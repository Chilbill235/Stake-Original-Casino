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
  let res = await call('/api/auth/guest', 'POST');
  const token = res.body.token;
  console.log('=== USER: ' + res.body.user.username + ' ===\n');

  // Test all session games
  const tests = [];

  // Mines
  res = await call('/api/play/mines/start', 'POST', { currency: 'GC', betAmount: 10, mineCount: 3 }, token);
  const minesId = res.body.gameId;
  for (let i = 0; i < 5; i++) {
    res = await call('/api/play/mines/reveal', 'POST', { gameId: minesId, tileIndex: i }, token);
    if (res.body.hitBomb) { break; }
  }
  tests.push('Mines: ' + (res.body.hitBomb ? 'hit bomb' : res.body.cashedOut ? 'cashed out' : 'playing'));

  // Tower
  res = await call('/api/play/tower/start', 'POST', { currency: 'GC', betAmount: 10, difficulty: 'MEDIUM' }, token);
  const towerId = res.body.gameId;
  for (let i = 0; i < 3; i++) {
    res = await call('/api/play/tower/pick', 'POST', { gameId: towerId, tile: 0 }, token);
    if (!res.body.win) { break; }
  }
  tests.push('Tower: ' + (res.body.win ? 'completed' : 'trap hit'));

  // HiLo
  res = await call('/api/play/hilo/start', 'POST', { currency: 'GC', betAmount: 10 }, token);
  const hiloId = res.body.gameId;
  const rank = res.body.currentCard.rank;
  const guess = rank <= 7 ? 'HIGHER' : 'LOWER';
  res = await call('/api/play/hilo/guess', 'POST', { gameId: hiloId, guess }, token);
  tests.push('HiLo: ' + (res.body.win ? 'guessed ' + guess : 'wrong guess'));
  if (res.body.win && res.body.multiplier > 1) {
    res = await call('/api/play/hilo/cashout', 'POST', { gameId: hiloId }, token);
    tests.push('HiLo cashout: ' + (res.body.payout > 0 ? 'OK' : 'FAIL'));
  }

  // Blackjack
  for (let i = 0; i < 3; i++) {
    res = await call('/api/play/blackjack/start', 'POST', { currency: 'GC', betAmount: 10 }, token);
    if (res.body.resolved) {
      tests.push('Blackjack: resolved at deal (' + res.body.outcome + ')');
    } else {
      const bjId = res.body.gameId;
      const hitRes = await call('/api/play/blackjack/hit', 'POST', { gameId: bjId }, token);
      if (hitRes.body.resolved) {
        tests.push('Blackjack: hit resolved (' + hitRes.body.outcome + ')');
      } else {
        const standRes = await call('/api/play/blackjack/stand', 'POST', { gameId: bjId }, token);
        tests.push('Blackjack: stand resolved (' + standRes.body.outcome + ')');
      }
    }
  }
  console.log('Games: ' + tests.join('\n  '));

  // Now check bonus systems
  console.log('\n=== BONUS SYSTEMS ===\n');

  // Check challenges
  res = await call('/api/challenges', 'GET', null, token);
  const ch = res.body.challenges;
  console.log('Challenges:');
  ch.forEach(c => {
    console.log('  ' + c.id + ' [' + c.task + '] target=' + c.target + ' progress=' + c.progress + '/' + c.target +
      ' reward=' + c.minReward + '-' + c.maxReward + ' SC' + ' complete=' + c.completed);
  });

  // Check bonus status
  res = await call('/api/bonus/status', 'GET', null, token);
  console.log('\nBonus status:', JSON.stringify(res.body));

  // Check rakeback
  res = await call('/api/rakeback/status', 'GET', null, token);
  const rb = res.body.rakeback;
  console.log('\nRakeback:');
  ['daily', 'weekly', 'monthly'].forEach(t => {
    const r = rb[t];
    console.log('  ' + t + ': loss=' + r.lossTracked + ' claimable=' + r.claimable + ' canClaim=' + r.canClaim);
  });

  console.log('\n=== DONE ===');
}

run().catch(e => console.error(e));
