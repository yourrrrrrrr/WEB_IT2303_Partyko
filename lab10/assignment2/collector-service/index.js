const axios = require('axios');
const { initTracing, runWithSpan } = require('../../shared/tracing');
const logger = require('../../shared/logger');
const { publish, getKafka, ensureTopics } = require('../../shared/kafka');

process.env.SERVICE_NAME = 'collector-service';
initTracing('collector-service');

const POLL_MS = Number(process.env.POLL_INTERVAL_MS || 8000);
const CHANNEL = process.env.THINGSPEAK_CHANNEL || '2427201';
const TELEMETRY_URL = process.env.TELEMETRY_URL || 'http://telemetry-service:3010';

class ThingSpeakAdapter {
  constructor(channelId) {
    this.channelId = channelId;
    this.url = `https://api.thingspeak.com/channels/${channelId}/feeds.json?results=10`;
  }

  async fetch() {
    const { data } = await axios.get(this.url, { timeout: 15000 });
    return data.feeds || [];
  }

  normalize(feed) {
    const events = [];
    const base = {
      sensor_id: `EXT-TS-${this.channelId}-TEMP`,
      room_id: 'CAMPUS-EXT-1',
      timestamp: feed.created_at,
    };
    if (feed.field1 != null) {
      events.push({ ...base, metric: 'temperature', value: parseFloat(feed.field1) });
    }
    if (feed.field2 != null) {
      events.push({
        ...base,
        sensor_id: `EXT-TS-${this.channelId}-HUM`,
        metric: 'humidity',
        value: parseFloat(feed.field2),
      });
    }
    if (feed.field3 != null) {
      events.push({
        ...base,
        sensor_id: `EXT-TS-${this.channelId}-CO2`,
        metric: 'co2',
        value: parseFloat(feed.field3),
      });
    }
  if (feed.field4 != null) {
      events.push({
        ...base,
        sensor_id: `EXT-TS-${this.channelId}-LIGHT`,
        metric: 'light',
        value: parseFloat(feed.field4),
      });
    }
    return events.filter((e) => !Number.isNaN(e.value));
  }
}

class SyntheticAdapter {
  async fetch() {
    return [{ synthetic: true, ts: Date.now() }];
  }

  normalize() {
    const room = 'CAMPUS-EXT-1';
    const metric = 'temperature';
    const value = 22 + Math.random() * 4;
    return [{
      sensor_id: 'SYN-DEMO-TEMP',
      room_id: room,
      metric,
      value: Math.round(value * 100) / 100,
      timestamp: new Date().toISOString(),
    }];
  }
}

function getAdapter(source) {
  if (source === 'synthetic') return new SyntheticAdapter();
  return new ThingSpeakAdapter(process.env.THINGSPEAK_CHANNEL || '2427201');
}

async function poll(adapter, source) {
  await runWithSpan('collector-poll', async () => {
    const start = Date.now();
    const raw = await adapter.fetch();
    let count = 0;
    for (const item of raw) {
      const events = source === 'synthetic' ? adapter.normalize(item) : adapter.normalize(item);
      for (const event of events) {
        await publish('sensor-stream', event.sensor_id, event, [
          { source: Buffer.from(source) },
        ]);
        count++;
      }
    }
    logger.info('Collector poll done', {
      source,
      events: count,
      latency_ms: Date.now() - start,
    });
  });
}

async function main() {
  const source = process.argv.includes('--source')
    ? process.argv[process.argv.indexOf('--source') + 1]
    : process.env.COLLECTOR_SOURCE || 'thingspeak';

  const admin = getKafka().admin();
  await admin.connect();
  await ensureTopics(admin, ['sensor-stream']);
  await admin.disconnect();

  const adapter = getAdapter(source);
  logger.info('Collector started', { source, poll_ms: POLL_MS });

  poll(adapter, source).catch((e) => logger.error('Poll error', { error: e.message }));
  setInterval(() => poll(adapter, source).catch((e) => logger.error('Poll error', { error: e.message })), POLL_MS);
}

main();
