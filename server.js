require('dotenv').config();

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');

// Initialize Stripe from Environment Variables
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const server = http.createServer(app);

// Safe WebSocket initialization (handles serverless environments gracefully)
let wss;
try {
  wss = new WebSocket.Server({ server });
} catch (e) {
  wss = { clients: [] };
}

const JWT_SECRET = process.env.JWT_SECRET || 'casino_secret_key_123';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const HOUSE_EDGE = 0.01; // 1% House Edge (99% RTP)

// In-Memory Database (Store connected Stripe accounts per user)
const users = new Map();
users.set(1, { 
  id: 1, 
  username: 'Guest_1001', 
  gc_balance: 10000.0, 
  sc_balance: 100.0, 
  stripeAccountId: null 
});

// Active Game Sessions
const activeSessions = new Map();

// Coin Package Configurations ($1 USD = 1,000 GC + 1 FREE SC)
const COIN_PACKAGES = {
  'pack_10': { name: '10,000 GC + 10 Free SC', priceInCents: 1000, gcAmount: 10000, scAmount: 10 },
  'pack_20': { name: '20,000 GC + 20 Free SC', priceInCents: 2000, gcAmount: 20000, scAmount: 20 },
  'pack_50': { name: '50,000 GC + 50 Free SC', priceInCents: 5000, gcAmount: 50000, scAmount: 50 }
};

// 1. STRIPE WEBHOOK (Must capture raw body BEFORE express.json())
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error(`Webhook signature verification failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Credit user balances upon successful payment collection
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    if (session.payment_status === 'paid') {
      const userId = parseInt(session.metadata.userId);
      const gcAmount = parseFloat(session.metadata.gcAmount);
      const scAmount = parseFloat(session.metadata.scAmount);

      const user = users.get(userId);
      if (user) {
        user.gc_balance += gcAmount;
        user.sc_balance += scAmount;
        console.log(`[PAYMENT RECEIVED] Credited User ${userId}: +${gcAmount} GC, +${scAmount} SC`);
      }
    }
  }

  res.json({ received: true });
});

// Standard JSON middleware for remaining application routes
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function verifyToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
}

class ProvablyFair {
  static generateServerSeed() { return crypto.randomBytes(32).toString('hex'); }
  static hashSeed(seed) { return crypto.createHash('sha256').update(seed).digest('hex'); }
  
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

function createDeck() {
  const suits = ['♠', '♥', '♦', '♣'];
  const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const deck = [];
  for (let s of suits) {
    for (let v of values) {
      let score = parseInt(v);
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

function getBaccaratHandScore(hand) {
  let total = 0;
  for (let card of hand) {
    let val = card.score === 11 ? 1 : (card.score === 10 ? 0 : card.score);
    total += val;
  }
  return total % 10;
}

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
      if (pScore <= 5) {
        playerHand.push(deck.pop());
        pScore = getBaccaratHandScore(playerHand);
      }
      if (bankerHand.length === 2) {
        if (bScore <= 2) bankerHand.push(deck.pop());
        else if (bScore === 3 && (playerHand[2] ? playerHand[2].score !== 8 : true)) bankerHand.push(deck.pop());
        else if (bScore === 4 && [2,3,4,5,6,7].includes(playerHand[2]?.score)) bankerHand.push(deck.pop());
        else if (bScore === 5 && [4,5,6,7].includes(playerHand[2]?.score)) bankerHand.push(deck.pop());
        else if (bScore === 6 && [6,7].includes(playerHand[2]?.score)) bankerHand.push(deck.pop());
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
    return { win, multiplier, details: { roll, target, cond } };
  },

  limbo: (floats, params) => {
    const rawResult = (1 - HOUSE_EDGE) / (1 - floats[0]);
    const result = parseFloat(rawResult.toFixed(2));
    const target = params.targetMultiplier || 2.0;
    const win = result >= target;
    return { win, multiplier: win ? target : 0, details: { result, target } };
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

// API ROUTES

app.post('/api/auth/guest', (req, res) => {
  const token = jwt.sign({ id: 1, username: `Guest_${Math.floor(1000 + Math.random() * 9000)}` }, JWT_SECRET);
  const user = users.get(1);
  res.json({ token, balances: { gc: user.gc_balance, sc: user.sc_balance } });
});

app.get('/api/user/me', verifyToken, async (req, res) => {
  const user = users.get(req.user.id) || users.get(1);
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
    balances: { gc: user.gc_balance, sc: user.sc_balance }, 
    hasPayoutAccount: !!user.stripeAccountId,
    transfersActive
  });
});

app.post('/api/user/claim-gc', verifyToken, (req, res) => {
  const user = users.get(req.user.id) || users.get(1);
  user.gc_balance += 10000;
  res.json({ balances: { gc: user.gc_balance, sc: user.sc_balance } });
});

// Create Stripe Embedded Checkout Session (Dynamic Host Detection for Vercel)
app.post('/api/user/buy-coins', verifyToken, async (req, res) => {
  const { packageId } = req.body;
  const pkg = COIN_PACKAGES[packageId || 'pack_10'];

  if (!pkg) {
    return res.status(400).json({ error: 'Invalid coin package selected.' });
  }

  const host = req.headers.origin || `https://${req.headers.host}`;

  try {
    const session = await stripe.checkout.sessions.create({
      ui_mode: 'embedded_page',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: { name: pkg.name },
            unit_amount: pkg.priceInCents,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      return_url: `${host}/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      metadata: {
        userId: req.user.id.toString(),
        gcAmount: pkg.gcAmount.toString(),
        scAmount: pkg.scAmount.toString()
      }
    });

    res.json({ 
      clientSecret: session.client_secret,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY 
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create payment checkout session.', details: err.message });
  }
});

// Withdraw SC Endpoint with Dynamic URLs
app.post('/api/user/withdraw-sc', verifyToken, async (req, res) => {
  const { amount } = req.body;
  const user = users.get(req.user.id) || users.get(1);
  const host = req.headers.origin || `https://${req.headers.host}`;

  if (isNaN(amount) || amount < 100) {
    return res.status(400).json({ error: 'Minimum redemption limit is 100.00 Sweeps Coins (SC).' });
  }

  if (user.sc_balance < amount) {
    return res.status(400).json({ error: 'Insufficient Sweeps Coins balance.' });
  }

  try {
    if (!user.stripeAccountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        capabilities: { 
          transfers: { requested: true },
          card_payments: { requested: true }
        },
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
        error: 'Your payout account requires setup verification with Stripe before transferring funds.'
      });
    }

    const amountInCents = Math.round(amount * 100);
    const transfer = await stripe.transfers.create({
      amount: amountInCents,
      currency: 'usd',
      destination: user.stripeAccountId,
      description: `Sweeps Coins Payout for User #${user.id}`,
    });

    user.sc_balance -= amount;

    res.json({
      success: true,
      message: `Successfully paid out $${amount.toFixed(2)} USD!`,
      transferId: transfer.id,
      balances: { gc: user.gc_balance, sc: user.sc_balance }
    });
  } catch (err) {
    console.error('Stripe Payout Error:', err);
    res.status(500).json({ error: 'Payout transfer failed.', details: err.message });
  }
});

