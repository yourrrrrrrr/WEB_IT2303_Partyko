const dns = require('dns').promises;
const net = require('net');

function isPrivateIpv4(ip) {
  if (!net.isIP(ip)) return false;
  if (net.isIP(ip) !== 4) return false;
  const parts = ip.split('.').map((x) => parseInt(x, 10));
  const [a, b] = parts;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function isLocalHostname(hostname) {
  const h = String(hostname || '').toLowerCase();
  return h === 'localhost' || h.endsWith('.localhost');
}

function parseAllowlist() {
  const raw = process.env.PREVIEW_ALLOWLIST || 'myblog.com,example.com';
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

async function validatePreviewUrl(urlString) {
  let u;
  try {
    u = new URL(urlString);
  } catch {
    return { ok: false, error: 'Некорректный URL' };
  }

  if (u.protocol !== 'https:') {
    return { ok: false, error: 'Разрешён только https://' };
  }

  if (!u.hostname) return { ok: false, error: 'Некорректный URL' };

  if (isLocalHostname(u.hostname)) {
    return { ok: false, error: 'URL не разрешён' };
  }

  const allowlist = parseAllowlist();
  const host = u.hostname.toLowerCase();
  if (!allowlist.includes(host)) {
    return { ok: false, error: 'Домен не разрешён' };
  }

  // Resolve and block private ranges.
  try {
    const res = await dns.lookup(host, { all: true, verbatim: true });
    for (const a of res) {
      if (a.family === 4 && isPrivateIpv4(a.address)) {
        return { ok: false, error: 'URL не разрешён' };
      }
      // IPv6: block loopback and local as conservative
      if (a.family === 6) {
        const v = String(a.address).toLowerCase();
        if (v === '::1' || v.startsWith('fe80:') || v.startsWith('fc') || v.startsWith('fd')) {
          return { ok: false, error: 'URL не разрешён' };
        }
      }
    }
  } catch {
    return { ok: false, error: 'Не удалось проверить домен' };
  }

  return { ok: true, url: u.toString() };
}

module.exports = { validatePreviewUrl };

