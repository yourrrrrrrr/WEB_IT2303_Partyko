/**
 * In-memory "БД" для платформы статей (ЛР5).
 * users, articles, comments, refreshSessions (с полями userId, hash, userAgent, ip, createdAt, expiresAt).
 */

/** @type {Map<string, { id, email, passwordHash?, role, status, createdAt, providerId? }>} */
const users = new Map();

/** @type {Map<string, { id, title, body, authorId, status, createdAt, updatedAt }>} */
const articles = new Map();

/** articleId -> Map<commentId, { id, articleId, authorId, body, createdAt }> */
const commentsByArticle = new Map();

/** @type {Map<string, { userId, hash, userAgent, ip, createdAt, expiresAt, revokedAt?, jti, familyId? }>} */
const refreshSessions = new Map();

function getComments(articleId) {
  const map = commentsByArticle.get(articleId);
  return map ? Array.from(map.values()) : [];
}

function addComment(comment) {
  let map = commentsByArticle.get(comment.articleId);
  if (!map) {
    map = new Map();
    commentsByArticle.set(comment.articleId, map);
  }
  map.set(comment.id, comment);
}

function deleteComment(articleId, commentId) {
  const map = commentsByArticle.get(articleId);
  if (map) map.delete(commentId);
}

function getComment(articleId, commentId) {
  const map = commentsByArticle.get(articleId);
  return map ? map.get(commentId) : null;
}

module.exports = {
  users,
  articles,
  commentsByArticle,
  refreshSessions,
  getComments,
  addComment,
  deleteComment,
  getComment
};
