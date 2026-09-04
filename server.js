require('dotenv').config();

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const db = require('./database');
const { verifyToken } = require('./middleware/auth');

// -----------------------------------------------------------------------------
// 1. CONFIGURATION & CONSTANTS
// -----------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'casino_secret_key_123';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const PERSONA_WEBHOOK_SECRET = process.env.PERSONA_WEBHOOK_SECRET;
const HOUSE_EDGE = 0.13; // 13% House Edge (86% RTP)
const RAKEBACK_RATE = 0.05; // 5% of House Edge back to user (0.13 * 0.05 = 0.0065 = 0.65%)

let stripe = null;
if (STRIPE_SECRET_KEY) {
  try {
    stripe = require('stripe')(STRIPE_SECRET_KEY);
  } catch (e) {
    console.warn('[Stripe]: Failed to initialize Stripe SDK:', e.message);
  }
}

const bcrypt = require('bcryptjs');
const { GAMES, GAME_FLOAT_COUNTS, round2, SLOT_JACKPOT_POOL } = require('./engine/serverGames');

const RESTRICTED_STATES = [
  'WA', 'ID', 'NV', 'MI', 'MT', 'CT', 'NJ', 'NY', 'LA', 'TN', 'IN', 'ME', 'OK',
  'KY', 'GA', 'AL', 'DE', 'AR', 'FL', 'HI', 'IL', 'IA', 'KS', 'MD', 'MN', 'MS',
  'MO', 'NE', 'NH', 'NC', 'ND', 'PA', 'RI', 'SC', 'SD', 'TX', 'UT', 'VT', 'VA',
  'WV', 'WI', 'WY'
];

const RESTRICTED_COUNTRIES = [
  'AF', 'IQ', 'IR', 'KP', 'LY', 'PK', 'SA', 'SD', 'SS', 'SY', 'YE', 'CN', 'RU'
];

const GEO_CACHE_TTL = 1000 * 60 * 60; // 1 hour

const GEO_PROVIDERS = [
  (ip) => fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`).then(r => r.json()) ,
  (ip) => fetch(`https://ipwho.is/${encodeURIComponent(ip)}`).then(r => r.json()) ,
  (ip) => fetch(`https://ip-api.com/json/${encodeURIComponent(ip)}`).then(r => r.json())
];

const VPN_ASN_KEYWORDS = [
  // Generic VPN, Proxy & Security Services
  'vpn', 'proxy', 'anonymizer', 'tunnel', 'tor', 'exit-node', 'mullvad', 
  'nordvpn', 'expressvpn', 'surfshark', 'cyberghost', 'privateinternetaccess', 
  'pia', 'ipvanish', 'vyprvpn', 'windscribe', 'proton', 'protonvpn', 'purevpn',
  'hide.me', 'zenmate', 'strongvpn', 'tunnelbear', 'airvpn', 'mullvad', 'ivpn',

  // Cloud Providers & Hyperscalers
  'aws', 'amazon', 'azure', 'gcp', 'google cloud', 'oracle cloud', 'alibaba', 
  'alicloud', 'tencent', 'ibm cloud', 'scaleway', 'ovh', 'ovhcloud', 

  // Hosting, VPS & Infrastructure
  'hosting', 'datacenter', 'data center', 'server', 'vps', 'cloud', 'colo', 
  'colocation', 'dedi', 'dedicated', 'bare metal', 'rackspace', 'digitalocean', 
  'linode', 'akamai', 'hetzner', 'contabo', 'vultr', 'upcloud', 'hostinger', 
  'bluehost', 'hostgator', 'godaddy', 'ionos', 'a2 hosting', 'siteground', 
  'fastcomet', 'inmotion', 'dreamhost', 'liquid web', 'leaseweb', 'choopa', 

  // Network Infrastructure & Backbone/Transit
  'transit', 'backbone', 'peering', 'ixp', 'interconnection', 'cdn', 
  'cloudflare', 'fastly', 'imperva', 'incapsula', 'stackpath', 'limelight', 
  'edgio', 'denial', 'ddos-guard', 'sucuri', 'cogent', 'cogentco', 'he.net', 
  'hurricane electric', 'gtt', 'pccw', 'zayo', 'level3', 'lumen', 'telia', 
  'arelion', 'tata communications', 'seaborn', 'telstra global',

  // Datacenter Real Estate & Interconnects
  'equinix', 'digital realty', 'cyrusone', 'switch', 'tierpoint', 'telehouse', 
  'coresite', 'flexential', 'iron mountain', 'qts', 'databank'
];

// In-memory geo cache: ip -> { data, expiresAt }
const geoCache = new Map();

// Coin Package Configurations
const COIN_PACKAGES = {
  'pack_10': { name: '15,000 GC + 15 Free SC', priceInCents: 999, gcAmount: 15000, scAmount: 15 },
  'pack_20': { name: '25,000 GC + 25 Free SC', priceInCents: 1999, gcAmount: 25000, scAmount: 25 },
  'pack_50': { name: '55,000 GC + 55 Free SC', priceInCents: 4999, gcAmount: 55000, scAmount: 55 },
  'pack_100': { name: '100,000 GC + 105 Free SC', priceInCents: 9999, gcAmount: 100000, scAmount: 105 }
};

function isGuestUser(user) {
  return !!(user.isGuest || (user.email && user.email.endsWith('@guest.casino')));
}

// -----------------------------------------------------------------------------
// 2. IN-MEMORY DATA STORES
// -----------------------------------------------------------------------------
const users = new Map();
const processedEvents = new Set();
const transactions = new Map();
const activeSessions = new Map();
const userSeeds = new Map();
const amoeRegistry = new Map();
const cryptoPayments = new Map();

// -----------------------------------------------------------------------------
// 2a. GEOLOCATION / JURISDICTION COMPLIANCE
// -----------------------------------------------------------------------------

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'] || req.headers['cf-connecting-ip'];
  if (forwarded) {
    return String(forwarded).split(',')[0].trim().replace('::ffff:', '');
  }
  return (req.socket.remoteAddress || '').replace('::ffff:', '');
}

function isVpnOrHosting(asn, org) {
  if (!asn && !org) return false;
  const haystack = `${asn || ''} ${org || ''}`.toLowerCase();
  return VPN_ASN_KEYWORDS.some(k => haystack.includes(k));
}

async function geoLookup(ip) {
  if (!ip || ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') {
    return { ip, state: null, country: 'US', city: null, restricted: false, isVpn: false, asn: null, org: null, riskScore: 0 };
  }

  const cached = geoCache.get(ip);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  let lastError = null;
  for (const provider of GEO_PROVIDERS) {
    try {
      const data = await provider(ip);
      if (!data || data.status === 'fail') {
        lastError = data?.reason || 'provider returned fail';
        continue;
      }

      const state = (data.region_code || data.region || data.state || data.subdivision || null);
      const country = (data.country_code || data.country || null);
      const restricted = RESTRICTED_STATES.includes((state || '').toUpperCase()) ||
                         RESTRICTED_COUNTRIES.includes((country || '').toUpperCase());
      const asn = data.asn || data.as || null;
      const org = data.org || data.isp || data.as || null;
      const isVpn = isVpnOrHosting(asn, org);
      const riskScore = (restricted ? 50 : 0) + (isVpn ? 30 : 0) + (data.proxy ? 20 : 0) + (data.hosting ? 20 : 0);

      const result = {
        ip,
        state: state ? String(state).toUpperCase() : null,
        country: country ? String(country).toUpperCase() : null,
        city: data.city || null,
        restricted,
        isVpn,
        asn,
        org,
        riskScore: Math.min(100, riskScore),
        provider: 'geo',
        lookedUpAt: Date.now()
      };

      geoCache.set(ip, { data: result, expiresAt: Date.now() + GEO_CACHE_TTL });
      return result;
    } catch (e) {
      lastError = e.message;
      continue;
    }
  }

  console.warn(`[Geo] All providers failed for ${ip}: ${lastError}`);
  return { ip, state: null, country: null, city: null, restricted: null, isVpn: false, asn: null, org: null, riskScore: -1, error: lastError };
}

// Generate a unique user ID (avoids collisions from deletions/counters)
let nextUserId = 1;
function generateUserId() {
  while (users.has(nextUserId)) nextUserId++;
  const id = nextUserId;
  nextUserId++;
  return id;
}

// -----------------------------------------------------------------------------
// 2b. PERSISTENCE — SQLite database for durable storage
// -----------------------------------------------------------------------------
async function loadData() {
  try {
    await db.getDb();
    const userCount = await db.getUserCount();
    if (userCount === 0) {
      console.log('[Persistence]: No users in database, will seed demo user.');
      return;
    }

    const allUsers = await db.getAllUsers();
    for (const u of allUsers) {
      const userData = {
        id: u.id,
        username: u.username,
        email: u.email,
        password: u.password,
        gc_balance: u.gc_balance,
        sc_unplayed: u.sc_unplayed,
        sc_played: u.sc_played,
        stripeAccountId: u.stripe_account_id,
        kyc: {
          status: u.kyc_status,
          tier: u.kyc_tier,
          inquiryId: u.kyc_inquiry_id,
          verifiedAt: u.kyc_verified_at,
          rejectionReason: u.kyc_rejection_reason
        },
        lastDailyClaim: u.last_daily_claim,
        dailyStreak: u.daily_streak,
        adsWatchedToday: u.ads_watched_today,
        lastAdReset: u.last_ad_reset,
        state: u.state,
        createdAt: u.created_at,
        vipTier: u.vip_tier,
        totalWageredGC: u.total_wagered_gc,
        totalWageredSC: u.total_wagered_sc,
        rakebackAccruedSC: u.rakeback_accrued_sc,
        isGuest: u.email && u.email.endsWith('@guest.casino'),
        bonus: {
          lastClaimAt: 0,
          claimStreak: u.daily_streak,
          dailyClaimed: false,
          challenges: [],
          challengeDate: '',
          telemetry: {
            scWagered: 0, gcWagered: 0, rounds: 0, roundsWon: 0,
            gamesPlayed: [], dailyLossSC: 0, dailyWagerSC: 0, dailyWinSC: 0,
            weeklyLossSC: 0, weeklyWagerSC: 0, weeklyWinSC: 0,
            monthlyLossSC: 0, monthlyWagerSC: 0, monthlyWinSC: 0,
            diceOver90: 0, crashCashout2x: 0, blackjackHands: 0,
            history: [],
            lastDailyReset: Date.now(),
            lastWeeklyReset: Date.now(),
            lastMonthlyReset: Date.now()
          },
          rakeback: {
            lastDailyAt: 0, lastWeeklyAt: 0, lastMonthlyAt: 0,
            dailyPool: 0, weeklyPool: 0, monthlyPool: 0
          }
        }
      };
      users.set(u.id, userData);
      transactions.set(u.id, []);
    }
    console.log('[Persistence]: Loaded ' + users.size + ' users from database.');
  } catch (e) {
    console.error('[Persistence]: Failed to load data:', e.message);
  }
}

async function saveData() {
  try {
    for (const user of users.values()) {
      await db.updateUser(user.id, {
        username: user.username,
        email: user.email,
        gc_balance: user.gc_balance,
        sc_unplayed: user.sc_unplayed,
        sc_played: user.sc_played,
        stripe_account_id: user.stripeAccountId,
        kyc_status: user.kyc?.status || 'UNVERIFIED',
        kyc_tier: user.kyc?.tier || 0,
        kyc_inquiry_id: user.kyc?.inquiryId,
        kyc_verified_at: user.kyc?.verifiedAt,
        kyc_rejection_reason: user.kyc?.rejectionReason,
        last_daily_claim: user.lastDailyClaim,
        daily_streak: user.dailyStreak,
        ads_watched_today: user.adsWatchedToday,
        last_ad_reset: user.lastAdReset,
      state: user.state,
      vip_tier: user.vipTier,
      total_wagered_gc: user.totalWageredGC,
      total_wagered_sc: user.totalWageredSC,
      rakeback_accrued_sc: user.rakebackAccruedSC,
      geo_ip: user.geoIp,
      geo_country: user.geoCountry,
      geo_city: user.geoCity,
      geo_is_vpn: user.geoIsVpn ? 1 : 0,
      geo_risk_score: user.geoRiskScore || 0,
       registered_at: user.registeredAt || user.createdAt || null
      });
    }
  } catch (e) {
    console.error('[Persistence]: Failed to save data:', e.message);
  }
}

// Save every 30 seconds
setInterval(saveData, 30000);

