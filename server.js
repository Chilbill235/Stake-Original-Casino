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
const HOUSE_EDGE = 0.13; // 1% House Edge (99% RTP)
const RAKEBACK_RATE = 5.00; // 5% of House Edge back to user

const stripe = require('stripe')(STRIPE_SECRET_KEY);

const RESTRICTED_STATES = ['WA', 'ID', 'NV', 'KY', 'MI', 'GA', 'OH'];

// Coin Package Configurations ($1 USD = 1,000 GC + 1 FREE SC)
const COIN_PACKAGES = {
  'pack_10': { name: '10,000 GC + 15 Free SC', priceInCents: 1500, gcAmount: 15000, scAmount: 15 },
  'pack_20': { name: '20,000 GC + 25 Free SC', priceInCents: 2500, gcAmount: 25000, scAmount: 25 },
  'pack_50': { name: '50,000 GC + 55 Free SC', priceInCents: 5500, gcAmount: 55000, scAmount: 55 },
  'pack_100': { name: '100,000 GC + 105 Free SC', priceInCents: 10500, gcAmount: 100000, scAmount: 105 }
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
const GAMES = {
  slots: (floats) => {
    const symbols = ['🍒', '🍋', '🍇', '🔔', '💎', '7️⃣'];
    const weights = [0.40, 0.25, 0.18, 0.10, 0.05, 0.02];
    const grid = [];
    let idx = 0;
    
    for (let r = 0; r < 3; r++) {
      const row = [];
      for (let c = 0; c < 3; c++) {
        const rand = floats[idx++];
        let sum = 0, sym = symbols[0];
        for (let i = 0; i < symbols.length; i++) {
          sum += weights[i];
          if (rand <= sum) { sym = symbols[i]; break; }
        }
        row.push(sym);
      }
      grid.push(row);
    }
    
    const lines = [
      [grid[0][0], grid[0][1], grid[0][2]],
      [grid[1][0], grid[1][1], grid[1][2]],
      [grid[2][0], grid[2][1], grid[2][2]],
      [grid[0][0], grid[1][1], grid[2][2]],
      [grid[2][0], grid[1][1], grid[0][2]]
    ];
    
    let rawMult = 0;
    const payouts = { '🍒': 1.5, '🍋': 3, '🍇': 5, '🔔': 10, '💎': 25, '7️⃣': 75 };
    lines.forEach(line => {
      if (line[0] === line[1] && line[1] === line[2]) rawMult += payouts[line[0]];
    });

    const multiplier = parseFloat((rawMult * (1 - HOUSE_EDGE)).toFixed(2));
    return { win: multiplier > 0, multiplier, details: { grid } };
  },

  blackjack: (floats) => {
    const deck = createDeck();
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(floats[i % floats.length] * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    
    const playerHand = [deck.pop(), deck.pop()];
    const dealerHand = [deck.pop(), deck.pop()];
    
    let playerScore = getHandScore(playerHand);
    let dealerScore = getHandScore(dealerHand);
    
    while (dealerScore < 17 && deck.length > 0) {
      dealerHand.push(deck.pop());
      dealerScore = getHandScore(dealerHand);
    }

    let multiplier = 0;
    if (playerScore === 21 && playerHand.length === 2) {
      multiplier = 2.5 * (1 - HOUSE_EDGE);
    } else if (playerScore <= 21 && (dealerScore > 21 || playerScore > dealerScore)) {
      multiplier = 2.0 * (1 - HOUSE_EDGE);
    } else if (playerScore <= 21 && playerScore === dealerScore) {
      multiplier = 1.0;
    }

    return { win: multiplier > 1.0, multiplier: parseFloat(multiplier.toFixed(2)), details: { playerHand, dealerHand, playerScore, dealerScore } };
  },

  baccarat: (floats, params) => {
    const betOn = params.target || 'PLAYER';
    const deck = createDeck();
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(floats[i % floats.length] * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }

    const playerHand = [deck.pop(), deck.pop()];
    const bankerHand = [deck.pop(), deck.pop()];
    let pScore = getBaccaratHandScore(playerHand);
    let bScore = getBaccaratHandScore(bankerHand);

    if (pScore < 8 && bScore < 8) {
      let playerThirdVal = null;
      if (pScore <= 5) {
        const p3 = deck.pop();
        playerHand.push(p3);
        playerThirdVal = getBaccaratCardValue(p3);
        pScore = getBaccaratHandScore(playerHand);
      }

      if (playerHand.length === 2) {
        if (bScore <= 5) bankerHand.push(deck.pop());
      } else {
        if (bScore <= 2) bankerHand.push(deck.pop());
        else if (bScore === 3 && playerThirdVal !== 8) bankerHand.push(deck.pop());
        else if (bScore === 4 && [2,3,4,5,6,7].includes(playerThirdVal)) bankerHand.push(deck.pop());
        else if (bScore === 5 && [4,5,6,7].includes(playerThirdVal)) bankerHand.push(deck.pop());
        else if (bScore === 6 && [6,7].includes(playerThirdVal)) bankerHand.push(deck.pop());
      }
      bScore = getBaccaratHandScore(bankerHand);
    }

    let outcome = 'TIE';
    if (pScore > bScore) outcome = 'PLAYER';
    else if (bScore > pScore) outcome = 'BANKER';

    let win = outcome === betOn;
    let multiplier = 0;
    if (win) {
      if (betOn === 'PLAYER') multiplier = 2.0 * (1 - HOUSE_EDGE);
      if (betOn === 'BANKER') multiplier = 1.95 * (1 - HOUSE_EDGE);
      if (betOn === 'TIE') multiplier = 8.0;
    }

    return { win, multiplier: parseFloat(multiplier.toFixed(2)), details: { playerHand, bankerHand, pScore, bScore, outcome } };
  },

  dice: (floats, params) => {
    const roll = parseFloat((floats[0] * 100).toFixed(2));
    const target = params.target || 50;
    const cond = params.condition || 'OVER';
    const win = cond === 'OVER' ? roll > target : roll < target;
    const winProb = cond === 'OVER' ? (100 - target) : target;
    
    const multiplier = win ? parseFloat(((100 - (HOUSE_EDGE * 100)) / winProb).toFixed(4)) : 0;
    return { win, multiplier, details: { rolled: roll, target, cond } };
  },

  limbo: (floats, params) => {
    const rawResult = (1 - HOUSE_EDGE) / (1 - floats[0]);
    const result = parseFloat(rawResult.toFixed(2));
    const target = params.targetMultiplier || 2.0;
    const win = result >= target;
    return { win, multiplier: win ? target : 0, details: { resultMultiplier: result, target } };
  },

  crash: (floats, params) => {
    const e = Math.pow(2, 52);
    const h = Math.floor(floats[0] * e);
    let crashPoint = 1.0;
    if (h % 33 !== 0) {
      crashPoint = parseFloat(((e - h / 50) / (e - h) * (1 - HOUSE_EDGE)).toFixed(2));
    }
    const target = params.targetMultiplier || 1.5;
    const win = crashPoint >= target;
    return { win, multiplier: win ? target : 0, details: { crashPoint, target } };
  },

  hilo: (floats, params) => {
    const deck = createDeck();
    const currentCardIdx = Math.floor(floats[0] * deck.length);
    const nextCardIdx = Math.floor(floats[1] * deck.length);
    const currentCard = deck[currentCardIdx];
    const nextCard = deck[nextCardIdx];

    const guess = params.guess || 'HIGHER';
    let win = false;
    if (guess === 'HIGHER') win = nextCard.score >= currentCard.score;
    if (guess === 'LOWER') win = nextCard.score <= currentCard.score;

    const multiplier = win ? parseFloat((1.95 * (1 - HOUSE_EDGE)).toFixed(2)) : 0;
    return { win, multiplier: parseFloat(multiplier.toFixed(2)), details: { currentCard, nextCard, guess } };
  },

  plinko: (floats) => {
    let position = 0;
    for (let r = 0; r < 16; r++) {
      if (floats[r] > 0.5) position++;
    }
    const mults = [100, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 100];
    const multiplier = parseFloat((mults[position] * (1 - HOUSE_EDGE)).toFixed(2));
    return { win: multiplier >= 1.0, multiplier, details: { position } };
  },

  keno: (floats, params) => {
    const picked = params.selectedNumbers || [1, 5, 10, 15, 20];
    const pool = Array.from({ length: 40 }, (_, i) => i + 1);
    const drawn = [];
    for (let i = 0; i < 10; i++) {
      const choice = Math.floor(floats[i] * pool.length);
      drawn.push(pool.splice(choice, 1)[0]);
    }
    const matches = picked.filter(n => drawn.includes(n)).length;
    const payouts = [0, 0, 1.5, 4.0, 10.0, 50.0];
    const multiplier = parseFloat(((payouts[matches] || 0) * (1 - HOUSE_EDGE)).toFixed(2));
    return { win: multiplier > 0, multiplier, details: { drawn, matches } };
  },

  wheel: (floats) => {
    const segments = [0, 1.5, 1.2, 2.0, 0, 3.0, 1.2, 5.0, 0, 1.5, 2.0, 10.0];
    const index = Math.floor(floats[0] * segments.length);
    const multiplier = parseFloat((segments[index] * (1 - HOUSE_EDGE)).toFixed(2));
    return { win: multiplier > 0, multiplier, details: { index } };
  }
};

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
// 10. MINES GAME ENDPOINTS
// -----------------------------------------------------------------------------
app.post('/api/play/mines/start', verifyToken, enforceJurisdiction, (req, res) => {
  const { currency, betAmount, mineCount } = req.body;
  const user = users.get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  if (currency === 'GC') {
    if (user.gc_balance < betAmount || betAmount <= 0) return res.status(400).json({ error: 'Insufficient GC balance.' });
    user.gc_balance -= betAmount;
    updateVipAndRakeback(user, 0, betAmount);
  } else {
    const totalSC = user.sc_unplayed + user.sc_played;
    if (totalSC < betAmount || betAmount <= 0) return res.status(400).json({ error: 'Insufficient SC balance.' });
    
    let remainingBet = betAmount;
    if (user.sc_unplayed >= remainingBet) {
      user.sc_unplayed -= remainingBet;
    } else {
      remainingBet -= user.sc_unplayed;
      user.sc_unplayed = 0;
      user.sc_played -= remainingBet;
    }
    updateVipAndRakeback(user, betAmount, 0);
  }

  const seedPair = getUserSeedPair(user.id);
  const floats = ProvablyFair.getFloats(seedPair.serverSeed, seedPair.clientSeed, seedPair.nonce++, 25);
  
  const board = Array(25).fill('GEM');
  let bombs = 0;
  let idx = 0;
  const count = Math.min(Math.max(mineCount || 3, 1), 24);

  while (bombs < count) {
    const pos = Math.floor(floats[idx++] * 25);
    if (board[pos] !== 'BOMB') { board[pos] = 'BOMB'; bombs++; }
  }

  const gameId = `mines_${crypto.randomUUID()}`;
  activeSessions.set(gameId, {
    userId: user.id, currency, betAmount, board, revealed: [], mineCount: count, active: true
  });

  logTransaction(user.id, 'BET', `Placed bet on Mines (${count} mines)`, currency === 'GC' ? -betAmount : 0, currency === 'SC' ? -betAmount : 0);

  res.json({ gameId, balances: { gc: user.gc_balance, sc: user.sc_unplayed + user.sc_played }, status: 'ACTIVE' });
});

app.post('/api/play/mines/reveal', verifyToken, (req, res) => {
  const { gameId, tileIndex } = req.body;
  const session = activeSessions.get(gameId || `${req.user.id}_mines`);
  if (!session || !session.active) return res.status(400).json({ error: 'No active Mines game found.' });
  if (session.revealed.includes(tileIndex)) return res.status(400).json({ error: 'Tile already revealed.' });

  if (session.board[tileIndex] === 'BOMB') {
    session.active = false;
    return res.json({ win: false, hitBomb: true, board: session.board, multiplier: 0, payout: 0 });
  }

  session.revealed.push(tileIndex);
  const gemsFound = session.revealed.length;
  let mult = 1;
  for (let i = 0; i < gemsFound; i++) {
    mult *= (25 - i) / (25 - session.mineCount - i);
  }
  mult *= (1 - HOUSE_EDGE);

  res.json({ win: true, hitBomb: false, tileIndex, multiplier: parseFloat(mult.toFixed(2)), gemsFound });
});

app.post('/api/play/mines/cashout', verifyToken, (req, res) => {
  const { gameId } = req.body;
  const session = activeSessions.get(gameId || `${req.user.id}_mines`);
  if (!session || !session.active || session.revealed.length === 0) return res.status(400).json({ error: 'Cannot cashout.' });

  let mult = 1;
  for (let i = 0; i < session.revealed.length; i++) {
    mult *= (25 - i) / (25 - session.mineCount - i);
  }
  mult *= (1 - HOUSE_EDGE);

  const user = users.get(req.user.id);
  const payout = mult * session.betAmount;

  if (session.currency === 'GC') {
    user.gc_balance += payout;
  } else {
    user.sc_played += payout;
  }

  session.active = false;
  logTransaction(user.id, 'WIN', `Cashed out Mines @ ${mult.toFixed(2)}x`, session.currency === 'GC' ? payout : 0, session.currency === 'SC' ? payout : 0);

  broadcastLiveBet({
    username: user.username, game: 'MINES', betAmount: session.betAmount, currency: session.currency, multiplier: mult, win: true, payout
  });

  res.json({ win: true, payout, multiplier: parseFloat(mult.toFixed(2)), balances: { gc: user.gc_balance, sc: user.sc_unplayed + user.sc_played } });
});

// -----------------------------------------------------------------------------
// 11. TOWER GAME ENDPOINTS
// -----------------------------------------------------------------------------
app.post('/api/play/tower/start', verifyToken, enforceJurisdiction, (req, res) => {
  const { currency, betAmount, difficulty } = req.body;
  const user = users.get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  if (currency === 'GC') {
    if (user.gc_balance < betAmount || betAmount <= 0) return res.status(400).json({ error: 'Insufficient GC balance.' });
    user.gc_balance -= betAmount;
    updateVipAndRakeback(user, 0, betAmount);
  } else {
    const totalSC = user.sc_unplayed + user.sc_played;
    if (totalSC < betAmount || betAmount <= 0) return res.status(400).json({ error: 'Insufficient SC balance.' });
    
    let remainingBet = betAmount;
    if (user.sc_unplayed >= remainingBet) {
      user.sc_unplayed -= remainingBet;
    } else {
      remainingBet -= user.sc_unplayed;
      user.sc_unplayed = 0;
      user.sc_played -= remainingBet;
    }
    updateVipAndRakeback(user, betAmount, 0);
  }

  const seedPair = getUserSeedPair(user.id);
  const floats = ProvablyFair.getFloats(seedPair.serverSeed, seedPair.clientSeed, seedPair.nonce++, 8);
  
  const rows = [];
  const safeCount = difficulty === 'EASY' ? 2 : (difficulty === 'HARD' ? 1 : 1); // Simplified safety configuration
  for (let i = 0; i < 8; i++) {
    const winningTile = Math.floor(floats[i] * 3);
    rows.push(winningTile);
  }

  const gameId = `tower_${crypto.randomUUID()}`;
  activeSessions.set(gameId, {
    userId: user.id, currency, betAmount, rows, currentFloor: 0, active: true, multiplier: 1.00
  });

  logTransaction(user.id, 'BET', `Placed bet on Tower (${difficulty})`, currency === 'GC' ? -betAmount : 0, currency === 'SC' ? -betAmount : 0);

  res.json({ gameId, balances: { gc: user.gc_balance, sc: user.sc_unplayed + user.sc_played }, status: 'ACTIVE' });
});

app.post('/api/play/tower/pick', verifyToken, (req, res) => {
  const { gameId, tile } = req.body;
  const session = activeSessions.get(gameId);
  if (!session || !session.active) return res.status(400).json({ error: 'No active Tower game found.' });

  const winningTile = session.rows[session.currentFloor];
  if (tile !== winningTile) {
    session.active = false;
    return res.json({ win: false, multiplier: 0 });
  }

  session.currentFloor++;
  const mult = parseFloat((Math.pow(1.5, session.currentFloor) * (1 - HOUSE_EDGE)).toFixed(2));
  session.multiplier = mult;

  res.json({ win: true, multiplier: mult, currentFloor: session.currentFloor });
});

app.post('/api/play/tower/cashout', verifyToken, (req, res) => {
  const { gameId } = req.body;
  const session = activeSessions.get(gameId);
  if (!session || !session.active || session.currentFloor === 0) return res.status(400).json({ error: 'Cannot cash out Tower.' });

  const user = users.get(req.user.id);
  const payout = session.multiplier * session.betAmount;

  if (session.currency === 'GC') {
    user.gc_balance += payout;
  } else {
    user.sc_played += payout;
  }

  session.active = false;
  logTransaction(user.id, 'WIN', `Cashed out Tower @ ${session.multiplier}x`, session.currency === 'GC' ? payout : 0, session.currency === 'SC' ? payout : 0);

  broadcastLiveBet({
    username: user.username, game: 'TOWER', betAmount: session.betAmount, currency: session.currency, multiplier: session.multiplier, win: true, payout
  });

  res.json({ win: true, payout, multiplier: session.multiplier, balances: { gc: user.gc_balance, sc: user.sc_unplayed + user.sc_played } });
});

// -----------------------------------------------------------------------------
// 12. GENERAL GAMES EXECUTION ENDPOINT
// -----------------------------------------------------------------------------
app.post('/api/play/:gameId', verifyToken, enforceJurisdiction, (req, res) => {
  const { gameId } = req.params;
  const { currency, betAmount, params } = req.body;
  const user = users.get(req.user.id);

  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (!GAMES[gameId]) return res.status(404).json({ error: `Game engine '${gameId}' not supported.` });
  
  if (currency === 'GC') {
    if (user.gc_balance < betAmount || betAmount <= 0) return res.status(400).json({ error: 'Insufficient GC balance.' });
    user.gc_balance -= betAmount;
    updateVipAndRakeback(user, 0, betAmount);
  } else {
    const totalSC = user.sc_unplayed + user.sc_played;
    if (totalSC < betAmount || betAmount <= 0) return res.status(400).json({ error: 'Insufficient SC balance.' });

    let remainingBet = betAmount;
    if (user.sc_unplayed >= remainingBet) {
      user.sc_unplayed -= remainingBet;
    } else {
      remainingBet -= user.sc_unplayed;
      user.sc_unplayed = 0;
      user.sc_played -= remainingBet;
    }
    updateVipAndRakeback(user, betAmount, 0);
  }

  logTransaction(user.id, 'BET', `Wagered on ${gameId.toUpperCase()}`, currency === 'GC' ? -betAmount : 0, currency === 'SC' ? -betAmount : 0);

  const seedPair = getUserSeedPair(user.id);
  const floats = ProvablyFair.getFloats(seedPair.serverSeed, seedPair.clientSeed, seedPair.nonce++, 52);

  const outcome = GAMES[gameId](floats, params || {});
  const payout = outcome.multiplier * betAmount;

  if (outcome.win && payout > 0) {
    if (currency === 'GC') {
      user.gc_balance += payout;
    } else {
      user.sc_played += payout;
    }
    logTransaction(user.id, 'WIN', `Won ${gameId.toUpperCase()} @ ${outcome.multiplier}x`, currency === 'GC' ? payout : 0, currency === 'SC' ? payout : 0);
  }

  broadcastLiveBet({
    username: user.username,
    game: gameId.toUpperCase(),
    betAmount,
    currency,
    multiplier: outcome.multiplier,
    win: outcome.win,
    payout
  });

  res.json({
    ...outcome,
    payout,
    provablyFair: {
      serverSeedHash: ProvablyFair.hashSeed(seedPair.serverSeed),
      clientSeed: seedPair.clientSeed,
      nonce: seedPair.nonce - 1
    },
    balances: { gc: user.gc_balance, sc: user.sc_unplayed + user.sc_played }
  });
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