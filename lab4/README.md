# Лабораторная работа 4 — JWT + RBAC Task Manager

REST API на Node.js + Express: JWT-аутентификация и ролевая модель доступа (RBAC). Соответствует заданию «JWT-аутентификация с ролями и RBAC».

## Структура проекта

```
lab4/
├── package.json
├── .env.example          ← скопировать в .env и задать секреты
├── src/
│   ├── app.js            ← точка входа
│   ├── db.js             ← in-memory «база» (users, tasks, refreshTokens)
│   ├── config/
│   │   └── rbac.js       ← роли и права, наследование
│   ├── middleware/
│   │   ├── authenticate.js  ← проверка JWT (requireAuth)
│   │   ├── authorize.js      ← requirePermission, requireOwnerOrRole
│   │   └── rateLimiter.js    ← 5 запросов/15 мин на /auth/login
│   ├── services/
│   │   └── tokenService.js  ← генерация/верификация токенов, хранение хеша refresh
│   └── routes/
│       ├── auth.js       ← /auth/register, login, refresh, logout, me
│       ├── tasks.js      ← /api/tasks
│       └── users.js      ← /api/users
├── index.html
├── app.js
└── styles.css
```

## Требования (выполнено)

- Пароли: Argon2id (memoryCost: 65536, timeCost: 3)
- Access Token: JWT HS256, 15 мин, payload: sub, email, role, iss, iat, exp, jti
- Refresh Token: JWT HS256, 7 дней, в памяти хранится только SHA-256 хеш
- Refresh в HttpOnly cookie, path: `/auth/refresh`; access только в теле ответа
- RBAC с наследованием ролей (user → manager → admin), без сторонних библиотек
- Rate limiting: 5 запросов / 15 мин на `/auth/login`
- При смене роли и деактивации — инвалидация всех refresh-токенов пользователя
- При повторном использовании refresh token — 401 и инвалидация всех токенов пользователя
- 401 Unauthorized / 403 Forbidden различаются; алгоритм `algorithms: ['HS256']` при верификации

## Установка и запуск

```bash
cd lab4
cp .env.example .env   # при необходимости задать JWT_ACCESS_SECRET, JWT_REFRESH_SECRET
npm install
npm run dev
```

Открой **http://localhost:3000/** — интерфейс и API с одного сервера.

**Вход под админом:** `admin@example.com` / `admin123` (создаётся при первом запуске).

## Критерии проверки

- Пользователь с ролью `user` не может прочитать чужую задачу → 404 (в списке только свои; PATCH/DELETE чужой → 404)
- Пользователь с ролью `user` не может вызвать `PATCH /api/tasks/:id/status` → 403
- После деактивации аккаунта старый refresh token не работает
- После смены роли новый access token содержит обновлённую роль
- `POST /auth/refresh` с уже использованным refresh token → 401 и инвалидация всех токенов пользователя
- Истёкший access token → 401 с `code: "TOKEN_EXPIRED"` в теле ответа
