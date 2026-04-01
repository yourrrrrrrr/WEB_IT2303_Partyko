/**
 * Double Submit Cookie: при входе выставляем csrf-token (не HttpOnly, SameSite=Strict).
 * POST/PATCH/DELETE к /auth/* обязаны передавать X-CSRF-Token, middleware сверяет с cookie.
 */

function verifyCsrf(req, res, next) {
  const cookieToken = req.cookies?.['csrf-token'];
  const headerToken = req.get('X-CSRF-Token');
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ error: 'Forbidden', message: 'Неверный или отсутствующий X-CSRF-Token' });
  }
  next();
}

module.exports = { verifyCsrf };
