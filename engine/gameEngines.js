const ProvablyFair = require('./provablyFair');

const SYMBOLS = ['🎰', '💎', '👑', '🔥', '⭐', '🍋', '🍒', '7️⃣'];

const GAMES = {
  // 1. Slots Engine (3 Reels)
  slots: (serverSeed, clientSeed, nonce, betAmount) => {
    const r1 = SYMBOLS[Math.floor(ProvablyFair.generateFloat(serverSeed, clientSeed, nonce, 1) * SYMBOLS.length)];
    const r2 = SYMBOLS[Math.floor(ProvablyFair.generateFloat(serverSeed, clientSeed, nonce, 2) * SYMBOLS.length)];
    const r3 = SYMBOLS[Math.floor(ProvablyFair.generateFloat(serverSeed, clientSeed, nonce, 3) * SYMBOLS.length)];

    const grid = [['⭐', '🍋', '🍒'], [r1, r2, r3], ['🔥', '👑', '💎']];
    let multiplier = 0;

    if (r1 === r2 && r2 === r3) {
      multiplier = r1 === '7️⃣' ? 50 : 15;
    } else if (r1 === r2 || r2 === r3 || r1 === r3) {
      multiplier = 1.5;
    }

    return {
      result: [r1, r2, r3],
      details: { grid },
      multiplier,
      win: multiplier > 0
    };
  },

  // 2. Dice Engine (0.00 - 99.99 Target)
  dice: (serverSeed, clientSeed, nonce, betAmount, params = {}) => {
    const houseEdge = 1.0; // 1% House Edge
    return ProvablyFair.playDice(serverSeed, clientSeed, nonce, params.target || 50, params.condition || 'OVER', houseEdge);
  },

  // 3. Limbo Engine
  limbo: (serverSeed, clientSeed, nonce, betAmount, params = {}) => {
    const houseEdge = 1.0; // 1% House Edge
    const targetMultiplier = params.targetMultiplier || 2.0;
    return ProvablyFair.playLimbo(serverSeed, clientSeed, nonce, targetMultiplier, houseEdge);
  },

  // 4. Plinko Engine (Dynamic Rows 8-16)
  plinko: (serverSeed, clientSeed, nonce, betAmount, params = {}) => {
    const rows = Math.min(16, Math.max(8, params.rows || 10));
    let path = [];
    let rightTurns = 0;

    for (let i = 0; i < rows; i++) {
      const turn = ProvablyFair.generateFloat(serverSeed, clientSeed, nonce, i) > 0.5 ? 1 : 0;
      path.push(turn);
      rightTurns += turn;
    }

    // Paytable mapped for 10-row baseline
    const multipliersByBucket = [13, 3, 1.3, 0.7, 0.4, 0.4, 0.7, 1.3, 3, 13];
    const bucketIndex = Math.floor((rightTurns / rows) * (multipliersByBucket.length - 1));
    const multiplier = multipliersByBucket[bucketIndex];

    return { result: path, bucket: rightTurns, multiplier, win: multiplier > 1 };
  },

  // 5. Keno Engine (Draws 5 winning tiles from 1-40)
  keno: (serverSeed, clientSeed, nonce, betAmount, params = {}) => {
    const playerPicks = params.selectedNumbers || params.picks || [1, 5, 10, 15, 20];
    const drawn = [];
    let cursor = 0;

    while (drawn.length < 5) {
      const num = ProvablyFair.generateInt(serverSeed, clientSeed, nonce, 1, 40, cursor);
      if (!drawn.includes(num)) drawn.push(num);
      cursor++;
    }

    const matches = playerPicks.filter(val => drawn.includes(val)).length;
    const kenoPaytable = [0, 0, 1.5, 4.5, 12, 45]; // Weighted 1% edge
    const multiplier = kenoPaytable[matches] || 0;

    return { result: drawn, matches, multiplier, win: multiplier > 0 };
  },

  // 6. Wheel Engine (Weighted Segments)
  wheel: (serverSeed, clientSeed, nonce, betAmount) => {
    const float = ProvablyFair.generateFloat(serverSeed, clientSeed, nonce);

    // Probability Weighted Distribution
    let landed = { color: 'BLACK', mult: 0 };
    if (float < 0.40) landed = { color: 'GREY', mult: 1.2 };
    else if (float < 0.70) landed = { color: 'BLUE', mult: 1.8 };
    else if (float < 0.90) landed = { color: 'GREEN', mult: 3.0 };
    else if (float < 0.99) landed = { color: 'PURPLE', mult: 5.0 };
    else landed = { color: 'GOLD', mult: 20.0 };

    return { result: landed.color, multiplier: landed.mult, win: landed.mult > 0 };
  },

  // 7. Hilo Engine
  hilo: (serverSeed, clientSeed, nonce, betAmount, params = {}) => {
    const currentCard = params.currentCard || 7;
    const nextCard = ProvablyFair.generateInt(serverSeed, clientSeed, nonce, 1, 13);

    let win = false;
    if (params.guess === 'HIGHER' && nextCard >= currentCard) win = true;
    if (params.guess === 'LOWER' && nextCard <= currentCard) win = true;

    // Adjusted for slight 1% house edge scaling
    const multiplier = win ? 1.96 : 0;
    return { result: nextCard, currentCard, guess: params.guess, multiplier, win };
  },

  // 8. Tower Engine (Ascend Levels)
  tower: (serverSeed, clientSeed, nonce, betAmount, params = {}) => {
    const chosenTile = params.tile || 0; // 0, 1, or 2
    const deathTile = ProvablyFair.generateInt(serverSeed, clientSeed, nonce, 0, 2);
    const win = chosenTile !== deathTile;

    return { result: { chosenTile, deathTile }, multiplier: win ? 1.47 : 0, win };
  },

  // 9. Blackjack Single Hand Engine
  blackjack: (serverSeed, clientSeed, nonce, betAmount) => {
    const shuffledDeck = ProvablyFair.shuffleDeck(serverSeed, clientSeed, nonce);

    const playerHand = [shuffledDeck[0], shuffledDeck[2]];
    const dealerHand = [shuffledDeck[1], shuffledDeck[3]];

    const calcScore = (hand) => {
      let score = 0, aces = 0;
      hand.forEach(c => {
        score += c.score;
        if (c.value === 'A') aces++;
      });
      while (score > 21 && aces > 0) { score -= 10; aces--; }
      return score;
    };

    const playerTotal = calcScore(playerHand);
    const dealerTotal = calcScore(dealerHand);

    let win = false;
    let multiplier = 0;

    if (playerTotal <= 21 && (playerTotal > dealerTotal || dealerTotal > 21)) {
      win = true;
      multiplier = playerTotal === 21 && playerHand.length === 2 ? 2.5 : 1.98;
    } else if (playerTotal === dealerTotal) {
      multiplier = 1.0; // Push
    }

    return {
      result: { playerTotal, dealerTotal },
      details: { playerHand, dealerHand, dealerScore: dealerTotal, playerScore: playerTotal },
      multiplier,
      win
    };
  },

  // 10. Mines Instant Bet Evaluator
  mines: (serverSeed, clientSeed, nonce, betAmount, params = {}) => {
    const mineCount = Math.min(24, Math.max(1, params.mineCount || 3));
    const float = ProvablyFair.generateFloat(serverSeed, clientSeed, nonce);

    const hitBomb = float < (mineCount / 25);
    const safeTilesCount = 25 - mineCount;
    const multiplier = hitBomb ? 0 : Number((0.99 * (25 / safeTilesCount)).toFixed(2));

    return { result: { hitBomb }, multiplier, win: !hitBomb };
  }
};

module.exports = { GAMES };