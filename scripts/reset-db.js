/**
 * scripts/reset-db.js
 *
 * DESTROYS all users, transactions, seeds, bonuses, telemetry, and affiliates,
 * then creates ONE fresh Demo account that the operator can hand out.
 *
 *   Username: Demo
 *   Email:    demo@casino.local
 *   Password: Demo1234!
 *
 * Usage:
 *   node scripts/reset-db.js            # wipes everything, recreates schema, seeds Demo user
 *   node scripts/reset-db.js --seed    # only seeds the Demo user if missing
 *
 * WARNING: This deletes all live data. The SQLite file is rewritten on disk.
 */

const bcrypt = require('bcryptjs');
const db = require('../database');

async function seedDemoUser() {
  const username = 'Demo';
  const email = 'demo@casino.local';
  const password = 'Demo1234!';
  const hashed = await bcrypt.hash(password, 12);

  const existing = await db.findByEmail(email);
  let userId;
  if (existing) {
    userId = existing.id;
    await db.updateUser(userId, {
      username,
      email,
      password: hashed,
      gc_balance: 10000,
      sc_unplayed: 10,
      sc_played: 0,
      kyc_status: 'VERIFIED',
      kyc_tier: 2,
      kyc_verified_at: new Date().toISOString(),
      state: 'CA'
    });
    console.log(`[reset] Updated existing Demo user (id=${userId}).`);
  } else {
    userId = await db.createUser({
      username,
      email,
      password: hashed,
      gcBalance: 10000,
      scBalance: 10
    });
    await db.updateUser(userId, {
      kyc_status: 'VERIFIED',
      kyc_tier: 2,
      kyc_verified_at: new Date().toISOString(),
      state: 'CA'
    });
    console.log(`[reset] Created fresh Demo user (id=${userId}).`);
  }

  console.log('--------------------------------------------------');
  console.log('  Demo credentials');
  console.log(`    Username: ${username}`);
  console.log(`    Email:    ${email}`);
  console.log(`    Password: ${password}`);
  console.log(`    GC: 10,000   SC: 10.00   KYC: VERIFIED`);
  console.log('--------------------------------------------------');
}

async function reset() {
  console.log('[reset] Dropping all tables...');
  await db.getDb();
  db.dropAllTables();
  console.log('[reset] Recreating schema...');
  db.createSchema();
  db.persistSync();
  await seedDemoUser();
}

async function seedOnly() {
  await db.getDb();
  await seedDemoUser();
}

(async () => {
  try {
    const arg = process.argv[2];
    if (arg === '--seed') {
      await seedOnly();
    } else {
      await reset();
    }
    console.log('[reset] Done.');
    process.exit(0);
  } catch (e) {
    console.error('[reset] Failed:', e);
    process.exit(1);
  }
})();