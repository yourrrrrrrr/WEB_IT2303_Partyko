/**
 * stripHtml — очистка HTML-тегов через RegExp.
 * validateSchema(schema) — middleware валидации и санитизации входных данных.
 */

function stripHtml(str) {
  if (str == null || typeof str !== 'string') return '';
  return str.replace(/<[^>]*>/g, '').trim();
}

const schemaValidators = {
  string: (v, opts) => {
    if (typeof v !== 'string') return { valid: false, message: 'Ожидается строка' };
    const s = opts?.stripHtml ? stripHtml(v) : v.trim();
    if (opts?.minLength != null && s.length < opts.minLength) return { valid: false, message: `Минимум ${opts.minLength} символов` };
    if (opts?.maxLength != null && s.length > opts.maxLength) return { valid: false, message: `Максимум ${opts.maxLength} символов` };
    return { valid: true, value: s };
  },
  email: (v) => {
    if (typeof v !== 'string') return { valid: false, message: 'Ожидается email' };
    const s = v.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return { valid: false, message: 'Некорректный email' };
    return { valid: true, value: s };
  },
  number: (v, opts) => {
    const n = Number(v);
    if (Number.isNaN(n)) return { valid: false, message: 'Ожидается число' };
    if (opts?.min != null && n < opts.min) return { valid: false, message: `Минимум ${opts.min}` };
    if (opts?.max != null && n > opts.max) return { valid: false, message: `Максимум ${opts.max}` };
    return { valid: true, value: n };
  },
  enum: (v, opts) => {
    const allowed = opts?.values;
    if (!allowed || !allowed.includes(v)) return { valid: false, message: `Допустимые значения: ${allowed.join(', ')}` };
    return { valid: true, value: v };
  }
};

function validateSchema(schema) {
  return (req, res, next) => {
    const body = req.body || {};
    const query = req.query || {};
    const params = req.params || {};
    const errors = [];
    const sanitized = {};

    for (const [key, rule] of Object.entries(schema)) {
      const source = rule.source === 'query' ? query : rule.source === 'params' ? params : body;
      let value = source[key];
      if (value === undefined && rule.optional) continue;
      if (value === undefined && !rule.optional) {
        errors.push(`${key}: обязательное поле`);
        continue;
      }
      const validator = schemaValidators[rule.type] || schemaValidators.string;
      const result = validator(value, rule);
      if (!result.valid) {
        errors.push(`${key}: ${result.message}`);
      } else {
        sanitized[key] = result.value;
      }
    }

    if (errors.length) {
      return res.status(400).json({ error: 'Валидация не пройдена', details: errors });
    }
    req.sanitized = sanitized;
    next();
  };
}

module.exports = { stripHtml, validateSchema, schemaValidators };
