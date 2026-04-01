// Фронтенд Lab5 — открывать http://localhost:3000/ (фронт с того же сервера)

const API_BASE = '';
let accessToken = null;
let currentUser = null;

function getCsrfToken() {
  const m = document.cookie.match(/csrf-token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

function authFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const csrf = getCsrfToken();
  if (csrf) headers['X-CSRF-Token'] = csrf;
  return fetch(API_BASE + path, { ...options, credentials: 'include', headers });
}

function showMessage(type, text) {
  const err = document.getElementById('msg-error');
  const ok = document.getElementById('msg-success');
  err.classList.add('hidden');
  ok.classList.add('hidden');
  if (!text) return;
  const el = type === 'error' ? err : ok;
  el.textContent = text;
  el.classList.remove('hidden');
}

async function refreshAccessToken() {
  try {
    const res = await authFetch('/auth/refresh', { method: 'POST' });
    if (!res.ok) return false;
    const data = await res.json();
    accessToken = data.accessToken || null;
    return !!accessToken;
  } catch {
    return false;
  }
}

async function apiFetch(path, options = {}, retry = true) {
  const opts = { ...options, credentials: 'include' };
  opts.headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (accessToken) opts.headers['Authorization'] = `Bearer ${accessToken}`;
  const res = await fetch(`${API_BASE}${path}`, opts);
  if (res.status === 401 && retry) {
    let body = {};
    try { body = await res.json(); } catch (_) {}
    if (body.code === 'TOKEN_EXPIRED') {
      if (await refreshAccessToken()) return apiFetch(path, options, false);
    }
  }
  return res;
}

function renderMe(data) {
  document.getElementById('me-info').textContent = typeof data === 'object' ? JSON.stringify(data, null, 2) : data;
  if (data && data.user) {
    currentUser = { id: data.user.id, role: data.user.role, permissions: data.permissions || [] };
    const adminSection = document.getElementById('admin-section');
    if (adminSection) adminSection.style.display = currentUser.permissions.includes('users:manage') ? 'block' : 'none';
    if (adminSection && currentUser.permissions.includes('users:manage')) loadUsers();
  } else {
    currentUser = null;
    const adminSection = document.getElementById('admin-section');
    if (adminSection) adminSection.style.display = 'none';
  }
}

function renderArticles(data) {
  const container = document.getElementById('articles-list');
  container.innerHTML = '';
  if (!data || !data.articles || data.articles.length === 0) {
    container.innerHTML = '<p class="hint">Статей пока нет. Создайте статью (нужна роль author или выше).</p>';
    return;
  }
  const canPublish = currentUser && (currentUser.permissions || []).includes('articles:publish');
  data.articles.forEach(function (a) {
    const div = document.createElement('div');
    div.className = 'article-item';
    const isDraft = (a.status || 'draft') === 'draft';
    const notOwn = !currentUser || a.authorId !== currentUser.id;
    const showPublish = isDraft && canPublish && notOwn;
    let actions = '';
    if (showPublish) actions = '<button type="button" class="btn-publish" data-id="' + escapeHtml(a.id) + '">Опубликовать</button>';
    div.innerHTML =
      '<div class="article-title">' + escapeHtml(a.title) + ' <span class="badge status-' + (a.status || 'draft') + '">' + (a.status || 'draft') + '</span></div>' +
      '<div class="article-meta">ID: ' + escapeHtml(a.id) + ' · Автор: ' + escapeHtml(a.authorId) + ' · ' + (a.createdAt || '') + '</div>' +
      (a.body ? '<div class="article-body">' + escapeHtml(a.body) + '</div>' : '') +
      (actions ? '<div class="article-actions">' + actions + '</div>' : '');
    container.appendChild(div);
  });
  container.querySelectorAll('.btn-publish').forEach(function (btn) {
    btn.addEventListener('click', function () { publishArticle(this.dataset.id); });
  });
}

async function publishArticle(articleId) {
  showMessage();
  try {
    const res = await apiFetch('/api/articles/' + encodeURIComponent(articleId) + '/publish', { method: 'POST' });
    const data = await res.json().catch(function () { return {}; });
    if (!res.ok) { showMessage('error', data.error || data.message || 'Не удалось опубликовать'); return; }
    showMessage('success', 'Статья опубликована.');
    loadArticles();
  } catch (_) { showMessage('error', 'Ошибка публикации'); }
}

function escapeHtml(s) {
  if (s == null) return '';
  const el = document.createElement('div');
  el.textContent = s;
  return el.innerHTML;
}

async function handleRegister() {
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  showMessage();
  try {
    const res = await fetch(API_BASE + '/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json().catch(function () { return {}; });
    if (!res.ok) { showMessage('error', data.error || 'Ошибка регистрации'); return; }
    showMessage('success', 'Регистрация успешна. Выполните вход.');
  } catch (e) {
    showMessage('error', 'Не удалось подключиться к серверу.');
  }
}

async function handleLogin() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  showMessage();
  try {
    const res = await fetch(API_BASE + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password })
    });
    const data = await res.json().catch(function () { return {}; });
    if (!res.ok) { showMessage('error', data.error || 'Ошибка входа'); return; }
    accessToken = data.accessToken;
    showMessage('success', 'Вход выполнен.');
    await loadMe();
  } catch (e) {
    showMessage('error', 'Не удалось подключиться к серверу.');
  }
}

