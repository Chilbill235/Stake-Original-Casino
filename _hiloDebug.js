// _hiloDebug.js
const BASE = 'http://localhost:' + (process.env.TEST_PORT || 3100);

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
  const g = await req('/api/auth/guest', 'POST');
  const T = g.data.token;
  const s = await req('/api/play/hilo/start', 'POST', { currency: 'GC', betAmount: 10 }, T);
  console.log('START:', JSON.stringify(s.data));
  const guess = s.data.currentCard.rank <= 7 ? 'HIGHER' : 'LOWER';
  const gr = await req('/api/play/hilo/guess', 'POST', { gameId: s.data.gameId, guess }, T);
  console.log('GUESS:', JSON.stringify(gr));
  if (gr.data && gr.data.multiplier > 1) {
    const co = await req('/api/play/hilo/cashout', 'POST', { gameId: s.data.gameId }, T);
    console.log('CASHOUT STATUS:', co.status, JSON.stringify(co.data));
  }
})();
