const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

// Backend selection:
//   - 'memory' (or Vercel serverless with no writable FS) → all db.* calls
//     become safe no-ops that read/write the in-memory Maps in server.js.
//     No SQLite file is opened, nothing is persisted across restarts.
//   - 'sqlite' (default for local dev) → original sql.js behavior.
// Set DATABASE_BACKEND=memory in the environment to force memory mode.
const BACKEND = (process.env.DATABASE_BACKEND || '').toLowerCase();
const isServerless = process.env.VERCEL === '1';
const MEMORY_BACKEND = BACKEND === 'memory' || (isServerless && BACKEND !== 'sqlite');
const dbPath = isServerless
  ? '/tmp/casino.sqlite'
  : path.join(__dirname, 'casino.sqlite');
const SOURCE_DB_PATH = '/var/task/casino.sqlite';

let initPromise = null;
let db = null;
let persistWarned = false;
let memoryWarned = false;

async function getDb() {
  if (initPromise) await initPromise;
  if (!db) throw new Error('Database not initialized');
  return db;
}

function createSchema() {
  const database = db;

  database.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT,
    password TEXT,
    gc_balance REAL DEFAULT 10000.0,
    sc_unplayed REAL DEFAULT 10.0,
    sc_played REAL DEFAULT 0.0,
    stripe_account_id TEXT,
    kyc_status TEXT DEFAULT 'UNVERIFIED',
    kyc_tier INTEGER DEFAULT 0,
    kyc_inquiry_id TEXT,
    kyc_verified_at TEXT,
    kyc_rejection_reason TEXT,
    last_daily_claim INTEGER DEFAULT 0,
    daily_streak INTEGER DEFAULT 0,
    ads_watched_today INTEGER DEFAULT 0,
    last_ad_reset INTEGER DEFAULT 0,
    state TEXT DEFAULT 'CA',
    created_at INTEGER DEFAULT 0,
    vip_tier TEXT DEFAULT 'Bronze',
    total_wagered_gc REAL DEFAULT 0,
    total_wagered_sc REAL DEFAULT 0,
    rakeback_accrued_sc REAL DEFAULT 0,
    geo_ip TEXT,
    geo_country TEXT,
    geo_city TEXT,
    geo_is_vpn INTEGER DEFAULT 0,
    geo_risk_score INTEGER DEFAULT 0,
    registered_at INTEGER DEFAULT 0,
    referral_code TEXT,
    referred_by INTEGER,
    is_guest INTEGER DEFAULT 0,
    didit_session_id TEXT
   )`);

  const existingCols = new Set();
  try {
    const colStmt = database.prepare('PRAGMA table_info(users)');
    while (colStmt.step()) {
      const col = colStmt.getAsObject();
      existingCols.add(col.name);
    }
    colStmt.free();
  } catch (e) {}

  const ensureColumn = (name, def) => {
    if (!existingCols.has(name)) {
      database.run(`ALTER TABLE users ADD COLUMN ${name} ${def}`);
    }
  };
  ensureColumn('referral_code', 'TEXT');
  ensureColumn('referred_by', 'INTEGER');
  ensureColumn('is_guest', 'INTEGER DEFAULT 0');
  ensureColumn('didit_session_id', 'TEXT');
  ensureColumn('password_reset_token', 'TEXT');
  ensureColumn('password_reset_expiry', 'INTEGER DEFAULT 0');


  db.run(`CREATE TABLE IF NOT EXISTS provably_fair_seeds (
    user_id INTEGER PRIMARY KEY,
    server_seed TEXT NOT NULL,
    client_seed TEXT DEFAULT 'default_client_seed',
    nonce INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    description TEXT,
    gc_delta REAL DEFAULT 0,
    sc_delta REAL DEFAULT 0,
    currency TEXT,
    amount REAL,
    status TEXT DEFAULT 'COMPLETED',
    metadata TEXT,
    timestamp TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS bonus_state (
    user_id INTEGER PRIMARY KEY,
    last_claim_at INTEGER DEFAULT 0,
    claim_streak INTEGER DEFAULT 0,
    daily_claimed INTEGER DEFAULT 0,
    challenge_date TEXT DEFAULT '',
    challenges TEXT DEFAULT '[]',
    rakeback_last_daily INTEGER DEFAULT 0,
    rakeback_last_weekly INTEGER DEFAULT 0,
    rakeback_last_monthly INTEGER DEFAULT 0,
    rakeback_daily_pool REAL DEFAULT 0,
    rakeback_weekly_pool REAL DEFAULT 0,
    rakeback_monthly_pool REAL DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS affiliates (
    user_id INTEGER PRIMARY KEY,
    referral_code TEXT UNIQUE NOT NULL,
    referred_by INTEGER,
    created_at INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (referred_by) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS affiliate_earnings (
    id TEXT PRIMARY KEY,
    affiliate_user_id INTEGER NOT NULL,
    referred_user_id INTEGER NOT NULL,
    source TEXT NOT NULL,
    amount_sc REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS telemetry (
    user_id INTEGER PRIMARY KEY,
    sc_wagered REAL DEFAULT 0,
    gc_wagered REAL DEFAULT 0,
    rounds INTEGER DEFAULT 0,
    rounds_won INTEGER DEFAULT 0,
    games_played TEXT DEFAULT '[]',
    daily_loss_sc REAL DEFAULT 0,
    daily_wager_sc REAL DEFAULT 0,
    daily_win_sc REAL DEFAULT 0,
    weekly_loss_sc REAL DEFAULT 0,
    weekly_wager_sc REAL DEFAULT 0,
    weekly_win_sc REAL DEFAULT 0,
    monthly_loss_sc REAL DEFAULT 0,
    monthly_wager_sc REAL DEFAULT 0,
    monthly_win_sc REAL DEFAULT 0,
    dice_over90 REAL DEFAULT 0,
    crash_cashout2x INTEGER DEFAULT 0,
    blackjack_hands INTEGER DEFAULT 0,
    sc_unplayed REAL DEFAULT 0,
    sc_played REAL DEFAULT 0,
    gc_balance REAL DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS jackpot_pool (
    id INTEGER PRIMARY KEY,
    daily REAL DEFAULT 1000,
    minor REAL DEFAULT 2000,
    major REAL DEFAULT 10000,
    grand REAL DEFAULT 50000
  )`);

  db.run(`INSERT OR IGNORE INTO jackpot_pool (id) VALUES (1)`);

  db.run(`CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_transactions_timestamp ON transactions(timestamp)`);
}

function persistSync() {
  if (!db) return;
  try {
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
  } catch (e) {
    if (!persistWarned) {
      persistWarned = true;
      console.warn('[Persistence]: Read-only filesystem at ' + dbPath + ' — data is in-memory only. Changes will not persist across cold starts.');
    }
  }
}

let persistScheduled = false;
function scheduleSave() {
  if (persistScheduled) return;
  persistScheduled = true;
  setImmediate(() => {
    persistScheduled = false;
    persistSync();
  });
}

if (MEMORY_BACKEND) {
  // In memory mode we don't open SQLite at all — the in-memory Maps in
  // server.js (users, transactions) hold the live data. Skip the heavy
  // initSqlJs() call so cold starts are fast on Vercel.
  initPromise = Promise.resolve(null);
  if (!memoryWarned) {
    memoryWarned = true;
    console.log('[Database]: Running in MEMORY backend mode (no persistence).');
  }
} else {
  initPromise = (async () => {
    let SQL;
    try {
      SQL = await initSqlJs();
    } catch (e) {
      console.error('[DB]: Failed to load sql.js:', e.message);
      return null;
    }

    if (!SQL || typeof SQL.Database !== 'function') {
      console.error('[DB]: sql.js Database constructor not available');
      return null;
    }

    if (fs.existsSync(dbPath)) {
      try {
        const filebuffer = fs.readFileSync(dbPath);
         db = new SQL.Database(filebuffer);
      } catch (e) {
        console.error('[DB]: Failed to load existing database, starting fresh:', e.message);
        db = new SQL.Database();
      }
    } else if (isServerless && fs.existsSync(SOURCE_DB_PATH)) {
      try {
        const filebuffer = fs.readFileSync(SOURCE_DB_PATH);
        db = new SQL.Database(filebuffer);
      } catch (e) {
        console.error('[DB]: Failed to load seed DB from /var/task, starting fresh:', e.message);
        db = new SQL.Database();
      }
    } else {
      db = new SQL.Database();
    }

    createSchema();
    persistSync();
    return db;
  })();
}

const REAL_DB = {
  getDb,
  createSchema,
  persistSync,
  scheduleSave,
  initPromise,

  createUser: async (params) => {
    const database = await getDb();
    const { username, email, password, gcBalance = 10000, scBalance = 10 } = params;
    const now = Date.now();
    database.run(
      'INSERT INTO users (username, email, password, gc_balance, sc_unplayed, created_at, registered_at, is_guest) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [username, email, password, gcBalance, scBalance, now, now, email && email.endsWith('@guest.casino') ? 1 : 0]
    );
    scheduleSave();
    const stmt = database.prepare('SELECT id FROM users WHERE username = ?');
    stmt.bind([username]);
    const result = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
    return result ? result.id : null;
  },

  getUserById: async (id) => {
    const database = await getDb();
    const stmt = database.prepare('SELECT * FROM users WHERE id = ?');
    stmt.bind([id]);
    const result = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
    return result;
  },

  getBonusState: async (userId) => {
    const database = await getDb();
    const stmt = database.prepare('SELECT * FROM bonus_state WHERE user_id = ?');
    stmt.bind([userId]);
    const result = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
    return result;
  },

  saveBonusState: async (userId, bonus) => {
    const database = await getDb();
    const b = bonus || {};
    database.run(
      `INSERT OR REPLACE INTO bonus_state
       (user_id, last_claim_at, claim_streak, daily_claimed, challenge_date, challenges,
        rakeback_last_daily, rakeback_last_weekly, rakeback_last_monthly,
        rakeback_daily_pool, rakeback_weekly_pool, rakeback_monthly_pool)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        b.lastClaimAt || 0,
        b.claimStreak || 0,
        b.dailyClaimed ? 1 : 0,
        b.challengeDate || '',
        JSON.stringify(b.challenges || []),
        b.rakeback?.lastDailyAt || 0,
        b.rakeback?.lastWeeklyAt || 0,
        b.rakeback?.lastMonthlyAt || 0,
        b.rakeback?.dailyPool || 0,
        b.rakeback?.weeklyPool || 0,
        b.rakeback?.monthlyPool || 0
      ]
    );
    scheduleSave();
  },

  findByEmail: async (email) => {
    const database = await getDb();
    const stmt = database.prepare('SELECT * FROM users WHERE email = ?');
    stmt.bind([email]);
    const result = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
    return result;
  },

  findByUsername: async (username) => {
    const database = await getDb();
    const stmt = database.prepare('SELECT * FROM users WHERE username = ?');
    stmt.bind([username]);
    const result = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
    return result;
  },

  updateUser: async (id, fields) => {
    const database = await getDb();
    const keys = Object.keys(fields);
    if (keys.length === 0) return;
    const setClause = keys.map(k => `${k} = ?`).join(', ');
    const values = keys.map(k => fields[k]);
    values.push(id);
    database.run(`UPDATE users SET ${setClause} WHERE id = ?`, values);
    scheduleSave();
  },

  adjustBalance: async (id, gcDelta = 0, scDelta = 0) => {
    const database = await getDb();
    if (gcDelta !== 0) {
      database.run('UPDATE users SET gc_balance = gc_balance + ? WHERE id = ?', [gcDelta, id]);
    }
    if (scDelta !== 0) {
      database.run('UPDATE users SET sc_unplayed = sc_unplayed + ? WHERE id = ?', [scDelta, id]);
    }
    scheduleSave();
  },

  addTransaction: async (tx) => {
    const database = await getDb();
    database.run(
      'INSERT INTO transactions (id, user_id, type, description, gc_delta, sc_delta, currency, amount, status, metadata, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        tx.id, tx.userId, tx.type, tx.description, tx.gcDelta || 0, tx.scDelta || 0,
        tx.currency || null, tx.amount || 0, tx.status || 'COMPLETED',
        JSON.stringify(tx.metadata || {}), tx.timestamp || new Date().toISOString()
      ]
    );
    scheduleSave();
  },

  getTransactions: async (userId, limit = 100) => {
    const database = await getDb();
    const stmt = database.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?');
    stmt.bind([userId, limit]);
    const results = [];
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();
    return results;
  },

  getSeed: async (userId) => {
    const database = await getDb();
    const stmt = database.prepare('SELECT * FROM provably_fair_seeds WHERE user_id = ?');
    stmt.bind([userId]);
    const result = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
    return result;
  },

  saveSeed: async (userId, serverSeed, clientSeed, nonce = 0) => {
    const database = await getDb();
    database.run(
      'INSERT OR REPLACE INTO provably_fair_seeds (user_id, server_seed, client_seed, nonce) VALUES (?, ?, ?, ?)',
      [userId, serverSeed, clientSeed, nonce]
    );
    scheduleSave();
  },

  updateNonce: async (userId, nonce) => {
    const database = await getDb();
    database.run('UPDATE provably_fair_seeds SET nonce = ? WHERE user_id = ?', [nonce, userId]);
    scheduleSave();
  },

  getTotalWagered: async () => {
    const database = await getDb();
    const result = database.exec('SELECT SUM(total_wagered_gc), SUM(total_wagered_sc) FROM users');
    return {
      totalGC: result[0]?.values[0]?.[0] || 0,
      totalSC: result[0]?.values[0]?.[1] || 0
    };
  },

  getAffiliateByUserId: async (userId) => {
    const database = await getDb();
    const stmt = database.prepare('SELECT * FROM affiliates WHERE user_id = ?');
    stmt.bind([userId]);
    const result = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
    return result;
  },

  getAffiliateByCode: async (code) => {
    const database = await getDb();
    const stmt = database.prepare('SELECT * FROM affiliates WHERE referral_code = ?');
    stmt.bind([code]);
    const result = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
    return result;
  },

  createAffiliate: async (userId, referralCode, referredBy = null) => {
    const database = await getDb();
    database.run(
      'INSERT OR IGNORE INTO affiliates (user_id, referral_code, referred_by, created_at) VALUES (?, ?, ?, ?)',
      [userId, referralCode, referredBy, Date.now()]
    );
    scheduleSave();
  },

  setAffiliateReferredBy: async (userId, referredBy) => {
    const database = await getDb();
    database.run('UPDATE affiliates SET referred_by = ? WHERE user_id = ?', [referredBy, userId]);
    scheduleSave();
  },

  getReferrals: async (affiliateUserId) => {
    const database = await getDb();
    const stmt = database.prepare('SELECT u.id, u.username, u.created_at, ae.amount_sc FROM users u JOIN affiliate_earnings ae ON ae.referred_user_id = u.id WHERE ae.affiliate_user_id = ? ORDER BY ae.created_at DESC');
    stmt.bind([affiliateUserId]);
    const results = [];
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();
    return results;
  },

  addAffiliateEarning: async (earning) => {
    const database = await getDb();
    database.run(
      'INSERT INTO affiliate_earnings (id, affiliate_user_id, referred_user_id, source, amount_sc, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [earning.id, earning.affiliateUserId, earning.referredUserId, earning.source, earning.amountSC, earning.timestamp || new Date().toISOString()]
    );
    scheduleSave();
  },

  getReferredUsers: async (affiliateUserId) => {
    const database = await getDb();
    const stmt = database.prepare(`
      SELECT u.id, u.username, u.created_at as referred_at
      FROM users u
      JOIN affiliates a ON u.id = a.user_id AND a.referred_by = ?
      ORDER BY a.created_at DESC
    `);
    stmt.bind([affiliateUserId]);
    const results = [];
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();
    return results;
  },

  getAffiliateEarningsTotals: async (affiliateUserId) => {
    const database = await getDb();
    const stmt = database.prepare(`
      SELECT source, COALESCE(SUM(amount_sc), 0) as total
      FROM affiliate_earnings
      WHERE affiliate_user_id = ?
      GROUP BY source
    `);
    stmt.bind([affiliateUserId]);
    const totals = {};
    while (stmt.step()) {
      const row = stmt.getAsObject();
      totals[row.source] = row.total;
    }
    stmt.free();
    return totals;
  },

  getAffiliateEarnings: async (affiliateUserId, limit = 50) => {
    const database = await getDb();
    const stmt = database.prepare(`
      SELECT *
      FROM affiliate_earnings
      WHERE affiliate_user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `);
    stmt.bind([affiliateUserId, limit]);
    const results = [];
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();
    return results;
  },

  getTelemetry: async (userId) => {
    const database = await getDb();
    const stmt = database.prepare('SELECT * FROM telemetry WHERE user_id = ?');
    stmt.bind([userId]);
    const result = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
    return result;
  },

  saveTelemetry: async (userId, tel) => {
    const database = await getDb();
    const t = tel || {};
    database.run(
      `INSERT OR REPLACE INTO telemetry
       (user_id, sc_wagered, gc_wagered, rounds, rounds_won, games_played,
        daily_loss_sc, daily_wager_sc, daily_win_sc, weekly_loss_sc, weekly_wager_sc, weekly_win_sc,
        monthly_loss_sc, monthly_wager_sc, monthly_win_sc, dice_over90, crash_cashout2x,
        blackjack_hands, sc_unplayed, sc_played, gc_balance)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId, t.scWagered || 0, t.gcWagered || 0, t.rounds || 0, t.roundsWon || 0,
        JSON.stringify(t.gamesPlayed || []),
        t.dailyLossSC || 0, t.dailyWagerSC || 0, t.dailyWinSC || 0,
        t.weeklyLossSC || 0, t.weeklyWagerSC || 0, t.weeklyWinSC || 0,
        t.monthlyLossSC || 0, t.monthlyWagerSC || 0, t.monthlyWinSC || 0,
        t.diceOver90 || 0, t.crashCashout2x || 0, t.blackjackHands || 0,
        t.scUnplayed || 0, t.scPlayed || 0, t.gcBalance || 0
      ]
    );
    scheduleSave();
  },

  getJackpotPool: async () => {
    const database = await getDb();
    const stmt = database.prepare('SELECT * FROM jackpot_pool WHERE id = 1');
    const result = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
    return result;
  },

  updateJackpotPool: async (pool) => {
    const database = await getDb();
    database.run(
      'INSERT OR REPLACE INTO jackpot_pool (id, daily, minor, major, grand) VALUES (1, ?, ?, ?, ?)',
      [pool.daily || 1000, pool.minor || 2000, pool.major || 10000, pool.grand || 50000]
    );
    scheduleSave();
  },

  getAllUsers: async () => {
    const database = await getDb();
    const stmt = database.prepare('SELECT * FROM users');
    const users = [];
    while (stmt.step()) {
      users.push(stmt.getAsObject());
    }
    stmt.free();
    return users;
  },

  getUserCount: async () => {
    const database = await getDb();
    const result = database.exec('SELECT COUNT(*) as count FROM users');
    return result[0]?.values[0]?.[0] || 0;
  }
};

// In-memory backend stub. When DATABASE_BACKEND=memory (or we're on Vercel
// without a writable filesystem), every db.* call becomes a safe no-op. The
// in-memory Maps in server.js (users, transactions) hold the live data, so
// the server still works — just nothing is persisted across cold starts.
const MEMORY_STUB = {
  getDb: async () => null,
  createSchema: async () => {},
  persistSync: () => {},
  scheduleSave: () => {},
  initPromise: Promise.resolve(),
  isMemoryBackend: true,

  // Reads return null/empty so callers fall through to the in-memory Maps.
  getUserById: async () => null,
  findByEmail: async () => null,
  findByUsername: async () => null,
  getBonusState: async () => null,
  getSeed: async () => null,
  getTelemetry: async () => null,
  getTransactions: async () => [],
  getTotalWagered: async () => ({ totalGC: 0, totalSC: 0 }),
  getAffiliateByUserId: async () => null,
  getAffiliateByCode: async () => null,
  getReferrals: async () => [],
  getReferredUsers: async () => [],
  getAffiliateEarningsTotals: async () => ({}),
  getAffiliateEarnings: async () => [],
  getJackpotPool: async () => null,
  getAllUsers: async () => [],
  getUserCount: async () => 0,

  // Writes are accepted but discarded. They log once so we know we're in
  // memory mode in production. createUser returns a unique numeric id so
  // server.js can store the new user in its in-memory Map.
  _nextUserId: 1000,
  createUser: async function (params) {
    const id = this._nextUserId++;
    return id;
  },
  updateUser: async () => {},
  adjustBalance: async () => {},
  saveBonusState: async () => {},
  saveSeed: async () => {},
  updateNonce: async () => {},
  saveTelemetry: async () => {},
  addTransaction: async () => {},
  createAffiliate: async () => {},
  setAffiliateReferredBy: async () => {},
  addAffiliateEarning: async () => {},
  updateJackpotPool: async () => {}
};

if (MEMORY_BACKEND) {
  if (!memoryWarned) {
    memoryWarned = true;
    console.log('[Database]: Running in MEMORY backend mode (no persistence). ' +
      'Set DATABASE_BACKEND=sqlite to force the on-disk SQLite file.');
  }
  module.exports = MEMORY_STUB;
} else {
  module.exports = REAL_DB;
}
