const crypto = require('crypto');

/**
 * Stateful byte generator consuming 32-byte HMAC chunks to generate float streams efficiently.
 */
class ByteStream {
  constructor(serverSeed, clientSeed, nonce) {
    this.serverSeed = serverSeed;
    this.clientSeed = clientSeed;
    this.nonce = nonce;
    this.round = 0;
    this.buffer = Buffer.alloc(0);
    this.offset = 0;
  }

  /**
   * Reads next 4 bytes to output a uniform float [0, 1)
   */
  nextFloat() {
    if (this.offset + 4 > this.buffer.length) {
      const hmac = crypto.createHmac('sha256', this.serverSeed);
      hmac.update(`${this.clientSeed}:${this.nonce}:${this.round++}`);
      this.buffer = hmac.digest();
      this.offset = 0;
    }

    const value = this.buffer.readUInt32BE(this.offset);
    this.offset += 4;
    return value / 4294967296;
  }
}

class ProvablyFair {
  /**
   * Generates a cryptographically secure 256-bit server seed hex string
   */
  static generateServerSeed() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Hashes the unrevealed server seed with SHA-256 for public pre-bet commit
   */
  static hashSeed(seed) {
    return crypto.createHash('sha256').update(seed).digest('hex');
  }

  /**
   * Verifies that a disclosed server seed matches a previously given public hash
   */
  static verifySeed(serverSeed, expectedHash) {
    return this.hashSeed(serverSeed) === expectedHash;
  }

  /**
   * Generates a floating-point number between [0, 1) using HMAC-SHA256
   */
  static generateFloat(serverSeed, clientSeed, nonce, cursor = 0) {
    const stream = new ByteStream(serverSeed, clientSeed, nonce);
    stream.round = cursor;
    return stream.nextFloat();
  }

  /**
   * Generates an integer in range [min, max] inclusive without rejection bias
   */
  static generateInt(serverSeed, clientSeed, nonce, min, max, cursor = 0) {
    const float = this.generateFloat(serverSeed, clientSeed, nonce, cursor);
    return Math.floor(float * (max - min + 1)) + min;
  }

  /**
   * DICE ENGINE (0.00 - 99.99)
   * Prevents standard .toFixed() rounding bugs that cause out-of-bounds 100.00 rolls
   */
  static playDice(serverSeed, clientSeed, nonce, target, condition = 'OVER', houseEdge = 1.0) {
    const float = this.generateFloat(serverSeed, clientSeed, nonce);
    // Truncate to exactly 2 decimal places to guarantee uniform [0.00, 99.99] range
    const roll = Math.floor(float * 10000) / 100;

    const win = condition === 'OVER' ? roll > target : roll < target;
    const winProbability = condition === 'OVER' ? (100 - target) / 100 : target / 100;

    const payoutMultiplier = win ? Math.floor(((1 - houseEdge / 100) / winProbability) * 10000) / 10000 : 0;

    return { roll, win, multiplier: payoutMultiplier };
  }

  /**
   * LIMBO / CRASH ENGINE
   * Implements standard Bustabit/Stake distribution curve: P(X >= x) = RTP / x
   */
  static playLimbo(serverSeed, clientSeed, nonce, targetMultiplier, houseEdge = 1.0) {
    const float = this.generateFloat(serverSeed, clientSeed, nonce);
    const rtp = 100 - houseEdge;

    // Standard Limbo multiplier formula: (100 - HouseEdge) / (100 * (1 - float))
    const rawResult = rtp / (100 * (1 - float));
    const resultMultiplier = Math.max(1.00, Math.floor(rawResult * 100) / 100);

    const win = resultMultiplier >= targetMultiplier;
    const payoutMultiplier = win ? targetMultiplier : 0;

    return { resultMultiplier, win, multiplier: payoutMultiplier };
  }

  /**
   * PROVABLY FAIR CARD DECK SHUFFLE
   * Optimized Fisher-Yates powered by a continuous byte stream (supports multi-deck shoes)
   */
  static shuffleDeck(serverSeed, clientSeed, nonce, deckCount = 1) {
    const suits = ['♠', '♥', '♦', '♣'];
    const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    const deck = [];

    for (let d = 0; d < deckCount; d++) {
      for (let suit of suits) {
        for (let value of values) {
          let score = parseInt(value);
          if (['J', 'Q', 'K'].includes(value)) score = 10;
          if (value === 'A') score = 11;
          deck.push({ suit, value, score });
        }
      }
    }

    const stream = new ByteStream(serverSeed, clientSeed, nonce);

    for (let i = deck.length - 1; i > 0; i--) {
      const float = stream.nextFloat();
      const j = Math.floor(float * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }

    return deck;
  }
}

module.exports = ProvablyFair;