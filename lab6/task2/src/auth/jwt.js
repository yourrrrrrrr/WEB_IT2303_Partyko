const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_secret_change_me';
const JWT_ISSUER = 'lab6-task2';

function signToken(user) {
  return jwt.sign(
    { sub: String(user.id), username: user.username, role: user.role },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '30m', issuer: JWT_ISSUER }
  );
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'], issuer: JWT_ISSUER });
}

function authenticate(req, res, next) {
  const cookieToken = req.cookies?.auth;
  const header = req.headers.authorization;
  const bearer = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : null;
  const token = cookieToken || bearer;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const payload = verifyToken(token);
    req.user = { id: Number(payload.sub), username: payload.username, role: payload.role };
    return next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(500).json({ error: 'Server error' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  next();
}

module.exports = { signToken, authenticate, requireAdmin };

