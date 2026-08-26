// _patch2b.js — remaining client.js surgery + appended game modules
const fs = require('fs');
const p = 'D:/Casino/public/client.js';
let s = fs.readFileSync(p, 'utf8');

function findFnEnd(src, fnStart) {
  let i = src.indexOf('{', fnStart);
  let depth = 0;
  let st = 'code';
  for (; i < src.length; i++) {
    const ch = src[i];
    const nx = src[i + 1];
    if (st === 'code') {
      if (ch === '/' && nx === '/') { st = 'line'; i++; continue; }
      if (ch === '/' && nx === '*') { st = 'block'; i++; continue; }
      if (ch === "'") { st = 'sq'; continue; }
      if (ch === '"') { st = 'dq'; continue; }
      if (ch === '`') { st = 'tpl'; continue; }
      if (ch === '{') depth++;
      if (ch === '}') { depth--; if (depth === 0) return i + 1; }
    } else if (st === 'sq') {
      if (ch === '\\') i++;
      else if (ch === "'") st = 'code';
    } else if (st === 'dq') {
      if (ch === '\\') i++;
      else if (ch === '"') st = 'code';
    } else if (st === 'tpl') {
      if (ch === '\\') i++;
      else if (ch === '`') st = 'code';
    } else if (st === 'line') {
      if (ch === '\n') st = 'code';
    } else if (st === 'block') {
      if (ch === '*' && nx === '/') { st = 'code'; i++; }
    }
  }
  throw new Error('unbalanced scan from offset ' + fnStart);
}

function replaceFn(name, newSrc) {
  const asyncSig = 'async function ' + name + '(';
  const plainSig = 'function ' + name + '(';
  let start = -1;
  if (s.includes(asyncSig)) start = s.indexOf(asyncSig);
  else if (s.includes(plainSig)) start = s.indexOf(plainSig);
  else throw new Error('fn not found: ' + name);
  const end = findFnEnd(s, start);
  s = s.slice(0, start) + newSrc.trim() + s.slice(end);
  console.log('[ok] replaced', name);
}

// ---------------------------------------------------------------------------
// Limbo — no simulation, sync provably fair
// ---------------------------------------------------------------------------
replaceFn('executeLimboBet', `
async function executeLimboBet(betAmount) {
  state.isProcessing = true;
  playSound('chip');
  const targetMultiplier = parseFloat(document.getElementById('limbo-target')?.value || 2.0);
  const actionBtn = document.getElementById('btn-primary-action');
  const display = document.getElementById('game-display-area');

  actionBtn.disabled = true;

  try {
    const data = await apiRequest('/api/play/limbo', 'POST', {
      currency: state.currency,
      betAmount,
      params: { targetMultiplier }
    });

    state.balances = data.balances;
    updateWalletUI();
    syncFair(data);

    const finalResult = data.details.resultMultiplier;
    let current = 1.00;
    const duration = 1000;
    const startTime = performance.now();

    function animate(now) {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      current = 1.00 + (finalResult - 1.00) * Math.pow(progress, 2);

      display.innerHTML = \`
        <div style="text-align:center; padding: 30px;">
          <div style="font-size: 3.5rem; font-weight: 800; color: \${progress === 1 ? (data.win ? '#00e701' : '#ff4d4d') : '#fff'};">
            \${current.toFixed(2)}x
          </div>
          <div style="color:#b1bad2; font-weight:600;">Target: \${targetMultiplier.toFixed(2)}x</div>
          \${progress === 1 && data.win ? \`<div style="margin-top:10px; color:#00e701; font-weight:800;">WIN — paid \${Number(data.payout).toFixed(2)} \${state.currency}</div>\` : ''}
        </div>\`;

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        if (data.win) playSound('win'); else playSound('loss');
        actionBtn.disabled = false;
        state.isProcessing = false;
      }
    }

    requestAnimationFrame(animate);

  } catch (err) {
    alert(err.message || 'Limbo bet failed');
    actionBtn.disabled = false;
    state.isProcessing = false;
  }
}
`);