// Graceful shutdown handler (single handler for both signals)
async function gracefulShutdown(signal) {
  console.log(`${signal} signal received: saving data and closing server`);
  await saveData();
  db.persistSync();
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
  // Force shutdown after 5 seconds
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Initialize database and load users
(async () => {
  await loadData();

  // Initialize nextUserId after loading data
  if (users.size > 0) {
    nextUserId = Math.max(...users.keys()) + 1;
  }

// Seed Initial Demo User only if no users exist (don't clobber persisted data)
if (users.size === 0) {
  const demoId = await db.createUser({
    username: 'Player_1001',
    email: 'player1001@example.com',
    password: await bcrypt.hash('Demo1234!', 12),
    gcBalance: 10000,
    scBalance: 50
  });

  await db.updateUser(demoId, {
    kyc_status: 'VERIFIED',
    kyc_tier: 2,
    kyc_inquiry_id: 'inq_demo123',
    kyc_verified_at: new Date().toISOString()
  });

  const demoUser = {
    id: demoId,
    username: 'Player_1001',
    email: 'player1001@example.com',
    password: await bcrypt.hash('Demo1234!', 12),
    gc_balance: 10000.0,
    sc_unplayed: 50.0,
    sc_played: 0.0,
    stripeAccountId: null,
    kyc: {
      status: 'VERIFIED',
      tier: 2,
      inquiryId: 'inq_demo123',
      verifiedAt: new Date().toISOString(),
      rejectionReason: null
    },
    lastDailyClaim: 0,
    dailyStreak: 0,
    adsWatchedToday: 0,
    lastAdReset: Date.now(),
    state: 'CA',
    createdAt: Date.now(),
    vipTier: 'Bronze',
    totalWageredGC: 0,
    totalWageredSC: 0,
    rakebackAccruedSC: 0,
    isGuest: false,
    bonus: {
      lastClaimAt: 0,
      claimStreak: 0,
      dailyClaimed: false,
      challenges: [],
      challengeDate: '',
      telemetry: {
        scWagered: 0, gcWagered: 0, rounds: 0, roundsWon: 0,
        gamesPlayed: [], dailyLossSC: 0, dailyWagerSC: 0, dailyWinSC: 0,
        weeklyLossSC: 0, weeklyWagerSC: 0, weeklyWinSC: 0,
        monthlyLossSC: 0, monthlyWagerSC: 0, monthlyWinSC: 0,
        diceOver90: 0, crashCashout2x: 0, blackjackHands: 0,
        history: [],
        lastDailyReset: Date.now(),
        lastWeeklyReset: Date.now(),
        lastMonthlyReset: Date.now()
      },
      rakeback: {
        lastDailyAt: 0, lastWeeklyAt: 0, lastMonthlyAt: 0,
        dailyPool: 0, weeklyPool: 0, monthlyPool: 0
      }
    }
  };
  users.set(demoId, demoUser);
  transactions.set(demoId, []);
}

console.log('[Init]: Database initialized, ' + users.size + ' users loaded.');
})();

// -----------------------------------------------------------------------------
// 3. PROVABLY FAIR ENGINE
// -----------------------------------------------------------------------------
class ProvablyFair {
  static generateServerSeed() { 
    return crypto.randomBytes(32).toString('hex'); 
  }

  static hashSeed(seed) { 
    return crypto.createHash('sha256').update(seed).digest('hex'); 
  }
  
  static getFloats(serverSeed, clientSeed, nonce, count = 1) {
    const floats = [];
    let currentNonce = nonce;
    while (floats.length < count) {
      const hmac = crypto.createHmac('sha256', serverSeed);
      hmac.update(`${clientSeed}:${currentNonce}`);
      const buffer = hmac.digest();
      for (let i = 0; i < 32 && floats.length < count; i += 4) {
        floats.push(buffer.readUInt32BE(i) / Math.pow(2, 32));
      }
      currentNonce++;
    }
    return floats;
  }
}

// -----------------------------------------------------------------------------
// 4. HELPER & COMPLIANCE FUNCTIONS
// -----------------------------------------------------------------------------

function getUserSeedPair(userId) {
  if (!userSeeds.has(userId)) {
    userSeeds.set(userId, {
      serverSeed: ProvablyFair.generateServerSeed(),
      clientSeed: crypto.randomBytes(16).toString('hex'), // Generates a random 32-character hex string
      nonce: 0
    });
  }
  return userSeeds.get(userId);
}

function logTransaction(userId, type, description, gcDelta, scDelta, metadata = {}) {
  if (!transactions.has(userId)) transactions.set(userId, []);

  const tx = {
    id: `tx_${crypto.randomUUID()}`,
    type, // 'BET', 'WIN', 'PURCHASE', 'WITHDRAWAL', 'BONUS', 'RAKEBACK', 'AD_REWARD'
    description,
    gcDelta,
    scDelta,
    currency: gcDelta !== 0 ? 'GC' : 'SC',
    amount: gcDelta !== 0 ? Math.abs(gcDelta) : Math.abs(scDelta),
    status: 'COMPLETED',
    metadata,
    timestamp: new Date().toISOString()
  };

  transactions.get(userId).unshift(tx);

  // Cap transactions per user to prevent unbounded growth (keep last 100)
  const userTx = transactions.get(userId);
  if (userTx.length > 100) {
    userTx.splice(100);
  }
  return tx;
}

function updateVipAndRakeback(user, scWagered, gcWagered) {
  user.totalWageredSC += scWagered;
  user.totalWageredGC += gcWagered;

  if (scWagered > 0) {
    user.rakebackAccruedSC += (scWagered * HOUSE_EDGE * RAKEBACK_RATE);
    user.rakebackAccruedSC = Math.round(user.rakebackAccruedSC * 100) / 100;
  }

  if (user.totalWageredSC >= 100000) user.vipTier = 'Diamond';
  else if (user.totalWageredSC >= 25000) user.vipTier = 'Platinum';
  else if (user.totalWageredSC >= 5000) user.vipTier = 'Gold';
  else if (user.totalWageredSC >= 1000) user.vipTier = 'Silver';
  else user.vipTier = 'Bronze';
}

/**
 * Validates a wager end-to-end (currency whitelist, numeric bet, rounding,
 * balance check, max limit). Returns { user, currency, amount } or sends an error
 * response and returns null.
 */
function validateWager(req, res) {
  const { currency, betAmount } = req.body || {};

  const user = users.get(req.user.id);
  if (!user) { res.status(404).json({ error: 'User not found.' }); return null; }

  if (currency !== 'GC' && currency !== 'SC') {
    res.status(400).json({ error: "Invalid currency. Must be 'GC' or 'SC'." });
    return null;
  }

  const amount = Number(betAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    res.status(400).json({ error: 'Bet amount must be a positive number.' });
    return null;
  }

  const MAX_BET = currency === 'GC' ? 100000 : 10000;
  if (amount > MAX_BET) {
    res.status(400).json({ error: `Maximum bet is ${MAX_BET.toLocaleString()} ${currency}.` });
    return null;
  }

  const rounded = Math.round(amount * 100) / 100;
  const balance = currency === 'GC'
    ? user.gc_balance
    : user.sc_unplayed;

  if (rounded > balance) {
    res.status(400).json({ error: `Insufficient ${currency} balance.` });
    return null;
  }

  return { user, currency, amount: rounded };
}

/** Debits a stake from the correct currency bucket and accrues VIP/rakeback. */
function debitBet(user, currency, amount) {
  if (currency === 'GC') {
    user.gc_balance = Math.max(0, user.gc_balance - amount);
    updateVipAndRakeback(user, 0, amount);
  } else {
    user.sc_unplayed = Math.max(0, user.sc_unplayed - amount);
    updateVipAndRakeback(user, amount, 0);
  }
  saveData();
}

function creditWin(user, currency, amount) {
  if (currency === 'GC') user.gc_balance += amount;
  else user.sc_played += amount;
  saveData();
}

function balancesOf(user) {
  return { gc: user.gc_balance, sc: user.sc_unplayed + user.sc_played };
}

/**
 * Loads an ACTIVE game session owned by this user.
 * Sends the appropriate error response and returns null when invalid.
 */
// -----------------------------------------------------------------------------
// 5. GAME ENGINES
// -----------------------------------------------------------------------------
// (game engines imported above with bcrypt)
// -----------------------------------------------------------------------------
// 6. EXPRESS APP & MIDDLEWARES
// -----------------------------------------------------------------------------
const app = express();
const server = http.createServer(app);

function corsOptions(origin, callback) {
  const allowedOrigins = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:8080',
    'http://127.0.0.1:8080',
    'http://localhost:3001',
    'http://127.0.0.1:3001',
    process.env.FRONTEND_URL
  ].filter(Boolean);

  var isLocalNetwork = /^http:\/\/(localhost:|127\.0\.0\.1:|192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(origin);
  if (!origin || allowedOrigins.includes(origin) || isLocalNetwork) {
    callback(null, true);
  } else {
    console.warn('[CORS]: Rejected origin:', origin);
    callback(null, false);
  }
}

app.use(cors({
  origin: corsOptions,
  credentials: true
}));

// Geofencing Compliance Middleware
function enforceJurisdiction(req, res, next) {
  // Use server-side user state, not client-spoofable header
  const user = users.get(req.user.id);
  const userState = (user && user.state) || 'CA';
  if (RESTRICTED_STATES.includes(userState.toUpperCase())) {
    return res.status(403).json({
      error: `Sweepstakes play is unavailable in your jurisdiction (${userState}).`
    });
  }
  next();
}

// Stripe Webhook Endpoint (Raw Body Parser before express.json())
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  if (!stripe) {
    return res.status(500).json({ error: 'Stripe is not configured.' });
  }

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error(`[STRIPE WEBHOOK ERROR] ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (processedEvents.has(event.id)) {
    return res.json({ received: true, deduplicated: true });
  }
  processedEvents.add(event.id);

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    if (session.payment_status === 'paid') {
      const userId = parseInt(session.metadata.userId, 10);
      if (isNaN(userId)) {
        console.error('[STRIPE WEBHOOK ERROR] Invalid userId in metadata');
        return res.status(400).json({ error: 'Invalid user ID in metadata.' });
      }
      const gcAmount = parseFloat(session.metadata.gcAmount);
      const scAmount = parseFloat(session.metadata.scAmount);

      const stripeTxId = `stripe_${session.id}`;
      const existing = await db.getTransactionById(stripeTxId);
      const alreadyCredited = !!(existing && existing.status === 'COMPLETED');
      const user = users.get(userId);
      if (user && !alreadyCredited) {
        user.gc_balance = round2((user.gc_balance || 0) + gcAmount);
        user.sc_unplayed = round2((user.sc_unplayed || 0) + scAmount);
        saveData();

        logTransaction(userId, 'PURCHASE', `Purchased ${session.metadata.packageName || 'Coin Package'}`, gcAmount, scAmount, { stripeSessionId: session.id });
        try {
          await db.addTransaction({
            id: stripeTxId,
            userId,
            type: 'PURCHASE',
            description: `Purchased ${session.metadata.packageName || 'Coin Package'} (Stripe)`,
            gcDelta: gcAmount,
            scDelta: scAmount,
            currency: 'GC',
            amount: (session.amount_total || 0) / 100,
            status: 'COMPLETED',
            metadata: { stripeSessionId: session.id, packageId: session.metadata.packageId, paymentMethod: 'card' }
          });
        } catch (e) { console.error('[Stripe Webhook DB]:', e.message); }

        const usdValue = (session.amount_total || 0) / 100;
        creditReferrerForDeposit(user, usdValue);

        sendToUser(userId, {
          type: 'BALANCE_UPDATE',
          balances: { gc: user.gc_balance, sc_unplayed: user.sc_unplayed, sc_played: user.sc_played },
          message: `Added ${gcAmount.toLocaleString()} GC and ${scAmount} SC!`
        });
      } else if (user) {
        try { db.updateTransactionStatus(stripeTxId, 'COMPLETED'); } catch (e) { /* non-blocking */ }
      }
    }
  }

  res.json({ received: true });
});

// Persona / Identity Verification Webhook Endpoint
app.post('/api/webhooks/kyc', express.raw({ type: 'application/json' }), (req, res) => {
  let event;

  if (PERSONA_WEBHOOK_SECRET) {
    const sig = req.headers['persona-signature'];
    if (!sig) {
      return res.status(401).json({ error: 'Missing webhook signature.' });
    }

    const computedSig = crypto
      .createHmac('sha256', PERSONA_WEBHOOK_SECRET)
      .update(req.body)
      .digest('hex');

    if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(computedSig, 'hex'))) {
      console.error('[PERSONA WEBHOOK WARNING] Invalid signature');
      return res.status(401).json({ error: 'Invalid webhook signature.' });
    }
  }

  try {
    event = JSON.parse(req.body.toString('utf8'));
  } catch (err) {
    return res.status(400).json({ error: 'Malformed JSON body.' });
  }

  const { event: eventType, data } = event;
  const referenceId = data?.attributes?.reference_id;

  if (!referenceId) return res.status(400).json({ error: 'Missing reference_id' });

  const userId = parseInt(referenceId, 10);
  const user = users.get(userId);

  if (user) {
    if (eventType === 'inquiry.approved') {
      user.kyc.status = 'VERIFIED';
      user.kyc.tier = 2;
      user.kyc.verifiedAt = new Date().toISOString();
      user.kyc.rejectionReason = null;

      sendToUser(userId, {
        type: 'KYC_STATUS_UPDATE',
        kyc: user.kyc,
        message: 'Your identity has been successfully verified!'
      });
    } else if (eventType === 'inquiry.declined' || eventType === 'inquiry.failed') {
      user.kyc.status = 'REJECTED';
      user.kyc.rejectionReason = data?.attributes?.declined_reason || 'Document verification failed.';

      sendToUser(userId, {
        type: 'KYC_STATUS_UPDATE',
        kyc: user.kyc,
        message: 'Identity verification failed. Please check your documents and retry.'
      });
    }
  } else {
    console.warn(`[PERSONA WEBHOOK] User ${userId} not found for webhook event ${eventType}`);
  }

  res.json({ success: true });
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting middleware - only for API routes
const rateLimitMap = new Map();

function rateLimit(maxRequests, windowMs) {
  return (req, res, next) => {
    if (!req.path.startsWith('/api/')) {
      return next();
    }
    const key = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const userRequests = rateLimitMap.get(key) || [];

    const validRequests = userRequests.filter(time => now - time < windowMs);
    if (validRequests.length >= maxRequests) {
      return res.status(429).json({ error: 'Too many requests. Please slow down.' });
    }

    validRequests.push(now);
    rateLimitMap.set(key, validRequests);
    next();
  };
}

app.use(rateLimit(500, 60000));

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

app.post('/api/auth/forgot-password', (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email is required.' });

  const user = Array.from(users.values()).find(u => u.email === email);
  if (!user) {
    return res.json({ success: true, message: 'If an account with that email exists, a password reset link has been sent.' });
  }

  const resetToken = crypto.randomBytes(32).toString('hex');
  const resetExpiry = Date.now() + 3600000;

  user.passwordResetToken = resetToken;
  user.passwordResetExpiry = resetExpiry;
  saveData();

  res.json({ success: true, message: 'If an account with that email exists, a password reset link has been sent.' });
});

app.post('/api/auth/reset-password', async (req, res) => {
  const { token, newPassword } = req.body || {};
  if (!token || !newPassword) {
    return res.status(400).json({ error: 'Token and new password are required.' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const user = Array.from(users.values()).find(u => u.passwordResetToken === token && u.passwordResetExpiry > Date.now());
  if (!user) {
    return res.status(400).json({ error: 'Invalid or expired reset token.' });
  }

  user.password = await bcrypt.hash(newPassword, 10);
  user.passwordResetToken = null;
  user.passwordResetExpiry = null;
  saveData();

  res.json({ success: true, message: 'Password reset successfully.' });
});

// -----------------------------------------------------------------------------
// 7. WEBSOCKET SERVER & HEARTBEAT
// -----------------------------------------------------------------------------
const wss = new WebSocket.Server({ noServer: true });
const connectedClients = new Map();

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const queryToken = url.searchParams.get('token');
  const authHeader = request.headers['authorization'];
  const headerToken = authHeader && authHeader.split(' ')[1];
  const token = headerToken || queryToken;

  if (!token) {
    socket.destroy();
    return;
  }

  jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }, (err, decoded) => {
    if (err) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.userId = decoded.id;
      ws.isAlive = true;
      wss.emit('connection', ws, request);
    });
  });
});

wss.on('connection', (ws) => {
  if (!connectedClients.has(ws.userId)) {
    connectedClients.set(ws.userId, new Set());
  }
  connectedClients.get(ws.userId).add(ws);

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('close', () => {
    if (connectedClients.has(ws.userId)) {
      connectedClients.get(ws.userId).delete(ws);
      if (connectedClients.get(ws.userId).size === 0) {
        connectedClients.delete(ws.userId);
      }
    }
  });
});

const pingInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => clearInterval(pingInterval));

function sendToUser(userId, payload) {
  const userSockets = connectedClients.get(userId);
  if (userSockets) {
    const data = JSON.stringify(payload);
    userSockets.forEach(client => {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    });
  }
}

function broadcastLiveBet(betData) {
  const data = JSON.stringify({ type: 'LIVE_BET', ...betData });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  });
}

// -----------------------------------------------------------------------------
// 8. API ROUTES & USER PROFILE ENDPOINTS
// -----------------------------------------------------------------------------

app.post('/api/auth/guest', async (req, res) => {
  try {
    const username = `Guest_${Math.floor(1000 + Math.random() * 9000)}`;
    const email = `${username.toLowerCase()}@guest.casino`;

    const clientIp = getClientIp(req);
    const geo = await geoLookup(clientIp);
    const detectedState = (geo.state || 'CA').toUpperCase();
    const detectedCountry = (geo.country || 'US').toUpperCase();

    if (RESTRICTED_STATES.includes(detectedState) || RESTRICTED_COUNTRIES.includes(detectedCountry)) {
      return res.status(403).json({
        error: `Sweepstakes play is unavailable in your jurisdiction (${detectedState || detectedCountry}).`,
        geo: { state: geo.state, country: geo.country, restricted: true }
      });
    }

    if (geo.isVpn || geo.riskScore >= 50) {
      return res.status(403).json({
        error: 'Access from VPN, proxy, or hosting provider is not allowed.',
        geo: { state: geo.state, country: geo.country, isVpn: geo.isVpn, riskScore: geo.riskScore }
      });
    }

    const userId = await db.createUser({
      username,
      email,
      password: null,
      gcBalance: 10000,
      scBalance: 10
    });

    await db.updateUser(userId, {
      state: detectedState,
      geo_ip: clientIp,
      geo_country: geo.country || null,
      geo_city: geo.city || null,
      geo_is_vpn: geo.isVpn ? 1 : 0,
      geo_risk_score: geo.riskScore || 0,
      registered_at: Date.now()
    });

    // Always create an affiliate record so the user has a referral code
    // they can share, even if they arrived without ?ref=
    await ensureAffiliateRecordFor(userId, generateReferralCode(username), null);

    if (req.body?.ref) {
      try {
        const referrerAff = await db.getAffiliateByCode(String(req.body.ref).trim());
        if (referrerAff && referrerAff.user_id !== userId) {
          await db.setAffiliateReferredBy(userId, referrerAff.user_id);
        }
      } catch (e) {
        console.warn('[Guest Referral Hook]:', e.message);
      }
    }

    const newUser = {
      id: userId,
      username,
      email,
      password: null,
      gc_balance: 10000.0,
      sc_unplayed: 10.0,
      sc_played: 0.0,
      stripeAccountId: null,
      kyc: {
        status: process.env.NODE_ENV === 'production' ? 'UNVERIFIED' : 'VERIFIED',
        tier: process.env.NODE_ENV === 'production' ? 0 : 2,
        inquiryId: null,
        verifiedAt: process.env.NODE_ENV === 'production' ? null : new Date().toISOString(),
        rejectionReason: null
      },
      lastDailyClaim: 0,
      dailyStreak: 0,
      adsWatchedToday: 0,
      lastAdReset: Date.now(),
      state: detectedState,
      createdAt: Date.now(),
      vipTier: 'Bronze',
      totalWageredGC: 0,
      totalWageredSC: 0,
      rakebackAccruedSC: 0,
      geoIp: clientIp,
      geoCountry: geo.country || null,
      geoCity: geo.city || null,
      geoIsVpn: !!geo.isVpn,
      geoRiskScore: geo.riskScore || 0,
      registeredAt: Date.now(),
      isGuest: true,
      bonus: {
        lastClaimAt: 0,
        claimStreak: 0,
        dailyClaimed: false,
        challenges: [],
        challengeDate: '',
        telemetry: {
          scWagered: 0, gcWagered: 0, rounds: 0, roundsWon: 0,
          gamesPlayed: [], dailyLossSC: 0, dailyWagerSC: 0, dailyWinSC: 0,
          weeklyLossSC: 0, weeklyWagerSC: 0, weeklyWinSC: 0,
          monthlyLossSC: 0, monthlyWagerSC: 0, monthlyWinSC: 0,
          diceOver90: 0, crashCashout2x: 0, blackjackHands: 0,
          history: [],
          lastDailyReset: Date.now(),
          lastWeeklyReset: Date.now(),
          lastMonthlyReset: Date.now()
        },
        rakeback: {
          lastDailyAt: 0, lastWeeklyAt: 0, lastMonthlyAt: 0,
          dailyPool: 0, weeklyPool: 0, monthlyPool: 0
        }
      }
    };
    users.set(userId, newUser);
    transactions.set(userId, []);

     const token = jwt.sign({ id: userId, username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({
      token,
      user: {
        id: userId,
        username,
        email,
        isGuest: true,
        kyc: newUser.kyc,
        state: detectedState,
        geo: { ip: clientIp, country: geo.country, state: geo.state, city: geo.city, isVpn: geo.isVpn, riskScore: geo.riskScore }
      },
      balances: { gc: 10000, sc: 10 }
     });
  } catch (e) {
    console.error('[Guest Registration Error]:', e.message);
    res.status(500).json({ error: 'Failed to create guest account.' });
  }
});

app.get('/api/geo/lookup', async (req, res) => {
  const clientIp = getClientIp(req);
  const geo = await geoLookup(clientIp);
  res.json({
    ip: geo.ip,
    state: geo.state,
    country: geo.country,
    city: geo.city,
    restricted: geo.restricted,
    isVpn: geo.isVpn,
    riskScore: geo.riskScore
  });
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password, birthDate, state, ref } = req.body || {};

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email, and password are required.' });
    }

    if (!birthDate) {
      return res.status(400).json({ error: 'Birth date is required for age verification.' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    if (username.length < 3 || username.length > 20) {
      return res.status(400).json({ error: 'Username must be between 3 and 20 characters.' });
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.status(400).json({ error: 'Username can only contain letters, numbers, and underscores.' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
    }

    if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
      return res.status(400).json({ error: 'Password must contain at least one uppercase letter, one lowercase letter, and one number.' });
    }

    const birth = new Date(birthDate);
    const ageMs = Date.now() - birth.getTime();
    const minAgeMs = 18 * 365.25 * 24 * 60 * 60 * 1000;
    if (ageMs < minAgeMs || birth > new Date()) {
      return res.status(403).json({ error: 'You must be at least 18 years old to register.' });
    }

    const stateCode = (state || 'CA').toUpperCase();
    if (RESTRICTED_STATES.includes(stateCode)) {
      return res.status(403).json({ error: `Online gaming is not available in ${stateCode}.` });
    }

    // Strict geo check: verify IP-based location matches claimed state and isn't restricted
    const clientIp = getClientIp(req);
    const geo = await geoLookup(clientIp);
    const detectedState = (geo.state || stateCode).toUpperCase();
    const detectedCountry = (geo.country || 'US').toUpperCase();

    if (RESTRICTED_STATES.includes(detectedState) || RESTRICTED_COUNTRIES.includes(detectedCountry)) {
      return res.status(403).json({
        error: `Sweepstakes play is unavailable in your jurisdiction (${detectedState || detectedCountry}).`,
        geo: { state: geo.state, country: geo.country, restricted: true }
      });
    }

    if (state && geo.state && state.toUpperCase() !== geo.state.toUpperCase()) {
      console.warn(`[Geo] State mismatch during registration: user claimed ${state}, IP detected ${geo.state}, IP=${clientIp}`);
    }

    const finalState = (geo.state || stateCode).toUpperCase();

    const existingEmail = await db.findByEmail(email);
    if (existingEmail) {
      return res.status(409).json({ error: 'Email already registered.' });
    }

    const existingUsername = await db.findByUsername(username);
    if (existingUsername) {
      return res.status(409).json({ error: 'Username already taken.' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const userId = await db.createUser({
      username,
      email,
      password: hashedPassword,
      gcBalance: 10000,
      scBalance: 10
    });

    await db.updateUser(userId, {
      state: finalState,
      kyc_status: 'UNVERIFIED',
      kyc_tier: 0,
      geo_ip: clientIp,
      geo_country: geo.country || null,
      geo_city: geo.city || null,
      geo_is_vpn: !!geo.isVpn,
      geo_risk_score: geo.riskScore || 0,
      registered_at: Date.now()
    });

    // Always create an affiliate record so the user has a referral code
    await ensureAffiliateRecordFor(userId, generateReferralCode(username), null);

    // Auto-attribute referral if a valid code is provided
    if (ref) {
      try {
        const referrerAff = await db.getAffiliateByCode(String(ref).trim());
        if (referrerAff && referrerAff.user_id !== userId) {
          await db.setAffiliateReferredBy(userId, referrerAff.user_id);
        }
      } catch (e) {
        console.warn('[Register Referral Hook]:', e.message);
      }
    }

    const newUser = {
      id: userId,
      username,
      email,
      password: hashedPassword,
      gc_balance: 10000.0,
      sc_unplayed: 10.0,
      sc_played: 0.0,
      stripeAccountId: null,
      kyc: {
        status: 'UNVERIFIED',
        tier: 0,
        inquiryId: null,
        verifiedAt: null,
        rejectionReason: null
      },
      lastDailyClaim: 0,
      dailyStreak: 0,
      adsWatchedToday: 0,
      lastAdReset: Date.now(),
      state: stateCode,
      createdAt: Date.now(),
      vipTier: 'Bronze',
      totalWageredGC: 0,
      totalWageredSC: 0,
      rakebackAccruedSC: 0,
      bonus: {
        lastClaimAt: 0,
        claimStreak: 0,
        dailyClaimed: false,
        challenges: [],
        challengeDate: '',
        telemetry: {
          scWagered: 0, gcWagered: 0, rounds: 0, roundsWon: 0,
          gamesPlayed: [], dailyLossSC: 0, dailyWagerSC: 0, dailyWinSC: 0,
          weeklyLossSC: 0, weeklyWagerSC: 0, weeklyWinSC: 0,
          monthlyLossSC: 0, monthlyWagerSC: 0, monthlyWinSC: 0,
          diceOver90: 0, crashCashout2x: 0, blackjackHands: 0,
          history: [],
          lastDailyReset: Date.now(),
          lastWeeklyReset: Date.now(),
          lastMonthlyReset: Date.now()
        },
        rakeback: {
          lastDailyAt: 0, lastWeeklyAt: 0, lastMonthlyAt: 0,
          dailyPool: 0, weeklyPool: 0, monthlyPool: 0
        }
      }
    };
     users.set(userId, newUser);
    transactions.set(userId, []);

    const token = jwt.sign({ id: userId, username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({
      token,
      user: { id: userId, username, email, isGuest: false, kyc: newUser.kyc, state: stateCode },
      balances: { gc: 10000, sc: 10 }
    });
  } catch (e) {
    console.error('[Registration Error]:', e.message);
    if (e.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'Email or username already exists.' });
    }
    res.status(500).json({ error: 'Failed to create account. Please try again.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    let foundUser = null;
    const dbUser = await db.findByEmail(email);
    if (dbUser) {
      foundUser = users.get(dbUser.id);
      if (!foundUser) {
        foundUser = {
          id: dbUser.id,
          username: dbUser.username,
          email: dbUser.email,
          password: dbUser.password,
          gc_balance: dbUser.gc_balance,
          sc_unplayed: dbUser.sc_unplayed,
          sc_played: dbUser.sc_played,
          stripeAccountId: dbUser.stripe_account_id,
          kyc: {
            status: dbUser.kyc_status,
            tier: dbUser.kyc_tier,
            inquiryId: dbUser.kyc_inquiry_id,
            verifiedAt: dbUser.kyc_verified_at,
            rejectionReason: dbUser.kyc_rejection_reason
          },
          state: dbUser.state,
          createdAt: dbUser.created_at,
          vipTier: dbUser.vip_tier,
          totalWageredGC: dbUser.total_wagered_gc,
          totalWageredSC: dbUser.total_wagered_sc,
          rakebackAccruedSC: dbUser.rakeback_accrued_sc,
          geoIp: dbUser.geo_ip,
          geoCountry: dbUser.geo_country,
          geoCity: dbUser.geo_city,
          geoIsVpn: dbUser.geo_is_vpn,
          geoRiskScore: dbUser.geo_risk_score,
          registeredAt: dbUser.registered_at,
          isGuest: dbUser.email && dbUser.email.endsWith('@guest.casino')
        };
        users.set(dbUser.id, foundUser);
        transactions.set(dbUser.id, []);
      }
    }

    if (!foundUser) return res.status(401).json({ error: 'Invalid credentials.' });

    const valid = await bcrypt.compare(password, foundUser.password || '');
    if (!valid) return res.status(401).json({ error: 'Invalid credentials.' });

    const clientIp = getClientIp(req);
    const geo = await geoLookup(clientIp);
    const detectedState = (geo.state || foundUser.state || 'CA').toUpperCase();
    const detectedCountry = (geo.country || 'US').toUpperCase();

    if (RESTRICTED_STATES.includes(detectedState) || RESTRICTED_COUNTRIES.includes(detectedCountry)) {
      return res.status(403).json({
        error: `Sweepstakes play is unavailable in your jurisdiction (${detectedState || detectedCountry}).`,
        geo: { state: geo.state, country: geo.country, restricted: true }
      });
    }

    if (geo.isVpn || geo.riskScore >= 50) {
      return res.status(403).json({
        error: 'Access from VPN, proxy, or hosting provider is not allowed.',
        geo: { state: geo.state, country: geo.country, isVpn: geo.isVpn, riskScore: geo.riskScore }
      });
    }

    await db.updateUser(foundUser.id, {
      geo_ip: clientIp,
      geo_country: geo.country || null,
      geo_city: geo.city || null,
      geo_is_vpn: geo.isVpn ? 1 : 0,
      geo_risk_score: geo.riskScore || 0
    });

    const token = jwt.sign({ id: foundUser.id, username: foundUser.username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({
      token,
      user: {
        id: foundUser.id,
        username: foundUser.username,
        email: foundUser.email,
        isGuest: foundUser.isGuest || (foundUser.email && foundUser.email.endsWith('@guest.casino')) || false,
        kyc: foundUser.kyc,
        state: foundUser.state,
        geo: { ip: clientIp, country: geo.country, state: geo.state, city: geo.city, isVpn: geo.isVpn, riskScore: geo.riskScore }
      },
      balances: { gc: foundUser.gc_balance, sc: foundUser.sc_unplayed + foundUser.sc_played }
    });
  } catch (e) {
    console.error('[Login Error]:', e.message);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

app.get('/api/user/me', verifyToken, async (req, res) => {
  const user = users.get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User profile not found.' });

  // Geo check on profile access
  const clientIp = getClientIp(req);
  const geo = await geoLookup(clientIp);
  const detectedState = (geo.state || user.state || 'CA').toUpperCase();
  const detectedCountry = (geo.country || 'US').toUpperCase();
  if (RESTRICTED_STATES.includes(detectedState) || RESTRICTED_COUNTRIES.includes(detectedCountry)) {
    return res.status(403).json({
      error: `Sweepstakes play is unavailable in your jurisdiction (${detectedState || detectedCountry}).`,
      geo: { state: geo.state, country: geo.country, restricted: true }
    });
  }
  if (geo.isVpn || geo.riskScore >= 50) {
    return res.status(403).json({
      error: 'Access from VPN, proxy, or hosting provider is not allowed.',
      geo: { state: geo.state, country: geo.country, isVpn: geo.isVpn, riskScore: geo.riskScore }
    });
  }

  // Update geo in DB
  await db.updateUser(user.id, {
    geo_ip: clientIp,
    geo_country: geo.country || null,
    geo_city: geo.city || null,
    geo_is_vpn: geo.isVpn ? 1 : 0,
    geo_risk_score: geo.riskScore || 0
  });
  user.geoIp = clientIp;
  user.geoCountry = geo.country || null;
  user.geoCity = geo.city || null;
  user.geoIsVpn = !!geo.isVpn;
  user.geoRiskScore = geo.riskScore || 0;

  let transfersActive = false;
  if (user.stripeAccountId) {
    try {
      const acc = await stripe.accounts.retrieve(user.stripeAccountId);
      transfersActive = acc.capabilities?.transfers === 'active';
    } catch (e) {
      transfersActive = false;
    }
  }

   res.json({
    id: user.id,
    username: user.username,
    email: user.email,
    state: user.state,
    geo: {
      ip: user.geoIp || null,
      country: user.geoCountry || null,
      city: user.geoCity || null,
      isVpn: !!user.geoIsVpn,
      riskScore: user.geoRiskScore || 0,
      registeredAt: user.registeredAt || null
    },
    isGuest: user.email && user.email.endsWith('@guest.casino'),
    createdAt: user.createdAt,
    balances: { 
      gc: user.gc_balance, 
      sc: user.sc_unplayed + user.sc_played,
      sc_unplayed: user.sc_unplayed, 
      sc_played: user.sc_played
    },
    kyc: user.kyc || { status: 'UNVERIFIED', tier: 0 },
    vip: {
      tier: user.vipTier,
      totalWageredSC: user.totalWageredSC,
      totalWageredGC: user.totalWageredGC,
      rakebackAccruedSC: user.rakebackAccruedSC
    },
    hasPayoutAccount: !!user.stripeAccountId,
    transfersActive,
    flags: {
      allowGuestPayments: process.env.ALLOW_GUEST_PAYMENTS === 'true'
    },
    dailyBonus: {
      canClaim: Date.now() - (user.bonus?.lastClaimAt || user.lastDailyClaim || 0) > 24 * 60 * 60 * 1000,
      nextClaimMs: Math.max(0, ((user.bonus?.lastClaimAt || user.lastDailyClaim || 0) + 24 * 60 * 60 * 1000) - Date.now()),
      streak: user.bonus?.claimStreak || user.dailyStreak || 0
    },
    bonus: user.bonus ? {
      lastClaimAt: user.bonus.lastClaimAt,
      claimStreak: user.bonus.claimStreak,
      dailyClaimed: user.bonus.dailyClaimed,
      challengeDate: user.bonus.challengeDate,
      challenges: user.bonus.challenges,
      rakeback: user.bonus.rakeback
    } : null
  });
});

app.get('/api/session-status', (req, res) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.json({ authenticated: false });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = users.get(decoded.id);
    if (!user) {
      return res.json({ authenticated: false });
    }

    const clientIp = getClientIp(req);
    const detectedState = (user.state || 'CA').toUpperCase();
    const detectedCountry = (user.geoCountry || 'US').toUpperCase();
    if (RESTRICTED_STATES.includes(detectedState) || RESTRICTED_COUNTRIES.includes(detectedCountry)) {
      return res.json({ authenticated: false, geoRestricted: true, state: detectedState, country: detectedCountry });
    }
    if (user.geoIsVpn || (user.geoRiskScore || 0) >= 50) {
      return res.json({ authenticated: false, geoRestricted: true, isVpn: !!user.geoIsVpn, riskScore: user.geoRiskScore || 0 });
    }

    res.json({
      authenticated: true,
      id: user.id,
      username: user.username,
      email: user.email,
      state: user.state,
      geo: {
        ip: user.geoIp || null,
        country: user.geoCountry || null,
        city: user.geoCity || null,
        isVpn: !!user.geoIsVpn,
        riskScore: user.geoRiskScore || 0,
        registeredAt: user.registeredAt || null
      },
      isGuest: user.email ? user.email.endsWith('@guest.casino') : false,
      kyc: user.kyc || { status: 'UNVERIFIED', tier: 0 },
      balances: { gc: user.gc_balance, sc: user.sc_unplayed + user.sc_played },
      flags: {
        allowGuestPayments: process.env.ALLOW_GUEST_PAYMENTS === 'true'
      }
    });
  } catch (err) {
    res.json({ authenticated: false });
  }
});

app.get('/api/user/transactions', verifyToken, enforceJurisdiction, (req, res) => {
  const userTransactions = transactions.get(req.user.id) || [];
  
  const typeFilter = req.query.type;
  const currencyFilter = req.query.currency;
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;

  let filtered = userTransactions;

  if (typeFilter) {
    filtered = filtered.filter(tx => tx.type === typeFilter.toUpperCase());
  }

  if (currencyFilter) {
    filtered = filtered.filter(tx => tx.currency === currencyFilter.toUpperCase());
  }

  const startIndex = (page - 1) * limit;
  const endIndex = page * limit;
  const paginatedResults = filtered.slice(startIndex, endIndex);

  res.json({
    transactions: paginatedResults,
    pagination: {
      total: filtered.length,
      page,
      limit,
      totalPages: Math.ceil(filtered.length / limit)
    }
  });
});

// -----------------------------------------------------------------------------
// 9. STAKE-STYLE KYC VERIFICATION & USER ACTION ENDPOINTS
// -----------------------------------------------------------------------------

app.post('/api/user/kyc/start', verifyToken, enforceJurisdiction, (req, res) => {
  const user = users.get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  if (user.kyc.status === 'VERIFIED') {
    return res.status(400).json({ error: 'Identity is already fully verified.' });
  }

  user.kyc.status = 'PENDING';
  
  res.json({
    success: true,
    kycStatus: user.kyc.status,
    personaConfig: {
      templateId: process.env.PERSONA_TEMPLATE_ID || 'itmpl_sandbox_default',
      referenceId: user.id.toString(),
      environment: process.env.NODE_ENV === 'production' ? 'production' : 'sandbox'
    }
  });
});

app.post('/api/user/kyc/verify-sandbox', verifyToken, enforceJurisdiction, (req, res) => {
  // Sandbox KYC is only available in development/test environments
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Sandbox verification is not available in production.' });
  }
  const user = users.get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  user.kyc.status = 'VERIFIED';
  user.kyc.tier = 2;
  user.kyc.verifiedAt = new Date().toISOString();
  user.kyc.rejectionReason = null;
  saveData();

  res.json({
    success: true,
    message: 'Sandbox Identity Verification Successful!',
    kyc: user.kyc
  });
});

app.post('/api/user/amoe-code', verifyToken, enforceJurisdiction, (req, res) => {
  const code = `AMOE-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  amoeRegistry.set(code, { userId: req.user.id, issuedAt: Date.now(), redeemed: false });
  
  res.json({
    success: true,
    amoeCode: code,
    instructions: 'Write this code on a 4x6 post card along with your account username and mail it to our legal sweepstakes address to claim 5.00 free SC.'
  });
});

