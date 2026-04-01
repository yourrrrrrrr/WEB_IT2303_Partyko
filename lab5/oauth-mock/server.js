// Mock OAuth2 сервер (имитация GitHub) для Лабораторной 5
//
// Это упрощённый скелет. Полный PKCE flow и хранение code/state/code_challenge
// будут добавлены при реализации логики в основной задаче.

const express = require('express');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.OAUTH_PORT || 3001;

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Временное in-memory хранилище авторизационных кодов
const authCodes = new Map();

// Набор тестовых пользователей
const testUsers = [
  { id: 'u1', login: 'reader_user', email: 'reader@example.com', role: 'reader' },
  { id: 'u2', login: 'author_user', email: 'author@example.com', role: 'author' },
  { id: 'u3', login: 'editor_user', email: 'editor@example.com', role: 'editor' }
];

// Страница авторизации (имитация GitHub /authorize)
app.get('/authorize', (req, res) => {
  const { client_id, redirect_uri, state } = req.query;

  if (!client_id || !redirect_uri || !state) {
    return res.status(400).send('Missing required query params');
  }

  // Простая HTML-страница с выбором пользователя
  const html = `
<!DOCTYPE html>
<html lang="ru">
  <head>
    <meta charset="UTF-8">
    <title>Mock OAuth2 Авторизация</title>
    <style>
      body { font-family: sans-serif; padding: 30px; }
      h1 { margin-bottom: 20px; }
      button { display: block; margin: 10px 0; padding: 10px 20px; }
    </style>
  </head>
  <body>
    <h1>Войти как тестовый пользователь</h1>
    ${testUsers
      .map(
        (u) => `
      <form method="POST" action="/authorize">
        <input type="hidden" name="userId" value="${u.id}">
        <input type="hidden" name="client_id" value="${client_id}">
        <input type="hidden" name="redirect_uri" value="${redirect_uri}">
        <input type="hidden" name="state" value="${state}">
        <button type="submit">${u.login} (${u.email})</button>
      </form>
    `
      )
      .join('')}
  </body>
</html>`;

  res.send(html);
});

// Обработка выбора пользователя → выдача code и редирект
app.post('/authorize', (req, res) => {
  const { userId, client_id, redirect_uri, state } = req.body;

  const user = testUsers.find((u) => u.id === userId);
  if (!user) {
    return res.status(400).send('Unknown user');
  }

  const code = uuidv4();
  authCodes.set(code, {
    userId: user.id,
    clientId: client_id,
    redirectUri: redirect_uri,
    state,
    createdAt: Date.now()
  });

  const url = new URL(redirect_uri);
  url.searchParams.set('code', code);
  url.searchParams.set('state', state);

  res.redirect(url.toString());
});

// Обмен code → access_token (упрощённо, без PKCE)
app.post('/token', (req, res) => {
  const { code } = req.body;
  const record = authCodes.get(code);

  if (!record) {
    return res.status(400).json({ error: 'invalid_grant' });
  }

  authCodes.delete(code);

  // В реальности здесь был бы JWT, но для mock достаточно простого токена
  const accessToken = `mock-token-${record.userId}-${uuidv4()}`;

  res.json({
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: 3600,
    user_id: record.userId
  });
});

// Данные пользователя по access_token
app.get('/user', (req, res) => {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'missing_token' });
  }

  const match = token.match(/^mock-token-(u\d+)-/);
  if (!match) {
    return res.status(401).json({ error: 'invalid_token' });
  }

  const userId = match[1];
  const user = testUsers.find((u) => u.id === userId);
  if (!user) {
    return res.status(401).json({ error: 'invalid_token' });
  }

  res.json({
    id: user.id,
    login: user.login,
    email: user.email
  });
});

app.listen(PORT, () => {
  console.log(`Mock OAuth2 сервер запущен на http://localhost:${PORT}`);
});

