const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { initTracing, runWithSpan } = require('../../shared/tracing');
const logger = require('../../shared/logger');
const { fetchRecommendations } = require('../../shared/services');

process.env.SERVICE_NAME = 'learning-api-gateway';
initTracing('learning-api-gateway');

const PORT = Number(process.env.PORT || 8080);
const JWT_SECRET = process.env.JWT_SECRET || 'learning-secret-change-me';
const COURSE_URL = process.env.COURSE_SERVICE_URL || 'http://course-service:3001';
const PROGRESS_HOST = process.env.PROGRESS_GRPC_HOST || 'progress-service';
const PROGRESS_PORT = process.env.PROGRESS_GRPC_PORT || '50051';

const packageDef = protoLoader.loadSync(
  path.join(__dirname, '../proto/progress.proto'),
  { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true }
);
const proto = grpc.loadPackageDefinition(packageDef).progress;

function getProgressClient() {
  return new proto.ProgressService(
    `${PROGRESS_HOST}:${PROGRESS_PORT}`,
    grpc.credentials.createInsecure()
  );
}

function grpcCall(method, payload) {
  const client = getProgressClient();
  return new Promise((resolve, reject) => {
    client[method](payload, (err, res) => (err ? reject(err) : resolve(res)));
  });
}

const app = express();
app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  req.requestId = req.headers['x-request-id'] || uuidv4();
  res.setHeader('X-Request-ID', req.requestId);
  if (req.headers.traceparent) res.setHeader('traceparent', req.headers.traceparent);
  process.env.CORRELATION_ID = req.requestId;
  next();
});

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 50,
  keyGenerator: (req) => req.studentId || req.ip,
  message: { error: 'Rate limit exceeded: 50 req/min per student' },
});
app.use(limiter);

function authMiddleware(req, res, next) {
  if (req.path === '/health' || req.path === '/auth/token' || req.path.startsWith('/dashboard')) {
    return next();
  }
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'JWT required' });
  }
  try {
    const token = header.slice(7);
    const decoded = jwt.verify(token, JWT_SECRET);
    req.studentId = decoded.sub || decoded.student_id;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

app.use(authMiddleware);

app.get('/health', (_, res) => res.json({ status: 'ok', service: 'learning-api-gateway' }));

app.post('/auth/token', (req, res) => {
  const studentId = req.body.student_id || 'student-1';
  const token = jwt.sign({ sub: studentId, student_id: studentId }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, student_id: studentId });
});

function courseServicePath(mountUrl) {
  const rest = mountUrl === '/' || mountUrl === '' ? '' : mountUrl;
  return `/courses${rest}`;
}

app.use('/api/courses', async (req, res) => {
  try {
    const url = `${COURSE_URL}${courseServicePath(req.url)}`;
    const { data, status } = await axios({
      method: req.method,
      url,
      data: req.body,
      headers: { 'x-student-id': req.studentId },
      validateStatus: () => true,
    });
    res.status(status).json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.post('/api/progress/watch', async (req, res) => {
  try {
    const result = await runWithSpan('gateway-mark-watched', () =>
      grpcCall('MarkLessonWatched', {
        student_id: req.studentId,
        course_id: req.body.course_id,
        lesson_id: req.body.lesson_id,
        watch_seconds: req.body.watch_seconds || 120,
      })
    );
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/progress/:courseId', async (req, res) => {
  try {
    const result = await grpcCall('GetCourseProgress', {
      student_id: req.studentId,
      course_id: req.params.courseId,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/progress/stats', async (req, res) => {
  try {
    const result = await grpcCall('GetStudentStats', { student_id: req.studentId });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/recommendations', async (req, res) => {
  try {
    const { data, instance } = await fetchRecommendations(req.studentId);
    res.json({
      ...data,
      load_balanced_from: instance ? instance.id || instance.address : null,
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/dashboard/student/:id', async (req, res) => {
  const studentId = req.params.id;
  try {
    const [coursesRes, progressRes, recRes, statsRes] = await Promise.all([
      axios.get(`${COURSE_URL}/courses`).catch(() => ({ data: [] })),
      grpcCall('GetCourseProgress', { student_id: studentId, course_id: 'c1' }).catch(() => null),
      fetchRecommendations(studentId).then(({ data }) => data),
      grpcCall('GetStudentStats', { student_id: studentId }).catch(() => ({})),
    ]);

    const currentCourse = coursesRes.data[0] || null;
    res.json({
      student_id: studentId,
      current_course: currentCourse,
      completion_percent: progressRes?.completion_percent ?? 0,
      watched_lessons: progressRes?.watched_lesson_ids ?? [],
      recommendations: recRes?.recommendations ?? [],
      dropout_risk_score: recRes?.dropout_risk?.risk_score ?? 0.1,
      stats: statsRes,
      request_id: req.requestId,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use('/dashboard', express.static(path.join(__dirname, '../dashboard')));

app.listen(PORT, () => logger.info(`Learning API Gateway on ${PORT}`));
