window.GameRenderers = window.GameRenderers || {};

GameRenderers.renderBaccarat = function(details, payout) {
  const display = document.getElementById('game-display-area');
  const outcome = details.outcome;
  const betOn = details.betOn;
  const colorMap = { PLAYER: '#1876d2', BANKER: '#ff4d4d', TIE: '#8248ff' };
  const won = outcome === betOn;

  let sideBetHTML = '';
  if (details.sideBet) {
    const sbWin = details.sideBet.won;
    const sbColor = sbWin ? '#00e701' : '#ff4d4d';
    sideBetHTML = '<div class="baccarat-sidebet ' + (sbWin ? 'sb-win' : 'sb-loss') + '">' +
      '<div class="sb-type">' + details.sideBet.type + '</div>' +
      '<div class="sb-result">' + (sbWin ? 'WON ' + details.sideBet.multiplier.toFixed(2) + 'x' : 'LOST') + '</div>' +
      '</div>';
  }

  let html = '<div class="baccarat-table">';

  html += '<div class="baccarat-trend">';
  if (GameRenderers.baccaratTrend) {
    GameRenderers.baccaratTrend.slice(-8).forEach(t => {
      html += '<div class="trend-dot trend-' + t.toLowerCase() + '">' + t.charAt(0) + '</div>';
    });
  }
  html += '</div>';

  html += '<div class="baccarat-hand banker-hand">';
  html += '<div class="hand-label" style="color:' + colorMap.BANKER + '">BANKER ' + (details.bScore !== undefined ? '(' + details.bScore + ')' : '') + '</div>';
  html += '<div class="hand-cards">' + details.bankerHand.map((c, i) => GameRenderers.cardHTML(c, true)).join('') + '</div>';
  html += '</div>';

  html += '<div class="baccarat-divider"><span class="commission-badge">5% commission</span></div>';

  html += '<div class="baccarat-hand player-hand">';
  html += '<div class="hand-label" style="color:' + colorMap.PLAYER + '">PLAYER ' + (details.pScore !== undefined ? '(' + details.pScore + ')' : '') + '</div>';
  html += '<div class="hand-cards">' + details.playerHand.map((c, i) => GameRenderers.cardHTML(c, true)).join('') + '</div>';
  html += '</div>';

  html += '<div class="baccarat-bet-info">Main bet: <span style="color:' + colorMap[betOn] + ';font-weight:700;">' + betOn + '</span>' + (betOn === 'BANKER' ? ' (1.95x)' : betOn === 'TIE' ? ' (9x)' : ' (2x)') + '</div>';

  html += sideBetHTML;

  if (!outcome) {
    html += '<button class="baccarat-reveal-btn" onclick="revealBaccaratCards()">REVEAL CARDS</button>';
  }

  html += '</div>';
  display.innerHTML = html;

  state.baccaratPendingReveal = { details, payout };

  if (!outcome) {
    GameRenderers.addBaccaratTrend('?');
  }
};

GameRenderers.revealBaccaratCards = function() {
  const details = state.baccaratPendingReveal.details;
  const payout = state.baccaratPendingReveal.payout;
  const outcome = details.outcome;
  const betOn = details.betOn;
  const colorMap = { PLAYER: '#1876d2', BANKER: '#ff4d4d', TIE: '#8248ff' };
  const won = outcome === betOn;

  GameRenderers.addBaccaratTrend(outcome);

  let step = 0;
   const playerCards = document.querySelectorAll('.baccarat-hand.player-hand .playing-card');
   const bankerCards = document.querySelectorAll('.baccarat-hand.banker-hand .playing-card');
  const totalCards = playerCards.length + bankerCards.length;
  let revealed = 0;

  const interval = setInterval(() => {
    if (step < playerCards.length) {
      const idx = step;
      const card = playerCards[idx];
      if (card) {
        card.classList.remove('face-down');
        card.classList.add('card-reveal');
        card.innerHTML = '<span class="pc-rank">' + (details.playerHand[idx].label || details.playerHand[idx].value) + '</span><span class="pc-suit">' + details.playerHand[idx].suit + '</span>';
        playSound('card-deal');
      }
    } else if (step < playerCards.length + bankerCards.length) {
      const idx = step - playerCards.length;
      const card = bankerCards[idx];
      if (card) {
        card.classList.remove('face-down');
        card.classList.add('card-reveal');
        card.innerHTML = '<span class="pc-rank">' + (details.bankerHand[idx].label || details.bankerHand[idx].value) + '</span><span class="pc-suit">' + details.bankerHand[idx].suit + '</span>';
        playSound('card-deal');
      }
    }
    revealed++;
    step++;

    if (revealed >= totalCards) {
      clearInterval(interval);
      finishBaccaratReveal();
    }
  }, 300);

  function finishBaccaratReveal() {
    const display = document.getElementById('game-display-area');
    const resultColor = won ? '#00e701' : colorMap[outcome];

    let html = '<div class="baccarat-table">';
    html += '<div class="baccarat-trend">';
    if (GameRenderers.baccaratTrend) {
      GameRenderers.baccaratTrend.slice(-8).forEach(t => {
        html += '<div class="trend-dot trend-' + t.toLowerCase() + '">' + t.charAt(0) + '</div>';
      });
    }
    html += '</div>';

    html += '<div class="baccarat-hand banker-hand">';
    html += '<div class="hand-label" style="color:' + colorMap.BANKER + '">BANKER (' + details.bScore + ')</div>';
    html += '<div class="hand-cards">' + details.bankerHand.map(c => GameRenderers.cardHTML(c, false)).join('') + '</div>';
    html += '</div>';

    html += '<div class="baccarat-divider"><span class="commission-badge">5% commission</span></div>';

    html += '<div class="baccarat-hand player-hand">';
    html += '<div class="hand-label" style="color:' + colorMap.PLAYER + '">PLAYER (' + details.pScore + ')</div>';
    html += '<div class="hand-cards">' + details.playerHand.map(c => GameRenderers.cardHTML(c, false)).join('') + '</div>';
    html += '</div>';

    html += '<div class="baccarat-result ' + (won ? 'bacc-win' : 'bacc-loss') + '">';
    html += '<div class="result-outcome">' + outcome + (won ? ' — YOU WIN' : '') + '</div>';
    html += '<div class="result-payout">' + Number(payout).toFixed(2) + ' ' + state.currency + '</div>';
    html += '</div>';

    html += '</div>';
    display.innerHTML = html;

    setTimeout(() => {
      state.balances = state.baccaratPendingBalance || state.balances;
      updateWalletUI();
      state.activeGameState = null;
      delete state.baccaratPendingReveal;
      delete state.baccaratPendingBalance;
      resetRoundUI('PLACE BET');
      resetBaccaratSideBets();
    }, 2500);

    if (won) playSound('win'); else playSound('loss');
  }
};

GameRenderers.addBaccaratTrend = function(outcome) {
  if (!GameRenderers.baccaratTrend) GameRenderers.baccaratTrend = [];
  GameRenderers.baccaratTrend.push(outcome);
  GameRenderers.baccaratTrend = GameRenderers.baccaratTrend.slice(-20);
};
