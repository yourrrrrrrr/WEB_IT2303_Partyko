const { Kafka, logLevel } = require('kafkajs');
const logger = require('./logger');

let kafka;
let producer;

function getKafka() {
  if (!kafka) {
    kafka = new Kafka({
      clientId: process.env.SERVICE_NAME || 'app',
      brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
      logLevel: logLevel.ERROR,
    });
  }
  return kafka;
}

async function getProducer() {
  if (!producer) {
    producer = getKafka().producer({
      idempotent: true,
      maxInFlightRequests: 1,
      transactionalId: process.env.KAFKA_TX_ID || undefined,
    });
    await producer.connect();
    logger.info('Kafka producer connected');
  }
  return producer;
}

async function publish(topic, key, value, headers = []) {
  const p = await getProducer();
  const traceHeaders = require('./tracing').injectTraceHeaders();
  const hdrs = {};
  for (const h of [...headers, ...traceHeaders]) {
    const k = Object.keys(h)[0];
    hdrs[k] = Buffer.isBuffer(h[k]) ? h[k] : Buffer.from(String(h[k]));
  }
  if (process.env.CORRELATION_ID) {
    hdrs['correlation-id'] = Buffer.from(process.env.CORRELATION_ID);
  }
  await p.send({
    topic,
    messages: [{ key, value: JSON.stringify(value), headers: hdrs }],
  });
}

async function createConsumer(groupId, topics, handler, { fromBeginning = false } = {}) {
  const consumer = getKafka().consumer({ groupId });
  await consumer.connect();
  await consumer.subscribe({ topics, fromBeginning });
  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      try {
        const headers = message.headers || {};
        const correlationId = headers['correlation-id']?.toString();
        if (correlationId) process.env.CORRELATION_ID = correlationId;
        const value = JSON.parse(message.value.toString());
        await handler({ topic, partition, key: message.key?.toString(), value, headers });
      } catch (err) {
        logger.error('Consumer error', { error: err.message, topic });
        const dlq = `${topic}-dlq`;
        try {
          const p = await getProducer();
          await p.send({
            topic: dlq,
            messages: [
              {
                key: message.key,
                value: message.value,
                headers: { error: Buffer.from(err.message) },
              },
            ],
          });
        } catch (dlqErr) {
          logger.error('DLQ publish failed', { error: dlqErr.message });
        }
      }
    },
  });
  return consumer;
}

async function ensureTopics(admin, topics) {
  const existing = await admin.listTopics();
  for (const t of topics) {
    if (!existing.includes(t)) {
      await admin.createTopics({
        topics: [{ topic: t, numPartitions: 3, replicationFactor: 1 }],
      });
    }
  }
}

module.exports = { getKafka, getProducer, publish, createConsumer, ensureTopics };