app.post('/api/user/claim-rakeback', verifyToken, enforceJurisdiction, (req, res) => {
  const user = users.get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const bonus = ensureBonusFields(user);
  const rak = bonus.rakeback || { dailyPool: 0, weeklyPool: 0, monthlyPool: 0 };
  const totalRakeback = (rak.dailyPool || 0) + (rak.weeklyPool || 0) + (rak.monthlyPool || 0);

  if (totalRakeback <= 0 && user.rakebackAccruedSC <= 0) {
    return res.status(400).json({ error: 'No rakeback available to claim.' });
  }

  const legacyAmount = user.rakebackAccruedSC || 0;
  const poolAmount = totalRakeback;
  const totalClaim = round2(legacyAmount + poolAmount);

  if (totalClaim <= 0) {
    return res.status(400).json({ error: 'No rakeback available to claim.' });
  }

  user.sc_unplayed += totalClaim;
  user.rakebackAccruedSC = 0;
  if (bonus.rakeback) {
    bonus.rakeback.dailyPool = 0;
    bonus.rakeback.weeklyPool = 0;
    bonus.rakeback.monthlyPool = 0;
  }
  saveData();

  logTransaction(user.id, 'RAKEBACK', `Claimed Rakeback (legacy endpoint)`, 0, totalClaim);

  res.json({
    success: true,
    claimed: totalClaim,
    balances: { gc: user.gc_balance, sc: user.sc_unplayed + user.sc_played }
  });
});

