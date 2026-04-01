const crypto = require('crypto');

const sessions = new Map(); // sessionId -> { username, role, createdAt }

function createSession(user) {
  const sessionId = crypto.randomBytes(32).toString('hex');
  sessions.set(sessionId, {
    username: user.username,
    role: user.role,
    createdAt: Date.now()
  });
  return sessionId;
}

function deleteSession(sessionId) {
  if (!sessionId) return;
  sessions.delete(sessionId);
}

function getSession(sessionId) {
  if (!sessionId) return null;
  return sessions.get(sessionId) || null;
}

function requireAuth(req, res, next) {
  const sid = req.cookies?.sessionId;
  const session = getSession(sid);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });
  req.user = { username: session.username, role: session.role };
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(500).json({ error: 'Server error' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  next();
}

module.exports = { createSession, deleteSession, getSession, requireAuth, requireAdmin };

