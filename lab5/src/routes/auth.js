/**
 * authRouter: /auth/register, login, refresh, logout, logout-all, me, sessions, DELETE sessions/:id, oauth/github, oauth/github/callback.
 * CSRF: при логине выставляем csrf-token cookie; POST/PATCH/DELETE /auth/* требуют X-CSRF-Token.
 */

const express = require('express');
const argon2 = require('argon2');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { users, refreshSessions } = require('../db');
const { getPermissionsForRole } = require('../config/rbac');
const tokenService = require('../services/tokenService');
const securityLogger = require('../services/securityLogger');
const { requireAuth, checkUserStatus } = require('../middleware/authenticate');
const { requirePermission } = require('../middleware/authorize');
const { refreshLimiter } = require('../middleware/rateLimiter');
const { verifyCsrf } = require('../middleware/csrf');

const router = express.Router();

const OAUTH_MOCK_URL = process.env.OAUTH_MOCK_URL || 'http://localhost:3001';
const OAUTH_CLIENT_ID = 'lab5-client';
const pkceStateStore = new Map();

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

router.post('/register', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    securityLogger.log('REGISTER_FAIL', { ip: req.ip, meta: { reason: 'missing_fields' } });
    return res.status(400).json({ error: 'Email и пароль обязательны' });
  }
  const norm = (typeof email === 'string' ? email : '').toLowerCase().trim();
  if (!isValidEmail(norm)) {
    securityLogger.log('REGISTER_FAIL', { ip: req.ip, meta: { reason: 'invalid_email' } });
    return res.status(400).json({ error: 'Некорректный email' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    securityLogger.log('REGISTER_FAIL', { ip: req.ip, meta: { reason: 'short_password' } });
    return res.status(400).json({ error: 'Пароль: минимум 8 символов' });
  }
  for (const u of users.values()) {
    if (u.email === norm) {
      securityLogger.log('REGISTER_FAIL', { ip: req.ip, meta: { reason: 'email_exists' } });
      return res.status(409).json({ error: 'Пользователь с таким email уже существует' });
    }
  }
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3 });
  const id = uuidv4();
  users.set(id, { id, email: norm, passwordHash, role: 'reader', status: 'active', createdAt: new Date().toISOString() });
  securityLogger.log('REGISTER_SUCCESS', { userId: id, ip: req.ip });
  return res.status(201).json({ message: 'Регистрация успешна', user: { id, email: norm, role: 'reader' } });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    securityLogger.log('LOGIN_FAIL', { ip: req.ip, meta: { reason: 'missing' } });
    return res.status(400).json({ error: 'Email и пароль обязательны' });
  }
  const norm = (typeof email === 'string' ? email : '').toLowerCase().trim();
  let user = null;
  for (const u of users.values()) if (u.email === norm) { user = u; break; }
  if (!user) {
    securityLogger.log('LOGIN_FAIL', { ip: req.ip, meta: { email: norm } });
    return res.status(401).json({ error: 'Неверный email или пароль' });
  }
  if (user.status === 'suspended') {
    securityLogger.log('LOGIN_FAIL', { userId: user.id, ip: req.ip, meta: { reason: 'suspended' } });
    return res.status(403).json({ error: 'Аккаунт заблокирован' });
  }
  if (!user.passwordHash) {
    securityLogger.log('LOGIN_FAIL', { userId: user.id, ip: req.ip, meta: { reason: 'oauth_only' } });
    return res.status(401).json({ error: 'Неверный email или пароль' });
  }
  const ok = await argon2.verify(user.passwordHash, password);
  if (!ok) {
    securityLogger.log('LOGIN_FAIL', { ip: req.ip, meta: { email: norm } });
    return res.status(401).json({ error: 'Неверный email или пароль' });
  }
  const accessToken = tokenService.generateAccessToken(user);
  const refreshToken = tokenService.generateRefreshToken(user, { userAgent: req.get('user-agent'), ip: req.ip });
  const csrfToken = uuidv4();
  res.cookie('csrf-token', csrfToken, { httpOnly: false, sameSite: 'strict', maxAge: 24 * 60 * 60 * 1000 });
  res.cookie('refreshToken', refreshToken, { httpOnly: true, sameSite: 'strict', path: '/auth/refresh', maxAge: tokenService.REFRESH_TTL * 1000 });
  securityLogger.log('LOGIN_SUCCESS', { userId: user.id, ip: req.ip });
  return res.json({ message: 'Вход выполнен', accessToken });
});