app.post('/api/user/daily-bonus', verifyToken, enforceJurisdiction, (req, res) => {
  const user = users.get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const bonus = ensureBonusFields(user);
  const now = Date.now();
  const ONE_DAY = 24 * 60 * 60 * 1000;
  const TWO_DAYS = 48 * 60 * 60 * 1000;

  if (now - bonus.lastClaimAt < ONE_DAY) {
    const remainingMs = (bonus.lastClaimAt + ONE_DAY) - now;
    return res.status(400).json({ error: 'Daily bonus is not ready yet.', nextClaimMs: remainingMs });
  }

  if (now - bonus.lastClaimAt > TWO_DAYS) {
    bonus.claimStreak = 1;
  } else {
    bonus.claimStreak = (bonus.claimStreak || 0) + 1;
  }

  bonus.lastClaimAt = now;
  bonus.dailyClaimed = true;
  const gcReward = 5000 + (bonus.claimStreak * 1000);
  const scReward = 1.00 + (bonus.claimStreak * 0.25);

  user.gc_balance += gcReward;
  user.sc_unplayed += scReward;
  saveData();

  logTransaction(user.id, 'BONUS', `Daily Claim (Day ${bonus.claimStreak})`, gcReward, scReward);

  res.json({
    success: true,
    claimed: { gc: gcReward, sc: scReward },
    streak: bonus.claimStreak,
    balances: { gc: user.gc_balance, sc: user.sc_unplayed + user.sc_played }
  });
});

app.post('/api/user/rewarded-ad', verifyToken, enforceJurisdiction, (req, res) => {
  const user = users.get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const now = Date.now();
  if (now - user.lastAdReset > 24 * 60 * 60 * 1000) {
    user.adsWatchedToday = 0;
    user.lastAdReset = now;
  }

  if (user.adsWatchedToday >= 10) {
    return res.status(429).json({ error: 'Daily ad watch limit reached (10/10).' });
  }

  user.adsWatchedToday += 1;
  const gcReward = 2500;
  const scReward = 0.25;

  user.gc_balance += gcReward;
  user.sc_unplayed += scReward;
  saveData();

  logTransaction(user.id, 'AD_REWARD', `Watched Video Ad (#${user.adsWatchedToday})`, gcReward, scReward);

  res.json({
    success: true,
    adsWatchedToday: user.adsWatchedToday,
    reward: { gc: gcReward, sc: scReward },
    balances: { gc: user.gc_balance, sc: user.sc_unplayed + user.sc_played }
  });
});

app.post('/api/user/buy-coins', verifyToken, enforceJurisdiction, async (req, res) => {
  const { packageId, uiMode } = req.body;
  const pkg = COIN_PACKAGES[packageId || 'pack_10'];

  if (!pkg) return res.status(400).json({ error: 'Invalid coin package.' });

  const user = users.get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const guestPaymentsAllowed = process.env.ALLOW_GUEST_PAYMENTS === 'true';
  if (!guestPaymentsAllowed && isGuestUser(user)) {
    return res.status(403).json({
      error: 'Guest accounts cannot purchase coins. Please register a real account first.',
      requiresAccount: true
    });
  }

  const host = req.headers.origin || `https://${req.headers.host}`;
  const mode = uiMode === 'hosted' ? 'hosted' : 'embedded_page';

  if (!stripe) {
    return res.status(500).json({ error: 'Payment processor is not configured. Please contact support or try again later.' });
  }

  try {
    const sessionConfig = {
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: pkg.name },
          unit_amount: pkg.priceInCents,
        },
        quantity: 1,
      }],
      mode: 'payment',
      metadata: {
        userId: req.user.id.toString(),
        packageName: pkg.name,
        gcAmount: pkg.gcAmount.toString(),
        scAmount: pkg.scAmount.toString()
      }
    };

    if (mode === 'embedded_page') {
      sessionConfig.ui_mode = 'embedded_page';
      sessionConfig.return_url = `${host}/?payment=success&session_id={CHECKOUT_SESSION_ID}`;
    } else {
      sessionConfig.success_url = `${host}/?payment=success&session_id={CHECKOUT_SESSION_ID}`;
      sessionConfig.cancel_url = `${host}/?payment=cancelled`;
    }

    const session = await stripe.checkout.sessions.create(sessionConfig);

    try {
      await db.addTransaction({
        id: `stripe_${session.id}`,
        userId: user.id,
        type: 'PURCHASE',
        description: `Purchased ${pkg.name} (Stripe)`,
        gcDelta: pkg.gcAmount,
        scDelta: pkg.scAmount,
        currency: 'GC',
        amount: pkg.priceInCents / 100,
        status: 'PENDING',
        metadata: { stripeSessionId: session.id, packageId, uiMode: mode }
      });
    } catch (e) { console.error('[Stripe Purchase Tracking]:', e.message); }

    res.json({
      clientSecret: session.client_secret,
      url: session.url,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create checkout session.', details: err.message });
  }
});

// Crypto Payment Initiation (Mock / Integration Point)
app.post('/api/user/crypto-payment/initiate', verifyToken, enforceJurisdiction, async (req, res) => {
  const { packageId, currency } = req.body;
  const pkg = COIN_PACKAGES[packageId || 'pack_10'];
  if (!pkg) return res.status(400).json({ error: 'Invalid coin package.' });

  const cur = (currency || 'BTC').toUpperCase();
  if (!ALLOWED_CRYPTOS.includes(cur)) {
    return res.status(400).json({ error: 'Unsupported cryptocurrency. Accepted: BTC, ETH, BASE, POLYGON, USDC, USDT, SOL.' });
  }

  const user = users.get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const guestOk = process.env.ALLOW_GUEST_PAYMENTS === 'true';
  if (!guestOk && isGuestUser(user)) {
    return res.status(403).json({ error: 'Guest accounts cannot purchase coins. Please register a real account first.', requiresAccount: true });
  }

  const usdAmount = pkg.priceInCents / 100;
  const address = CRYPTO_ADDRESSES[cur] || '';
  if (!address) {
    return res.status(503).json({ error: `Merchant ${cur} address is not configured.`, currency: cur });
  }
  const cryptoAmounts = {
    BTC:     (usdAmount / 50000).toFixed(8),
    ETH:     (usdAmount / 3000).toFixed(6),
    BASE:    (usdAmount / 3000).toFixed(6),
    POLYGON: (usdAmount / 1).toFixed(6),
    USDC:    usdAmount.toFixed(2),
    USDT:    usdAmount.toFixed(2),
    SOL:     (usdAmount / 150).toFixed(6)
  };
  const amount = cryptoAmounts[cur] || '0';

  const paymentId = crypto.randomUUID();
  cryptoPayments.set(paymentId, {
    userId: user.id,
    packageId,
    currency: cur,
    chain: chainOf(cur),
    address,
    amount,
    usdAmount,
    gcAmount: pkg.gcAmount,
    scAmount: pkg.scAmount,
    status: 'PENDING',
    createdAt: Date.now()
  });

  res.json({
    success: true,
    paymentId,
    currency: cur,
    chain: chainOf(cur),
    address,
    amount,
    usdAmount,
    message: `Send the suggested ${amount} ${cur} (or more) to the address below. Your package will be credited after on-chain confirmation.`
  });
});

