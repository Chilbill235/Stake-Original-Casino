const fs = require('fs');
const initSqlJs = require('D:/Casino/node_modules/sql.js');
(async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync('D:/Casino/casino.sqlite'));
  let r = db.exec("SELECT id, username, email, gc_balance, sc_unplayed, sc_played, kyc_status, state FROM users ORDER BY id DESC LIMIT 3");
  if (r.length) {
    const c = r[0].columns; r[0].values.forEach(v => console.log('USER:', c.map((k,i)=>k+': '+v[i]).join(' | ')));
  }
  console.log('--- recent transactions ---');
  r = db.exec("SELECT id, user_id, type, status, amount FROM transactions ORDER BY timestamp DESC LIMIT 5");
  if (r.length) { const c = r[0].columns; r[0].values.forEach(v => console.log('TX:', c.map((k,i)=>k+': '+v[i]).join(' | '))); } else console.log('none');
  db.close();
})();
