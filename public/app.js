let currentCurrency = 'GC';
let currentGame = null;
let userBalances = { gc: 10000, sc: 10 };
let socket = null;
let selectedKenoNumbers = [1, 5, 10, 15, 20];
let activeCheckoutInstance = null;

// Dynamic Game State Tracker
let activeGameState = null;

async function initSession() {
  let token = localStorage.getItem('casino_token');

  if (!token) {
    try {
      const res = await fetch('/api/auth/guest', { method: 'POST' });
      const data = await res.json();
      if (data.token) {
        localStorage.setItem('casino_token', data.token);
        userBalances = data.balances || userBalances;
      }
    } catch (err) {
      console.error('Auth error:', err);
    }
  } else {
    try {
      const res = await fetch('/api/user/me', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        userBalances = data.balances;
      } else {
        localStorage.removeItem('casino_token');
        return await initSession();
      }
    } catch (e) {
      console.error('Session error:', e);
    }
  }

  updateWalletUI();
  connectWebSocket();
}

function connectWebSocket() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(`${protocol}//${window.location.host}`);

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'LIVE_BET') {
        const feed = document.getElementById('bets-feed');
        if (!feed) return;
        const row = document.createElement('div');
        row.className = 'bet-row';
        row.innerHTML = `
          <span><strong>${data.username}</strong> (${data.game})</span>
          <span style="color: ${data.win ? '#00e701' : '#ff0055'}">${Number(data.multiplier).toFixed(2)}x</span>
        `;
        feed.prepend(row);
        if (feed.children.length > 10) feed.removeChild(feed.lastChild);
      }
    } catch (err) {
      console.error('WS parse error:', err);
    }
  };
}

function updateWalletUI() {
  const tag = document.getElementById('curr-tag');
  const val = document.getElementById('balance-val');
  if (!tag || !val) return;

  if (currentCurrency === 'GC') {
    tag.textContent = 'GC';
    tag.style.background = '#ffb703';
    tag.style.color = '#000';
    val.textContent = Number(userBalances.gc || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } else {
    tag.textContent = 'SC';
    tag.style.background = '#00e701';
    tag.style.color = '#000';
    val.textContent = Number(userBalances.sc || 0).toFixed(2);
  }
}

function switchCurrency(currency) {
  currentCurrency = currency;
  updateWalletUI();
}

/* --- STORE & PURCHASE MODAL HANDLERS --- */
function openStoreModal() { 
  document.getElementById('modal-store').classList.remove('hidden'); 
}

function closeStoreModal() { 
  document.getElementById('modal-store').classList.add('hidden');
  const container = document.getElementById('checkout-container');
  if (container) container.innerHTML = '';
  if (activeCheckoutInstance) {
    activeCheckoutInstance.destroy();
    activeCheckoutInstance = null;
  }
}

async function buyCoinPackage(packageId) {
  try {
    const token = localStorage.getItem('casino_token');
    const response = await fetch('/api/user/buy-coins', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ packageId })
    });

    const data = await response.json();
    if (!response.ok || data.error) {
      alert(data.error || 'Failed to initialize payment');
      return;
    }

    const container = document.getElementById('checkout-container');
    container.innerHTML = '';
    if (activeCheckoutInstance) {
      activeCheckoutInstance.destroy();
      activeCheckoutInstance = null;
    }

    // Fixed: Uses the publishable key dynamically provided by the backend endpoint instead of a hardcoded string
    const stripe = Stripe(data.publishableKey);

    activeCheckoutInstance = await stripe.initEmbeddedCheckout({
      clientSecret: data.clientSecret
    });

    activeCheckoutInstance.mount('#checkout-container');
  } catch (err) {
    console.error('Failed to load Stripe checkout:', err);
    alert('Failed to connect to checkout service.');
  }
}

/* --- REDEEM MODAL HANDLERS --- */
function openRedeemModal() { document.getElementById('modal-redeem').classList.remove('hidden'); }
function closeRedeemModal() { document.getElementById('modal-redeem').classList.add('hidden'); }

async function submitRedeem() {
  const amount = parseFloat(document.getElementById('redeem-input').value);
  const token = localStorage.getItem('casino_token');

  if (isNaN(amount) || amount < 100) {
    alert('Minimum redemption limit is 100.00 Sweeps Coins (SC).');
    return;
  }

  const res = await fetch('/api/user/withdraw-sc', {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json', 
      'Authorization': `Bearer ${token}` 
    },
    body: JSON.stringify({ amount })
  });

  const data = await res.json();
  if (!res.ok) return alert(data.error || 'Withdrawal failed');

  // If Stripe Connect Onboarding is required
  if (data.requiresOnboarding && data.onboardingUrl) {
    window.location.href = data.onboardingUrl;
    return;
  }

  userBalances = data.balances;
  updateWalletUI();
  alert(data.message);
  closeRedeemModal();
}

