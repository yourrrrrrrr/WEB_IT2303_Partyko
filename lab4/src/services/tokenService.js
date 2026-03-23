/**
 * Генерация и верификация JWT, работа с refresh-токенами (хеш SHA-256 в памяти).
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { refreshTokens } = require('../db');
const { getPermissionsForRole } = require('../config/rbac');

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;           // 15 минут
const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 дней

function getSecrets() {
  return {
    access: process.env.JWT_ACCESS_SECRET || 'access-secret-very-long-and-random-1234567890',
    refresh: process.env.JWT_REFRESH_SECRET || 'refresh-secret-even-longer-0987654321'
  };
}

/**
 * Access Token: JWT HS256, 15 мин, payload: sub, email, role, iss, iat, exp, jti
 */
function generateAccessToken(user) {
  const { access } = getSecrets();
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    iss: 'lab4-task-manager',
    iat: now,
    exp: now + ACCESS_TOKEN_TTL_SECONDS,
    jti: uuidv4()
  };
  return jwt.sign(payload, access, { algorithm: 'HS256' });
}

/**
 * Refresh Token: JWT HS256, 7 дней. В памяти хранится только SHA-256 хеш.
 */
function generateRefreshToken(user) {
  const { refresh } = getSecrets();
  const now = Math.floor(Date.now() / 1000);
  const jti = uuidv4();
  const payload = {
    sub: user.id,
    iss: 'lab4-task-manager',
    iat: now,
    exp: now + REFRESH_TOKEN_TTL_SECONDS,
    jti
  };
  const token = jwt.sign(payload, refresh, { algorithm: 'HS256' });
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  refreshTokens.set(jti, {
    userId: user.id,
    hash,
    expiresAt: (now + REFRESH_TOKEN_TTL_SECONDS) * 1000
  });
  return token;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Верификация access token. algorithms: ['HS256'].
 * @returns {{ payload, error?: string, code?: string }}
 */
function verifyAccessToken(token) {
  const { access } = getSecrets();
  try {
    const payload = jwt.verify(token, access, { algorithms: ['HS256'] });
    return { payload };
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return { error: 'Access token истёк', code: 'TOKEN_EXPIRED' };
    }
    return { error: 'Невалидный access token', code: 'TOKEN_INVALID' };
  }
}

/**
 * Верификация refresh token. algorithms: ['HS256'].
 * @returns {{ payload, error?: string }}
 */
function verifyRefreshToken(token) {
  const { refresh } = getSecrets();
  try {
    const payload = jwt.verify(token, refresh, { algorithms: ['HS256'] });
    return { payload };
  } catch (err) {
    return { error: 'Невалидный refresh token' };
  }
}

/**
 * Инвалидирует один refresh token (по jti).
 */
function revokeRefreshToken(jti) {
  const record = refreshTokens.get(jti);
  if (record && !record.revokedAt) {
    record.revokedAt = Date.now();
    refreshTokens.set(jti, record);
  }
}

/**
 * Инвалидирует все refresh-токены пользователя (при смене роли / деактивации).
 */
function revokeAllRefreshTokensForUser(userId) {
  const now = Date.now();
  for (const [jti, record] of refreshTokens.entries()) {
    if (record.userId === userId && !record.revokedAt) {
      record.revokedAt = now;
      refreshTokens.set(jti, record);
    }
  }
}

/**
 * Проверяет refresh token по jti и хешу. Если токен уже был использован (revokedAt),
 * возвращает { reused: true, userId } — тогда нужно инвалидировать все токены пользователя.
 */
function validateStoredRefreshToken(jti, token) {
  const record = refreshTokens.get(jti);
  if (!record) return { error: 'Refresh token не найден' };
  if (record.revokedAt) return { reused: true, userId: record.userId };
  if (record.expiresAt < Date.now()) {
    refreshTokens.delete(jti);
    return { error: 'Refresh token истёк' };
  }
  const hashed = hashToken(token);
  if (hashed !== record.hash) {
    refreshTokens.delete(jti);
    return { error: 'Refresh token невалиден' };
  }
  return { record };
}

module.exports = {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  getSecrets,
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  revokeRefreshToken,
  revokeAllRefreshTokensForUser,
  validateStoredRefreshToken,
  hashToken
};
