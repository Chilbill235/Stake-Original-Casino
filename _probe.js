'use strict';
const B = 'http://localhost:3017';
function ft(url, opts, ms = 8000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return fetch(url, Object.assign({ signal: c.signal }, opts || {})).finally(() => clearTimeout(t));
}
(async () => {
  try {
    const t0 = Date.now();
    const r = await ft(B + '/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'p' + Date.now(), email: 'p' + Date.now() + '@t.com', password: 'Test123456', birthDate: '1990-01-01', state: 'CA' })
    });
    console.log('register', r.status, Date.now() - t0 + 'ms');
    const d = await r.json();
    const tok = d.token || d.accessToken;
    if (!tok) { console.log('no token:', JSON.stringify(d).slice(0, 300)); process.exit(0); }
    for (const [name, path, body] of [
      ['slots', '/api/play/slots', { currency: 'GC', betAmount: 10 }],
      ['dice', '/api/play/dice', { currency: 'GC', betAmount: 10, params: { target: 50, condition: 'OVER' } }],
      ['mines-start', '/api/play/mines/start', { currency: 'GC', betAmount: 10, mineCount: 3 }],
      ['tower-start', '/api/play/tower/start', { currency: 'GC', betAmount: 10 }],
      ['bj-start', '/api/play/blackjack/start', { currency: 'GC', betAmount: 10 }],
      ['hilo-start', '/api/play/hilo/start', { currency: 'GC', betAmount: 10 }]
    ]) {
      const t1 = Date.now();
      try {
        const r2 = await ft(B + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify(body) }, 10000);
        const txt = await r2.text();
        console.log(name, r2.status, Date.now() - t1 + 'ms', txt.slice(0, 120));
      } catch (e) { console.log(name, 'EXC', e.name, Date.now() - t1 + 'ms'); }
    }
  } catch (e) {
    console.log('FATAL', e.name, e.cause ? e.cause.code || e.cause : e.message);
  }
  process.exit(0);
})();
