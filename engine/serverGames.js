/**
 * SERVER GAME ENGINES — authoritative math for every casino game.
 * Each engine receives a deterministic float stream derived from
 * HMAC-SHA256(serverSeed, `${clientSeed}:${nonce}`) plus player params,
 * and returns an outcome whose expected value is below the stake.
 */
'use strict';

function round2(n) {
  return Math.round(n * 100) / 100;
}

// How many random floats each game needs per round
const GAME_FLOAT_COUNTS = {
  slots: 9,
  dice: 1,
  limbo: 1,
  crash: 1,
  plinko: 16,
  keno: 10,
  wheel: 1,
  baccarat: 52
};

const PLINKO_PAYTABLES = {
  8:  [13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13],
  10: [22, 5, 2, 1.4, 0.6, 0.4, 0.6, 1.4, 2, 5, 22],
  12: [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33],
  14: [58, 15, 7, 4, 1.9, 1, 0.5, 0.2, 0.5, 1, 1.9, 4, 7, 15, 58],
  16: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110]
};

const KENO_PAYTABLES = {
  1:  [0, 3.8],
  2:  [0, 1.7, 5.2],
  3:  [0, 1, 2.8, 24],
  4:  [0, 0.5, 2, 8, 80],
  5:  [0, 0, 1.5, 4.5, 12, 45],
  6:  [0, 0, 0, 2, 7, 20, 75],
  7:  [0, 0, 0, 1, 4, 12, 40, 100],
  8:  [0, 0, 0, 0.5, 2, 6, 20, 60, 125],
  9:  [0, 0, 0, 0.5, 1, 4, 10, 30, 80, 150],
  10: [0, 0, 0, 0.3, 1, 2, 6, 17, 50, 100, 250]
};

// Weighted 12-segment wheel ring — weights tuned so EV ≈ 0.95x (95% RTP)
const WHEEL_SEGMENTS = [
  { color: 'GRAY',   mult: 0 },
  { color: 'BLUE',   mult: 1.2 },
  { color: 'GREEN',  mult: 1.5 },
  { color: 'BLUE',   mult: 2 },
  { color: 'PURPLE', mult: 3 },
  { color: 'GRAY',   mult: 0 },
  { color: 'GREEN',  mult: 1.2 },
  { color: 'ORANGE', mult: 1.5 },
  { color: 'BLUE',   mult: 2 },
  { color: 'PURPLE', mult: 5 },
  { color: 'GOLD',   mult: 10 },
  { color: 'GOLD',   mult: 50 }
];
const WHEEL_WEIGHTS = [6.7, 2.0, 1.0, 1.5, 0.8, 6.7, 2.0, 1.0, 1.5, 0.5, 0.15, 0.05];

const SLOT_SYMBOLS = ['🍒', '🍋', '🍇', '🔔', '💎', '7️⃣'];
const SLOT_WEIGHTS = [0.40, 0.25, 0.18, 0.10, 0.05, 0.02];
const SLOT_PAYOUTS = { '🍒': 1.5, '🍋': 3, '🍇': 5, '🔔': 10, '💎': 25, '7️⃣': 75 };

const BACCARAT_SUITS = ['♠', '♥', '♦', '♣'];
const CARD_VALUES = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function baccaratCardValue(card) {
  if (card.value === 'A') return 1;
  if (['10', 'J', 'Q', 'K'].includes(card.value)) return 0;
  return parseInt(card.value, 10);
}

function baccaratHandScore(hand) {
  return hand.reduce((sum, c) => sum + baccaratCardValue(c), 0) % 10;
}

