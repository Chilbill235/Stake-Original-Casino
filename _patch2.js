'use strict';
const fs = require('fs');
const p = 'D:/Casino/server.js';
let s = fs.readFileSync(p, 'utf8');
let ok = 0, fail = 0;
function rep(re, to, name) {
  if (re.test(s)) { s = s.replace(re, to); ok++; console.log('OK  ' + name); }
  else { fail++; console.log('MISS ' + name); }
}

// ---- 4. Persist password changes (hash) to the database ----
rep(/(async function saveData\(\) \{[\s\S]*?gc_balance: user\.gc_balance,\s*\r?\n)/,
'$1        password: user.password,\n', 'persist password');

// ---- 5. Forgot-password: case-insensitive lookup ----
rep(/  const user = Array\.from\(users\.values\(\)\)\.find\(u => u\.email === email\);\s*\r?\n\s*if \(!user\) \{\s*\r?\n\s*return res\.json\(\{ success: true, message: 'If an account with that email exists, a password reset link has been sent\.' \}\);/,
"  const needle = String(email).toLowerCase();\n" +
"  const user = Array.from(users.values()).find(u => u.email && String(u.email).toLowerCase() === needle);\n" +
"  if (!user) {\n" +
"    return res.json({ success: true, message: 'If an account with that email exists, a password reset link has been sent.' });", 'forgot-password lookup');

// ---- 5b. Optional direct token return (dev only) ----
rep(/  user\.passwordResetToken = resetToken;\s*\r?\n\s*user\.passwordResetExpiry = resetExpiry;\s*\r?\n\s*saveData\(\);\s*\r?\n\s*res\.json\(\{ success: true, message: 'If an account with that email exists, a password reset link has been sent\.' \}\);/,
"  user.passwordResetToken = resetToken;\n" +
"  user.passwordResetExpiry = resetExpiry;\n" +
"  saveData();\n" +
"  // No mail provider is wired up; in local/dev mode the reset token may be\n" +
"  // returned directly so the flow is completable. NEVER enable in production.\n" +
"  const payload = { success: true, message: 'If an account with that email exists, a password reset link has been sent.' };\n" +
"  if (process.env.ALLOW_RESET_TOKEN_IN_RESPONSE === 'true') payload.resetToken = resetToken;\n" +
"  res.json(payload);", 'forgot-password token option');

// ---- 6. Health + leaderboard endpoints ----
rep(/\/\/ -----------------------------------------------------------------------------\s*\r?\n\/\/ 7\. WEBSOCKET SERVER & HEARTBEAT/,
"// -----------------------------------------------------------------------------\n" +
"// 6b. HEALTH CHECK & LEADERBOARD\n" +
"// -----------------------------------------------------------------------------\n" +
"app.get('/api/health', (req, res) => {\n" +
"  res.json({\n" +
"    ok: true,\n" +
"    uptimeSeconds: Math.floor(process.uptime()),\n" +
"    users: users.size,\n" +
"    activeGames: Object.keys(GAMES).length,\n" +
"    timestamp: Date.now()\n" +
"  });\n" +
"});\n" +
"\n" +
"// Public daily leaderboard — ranks players by total volume wagered.\n" +
"app.get('/api/leaderboard', (req, res) => {\n" +
"  const rows = [];\n" +
"  for (const u of users.values()) {\n" +
"    if (!u.username) continue;\n" +
"    const gc = Number(u.totalWageredGC) || 0;\n" +
"    const sc = Number(u.totalWageredSC) || 0;\n" +
"    if (gc <= 0 && sc <= 0) continue;\n" +
"    rows.push({\n" +
"      username: String(u.username).slice(0, 24),\n" +
"      vipTier: u.vipTier || 'Bronze',\n" +
"      gcWagered: Math.round(gc),\n" +
"      scWagered: round2(sc),\n" +
"      rounds: (u.bonus && u.bonus.telemetry && Number(u.bonus.telemetry.rounds)) || 0,\n" +
"      // GC 1,000 ≈ $1 of play; SC ≈ $1. Combined volume score.\n" +
"      score: gc / 1000 + sc\n" +
"    });\n" +
"  }\n" +
"  rows.sort((a, b) => b.score - a.score);\n" +
"  res.json({ leaderboard: rows.slice(0, 20), updatedAt: Date.now() });\n" +
"});\n" +
"\n" +
"// -----------------------------------------------------------------------------\n" +
"// 7. WEBSOCKET SERVER & HEARTBEAT", 'health + leaderboard endpoints');

fs.writeFileSync(p, s);
console.log('PART2 ok=' + ok + ' fail=' + fail);
