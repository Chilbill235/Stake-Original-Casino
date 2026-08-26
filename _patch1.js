const fs = require('fs');
const p = 'D:/Casino/server.js';
let s = fs.readFileSync(p, 'utf8');

// ---- 1. Replace MINES + TOWER sections with the session-games router ----
const mStart = s.indexOf('// 10. MINES GAME ENDPOINTS');
if (mStart < 0) throw new Error('mines marker not found');
const barStart = s.lastIndexOf('// -----', mStart);

const gIdx = s.indexOf('// 12. GENERAL GAMES EXECUTION ENDPOINT');
if (gIdx < 0) throw new Error('general games marker not found');
const gBar = s.lastIndexOf('// -----', gIdx);

const routerBlock = [
  '// -----------------------------------------------------------------------------',
  '// 10. SESSION-BASED GAMES (MINES / TOWER / HILO / BLACKJACK)',
  '// -----------------------------------------------------------------------------',
  "require('./engine/sessionGames').register(app, {",
  '  HOUSE_EDGE,',
  '  ProvablyFair,',
  '  users,',
  '  activeSessions,',
  '  getUserSeedPair,',
  '  logTransaction,',
  '  broadcastLiveBet,',
  '  debitBet,',
  '  creditWin,',
  '  balancesOf,',
  '  validateWager,',
  '  verifyToken',
  '});',
  ''
].join('\r\n');

s = s.slice(0, barStart) + routerBlock + s.slice(gBar);
fs.writeFileSync(p, s);
console.log('[1] router swapped in, size now:', s.length);

// ---- 2. Rewrite the general games execution endpoint ----
const routeStart = s.indexOf("app.post('/api/play/:gameId'");
if (routeStart < 0) throw new Error('general route not found');
const sec13 = s.indexOf('// 13. SERVER INITIALIZATION');
if (sec13 < 0) throw new Error('section 13 marker not found');
const sec13Bar = s.lastIndexOf('// -----', sec13);

const generalRoute = [
  "app.post('/api/play/:gameId', verifyToken, enforceJurisdiction, (req, res) => {",
  '  const { gameId } = req.params;',
  '',
  "  if (!GAMES[gameId]) return res.status(404).json({ error: `Game engine '${gameId}' not supported.` });",
  '',
  '  const wager = validateWager(req, res);',
  '  if (!wager) return;',
  '  const { user, currency, amount } = wager;',
  '',
  '  debitBet(user, currency, amount);',
  "  logTransaction(user.id, 'BET', `Wagered on ${gameId.toUpperCase()}`,",
  "    currency === 'GC' ? -amount : 0, currency === 'SC' ? -amount : 0);",
  '',
  '  const seedPair = getUserSeedPair(user.id);',
  '  const floatCount = GAME_FLOAT_COUNTS[gameId] || 20;',
  '  const floats = ProvablyFair.getFloats(seedPair.serverSeed, seedPair.clientSeed, seedPair.nonce++, floatCount);',
  '',
  '  const outcome = GAMES[gameId](floats, req.body.params || {});',
  '  // Any positive multiplier returns value to the player (partial plinko hits, pushes, etc.)',
  '  const payout = Math.round(outcome.multiplier * amount * 100) / 100;',
  '',
  '  if (payout > 0) {',
  '    creditWin(user, currency, payout);',
  "    logTransaction(user.id, outcome.multiplier > 1 ? 'WIN' : 'BET',",
  '      `${gameId.toUpperCase()} resolved @ ${outcome.multiplier}x`,',
  "      currency === 'GC' ? payout : 0, currency === 'SC' ? payout : 0);",
  '  }',
  '',
  '  broadcastLiveBet({',
  '    username: user.username,',
  '    game: gameId.toUpperCase(),',
  '    betAmount: amount,',
  '    currency,',
  '    multiplier: outcome.multiplier,',
  '    win: outcome.multiplier > 1,',
  '    payout',
  '  });',
  '',
  '  res.json({',
  '    ...outcome,',
  '    betAmount: amount,',
  '    payout,',
  '    provablyFair: {',
  '      serverSeedHash: ProvablyFair.hashSeed(seedPair.serverSeed),',
  '      clientSeed: seedPair.clientSeed,',
  '      nonce: seedPair.nonce - 1',
  '    },',
  '    balances: balancesOf(user)',
  '  });',
  '});',
  '',
  '// -----------------------------------------------------------------------------',
  '// 12b. ERROR HANDLING & JSON 404 FALLBACK',
  '// -----------------------------------------------------------------------------',
  '// eslint-disable-next-line no-unused-vars',
  'app.use((err, req, res, next) => {',
  "  if (err && err.type === 'entity.parse.failed') {",
  "    return res.status(400).json({ error: 'Malformed JSON body.' });",
  '  }',
  "  console.error('[SERVER ERROR]', err);",
  "  res.status(500).json({ error: 'Internal server error.' });",
  '});',
  '',
  '// JSON 404 for any unknown API route (never leak an HTML stack page)',
  'app.use((req, res) => {',
  "  if (req.path.startsWith('/api/')) {",
  "    return res.status(404).json({ error: 'Endpoint not found.' });",
  '  }',
  "  res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));",
  '});',
  ''
].join('\r\n');

s = s.slice(0, routeStart) + generalRoute + s.slice(sec13Bar);
fs.writeFileSync(p, s);
console.log('[2] general route rewritten, size now:', s.length);
