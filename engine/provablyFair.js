const crypto = require('crypto');

class ProvablyFair {
  /**
   * Generates a 256-bit cryptographically secure server seed
   */
  static generateServerSeed() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Hashes the server seed with SHA-256 (shown to players before the bet)
   */
  static hashSeed(seed) {
    return crypto.createHash('sha256').update(seed).digest('hex');
  }

  /**
   * Generates a floating-point number between [0, 1) using HMAC-SHA256 with optional cursor support.
   * Uses 4-byte chunking to guarantee unbiased distribution.
   */
  static generateFloat(serverSeed, clientSeed, nonce, cursor = 0) {
    const hmac = crypto.createHmac('sha256', serverSeed);
    hmac.update(`${clientSeed}:${nonce}:${cursor}`);
    const buffer = hmac.digest();

    // Consume 4 bytes for uniform 32-bit integer conversion
    const value = buffer.readUInt32BE(0);
    return value / 4294967296; // 2^32
  }

  /**
   * Generates an integer in the range [min, max] inclusive
   */
  static generateInt(serverSeed, clientSeed, nonce, min, max, cursor = 0) {
    const float = this.generateFloat(serverSeed, clientSeed, nonce, cursor);
    return Math.floor(float * (max - min + 1)) + min;
  }

  /**
   * DICE ENGINE (0.00 - 99.99)
   * @param {number} houseEdge - House edge percentage (e.g., 1.0 for 1% house edge)
   */
  static playDice(serverSeed, clientSeed, nonce, target, condition = 'OVER', houseEdge = 1.0) {
    const float = this.generateFloat(serverSeed, clientSeed, nonce);
    const roll = Number((float * 100).toFixed(2));
    
    const win = condition === 'OVER' ? roll > target : roll < target;
    const winProbability = condition === 'OVER' ? (100 - target) / 100 : target / 100;
    
    // Multiplier = (1 - HouseEdge) / WinProbability
    const multiplier = win ? Number(((1 - houseEdge / 100) / winProbability).toFixed(4)) : 0;

    return { roll, win, multiplier };
  }

  /**
   * LIMBO ENGINE
   * @param {number} houseEdge - House edge percentage (e.g., 1.0 for 1% house edge / 99% RTP)
   */
  static playLimbo(serverSeed, clientSeed, nonce, targetMultiplier, houseEdge = 1.0) {
    const float = this.generateFloat(serverSeed, clientSeed, nonce);
    const rtp = 1 - (houseEdge / 100);
    
    // Formula: (Max Multiplier * RTP) / (Float * Max Multiplier + 1)
    // Scaled for provably fair crash/limbo curves
    const rawResult = (rtp * 100) / (float * 99 + 1);
    const resultMultiplier = Math.max(1.00, Number(rawResult.toFixed(2)));
    
    const win = resultMultiplier >= targetMultiplier;
    const payoutMultiplier = win ? targetMultiplier : 0;

    return { resultMultiplier, win, multiplier: payoutMultiplier };
  }

  /**
   * PROVABLY FAIR CARD DECK SHUFFLE (Blackjack, Baccarat, Poker)
   * Uses Fisher-Yates shuffle with provable floats
   */
  static shuffleDeck(serverSeed, clientSeed, nonce) {
    const suits = ['♠', '♥', '♦', '♣'];
    const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    const deck = [];

    for (let suit of suits) {
      for (let value of values) {
        let score = parseInt(value);
        if (['J', 'Q', 'K'].includes(value)) score = 10;
        if (value === 'A') score = 11;
        deck.push({ suit, value, score });
      }
    }

    // Unbiased Fisher-Yates shuffle powered by HMAC iteration
    for (let i = deck.length - 1; i > 0; i--) {
      const float = this.generateFloat(serverSeed, clientSeed, nonce, i);
      const j = Math.floor(float * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }

    return deck;
  }
}

module.exports = ProvablyFair;