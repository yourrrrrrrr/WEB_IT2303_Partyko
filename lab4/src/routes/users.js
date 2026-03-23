/**
 * Маршруты /api/users: список (manager+), смена роли (admin), деактивация (admin).
 * При смене роли и деактивации — инвалидация всех refresh-токенов пользователя.
 */

const express = require('express');
const { users } = require('../db');
const { ROLE_HIERARCHY } = require('../config/rbac');
const tokenService = require('../services/tokenService');
const { requireAuth } = require('../middleware/authenticate');
const { requirePermission } = require('../middleware/authorize');

const router = express.Router();

// GET /api/users — список пользователей (manager+)
router.get('/', requireAuth, requirePermission('users:read'), (req, res) => {
  const list = [];
  for (const u of users.values()) {
    list.push({
      id: u.id,
      email: u.email,
      role: u.role,
      active: u.active,
      createdAt: u.createdAt
    });
  }
  res.json({ users: list, total: list.length });
});

// PATCH /api/users/:id/role — изменить роль (admin). Инвалидируем все refresh токены пользователя.
router.patch('/:id/role', requireAuth, requirePermission('users:role:update'), (req, res) => {
  const user = users.get(req.params.id);
  if (!user) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }
  const { role } = req.body || {};
  if (!ROLE_HIERARCHY.includes(role)) {
    return res.status(400).json({ error: `Недопустимая роль. Допустимые: ${ROLE_HIERARCHY.join(', ')}` });
  }
  user.role = role;
  users.set(user.id, user);
  tokenService.revokeAllRefreshTokensForUser(user.id);
  res.json({ message: 'Роль обновлена', user: { id: user.id, email: user.email, role: user.role } });
});

// PATCH /api/users/:id/deactivate — деактивировать аккаунт (admin). Инвалидируем все refresh токены.
router.patch('/:id/deactivate', requireAuth, requirePermission('users:deactivate'), (req, res) => {
  const user = users.get(req.params.id);
  if (!user) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }
  user.active = false;
  users.set(user.id, user);
  tokenService.revokeAllRefreshTokensForUser(user.id);
  res.json({ message: 'Аккаунт деактивирован', user: { id: user.id, email: user.email, active: user.active } });
});

module.exports = router;
