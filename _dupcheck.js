'use strict';
const fs = require('fs');
const files = {
  'index.html': 'D:/Casino/public/index.html',
  'shelftop.html': 'D:/Casino/public/views/partials/shelftop.html',
  'pagebottom.html': 'D:/Casino/public/views/partials/pagebottom.html'
};
const ids = ['global-bets-sidebar', 'global-bets-drawer', 'bets-feed"', 'drawer-bets-feed', 'lobby-bets-btn', 'global-bets-fab', 'game-result-feed"', 'drawer-game-result-feed', 'global-bets-close'];
for (const [name, p] of Object.entries(files)) {
  const s = fs.readFileSync(p, 'utf8');
  console.log('=== ' + name + ' (lines ' + s.split(/\r?\n/).length + ') ===');
  ids.forEach(id => {
    const c = (s.split(id).length - 1);
    if (c) console.log('   ' + id.replace('"', '') + ': ' + c);
  });
}
// How does index.html relate to the partials? Does it embed shelftop/pagebottom content?
const idx = fs.readFileSync(files['index.html'], 'utf8');
const top = fs.readFileSync(files['shelftop.html'], 'utf8');
const bot = fs.readFileSync(files['pagebottom.html'], 'utf8');
const topHead = top.slice(0, 400).replace(/\s+/g, ' ');
console.log('\nshelftop head:', topHead);
console.log('\nindex contains shelftop snippet:', idx.includes(top.slice(0, 120).replace(/\s+/g, ' ').trim()));
console.log('index contains pagebottom snippet:', idx.includes(bot.slice(0, 120).replace(/\s+/g, ' ').trim()));
// Does client.js inject any of these?
const cl = fs.readFileSync('D:/Casino/public/client.js', 'utf8');
ids.forEach(id => {
  const re = new RegExp("(createElement|innerHTML|insertAdjacentHTML)[\\s\\S]{0,200}" + id.replace('"', ''));
  if (re.test(cl)) console.log('client.js INJECTS:', id);
});