async function handleLogout() {
  showMessage();
  try {
    await authFetch('/auth/logout', { method: 'POST' });
  } catch (_) {}
  accessToken = null;
  renderMe('Не авторизован');
  document.getElementById('articles-list').innerHTML = '<p class="hint">Нажмите «Загрузить статьи».</p>';
  showMessage('success', 'Выход выполнен.');
}

async function loadMe() {
  showMessage();
  try {
    const res = await apiFetch('/auth/me');
    const data = await res.json().catch(function () { return {}; });
    if (!res.ok) { showMessage('error', data.error || 'Не удалось загрузить профиль'); return; }
    renderMe(data);
    loadArticles();
  } catch (_) {
    showMessage('error', 'Ошибка запроса /auth/me');
  }
}

async function loadArticles() {
  showMessage();
  try {
    const res = await apiFetch('/api/articles');
    const data = await res.json().catch(function () { return {}; });
    if (!res.ok) { showMessage('error', data.error || 'Не удалось загрузить статьи'); return; }
    renderArticles(data);
  } catch (_) {
    showMessage('error', 'Ошибка запроса /api/articles');
  }
}

async function createArticle() {
  const title = document.getElementById('article-title').value.trim();
  const body = document.getElementById('article-body').value.trim();
  showMessage();
  if (!title) { showMessage('error', 'Введите заголовок'); return; }
  try {
    const res = await apiFetch('/api/articles', {
      method: 'POST',
      body: JSON.stringify({ title, body })
    });
    const data = await res.json().catch(function () { return {}; });
    if (!res.ok) { showMessage('error', data.error || 'Не удалось создать статью (нужна роль author+)'); return; }
    showMessage('success', 'Статья создана.');
    document.getElementById('article-title').value = '';
    document.getElementById('article-body').value = '';
    await loadArticles();
  } catch (_) {
    showMessage('error', 'Ошибка создания статьи');
  }
}