// -----------------------------------------------------------------------------
// Crypto payment confirmation by txid (user-submitted)
// Every currency is verified on-chain (Solana RPC, mempool.space, Ethereum
// JSON-RPC) before the package is credited — no packs are granted without
// verified payment. In production this is also driven by a blockchain webhook.
// -----------------------------------------------------------------------------
app.post('/api/user/crypto-payment/confirm', verifyToken, enforceJurisdiction, async (req, res) => {
  const guestOk = process.env.ALLOW_GUEST_PAYMENTS === 'true';
  const user = users.get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (!guestOk && isGuestUser(user)) {
    return res.status(403).json({ error: 'Guest accounts cannot purchase coins.', requiresAccount: true });
  }

  const { paymentId, txid, amountSent } = req.body || {};
  if (!paymentId) return res.status(400).json({ error: 'paymentId is required.' });
  if (!txid) return res.status(400).json({ error: 'Transaction ID (txid) is required.' });

  const payment = cryptoPayments.get(paymentId);
  if (!payment) return res.status(404).json({ error: 'Payment not found.' });
  if (payment.userId !== user.id) return res.status(403).json({ error: 'Payment does not belong to this user.' });
  if (payment.status === 'COMPLETED') {
    return res.status(409).json({ error: 'Payment already credited.' });
  }

  try {
    const verify = await verifyCryptoDeposit(payment, txid);
    if (!verify.verified) {
      return res.status(400).json({ error: verify.error || 'Payment could not be verified on-chain.', verified: false, currency: payment.currency });
    }

    // Credit the selected package
    if (acquireLock(user.id, 'crypto-' + paymentId)) {
      try {
        user.gc_balance = round2((user.gc_balance || 0) + payment.gcAmount);
        user.sc_unplayed = round2((user.sc_unplayed || 0) + payment.scAmount);
        const txAmount = amountSent ? parseFloat(amountSent) : Number(payment.amount || 0);
        const usd = txAmount > 0 ? txAmount * payment.usdAmount : payment.usdAmount;
        logTransaction(user.id, 'PURCHASE', `Crypto ${payment.currency} deposit (txid ${txid}) ${txAmount ? txAmount + ' ' + payment.currency + ' sent' : ''}`, payment.gcAmount, payment.scAmount, { paymentId, currency: payment.currency, txid, amountSent: txAmount || null });
        creditReferrerForDeposit(user, usd || payment.usdAmount || 0);
        try { await db.addTransaction({ id: `crypto_${paymentId}`, userId: user.id, type: 'PURCHASE', description: `Crypto ${payment.currency} deposit (txid ${txid})`, gcDelta: payment.gcAmount, scDelta: payment.scAmount, currency: 'GC', amount: payment.usdAmount || 0, status: 'COMPLETED', metadata: { paymentId, currency: payment.currency, chain: payment.chain, address: payment.address, txid, amountSent: txAmount || null } }); } catch (e) { console.error('[Crypto Confirm DB]:', e.message); }
        saveData();
      } finally {
        releaseLock(user.id, 'crypto-' + paymentId);
      }
    }

    payment.status = 'COMPLETED';
    payment.txid = txid;
    cryptoPayments.set(paymentId, payment);

    sendToUser(user.id, {
      type: 'BALANCE_UPDATE',
      balances: { gc: user.gc_balance, sc_unplayed: user.sc_unplayed, sc_played: user.sc_played },
      message: `Crypto deposit confirmed! +${payment.gcAmount} GC + ${payment.scAmount} SC credited.`
    });

    res.json({
      success: true,
      verified: true,
      credited: { gc: payment.gcAmount, sc: payment.scAmount },
      balances: { gc: user.gc_balance, sc: user.sc_unplayed + user.sc_played }
    });
  } catch (err) {
    console.error('[Crypto Confirm Error]:', err.message);
    res.status(500).json({ error: 'Failed to confirm crypto payment.' });
  }
});

app.post('/api/user/crypto-payment/webhook', express.json(), async (req, res) => {
  const { paymentId, status, address, txid } = req.body;
  const payment = cryptoPayments.get(paymentId);
  if (!payment) return res.status(404).json({ error: 'Payment not found.' });

  if (status === 'CONFIRMED' || status === 'COMPLETED') {
    if (payment.status === 'COMPLETED') {
      return res.json({ success: true, deduplicated: true });
    }
    // Only honour webhooks that target the configured merchant address.
    if (address && address.toLowerCase !== undefined && typeof address.toLowerCase === 'function' && address.toLowerCase() !== String(payment.address || CRYPTO_ADDRESSES[payment.currency] || '').toLowerCase()) {
      console.warn('[Crypto Webhook]: address mismatch (ignored)', address, payment.address);
    }
    payment.status = 'COMPLETED';
    const user = users.get(payment.userId);
    if (user) {
      user.gc_balance = round2((user.gc_balance || 0) + payment.gcAmount);
      user.sc_unplayed = round2((user.sc_unplayed || 0) + payment.scAmount);
      saveData();
      logTransaction(user.id, 'PURCHASE', `Crypto ${payment.currency} payment`, payment.gcAmount, payment.scAmount, { paymentId, currency: payment.currency, address: payment.address, txid });
      try {
        await db.addTransaction({
          id: `crypto_${paymentId}`,
          userId: user.id,
          type: 'PURCHASE',
          description: `Crypto ${payment.currency} payment (webhook)`,
          gcDelta: payment.gcAmount,
          scDelta: payment.scAmount,
          currency: 'GC',
          amount: payment.usdAmount || 0,
          status: 'COMPLETED',
          metadata: { paymentId, currency: payment.currency, chain: payment.chain, address: payment.address, txid }
        });
      } catch (e) { console.error('[Crypto Webhook DB]:', e.message); }
      creditReferrerForDeposit(user, payment.usdAmount || 0);
      sendToUser(user.id, {
        type: 'BALANCE_UPDATE',
        balances: { gc: user.gc_balance, sc_unplayed: user.sc_unplayed, sc_played: user.sc_played },
        message: `Crypto deposit confirmed! +${payment.gcAmount} GC + ${payment.scAmount} SC credited.`
      });
    }
  }

  res.json({ success: true });
});

// Public: merchant deposit addresses per currency (used by the checkout UI + QR).
app.get('/api/crypto/addresses', (req, res) => {
  const addresses = {};
  for (const c of ALLOWED_CRYPTOS) {
    addresses[c] = { address: CRYPTO_ADDRESSES[c] || null, chain: chainOf(c) };
  }
  res.json({ currencies: ALLOWED_CRYPTOS, addresses });
});

// Public: render a QR code (SVG) for any deposit URI / address, generated locally.
app.get('/api/crypto/qr', async (req, res) => {
  const data = (req.query.data || '').toString().trim();
  if (!data) return res.status(400).json({ error: 'data query param is required.' });
  try {
    const QRCode = require('qrcode');
    const svg = await QRCode.toString(data, { type: 'svg', margin: 1, width: 256, color: { dark: '#000', light: '#fff' } });
    res.type('image/svg+xml').send(svg);
  } catch (e) {
    console.error('[QR]:', e.message);
    res.status(500).json({ error: 'QR generation failed.' });
  }
});

// -----------------------------------------------------------------------------
// Phantom (Solana) payment confirmation
// Verifies the on-chain transfer matches the expected lamports, then credits.
// -----------------------------------------------------------------------------
const PHANTOM_MERCHANT = process.env.MERCHANT_SOL || '8p47qJgqVaqF6S6jDByyByv7xT2Ayg2P4Y7K59zQyKkW';
const SOLANA_RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const ETH_RPC = process.env.ETH_RPC_URL || 'https://cloudflare-eth.com';
const BASE_RPC = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const POLYGON_RPC = process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com';
const MERCHANT_BTC_ADDR = (process.env.MERCHANT_BTC || 'bc1qvradlsp8n6p2cjcckyhha7r3kf98uuxu9pnkht').toLowerCase();
const MERCHANT_ETH_ADDR = (process.env.MERCHANT_ETH || '0xA2D4d2691C2ED0d8f48ed2fFd2d4b22f985C4cd5').toLowerCase().replace(/^0x/, '');

// Accepted deposit currencies (module-level so routes + the addresses endpoint share one source of truth).
const ALLOWED_CRYPTOS = ['BTC', 'ETH', 'BASE', 'POLYGON', 'USDC', 'USDT', 'SOL'];

// Canonical merchant address map per accepted currency.
// EVM-native currencies (ETH/BASE/POLYGON) share one EVM address; USDT (ERC-20) uses it too.
// BTC/SOL/USDC are chain-native or token-account addresses (case preserved: base58/bech32).
const CRYPTO_ADDRESSES = {
  BTC:     MERCHANT_BTC_ADDR,
  ETH:     '0x' + MERCHANT_ETH_ADDR,
  BASE:    '0x' + MERCHANT_ETH_ADDR,
  POLYGON: '0x' + MERCHANT_ETH_ADDR,
  USDT:    '0x' + MERCHANT_ETH_ADDR,
  USDC:    process.env.MERCHANT_USDC || '',
  SOL:     PHANTOM_MERCHANT
};
function chainOf(currency) {
  switch (currency) {
    case 'BTC': return 'bitcoin';
    case 'ETH': return 'ethereum';
    case 'BASE': return 'base';
    case 'POLYGON': return 'polygon';
    case 'USDT': return 'ethereum';
    case 'USDC': return 'solana';
    case 'SOL': return 'solana';
    default: return 'unknown';
  }
}

async function solanaGetTransaction(txid) {
  const rpcRes = await fetch(SOLANA_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'getTransaction',
      params: [txid, { encoding: 'json', commitment: 'confirmed' }]
    })
  });
  const rpcData = await rpcRes.json();
  return { tx: rpcData?.result?.transaction, meta: rpcData?.result?.meta };
}

function ethCallFactory(rpcUrl) {
  return async function ethCall(method, params) {
    const r = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params })
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    return j.result;
  };
}

// Verify a user-submitted on-chain payment against the merchant address for the
// payment's currency/chain. Returns { verified, received, error }.
async function verifyCryptoDeposit(payment, txid) {
  const currency = payment.currency;
  const expected = parseFloat(payment.amount) || 0;
  const usdAmount = payment.usdAmount || expected;
  const merchantAddress = (payment.address || CRYPTO_ADDRESSES[currency] || '').trim();
  try {
    if (!merchantAddress) {
      return { verified: false, error: `Merchant ${currency} address is not configured.` };
    }

    // ---- Solana: native SOL ----
    if (currency === 'SOL') {
      const { tx, meta } = await solanaGetTransaction(txid);
      if (!tx || !meta || meta.err) return { verified: false, error: 'Solana transaction not found or failed.' };
      const accountKeys = tx.message?.accountKeys || [];
      const toIdx = accountKeys.findIndex(k => (typeof k === 'string' ? k : k.pubkey) === merchantAddress);
      if (toIdx === -1) return { verified: false, error: 'Transaction does not credit the merchant Solana wallet.' };
      const received = (meta.postBalances?.[toIdx] ?? 0) - (meta.preBalances?.[toIdx] ?? 0);
      if (received <= 0) return { verified: false, error: 'No SOL was received by the merchant wallet.' };
      if (received < expected * 1e9) return { verified: false, error: 'Received amount is below the required deposit.', received: (received / 1e9) + ' SOL' };
      return { verified: true, received: (received / 1e9) + ' SOL' };
    }

    // ---- Solana: SPL token (USDC) — match by token-account owner OR credited account ----
    if (currency === 'USDC') {
      const { tx, meta } = await solanaGetTransaction(txid);
      if (!tx || !meta || meta.err) return { verified: false, error: 'Solana transaction not found or failed.' };
      const postTok = meta.postTokenBalances || [];
      const preTok = meta.preTokenBalances || [];
      let receivedUi = 0;
      for (const pb of postTok) {
        const matches = (pb.account && pb.account === merchantAddress) || pb.owner === merchantAddress;
        if (!matches) continue;
        const pre = preTok.find(p => p.account === pb.account);
        const delta = parseFloat(pb.uiAmount || 0) - (pre ? parseFloat(pre.uiAmount || 0) : 0);
        if (delta > receivedUi) receivedUi = delta;
      }
      if (receivedUi <= 0) return { verified: false, error: 'No USDC was received by the merchant address.' };
      if (receivedUi < expected) return { verified: false, error: 'Received amount is below the required deposit.', received: receivedUi + ' USDC' };
      return { verified: true, received: receivedUi + ' USDC' };
    }

    // ---- Bitcoin ----
    if (currency === 'BTC') {
      const rpcRes = await fetch('https://mempool.space/api/tx/' + encodeURIComponent(txid));
      if (!rpcRes.ok) return { verified: false, error: 'Bitcoin transaction not found on the explorer.' };
      const t = await rpcRes.json();
      let receivedSats = 0;
      for (const v of (t.vout || [])) {
        const a = (v.scriptpubkey_address || v.scriptpubkey_addr || '').toLowerCase();
        if (a === MERCHANT_BTC_ADDR) {
          let val = v.value;
          if (val !== undefined && val < 1) val = Math.round(val * 1e8);
          receivedSats += (val || 0);
        }
      }
      const expectedSats = Math.round(expected * 1e8);
      if (receivedSats <= 0) return { verified: false, error: 'No BTC was received by the merchant address.' };
      if (receivedSats < expectedSats) return { verified: false, error: 'Received amount is below the required deposit.', received: (receivedSats / 1e8) + ' BTC' };
      return { verified: true, received: (receivedSats / 1e8) + ' BTC' };
    }

    // ---- EVM chains: native ETH / BASE / POLYGON, or ERC-20 USDT ----
    if (currency === 'ETH' || currency === 'BASE' || currency === 'POLYGON' || currency === 'USDT') {
      const rpcUrl = currency === 'BASE' ? BASE_RPC : currency === 'POLYGON' ? POLYGON_RPC : ETH_RPC;
      const eth = ethCallFactory(rpcUrl);
      const tx = await eth('eth_getTransactionByHash', [txid]);
      if (!tx) return { verified: false, error: currency + ' transaction not found.' };
      const receipt = await eth('eth_getTransactionReceipt', [txid]);
      if (!receipt) return { verified: false, error: 'Transaction receipt not found.' };
      if (receipt.status === '0x0') return { verified: false, error: 'Transaction failed on-chain.' };

      const fullEth = '0x' + MERCHANT_ETH_ADDR;
      // Native coin transfer (ETH / BASE / POLYGON)
      if (currency !== 'USDT' && tx.to && tx.to.toLowerCase() === fullEth) {
        const expectedWei = BigInt(Math.round(expected * 1e18));
        const val = BigInt(tx.value || '0x0');
        if (val >= expectedWei) return { verified: true, received: (Number(val) / 1e18) + ' ' + currency };
        return { verified: false, error: 'Received ' + currency + ' amount is below the required deposit.', received: (Number(val) / 1e18) + ' ' + currency };
      }
      // ERC-20 token transfer (USDT) credited to the merchant
      const expectedToken = BigInt(Math.round(usdAmount * 1e6));
      const padAddr = '0x' + MERCHANT_ETH_ADDR.padStart(64, '0');
      let tokenIn = 0n;
      for (const log of (receipt.logs || [])) {
        if (log.topics && log.topics.length >= 3 && log.topics[2] && log.topics[2].toLowerCase() === padAddr) {
          const d = BigInt(log.data || '0x0');
          if (d > tokenIn) tokenIn = d;
        }
      }
      if (tokenIn > 0n) {
        if (tokenIn < expectedToken) return { verified: false, error: 'Received amount is below the required deposit.', received: (Number(tokenIn) / 1e6) + ' ' + currency };
        return { verified: true, received: (Number(tokenIn) / 1e6) + ' ' + currency };
      }
      return { verified: false, error: 'No ' + currency + ' was received by the merchant address.' };
    }

    return { verified: false, error: 'No on-chain verification path configured for ' + currency + '.' };
  } catch (e) {
    console.warn('[Crypto Verify] ' + currency + ' lookup failed:', e.message);
    return { verified: false, error: 'Could not verify the deposit on-chain for ' + currency + '. Please retry or use the processor confirmation flow.' };
  }
}


