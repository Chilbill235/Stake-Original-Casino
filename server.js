require('dotenv').config();

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'casino-data.json');

// -----------------------------------------------------------------------------
// 1. CONFIGURATION & CONSTANTS
// -----------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'casino_secret_key_123';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const PERSONA_WEBHOOK_SECRET = process.env.PERSONA_WEBHOOK_SECRET;
const HOUSE_EDGE = 0.13; // 13% House Edge (86% RTP)
const RAKEBACK_RATE = 5.00; // 5% of House Edge back to user

const stripe = require('stripe')(STRIPE_SECRET_KEY);
const bcrypt = require('bcryptjs');

const RESTRICTED_STATES = ['WA', 'ID', 'NV', 'KY', 'MI', 'GA', 'KY'];

// Coin Package Configurations ($1 USD = 1,000 GC + 1 FREE SC)
const COIN_PACKAGES = {
  'pack_10': { name: '15,000 GC + 15 Free SC', priceInCents: 1000, gcAmount: 15000, scAmount: 15 },
  'pack_20': { name: '25,000 GC + 25 Free SC', priceInCents: 2000, gcAmount: 25000, scAmount: 25 },
  'pack_50': { name: '55,000 GC + 55 Free SC', priceInCents: 5000, gcAmount: 55000, scAmount: 55 },
  'pack_100': { name: '100,000 GC + 105 Free SC', priceInCents: 10000, gcAmount: 100000, scAmount: 105 }
};

// -----------------------------------------------------------------------------
// 2. IN-MEMORY DATA STORES
// -----------------------------------------------------------------------------
const users = new Map();
const processedEvents = new Set();
const transactions = new Map();
const activeSessions = new Map();
const userSeeds = new Map();
const amoeRegistry = new Map();

// -----------------------------------------------------------------------------
// 2b. PERSISTENCE — save/load users to file so balances survive restarts
// -----------------------------------------------------------------------------
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.users) {
        for (const u of data.users) { users.set(u.id, u); }
      }
      if (data.transactions) {
        for (const [k, v] of Object.entries(data.transactions)) { transactions.set(Number(k), v); }
      }
      if (data.userSeeds) {
        for (const [k, v] of Object.entries(data.userSeeds)) { userSeeds.set(Number(k), v); }
      }
      console.log('[Persistence]: Loaded ' + users.size + ' users from disk.');
    }
  } catch (e) {
    console.error('[Persistence]: Failed to load data:', e.message);
  }
}

function saveData() {
  try {
    ensureDataDir();
    const data = {
      users: Array.from(users.values()),
      transactions: Object.fromEntries(transactions),
      userSeeds: Object.fromEntries(userSeeds)
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('[Persistence]: Failed to save data:', e.message);
  }
}

// Save every 30 seconds and on key events
setInterval(saveData, 30000);
process.on('SIGINT', () => { saveData(); process.exit(); });
process.on('SIGTERM', () => { saveData(); process.exit(); });

loadData();   

// Seed Initial Demo User
users.set(1, { 
  id: 1, 
  username: 'Player_1001', 
  email: 'player1001@example.com',
  gc_balance: 10000.0, 
  sc_unplayed: 50.0,
  sc_played: 0.0,     
  stripeAccountId: null,
  kyc: {
    status: 'VERIFIED', // UNVERIFIED | PENDING | VERIFIED | REJECTED
    tier: 2,           // Tier 0: Unverified, Tier 1: Basic (Purchases), Tier 2: Full (Redemptions)
    inquiryId: 'inq_demo123',
    verifiedAt: new Date().toISOString(),
    rejectionReason: null
  },
  lastDailyClaim: 0,
  dailyStreak: 0,
  adsWatchedToday: 0,
  lastAdReset: Date.now(),
  state: 'CA',
  vipTier: 'Bronze',
  totalWageredGC: 0,
  totalWageredSC: 0,
  rakebackAccruedSC: 0
});
transactions.set(1, []);

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
      clientSeed: 'default_client_seed',
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
  return tx;
}