// ---------------------------------------------------------------------------
// Keno board with draw marking
// ---------------------------------------------------------------------------
replaceFn('renderKenoBoard', `
function renderKenoBoard(opts = {}) {
  const drawn = opts.drawn || [];
  const drawnSet = new Set(drawn);
  const pickSet = new Set(state.selectedKenoNumbers);
  const locked = !!opts.locked;

  let html = '<div style="display:grid; grid-template-columns: repeat(8, minmax(30px, 1fr)); gap:6px; max-width:420px; margin:auto;" id="keno-board">';
  for (let i = 1; i <= 40; i++) {
    const isPicked = pickSet.has(i);
    const isDrawn = drawnSet.has(i);
    let bg = '#14222d';
    let color = '#fff';
    let border = '1px solid #243542';
    let glow = 'none';
    if (isDrawn && isPicked) { bg = '#00e701'; color = '#000'; border = '2px solid #fff'; glow = '0 0 10px rgba(0,231,1,.55)'; }
    else if (isDrawn) { bg = '#8248ff'; color = '#fff'; }
    else if (isPicked) { bg = '#00e701'; color = '#000'; }
    html += \`<div style="background:\${bg}; color:\${color}; padding:10px 4px; border-radius:4px; font-weight:600; font-size:0.9rem; cursor:\${locked ? 'default' : 'pointer'}; text-align:center; border:\${border}; box-shadow:\${glow};" onclick="\${locked ? '' : 'toggleKenoNumber(' + i + ')'}">\${i}</div>\`;
  }
  html += '</div>';
  if (drawn.length) {
    const hits = state.selectedKenoNumbers.filter(n => drawnSet.has(n)).length;
    html += \`<div style="text-align:center; margin-top:12px; color:#b1bad2; font-size:0.9rem; font-weight:600;">\${hits} / \${state.selectedKenoNumbers.length} picks hit</div>\`;
  }
  document.getElementById('game-display-area').innerHTML = html;
}
`);

// ---------------------------------------------------------------------------
// Standard bet dispatcher — real visuals per game, NO random fallback
// ---------------------------------------------------------------------------
replaceFn('executeStandardBet', `
async function executeStandardBet(betAmount) {
  if (!state.currentGame) return;

  state.isProcessing = true;
  playSound('chip');
  const actionBtn = document.getElementById('btn-primary-action');
  actionBtn.disabled = true;

  const params = {};
  if (state.currentGame === 'plinko') {
    params.rows = parseInt(document.getElementById('plinko-rows')?.value || 16);
  } else if (state.currentGame === 'keno') {
    if (state.selectedKenoNumbers.length === 0) {
      actionBtn.disabled = false;
      state.isProcessing = false;
      return alert('Please select at least 1 Keno number.');
    }
    params.selectedNumbers = state.selectedKenoNumbers;
  } else if (state.currentGame === 'baccarat') {
    params.betType = document.getElementById('baccarat-bet')?.value || 'PLAYER';
  } else if (state.currentGame === 'crash') {
    params.targetMultiplier = parseFloat(document.getElementById('crash-target')?.value || 2.0);
  }

  try {
    // Server is the single source of truth — failures surface as alerts,
    // never as simulated Math.random() results.
    const data = await apiRequest('/api/play/' + state.currentGame, 'POST', {
      currency: state.currency,
      betAmount,
      params
    });

    state.balances = data.balances;
    updateWalletUI();
    syncFair(data);

    if (data.multiplier > 1) playSound('win'); else playSound('loss');

    switch (state.currentGame) {
      case 'slots':    return renderSlotsResult(data.details, data.multiplier);
      case 'plinko':   return renderPlinkoResult(data.details, data.multiplier, data.payout);
      case 'keno':     return renderKenoResult(data.details);
      case 'wheel':    return renderWheelResult(data.details, data.multiplier);
      case 'baccarat': return renderBaccaratResult(data.details, data.payout);
      case 'crash':    return renderCrashResult(data.details, data.win, data.payout);
      default:         break;
    }

    const display = document.getElementById('game-display-area');
    display.innerHTML = \`
      <div style="text-align:center; padding: 20px;">
        <div style="font-size:2rem; font-weight:800; color:\${data.multiplier > 1 ? '#00e701' : '#ff4d4d'}; margin-bottom: 12px;">
          \${data.multiplier.toFixed(2)}x
        </div>
        <p style="font-weight: 600; color: #b1bad2;">Payout: \${Number(data.payout).toFixed(2)} \${state.currency}</p>
      </div>\`;
  } catch (err) {
    alert(err.message || (state.currentGame + ' failed'));
  } finally {
    actionBtn.disabled = false;
    state.isProcessing = false;
  }
}

function renderKenoResult(details) {
  renderKenoBoard({ drawn: details.drawn, locked: true });
}
`);

