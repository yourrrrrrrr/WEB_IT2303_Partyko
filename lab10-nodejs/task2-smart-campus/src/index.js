import express from 'express';
import morgan from 'morgan';
import { randomUUID } from 'crypto';
import { bus } from './bus.js';

const ports = {
  gateway: 3200,
  telemetry: 3201,
  registry: 3202,
  alert: 3203,
  notification: 3204
};
const devices = new Map();
const roomEvents = new Map();
const alerts = [];
const rate = new Map();
const apiKey = (req, res, next) => req.headers['x-api-key'] === 'sensor-demo-key' ? next() : res.status(401).json({ error: 'X-API-Key required' });

const rateLimit = (req, res, next) => {
  const id = req.body.sensor_id || req.headers['x-sensor-id'] || 'unknown';
  const now = Date.now();
  const b = (rate.get(id) || []).filter(t => now - t < 60000);
  b.push(now); rate.set(id, b);
  return b.length > 100 ? res.status(429).json({ error: '100 req/min per sensor' }) : next();
};

function trace(req, res, next) {
  req.traceId = req.headers.traceparent || req.headers['x-request-id'] || randomUUID();
  res.setHeader('X-Request-ID', req.traceId);
  next();
}

function saveEvent(e) {
  if (!roomEvents.has(e.room_id)) roomEvents.set(e.room_id, []);
  roomEvents.get(e.room_id).push(e);
}
function isDisabled(sensorId) {
  return devices.get(sensorId)?.disabled === true;
}
function normalizeEvent(body) {
  return {
    sensor_id: body.sensor_id,
    room_id: body.room_id,
    metric: body.metric,
    value: Number(body.value),
    timestamp: body.timestamp || new Date().toISOString()
  };
}
function publishTelemetry(req, event) {
  saveEvent(event);
  return bus.publish('sensor-stream', event, {
    traceparent: req.traceId,
    source: req.headers.source || 'direct',
    sensor_id: event.sensor_id
  });
}

function startTelemetry() {
  const app = express();
  app.use(express.json(), morgan('dev'), trace);

  app.post('/telemetry', apiKey, rateLimit, (req, res) => {
    const e = normalizeEvent(req.body);
    if (isDisabled(e.sensor_id)) return res.status(403).json({ error: 'sensor disabled' });
    publishTelemetry(req, e); res.status(202).json({ accepted: true, event: e });
  });

  app.post('/telemetry/batch', apiKey, (req, res) => {
    const accepted = [];
    for (const raw of req.body.events || []) {
      const e = normalizeEvent(raw);
      if (!isDisabled(e.sensor_id)) {
        publishTelemetry(req, e);
        accepted.push(e);
      }
    } res.status(202).json({ accepted: accepted.length });
  });

  app.get('/telemetry/room/:id', (req, res) => res.json(roomEvents.get(req.params.id) || []));

  app.post('/telemetry/external', apiKey, (req, res) => {
    const feed = req.body.feed || {};
    const events = [{
      sensor_id: 'EXT-TS-TEMP',
      room_id: 'CAMPUS-EXT-1',
      metric: 'temperature',
      value: Number(feed.field1 || 22),
      timestamp: feed.created_at || new Date().toISOString()
    }, {
      sensor_id: 'EXT-TS-HUM',
      room_id: 'CAMPUS-EXT-1',
      metric: 'humidity',
      value: Number(feed.field2 || 50),
      timestamp: feed.created_at || new Date().toISOString()
    }];
    events.forEach(e => publishTelemetry(req, e));
    res.json({ normalized: events });
  });

  app.get('/health', (_, res) => res.json({
    service: 'telemetry', status: 'UP'
  }));

  app.listen(ports.telemetry, () => console.log(`Telemetry Service :${ports.telemetry}`));
}

function startRegistry() {
  const app = express();
  app.use(express.json(), morgan('dev'));

  app.post('/devices/register', (req, res) => {
    const d = {
      sensor_id: req.body.sensor_id,
      room_id: req.body.room_id,
      metrics: req.body.metrics || [],
      disabled: false,
      last_seen: new Date().toISOString()
    };
    devices.set(d.sensor_id, d);
    res.status(201).json(d);
  });

  app.get('/devices/:sensor_id', (req, res) => res.json(devices.get(req.params.sensor_id) || null));
  app.get('/devices/room/:id', (req, res) => res.json([...devices.values()].filter(d => d.room_id === req.params.id)));
  app.put('/devices/:sensor_id/disable', (req, res) => {
    const d = devices.get(req.params.sensor_id);
    if (!d) return res.status(404).json({
      error: 'not found'
    });
    d.disabled = true; res.json(d);
  });

  app.get('/health', (_, res) => res.json({
    service: 'registry', status: 'UP'
  }));

  app.listen(ports.registry, () => console.log(`Device Registry :${ports.registry}`));
}

