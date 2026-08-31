window.GameRenderers = window.GameRenderers || {};

GameRenderers.renderDice = function(details, win) {
  const display = document.getElementById('game-display-area');
  const roll = details.rolled;
  const target = details.target;
  const cond = details.condition || 'OVER';
  const winColor = '#00e701';
  const loseColor = '#ff4d4d';
  let zoneLeft, zoneWidth;
  if (cond === 'OVER') { zoneLeft = target; zoneWidth = 100 - target; }
  else { zoneLeft = 0; zoneWidth = target; }

  display.innerHTML = `
    <div class="dice-board" style="max-width:430px; margin:auto; text-align:center;">
      <div class="dice-result" style="font-size:3rem; font-weight:900; color:${win ? winColor : loseColor};">${roll.toFixed(2)}</div>
      <div class="dice-bar-container" style="position:relative; height:18px; border-radius:9px; margin:22px 0 26px; background:#14222d; border:1px solid #243542;">
        <div class="dice-zone" style="position:absolute; top:0; bottom:0; left:${zoneLeft}%; width:${zoneWidth}%; background:${win ? winColor : loseColor}; opacity:0.35; border-radius:9px;"></div>
        <div class="dice-marker" style="position:absolute; top:-6px; bottom:-6px; left:calc(${Math.min(99.2, Math.max(0, roll))}% - 2px); width:4px; background:#fff; border-radius:2px;"></div>
        <div class="dice-target-label" style="position:absolute; top:120%; left:${zoneLeft}%; transform:translateX(-50%); font-size:0.7rem; color:#b1bad2;">${target.toFixed(2)}</div>
      </div>
      <p class="dice-status" style="font-weight:700; color:${win ? winColor : loseColor};">${win ? 'WIN' : 'LOSS'}${win ? ' • ' + details.winChance.toFixed(2) + '% chance' : ''}</p>
    </div>`;
};
