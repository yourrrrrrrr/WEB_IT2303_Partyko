const express = require('express');
const cors = require('cors');
const { initTracing } = require('../../shared/tracing');
const logger = require('../../shared/logger');

process.env.SERVICE_NAME = 'device-registry';
initTracing('device-registry');

const PORT = Number(process.env.PORT || 3011);
const devices = new Map();

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_, res) => res.json({ status: 'ok', service: 'device-registry', devices: devices.size }));

app.post('/devices/register', (req, res) => {
  const { sensor_id, room_id, type, enabled = true } = req.body;
  if (!sensor_id || !room_id) {
    return res.status(400).json({ error: 'sensor_id and room_id required' });
  }
  const device = {
    sensor_id,
    room_id,
    type: type || 'generic',
    enabled,
    registered_at: new Date().toISOString(),
  };
  devices.set(sensor_id, device);
  logger.info('Device registered', { sensor_id, room_id });
  res.status(201).json(device);
});

app.get('/devices/:sensor_id', (req, res) => {
  const d = devices.get(req.params.sensor_id);
  if (!d) return res.status(404).json({ error: 'Not found' });
  res.json(d);
});

app.get('/devices/room/:id', (req, res) => {
  const list = [...devices.values()].filter((d) => d.room_id === req.params.id);
  res.json(list);
});

app.put('/devices/:sensor_id/disable', (req, res) => {
  const d = devices.get(req.params.sensor_id);
  if (!d) return res.status(404).json({ error: 'Not found' });
  d.enabled = false;
  res.json(d);
});

app.listen(PORT, async () => {
  logger.info(`Device registry on ${PORT}`);
  ['S-TEMP-101', 'S-CO2-101', 'S-MOT-101', 'EXT-TS-2427201-TEMP'].forEach((id, i) => {
    devices.set(id, {
      sensor_id: id,
      room_id: i < 3 ? 'room-101' : 'CAMPUS-EXT-1',
      type: 'environmental',
      enabled: true,
      registered_at: new Date().toISOString(),
    });
  });
});

module.exports = { devices };
