function output(data) {
  document.getElementById('out').textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
}

async function callApi(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const body = await res.json().catch(() => ({}));
  output({ status: res.status, body });
}

function values() {
  return {
    userId: document.getElementById('userId') ? document.getElementById('userId').value.trim() : '',
    username: document.getElementById('username') ? document.getElementById('username').value.trim() : '',
    setScore: Number(document.getElementById('setScore').value),
    delta: Number(document.getElementById('delta').value),
    top: Number(document.getElementById('top').value),
    page: Number(document.getElementById('page').value),
    limit: Number(document.getElementById('limit').value)
  };
}

function getQueueValues() {
  return {
    userId: document.getElementById('queueUserId').value.trim(),
    achievement: document.getElementById('achievement').value.trim(),
    metadata: parseJson(document.getElementById('metadata').value, { from: 'ui' })
  };
}

function getTxValues() {
  return {
    userId: document.getElementById('tx-userId').value.trim(),
    username: document.getElementById('tx-username').value.trim(),
    initialScore: Number(document.getElementById('tx-initialScore').value),
    forceError: document.getElementById('tx-forceError').checked
  };
}

function parseJson(str, fallback) {
  try {
    return JSON.parse(str);
  } catch (_) {
    return fallback;
  }
}

document.getElementById('btn-post-scores').addEventListener('click', () => {
  const v = values();
  callApi('/api/scores', {
    method: 'POST',
    body: JSON.stringify({ userId: v.userId, username: v.username, score: v.setScore })
  });
});

document.getElementById('btn-post-increment').addEventListener('click', () => {
  const v = values();
  callApi('/api/scores/increment', {
    method: 'POST',
    body: JSON.stringify({ userId: v.userId, delta: v.delta })
  });
});

document.getElementById('btn-get-player').addEventListener('click', () => {
  const v = values();
  callApi(`/api/leaderboard/player/${encodeURIComponent(v.userId)}`);
});

document.getElementById('btn-get-leaderboard').addEventListener('click', () => {
  const v = values();
  const qs = new URLSearchParams();
  if (Number.isFinite(v.top)) qs.set('top', String(v.top));
  if (Number.isFinite(v.page)) qs.set('page', String(v.page));
  if (Number.isFinite(v.limit)) qs.set('limit', String(v.limit));
  callApi(`/api/leaderboard?${qs.toString()}`);
});

document.getElementById('btn-weekly').addEventListener('click', () => {
  callApi('/api/leaderboard/weekly');
});

document.getElementById('btn-delete-player').addEventListener('click', async () => {
  const v = values();
  await callApi(`/api/leaderboard/player/${encodeURIComponent(v.userId)}`, { method: 'DELETE' });
});

document.getElementById('btn-enqueue').addEventListener('click', () => {
  const v = getQueueValues();
  callApi('/api/achievements/enqueue', {
    method: 'POST',
    body: JSON.stringify({ userId: v.userId, achievement: v.achievement, metadata: v.metadata })
  });
});

document.getElementById('btn-queue-stats').addEventListener('click', () => {
  callApi('/api/achievements/stats');
});

document.getElementById('btn-events').addEventListener('click', () => {
  const userId = document.getElementById('events-user').value.trim();
  const event = document.getElementById('events-type').value.trim();
  const from = document.getElementById('events-from').value.trim() || '-';
  const limit = document.getElementById('events-limit').value.trim() || '20';
  const qs = new URLSearchParams();
  if (userId) qs.set('userId', userId);
  if (event) qs.set('event', event);
  qs.set('from', from);
  qs.set('limit', limit);
  callApi(`/api/events?${qs.toString()}`);
});

document.getElementById('btn-summary').addEventListener('click', () => {
  callApi('/api/stats/summary');
});

document.getElementById('btn-tx-register').addEventListener('click', () => {
  const v = getTxValues();
  callApi('/api/players/register', {
    method: 'POST',
    body: JSON.stringify({ userId: v.userId, username: v.username, initialScore: v.initialScore, forceError: v.forceError })
  });
});
