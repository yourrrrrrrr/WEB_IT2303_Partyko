const { describe, it } = require('node:test');
const assert = require('node:assert');
const axios = require('axios');

const GW = process.env.LEARNING_GATEWAY_URL || 'http://localhost:8080';

describe('Learning Platform', () => {
  it('lesson watch updates progress and recommendations flow', async () => {
    const { data: auth } = await axios.post(`${GW}/auth/token`, { student_id: 'test-student' });
    const headers = { Authorization: `Bearer ${auth.token}`, 'X-Request-ID': 'test-1' };

    await axios.post(
      `${GW}/api/progress/watch`,
      { course_id: 'c1', lesson_id: 'l1-1', watch_seconds: 200 },
      { headers }
    );

    await new Promise((r) => setTimeout(r, 2500));

    const progress = await axios.get(`${GW}/api/progress/c1`, { headers });
    assert.ok(progress.data.lessons_watched >= 1);

    const recs = await axios.get(`${GW}/api/recommendations`, { headers });
    assert.ok(Array.isArray(recs.data.recommendations));
  });

  it('dashboard aggregates student data', async () => {
    const { data } = await axios.get(`${GW}/dashboard/student/test-student`);
    assert.ok('completion_percent' in data);
    assert.ok('dropout_risk_score' in data);
  });
});
