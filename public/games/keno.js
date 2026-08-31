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

  const hits = state.selectedKenoNumbers.filter(n => drawnSet.has(n)).length;

  let html = '<div class="keno-board">';
  html += '<div class="keno-header">';
  html += '<div class="keno-count">' + (locked ? 'Drawn: ' + drawn.length + ' numbers' : state.selectedKenoNumbers.length + ' / 10 chosen') + '</div>';
  html += '<button class="keno-quick-pick" onclick="quickPickKeno()">🎲 Quick Pick</button>';
  html += '</div>';

  html += '<div class="keno-grid" id="keno-board">';
  for (let i = 1; i <= 40; i++) {
    const isPicked = pickSet.has(i);
    const isDrawn = drawnSet.has(i);
    let cls = 'keno-num';
    if (isDrawn && isPicked) cls += ' keno-hit';
    else if (isDrawn) cls += ' keno-drawn';
    else if (isPicked) cls += ' keno-picked';
    html += `<div class="${cls}" ${locked ? '' : `onclick="toggleKenoNumber(${i})"`}>${i}</div>`;
  }
  html += '</div>';

  if (locked && hits > 0) {
    html += '<div class="keno-result">' + hits + ' / ' + state.selectedKenoNumbers.length + ' hits</div>';
  }

  if (!locked && drawn.length === 0) {
    const canBet = state.selectedKenoNumbers.length > 0;
    html += '<button class="keno-bet-btn ' + (canBet ? '' : 'disabled') + '" onclick="placeKenoBet()" ' + (!canBet ? 'disabled' : '') + '>PLACE KENO BET (' + state.selectedKenoNumbers.length + ' numbers)</button>';
  }

  html += '</div>';
  document.getElementById('game-display-area').innerHTML = html;
};

GameRenderers.toggleKenoNumber = function(num) {
  playSound('click');
  const idx = state.selectedKenoNumbers.indexOf(num);
  if (idx > -1) state.selectedKenoNumbers.splice(idx, 1);
  else if (state.selectedKenoNumbers.length < 10) state.selectedKenoNumbers.push(num);
  GameRenderers.renderKenoBoard({ drawn: [], locked: false });
};

GameRenderers.quickPickKeno = function() {
  const nums = [];
  while (nums.length < 5) {
    const n = Math.floor(Math.random() * 40) + 1;
    if (!nums.includes(n)) nums.push(n);
  }
  state.selectedKenoNumbers = nums;
  playSound('chip');
  GameRenderers.renderKenoBoard({ drawn: [], locked: false });
};

GameRenderers.kenoPayoutTable = function() {
  const payouts = [
    { hits: 1, mult: 1.5 }, { hits: 2, mult: 3 }, { hits: 3, mult: 8 },
    { hits: 4, mult: 20 }, { hits: 5, mult: 50 }, { hits: 6, mult: 100 },
    { hits: 7, mult: 250 }, { hits: 8, mult: 500 }, { hits: 9, mult: 1000 }, { hits: 10, mult: 2500 }
  ];
  let html = '<div class="keno-payout-table">';
  html += '<div class="payout-title">Payout Table (5 picks)</div>';
  html += '<div class="payout-row payout-header"><span>Hits</span><span>Multiplier</span></div>';
  payouts.forEach(p => {
    html += '<div class="payout-row"><span>' + p.hits + '</span><span>' + p.mult + 'x</span></div>';
  });
  html += '</div>';
  return html;
};
