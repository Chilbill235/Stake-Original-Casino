window.GameRenderers = window.GameRenderers || {};

GameRenderers.renderMinesBoard = function() {
  const display = document.getElementById('game-display-area');
  const ags = state.activeGameState;
  if (!ags) return;

  const totalTiles = 25;
  const mineCount = ags.mineCount || 3;
  const board = ags.board || Array(totalTiles).fill('GEM');
  const revealedTiles = ags.revealedTiles || [];

  let html = '<div style="display:grid; grid-template-columns: repeat(5, minmax(44px, 1fr)); gap:6px; max-width:260px; margin:auto;" id="mines-board">';
  for (let i = 0; i < totalTiles; i++) {
    const revealed = revealedTiles.includes(i);
    const isBomb = board[i] === 'BOMB';
    let bg = '#14222d';
    let sym = '?';
    let color = '#fff';
    let border = '1px solid #243542';
    let glow = 'none';
    if (revealed) {
      if (isBomb) { bg = '#ff4d4d'; sym = '💣'; color = '#fff'; }
      else { bg = '#00e701'; sym = '💎'; color = '#000'; glow = '0 0 8px rgba(0,231,1,.5)'; }
    }
    html += `<div style="background:${bg}; color:${color}; padding:4px; border-radius:4px; font-weight:600; font-size:1rem; cursor:${revealed ? 'default' : 'pointer'}; text-align:center; border:${border}; box-shadow:${glow};" onclick="${revealed ? '' : 'revealMineTile(' + i + ')'}">${sym}</div>`;
  }
  html += '</div>';
  let multHTML = '<div style="text-align:center;margin-top:14px;font-size:1.2rem;font-weight:700;color:#00e701;">' +
    'Multiplier: ' + (ags.currentMultiplier || 1.0).toFixed(2) + 'x</div>';
  document.getElementById('game-display-area').innerHTML = html + multHTML;
};

GameRenderers.renderMinesLoss = function(data) {
  const display = document.getElementById('game-display-area');
  const ags = state.activeGameState;
  const hitTile = data.hitTileIndex || 0;

  const totalTiles = 25;
  const board = data.board || ags.board || Array(totalTiles).fill('GEM');
  const revealedTiles = ags.revealedTiles || [];

  let html = '<div style="display:grid; grid-template-columns: repeat(5, minmax(44px, 1fr)); gap:6px; max-width:260px; margin:auto;" id="mines-board">';
  for (let i = 0; i < totalTiles; i++) {
    const revealed = revealedTiles.includes(i) || i === hitTile;
    const isBomb = board[i] === 'BOMB';
    let bg = '#14222d';
    let sym = '?';
    let color = '#fff';
    let border = '2px solid #243542';
    let glow = 'none';
    if (revealed || isBomb) {
      if (isBomb) { bg = '#ff4d4d'; sym = '💣'; color = '#fff'; glow = '0 0 12px rgba(255,77,77,.5)'; }
      else { bg = '#00e701'; sym = '💎'; color = '#000'; }
    }
    html += `<div style="background:${bg}; color:${color}; padding:4px; border-radius:4px; font-weight:600; font-size:1.1rem; text-align:center; border:${border}; box-shadow:${glow};">${sym}</div>`;
  }
  html += '</div>';

  html += '<div style="text-align:center;margin-top:14px;">' +
    '<div style="font-size:2rem;font-weight:900;color:#ff4d4d;">💥 BOMB HIT 💥</div>' +
    '<div style="color:#b1bad2;font-size:0.9rem;margin-top:6px;">Revealed ' + revealedTiles.length + ' safe tiles before the bomb</div>' +
    '</div>';

  document.getElementById('game-display-area').innerHTML = html;
  playSound('loss');
};

GameRenderers.renderMinesWin = function(data) {
  const display = document.getElementById('game-display-area');
  const ags = state.activeGameState;

  const totalTiles = 25;
  const revealedTiles = ags.revealedTiles || [];

  let html = '<div style="display:grid; grid-template-columns: repeat(5, minmax(44px, 1fr)); gap:6px; max-width:260px; margin:auto;" id="mines-board">';
  for (let i = 0; i < totalTiles; i++) {
    const revealed = revealedTiles.includes(i);
    let bg = '#00e701';
    let sym = '💎';
    let color = '#000';
    if (revealed) {
      html += `<div style="background:${bg}; color:${color}; padding:4px; border-radius:4px; font-weight:600; font-size:1.1rem; text-align:center; border:2px solid #fff; box-shadow:0 0 12px rgba(0,231,1,.5);">${sym}</div>`;
    } else {
      html += `<div style="background:#14222d; color:#557086; padding:4px; border-radius:4px; font-weight:600; font-size:1.1rem; text-align:center; border:1px dashed #243542;">💣</div>`;
    }
  }
  html += '</div>';

  html += '<div style="text-align:center;margin-top:14px;">' +
    '<div style="font-size:2rem;font-weight:900;color:#00e701;">✅ BOARD CLEARED ✅</div>' +
    '<div style="color:#b1bad2;font-size:0.9rem;margin-top:6px;">Multiplier: ' + data.multiplier.toFixed(2) + 'x</div>' +
    '<div style="color:#00e701;font-weight:700;margin-top:4px;">Paid ' + Number(data.payout).toFixed(2) + ' ' + state.currency + '</div>' +
    '</div>';

  document.getElementById('game-display-area').innerHTML = html;
  playSound('win');
};
