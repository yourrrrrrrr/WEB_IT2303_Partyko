// Фронтенд для ЛР4: JWT + RBAC Task Manager
// Запуск: открыть http://localhost:3000/ (фронт раздаётся тем же сервером — без CORS)

const API_BASE = '';
let accessToken = null;

// ========= Утилиты =========

function showMessage(type, text) {
  const errorEl = document.getElementById('msg-error');
  const successEl = document.getElementById('msg-success');
  errorEl.classList.add('hidden');
  successEl.classList.add('hidden');

  if (!text) return;

  const el = type === 'error' ? errorEl : successEl;
  el.textContent = text;
  el.classList.remove('hidden');
}

async function refreshAccessToken() {
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include'
    });
    if (!res.ok) return false;
    const data = await res.json();
    accessToken = data.accessToken || null;
    return !!accessToken;
  } catch {
    return false;
  }
}

async function apiFetch(path, options = {}, retry = true) {
  const opts = { ...options };
  opts.headers = {
    'Content-Type': 'application/json',
    ...(opts.headers || {})
  };
  if (accessToken) {
    opts.headers['Authorization'] = `Bearer ${accessToken}`;
  }
  opts.credentials = 'include';

  const res = await fetch(`${API_BASE}${path}`, opts);

  if (res.status === 401 && retry) {
    let body;
    try {
      body = await res.json();
    } catch {
      body = {};
    }
    if (body && body.code === 'TOKEN_EXPIRED') {
      const ok = await refreshAccessToken();
      if (ok) {
        return apiFetch(path, options, false);
      }
    }
  }

  return res;
}

function renderMe(data) {
  const el = document.getElementById('me-info');
  el.textContent = JSON.stringify(data, null, 2);
}

function renderTasks(data) {
  const container = document.getElementById('tasks-list');
  container.innerHTML = '';

  if (!data || !data.tasks || data.tasks.length === 0) {
    container.innerHTML = '<p class="hint">Задач пока нет.</p>';
    return;
  }

  data.tasks.forEach(task => {
    const div = document.createElement('div');
    div.className = 'task-item';
    div.dataset.id = task.id;

    const top = document.createElement('div');
    top.className = 'task-top';

    const title = document.createElement('div');
    title.className = 'task-title';
    title.textContent = task.title;

    const status = document.createElement('span');
    status.className = `badge status-${task.status}`;
    status.textContent = `status: ${task.status}`;

    top.appendChild(title);
    top.appendChild(status);

    const meta = document.createElement('div');
    meta.className = 'task-meta';
    meta.textContent = `ID: ${task.id} • Владелец: ${task.ownerId}`;

    const desc = document.createElement('div');
    desc.className = 'task-meta';
    desc.textContent = task.description || '—';

    const actions = document.createElement('div');
    actions.className = 'task-actions';

    const btnEdit = document.createElement('button');
    btnEdit.textContent = 'Изменить';
    btnEdit.addEventListener('click', () => editTask(task));

    const btnStatus = document.createElement('button');
    btnStatus.textContent = 'Статус';
    btnStatus.classList.add('secondary');
    btnStatus.addEventListener('click', () => changeStatus(task));

    const btnDelete = document.createElement('button');
    btnDelete.textContent = 'Удалить';
    btnDelete.classList.add('secondary');
    btnDelete.addEventListener('click', () => deleteTask(task));

    actions.appendChild(btnEdit);
    actions.appendChild(btnStatus);
    actions.appendChild(btnDelete);

    div.appendChild(top);
    div.appendChild(meta);
    div.appendChild(desc);
    div.appendChild(actions);

    container.appendChild(div);
  });
}

function renderUsers(data) {
  const container = document.getElementById('users-list');
  container.innerHTML = '';

  if (!data || !data.users || data.users.length === 0) {
    container.innerHTML = '<p class="hint">Пользователи не найдены или нет прав.</p>';
    return;
  }

  data.users.forEach(u => {
    const row = document.createElement('div');
    row.className = 'user-row';

    const main = document.createElement('div');
    main.className = 'user-main';

    const email = document.createElement('div');
    email.className = 'user-email';
    email.textContent = u.email;

    const meta = document.createElement('div');
    meta.className = 'user-meta';
    meta.textContent = `ID: ${u.id} • role: ${u.role} • active: ${u.active}`;

    main.appendChild(email);
    main.appendChild(meta);

    row.appendChild(main);
    container.appendChild(row);
  });
}

// ========= Действия =========

async function handleRegister() {
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  showMessage(); // очистить

  try {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showMessage('error', data.error || 'Ошибка регистрации');
      return;
    }
    showMessage('success', 'Регистрация успешна, теперь выполните вход.');
  } catch (e) {
    showMessage('error', 'Не удалось подключиться к серверу.');
  }
}

async function handleLogin() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  showMessage();

  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showMessage('error', data.error || 'Ошибка входа');
      return;
    }
    accessToken = data.accessToken;
    showMessage('success', 'Вход выполнен.');
    await loadMe();
    await loadTasks();
  } catch (e) {
    showMessage('error', 'Не удалось подключиться к серверу.');
  }
}

async function handleLogout() {
  showMessage();
  try {
    await fetch(`${API_BASE}/auth/logout`, {
      method: 'POST',
      credentials: 'include'
    });
  } catch {
    // ignore
  }
  accessToken = null;
  renderMe('Не авторизован');
  document.getElementById('tasks-list').innerHTML = '<p class="hint">Войдите, чтобы увидеть задачи.</p>';
  document.getElementById('users-list').innerHTML = '';
  showMessage('success', 'Выход выполнен.');
}

