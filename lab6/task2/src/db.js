const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'platform.db');

function openDb() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  return new sqlite3.Database(DB_PATH);
}

function initDb(db) {
  db.serialize(() => {
    db.run('PRAGMA foreign_keys = ON');

    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user','admin'))
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS articles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        author_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')),
        created_at TEXT NOT NULL,
        FOREIGN KEY(author_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        article_id INTEGER NOT NULL,
        author_id INTEGER NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE,
        FOREIGN KEY(author_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
  });
}

async function seedDb(db) {
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
  const alicePassword = process.env.ALICE_PASSWORD || 'alice123';

  const adminHash = await bcrypt.hash(adminPassword, 10);
  const aliceHash = await bcrypt.hash(alicePassword, 10);

  await new Promise((resolve) => {
    db.serialize(() => {
      db.run(
        'INSERT OR IGNORE INTO users(username, password_hash, role) VALUES (?, ?, ?)',
        ['admin', adminHash, 'admin']
      );
      db.run(
        'INSERT OR IGNORE INTO users(username, password_hash, role) VALUES (?, ?, ?)',
        ['alice', aliceHash, 'user']
      );

      db.get('SELECT id FROM users WHERE username = ?', ['admin'], (err, row) => {
        const adminId = row?.id;
        if (!adminId) return resolve();

        db.get('SELECT COUNT(*) AS c FROM articles', [], (err2, row2) => {
          if (err2) return resolve();
          if ((row2?.c || 0) > 0) return resolve();

          const now = new Date().toISOString();
          db.run(
            'INSERT INTO articles(title, content, author_id, status, created_at) VALUES (?, ?, ?, ?, ?)',
            ['Draft article', 'Hello from draft', adminId, 'draft', now]
          );
          db.run(
            'INSERT INTO articles(title, content, author_id, status, created_at) VALUES (?, ?, ?, ?, ?)',
            ['Published article', 'Hello from published', adminId, 'published', now]
          );
          resolve();
        });
      });
    });
  });

  // Return demo creds (for report), NOT via API
  return {
    adminPassword,
    alicePassword,
    jwtSecretHint: crypto.createHash('sha256').update(String(process.env.JWT_SECRET || '')).digest('hex').slice(0, 8)
  };
}

module.exports = { DB_PATH, openDb, initDb, seedDb };

