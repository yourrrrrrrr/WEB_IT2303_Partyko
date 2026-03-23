/**
 * Маршруты /api/tasks: список, создание, обновление, смена статуса, удаление.
 * user: только свои; manager+: все задачи, смена статуса; admin: удаление любой.
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { tasks } = require('../db');
const { requireAuth } = require('../middleware/authenticate');
const { requirePermission, requireOwnerOrRole } = require('../middleware/authorize');

const router = express.Router();

const ALLOWED_STATUSES = ['open', 'in_progress', 'done', 'cancelled'];

// GET /api/tasks — список (user: только свои, manager+: все)
router.get('/', requireAuth, (req, res) => {
  const result = [];
  if (req.user.permissions.includes('tasks:read:any')) {
    for (const task of tasks.values()) result.push(task);
  } else {
    for (const task of tasks.values()) {
      if (task.ownerId === req.user.id) result.push(task);
    }
  }
  res.json({ tasks: result, total: result.length });
});

// POST /api/tasks — создать задачу
router.post('/', requireAuth, requirePermission('tasks:create'), (req, res) => {
  const { title, description } = req.body || {};
  if (!title || typeof title !== 'string' || title.trim().length < 3) {
    return res.status(400).json({ error: 'Заголовок (title) обязателен, минимум 3 символа' });
  }
  const id = uuidv4();
  const now = new Date().toISOString();
  const task = {
    id,
    title: title.trim(),
    description: typeof description === 'string' ? description.trim() : '',
    status: 'open',
    ownerId: req.user.id,
    createdAt: now,
    updatedAt: now
  };
  tasks.set(id, task);
  res.status(201).json({ message: 'Задача создана', task });
});

// PATCH /api/tasks/:id — обновить (title, description). Владелец или manager+
router.patch('/:id', requireAuth, (req, res, next) => {
  const task = tasks.get(req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Задача не найдена' });
  }
  req.ownerId = task.ownerId;
  next();
}, requireOwnerOrRole('manager'), (req, res) => {
  const task = tasks.get(req.params.id);
  const { title, description } = req.body || {};
  if (title !== undefined) {
    if (typeof title !== 'string' || title.trim().length < 3) {
      return res.status(400).json({ error: 'Заголовок: минимум 3 символа' });
    }
    task.title = title.trim();
  }
  if (description !== undefined) {
    if (typeof description !== 'string') {
      return res.status(400).json({ error: 'Описание должно быть строкой' });
    }
    task.description = description.trim();
  }
  task.updatedAt = new Date().toISOString();
  tasks.set(task.id, task);
  res.json({ message: 'Задача обновлена', task });
});

// PATCH /api/tasks/:id/status — изменить статус (только manager+)
router.patch('/:id/status', requireAuth, requirePermission('tasks:status:update:any'), (req, res) => {
  const task = tasks.get(req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Задача не найдена' });
  }
  const { status } = req.body || {};
  if (!ALLOWED_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Недопустимый статус. Допустимые: ${ALLOWED_STATUSES.join(', ')}` });
  }
  task.status = status;
  task.updatedAt = new Date().toISOString();
  tasks.set(task.id, task);
  res.json({ message: 'Статус обновлён', task });
});

// DELETE /api/tasks/:id — удалить (user: только свою, admin: любую). Чужую для user → 404
router.delete('/:id', requireAuth, (req, res, next) => {
  const task = tasks.get(req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Задача не найдена' });
  }
  req.ownerId = task.ownerId;
  req.task = task;
  next();
}, (req, res, next) => {
  const isOwner = req.task.ownerId === req.user.id;
  const canDeleteAny = req.user.permissions.includes('tasks:delete:any');
  if (!isOwner && !canDeleteAny) {
    return res.status(404).json({ error: 'Задача не найдена' });
  }
  next();
}, (req, res) => {
  tasks.delete(req.task.id);
  res.json({ message: 'Задача удалена' });
});

module.exports = router;
