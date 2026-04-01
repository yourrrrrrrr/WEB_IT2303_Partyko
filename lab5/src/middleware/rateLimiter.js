const rateLimit = require('express-rate-limit');
const securityLogger = require('../services/securityLogger');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Слишком много попыток. Попробуйте через 15 минут.' },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    securityLogger.log('LOGIN_BLOCKED', { ip: req.ip, userAgent: req.get('user-agent') });
    res.status(429).json(options.message);
  }
});

const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false
});

module.exports = { authLimiter, refreshLimiter, apiLimiter };
