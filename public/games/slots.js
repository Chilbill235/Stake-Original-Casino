window.GameRenderers = window.GameRenderers || {};

const SLOT_SPIN_SYMBOLS = ['🍒', '🍋', '🍇', '🔔', '💎', '7️⃣', '⭐', '🎰'];
const SLOT_LINE_NAMES = ['TOP', 'MIDDLE', 'BOTTOM', 'DIAG ↘', 'DIAG ↖'];
const SLOT_LINE_DESC = ['Top row left-to-right', 'Middle row left-to-right', 'Bottom row left-to-right', 'Diagonal top-left to bottom-right', 'Diagonal bottom-left to top-right'];
const LINES = [
  [[0,0],[0,1],[0,2]], [[1,0],[1,1],[1,2]], [[2,0],[2,1],[2,2]],
  [[0,0],[1,1],[2,2]], [[2,0],[1,1],[0,2]]
];

const JACKPOT_COLORS = {
  mini: '#8248ff',
  minor: '#00b3ff',
  major: '#ff4d4d',
  grand: '#ff1744'
};

GameRenderers.renderSlots = function(details, multiplier, payout) {
  const display = document.getElementById('game-display-area');
  const grid = details.grid;
  const winLines = details.winningLines || [];
  const jackpot = details.jackpot || null;
  const jackpotPool = details.jackpotPool || null;
  const currency = (typeof window !== 'undefined' && window.__CASINO_CURRENCY) || 'GC';

  playSound('spin');

  let animGrid = grid.map(row => row.map(() => SLOT_SPIN_SYMBOLS[Math.floor(Math.random() * SLOT_SPIN_SYMBOLS.length)]));
  let col = 0;

  function renderDisplay() {
    let html = GameRenderers.slotsGridHTML(animGrid, null, false);
    if (jackpotPool) {
      html += '<div style="margin-top:12px;text-align:center;">';
      ['mini','minor','major','grand'].forEach(tier => {
        const jp = jackpotPool[tier];
        if (!jp) return;
        const label = tier.charAt(0).toUpperCase() + tier.slice(1);
        const color = JACKPOT_COLORS[tier];
        html += '<span style="display:inline-block;margin:0 6px;font-size:0.7rem;color:' + color + ';font-weight:700;">' +
          label + ': ' + Number(jp).toFixed(0) + ' ' + currency + '</span>';
      });
      html += '</div>';
    }
    display.innerHTML = html;
  }

  function spinColumn(colIdx) {
    return new Promise(resolve => {
      let ticks = 0;
      const maxTicks = 25 + colIdx * 8;
      const interval = setInterval(() => {
        animGrid.forEach((row, r) => {
          animGrid[r][colIdx] = SLOT_SPIN_SYMBOLS[Math.floor(Math.random() * SLOT_SPIN_SYMBOLS.length)];
          if (r === 1) animGrid[r][colIdx] = SLOT_SPIN_SYMBOLS[Math.floor(Math.random() * SLOT_SPIN_SYMBOLS.length)];
        });
        renderDisplay();
        ticks++;
        if (ticks >= maxTicks) {
          clearInterval(interval);
          animGrid.forEach((row, r) => { animGrid[r][colIdx] = grid[r][colIdx]; });
          playSound('chip');
          resolve();
        }
      }, Math.max(35, 80 - colIdx * 15));
    });
  }

  col = 0;
  (async function run() {
    for (let c = 0; c < 3; c++) {
      await spinColumn(c);
    }
    finish();
  })();

  function finish() {
    const hot = new Set();
    winLines.forEach(w => LINES[w.line].forEach(([r, c]) => hot.add(r + '-' + c)));
    let html = GameRenderers.slotsGridHTML(grid, hot, true);

    if (jackpot && jackpot.tier === 'grand') {
      html += '<div style="text-align:center;margin-top:16px;">' +
        '<div style="font-size:2.2rem;font-weight:900;color:#ff1744;">🎰 GRAND JACKPOT! 🎰</div>' +
        '<div style="color:#ff4d4d;font-size:1.1rem;font-weight:700;margin-top:4px;">' + jackpot.amount.toFixed(2) + ' ' + currency + '</div>' +
        '</div>';
      playSound('win');
    } else if (jackpot) {
      html += '<div style="text-align:center;margin-top:14px;">' +
        '<div style="font-size:1.4rem;font-weight:800;color:' + JACKPOT_COLORS[jackpot.tier] + ';">' +
        jackpot.tier.toUpperCase() + ' JACKPOT!</div>' +
        '<div style="color:#b1bad2;font-size:0.85rem;margin-top:2px;">' + jackpot.amount.toFixed(2) + ' ' + currency + '</div>' +
        '</div>';
      playSound('win');
    }

    if (winLines.length) {
      html += '<div style="text-align:center;margin-top:12px;font-weight:800;color:#00e701;font-size:1.1rem;">WIN ' + multiplier.toFixed(2) + 'x</div>';
      html += '<div style="margin-top:10px;">';
      winLines.forEach(w => {
        html += '<div style="display:flex;align-items:center;justify-content:center;gap:6px;margin-bottom:4px;">' +
          '<span style="background:var(--accent-gold);color:#000;font-size:0.65rem;font-weight:800;padding:2px 6px;border-radius:3px;">' + SLOT_LINE_NAMES[w.line] + '</span>' +
          '<span style="color:#b1bad2;font-size:0.8rem;">pays</span>' +
          '<span style="color:#00e701;font-weight:800;">' + w.multiplier.toFixed(2) + 'x</span>' +
          '</div>';
      });
      html += '</div>';
      playSound('win');
    } else if (!jackpot) {
      html += '<div style="text-align:center;margin-top:14px;color:#ff4d4d;font-weight:700;">No winning lines 💀</div>';
      playSound('loss');
    }

    if (jackpotPool) {
      html += '<div style="margin-top:12px;padding:8px;background:rgba(130,72,255,0.08);border-radius:8px;">';
      html += '<div style="text-align:center;font-weight:700;color:#8248ff;font-size:0.75rem;">PROGRESSIVE JACKPOTS</div>';
      html += '<div style="display:flex;justify-content:space-around;margin-top:4px;">';
      ['mini','minor','major','grand'].forEach(tier => {
        const jp = jackpotPool[tier];
        const color = JACKPOT_COLORS[tier];
        html += '<div style="text-align:center;">' +
          '<div style="color:' + color + ';font-size:0.65rem;font-weight:700;">' + tier.charAt(0).toUpperCase() + tier.slice(1) + '</div>' +
          '<div style="color:#fff;font-size:0.75rem;font-weight:700;">' + Number(jp).toFixed(0) + '</div>' +
          '</div>';
      });
      html += '</div></div>';
    }

    display.innerHTML = html;
  }
};