async function loadUsers() {
  const container = document.getElementById('users-list');
  if (!container) return;
  showMessage();
  try {
    const res = await apiFetch('/api/users');
    const data = await res.json().catch(function () { return {}; });
    if (!res.ok) { showMessage('error', data.error || 'Не удалось загрузить пользователей'); container.innerHTML = ''; return; }
    if (!data.users || data.users.length === 0) {
      container.innerHTML = '<p class="hint">Пользователей нет.</p>';
      return;
    }
    container.innerHTML = data.users.map(function (u) {
      const status = u.status || 'active';
      return '<div class="user-item" data-id="' + escapeHtml(u.id) + '">' +
        '<span class="user-email">' + escapeHtml(u.email) + '</span> ' +
        '<span class="badge">' + escapeHtml(u.role) + '</span> ' +
        '<span class="badge status-' + status + '">' + status + '</span> ' +
        '<select class="user-role-select" data-id="' + escapeHtml(u.id) + '">' +
        '<option value="reader"' + (u.role === 'reader' ? ' selected' : '') + '>reader</option>' +
        '<option value="author"' + (u.role === 'author' ? ' selected' : '') + '>author</option>' +
        '<option value="editor"' + (u.role === 'editor' ? ' selected' : '') + '>editor</option>' +
        '<option value="admin"' + (u.role === 'admin' ? ' selected' : '') + '>admin</option>' +
        '</select> ' +
        '<button type="button" class="btn-status" data-id="' + escapeHtml(u.id) + '" data-status="' + (status === 'active' ? 'suspended' : 'active') + '">' +
        (status === 'active' ? 'Деактивировать' : 'Активировать') + '</button>' +
        '</div>';
    }).join('');
    container.querySelectorAll('.user-role-select').forEach(function (sel) {
      sel.addEventListener('change', function () { changeUserRole(this.dataset.id, this.value); });
    });
    container.querySelectorAll('.btn-status').forEach(function (btn) {
      btn.addEventListener('click', function () { changeUserStatus(this.dataset.id, this.dataset.status); });
    });
  } catch (_) {
    showMessage('error', 'Ошибка загрузки пользователей');
    container.innerHTML = '';
  }
}

async function changeUserRole(userId, role) {
  showMessage();
  try {
    const res = await apiFetch('/api/users/' + encodeURIComponent(userId) + '/role', {
      method: 'PATCH',
      body: JSON.stringify({ role: role })
    });
    const data = await res.json().catch(function () { return {}; });
    if (!res.ok) { showMessage('error', data.error || 'Не удалось изменить роль'); return; }
    showMessage('success', 'Роль изменена.');
    loadUsers();
  } catch (_) { showMessage('error', 'Ошибка'); }
}

async function changeUserStatus(userId, status) {
  showMessage();
  try {
    const res = await apiFetch('/api/users/' + encodeURIComponent(userId) + '/status', {
      method: 'PATCH',
      body: JSON.stringify({ status: status })
    });
    const data = await res.json().catch(function () { return {}; });
    if (!res.ok) { showMessage('error', data.error || 'Не удалось изменить статус'); return; }
    showMessage('success', status === 'suspended' ? 'Пользователь деактивирован.' : 'Пользователь активирован.');
    loadUsers();
  } catch (_) { showMessage('error', 'Ошибка'); }
}

document.addEventListener('DOMContentLoaded', function () {
  const params = new URLSearchParams(window.location.search);
  if (params.get('accessToken')) {
    accessToken = params.get('accessToken');
    history.replaceState({}, '', window.location.pathname);
    loadMe();
  } else {
    loadArticles();
  }
  if (params.get('error')) {
    const err = params.get('error');
    const messages = {
      invalid_state: 'OAuth: неверный state. Попробуйте ещё раз.',
      state_expired: 'OAuth: истёк state. Попробуйте ещё раз.',
      token_exchange_failed: 'OAuth: ошибка обмена кода. Убедитесь, что mock OAuth запущен (npm run start:oauth-mock).',
      user_fetch_failed: 'OAuth: не удалось получить данные пользователя.'
    };
    showMessage('error', messages[err] || err);
  }
  document.getElementById('btn-register').addEventListener('click', handleRegister);
  document.getElementById('btn-login').addEventListener('click', handleLogin);
  document.getElementById('btn-logout').addEventListener('click', handleLogout);
  document.getElementById('btn-me').addEventListener('click', loadMe);
  document.getElementById('btn-load-articles').addEventListener('click', loadArticles);
  document.getElementById('btn-create-article').addEventListener('click', createArticle);
  const btnLoadUsers = document.getElementById('btn-load-users');
  if (btnLoadUsers) btnLoadUsers.addEventListener('click', loadUsers);
  document.getElementById('articles-list').innerHTML = '<p class="hint">Нажмите «Загрузить статьи» (без входа — только опубликованные).</p>';
  const adminSection = document.getElementById('admin-section');
  if (adminSection) adminSection.style.display = 'none';
});
