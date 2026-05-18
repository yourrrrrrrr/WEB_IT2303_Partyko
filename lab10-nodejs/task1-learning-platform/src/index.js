import express from 'express';
import morgan from 'morgan';
import { randomUUID } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { bus } from './bus.js';
import { courses, lessons, progress, recommendations } from './data.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, '..', 'public');

const ports = { course: 3101, progress: 3102, recommendation: 3103, gateway: 3100 };
const auth = (req, res, next) => {
  req.traceId = req.headers.traceparent || req.headers['x-request-id'] || randomUUID();
  res.setHeader('X-Request-ID', req.traceId);
  if (!req.headers.authorization) return res.status(401).json({ error: 'JWT token required: Authorization: Bearer demo' });
  next();
};

const rateState = new Map();
const rateLimit = (limit) => (req, res, next) => {
  const id = req.headers['x-student-id'] || 'anonymous';
  const now = Date.now(); const bucket = rateState.get(id) || [];
  const fresh = bucket.filter(t => now - t < 60_000); fresh.push(now); rateState.set(id, fresh);
  if (fresh.length > limit) return res.status(429).json({ error: `rate limit ${limit} req/min per student` });
  next();
};

function startCourseService() {
  const app = express(); app.use(express.json(), morgan('dev'));
  app.get('/courses', (_, res) => res.json(courses));
  app.get('/courses/:id', (req, res) => res.json(courses.find(c => c.course_id === req.params.id) || null));
  app.get('/courses/:id/lessons', (req, res) => res.json({ course_id: req.params.id, lessons: lessons[req.params.id] || [] }));
  app.post('/courses/:id/enroll', (req, res) => res.status(201).json({ enrolled: true, course_id: req.params.id, student_id: req.body.student_id }));
  app.get('/health', (_, res) => res.json({ service: 'course', status: 'UP' }));
  app.listen(ports.course, () => console.log(`Course Service :${ports.course}`));
}

function startProgressService() {
  const app = express(); app.use(express.json(), morgan('dev'));
  app.post('/grpc/MarkLessonWatched', (req, res) => {
    const { student_id, course_id, lesson_id, watch_time = 0 } = req.body;
    const key = `${student_id}:${course_id}`; const item = progress.get(key) || { watched: new Set(), total_watch_time: 0, last_activity: null, streak_days: 1 };
    item.watched.add(lesson_id); item.total_watch_time += watch_time; item.last_activity = new Date().toISOString(); progress.set(key, item);
    const percent = Math.round((item.watched.size / (lessons[course_id]?.length || 1)) * 100);
    bus.publish('learning-events', { type: 'lesson.watched', student_id, course_id, lesson_id, percent }, { traceparent: req.headers.traceparent, correlation_id: req.headers['x-request-id'] });
    if (percent >= 100) bus.publish('learning-events', { type: 'course.completed', student_id, course_id }, { traceparent: req.headers.traceparent });
    res.json({ student_id, course_id, percent, watched_lessons: [...item.watched], total_watch_time: item.total_watch_time, streak_days: item.streak_days, last_activity: item.last_activity });
  });
  app.get('/grpc/GetCourseProgress', (req, res) => {
    const { student_id, course_id } = req.query; const item = progress.get(`${student_id}:${course_id}`) || { watched: new Set(), total_watch_time: 0 };
    res.json({ student_id, course_id, percent: Math.round((item.watched.size / (lessons[course_id]?.length || 1)) * 100), watched_lessons: [...item.watched] });
  });
  app.get('/grpc/GetStudentStats', (req, res) => {
    const rows = [...progress.entries()].filter(([k]) => k.startsWith(`${req.query.student_id}:`));
    res.json({ student_id: req.query.student_id, courses_started: rows.length, total_watch_time: rows.reduce((s, [, v]) => s + v.total_watch_time, 0) });
  });
  app.get('/health', (_, res) => res.json({ service: 'progress-grpc-adapter', status: 'UP' }));
  app.listen(ports.progress, () => console.log(`Progress Service :${ports.progress}`));
}

