# Задание 2 — IoT-платформа умного кампуса

## Запуск
```bash
npm install
npm run dev
```

Сервисы:
- Ingress API Gateway + HTML frontend: `http://localhost:3200`
- Telemetry Service: `http://localhost:3201`
- Device Registry: `http://localhost:3202`
- Alert Engine: `http://localhost:3203`
- Notification Service: `http://localhost:3204`

## Проверка сценария
```bash
curl -X POST http://localhost:3202/devices/register \
  -H "Content-Type: application/json" \
  -d '{"sensor_id":"s-temp-1","room_id":"A101","metrics":["temperature"]}'

curl -X POST http://localhost:3200/telemetry \
  -H "X-API-Key: sensor-demo-key" -H "Content-Type: application/json" \
  -d '{"sensor_id":"s-temp-1","room_id":"A101","metric":"temperature","value":31}'

curl http://localhost:3203/alerts
open http://localhost:3200
open http://localhost:3200/dashboard/campus
```

Реализовано: API key authentication, rate limit 100 req/min/sensor, topic `sensor-stream`, topic `campus-alerts`, DLQ/replay модель, Kafka headers propagation, request id/traceparent, Device Registry, Alert Engine, Notification Service, dashboard и endpoint `/telemetry/external` для нормализации внешних источников вроде ThingSpeak.


## HTML frontend
Откройте `http://localhost:3200`. Интерфейс позволяет зарегистрировать датчик, отправить одиночную и batch-телеметрию, вызвать нормализацию внешнего feed, посмотреть события комнаты, алерты, health-check и dashboard кампуса.