// ---------------------------------------------------------------------------
// Primary dispatcher — routes Blackjack & HiLo session games
// ---------------------------------------------------------------------------
replaceFn('handlePrimaryAction', `
function handlePrimaryAction() {
  if (state.isProcessing) return;

  const currentBalance = state.currency === 'GC' ? state.balances.gc : state.balances.sc;
  const betInput = document.getElementById('bet-input');
  const betAmount = parseFloat(betInput?.value || 0);

  if (state.activeGameState) {
    if (state.currentGame === 'mines') return cashoutMines();
    if (state.currentGame === 'tower') return cashoutTower();
    if (state.currentGame === 'hilo') return cashoutHilo();
  }

  if (isNaN(betAmount) || betAmount <= 0) {
    return alert('Please enter a valid bet amount.');
  }

  if (betAmount > currentBalance) {
    return alert(\`Insufficient \${state.currency} balance.\`);
  }

  switch (state.currentGame) {
    case 'mines':     return startMinesGame(betAmount);
    case 'tower':     return startTowerGame(betAmount);
    case 'limbo':     return executeLimboBet(betAmount);
    case 'dice':      return executeDiceBet(betAmount);
    case 'blackjack': return startBlackjackGame(betAmount);
    case 'hilo':      return startHiloGame(betAmount);
    default:          return executeStandardBet(betAmount);
  }
}
`);

// ---------------------------------------------------------------------------
// launchGame — Baccarat bet selector, HiLo/Crash cases, button-text fix
// ---------------------------------------------------------------------------
{
  const oldList = "if (!['mines', 'hilo', 'tower', 'blackjack', 'slots', 'wheel'].includes(gameId)) {";
  const newList = "if (!['mines', 'tower', 'blackjack', 'slots'].includes(gameId)) {";
  if (!s.includes(oldList)) throw new Error('launchGame exclusion list not found');
  s = s.replace(oldList, newList);
  console.log('[ok] launchGame exclusion list fixed');

  const kenoCaseRe = /case 'keno':\r?\n\s*state\.selectedKenoNumbers = \[\];/;
  const gameCases = [
    "    case 'baccarat':",
    "      options.innerHTML = `",
    "        <div class=\"control-group\" style=\"grid-column: 1 / -1;\">",
    "          <label class=\"control-label\">Bet Type</label>",
    "          <select id=\"baccarat-bet\" class=\"control-select\">",
    "            <option value=\"PLAYER\" selected>Player — pays 2x</option>",
    "            <option value=\"BANKER\">Banker — pays 1.95x</option>",
    "            <option value=\"TIE\">Tie — pays 9x</option>",
    "          </select>",
    "        </div>`;",
    "      break;",
    "",
    "    case 'hilo':",
    "      options.innerHTML = `",
    "        <div class=\"control-group\" style=\"grid-column: 1 / -1; color:#b1bad2; font-size:0.85rem; font-weight:600;\">",
    "          Guess HIGHER or LOWER than your base card. Correct guesses compound your multiplier — cash out anytime. Ties lose.",
    "        </div>`;",
    "      break;",
    "",
    "    case 'crash':",
    "      options.innerHTML = `",
    "        <div class=\"control-group\" style=\"grid-column: 1 / -1;\">",
    "          <label class=\"control-label\">Auto Cashout Target</label>",
    "          <input type=\"number\" id=\"crash-target\" value=\"2.00\" step=\"0.01\" min=\"1.01\" max=\"1000000\" class=\"control-input\">",
    "        </div>`;",
    "      break;",
    "",
    "    case 'keno':",
    "      state.selectedKenoNumbers = [];"
  ].join('\n');

  if (!kenoCaseRe.test(s)) throw new Error('keno case anchor not found');
  s = s.replace(kenoCaseRe, () => gameCases);
  console.log('[ok] launchGame game cases added');
}

// ---------------------------------------------------------------------------
// Append NEW game modules just before the profile section of client.js
// ---------------------------------------------------------------------------
const profIdxCheck = s.indexOf('// 11. PROFILE & MODAL CONTROLLERS');
if (profIdxCheck < 0) throw new Error('profile anchor not found');

// Inserts a code block immediately before the section-11 comment bar
function injectBeforeProfile(block) {
  const idx = s.indexOf('// 11. PROFILE & MODAL CONTROLLERS');
  if (idx < 0) throw new Error('profile anchor lost');
  const bar = s.lastIndexOf('// ======', idx);
  s = s.slice(0, bar) + block.trimEnd() + '\r\n\r\n' + s.slice(bar);
}

