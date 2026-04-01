const path = require('path');
const { randomUUID } = require('crypto');
const { v4: uuidv4 } = require('uuid');
const express = require('express');
const { createClient } = require('redis');
require('dotenv').config();

const PORT = Number(process.env.PORT || 3008);
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

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

const KEYS = {
  leaderboardGlobal: 'leaderboard:global',
  streamEvents: 'events:game',
  statsSummary: 'stats:summary',
  statsPlayersTotal: 'stats:players:total',
  statsAchievementsProcessed: 'stats:achievements:processed',
  queueMain: 'queue:achievements',
  queueProcessing: 'queue:achievements:processing',
  queueFailed: 'queue:achievements:failed',
  queueDlq: 'queue:achievements:dlq'
};

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const redis = createClient({
  url: REDIS_URL,
  socket: { reconnectStrategy: (retries) => Math.min(retries * 100, 3000) }
});
redis.on('error', (err) => console.error('Redis error:', redisErrText(err)));

let workerRunning = true;

function weeklyKey(date = new Date()) {
  const copy = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = copy.getUTCDay() || 7;
  copy.setUTCDate(copy.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(copy.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((copy - yearStart) / 86400000) + 1) / 7);
  return `leaderboard:week:${copy.getUTCFullYear()}-${String(weekNo).padStart(2, '0')}`;
}

function playerKey(userId) {
  return `player:${userId}`;
}

function lockKey(resource) {
  return `lock:${resource}`;
}

async function addEvent(userId, event, data) {
  await redis.xAdd(KEYS.streamEvents, '*', {
    userId: String(userId || ''),
    event,
    data: JSON.stringify(data || {}),
    timestamp: new Date().toISOString()
  });
}

async function ensureWeeklyExpire() {
  const key = weeklyKey();
  const ttl = await redis.ttl(key);
  if (ttl < 0) await redis.expire(key, 8 * 24 * 3600);
}

async function acquireLock(resource, ttlMs) {
  const id = randomUUID();
  const key = lockKey(resource);
  const result = await redis.set(key, id, { NX: true, PX: ttlMs });
  return { acquired: result === 'OK', lockId: result === 'OK' ? id : null };
}