function updateVipAndRakeback(user, scWagered, gcWagered) {
  user.totalWageredSC += scWagered;
  user.totalWageredGC += gcWagered;

  if (scWagered > 0) {
    user.rakebackAccruedSC += (scWagered * HOUSE_EDGE * RAKEBACK_RATE);
  }

  if (user.totalWageredSC >= 100000) user.vipTier = 'Diamond';
  else if (user.totalWageredSC >= 25000) user.vipTier = 'Platinum';
  else if (user.totalWageredSC >= 5000) user.vipTier = 'Gold';
  else if (user.totalWageredSC >= 1000) user.vipTier = 'Silver';
  else user.vipTier = 'Bronze';
}

/**
 * Validates a wager end-to-end (currency whitelist, numeric bet, rounding,
 * balance check). Returns { user, currency, amount } or sends an error
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

  const rounded = Math.round(amount * 100) / 100;
  const balance = currency === 'GC'
    ? user.gc_balance
    : user.sc_unplayed + user.sc_played;

  if (rounded > balance) {
    res.status(400).json({ error: `Insufficient ${currency} balance.` });
    return null;
  }

  return { user, currency, amount: rounded };
}

/** Debits a stake from the correct currency bucket and accrues VIP/rakeback. */
function debitBet(user, currency, amount) {
  if (currency === 'GC') {
    user.gc_balance -= amount;
    updateVipAndRakeback(user, 0, amount);
  } else {
    let remaining = amount;
    if (user.sc_unplayed >= remaining) {
      user.sc_unplayed -= remaining;
    } else {
      remaining -= user.sc_unplayed;
      user.sc_unplayed = 0;
      user.sc_played = Math.max(0, user.sc_played - remaining);
    }
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
function getOwnedSession(req, res, gameId) {
  const session = activeSessions.get(gameId);
  if (!session || !session.active) {
    res.status(400).json({ error: 'No active game round found for this game ID.' });
    return null;
  }
  if (session.userId !== req.user.id) {
    res.status(403).json({ error: 'This game session belongs to another player.' });
    return null;
  }
  return session;
}


// -----------------------------------------------------------------------------
// 5. GAME ENGINES
// -----------------------------------------------------------------------------
const { GAMES, GAME_FLOAT_COUNTS, round2 } = require('./engine/serverGames');
// -----------------------------------------------------------------------------
// 6. EXPRESS APP & MIDDLEWARES
// -----------------------------------------------------------------------------
const app = express();
const server = http.createServer(app);

app.use(cors({ origin: true, credentials: true }));

// Geofencing Compliance Middleware
function enforceJurisdiction(req, res, next) {
  const userState = req.headers['x-user-state'] || 'CA';
  if (RESTRICTED_STATES.includes(userState.toUpperCase())) {
    return res.status(403).json({ 
      error: `Sweepstakes play is unavailable in your jurisdiction (${userState}).` 
    });
  }
  next();
}

// Stripe Webhook Endpoint (Raw Body Parser before express.json())
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

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
      const gcAmount = parseFloat(session.metadata.gcAmount);
      const scAmount = parseFloat(session.metadata.scAmount);

      const user = users.get(userId);
      if (user) {
        user.gc_balance += gcAmount;
        user.sc_unplayed += scAmount;
        saveData();

        logTransaction(userId, 'PURCHASE', `Purchased ${session.metadata.packageName || 'Coin Package'}`, gcAmount, scAmount, { stripeSessionId: session.id });

        sendToUser(userId, {
          type: 'BALANCE_UPDATE',
          balances: { gc: user.gc_balance, sc_unplayed: user.sc_unplayed, sc_played: user.sc_played },
          message: `Added ${gcAmount.toLocaleString()} GC and ${scAmount} SC!`
        });
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
  }

  res.json({ success: true });
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function verifyToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Authentication token required.' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired session token.' });
    req.user = user;
    next();
  });
}

// -----------------------------------------------------------------------------
// 7. WEBSOCKET SERVER & HEARTBEAT
// -----------------------------------------------------------------------------
const wss = new WebSocket.Server({ noServer: true });
const connectedClients = new Map();