router.post('/refresh', refreshLimiter, async (req, res) => {
  const token = req.cookies?.refreshToken;
  if (!token) {
    securityLogger.log('TOKEN_REFRESH_FAIL', { ip: req.ip, meta: { reason: 'no_token' } });
    return res.status(401).json({ error: 'Unauthorized', message: 'Refresh token отсутствует' });
  }
  const verifyResult = tokenService.verifyRefreshToken(token);
  if (verifyResult.error) {
    securityLogger.log('TOKEN_REFRESH_FAIL', { ip: req.ip, meta: { reason: 'invalid' } });
    return res.status(401).json({ error: 'Unauthorized', message: verifyResult.error });
  }
  const validation = tokenService.validateStoredRefreshToken(verifyResult.payload.jti, token, req);
  if (validation.error) {
    securityLogger.log('TOKEN_REFRESH_FAIL', { ip: req.ip, meta: { reason: validation.error } });
    return res.status(401).json({ error: 'Unauthorized', message: validation.error });
  }
  if (validation.reused) {
    tokenService.revokeAllSessionsForUser(validation.userId);
    return res.status(401).json({ error: 'Unauthorized', message: 'Refresh token уже использован. Все сессии инвалидированы.' });
  }
  const user = users.get(validation.session.userId);
  if (!user || user.status === 'suspended') {
    return res.status(401).json({ error: 'Unauthorized', message: 'Пользователь не найден или заблокирован' });
  }
  tokenService.revokeSession(validation.session.jti);
  const newAccess = tokenService.generateAccessToken(user);
  const newRefresh = tokenService.generateRefreshToken(user, { userAgent: req.get('user-agent'), ip: req.ip });
  res.cookie('refreshToken', newRefresh, { httpOnly: true, sameSite: 'strict', path: '/auth/refresh', maxAge: tokenService.REFRESH_TTL * 1000 });
  securityLogger.log('TOKEN_REFRESH_SUCCESS', { userId: user.id, ip: req.ip });
  return res.json({ message: 'Токен обновлён', accessToken: newAccess });
});

router.post('/logout', verifyCsrf, (req, res) => {
  const token = req.cookies?.refreshToken;
  if (token) {
    const verifyResult = tokenService.verifyRefreshToken(token);
    if (verifyResult.payload) tokenService.revokeSession(verifyResult.payload.jti);
  }
  res.clearCookie('refreshToken', { path: '/auth/refresh' });
  res.clearCookie('csrf-token');
  securityLogger.log('LOGOUT', { ip: req.ip });
  return res.json({ message: 'Выход выполнен' });
});

router.post('/logout-all', requireAuth, checkUserStatus, verifyCsrf, (req, res) => {
  tokenService.revokeAllSessionsForUser(req.user.id);
  res.clearCookie('refreshToken', { path: '/auth/refresh' });
  res.clearCookie('csrf-token');
  securityLogger.log('LOGOUT_ALL', { userId: req.user.id, ip: req.ip });
  return res.json({ message: 'Выход со всех устройств выполнен' });
});

router.get('/me', requireAuth, checkUserStatus, (req, res) => {
  const u = users.get(req.user.id);
  res.setHeader('X-Permissions', (req.user.permissions || []).join(','));
  return res.json({
    user: { id: u.id, email: u.email, role: u.role, status: u.status || 'active', createdAt: u.createdAt },
    permissions: req.user.permissions
  });
});

router.get('/sessions', requireAuth, checkUserStatus, (req, res) => {
  const token = req.cookies?.refreshToken;
  let currentJti = null;
  if (token) {
    const vr = tokenService.verifyRefreshToken(token);
    if (vr.payload) currentJti = vr.payload.jti;
  }
  const list = tokenService.getSessionsForUser(req.user.id, currentJti);
  return res.json({ sessions: list });
});

