# Задание 1 — Микросервисная платформа онлайн-обучения

## Запуск
```bash
npm install
npm run dev
```

Сервисы:
- API Gateway + HTML frontend: `http://localhost:3100`
- Course Service: `http://localhost:3101`
- Progress Service: `http://localhost:3102`
- Recommendation Service: `http://localhost:3103`

## Проверка сценария
```bash
curl -H "Authorization: Bearer demo" -H "X-Student-ID: s1" http://localhost:3100/api/courses
curl -X POST http://localhost:3100/api/progress/watch \
  -H "Authorization: Bearer demo" -H "Content-Type: application/json" \
  -d '{"student_id":"s1","course_id":"js-basic","lesson_id":"intro","watch_time":120}'
curl -H "Authorization: Bearer demo" http://localhost:3100/api/recommendations/s1
open http://localhost:3100
open http://localhost:3100/dashboard/student/s1
```

Реализовано: JWT-like проверка, rate limit 50 req/min/student, X-Request-ID/traceparent, topic `learning-events`, headers, replay/DLQ, сервисы Course/Progress/Recommendation, dashboard.


## HTML frontend
Откройте `http://localhost:3100`. Интерфейс позволяет загрузить курсы, выбрать урок, записать студента на курс, отправить событие просмотра урока, получить рекомендации и открыть dashboard студента.
