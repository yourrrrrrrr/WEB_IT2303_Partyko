/**
 * JWT access (15 мин) + refresh (30 дней), ротация, хранение сессии как { userId, hash, userAgent, ip, createdAt, expiresAt }.
 * При повторном использовании refresh — инвалидация всей «семьи» токенов пользователя.
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { refreshSessions, users } = require('../db');
const { getPermissionsForRole } = require('../config/rbac');
const securityLogger = require('./securityLogger');

const ACCESS_TTL = 15 * 60;
const REFRESH_TTL = 30 * 24 * 60 * 60;

function getSecrets() {
  return {
    access: process.env.JWT_ACCESS_SECRET || 'lab5-access-secret-min-32-chars',
    refresh: process.env.JWT_REFRESH_SECRET || 'lab5-refresh-secret-different-32'
  };
}

function generateAccessToken(user) {
  const { access } = getSecrets();
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role, iss: 'lab5', iat: now, exp: now + ACCESS_TTL, jti: uuidv4() },
    access,
    { algorithm: 'HS256' }
  );
}

function generateRefreshToken(user, opts = {}) {
  const { refresh } = getSecrets();
  const now = Math.floor(Date.now() / 1000);
  const jti = uuidv4();
  const token = jwt.sign(
    { sub: user.id, iss: 'lab5', iat: now, exp: now + REFRESH_TTL, jti },
    refresh,
    { algorithm: 'HS256' }
  );
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  refreshSessions.set(jti, {
    userId: user.id,
    hash,
    userAgent: opts.userAgent ?? null,
    ip: opts.ip ?? null,
    createdAt: now * 1000,
    expiresAt: (now + REFRESH_TTL) * 1000,
    jti
  });
  return token;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function verifyAccessToken(token) {
  const { access } = getSecrets();
  if (!token) return { error: 'Token missing', code: 'TOKEN_INVALID' };
  const header = token.split('.')[0];
  if (header) {
    try {
      const decoded = JSON.parse(Buffer.from(header, 'base64url').toString());
      if (decoded.alg === 'none') return { error: 'Algorithm none not allowed', code: 'TOKEN_INVALID' };
    } catch (_) {}
  }
  try {
    const payload = jwt.verify(token, access, { algorithms: ['HS256'] });
    return { payload };
  } catch (err) {
    if (err.name === 'TokenExpiredError') return { error: 'Access token истёк', code: 'TOKEN_EXPIRED' };
    return { error: 'Невалидный access token', code: 'TOKEN_INVALID' };
  }
}

function verifyRefreshToken(token) {
  const { refresh } = getSecrets();
  try {
    const payload = jwt.verify(token, refresh, { algorithms: ['HS256'] });
    return { payload };
  } catch (_) {
    return { error: 'Невалидный refresh token' };
  }
}

function revokeSession(jti) {
  const s = refreshSessions.get(jti);
  if (s && !s.revokedAt) {
    s.revokedAt = Date.now();
    refreshSessions.set(jti, s);
  }
}

function revokeAllSessionsForUser(userId) {
  const now = Date.now();
  for (const [jti, s] of refreshSessions.entries()) {
    if (s.userId === userId && !s.revokedAt) {
      s.revokedAt = now;
      refreshSessions.set(jti, s);
    }
  }
}

function validateStoredRefreshToken(jti, token, req) {
  const s = refreshSessions.get(jti);
  if (!s) return { error: 'Session not found' };
  if (s.revokedAt) {
    securityLogger.log('TOKEN_REUSE_DETECTED', { userId: s.userId, ip: req?.ip, userAgent: req?.get('user-agent') });
    return { reused: true, userId: s.userId };
  }
  if (s.expiresAt < Date.now()) {
    refreshSessions.delete(jti);
    return { error: 'Refresh token истёк' };
  }
  if (hashToken(token) !== s.hash) {
    refreshSessions.delete(jti);
    return { error: 'Invalid token hash' };
  }
  return { session: s };
}

function getSessionsForUser(userId, currentJti) {
  const list = [];
  for (const [jti, s] of refreshSessions.entries()) {
    if (s.userId !== userId || s.revokedAt || s.expiresAt < Date.now()) continue;
    list.push({
      sessionId: jti.slice(0, 8),
      jti,
      createdAt: new Date(s.createdAt).toISOString(),
      expiresAt: new Date(s.expiresAt).toISOString(),
      userAgent: s.userAgent,
      ip: s.ip,
      isCurrent: jti === currentJti
    });
  }
  return list;
}

module.exports = {
  ACCESS_TTL,
  REFRESH_TTL,
  getSecrets,
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  revokeSession,
  revokeAllSessionsForUser,
  validateStoredRefreshToken,
  getSessionsForUser,
  hashToken
};
