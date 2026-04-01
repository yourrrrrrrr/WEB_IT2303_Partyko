function looksLikeSqlInjection(input) {
  const s = String(input ?? '');
  if (s.length > 200) return true;
  return /('|--|;)/.test(s);
}

function logSqlInjectionAttempt(context, value) {
  console.warn('[SQLI ATTEMPT]', context, String(value ?? '').slice(0, 500));
}

function logBlockedSsrf(url, reason) {
  console.warn('[SSRF BLOCKED]', reason, url);
}

function logUploadError(reason, details) {
  console.warn('[UPLOAD BLOCKED]', reason, details || '');
}

module.exports = { looksLikeSqlInjection, logSqlInjectionAttempt, logBlockedSsrf, logUploadError };