async function loadMe() {
  showMessage();
  try {
    const res = await apiFetch('/auth/me', { method: 'GET' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showMessage('error', data.error || 'Не удалось получить профиль');
      return;
    }
    renderMe(data);
  } catch {
    showMessage('error', 'Ошибка запроса /auth/me');
  }
}

async function loadTasks() {
  showMessage();
  try {
    const res = await apiFetch('/api/tasks', { method: 'GET' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showMessage('error', data.error || 'Не удалось загрузить задачи');
      return;
    }
    renderTasks(data);
  } catch {
    showMessage('error', 'Ошибка запроса /api/tasks');
  }
}

async function createTask() {
  const title = document.getElementById('task-title').value.trim();
  const description = document.getElementById('task-desc').value.trim();
  showMessage();

  if (!title) {
    showMessage('error', 'Введите заголовок задачи');
    return;
  }

  try {
    const res = await apiFetch('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title, description })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showMessage('error', data.error || 'Не удалось создать задачу');
      return;
    }
    showMessage('success', 'Задача создана.');
    document.getElementById('task-title').value = '';
    document.getElementById('task-desc').value = '';
    await loadTasks();
  } catch {
    showMessage('error', 'Ошибка запроса создания задачи');
  }
}

async function editTask(task) {
  const newTitle = prompt('Новый заголовок задачи:', task.title);
  if (newTitle === null) return;
  const newDesc = prompt('Новое описание задачи:', task.description || '');
  if (newDesc === null) return;

  showMessage();
  try {
    const res = await apiFetch(`/api/tasks/${task.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: newTitle, description: newDesc })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showMessage('error', data.error || 'Не удалось обновить задачу');
      return;
    }
    showMessage('success', 'Задача обновлена.');
    await loadTasks();
  } catch {
    showMessage('error', 'Ошибка запроса обновления задачи');
  }
}

async function changeStatus(task) {
  const statuses = ['open', 'in_progress', 'done', 'cancelled'];
  const currentIdx = statuses.indexOf(task.status);
  const nextStatus = prompt(
    `Текущий статус: ${task.status}\nВведите новый статус (${statuses.join(', ')}):`,
    currentIdx >= 0 ? statuses[(currentIdx + 1) % statuses.length] : 'open'
  );
  if (!nextStatus) return;

  showMessage();
  try {
    const res = await apiFetch(`/api/tasks/${task.id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: nextStatus })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showMessage('error', data.error || 'Не удалось изменить статус (нужны права manager+)');
      return;
    }
    showMessage('success', 'Статус обновлён.');
    await loadTasks();
  } catch {
    showMessage('error', 'Ошибка запроса изменения статуса');
  }
}

async function deleteTask(task) {
  if (!confirm(`Удалить задачу "${task.title}"?`)) return;
  showMessage();
  try {
    const res = await apiFetch(`/api/tasks/${task.id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showMessage('error', data.error || 'Не удалось удалить задачу');
      return;
    }
    showMessage('success', 'Задача удалена.');
    await loadTasks();
  } catch {
    showMessage('error', 'Ошибка запроса удаления задачи');
  }
}

async function loadUsers() {
  showMessage();
  try {
    const res = await apiFetch('/api/users', { method: 'GET' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showMessage('error', data.error || 'Не удалось загрузить пользователей (нужны права manager+)');
      return;
    }
    renderUsers(data);
  } catch {
    showMessage('error', 'Ошибка запроса /api/users');
  }
}

async function changeUserRole() {
  const userId = document.getElementById('role-user-id').value.trim();
  const newRole = document.getElementById('role-new-role').value;
  if (!userId) {
    showMessage('error', 'Введите ID пользователя');
    return;
  }
  showMessage();

  try {
    const res = await apiFetch(`/api/users/${userId}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role: newRole })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showMessage('error', data.error || 'Не удалось изменить роль (нужны права admin)');
      return;
    }
    showMessage('success', 'Роль пользователя обновлена.');
    await loadUsers();
    await loadMe();
  } catch {
    showMessage('error', 'Ошибка запроса смены роли');
  }
}

async function deactivateUser() {
  const userId = document.getElementById('deact-user-id').value.trim();
  if (!userId) {
    showMessage('error', 'Введите ID пользователя');
    return;
  }
  showMessage();

  try {
    const res = await apiFetch(`/api/users/${userId}/deactivate`, {
      method: 'PATCH'
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showMessage('error', data.error || 'Не удалось деактивировать пользователя (нужны права admin)');
      return;
    }
    showMessage('success', 'Аккаунт деактивирован.');
    await loadUsers();
  } catch {
    showMessage('error', 'Ошибка запроса деактивации пользователя');
  }
}

// ========= Инициализация =========

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-register').addEventListener('click', handleRegister);
  document.getElementById('btn-login').addEventListener('click', handleLogin);
  document.getElementById('btn-logout').addEventListener('click', handleLogout);
  document.getElementById('btn-me').addEventListener('click', loadMe);

  document.getElementById('btn-load-tasks').addEventListener('click', loadTasks);
  document.getElementById('btn-create-task').addEventListener('click', createTask);

  document.getElementById('btn-load-users').addEventListener('click', loadUsers);
  document.getElementById('btn-change-role').addEventListener('click', changeUserRole);
  document.getElementById('btn-deactivate-user').addEventListener('click', deactivateUser);

  // подсказка по умолчанию
  document.getElementById('tasks-list').innerHTML = '<p class="hint">Войдите, затем нажмите «Загрузить задачи».</p>';
});

