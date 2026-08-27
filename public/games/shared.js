window.GameRenderers = window.GameRenderers || {};

GameRenderers.cardHTML = function(card, faceDown, isHilo) {
  const WHEEL_COLORS = {
    GRAY: '#39424d', BLUE: '#1876d2', GREEN: '#00e701',
    PURPLE: '#8248ff', ORANGE: '#ff8b20', GOLD: '#ffc700'
  };
  if (faceDown || !card) return '<div class="playing-card face-down"><span>🂠</span></div>';
  const red = card.suit === '♥' || card.suit === '♦';
  const suit = card.suit || '♠';
  if (isHilo) {
    const rankLabel = card.label || card.value;
    return '<div class="playing-card big ' + (red ? 'red' : '') + '">' +
      '<span class="pc-rank">' + rankLabel + '</span>' +
      '<span class="pc-suit">' + suit + '</span>' +
      '</div>';
  }
  return '<div class="playing-card ' + (red ? 'red' : '') + '">' +
    '<span class="pc-rank">' + (card.label || card.value) + '</span>' +
    '<span class="pc-suit">' + suit + '</span>' +
    '</div>';
};

GameRenderers.cardBackHTML = function() {
  return '<div class="playing-card face-down"><span>🂠</span></div>';
};
