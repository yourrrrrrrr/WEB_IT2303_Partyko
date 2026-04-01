/**
 * Основной сервер (порт 3000): authRouter + apiRouter, helmet CSP, CORS, rate limiters, статика.
 */

require('dotenv').config();
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const argon2 = require('argon2');
const { v4: uuidv4 } = require('uuid');
const { users } = require('./db');
const { requestId } = require('./middleware/requestId');
const { authLimiter, refreshLimiter, apiLimiter } = require('./middleware/rateLimiter');
const authRouter = require('./routes/auth');
const articlesRouter = require('./routes/articles');
const commentsRouter = require('./routes/comments');
const usersRouter = require('./routes/users');
const adminRouter = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"]
    }
  }
}));

app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:3000', 'http://127.0.0.1:5173'],
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  exposedHeaders: ['X-Request-ID', 'X-Permissions'],
  maxAge: 24 * 60 * 60
}));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(requestId);

app.use('/auth/login', authLimiter);
app.use('/auth/register', authLimiter);
app.use('/auth/refresh', refreshLimiter);
app.use('/api', apiLimiter);

app.use('/auth', authRouter);
app.use('/api/articles', articlesRouter);
app.use('/api/articles/:articleId/comments', commentsRouter);
app.use('/api/users', usersRouter);
app.use('/admin', adminRouter);

app.use(express.static(path.join(__dirname, '..')));

app.use((err, req, res, next) => {
  console.error('[ERROR]', res.locals?.requestId, err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});
app.use((req, res) => res.status(404).json({ error: 'Маршрут не найден' }));

async function seedAdmin() {
  if (users.size > 0) return;
  const passwordHash = await argon2.hash('admin123', { type: argon2.argon2id, memoryCost: 65536, timeCost: 3 });
  const id = uuidv4();
  users.set(id, {
    id,
    email: 'admin@example.com',
    passwordHash,
    role: 'admin',
    status: 'active',
    createdAt: new Date().toISOString()
  });
  console.log('[SEED] Админ: admin@example.com / admin123');
}

(async () => {
  await seedAdmin();
  app.listen(PORT, () => {
    console.log(`Lab5: http://localhost:${PORT}`);
    console.log('Mock OAuth (отдельно): node mock-oauth/server.js → :3001');
  });
})();
