/**
 * Проверка прав через RBAC Engine.
 * requirePermission(...perms) — хотя бы одно из прав.
 * requireOwnerOrRole(role) — владелец ресурса ИЛИ пользователь с указанной ролью и выше.
 */

const { getRoleIndex, hasRoleAtLeast } = require('../config/rbac');

function requirePermission(...perms) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Требуется аутентификация' });
    }
    const userPerms = req.user.permissions || [];
    const has = perms.some(p => userPerms.includes(p));
    if (!has) {
      return res.status(403).json({ error: 'Forbidden', message: 'Недостаточно прав' });
    }
    next();
  };
}

/**
 * Владелец ресурса (req.ownerId должен быть установлен в роуте) или пользователь с ролью minRole и выше.
 */
function requireOwnerOrRole(minRole) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Требуется аутентификация' });
    }
    const ownerId = req.ownerId;
    if (ownerId === req.user.id) return next();
    if (hasRoleAtLeast(req.user.role, minRole)) return next();
    return res.status(403).json({ error: 'Forbidden', message: 'Недостаточно прав' });
  };
}

module.exports = { requirePermission, requireOwnerOrRole };
