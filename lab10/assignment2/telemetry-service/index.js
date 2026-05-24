const express = require('express');
const cors = require('cors');
const { initTracing, runWithSpan } = require('../../shared/tracing');
const logger = require('../../shared/logger');
const { publish, getKafka, ensureTopics } = require('../../shared/kafka');
const axios = require('axios');

process.env.SERVICE_NAME = 'telemetry-service';
initTracing('telemetry-service');

const PORT = Number(process.env.PORT || 3010);
const HOST = process.env.HOST || '0.0.0.0';
const REGISTRY_URL = process.env.REGISTRY_URL || 'http://device-registry:3011';
const VALID_METRICS = ['temperature', 'humidity', 'co2', 'motion', 'light'];

const roomBuffer = new Map();

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_, res) => res.json({ status: 'ok', service: 'telemetry-service' }));

async function isSensorEnabled(sensorId) {
  try {
    const { data } = await axios.get(`${REGISTRY_URL}/devices/${sensorId}`, { timeout: 2000 });
    return data.enabled !== false;
  } catch {
    return true;
  }
}

async function ingestEvent(event) {
  return runWithSpan('ingest-telemetry', async () => {
    if (!VALID_METRICS.includes(event.metric)) {
      throw new Error(`Invalid metric: ${event.metric}`);
    }
    const enabled = await isSensorEnabled(event.sensor_id);
    if (!enabled) {
      const err = new Error('Sensor disabled');
      err.status = 403;
      throw err;
    }
    const key = event.room_id;
    if (!roomBuffer.has(key)) roomBuffer.set(key, []);
    const buf = roomBuffer.get(key);
    buf.push(event);
    if (buf.length > 500) buf.shift();

    await publish('sensor-stream', event.sensor_id, event, [
      { source: Buffer.from('telemetry-service') },
    ]);
    logger.info('Telemetry ingested', { sensor_id: event.sensor_id, metric: event.metric });
    return event;
  });
}

app.post('/telemetry', async (req, res) => {
  try {
    const event = normalizeEvent(req.body);
    const saved = await ingestEvent(event);
    res.status(201).json(saved);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

app.post('/telemetry/batch', async (req, res) => {
  const events = (req.body.events || req.body || []).map(normalizeEvent);
  const results = [];
  for (const e of events) {
    try {
      results.push(await ingestEvent(e));
    } catch (err) {
      results.push({ error: err.message, sensor_id: e.sensor_id });
    }
  }
  res.status(201).json({ count: results.length, results });
});

app.post('/telemetry/external', async (req, res) => {
  try {
    const events = Array.isArray(req.body) ? req.body : [req.body];
    const saved = [];
    for (const e of events) {
      saved.push(await ingestEvent(normalizeEvent(e)));
    }
    res.status(201).json(saved);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/telemetry/room/:id', (req, res) => {
  res.json(roomBuffer.get(req.params.id) || []);
});

function normalizeEvent(body) {
  return {
    sensor_id: body.sensor_id,
    room_id: body.room_id,
    metric: body.metric,
    value: Number(body.value),
    timestamp: body.timestamp || new Date().toISOString(),
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function start() {
  const topics = ['sensor-stream', 'sensor-stream-dlq', 'campus-alerts', 'campus-alerts-dlq'];
  for (let attempt = 1; attempt <= 30; attempt++) {
    try {
      const admin = getKafka().admin();
      await admin.connect();
      await ensureTopics(admin, topics);
      await admin.disconnect();
      break;
    } catch (err) {
      logger.warn('Kafka not ready for telemetry', { attempt, error: err.message });
      if (attempt === 30) throw err;
      await sleep(2000);
    }
  }

  app.listen(PORT, HOST, () => {
    logger.info(`Telemetry service on ${PORT}`);
  });
}

start();
module.exports = { roomBuffer, ingestEvent, normalizeEvent };
