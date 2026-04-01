const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const { createClient } = require('redis');
require('dotenv').config();

const PORT = Number(process.env.PORT || 3007);
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const SESSION_TTL_SEC = 2 * 60 * 60;

/** Сообщение об ошибке Redis (у части сетевых ошибок в Node message бывает пустым). */
function redisErrText(err) {
  if (!err) return 'unknown';
  if (err.errors && Array.isArray(err.errors)) {
    return err.errors.map((e) => redisErrText(e)).join('; ');
  }
  const parts = [
    err.message,
    err.code,
    typeof err.errno === 'number' ? `errno=${err.errno}` : null,
    err.syscall,
    err.address && err.port != null ? `${err.address}:${err.port}` : err.address
  ].filter(Boolean);
  return parts.length ? parts.join(' | ') : String(err);
}

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public')));

const redisSocket = {
  reconnectStrategy: (retries) => Math.min(retries * 100, 3000)
};

const redis = createClient({ url: REDIS_URL, socket: redisSocket });
const publisher = redis.duplicate();
const subscriber = redis.duplicate();

redis.on('error', (err) => console.error('Redis error:', redisErrText(err)));
publisher.on('error', (err) => console.error('Publisher error:', redisErrText(err)));
subscriber.on('error', (err) => console.error('Subscriber error:', redisErrText(err)));

const users = new Map();
users.set('admin@example.com', { userId: 'u-admin', email: 'admin@example.com', password: 'admin123', role: 'admin' });
users.set('user@example.com', { userId: 'u-1', email: 'user@example.com', password: 'user12345', role: 'user' });

const clientsByChannel = new Map();
const channelRefCount = new Map();
const activeSubscriptions = new Set();

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const raw = forwarded ? String(forwarded).split(',')[0].trim() : req.ip || req.socket.remoteAddress || 'unknown';
  return raw.startsWith('::ffff:') ? raw.slice(7) : raw;
}

