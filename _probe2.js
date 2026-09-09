'use strict';
(async () => {
  const variants = [
    ['no-accept-enc', {}],
    ['accept-enc-gzip', { 'Accept-Encoding': 'gzip' }],
    ['accept-enc-deflate', { 'Accept-Encoding': 'deflate' }]
  ];
  for (const [name, headers] of variants) {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 6000);
    const t0 = Date.now();
    try {
      const r = await fetch('http://localhost:3017/api/health', { headers, signal: c.signal });
      const txt = await r.text();
      console.log(name, r.status, Date.now() - t0 + 'ms', r.headers.get('content-encoding'), txt.slice(0, 60));
    } catch (e) {
      console.log(name, 'EXC', e.name, Date.now() - t0 + 'ms');
    }
    clearTimeout(t);
  }
  process.exit(0);
})();
