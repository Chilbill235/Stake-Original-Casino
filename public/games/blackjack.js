window.GameRenderers = window.GameRenderers || {};

GameRenderers.canDoubleDown = function (data) {
  return !!data && !data.resolved && Array.isArray(data.playerHand) && data.playerHand.length === 2;
};

// SPLIT and INSURANCE are not supported by the game engine yet — keep hidden.
GameRenderers.canSplit = function () { return false; };
GameRenderers.canInsurance = function () { return false; };

/* ==========================================================================
   1. DYNAMIC CSS STYLES INJECTION
   ========================================================================== */
(function injectBlackjackStyles() {
  if (document.getElementById('bj-renderer-styles')) return;

  const styleTag = document.createElement('style');
  styleTag.id = 'bj-renderer-styles';
  styleTag.textContent = `
    .bj-table-felt {
      max-width: 580px;
      margin: 0 auto;
      background: radial-gradient(circle at center, #1b382b 0%, #0c1a13 100%);
      border: 4px solid #2e4a3b;
      border-radius: 16px;
      padding: 20px;
      box-shadow: inset 0 0 30px rgba(0,0,0,0.6);
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      user-select: none;
    }

    .bj-table-header {
      font-size: 0.65rem;
      color: rgba(255,255,255,0.4);
      text-align: center;
      letter-spacing: 1px;
      margin-bottom: 15px;
      font-weight: 700;
    }

    .hand-row {
      display: flex;
      justify-content: center;
      gap: 8px;
      min-height: 80px;
      margin: 10px 0;
      flex-wrap: wrap;
    }

    .casino-card {
      width: 52px;
      height: 76px;
      background: #ffffff;
      border-radius: 6px;
      position: relative;
      box-shadow: 0 4px 10px rgba(0,0,0,0.4);
      font-weight: 800;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 4px;
      box-sizing: border-box;
    }

    .casino-card.small {
      width: 38px;
      height: 56px;
      padding: 2px;
      border-radius: 4px;
    }

    .card-anim {
      animation: dealCard 0.25s ease-out forwards;
    }

    @keyframes dealCard {
      from { opacity: 0; transform: translateY(-20px) scale(0.8); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    .card-back {
      background: linear-gradient(135deg, #1c2b36 0%, #0d161d 100%);
      border: 2px solid #3d5a80;
    }

    .card-back-pattern {
      width: 100%;
      height: 100%;
      border: 1px dashed rgba(255,255,255,0.2);
      display: flex;
      align-items: center;
      justify-content: center;
      color: rgba(255,255,255,0.2);
      font-size: 1.2rem;
    }

    .card-corner {
      display: flex;
      flex-direction: column;
      line-height: 0.8;
      font-size: 0.75rem;
    }

    .small .card-corner {
      font-size: 0.6rem;
    }

    .card-center-suit {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-size: 1.3rem;
      opacity: 0.85;
    }

    .small .card-center-suit {
      font-size: 0.9rem;
    }

    .bottom-right {
      transform: rotate(180deg);
    }

    .bj-row-label {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 10px;
      font-size: 0.85rem;
      font-weight: 800;
      color: #b1bad2;
    }

    .dealer-score-pill, .hand-score {
      background: rgba(0,0,0,0.4);
      padding: 2px 8px;
      border-radius: 12px;
      color: #00e701;
      font-family: monospace;
    }

    .bj-table-line {
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent);
      margin: 15px 0;
    }

    .bj-hands-flex {
      display: flex;
      justify-content: center;
      gap: 16px;
      flex-wrap: wrap;
    }

    .player-hand-container {
      padding: 8px 12px;
      border-radius: 8px;
      border: 1px solid rgba(255,255,255,0.1);
      background: rgba(0,0,0,0.2);
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .active-split-hand {
      border-color: #00e701;
      background: rgba(0, 231, 1, 0.08);
      box-shadow: 0 0 12px rgba(0, 231, 1, 0.2);
    }

    .hand-header {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 4px;
    }

    .hand-label {
      font-size: 0.75rem;
      color: #b1bad2;
      font-weight: 700;
    }

    .bj-badge {
      font-size: 0.65rem;
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: 800;
      letter-spacing: 0.5px;
    }

    .badge-bust { background: #ff4d4d; color: #fff; }
    .badge-bj { background: #ffc700; color: #000; }
    .badge-21 { background: #00e701; color: #000; }

    .hand-bet-chip {
      margin-top: 6px;
      font-size: 0.75rem;
      font-weight: 800;
      color: #ffc700;
      background: rgba(0,0,0,0.4);
      padding: 2px 8px;
      border-radius: 10px;
    }

    .bj-status-toast {
      margin-top: 15px;
      padding: 10px;
      background: rgba(0,0,0,0.6);
      border: 1px solid #00e701;
      border-radius: 8px;
      text-align: center;
      font-weight: 800;
      font-size: 0.9rem;
      letter-spacing: 0.5px;
    }
  `;
  document.head.appendChild(styleTag);
})();

/* ==========================================================================
   2. CARD RENDERER ENGINE
   ========================================================================== */
