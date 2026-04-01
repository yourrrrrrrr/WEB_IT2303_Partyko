/**
 * SecurityLogger — лог событий безопасности с фильтрацией.
 * События: REGISTER_SUCCESS, REGISTER_FAIL, LOGIN_SUCCESS, LOGIN_FAIL, LOGIN_BLOCKED,
 * LOGOUT, LOGOUT_ALL, TOKEN_REFRESH_SUCCESS, TOKEN_REFRESH_FAIL, TOKEN_REUSE_DETECTED,
 * OAUTH_LOGIN_SUCCESS, PERMISSION_DENIED, IDOR_ATTEMPT, ROLE_CHANGED, USER_SUSPENDED.
 */

const events = [];

function log(event, meta = {}) {
  events.push({
    id: events.length + 1,
    event,
    userId: meta.userId ?? null,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
    meta: meta.meta ?? null,
    createdAt: new Date().toISOString()
  });
}

function getLogs(filters = {}) {
  let list = [...events];
  if (filters.event) {
    list = list.filter(e => e.event === filters.event);
  }
  if (filters.userId) {
    list = list.filter(e => e.userId === filters.userId);
  }
  if (filters.dateFrom) {
    const from = new Date(filters.dateFrom).getTime();
    list = list.filter(e => new Date(e.createdAt).getTime() >= from);
  }
  if (filters.dateTo) {
    const to = new Date(filters.dateTo).getTime();
    list = list.filter(e => new Date(e.createdAt).getTime() <= to);
  }
  return list;
}

module.exports = {
  log,
  getLogs,
  events
};
