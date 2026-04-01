const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { logUploadError } = require('./security/logging');

const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');

function ensureUploadDir() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function extFromFilename(name) {
  const ext = path.extname(String(name || '')).toLowerCase();
  return ext.startsWith('.') ? ext.slice(1) : ext;
}

const ALLOWED_EXT = new Set(['jpg', 'jpeg', 'png', 'gif']);
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/gif']);

function fileFilter(req, file, cb) {
  const ext = extFromFilename(file.originalname);
  const okExt = ALLOWED_EXT.has(ext);
  const okMime = ALLOWED_MIME.has(String(file.mimetype || '').toLowerCase());
  if (!okExt || !okMime) {
    logUploadError('invalid_type', `${file.originalname} (${file.mimetype})`);
    return cb(new Error('Недопустимый тип файла'));
  }
  cb(null, true);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    ensureUploadDir();
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const ext = extFromFilename(file.originalname);
    const safeExt = ALLOWED_EXT.has(ext) ? ext : 'bin';
    cb(null, `${uuidv4()}.${safeExt}`);
  }
});

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

module.exports = { upload, ensureUploadDir, UPLOAD_DIR };