// Mines & Games Endpoints
app.post('/api/play/mines/start', verifyToken, (req, res) => {
  const { currency, betAmount, mineCount } = req.body;
  const user = users.get(req.user.id) || users.get(1);
  const balKey = currency === 'GC' ? 'gc_balance' : 'sc_balance';

  if (user[balKey] < betAmount) return res.status(400).json({ error: 'Insufficient balance' });

  user[balKey] -= betAmount;
  
  const sSeed = ProvablyFair.generateServerSeed();
  const floats = ProvablyFair.getFloats(sSeed, 'client_seed', Date.now(), 25);
  
  const board = Array(25).fill('GEM');
  let bombs = 0;
  let idx = 0;
  const count = mineCount || 3;
  while (bombs < count) {
    const pos = Math.floor(floats[idx++] * 25);
    if (board[pos] !== 'BOMB') { board[pos] = 'BOMB'; bombs++; }
  }

  activeSessions.set(req.user.id + '_mines', {
    currency, betAmount, board, revealed: [], mineCount: count, active: true
  });

  res.json({ balances: { gc: user.gc_balance, sc: user.sc_balance }, status: 'ACTIVE' });
});

app.post('/api/play/mines/reveal', verifyToken, (req, res) => {
  const { tileIndex } = req.body;
  const session = activeSessions.get(req.user.id + '_mines');
  if (!session || !session.active) return res.status(400).json({ error: 'No active game' });

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
  const session = activeSessions.get(req.user.id + '_mines');
  if (!session || !session.active || session.revealed.length === 0) return res.status(400).json({ error: 'Cannot cashout' });

  let mult = 1;
  for (let i = 0; i < session.revealed.length; i++) {
    mult *= (25 - i) / (25 - session.mineCount - i);
  }
  mult *= (1 - HOUSE_EDGE);

  const user = users.get(req.user.id) || users.get(1);
  const balKey = session.currency === 'GC' ? 'gc_balance' : 'sc_balance';
  const payout = mult * session.betAmount;
  user[balKey] += payout;

  session.active = false;

  const broadcastData = JSON.stringify({
    type: 'LIVE_BET', username: user.username, game: 'MINES',
    betAmount: session.betAmount, currency: session.currency, multiplier: mult, win: true, payout
  });
  if (wss.clients) {
    wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(broadcastData); });
  }

  res.json({ win: true, payout, multiplier: parseFloat(mult.toFixed(2)), balances: { gc: user.gc_balance, sc: user.sc_balance } });
});

app.post('/api/play/:gameId', verifyToken, (req, res) => {
  const { gameId } = req.params;
  const { currency, betAmount, params } = req.body;
  const user = users.get(req.user.id) || users.get(1);

  if (!GAMES[gameId]) return res.status(404).json({ error: 'Game not found' });
  const balKey = currency === 'GC' ? 'gc_balance' : 'sc_balance';

  if (user[balKey] < betAmount) {
    return res.status(400).json({ error: `Insufficient ${currency} balance.` });
  }

  user[balKey] -= betAmount;

  const sSeed = ProvablyFair.generateServerSeed();
  const floats = ProvablyFair.getFloats(sSeed, 'client_seed', Date.now(), 52);

  const outcome = GAMES[gameId](floats, params || {});
  const payout = outcome.multiplier * betAmount;

  if (outcome.win && payout > 0) {
    user[balKey] += payout;
  }

  const broadcastData = JSON.stringify({
    type: 'LIVE_BET', username: user.username, game: gameId.toUpperCase(),
    betAmount, currency, multiplier: outcome.multiplier, win: outcome.win, payout
  });
  if (wss.clients) {
    wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(broadcastData); });
  }

  res.json({
    ...outcome,
    payout,
    provablyFair: { serverSeedHash: ProvablyFair.hashSeed(sSeed) },
    balances: { gc: user.gc_balance, sc: user.sc_balance }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎰 STAKE CASINO ENGINE ACTIVE: Port ${PORT}`);
});