# Лабораторная работа 10 — Node.js + HTML frontend

В проекте две реализации на JavaScript/Node.js:

- `task1-learning-platform` — микросервисная платформа онлайн-обучения с HTML-фронтендом.
- `task2-smart-campus` — распределённая IoT-платформа умного кампуса с HTML-фронтендом.

Обе реализации сделаны как учебный runnable-demo: несколько Express-сервисов запускаются отдельными процессами, используется общий event-bus с Kafka-совместимой моделью событий для демонстрации producer/consumer, headers, replay и DLQ. В реальном развёртывании event-bus можно заменить на KafkaJS.

## Быстрый запуск

```bash
cd lab10-nodejs
npm install
npm run task1
# открыть http://localhost:3100

# или во втором запуске
npm run task2
# открыть http://localhost:3200
```
