const express = require('express');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { initTracing, runWithSpan } = require('../../shared/tracing');
const logger = require('../../shared/logger');
const { publish } = require('../../shared/kafka');

process.env.SERVICE_NAME = 'progress-service';
initTracing('progress-service');

const PORT = process.env.GRPC_PORT || '50051';
const HEALTH_PORT = Number(process.env.HEALTH_PORT || 50052);
const HOST = process.env.HOST || '0.0.0.0';

const courseLessons = {
  c1: 5,
  c2: 4,
  c3: 6,
};

const progressStore = new Map();
const statsStore = new Map();

function key(studentId, courseId) {
  return `${studentId}:${courseId}`;
}

function getProgress(studentId, courseId) {
  const k = key(studentId, courseId);
  if (!progressStore.has(k)) {
    progressStore.set(k, { watched: new Set(), watchSeconds: 0 });
  }
  return progressStore.get(k);
}

function updateStreak(studentId) {
  const today = new Date().toISOString().slice(0, 10);
  let stats = statsStore.get(studentId);
  if (!stats) {
    stats = { streak_days: 1, last_day: today, total_watch_seconds: 0, last_activity: new Date().toISOString(), courses: new Set() };
    statsStore.set(studentId, stats);
    return stats;
  }
  if (stats.last_day !== today) {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    stats.streak_days = stats.last_day === yesterday ? stats.streak_days + 1 : 1;
    stats.last_day = today;
  }
  stats.last_activity = new Date().toISOString();
  return stats;
}

async function emitEvent(type, payload) {
  await publish('learning-events', payload.student_id, {
    type,
    timestamp: new Date().toISOString(),
    ...payload,
  });
}

const packageDef = protoLoader.loadSync(
  path.join(__dirname, '../proto/progress.proto'),
  { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true }
);
const proto = grpc.loadPackageDefinition(packageDef).progress;

const handlers = {
  MarkLessonWatched: async (call, callback) => {
    try {
      await runWithSpan('MarkLessonWatched', async () => {
        const { student_id, course_id, lesson_id, watch_seconds } = call.request;
        const total = courseLessons[course_id] || 5;
        const prog = getProgress(student_id, course_id);
        prog.watched.add(lesson_id);
        prog.watchSeconds += watch_seconds || 60;

        const stats = updateStreak(student_id);
        stats.total_watch_seconds += watch_seconds || 60;
        stats.courses.add(course_id);

        const completion = (prog.watched.size / total) * 100;

        await emitEvent('lesson.watched', {
          student_id,
          course_id,
          lesson_id,
          completion_percent: completion,
          watch_seconds: watch_seconds || 60,
        });

        if (prog.watched.size >= total) {
          await emitEvent('course.completed', {
            student_id,
            course_id,
            completion_percent: 100,
          });
        }

        logger.info('Lesson watched', { student_id, course_id, lesson_id });

        callback(null, {
          student_id,
          course_id,
          lessons_watched: prog.watched.size,
          total_lessons: total,
          completion_percent: completion,
          watched_lesson_ids: [...prog.watched],
        });
      });
    } catch (err) {
      callback({ code: grpc.status.INTERNAL, message: err.message });
    }
  },

  GetCourseProgress: (call, callback) => {
    const { student_id, course_id } = call.request;
    const total = courseLessons[course_id] || 5;
    const prog = getProgress(student_id, course_id);
    callback(null, {
      student_id,
      course_id,
      lessons_watched: prog.watched.size,
      total_lessons: total,
      completion_percent: (prog.watched.size / total) * 100,
      watched_lesson_ids: [...prog.watched],
    });
  },

  GetStudentStats: (call, callback) => {
    const { student_id } = call.request;
    const stats = statsStore.get(student_id) || {
      streak_days: 0,
      last_activity: null,
      total_watch_seconds: 0,
      courses: new Set(),
    };
    callback(null, {
      student_id,
      streak_days: stats.streak_days || 0,
      last_activity: stats.last_activity || '',
      total_watch_seconds: stats.total_watch_seconds || 0,
      courses_in_progress: stats.courses ? stats.courses.size : 0,
    });
  },
};

const healthApp = express();
healthApp.get('/health', (_, res) => res.json({ status: 'ok', service: 'progress-service' }));
healthApp.listen(HEALTH_PORT, HOST);

const server = new grpc.Server();
server.addService(proto.ProgressService.service, handlers);
server.bindAsync(`${HOST}:${PORT}`, grpc.ServerCredentials.createInsecure(), async (err) => {
  if (err) throw err;
  server.start();
  logger.info(`Progress gRPC on ${PORT}`);
});

module.exports = { progressStore, statsStore, courseLessons };
