/**
 * Маршруты /auth/*: регистрация, вход, refresh, logout, me.
 */

const express = require('express');
const argon2 = require('argon2');
const { v4: uuidv4 } = require('uuid');
const { users, refreshTokens } = require('../db');
const { getPermissionsForRole } = require('../config/rbac');
const tokenService = require('../services/tokenService');
const { requireAuth } = require('../middleware/authenticate');
const { loginLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// POST /auth/register — регистрация (роль 'user' по умолчанию)
router.post('/register', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email и пароль обязательны' });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Некорректный email' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Пароль: минимум 8 символов' });
  }

  const normalized = email.toLowerCase().trim();
  for (const u of users.values()) {
    if (u.email === normalized) {
      return res.status(409).json({ error: 'Пользователь с таким email уже существует' });
    }
  }

  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1
  });

  const id = uuidv4();
  const user = {
    id,
    email: normalized,
    passwordHash,
    role: 'user',
    active: true,
    createdAt: new Date().toISOString()
  };
  users.set(id, user);

  return res.status(201).json({
    message: 'Регистрация успешна',
    user: { id: user.id, email: user.email, role: user.role }
  });
});

// POST /auth/login — вход, возвращает accessToken; refreshToken в HttpOnly cookie
router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email и пароль обязательны' });
  }

  const normalized = email.toLowerCase().trim();
  let foundUser = null;
  for (const u of users.values()) {
    if (u.email === normalized) {
      foundUser = u;
      break;
    }
  }

  if (!foundUser) {
    return res.status(401).json({ error: 'Неверный email или пароль' });
  }
  if (foundUser.active === false) {
    return res.status(403).json({ error: 'Аккаунт деактивирован' });
  }

  const ok = await argon2.verify(foundUser.passwordHash, password);
  if (!ok) {
    return res.status(401).json({ error: 'Неверный email или пароль' });
  }

  const accessToken = tokenService.generateAccessToken(foundUser);
  const refreshToken = tokenService.generateRefreshToken(foundUser);

  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    sameSite: 'strict',
    secure: false,
    path: '/auth/refresh',
    maxAge: tokenService.REFRESH_TOKEN_TTL_SECONDS * 1000
  });

  return res.json({
    message: 'Вход выполнен',
    accessToken
  });
});

// POST /auth/refresh — обновление access token по refresh token (Rotation: старый инвалидируется)
router.post('/refresh', async (req, res) => {
  const token = req.cookies && req.cookies.refreshToken;
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Refresh token отсутствует' });
  }

  const verifyResult = tokenService.verifyRefreshToken(token);
  if (verifyResult.error) {
    return res.status(401).json({ error: 'Unauthorized', message: verifyResult.error });
  }

  const { jti } = verifyResult.payload;
  const validation = tokenService.validateStoredRefreshToken(jti, token);
  if (validation.error) {
    return res.status(401).json({ error: 'Unauthorized', message: validation.error });
  }
  // Повторное использование refresh token → инвалидируем все токены пользователя (критерий проверки)
  if (validation.reused) {
    tokenService.revokeAllRefreshTokensForUser(validation.userId);
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Refresh token уже был использован. Все сессии пользователя инвалидированы.'
    });
  }

  const user = users.get(validation.record.userId);
  if (!user || user.active === false) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Пользователь не найден или деактивирован' });
  }

  tokenService.revokeRefreshToken(jti);

  const newAccessToken = tokenService.generateAccessToken(user);
  const newRefreshToken = tokenService.generateRefreshToken(user);

  res.cookie('refreshToken', newRefreshToken, {
    httpOnly: true,
    sameSite: 'strict',
    secure: false,
    path: '/auth/refresh',
    maxAge: tokenService.REFRESH_TOKEN_TTL_SECONDS * 1000
  });

  return res.json({
    message: 'Access token обновлён',
    accessToken: newAccessToken
  });
});

// POST /auth/logout — выход, инвалидирует текущий refresh token
router.post('/logout', (req, res) => {
  const token = req.cookies && req.cookies.refreshToken;
  if (token) {
    const verifyResult = tokenService.verifyRefreshToken(token);
    if (verifyResult.payload) {
      tokenService.revokeRefreshToken(verifyResult.payload.jti);
    }
  }
  res.clearCookie('refreshToken', { path: '/auth/refresh' });
  return res.json({ message: 'Выход выполнен' });
});

// GET /auth/me — данные пользователя и текущие permissions (только авторизованным)
router.get('/me', requireAuth, (req, res) => {
  const user = users.get(req.user.id);
  if (!user) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }
  res.json({
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      active: user.active,
      createdAt: user.createdAt
    },
    permissions: req.user.permissions
  });
});

module.exports = router;
