const API = '';
let currentUser = null;

function getCookie(name) {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[$()*+./?[\\\]^{|}-]/g, '\\$&') + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : '';
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

async function apiFetch(path, options = {}) {
  return fetch(API + path, { ...options, credentials: 'include' });
}

function updateCsrfView() {
  const v = getCookie('csrf-token');
  document.getElementById('csrf-view').value = v || '';
}

async function loadMe() {
  showMessage();
  try {
    const res = await apiFetch('/api/me');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      currentUser = null;
      document.getElementById('me-out').textContent = 'Не авторизован';
      return;
    }
    currentUser = data.user;
    document.getElementById('me-out').textContent = JSON.stringify(data, null, 2);
  } catch {
    showMessage('error', 'Ошибка запроса /api/me');
  }
}

async function seedUsers() {
  showMessage();
  const out = document.getElementById('seed-out');
  out.classList.add('hidden');
  try {
    const res = await apiFetch('/__dev/seed-users', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showMessage('error', data.error || 'Не удалось создать пользователей');
      return;
    }
    out.textContent = JSON.stringify(data, null, 2);
    out.classList.remove('hidden');
    showMessage('success', 'Dev-пользователи готовы.');
  } catch {
    showMessage('error', 'Ошибка запроса /__dev/seed-users');
  }
}

async function login() {
  showMessage();
  try {
    const username = document.getElementById('login-user').value.trim();
    const password = document.getElementById('login-pass').value;
    const res = await apiFetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showMessage('error', data.error || 'Ошибка входа');
      return;
    }
    showMessage('success', 'Вход выполнен.');
    await loadMe();
  } catch {
    showMessage('error', 'Ошибка входа');
  }
}

async function logout() {
  showMessage();
  try {
    await apiFetch('/api/logout', { method: 'POST' });
  } catch {}
  currentUser = null;
  document.getElementById('me-out').textContent = 'Не авторизован';
  showMessage('success', 'Выход выполнен.');
}

async function loadProducts() {
  showMessage();
  try {
    const res = await apiFetch('/api/products');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showMessage('error', data.error || 'Не удалось загрузить товары');
      return;
    }
    const sel = document.getElementById('product-select');
    sel.innerHTML = (data.products || [])
      .map((p) => `<option value="${p.id}">${p.id} — ${p.name} (${(p.price_cents / 100).toFixed(2)})</option>`)
      .join('');
    updateCsrfView();
    showMessage('success', 'Товары загружены (csrf-token установлен).');
  } catch {
    showMessage('error', 'Ошибка запроса /api/products');
  }
}

function getSelectedProductId() {
  const v = document.getElementById('product-select').value;
  return Number(v);
}

async function loadReviews() {
  showMessage();
  const productId = getSelectedProductId();
  if (!productId) return showMessage('error', 'Выберите товар');
  try {
    const res = await apiFetch(`/api/products/${encodeURIComponent(productId)}/reviews`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showMessage('error', data.error || 'Не удалось загрузить отзывы');
      return;
    }
    renderReviews(data.reviews || []);
  } catch {
    showMessage('error', 'Ошибка загрузки отзывов');
  }
}

function renderReviews(items) {
  const container = document.getElementById('reviews-list');
  if (!items.length) {
    container.innerHTML = '<p class="hint">Пока отзывов нет.</p>';
    return;
  }
  const isAdmin = currentUser && currentUser.role === 'admin';
  container.innerHTML = items
    .map((r) => {
      const meta = `ID: ${r.id} • author: ${r.author} • ${r.created_at}`;
      const delBtn = isAdmin ? `<button class="secondary btn-del" data-id="${r.id}">Удалить</button>` : '';
      return `
        <div class="review-item">
          <div class="review-meta">${meta}</div>
          <div class="review-body">${r.body_html}</div>
          <div>${delBtn}</div>
        </div>
      `;
    })
    .join('');

  container.querySelectorAll('.btn-del').forEach((btn) => {
    btn.addEventListener('click', () => deleteReview(btn.dataset.id));
  });
}

async function createReview() {
  showMessage();
  const productId = getSelectedProductId();
  const body = document.getElementById('review-body').value;
  const csrf = getCookie('csrf-token');
  updateCsrfView();
  if (!csrf) return showMessage('error', 'Нет csrf-token cookie. Нажмите «Загрузить товары».');

  const out = document.getElementById('create-out');
  out.classList.add('hidden');
  try {
    const res = await apiFetch(`/api/products/${encodeURIComponent(productId)}/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({ body })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showMessage('error', data.error || 'Не удалось отправить отзыв');
      return;
    }
    out.textContent = JSON.stringify(data, null, 2);
    out.classList.remove('hidden');
    showMessage('success', 'Отзыв сохранён.');
    await loadReviews();
  } catch {
    showMessage('error', 'Ошибка отправки отзыва');
  }
}

async function deleteReview(id) {
  showMessage();
  const csrf = getCookie('csrf-token');
  updateCsrfView();
  if (!csrf) return showMessage('error', 'Нет csrf-token cookie.');
  try {
    const res = await apiFetch(`/api/reviews/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'X-CSRF-Token': csrf }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showMessage('error', data.error || 'Не удалось удалить');
      return;
    }
    showMessage('success', 'Удалено.');
    await loadReviews();
  } catch {
    showMessage('error', 'Ошибка удаления');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-seed').addEventListener('click', seedUsers);
  document.getElementById('btn-login').addEventListener('click', login);
  document.getElementById('btn-logout').addEventListener('click', logout);
  document.getElementById('btn-me').addEventListener('click', loadMe);
  document.getElementById('btn-load-products').addEventListener('click', loadProducts);
  document.getElementById('btn-load-reviews').addEventListener('click', loadReviews);
  document.getElementById('btn-create-review').addEventListener('click', createReview);
  updateCsrfView();
  loadMe();
});