GameRenderers.cardHTML = function(card, hidden = false, small = false, animated = true) {
  const sizeClass = small ? 'small' : '';
  const animClass = animated ? 'card-anim' : '';

  if (hidden) {
    return `
      <div class="casino-card card-back ${sizeClass} ${animClass}">
        <div class="card-back-pattern">♠</div>
      </div>
    `;
  }

  const suitSymbols = { '♠': '♠', '♥': '♥', '♦': '♦', '♣': '♣' };
  const suitColors = { '♠': '#0d0e12', '♥': '#e9113c', '♦': '#e9113c', '♣': '#0d0e12' };

  const rank = card.value || card.rank || 'A';
  const suit = card.suit || '♠';
  const color = suitColors[suit] || '#0d0e12';
  const symbol = suitSymbols[suit] || suit;

  return `
    <div class="casino-card ${sizeClass} ${animClass}" style="color: ${color};">
      <div class="card-corner top-left">
        <span class="card-rank">${rank}</span>
        <span class="card-suit">${symbol}</span>
      </div>
      <div class="card-center-suit">${symbol}</div>
      <div class="card-corner bottom-right">
        <span class="card-rank">${rank}</span>
        <span class="card-suit">${symbol}</span>
      </div>
    </div>
  `;
};

/* ==========================================================================
   3. ACCURATE BLACKJACK SCORE CALCULATOR
   ========================================================================== */
GameRenderers.blackjackHandScore = function(hand) {
  if (!hand || !Array.isArray(hand) || hand.length === 0) {
    return { score: 0, isSoft: false, isBust: false, isBlackjack: false };
  }

  let score = 0;
  let aces = 0;

  for (const c of hand) {
    const r = c.value || c.rank;
    if (r === 'A') {
      aces += 1;
      score += 11;
    } else if (['K', 'Q', 'J', '10'].includes(r)) {
      score += 10;
    } else {
      score += parseInt(r, 10) || 0;
    }
  }

  while (score > 21 && aces > 0) {
    score -= 10;
    aces -= 1;
  }

  const isSoft = aces > 0 && score <= 21;
  const isBust = score > 21;
  const isBlackjack = hand.length === 2 && score === 21;

  return { score, isSoft, isBust, isBlackjack };
};

/* ==========================================================================
   4. FULL CASINO TABLE RENDER ENGINE
   ========================================================================== */
GameRenderers.renderBlackjackHands = function(playerHand = [], dealerShown = [], holeHidden = true, msgObj = null, extraState = {}) {
  const display = document.getElementById('game-display-area');
  if (!display) return;

  // Support single hand or multi-hand array (split hands)
  const isMultiHand = Array.isArray(playerHand[0]);
  const playerHands = isMultiHand ? playerHand : [playerHand];
  const activeHandIdx = extraState.activeHandIndex || 0;

  // Calculate visible dealer score (hides hole card value if face down)
  const visibleDealerCards = holeHidden ? dealerShown.slice(0, 1) : dealerShown;
  const dealerEval = GameRenderers.blackjackHandScore(visibleDealerCards);
  
  let dealerScoreStr = '—';
  if (visibleDealerCards.length > 0) {
    dealerScoreStr = dealerEval.isSoft && !holeHidden 
      ? `Soft ${dealerEval.score}` 
      : dealerEval.score.toString();
  }

  // Build Dealer Cards HTML
  const dealerCardsHTML = dealerShown.map((c, idx) => {
    const isHole = idx === 1 && holeHidden;
    return GameRenderers.cardHTML(c, isHole, false, true);
  }).join('');

  // Build Player Hand(s) HTML
  const playerHandsHTML = playerHands.map((hand, idx) => {
    const handEval = GameRenderers.blackjackHandScore(hand);
    const isActive = isMultiHand && idx === activeHandIdx;
    const isSmallCard = isMultiHand && playerHands.length > 2;

    let statusBadge = '';
    if (handEval.isBust) {
      statusBadge = '<span class="bj-badge badge-bust">BUST</span>';
    } else if (handEval.isBlackjack) {
      statusBadge = '<span class="bj-badge badge-bj">BLACKJACK</span>';
    } else if (handEval.score === 21) {
      statusBadge = '<span class="bj-badge badge-21">21</span>';
    }

    const scoreDisplay = handEval.isSoft ? `Soft ${handEval.score}` : handEval.score;
    const betAmount = extraState.bets && extraState.bets[idx] ? extraState.bets[idx] : null;

    return `
      <div class="player-hand-container ${isActive ? 'active-split-hand' : ''}">
        <div class="hand-header">
          <span class="hand-label">${isMultiHand ? 'HAND ' + (idx + 1) : 'YOU'}</span>
          <span class="hand-score">${scoreDisplay}</span>
          ${statusBadge}
        </div>
        <div class="hand-row">
          ${hand.map(c => GameRenderers.cardHTML(c, false, isSmallCard, true)).join('')}
        </div>
        ${betAmount ? `<div class="hand-bet-chip">🪙 $${betAmount}</div>` : ''}
      </div>
    `;
  }).join('');

  // Build Status Toast Message
  let statusToastHTML = '';
  if (msgObj) {
    const textColor = msgObj.color || '#00e701';
    statusToastHTML = `
      <div class="bj-status-toast" style="border-color: ${textColor}; color: ${textColor};">
        ${msgObj.text || msgObj}
      </div>
    `;
  }

  // Inject Table Layout into Target Container
  display.innerHTML = `
    <div class="bj-table-felt">
      <div class="bj-table-header">BLACKJACK PAYS 3 TO 2 • DEALER STANDS ON SOFT 17</div>
      
      <!-- Dealer Section -->
      <div class="bj-dealer-area">
        <div class="bj-row-label">
          <span>🂠 DEALER</span>
          <span class="dealer-score-pill">${dealerScoreStr}</span>
        </div>
        <div class="hand-row">${dealerCardsHTML}</div>
      </div>

      <div class="bj-table-line"></div>

      <!-- Player Section -->
      <div class="bj-player-area">
        <div class="bj-hands-flex">
          ${playerHandsHTML}
        </div>
      </div>

      <!-- Toast Message -->
      ${statusToastHTML}
    </div>
  `;
};