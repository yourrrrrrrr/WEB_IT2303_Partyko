const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'reviews.db');

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
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        price_cents INTEGER NOT NULL DEFAULT 0
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        author TEXT NOT NULL,
        body_html TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
      )
    `);
  });
}

function seedDb(db) {
  db.serialize(() => {
    // products
    db.get('SELECT COUNT(*) AS c FROM products', [], (err, row) => {
      if (err) return;
      if ((row?.c || 0) > 0) return;
      const stmt = db.prepare('INSERT INTO products(name, price_cents) VALUES (?, ?)');
      stmt.run(['Keyboard', 3999]);
      stmt.run(['Mouse', 1999]);
      stmt.run(['Monitor', 14999]);
      stmt.finalize();
    });
  });
}

module.exports = { openDb, initDb, seedDb, DB_PATH };