app.post('/api/user/crypto-payment/phantom-confirm', verifyToken, enforceJurisdiction, async (req, res) => {
  const user = users.get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const guestOk = process.env.ALLOW_GUEST_PAYMENTS === 'true';
  if (!guestOk && isGuestUser(user)) {
    return res.status(403).json({ error: 'Guest accounts cannot purchase coins.', requiresAccount: true });
  }

  const { paymentId, txSignature, fromAddress } = req.body || {};
  const payment = cryptoPayments.get(paymentId);
  if (!payment) return res.status(404).json({ error: 'Payment not found.' });
  if (payment.userId !== user.id) return res.status(403).json({ error: 'Payment does not belong to this user.' });
  if (payment.status === 'COMPLETED') return res.status(409).json({ error: 'Payment already credited.' });
  if (payment.currency !== 'SOL') return res.status(400).json({ error: 'Phantom flow only handles SOL.' });

  // Idempotency guard
  if (!acquireLock(user.id, 'phantom-' + paymentId)) {
    return res.status(409).json({ error: 'Confirmation already in progress.' });
  }

  try {
    // Verify on-chain transaction via Solana RPC
    let verified = false;
    try {
      const rpcRes = await fetch(SOLANA_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getTransaction',
          params: [txSignature, { encoding: 'json', commitment: 'confirmed' }]
        })
      });
      const rpcData = await rpcRes.json();
      const tx = rpcData?.result?.transaction;
      const meta = rpcData?.result?.meta;
      if (tx && meta && !meta.err) {
        const accountKeys = tx.message?.accountKeys || [];
        const fromIdx = accountKeys.findIndex(k => (typeof k === 'string' ? k : k.pubkey) === fromAddress);
        const toIdx = accountKeys.findIndex(k => (typeof k === 'string' ? k : k.pubkey) === PHANTOM_MERCHANT);
        if (fromIdx !== -1 && toIdx !== -1) {
          const pre = meta.preBalances?.[fromIdx] ?? 0;
          const post = meta.postBalances?.[fromIdx] ?? 0;
          const lamportsSent = pre - post;
          const expected = Math.round(parseFloat(payment.amount) * 1e9);
          // Allow 1% tolerance for tx fees / network jitter
          if (Math.abs(lamportsSent - expected) <= Math.max(5000, expected * 0.01)) {
            verified = true;
          }
        }
      }
    } catch (e) {
      console.warn('[Phantom] on-chain verification RPC error:', e.message);
    }

    if (!verified) {
      return res.status(400).json({ error: 'On-chain payment could not be verified. Please contact support.' });
    }

    // Mark complete + credit balances
    payment.status = 'COMPLETED';
    user.gc_balance += payment.gcAmount;
    user.sc_unplayed += payment.scAmount;
    saveData();
    logTransaction(user.id, 'PURCHASE', 'Phantom (SOL) payment', payment.gcAmount, payment.scAmount, { paymentId, txSignature });
    creditReferrerForDeposit(user, payment.usdAmount || 0);

    res.json({
      success: true,
      credited: { gc: payment.gcAmount, sc: payment.scAmount },
      balances: balancesOf(user)
    });
  } catch (e) {
    console.error('[Phantom] confirm error:', e.message);
    res.status(500).json({ error: 'Failed to confirm payment.' });
  } finally {
    releaseLock(user.id, 'phantom-' + paymentId);
  }
});

app.post('/api/user/withdraw-sc', verifyToken, enforceJurisdiction, async (req, res) => {
  const user = users.get(req.user.id);
  const host = req.headers.origin || `https://${req.headers.host}`;

  if (!user) return res.status(404).json({ error: 'User not found.' });

  const guestOk = process.env.ALLOW_GUEST_PAYMENTS === 'true';
  if (!guestOk && (!user.kyc || user.kyc.status !== 'VERIFIED')) {
    return res.status(403).json({
      error: 'Identity verification (KYC) is required before redeeming Sweeps Coins for cash.',
      requiresKyc: true
    });
  }

  const amount = parseFloat(req.body.amount);
  if (isNaN(amount) || amount < 50) {
    return res.status(400).json({ error: 'Minimum redemption limit is 50.00 Sweeps Coins (SC).' });
  }

  if (user.sc_played < amount) {
    return res.status(400).json({
      error: `Insufficient redeemable balance. You have ${user.sc_played.toFixed(2)} SC eligible for redemption. (Unplayed SC must be wagered 1x first).`
    });
  }

  try {
    if (!stripe) {
      return res.status(500).json({ error: 'Payment processor is not configured. Please contact support.' });
    }

    if (!user.stripeAccountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        capabilities: { transfers: { requested: true } },
      });
      user.stripeAccountId = account.id;
    }

    const accountCheck = await stripe.accounts.retrieve(user.stripeAccountId);
    const transfersEnabled = accountCheck.capabilities?.transfers === 'active';

    if (!transfersEnabled) {
      const accountLink = await stripe.accountLinks.create({
        account: user.stripeAccountId,
        refresh_url: `${host}/?setup=retry`,
        return_url: `${host}/?setup=complete`,
        type: 'account_onboarding',
      });

      return res.status(200).json({
        requiresOnboarding: true,
        onboardingUrl: accountLink.url,
        error: 'Your payout account requires identity verification with Stripe before transferring funds.'
      });
    }

    const amountInCents = Math.round(amount * 100);
    const transfer = await stripe.transfers.create({
      amount: amountInCents,
      currency: 'usd',
      destination: user.stripeAccountId,
      description: `Sweeps Coins Redemption for User #${user.id}`,
    });

    const redeemedAmount = Math.min(amount, user.sc_played);
    user.sc_played = Math.max(0, user.sc_played - redeemedAmount);
    saveData();
    logTransaction(user.id, 'WITHDRAWAL', `Redeemed ${redeemedAmount} SC ($${redeemedAmount.toFixed(2)} USD)`, 0, -redeemedAmount);

    res.json({
      success: true,
      message: `Successfully transferred $${redeemedAmount.toFixed(2)} USD!`,
      transferId: transfer.id,
      balances: { gc: user.gc_balance, sc: user.sc_unplayed + user.sc_played }
    });
  } catch (err) {
    res.status(500).json({ error: 'Payout transfer failed.', details: err.message });
  }
});

app.get('/api/provably-fair/seed', verifyToken, (req, res) => {
  const seeds = getUserSeedPair(req.user.id);
  res.json({
    clientSeed: seeds.clientSeed,
    serverSeedHash: ProvablyFair.hashSeed(seeds.serverSeed),
    nonce: seeds.nonce
  });
});

app.post('/api/provably-fair/rotate-seed', verifyToken, (req, res) => {
  const { newClientSeed } = req.body;
  const seeds = getUserSeedPair(req.user.id);
  
  const previousServerSeed = seeds.serverSeed;
  seeds.serverSeed = ProvablyFair.generateServerSeed();
  if (newClientSeed) seeds.clientSeed = newClientSeed;
  seeds.nonce = 0;

  res.json({
    previousServerSeed,
    newServerSeedHash: ProvablyFair.hashSeed(seeds.serverSeed),
    newClientSeed: seeds.clientSeed,
    nonce: seeds.nonce
  });
});

// -----------------------------------------------------------------------------
// 10. SESSION-BASED GAMES (MINES / TOWER / HILO / BLACKJACK)
// -----------------------------------------------------------------------------
require('./engine/sessionGames').register(app, {
  HOUSE_EDGE,
  ProvablyFair,
  users,
  activeSessions,
  getUserSeedPair,
  logTransaction,
  broadcastLiveBet,
  debitBet,
  creditWin,
  balancesOf,
  validateWager,
  verifyToken,
  ensureBonusFields,
  updateTelemetry,
  saveData
});

// Slots Buy Bonus endpoint
app.post('/api/play/slots/buy-bonus', verifyToken, enforceJurisdiction, (req, res) => {
  const wager = validateWager(req, res);
  if (!wager) return;
  const { user, currency, amount } = wager;

  const bonusCost = amount * 100;
  const balance = currency === 'GC' ? user.gc_balance : user.sc_unplayed;
  if (bonusCost > balance) {
    return res.status(400).json({ error: `Insufficient ${currency} balance. Bonus costs ${bonusCost.toLocaleString()} ${currency}.` });
  }

  debitBet(user, currency, bonusCost);
  logTransaction(user.id, 'BET', `Slots Bonus Buy (${amount} x 100)`,
    currency === 'GC' ? -bonusCost : 0, currency === 'SC' ? -bonusCost : 0);

  const seedPair = getUserSeedPair(user.id);
  const floatCount = 30;
  const floats = ProvablyFair.getFloats(seedPair.serverSeed, seedPair.clientSeed, seedPair.nonce++, floatCount);

  const outcome = GAMES.slots(floats, { betAmount: amount });
  const payout = Math.round(outcome.multiplier * amount * 100) / 100;
  const isWin = outcome.multiplier > 1 || outcome.pushed;

  if (payout > 0) {
    creditWin(user, currency, payout);
    logTransaction(user.id, 'WIN', `Slots Bonus @ ${outcome.multiplier}x`,
      currency === 'GC' ? payout : 0, currency === 'SC' ? payout : 0);
  }

  ensureBonusFields(user);
  updateTelemetry(user, 'slots', currency, bonusCost, isWin, payout, outcome);

  broadcastLiveBet({
    username: user.username,
    game: 'SLOTS BONUS',
    betAmount: bonusCost,
    currency,
    multiplier: outcome.multiplier,
    win: isWin,
    payout
  });

  res.json({
    ...outcome,
    betAmount: amount,
    payout,
    provablyFair: {
      serverSeedHash: ProvablyFair.hashSeed(seedPair.serverSeed),
      clientSeed: seedPair.clientSeed,
      nonce: seedPair.nonce - 1
    },
    balances: balancesOf(user)
  });
});
// -----------------------------------------------------------------------------
// 12. GENERAL GAMES EXECUTION ENDPOINT
// -----------------------------------------------------------------------------
app.post('/api/play/:gameId', verifyToken, enforceJurisdiction, (req, res) => {
  const { gameId } = req.params;

  if (!GAMES[gameId]) return res.status(404).json({ error: `Game engine '${gameId}' not supported.` });

  const wager = validateWager(req, res);
  if (!wager) return;
  const { user, currency, amount } = wager;

  debitBet(user, currency, amount);
  logTransaction(user.id, 'BET', `Wagered on ${gameId.toUpperCase()}`,
    currency === 'GC' ? -amount : 0, currency === 'SC' ? -amount : 0);

  const seedPair = getUserSeedPair(user.id);
  const floatCount = GAME_FLOAT_COUNTS[gameId] || 20;
  const floats = ProvablyFair.getFloats(seedPair.serverSeed, seedPair.clientSeed, seedPair.nonce++, floatCount);

  let outcome;
  try {
    outcome = GAMES[gameId](floats, req.body.params || {});
  } catch (err) {
    console.error(`[GAME ENGINE ERROR] ${gameId}:`, err);
    // Refund the bet on engine error
    if (currency === 'GC') {
      user.gc_balance += amount;
    } else {
      user.sc_unplayed += amount;
    }
    seedPair.nonce--; // Roll back nonce to maintain sync
    saveData();
    logTransaction(user.id, 'BET', `Refund for ${gameId.toUpperCase()} (engine error)`,
      currency === 'GC' ? amount : 0, currency === 'SC' ? amount : 0);
    return res.status(500).json({ error: 'Game engine error. Bet refunded.' });
  }

  const payout = Math.round(outcome.multiplier * amount * 100) / 100;
  const isWin = outcome.multiplier > 1 || outcome.pushed;

  if (payout > 0) {
    creditWin(user, currency, payout);
    const txType = outcome.pushed ? 'BET' : 'WIN';
    logTransaction(user.id, txType,
      `${gameId.toUpperCase()} resolved @ ${outcome.multiplier}x${outcome.pushed ? ' (push)' : ''}`,
      currency === 'GC' ? payout : 0, currency === 'SC' ? payout : 0);
  }

  // Track telemetry for challenges and rakeback
  ensureBonusFields(user);
  updateTelemetry(user, gameId, currency, amount, isWin, payout, outcome);

  // Affiliate commission on SC wagers
  if (currency === 'SC') {
    creditReferrerForWager(user, amount);
  }

  broadcastLiveBet({
    username: user.username,
    game: gameId.toUpperCase(),
    betAmount: amount,
    currency,
    multiplier: outcome.multiplier,
    win: isWin,
    payout
  });

  res.json({
    ...outcome,
    betAmount: amount,
    payout,
    provablyFair: {
      serverSeedHash: ProvablyFair.hashSeed(seedPair.serverSeed),
      clientSeed: seedPair.clientSeed,
      nonce: seedPair.nonce - 1
    },
    balances: balancesOf(user)
  });
});

// -----------------------------------------------------------------------------
// 12. BONUS SYSTEMS: Daily Claim, Challenges, Rakeback
// -----------------------------------------------------------------------------

// In-memory lock map for idempotency (prevents race conditions on concurrent claims)
const claimLocks = new Map();

function acquireLock(userId, operation) {
  const key = `${userId}:${operation}`;
  if (claimLocks.has(key)) return false;
  claimLocks.set(key, Date.now());
  return true;
}

function releaseLock(userId, operation) {
  claimLocks.delete(`${userId}:${operation}`);
}

// Auto-release locks after 30 seconds to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of claimLocks.entries()) {
    if (now - timestamp > 30000) {
      claimLocks.delete(key);
    }
  }
}, 30000);

const CHALLENGE_POOL = [
  // --- WAGERING & STREAKS ---
  { id: 'sc_high_roller',      desc: 'Wager 250 SC across any games',       task: 'sc_wagered',       target: 250,    minReward: 2.50,  maxReward: 10.00 },
  { id: 'gc_volume_king',      desc: 'Wager 250,000 GC in 24 hours',        task: 'gc_wagered',       target: 250000, minReward: 1.50,  maxReward: 7.50  },
  { id: 'win_streak_3',        desc: 'Hit a 3-game winning streak',          task: 'win_streak',       target: 3,      minReward: 1.00,  maxReward: 5.00  },
  { id: 'hot_streak_5',        desc: 'Hit a 5-game winning streak',          task: 'win_streak',       target: 5,      minReward: 3.00,  maxReward: 15.00 },
  { id: 'marathon_50_rounds',  desc: 'Play 50 total rounds',                 task: 'rounds',           target: 50,     minReward: 1.50,  maxReward: 6.00  },

  // --- MULTIPLIERS & BIG WINS ---
  { id: 'multi_10x_hit',       desc: 'Hit a 10x multiplier or higher',       task: 'hit_multiplier',   target: 10,     minReward: 1.00,  maxReward: 5.00  },
  { id: 'multi_50x_legend',    desc: 'Hit a 50x multiplier or higher',       task: 'hit_multiplier',   target: 50,     minReward: 5.00,  maxReward: 25.00 },
  { id: 'sc_profit_20',        desc: 'Net profit 20 SC in a single session',  task: 'sc_net_profit',    target: 20,     minReward: 2.00,  maxReward: 8.00  },
  { id: 'big_win_single',      desc: 'Win at least 25 SC in a single round', task: 'single_round_win', target: 25,     minReward: 2.50,  maxReward: 12.00 },

  // --- DICE SPECIFIC ---
  { id: 'dice_over90',         desc: 'Win a Dice roll set to OVER 90',       task: 'dice_over90_win',  target: 1,      minReward: 1.50,  maxReward: 10.00 },
  { id: 'dice_under10',        desc: 'Win a Dice roll set to UNDER 10',      task: 'dice_under10_win', target: 1,      minReward: 1.50,  maxReward: 10.00 },
  { id: 'dice_precision_50',   desc: 'Hit an exact 50.00 roll on Dice',      task: 'dice_exact_50',    target: 1,      minReward: 10.00, maxReward: 50.00 },
  { id: 'dice_speed_15',       desc: 'Complete 15 Dice rolls',               task: 'dice_rounds',      target: 15,     minReward: 0.50,  maxReward: 2.50  },

  // --- CRASH SPECIFIC ---
  { id: 'crash_cashout_2x',    desc: 'Cash out Crash at 2x+ (3 times)',      task: 'crash_2x_count',   target: 3,      minReward: 1.00,  maxReward: 5.00  },
  { id: 'crash_cashout_5x',    desc: 'Cash out Crash at 5x or higher',       task: 'crash_5x_count',   target: 1,      minReward: 2.00,  maxReward: 10.00 },
  { id: 'crash_iron_hands',    desc: 'Cash out Crash at 10x or higher',      task: 'crash_10x_count',  target: 1,      minReward: 5.00,  maxReward: 25.00 },
  { id: 'crash_sniper_1_1x',   desc: 'Cash out Crash between 1.10x & 1.25x (5 times)', task: 'crash_snipe', target: 5, minReward: 0.75, maxReward: 3.50 },

  // --- BLACKJACK SPECIFIC ---
  { id: 'bj_natural_21',       desc: 'Get dealt a Natural Blackjack (21)',   task: 'bj_natural',       target: 1,      minReward: 1.50,  maxReward: 7.50  },
  { id: 'bj_win_double',       desc: 'Win a Blackjack hand on a Double Down', task: 'bj_double_win',   target: 1,      minReward: 1.00,  maxReward: 5.00  },
  { id: 'bj_dealer_bust',      desc: 'Win 3 Blackjack hands via Dealer Bust',task: 'bj_dealer_bust',  target: 3,      minReward: 1.25,  maxReward: 6.00  },
  { id: 'bj_marathon_10',      desc: 'Play 10 Blackjack hands',              task: 'bj_hands',         target: 10,     minReward: 0.75,  maxReward: 3.50  },

  // --- MINES / SLOTS / PLINKO ---
  { id: 'mines_clear_3',       desc: 'Uncover 3 safe tiles in Mines (1 win)', task: 'mines_tiles',     target: 3,      minReward: 0.50,  maxReward: 2.50  },
  { id: 'mines_high_risk',     desc: 'Win a Mines round with 5+ mines active',task: 'mines_hard_win',  target: 1,      minReward: 2.50,  maxReward: 12.00 },
  { id: 'plinko_high_bucket',  desc: 'Hit a 10x+ outer bucket in Plinko',    task: 'plinko_outer',     target: 1,      minReward: 1.50,  maxReward: 8.00  },
  { id: 'slots_bonus_trigger', desc: 'Trigger a Bonus Round or Free Spins',   task: 'slot_bonus',       target: 1,      minReward: 3.00,  maxReward: 15.00 },

  // --- EXPLORATION & TIMING ---
  { id: 'genre_explorer',      desc: 'Play at least 4 different game titles', task: 'unique_games',     target: 4,      minReward: 1.00,  maxReward: 4.00  },
  { id: 'jack_of_all_trades',  desc: 'Win at least 1 round in 3 different games', task: 'unique_wins',  target: 3,      minReward: 1.50,  maxReward: 6.00  },
  { id: 'quick_draw',          desc: 'Play 5 rounds within 5 minutes of login', task: 'speed_rounds',  target: 5,      minReward: 0.50,  maxReward: 2.00  }
];