GameRenderers.slotsGridHTML = function(grid, hot, showLabels) {
  let html = '<div class="slots-reel-container">';
  const labels = ['1', '2', '3', '4', '5'];
  for (let r = 0; r < 3; r++) {
    html += '<div class="slots-reel-row">';
    for (let c = 0; c < 3; c++) {
      const sym = grid[r][c];
      const hotKey = r + '-' + c;
      const isHot = hot && hot.has(hotKey);
      const isSeven = sym === '7️⃣';
      const isBar = sym === '🔔';
      const isDiamond = sym === '💎';
      let bg = isSeven ? '#1a0a3d' : isBar ? '#14222d' : isDiamond ? '#1a0a3d' : '#1a2c38';
      let border = '1px solid #243542';
      let glow = 'none';
      if (isHot) { bg = '#00e701'; border = '2px solid #fff'; glow = '0 0 16px rgba(0,231,1,.6)'; }
      let symStyle = '';
      if (['🍒','🍋','🍇'].includes(sym)) symStyle = 'font-size:2rem;';
      else if (sym === '7️⃣') symStyle = 'font-size:2rem; filter:brightness(1.2) drop-shadow(0 0 6px #8248ff);';
      else if (sym === '💎') symStyle = 'font-size:2rem; filter:drop-shadow(0 0 6px #8248ff);';
      else symStyle = 'font-size:2.2rem;';
      html += '<div class="slot-reel" style="' + (isHot ? 'animation:hotTile 0.5s ease;' : '') +
        'background:' + bg + '; display:flex; align-items:center; justify-content:center; ' +
        'border-radius:8px; border:' + border + '; box-shadow:' + glow + '; min-width:56px; height:min(72px,16vw); padding:4px;">' +
        '<span style="' + symStyle + '">' + sym + '</span></div>';
    }
    html += '</div>';
  }

  if (showLabels && hot.size > 0) {
    html += '<div class="slots-payline-label" style="margin-top:10px;text-align:center;">';
    html += '<span style="background:var(--accent-gold);color:#000;font-size:0.65rem;font-weight:800;padding:2px 6px;border-radius:3px;">WINNING LINE</span>';
    html += '</div>';
  }

  html += '</div>';
  return html;
};
