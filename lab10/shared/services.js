const axios = require('axios');
const logger = require('./logger');

const DEFAULT_INSTANCES = {
  'recommendation-service': [
    { id: 'rec-1', address: 'recommendation-1', port: 3003 },
    { id: 'rec-2', address: 'recommendation-2', port: 3004 },
  ],
  'alert-engine': [
    { id: 'alert-1', address: 'alert-engine-1', port: 3020 },
    { id: 'alert-2', address: 'alert-engine-2', port: 3021 },
  ],
};

const LOCAL_RECOMMENDATION = [
  { id: 'local-1', address: '127.0.0.1', port: 3003 },
  { id: 'local-2', address: '127.0.0.1', port: 3004 },
];

const HOST_RECOMMENDATION = [
  { id: 'host-1', address: 'host.docker.internal', port: 3003 },
  { id: 'host-2', address: 'host.docker.internal', port: 3004 },
];

function parseInstancesEnv(envKey, fallback) {
  const raw = process.env[envKey];
  if (!raw) return fallback;
  return raw.split(',').map((part, i) => {
    const [address, port] = part.trim().split(':');
    return { id: `${envKey}-${i}`, address, port: Number(port) };
  });
}

function getInstances(name) {
  if (name === 'recommendation-service') {
    return parseInstancesEnv(
      'RECOMMENDATION_INSTANCES',
      DEFAULT_INSTANCES['recommendation-service']
    );
  }
  if (name === 'alert-engine') {
    return parseInstancesEnv('ALERT_ENGINE_INSTANCES', DEFAULT_INSTANCES['alert-engine']);
  }
  return [];
}

function uniqueInstances(list) {
  const seen = new Set();
  const out = [];
  for (const inst of list) {
    const key = `${inst.address}:${inst.port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(inst);
  }
  return out;
}

function recommendationFallbacks() {
  const extras = [];
  if (process.env.IN_DOCKER === 'true') {
    extras.push(...HOST_RECOMMENDATION);
  } else {
    extras.push(...LOCAL_RECOMMENDATION);
  }
  return parseInstancesEnv('RECOMMENDATION_FALLBACK_INSTANCES', extras);
}

async function discoverHealthy(name) {
  const instances = getInstances(name);
  const healthy = [];
  for (const inst of instances) {
    try {
      await axios.get(`http://${inst.address}:${inst.port}/health`, { timeout: 3000 });
      healthy.push(inst);
    } catch (err) {
      logger.warn('Instance unhealthy', {
        service: name,
        id: inst.id,
        address: inst.address,
        error: err.message,
      });
    }
  }
  return healthy;
}

function pickRoundRobin(instances, key = '') {
  if (!instances.length) return null;
  const idx =
    Math.abs([...key].reduce((a, c) => a + c.charCodeAt(0), 0)) % instances.length;
  return instances[idx];
}

/**
 * Вызов recommendation-service с перебором инстансов (Docker DNS, localhost, host.docker.internal).
 */
async function fetchRecommendations(studentId, routingKey = studentId) {
  const configured = getInstances('recommendation-service');
  const healthy = await discoverHealthy('recommendation-service');
  const fallbacks = recommendationFallbacks();

  const primary = healthy.length ? healthy : configured;
  const first = pickRoundRobin(primary, routingKey);
  const rest = primary.filter((i) => i !== first);
  const tryList = uniqueInstances([first, ...rest, ...configured, ...fallbacks].filter(Boolean));

  const errors = [];
  for (const inst of tryList) {
    const url = `http://${inst.address}:${inst.port}/recommendations/${studentId}`;
    try {
      const { data } = await axios.get(url, { timeout: 5000 });
      return { data, instance: inst };
    } catch (err) {
      errors.push({ url, error: err.message });
      logger.warn('Recommendation request failed', { url, error: err.message });
    }
  }

  logger.error('All recommendation instances failed', { studentId, errors });
  return {
    data: {
      student_id: studentId,
      recommendations: [],
      dropout_risk: { risk_score: 0.1 },
      warning: 'recommendation-service unavailable',
      errors: errors.slice(0, 4),
    },
    instance: null,
  };
}

function getBaseUrlCandidates(pluralEnv, singularEnv, defaultDockerUrl, localPort) {
  const raw = process.env[pluralEnv] || process.env[singularEnv];
  const list = raw
    ? raw.split(',').map((s) => s.trim()).filter(Boolean)
    : [defaultDockerUrl];
  if (process.env.IN_DOCKER === 'true') {
    list.push(`http://host.docker.internal:${localPort}`);
  }
  list.push(`http://127.0.0.1:${localPort}`);
  const seen = new Set();
  return list.filter((u) => {
    const key = u.replace(/\/$/, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * HTTP-запрос с перебором базовых URL (Docker DNS → host.docker.internal → localhost).
 */
async function axiosWithFailover(baseUrls, buildRequest) {
  const errors = [];
  for (const base of baseUrls) {
    const root = base.replace(/\/$/, '');
    try {
      return await buildRequest(root);
    } catch (err) {
      errors.push({ base: root, error: err.message });
      logger.warn('Service request failed', { base: root, error: err.message });
    }
  }
  const err = new Error(errors.map((e) => `${e.base}: ${e.error}`).join(' | ') || 'All URLs failed');
  err.attempts = errors;
  throw err;
}

function getTelemetryBaseUrls() {
  return getBaseUrlCandidates('TELEMETRY_URLS', 'TELEMETRY_URL', 'http://telemetry-service:3010', 3010);
}

function getRegistryBaseUrls() {
  return getBaseUrlCandidates('REGISTRY_URLS', 'REGISTRY_URL', 'http://device-registry:3011', 3011);
}

module.exports = {
  discoverHealthy,
  pickRoundRobin,
  getInstances,
  fetchRecommendations,
  getBaseUrlCandidates,
  axiosWithFailover,
  getTelemetryBaseUrls,
  getRegistryBaseUrls,
};
