window.GameRenderers = window.GameRenderers || {};

GameRenderers.renderTower = function() {
  const display = document.getElementById('game-display-area');
  const ags = state.activeGameState;
  if (!ags) return;

  let html = '<div style="display:flex; flex-direction:column-reverse; gap:8px; max-width:320px; margin:auto;" id="tower-board">';
  const tiles = ags.tilesPerFloor || 3;
  const difficulty = ags.difficulty || 'MEDIUM';
  const diffLabel = { EASY: 'Easy (2 tiles)', MEDIUM: 'Medium (3 tiles)', HARD: 'Hard (2 tiles)' }[difficulty] || 'Medium';
  html += '<div style="text-align:center; color:#b1bad2; font-size:0.8rem; margin-bottom:10px; font-weight:700;">🏰 TOWER — ' + diffLabel + ' • Floor ' + ags.currentFloor + ' / 8</div>';
  html += '<div style="margin-bottom:8px;height:6px;background:#14222d;border-radius:3px;overflow:hidden;"><div style="width:' + (ags.currentFloor / 8 * 100) + '%;height:100%;background:linear-gradient(90,#00e701,#8248ff);transition:width 0.5s ease;"></div></div>';
  html += '<div style="margin-bottom:12px;text-align:center;color:#b1bad2;font-size:0.8rem;">💰 Multiplier: <span style="color:#00e701;font-weight:800;">' + (ags.currentMultiplier || 1.0).toFixed(2) + 'x</span></div>';
  for (let floor = 0; floor < 8; floor++) {
    const isCurrent = floor === ags.currentFloor;
    const isPassed = floor < ags.currentFloor;
    html += `<div style="display:flex; gap:4px; opacity:${isCurrent || isPassed ? '1' : '0.35'};">`;
    for (let tile = 0; tile < tiles; tile++) {
      let bg = isPassed ? 'var(--accent-green)' : isCurrent ? 'var(--bg-card)' : '#14222d';
      let color = isPassed ? '#000' : 'var(--text-primary)';
      let txt = isPassed ? '✓' : isCurrent ? '❓' : '?';
      let borderWidth = isPassed ? '2px' : '1px';
      let shadow = isPassed ? '0 0 10px rgba(0,231,1,.5)' : 'none';
      html += `<button class="tower-tile" style="flex:1; padding:14px; background:${bg}; color:${color}; border:${borderWidth} solid var(--border-color); border-radius:6px; cursor:${isCurrent ? 'pointer' : 'default'}; font-size:1.2rem; font-weight:700; transition:all 0.2s ease; box-shadow:${shadow};" ${isCurrent ? `onclick="pickTowerTile(${floor}, ${tile})"` : 'disabled'}>${txt}</button>`;
    }
    html += '</div>';
  }
  html += '</div>';
  display.innerHTML = html;
};

GameRenderers.renderMinesBoard = function() {
  const display = document.getElementById('game-display-area');
  const ags = state.activeGameState;
  if (!ags) return;

  let html = '<div style="display:grid; grid-template-columns: repeat(5, minmax(44px, 1fr)); gap:6px; max-width:260px; margin:auto;" id="mines-board">';
  for (let i = 0; i < ags.totalTiles; i++) {
    const revealed = ags.revealedTiles.includes(i);
    const isBomb = ags.mines.includes(i);
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

  let html = '<div style="display:grid; grid-template-columns: repeat(5, minmax(44px, 1fr)); gap:6px; max-width:260px; margin:auto;" id="mines-board">';
  for (let i = 0; i < (ags.totalTiles || 25); i++) {
    const revealed = ags.revealedTiles.includes(i) || i === hitTile;
    const isBomb = (data.board && data.board[i] === 'BOMB') || (ags.mines && ags.mines.includes(i));
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
    tileIndex++;
  }
  html += '</div>';

  html += '<div style="text-align:center;margin-top:14px;">' +
    '<div style="font-size:2rem;font-weight:900;color:#ff4d4d;">💥 BOMB HIT 💥</div>' +
    '<div style="color:#b1bad2;font-size:0.9rem;margin-top:6px;">Revealed ' + ags.revealedTiles.length + ' safe tiles before the bomb</div>' +
    '</div>';

  document.getElementById('game-display-area').innerHTML = html;
  playSound('loss');
};

GameRenderers.renderMinesWin = function(data) {
  const display = document.getElementById('game-display-area');
  const ags = state.activeGameState;

  let html = '<div style="display:grid; grid-template-columns: repeat(5, minmax(44px, 1fr)); gap:6px; max-width:260px; margin:auto;" id="mines-board">';
  for (let i = 0; i < (ags.totalTiles || 25); i++) {
    const revealed = ags.revealedTiles.includes(i);
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

GameRenderers.renderHiloBoard = function(msgObj) {
  const display = document.getElementById('game-display-area');
  const ags = state.activeGameState;
  display.innerHTML =
    '<div style="text-align:center;">' +
    (ags.prevCard ? '<div class="hand-row" style="justify-content:center;opacity:.45;margin-bottom:6px;">' + GameRenderers.cardHTML(ags.prevCard, false, true) + '</div>' : '') +
    (ags.currentCard ? '<div class="hand-row" style="justify-content:center;">' + GameRenderers.cardHTML(ags.currentCard, false, true) + '</div>' : '') +
    '<div style="margin-top:10px;color:#b1bad2;font-weight:700;">Multiplier: <span style="color:#00e701;">' + ags.multiplier.toFixed(2) + 'x</span></div>' +
    (msgObj ? '<div style="margin-top:8px;font-weight:800;color:' + msgObj.color + ';">' + msgObj.text + '</div>' : '') +
    '</div>';
};