const NEW_PART_1 = `
/* --- SHARED GAME RENDER HELPERS --- */
const SLOT_SPIN_SYMBOLS = ['🍒', '🍋', '🍇', '🔔', '💎', '7️⃣', '⭐', '🎰'];
const PLINKO_CLIENT_TABLES = {
  8:  [13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13],
  10: [22, 5, 2, 1.4, 0.6, 0.4, 0.6, 1.4, 2, 5, 22],
  12: [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33],
  14: [58, 15, 7, 4, 1.9, 1, 0.5, 0.2, 0.5, 1, 1.9, 4, 7, 15, 58],
  16: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110]
};
const WHEEL_COLORS = {
  GRAY: '#39424d', BLUE: '#1876d2', GREEN: '#00e701',
  PURPLE: '#8248ff', ORANGE: '#ff8b20', GOLD: '#ffc700'
};
const SLOT_LINE_NAMES = ['Top Row', 'Middle Row', 'Bottom Row', 'Diagonal ↘', 'Diagonal ↙'];

function cardHTML(card, hidden, big) {
  if (hidden || !card) return '<div class="playing-card face-down"><span>🂠</span></div>';
  const red = card.suit === '♥' || card.suit === '♦';
  const suit = card.suit || '♠';
  return \`
    <div class="playing-card \${red ? 'red' : ''} \${big ? 'big' : ''}">
      <span class="pc-rank">\${card.label || card.value}</span>
      <span class="pc-suit">\${suit}</span>
    </div>\`;
}

/* --- SLOTS RENDERER (spinning reels + winning line highlight) --- */
function slotsGridHTML(grid, hotSet, final) {
  let html = '<div style="display:flex;flex-direction:column;gap:8px;width:fit-content;margin:auto;padding:14px;background:#10161d;border-radius:12px;border:1px solid #243542;">';
  for (let r = 0; r < 3; r++) {
    html += '<div style="display:flex;gap:8px;">';
    for (let c = 0; c < 3; c++) {
      const isHot = final && hotSet.has(r + '-' + c);
      html += '<div style="width:min(72px,20vw);height:min(72px,20vw);display:flex;align-items:center;justify-content:center;font-size:clamp(1.6rem,6vw,2.1rem);background:#14222d;border:1px solid ' + (isHot ? '#00e701' : '#243542') + ';border-radius:10px;box-shadow:' + (isHot ? '0 0 14px rgba(0,231,1,.45)' : 'none') + ';">' + grid[r][c] + '</div>';
    }
    html += '</div>';
  }
  return html + '</div>';
}

function renderSlotsResult(details, multiplier) {
  const display = document.getElementById('game-display-area');
  const grid = details.grid;
  const winLines = details.winningLines || [];
  let tick = 0;

  const timer = setInterval(() => {
    tick++;
    const animGrid = grid.map(row => row.map(() => SLOT_SPIN_SYMBOLS[Math.floor(Math.random() * SLOT_SPIN_SYMBOLS.length)]));
    display.innerHTML = slotsGridHTML(animGrid, null, false);
    if (tick >= 12) {
      clearInterval(timer);
      finishSlots();
    }
  }, 60);

  function finishSlots() {
    const LINES = [
      [[0, 0], [0, 1], [0, 2]],
      [[1, 0], [1, 1], [1, 2]],
      [[2, 0], [2, 1], [2, 2]],
      [[0, 0], [1, 1], [2, 2]],
      [[2, 0], [1, 1], [0, 2]]
    ];
    const hot = new Set();
    winLines.forEach(w => LINES[w.line].forEach(([r, c]) => hot.add(r + '-' + c)));

    let html = slotsGridHTML(grid, hot, true);
    if (winLines.length) {
      html += '<div style="text-align:center;margin-top:14px;font-weight:800;color:#00e701;font-size:1.15rem;">WIN ' + multiplier.toFixed(2) + 'x</div>';
      html += '<div style="text-align:center;color:#b1bad2;font-size:0.82rem;margin-top:4px;">' +
        winLines.map(w => SLOT_LINE_NAMES[w.line] + ' pays ' + w.multiplier + 'x').join(' • ') + '</div>';
    } else {
      html += '<div style="text-align:center;margin-top:14px;color:#ff4d4d;font-weight:700;">No winning lines</div>';
    }
    display.innerHTML = html;
  }
}

`;

