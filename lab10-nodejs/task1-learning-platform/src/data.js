export const courses = [
  { course_id: 'js-basic', title: 'JavaScript Basic', category: 'programming', lessons_count: 5, difficulty: 'beginner' },
  { course_id: 'node-ms', title: 'Node.js Microservices', category: 'backend', lessons_count: 6, difficulty: 'intermediate' },
  { course_id: 'kafka', title: 'Kafka for Developers', category: 'backend', lessons_count: 4, difficulty: 'intermediate' },
];
export const lessons = {
  'js-basic': ['intro', 'variables', 'functions', 'arrays', 'async'],
  'node-ms': ['express', 'grpc', 'gateway', 'tracing', 'discovery', 'deploy'],
  kafka: ['topics', 'producers', 'consumers', 'replay'],
};
export const progress = new Map();
export const recommendations = new Map();
