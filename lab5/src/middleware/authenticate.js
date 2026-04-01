/**
 * JWT: проверка access token, явно algorithms: ['HS256'], запрет alg:none.
 * TokenExpiredError → 401 { code: 'TOKEN_EXPIRED' }, JsonWebTokenError → 401 { code: 'TOKEN_INVALID' }.
 * checkUserStatus: при status === 'suspended' → 403 «Аккаунт заблокирован».
 */

const { users } = require('../db');
const { getPermissionsForRole } = require('../config/rbac');
const tokenService = require('../services/tokenService');

function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Требуется access token' });
  }
  const result = tokenService.verifyAccessToken(token);
  if (result.error) {
    const body = { error: 'Unauthorized', message: result.error };
    if (result.code) body.code = result.code;
    return res.status(401).json(body);
  }
  const user = users.get(result.payload.sub);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Пользователь не найден' });
  }
  req.user = {
    ...user,
    permissions: getPermissionsForRole(user.role)
  };
  next();
}

function checkUserStatus(req, res, next) {
  const status = req.user.status || 'active';
  if (status === 'suspended') {
    return res.status(403).json({ error: 'Forbidden', message: 'Аккаунт заблокирован' });
  }
  next();
}

module.exports = { requireAuth, checkUserStatus };