injectBeforeProfile(NEW_PART_1);
console.log('[ok] new module part 1 injected');

const NEW_PART_2 = `
/* --- PLINKO RENDERER (animated drop + bucket highlight) --- */
function renderPlinkoResult(details, multiplier, payout) {
  const display = document.getElementById('game-display-area');
  const rows = details.rows;
  const path = details.path;
  const bucket = details.bucket;
  const table = PLINKO_CLIENT_TABLES[rows] || PLINKO_CLIENT_TABLES[16];

  let step = 0;
  let pos = 0;
  function drawMid() {
    display.innerHTML =
      '<div style="text-align:center;padding:20px;">' +
      '<div style="font-size:1rem;color:#b1bad2;font-weight:700;">Row ' + Math.min(step + 1, rows) + ' / ' + rows + '</div>' +
      '<div style="font-size:2.2rem;margin-top:6px;">' + '.\\u2009'.repeat(pos) + '⚪' + '.\\u2009'.repeat(rows - pos) + '</div>' +
      '</div>';
  }
  drawMid();

  const timer = setInterval(() => {
    if (step >= rows) {
      clearInterval(timer);
      finishPlinko();
      return;
    }
    pos += path[step];
    step++;
    playSound('chip');
    drawMid();
  }, Math.max(45, 650 / rows));

  function finishPlinko() {
    let buckets = '<div style="display:flex;gap:4px;justify-content:center;margin-top:10px;">';
    for (let i = 0; i <= rows; i++) {
      const hit = i === bucket;
      const m = table[i];
      const col = m >= 10 ? WHEEL_COLORS.GOLD : m >= 2 ? '#8248ff' : m >= 1 ? WHEEL_COLORS.GREEN : '#39424d';
      buckets += '<div style="min-width:min(30px,7vw);padding:6px 2px;border-radius:4px;text-align:center;font-size:0.62rem;font-weight:800;color:#fff;background:' + col + ';opacity:' + (hit ? '1' : '0.55') + ';transform:' + (hit ? 'scale(1.12)' : 'none') + ';box-shadow:' + (hit ? '0 0 10px rgba(255,199,0,.6)' : 'none') + ';">' + m.toFixed(2) + 'x</div>';
    }
    buckets += '</div>';

    const won = multiplier >= 1;
    display.innerHTML =
      '<div style="max-width:520px;margin:auto;text-align:center;">' + buckets +
      '<div style="margin-top:16px;font-size:2rem;font-weight:900;color:' + (won ? '#00e701' : '#ff4d4d') + ';">' + multiplier.toFixed(2) + 'x</div>' +
      '<div style="color:#b1bad2;font-size:0.85rem;margin-top:4px;">Payout: ' + Number(payout || 0).toFixed(2) + ' ' + state.currency + '</div>' +
      '</div>';
    if (won) playSound('win');
  }
}

`;

injectBeforeProfile(NEW_PART_2);
console.log('[ok] new module part 2 injected');

