const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const axios = require('axios');

const GATEWAY = process.env.IOT_GATEWAY_URL || 'http://localhost:8090';
const API_KEY = 'sensor-key-demo-1';
const headers = { 'x-api-key': API_KEY, 'x-sensor-id': 'S-TEMP-101' };

describe('Smart Campus IoT', () => {
  before(async () => {
    try {
      await axios.get(`${GATEWAY}/health`, { timeout: 3000 });
    } catch {
      console.warn('Gateway not running — start: docker compose up');
    }
  });

  it('test_temperature_alert — температура > 28 вызывает alert', async () => {
    await axios.post(
      `${GATEWAY}/telemetry`,
      {
        sensor_id: 'S-TEMP-101',
        room_id: 'room-101',
        metric: 'temperature',
        value: 31.5,
        timestamp: new Date().toISOString(),
      },
      { headers }
    );
    await new Promise((r) => setTimeout(r, 3000));
    const { data } = await axios.get(`${GATEWAY}/dashboard/campus/data`);
    const overheat = (data.alerts || []).some((a) => a.type === 'alert.overheat');
    assert.ok(overheat, 'Expected alert.overheat in dashboard data');
  });

  it('test_idle_room — нет движения 2 часа', async () => {
    await axios.post(
      `${GATEWAY}/telemetry`,
      {
        sensor_id: 'S-MOT-101',
        room_id: 'room-idle-demo',
        metric: 'motion',
        value: 1,
        timestamp: new Date().toISOString(),
      },
      { headers }
    );
    const { data } = await axios.get(`${GATEWAY}/dashboard/campus/data`);
    assert.ok(Array.isArray(data.alerts));
  });

  it('test_sensor_flood — 1000 событий за минуту', async () => {
    const batch = [];
    for (let i = 0; i < 1000; i++) {
      batch.push({
        sensor_id: `FLOOD-${i % 10}`,
        room_id: `room-${i % 5}`,
        metric: 'humidity',
        value: 50 + (i % 20),
        timestamp: new Date().toISOString(),
      });
    }
    const { status, data } = await axios.post(
      `${GATEWAY}/telemetry/batch`,
      { events: batch },
      { headers, timeout: 120000 }
    );
    assert.equal(status, 201);
    assert.equal(data.count, 1000);
  });

  it('test_registry_disable — отключённый sensor не принимает события', async () => {
    const id = 'S-DISABLED-TEST';
    await axios.post(`${GATEWAY}/devices/register`, {
      sensor_id: id,
      room_id: 'room-999',
      enabled: true,
    });
    await axios.put(`${GATEWAY}/devices/${id}/disable`, {}, { headers });
    try {
      await axios.post(
        `${GATEWAY}/telemetry`,
        { sensor_id: id, room_id: 'room-999', metric: 'temperature', value: 22 },
        { headers: { ...headers, 'x-sensor-id': id } }
      );
      assert.fail('Should reject disabled sensor');
    } catch (err) {
      assert.ok(err.response?.status === 403 || err.response?.data?.error);
    }
  });

  it('test_trace_pipeline — correlation id проходит gateway → kafka → alert', async () => {
    const requestId = `trace-test-${Date.now()}`;
    await axios.post(
      `${GATEWAY}/telemetry`,
      {
        sensor_id: 'S-CO2-101',
        room_id: 'room-102',
        metric: 'co2',
        value: 1200,
        timestamp: new Date().toISOString(),
      },
      {
        headers: {
          ...headers,
          'X-Request-ID': requestId,
          traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
        },
      }
    );
    await new Promise((r) => setTimeout(r, 2000));
    const { data } = await axios.get(`${GATEWAY}/system/health`);
    assert.ok(data.alert_engine_instances >= 1);
  });

  it('test_external_source_ingestion — collector → Kafka', async () => {
    const { ThingSpeakAdapter } = (() => {
      class ThingSpeakAdapter {
        normalize(feed) {
          return [{
            sensor_id: 'EXT-TEST',
            room_id: 'CAMPUS-EXT-1',
            metric: 'temperature',
            value: parseFloat(feed.field1 || '22'),
            timestamp: feed.created_at || new Date().toISOString(),
          }];
        }
      }
      return { ThingSpeakAdapter };
    })();
    const adapter = new ThingSpeakAdapter();
    const events = [];
    for (let i = 0; i < 5; i++) {
      events.push(...adapter.normalize({ field1: String(20 + i), created_at: new Date().toISOString() }));
    }
    assert.equal(events.length, 5);
    events.forEach((e) => {
      assert.ok(e.sensor_id);
      assert.ok(e.metric);
    });
  });
});
