let source = null;

function show(elId, data) {
  document.getElementById(elId).textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
}

async function request(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

function extractRateHeaders(res) {
  return {
    limit: res.headers.get('X-RateLimit-Limit'),
    remaining: res.headers.get('X-RateLimit-Remaining'),
    reset: res.headers.get('X-RateLimit-Reset')
  };
}

document.getElementById('btn-login-rl').addEventListener('click', async () => {
  const { res, body } = await request('/api/login', { method: 'POST' });
  show('rate-out', { status: res.status, headers: extractRateHeaders(res), body });
});

document.getElementById('btn-register-rl').addEventListener('click', async () => {
  const { res, body } = await request('/api/register', { method: 'POST' });
  show('rate-out', { status: res.status, headers: extractRateHeaders(res), body });
});

document.getElementById('btn-search-rl').addEventListener('click', async () => {
  const { res, body } = await request('/api/search?q=redis');
  show('rate-out', { status: res.status, headers: extractRateHeaders(res), body });
});

document.getElementById('btn-connect-sse').addEventListener('click', () => {
  const userId = document.getElementById('sse-user-id').value.trim() || 'u-1';
  if (source) source.close();
  source = new EventSource(`/api/notifications/stream/${encodeURIComponent(userId)}`);

  source.addEventListener('notification', (event) => {
    const prev = document.getElementById('sse-out').textContent;
    document.getElementById('sse-out').textContent = `${event.data}\n${prev}`.slice(0, 8000);
  });
  source.addEventListener('connected', (event) => {
    show('sse-out', `Подключено: ${event.data}`);
  });
  source.onerror = () => {
    const prev = document.getElementById('sse-out').textContent;
    document.getElementById('sse-out').textContent = `Ошибка SSE/переподключение...\n${prev}`.slice(0, 8000);
  };
});

document.getElementById('btn-disconnect-sse').addEventListener('click', () => {
  if (source) source.close();
  source = null;
  show('sse-out', 'Поток отключен');
});

document.getElementById('btn-send').addEventListener('click', async () => {
  const message = document.getElementById('notif-message').value.trim();
  const type = document.getElementById('notif-type').value.trim() || 'info';
  const userId = document.getElementById('notif-user-id').value.trim();
  const payload = userId ? { userId, message, type } : { message, type };
  const { res, body } = await request('/api/notifications/send', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  show('sse-out', { status: res.status, body });
});

document.getElementById('btn-broadcast').addEventListener('click', async () => {
  const message = document.getElementById('notif-message').value.trim();
  const { res, body } = await request('/api/notifications/broadcast', {
    method: 'POST',
    body: JSON.stringify({ message })
  });
  show('sse-out', { status: res.status, body });
});

document.getElementById('btn-auth-login').addEventListener('click', async () => {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const { res, body } = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });
  show('auth-out', { status: res.status, body });
});

document.getElementById('btn-auth-me').addEventListener('click', async () => {
  const { res, body } = await request('/api/auth/me');
  show('auth-out', { status: res.status, body });
});

document.getElementById('btn-auth-sessions').addEventListener('click', async () => {
  const { res, body } = await request('/api/auth/sessions');
  show('auth-out', { status: res.status, body });
});

document.getElementById('btn-auth-logout').addEventListener('click', async () => {
  const { res, body } = await request('/api/auth/logout', { method: 'POST' });
  show('auth-out', { status: res.status, body });
});
