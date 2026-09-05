const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

// On Vercel / serverless, /var/task is read-only — use /tmp for persistence
const isServerless = process.env.VERCEL === '1' || !!process.env.VERCEL;
const SOURCE_DB_PATH = path.join(__dirname, 'casino.sqlite');
const dbPath = isServerless ? '/tmp/casino.sqlite' : SOURCE_DB_PATH;
let db = null;
let saveScheduled = false;

const initPromise = (async () => {
  const SQL = await initSqlJs();
  if (fs.existsSync(dbPath)) {
    const filebuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(filebuffer);
    ensureSchema();
  } else if (isServerless && fs.existsSync(SOURCE_DB_PATH)) {
    // Cold start on Vercel: copy the read-only /var/task DB to /tmp
    try {
      const filebuffer = fs.readFileSync(SOURCE_DB_PATH);
      db = new SQL.Database(filebuffer);
      ensureSchema();
      persistSync();
    } catch (e) {
      console.error('[Persistence]: Failed to copy DB from source on serverless, starting fresh:', e.message);
      db = new SQL.Database();
      createSchema();
    }
  } else {
    db = new SQL.Database();
    createSchema();
    persistSync();
  }
  return db;
})();

function createSchema() {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
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
      registered_at INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS provably_fair_seeds (
      user_id INTEGER PRIMARY KEY,
      server_seed TEXT NOT NULL,
      client_seed TEXT DEFAULT 'default_client_seed',
      nonce INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS transactions (
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
      timestamp TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS bonus_state (
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
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS telemetry (
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
      history TEXT DEFAULT '[]',
      last_daily_reset INTEGER DEFAULT 0,
      last_weekly_reset INTEGER DEFAULT 0,
      last_monthly_reset INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS jackpot_pool (
      id INTEGER PRIMARY KEY DEFAULT 1,
      mini REAL DEFAULT 50,
      minor REAL DEFAULT 200,
      major REAL DEFAULT 1000,
      grand REAL DEFAULT 10000
    )
  `);

  db.run(`INSERT OR IGNORE INTO jackpot_pool (id) VALUES (1)`);

  db.run(`CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_transactions_timestamp ON transactions(timestamp)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS affiliates (
      user_id INTEGER PRIMARY KEY,
      referral_code TEXT UNIQUE NOT NULL,
      referred_by INTEGER,
      created_at INTEGER DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (referred_by) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS affiliate_earnings (
      id TEXT PRIMARY KEY,
      affiliate_user_id INTEGER NOT NULL,
      referred_user_id INTEGER NOT NULL,
      source TEXT NOT NULL,
      amount_sc REAL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_affiliate_earnings_user ON affiliate_earnings(affiliate_user_id)`);
}

function ensureSchema() {
  const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
  const tableNames = tables.length ? tables[0].values.map(r => r[0]) : [];

  if (!tableNames.includes('users')) {
    createSchema();
    return;
  }

  const columns = db.exec("PRAGMA table_info(users)");
  const colNames = columns.length ? columns[0].values.map(r => r[1]) : [];

  const requiredColumns = [
    'sc_unplayed', 'sc_played', 'stripe_account_id', 'kyc_status', 'kyc_tier',
    'kyc_inquiry_id', 'kyc_verified_at', 'kyc_rejection_reason',
    'last_daily_claim', 'daily_streak', 'ads_watched_today', 'last_ad_reset',
    'state', 'created_at', 'vip_tier', 'total_wagered_gc', 'total_wagered_sc', 'rakeback_accrued_sc',
    'password_reset_token', 'password_reset_expiry'
  ];

  for (const col of requiredColumns) {
    if (!colNames.includes(col)) {
      try {
        const colDef = {
          sc_unplayed: 'REAL DEFAULT 10.0',
          sc_played: 'REAL DEFAULT 0.0',
          stripe_account_id: 'TEXT',
          kyc_status: "TEXT DEFAULT 'UNVERIFIED'",
          kyc_tier: 'INTEGER DEFAULT 0',
          kyc_inquiry_id: 'TEXT',
          kyc_verified_at: 'TEXT',
          kyc_rejection_reason: 'TEXT',
          last_daily_claim: 'INTEGER DEFAULT 0',
          daily_streak: 'INTEGER DEFAULT 0',
          ads_watched_today: 'INTEGER DEFAULT 0',
          last_ad_reset: 'INTEGER DEFAULT 0',
          state: "TEXT DEFAULT 'CA'",
          created_at: 'INTEGER DEFAULT 0',
          vip_tier: "TEXT DEFAULT 'Bronze'",
          total_wagered_gc: 'REAL DEFAULT 0',
          total_wagered_sc: 'REAL DEFAULT 0',
          rakeback_accrued_sc: 'REAL DEFAULT 0',
          password_reset_token: 'TEXT',
          password_reset_expiry: 'INTEGER DEFAULT 0'
        }[col];
        db.run(`ALTER TABLE users ADD COLUMN ${col} ${colDef}`);
      } catch (e) {
        console.error(`[Migration]: Failed to add column ${col}:`, e.message);
      }
    }
  }

  if (colNames.includes('sc_balance') && !colNames.includes('sc_unplayed')) {
    db.run("UPDATE users SET sc_unplayed = sc_balance WHERE sc_unplayed IS NULL");
  }

  if (!tableNames.includes('provably_fair_seeds')) {
    db.run(`
      CREATE TABLE provably_fair_seeds (
        user_id INTEGER PRIMARY KEY,
        server_seed TEXT NOT NULL,
        client_seed TEXT DEFAULT 'default_client_seed',
        nonce INTEGER DEFAULT 0
      )
    `);
  }

  if (!tableNames.includes('transactions')) {
    db.run(`
      CREATE TABLE transactions (
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
        timestamp TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  if (!tableNames.includes('bonus_state')) {
    db.run(`
      CREATE TABLE bonus_state (
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
      )
    `);
  }

  if (!tableNames.includes('telemetry')) {
    db.run(`
      CREATE TABLE telemetry (
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
        history TEXT DEFAULT '[]',
        last_daily_reset INTEGER DEFAULT 0,
        last_weekly_reset INTEGER DEFAULT 0,
        last_monthly_reset INTEGER DEFAULT 0
      )
    `);
  }

  if (!tableNames.includes('jackpot_pool')) {
    db.run(`
      CREATE TABLE jackpot_pool (
        id INTEGER PRIMARY KEY DEFAULT 1,
        mini REAL DEFAULT 50,
        minor REAL DEFAULT 200,
        major REAL DEFAULT 1000,
        grand REAL DEFAULT 10000
      )
    `);
    db.run(`INSERT OR IGNORE INTO jackpot_pool (id) VALUES (1)`);
  }

  if (!tableNames.includes('affiliates')) {
    db.run(`
      CREATE TABLE affiliates (
        user_id INTEGER PRIMARY KEY,
        referral_code TEXT UNIQUE NOT NULL,
        referred_by INTEGER,
        created_at INTEGER DEFAULT 0
      )
    `);
  }

  if (!tableNames.includes('affiliate_earnings')) {
    db.run(`
      CREATE TABLE affiliate_earnings (
        id TEXT PRIMARY KEY,
        affiliate_user_id INTEGER NOT NULL,
        referred_user_id INTEGER NOT NULL,
        source TEXT NOT NULL,
        amount_sc REAL DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_affiliate_earnings_user ON affiliate_earnings(affiliate_user_id)`);
  }

  const geoColumns = ['geo_ip', 'geo_country', 'geo_city', 'geo_is_vpn', 'geo_risk_score', 'registered_at', 'password_reset_token', 'password_reset_expiry'];
  const existingCols = tableNames.includes('users')
    ? (() => {
        const stmt = db.prepare("PRAGMA table_info(users)");
        const cols = [];
        while (stmt.step()) {
          cols.push(stmt.getAsObject().name);
        }
        stmt.free();
        return cols;
      })()
    : [];
  for (const col of geoColumns) {
    if (!existingCols.includes(col)) {
      const colType = col === 'geo_is_vpn' || col === 'geo_risk_score' ? 'INTEGER DEFAULT 0' : 'TEXT';
      db.run(`ALTER TABLE users ADD COLUMN ${col} ${colType}`);
    }
  }
}

function persistSync() {
  if (!db) return;
  try {
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
  } catch (e) {
    // On read-only filesystems (e.g. serverless, containers) persistence is
    // best-effort. In-memory state still works; we just can't write to disk.
    if (!persistWarned) {
      persistWarned = true;
      console.warn('[Persistence]: Read-only filesystem — changes will not be saved to disk. In-memory state is active.');
    }
  }
}
var persistWarned = false;

function scheduleSave() {
  if (saveScheduled) return;
  saveScheduled = true;
  setImmediate(() => {
    persistSync();
    saveScheduled = false;
  });
}

async function getDb() {
  if (!db) await initPromise;
  return db;
}

function dropAllTables() {
  const tables = [
    'users', 'transactions', 'provably_fair_seeds', 'bonus_state',
    'telemetry', 'jackpot_pool', 'affiliates', 'affiliate_earnings'
  ];
  for (const t of tables) {
    try { db.run(`DROP TABLE IF EXISTS ${t}`); } catch (e) { /* ignore */ }
  }
}

module.exports = {
  getDb,
  persistSync,
  createSchema,
  dropAllTables,

  findById: async (id) => {
    const database = await getDb();
    const stmt = database.prepare('SELECT * FROM users WHERE id = :id');
    stmt.bind({ ':id': id });
    const result = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
    return result;
  },

  findByEmail: async (email) => {
    const database = await getDb();
    const stmt = database.prepare('SELECT * FROM users WHERE email = :email');
    stmt.bind({ ':email': email });
    const result = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
    return result;
  },

  findByUsername: async (username) => {
    const database = await getDb();
    const stmt = database.prepare('SELECT * FROM users WHERE username = :username');
    stmt.bind({ ':username': username });
    const result = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
    return result;
  },

  createUser: async ({ username, email, password, gcBalance, scBalance }) => {
    const database = await getDb();
    const createdAt = Date.now();
    database.run(
      `INSERT INTO users (username, email, password, gc_balance, sc_unplayed, sc_played, created_at, last_ad_reset, last_daily_claim)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [username, email, password, gcBalance || 10000, scBalance || 10, 0, createdAt, createdAt, createdAt]
    );

    const result = database.exec('SELECT last_insert_rowid()');
    const userId = result[0].values[0][0];

    database.run(
      'INSERT INTO provably_fair_seeds (user_id, server_seed, client_seed, nonce) VALUES (?, ?, ?, ?)',
      [userId, require('crypto').randomBytes(32).toString('hex'), 'default_client_seed', 0]
    );

    database.run(
      'INSERT INTO bonus_state (user_id, last_claim_at, claim_streak, rakeback_last_daily, rakeback_last_weekly, rakeback_last_monthly) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, createdAt, 0, createdAt, createdAt, createdAt]
    );

    database.run(
      'INSERT INTO telemetry (user_id, last_daily_reset, last_weekly_reset, last_monthly_reset) VALUES (?, ?, ?, ?)',
      [userId, createdAt, createdAt, createdAt]
    );

    persistSync();
    return userId;
  },

  updateUser: async (id, fields) => {
    const database = await getDb();
    const keys = Object.keys(fields).filter(k => fields[k] !== undefined);
    const values = keys.map(k => fields[k]);
    const setClause = keys.map(k => `${k} = ?`).join(', ');
    database.run(`UPDATE users SET ${setClause} WHERE id = ?`, [...values, id]);
    scheduleSave();
  },

  updateBalances: async ({ gcDelta, scDelta, userId }) => {
    const database = await getDb();
    if (gcDelta) {
      database.run('UPDATE users SET gc_balance = gc_balance + ? WHERE id = ?', [gcDelta, userId]);
    }
    if (scDelta) {
      database.run(
        'UPDATE users SET sc_unplayed = MAX(0, sc_unplayed + ?) WHERE id = ?',
        [scDelta, userId]
      );
    }
    scheduleSave();
  },

  addTransaction: async ({ id, userId, type, description, gcDelta, scDelta, currency, amount, status, metadata }) => {
    const database = await getDb();
    database.run(
      `INSERT OR REPLACE INTO transactions (id, user_id, type, description, gc_delta, sc_delta, currency, amount, status, metadata, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, userId, type, description, gcDelta || 0, scDelta || 0, currency, amount || 0, status || 'COMPLETED', metadata ? JSON.stringify(metadata) : null, new Date().toISOString()]
    );
    scheduleSave();
  },

  getTransactions: async (userId, limit = 50) => {
    const database = await getDb();
    const stmt = database.prepare(
      'SELECT * FROM transactions WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?'
    );
    stmt.bind([userId, limit]);
    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  },

  getTransactionById: async (id) => {
    const database = await getDb();
    const stmt = database.prepare('SELECT * FROM transactions WHERE id = ?');
    stmt.bind([id]);
    const result = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
    return result;
  },

  updateTransactionStatus: async (id, status) => {
    const database = await getDb();
    database.run('UPDATE transactions SET status = ? WHERE id = ?', [status, id]);
    scheduleSave();
  },

  getSeedPair: async (userId) => {
    const database = await getDb();
    const stmt = database.prepare('SELECT * FROM provably_fair_seeds WHERE user_id = ?');
    stmt.bind([userId]);
    const result = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
    return result;
  },

  setSeedPair: async (userId, serverSeed, clientSeed, nonce) => {
    const database = await getDb();
    database.run(
      'INSERT OR REPLACE INTO provably_fair_seeds (user_id, server_seed, client_seed, nonce) VALUES (?, ?, ?, ?)',
      [userId, serverSeed, clientSeed, nonce]
    );
    scheduleSave();
  },

  incrementNonce: async (userId) => {
    const database = await getDb();
    database.run('UPDATE provably_fair_seeds SET nonce = nonce + 1 WHERE user_id = ?', [userId]);
    scheduleSave();
  },

  getJackpotPool: async () => {
    const database = await getDb();
    const result = database.exec('SELECT * FROM jackpot_pool WHERE id = 1');
    if (result.length && result[0].values.length) {
      const cols = result[0].columns;
      const vals = result[0].values[0];
      const obj = {};
      cols.forEach((c, i) => { obj[c] = vals[i]; });
      return obj;
    }
    return { mini: 50, minor: 200, major: 1000, grand: 10000 };
  },

  updateJackpotPool: async (pool) => {
    const database = await getDb();
    database.run(
      'UPDATE jackpot_pool SET mini = ?, minor = ?, major = ?, grand = ? WHERE id = 1',
      [pool.mini, pool.minor, pool.major, pool.grand]
    );
    scheduleSave();
  },

  getUserCount: async () => {
    const database = await getDb();
    const result = database.exec('SELECT COUNT(*) FROM users');
    return result[0].values[0][0];
  },

  getAllUsers: async () => {
    const database = await getDb();
    const stmt = database.prepare('SELECT * FROM users');
    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  },

  getTotalWagered: async () => {
    const database = await getDb();
    const result = database.exec('SELECT SUM(total_wagered_gc), SUM(total_wagered_sc) FROM users');
    return {
      totalGC: result[0].values[0][0] || 0,
      totalSC: result[0].values[0][1] || 0
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
    database.run(
      'UPDATE affiliates SET referred_by = ? WHERE user_id = ?',
      [referredBy, userId]
    );
    scheduleSave();
  },

  getReferredUsers: async (affiliateUserId) => {
    const database = await getDb();
    const stmt = database.prepare(
      `SELECT u.id, u.username, u.created_at, a.created_at AS referred_at
       FROM affiliates a
       JOIN users u ON u.id = a.user_id
       WHERE a.referred_by = ?
       ORDER BY a.created_at DESC`
    );
    stmt.bind([affiliateUserId]);
    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  },

  addAffiliateEarning: async ({ id, affiliateUserId, referredUserId, source, amountSc }) => {
    const database = await getDb();
    database.run(
      `INSERT INTO affiliate_earnings (id, affiliate_user_id, referred_user_id, source, amount_sc) VALUES (?, ?, ?, ?, ?)`,
      [id, affiliateUserId, referredUserId, source, amountSc]
    );
    scheduleSave();
  },

  getAffiliateEarnings: async (affiliateUserId, limit = 100) => {
    const database = await getDb();
    const stmt = database.prepare(
      `SELECT * FROM affiliate_earnings WHERE affiliate_user_id = ? ORDER BY created_at DESC LIMIT ?`
    );
    stmt.bind([affiliateUserId, limit]);
    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  },

  getAffiliateEarningsTotals: async (affiliateUserId) => {
    const database = await getDb();
    const stmt = database.prepare(
      `SELECT source, COALESCE(SUM(amount_sc), 0) AS total
       FROM affiliate_earnings
       WHERE affiliate_user_id = ?
       GROUP BY source`
    );
    stmt.bind([affiliateUserId]);
    const results = {};
    while (stmt.step()) {
      const row = stmt.getAsObject();
      results[row.source] = row.total;
    }
    stmt.free();
    return results;
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
    database.run(
      `INSERT OR REPLACE INTO telemetry
       (user_id, sc_wagered, gc_wagered, rounds, rounds_won, games_played,
        daily_loss_sc, daily_wager_sc, daily_win_sc,
        weekly_loss_sc, weekly_wager_sc, weekly_win_sc,
        monthly_loss_sc, monthly_wager_sc, monthly_win_sc,
        dice_over90, crash_cashout2x, blackjack_hands, history,
        last_daily_reset, last_weekly_reset, last_monthly_reset)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        tel.scWagered || 0, tel.gcWagered || 0, tel.rounds || 0, tel.roundsWon || 0,
        JSON.stringify(tel.gamesPlayed || []),
        tel.dailyLossSC || 0, tel.dailyWagerSC || 0, tel.dailyWinSC || 0,
        tel.weeklyLossSC || 0, tel.weeklyWagerSC || 0, tel.weeklyWinSC || 0,
        tel.monthlyLossSC || 0, tel.monthlyWagerSC || 0, tel.monthlyWinSC || 0,
        tel.diceOver90 || 0, tel.crashCashout2x || 0, tel.blackjackHands || 0,
        JSON.stringify(tel.history || []),
        tel.lastDailyReset || 0, tel.lastWeeklyReset || 0, tel.lastMonthlyReset || 0
      ]
    );
    scheduleSave();
  }
};
