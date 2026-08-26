const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'casino.sqlite');
let db;

// Initialize Database asynchronously
(async () => {
  const SQL = await initSqlJs();
  if (fs.existsSync(dbPath)) {
    const filebuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(filebuffer);
  } else {
    db = new SQL.Database();
    db.run(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        gc_balance REAL DEFAULT 10000.0,
        sc_balance REAL DEFAULT 10.0
      )
    `);
    saveDb();
  }
})();

function saveDb() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
}

module.exports = {
  findById: {
    get: (id) => {
      if (!db) return null;
      const stmt = db.prepare('SELECT * FROM users WHERE id = :id');
      const result = stmt.getAsObject({ ':id': id });
      stmt.free();
      return result.id ? result : null;
    }
  },
  updateBalances: {
    run: ({ gcDelta, scDelta, userId }) => {
      if (!db) return;
      db.run(
        'UPDATE users SET gc_balance = gc_balance + :gc, sc_balance = sc_balance + :sc WHERE id = :id',
        { ':gc': gcDelta, ':sc': scDelta, ':id': userId }
      );
      saveDb();
    }
  }
};