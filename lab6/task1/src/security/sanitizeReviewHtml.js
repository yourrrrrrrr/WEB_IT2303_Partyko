const MAX_LEN = 2000;

// Разрешены только эти теги:
const ALLOWED_TAGS = new Set(['b', 'i', 'em', 'strong', 'a']);

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function isSafeHref(href) {
  if (typeof href !== 'string') return false;
  const v = href.trim().replace(/\s+/g, '');
  if (!v) return false;
  const lower = v.toLowerCase();
  if (lower.startsWith('javascript:')) return false;
  if (lower.startsWith('data:')) return false;
  return true;
}

// Требование методички: без сторонних библиотек.
// Это простой sanitizer на regex/tokenize подходе:
// - не пытается "понять" HTML полностью
// - вырезает все теги, кроме allowlist
// - оставляет только href у <a>, остальные атрибуты удаляет
function sanitizeReviewHtml(input) {
  const raw = String(input ?? '');
  if (raw.length > MAX_LEN) {
    return { ok: false, error: 'Отзыв не более 2000 символов' };
  }

  let out = '';
  let i = 0;
  while (i < raw.length) {
    const lt = raw.indexOf('<', i);
    if (lt === -1) {
      out += escapeHtml(raw.slice(i));
      break;
    }
    // text before tag
    out += escapeHtml(raw.slice(i, lt));
    const gt = raw.indexOf('>', lt + 1);
    if (gt === -1) {
      // broken tag -> treat as text
      out += escapeHtml(raw.slice(lt));
      break;
    }

    const tagContent = raw.slice(lt + 1, gt);
    i = gt + 1;

    // comments/doctype -> drop
    if (/^\s*!/i.test(tagContent) || /^\s*\?/i.test(tagContent) || /^\s*!--/.test(tagContent)) {
      continue;
    }

    const m = tagContent.match(/^\s*(\/)?\s*([a-zA-Z0-9]+)([\s\S]*)$/);
    if (!m) continue;

    const closing = !!m[1];
    const tag = String(m[2] || '').toLowerCase();
    const rest = String(m[3] || '');

    if (!ALLOWED_TAGS.has(tag)) {
      continue;
    }

    if (closing) {
      out += `</${tag}>`;
      continue;
    }

    if (tag !== 'a') {
      out += `<${tag}>`;
      continue;
    }

    // <a ...> keep only href
    let href = null;
    const hrefMatch = rest.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i);
    if (hrefMatch) href = hrefMatch[1] ?? hrefMatch[2] ?? hrefMatch[3] ?? null;

    if (href && isSafeHref(href)) {
      out += `<a href="${escapeHtml(href)}">`;
    } else {
      out += `<a href="#">`;
    }
  }

  return { ok: true, value: out };
}

module.exports = { sanitizeReviewHtml };

