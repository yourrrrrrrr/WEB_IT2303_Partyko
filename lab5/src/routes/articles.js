/**
 * GET /api/articles — публично только published; с токеном по роли; пагинация ?page=1&limit=10, фильтры ?status=&authorId=
 * POST /api/articles — черновик (author+)
 * GET /api/articles/:id — draft только для автора или editor+; иначе 404 (IDOR → лог)
 * PATCH /api/articles/:id — own draft или editor+ any
 * POST /api/articles/:id/publish — editor+, не свою (403 если своя)
 * DELETE /api/articles/:id — по таблице прав (own или admin any)
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { articles, users } = require('../db');
const { hasPermission } = require('../config/rbac');
const securityLogger = require('../services/securityLogger');
const tokenService = require('../services/tokenService');
const { requireAuth, checkUserStatus } = require('../middleware/authenticate');
const { requirePermission } = require('../middleware/authorize');
const { stripHtml } = require('../middleware/sanitize');

const router = express.Router();

function getAuthUser(req) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;
  const result = tokenService.verifyAccessToken(token);
  if (result.error) return null;
  return users.get(result.payload.sub);
}

router.get('/', (req, res) => {
  const user = getAuthUser(req);
  let list = [];
  if (!user) {
    for (const a of articles.values()) if (a.status === 'published') list.push(a);
  } else {
    if (hasPermission(user.role, 'articles:read')) {
      for (const a of articles.values()) {
        if (a.status === 'published') list.push(a);
        else if (a.authorId === user.id || hasPermission(user.role, 'articles:update:any')) list.push(a);
      }
    }
  }
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
  const status = req.query.status;
  const authorId = req.query.authorId;
  if (status) list = list.filter(a => a.status === status);
  if (authorId) list = list.filter(a => a.authorId === authorId);
  const total = list.length;
  const offset = (page - 1) * limit;
  list = list.slice(offset, offset + limit);
  res.json({ articles: list, total, page, limit });
});

router.post('/', requireAuth, checkUserStatus, requirePermission('articles:create'), (req, res) => {
  const title = stripHtml((req.body && req.body.title) || '');
  const body = stripHtml((req.body && req.body.body) || '');
  if (title.length < 3) return res.status(400).json({ error: 'Заголовок обязателен, минимум 3 символа после очистки' });
  const id = uuidv4();
  const now = new Date().toISOString();
  const article = { id, title, body, authorId: req.user.id, status: 'draft', createdAt: now, updatedAt: now };
  articles.set(id, article);
  res.status(201).json({ message: 'Статья создана', article });
});

router.get('/:id', (req, res, next) => {
  const article = articles.get(req.params.id);
  if (!article) return res.status(404).json({ error: 'Статья не найдена' });
  const user = getAuthUser(req);
  if (article.status === 'published') return res.json({ article });
  if (!user) return res.status(404).json({ error: 'Статья не найдена' });
  if (article.authorId === user.id) return res.json({ article });
  if (hasPermission(user.role, 'articles:update:any')) return res.json({ article });
  securityLogger.log('IDOR_ATTEMPT', { userId: user.id, ip: req.ip, meta: { resource: 'article', id: article.id } });
  return res.status(404).json({ error: 'Статья не найдена' });
});

router.patch('/:id', requireAuth, checkUserStatus, (req, res, next) => {
  const article = articles.get(req.params.id);
  if (!article) return res.status(404).json({ error: 'Статья не найдена' });
  const canUpdateAny = hasPermission(req.user.role, 'articles:update:any');
  const isOwner = article.authorId === req.user.id;
  if (article.status !== 'draft' && !canUpdateAny) return res.status(403).json({ error: 'Forbidden', message: 'Редактировать можно только черновики (или иметь право update:any)' });
  if (!isOwner && !canUpdateAny) return res.status(404).json({ error: 'Статья не найдена' });
  const title = req.body.title !== undefined ? stripHtml(String(req.body.title)) : article.title;
  const body = req.body.body !== undefined ? stripHtml(String(req.body.body)) : article.body;
  if (title.length < 3) return res.status(400).json({ error: 'Заголовок минимум 3 символа' });
  article.title = title;
  article.body = body;
  article.updatedAt = new Date().toISOString();
  articles.set(article.id, article);
  res.json({ message: 'Статья обновлена', article });
});

router.post('/:id/publish', requireAuth, checkUserStatus, requirePermission('articles:publish'), (req, res) => {
  const article = articles.get(req.params.id);
  if (!article) return res.status(404).json({ error: 'Статья не найдена' });
  if (article.authorId === req.user.id) return res.status(403).json({ error: 'Forbidden', message: 'Редактор не может опубликовать свою статью' });
  article.status = 'published';
  article.updatedAt = new Date().toISOString();
  articles.set(article.id, article);
  res.json({ message: 'Статья опубликована', article });
});

router.delete('/:id', requireAuth, checkUserStatus, (req, res) => {
  const article = articles.get(req.params.id);
  if (!article) return res.status(404).json({ error: 'Статья не найдена' });
  const canDeleteAny = hasPermission(req.user.role, 'articles:delete:any');
  const isOwner = article.authorId === req.user.id;
  if (!isOwner && !canDeleteAny) return res.status(404).json({ error: 'Статья не найдена' });
  articles.delete(article.id);
  res.json({ message: 'Статья удалена' });
});

module.exports = router;
