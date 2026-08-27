window.GameRenderers = window.GameRenderers || {};

GameRenderers.crashHistory = [];

GameRenderers.renderCrash = function(details, win, payout) {
  const display = document.getElementById('game-display-area');
  const crashPoint = details.crashPoint;
  const target = details.target;
  const isWin = win;

  const crashEmoji = isWin ? '✅' : '💥';
  const crashColor = isWin ? '#00e701' : '#ff4d4d';

  display.innerHTML =
    '<div style="text-align:center;padding:24px;" id="crash-result">' +
    '<div style="font-size:3.5rem;font-weight:900;color:' + crashColor + ';margin-bottom:8px;">' + crashPoint.toFixed(2) + 'x ' + crashEmoji + '</div>' +
    '<div style="color:#b1bad2;font-weight:600;">Cashout at ' + target.toFixed(2) + 'x</div>' +
    (isWin ? '<div style="color:' + crashColor + ';font-weight:700;margin-top:6px;">Paid ' + Number(payout).toFixed(2) + ' ' + state.currency + '</div>' : '<div style="color:#ff4d4d;font-weight:600;margin-top:6px;">You did not cash out in time</div>') +
    '</div>';

  GameRenderers.addCrashHistory(crashPoint);

  if (isWin) playSound('win'); else playSound('loss');
};

GameRenderers.addCrashHistory = function(point) {
  const entry = {
    point: point.toFixed(2),
    timestamp: Date.now(),
    isWin: point >= 2.0
  };
  GameRenderers.crashHistory.unshift(entry);
  GameRenderers.crashHistory = GameRenderers.crashHistory.slice(0, 15);
  GameRenderers.renderCrashHistory();
};

GameRenderers.renderCrashHistory = function() {
  const container = document.getElementById('crash-history-panel');
  if (!container || !GameRenderers.crashHistory.length) return;

  let html = '';
  GameRenderers.crashHistory.slice(0, 10).forEach((entry, i) => {
    const color = parseFloat(entry.point) < 2 ? '#ff4d4d' : '#00e701';
    const isCrash = parseFloat(entry.point) < 2;
    html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">' +
      '<span style="color:#b1bad2;font-size:0.75rem;min-width:60px;">#' + (i + 1) + '</span>' +
      '<span style="font-family:monospace;font-weight:700;color:' + color + '">' + entry.point + 'x</span>' +
      '<span style="color:#557086;font-size:0.7rem;flex:1;text-align:right;">' + (isCrash ? '💥' : '✅') + '</span>' +
      '</div>';
  });
  container.innerHTML = html;
};

GameRenderers.renderCrashGame = function(details, win, payout) {
  const display = document.getElementById('game-display-area');
  const crashPoint = details.crashPoint;
  const target = details.target;
  const isWin = win;

  let currentMult = 1.00;
  const tickRate = 50;
  const tickMult = 0.02;
  let crashed = false;
  let hasCashedOut = false;

  const rocketStates = ['🚀', '🛸', '🌌'];

  display.innerHTML =
    '<div id="crash-game-container" style="text-align:center;padding:20px;">' +
    '<div id="crash-multiplier" style="font-size:2.5rem;font-weight:900;font-variant-numeric:tabular-nums; color:#00e701;">1.00x</div>' +
    '<div id="crash-rocket" style="font-size:4rem;margin:20px 0;transition:margin-top 0.2s ease;">🚀</div>' +
    '<div id="crash-target-ui" style="color:#b1bad2;font-size:0.85rem;margin-bottom:16px;">Cashout at ' + target.toFixed(2) + 'x • Tap STOP below</div>' +
    '<div style="display:flex;gap:8px;justify-content:center;">' +
    '<button class="game-btn-action" id="crash-stop-btn" onclick="stopCrashCashout()" style="background:var(--accent-green);color:#000;">STOP — CASHOUT AT ' + target.toFixed(2) + 'x</button>' +
    '<button class="game-btn-action" id="crash-auto-btn" onclick="autoCrashCashout()" style="background:var(--bg-card);color:var(--text-secondary);">AUTO</button>' +
    '</div>' +
    '</div>';

  const targetEl = document.getElementById('crash-target-ui');
  const rocketEl = document.getElementById('crash-rocket');
  const multEl = document.getElementById('crash-multiplier');
  const stopBtn = document.getElementById('crash-stop-btn');

  state.crashTickHandle = 0;
  state.crashCashOutEarly = false;

  const interval = setInterval(() => {
    if (crashed) return;
    currentMult = parseFloat((currentMult + tickMult).toFixed(2));
    if (multEl) multEl.textContent = currentMult.toFixed(2) + 'x';
    if (rocketEl) rocketEl.style.marginTop = (20 - Math.min(20, currentMult * 2)) + 'px';
    if (targetEl) targetEl.textContent = 'Cashout at ' + target.toFixed(2) + 'x • Current: ' + currentMult.toFixed(2) + 'x';

    if (currentMult >= crashPoint) {
      crashed = true;
      clearInterval(interval);
      finishCrashGame(crashPoint, target, payout, isWin, details, multEl, rocketEl, targetEl, stopBtn);
    }
    if (state.crashCashOutEarly && currentMult >= target) {
      hasCashedOut = true;
      clearInterval(interval);
      finishCrashGame(crashPoint, target, payout, isWin, details, multEl, rocketEl, targetEl, stopBtn, true);
    }
  }, tickRate);

  state.crashIntervalHandle = interval;
};

function finishCrashGame(crashPoint, target, payout, win, details, multEl, rocketEl, targetEl, stopBtn, cashedOut) {
  if (rocketEl) rocketEl.textContent = '💥';
  if (multEl) multEl.textContent = crashPoint.toFixed(2) + 'x 💥';
  if (targetEl) targetEl.textContent = (cashedOut ? 'Cashed out at ' + target.toFixed(2) + 'x ✓' : 'CRASHED at ' + crashPoint.toFixed(2) + 'x');
  if (stopBtn) stopBtn.disabled = true;

  const container = document.getElementById('crash-game-container');
  if (container) {
    const resultHTML = '<div id="crash-cashout-result" style="margin-top:14px;padding:8px 16px;border-radius:8px;font-weight:700;display:inline-block;' +
      'background:' + (win ? 'rgba(0,231,1,0.15)' : 'rgba(255,77,77,0.15)') + ';' +
      'color:' + (win ? '#00e701' : '#ff4d4d') + ';">' +
      (win ? '+ ' + Number(payout).toFixed(2) + ' ' + state.currency + ' ✓' : 'BUST — did not cash out') +
      '</div>';
    container.insertAdjacentHTML('beforeend', resultHTML);
  }

  GameRenderers.addCrashHistory(crashPoint);
  if (win) playSound('win'); else playSound('loss');
}

function stopCrashCashout() {
  state.crashCashOutEarly = true;
  playSound('click');
}

function autoCrashCashout() {
  const current = parseFloat(document.getElementById('crash-multiplier')?.textContent || '1.00');
  const newTarget = prompt('Set auto-cashout multiplier:', '2.00');
  if (newTarget) {
    state.crashAutoTarget = parseFloat(newTarget);
    playSound('click');
  }
}
