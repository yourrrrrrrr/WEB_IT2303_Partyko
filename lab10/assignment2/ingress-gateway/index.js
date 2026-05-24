const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { initTracing } = require('../../shared/tracing');
const logger = require('../../shared/logger');
const {
  discoverHealthy,
  pickRoundRobin,
  axiosWithFailover,
  getTelemetryBaseUrls,
  getRegistryBaseUrls,
} = require('../../shared/services');

process.env.SERVICE_NAME = 'iot-ingress-gateway';
initTracing('iot-ingress-gateway');

const PORT = Number(process.env.PORT || 8090);
const API_KEYS = (process.env.SENSOR_API_KEYS || 'sensor-key-demo-1,sensor-key-demo-2').split(',');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.use((req, res, next) => {
  req.requestId = req.headers['x-request-id'] || uuidv4();
  res.setHeader('X-Request-ID', req.requestId);
  process.env.CORRELATION_ID = req.requestId;
  next();
});

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  keyGenerator: (req) => req.sensorId || req.headers['x-api-key'] || req.ip,
  message: { error: 'Rate limit: 100 req/min per sensor' },
});
app.use(limiter);

function apiKeyAuth(req, res, next) {
  if (
    req.path === '/health' ||
    req.path === '/system/health' ||
    req.path.startsWith('/dashboard')
  ) {
    return next();
  }
  const key = req.headers['x-api-key'];
  if (!key || !API_KEYS.includes(key)) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  req.sensorId = req.headers['x-sensor-id'] || key;
  next();
}

app.use(apiKeyAuth);

app.get('/health', (_, res) => res.json({ status: 'ok', service: 'iot-ingress-gateway' }));

app.get('/system/health', async (_, res) => {
  const telemetryUrls = getTelemetryBaseUrls();
  const registryUrls = getRegistryBaseUrls();
  const alerts = await discoverHealthy('alert-engine');

  let telemetryStatus = 'down';
  let registryStatus = 'down';
  let telemetryDetail = {};
  let registryDetail = {};

  try {
    telemetryDetail = await axiosWithFailover(telemetryUrls, (base) =>
      axios.get(`${base}/health`, { timeout: 3000 }).then((r) => r.data)
    );
    telemetryStatus = 'up';
  } catch {
    /* keep down */
  }

  try {
    registryDetail = await axiosWithFailover(registryUrls, (base) =>
      axios.get(`${base}/health`, { timeout: 3000 }).then((r) => r.data)
    );
    registryStatus = 'up';
  } catch {
    /* keep down */
  }

  res.json({
    status: telemetryStatus === 'up' && registryStatus === 'up' ? 'healthy' : 'degraded',
    services: [
      { name: 'telemetry', status: telemetryStatus, ...telemetryDetail },
      { name: 'registry', status: registryStatus, ...registryDetail },
    ],
    alert_engine_instances: alerts.length,
  });
});

app.post('/telemetry', proxyTelemetry);
app.post('/telemetry/batch', proxyTelemetry);
app.post('/telemetry/external', proxyTelemetry);

async function proxyTelemetry(req, res) {
  try {
    const result = await axiosWithFailover(getTelemetryBaseUrls(), (base) =>
      axios({
        method: req.method,
        url: `${base}${req.path}`,
        data: req.body,
        headers: { 'X-Request-ID': req.requestId },
        validateStatus: () => true,
        timeout: 120000,
      })
    );
    res.status(result.status).json(result.data);
  } catch (err) {
    res.status(502).json({ error: err.message, hint: 'Запустите: docker compose up -d telemetry-service iot-gateway' });
  }
}

app.get('/telemetry/room/:id', async (req, res) => {
  try {
    const data = await axiosWithFailover(getTelemetryBaseUrls(), (base) =>
      axios.get(`${base}/telemetry/room/${req.params.id}`, { timeout: 10000 }).then((r) => r.data)
    );
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.post('/devices/register', async (req, res) => {
  try {
    const result = await axiosWithFailover(getRegistryBaseUrls(), (base) =>
      axios.post(`${base}/devices/register`, req.body, { validateStatus: () => true, timeout: 10000 })
    );
    res.status(result.status).json(result.data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/devices/:id', async (req, res) => {
  try {
    const result = await axiosWithFailover(getRegistryBaseUrls(), (base) =>
      axios.get(`${base}/devices/${req.params.id}`, { validateStatus: () => true, timeout: 10000 })
    );
    res.status(result.status).json(result.data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.put('/devices/:sensor_id/disable', async (req, res) => {
  try {
    const result = await axiosWithFailover(getRegistryBaseUrls(), (base) =>
      axios.put(`${base}/devices/${req.params.sensor_id}/disable`, req.body, {
        validateStatus: () => true,
        timeout: 10000,
      })
    );
    res.status(result.status).json(result.data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.post('/dashboard/campus/reset', async (_, res) => {
  const alertBases = [
    'http://alert-engine-1:3020',
    'http://alert-engine-2:3021',
    'http://host.docker.internal:3020',
    'http://host.docker.internal:3021',
    'http://127.0.0.1:3020',
    'http://127.0.0.1:3021',
  ];
  const results = [];
  for (const base of alertBases) {
    try {
      const { data } = await axios.post(`${base}/admin/reset`, {}, { timeout: 3000 });
      results.push(data);
    } catch {
      /* instance may be down */
    }
  }
  res.json({ ok: true, reset_instances: results.length, details: results });
});

app.get('/dashboard/campus/data', async (_, res) => {
  try {
    const alertInstances = await discoverHealthy('alert-engine');
    const picked = pickRoundRobin(alertInstances) || { address: 'alert-engine-1', port: 3020 };
    const alertBases = [
      `http://${picked.address}:${picked.port}`,
      'http://host.docker.internal:3020',
      'http://127.0.0.1:3020',
      'http://host.docker.internal:3021',
      'http://127.0.0.1:3021',
    ];

    const temps = await axiosWithFailover(alertBases, (base) =>
      axios.get(`${base}/rooms/temperature`, { timeout: 5000 }).then((r) => r.data)
    ).catch(() => []);

    const alerts = await axiosWithFailover(alertBases, (base) =>
      axios.get(`${base}/alerts`, { timeout: 5000 }).then((r) => r.data)
    ).catch(() => []);

    res.json({
      temperatures: temps,
      alerts: (alerts || []).slice(0, 20),
      offline_sensors: [],
      occupancy_heatmap: buildHeatmap(alerts || []),
      alert_instance: picked.id,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function buildHeatmap(alerts) {
  const rooms = {};
  for (const a of alerts) {
    if (!a.room_id) continue;
    rooms[a.room_id] = (rooms[a.room_id] || 0) + 1;
  }
  return Object.entries(rooms).map(([room_id, score]) => ({ room_id, activity_score: score }));
}

app.get('/dashboard/campus', (_, res) => {
  res.sendFile(path.join(__dirname, '../dashboard/campus.html'));
});

app.listen(PORT, () => logger.info(`IoT Ingress Gateway on ${PORT}`));
