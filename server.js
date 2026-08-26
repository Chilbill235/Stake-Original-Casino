require('dotenv').config();

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');
const cors = require('cors');

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

const RESTRICTED_STATES = ['WA', 'ID', 'NV', 'KY', 'MI', 'GA', 'KY'];

// Coin Package Configurations ($1 USD = 1,000 GC + 1 FREE SC)
const COIN_PACKAGES = {
  'pack_10': { name: '10,000 GC + 15 Free SC', priceInCents: 1000, gcAmount: 15000, scAmount: 15 },
  'pack_20': { name: '20,000 GC + 25 Free SC', priceInCents: 2000, gcAmount: 25000, scAmount: 25 },
  'pack_50': { name: '50,000 GC + 55 Free SC', priceInCents: 5000, gcAmount: 55000, scAmount: 55 },
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
}

/** Credits winnings to the correct currency bucket. */
function creditWin(user, currency, amount) {
  if (currency === 'GC') user.gc_balance += amount;
  else user.sc_played += amount;
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


function getBaccaratCardValue(card) {
  if (['10', 'J', 'Q', 'K'].includes(card.value)) return 0;
  if (card.value === 'A') return 1;
  return parseInt(card.value, 10);
}

function getBaccaratHandScore(hand) {
  let total = 0;
  for (let card of hand) {
    total += getBaccaratCardValue(card);
  }
  return total % 10;
}

function createDeck() {
  const suits = ['♠', '♥', '♦', '♣'];
  const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const deck = [];
  for (let s of suits) {
    for (let v of values) {
      let score = parseInt(v, 10);
      if (['J', 'Q', 'K'].includes(v)) score = 10;
      if (v === 'A') score = 11;
      deck.push({ suit: s, value: v, score });
    }
  }
  return deck;
}

function getHandScore(hand) {
  let score = 0, aces = 0;
  for (let card of hand) {
    score += card.score;
    if (card.value === 'A') aces++;
  }
  while (score > 21 && aces > 0) { score -= 10; aces--; }
  return score;
}

// -----------------------------------------------------------------------------
// 5. GAME ENGINES
// -----------------------------------------------------------------------------
const { GAMES, GAME_FLOAT_COUNTS } = require('./engine/serverGames');
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
app.post('/api/webhooks/kyc', express.json(), (req, res) => {
  const event = req.body;
  
  if (PERSONA_WEBHOOK_SECRET) {
    const sig = req.headers['persona-signature'];
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

  const token = jwt.sign({ id: newUser.id, username: newUser.username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ 
    token, 
    user: { id: newUser.id, username: newUser.username, kyc: newUser.kyc }, 
    balances: { gc: newUser.gc_balance, sc: newUser.sc_unplayed + newUser.sc_played } 
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
  verifyToken
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
  // Any positive multiplier returns value to the player (partial plinko hits, pushes, etc.)
  const payout = Math.round(outcome.multiplier * amount * 100) / 100;

  if (payout > 0) {
    creditWin(user, currency, payout);
    logTransaction(user.id, outcome.multiplier > 1 ? 'WIN' : 'BET',
      `${gameId.toUpperCase()} resolved @ ${outcome.multiplier}x`,
      currency === 'GC' ? payout : 0, currency === 'SC' ? payout : 0);
  }

  broadcastLiveBet({
    username: user.username,
    game: gameId.toUpperCase(),
    betAmount: amount,
    currency,
    multiplier: outcome.multiplier,
    win: outcome.multiplier > 1,
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
// 12b. ERROR HANDLING & JSON 404 FALLBACK
// -----------------------------------------------------------------------------
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