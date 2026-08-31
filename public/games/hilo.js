window.GameRenderers = window.GameRenderers || {};

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
