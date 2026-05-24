/** Lightweight request correlation (no Jaeger / OpenTelemetry). */

function initTracing() {}

function getTracer() {
  return null;
}

function injectTraceHeaders() {
  const headers = [];
  if (process.env.CORRELATION_ID) {
    headers.push({ 'correlation-id': process.env.CORRELATION_ID });
  }
  return headers;
}

function extractTraceContext() {
  return undefined;
}

async function runWithSpan(_name, fn) {
  return fn();
}

module.exports = {
  initTracing,
  getTracer,
  injectTraceHeaders,
  extractTraceContext,
  runWithSpan,
};
