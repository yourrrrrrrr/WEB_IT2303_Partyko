# Lab7 — Задание 1

`Rate Limiting + Pub/Sub уведомления + сессии` на Node.js + Express + Redis.

## Что реализовано

- **Модуль 1 (Rate Limiter)**: middleware-фабрика на Redis (`INCR`, `EXPIRE`, `TTL`)
  - `POST /api/login` — 5/15 мин
  - `POST /api/register` — 3/1 час
  - `GET /api/search` — 30/1 мин
  - Заголовки: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
- **Модуль 2 (Pub/Sub + SSE)**:
  - `GET /api/notifications/stream/:userId`
  - `POST /api/notifications/send` (персонально или global)
  - `POST /api/notifications/broadcast` (global)
- **Модуль 3 (Sessions in Redis Hash)**:
  - `POST /api/auth/login`
  - `GET /api/auth/me`
  - `POST /api/auth/logout`
  - `GET /api/auth/sessions`
  - Сессия: `session:{sessionId}` (TTL 2 часа, `touchSession` при запросах)

## Запуск

```bash
cd lab7/task1
npm install
cp .env.example .env
npm run dev
```

Сервер и фронт: `http://localhost:3007`.

## Redis

Нужен запущенный Redis на `localhost:6379` (или укажи `REDIS_URL` в `.env`).

Если в консоли было `Redis error:` с пустым текстом — это обычно **нет процесса на порту 6379** (ошибка `ECONNREFUSED` у Node иногда без `message`).

**Варианты:**

- Docker: `docker run -d -p 6379:6379 --name redis redis:7-alpine`
- Windows: [Memurai](https://www.memurai.com/) или WSL2 + `redis-server`
