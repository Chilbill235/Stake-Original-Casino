// _repair.js — fix the tail of _patch2a.js, then rerun it and verify syntax
const fs = require('fs');

const pa = 'D:/Casino/_patch2a.js';
let lines = fs.readFileSync(pa, 'utf8').split(/\r?\n/);
while (
  lines.length &&
  (lines[lines.length - 1] === '' ||
   lines[lines.length - 1].includes('writeFileSync') ||
   lines[lines.length - 1].includes('[done] saved'))
) lines.pop();
lines.push('');
lines.push('fs.writeFileSync(p, s);');
lines.push("console.log('[done] saved, size:', s.length);");
fs.writeFileSync(pa, lines.join('\r\n') + '\r\n');
console.log('patch2a tail repaired');

delete require.cache[require.resolve(pa)];
require(pa);

const { execSync } = require('child_process');
try {
  execSync('node --check D:/Casino/public/client.js', { stdio: 'inherit' });
  console.log('client.js syntax OK');
} catch (e) {
  console.log('SYNTAX STILL BAD');
}

let c = fs.readFileSync('D:/Casino/public/client.js', 'utf8');
const bad = (c.match(/sim_mines_|sim_tower_|Math\.random/g) || []).length;
console.log('remaining random/sim tokens:', bad);
