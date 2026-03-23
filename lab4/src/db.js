/**
 * In-memory "база данных" для Task Manager (ЛР4).
 * Все данные хранятся в Map (учебная реализация).
 */

/** @type {Map<string, { id, email, passwordHash, role, active, createdAt }>} */
const users = new Map();

/** @type {Map<string, { id, title, description, status, ownerId, createdAt, updatedAt }>} */
const tasks = new Map();

/**
 * Хранилище refresh-токенов.
 * key: jti (идентификатор токена)
 * value: { userId, hash, expiresAt, revokedAt? }
 * Храним только SHA-256 хеш токена, не сам токен.
 */
/** @type {Map<string, { userId: string, hash: string, expiresAt: number, revokedAt?: number }>} */
const refreshTokens = new Map();

module.exports = {
  users,
  tasks,
  refreshTokens
};