function startAlertEngine(instance = 'alert-1') {
  const lastBySensorMetric = new Map();
  const motionByRoom = new Map();
  bus.subscribe('sensor-stream', 'alert-engine-group', record => {
    const e = record.event;
    const key = `${e.sensor_id}:${e.metric}`;
    const prev = lastBySensorMetric.get(key);
    lastBySensorMetric.set(key, e);
    if (e.metric === 'motion' && e.value > 0) motionByRoom.set(e.room_id, new Date(e.timestamp).getTime());
    const emit = (type, reason) => {
      const alert = {
        type, room_id: e.room_id,
        sensor_id: e.sensor_id,
        metric: e.metric,
        value: e.value,
        reason,
        timestamp: new Date().toISOString(),
        traceparent: record.headers.traceparent,
        instance
      };
      alerts.unshift(alert);
      bus.publish('campus-alerts', alert, {
        traceparent: record.headers.traceparent
      });
    };

    if (e.metric === 'temperature' && e.value > 28) emit('alert.overheat', 'temperature > 28°C');
    if (e.metric === 'co2' && e.value > 1000) emit('alert.air_quality', 'CO₂ > 1000 ppm');
    if (e.metric === 'temperature' && prev && Math.abs(e.value - prev.value) > 5
      && new Date(e.timestamp) - new Date(prev.timestamp) <= 60000)
      emit('alert.overheat', 'temperature jump > 5°C in 1 minute');
    for (const [room, last] of motionByRoom.entries())
      if (Date.now() - last > 2 * 60 * 60 * 1000) alerts.unshift({
        type: 'alert.room_idle',
        room_id: room,
        reason: 'no motion > 2 hours',
        timestamp: new Date().toISOString(),
        instance
      });
  }, 'earliest');

  const app = express();
  app.get('/alerts', (_, res) => res.json(alerts));
  app.get('/health', (_, res) => res.json({
    service: instance,
    status: 'UP'
  }));
  app.listen(ports.alert, () => console.log(`Alert Engine :${ports.alert}`));
}

function startNotification() {
  bus.subscribe('campus-alerts', 'notification-group', r => console.log(JSON.stringify({
    service: 'notification',
    alert: r.event.type,
    trace: r.headers.traceparent
  })));
  const app = express();
  app.get('/health', (_, res) => res.json({
    service: 'notification',
    status: 'UP'
  }));
  app.listen(ports.notification, () => console.log(`Notification Service :${ports.notification}`));
}

function startGateway() {
  const app = express();
  app.use(express.static('public'));
  app.get('/', (_, res) => res.redirect('/index.html'));
  app.use(express.json(), morgan('dev'), trace);
  app.post('/telemetry', apiKey, rateLimit, (req, res) => {
    const e = normalizeEvent(req.body);
    if (isDisabled(e.sensor_id)) return res.status(403).json({ error: 'sensor disabled' });
    publishTelemetry(req, e);
    res.status(202).json({ accepted: true, trace: req.traceId });
  });

  app.post('/telemetry/batch', apiKey, (req, res) => {
    for (const raw of req.body.events || []) publishTelemetry(req, normalizeEvent(raw));
    res.status(202).json({ accepted: (req.body.events || []).length });
  });
  app.get('/telemetry/room/:id', (req, res) => res.json(roomEvents.get(req.params.id) || []));
  app.post('/api/devices/register', (req, res) => {
    const d = {
      sensor_id: req.body.sensor_id,
      room_id: req.body.room_id,
      metrics: req.body.metrics || [],
      disabled: false,
      last_seen: new Date().toISOString()
    }; devices.set(d.sensor_id, d); res.status(201).json(d);
  });
  app.get('/api/devices/room/:id', (req, res) => res.json([...devices.values()].filter(d => d.room_id === req.params.id)));
  app.put('/api/devices/:sensor_id/disable', (req, res) => {
    const device = devices.get(req.params.sensorId);
    if (!device) {
      return res.status(404).json({ error: 'Sensor not found' });
    }

    device.status = 'offline';
    device.disabled = true;
    device.disabled_at = new Date().toISOString();
    devices.set(req.params.sensorId, device);

    res.json({
      disabled: true,
      sensor_id: req.params.sensorId,
      status: 'offline',
      device
    });
  });

  app.get('/api/alerts', (_, res) => res.json(alerts));

  app.post('/telemetry/external', apiKey, (req, res) => {
    const feed = req.body.feed || {};
    const events = [{
      sensor_id: 'EXT-TS-TEMP',
      room_id: 'CAMPUS-EXT-1',
      metric: 'temperature',
      value: Number(feed.field1 || 22),
      timestamp: feed.created_at || new Date().toISOString()
    }, {
      sensor_id: 'EXT-TS-HUM',
      room_id: 'CAMPUS-EXT-1',
      metric: 'humidity',
      value: Number(feed.field2 || 50),
      timestamp: feed.created_at || new Date().toISOString()
    }]; events.forEach(e => publishTelemetry(req, e));
    res.json({ normalized: events });
  });
  app.get('/dashboard/campus', (req, res) => {
    const temps = [...roomEvents.entries()].map(([room, ev]) => ({
      room, temperature: ev.filter(x => x.metric === 'temperature').at(-1)?.value
    }));
    const offline = [...devices.values()].filter(d => Date.now() - new Date(d.last_seen).getTime() > 600000);
    res.send(`<h1>Campus dashboard</h1><pre>${JSON.stringify({
      temperatures: temps,
      latest_alerts: alerts.slice(0, 10),
      offline_sensors: offline,
      occupancy_heatmap: [...roomEvents.entries()].map(([room, ev]) => ({
        room, motion_events: ev.filter(x => x.metric === 'motion' && x.value > 0).length
      }))
    }, null, 2)}</pre>`);
  });
  app.get('/system/health', (_, res) => res.json({
    gateway: 'UP',
    telemetry: 'UP',
    registry: 'UP',
    alert_engine: 'UP',
    notification: 'UP',
    discovery: 'healthy instances only'
  }));
  app.listen(ports.gateway, () => console.log(`Ingress API Gateway :${ports.gateway}`));
}
startTelemetry();
startRegistry();
startAlertEngine();
startNotification();
startGateway();
