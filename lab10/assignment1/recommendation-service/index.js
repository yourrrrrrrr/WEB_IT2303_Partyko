const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const { initTracing, runWithSpan } = require('../../shared/tracing');
const logger = require('../../shared/logger');
const { createConsumer, getKafka, ensureTopics } = require('../../shared/kafka');

process.env.SERVICE_NAME = process.env.SERVICE_NAME || 'recommendation-service';
initTracing(process.env.SERVICE_NAME);

const PORT = Number(process.env.PORT || 3003);
const HOST = process.env.HOST || '0.0.0.0';
const INSTANCE_ID = process.env.INSTANCE_ID || uuidv4().slice(0, 8);

const store = {
  recommendations: new Map(),
  popular: new Map(),
  dropoutRisk: new Map(),
};

const nextCourse = {
  c1: 'c2',
  c2: 'c3',
  c3: 'c1',
};

function ensureStudent(studentId) {
  if (!store.recommendations.has(studentId)) {
    store.recommendations.set(studentId, []);
  }
  return store.recommendations.get(studentId);
}

async function handleEvent({ value }) {
  await runWithSpan('process-learning-event', async () => {
    const { type, student_id, course_id, completion_percent } = value;
    const recs = ensureStudent(student_id);

    if (type === 'lesson.watched') {
      const popular = store.popular.get(course_id) || 0;
      store.popular.set(course_id, popular + 1);
      const next = nextCourse[course_id];
      if (next) {
        recs.push({
          kind: 'next_course',
          course_id: next,
          reason: 'Based on your progress',
          instance: INSTANCE_ID,
        });
      }
      if (completion_percent < 30) {
        recs.push({
          kind: 'repeat_topic',
          course_id,
          reason: 'Low completion — review basics',
          instance: INSTANCE_ID,
        });
      }
    }

    if (type === 'course.completed') {
      const next = nextCourse[course_id];
      if (next) {
        recs.push({
          kind: 'next_course',
          course_id: next,
          reason: 'Course completed — continue learning',
          instance: INSTANCE_ID,
        });
      }
    }

    if (type === 'student.inactive') {
      store.dropoutRisk.set(student_id, {
        risk_score: value.risk_score || 0.75,
        reason: 'No activity detected',
        updated_at: new Date().toISOString(),
      });
    }

    store.recommendations.set(student_id, recs.slice(-10));
    logger.info('Recommendation updated', { student_id, type, instance: INSTANCE_ID });
  });
}

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_, res) =>
  res.json({ status: 'ok', service: 'recommendation-service', instance: INSTANCE_ID })
);

app.get('/recommendations/:studentId', (req, res) => {
  const studentId = req.params.studentId;
  res.json({
    student_id: studentId,
    recommendations: store.recommendations.get(studentId) || [],
    dropout_risk: store.dropoutRisk.get(studentId) || { risk_score: 0.1 },
    popular_courses: [...store.popular.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([course_id, views]) => ({ course_id, views })),
    served_by: INSTANCE_ID,
  });
});

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function start() {
  const topics = ['learning-events', 'learning-events-dlq'];
  for (let attempt = 1; attempt <= 30; attempt++) {
    try {
      const admin = getKafka().admin();
      await admin.connect();
      await ensureTopics(admin, topics);
      await admin.disconnect();
      break;
    } catch (err) {
      logger.warn('Kafka not ready for recommendation', { attempt, error: err.message });
      if (attempt === 30) throw err;
      await sleep(2000);
    }
  }

  const groupId = `recommendation-${process.env.CONSUMER_GROUP_SUFFIX || 'default'}`;
  await createConsumer(groupId, ['learning-events'], handleEvent, {
    fromBeginning: process.env.KAFKA_FROM_BEGINNING === 'true',
  });

  app.listen(PORT, HOST, () => {
    logger.info(`Recommendation service ${INSTANCE_ID} on ${PORT}`);
  });
}

start().catch((err) => {
  logger.error('Recommendation start failed', { error: err.message });
  process.exit(1);
});

module.exports = { store, handleEvent };
