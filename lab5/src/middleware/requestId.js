const { v4: uuidv4 } = require('uuid');

function requestId(req, res, next) {
  const id = uuidv4();
  res.setHeader('X-Request-ID', id);
  res.locals.requestId = id;
  next();
}

module.exports = { requestId };