/* --- LOBBY & NAVIGATION --- */
function showLobby() {
  document.getElementById('view-lobby').classList.remove('hidden');
  document.getElementById('view-game').classList.add('hidden');
  currentGame = null;
  activeGameState = null;
}

function launchGame(gameId) {
  currentGame = gameId;
  activeGameState = null;

  document.getElementById('view-lobby').classList.add('hidden');
  document.getElementById('view-game').classList.remove('hidden');
  document.getElementById('active-game-title').textContent = gameId.toUpperCase();
  
  const options = document.getElementById('game-controls-options');
  const actionBtn = document.getElementById('btn-primary-action');
  options.innerHTML = '';
  
  actionBtn.setAttribute('onclick', 'executeCurrentGame()');
  actionBtn.textContent = 'PLACE BET';
  actionBtn.disabled = false;

  if (gameId === 'baccarat') {
    options.innerHTML = `
      <label style="font-weight:700;">Target: </label>
      <select id="baccarat-target">
        <option value="PLAYER">PLAYER (1.98x RTP)</option>
        <option value="BANKER">BANKER (1.93x RTP)</option>
        <option value="TIE">TIE (8.00x)</option>
      </select>
    `;
  } else if (gameId === 'dice') {
    options.innerHTML = `
      <select id="dice-cond"><option value="OVER">OVER</option><option value="UNDER">UNDER</option></select>
      <input type="number" id="dice-target" value="50" min="1" max="98">
    `;
  } else if (gameId === 'limbo') {
    options.innerHTML = `<label style="font-weight:700;">Target Multiplier: </label><input type="number" id="limbo-target" value="2.0" step="0.1" min="1.01">`;
  } else if (gameId === 'mines') {
    options.innerHTML = `<label style="font-weight:700;">Mines Count: </label><input type="number" id="mines-count" value="3" min="1" max="24">`;
    actionBtn.setAttribute('onclick', 'startMinesGame()');
    actionBtn.textContent = 'START MINES';
  } else if (gameId === 'keno') {
    renderKenoBoard();
    return;
  }

  document.getElementById('game-display-area').innerHTML = `<p style="color:#b1bad2; font-weight:700; text-align:center;">Place your bet to begin.</p>`;
}

function renderCards(hand, hiddenCard = false) {
  let html = `<div class="cards-row">`;
  hand.forEach((c, idx) => {
    if (hiddenCard && idx === 1) {
      html += `<div class="card-ui hidden-card">🎴</div>`;
    } else {
      const isRed = c.suit === '♥' || c.suit === '♦';
      html += `<div class="card-ui ${isRed ? 'red' : ''}">${c.value}${c.suit}</div>`;
    }
  });
  html += `</div>`;
  return html;
}

/* --- INTERACTIVE BLACKJACK GAME --- */
async function startBlackjackRound() {
  const betAmount = parseFloat(document.getElementById('bet-input').value);
  const token = localStorage.getItem('casino_token');
  const actionBtn = document.getElementById('btn-primary-action');

  actionBtn.disabled = true;

  const res = await fetch('/api/play/blackjack', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ currency: currentCurrency, betAmount })
  });

  const data = await res.json();
  if (!res.ok) {
    actionBtn.disabled = false;
    return alert(data.error);
  }

  userBalances = data.balances;
  updateWalletUI();

  activeGameState = {
    fullData: data,
    betAmount,
    deck: [...data.details.playerHand, ...data.details.dealerHand],
    playerHand: [data.details.playerHand[0], data.details.playerHand[1]],
    dealerHand: [data.details.dealerHand[0]],
    dealerFullHand: data.details.dealerHand
  };

  renderBlackjackBoard(true);
}

