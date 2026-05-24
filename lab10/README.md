# Практические задания: микросервисы (Node.js + Kafka + Docker)

Два проекта в одном репозитории:

| Задание | Описание | Gateway | Dashboard |
|---------|----------|---------|-----------|
| **1** | Платформа онлайн-обучения | http://localhost:8080 | http://localhost:8080/dashboard/ |
| **2** | Smart Campus IoT | http://localhost:8090 | http://localhost:8090/dashboard/campus |

Инфраструктура: **Kafka**, **Zookeeper** (без Consul и Jaeger — проще для локального запуска).

## Быстрый старт (Docker Desktop)

```powershell
cd c:\Users\Admin\Documents\microservices-hw
docker compose up --build -d
```

Подождите 1–2 минуты, пока поднимутся Kafka и сервисы.

### Проверка

- Learning dashboard: http://localhost:8080/dashboard/
- Campus dashboard: http://localhost:8090/dashboard/campus

### Задание 1 — сценарий демонстрации

```powershell
# JWT токен
curl -X POST http://localhost:8080/auth/token -H "Content-Type: application/json" -d "{\"student_id\":\"student-1\"}"

# Отметить урок (подставьте token из ответа)
curl -X POST http://localhost:8080/api/progress/watch -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" -d "{\"course_id\":\"c1\",\"lesson_id\":\"l1-1\",\"watch_seconds\":180}"

# Рекомендации (балансировка recommendation-1 / recommendation-2)
curl http://localhost:8080/api/recommendations -H "Authorization: Bearer TOKEN"

# Dashboard API
curl http://localhost:8080/dashboard/student/student-1
```

Цепочка: Gateway → gRPC Progress → Kafka `learning-events` → Recommendation (2 инстанса, consumer group).

### Задание 2 — сценарий демонстрации

API key для сенсоров: `sensor-key-demo-1`

```powershell
curl -X POST http://localhost:8090/telemetry -H "x-api-key: sensor-key-demo-1" -H "Content-Type: application/json" -d "{\"sensor_id\":\"S-TEMP-101\",\"room_id\":\"room-101\",\"metric\":\"temperature\",\"value\":30.5}"
```

Синтетический **collector** по умолчанию **не запущен** (чтобы не сыпались случайные alerts). Включить:

```powershell
docker compose --profile collector up -d collector
```

Для **ThingSpeak**:

```powershell
docker compose --profile thingspeak up -d collector-thingspeak
```

### Тесты (после `docker compose up`)

```powershell
npm install
npm test
npm run test:learning
```

## Архитектура

### Задание 1

- `course-service` — REST каталог
- `progress-service` — gRPC + Kafka producer (`learning-events`)
- `recommendation-service` × 2 — Kafka consumer, статический список инстансов
- `learning-gateway` — JWT, rate limit 50/min, `X-Request-ID`, dashboard

### Задание 2

- `telemetry-service` — REST, Kafka `sensor-stream`
- `device-registry` — регистрация устройств
- `alert-engine` × 2 — правила alert, Kafka consumer group
- `collector` — ThingSpeak / synthetic → Kafka
- `iot-gateway` — API key, rate limit 100/min, `/system/health`

## Kafka

| Topic | Назначение |
|-------|------------|
| `learning-events` | lesson.watched, course.completed, student.inactive |
| `learning-events-dlq` | Dead letter queue |
| `sensor-stream` | телеметрия сенсоров |
| `campus-alerts` | alert.overheat, alert.air_quality, alert.room_idle |
| `*-dlq` | DLQ для ошибок consumer |

Producer: idempotent (`kafkajs`). Partition key: `student_id` / `sensor_id`.

## Балансировка без Consul

Gateway читает список инстансов из переменных окружения и проверяет `/health`:

- `RECOMMENDATION_INSTANCES=recommendation-1:3003,recommendation-2:3004`
- `ALERT_ENGINE_INSTANCES=alert-engine-1:3020,alert-engine-2:3021`

Round-robin между **живыми** инстансами.

## Correlation ID (без Jaeger)

- HTTP: заголовок `X-Request-ID` (gateway генерирует или пробрасывает)
- Kafka: заголовок `correlation-id` в сообщениях
- Логи: JSON через `shared/logger.js`

## Критерии проверки (чеклист)

**Задание 1**

1. Просмотр урока → gRPC `MarkLessonWatched`
2. Событие в Kafka `lesson.watched`
3. Recommendation обновляет рекомендации
4. Gateway rate limit 50 req/min
5. `X-Request-ID` / `correlation-id` в цепочке gateway → Kafka
6. Балансировка 2 recommendation-инстанса (health check + round-robin)

**Задание 2**

1. Batch 1000 событий — `test_sensor_flood`
2. Replay: `KAFKA_FROM_BEGINNING=true` на consumer
3. 2 alert-engine в одной consumer group
4. Unhealthy инстанс исключается по `/health`
5. Dashboard live alerts
6. `X-Request-ID` проходит gateway → telemetry → Kafka

## Структура

```
microservices-hw/
├── docker-compose.yml
├── shared/           # logger, kafka, tracing (correlation id), services (LB)
├── assignment1/      # обучающая платформа
└── assignment2/      # IoT кампус
```
