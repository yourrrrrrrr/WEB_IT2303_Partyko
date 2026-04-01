require('dotenv').config();

const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const bcrypt = require('bcrypt');

const { openDb, initDb, seedDb } = require('./db');
const { escapeHtml } = require('./security/html');
const { validatePreviewUrl } = require('./security/ssrf');
const { looksLikeSqlInjection, logSqlInjectionAttempt, logBlockedSsrf } = require('./security/logging');
const { signToken, authenticate, requireAdmin } = require('./auth/jwt');
const { upload } = require('./upload');

const PORT = Number(process.env.PORT || 3010);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const app = express();
const db = openDb();
initDb(db);
seedDb(db).catch((e) => console.error('[SEED ERROR]', e));

// Security headers
app.use(helmet());
app.use(
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"]
    }
  })
);

// CORS только для https://myblog.com
app.use(
  cors({
    origin: (origin, cb) => {
      // Разрешаем запросы без Origin (curl/Postman) и same-origin поведение.
      if (!origin) return cb(null, true);

      const allowed = ['https://myblog.com'];
      // В dev разрешаем локальный фронт, чтобы можно было пользоваться приложением.
      if (process.env.NODE_ENV !== 'production') {
        allowed.push('http://localhost:3010', 'http://127.0.0.1:3010');
      }

      if (allowed.includes(origin)) return cb(null, true);
      return cb(new Error('CORS blocked'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
  })
);

app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());

// Static files (uploads not executable; nosniff already from helmet)
app.use(
  express.static(PUBLIC_DIR, {
    setHeaders(res) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
    }
  })
);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too Many Requests' }
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too Many Requests' }
});

function parseIntParam(value) {
  const raw = String(value ?? '');
  if (looksLikeSqlInjection(raw)) logSqlInjectionAttempt('param', raw);
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : NaN;
}

// [2] Login: parameterized query + bcrypt + JWT in HttpOnly cookie
app.post('/login', loginLimiter, (req, res, next) => {
  const { username, password } = req.body || {};
  const u = typeof username === 'string' ? username.trim() : '';
  const p = typeof password === 'string' ? password : '';

  if (looksLikeSqlInjection(u) || looksLikeSqlInjection(p)) {
    logSqlInjectionAttempt('login', `${u}:${p}`);
  }

  if (!u || !p || u.length > 64 || p.length > 128) {
    return res.status(400).json({ error: 'Некорректные данные' });
  }

  db.get('SELECT id, username, password_hash, role FROM users WHERE username = ?', [u], async (err, user) => {
    if (err) return next(err);
    if (!user) return res.status(401).json({ error: 'Ошибка входа' });

    const ok = await bcrypt.compare(p, user.password_hash).catch(() => false);
    if (!ok) return res.status(401).json({ error: 'Ошибка входа' });

    const token = signToken(user);
    res.cookie('auth', token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production'
    });
    res.json({ ok: true });
  });
});

app.post('/logout', (req, res) => {
  res.clearCookie('auth');
  res.json({ ok: true });
});

// [3] Get article (no err.message to client; prevent SQLi)
app.get('/articles/:id', (req, res, next) => {
  const id = parseIntParam(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'Некорректный id' });

  db.get('SELECT id, title, content, author_id, status, created_at FROM articles WHERE id = ?', [id], (err, row) => {
    if (err) return next(err);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  });
});

// [4] Create comment: no SQLi, author from session/JWT, store plain text
app.post('/articles/:id/comments', authenticate, (req, res, next) => {
  const articleId = parseIntParam(req.params.id);
  if (!Number.isFinite(articleId) || articleId <= 0) return res.status(400).json({ error: 'Некорректный id' });

  const body = typeof req.body?.body === 'string' ? req.body.body : '';
  if (looksLikeSqlInjection(body)) logSqlInjectionAttempt('comment_body', body);
  if (!body || body.length > 2000) return res.status(400).json({ error: 'Некорректный комментарий' });

  db.get('SELECT id FROM articles WHERE id = ?', [articleId], (err, row) => {
    if (err) return next(err);
    if (!row) return res.status(404).json({ error: 'Not found' });

    db.run(
      'INSERT INTO comments(article_id, author_id, body, created_at) VALUES (?, ?, ?, ?)',
      [articleId, req.user.id, body, new Date().toISOString()],
      function (err2) {
        if (err2) return next(err2);
        res.status(201).json({ id: this.lastID });
      }
    );
  });
});

// [5] List comments in HTML: escape output to prevent XSS
app.get('/articles/:id/comments', (req, res, next) => {
  const articleId = parseIntParam(req.params.id);
  if (!Number.isFinite(articleId) || articleId <= 0) return res.status(400).send('Bad Request');

  db.all(
    `
      SELECT c.id, c.body, c.created_at, u.username AS author
      FROM comments c
      JOIN users u ON u.id = c.author_id
      WHERE c.article_id = ?
      ORDER BY c.id ASC
    `,
    [articleId],
    (err, rows) => {
      if (err) return next(err);
      const html = (rows || [])
        .map((r) => `<div><b>${escapeHtml(r.author)}</b>: ${escapeHtml(r.body)}</div>`)
        .join('');
      res.send(`<html><body>${html}</body></html>`);
    }
  );
});

// [6] Upload: only images, uuid filename, 5MB, rate limited, auth required
app.post('/upload', authenticate, uploadLimiter, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: 'Недопустимый файл' });
    }
    if (!req.file) return res.status(400).json({ error: 'Файл обязателен' });
    res.json({ path: `/uploads/${req.file.filename}` });
  });
});

// [8] Publish: only admin; and only author or admin can change own articles
app.post('/articles/:id/publish', authenticate, (req, res, next) => {
  const id = parseIntParam(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'Некорректный id' });

  db.get('SELECT id, author_id, status FROM articles WHERE id = ?', [id], (err, row) => {
    if (err) return next(err);
    if (!row) return res.status(404).json({ error: 'Not found' });

    const isOwner = row.author_id === req.user.id;
    const isAdmin = req.user.role === 'admin';
    if (!isOwner && !isAdmin) return res.status(403).json({ error: 'Forbidden' });
    if (!isAdmin) return res.status(403).json({ error: 'Forbidden' });

    db.run('UPDATE articles SET status = ? WHERE id = ?', ['published', id], (err2) => {
      if (err2) return next(err2);
      res.json({ success: true });
    });
  });
});

// [9] Preview: SSRF protection + https only + allowlist + timeout
app.get('/preview', async (req, res) => {
  const url = String(req.query?.url || '');
  const v = await validatePreviewUrl(url);
  if (!v.ok) {
    logBlockedSsrf(url, v.error);
    return res.status(400).json({ error: 'URL не разрешён' });
  }
  try {
    const response = await axios.get(v.url, { timeout: 5000, responseType: 'text', maxRedirects: 0 });
    res.type('text/plain').send(String(response.data).slice(0, 200_000));
  } catch {
    res.status(502).json({ error: 'Не удалось получить превью' });
  }
});

// [10] /debug/config удалён => 404 (ничего не регистрируем)

// example admin-only endpoint (kept minimal for demo)
app.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

// Global error handler (no stack trace to client)
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // Invalid JSON in request body (express.json)
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Bad Request' });
  }
  if (err && err.message === 'CORS blocked') {
    return res.status(403).json({ error: 'CORS blocked' });
  }
  console.error('[ERROR]', err);
  res.status(500).json({ error: 'Server error' });
});

app.listen(PORT, () => {
  console.log(`Lab6/task2 listening on http://localhost:${PORT}`);
});