function renderBlackjackBoard(isInteractive = true) {
  const display = document.getElementById('game-display-area');
  const options = document.getElementById('game-controls-options');
  const pScore = calculateHandScore(activeGameState.playerHand);
  
  let html = `
    <div class="bj-table-grid">
      <div class="bj-hand-section">
        <span class="bj-label">Dealer Hand (${isInteractive ? activeGameState.dealerHand[0].score : activeGameState.fullData.details.dealerScore})</span>
        ${renderCards(activeGameState.dealerHand, isInteractive)}
      </div>
      <div class="bj-hand-section">
        <span class="bj-label">Your Hand (${pScore})</span>
        ${renderCards(activeGameState.playerHand)}
      </div>
    </div>`;

  display.innerHTML = html;

  if (isInteractive && pScore < 21) {
    options.innerHTML = `
      <button class="btn-play bj-hit" onclick="hitBlackjack()">HIT</button>
      <button class="btn-play bj-stand" onclick="standBlackjack()">STAND</button>
    `;
    document.getElementById('bet-bar').style.display = 'none';
  } else {
    finishBlackjackRound();
  }
}

function calculateHandScore(hand) {
  let score = 0, aces = 0;
  for (let card of hand) {
    score += card.score;
    if (card.value === 'A') aces++;
  }
  while (score > 21 && aces > 0) { score -= 10; aces--; }
  return score;
}

function hitBlackjack() {
  const extraCards = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
  const suits = ['♠', '♥', '♦', '♣'];
  const randVal = extraCards[Math.floor(Math.random() * extraCards.length)];
  const randSuit = suits[Math.floor(Math.random() * suits.length)];
  let score = parseInt(randVal);
  if (['J', 'Q', 'K'].includes(randVal)) score = 10;
  if (randVal === 'A') score = 11;

  activeGameState.playerHand.push({ suit: randSuit, value: randVal, score });
  
  const currentScore = calculateHandScore(activeGameState.playerHand);
  if (currentScore >= 21) {
    finishBlackjackRound();
  } else {
    renderBlackjackBoard(true);
  }
}

function standBlackjack() { finishBlackjackRound(); }

function finishBlackjackRound() {
  const options = document.getElementById('game-controls-options');
  const display = document.getElementById('game-display-area');
  document.getElementById('bet-bar').style.display = 'flex';
  document.getElementById('btn-primary-action').disabled = false;
  options.innerHTML = '';

  const data = activeGameState.fullData;
  activeGameState.dealerHand = activeGameState.dealerFullHand;

  const playerScore = calculateHandScore(activeGameState.playerHand);
  let win = false;
  let multiplier = 0;

  if (playerScore <= 21) {
    if (data.details.dealerScore > 21 || playerScore > data.details.dealerScore) {
      win = true;
      multiplier = 1.98;
    } else if (playerScore === data.details.dealerScore) {
      multiplier = 1.0;
    }
  }

  const statusClass = win ? 'text-win' : (multiplier === 1 ? 'text-push' : 'text-loss');
  const statusText = win ? 'YOU WIN!' : (multiplier === 1 ? 'PUSH (TIE)' : 'BUST / HOUSE WINS');

  let resultHtml = `
    <div class="bj-table-grid">
      <div class="round-outcome-banner ${statusClass}">${statusText}</div>
      <div class="bj-hand-section">
        <span class="bj-label">Dealer Final (${data.details.dealerScore})</span>
        ${renderCards(activeGameState.dealerHand, false)}
      </div>
      <div class="bj-hand-section">
        <span class="bj-label">Your Final (${playerScore})</span>
        ${renderCards(activeGameState.playerHand)}
      </div>
    </div>`;

  display.innerHTML = resultHtml;
  document.getElementById('pf-hash').textContent = data.provablyFair.serverSeedHash;
}

