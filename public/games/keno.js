window.GameRenderers = window.GameRenderers || {};

GameRenderers.renderKeno = function(details, multiplier, payout) {
  GameRenderers.renderKenoBoard({ drawn: details.drawn, locked: true });
  if (multiplier > 0) playSound('win'); else playSound('loss');
};

GameRenderers.renderKenoBoard = function(opts = {}) {
  const drawn = opts.drawn || [];
  const drawnSet = new Set(drawn);
  const pickSet = new Set(state.selectedKenoNumbers);
  const locked = !!opts.locked;

  let html = '<div class="keno-counter" style="margin-bottom:8px;">' +
    (locked ? 'Drawn: ' + drawn.length + ' numbers' : 'Select up to 10 numbers • <span class="count" style="color:var(--accent-gold);font-weight:800;">' + state.selectedKenoNumbers.length + '</span> / 10 chosen') +
    '</div>' +
    '<div style="display:grid; grid-template-columns: repeat(5, minmax(30px, 1fr)); gap:6px; max-width:420px; margin:auto;" id="keno-board">';
  for (let i = 1; i <= 40; i++) {
    const isPicked = pickSet.has(i);
    const isDrawn = drawnSet.has(i);
    let bg = '#14222d';
    let color = '#fff';
    let border = '1px solid #243542';
    let glow = 'none';
    if (locked) {
      if (isDrawn && isPicked) { bg = '#00e701'; color = '#000'; border = '2px solid #fff'; glow = '0 0 10px rgba(0,231,1,.55)'; }
      else if (isDrawn) { bg = '#8248ff'; color = '#fff'; }
      else if (isPicked) { bg = '#00e701'; color = '#000'; }
    } else {
      if (isPicked) { bg = '#00e701'; color = '#000'; border = '1px solid #fff'; }
    }
    html += `<div style="background:${bg}; color:${color}; padding:10px 4px; border-radius:4px; font-weight:600; font-size:0.9rem; cursor:${locked ? 'default' : 'pointer'}; text-align:center; border:${border}; box-shadow:${glow};" onclick="${locked ? '' : 'toggleKenoNumber(' + i + ')'}">${i}</div>`;
  }
  html += '</div>';
  if (!locked && drawn.length === 0) {
    html += '<div style="text-align:center;margin-top:10px;"><button class="game-btn-action" style="padding:6px 16px;font-weight:700;" onclick="placeKenoBet()">PLACE KENO BET (' + state.selectedKenoNumbers.length + ' numbers)</button></div>';
  }
  document.getElementById('game-display-area').innerHTML = html;
};

GameRenderers.toggleKenoNumber = function(num) {
  playSound('click');
  const idx = state.selectedKenoNumbers.indexOf(num);
  if (idx > -1) state.selectedKenoNumbers.splice(idx, 1);
  else if (state.selectedKenoNumbers.length < 10) state.selectedKenoNumbers.push(num);
  GameRenderers.renderKenoBoard({ drawn: [], locked: false });
};