const NEW_PART_3 = `
/* --- WHEEL RENDERER (conic-gradient ring with landed pointer) --- */
function renderWheelResult(details, multiplier) {
  const display = document.getElementById('game-display-area');
  const colors = [
    WHEEL_COLORS.GRAY, WHEEL_COLORS.BLUE, WHEEL_COLORS.GREEN, WHEEL_COLORS.BLUE,
    WHEEL_COLORS.PURPLE, WHEEL_COLORS.GRAY, WHEEL_COLORS.GREEN, WHEEL_COLORS.ORANGE,
    WHEEL_COLORS.BLUE, WHEEL_COLORS.PURPLE, WHEEL_COLORS.GOLD, WHEEL_COLORS.GOLD
  ];
  let stops = '';
  colors.forEach((c, i) => { stops += c + ' ' + (i * 30) + 'deg ' + ((i + 1) * 30) + 'deg' + (i < 11 ? ',' : ''); });
  const won = multiplier > 0;

  display.innerHTML =
    '<div style="text-align:center;padding:10px;">' +
    '<div style="position:relative;width:min(220px,60vw);height:min(220px,60vw);margin:auto;border-radius:50%;background:conic-gradient(' + stops + ');border:5px solid #243542;box-shadow:0 0 24px rgba(0,0,0,.6);">' +
    '<div style="position:absolute;top:-14px;left:50%;transform:translateX(-50%);width:0;height:0;border-left:10px solid transparent;border-right:10px solid transparent;border-top:16px solid #ffc700;"></div>' +
    '</div>' +
    '<div style="margin-top:20px;font-size:2rem;font-weight:900;color:' + (won ? '#00e701' : '#ff4d4d') + ';">' + multiplier.toFixed(2) + 'x</div>' +
    '<div style="color:#b1bad2;font-weight:600;">Landed on ' + details.color.toLowerCase() + '</div>' +
    '</div>';
}

/* --- BACCARAT RENDERER --- */
function renderBaccaratResult(details, payout) {
  const display = document.getElementById('game-display-area');
  const outcome = details.outcome;
  const betOn = details.betOn;
  const colorMap = { PLAYER: '#1876d2', BANKER: '#ff4d4d', TIE: '#8248ff' };

  display.innerHTML =
    '<div style="max-width:480px;margin:auto;">' +
    '<div class="bj-row-label" style="color:' + colorMap.BANKER + '">BANKER • ' + details.bScore + '</div>' +
    '<div class="hand-row">' + details.bankerHand.map(c => cardHTML(c, false)).join('') + '</div>' +
    '<div style="margin:12px 0;height:1px;background:#243542;"></div>' +
    '<div class="bj-row-label" style="color:' + colorMap.PLAYER + '">PLAYER • ' + details.pScore + '</div>' +
    '<div class="hand-row">' + details.playerHand.map(c => cardHTML(c, false)).join('') + '</div>' +
    '<div style="text-align:center;margin-top:18px;font-size:1.3rem;font-weight:900;color:' + colorMap[outcome] + ';">' + outcome + (outcome === betOn ? ' — YOU WIN' : '') + '</div>' +
    '<div style="text-align:center;color:#b1bad2;font-size:0.85rem;margin-top:4px;">' +
    (outcome === betOn ? 'Payout: ' + Number(payout).toFixed(2) + ' ' + state.currency :
     (outcome === 'TIE' && betOn !== 'TIE' ? 'Tie — your stake was pushed back' : '')) +
    '</div></div>';
}

/* --- CRASH RENDERER --- */
function renderCrashResult(details, win, payout) {
  const display = document.getElementById('game-display-area');
  display.innerHTML =
    '<div style="text-align:center;padding:26px;">' +
    '<div style="font-size:3rem;font-weight:900;color:' + (win ? '#00e701' : '#ff4d4d') + ';">' + details.crashPoint.toFixed(2) + 'x</div>' +
    '<div style="color:#b1bad2;font-weight:600;margin-top:6px;">Crashed' + (win ? ' after your ' + details.target.toFixed(2) + 'x target ✓' : ' before your ' + details.target.toFixed(2) + 'x target') + '</div>' +
    (win ? '<div style="margin-top:12px;font-weight:800;color:#00e701;">Paid ' + Number(payout).toFixed(2) + ' ' + state.currency + '</div>' : '') +
    '</div>';
}

`;

injectBeforeProfile(NEW_PART_3);
console.log('[ok] new module part 3 injected');

