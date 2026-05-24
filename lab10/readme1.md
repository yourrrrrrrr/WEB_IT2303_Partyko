Как устроена лабораторная (простыми словами)
Один репозиторий, два независимых проекта. Всё поднимается через Docker Compose: Kafka + микросервисы + два gateway.
Задание
Gateway
Dashboard
1 — обучение
http://localhost:8080
http://localhost:8080/dashboard/
2 — IoT кампус
http://localhost:8090
http://localhost:8090/dashboard/campus
Общая идея: не один большой сервер, а несколько маленьких. Они общаются через HTTP/gRPC (сразу) и Kafka (события «в фоне»).
Задание 1 — платформа обучения
Что происходит, когда студент «смотрит урок»
Браузер / curl
↓ JWT
Learning Gateway (:8080)
↓ gRPC
Progress Service → Kafka topic: learning-events
↓ ↓
сохраняет прогресс Recommendation Service (×2)
↓
обновляет рекомендации
Студент получает JWT: POST /auth/token с student_id.
Отмечает урок: POST /api/progress/watch (нужен Bearer token).
Gateway вызывает Progress Service по gRPC (MarkLessonWatched).
Progress считает % курса, streak, время просмотра и шлёт в Kafka событие lesson.watched (ключ = student_id).
Recommendation Service (2 копии, consumer group) читает Kafka и добавляет рекомендации:
следующий курс (c1→c2→c3→c1);
повтор темы, если прогресс < 30%;
при завершении курса — course.completed.
Рекомендации отдаются через GET /api/recommendations.
Dashboard GET /dashboard/student/{id} собирает прогресс, курсы, рекомендации, dropout risk.
Course Service — отдельно: каталог курсов и уроков (GET /api/courses, /lessons), без Kafka в основной цепочке просмотра.
Задание 2 — умный кампус (IoT)
Что происходит, когда сенсор шлёт температуру
Сенсор / dashboard / collector
↓ API key
IoT Gateway (:8090)
↓ HTTP
Telemetry Service → Kafka: sensor-stream
↓
Alert Engine (×2)
↓
alert.overheat / air_quality / room_idle
↓
Dashboard показывает alerts и температуры
Данные приходят с x-api-key: sensor-key-demo-1.
Gateway проксирует в Telemetry Service.
Telemetry проверяет сенсор в Device Registry (не отключён ли) и публикует в sensor-stream.
Alert Engine (2 инстанса) читает Kafka и проверяет правила:
температура > 28°C → alert.overheat;
CO₂ > 1000 → alert.air_quality;
нет движения > 2 ч → alert.room_idle;
скачок > 5°C за минуту → overheat (spike).
Collector (опционально) тянет ThingSpeak или synthetic и кладёт события в Kafka.
Device Registry — учёт сенсоров: регистрация, отключение (403 при отправке с отключённого).
Соответствие условиям лабораторной
Ниже — честная таблица: что есть, что упрощено, чего нет.
Задание 1
Требование ТЗ
В проекте
Статус
3 микросервиса: Course, Progress, Recommendation
да
✅
Course REST: /courses, /courses/{id}, /lessons, /enroll, /health
через gateway /api/courses/*
✅
Progress gRPC: 3 метода
да, proto + grpc-js
✅
Прогресс, %, streak, watch time, last activity
в progress-service
✅
Recommendation — Kafka consumer
2 инстанса, learning-events
✅
События lesson.watched, course.completed
progress шлёт
✅
student.inactive
обработка есть, отправки нет
⚠️ частично
Рекомендации: next course, repeat, popular, dropout
правила в recommendation-service
✅ (dropout только при inactive)
Gateway: JWT
POST /auth/token + Bearer
✅
Routing /api/courses, /api/progress, /api/recommendations
learning-gateway
✅
Rate limit 50 req/min
express-rate-limit по student
✅
X-Request-ID
gateway
✅
traceparent
пробрасывается в заголовке
✅
Kafka: topic, partition key, consumer groups, DLQ, idempotent producer
shared/kafka.js
✅
Replay from offset
KAFKA_FROM_BEGINNING=true
✅
Dashboard /dashboard/student/{id}
да + HTML UI
✅
Jaeger / OpenTelemetry
убрано → только correlation-id + JSON logs
❌ упрощено
Consul / Eureka
убрано → список инстансов + /health + round-robin
❌ упрощено
2 Recommendation + балансировка
recommendation-1/2
✅ (без Consul)
Критерии проверки (1–4, 6) — можно показать на dashboard/curl.
Критерий 5 (Jaeger trace) — в текущей версии не выполняется (нет Jaeger UI).
Задание 2
Требование ТЗ
В проекте
Статус
Telemetry REST
POST/batch/room/health + /telemetry/external
✅
SensorEvent: sensor_id
_id, room_id, metric, value, timestamp | да | ✅ | | Метрики temperature, humidity, co2, motion, light | да | ✅ | | Device Registry | register, get, room, disable, health | ✅ | | Alert Engine + правила | 2 инстанса, все 4 типа аномалий | ✅ | | События alert.overheat, air_quality, room_idle | да (+ campus-alerts topic) | ✅ | | Gateway: API key, rate 100/min, request ID | iot-gateway | ✅ | | GET /system/health | агрегация telemetry + registry + alerts | ✅ | | Kafka sensor-stream, campus-alerts, DLQ, retention 24h | compose + kafka.js | ✅ | | Consumer groups, replay | да | ✅ | | HTML dashboard /dashboard/campus | да | ✅ | | Collector + ThingSpeak | collector-thingspeak, адаптер | ✅ | | Notification Service | нет отдельного сервиса — alerts в памяти alert-engine + Kafka | ⚠️ упрощено | | Jaeger / OpenTelemetry | как в задании 1 | ❌ упрощено | | Consul | health check + failover URL | ❌ упрощено | | Тесты: temperature, flood, disable, trace | assignment2/tests/alerts.test.js | ✅ (trace = health, не Jaeger) |
Как объяснить на защите (короткий сценарий)
Задание 1
Открыть dashboard → войти → выбрать курс → отметить урок.
Показать JSON POST /api/progress/watch — gRPC + прогресс.
Через пару секунд — «Рекомендации»: появился next_course / repeat_topic.
Сказать: «Progress не ждёт Recommendation — событие ушло в Kafka, recommendation обработал асинхронно».
Задание 2
Отправить температуру 31°C с dashboard.
«Обновить карточки» — alert alert.overheat.
Показать GET /system/health.
Опционально: docker compose --profile thingspeak up -d collector-thingspeak — внешний источник.
Главная мысль лабораторной
Синхронно (gateway → сервис) — когда нужен немедленный ответ (прогресс, приём телеметрии).
Асинхронно (Kafka) — когда можно отложить реакцию (рекомендации, алерты) и масштабировать consumer’ы.
У вас это реализовано. Отличия от «идеального» ТЗ: нет Jaeger и Consul (упрощение для локального запуска), нет Notification Service и нет генерации student.inactive. Если преподаватель строго требует Jaeger/Consul — их нужно вернуть или описать в отчёте как сознательное упрощение.