/* --- ANIMATED BACCARAT ENGINE --- */
async function executeBaccaratRound() {
  const betAmount = parseFloat(document.getElementById('bet-input').value);
  const target = document.getElementById('baccarat-target').value;
  const token = localStorage.getItem('casino_token');
  const actionBtn = document.getElementById('btn-primary-action');

  actionBtn.disabled = true;
  const display = document.getElementById('game-display-area');

  const res = await fetch('/api/play/baccarat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ currency: currentCurrency, betAmount, params: { target } })
  });

  const data = await res.json();
  if (!res.ok) {
    actionBtn.disabled = false;
    return alert(data.error);
  }

  userBalances = data.balances;
  updateWalletUI();

  display.innerHTML = `<p style="color:#00e701; font-weight:600; text-align:center;">Dealing Cards...</p>`;
  
  setTimeout(() => {
    display.innerHTML = `
      <div class="bj-table-grid">
        <div class="bj-hand-section">
          <span class="bj-label">Player Hand</span>
          ${renderCards([data.details.playerHand[0]])}
        </div>
        <div class="bj-hand-section">
          <span class="bj-label">Banker Hand</span>
          <div class="cards-row"><div class="card-ui hidden-card">🎴</div></div>
        </div>
      </div>
    `;
  }, 600);

  setTimeout(() => {
    display.innerHTML = `
      <div class="bj-table-grid">
        <div class="bj-hand-section">
          <span class="bj-label">Player Hand</span>
          ${renderCards(data.details.playerHand)}
        </div>
        <div class="bj-hand-section">
          <span class="bj-label">Banker Hand</span>
          ${renderCards([data.details.bankerHand[0]])}
        </div>
      </div>
    `;
  }, 1200);

  setTimeout(() => {
    const statusClass = data.win ? 'text-win' : 'text-loss';
    display.innerHTML = `
      <div class="bj-table-grid">
        <div class="round-outcome-banner ${statusClass}">${data.multiplier.toFixed(2)}x - ${data.details.outcome}</div>
        <div class="bj-hand-section">
          <span class="bj-label">Player (${data.details.pScore})</span>
          ${renderCards(data.details.playerHand)}
        </div>
        <div class="bj-hand-section">
          <span class="bj-label">Banker (${data.details.bScore})</span>
          ${renderCards(data.details.bankerHand)}
        </div>
      </div>
    `;
    actionBtn.disabled = false;
    document.getElementById('pf-hash').textContent = data.provablyFair.serverSeedHash;
  }, 2000);
}

/* --- FLUID SLOTS ANIMATED ENGINE --- */
async function executeAnimatedSlots() {
  const betAmount = parseFloat(document.getElementById('bet-input').value);
  const token = localStorage.getItem('casino_token');
  const actionBtn = document.getElementById('btn-primary-action');
  const display = document.getElementById('game-display-area');

  actionBtn.disabled = true;

  const res = await fetch('/api/play/slots', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ currency: currentCurrency, betAmount })
  });

  const data = await res.json();
  if (!res.ok) {
    actionBtn.disabled = false;
    return alert(data.error);
  }

  userBalances = data.balances;
  updateWalletUI();

  display.innerHTML = `
    <div class="slot-container">
      <div class="slot-reel blur-spin" id="reel-0"><span>🍒</span></div>
      <div class="slot-reel blur-spin" id="reel-1"><span>🍋</span></div>
      <div class="slot-reel blur-spin" id="reel-2"><span>💎</span></div>
    </div>
  `;

  setTimeout(() => {
    const r0 = document.getElementById('reel-0');
    if (r0) { r0.classList.remove('blur-spin'); r0.innerHTML = `<span>${data.details.grid[1][0]}</span>`; }
  }, 600);

  setTimeout(() => {
    const r1 = document.getElementById('reel-1');
    if (r1) { r1.classList.remove('blur-spin'); r1.innerHTML = `<span>${data.details.grid[1][1]}</span>`; }
  }, 1000);

  setTimeout(() => {
    const r2 = document.getElementById('reel-2');
    if (r2) { r2.classList.remove('blur-spin'); r2.innerHTML = `<span>${data.details.grid[1][2]}</span>`; }
    
    setTimeout(() => {
      const statusClass = data.win ? 'text-win' : 'text-loss';
      let finalHtml = `<div style="text-align:center;"><div class="round-outcome-banner ${statusClass}" style="margin-bottom: 12px;">${data.multiplier.toFixed(2)}x Payout</div>`;
      finalHtml += `<div class="slot-container">` + 
        data.details.grid[1].map(s => `<div class="slot-reel"><span>${s}</span></div>`).join('') + 
        `</div></div>`;
      display.innerHTML = finalHtml;
      actionBtn.disabled = false;
      document.getElementById('pf-hash').textContent = data.provablyFair.serverSeedHash;
    }, 400);
  }, 1400);
}

/* --- KENO BOARD CONTROLLER --- */
function renderKenoBoard() {
  let html = '<div style="display:grid; grid-template-columns: repeat(8, 1fr); gap:6px; max-width:360px; margin:auto;" id="keno-board">';
  for (let i = 1; i <= 40; i++) {
    const isSelected = selectedKenoNumbers.includes(i);
    const bg = isSelected ? '#00e701' : '#14222d';
    const color = isSelected ? '#000' : '#fff';
    html += `<div style="background:${bg}; color:${color}; padding:10px; border-radius:4px; font-weight:600; font-size:0.9rem; cursor:pointer; text-align:center; border:1px solid #243542;" onclick="toggleKenoNumber(${i})">${i}</div>`;
  }
  html += '</div>';
  document.getElementById('game-display-area').innerHTML = html;
}

