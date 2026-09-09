'use strict';
(async () => {
  const r = await fetch('http://localhost:3099/api/health', { headers: { 'Accept-Encoding': 'gzip' } });
  console.log('status', r.status, r.headers.get('content-encoding'));
  console.log((await r.text()).slice(0, 60));
  process.exit(0);
})().catch(e => console.log('EXC', e.name, e.message));
