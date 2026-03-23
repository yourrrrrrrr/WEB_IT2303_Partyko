/**
 * Точка входа: Task Manager — JWT + RBAC (Лабораторная 4).
 * Эндпоинты: /auth/*, /api/tasks, /api/users. Фронт раздаётся с того же сервера.
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
const authRoutes = require('./routes/auth');
const tasksRoutes = require('./routes/tasks');
const usersRoutes = require('./routes/users');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:5500', 'http://127.0.0.1:5500'],
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

app.use('/auth', authRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/users', usersRoutes);

// Статика: фронтенд с того же сервера
app.use(express.static(path.join(__dirname, '..')));

app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});
app.use((req, res) => {
  res.status(404).json({ error: 'Маршрут не найден' });
});

async function seedAdmin() {
  if (users.size > 0) return;
  const passwordHash = await argon2.hash('admin123', {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1
  });
  const id = uuidv4();
  users.set(id, {
    id,
    email: 'admin@example.com',
    passwordHash,
    role: 'admin',
    active: true,
    createdAt: new Date().toISOString()
  });
  console.log('[SEED] Админ: admin@example.com / admin123');
}

(async () => {
  await seedAdmin();
  app.listen(PORT, () => {
    console.log(`Lab4 Task Manager: http://localhost:${PORT}`);
    console.log('  POST   /auth/register   POST   /auth/login   POST   /auth/refresh   POST   /auth/logout');
    console.log('  GET    /auth/me');
    console.log('  GET    /api/tasks       POST   /api/tasks     PATCH  /api/tasks/:id  PATCH  /api/tasks/:id/status  DELETE /api/tasks/:id');
    console.log('  GET    /api/users       PATCH  /api/users/:id/role  PATCH  /api/users/:id/deactivate');
  });
})();