const courseViews = new Map(courses.map(c => [c.course_id, 0]));

function getNextCourse(currentCourseId) {
  const current = courses.find(c => c.course_id === currentCourseId);
  if (!current) return courses[0];
  return courses.find(c => c.category === current.category && c.course_id !== current.course_id)
    || courses.find(c => c.course_id !== current.course_id)
    || current;
}

function buildRecommendationState(studentId, extra = {}) {
  const rows = [...progress.entries()].filter(([key]) => key.startsWith(`${studentId}:`));
  const studentProgress = rows.map(([key, value]) => {
    const courseId = key.split(':')[1];
    const totalLessons = lessons[courseId]?.length || 1;
    return {
      course_id: courseId,
      watched_lessons: [...value.watched],
      percent: Math.round((value.watched.size / totalLessons) * 100),
      total_watch_time: value.total_watch_time || 0,
      last_activity: value.last_activity || null
    };
  });

  const lastCourse = extra.course_id || studentProgress.at(-1)?.course_id || null;
  const nextCourse = getNextCourse(lastCourse);

  const reviewTopics = studentProgress.flatMap(item => {
    const courseLessons = lessons[item.course_id] || [];
    return courseLessons
      .filter(lesson => !item.watched_lessons.includes(lesson))
      .slice(0, 2)
      .map(lesson => ({
        course_id: item.course_id,
        lesson_id: lesson,
        reason: 'Тема ещё не пройдена, рекомендуется повторить/изучить'
      }));
  });

  const inactiveEvent = extra.event_type === 'student.inactive';
  const lowProgress = studentProgress.some(item => item.percent < 30 && item.total_watch_time < 300);
  const score = inactiveEvent ? 0.9 : lowProgress ? 0.65 : 0.15;

  const mostPopularCourses = [...courseViews.entries()]
    .map(([course_id, watched_events]) => ({
      course_id,
      title: courses.find(c => c.course_id === course_id)?.title || course_id,
      watched_events
    }))
    .sort((a, b) => b.watched_events - a.watched_events);

  return {
    source: 'Recommendation Service / Kafka consumer',
    consumed_topic: 'learning-events',
    handled_events: ['lesson.watched', 'course.completed', 'student.inactive'],
    next_course: {
      course_id: nextCourse.course_id,
      title: nextCourse.title,
      reason: lastCourse
        ? `После ${lastCourse} рекомендуется следующий курс: ${nextCourse.title}`
        : `Начните с курса ${nextCourse.title}`
    },
    review_topics: reviewTopics.length ? reviewTopics : [{
      course_id: lastCourse || courses[0].course_id,
      lesson_id: extra.lesson_id || 'intro',
      reason: 'Недостаточно данных, базовая рекомендация для повторения'
    }],
    dropout_risk: {
      score,
      level: score >= 0.75 ? 'high' : score >= 0.5 ? 'medium' : 'low',
      reason: inactiveEvent
        ? 'Получено событие student.inactive'
        : lowProgress
          ? 'Низкий прогресс и мало времени просмотра'
          : 'Активность нормальная'
    },
    most_popular_courses: mostPopularCourses
  };
}

function startRecommendationService(instance = 'rec-1') {
  bus.subscribe('learning-events', 'recommendation-group', record => {
    const e = record.event;

    if (e.type === 'lesson.watched') {
      courseViews.set(e.course_id, (courseViews.get(e.course_id) || 0) + 1);
    }

    recommendations.set(e.student_id, buildRecommendationState(e.student_id, {
      course_id: e.course_id,
      lesson_id: e.lesson_id,
      event_type: e.type
    }));

    console.log(JSON.stringify({
      service: instance,
      topic: 'learning-events',
      consumed: e.type,
      trace: record.headers.traceparent
    }));
  }, 'earliest');

  const app = express();
  app.get('/recommendations/:studentId', (req, res) => res.json({
    instance,
    student_id: req.params.studentId,
    recommendations: recommendations.get(req.params.studentId) || buildRecommendationState(req.params.studentId)
  }));
  app.get('/popular', (_, res) => res.json(buildRecommendationState('system').most_popular_courses));
  app.get('/health', (_, res) => res.json({ service: instance, status: 'UP' }));
  app.listen(ports.recommendation, () => console.log(`Recommendation Service :${ports.recommendation}`));
}

