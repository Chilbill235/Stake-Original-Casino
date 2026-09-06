window.GameRenderers = window.GameRenderers || {};

GameRenderers.crashHistory = [];

GameRenderers.renderCrash = function(details, win, payout) {
  const display = document.getElementById('game-display-area');
  const crashPoint = details.crashPoint;
  const target = details.target;
  const isWin = win;

  display.innerHTML =
    '<div class="crash-result" id="crash-result">' +
    '<div class="crash-multiplier ' + (isWin ? 'win' : 'lose') + '">' + crashPoint.toFixed(2) + 'x ' + (isWin ? '✅' : '💥') + '</div>' +
    '<div class="crash-detail">Cashout at ' + target.toFixed(2) + 'x</div>' +
    (isWin ? '<div class="crash-payout">Paid ' + Number(payout).toFixed(2) + ' ' + state.currency + '</div>' : '<div class="crash-message">You did not cash out in time</div>') +
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

  let html = '<div class="crash-history-list">';
  GameRenderers.crashHistory.slice(0, 10).forEach((entry, i) => {
    const color = parseFloat(entry.point) < 2 ? '#ff4d4d' : '#00e701';
    const isCrash = parseFloat(entry.point) < 2;
    html += '<div class="crash-history-item">' +
      '<span class="crash-history-num">#' + (i + 1) + '</span>' +
      '<span class="crash-history-point" style="color:' + color + '">' + entry.point + 'x</span>' +
      '<span class="crash-history-icon">' + (isCrash ? '💥' : '✅') + '</span>' +
      '</div>';
  });
  html += '</div>';
  container.innerHTML = html;
};

GameRenderers.renderCrashGame = function(details, win, payout) {
  const display = document.getElementById('game-display-area');
  const crashPoint = details.crashPoint;
  const target = details.target;
  const isWin = win;

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
    '<div id="crash-game-container" class="crash-game">' +
    '<div id="crash-multiplier" class="crash-multiplier">1.00x</div>' +
    '<div id="crash-rocket" class="crash-rocket">🚀</div>' +
    '<div id="crash-target-ui" class="crash-target-ui">Auto-cashout at ' + target.toFixed(2) + 'x</div>' +
    '<canvas id="crash-canvas" width="320" height="180" class="crash-canvas"></canvas>' +
    '<div class="crash-actions">' +
    '<button class="game-btn-action crash-cashout-btn" id="crash-stop-btn" onclick="stopCrashCashout()">CASH OUT NOW</button>' +
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
      stopBtn.classList.add(crashed ? 'crash-crashed' : 'crash-cashedout');
    }

    if (cashedOut) {
      const resultHTML = '<div class="crash-cashout-result">' +
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
