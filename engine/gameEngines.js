const ProvablyFair = require('./provablyFair');

const SYMBOLS = ['🎰', '💎', '👑', '🔥', '⭐', '🍋', '🍒', '7️⃣'];

// Math helper for combinations nCr
const nCr = (n, r) => {
  if (r < 0 || r > n) return 0;
  if (r === 0 || r === n) return 1;
  let res = 1;
  for (let i = 1; i <= r; i++) res = (res * (n - i + 1)) / i;
  return res;
};

// Pre-calculated Plinko paytables per row count (Target ~99% RTP)
const PLINKO_PAYTABLES = {
  8: [13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13],
  10: [22, 5, 2, 1.4, 0.6, 0.4, 0.6, 1.4, 2, 5, 22],
  12: [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33],
  14: [58, 15, 7, 4, 1.9, 1, 0.5, 0.2, 0.5, 1, 1.9, 4, 7, 15, 58],
  16: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110]
};

const GAMES = {
  /**
   * 1. SLOTS ENGINE (3x3 Grid, 5 Paylines)
   */
  slots: (serverSeed, clientSeed, nonce, betAmount) => {
    const grid = [];
    let cursor = 0;

    for (let row = 0; row < 3; row++) {
      grid[row] = [];
      for (let col = 0; col < 3; col++) {
        const float = ProvablyFair.generateFloat(serverSeed, clientSeed, nonce, cursor++);
        grid[row][col] = SYMBOLS[Math.floor(float * SYMBOLS.length)];
      }
    }

    const paylines = [
      grid[0], // Top row
      grid[1], // Middle row
      grid[2], // Bottom row
      [grid[0][0], grid[1][1], grid[2][2]], // Diagonal 1
      [grid[2][0], grid[1][1], grid[0][2]]  // Diagonal 2
    ];

    let totalMultiplier = 0;
    const winningLines = [];

    paylines.forEach((line, idx) => {
      const [a, b, c] = line;
      if (a === b && b === c) {
        const lineMult = a === '7️⃣' ? 25 : a === '💎' ? 10 : 5;
        totalMultiplier += lineMult;
        winningLines.push({ line: idx, symbols: line, multiplier: lineMult });
      } else if (a === b || b === c || a === c) {
        totalMultiplier += 0.2;
      }
    });

    totalMultiplier = Math.floor(totalMultiplier * 100) / 100;

    return {
      result: grid,
      details: { winningLines },
      multiplier: totalMultiplier,
      win: totalMultiplier > 0
    };
  },

  /**
   * 2. DICE ENGINE (0.00 - 99.99 Target)
   */
  dice: (serverSeed, clientSeed, nonce, betAmount, params = {}) => {
    const houseEdge = 1.0;
    const target = Math.min(98.99, Math.max(0.01, params.target || 50));
    const condition = params.condition === 'UNDER' ? 'UNDER' : 'OVER';

    return ProvablyFair.playDice(serverSeed, clientSeed, nonce, target, condition, houseEdge);
  },

  /**
   * 3. LIMBO ENGINE
   */
  limbo: (serverSeed, clientSeed, nonce, betAmount, params = {}) => {
    const houseEdge = 1.0;
    const targetMultiplier = Math.max(1.01, params.targetMultiplier || 2.0);

    return ProvablyFair.playLimbo(serverSeed, clientSeed, nonce, targetMultiplier, houseEdge);
  },

  /**
   * 4. PLINKO ENGINE (Binomial Path Distribution)
   */
  plinko: (serverSeed, clientSeed, nonce, betAmount, params = {}) => {
    const targetRows = params.rows || 10;
    const rows = Math.min(16, Math.max(8, Math.round(targetRows / 2) * 2));
    
    const path = [];
    let rightTurns = 0;

    for (let i = 0; i < rows; i++) {
      const turn = ProvablyFair.generateFloat(serverSeed, clientSeed, nonce, i) >= 0.5 ? 1 : 0;
      path.push(turn);
      rightTurns += turn;
    }

    const paytable = PLINKO_PAYTABLES[rows];
    const multiplier = paytable[rightTurns];

    return {
      result: path,
      bucket: rightTurns,
      rows,
      multiplier,
      win: multiplier > 1.0
    };
  },

  /**
   * 5. KENO ENGINE (10 Draws out of 40)
   */
  keno: (serverSeed, clientSeed, nonce, betAmount, params = {}) => {
    const playerPicks = (params.selectedNumbers || params.picks || [1, 5, 10, 15, 20]).slice(0, 10);
    const pool = Array.from({ length: 40 }, (_, i) => i + 1);
    const drawn = [];

    for (let i = 0; i < 10; i++) {
      const float = ProvablyFair.generateFloat(serverSeed, clientSeed, nonce, i);
      const randIdx = Math.floor(float * pool.length);
      drawn.push(pool.splice(randIdx, 1)[0]);
    }

    const matches = playerPicks.filter(val => drawn.includes(val)).length;
    
    const paytablesByPicksCount = {
      1: [0, 3.8],
      2: [0, 1.7, 5.2],
      3: [0, 1.0, 2.8, 24],
      4: [0, 0.5, 2.0, 8.0, 80],
      5: [0, 0.0, 1.5, 4.5, 12, 45]
    };

    const activePaytable = paytablesByPicksCount[playerPicks.length] || paytablesByPicksCount[5];
    const multiplier = activePaytable[matches] || 0;

    return { result: drawn, playerPicks, matches, multiplier, win: multiplier > 0 };
  },

  /**
   * 6. WHEEL ENGINE (Exact Segment Distribution)
   */
  wheel: (serverSeed, clientSeed, nonce, betAmount) => {
    const float = ProvablyFair.generateFloat(serverSeed, clientSeed, nonce);

    const segments = [
      { color: 'BLACK', mult: 0.0, prob: 0.40 },
      { color: 'GREY', mult: 1.2, prob: 0.30 },
      { color: 'BLUE', mult: 1.8, prob: 0.20 },
      { color: 'GREEN', mult: 3.0, prob: 0.08 },
      { color: 'PURPLE', mult: 5.0, prob: 0.019 },
      { color: 'GOLD', mult: 20.0, prob: 0.001 }
    ];

    let cumulative = 0;
    let landed = segments[0];

    for (const segment of segments) {
      cumulative += segment.prob;
      if (float < cumulative) {
        landed = segment;
        break;
      }
    }

    return { result: landed.color, multiplier: landed.mult, win: landed.mult > 0 };
  },

  /**
   * 7. HILO ENGINE (Dynamic Probability Multiplier)
   */
  hilo: (serverSeed, clientSeed, nonce, betAmount, params = {}) => {
    const currentCard = Math.min(13, Math.max(1, params.currentCard || 7));
    const guess = params.guess === 'LOWER' ? 'LOWER' : 'HIGHER';
    const houseEdge = 0.01;

    const nextCard = ProvablyFair.generateInt(serverSeed, clientSeed, nonce, 1, 13);

    let winningCards = 0;
    let win = false;

    if (guess === 'HIGHER') {
      winningCards = 13 - currentCard;
      win = nextCard > currentCard;
    } else {
      winningCards = currentCard - 1;
      win = nextCard < currentCard;
    }

    if (winningCards === 0) {
      return { error: 'Invalid guess for card boundary', win: false, multiplier: 0 };
    }

    const winProbability = winningCards / 13;
    const rawMultiplier = (1 - houseEdge) / winProbability;
    const multiplier = win ? Math.floor(rawMultiplier * 10000) / 10000 : 0;

    return { result: nextCard, currentCard, guess, multiplier, win };
  },

  /**
   * 8. TOWER ENGINE (Multi-Level Difficulty Configuration)
   */
  tower: (serverSeed, clientSeed, nonce, betAmount, params = {}) => {
    const chosenTile = Math.min(2, Math.max(0, params.tile || 0));
    const deathTile = ProvablyFair.generateInt(serverSeed, clientSeed, nonce, 0, 2);
    const win = chosenTile !== deathTile;
    const multiplier = win ? 1.47 : 0;

    return { result: { chosenTile, deathTile }, multiplier, win };
  },

  /**
   * 9. BLACKJACK INSTANT ENGINE
   */
  blackjack: (serverSeed, clientSeed, nonce) => {
    const deck = ProvablyFair.shuffleDeck(serverSeed, clientSeed, nonce);
    let cardIdx = 0;

    const playerHand = [deck[cardIdx++], deck[cardIdx++]];
    const dealerHand = [deck[cardIdx++], deck[cardIdx++]];

    const calcScore = (hand) => {
      let score = 0, aces = 0;
      hand.forEach(c => {
        score += c.score;
        if (c.value === 'A') aces++;
      });
      while (score > 21 && aces > 0) {
        score -= 10;
        aces--;
      }
      return score;
    };

    let playerTotal = calcScore(playerHand);
    let dealerTotal = calcScore(dealerHand);
    const playerBJ = playerTotal === 21 && playerHand.length === 2;

    if (!playerBJ && playerTotal <= 21) {
      while (dealerTotal < 17) {
        dealerHand.push(deck[cardIdx++]);
        dealerTotal = calcScore(dealerHand);
      }
    }

    const dealerBJ = dealerTotal === 21 && dealerHand.length === 2;
    let win = false;
    let multiplier = 0;

    if (playerBJ) {
      if (dealerBJ) {
        multiplier = 1.0;
      } else {
        win = true;
        multiplier = 2.5;
      }
    } else if (playerTotal <= 21) {
      if (dealerTotal > 21 || playerTotal > dealerTotal) {
        win = true;
        multiplier = 2.0;
      } else if (playerTotal === dealerTotal) {
        multiplier = 1.0;
      }
    }

    return {
      result: { playerTotal, dealerTotal },
      details: { playerHand, dealerHand, playerScore: playerTotal, dealerScore: dealerTotal },
      multiplier,
      win
    };
  },

  /**
   * 10. MINES ENGINE (Combinatorial Multiplier Evaluator)
   */
  mines: (serverSeed, clientSeed, nonce, betAmount, params = {}) => {
    const mineCount = Math.min(24, Math.max(1, params.mineCount || 3));
    const revealedTiles = Array.isArray(params.revealedTiles) 
      ? params.revealedTiles 
      : [params.tile || 0];

    const grid = Array(25).fill(0);
    for (let i = 0; i < mineCount; i++) grid[i] = 1;

    for (let i = 24; i > 0; i--) {
      const float = ProvablyFair.generateFloat(serverSeed, clientSeed, nonce, 24 - i);
      const j = Math.floor(float * (i + 1));
      [grid[i], grid[j]] = [grid[j], grid[i]];
    }

    let hitBomb = false;
    for (const tileIdx of revealedTiles) {
      if (grid[tileIdx] === 1) {
        hitBomb = true;
        break;
      }
    }

    const k = revealedTiles.length;
    const totalComb = nCr(25, k);
    const safeComb = nCr(25 - mineCount, k);
    const winProbability = safeComb / totalComb;

    const houseEdge = 0.01;
    const multiplier = (!hitBomb && winProbability > 0)
      ? Math.floor(((1 - houseEdge) / winProbability) * 100) / 100
      : 0;

    return {
      result: { hitBomb },
      details: {
        revealedCount: k,
        mineLocations: grid.map((v, i) => v === 1 ? i : null).filter(v => v !== null)
      },
      multiplier,
      win: !hitBomb
    };
  },

  /**
   * 11. BACCARAT ENGINE
   */
  baccarat: (serverSeed, clientSeed, nonce, betAmount, params = {}) => {
    const betType = params.betType || 'PLAYER'; // PLAYER, BANKER, TIE
    const deck = ProvablyFair.shuffleDeck(serverSeed, clientSeed, nonce);
    let idx = 0;

    const playerHand = [deck[idx++], deck[idx++]];
    const bankerHand = [deck[idx++], deck[idx++]];

    const handVal = (hand) => {
      let sum = 0;
      hand.forEach(c => sum += (c.score > 9 ? 0 : c.score));
      return sum % 10;
    };

    let pVal = handVal(playerHand);
    let bVal = handVal(bankerHand);

    let natural = false;
    if (pVal >= 8 || bVal >= 8) {
      natural = true;
    } else {
      if (pVal <= 5) {
        playerHand.push(deck[idx++]);
        pVal = handVal(playerHand);
      }
      if (bVal <= 5) {
        bankerHand.push(deck[idx++]);
        bVal = handVal(bankerHand);
      }
    }

    let winner = 'TIE';
    if (pVal > bVal) winner = 'PLAYER';
    else if (bVal > pVal) winner = 'BANKER';

    let win = false;
    let multiplier = 0;

    if (betType === winner) {
      win = true;
      if (winner === 'BANKER') multiplier = 1.95;
      else if (winner === 'PLAYER') multiplier = 2.0;
      else if (winner === 'TIE') multiplier = 9.0;
    } else if (winner === 'TIE' && betType !== 'TIE') {
      multiplier = 1.0;
      win = true;
    }

    return {
      result: { winner, pVal, bVal },
      details: { playerHand, bankerHand, natural },
      multiplier,
      win
    };
  },

  /**
   * 12. ROULETTE ENGINE (European Single Zero)
   */
  roulette: (serverSeed, clientSeed, nonce, betAmount, params = {}) => {
    const pocket = ProvablyFair.generateInt(serverSeed, clientSeed, nonce, 0, 36);
    const betType = params.betType || 'RED';
    const targetNumber = params.number !== undefined ? params.number : 17;

    const redNumbers = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
    let isRed = redNumbers.includes(pocket);
    let isGreen = pocket === 0;

    let win = false;
    let multiplier = 0;

    if (betType === 'RED') {
      win = isRed;
      multiplier = win ? 2.0 : 0;
    } else if (betType === 'BLACK') {
      win = !isRed && !isGreen;
      multiplier = win ? 2.0 : 0;
    } else if (betType === 'EVEN') {
      win = !isGreen && pocket % 2 === 0;
      multiplier = win ? 2.0 : 0;
    } else if (betType === 'ODD') {
      win = !isGreen && pocket % 2 !== 0;
      multiplier = win ? 2.0 : 0;
    } else if (betType === 'NUMBER') {
      win = pocket === targetNumber;
      multiplier = win ? 36.0 : 0;
    }

    return {
      result: { pocket, color: isGreen ? 'GREEN' : (isRed ? 'RED' : 'BLACK') },
      multiplier,
      win
    };
  },

  /**
   * 13. CRAPS ENGINE
   */
  craps: (serverSeed, clientSeed, nonce, betAmount, params = {}) => {
    const die1 = ProvablyFair.generateInt(serverSeed, clientSeed, nonce, 1, 6);
    const die2 = ProvablyFair.generateInt(serverSeed, clientSeed, nonce, 2, 6);
    const roll = die1 + die2;
    const betType = params.betType || 'PASS';

    let win = false;
    let multiplier = 0;

    if (betType === 'PASS') {
      if (roll === 7 || roll === 11) {
        win = true;
        multiplier = 2.0;
      } else if (roll === 2 || roll === 3 || roll === 12) {
        win = false;
        multiplier = 0;
      } else {
        win = roll % 2 === 0;
        multiplier = win ? 2.0 : 0;
      }
    }

    return {
      result: { roll, dice: [die1, die2] },
      multiplier,
      win
    };
  }
};

module.exports = { GAMES };