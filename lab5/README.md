# Лабораторная работа 5 — Полная система безопасности

OAuth2 (mock) + JWT + RBAC + защита от атак. Два роутера: `authRouter` и `apiRouter`. In-memory хранилище.

## Установка

```bash
cd lab5
npm install
cp .env.example .env   # при необходимости задать JWT_ACCESS_SECRET, JWT_REFRESH_SECRET
```

## Запуск

1. **Основной сервер (порт 3000):**
   ```bash
   npm run dev
   ```
2. **Mock OAuth2 (порт 3001)** — для входа «через GitHub»:
   ```bash
   npm run start:oauth-mock
   ```

Открой **http://localhost:3000/** — регистрация, локальный вход, OAuth (mock), статьи, комментарии.

**Админ по умолчанию:** `admin@example.com` / `admin123`

## Структура (по методичке)

```
lab5/
├── src/
│   ├── app.js
│   ├── db.js
│   ├── config/rbac.js
│   ├── services/tokenService.js, securityLogger.js
│   ├── middleware/ (authenticate, authorize, rateLimiter, csrf, sanitize, requestId)
│   └── routes/ (auth, articles, comments, users, admin)
├── mock-oauth/
│   ├── server.js   # GET /authorize, POST /token (PKCE), GET /user
│   └── users.js
├── index.html, app.js, styles.css
└── package.json
```

## Эндпоинты

- **Auth:** POST register, login, refresh, logout, logout-all; GET me, sessions; DELETE sessions/:sessionId; GET oauth/github, oauth/github/callback
- **Статьи:** GET/POST /api/articles; GET/PATCH/DELETE /api/articles/:id; POST /api/articles/:id/publish
- **Комментарии:** GET/POST /api/articles/:id/comments; DELETE /api/articles/:id/comments/:commentId
- **Пользователи (editor+):** GET /api/users, GET/PATCH /api/users/:id/role, /api/users/:id/status (admin)
- **Админ:** GET /admin/security-log (фильтры event, userId, dateFrom, dateTo)

## Безопасность

- CSRF: cookie `csrf-token` + заголовок `X-CSRF-Token` для POST/PATCH/DELETE /auth/*
- Rate limit: auth 5/15 мин, refresh 20/15 мин, api 100/15 мин
- JWT: HS256, запрет alg:none; TOKEN_EXPIRED / TOKEN_INVALID в ответах
- SecurityLogger: события REGISTER_*, LOGIN_*, TOKEN_*, OAUTH_*, PERMISSION_DENIED, IDOR_ATTEMPT, ROLE_CHANGED, USER_SUSPENDED