function rateLimiter(options) {
  const { routeName, max, windowSec } = options;
  return async (req, res, next) => {
    try {
      const ip = getClientIp(req);
      const key = `rl:${routeName}:${ip}`;
      const count = await redis.incr(key);
      if (count === 1) {
        await redis.expire(key, windowSec);
      }
      const ttl = Math.max(await redis.ttl(key), 0);
      const remaining = Math.max(max - count, 0);
      const resetAt = Math.floor(Date.now() / 1000) + ttl;

      res.setHeader('X-RateLimit-Limit', String(max));
      res.setHeader('X-RateLimit-Remaining', String(remaining));
      res.setHeader('X-RateLimit-Reset', String(resetAt));

      if (count > max) {
        return res.status(429).json({
          error: 'Too Many Requests',
          route: routeName,
          retryAfterSec: ttl
        });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

async function subscribeChannel(channel) {
  if (activeSubscriptions.has(channel)) return;
  await subscriber.subscribe(channel, (message, receivedChannel) => {
    const targets = clientsByChannel.get(receivedChannel);
    if (!targets || targets.size === 0) return;
    for (const res of targets) {
      res.write(`event: notification\n`);
      res.write(`data: ${message}\n\n`);
    }
  });
  activeSubscriptions.add(channel);
}

async function unsubscribeChannel(channel) {
  if (!activeSubscriptions.has(channel)) return;
  await subscriber.unsubscribe(channel);
  activeSubscriptions.delete(channel);
}

async function addSseClient(channel, res) {
  if (!clientsByChannel.has(channel)) {
    clientsByChannel.set(channel, new Set());
  }
  clientsByChannel.get(channel).add(res);
  const refs = (channelRefCount.get(channel) || 0) + 1;
  channelRefCount.set(channel, refs);
  if (refs === 1) {
    await subscribeChannel(channel);
  }
}

async function removeSseClient(channel, res) {
  const set = clientsByChannel.get(channel);
  if (set) {
    set.delete(res);
    if (set.size === 0) clientsByChannel.delete(channel);
  }
  const refs = Math.max((channelRefCount.get(channel) || 1) - 1, 0);
  if (refs === 0) {
    channelRefCount.delete(channel);
    await unsubscribeChannel(channel);
  } else {
    channelRefCount.set(channel, refs);
  }
}

function sessionKey(sessionId) {
  return `session:${sessionId}`;
}

async function touchSession(sessionId) {
  const key = sessionKey(sessionId);
  await redis.hSet(key, 'lastActivity', new Date().toISOString());
  await redis.expire(key, SESSION_TTL_SEC);
}

async function requireSession(req, res, next) {
  try {
    const sid = req.cookies.sessionId;
    if (!sid) {
      return res.status(401).json({ error: 'Нет сессии' });
    }
    const session = await redis.hGetAll(sessionKey(sid));
    if (!session || Object.keys(session).length === 0) {
      res.clearCookie('sessionId');
      return res.status(401).json({ error: 'Сессия не найдена или истекла' });
    }
    req.sessionId = sid;
    req.session = session;
    await touchSession(sid);
    next();
  } catch (err) {
    next(err);
  }
}

app.post('/api/login', rateLimiter({ routeName: '/api/login', max: 5, windowSec: 15 * 60 }), (req, res) => {
  res.json({ ok: true, message: 'Login endpoint rate-limited' });
});

app.post('/api/register', rateLimiter({ routeName: '/api/register', max: 3, windowSec: 60 * 60 }), (req, res) => {
  res.json({ ok: true, message: 'Register endpoint rate-limited' });
});

app.get('/api/search', rateLimiter({ routeName: '/api/search', max: 30, windowSec: 60 }), (req, res) => {
  const q = String(req.query.q || '').trim();
  const fakeResults = q ? [`result for "${q}" #1`, `result for "${q}" #2`] : [];
  res.json({ q, items: fakeResults });
});

app.get('/api/notifications/stream/:userId', async (req, res, next) => {
  try {
    const { userId } = req.params;
    const userChannel = `notifications:${userId}`;
    const globalChannel = 'notifications:global';

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    res.write('event: connected\n');
    res.write(`data: ${JSON.stringify({ message: 'SSE connected', userId })}\n\n`);

    await addSseClient(userChannel, res);
    await addSseClient(globalChannel, res);

    const ping = setInterval(() => {
      res.write('event: ping\n');
      res.write(`data: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
    }, 25000);

    req.on('close', async () => {
      clearInterval(ping);
      await removeSseClient(userChannel, res);
      await removeSseClient(globalChannel, res);
    });
  } catch (err) {
    next(err);
  }
});

app.post('/api/notifications/send', async (req, res, next) => {
  try {
    const { userId, message, type = 'info' } = req.body || {};
    if (!message) {
      return res.status(400).json({ error: 'message обязателен' });
    }
    const channel = userId ? `notifications:${userId}` : 'notifications:global';
    const payload = {
      type,
      message,
      timestamp: new Date().toISOString()
    };
    await publisher.publish(channel, JSON.stringify(payload));
    res.json({ ok: true, channel, payload });
  } catch (err) {
    next(err);
  }
});

app.post('/api/notifications/broadcast', async (req, res, next) => {
  try {
    const { message } = req.body || {};
    if (!message) {
      return res.status(400).json({ error: 'message обязателен' });
    }
    const payload = {
      type: 'broadcast',
      message,
      timestamp: new Date().toISOString()
    };
    await publisher.publish('notifications:global', JSON.stringify(payload));
    res.json({ ok: true, channel: 'notifications:global', payload });
  } catch (err) {
    next(err);
  }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    const user = users.get(String(email || '').toLowerCase());
    if (!user || user.password !== password) {
      return res.status(401).json({ error: 'Неверные credentials' });
    }

    const sid = crypto.randomBytes(32).toString('hex');
    const key = sessionKey(sid);
    const data = {
      userId: user.userId,
      email: user.email,
      role: user.role,
      loginAt: new Date().toISOString(),
      loginIp: getClientIp(req),
      userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
      lastActivity: new Date().toISOString()
    };

    await redis.hSet(key, data);
    await redis.expire(key, SESSION_TTL_SEC);

    res.cookie('sessionId', sid, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: SESSION_TTL_SEC * 1000
    });
    res.json({ ok: true, user: { userId: user.userId, email: user.email, role: user.role } });
  } catch (err) {
    next(err);
  }
});

app.get('/api/auth/me', requireSession, async (req, res, next) => {
  try {
    const ttl = await redis.ttl(sessionKey(req.sessionId));
    res.json({ sessionId: req.sessionId, ttlSec: ttl, session: req.session });
  } catch (err) {
    next(err);
  }
});

app.post('/api/auth/logout', requireSession, async (req, res, next) => {
  try {
    await redis.del(sessionKey(req.sessionId));
    res.clearCookie('sessionId');
    res.json({ ok: true, message: 'Сессия удалена' });
  } catch (err) {
    next(err);
  }
});

app.get('/api/auth/sessions', requireSession, async (req, res, next) => {
  try {
    const targetUserId = req.session.userId;
    const sessions = [];
    let cursor = 0;
    do {
      const reply = await redis.scan(cursor, { MATCH: 'session:*', COUNT: 100 });
      cursor = Number(reply.cursor);
      const keys = reply.keys || [];
      for (const key of keys) {
        const data = await redis.hGetAll(key);
        if (data.userId === targetUserId) {
          const ttl = await redis.ttl(key);
          sessions.push({
            sessionId: key.slice('session:'.length),
            ...data,
            ttlSec: ttl
          });
        }
      }
    } while (cursor !== 0);

    res.json({ userId: targetUserId, sessions });
  } catch (err) {
    next(err);
  }
});

app.get('/api/debug/redis', async (req, res, next) => {
  try {
    const keys = await redis.keys('*');
    const info = {};
    for (const key of keys) {
      const type = await redis.type(key);
      const ttl = await redis.ttl(key);
      const value = type === 'hash' ? await redis.hGetAll(key) : await redis.get(key);
      info[key] = { type, ttl, value };
    }
    res.json(info);
  } catch (err) {
    next(err);
  }
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Ошибка сервера' });
});

async function start() {
  await redis.connect();
  await publisher.connect();
  await subscriber.connect();
  app.listen(PORT, () => {
    console.log(`Lab7 Task1 started: http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error('Не удалось запустить приложение:', redisErrText(err));
  console.error('\nСкорее всего Redis не запущен или неверный REDIS_URL в .env');
  console.error('Примеры запуска Redis:');
  console.error('  docker run -d -p 6379:6379 --name redis redis:7-alpine');
  console.error('  redis-server   (если установлен локально)');
  console.error(`Текущий REDIS_URL: ${REDIS_URL}\n`);
  process.exit(1);
});
