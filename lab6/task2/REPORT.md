## Отчёт по аудиту и исправлениям (OWASP Top 10 2021)

### Часть A — Таблица уязвимостей (по блокам [1]–[10])

| Блок | Маршрут/функция | Тип уязвимости (OWASP 2021) | Что было уязвимо / эксплуатация | Критичность | Что сделано |
|---:|---|---|---|---|---|
| 1 | `POST /upload` (multer storage) | **A05: Security Misconfiguration** + **A01: Broken Access Control** | Сохранение файла под `originalname`, без проверки типа/размера → загрузка `shell.php`, path traversal, подмена файлов. | Критический | Ограничение типов (MIME+ext), имя `uuid.ext`, лимит 5MB, rate limit, `nosniff`. |
| 2 | `POST /login` | **A03: Injection** + **A07: Identification and Authentication Failures** | SQLi через строковую интерполяцию + пароль в открытом виде + токен в ответе/хардкод. | Критический | Плейсхолдер `?`, bcrypt-хеш, JWT в HttpOnly cookie, rate limit. |
| 3 | `GET /articles/:id` | **A03: Injection** + **A09: Security Logging and Monitoring Failures** | SQLi в `id`, выдача `err.message` клиенту. | Высокий | Параметризованный запрос, строгий `parseInt`, ошибки только в лог. |
| 4 | `POST /articles/:id/comments` | **A03: Injection** + **A03/A07** | SQLi через вставку автора/текста; возможность подменять автора. | Высокий | Автор только из JWT, INSERT через `?`, валидация длины. |
| 5 | `GET /articles/:id/comments` (HTML) | **A03: Injection (XSS)** | Stored/Reflected XSS через вывод `author/body` в HTML. | Высокий | `escapeHtml()` при выводе. |
| 6 | Статика `public/uploads` | **A05: Security Misconfiguration** | Возможность “исполняемого” контента и MIME sniffing. | Средний | `helmet()` + `X-Content-Type-Options: nosniff` на статику. |
| 7 | `authenticate()` по `x-token` + запрос в БД | **A07: Identification and Authentication Failures** | Токен хранится в БД и проверяется SQL-запросом → SQLi и утечки. | Высокий | JWT HS256: верификация без БД (`Authorization: Bearer` или cookie `auth`). |
| 8 | `POST /articles/:id/publish` | **A01: Broken Access Control** | Любой пользователь мог публиковать любые статьи. | Критический | Проверка владельца + роль admin (публикация только admin). |
| 9 | `GET /preview?url=...` | **A10: SSRF** | Сервер ходит по любому URL (в т.ч. в 169.254.*, localhost). | Критический | Только `https://`, deny private IP/ranges, deny localhost, allowlist доменов, timeout 5s, лог блокировок. |
| 10 | `GET /debug/config` | **A02: Cryptographic Failures** + **A05** | Отдача `process.env` и admin token → полный компромисс. | Критический | Endpoint удалён (404). |

### Часть B — Где лежит исправленный код

- Сервер: `src/server.js`
- SSRF-защита: `src/security/ssrf.js`
- JWT: `src/auth/jwt.js`
- Upload-фильтр: `src/upload.js`

### Часть C — Верификация (curl / PowerShell)

См. `scripts/verify.ps1` (содержит проверки “до/после” в формате методички).

