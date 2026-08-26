const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'casino.sqlite');
let db = null;
let saveScheduled = false;

// Shared initialization promise prevents race conditions
const initPromise = (async () => {
  const SQL = await initSqlJs();
  if (fs.existsSync(dbPath)) {
    const filebuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(filebuffer);
  } else {
    db = new SQL.Database();
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        gc_balance REAL DEFAULT 10000.0,
        sc_balance REAL DEFAULT 10.0
      )
    `);
    persistSync();
  }
  return db;
})();

// Immediate sync save (used for initial creation or graceful shutdown)
function persistSync() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}

// Batched asynchronous persistence to protect I/O performance
function scheduleSave() {
  if (saveScheduled) return;
  saveScheduled = true;
  setImmediate(() => {
    persistSync();
    saveScheduled = false;
  });
}

// Ensures db is fully initialized before executing queries
async function getDb() {
  if (!db) await initPromise;
  return db;
}

module.exports = {
  getDb,
  findById: async (id) => {
    const database = await getDb();
    const stmt = database.prepare('SELECT * FROM users WHERE id = :id');
    const result = stmt.getAsObject({ ':id': id });
    stmt.free();
    return result.id ? result : null;
  },
  updateBalances: async ({ gcDelta, scDelta, userId }) => {
    const database = await getDb();
    database.run(
      'UPDATE users SET gc_balance = gc_balance + :gc, sc_balance = sc_balance + :sc WHERE id = :id',
      { ':gc': gcDelta, ':sc': scDelta, ':id': userId }
    );
    scheduleSave();
  },
  persistSync
};