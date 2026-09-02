window.GameRenderers = window.GameRenderers || {};

/**
 * STAKE GATES — 5×3 slots with 25 paylines, scatter free-spins, and 4 progressive
 * jackpots. Server returns the stopping grid; client animates the reels and
 * overlays win paylines.
 *
 * Data shape from server:
 *   details.grid           2-D array [row][col] of symbols
 *   details.winningLines   [{ line, matchCount, symbol, multiplier }]
 *   details.scatterCount   total scatter (⭐) symbols on screen
 *   details.freeSpinsTriggered   boolean
 *   details.freeSpinMode         boolean (true if this round was a free spin)
 */

const SLOT_SYMBOLS = ['🍒', '🍋', '🍇', '🔔', '💎', '7️⃣', '⭐'];
const SLOT_DISPLAY = SLOT_SYMBOLS;
const SLOT_PAYLINES = [
  [0,0,0,0,0], [1,1,1,1,1], [2,2,2,2,2],
  [0,1,2,1,0], [2,1,0,1,2],
  [1,0,1,2,1], [1,2,1,0,1],
  [0,0,1,2,2], [2,2,1,0,0],
  [0,1,1,1,2], [2,1,1,1,0],
  [0,1,0,1,0], [2,1,2,1,2],
  [0,0,0,1,2], [2,2,2,1,0],
  [0,0,1,0,0], [2,2,1,2,2],
  [0,1,2,0,1], [2,1,0,2,1],
  [1,0,0,0,1], [1,2,2,2,1],
  [0,2,2,2,0], [1,0,2,0,1], [1,2,0,2,1]
];
const REELS = 5;
const ROWS = 3;
const JACKPOT_COLORS = {
  mini:  '#8248ff',
  minor: '#00b3ff',
  major: '#ff4d4d',
  grand: '#ff1744'
};

function slotsShuffle(seed) {
  // Fisher–Yates with a deterministic seed (mulberry32)
  let t = seed >>> 0;
  function rng() { t |= 0; t = (t + 0x6D2B79F5) | 0; let r = Math.imul(t ^ (t >>> 15), 1 | t); r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r; return ((r ^ (r >>> 14)) >>> 0) / 4294967296; }
  const arr = SLOT_DISPLAY.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const k = Math.floor(rng() * (i + 1));
    [arr[i], arr[k]] = [arr[k], arr[i]];
  }
  return arr;
}

