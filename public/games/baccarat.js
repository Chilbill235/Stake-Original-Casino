window.GameRenderers = window.GameRenderers || {};

GameRenderers.renderBaccarat = function(details, payout) {
  const display = document.getElementById('game-display-area');
  const outcome = details.outcome;
  const betOn = details.betOn;
  const colorMap = { PLAYER: '#1876d2', BANKER: '#ff4d4d', TIE: '#8248ff' };

  let sideBetHTML = '';
  if (details.sideBet) {
    const sbWin = details.sideBet.won;
    const sbColor = sbWin ? '#00e701' : '#ff4d4d';
    sideBetHTML = '<div style="margin-top:12px;padding:8px;border-radius:8px;background:rgba(' + (sbWin ? '0,231,1' : '255,77,77') + ',0.15);">' +
      '<div style="font-weight:700;color:' + sbColor + ';">' + details.sideBet.type + ': ' + (sbWin ? 'WON ' + details.sideBet.multiplier.toFixed(2) + 'x' : 'LOST') + '</div>' +
      '</div>';
  }

  display.innerHTML =
    '<div style="max-width:480px;margin:auto;">' +
    '<div class="bj-row-label" style="display:flex;justify-content:space-between;">' +
      '<span style="color:' + colorMap.BANKER + '">🂠 DEALER • ?</span>' +
      '<span style="color:#b1bad2;font-size:0.75rem;">' + (details.pScore !== undefined ? details.bScore + ' pts' : '') + '</span>' +
    '</div>' +
    '<div class="hand-row" id="baccarat-banker-hand">' +
      details.bankerHand.map((c, i) => GameRenderers.cardHTML(c, true)).join('') +
    '</div>' +
    '<div style="margin:12px 0;height:1px;background:#243542;"></div>' +
    '<div class="bj-row-label" style="display:flex;justify-content:space-between;">' +
      '<span style="color:' + colorMap.PLAYER + '">🃏 PLAYER • ?</span>' +
      '<span style="color:#b1bad2;font-size:0.75rem;">' + (details.pScore !== undefined ? details.pScore + ' pts' : '') + '</span>' +
    '</div>' +
    '<div class="hand-row" id="baccarat-player-hand">' +
      details.playerHand.map((c, i) => GameRenderers.cardHTML(c, true)).join('') +
    '</div>' +
    sideBetHTML +
    '<div style="margin-top:12px;text-align:center;">' +
      '<div style="display:inline-block;background:#14222d;border-radius:6px;padding:6px 14px;font-size:0.75rem;color:#b1bad2;">' +
      'Banker bets: 5% commission • Side bets: Pair (11x)' +
      '</div>' +
    '</div></div>';

  state.baccaratPendingReveal = { details, payout };
};

GameRenderers.revealBaccaratCards = function() {
  const details = state.baccaratPendingReveal.details;
  const payout = state.baccaratPendingReveal.payout;
  const outcome = details.outcome;
  const betOn = details.betOn;
  const colorMap = { PLAYER: '#1876d2', BANKER: '#ff4d4d', TIE: '#8248ff' };
  const won = outcome === betOn;
  let step = 0;
  const playerHand = details.playerHand;
  const bankerHand = details.bankerHand;
  const playerCards = document.querySelectorAll('#baccarat-player-hand .playing-card');
  const bankerCards = document.querySelectorAll('#baccarat-banker-hand .playing-card');
  const totalCards = playerCards.length + bankerCards.length;
  let revealed = 0;

  const interval = setInterval(() => {
    if (step < playerCards.length) {
      const idx = step;
      const card = playerCards[idx];
      if (card) {
        card.classList.remove('face-down');
        card.innerHTML = '<span class="pc-rank">' + (playerHand[idx].label || playerHand[idx].value) + '</span><span class="pc-suit">' + playerHand[idx].suit + '</span>';
        playSound('card-deal');
      }
    } else if (step < playerCards.length + bankerCards.length) {
      const idx = step - playerCards.length;
      const card = bankerCards[idx];
      if (card) {
        card.classList.remove('face-down');
        card.innerHTML = '<span class="pc-rank">' + (bankerHand[idx].label || bankerHand[idx].value) + '</span><span class="pc-suit">' + bankerHand[idx].suit + '</span>';
        playSound('card-deal');
      }
    }
    revealed++;
    step++;

    if (revealed >= totalCards) {
      clearInterval(interval);
      finishReveal();
    }
  }, 250);

  function finishReveal() {
    const display = document.getElementById('game-display-area');
    const resultColor = won ? '#00e701' : colorMap[outcome];

    display.innerHTML =
      '<div style="max-width:480px;margin:auto;">' +
      '<div class="bj-row-label" style="display:flex;justify-content:space-between;">' +
        '<span style="color:' + colorMap.BANKER + '">💠 DEALER • ' + details.bScore + '</span>' +
      '</div>' +
      '<div class="hand-row" id="baccarat-banker-hand">' +
        details.bankerHand.map(c => GameRenderers.cardHTML(c, false)).join('') +
      '</div>' +
      '<div style="margin:12px 0;height:1px;background:#243542;"></div>' +
      '<div class="bj-row-label" style="display:flex;justify-content:space-between;">' +
        '<span style="color:' + colorMap.PLAYER + '">🎲 PLAYER • ' + details.pScore + '</span>' +
      '</div>' +
      '<div class="hand-row" id="baccarat-player-hand">' +
        details.playerHand.map(c => GameRenderers.cardHTML(c, false)).join('') +
      '</div>' +
      '<div style="text-align:center;margin-top:18px;padding:12px;border-radius:8px;background:rgba(' + (won ? '0,231,1' : '255,77,77') + ',0.12);">' +
        '<div style="font-size:1.4rem;font-weight:900;color:' + resultColor + '">' + outcome + (won ? ' — YOU WIN' : '') + '</div>' +
        '<div style="color:#b1bad2;font-size:0.85rem;margin-top:4px;">Payout: ' + Number(payout).toFixed(2) + ' ' + state.currency + '</div>' +
      '</div>' +
      '</div>';

    setTimeout(() => {
      state.balances = state.baccaratPendingBalance || state.balances;
      updateWalletUI();
      state.activeGameState = null;
      delete state.baccaratPendingReveal;
      delete state.baccaratPendingBalance;
      resetRoundUI('PLACE BET');
    }, 2000);

    if (won) playSound('win'); else playSound('loss');
  }
};
