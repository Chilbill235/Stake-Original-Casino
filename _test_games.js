const http = require('http');

function call(path, method = 'GET', body = null, token = null) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const opt = { hostname: 'localhost', port: 3000, path, method, headers };
    const req = http.request(opt, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch (e) { resolve({ status: res.statusCode, body: d }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function run() {
  // Create fresh guest
  let res = await call('/api/auth/guest', 'POST');
  const token = res.body.token;
  console.log('=== USER: ' + res.body.user.username + ' ===\n');

  // Test every game
  const games = [
    { name: 'slots', params: {} },
    { name: 'dice', params: { target: 50, condition: 'OVER' } },
    { name: 'wheel', params: {} },
    { name: 'baccarat', params: {} },
    { name: 'plinko', params: { rows: 8 } },
    { name: 'crash', params: { targetMultiplier: 2 } },
    { name: 'tower', params: { difficulty: 'MEDIUM' } },
    { name: 'mines', params: { mineCount: 3 } },
    { name: 'keno', params: {} },
    { name: 'hilo', params: {} },
    { name: 'blackjack', params: {} },
    { name: 'limbo', params: { targetMultiplier: 2 } }
  ];

  for (const g of games) {
    try {
      res = await call('/api/play/' + g.name, 'POST', {
        currency: 'GC',
        betAmount: 10,
        params: g.params
      }, token);

      if (res.status === 200) {
        const d = res.body;
        console.log(g.name + ': OK | multiplier=' + d.multiplier + ' payout=' + d.payout + ' details=' + (d.details ? Object.keys(d.details).join(',') : 'none'));
      } else {
        console.log(g.name + ': FAIL status=' + res.status + ' error=' + (res.body.error || res.body));
      }
    } catch (e) {
      console.log(g.name + ': ERROR ' + e.message);
    }
  }

  console.log('\n=== BONUS SYSTEMS ===\n');

  // Check bonus status
  res = await call('/api/bonus/status', 'GET', null, token);
  console.log('bonus/status:', res.status, JSON.stringify(res.body));

  // Daily claim
  res = await call('/api/bonus/daily-claim', 'POST', {}, token);
  console.log('daily-claim:', res.status, JSON.stringify(res.body));

  // Challenges
  res = await call('/api/challenges', 'GET', null, token);
  console.log('challenges:', res.status);
  if (res.body.challenges) {
    res.body.challenges.forEach(c => {
      console.log('  - ' + c.id + ' [' + c.task + '] target=' + c.target + ' progress=' + c.progress + ' reward=' + c.minReward + '-' + c.maxReward + ' SC');
    });
  }

  // Claim a challenge (if completable)
  const allGamesRes = await call('/api/challenges', 'GET', null, token);
  if (allGamesRes.body.challenges) {
    for (const c of allGamesRes.body.challenges) {
      if (c.completed && !c.claimed) {
        res = await call('/api/challenges/claim', 'POST', { challengeId: c.id }, token);
        console.log('claim challenge ' + c.id + ':', res.status, JSON.stringify(res.body));
      }
    }
  }

  // Rakeback
  res = await call('/api/rakeback/status', 'GET', null, token);
  console.log('rakeback/status:', res.status);
  if (res.body.rakeback) {
    ['daily','weekly','monthly'].forEach(t => {
      const r = res.body.rakeback[t];
      console.log('  ' + t + ': loss=' + r.lossTracked + ' claimable=' + r.claimable + ' canClaim=' + r.canClaim + ' rate=' + r.rateMin + '-' + r.rateMax + '%');
    });
  }

  console.log('\n=== DONE ===');
}

run().catch(e => console.error(e));
