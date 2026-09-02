window.GameRenderers = window.GameRenderers || {};

GameRenderers.crashHistory = [];

GameRenderers.renderCrash = function(details, win, payout) {
  const display = document.getElementById('game-display-area');
  const crashPoint = details.crashPoint;
  const target = details.target;
  const isWin = win;

  display.innerHTML =
    '<div class="crash-result" style="text-align:center;padding:24px;" id="crash-result">' +
    '<div style="font-size:3.5rem;font-weight:900;color:' + (isWin ? '#00e701' : '#ff4d4d') + ';margin-bottom:8px;">' + crashPoint.toFixed(2) + 'x ' + (isWin ? '✅' : '💥') + '</div>' +
    '<div style="color:#b1bad2;font-weight:600;">Cashout at ' + target.toFixed(2) + 'x</div>' +
    (isWin ? '<div style="color:#00e701;font-weight:700;margin-top:6px;">Paid ' + Number(payout).toFixed(2) + ' ' + state.currency + '</div>' : '<div style="color:#ff4d4d;font-weight:600;margin-top:6px;">You did not cash out in time</div>') +
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

  // Clear any prior interval
  if (state.crashIntervalHandle) {
    clearInterval(state.crashIntervalHandle);
    state.crashIntervalHandle = null;
  }
  state.crashCashOutEarly = false;
  state.crashAutoTarget = null;

  let currentMult = 1.00;
  const tickRate = 60;
  const tickMult = 0.015;
  let crashed = false;
  let hasCashedOut = false;

  display.innerHTML =
    '<div id="crash-game-container" style="text-align:center;padding:20px;">' +
    '<div id="crash-multiplier" style="font-size:3rem;font-weight:900;font-variant-numeric:tabular-nums;color:#00e701;line-height:1.1;">1.00x</div>' +
    '<div id="crash-rocket" style="font-size:4rem;margin:12px 0;transition:margin-top 0.2s ease;">🚀</div>' +
    '<div id="crash-target-ui" style="color:#b1bad2;font-size:0.85rem;margin-bottom:12px;">Auto-cashout at ' + target.toFixed(2) + 'x</div>' +
    '<canvas id="crash-canvas" width="320" height="180" style="background:#0b141e;border-radius:8px;border:1px solid #243542;margin-bottom:16px;"></canvas>' +
    '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">' +
    '<button class="game-btn-action" id="crash-stop-btn" onclick="stopCrashCashout()" style="background:var(--accent-green);color:#000;font-weight:800;padding:12px 22px;">CASH OUT NOW</button>' +
    '</div>' +
    '</div>';

  const targetEl = document.getElementById('crash-target-ui');
  const rocketEl = document.getElementById('crash-rocket');
  const multEl = document.getElementById('crash-multiplier');
  const stopBtn = document.getElementById('crash-stop-btn');
  const canvas = document.getElementById('crash-canvas');
  const ctx = canvas ? canvas.getContext('2d') : null;

  const points = [];
  const maxPoints = 200;

  function drawGraph() {
    if (!ctx) return;
    ctx.clearRect(0, 0, 320, 180);
    ctx.fillStyle = '#0b141e';
    ctx.fillRect(0, 0, 320, 180);

    if (points.length < 2) return;

    const maxVal = Math.max(crashPoint, target, 2) * 1.1;
    ctx.strokeStyle = isWin ? '#00e701' : (hasCashedOut ? '#00e701' : '#ff4d4d');
    ctx.lineWidth = 2;
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = (i / (points.length - 1)) * 320;
      const y = 170 - (p / maxVal) * 160;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    ctx.fillStyle = hasCashedOut ? '#00e701' : (crashed ? '#ff4d4d' : '#ffc700');
    const lastY = 170 - (points[points.length - 1] / maxVal) * 160;
    ctx.beginPath();
    ctx.arc(320, lastY, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  function finish(cashedOut) {
    if (state.crashIntervalHandle) {
      clearInterval(state.crashIntervalHandle);
      state.crashIntervalHandle = null;
    }
    if (rocketEl) rocketEl.textContent = cashedOut ? '✅' : '💥';
    if (multEl) multEl.textContent = crashPoint.toFixed(2) + 'x ' + (cashedOut ? '✓' : '💥');
    if (targetEl) targetEl.textContent = cashedOut ? ('Cashed out at ' + target.toFixed(2) + 'x ✓') : ('CRASHED at ' + crashPoint.toFixed(2) + 'x');
    if (stopBtn) {
      stopBtn.disabled = true;
      stopBtn.textContent = crashed ? 'CRASHED' : 'CASHED OUT';
      stopBtn.style.background = crashed ? '#ff4d4d' : '#00e701';
    }

    if (cashedOut) {
      const resultHTML = '<div id="crash-cashout-result" style="margin-top:14px;padding:10px 18px;border-radius:8px;font-weight:800;display:inline-block;' +
        'background:rgba(0,231,1,0.15);color:#00e701;">' +
        '✓ + ' + Number(payout).toFixed(2) + ' ' + state.currency +
        '</div>';
      const container = document.getElementById('crash-game-container');
      if (container) container.insertAdjacentHTML('beforeend', resultHTML);
      playSound('win');
    } else {
      playSound('loss');
    }
  }

  const interval = setInterval(() => {
    if (crashed) return;
    currentMult = parseFloat((currentMult + tickMult).toFixed(2));
    points.push(currentMult);
    if (points.length > maxPoints) points.shift();

    if (multEl) multEl.textContent = currentMult.toFixed(2) + 'x';
    if (rocketEl) rocketEl.style.marginTop = (Math.max(0, 60 - currentMult * 2)) + 'px';
    if (targetEl) targetEl.textContent = 'Auto-cashout at ' + target.toFixed(2) + 'x • Current: ' + currentMult.toFixed(2) + 'x';

    drawGraph();

    if (currentMult >= crashPoint) {
      crashed = true;
      hasCashedOut = false;
      finish(false);
      return;
    }
    if (currentMult >= target) {
      hasCashedOut = true;
      finish(true);
      return;
    }
  }, tickRate);

  state.crashIntervalHandle = interval;
};
