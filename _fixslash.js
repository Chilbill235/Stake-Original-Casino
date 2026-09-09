'use strict';
const fs = require('fs');
const p = 'D:/Casino/server.js';
let s = fs.readFileSync(p, 'utf8');
const bad = String.raw`if (!/text\\\/|application\\\/(json|javascript|xml)|image\\\/svg/.test(ct)) return null;`;
const good = String.raw`if (!/text\/|application\/(json|javascript|xml)|image\/svg/.test(ct)) return null;`;
// The file may contain 4, 3 or 2 backslashes; normalize step by step.
let fixed = false;
for (const n of [4, 3, 2]) {
  const bs = '\\'.repeat(n);
  const from = 'if (!/text' + bs + '/|application' + bs + '/(json|javascript|xml)|image' + bs + '/svg/.test(ct)) return null;';
  if (s.includes(from)) { s = s.replace(from, good); fixed = true; break; }
}
if (!fixed && s.includes(good)) { fixed = true; }
console.log(fixed ? 'FIXED' : 'NOT FOUND');
fs.writeFileSync(p, s);