function startGateway() {
  const app = express();

  app.use(express.static(publicDir));

  app.get('/', (_, res) => res.redirect('/index.html'));

  app.get('/dashboard/student/:id', (req, res) => {
    const rows = [...progress.entries()].filter(([k]) => k.startsWith(`${req.params.id}:`));
    const rec = recommendations.get(req.params.id) || buildRecommendationState(req.params.id);
    res.send(`<h1>Student dashboard</h1><pre>${JSON.stringify({
      current_course: rows[0]?.[0]?.split(':')[1] || null,
      progress: rows.map(([k, v]) => ({ course: k.split(':')[1], watched: [...v.watched] })),
      recommendations: rec,
      dropout_risk: rec.dropout_risk
    }, null, 2)}</pre>`);
  });

  app.use(express.json(), morgan('dev'));

  app.use('/api', rateLimit(50), auth);
  app.get('/api/courses', (_, res) => res.json(courses));
  app.get('/api/courses/:id/lessons', (req, res) => res.json({ course_id: req.params.id, lessons: lessons[req.params.id] || [] }));
  app.post('/api/courses/:id/enroll', (req, res) => res.status(201).json({ enrolled: true, course_id: req.params.id, student_id: req.body.student_id }));

  app.post('/api/progress/watch', (req, res) => {
    req.headers.traceparent = req.traceId;
    const fakeReq = {
      body: req.body,
      headers: req.headers
    };
    const { student_id, course_id, lesson_id, watch_time = 0 } = fakeReq.body;
    const key = `${student_id}:${course_id}`;
    const item = progress.get(key) || { watched: new Set(), total_watch_time: 0, streak_days: 1 };
    item.watched.add(lesson_id); item.total_watch_time += watch_time; item.last_activity = new Date().toISOString();
    progress.set(key, item);
    const percent = Math.round((item.watched.size / (lessons[course_id]?.length || 1)) * 100);
    bus.publish('learning-events', { type: 'lesson.watched', student_id, course_id, lesson_id, percent }, { traceparent: req.traceId, correlation_id: req.traceId, partition_key: student_id });
    if (percent >= 100) {
      bus.publish('learning-events', { type: 'course.completed', student_id, course_id }, { traceparent: req.traceId, correlation_id: req.traceId, partition_key: student_id });
    }
    res.json({ percent, watched_lessons: [...item.watched], grpc: 'MarkLessonWatched simulated' });
  });

  app.post('/api/students/:studentId/inactive', (req, res) => {
    bus.publish('learning-events', {
      type: 'student.inactive',
      student_id: req.params.studentId
    }, {
      traceparent: req.traceId,
      correlation_id: req.traceId,
      partition_key: req.params.studentId
    });
    res.json({
      event: 'student.inactive',
      student_id: req.params.studentId,
      published_to: 'learning-events'
    });
  });

  app.get('/api/recommendations/:studentId', (req, res) => res.json({
    recommendations: recommendations.get(req.params.studentId) || buildRecommendationState(req.params.studentId)
  }));

  app.get('/api/recommendations/popular/courses', (_, res) => res.json({
    most_popular_courses: buildRecommendationState('system').most_popular_courses
  }));
  app.get('/system/health', (_, res) => res.json({
    gateway: 'UP',
    course: 'UP',
    progress: 'UP',
    recommendation: 'UP',
    discovery: '2 recommendation instances balanced demo'
  }));

  app.listen(ports.gateway, () => console.log(`API Gateway :${ports.gateway}`));
}

startCourseService(); 
startProgressService(); 
startRecommendationService(); 
startGateway();