router.delete('/sessions/:sessionId', requireAuth, checkUserStatus, verifyCsrf, (req, res) => {
  const prefix = req.params.sessionId;
  let found = false;
  for (const [jti, s] of refreshSessions.entries()) {
    if (s.userId === req.user.id && jti.startsWith(prefix)) {
      tokenService.revokeSession(jti);
      found = true;
      break;
    }
  }
  if (!found) return res.status(404).json({ error: 'Сессия не найдена' });
  return res.json({ message: 'Сессия завершена' });
});

function getBaseUrl(req) {
  const host = req.get('host') || 'localhost:3000';
  const protocol = req.protocol || (req.get('x-forwarded-proto') || 'http');
  return `${protocol}://${host}`;
}

router.get('/oauth/github', (req, res) => {
  const baseUrl = getBaseUrl(req);
  const code_verifier = uuidv4() + uuidv4().replace(/-/g, '');
  const code_challenge = crypto.createHash('sha256').update(code_verifier).digest('base64url');
  const state = uuidv4();
  pkceStateStore.set(state, { code_verifier, createdAt: Date.now(), baseUrl });
  const url = new URL(`${OAUTH_MOCK_URL}/authorize`);
  url.searchParams.set('client_id', OAUTH_CLIENT_ID);
  url.searchParams.set('redirect_uri', `${baseUrl}/auth/oauth/github/callback`);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', code_challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  res.redirect(url.toString());
});

router.get('/oauth/github/callback', async (req, res) => {
  const { code, state } = req.query || {};
  const stored = pkceStateStore.get(state);
  const baseUrl = stored?.baseUrl || getBaseUrl(req);
  if (!stored) return res.redirect(`${baseUrl}/?error=invalid_state`);
  pkceStateStore.delete(state);
  if (Date.now() - stored.createdAt > 60000) return res.redirect(`${baseUrl}/?error=state_expired`);
  const code_verifier = stored.code_verifier;
  const tokenRes = await fetch(`${OAUTH_MOCK_URL}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, code_verifier, grant_type: 'authorization_code' })
  }).catch(() => null);
  if (!tokenRes || !tokenRes.ok) {
    return res.redirect(`${baseUrl}/?error=token_exchange_failed`);
  }
  const tokenData = await tokenRes.json();
  const userRes = await fetch(`${OAUTH_MOCK_URL}/user`, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` }
  }).catch(() => null);
  if (!userRes || !userRes.ok) return res.redirect(`${baseUrl}/?error=user_fetch_failed`);
  const oauthUser = await userRes.json();
  let user = null;
  for (const u of users.values()) {
    if (u.providerId === oauthUser.id) { user = u; break; }
  }
  const role = ['reader', 'author', 'editor', 'admin'].includes(oauthUser.role) ? oauthUser.role : 'reader';
  if (!user) {
    const id = uuidv4();
    user = { id, email: oauthUser.email || `oauth-${oauthUser.id}@local`, role, status: 'active', createdAt: new Date().toISOString(), providerId: oauthUser.id };
    users.set(id, user);
  } else {
    user.role = role;
    users.set(user.id, user);
  }
  securityLogger.log('OAUTH_LOGIN_SUCCESS', { userId: user.id, ip: req.ip, meta: { provider: 'github' } });
  const accessToken = tokenService.generateAccessToken(user);
  const refreshToken = tokenService.generateRefreshToken(user, { userAgent: req.get('user-agent'), ip: req.ip });
  const csrfToken = uuidv4();
  res.cookie('csrf-token', csrfToken, { httpOnly: false, sameSite: 'strict', maxAge: 24 * 60 * 60 * 1000 });
  res.cookie('refreshToken', refreshToken, { httpOnly: true, sameSite: 'strict', path: '/auth/refresh', maxAge: tokenService.REFRESH_TTL * 1000 });
  res.redirect(`${baseUrl}/?accessToken=${encodeURIComponent(accessToken)}`);
});

module.exports = router;
