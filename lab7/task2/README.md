# Lab7 — Задание 2

Backend игрового проекта с продвинутыми структурами Redis по методичке:

1. **Модуль 1 — Лидерборд (Sorted Sets)**: `leaderboard:global`, `leaderboard:week:{YYYY-WW}`
2. **Модуль 2 — Очередь задач (Lists) + Worker**: `queue:achievements*`, retry, DLQ
3. **Модуль 3 — Распределённая блокировка (Redlock, упрощённый)**: `lock:*`, Lua release
4. **Модуль 4 — Redis Streams (аудит событий)**: `events:game` + агрегатор `stats:summary`
5. **Модуль 5 — Транзакции (MULTI/EXEC)**: `POST /api/players/register`

## Запуск

```bash
cd lab7/task2
npm install
cp .env.example .env
npm run dev
```

Сервер и фронт: `http://localhost:3008`.

## Основные эндпоинты

- `POST /api/players/register`
- `POST /api/scores`
- `POST /api/scores/increment`
- `GET /api/leaderboard`
- `GET /api/leaderboard/player/:userId`
- `GET /api/leaderboard/weekly`
- `POST /api/achievements/enqueue`
- `GET /api/achievements/stats`
- `GET /api/events`
- `GET /api/stats/summary`

## Примечания

- Worker и агрегатор запущены в этом же процессе сервера.
- Агрегатор обновляет `stats:summary` каждые 30 сек и подрезает stream до 10000 записей.
