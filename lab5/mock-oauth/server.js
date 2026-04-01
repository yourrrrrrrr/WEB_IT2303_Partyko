/**
 * Mock OAuth2 (имитация GitHub): GET /authorize (client_id, redirect_uri, state, code_challenge, code_challenge_method),
 * POST /token (code, code_verifier) — проверка PKCE SHA-256, GET /user.
 */

const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { testUsers } = require('./users');

const app = express();
const PORT = process.env.OAUTH_PORT || 3001;

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const authCodes = new Map();
const accessTokens = new Map();

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

app.get('/authorize', (req, res) => {
  const { client_id, redirect_uri, state, code_challenge, code_challenge_method } = req.query;
  if (!client_id || !redirect_uri || !state || !code_challenge) {
    return res.status(400).send('Missing required params: client_id, redirect_uri, state, code_challenge');
  }
  if (code_challenge_method && code_challenge_method !== 'S256') {
    return res.status(400).send('Only S256 supported');
  }
  const html = `
<!DOCTYPE html>
<html lang="ru">
<head><meta charset="UTF-8"><title>Mock OAuth2</title>
<style>body{font-family:sans-serif;padding:30px;} button{display:block;margin:10px 0;padding:12px 24px;}</style>
</head>
<body>
  <h1>Выберите роль для входа (Mock GitHub)</h1>
  ${testUsers.map(u => `
  <form method="POST" action="/authorize">
    <input type="hidden" name="userId" value="${u.id}">
    <input type="hidden" name="client_id" value="${client_id}">
    <input type="hidden" name="redirect_uri" value="${redirect_uri}">
    <input type="hidden" name="state" value="${state}">
    <input type="hidden" name="code_challenge" value="${code_challenge}">
    <input type="hidden" name="code_challenge_method" value="${code_challenge_method || 'S256'}">
    <button type="submit">Войти как ${u.role} (${u.email})</button>
  </form>
  `).join('')}
</body>
</html>`;
  res.send(html);
});

app.post('/authorize', (req, res) => {
  const { userId, client_id, redirect_uri, state, code_challenge, code_challenge_method } = req.body;
  const user = testUsers.find(u => u.id === userId);
  if (!user) return res.status(400).send('Unknown user');
  const code = uuidv4();
  authCodes.set(code, {
    userId: user.id,
    clientId: client_id,
    redirectUri: redirect_uri,
    state,
    codeChallenge: code_challenge,
    codeChallengeMethod: code_challenge_method || 'S256',
    createdAt: Date.now()
  });
  const url = new URL(redirect_uri);
  url.searchParams.set('code', code);
  url.searchParams.set('state', state);
  res.redirect(url.toString());
});

app.post('/token', (req, res) => {
  const { code, code_verifier } = req.body || {};
  const record = authCodes.get(code);
  if (!record) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'Invalid or expired code' });
  }
  authCodes.delete(code);
  const expected = base64url(crypto.createHash('sha256').update(code_verifier || '').digest());
  if (expected !== record.codeChallenge) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed' });
  }
  const access_token = `mock-${record.userId}-${uuidv4()}`;
  accessTokens.set(access_token, { userId: record.userId, createdAt: Date.now() });
  res.json({ access_token, token_type: 'bearer', expires_in: 3600 });
});

app.get('/user', (req, res) => {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'missing_token' });
  const data = accessTokens.get(token);
  if (!data) return res.status(401).json({ error: 'invalid_token' });
  const user = testUsers.find(u => u.id === data.userId);
  if (!user) return res.status(401).json({ error: 'invalid_token' });
  res.json({ id: user.id, login: user.login, email: user.email, role: user.role || 'reader' });
});

app.listen(PORT, () => {
  console.log(`Mock OAuth2 (PKCE) на http://localhost:${PORT}`);
});