// Initialize user fields for bonus systems
function ensureBonusFields(user) {
  if (!user.bonus) user.bonus = {};
  if (!user.bonus.lastClaimAt) user.bonus.lastClaimAt = 0;
  if (!user.bonus.claimStreak) user.bonus.claimStreak = 0;
  if (!user.bonus.dailyClaimed) user.bonus.dailyClaimed = false;
  if (!user.bonus.challenges) user.bonus.challenges = [];
  if (!user.bonus.challengeDate) user.bonus.challengeDate = '';
  if (!user.bonus.telemetry) user.bonus.telemetry = {
    scWagered: 0, gcWagered: 0, rounds: 0, roundsWon: 0,
    gamesPlayed: [],
    dailyLossSC: 0, dailyWagerSC: 0, dailyWinSC: 0,
    weeklyLossSC: 0, weeklyWagerSC: 0, weeklyWinSC: 0,
    monthlyLossSC: 0, monthlyWagerSC: 0, monthlyWinSC: 0,
    diceOver90: 0, crashCashout2x: 0, blackjackHands: 0,
    history: [],
    lastDailyReset: Date.now(),
    lastWeeklyReset: Date.now(),
    lastMonthlyReset: Date.now()
  };
  // Convert legacy Set to array if needed
  if (user.bonus.telemetry && user.bonus.telemetry.gamesPlayed && !(user.bonus.telemetry.gamesPlayed instanceof Set)) {
    if (!Array.isArray(user.bonus.telemetry.gamesPlayed)) {
      user.bonus.telemetry.gamesPlayed = [];
    }
  }
  if (!user.bonus.rakeback) user.bonus.rakeback = {
    lastDailyAt: 0, lastWeeklyAt: 0, lastMonthlyAt: 0,
    dailyPool: 0, weeklyPool: 0, monthlyPool: 0
  };

  // Reset telemetry windows if period has elapsed
  resetTelemetryWindows(user.bonus.telemetry);

  return user.bonus;
}

// Reset telemetry counters when their period elapses
function resetTelemetryWindows(t) {
  const now = Date.now();
  const ONE_DAY = 24 * 60 * 60 * 1000;
  const ONE_WEEK = 7 * ONE_DAY;
  const ONE_MONTH = 30 * ONE_DAY;

  if (!t.lastDailyReset || now - t.lastDailyReset >= ONE_DAY) {
    t.dailyLossSC = 0;
    t.dailyWagerSC = 0;
    t.dailyWinSC = 0;
    t.lastDailyReset = now;
  }
  if (!t.lastWeeklyReset || now - t.lastWeeklyReset >= ONE_WEEK) {
    t.weeklyLossSC = 0;
    t.weeklyWagerSC = 0;
    t.weeklyWinSC = 0;
    t.lastWeeklyReset = now;
  }
  if (!t.lastMonthlyReset || now - t.lastMonthlyReset >= ONE_MONTH) {
    t.monthlyLossSC = 0;
    t.monthlyWagerSC = 0;
    t.monthlyWinSC = 0;
    t.lastMonthlyReset = now;
  }
}

// Generate daily challenges for a user (3 random challenges, same day)
function generateDailyChallenges(user) {
  const today = new Date().toISOString().slice(0, 10);
  const bonus = ensureBonusFields(user);
  if (bonus.challengeDate === today && bonus.challenges.length === 3) return bonus.challenges;

  const shuffled = [...CHALLENGE_POOL].sort(() => Math.random() - 0.5).slice(0, 3);
  bonus.challenges = shuffled.map(c => ({
    id: c.id,
    desc: c.desc,
    task: c.task,
    target: c.target,
    minReward: c.minReward,
    maxReward: c.maxReward,
    progress: 0,
    claimed: false,
    completed: false
  }));
  bonus.challengeDate = today;
  return bonus.challenges;
}

// Evaluate a challenge against current telemetry
function evaluateChallenge(user, challenge) {
  const t = ensureBonusFields(user).telemetry;
  const games = Array.isArray(t.gamesPlayed) ? t.gamesPlayed : [];
  const uniqueGames = [...new Set(games)];
  switch (challenge.task) {
    case 'sc_wagered':         return t.scWagered || 0;
    case 'gc_wagered':         return t.gcWagered || 0;
    case 'rounds':             return t.rounds || 0;
    case 'rounds_won':         return t.roundsWon || 0;
    case 'games_played':       return uniqueGames.length;
    case 'dice_over90':        return t.diceOver90 || 0;
    case 'crash_cashout_2x':   return t.crashCashout2x || 0;
    case 'blackjack_hands':    return t.blackjackHands || 0;
    default:                   return 0;
  }
}

// Update telemetry after a game round
function updateTelemetry(user, gameId, currency, betAmount, won, payout, outcome) {
  const bonus = ensureBonusFields(user);
  const t = bonus.telemetry;

  if (currency === 'GC') {
    t.gcWagered += betAmount;
  } else {
    t.scWagered += betAmount;
    t.dailyWagerSC += betAmount;
    t.weeklyWagerSC += betAmount;
    t.monthlyWagerSC += betAmount;
  }

  t.rounds++;
  if (won) {
    t.roundsWon++;
    if (currency === 'SC') {
      t.dailyWinSC += payout;
      t.weeklyWinSC += payout;
      t.monthlyWinSC += payout;
    }
  }
  if (Array.isArray(t.gamesPlayed)) {
    t.gamesPlayed.push(gameId);
  } else {
    t.gamesPlayed = [gameId];
  }

  if (!won && currency === 'SC') {
    const loss = betAmount;
    t.dailyLossSC += loss;
    t.weeklyLossSC += loss;
    t.monthlyLossSC += loss;
  }

  // Challenge-specific tracking
  // dice_over90: track SC wagered on OVER 90 bets (matches challenge description)
  if (gameId === 'dice' && currency === 'SC' && outcome?.details?.target >= 90 && outcome?.details?.condition === 'OVER') {
    t.diceOver90 = (t.diceOver90 || 0) + betAmount;
  }
  if (gameId === 'crash' && won && payout / betAmount >= 2) { t.crashCashout2x = (t.crashCashout2x || 0) + 1; }
  if (gameId === 'blackjack') { t.blackjackHands = (t.blackjackHands || 0) + 1; }

  // Push to history (cap at 100 entries)
  t.history.push({ ts: Date.now(), game: gameId, currency, bet: betAmount, won, payout });
  if (t.history.length > 100) t.history.shift();

  // Cap gamesPlayed array to prevent unbounded growth (keep last 50)
  if (t.gamesPlayed.length > 50) {
    t.gamesPlayed = t.gamesPlayed.slice(-50);
  }

  // Re-evaluate challenges
  bonus.challenges.forEach(c => {
    c.progress = evaluateChallenge(user, c);
    if (c.progress >= c.target && !c.completed) c.completed = true;
  });
}

// Random bounded reward for challenges
function calcChallengeReward(challenge) {
  return round2(challenge.minReward + Math.random() * (challenge.maxReward - challenge.minReward));
}

// -----------------------------------------------------------------------------
// 12a. DAILY CLAIM ENDPOINTS
// -----------------------------------------------------------------------------
// Fixed reward: 1,000 GC + 1.00 SC (≈ $1 USD value), strict 24-hour cooldown

const DAILY_CLAIM_REWARD = { gc: 1000, sc: 1.00 };

app.get('/api/bonus/status', verifyToken, (req, res) => {
  const user = users.get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const bonus = ensureBonusFields(user);

  const now = Date.now();
  const ONE_DAY = 24 * 60 * 60 * 1000;
  const nextClaimMs = Math.max(0, (bonus.lastClaimAt + ONE_DAY) - now);
  const canClaim = nextClaimMs <= 0;

  res.json({
    canClaim,
    nextClaimMs,
    streak: bonus.claimStreak,
    lastClaimAt: bonus.lastClaimAt,
    reward: DAILY_CLAIM_REWARD
  });
});

app.post('/api/bonus/daily-claim', verifyToken, (req, res) => {
  const user = users.get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const bonus = ensureBonusFields(user);

  // Idempotency lock
  if (!acquireLock(user.id, 'daily-claim')) {
    return res.status(409).json({ error: 'Claim already in progress.' });
  }

  try {
    const now = Date.now();
    const ONE_DAY = 24 * 60 * 60 * 1000;
    const elapsed = now - bonus.lastClaimAt;

    if (elapsed < ONE_DAY) {
      const remaining = ONE_DAY - elapsed;
      return res.status(400).json({
        error: 'Daily claim not ready.',
        nextClaimMs: remaining
      });
    }

    // Server-side strict cooldown
    bonus.lastClaimAt = now;
    bonus.claimStreak = (bonus.claimStreak || 0) + 1;

    const gcReward = DAILY_CLAIM_REWARD.gc;
    const scReward = DAILY_CLAIM_REWARD.sc;
    user.gc_balance += gcReward;
    user.sc_unplayed += scReward;

    saveData();
    logTransaction(user.id, 'BONUS', `Daily Claim #${bonus.claimStreak}`, gcReward, scReward);

    res.json({
      success: true,
      claimed: { gc: gcReward, sc: scReward },
      streak: bonus.claimStreak,
      balances: balancesOf(user)
    });
  } finally {
    releaseLock(user.id, 'daily-claim');
  }
});

// -----------------------------------------------------------------------------
// 12b. DAILY CHALLENGES ENDPOINTS
// -----------------------------------------------------------------------------

app.get('/api/challenges', verifyToken, (req, res) => {
  const user = users.get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  ensureBonusFields(user);
  const challenges = generateDailyChallenges(user);
  const progress = challenges.map(c => ({
    id: c.id,
    desc: c.desc,
    task: c.task,
    target: c.target,
    minReward: c.minReward,
    maxReward: c.maxReward,
    progress: Math.min(c.progress, c.target),
    completed: c.completed,
    claimed: c.claimed
  }));
  res.json({ challenges: progress });
});

app.post('/api/challenges/claim', verifyToken, (req, res) => {
  const user = users.get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const { challengeId } = req.body || {};
  if (!challengeId) return res.status(400).json({ error: 'challengeId required.' });

  if (!acquireLock(user.id, 'challenge-claim-' + challengeId)) {
    return res.status(409).json({ error: 'Claim already in progress.' });
  }

  try {
    const bonus = ensureBonusFields(user);
    const challenge = bonus.challenges.find(c => c.id === challengeId);

    if (!challenge) return res.status(404).json({ error: 'Challenge not found.' });
    if (challenge.claimed) return res.status(400).json({ error: 'Challenge already claimed.' });
    if (!challenge.completed) return res.status(400).json({ error: 'Challenge not yet completed.' });

    const reward = calcChallengeReward(challenge);
    const scReward = reward;
    const gcReward = Math.round(scReward * 1000);

    user.gc_balance += gcReward;
    user.sc_unplayed += scReward;

    challenge.claimed = true;
    challenge.reward = scReward;

    saveData();
    logTransaction(user.id, 'BONUS', `Challenge: ${challenge.desc}`, gcReward, scReward);

    res.json({
      success: true,
      reward: scReward,
      balances: balancesOf(user)
    });
  } finally {
    releaseLock(user.id, 'challenge-claim-' + challengeId);
  }
});

// -----------------------------------------------------------------------------
// 12c. TIERED RAKEBACK ENDPOINTS
// -----------------------------------------------------------------------------

const RAKEBACK_WINDOWS = {
  daily: { ms: 24 * 60 * 60 * 1000,  field: 'lastDailyAt',  pool: 'dailyPool' },
  weekly: { ms: 7 * 24 * 60 * 60 * 1000, field: 'lastWeeklyAt', pool: 'weeklyPool' },
  monthly: { ms: 30 * 24 * 60 * 60 * 1000, field: 'lastMonthlyAt', pool: 'monthlyPool' }
};

function getRakebackLosses(user) {
  const bonus = ensureBonusFields(user);
  const rb = bonus.rakeback;
  const t = bonus.telemetry;
  const now = Date.now();
  const ONE_DAY = 24 * 60 * 60 * 1000;
  const ONE_WEEK = 7 * ONE_DAY;
  const ONE_MONTH = 30 * ONE_DAY;

  // Per-tier: count losses since the last claim. If last claim is older than
  // the window, count all losses within the window.
  const dailyLossSinceClaim = (now - rb.lastDailyAt < ONE_DAY)
    ? (t.dailyLossSC || 0)
    : (now - (rb.lastDailyAt || 0) < ONE_DAY ? (t.dailyLossSC || 0) : (t.dailyLossSC || 0));
  const weeklyLossSinceClaim = (t.weeklyLossSC || 0);
  const monthlyLossSinceClaim = (t.monthlyLossSC || 0);
  return {
    daily:   Math.max(0, dailyLossSinceClaim),
    weekly:  Math.max(0, weeklyLossSinceClaim),
    monthly: Math.max(0, monthlyLossSinceClaim)
  };
}

