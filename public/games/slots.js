window.GameRenderers = window.GameRenderers || {};

const SLOT_SPIN_SYMBOLS = ['🍒', '🍋', '🍇', '🔔', '💎', '7️⃣', '⭐', '🎰'];
const SLOT_LINE_NAMES = ['TOP', 'MIDDLE', 'BOTTOM', 'DIAG ↘', 'DIAG ↖'];
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
  const bonusTriggered = details.bonusTriggered || false;
  const currency = (typeof window !== 'undefined' && window.__CASINO_CURRENCY) || 'GC';

  playSound('spin');

  const machineHTML = `
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

        <div class="slot-machine-window">
          <div class="slot-reels-container" id="slot-reels">
            <div class="slot-reel" id="reel-0">
              <div class="reel-strip" id="strip-0"></div>
            </div>
            <div class="slot-reel" id="reel-1">
              <div class="reel-strip" id="strip-1"></div>
            </div>
            <div class="slot-reel" id="reel-2">
              <div class="reel-strip" id="strip-2"></div>
            </div>
          </div>

          <div class="slot-payline-overlay" id="slot-paylines"></div>
        </div>

        <div class="slot-machine-footer">
          <div class="slot-credits">
            <span class="credits-label">CREDITS</span>
            <span class="credits-value" id="slot-credits">${formatCoins(state.balances[state.currency.toLowerCase()] || 0)}</span>
          </div>
          <div class="slot-win-display" id="slot-win-display">
            <span class="win-label">WIN</span>
            <span class="win-value" id="slot-win-value">0.00</span>
          </div>
        </div>
      </div>
    </div>

    <div class="slot-jackpots" id="slot-jackpots"></div>
  `;

  display.innerHTML = machineHTML;

  if (jackpotPool) {
    const jackpotEl = document.getElementById('slot-jackpots');
    if (jackpotEl) {
      let jpHTML = '<div class="jackpot-bar">';
      ['mini','minor','major','grand'].forEach(tier => {
        const jp = jackpotPool[tier];
        if (!jp) return;
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

  function getRandomSymbol() {
    return SLOT_SPIN_SYMBOLS[Math.floor(Math.random() * SLOT_SPIN_SYMBOLS.length)];
  }

  function createReelStrip(targetSymbol, extraCount = 20) {
    const symbols = [];
    for (let i = 0; i < extraCount; i++) {
      symbols.push(getRandomSymbol());
    }
    symbols.push(targetSymbol);
    return symbols;
  }

  function animateReel(reelIndex, finalSymbol, duration) {
    return new Promise(resolve => {
      const strip = document.getElementById('strip-' + reelIndex);
      const reel = document.getElementById('reel-' + reelIndex);
      if (!strip || !reel) {
        resolve();
        return;
      }

      reel.classList.add('spinning');
      reel.classList.remove('reel-stopped');

      const symbols = createReelStrip(finalSymbol);
      const symbolHeight = 100;
      const totalHeight = symbols.length * symbolHeight;

      strip.innerHTML = symbols.map(s => `
        <div class="reel-symbol">${s}</div>
      `).join('');

      strip.style.height = totalHeight + 'px';
      reel.style.overflow = 'hidden';

      const startTime = performance.now();
      const spinDuration = duration;

      function animate(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / spinDuration, 1);

        const easeOut = 1 - Math.pow(1 - progress, 3);
        const currentPos = easeOut * totalHeight;

        strip.style.transform = `translateY(-${currentPos}px)`;

        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          strip.style.transform = `translateY(-${totalHeight - symbolHeight}px)`;
          reel.classList.remove('spinning');
          reel.classList.add('reel-stopped');
          playSound('chip');
          resolve();
        }
      }

      requestAnimationFrame(animate);
    });
  }

  async function spinReels() {
    const durations = [1500, 2000, 2500];

    const promises = [];
    for (let col = 0; col < 3; col++) {
      const finalSymbol = grid[1][col];
      promises.push(animateReel(col, finalSymbol, durations[col]));
    }

    await Promise.all(promises);
    finish();
  }

  function finish() {
    const hot = new Set();
    winLines.forEach(w => LINES[w.line].forEach(([r, c]) => hot.add(r + '-' + c)));

    const paylineEl = document.getElementById('slot-paylines');
    if (paylineEl && hot.size > 0) {
      let svgHTML = '<svg class="payline-svg" viewBox="0 0 100 100" preserveAspectRatio="none">';
      winLines.forEach(w => {
        const line = LINES[w.line];
        if (!line || line.length < 2) return;
        const color = '#ffd700';
        const points = line.map(([r, c]) => {
          const x = (c / 2) * 100 + (100 / 6);
          const y = (r / 2) * 100 + (100 / 6);
          return `${x},${y}`;
        }).join(' ');
        svgHTML += `<polyline points="${points}" stroke="${color}" fill="none" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 0 6px ${color});" />`;
      });
      svgHTML += '</svg>';
      paylineEl.innerHTML = svgHTML;
    }

    if (bonusTriggered) {
      const bonusHTML = `
        <div class="slot-bonus-overlay">
          <div class="bonus-title">FREE SPINS!</div>
          <div class="bonus-sub">3+ Scatter symbols triggered 10 free spins</div>
        </div>
      `;
      display.innerHTML += bonusHTML;
      playSound('win');
    }

    if (jackpot && jackpot.tier === 'grand') {
      display.innerHTML += `
        <div class="jackpot-celebration grand">
          <div class="jackpot-text">🎰 GRAND JACKPOT! 🎰</div>
          <div class="jackpot-amount">${jackpot.amount.toFixed(2)} ${currency}</div>
        </div>
      `;
      playSound('win');
    } else if (jackpot) {
      display.innerHTML += `
        <div class="jackpot-celebration ${jackpot.tier}">
          <div class="jackpot-text">${jackpot.tier.toUpperCase()} JACKPOT!</div>
          <div class="jackpot-amount">${jackpot.amount.toFixed(2)} ${currency}</div>
        </div>
      `;
      playSound('win');
    }

    if (winLines.length) {
      const winDisplay = document.getElementById('slot-win-value');
      if (winDisplay) {
        winDisplay.textContent = multiplier.toFixed(2) + 'x';
        winDisplay.parentElement.classList.add('win-active');
      }

      display.innerHTML += `
        <div class="slot-win-info">
          <div class="win-amount">WIN ${multiplier.toFixed(2)}x</div>
          <div class="win-payout">+${payout.toFixed(2)} ${currency}</div>
        </div>
      `;
      playSound('win');
    } else if (!jackpot && !bonusTriggered) {
      const winDisplay = document.getElementById('slot-win-value');
      if (winDisplay) {
        winDisplay.textContent = '0.00';
      }
      playSound('loss');
    }

    state.isProcessing = false;
    const actionBtn = document.getElementById('btn-primary-action');
    if (actionBtn) actionBtn.disabled = false;
  }

  spinReels();
};

GameRenderers.slotsGridHTML = function(grid, hot, showLabels) {
  return '<div class="slots-reel-container"></div>';
};