server.on('upgrade', (request, socket, head) => {
  const urlParams = new URLSearchParams(request.url.replace(/^[^?]*\?/, ''));
  const token = urlParams.get('token');

  if (!token) {
    socket.destroy();
    return;
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
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

app.post('/api/auth/guest', (req, res) => {
  const guestId = users.size + 1;
  const username = `Guest_${Math.floor(1000 + Math.random() * 9000)}`;
  const newUser = {
    id: guestId,
    username,
    email: `${username.toLowerCase()}@guest.casino`,
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
    state: 'CA',
    vipTier: 'Bronze',
    totalWageredGC: 0,
    totalWageredSC: 0,
    rakebackAccruedSC: 0
  };
  users.set(guestId, newUser);
  transactions.set(guestId, []);
  saveData();

  const token = jwt.sign({ id: newUser.id, username: newUser.username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ 
    token, 
    user: { id: newUser.id, username: newUser.username, kyc: newUser.kyc }, 
    balances: { gc: newUser.gc_balance, sc: newUser.sc_unplayed + newUser.sc_played } 
  });
});

app.post('/api/auth/register', async (req, res) => {
  const { username, email, password, birthDate } = req.body || {};

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Username, email, and password are required.' });
  }

  if (!birthDate) {
    return res.status(400).json({ error: 'Birth date is required for age verification.' });
  }

  const birth = new Date(birthDate);
  const ageMs = Date.now() - birth.getTime();
  const minAgeMs = 18 * 365 * 24 * 60 * 60 * 1000;
  if (ageMs < minAgeMs || birth > new Date()) {
    return res.status(403).json({ error: 'You must be at least 18 years old to register.' });
  }

  for (const u of users.values()) {
    if (u.email === email) return res.status(409).json({ error: 'Email already registered.' });
    if (u.username === username) return res.status(409).json({ error: 'Username already taken.' });
  }

  const userId = users.size + 1;
  const hashedPassword = await bcrypt.hash(password, 10);
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
    state: 'CA',
    vipTier: 'Bronze',
    totalWageredGC: 0,
    totalWageredSC: 0,
    rakebackAccruedSC: 0
  };
  users.set(userId, newUser);
  transactions.set(userId, []);
  saveData();

  const token = jwt.sign({ id: newUser.id, username: newUser.username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({
    token,
    user: { id: newUser.id, username: newUser.username, email: newUser.email, kyc: newUser.kyc },
    balances: { gc: newUser.gc_balance, sc: newUser.sc_unplayed + newUser.sc_played }
  });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  let foundUser = null;
  for (const u of users.values()) {
    if (u.email === email) { foundUser = u; break; }
  }
  if (!foundUser) return res.status(401).json({ error: 'Invalid credentials.' });

  const valid = await bcrypt.compare(password, foundUser.password || '');
  if (!valid) return res.status(401).json({ error: 'Invalid credentials.' });

  const token = jwt.sign({ id: foundUser.id, username: foundUser.username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({
    token,
    user: { id: foundUser.id, username: foundUser.username, email: foundUser.email, kyc: foundUser.kyc },
    balances: { gc: foundUser.gc_balance, sc: foundUser.sc_unplayed + foundUser.sc_played }
  });
});

app.get('/api/user/me', verifyToken, async (req, res) => {
  const user = users.get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User profile not found.' });

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
    dailyBonus: {
      canClaim: Date.now() - user.lastDailyClaim > 24 * 60 * 60 * 1000,
      nextClaimMs: Math.max(0, (user.lastDailyClaim + 24 * 60 * 60 * 1000) - Date.now()),
      streak: user.dailyStreak
    }
  });
});

app.get('/api/user/transactions', verifyToken, (req, res) => {
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

app.post('/api/user/kyc/start', verifyToken, (req, res) => {
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

app.post('/api/user/kyc/verify-sandbox', verifyToken, (req, res) => {
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

app.post('/api/user/amoe-code', verifyToken, (req, res) => {
  const code = `AMOE-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  amoeRegistry.set(code, { userId: req.user.id, issuedAt: Date.now(), redeemed: false });
  
  res.json({
    success: true,
    amoeCode: code,
    instructions: 'Write this code on a 4x6 post card along with your account username and mail it to our legal sweepstakes address to claim 5.00 free SC.'
  });
});

app.post('/api/user/claim-rakeback', verifyToken, (req, res) => {
  const user = users.get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (user.rakebackAccruedSC <= 0) {
    return res.status(400).json({ error: 'No rakeback available to claim.' });
  }

  const amount = user.rakebackAccruedSC;
  user.sc_unplayed += amount;
  user.rakebackAccruedSC = 0;
  saveData();

  logTransaction(user.id, 'RAKEBACK', `Claimed Rakeback`, 0, amount);

  res.json({
    success: true,
    claimed: amount,
    balances: { gc: user.gc_balance, sc: user.sc_unplayed + user.sc_played }
  });
});

app.post('/api/user/daily-bonus', verifyToken, (req, res) => {
  const user = users.get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const now = Date.now();
  const ONE_DAY = 24 * 60 * 60 * 1000;
  const TWO_DAYS = 48 * 60 * 60 * 1000;

  if (now - user.lastDailyClaim < ONE_DAY) {
    const remainingMs = (user.lastDailyClaim + ONE_DAY) - now;
    return res.status(400).json({ error: 'Daily bonus is not ready yet.', nextClaimMs: remainingMs });
  }

  if (now - user.lastDailyClaim > TWO_DAYS) {
    user.dailyStreak = 1;
  } else {
    user.dailyStreak = (user.dailyStreak || 0) + 1;
  }

  user.lastDailyClaim = now;
  const gcReward = 5000 + (user.dailyStreak * 1000);
  const scReward = 1.00 + (user.dailyStreak * 0.25);

  user.gc_balance += gcReward;
  user.sc_unplayed += scReward;
  saveData();

  logTransaction(user.id, 'BONUS', `Daily Claim (Day ${user.dailyStreak})`, gcReward, scReward);

  res.json({
    success: true,
    claimed: { gc: gcReward, sc: scReward },
    streak: user.dailyStreak,
    balances: { gc: user.gc_balance, sc: user.sc_unplayed + user.sc_played }
  });
});

app.post('/api/user/rewarded-ad', verifyToken, (req, res) => {
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

app.post('/api/user/buy-coins', verifyToken, async (req, res) => {
  const { packageId, uiMode } = req.body;
  const pkg = COIN_PACKAGES[packageId || 'pack_10'];

  if (!pkg) return res.status(400).json({ error: 'Invalid coin package.' });

  const host = req.headers.origin || `https://${req.headers.host}`;
  const mode = uiMode === 'hosted' ? 'hosted' : 'embedded_page';

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

    res.json({
      clientSecret: session.client_secret,
      url: session.url,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create checkout session.', details: err.message });
  }
});

app.post('/api/user/withdraw-sc', verifyToken, async (req, res) => {
  const { amount } = req.body;
  const user = users.get(req.user.id);
  const host = req.headers.origin || `https://${req.headers.host}`;

  if (!user) return res.status(404).json({ error: 'User not found.' });

  if (!user.kyc || user.kyc.status !== 'VERIFIED') {
    return res.status(403).json({
      error: 'Identity verification (KYC) is required before redeeming Sweeps Coins for cash.',
      requiresKyc: true
    });
  }

  if (isNaN(amount) || amount < 50) {
    return res.status(400).json({ error: 'Minimum redemption limit is 50.00 Sweeps Coins (SC).' });
  }

  if (user.sc_played < amount) {
    return res.status(400).json({ 
      error: `Insufficient redeemable balance. You have ${user.sc_played.toFixed(2)} SC eligible for redemption. (Unplayed SC must be wagered 1x first).` 
    });
  }

  try {
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

    user.sc_played -= amount;
    saveData();
    logTransaction(user.id, 'WITHDRAWAL', `Redeemed ${amount} SC ($${amount.toFixed(2)} USD)`, 0, -amount);

    res.json({
      success: true,
      message: `Successfully transferred $${amount.toFixed(2)} USD!`,
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

   const outcome = GAMES[gameId](floats, req.body.params || {});
   const payout = Math.round(outcome.multiplier * amount * 100) / 100;
   const isWin = outcome.multiplier > 1 || outcome.pushed;

   if (payout > 0) {
     creditWin(user, currency, payout);
     logTransaction(user.id, isWin ? 'WIN' : 'BET',
       `${gameId.toUpperCase()} resolved @ ${outcome.multiplier}x`,
       currency === 'GC' ? payout : 0, currency === 'SC' ? payout : 0);
   }

   // Track telemetry for challenges and rakeback
   ensureBonusFields(user);
   updateTelemetry(user, gameId, currency, amount, isWin, payout, outcome);

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
  claimLocks.set(key, true);
  return true;
}

function releaseLock(userId, operation) {
  claimLocks.delete(`${userId}:${operation}`);
}

// Challenge definitions — pool to draw 3 from each day
const CHALLENGE_POOL = [
  { id: 'bet_100_sc',           desc: 'Wager 100 SC in 24 hours',           task: 'sc_wagered', target: 100,  minReward: 1.00,  maxReward: 5.00  },
  { id: 'bet_50_gc',            desc: 'Wager 50,000 GC in 24 hours',         task: 'gc_wagered', target: 50000, minReward: 1.00,  maxReward: 5.00  },
  { id: 'rounds_10',            desc: 'Play 10 rounds in 24 hours',          task: 'rounds',     target: 10,   minReward: 0.50,  maxReward: 3.00  },
  { id: 'win_5_rounds',         desc: 'Win 5 rounds in 24 hours',            task: 'rounds_won', target: 5,    minReward: 1.00,  maxReward: 8.00  },
  { id: 'play_3_games',         desc: 'Play 3 different games in 24 hours',  task: 'games_played', target: 3,  minReward: 0.50,  maxReward: 2.50 },
  { id: 'lose_5_sc_max',        desc: 'Wager 100 SC on Dice (OVER 90)',      task: 'dice_over90', target: 100, minReward: 0.50,  maxReward: 15.00 },
  { id: 'crash_2x_cashout',     desc: 'Cashout Crash at 2x or higher 3 times', task: 'crash_cashout_2x', target: 3, minReward: 0.50, maxReward: 7.00 },
  { id: 'blackjack_3_hands',    desc: 'Play 3 Blackjack hands',              task: 'blackjack_hands', target: 3, minReward: 0.50, maxReward: 3.00 }
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
    history: []
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
  return user.bonus;
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
    if (!won) t.dailyLossSC = 0;
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
  t.gamesPlayed.push(gameId);
  // Deduplicate for the games-played challenge
  const uniqueGames = [...new Set(t.gamesPlayed)];

  if (!won && currency === 'SC') {
    const loss = betAmount;
    t.dailyLossSC += loss;
    t.weeklyLossSC += loss;
    t.monthlyLossSC += loss;
  }

  // Challenge-specific tracking
  if (gameId === 'dice' && currency === 'SC' && won && betAmount >= 1 && payout / betAmount >= 9) (t.diceOver90 = (t.diceOver90 || 0) + 1);
  if (gameId === 'crash' && won && payout / betAmount >= 2) (t.crashCashout2x = (t.crashCashout2x || 0) + 1);
  if (gameId === 'blackjack') (t.blackjackHands = (t.blackjackHands || 0) + 1);

  // Push to history (cap at 200 entries)
  t.history.push({ ts: Date.now(), game: gameId, currency, bet: betAmount, won, payout });
  if (t.history.length > 200) t.history.shift();

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
// Fixed reward: 10,000 GC + 10.00 SC, strict 24-hour cooldown

const DAILY_CLAIM_REWARD = { gc: 10000, sc: 10.00 };

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
  const t = bonus.telemetry;
  // Net SC loss = SC wagered - SC won (for each window)
  const dailyLoss = Math.max(0, (t.dailyLossSC || 0));
  const weeklyLoss = Math.max(0, (t.weeklyLossSC || 0));
  const monthlyLoss = Math.max(0, (t.monthlyLossSC || 0));
  return { daily: dailyLoss, weekly: weeklyLoss, monthly: monthlyLoss };
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
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed JSON body.' });
  }
  console.error('[SERVER ERROR]', err);
  res.status(500).json({ error: 'Internal server error.' });
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
server.listen(PORT, () => {
  console.log(`🎰 SWEEPSTAKES CASINO ENGINE ONLINE: Port ${PORT}`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
  });
});