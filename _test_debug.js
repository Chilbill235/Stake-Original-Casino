const http = require('http');

function call(path, method = 'GET', body = null, token = null) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const opt = { hostname: 'localhost', port: 3000, path, method, headers, timeout: 5000 };
    const req = http.request(opt, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch (e) { resolve({ status: res.statusCode, body: d }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout for ' + method + ' ' + path)); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function run() {
  console.log('1. Auth...');
  let res = await call('/api/auth/guest', 'POST');
  const token = res.body.token;
  console.log('   OK: ' + res.body.user.username);

  console.log('2. Mines start...');
  res = await call('/api/play/mines/start', 'POST', { currency: 'GC', betAmount: 10, mineCount: 3 }, token);
  console.log('   ' + res.status + ': ' + (res.body.gameId ? 'OK' : 'FAIL'));
  
  if (res.body.gameId) {
    console.log('3. Mines reveal...');
    res = await call('/api/play/mines/reveal', 'POST', { gameId: res.body.gameId, tileIndex: 0 }, token);
    console.log('   ' + res.status + ': ' + (res.body.hitBomb ? 'BOMBED' : res.body.multiplier ? 'SAFE' : 'unknown'));
  }

  console.log('4. Tower start...');
  res = await call('/api/play/tower/start', 'POST', { currency: 'GC', betAmount: 10, difficulty: 'MEDIUM' }, token);
  console.log('   ' + res.status + ': ' + (res.body.gameId ? 'OK' : 'FAIL'));

  console.log('5. HiLo start...');
  res = await call('/api/play/hilo/start', 'POST', { currency: 'GC', betAmount: 10 }, token);
  console.log('   ' + res.status + ': ' + (res.body.gameId ? 'OK' : 'FAIL'));

  console.log('6. Blackjack start...');
  res = await call('/api/play/blackjack/start', 'POST', { currency: 'GC', betAmount: 10 }, token);
  console.log('   ' + res.status + ': resolved=' + res.body.resolved);

  console.log('7. Challenges...');
  res = await call('/api/challenges', 'GET', null, token);
  res.body.challenges.forEach(c => console.log('   ' + c.id + ': ' + c.progress + '/' + c.target + ' reward=' + c.minReward + '-' + c.maxReward));

  console.log('8. Bonus status...');
  res = await call('/api/bonus/status', 'GET', null, token);
  console.log('   ' + JSON.stringify(res.body));

  console.log('9. Rakeback status...');
  res = await call('/api/rakeback/status', 'GET', null, token);
  console.log('   daily loss=' + res.body.rakeback.daily.lossTracked + ' claimable=' + res.body.rakeback.daily.claimable);

  console.log('\nALL TESTS DONE');
}

run().catch(e => console.error('ERROR:', e.message));
