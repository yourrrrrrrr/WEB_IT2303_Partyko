require('dotenv').config();

const express = require('express');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcrypt');

const { openDb, initDb, seedDb } = require('./db');
const { sanitizeReviewHtml } = require('./security/sanitizeReviewHtml');
const { ensureCsrfCookie, verifyCsrf } = require('./security/csrf');
const { createSession, deleteSession, requireAuth, requireAdmin } = require('./auth/sessions');

const PORT = Number(process.env.PORT || 3006);

const app = express();
const db = openDb();
initDb(db);
seedDb(db);

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

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

app.use(express.json({ limit: '128kb' }));
app.use(express.urlencoded({ extended: false, limit: '128kb' }));
app.use(cookieParser());

app.use(
  express.static(PUBLIC_DIR, {
    setHeaders(res) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
    }
  })
);

app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

// GET /api/products (первый запрос ставит csrf-token cookie)
app.get('/api/products', (req, res) => {
  ensureCsrfCookie(req, res);

  db.all('SELECT id, name, price_cents FROM products ORDER BY id ASC', [], (err, rows) => {
    if (err) {
      console.error('[DB ERROR]', err);
      return res.status(500).json({ error: 'Server error' });
    }
    res.json({ products: rows });
  });
});

function parseProductId(req, res) {
  const raw = String(req.params.id ?? '');
  if (!/^\d+$/.test(raw)) {
    res.status(400).json({ error: 'Некорректный productId' });
    return null;
  }
  const id = parseInt(raw, 10);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: 'Некорректный productId' });
    return null;
  }
  return id;
}

function parseReviewId(req, res) {
  const raw = String(req.params.id ?? '');
  if (!/^\d+$/.test(raw)) {
    res.status(400).json({ error: 'Некорректный reviewId' });
    return null;
  }
  const id = parseInt(raw, 10);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: 'Некорректный reviewId' });
    return null;
  }
  return id;
}

// public: GET reviews for product
app.get('/api/products/:id/reviews', (req, res) => {
  const productId = parseProductId(req, res);
  if (!productId) return;

  db.all(
    'SELECT id, product_id, author, body_html, created_at FROM reviews WHERE product_id = ? ORDER BY id DESC',
    [productId],
    (err, rows) => {
      if (err) {
        console.error('[DB ERROR]', err);
        return res.status(500).json({ error: 'Server error' });
      }
      res.json({ reviews: rows });
    }
  );
});

// rate limit: max 3 reviews per minute per IP
const reviewLimiter = rateLimit({
  windowMs: 60_000,
  limit: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too Many Requests' }
});

// auth: login/logout
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Некорректные данные' });
  }
  const u = username.trim();
  if (!u || u.length > 64 || password.length > 128) {
    return res.status(400).json({ error: 'Некорректные данные' });
  }

  db.get('SELECT id, username, password_hash, role FROM users WHERE username = ?', [u], async (err, row) => {
    if (err) {
      console.error('[DB ERROR]', err);
      return res.status(500).json({ error: 'Server error' });
    }

    if (!row) return res.status(401).json({ error: 'Ошибка входа' });
    const ok = await bcrypt.compare(password, row.password_hash).catch(() => false);
    if (!ok) return res.status(401).json({ error: 'Ошибка входа' });

    const sessionId = createSession({ username: row.username, role: row.role });
    res.cookie('sessionId', sessionId, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production'
    });
    res.json({ ok: true });
  });
});

app.post('/api/logout', (req, res) => {
  const sid = req.cookies?.sessionId;
  deleteSession(sid);
  res.clearCookie('sessionId');
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// create review: auth + csrf + limiter
app.post('/api/products/:id/reviews', requireAuth, verifyCsrf, reviewLimiter, (req, res) => {
  const productId = parseProductId(req, res);
  if (!productId) return;

  const { body } = req.body || {};
  const sanitized = sanitizeReviewHtml(body);
  if (!sanitized.ok) return res.status(400).json({ error: sanitized.error });

  // author only from session
  const author = req.user.username;

  // Ensure product exists
  db.get('SELECT id FROM products WHERE id = ?', [productId], (err, row) => {
    if (err) {
      console.error('[DB ERROR]', err);
      return res.status(500).json({ error: 'Server error' });
    }
    if (!row) return res.status(404).json({ error: 'Product not found' });

    db.run(
      'INSERT INTO reviews(product_id, author, body_html, created_at) VALUES (?, ?, ?, ?)',
      [productId, author, sanitized.value, new Date().toISOString()],
      function (err2) {
        if (err2) {
          console.error('[DB ERROR]', err2);
          return res.status(500).json({ error: 'Server error' });
        }
        res.status(201).json({ id: this.lastID });
      }
    );
  });
});

// delete review: admin + csrf
app.delete('/api/reviews/:id', requireAuth, requireAdmin, verifyCsrf, (req, res) => {
  const reviewId = parseReviewId(req, res);
  if (!reviewId) return;

  db.run('DELETE FROM reviews WHERE id = ?', [reviewId], function (err) {
    if (err) {
      console.error('[DB ERROR]', err);
      return res.status(500).json({ error: 'Server error' });
    }
    if (this.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  });
});

// helper endpoint for demo-seed users (disabled in production)
app.post('/__dev/seed-users', async (req, res) => {
  if (process.env.NODE_ENV === 'production') return res.status(404).json({ error: 'Not found' });

  const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
  const userPass = process.env.USER_PASSWORD || 'user123';

  const adminHash = await bcrypt.hash(adminPass, 10);
  const userHash = await bcrypt.hash(userPass, 10);

  db.serialize(() => {
    db.run('INSERT OR IGNORE INTO users(username, password_hash, role) VALUES (?, ?, ?)', ['admin', adminHash, 'admin']);
    db.run('INSERT OR IGNORE INTO users(username, password_hash, role) VALUES (?, ?, ?)', ['alice', userHash, 'user']);
  });

  res.json({ ok: true, users: [{ username: 'admin', password: adminPass }, { username: 'alice', password: userPass }] });
});

// global error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[UNHANDLED ERROR]', err);
  res.status(500).json({ error: 'Server error' });
});

app.listen(PORT, () => {
  console.log(`Lab6/task1 listening on http://localhost:${PORT}`);
});

