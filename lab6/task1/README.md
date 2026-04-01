## Lab6 — Задание 1 (бывшее задание 2)

Безопасный REST API отзывов (reviews) о товарах.

### Запуск

```bash
cd lab6/task1
npm install
npm run dev
```

Сервер: `http://localhost:3006`

### Быстрая проверка (curl)

Файл `scripts/verify.ps1` (PowerShell) создаёт cookies и гоняет проверки из методички.

### Эндпоинты

- `GET  /api/products` — публично (первый запрос ставит cookie `csrf-token`)
- `GET  /api/products/:id/reviews` — публично
- `POST /api/products/:id/reviews` — только авторизованным, требует CSRF
- `DELETE /api/reviews/:id` — только admin, требует CSRF

- `POST /api/login` — выставляет `sessionId` в HttpOnly cookie
- `POST /api/logout`

