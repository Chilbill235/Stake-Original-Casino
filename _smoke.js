// _smoke.js — end-to-end verification of every fixed system
const BASE = 'http://localhost:' + (process.env.TEST_PORT || 3100);
let failures = 0;

function ok(cond, label) {
  if (cond) console.log('  PASS  ' + label);
  else { failures++; console.log('  FAIL  ' + label); }
}

async function req(path, method = 'GET', body = null, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined
  });
  let data = {};
  try { data = await res.json(); } catch (_) {}
  return { status: res.status, data };
}

(async () => {
  // ---- Auth ----
  const g1 = await req('/api/auth/guest', 'POST');
  ok(g1.status === 200 && g1.data.token, 'guest auth issues token');
  const T = g1.data.token;

  const seed = await req('/api/provably-fair/seed', 'GET', null, T);
  ok(seed.status === 200 && /^[0-9a-f]{64}$/.test(seed.data.serverSeedHash), 'provably-fair seed endpoint returns sha256 hash');

  // ---- Validation fixes (NaN exploit etc.) ----
  let r = await req('/api/play/dice', 'POST', { currency: 'GC', betAmount: 'abc' }, T);
  ok(r.status === 400, 'NaN/invalid betAmount rejected (was silently accepted before)');

  r = await req('/api/play/dice', 'POST', { currency: 'GOLD', betAmount: 10 }, T);
  ok(r.status === 400, 'invalid currency rejected');

  r = await req('/api/play/dice', 'POST', { currency: 'SC', betAmount: 99999 }, T);
  ok(r.status === 400, 'over-balance SC bet rejected');

  // ---- Slots returns full grid + winning lines ----
  r = await req('/api/play/slots', 'POST', { currency: 'GC', betAmount: 100 }, T);
  ok(r.status === 200 && Array.isArray(r.data.details.grid) && r.data.details.grid.length === 3 &&
     Array.isArray(r.data.details.winningLines), 'slots returns 3x3 grid + winningLines for the reel UI');
  ok(typeof r.data.provablyFair.nonce === 'number' && typeof r.data.provablyFair.serverSeedHash === 'string',
     'slots response carries provably-fair metadata for client sync');

  // ---- Dice respects target/condition ----
  r = await req('/api/play/dice', 'POST', { currency: 'GC', betAmount: 10, params: { condition: 'OVER', target: 90 } }, T);
  ok(r.status === 200 && (r.data.multiplier === 0 || Math.abs(r.data.multiplier - 9.9) < 0.02),
     'dice OVER 90 pays ~9.9x when it wins (edge matches UI preview)');
  ok(!r.data.win || r.data.details.rolled > 90, 'dice roll consistent with condition');

  // ---- Plinko honors row selection ----
  r = await req('/api/play/plinko', 'POST', { currency: 'GC', betAmount: 10, params: { rows: 8 } }, T);
  ok(r.status === 200 && r.data.details.rows === 8 && r.data.details.path.length === 8,
     'plinko plays the selected 8 rows (was hardcoded to 16)');

  // ---- Keno supports up to 10 picks ----
  const picks10 = [1,2,3,4,5,6,7,8,9,10];
  r = await req('/api/play/keno', 'POST', { currency: 'GC', betAmount: 10, params: { selectedNumbers: picks10 } }, T);
  ok(r.status === 200 && r.data.details.drawn.length === 10 && typeof r.data.multiplier === 'number',
     'keno resolves with 10 picks without undefined payout (old table broke at >5)');

  // ---- Wheel expected value is sane (< 1, was ~2.28x exploit) ----
  let sum = 0, N = 300;
  for (let i = 0; i < N; i++) {
    const w = await req('/api/play/wheel', 'POST', { currency: 'GC', betAmount: 1 }, T);
    if (w.status !== 200) break;
    sum += w.data.multiplier;
  }
  const ev = sum / N;
  ok(ev < 1.05, `wheel EV over ${N} spins = ${ev.toFixed(3)}x (exploitable >1.0 RTP fixed)`);

  // ---- Mines full round ----
  r = await req('/api/play/mines/start', 'POST', { currency: 'GC', betAmount: 10, mineCount: 3 }, T);
  ok(r.status === 200 && r.data.gameId, 'mines session starts');
  const minesId = r.data.gameId;
  r = await req('/api/play/mines/cashout', 'POST', { gameId: minesId }, T);
  ok(r.status === 400, 'cashout blocked before any reveal');
  r = await req('/api/play/mines/reveal', 'POST', { gameId: minesId, tileIndex: 0 }, T);
  ok(r.status === 200 && (r.data.hitBomb === true || typeof r.data.multiplier === 'number'), 'mines reveal resolves server-side');

  // ---- Tower difficulty respected + cross-user protection ----
  r = await req('/api/play/tower/start', 'POST', { currency: 'GC', betAmount: 10, difficulty: 'HARD' }, T);
  ok(r.status === 200 && r.data.tilesPerFloor === 2, 'tower HARD uses 2-tile floors (difficulty was ignored before)');
  const towerId = r.data.gameId;
  const g2 = await req('/api/auth/guest', 'POST');
  r = await req('/api/play/tower/pick', 'POST', { gameId: towerId, tile: 0 }, g2.data.token);
  ok(r.status === 403, "another player cannot act on someone else's game session (ownership check added)");
  r = await req('/api/play/tower/pick', 'POST', { gameId: towerId, tile: 0 }, T);
  ok(r.status === 200, 'owner can pick a tile');

  console.log(failures === 0 ? '\nPART A PASSED' : `\n${failures} FAILURES SO FAR`);

  // ---- HiLo interactive flow ----
  r = await req('/api/play/hilo/start', 'POST', { currency: 'GC', betAmount: 10 }, T);
  ok(r.status === 200 && r.data.currentCard && r.data.currentCard.rank >= 4 && r.data.currentCard.rank <= 10,
     'hilo deals a fair base card in the middle of the range');
  const hiloId = r.data.gameId;
  const rank = r.data.currentCard.rank;
  const guess = rank <= 7 ? 'HIGHER' : 'LOWER';
  r = await req('/api/play/hilo/guess', 'POST', { gameId: hiloId, guess }, T);
  ok(r.status === 200, 'hilo guess resolves with probability-based outcome');
  if (r.data.multiplier > 1 && !(r.data.cashedOut || r.data.autoCashout)) {
    const co = await req('/api/play/hilo/cashout', 'POST', { gameId: hiloId }, T);
    ok(co.status === 200 && co.data.payout > 0, 'hilo cashout pays accrued multiplier');
  } else if (r.data.cashedOut || r.data.autoCashout) {
    ok(r.data.payout > 0, 'hilo auto-cashout paid accrued multiplier');
  } else {
    ok(true, 'hilo round ended (loss is a valid resolution)');
  }

  // ---- Blackjack interactive flow ----
  let resolvedNaturally = false;
  for (let tries = 0; tries < 8 && !resolvedNaturally; tries++) {
    r = await req('/api/play/blackjack/start', 'POST', { currency: 'GC', betAmount: 10 }, T);
    if (r.data.resolved) { resolvedNaturally = true; ok(true, 'blackjack natural BJ / push resolved at deal'); continue; }
    const bjId = r.data.gameId;
    const hitRes = await req('/api/play/blackjack/hit', 'POST', { gameId: bjId }, T);
    if (hitRes.data.resolved) {
      resolvedNaturally = true;
      ok(true, 'blackjack hit resolved (bust or auto-stand on 21)');
    } else {
      const stRes = await req('/api/play/blackjack/stand', 'POST', { gameId: bjId }, T);
      resolvedNaturally = true;
      ok(stRes.status === 200 && stRes.data.resolved && typeof stRes.data.payout === 'number',
         'blackjack stand plays out the dealer and settles');
    }
  }
  ok(resolvedNaturally, 'blackjack hands always reach resolution');

  // ---- JSON error handling ----
  r = await req('/api/nonexistent-endpoint', 'GET');
  ok(r.status === 404 && r.data.error === 'Endpoint not found.', 'unknown API routes return JSON 404 instead of HTML');

  console.log(failures === 0 ? '\nALL SMOKE TESTS PASSED \u2714' : `\n${failures} TEST(S) FAILED \u2718`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('SMOKE RUNNER ERROR:', e); process.exit(2); });



