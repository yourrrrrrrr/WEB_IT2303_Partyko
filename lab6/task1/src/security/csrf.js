const crypto = require('crypto');

function ensureCsrfCookie(req, res) {
  const existing = req.cookies?.['csrf-token'];
  if (existing && typeof existing === 'string' && existing.length >= 16) return existing;

  const token = crypto.randomBytes(32).toString('hex');
  res.cookie('csrf-token', token, {
    httpOnly: false,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production'
  });
  return token;
}

function verifyCsrf(req, res, next) {
  const cookieToken = req.cookies?.['csrf-token'];
  const headerToken = req.headers['x-csrf-token'];

  if (!cookieToken || !headerToken) {
    return res.status(403).json({ error: 'CSRF-токен отсутствует' });
  }

  try {
    const a = Buffer.from(String(cookieToken));
    const b = Buffer.from(String(headerToken));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(403).json({ error: 'Неверный CSRF-токен' });
    }
  } catch {
    return res.status(403).json({ error: 'Ошибка проверки CSRF-токена' });
  }

  next();
}

module.exports = { ensureCsrfCookie, verifyCsrf };

