const API = '';

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

async function apiFetch(path, options = {}) {
  return fetch(API + path, { ...options, credentials: 'include' });
}

async function login() {
  showMessage();
  try {
    const username = document.getElementById('login-user').value.trim();
    const password = document.getElementById('login-pass').value;
    const res = await apiFetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return showMessage('error', data.error || 'Ошибка входа');
    showMessage('success', 'Вход выполнен.');
    await loadMe();
  } catch {
    showMessage('error', 'Ошибка входа');
  }
}

async function logout() {
  showMessage();
  try {
    await apiFetch('/logout', { method: 'POST' });
  } catch {}
  document.getElementById('me-out').textContent = 'Не авторизован';
  showMessage('success', 'Выход выполнен.');
}

async function loadMe() {
  showMessage();
  try {
    const res = await apiFetch('/me');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      document.getElementById('me-out').textContent = 'Не авторизован';
      return;
    }
    document.getElementById('me-out').textContent = JSON.stringify(data, null, 2);
  } catch {
    showMessage('error', 'Ошибка /me');
  }
}

function getArticleId() {
  return String(document.getElementById('article-id').value || '').trim();
}

async function loadArticle() {
  showMessage();
  const id = getArticleId();
  const out = document.getElementById('article-out');
  out.classList.add('hidden');
  try {
    const res = await apiFetch(`/articles/${encodeURIComponent(id)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return showMessage('error', data.error || 'Не удалось загрузить статью');
    out.textContent = JSON.stringify(data, null, 2);
    out.classList.remove('hidden');
    await loadCommentsHtml();
  } catch {
    showMessage('error', 'Ошибка загрузки статьи');
  }
}

async function publish() {
  showMessage();
  const id = getArticleId();
  try {
    const res = await apiFetch(`/articles/${encodeURIComponent(id)}/publish`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return showMessage('error', data.error || 'Не удалось опубликовать');
    showMessage('success', 'Опубликовано.');
    await loadArticle();
  } catch {
    showMessage('error', 'Ошибка публикации');
  }
}

async function addComment() {
  showMessage();
  const id = getArticleId();
  const body = document.getElementById('comment-body').value;
  try {
    const res = await apiFetch(`/articles/${encodeURIComponent(id)}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return showMessage('error', data.error || 'Не удалось добавить');
    showMessage('success', 'Комментарий добавлен.');
    document.getElementById('comment-body').value = '';
    await loadCommentsHtml();
  } catch {
    showMessage('error', 'Ошибка добавления комментария');
  }
}

async function loadCommentsHtml() {
  const id = getArticleId();
  const container = document.getElementById('comments-html');
  container.textContent = 'Загрузка...';
  try {
    const res = await apiFetch(`/articles/${encodeURIComponent(id)}/comments`);
    const htmlDoc = await res.text();
    // Берём только body содержимое (простая вырезка)
    const m = htmlDoc.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    container.innerHTML = m ? m[1] : htmlDoc;
  } catch {
    container.textContent = 'Ошибка загрузки комментариев';
  }
}

async function uploadFile() {
  showMessage();
  const fileInput = document.getElementById('upload-file');
  const file = fileInput.files && fileInput.files[0];
  const out = document.getElementById('upload-out');
  out.classList.add('hidden');
  if (!file) return showMessage('error', 'Выберите файл');

  try {
    const fd = new FormData();
    fd.append('file', file);
    const res = await apiFetch('/upload', { method: 'POST', body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return showMessage('error', data.error || 'Загрузка не удалась');
    out.textContent = JSON.stringify(data, null, 2);
    out.classList.remove('hidden');
    showMessage('success', 'Файл загружен.');
  } catch {
    showMessage('error', 'Ошибка загрузки');
  }
}

async function preview() {
  showMessage();
  const url = document.getElementById('preview-url').value.trim();
  const out = document.getElementById('preview-out');
  out.classList.add('hidden');
  if (!url) return showMessage('error', 'Введите URL');
  try {
    const res = await apiFetch(`/preview?url=${encodeURIComponent(url)}`);
    const text = await res.text();
    if (!res.ok) {
      try {
        const j = JSON.parse(text);
        return showMessage('error', j.error || 'Ошибка preview');
      } catch {
        return showMessage('error', 'Ошибка preview');
      }
    }
    out.textContent = text;
    out.classList.remove('hidden');
  } catch {
    showMessage('error', 'Ошибка preview');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-login').addEventListener('click', login);
  document.getElementById('btn-logout').addEventListener('click', logout);
  document.getElementById('btn-me').addEventListener('click', loadMe);
  document.getElementById('btn-load-article').addEventListener('click', loadArticle);
  document.getElementById('btn-publish').addEventListener('click', publish);
  document.getElementById('btn-add-comment').addEventListener('click', addComment);
  document.getElementById('btn-upload').addEventListener('click', uploadFile);
  document.getElementById('btn-preview').addEventListener('click', preview);

  loadMe();
  loadArticle();
});

