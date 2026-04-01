/**
 * GET /admin/security-log — только admin, фильтры event, userId, dateFrom, dateTo.
 */

const express = require('express');
const securityLogger = require('../services/securityLogger');
const { requireAuth, checkUserStatus } = require('../middleware/authenticate');
const { requirePermission } = require('../middleware/authorize');

const router = express.Router();

router.get('/security-log', requireAuth, checkUserStatus, requirePermission('users:manage'), (req, res) => {
  const event = req.query.event;
  const userId = req.query.userId;
  const dateFrom = req.query.dateFrom;
  const dateTo = req.query.dateTo;
  const logs = securityLogger.getLogs({ event, userId, dateFrom, dateTo });
  res.json({ logs, total: logs.length });
});

module.exports = router;
