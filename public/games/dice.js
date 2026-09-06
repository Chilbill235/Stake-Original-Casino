window.GameRenderers = window.GameRenderers || {};

GameRenderers.renderDice = function(details, win) {
  const display = document.getElementById('game-display-area');
  const roll = details.rolled;
  const target = details.target;
  const cond = details.condition || 'OVER';
  let zoneLeft, zoneWidth;
  if (cond === 'OVER') { zoneLeft = target; zoneWidth = 100 - target; }
  else { zoneLeft = 0; zoneWidth = target; }

  display.innerHTML = `
    <div class="dice-board">
      <div class="dice-result ${win ? 'win' : 'lose'}">${roll.toFixed(2)}</div>
      <div class="dice-bar-container">
        <div class="dice-zone ${win ? 'win' : 'lose'}" style="left:${zoneLeft}%; width:${zoneWidth}%;"></div>
        <div class="dice-marker" style="left:calc(${Math.min(99.2, Math.max(0, roll))}% - 2px);"></div>
        <div class="dice-target-label">${target.toFixed(2)}</div>
      </div>
      <p class="dice-status ${win ? 'win' : 'lose'}">${win ? 'WIN' : 'LOSS'}${win ? ' • ' + details.winChance.toFixed(2) + '% chance' : ''}</p>
    </div>`;
};
