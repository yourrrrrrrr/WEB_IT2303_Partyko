const { hasPermission } = require('../config/rbac');
const securityLogger = require('../services/securityLogger');

function requirePermission(...perms) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const ok = perms.some(p => hasPermission(req.user.role, p));
    if (!ok) {
      securityLogger.log('PERMISSION_DENIED', { userId: req.user.id, ip: req.ip, meta: { required: perms } });
      return res.status(403).json({ error: 'Forbidden', message: 'Недостаточно прав' });
    }
    next();
  };
}

module.exports = { requirePermission };
