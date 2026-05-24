const express = require('express');
const cors = require('cors');
const path = require('path');
const { initTracing } = require('../../shared/tracing');
const logger = require('../../shared/logger');
const { publish } = require('../../shared/kafka');

process.env.SERVICE_NAME = 'course-service';
initTracing('course-service');

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '0.0.0.0';

const courses = [
  { course_id: 'c1', title: 'Node.js Basics', category: 'backend', lessons_count: 5, difficulty: 'beginner' },
  { course_id: 'c2', title: 'Kafka Streams', category: 'data', lessons_count: 4, difficulty: 'intermediate' },
  { course_id: 'c3', title: 'gRPC Microservices', category: 'architecture', lessons_count: 6, difficulty: 'advanced' },
];

const lessons = {
  c1: ['l1-1', 'l1-2', 'l1-3', 'l1-4', 'l1-5'],
  c2: ['l2-1', 'l2-2', 'l2-3', 'l2-4'],
  c3: ['l3-1', 'l3-2', 'l3-3', 'l3-4', 'l3-5', 'l3-6'],
};

const enrollments = new Map();

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_, res) => res.json({ status: 'ok', service: 'course-service' }));

app.get('/courses', (_, res) => {
  res.json(courses);
});

app.get('/courses/:id', (req, res) => {
  const course = courses.find((c) => c.course_id === req.params.id);
  if (!course) return res.status(404).json({ error: 'Course not found' });
  res.json(course);
});

app.get('/courses/:id/lessons', (req, res) => {
  const list = lessons[req.params.id];
  if (!list) return res.status(404).json({ error: 'Course not found' });
  res.json(list.map((id, i) => ({ lesson_id: id, order: i + 1, title: `Lesson ${i + 1}` })));
});

app.post('/courses/:id/enroll', async (req, res) => {
  const course = courses.find((c) => c.course_id === req.params.id);
  if (!course) return res.status(404).json({ error: 'Course not found' });
  const studentId = req.body.student_id || req.headers['x-student-id'];
  if (!studentId) return res.status(400).json({ error: 'student_id required' });
  const key = `${studentId}:${course.course_id}`;
  enrollments.set(key, { student_id: studentId, course_id: course.course_id, enrolled_at: new Date().toISOString() });
  logger.info('Student enrolled', { studentId, courseId: course.course_id });
  res.status(201).json({ enrolled: true, course_id: course.course_id, student_id: studentId });
});

app.listen(PORT, HOST, () => {
  logger.info(`Course service on ${PORT}`);
});

module.exports = { courses, lessons };