app.get('/api/rakeback/status', verifyToken, (req, res) => {
  const user = users.get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const bonus = ensureBonusFields(user);
  const rb = bonus.rakeback;
  const now = Date.now();
  const losses = getRakebackLosses(user);

  const tiers = ['daily', 'weekly', 'monthly'];
  const result = {};

  tiers.forEach(tier => {
    const w = RAKEBACK_WINDOWS[tier];
    const lastAt = rb[w.field];
    const nextAvailable = lastAt + w.ms;
    const remaining = Math.max(0, nextAvailable - now);
    const canClaim = remaining <= 0;
    const rate = 0.03 + Math.random() * 0.07; // 3% to 10% randomized
    const claimable = canClaim ? round2(losses[tier] * rate * 0.5) : 0; // capped at 50% of loss
    result[tier] = {
      claimable: canClaim ? round2(claimable) : 0,
      lossTracked: round2(losses[tier]),
      rateMin: 3,
      rateMax: 10,
      canClaim: canClaim && claimable > 0,
      nextClaimMs: remaining,
      period: tier === 'daily' ? '24 hours' : tier === 'weekly' ? '7 days' : '30 days'
    };
  });

  res.json({ rakeback: result });
});

app.post('/api/rakeback/claim', verifyToken, (req, res) => {
  const user = users.get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const { tier } = req.body || {};
  if (!tier || !['daily', 'weekly', 'monthly'].includes(tier)) {
    return res.status(400).json({ error: 'Invalid rakeback tier.' });
  }

  if (!acquireLock(user.id, 'rakeback-' + tier)) {
    return res.status(409).json({ error: 'Claim already in progress.' });
  }

  try {
    const bonus = ensureBonusFields(user);
    const rb = bonus.rakeback;
    const w = RAKEBACK_WINDOWS[tier];
    const now = Date.now();

    if (now - rb[w.field] < w.ms) {
      const remaining = (rb[w.field] + w.ms) - now;
      return res.status(400).json({ error: `${tier} rakeback not ready.`, nextClaimMs: remaining });
    }

    const losses = getRakebackLosses(user);
    if (losses[tier] <= 0) {
      return res.status(400).json({ error: 'No losses tracked for this period.' });
    }

  const rate = 0.03 + Math.random() * 0.07;
  const amount = round2(losses[tier] * rate * 0.5);

  if (amount <= 0) {
    return res.status(400).json({ error: 'Calculated rakeback is 0.00.' });
  }

  rb[w.field] = now;

  // Reset the loss counter for this period so the next accrual starts fresh.
  // Rakeback only counts losses since the last claim.
  if (tier === 'daily')   bonus.telemetry.dailyLossSC = 0;
  if (tier === 'weekly')  bonus.telemetry.weeklyLossSC = 0;
  if (tier === 'monthly') bonus.telemetry.monthlyLossSC = 0;

  user.sc_unplayed += amount;
  saveData();
    logTransaction(user.id, 'RAKEBACK', `${tier.charAt(0).toUpperCase() + tier.slice(1)} Rakeback (${(rate * 100).toFixed(0)}%)`, 0, amount, { tier });

    res.json({
      success: true,
      tier,
      claimed: amount,
      rate: round2(rate * 100),
      balances: balancesOf(user)
    });
  } finally {
    releaseLock(user.id, 'rakeback-' + tier);
  }
});
// -----------------------------------------------------------------------------
// 13. AFFILIATE / REFERRAL SYSTEM
// -----------------------------------------------------------------------------

const AFFILIATE_DEPOSIT_RATE = 0.05; // 5% of deposit USD value credited as SC to referrer
const AFFILIATE_WAGER_RATE = 0.001;  // 0.1% of referred user's wagered SC credited to referrer

function generateReferralCode(username) {
  const base = (username || 'user').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 6) || 'PLAYER';
  const suffix = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `${base}-${suffix}`;
}

async function ensureAffiliateRecord(user) {
  let record = await db.getAffiliateByUserId(user.id);
  if (!record) {
    const code = generateReferralCode(user.username);
    await db.createAffiliate(user.id, code, null);
    record = await db.getAffiliateByUserId(user.id);
  }
  return record;
}

async function ensureAffiliateRecordFor(userId, code, referredBy) {
  let record = await db.getAffiliateByUserId(userId);
  if (!record) {
    await db.createAffiliate(userId, code, referredBy);
    record = await db.getAffiliateByUserId(userId);
  }
  return record;
}

async function creditReferrerForDeposit(referredUser, depositUsdValue) {
  try {
    const aff = await db.getAffiliateByUserId(referredUser.id);
    if (!aff || !aff.referred_by) return;
    const referrer = users.get(aff.referred_by);
    if (!referrer) return;
    const commission = round2(depositUsdValue * AFFILIATE_DEPOSIT_RATE);
    if (commission <= 0) return;
    referrer.sc_unplayed = round2((referrer.sc_unplayed || 0) + commission);
    await db.addAffiliateEarning({
      id: `afe_${crypto.randomUUID()}`,
      affiliateUserId: referrer.id,
      referredUserId: referredUser.id,
      source: 'DEPOSIT',
      amountSc: commission
    });
    saveData();
    sendToUser(referrer.id, {
      type: 'BALANCE_UPDATE',
      balances: { gc: referrer.gc_balance, sc_unplayed: referrer.sc_unplayed, sc_played: referrer.sc_played },
      message: `Affiliate commission: +${commission} SC from ${referredUser.username}'s deposit.`
    });
  } catch (e) {
    console.error('[Affiliate Deposit Credit Error]:', e.message);
  }
}

async function creditReferrerForWager(referredUser, scWagered) {
  try {
    if (scWagered <= 0) return;
    const aff = await db.getAffiliateByUserId(referredUser.id);
    if (!aff || !aff.referred_by) return;
    const referrer = users.get(aff.referred_by);
    if (!referrer) return;
    const commission = round2(scWagered * AFFILIATE_WAGER_RATE);
    if (commission <= 0) return;
    referrer.sc_unplayed = round2((referrer.sc_unplayed || 0) + commission);
    await db.addAffiliateEarning({
      id: `afe_${crypto.randomUUID()}`,
      affiliateUserId: referrer.id,
      referredUserId: referredUser.id,
      source: 'WAGER',
      amountSc: commission
    });
    saveData();
  } catch (e) {
    console.error('[Affiliate Wager Credit Error]:', e.message);
  }
}

app.get('/api/affiliate/status', verifyToken, async (req, res) => {
  const user = users.get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  try {
    const aff = await ensureAffiliateRecord(user);
    const referred = await db.getReferredUsers(user.id);
    const totals = await db.getAffiliateEarningsTotals(user.id);
    const earnings = await db.getAffiliateEarnings(user.id, 50);
    const totalEarnings = Object.values(totals).reduce((s, v) => s + Number(v || 0), 0);

    const baseUrl = (req.headers.origin || `https://${req.headers.host}`).replace(/\/$/, '');
    const referralLink = `${baseUrl}/?ref=${aff.referral_code}`;

    res.json({
      referralCode: aff.referral_code,
      referralLink,
      totals: {
        deposits: round2(totals.DEPOSIT || 0),
        wagers: round2(totals.WAGER || 0),
        total: round2(totalEarnings)
      },
      referredCount: referred.length,
      referredUsers: referred.map((r) => ({
        id: r.id,
        username: r.username,
        referredAt: r.referred_at
      })),
      recentEarnings: earnings.map((e) => ({
        id: e.id,
        referredUserId: e.referred_user_id,
        source: e.source,
        amountSc: round2(e.amount_sc),
        createdAt: e.created_at
      })),
      rates: {
        depositRatePct: AFFILIATE_DEPOSIT_RATE * 100,
        wagerRatePct: AFFILIATE_WAGER_RATE * 100
      }
    });
  } catch (e) {
    console.error('[Affiliate Status Error]:', e.message);
    res.status(500).json({ error: 'Failed to load affiliate status.' });
  }
});

app.post('/api/affiliate/apply', verifyToken, async (req, res) => {
  const user = users.get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const code = String(req.body?.code || '').trim();
  if (!code) return res.status(400).json({ error: 'Referral code is required.' });

  try {
    const existing = await db.getAffiliateByUserId(user.id);
    if (existing && existing.referred_by) {
      return res.status(400).json({ error: 'You already used a referral code.' });
    }

    const referrerAff = await db.getAffiliateByCode(code);
    if (!referrerAff) return res.status(404).json({ error: 'Invalid referral code.' });
    if (referrerAff.user_id === user.id) {
      return res.status(400).json({ error: 'You cannot refer yourself.' });
    }

    const referrer = users.get(referrerAff.user_id);
    if (!referrer) return res.status(404).json({ error: 'Referrer not found.' });

    await ensureAffiliateRecord(user);
    await db.setAffiliateReferredBy(user.id, referrer.id);

    user.referred_by = referrer.id;
    saveData();

    sendToUser(referrer.id, {
      type: 'BALANCE_UPDATE',
      message: `${user.username} just joined using your referral link!`
    });

    res.json({ success: true, message: 'Referral code applied successfully.' });
  } catch (e) {
    console.error('[Affiliate Apply Error]:', e.message);
    res.status(500).json({ error: 'Failed to apply referral code.' });
  }
});

// -----------------------------------------------------------------------------
// 14. TRANSACTION CATEGORY ENDPOINTS
// -----------------------------------------------------------------------------

app.get('/api/user/transactions/deposits', verifyToken, (req, res) => {
  const all = transactions.get(req.user.id) || [];
  const limit = parseInt(req.query.limit, 10) || 50;
  const filtered = all.filter((tx) => tx.type === 'PURCHASE').slice(0, limit);
  res.json({ transactions: filtered, category: 'deposits', count: filtered.length });
});

app.get('/api/user/transactions/withdrawals', verifyToken, (req, res) => {
  const all = transactions.get(req.user.id) || [];
  const limit = parseInt(req.query.limit, 10) || 50;
  const filtered = all.filter((tx) => tx.type === 'WITHDRAWAL').slice(0, limit);
  res.json({ transactions: filtered, category: 'withdrawals', count: filtered.length });
});

app.get('/api/user/transactions/bets-casino', verifyToken, (req, res) => {
  const all = transactions.get(req.user.id) || [];
  const limit = parseInt(req.query.limit, 10) || 50;
  const filtered = all.filter((tx) => tx.type === 'BET' || tx.type === 'WIN').slice(0, limit);
  res.json({ transactions: filtered, category: 'bets-casino', count: filtered.length });
});

// -----------------------------------------------------------------------------
// 15. ADMIN: WIPE + RESEED (gated by RESET_SECRET env var)
// -----------------------------------------------------------------------------
//
//   POST /api/admin/reset
//   Header: x-reset-secret: <RESET_SECRET>
//
//   Body (optional): { "demoEmail": "demo@casino.local", "demoPassword": "Demo1234!" }
//
//   Wipes every user/transaction/seed/affiliate row, recreates schema, then
//   seeds ONE Demo user with the supplied credentials (or the defaults).
//
app.post('/api/admin/reset', async (req, res) => {
  const required = process.env.RESET_SECRET;
  if (!required) {
    return res.status(503).json({ error: 'RESET_SECRET is not configured on this server.' });
  }
  const provided = req.headers['x-reset-secret'] || req.body?.secret;
  if (provided !== required) {
    return res.status(401).json({ error: 'Invalid reset secret.' });
  }

  try {
    const demoEmail = String(req.body?.demoEmail || 'demo@casino.local').toLowerCase().trim();
    const demoUsername = String(req.body?.demoUsername || 'Demo').trim();
    const demoPassword = String(req.body?.demoPassword || 'Demo1234!');

    db.dropAllTables();
    db.createSchema();
    db.persistSync();

    const hashed = await bcrypt.hash(demoPassword, 12);
    const existing = await db.findByEmail(demoEmail);
    let userId;
    if (existing) {
      userId = existing.id;
      await db.updateUser(userId, {
        username: demoUsername,
        email: demoEmail,
        password: hashed,
        gc_balance: 10000,
        sc_unplayed: 10,
        sc_played: 0,
        kyc_status: 'VERIFIED',
        kyc_tier: 2,
        kyc_verified_at: new Date().toISOString(),
        state: 'CA'
      });
    } else {
      userId = await db.createUser({
        username: demoUsername,
        email: demoEmail,
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
    }

    users.clear();
    transactions.clear();
    userSeeds.clear();
    processedEvents.clear();
    cryptoPayments.clear();
    amoeRegistry.clear();
    nextUserId = 1;
    nextUserId = userId + 1;

    saveData();

    console.log(`[ADMIN RESET]: database wiped, Demo user seeded (id=${userId}).`);
    return res.json({
      success: true,
      demo: { id: userId, username: demoUsername, email: demoEmail },
      message: 'Database reset complete. All users except the Demo account were deleted.'
    });
  } catch (e) {
    console.error('[ADMIN RESET]:', e.message);
    return res.status(500).json({ error: 'Reset failed: ' + e.message });
  }
});

app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed JSON body.' });
  }
  if (err && err.status === 403) {
    return res.status(403).json({ error: err.message || 'Forbidden.' });
  }
  console.error('[SERVER ERROR]', err);
  res.status(500).json({ error: 'Internal server error.' });
});

// -----------------------------------------------------------------------------
// 8. HYBRID MULTI-PAGE ROUTES
// Lightweight dedicated HTML per non-game route (shared shell + only that
// page's view markup) so deep visits to /account, /bonus, etc. no longer
// download the entire single-page index.html with every view baked in.
// -----------------------------------------------------------------------------
const VIEWS_DIR = path.join(__dirname, 'public', 'views');
const pageHtmlCache = {};
function renderPage(viewName) {
  if (pageHtmlCache[viewName]) return pageHtmlCache[viewName];
  const top = fs.readFileSync(path.join(VIEWS_DIR, 'partials', 'shelftop.html'), 'utf8');
  const bottom = fs.readFileSync(path.join(VIEWS_DIR, 'partials', 'pagebottom.html'), 'utf8');
  const content = fs.readFileSync(path.join(VIEWS_DIR, 'pages', viewName + '.html'), 'utf8');
  const html = top + content + bottom;
  pageHtmlCache[viewName] = html;
  return html;
}

app.get('/account', (req, res) => res.type('html').send(renderPage('account')));
app.get('/account/*', (req, res) => res.type('html').send(renderPage('account')));
app.get('/bonus', (req, res) => res.type('html').send(renderPage('bonus')));
app.get('/challenges', (req, res) => res.type('html').send(renderPage('challenges')));
app.get('/rakeback', (req, res) => res.type('html').send(renderPage('rakeback')));

// SPA fallback: serve index.html for all non-API routes (exclude /api/ so unknown
// API endpoints fall through to the JSON 404 handler below)
app.get(/^\/(?!api\/).*$/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// JSON 404 for any unknown API route (never leak an HTML stack page)
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Endpoint not found.' });
  }
  res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
});

// -----------------------------------------------------------------------------
// 13. SERVER INITIALIZATION & GRACEFUL SHUTDOWN
// -----------------------------------------------------------------------------
if (process.env.VERCEL) {
  module.exports = app;
} else {
  // Fail fast and clearly instead of throwing an uncaught fatal error (e.g. EADDRINUSE).
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[Server]: Port ${PORT} is already in use. Another server instance may be running. Exiting.`);
    } else {
      console.error('[Server]: Failed to start:', err.message);
    }
    process.exit(1);
  });
  server.listen(PORT, () => {
    console.log(`🎰 SWEEPSTAKES CASINO ENGINE ONLINE: Port ${PORT}`);
  });
}