const GAMES = {
  /**
   * SLOTS — 3x3 grid, 5 paylines. RTP ≈ 92.9% by design of weights + paytable.
   */
  slots: (floats) => {
    const grid = [];
    for (let r = 0; r < 3; r++) {
      const row = [];
      for (let c = 0; c < 3; c++) {
        const rand = floats[r * 3 + c];
        let acc = 0;
        let sym = SLOT_SYMBOLS[0];
        for (let i = 0; i < SLOT_SYMBOLS.length; i++) {
          acc += SLOT_WEIGHTS[i];
          if (rand < acc) { sym = SLOT_SYMBOLS[i]; break; }
        }
        row.push(sym);
      }
      grid.push(row);
    }

    const paylines = [
      [[0, 0], [0, 1], [0, 2]],
      [[1, 0], [1, 1], [1, 2]],
      [[2, 0], [2, 1], [2, 2]],
      [[0, 0], [1, 1], [2, 2]],
      [[2, 0], [1, 1], [0, 2]]
    ];

    let rawMult = 0;
    const winningLines = [];
    paylines.forEach((line, idx) => {
      const symbols = line.map(([r, c]) => grid[r][c]);
      if (symbols[0] === symbols[1] && symbols[1] === symbols[2]) {
        rawMult += SLOT_PAYOUTS[symbols[0]];
        winningLines.push({ line: idx, symbols, multiplier: SLOT_PAYOUTS[symbols[0]] });
      }
    });

    const multiplier = round2(rawMult);
    return { win: multiplier > 0, multiplier, details: { grid, winningLines } };
  },

  /**
   * DICE — roll of 0.00–99.99, ~1% house edge (multiplier = 99 / winChance).
   */
  dice: (floats, params) => {
    const roll = Math.floor(floats[0] * 10000) / 100;
    let target = Number(params.target);
    if (!Number.isFinite(target)) target = 50;
    target = Math.min(98.99, Math.max(0.01, target));
    const condition = params.condition === 'UNDER' ? 'UNDER' : 'OVER';

    const win = condition === 'OVER' ? roll > target : roll < target;
    const winChance = condition === 'OVER' ? 100 - target : target;
    const multiplier = win ? Math.floor((99 / winChance) * 10000) / 10000 : 0;

    return { win, multiplier, details: { rolled: roll, target, condition, winChance } };
  },

  /**
   * LIMBO — Stake-style distribution P(result >= x) ≈ 99/x (~1% house edge).
   */
  limbo: (floats, params) => {
    let target = Number(params.targetMultiplier);
    if (!Number.isFinite(target)) target = 2;
    target = Math.min(1000000, Math.max(1.01, target));

    const float = Math.min(0.9999999999, Math.max(0, floats[0]));
    const resultMultiplier = Math.max(1.00, Math.floor(99 / (1 - float)) / 100);
    const win = resultMultiplier >= target;

    return { win, multiplier: win ? target : 0, details: { resultMultiplier, target } };
  },

  /**
   * CRASH — Bustabit curve: 1-in-33 instant bust at 1.00x, otherwise ~99% RTP.
   */
  crash: (floats, params) => {
    let target = Number(params.targetMultiplier);
    if (!Number.isFinite(target)) target = 2;
    target = Math.min(1000000, Math.max(1.01, target));

    const e = Math.pow(2, 52);
    const h = Math.min(Math.floor(floats[0] * e), e - 1);

    let crashPoint = 1.00;
    if (h % 33 !== 0) {
      const intCrash = Math.floor((100 * e - h) / (e - h));
      crashPoint = Math.min(100000000, Math.max(1, intCrash / 100));
    }

    const win = crashPoint >= target;
    return { win, multiplier: win ? target : 0, details: { crashPoint, target } };
  },

  /**
   * PLINKO — honors the selected row count (8/10/12/14/16), binomial drop,
   * 99%-RTP paytables.
   */
  plinko: (floats, params) => {
    const allowed = [8, 10, 12, 14, 16];
    const rows = allowed.includes(parseInt(params.rows, 10)) ? parseInt(params.rows, 10) : 16;

    const path = [];
    let bucket = 0;
    for (let i = 0; i < rows; i++) {
      const turn = floats[i] >= 0.5 ? 1 : 0;
      path.push(turn);
      bucket += turn;
    }

    const multiplier = PLINKO_PAYTABLES[rows][bucket];
    return { win: multiplier >= 1, multiplier, details: { path, bucket, rows } };
  },

  /**
   * KENO — 10 draws out of 40; paytable scales with number of picks (1–10).
   */
  keno: (floats, params) => {
    let picks = Array.isArray(params.selectedNumbers) ? params.selectedNumbers : [];
    picks = [...new Set(picks)]
      .filter(n => Number.isInteger(n) && n >= 1 && n <= 40)
      .slice(0, 10)
      .sort((a, b) => a - b);
    if (picks.length === 0) picks = [1, 5, 10, 15, 20];

    const pool = Array.from({ length: 40 }, (_, i) => i + 1);
    const drawn = [];
    for (let i = 0; i < 10; i++) {
      drawn.push(pool.splice(Math.floor(floats[i] * pool.length), 1)[0]);
    }

    const hits = picks.filter(n => drawn.includes(n)).length;
    const paytable = KENO_PAYTABLES[picks.length];
    const multiplier = (paytable && paytable[hits]) || 0;

    return { win: multiplier > 0, multiplier, details: { drawn, picks, hits } };
  },

  /**
   * WHEEL — weighted segment ring, EV ≈ 0.95x per spin (95% RTP).
   */
  wheel: (floats) => {
    const totalWeight = WHEEL_WEIGHTS.reduce((a, b) => a + b, 0);
    let rand = floats[0] * totalWeight;
    let index = WHEEL_SEGMENTS.length - 1;
    for (let i = 0; i < WHEEL_SEGMENTS.length; i++) {
      rand -= WHEEL_WEIGHTS[i];
      if (rand < 0) { index = i; break; }
    }

    const seg = WHEEL_SEGMENTS[index];
    return {
      win: seg.mult > 0,
      multiplier: seg.mult,
      details: { index, color: seg.color, mult: seg.mult, totalSegments: WHEEL_SEGMENTS.length }
    };
  },

  /**
   * BACCARAT — true third-card drawing rules with standard payouts:
   * Banker 1.95x (5% commission), Player 2.0x, Tie 9.0x. Non-tie bets PUSH on tie.
   */
  baccarat: (floats, params) => {
    const betOn = ['PLAYER', 'BANKER', 'TIE'].includes(params.betType) ? params.betType : 'PLAYER';
    const deck = [];
    for (const suit of BACCARAT_SUITS) {
      for (const value of CARD_VALUES) {
        deck.push({ suit, value });
      }
    }
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(floats[i] * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }

    const playerHand = [deck.pop(), deck.pop()];
    const bankerHand = [deck.pop(), deck.pop()];
    let pScore = baccaratHandScore(playerHand);
    let bScore = baccaratHandScore(bankerHand);

    if (pScore < 8 && bScore < 8) {
      let playerThirdVal = null;
      if (pScore <= 5) {
        const p3 = deck.pop();
        playerHand.push(p3);
        playerThirdVal = baccaratCardValue(p3);
        pScore = baccaratHandScore(playerHand);
      }

      if (playerHand.length === 2) {
        if (bScore <= 5) bankerHand.push(deck.pop());
      } else {
        if (bScore <= 2) bankerHand.push(deck.pop());
        else if (bScore === 3 && playerThirdVal !== 8) bankerHand.push(deck.pop());
        else if (bScore === 4 && [2, 3, 4, 5, 6, 7].includes(playerThirdVal)) bankerHand.push(deck.pop());
        else if (bScore === 5 && [4, 5, 6, 7].includes(playerThirdVal)) bankerHand.push(deck.pop());
        else if (bScore === 6 && [6, 7].includes(playerThirdVal)) bankerHand.push(deck.pop());
      }
      bScore = baccaratHandScore(bankerHand);
    }

    let outcome = 'TIE';
    if (pScore > bScore) outcome = 'PLAYER';
    else if (bScore > pScore) outcome = 'BANKER';

    let multiplier = 0;
    let win = false;
    let pushed = false;

    if (betOn === outcome) {
      win = true;
      if (outcome === 'PLAYER') multiplier = 2.0;
      else if (outcome === 'BANKER') multiplier = 1.95;
      else multiplier = 9.0;
    } else if (outcome === 'TIE' && betOn !== 'TIE') {
      pushed = true;
      win = true; // stake returned — not a loss
      multiplier = 1.0;
    }

    return {
      win,
      pushed,
      multiplier,
      details: { playerHand, bankerHand, pScore, bScore, outcome, betOn }
    };
  }
};

module.exports = { GAMES, GAME_FLOAT_COUNTS };
