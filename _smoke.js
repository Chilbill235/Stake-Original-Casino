'use strict';
// End-to-end smoke test for the casino API. Start server on PORT, then: node _smoke.js
const BASE = `http://127.0.0.1:${process.env.SMOKE_PORT || 3017}`;
const results = [];
let token = null;

async function req(method, path, body, auth) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(auth && token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text.slice(0, 200); }
  return { status: res.status, data };
}

async function check(name, fn) {
  try {
    const r = await fn();
    const ok = r.ok !== false && (!r.status || r.status < 400);
    results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${r.status ? 'HTTP ' + r.status : ''} ${ok ? '' : JSON.stringify(r.data).slice(0, 200)}`);
  } catch (e) {
    results.push(`FAIL  ${name}  EXC ${e.message}`);
  }
}

(async () => {
  const reg = await req('POST', '/api/auth/register', { username: 'smoke' + Date.now(), email: `smoke${Date.now()}@t.com`, password: 'Test123456', birthDate: '1990-01-01', state: 'TX' });
  token = reg.data?.token || reg.data?.accessToken;
  results.push(`${token ? 'PASS' : 'FAIL'}  register  HTTP ${reg.status} ${JSON.stringify(reg.data).slice(0, 150)}`);
  if (!token) { console.log(results.join('\n')); process.exit(1); }

  for (const g of ['slots', 'dice', 'limbo', 'plinko', 'keno', 'wheel', 'baccarat', 'crash']) {
    await check(`play ${g}`, async () => {
      const r = await req('POST', `/api/play/${g}`, { currency: 'GC', betAmount: 10, params: { target: 50, condition: 'OVER', targetMultiplier: 1.5, risk: 'medium', rows: 12, picks: 3, betType: 'PLAYER' } }, true);
      return { ok: r.status === 200 && r.data && typeof r.data.payout === 'number', status: r.status, data: r.data };
    });
  }

  await check('mines full round', async () => {
    let r = await req('POST', '/api/play/mines/start', { currency: 'GC', betAmount: 10, mineCount: 3 }, true);
    const gameId = r.data?.gameId; if (!gameId) return r;
    r = await req('POST', '/api/play/mines/reveal', { gameId, tileIndex: 0 }, true);
    if (r.status !== 200) return r;
    if (r.data?.hitBomb) return { ok: true, status: 200, data: 'hitMine(valid)' };
    r = await req('POST', '/api/play/mines/cashout', { gameId }, true);
    return r.status === 200 ? { ok: true } : r;
  });

  await check('tower full round', async () => {
    let r = await req('POST', '/api/play/tower/start', { currency: 'GC', betAmount: 10 }, true);
    const gameId = r.data?.gameId; if (!gameId) return r;
    r = await req('POST', '/api/play/tower/pick', { gameId, tile: 0 }, true);
    if (r.status !== 200) return r;
    if (r.data?.win === false) return { ok: true, status: 200, data: 'trapTile(valid)' };
    r = await req('POST', '/api/play/tower/cashout', { gameId }, true);
    return r.status === 200 ? { ok: true } : r;
  });

  await check('blackjack full round', async () => {
    let r = await req('POST', '/api/play/blackjack/start', { currency: 'GC', betAmount: 10 }, true);
    const gameId = r.data?.gameId; if (!gameId) return r;
    if (gameId && r.data?.playerHand?.length === 2) {
      const d = await req('POST', '/api/play/blackjack/double', { gameId }, true);
      if (d.status !== 200) return d;
      return { ok: d.data?.resolved === true, status: d.status, data: d.data };
    }
    r = await req('POST', '/api/play/blackjack/hit', { gameId }, true);
    if (r.status !== 200) return r;
    r = await req('POST', '/api/play/blackjack/stand', { gameId }, true);
    return r.status === 200 ? { ok: true } : r;
  });

  await check('hilo full round', async () => {
    let r = await req('POST', '/api/play/hilo/start', { currency: 'GC', betAmount: 10 }, true);
    const gameId = r.data?.gameId; if (!gameId) return r;
    r = await req('POST', '/api/play/hilo/guess', { gameId, guess: r.data?.currentCard?.rank <= 7 ? 'HIGHER' : 'LOWER' }, true);
    if (r.status !== 200) return r;
    if (!r.data?.win) return { ok: true, status: 200, data: 'lostGuess(valid)' };
    r = await req('POST', '/api/play/hilo/cashout', { gameId }, true);
    return r.status === 200 ? { ok: true } : r;
  });

  console.log(results.join('\n'));
  const fails = results.filter(r => r.startsWith('FAIL')).length;
  console.log(`\n${results.length - fails}/${results.length} passed`);
  setTimeout(() => process.exit(fails ? 1 : 0), 50);
})().catch(e => { console.log('FATAL', e.message); process.exit(1); });