const NEW_PART_4 = `
/* --- ROUND UI RESET HELPERS --- */
function resetRoundUI(label) {
  const actionBtn = document.getElementById('btn-primary-action');
  if (!actionBtn) return;
  actionBtn.textContent = label;
  actionBtn.disabled = false;
}

/* --- BLACKJACK (interactive hit / stand) --- */
function blackjackOutcomeText(outcome, multiplier, payout) {
  const cur = state.currency;
  switch (outcome) {
    case 'BLACKJACK': return { text: 'BLACKJACK! Paid ' + Number(payout).toFixed(2) + ' ' + cur, color: '#00e701' };
    case 'WIN':       return { text: 'You win! Payout ' + Number(payout).toFixed(2) + ' ' + cur, color: '#00e701' };
    case 'PUSH':      return { text: 'Push — stake returned', color: '#ffc700' };
    case 'BUST':      return { text: 'Bust! Over 21', color: '#ff4d4d' };
    default:          return { text: 'Dealer wins', color: '#ff4d4d' };
  }
}

function renderBlackjackHands(playerHand, dealerShown, holeHidden, msgObj) {
  const display = document.getElementById('game-display-area');
  display.innerHTML =
    '<div style="max-width:430px;margin:auto;text-align:center;">' +
    '<div class="bj-row-label">DEALER</div>' +
    '<div class="hand-row">' + dealerShown.map(c => cardHTML(c, holeHidden)).join('') + '</div>' +
    '<div style="margin:10px 0;height:1px;background:#243542;"></div>' +
    '<div class="bj-row-label">YOU</div>' +
    '<div class="hand-row">' + playerHand.map(c => cardHTML(c, false)).join('') + '</div>' +
    (msgObj ? '<div style="margin-top:14px;font-weight:800;color:' + msgObj.color + ';">' + msgObj.text + '</div>' : '') +
    '</div>';
}

async function startBlackjackGame(betAmount) {
  state.isProcessing = true;
  playSound('chip');
  try {
    const data = await apiRequest('/api/play/blackjack/start', 'POST', {
      currency: state.currency,
      betAmount
    });
    if (data.balances) { state.balances = data.balances; updateWalletUI(); }

    if (data.resolved) {
      renderBlackjackHands(data.playerHand, data.dealerHand, false,
        blackjackOutcomeText(data.outcome, data.multiplier, data.payout));
      if (data.multiplier > 1) playSound('win'); else playSound('chip');
      resetRoundUI('DEAL HAND');
      state.activeGameState = null;
    } else {
      state.activeGameState = {
        type: 'blackjack',
        gameId: data.gameId,
        dealerUp: data.dealerUpCard,
        betAmount
      };
      renderBlackjackHands(data.playerHand, [data.dealerUpCard], true, null);
      document.getElementById('game-controls-options').innerHTML =
        '<button type="button" class="btn-play" style="padding:12px 26px;font-weight:800;" onclick="blackjackAction(\\'hit\\')">HIT</button>' +
        '<button type="button" class="btn-secondary-action" style="padding:12px 26px;font-weight:800;" onclick="blackjackAction(\\'stand\\')">STAND</button>';
      resetRoundUI('IN PLAY…');
      document.getElementById('btn-primary-action').disabled = true;
    }
  } catch (err) {
    alert(err.message || 'Blackjack failed');
  } finally {
    state.isProcessing = false;
  }
}

`;

injectBeforeProfile(NEW_PART_4);
console.log('[ok] new module part 4 injected');

const NEW_PART_5 = `
/* --- HILO (interactive higher/lower with cashout) --- */
function hiloStepMult(rank, guess) {
  const good = guess === 'HIGHER' ? 13 - rank : rank - 1;
  return good <= 0 ? 0 : Math.floor((13 / good) * 0.87 * 10000) / 10000;
}

function renderHiloControls() {
  const ags = state.activeGameState;
  if (!ags || ags.type !== 'hilo' || !ags.currentCard) return;
  const rank = ags.currentCard.rank;
  const upM = hiloStepMult(rank, 'HIGHER');
  const downM = hiloStepMult(rank, 'LOWER');
  document.getElementById('game-controls-options').innerHTML =
    '<button type="button" class="btn-play" style="padding:12px 22px;font-weight:800;' + (upM ? '' : 'opacity:.35;pointer-events:none;') + '" onclick="hiloGuess(\\'HIGHER\\')">▲ HIGHER<div style="font-size:0.7rem;font-weight:600;">' + upM.toFixed(2) + 'x • ' + ((13 - rank) / 13 * 100).toFixed(1) + '%</div></button>' +
    '<button type="button" class="btn-secondary-action" style="padding:12px 22px;font-weight:800;' + (downM ? '' : 'opacity:.35;pointer-events:none;') + '" onclick="hiloGuess(\\'LOWER\\')">▼ LOWER<div style="font-size:0.7rem;font-weight:600;">' + downM.toFixed(2) + 'x • ' + ((rank - 1) / 13 * 100).toFixed(1) + '%</div></button>';
}

function renderHiloBoard(msgObj) {
  const display = document.getElementById('game-display-area');
  const ags = state.activeGameState;
  display.innerHTML =
    '<div style="text-align:center;">' +
    (ags.prevCard ? '<div class="hand-row" style="justify-content:center;opacity:.45;margin-bottom:6px;">' + cardHTML(ags.prevCard, false, true) + '</div>' : '') +
    (ags.currentCard ? '<div class="hand-row" style="justify-content:center;">' + cardHTML(ags.currentCard, false, true) + '</div>' : '') +
    '<div style="margin-top:10px;color:#b1bad2;font-weight:700;">Multiplier: <span style="color:#00e701;">' + ags.multiplier.toFixed(2) + 'x</span></div>' +
    (msgObj ? '<div style="margin-top:8px;font-weight:800;color:' + msgObj.color + ';">' + msgObj.text + '</div>' : '') +
    '</div>';
}

`;