GameRenderers.renderSlots = function(details, multiplier, payout) {
  const display = document.getElementById('game-display-area');
  if (!display) return;
  const grid = details.grid;
  const winLines = details.winningLines || [];
  const scatterCount = details.scatterCount || 0;
  const freeSpinsTriggered = !!details.freeSpinsTriggered;
  const freeSpinsAwarded = details.freeSpinsAwarded || 0;
  const freeSpinMode = !!details.freeSpinMode;
  const jackpot = details.jackpot || null;
  const jackpotPool = details.jackpotPool || null;
  const currency = (typeof window !== 'undefined' && window.__CASINO_CURRENCY) || 'GC';

  playSound('spin');

  display.innerHTML = `
    <div class="slot-machine">
      <div class="slot-machine-frame">
        <div class="slot-machine-header">
          <div class="slot-machine-title">🎰 STAKE GATES</div>
          <div class="slot-machine-lights">
            <span class="slot-light light-green"></span>
            <span class="slot-light light-yellow"></span>
            <span class="slot-light light-red"></span>
          </div>
        </div>
        <div class="slot-freespins-banner ${freeSpinMode ? '' : 'hidden'}">
          🎉 FREE SPIN — 3× MULTIPLIER ACTIVE
        </div>
        <div class="slot-machine-window">
          <div class="slot-reels-container" id="slot-reels"></div>
          <div class="slot-payline-overlay" id="slot-paylines"></div>
        </div>
        <div class="slot-machine-footer">
          <div class="slot-credits">
            <span class="credits-label">CREDITS</span>
            <span class="credits-value" id="slot-credits">${formatCoins(state.balances[state.currency.toLowerCase()] || 0)}</span>
          </div>
          <div class="slot-win-display">
            <span class="win-label">WIN</span>
            <span class="win-value" id="slot-win-value">0.00</span>
          </div>
        </div>
      </div>
      <div class="slot-jackpots" id="slot-jackpots"></div>
    </div>
  `;

  if (jackpotPool) {
    const jackpotEl = document.getElementById('slot-jackpots');
    if (jackpotEl) {
      let jpHTML = '<div class="jackpot-bar">';
      ['mini','minor','major','grand'].forEach(tier => {
        const jp = jackpotPool[tier];
        if (jp == null) return;
        const color = JACKPOT_COLORS[tier];
        jpHTML += `
          <div class="jackpot-item">
            <span class="jackpot-tier" style="color:${color}">${tier.toUpperCase()}</span>
            <span class="jackpot-amount" style="color:${color}">${Number(jp).toFixed(0)}</span>
          </div>
        `;
      });
      jpHTML += '</div>';
      jackpotEl.innerHTML = jpHTML;
    }
  }

  // Build 5 reels
  const reelsContainer = document.getElementById('slot-reels');
  if (reelsContainer) {
    reelsContainer.innerHTML = '';
    for (let c = 0; c < REELS; c++) {
      const reel = document.createElement('div');
      reel.className = 'slot-reel';
      reel.id = 'reel-' + c;
      reel.innerHTML = '<div class="reel-strip" id="strip-' + c + '"></div>';
      reelsContainer.appendChild(reel);
    }
  }

  function animateReel(reelIndex, finalSymbols, duration) {
    return new Promise(resolve => {
      const strip = document.getElementById('strip-' + reelIndex);
      const reel = document.getElementById('reel-' + reelIndex);
      if (!strip || !reel) { resolve(); return; }

      reel.classList.add('spinning');
      reel.classList.remove('reel-stopped');

      // Build strip: 30 random symbols cycling, then the 3 final symbols
      const seed = (Date.now() + reelIndex * 1337) >>> 0;
      const stripArr = [];
      for (let i = 0; i < 30; i++) {
        stripArr.push(SLOT_DISPLAY[Math.floor(Math.random() * SLOT_DISPLAY.length)]);
      }
      finalSymbols.forEach(s => stripArr.push(s));

      const symbolHeight = 100;
      const totalHeight = stripArr.length * symbolHeight;

      strip.innerHTML = stripArr.map(s => `<div class="reel-symbol">${s}</div>`).join('');
      strip.style.height = totalHeight + 'px';

      const startTime = performance.now();
      function step(now) {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const easeOut = 1 - Math.pow(1 - progress, 3);
        const currentPos = easeOut * (totalHeight - (3 * symbolHeight));
        strip.style.transform = `translateY(-${currentPos}px)`;
        if (progress < 1) requestAnimationFrame(step);
        else {
          // Snap so the bottom three cells are the final symbols
          strip.style.transform = `translateY(-${totalHeight - (3 * symbolHeight)}px)`;
          reel.classList.remove('spinning');
          reel.classList.add('reel-stopped');
          playSound('chip');
          resolve();
        }
      }
      requestAnimationFrame(step);
    });
  }

  async function spin() {
    // Stop reels left-to-right with stagger
    const promises = [];
    for (let c = 0; c < REELS; c++) {
      const finalCol = [];
      for (let r = 0; r < ROWS; r++) finalCol.push(grid[r][c]);
      const duration = 1200 + + c * 250;
      promises.push(animateReel(c, finalCol, duration));
    }
    await Promise.all(promises);
    finish();
  }

  function finish() {
    // Mark winning cells
    const hot = new Set();
    winLines.forEach(w => {
      const line = SLOT_PAYLINES[w.line];
      if (!line) return;
      line.forEach((rowIdx, col) => hot.add(rowIdx + '-' + col));
    });

    // Overlay paylines (drawn as SVG)
    const paylineEl = document.getElementById('slot-paylines');
    if (paylineEl && winLines.length > 0) {
      const colSpacing = 100 / REELS;
      const rowSpacing = 100 / ROWS;
      let svg = `<svg class="payline-svg" viewBox="0 0 100 100" preserveAspectRatio="none">`;
      winLines.forEach((w, idx) => {
        const line = SLOT_PAYLINES[w.line];
        if (!line) return;
        const color = ['#ffd700', '#00ff41', '#00b4ff', '#a855f7'][idx % 4];
        const points = line.map((rowIdx, col) => {
          const x = col * colSpacing + colSpacing / 2;
          const y = rowIdx * rowSpacing + rowSpacing / 2;
          return `${x},${y}`;
        }).join(' ');
        svg += `<polyline points="${points}" stroke="${color}" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 0 6px ${color});"><animate attributeName="stroke-dasharray" values="0 200;200 0" dur="1.2s" /></polyline>`;
      });
      svg += '</svg>';
      paylineEl.innerHTML = svg;
    }

    // Glow the matching cells
    document.querySelectorAll('.slot-reel').forEach((reelEl, col) => {
      for (let row = 0; row < ROWS; row++) {
        const cell = reelEl.children[row];
        if (cell && hot.has(row + '-' + col)) {
          cell.classList.add('winning');
        }
      }
    });

    // Win display
    if (winLines.length || scatterCount >= 3 || jackpot) {
      const winDisplay = document.getElementById('slot-win-value');
      if (winDisplay) {
        winDisplay.textContent = multiplier.toFixed(2) + 'x';
        winDisplay.parentElement.classList.add('win-active');
      }
    }

    // Big-win info banner
    if (winLines.length) {
      const winLineText = winLines.length === 1
        ? `${winLines[0].matchCount}× ${winLines[0].symbol}`
        : `${winLines.length} LINES`;
      display.insertAdjacentHTML('beforeend', `
        <div class="slot-win-info">
          <div class="win-amount">${winLineText}</div>
          <div class="win-payout">+${payout.toFixed(2)} ${currency}</div>
        </div>
      `);
      playSound('win');
    } else if (!jackpot && !scatterCount) {
      playSound('loss');
    }

    // Free-spin notification
    if (freeSpinsTriggered) {
      display.insertAdjacentHTML('beforeend', `
        <div class="slot-bonus-overlay">
          <div class="bonus-title">⭐ ${scatterCount} SCATTERS!</div>
          <div class="bonus-sub">${freeSpinsAwarded} FREE SPINS awarded (3× multiplier)</div>
        </div>
      `);
      playSound('win');
    }

    // Jackpot celebration
    if (jackpot) {
      display.insertAdjacentHTML('beforeend', `
        <div class="jackpot-celebration ${jackpot.tier}">
          <div class="jackpot-text">${jackpot.tier === 'grand' ? '🎰 ' : ''}${jackpot.tier.toUpperCase()} JACKPOT!${jackpot.tier === 'grand' ? ' 🎰' : ''}</div>
          <div class="jackpot-amount">${jackpot.amount.toFixed(2)} ${currency}</div>
        </div>
      `);
      playSound('win');
    }

    state.isProcessing = false;
    const actionBtn = document.getElementById('btn-primary-action');
    if (actionBtn) actionBtn.disabled = false;
  }

  spin();
};