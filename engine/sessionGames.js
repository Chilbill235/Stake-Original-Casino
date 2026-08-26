/**
 * SESSION-BASED GAMES ROUTER — Mines, Tower, HiLo, Blackjack.
 * All state lives server-side in activeSessions; every round is bound to the
 * authenticated owner and resolved server-authoritatively.
 */
'use strict';

const crypto = require('crypto');

const TOWER_CONFIG = {
  EASY:   { tiles: 4, safe: 3 },
  MEDIUM: { tiles: 3, safe: 2 },
  HARD:   { tiles: 2, safe: 1 }
};

const CARD_SUITS = ['♠', '♥', '♦', '♣'];
const CARD_VALUES = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const HILO_LABELS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

function round2(n) {
  return Math.round(n * 100) / 100;
}

function createShuffledDeck(floats) {
  const deck = [];
  for (const suit of CARD_SUITS) {
    for (const value of CARD_VALUES) {
      let score = parseInt(value, 10);
      if (['J', 'Q', 'K'].includes(value)) score = 10;
      if (value === 'A') score = 11;
      deck.push({ suit, value, score });
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(floats[51 - i] * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function handScore(hand) {
  let score = 0;
  let aces = 0;
  for (const card of hand) {
    score += card.score;
    if (card.value === 'A') aces++;
  }
  while (score > 21 && aces > 0) {
    score -= 10;
    aces--;
  }
  return score;
}

function isNatural(hand) {
  return hand.length === 2 && handScore(hand) === 21;
}

/**
 * register(app, deps) mounts every session-game route.
 * deps = { HOUSE_EDGE, ProvablyFair, getUserSeedPair, activeSessions,
 *          logTransaction, broadcastLiveBet, debitBet, creditWin,
 *          balancesOf, validateWager }
 */
const depsUsers = (deps, userId) => deps.users.get(userId);

function register(app, deps) {
  const {
    HOUSE_EDGE, ProvablyFair, getUserSeedPair, activeSessions,
    logTransaction, broadcastLiveBet, debitBet, creditWin, balancesOf, validateWager
  } = deps;

  const post = (path, handler) => app.post(path, deps.verifyToken, handler);

  const nextFloats = (userId, count) => {
    const seedPair = getUserSeedPair(userId);
    const floats = ProvablyFair.getFloats(seedPair.serverSeed, seedPair.clientSeed, seedPair.nonce++, count);
    return floats;
  };

  // ------------------------------------------------------------------
  // MINES
  // ------------------------------------------------------------------
  post('/api/play/mines/start', (req, res) => {
    const wager = validateWager(req, res);
    if (!wager) return;
    const { user, currency, amount } = wager;

    const rawMines = Number(req.body.mineCount);
    if (!Number.isInteger(rawMines) || rawMines < 1 || rawMines > 24) {
      return res.status(400).json({ error: 'Mine count must be an integer between 1 and 24.' });
    }

    debitBet(user, currency, amount);

    const mineCount = rawMines;
    const tiles = Array.from({ length: 25 }, (_, i) => i);
    const floats = nextFloats(user.id, 25);
    for (let i = 24; i > 0; i--) {
      const j = Math.floor(floats[24 - i] * (i + 1));
      [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
    }

    const board = Array(25).fill('GEM');
    for (let b = 0; b < mineCount; b++) board[tiles[b]] = 'BOMB';

    const gameId = `mines_${crypto.randomUUID()}`;
    activeSessions.set(gameId, {
      game: 'mines', userId: user.id, currency, betAmount: amount,
      board, revealed: [], mineCount, active: true
    });

    logTransaction(user.id, 'BET', `Placed bet on Mines (${mineCount} mines)`,
      currency === 'GC' ? -amount : 0, currency === 'SC' ? -amount : 0);

    res.json({ gameId, mineCount, balances: balancesOf(user), status: 'ACTIVE' });
  });

  function minesMultiplier(revealedCount, mineCount) {
    let mult = 1;
    for (let i = 0; i < revealedCount; i++) {
      mult *= (25 - i) / (25 - mineCount - i);
    }
    return round2(mult * (1 - HOUSE_EDGE));
  }

  post('/api/play/mines/reveal', (req, res) => {
    const { gameId, tileIndex } = req.body || {};
    const session = activeSessions.get(gameId);
    if (!session || !session.active) return res.status(400).json({ error: 'No active Mines round found.' });
    if (session.userId !== req.user.id) return res.status(403).json({ error: 'This game session belongs to another player.' });

    const tile = Number(tileIndex);
    if (!Number.isInteger(tile) || tile < 0 || tile > 24) {
      return res.status(400).json({ error: 'Invalid tile index.' });
    }
    if (session.revealed.includes(tile)) return res.status(400).json({ error: 'Tile already revealed.' });

    if (session.board[tile] === 'BOMB') {
      session.active = false;
      const user = depsUsers(deps, session.userId);
      broadcastLiveBet({
        username: user ? user.username : 'Anonymous', game: 'MINES',
        betAmount: session.betAmount, currency: session.currency,
        multiplier: 0, win: false, payout: 0
      });
      return res.json({ win: false, hitBomb: true, board: session.board, multiplier: 0, payout: 0, balances: balancesOf(user) });
    }

    session.revealed.push(tile);
    const safeTiles = 25 - session.mineCount;

    // Board cleared — auto-cashout
    if (session.revealed.length >= safeTiles) {
      return finishMinesRound(session, res, tile);
    }

    res.json({
      win: true, hitBomb: false, tileIndex: tile,
      multiplier: minesMultiplier(session.revealed.length, session.mineCount),
      gemsFound: session.revealed.length
    });
  });

  function finishMinesRound(session, res, lastTile) {
    const user = depsUsers(deps, session.userId);
    const mult = minesMultiplier(session.revealed.length, session.mineCount);
    const payout = round2(mult * session.betAmount);
    creditWin(user, session.currency, payout);
    session.active = false;

    logTransaction(user.id, 'WIN', `Mines win @ ${mult.toFixed(2)}x (${session.revealed.length} gems)`,
      session.currency === 'GC' ? payout : 0, session.currency === 'SC' ? payout : 0);
    broadcastLiveBet({
      username: user.username, game: 'MINES', betAmount: session.betAmount,
      currency: session.currency, multiplier: mult, win: true, payout
    });

    res.json({
      win: true, hitBomb: false, cashedOut: true, autoCashout: true,
      tileIndex: lastTile !== undefined ? lastTile : null,
      board: session.board, multiplier: mult, payout, balances: balancesOf(user)
    });
  }

  post('/api/play/mines/cashout', (req, res) => {
    const { gameId } = req.body || {};
    const session = activeSessions.get(gameId);
    if (!session || !session.active) return res.status(400).json({ error: 'No active Mines round found.' });
    if (session.userId !== req.user.id) return res.status(403).json({ error: 'This game session belongs to another player.' });
    if (session.revealed.length === 0) return res.status(400).json({ error: 'Reveal at least one gem before cashing out.' });

    finishMinesRound(session, res);
  });

  // ------------------------------------------------------------------
  // TOWER
  // ------------------------------------------------------------------
  const TOWER_FLOORS = 8;

  post('/api/play/tower/start', (req, res) => {
    const wager = validateWager(req, res);
    if (!wager) return;
    const { user, currency, amount } = wager;

    const difficulty = TOWER_CONFIG[req.body.difficulty] ? req.body.difficulty : 'MEDIUM';
    const cfg = TOWER_CONFIG[difficulty];

    debitBet(user, currency, amount);

    const floats = nextFloats(user.id, TOWER_FLOORS * cfg.tiles);
    const floors = []; // each floor: array of booleans; true = safe tile
    for (let f = 0; f < TOWER_FLOORS; f++) {
      const row = Array(cfg.tiles).fill(false);
      for (let s = 0; s < cfg.safe; s++) {
        let pos;
        do {
          pos = Math.floor(floats[f * cfg.tiles + s] * cfg.tiles);
        } while (row[pos]);
        row[pos] = true;
      }
      floors.push(row);
    }

    // Fair per-step multiplier: payout odds of surviving one floor
    const stepMult = round2((cfg.tiles / cfg.safe) * (1 - HOUSE_EDGE) * 100) / 100;

    const gameId = `tower_${crypto.randomUUID()}`;
    activeSessions.set(gameId, {
      game: 'tower', userId: user.id, currency, betAmount: amount,
      difficulty, cfg, floors, currentFloor: 0, multiplier: 1, stepMult,
      active: true
    });

    logTransaction(user.id, 'BET', `Placed bet on Tower (${difficulty})`,
      currency === 'GC' ? -amount : 0, currency === 'SC' ? -amount : 0);

    res.json({
      gameId, difficulty, tilesPerFloor: cfg.tiles,
      balances: balancesOf(user), status: 'ACTIVE'
    });
  });

  function towerStepMultiplier(floor, stepMult) {
    return round2(Math.pow(stepMult, floor) * 100) / 100;
  }

  post('/api/play/tower/pick', (req, res) => {
    const { gameId, tile } = req.body || {};
    const session = activeSessions.get(gameId);
    if (!session || !session.active || session.game !== 'tower') return res.status(400).json({ error: 'No active Tower round found.' });
    if (session.userId !== req.user.id) return res.status(403).json({ error: 'This game session belongs to another player.' });

    const t = Number(tile);
    if (!Number.isInteger(t) || t < 0 || t >= session.cfg.tiles) {
      return res.status(400).json({ error: 'Invalid tile selection.' });
    }

    const isSafe = session.floors[session.currentFloor][t];
    if (!isSafe) {
      session.active = false;
      const user = depsUsers(deps, session.userId);
      broadcastLiveBet({
        username: user.username, game: 'TOWER', betAmount: session.betAmount,
        currency: session.currency, multiplier: 0, win: false, payout: 0
      });
      return res.json({
        win: false, trapTile: t,
        safeTiles: session.floors[session.currentFloor].map((safe, idx) => safe ? idx : null).filter(v => v !== null),
        multiplier: 0, payout: 0
      });
    }

    session.currentFloor += 1;
    session.multiplier = towerStepMultiplier(session.currentFloor, session.stepMult);

    const finished = session.currentFloor >= TOWER_FLOORS;
    if (finished) {
      const user = depsUsers(deps, session.userId);
      const payout = round2(session.multiplier * session.betAmount);
      creditWin(user, session.currency, payout);
      session.active = false;
      logTransaction(user.id, 'WIN', `Tower completed @ ${session.multiplier.toFixed(2)}x`,
        session.currency === 'GC' ? payout : 0, session.currency === 'SC' ? payout : 0);
      broadcastLiveBet({
        username: user.username, game: 'TOWER', betAmount: session.betAmount,
        currency: session.currency, multiplier: session.multiplier, win: true, payout
      });
      return res.json({
        win: true, cashedOut: true, autoCashout: true, currentFloor: session.currentFloor,
        multiplier: session.multiplier, payout, balances: balancesOf(user)
      });
    }

    res.json({
      win: true, currentFloor: session.currentFloor,
      multiplier: session.multiplier, nextCashout: towerStepMultiplier(session.currentFloor + 1, session.stepMult)
    });
  });

  post('/api/play/tower/cashout', (req, res) => {
    const { gameId } = req.body || {};
    const session = activeSessions.get(gameId);
    if (!session || !session.active || session.game !== 'tower') return res.status(400).json({ error: 'No active Tower round found.' });
    if (session.userId !== req.user.id) return res.status(403).json({ error: 'This game session belongs to another player.' });
    if (session.currentFloor === 0) return res.status(400).json({ error: 'Climb at least one floor before cashing out.' });

    const user = depsUsers(deps, session.userId);
    const mult = session.multiplier;
    const payout = round2(mult * session.betAmount);
    creditWin(user, session.currency, payout);
    session.active = false;

    logTransaction(user.id, 'WIN', `Cashed out Tower @ ${mult.toFixed(2)}x`,
      session.currency === 'GC' ? payout : 0, session.currency === 'SC' ? payout : 0);
    broadcastLiveBet({
      username: user.username, game: 'TOWER', betAmount: session.betAmount,
      currency: session.currency, multiplier: mult, win: true, payout
    });

    res.json({ win: true, cashedOut: true, payout, multiplier: mult, balances: balancesOf(user) });
  });

  // ------------------------------------------------------------------
  // BLACKJACK — interactive hit/stand with dealer AI
  // ------------------------------------------------------------------
  const BJ_PAYOUT = round2(2 * (1 - HOUSE_EDGE));            // standard win
  const BJ_NATURAL = round2(2.5 * (1 - HOUSE_EDGE));         // blackjack pays 3:2 (edge-adjusted)

  post('/api/play/blackjack/start', (req, res) => {
    const wager = validateWager(req, res);
    if (!wager) return;
    const { user, currency, amount } = wager;

    debitBet(user, currency, amount);

    const floats = nextFloats(user.id, 51);
    const deck = createShuffledDeck(floats);
    let cardIdx = 0;

    const playerHand = [deck[cardIdx++], deck[cardIdx++]];
    const dealerHand = [deck[cardIdx++], deck[cardIdx++]];

    const gameId = `bj_${crypto.randomUUID()}`;
    const session = {
      game: 'blackjack', userId: user.id, currency, betAmount: amount,
      deck, cardIdx, playerHand, dealerHand, active: true
    };

    // Natural blackjack resolves immediately
    if (isNatural(playerHand)) {
      session.active = false;
      const playerBJ = true;
      const dealerBJ = isNatural(dealerHand);
      let multiplier;
      let outcome;

      if (dealerBJ) { multiplier = 1.00; outcome = 'PUSH'; }
      else { multiplier = BJ_NATURAL; outcome = 'BLACKJACK'; }

      if (multiplier > 1) creditWin(user, currency, round2(multiplier * amount));

      logTransaction(user.id, multiplier > 1 ? 'WIN' : 'BET',
        `Blackjack ${outcome} @ ${multiplier.toFixed(2)}x`,
        multiplier > 1 ? (currency === 'GC' ? round2(multiplier * amount) : 0) : 0,
        multiplier > 1 ? (currency === 'SC' ? round2(multiplier * amount) : 0) : 0);
      broadcastLiveBet({
        username: user.username, game: 'BLACKJACK', betAmount: amount,
        currency, multiplier, win: outcome === 'BLACKJACK',
        payout: multiplier > 1 ? round2(multiplier * amount) : (outcome === 'PUSH' ? amount : 0)
      });

      return res.json({
        resolved: true, outcome,
        multiplier,
        payout: multiplier > 1 ? round2(multiplier * amount) : (outcome === 'PUSH' ? amount : 0),
        playerHand, dealerHand,
        playerScore: handScore(playerHand), dealerScore: handScore(dealerHand),
        balances: balancesOf(user)
      });
    }

    activeSessions.set(gameId, session);

    res.json({
      resolved: false, gameId,
      playerHand, dealerUpCard: dealerHand[0],
      playerScore: handScore(playerHand),
      status: 'ACTIVE'
    });
  });

  function finishBlackjack(session, res, outcome, multiplier) {
    const user = depsUsers(deps, session.userId);
    const payout = round2(multiplier * session.betAmount);

    if (multiplier > 0) creditWin(user, session.currency, payout);
    session.active = false;

    logTransaction(user.id, multiplier > 1 ? 'WIN' : (multiplier === 1 ? 'BET' : 'BET'),
      `Blackjack ${outcome} @ ${multiplier.toFixed(2)}x`,
      multiplier !== 1 ? (session.currency === 'GC' ? payout : 0) : 0,
      multiplier !== 1 ? (session.currency === 'SC' ? payout : 0) : 0);
    broadcastLiveBet({
      username: user.username, game: 'BLACKJACK', betAmount: session.betAmount,
      currency: session.currency, multiplier,
      win: multiplier > 1,
      payout: multiplier === 1 ? session.betAmount : payout
    });

    res.json({
      resolved: true, outcome, multiplier, payout,
      playerHand: session.playerHand, dealerHand: session.dealerHand,
      playerScore: handScore(session.playerHand), dealerScore: handScore(session.dealerHand),
      balances: balancesOf(user)
    });
  }

  post('/api/play/blackjack/hit', (req, res) => {
    const { gameId } = req.body || {};
    const session = activeSessions.get(gameId);
    if (!session || !session.active || session.game !== 'blackjack') return res.status(400).json({ error: 'No active Blackjack hand found.' });
    if (session.userId !== req.user.id) return res.status(403).json({ error: 'This hand belongs to another player.' });

    session.playerHand.push(session.deck[session.cardIdx++]);
    const score = handScore(session.playerHand);

    if (score > 21) return finishBlackjack(session, res, 'BUST', 0);
    if (score === 21) {
      // Auto-stand on 21
      while (handScore(session.dealerHand) < 17) {
        session.dealerHand.push(session.deck[session.cardIdx++]);
      }
      const dealerScore = handScore(session.dealerHand);
      if (dealerScore > 21 || score > dealerScore) return finishBlackjack(session, res, 'WIN', BJ_PAYOUT);
      return finishBlackjack(session, res, 'PUSH', 1.00);
    }

    res.json({
      resolved: false, playerHand: session.playerHand,
      dealerUpCard: session.dealerHand[0], playerScore: score, status: 'ACTIVE'
    });
  });

  post('/api/play/blackjack/stand', (req, res) => {
    const { gameId } = req.body || {};
    const session = activeSessions.get(gameId);
    if (!session || !session.active || session.game !== 'blackjack') return res.status(400).json({ error: 'No active Blackjack hand found.' });
    if (session.userId !== req.user.id) return res.status(403).json({ error: 'This hand belongs to another player.' });

    while (handScore(session.dealerHand) < 17) {
      session.dealerHand.push(session.deck[session.cardIdx++]);
    }
    const pScore = handScore(session.playerHand);
    const dScore = handScore(session.dealerHand);

    if (dScore > 21 || pScore > dScore) return finishBlackjack(session, res, 'WIN', BJ_PAYOUT);
    if (pScore === dScore) return finishBlackjack(session, res, 'PUSH', 1.00);
    return finishBlackjack(session, res, 'DEALER_WINS', 0);
  });

  // ------------------------------------------------------------------
  // HILO — interactive higher/lower card climb with cashout
  // ------------------------------------------------------------------
  post('/api/play/hilo/start', (req, res) => {
    const wager = validateWager(req, res);
    if (!wager) return;
    const { user, currency, amount } = wager;

    debitBet(user, currency, amount);

    // Base card is drawn from the middle of the rank range for fairness
    let floats = nextFloats(user.id, 2);
    let currentRank = 1 + Math.floor(floats[0] * 13);
    if (currentRank < 4 || currentRank > 10) currentRank = Math.min(10, Math.max(4, currentRank));

    const gameId = `hilo_${crypto.randomUUID()}`;
    activeSessions.set(gameId, {
      game: 'hilo', userId: user.id, currency, betAmount: amount,
      currentRank, multiplier: 1.00, active: true
    });

    logTransaction(user.id, 'BET', 'Placed bet on HiLo',
      currency === 'GC' ? -amount : 0, currency === 'SC' ? -amount : 0);

    res.json({
      gameId,
      currentCard: { label: HILO_LABELS[currentRank - 1], rank: currentRank },
      multiplier: 1.00,
      balances: balancesOf(user), status: 'ACTIVE'
    });
  });

  function hiloOdds(rank, guess) {
    if (guess === 'HIGHER') {
      const good = 13 - rank;              // cards strictly above
      return { good, prob: good / 13 };
    }
    const good = rank - 1;                 // cards strictly below
    return { good, prob: good / 13 };
  }

  post('/api/play/hilo/guess', (req, res) => {
    const { gameId, guess } = req.body || {};
    const session = activeSessions.get(gameId);
    if (!session || !session.active || session.game !== 'hilo') return res.status(400).json({ error: 'No active HiLo round found.' });
    if (session.userId !== req.user.id) return res.status(403).json({ error: 'This game session belongs to another player.' });
    if (guess !== 'HIGHER' && guess !== 'LOWER') return res.status(400).json({ error: "Guess must be 'HIGHER' or 'LOWER'." });

    const odds = hiloOdds(session.currentRank, guess);
    if (odds.good <= 0) {
      return res.status(400).json({ error: 'No winning cards possible for this guess — pick the other side or cash out.' });
    }

    const floats = nextFloats(session.userId, 2);
    const nextRank = 1 + Math.floor(floats[0] * 13);
    const suit = CARD_SUITS[Math.floor(floats[1] * 4)];
    const nextCard = { label: HILO_LABELS[nextRank - 1], rank: nextRank, suit };

    const win = guess === 'HIGHER' ? nextRank > session.currentRank : nextRank < session.currentRank;

    if (!win) {
      session.active = false;
      const user = depsUsers(deps, session.userId);
      broadcastLiveBet({
        username: user.username, game: 'HILO', betAmount: session.betAmount,
        currency: session.currency, multiplier: 0, win: false, payout: 0
      });
      return res.json({
        win: false, nextCard, currentCard: { label: HILO_LABELS[session.currentRank - 1], rank: session.currentRank },
        multiplier: 0, payout: 0
      });
    }

    session.multiplier = round2((session.multiplier * (13 / odds.good)) * (1 - HOUSE_EDGE) * 100) / 100;
    session.currentRank = nextRank;

    // Board boundary reached — no further guesses in this direction.
    const upGood = hiloOdds(nextRank, 'HIGHER').good;
    const downGood = hiloOdds(nextRank, 'LOWER').good;
    const canContinue = nextRank > 1 && nextRank < 13 && (upGood > 0 || downGood > 0);

    if (!canContinue) {
      const user = depsUsers(deps, session.userId);
      const payout = round2(session.multiplier * session.betAmount);
      creditWin(user, session.currency, payout);
      session.active = false;
      logTransaction(user.id, 'WIN', `HiLo auto-cashout @ ${session.multiplier.toFixed(2)}x`,
        session.currency === 'GC' ? payout : 0, session.currency === 'SC' ? payout : 0);
      broadcastLiveBet({
        username: user.username, game: 'HILO', betAmount: session.betAmount,
        currency: session.currency, multiplier: session.multiplier, win: true, payout
      });
      return res.json({
        win: true, nextCard, multiplier: session.multiplier, payout,
        cashedOut: true, autoCashout: true,
        currentCard: { label: HILO_LABELS[nextRank - 1], rank: nextRank },
        balances: balancesOf(user)
      });
    }

    res.json({
      win: true, nextCard,
      currentCard: { label: HILO_LABELS[nextRank - 1], rank: nextRank },
      multiplier: session.multiplier
    });
  });

  post('/api/play/hilo/cashout', (req, res) => {
    const { gameId } = req.body || {};
    const session = activeSessions.get(gameId);
    if (!session || !session.active || session.game !== 'hilo') return res.status(400).json({ error: 'No active HiLo round found.' });
    if (session.userId !== req.user.id) return res.status(403).json({ error: 'This game session belongs to another player.' });
    if (!(session.multiplier > 1)) return res.status(400).json({ error: 'Win at least one correct guess before cashing out.' });

    const user = depsUsers(deps, session.userId);
    const mult = session.multiplier;
    const payout = round2(mult * session.betAmount);
    creditWin(user, session.currency, payout);
    session.active = false;

    logTransaction(user.id, 'WIN', `Cashed out HiLo @ ${mult.toFixed(2)}x`,
      session.currency === 'GC' ? payout : 0, session.currency === 'SC' ? payout : 0);
    broadcastLiveBet({
      username: user.username, game: 'HILO', betAmount: session.betAmount,
      currency: session.currency, multiplier: mult, win: true, payout
    });

    res.json({ win: true, cashedOut: true, payout, multiplier: mult, balances: balancesOf(user) });
  });
}

module.exports = { register };