injectBeforeProfile(NEW_PART_5);
console.log('[ok] new module part 5 injected');

const NEW_PART_6 = `
async function startHiloGame(betAmount) {
  state.isProcessing = true;
  playSound('chip');
  try {
    const data = await apiRequest('/api/play/hilo/start', 'POST', {
      currency: state.currency,
      betAmount
    });
    if (data.balances) { state.balances = data.balances; updateWalletUI(); }

    state.activeGameState = {
      type: 'hilo',
      gameId: data.gameId,
      currentCard: data.currentCard,
      prevCard: null,
      multiplier: 1.00,
      betAmount
    };
    renderHiloBoard(null);
    renderHiloControls();

    const actionBtn = document.getElementById('btn-primary-action');
    actionBtn.textContent = 'CASHOUT (1.00x)';
    actionBtn.disabled = true; // enabled after the first correct guess
  } catch (err) {
    alert(err.message || 'HiLo start failed');
  } finally {
    state.isProcessing = false;
  }
}

async function hiloGuess(guess) {
  if (state.isProcessing || !state.activeGameState) return;
  state.isProcessing = true;
  playSound('click');
  try {
    const data = await apiRequest('/api/play/hilo/guess', 'POST', {
      gameId: state.activeGameState.gameId,
      guess
    });

    if (!data.win) {
      if (data.balances) { state.balances = data.balances; updateWalletUI(); }
      state.activeGameState.prevCard = state.activeGameState.currentCard;
      state.activeGameState.currentCard = data.nextCard;
      renderHiloBoard({ text: 'Wrong guess — you needed ' + guess.toLowerCase() + '. Round over.', color: '#ff4d4d' });
      playSound('loss');
      document.getElementById('game-controls-options').innerHTML = '';
      state.activeGameState = null;
      setTimeout(() => { launchGame('hilo'); }, 1500);
    } else if (data.cashedOut || data.autoCashout) {
      if (data.balances) { state.balances = data.balances; updateWalletUI(); }
      state.activeGameState.multiplier = data.multiplier;
      state.activeGameState.currentCard = data.nextCard;
      state.activeGameState.prevCard = null;
      renderHiloBoard({ text: 'Board boundary reached — auto-cashout ' + data.multiplier.toFixed(2) + 'x, +' + Number(data.payout).toFixed(2) + ' ' + state.currency, color: '#00e701' });
      playSound('win');
      document.getElementById('game-controls-options').innerHTML = '';
      state.activeGameState = null;
      resetRoundUI('PLACE BET');
    } else {
      const ags = state.activeGameState;
      ags.prevCard = ags.currentCard;
      ags.currentCard = data.nextCard || data.currentCard;
      ags.multiplier = data.multiplier;
      renderHiloBoard(null);
      renderHiloControls();
      playSound('win');
      const btn = document.getElementById('btn-primary-action');
      btn.textContent = 'CASHOUT (' + ags.multiplier.toFixed(2) + 'x)';
      btn.disabled = false;
    }
  } catch (err) {
    alert(err.message || 'HiLo guess failed');
  } finally {
    state.isProcessing = false;
  }
}

async function cashoutHilo() {
  if (state.isProcessing || !state.activeGameState) return;
  state.isProcessing = true;
  playSound('win');
  try {
    const data = await apiRequest('/api/play/hilo/cashout', 'POST', {
      gameId: state.activeGameState.gameId
    });
    if (data.balances) { state.balances = data.balances; updateWalletUI(); }
    renderHiloBoard({ text: 'Cashed out ' + data.multiplier.toFixed(2) + 'x — +' + Number(data.payout).toFixed(2) + ' ' + state.currency, color: '#00e701' });
    document.getElementById('game-controls-options').innerHTML = '';
    state.activeGameState = null;
    resetRoundUI('PLACE BET');
  } catch (err) {
    alert(err.message || 'HiLo cashout failed');
  } finally {
    state.isProcessing = false;
  }
}

`;

injectBeforeProfile(NEW_PART_6);
console.log('[ok] new module part 6 injected');

fs.writeFileSync(p, s);
console.log('[done] client.js size:', s.length);



