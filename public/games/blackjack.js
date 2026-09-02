window.GameRenderers = window.GameRenderers || {};

GameRenderers.cardHTML = function(card, hidden, small) {
  const suitSymbols = { '♠': 'spades', '♥': 'hearts', '♦': 'diams', '♣': 'clubs' };
  const suitEmoji = { '♠': '♠️', '♥': '♥️', '♦': '♦️', '♣': '♣️' };
  const suitColors = { '♠': '#fff', '♥': '#ff4d4d', '♦': '#ff4d4d', '♣': '#fff' };
  
  if (hidden) {
    return '<div style="width:' + (small ? '32px' : '44px') + ';height:' + (small ? '44px' : '60px') + ';background:linear-gradient(135deg,#1a2c38,#243542);border:2px solid #3d5a80;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:1.2rem;">🂠</div>';
  }
  
  const rank = card.value || 'A';
  const suit = card.suit || '♠';
  const color = suitColors[suit] || '#fff';
  const size = small ? '1rem' : '1.4rem';
  
  return '<div style="width:' + (small ? '32px' : '44px') + ';height:' + (small ? '44px' : '60px') + ';background:linear-gradient(135deg,#1a2c38,#213743);border:2px solid #3d5a80;border-radius:6px;display:flex;align-items:center;justify-content:center;font-weight:800;color:' + color + ';font-size:' + size + ';flex-direction:column;line-height:1;">' + rank + '<br><span style="font-size:0.7em;">' + (suitEmoji[suit] || suit) + '</span></div>';
};

GameRenderers.renderBlackjackHands = function(playerHand, dealerShown, holeHidden, msgObj) {
  const display = document.getElementById('game-display-area');
  const playerScore = GameRenderers.blackjackHandScore(playerHand);
  let dealerScoreStr = '—';
  if (!holeHidden) {
    dealerScoreStr = GameRenderers.blackjackHandScore(dealerShown).toString();
  }

  display.innerHTML =
    '<div style="max-width:460px;margin:auto;text-align:center;">' +
    '<div class="bj-row-label" style="display:flex;justify-content:space-between;">' +
      '<span>🂠 DEALER • ' + dealerScoreStr + '</span>' +
      '<span style="color:var(--text-muted);font-size:0.8rem;">Target: 21</span>' +
    '</div>' +
    '<div class="hand-row">' + dealerShown.map(c => GameRenderers.cardHTML(c, holeHidden, false)).join('') + '</div>' +
    '<div style="margin:10px 0;height:1px;background:#243542;"></div>' +
    '<div class="bj-row-label" style="display:flex;justify-content:space-between;">' +
      '<span>🃏 YOU • <span style="color:var(--accent-blue);font-weight:800;">' + playerScore + '</span></span>' +
      '<span style="color:' + (playerScore > 21 ? '#ff4d4d' : playerScore === 21 ? '#00e701' : '#b1bad2') + ';font-size:0.8rem;font-weight:700;">' + (playerScore > 21 ? 'BUST' : playerScore === 21 ? 'BLACKJACK' : '') + '</span>' +
    '</div>' +
    '<div class="hand-row">' + playerHand.map(c => GameRenderers.cardHTML(c, false, false)).join('') + '</div>' +
    (msgObj ? '<div style="margin-top:14px;padding:8px;border-radius:8px;background:rgba(' + (msgObj.color.includes('e7') ? '0,231,1' : msgObj.color.includes('4d4d') ? '255,77,77' : '255,199,0') + ',0.12);font-weight:800;color:' + msgObj.color + ';">' + msgObj.text + '</div>' : '') +
    '</div>';
};

GameRenderers.blackjackHandScore = function(hand) {
  let score = 0;
  let aces = 0;
  for (const c of hand) {
    const r = c.value;
    if (r === 'A') { aces++; score += 11; }
    else if (['K','Q','J'].includes(r)) score += 10;
    else if (r === '10') score += 10;
    else score += parseInt(r) || 0;
  }
  while (score > 21 && aces > 0) { score -= 10; aces--; }
  return score;
};
