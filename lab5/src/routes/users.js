/**
 * GET /api/users, GET /api/users/:id (editor+)
 * PATCH /api/users/:id/role (admin) — инвалидация refresh + ROLE_CHANGED
 * PATCH /api/users/:id/status (admin) — active/suspended, инвалидация + USER_SUSPENDED
 */

const express = require('express');
const { users } = require('../db');
const { ROLE_HIERARCHY } = require('../config/rbac');
const tokenService = require('../services/tokenService');
const securityLogger = require('../services/securityLogger');
const { requireAuth, checkUserStatus } = require('../middleware/authenticate');
const { requirePermission } = require('../middleware/authorize');

const router = express.Router();

router.get('/', requireAuth, checkUserStatus, requirePermission('users:read'), (req, res) => {
  const list = [];
  for (const u of users.values()) {
    list.push({ id: u.id, email: u.email, role: u.role, status: u.status || 'active', createdAt: u.createdAt });
  }
  res.json({ users: list, total: list.length });
});

router.get('/:id', requireAuth, checkUserStatus, requirePermission('users:read'), (req, res) => {
  const user = users.get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  res.json({ user: { id: user.id, email: user.email, role: user.role, status: user.status || 'active', createdAt: user.createdAt } });
});

router.patch('/:id/role', requireAuth, checkUserStatus, requirePermission('users:manage'), (req, res) => {
  const user = users.get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  const role = req.body?.role;
  if (!ROLE_HIERARCHY.includes(role)) return res.status(400).json({ error: `Роль должна быть одна из: ${ROLE_HIERARCHY.join(', ')}` });
  user.role = role;
  users.set(user.id, user);
  tokenService.revokeAllSessionsForUser(user.id);
  securityLogger.log('ROLE_CHANGED', { userId: user.id, ip: req.ip, meta: { newRole: role } });
  res.json({ message: 'Роль обновлена', user: { id: user.id, email: user.email, role: user.role } });
});

router.patch('/:id/status', requireAuth, checkUserStatus, requirePermission('users:manage'), (req, res) => {
  const user = users.get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  const status = req.body?.status;
  if (status !== 'active' && status !== 'suspended') return res.status(400).json({ error: 'status должен быть active или suspended' });
  user.status = status;
  users.set(user.id, user);
  tokenService.revokeAllSessionsForUser(user.id);
  securityLogger.log('USER_SUSPENDED', { userId: user.id, ip: req.ip, meta: { status } });
  res.json({ message: 'Статус обновлён', user: { id: user.id, email: user.email, status: user.status } });
});

module.exports = router;
