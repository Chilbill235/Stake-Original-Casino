'use strict';
const fs = require('fs');

// ---- client.js: leaderboard loader ----
{
  const p = 'D:/Casino/public/client.js';
  let s = fs.readFileSync(p, 'utf8');
  let ok = 0, fail = 0;
  const rep = (re, to, name) => {
    if (re.test(s)) { s = s.replace(re, to); ok++; console.log('OK  ' + name); }
    else { fail++; console.log('MISS ' + name); }
  };

  rep(/function isAuthenticated\(\) \{/,
`function escapeHTMLSafe(str) {
  return String(str == null ? '' : str).replace(/[&<>'"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}

let leaderboardTimer = null;
async function loadLeaderboard() {
  const listEl = document.getElementById('leaderboard-list');
  if (!listEl) return;
  try {
    const data = await apiRequest('/api/leaderboard', 'GET');
    const rows = data.leaderboard || [];
    if (!rows.length) {
      listEl.innerHTML = '<div class="lb-empty">No wagers yet — be the first on the board!</div>';
      return;
    }
    const medals = ['🥇', '🥈', '🥉'];
    listEl.innerHTML = rows.map((r, i) =>
      '<div class="lb-row' + (i < 3 ? ' lb-top' : '') + '">' +
        '<span class="lb-rank">' + (medals[i] || ('#' + (i + 1))) + '</span>' +
        '<span class="lb-name">' + escapeHTMLSafe(r.username) + '</span>' +
        '<span class="lb-vip">' + escapeHTMLSafe(r.vipTier) + '</span>' +
        '<span class="lb-rounds">' + (r.rounds || 0) + ' rounds</span>' +
        '<span class="lb-vol">' + Number(r.gcWagered || 0).toLocaleString() + ' GC' +
          (r.scWagered ? ' · ' + Number(r.scWagered).toFixed(2) + ' SC' : '') + '</span>' +
      '</div>'
    ).join('');
  } catch (err) {
    console.warn('[Leaderboard]:', err.message);
  }
}

function isAuthenticated() {`, 'leaderboard function');

  rep(/(const lobbyBetsBtn = document\.getElementById\('lobby-bets-btn'\);\s*\r?\n\s*if \(lobbyBetsBtn\) lobbyBetsBtn\.classList\.remove\('hidden'\);)/,
'$1\n  loadLeaderboard();', 'showLobby calls leaderboard');

  fs.writeFileSync(p, s);
  console.log('client ok=' + ok + ' fail=' + fail);
}

// ---- index.html: leaderboard section in the lobby ----
{
  const p = 'D:/Casino/public/index.html';
  let s = fs.readFileSync(p, 'utf8');
  const anchor = '<!-- Category Filter -->';
  if (!s.includes(anchor)) { console.log('MISS lobby anchor'); process.exit(1); }
  const section = [
'<!-- Daily Leaderboard -->',
'        <section class="leaderboard-section" id="leaderboard-section">',
'          <div class="lb-header">',
'            <h3>🏆 Daily Leaderboard</h3>',
'            <span class="lb-sub">Top players by total volume wagered</span>',
'          </div>',
'          <div id="leaderboard-list" class="lb-list"><div class="lb-empty">Loading leaderboard…</div></div>',
'        </section>',
'',
'        ' + anchor
  ].join('\r\n');
  s = s.replace(anchor, section);
  fs.writeFileSync(p, s);
  console.log('HTML leaderboard inserted');
}