async function releaseLock(resource, lockId) {
  const lua = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("DEL", KEYS[1])
    else
      return 0
    end
  `;
  return redis.eval(lua, { keys: [lockKey(resource)], arguments: [lockId] });
}

async function withLock(resource, ttlMs, fn) {
  let attempt = 0;
  while (attempt < 3) {
    attempt += 1;
    const lock = await acquireLock(resource, ttlMs);
    if (lock.acquired) {
      try {
        return await fn();
      } finally {
        await releaseLock(resource, lock.lockId);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Не удалось получить блокировку');
}

async function incrementScoreWithFloorZero(userId, delta) {
  const lua = `
    local key = KEYS[1]
    local member = ARGV[1]
    local diff = tonumber(ARGV[2])
    local nextScore = tonumber(redis.call("ZINCRBY", key, diff, member))
    if nextScore < 0 then
      nextScore = 0
      redis.call("ZADD", key, 0, member)
    end
    return tostring(nextScore)
  `;
  const out = await redis.eval(lua, { keys: [KEYS.leaderboardGlobal], arguments: [userId, String(delta)] });
  return Number(out);
}

async function rankFor(userId) {
  const rank = await redis.zRevRank(KEYS.leaderboardGlobal, userId);
  return rank === null ? null : rank + 1;
}

async function getUsername(userId) {
  const value = await redis.hGet(playerKey(userId), 'username');
  return value || `user-${userId}`;
}

app.post('/api/scores', async (req, res, next) => {
  try {
    const { userId, username, score } = req.body || {};
    if (!userId || !username || Number.isNaN(Number(score))) {
      return res.status(400).json({ error: 'userId, username, score обязательны' });
    }

    const result = await withLock(`score:${userId}`, 2000, async () => {
      const oldScore = await redis.zScore(KEYS.leaderboardGlobal, userId);
      await redis.hSet(playerKey(userId), { username, updatedAt: new Date().toISOString() });
      await redis.zAdd(KEYS.leaderboardGlobal, [{ score: Number(score), value: userId }]);
      const wKey = weeklyKey();
      await redis.zAdd(wKey, [{ score: Number(score), value: userId }]);
      await ensureWeeklyExpire();
      const rank = await rankFor(userId);
      if (oldScore === null) {
        await addEvent(userId, 'player_joined', { username });
      }
      await addEvent(userId, 'score_updated', { score: Number(score), mode: 'set' });
      return { rank };
    });

    res.json({ ok: true, userId, rank: result.rank });
  } catch (err) {
    next(err);
  }
});

app.post('/api/scores/increment', async (req, res, next) => {
  try {
    const { userId, delta } = req.body || {};
    if (!userId || Number.isNaN(Number(delta))) {
      return res.status(400).json({ error: 'userId и delta обязательны' });
    }
    const value = Number(delta);
    const result = await withLock(`score:${userId}`, 2000, async () => {
      const score = await incrementScoreWithFloorZero(userId, value);
      const rank = await rankFor(userId);
      await addEvent(userId, 'score_updated', { delta: value, score, mode: 'increment' });
      return { score, rank };
    });
    res.json({ ok: true, userId, ...result });
  } catch (err) {
    next(err);
  }
});

app.get('/api/leaderboard', async (req, res, next) => {
  try {
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || req.query.top || 10), 1), 100);
    const start = (page - 1) * limit;
    const end = start + limit - 1;
    // В node-redis нет zRevRangeWithScores в используемой версии,
    // поэтому берём ZRANGE WITHSCORES с флагом REV.
    const rows = await redis.zRangeWithScores(KEYS.leaderboardGlobal, start, end, { REV: true });
    const items = [];
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const rank = start + i + 1;
      const username = await getUsername(row.value);
      items.push({ rank, userId: row.value, username, score: row.score });
    }
    res.json({ page, limit, items });
  } catch (err) {
    next(err);
  }
});

app.get('/api/leaderboard/player/:userId', async (req, res, next) => {
  try {
    const userId = req.params.userId;
    const score = await redis.zScore(KEYS.leaderboardGlobal, userId);
    const rank = await rankFor(userId);
    if (score === null || rank === null) {
      return res.status(404).json({ error: 'Игрок не найден' });
    }
    const start = Math.max(rank - 3, 0);
    const end = rank + 1;
    const neighborsRaw = await redis.zRangeWithScores(KEYS.leaderboardGlobal, start, end, { REV: true });
    const neighbors = [];
    for (let i = 0; i < neighborsRaw.length; i += 1) {
      const item = neighborsRaw[i];
      neighbors.push({
        rank: start + i + 1,
        userId: item.value,
        username: await getUsername(item.value),
        score: item.score
      });
    }
    res.json({ userId, score: Number(score), rank, neighbors });
  } catch (err) {
    next(err);
  }
});

app.get('/api/leaderboard/weekly', async (req, res, next) => {
  try {
    const key = weeklyKey();
    const rows = await redis.zRangeWithScores(key, 0, 9, { REV: true });
    const items = [];
    for (let i = 0; i < rows.length; i += 1) {
      items.push({
        rank: i + 1,
        userId: rows[i].value,
        username: await getUsername(rows[i].value),
        score: rows[i].score
      });
    }
    res.json({ key, items });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/leaderboard/player/:userId', async (req, res, next) => {
  try {
    const { userId } = req.params;
    await redis.zRem(KEYS.leaderboardGlobal, userId);
    await redis.zRem(weeklyKey(), userId);
    await redis.del(playerKey(userId));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.post('/api/achievements/enqueue', async (req, res, next) => {
  try {
    const { userId, achievement, metadata = {} } = req.body || {};
    if (!userId || !achievement) {
      return res.status(400).json({ error: 'userId и achievement обязательны' });
    }
    const job = {
      id: uuidv4(),
      userId,
      achievement,
      metadata,
      attempts: 0,
      createdAt: new Date().toISOString()
    };
    await redis.lPush(KEYS.queueMain, JSON.stringify(job));
    res.json({ ok: true, job });
  } catch (err) {
    next(err);
  }
});

app.get('/api/achievements/stats', async (req, res, next) => {
  try {
    const [mainLen, processingLen, failedLen, dlqLen, processed, dlq] = await Promise.all([
      redis.lLen(KEYS.queueMain),
      redis.lLen(KEYS.queueProcessing),
      redis.lLen(KEYS.queueFailed),
      redis.lLen(KEYS.queueDlq),
      redis.get(KEYS.statsAchievementsProcessed),
      redis.lRange(KEYS.queueDlq, 0, -1)
    ]);
    res.json({
      queues: { mainLen, processingLen, failedLen, dlqLen },
      processed: Number(processed || 0),
      dlq: dlq.map((x) => JSON.parse(x))
    });
  } catch (err) {
    next(err);
  }
});

app.post('/api/players/register', async (req, res, next) => {
  try {
    const { userId, username, initialScore = 0, forceError = false } = req.body || {};
    if (!userId || !username) {
      return res.status(400).json({ error: 'userId и username обязательны' });
    }
    const now = new Date().toISOString();
    const wk = weeklyKey();
    const welcomeJob = JSON.stringify({
      id: uuidv4(),
      userId,
      achievement: 'welcome',
      metadata: { username },
      attempts: 0,
      createdAt: now
    });

    await ensureWeeklyExpire();
    const tx = redis.multi();
    tx.hSet(playerKey(userId), { username, joinedAt: now, gamesPlayed: '0' });
    tx.zAdd(KEYS.leaderboardGlobal, [{ score: Number(initialScore), value: userId }]);
    tx.zAdd(wk, [{ score: Number(initialScore), value: userId }]);
    tx.incr(KEYS.statsPlayersTotal);
    tx.lPush(KEYS.queueMain, welcomeJob);
    if (forceError) {
      // Демо "rollback": отменяем транзакцию до EXEC, чтобы Redis ничего не записал.
      await tx.discard();
      return res.status(400).json({ error: 'Искусственная ошибка: транзакция отменена (DISCARD)' });
    }

    const results = await tx.exec();
    if (!results) {
      return res.status(409).json({ error: 'Транзакция не выполнена' });
    }
    await addEvent(userId, 'player_joined', { username, source: 'register' });
    const rank = await rankFor(userId);
    const totalPlayers = Number(await redis.get(KEYS.statsPlayersTotal) || 0);
    res.json({ player: { userId, username, initialScore: Number(initialScore) }, rank, totalPlayers });
  } catch (err) {
    next(err);
  }
});

app.get('/api/events', async (req, res, next) => {
  try {
    const { userId, event, from = '-', limit = '20' } = req.query;
    const count = Math.min(Math.max(Number(limit), 1), 200);
    const rows = await redis.xRange(KEYS.streamEvents, from, '+', { COUNT: count });
    const mapped = rows.map((row) => ({
      id: row.id,
      userId: row.message.userId || '',
      event: row.message.event || '',
      data: safeJson(row.message.data),
      timestamp: row.message.timestamp || ''
    }));
    const filtered = mapped.filter((item) => {
      if (userId && item.userId !== userId) return false;
      if (event && item.event !== event) return false;
      return true;
    });
    res.json({ items: filtered, nextFrom: filtered.length ? filtered[filtered.length - 1].id : from });
  } catch (err) {
    next(err);
  }
});

app.get('/api/stats/summary', async (req, res, next) => {
  try {
    const raw = await redis.get(KEYS.statsSummary);
    res.json(raw ? JSON.parse(raw) : { message: 'Пока нет агрегированной статистики' });
  } catch (err) {
    next(err);
  }
});

app.get('/api/debug/redis', async (req, res, next) => {
  try {
    const keys = await redis.keys('*');
    const out = {};
    for (const key of keys) {
      const type = await redis.type(key);
      const ttl = await redis.ttl(key);
      if (type === 'zset') {
        out[key] = { type, ttl, value: await redis.zRangeWithScores(key, 0, -1) };
      } else if (type === 'list') {
        out[key] = { type, ttl, value: await redis.lRange(key, 0, -1) };
      } else if (type === 'hash') {
        out[key] = { type, ttl, value: await redis.hGetAll(key) };
      } else {
        out[key] = { type, ttl, value: await redis.get(key) };
      }
    }
    res.json(out);
  } catch (err) {
    next(err);
  }
});

function safeJson(data) {
  try {
    return JSON.parse(data || '{}');
  } catch (_) {
    return { raw: data };
  }
}

async function processAchievement(rawJob) {
  const delay = 100 + Math.floor(Math.random() * 401);
  await new Promise((resolve) => setTimeout(resolve, delay));
  const fail = Math.random() < 0.2;
  const job = safeJson(rawJob);

  if (fail) {
    job.attempts = Number(job.attempts || 0) + 1;
    await redis.lRem(KEYS.queueProcessing, 1, rawJob);
    await redis.lPush(KEYS.queueFailed, JSON.stringify(job));
    if (job.attempts < 3) {
      await redis.lPush(KEYS.queueMain, JSON.stringify(job));
    } else {
      await redis.lPush(KEYS.queueDlq, JSON.stringify(job));
    }
    return;
  }

  await redis.lRem(KEYS.queueProcessing, 1, rawJob);
  await redis.incr(KEYS.statsAchievementsProcessed);
  await addEvent(job.userId || '', 'achievement_earned', {
    achievement: job.achievement || 'unknown',
    jobId: job.id || ''
  });
}

async function workerLoop() {
  while (workerRunning) {
    try {
      const raw = await redis.brPopLPush(KEYS.queueMain, KEYS.queueProcessing, 5);
      if (!raw) continue;
      await processAchievement(raw);
    } catch (err) {
      console.error('Worker error:', err.message);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

async function aggregateStats() {
  const now = Date.now();
  const fiveMinAgo = now - 5 * 60 * 1000;
  const rows = await redis.xRange(KEYS.streamEvents, '-', '+', { COUNT: 1000 });
  const recent = rows
    .map((r) => ({ id: r.id, message: r.message }))
    .filter((r) => {
      const ts = Date.parse(r.message.timestamp || 0);
      return Number.isFinite(ts) && ts >= fiveMinAgo;
    });

  const uniquePlayers = new Set();
  const byEvent = {};
  for (const row of recent) {
    if (row.message.userId) uniquePlayers.add(row.message.userId);
    const ev = row.message.event || 'unknown';
    byEvent[ev] = (byEvent[ev] || 0) + 1;
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    windowSec: 300,
    totalRecentEvents: recent.length,
    uniquePlayers: uniquePlayers.size,
    byEvent
  };

  await redis.set(KEYS.statsSummary, JSON.stringify(summary), { EX: 60 });
  await redis.xTrim(KEYS.streamEvents, 'MAXLEN', 10000);
}

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Ошибка сервера' });
});

async function start() {
  await redis.connect();
  setInterval(() => {
    aggregateStats().catch((err) => console.error('Aggregator error:', err.message));
  }, 30000);
  workerLoop().catch((err) => console.error('Worker loop fatal:', err.message));
  app.listen(PORT, () => {
    console.log(`Lab7 Task2 started: http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error('Не удалось запустить приложение:', redisErrText(err));
  console.error('\nСкорее всего Redis не запущен. Пример: docker run -d -p 6379:6379 redis:7-alpine');
  console.error(`REDIS_URL: ${REDIS_URL}\n`);
  process.exit(1);
});

process.on('SIGINT', async () => {
  workerRunning = false;
  await redis.quit();
  process.exit(0);
});
