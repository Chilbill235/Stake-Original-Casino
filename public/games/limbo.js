window.GameRenderers = window.GameRenderers || {};

GameRenderers.renderLimbo = function(finalResult, win, payout, targetMultiplier) {
  const display = document.getElementById('game-display-area');
  const winProb = ((1 / targetMultiplier) * 100).toFixed(2);
  let current = 1.00;
  const duration = 1200;
  const startTime = performance.now();

  display.innerHTML = `
    <div class="limbo-board">
      <div class="limbo-display">
        <div class="limbo-multiplier" id="limbo-mult">1.00x</div>
        <div class="limbo-target">Target: ${targetMultiplier.toFixed(2)}x</div>
      </div>
      <div class="limbo-probability">
        <div class="prob-bar">
          <div class="prob-fill" style="width:${Math.min(100, winProb)}%"></div>
        </div>
        <div class="prob-label">Win chance: ${winProb}%</div>
      </div>
    </div>`;

  const multEl = document.getElementById('limbo-mult');

  function animate(now) {
    const elapsed = now - startTime;
    const progress = Math.min(1, elapsed / duration);
    current = 1.00 + (finalResult - 1.00) * GameRenderers.easeOutCubic(progress);

    if (multEl) {
      multEl.textContent = current.toFixed(2) + 'x';
      multEl.style.color = progress === 1 ? (win ? '#00e701' : '#ff4d4d') : '#fff';
    }

    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      finishLimbo();
    }
  }

  requestAnimationFrame(animate);

  function finishLimbo() {
    let html = '<div class="limbo-board">';
    html += '<div class="limbo-display">';
    html += '<div class="limbo-multiplier ' + (win ? 'limbo-win' : 'limbo-loss') + '">' + finalResult.toFixed(2) + 'x ' + (win ? '✅' : '💥') + '</div>';
    html += '<div class="limbo-result-detail">' + (win ? '+' + Number(payout).toFixed(2) + ' ' + state.currency : 'BUST') + '</div>';
    html += '</div>';

    if (GameRenderers.limboHistory && GameRenderers.limboHistory.length > 0) {
      html += '<div class="limbo-history">';
      GameRenderers.limboHistory.slice(0, 10).forEach(entry => {
        html += '<div class="limbo-history-item ' + (entry.win ? 'lh-win' : 'lh-loss') + '">' + entry.value.toFixed(2) + 'x</div>';
      });
      html += '</div>';
    }

    html += '</div>';
    display.innerHTML = html;

    if (win) playSound('win'); else playSound('loss');

    setTimeout(() => {
      updateWalletUI();
    }, 100);
  }
};

GameRenderers.easeOutCubic = function(t) {
  return 1 - Math.pow(1 - t, 3);
};

GameRenderers.addLimboHistory = function(value, win) {
  if (!GameRenderers.limboHistory) GameRenderers.limboHistory = [];
  GameRenderers.limboHistory.unshift({ value, win, time: Date.now() });
  GameRenderers.limboHistory = GameRenderers.limboHistory.slice(0, 10);
};
