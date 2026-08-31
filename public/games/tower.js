window.GameRenderers = window.GameRenderers || {};

GameRenderers.renderTower = function() {
  const display = document.getElementById('game-display-area');
  const ags = state.activeGameState;
  if (!ags) return;

  const tiles = ags.tilesPerFloor || 3;
  const difficulty = ags.difficulty || 'MEDIUM';
  const diffLabel = { EASY: 'Easy (2 tiles)', MEDIUM: 'Medium (3 tiles)', HARD: 'Hard (2 tiles)' }[difficulty] || 'Medium';

  let html = '<div class="tower-board">';
  html += '<div class="tower-header">';
  html += '<div class="tower-title">Tower</div>';
  html += '<div class="tower-difficulty">' + diffLabel + '</div>';
  html += '</div>';

  html += '<div class="tower-progress">';
  html += '<div class="tower-progress-bar"><div class="tower-progress-fill" style="width:' + (ags.currentFloor / 8 * 100) + '%"></div></div>';
  html += '<div class="tower-floor">Floor ' + ags.currentFloor + ' / 8</div>';
  html += '</div>';

  html += '<div class="tower-multiplier">Multiplier: <span>' + (ags.currentMultiplier || 1.0).toFixed(2) + 'x</span></div>';

  for (let floor = 0; floor < 8; floor++) {
    const isCurrent = floor === ags.currentFloor;
    const isPassed = floor < ags.currentFloor;
    html += '<div class="tower-floor-row" style="opacity:' + (isCurrent || isPassed ? '1' : '0.4') + ';">';
    for (let tile = 0; tile < tiles; tile++) {
      let cls = 'tower-tile';
      if (isPassed) cls += ' tower-tile-passed';
      else if (isCurrent) cls += ' tower-tile-current';
      else cls += ' tower-tile-hidden';
      html += `<button class="${cls}" ${isCurrent ? `onclick="pickTowerTile(${floor}, ${tile})"` : 'disabled'}>${isPassed ? '✓' : isCurrent ? '?' : '?'}</button>`;
    }
    html += '</div>';
  }

  html += '</div>';
  display.innerHTML = html;
};
