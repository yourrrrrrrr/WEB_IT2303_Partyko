/**
 * GET /api/articles/:articleId/comments
 * POST /api/articles/:articleId/comments — только к опубликованным (comments:create)
 * DELETE /api/articles/:articleId/comments/:commentId — own или comments:delete:any
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { articles, getComments, addComment, deleteComment, getComment } = require('../db');
const { hasPermission } = require('../config/rbac');
const { requireAuth, checkUserStatus } = require('../middleware/authenticate');
const { requirePermission } = require('../middleware/authorize');
const { stripHtml } = require('../middleware/sanitize');

const router = express.Router({ mergeParams: true });

router.get('/', (req, res) => {
  const article = articles.get(req.params.articleId);
  if (!article) return res.status(404).json({ error: 'Статья не найдена' });
  const list = getComments(article.id);
  res.json({ comments: list });
});

router.post('/', requireAuth, checkUserStatus, requirePermission('comments:create'), (req, res) => {
  const article = articles.get(req.params.articleId);
  if (!article) return res.status(404).json({ error: 'Статья не найдена' });
  if (article.status !== 'published') return res.status(400).json({ error: 'Комментарии можно добавлять только к опубликованным статьям' });
  const body = stripHtml((req.body && req.body.comment) || (req.body && req.body.body) || '');
  if (body.length < 1) return res.status(400).json({ error: 'Текст комментария обязателен' });
  const id = uuidv4();
  const comment = { id, articleId: article.id, authorId: req.user.id, body, createdAt: new Date().toISOString() };
  addComment(comment);
  res.status(201).json({ message: 'Комментарий добавлен', comment });
});

router.delete('/:commentId', requireAuth, checkUserStatus, (req, res) => {
  const article = articles.get(req.params.articleId);
  if (!article) return res.status(404).json({ error: 'Статья не найдена' });
  const comment = getComment(article.id, req.params.commentId);
  if (!comment) return res.status(404).json({ error: 'Комментарий не найден' });
  const isOwner = comment.authorId === req.user.id;
  const canDeleteAny = hasPermission(req.user.role, 'comments:delete:any');
  if (!isOwner && !canDeleteAny) return res.status(403).json({ error: 'Forbidden', message: 'Недостаточно прав' });
  deleteComment(article.id, comment.id);
  res.json({ message: 'Комментарий удалён' });
});

module.exports = router;