function toggleKenoNumber(num) {
  if (selectedKenoNumbers.includes(num)) {
    selectedKenoNumbers = selectedKenoNumbers.filter(n => n !== num);
  } else if (selectedKenoNumbers.length < 5) {
    selectedKenoNumbers.push(num);
  }
  renderKenoBoard();
}

/* --- MINES ENGINE --- */
async function startMinesGame() {
  const betAmount = parseFloat(document.getElementById('bet-input').value);
  const mineCount = parseInt(document.getElementById('mines-count').value);
  const token = localStorage.getItem('casino_token');

  const res = await fetch('/api/play/mines/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ currency: currentCurrency, betAmount, mineCount })
  });

  const data = await res.json();
  if (!res.ok) return alert(data.error);

  userBalances = data.balances;
  updateWalletUI();

  let boardHtml = '<div style="display:grid; grid-template-columns: repeat(5, 1fr); gap:8px; max-width:320px; margin:auto;">';
  for (let i = 0; i < 25; i++) {
    boardHtml += `<button style="height:50px; background:#14222d; border:1px solid #243542; color:#fff; font-size:1rem; font-weight:600; border-radius:6px; cursor:pointer;" id="mine-tile-${i}" onclick="revealMineTile(${i})">?</button>`;
  }
  boardHtml += '</div>';

  document.getElementById('game-display-area').innerHTML = boardHtml;
  document.getElementById('btn-primary-action').setAttribute('onclick', 'cashoutMines()');
  document.getElementById('btn-primary-action').textContent = 'CASHOUT (1.00x)';
}

async function revealMineTile(tileIndex) {
  const token = localStorage.getItem('casino_token');
  const res = await fetch('/api/play/mines/reveal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ tileIndex })
  });

  const data = await res.json();
  const tile = document.getElementById(`mine-tile-${tileIndex}`);

  if (data.hitBomb) {
    tile.style.background = '#ff0055';
    tile.textContent = '💣';
    alert('BOMB HIT! Game Over.');
    launchGame('mines');
  } else {
    tile.style.background = '#00e701';
    tile.style.color = '#000';
    tile.textContent = '💎';
    document.getElementById('btn-primary-action').textContent = `CASHOUT (${data.multiplier}x)`;
  }
}

async function cashoutMines() {
  const token = localStorage.getItem('casino_token');
  const res = await fetch('/api/play/mines/cashout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  });

  const data = await res.json();
  if (res.ok) {
    userBalances = data.balances;
    updateWalletUI();
    alert(`Cashed out for ${data.payout.toFixed(2)} ${currentCurrency}!`);
    launchGame('mines');
  }
}

/* --- GENERAL ROUTER FOR DIRECT GAMES --- */
async function executeCurrentGame() {
  if (!currentGame) return;

  if (currentGame === 'blackjack') return startBlackjackRound();
  if (currentGame === 'baccarat') return executeBaccaratRound();
  if (currentGame === 'slots') return executeAnimatedSlots();

  const betAmount = parseFloat(document.getElementById('bet-input').value);
  const token = localStorage.getItem('casino_token');
  const params = {};

  if (currentGame === 'dice') {
    params.condition = document.getElementById('dice-cond')?.value;
    params.target = parseFloat(document.getElementById('dice-target')?.value);
  }
  if (currentGame === 'limbo') params.targetMultiplier = parseFloat(document.getElementById('limbo-target')?.value);
  if (currentGame === 'keno') params.selectedNumbers = selectedKenoNumbers;

  const res = await fetch(`/api/play/${currentGame}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ currency: currentCurrency, betAmount, params })
  });

  const data = await res.json();
  if (!res.ok) return alert(data.error);

  userBalances = data.balances;
  updateWalletUI();

  const display = document.getElementById('game-display-area');
  const statusClass = data.win ? 'text-win' : 'text-loss';
  
  let html = `
    <div style="text-align:center; padding: 20px;">
      <div class="round-outcome-banner ${statusClass}" style="margin-bottom: 12px; display:inline-block;">${data.multiplier.toFixed(2)}x</div>
      <p style="font-weight: 600; font-size: 1rem; color: #b1bad2; margin-bottom: 4px;">Payout: ${data.payout.toFixed(2)} ${currentCurrency}</p>
    </div>
  `;

  display.innerHTML = html;
  document.getElementById('pf-hash').textContent = data.provablyFair.serverSeedHash;
}

window.addEventListener('DOMContentLoaded', initSession);