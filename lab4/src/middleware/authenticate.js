/**
 * Проверка JWT (access token). 401 Unauthorized при отсутствии/невалидном/истёкшем токене.
 */

const { users } = require('../db');
const { getPermissionsForRole } = require('../config/rbac');
const tokenService = require('../services/tokenService');

function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Access token отсутствует'
    });
  }

  const result = tokenService.verifyAccessToken(token);
  if (result.error) {
    const body = { error: 'Unauthorized', message: result.error };
    if (result.code) body.code = result.code;
    return res.status(401).json(body);
  }

  const user = users.get(result.payload.sub);
  if (!user || user.active === false) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Пользователь не найден или деактивирован'
    });
  }

  req.user = {
    id: user.id,
    email: user.email,
    role: user.role,
    permissions: getPermissionsForRole(user.role)
  };
  next();
}

module.exports = { requireAuth };
