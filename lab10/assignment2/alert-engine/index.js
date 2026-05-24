const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const { initTracing, runWithSpan } = require('../../shared/tracing');
const logger = require('../../shared/logger');
const { createConsumer, publish, getKafka, ensureTopics } = require('../../shared/kafka');

process.env.SERVICE_NAME = process.env.SERVICE_NAME || 'alert-engine';
initTracing(process.env.SERVICE_NAME);

const PORT = Number(process.env.PORT || 3020);
const INSTANCE_ID = process.env.INSTANCE_ID || uuidv4().slice(0, 8);

const ALERT_COOLDOWN_MS = Number(process.env.ALERT_COOLDOWN_MS || 5 * 60 * 1000);
const ROOM_TEMP_TTL_MS = Number(process.env.ROOM_TEMP_TTL_MS || 30 * 60 * 1000);

const state = {
  lastMotion: new Map(),
  tempHistory: new Map(),
  alerts: [],
  roomTemp: new Map(),
  alertCooldown: new Map(),
};

function pushAlert(alert) {
  const entry = { ...alert, instance: INSTANCE_ID, id: uuidv4(), at: new Date().toISOString() };
  state.alerts.unshift(entry);
  if (state.alerts.length > 100) state.alerts.pop();
  return entry;
}

function shouldEmitAlert(type, room_id, sensor_id = '') {
  const key = `${type}:${room_id}:${sensor_id}`;
  const last = state.alertCooldown.get(key);
  if (last && Date.now() - last < ALERT_COOLDOWN_MS) return false;
  state.alertCooldown.set(key, Date.now());
  return true;
}

async function publishAlert(type, payload) {
  const room_id = payload.room_id || 'unknown';
  const sensor_id = payload.sensor_id || '';
  if (!shouldEmitAlert(type, room_id, payload.reason === 'temperature_spike' ? `spike:${sensor_id}` : sensor_id)) {
    return null;
  }
  const alert = pushAlert({ type, ...payload });
  await publish('campus-alerts', payload.room_id || 'unknown', {
    type,
    timestamp: new Date().toISOString(),
    ...payload,
  });
  logger.info('Alert published', { type, room_id: payload.room_id, instance: INSTANCE_ID });
  return alert;
}

async function processEvent({ value }) {
  await runWithSpan('alert-process', async () => {
    const { sensor_id, room_id, metric, value: val, timestamp } = value;
    const ts = new Date(timestamp).getTime();

    if (metric === 'temperature') {
      state.roomTemp.set(room_id, { value: val, updatedAt: ts });
      const histKey = `${room_id}:${sensor_id}`;
      const hist = state.tempHistory.get(histKey) || [];
      hist.push({ ts, val });
      const cutoff = ts - 60000;
      const recent = hist.filter((h) => h.ts >= cutoff);
      state.tempHistory.set(histKey, recent);
      if (val > 28) {
        await publishAlert('alert.overheat', { room_id, sensor_id, value: val, threshold: 28 });
      } else if (recent.length >= 3) {
        const delta = Math.abs(recent[recent.length - 1].val - recent[0].val);
        if (delta > 5) {
          await publishAlert('alert.overheat', {
            room_id,
            sensor_id,
            value: val,
            reason: 'temperature_spike',
            delta,
          });
        }
      }
    }

    if (metric === 'co2' && val > 1000) {
      await publishAlert('alert.air_quality', { room_id, sensor_id, value: val, threshold: 1000 });
    }

    if (metric === 'motion' && val > 0) {
      state.lastMotion.set(room_id, ts);
    }
  });
}

async function checkIdleRooms() {
  const now = Date.now();
  const twoHours = 2 * 60 * 60 * 1000;
  for (const [room_id, lastTs] of state.lastMotion.entries()) {
    if (lastTs > 0 && now - lastTs > twoHours) {
      await publishAlert('alert.room_idle', { room_id, idle_hours: (now - lastTs) / 3600000 });
      state.lastMotion.set(room_id, now);
    }
  }
}

const app = express();
app.use(cors());

app.get('/health', (_, res) =>
  res.json({ status: 'ok', service: 'alert-engine', instance: INSTANCE_ID, alerts: state.alerts.length })
);

app.get('/alerts', (req, res) => {
  const maxAge = Number(req.query.max_age_minutes || 120) * 60 * 1000;
  const cutoff = Date.now() - maxAge;
  const list = state.alerts.filter((a) => new Date(a.at).getTime() >= cutoff);
  res.json(list.slice(0, 50));
});

app.get('/rooms/temperature', (_, res) => {
  const now = Date.now();
  const rooms = [...state.roomTemp.entries()]
    .filter(([, data]) => now - data.updatedAt <= ROOM_TEMP_TTL_MS)
    .map(([room_id, data]) => ({ room_id, temperature: data.value, updated_at: new Date(data.updatedAt).toISOString() }));
  res.json(rooms);
});

app.post('/admin/reset', (_, res) => {
  state.alerts = [];
  state.roomTemp.clear();
  state.tempHistory.clear();
  state.lastMotion.clear();
  state.alertCooldown.clear();
  logger.info('Alert engine state reset', { instance: INSTANCE_ID });
  res.json({ ok: true, instance: INSTANCE_ID });
});

async function start() {
  const admin = getKafka().admin();
  await admin.connect();
  await ensureTopics(admin, ['sensor-stream', 'campus-alerts', 'sensor-stream-dlq']);
  await admin.disconnect();

  const groupId = `alert-engine-${process.env.CONSUMER_GROUP_SUFFIX || 'default'}`;
  await createConsumer(groupId, ['sensor-stream'], processEvent, {
    fromBeginning: process.env.KAFKA_FROM_BEGINNING === 'true',
  });

  setInterval(checkIdleRooms, 60000);

  app.listen(PORT, () => {
    logger.info(`Alert engine ${INSTANCE_ID} on ${PORT}`);
  });
}

start();
module.exports = { state, processEvent, publishAlert };
