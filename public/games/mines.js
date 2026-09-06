window.GameRenderers = window.GameRenderers || {};

GameRenderers.renderMinesBoard = function() {
  const display = document.getElementById('game-display-area');
  const ags = state.activeGameState;
  if (!ags) return;

  const totalTiles = 25;
  const mineCount = ags.mineCount || 3;
  const board = ags.board || Array(totalTiles).fill('GEM');
  const revealedTiles = ags.revealedTiles || [];

  let html = '<div class="mines-board" id="mines-board">';
  for (let i = 0; i < totalTiles; i++) {
    const revealed = revealedTiles.includes(i);
    const isBomb = board[i] === 'BOMB';
    let cls = 'mine-tile';
    let sym = '?';
    if (revealed) {
      if (isBomb) { cls += ' mine'; sym = '💣'; }
      else { cls += ' gem'; sym = '💎'; }
    }
    html += `<div class="${cls}" ${revealed ? '' : 'onclick="revealMineTile(' + i + ')"'}>${sym}</div>`;
  }
  html += '</div>';
  let multHTML = '<div class="mines-multiplier">Multiplier: ' + (ags.currentMultiplier || 1.0).toFixed(2) + 'x</div>';
  document.getElementById('game-display-area').innerHTML = html + multHTML;
};

GameRenderers.renderMinesLoss = function(data) {
  const display = document.getElementById('game-display-area');
  const ags = state.activeGameState;
  const hitTile = data.hitTileIndex || 0;

  const totalTiles = 25;
  const board = data.board || ags.board || Array(totalTiles).fill('GEM');
  const revealedTiles = ags.revealedTiles || [];

  let html = '<div class="mines-board" id="mines-board">';
  for (let i = 0; i < totalTiles; i++) {
    const revealed = revealedTiles.includes(i) || i === hitTile;
    const isBomb = board[i] === 'BOMB';
    let cls = 'mine-tile';
    let sym = '?';
    if (revealed || isBomb) {
      if (isBomb) { cls += ' mine'; sym = '💣'; }
      else { cls += ' gem'; sym = '💎'; }
    }
    html += `<div class="${cls}">${sym}</div>`;
  }
  html += '</div>';

  html += '<div class="mines-result loss">' +
    '<div class="mines-result-title">💥 BOMB HIT 💥</div>' +
    '<div class="mines-result-sub">Revealed ' + revealedTiles.length + ' safe tiles before the bomb</div>' +
    '</div>';

  document.getElementById('game-display-area').innerHTML = html;
  playSound('loss');
};

GameRenderers.renderMinesWin = function(data) {
  const display = document.getElementById('game-display-area');
  const ags = state.activeGameState;

  const totalTiles = 25;
  const revealedTiles = ags.revealedTiles || [];

  let html = '<div class="mines-board" id="mines-board">';
  for (let i = 0; i < totalTiles; i++) {
    const revealed = revealedTiles.includes(i);
    let cls = 'mine-tile';
    let sym = '💣';
    if (revealed) { cls += ' gem'; sym = '💎'; }
    html += `<div class="${cls}">${sym}</div>`;
  }
  html += '</div>';

  html += '<div class="mines-result win">' +
    '<div class="mines-result-title">✅ BOARD CLEARED ✅</div>' +
    '<div class="mines-result-sub">Multiplier: ' + data.multiplier.toFixed(2) + 'x</div>' +
    '<div class="mines-result-payout">Paid ' + Number(data.payout).toFixed(2) + ' ' + state.currency + '</div>' +
    '</div>';

  document.getElementById('game-display-area').innerHTML = html;
  playSound('win');
};
