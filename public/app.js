/**
 * SWEEPSTAKES CASINO FRONTEND CONTROLLER
 * Fully unified state management, provably fair UI sync, and secure game execution.
 */

// Global Application State
const state = {
  currency: 'GC', // 'GC' (Gold Coins) or 'SC' (Sweeps Coins)
  currentGame: null,
  balances: { gc: 10000.0, sc: 10.0 },
  selectedKenoNumbers: [],
  activeGameState: null, // Holds persistent multi-step game state (Mines, Blackjack, Hilo)
  isProcessing: false, // In-flight request lock to prevent race conditions & double-bets
  activeCheckoutInstance: null,
  ws: null,
  wsReconnectTimer: null
};

/* ==========================================================================
   1. AUTHENTICATION & SESSION MANAGEMENT
   ========================================================================== */

async function initSession() {
  let token = localStorage.getItem('casino_token');

  try {
    if (!token) {
      const res = await fetch('/api/auth/guest', { method: 'POST' });
      if (!res.ok) throw new Error('Guest authentication failed');
      const data = await res.json();
      
      if (data.token) {
        token = data.token;
        localStorage.setItem('casino_token', token);
        state.balances = data.balances || state.balances;
      }
    } else {
      const res = await fetch('/api/user/me', {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (res.ok) {
        const data = await res.json();
        state.balances = data.balances;
      } else {
        // Token invalid or expired: clear and re-initialize once
        localStorage.removeItem('casino_token');
        return await initSession();
      }
    }
  } catch (err) {
    console.error('[Auth Error]:', err);
  }

  updateWalletUI();
  connectWebSocket();
  setupGlobalEventListeners();
}

/* ==========================================================================
   2. WEBSOCKET REAL-TIME LIVE BETS FEED (Auto-Reconnecting)
   ========================================================================== */

function connectWebSocket() {
  if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  state.ws = new WebSocket(`${protocol}//${window.location.host}`);

  state.ws.onopen = () => {
    console.log('[WS] Connected to live bets stream');
    if (state.wsReconnectTimer) clearTimeout(state.wsReconnectTimer);
  };

  state.ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'LIVE_BET') {
        renderLiveBetRow(data);
      }
    } catch (err) {
      console.error('[WS Parse Error]:', err);
    }
  };

  state.ws.onclose = () => {
    console.warn('[WS] Connection closed. Retrying in 3s...');
    state.wsReconnectTimer = setTimeout(connectWebSocket, 3000);
  };

  state.ws.onerror = (err) => {
    console.error('[WS Error]:', err);
    state.ws.close();
  };
}

function renderLiveBetRow(data) {
  const feed = document.getElementById('bets-feed');
  if (!feed) return;

  const row = document.createElement('div');
  row.className = 'bet-row';
  row.innerHTML = `
    <span><strong>${escapeHTML(data.username || 'Anonymous')}</strong> (${escapeHTML(data.game)})</span>
    <span style="color: ${data.win ? '#00e701' : '#ff0055'}; font-weight:700;">${Number(data.multiplier).toFixed(2)}x</span>
  `;

  feed.prepend(row);
  if (feed.children.length > 10) feed.removeChild(feed.lastChild);
}

/* ==========================================================================
   3. WALLET & CURRENCY CONTROLLER
   ========================================================================== */

function updateWalletUI() {
  const tag = document.getElementById('curr-tag');
  const val = document.getElementById('balance-val');
  if (!tag || !val) return;

  if (state.currency === 'GC') {
    tag.textContent = 'GC';
    tag.style.background = '#ffb703';
    tag.style.color = '#000';
    val.textContent = Number(state.balances.gc || 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  } else {
    tag.textContent = 'SC';
    tag.style.background = '#00e701';
    tag.style.color = '#000';
    val.textContent = Number(state.balances.sc || 0).toFixed(2);
  }
}

function switchCurrency(currency) {
  if (state.isProcessing) return;
  state.currency = currency;
  updateWalletUI();
}

function adjustBet(action) {
  const input = document.getElementById('bet-input');
  if (!input) return;

  let currentBet = parseFloat(input.value) || 0;
  const maxBalance = state.currency === 'GC' ? state.balances.gc : state.balances.sc;

  if (action === 'HALF') {
    currentBet = Math.max(0.01, currentBet / 2);
  } else if (action === 'DOUBLE') {
    currentBet = Math.min(maxBalance, currentBet * 2);
  } else if (action === 'MAX') {
    currentBet = maxBalance;
  }

  input.value = currentBet.toFixed(2);
}

/* ==========================================================================
   4. STORE & STRIPE CHECKOUT
   ========================================================================== */

function openStoreModal() {
  document.getElementById('modal-store')?.classList.remove('hidden');
}

function closeStoreModal() {
  document.getElementById('modal-store')?.classList.add('hidden');
  const container = document.getElementById('checkout-container');
  if (container) container.innerHTML = '';
  if (state.activeCheckoutInstance) {
    state.activeCheckoutInstance.destroy();
    state.activeCheckoutInstance = null;
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
    if (container) container.innerHTML = '';
    if (state.activeCheckoutInstance) {
      state.activeCheckoutInstance.destroy();
      state.activeCheckoutInstance = null;
    }

    const stripe = Stripe(data.publishableKey);
    state.activeCheckoutInstance = await stripe.initEmbeddedCheckout({
      clientSecret: data.clientSecret
    });

    state.activeCheckoutInstance.mount('#checkout-container');
  } catch (err) {
    console.error('[Checkout Error]:', err);
    alert('Failed to connect to checkout service.');
  }
}

/* ==========================================================================
   5. SWEEPS COINS REDEMPTION
   ========================================================================== */

function openRedeemModal() { document.getElementById('modal-redeem')?.classList.remove('hidden'); }
function closeRedeemModal() { document.getElementById('modal-redeem')?.classList.add('hidden'); }

async function submitRedeem() {
  const input = document.getElementById('redeem-input');
  const amount = parseFloat(input?.value);
  const token = localStorage.getItem('casino_token');

  if (isNaN(amount) || amount < 100) {
    alert('Minimum redemption limit is 100.00 Sweeps Coins (SC).');
    return;
  }

  try {
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

    if (data.requiresOnboarding && data.onboardingUrl) {
      window.location.href = data.onboardingUrl;
      return;
    }

    state.balances = data.balances;
    updateWalletUI();
    alert(data.message || 'Redemption request submitted successfully.');
    closeRedeemModal();
  } catch (err) {
    console.error('[Redeem Error]:', err);
    alert('Redemption request failed.');
  }
}

/* ==========================================================================
   6. LOBBY & GAME LAUNCH ROUTER
   ========================================================================== */

function showLobby() {
  document.getElementById('view-lobby')?.classList.remove('hidden');
  document.getElementById('view-game')?.classList.add('hidden');
  state.currentGame = null;
  state.activeGameState = null;
  state.isProcessing = false;
}

function launchGame(gameId) {
  state.currentGame = gameId;
  state.activeGameState = null;
  state.isProcessing = false;

  document.getElementById('view-lobby')?.classList.add('hidden');
  document.getElementById('view-game')?.classList.remove('hidden');
  document.getElementById('active-game-title').textContent = gameId.toUpperCase();

  const options = document.getElementById('game-controls-options');
  const actionBtn = document.getElementById('btn-primary-action');
  const betBar = document.getElementById('bet-bar');

  if (betBar) betBar.style.display = 'flex';
  options.innerHTML = '';
  actionBtn.disabled = false;

  // Configure Game Option Panels Dynamically
  switch (gameId) {
    case 'baccarat':
      options.innerHTML = `
        <label style="font-weight:700;">Target: </label>
        <select id="baccarat-target" class="game-select">
          <option value="PLAYER">PLAYER (1.98x)</option>
          <option value="BANKER">BANKER (1.93x)</option>
          <option value="TIE">TIE (8.00x)</option>
        </select>`;
      break;

    case 'dice':
      options.innerHTML = `
        <select id="dice-cond" class="game-select">
          <option value="OVER">OVER</option>
          <option value="UNDER">UNDER</option>
        </select>
        <input type="number" id="dice-target" value="50.00" step="0.01" min="0.01" max="98.99" class="game-input">`;
      break;

    case 'limbo':
      options.innerHTML = `
        <label style="font-weight:700;">Target Multiplier: </label>
        <input type="number" id="limbo-target" value="2.00" step="0.1" min="1.01" class="game-input">`;
      break;

    case 'plinko':
      options.innerHTML = `
        <label style="font-weight:700;">Rows: </label>
        <select id="plinko-rows" class="game-select">
          <option value="8">8 Rows</option>
          <option value="10" selected>10 Rows</option>
          <option value="12">12 Rows</option>
          <option value="14">14 Rows</option>
          <option value="16">16 Rows</option>
        </select>`;
      break;

    case 'hilo':
      options.innerHTML = `
        <label style="font-weight:700;">Current Card: </label>
        <input type="number" id="hilo-card" value="7" min="1" max="13" class="game-input">
        <select id="hilo-guess" class="game-select">
          <option value="HIGHER">HIGHER OR EQUAL</option>
          <option value="LOWER">LOWER OR EQUAL</option>
        </select>`;
      break;

    case 'tower':
      options.innerHTML = `
        <label style="font-weight:700;">Pick Tile (0-2): </label>
        <select id="tower-tile" class="game-select">
          <option value="0">Tile 1</option>
          <option value="1">Tile 2</option>
          <option value="2">Tile 3</option>
        </select>`;
      break;

    case 'mines':
      options.innerHTML = `
        <label style="font-weight:700;">Mines Count: </label>
        <input type="number" id="mines-count" value="3" min="1" max="24" class="game-input">`;
      actionBtn.textContent = 'START MINES';
      break;

    case 'keno':
      renderKenoBoard();
      break;
  }

  if (gameId !== 'mines') {
    actionBtn.textContent = 'PLACE BET';
  }

  document.getElementById('game-display-area').innerHTML = `
    <p style="color:#b1bad2; font-weight:700; text-align:center; padding: 20px;">
      Place your bet to begin.
    </p>`;
}

/* ==========================================================================
   7. INTERACTIVE GAME ENGINES & DISPATCHER
   ========================================================================== */

function handlePrimaryAction() {
  if (state.isProcessing) return;

  const currentBalance = state.currency === 'GC' ? state.balances.gc : state.balances.sc;
  const betInput = document.getElementById('bet-input');
  const betAmount = parseFloat(betInput?.value || 0);

  if (isNaN(betAmount) || betAmount <= 0) {
    return alert('Please enter a valid bet amount.');
  }

  if (betAmount > currentBalance) {
    return alert(`Insufficient ${state.currency} balance.`);
  }

  switch (state.currentGame) {
    case 'blackjack':
      startBlackjackRound(betAmount);
      break;
    case 'baccarat':
      executeBaccaratRound(betAmount);
      break;
    case 'slots':
      executeAnimatedSlots(betAmount);
      break;
    case 'mines':
      if (!state.activeGameState) {
        startMinesGame(betAmount);
      } else {
        cashoutMines();
      }
      break;
    default:
      executeStandardBet(betAmount);
      break;
  }
}

/* --- BLACKJACK (Fully Server-Validated Interactive Engine) --- */

async function startBlackjackRound(betAmount) {
  state.isProcessing = true;
  const token = localStorage.getItem('casino_token');
  const actionBtn = document.getElementById('btn-primary-action');
  actionBtn.disabled = true;

  try {
    const res = await fetch('/api/play/blackjack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ currency: state.currency, betAmount })
    });

    const data = await res.json();
    if (!res.ok) {
      state.isProcessing = false;
      actionBtn.disabled = false;
      return alert(data.error || 'Blackjack error');
    }

    state.balances = data.balances;
    updateWalletUI();

    state.activeGameState = {
      fullData: data,
      betAmount
    };

    renderBlackjackBoard(data);
  } catch (err) {
    console.error('[Blackjack Error]:', err);
  } finally {
    state.isProcessing = false;
  }
}

function renderBlackjackBoard(data) {
  const display = document.getElementById('game-display-area');
  const options = document.getElementById('game-controls-options');
  const statusClass = data.win ? 'text-win' : (data.multiplier === 1 ? 'text-push' : 'text-loss');
  const statusText = data.win 
    ? `YOU WIN! (${data.multiplier.toFixed(2)}x)` 
    : (data.multiplier === 1 ? 'PUSH (TIE)' : 'HOUSE WINS');

  display.innerHTML = `
    <div class="bj-table-grid">
      <div class="round-outcome-banner ${statusClass}">${statusText}</div>
      <div class="bj-hand-section">
        <span class="bj-label">Dealer Score (${data.details.dealerScore})</span>
        ${renderCards(data.details.dealerHand)}
      </div>
      <div class="bj-hand-section">
        <span class="bj-label">Your Score (${data.details.playerScore})</span>
        ${renderCards(data.details.playerHand)}
      </div>
    </div>`;

  options.innerHTML = '';
  document.getElementById('btn-primary-action').disabled = false;
  updateProvablyFairHash(data.provablyFair?.serverSeedHash);
}

/* --- BACCARAT (Animated Deal Engine) --- */

async function executeBaccaratRound(betAmount) {
  state.isProcessing = true;
  const target = document.getElementById('baccarat-target')?.value || 'PLAYER';
  const token = localStorage.getItem('casino_token');
  const actionBtn = document.getElementById('btn-primary-action');
  const display = document.getElementById('game-display-area');

  actionBtn.disabled = true;

  try {
    const res = await fetch('/api/play/baccarat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ currency: state.currency, betAmount, params: { target } })
    });

    const data = await res.json();
    if (!res.ok) {
      actionBtn.disabled = false;
      state.isProcessing = false;
      return alert(data.error || 'Baccarat error');
    }

    state.balances = data.balances;
    updateWalletUI();

    display.innerHTML = `<p style="color:#00e701; font-weight:600; text-align:center; padding:20px;">Dealing Cards...</p>`;

    // Step-by-Step Dealing Animation Sequence
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
        </div>`;
    }, 500);

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
        </div>`;
    }, 1000);

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
        </div>`;

      actionBtn.disabled = false;
      state.isProcessing = false;
      updateProvablyFairHash(data.provablyFair?.serverSeedHash);
    }, 1600);

  } catch (err) {
    console.error('[Baccarat Error]:', err);
    actionBtn.disabled = false;
    state.isProcessing = false;
  }
}

/* --- ANIMATED SLOTS ENGINE --- */

async function executeAnimatedSlots(betAmount) {
  state.isProcessing = true;
  const token = localStorage.getItem('casino_token');
  const actionBtn = document.getElementById('btn-primary-action');
  const display = document.getElementById('game-display-area');

  actionBtn.disabled = true;

  try {
    const res = await fetch('/api/play/slots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ currency: state.currency, betAmount })
    });

    const data = await res.json();
    if (!res.ok) {
      actionBtn.disabled = false;
      state.isProcessing = false;
      return alert(data.error || 'Slots error');
    }

    state.balances = data.balances;
    updateWalletUI();

    display.innerHTML = `
      <div class="slot-container">
        <div class="slot-reel blur-spin" id="reel-0"><span>🍒</span></div>
        <div class="slot-reel blur-spin" id="reel-1"><span>🍋</span></div>
        <div class="slot-reel blur-spin" id="reel-2"><span>💎</span></div>
      </div>`;

    setTimeout(() => {
      const r0 = document.getElementById('reel-0');
      if (r0) { r0.classList.remove('blur-spin'); r0.innerHTML = `<span>${data.result[1][0]}</span>`; }
    }, 500);

    setTimeout(() => {
      const r1 = document.getElementById('reel-1');
      if (r1) { r1.classList.remove('blur-spin'); r1.innerHTML = `<span>${data.result[1][1]}</span>`; }
    }, 900);

    setTimeout(() => {
      const r2 = document.getElementById('reel-2');
      if (r2) { r2.classList.remove('blur-spin'); r2.innerHTML = `<span>${data.result[1][2]}</span>`; }

      setTimeout(() => {
        const statusClass = data.win ? 'text-win' : 'text-loss';
        let finalHtml = `
          <div style="text-align:center;">
            <div class="round-outcome-banner ${statusClass}" style="margin-bottom: 12px;">${data.multiplier.toFixed(2)}x Payout</div>
            <div class="slot-container">
              ${data.result[1].map(s => `<div class="slot-reel"><span>${s}</span></div>`).join('')}
            </div>
          </div>`;

        display.innerHTML = finalHtml;
        actionBtn.disabled = false;
        state.isProcessing = false;
        updateProvablyFairHash(data.provablyFair?.serverSeedHash);
      }, 300);
    }, 1300);

  } catch (err) {
    console.error('[Slots Error]:', err);
    actionBtn.disabled = false;
    state.isProcessing = false;
  }
}

/* --- MINES ENGINE (Interactive Tile Reveal & Cashout) --- */

async function startMinesGame(betAmount) {
  state.isProcessing = true;
  const mineCount = parseInt(document.getElementById('mines-count')?.value || 3);
  const token = localStorage.getItem('casino_token');

  try {
    const res = await fetch('/api/play/mines/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ currency: state.currency, betAmount, mineCount })
    });

    const data = await res.json();
    if (!res.ok) {
      state.isProcessing = false;
      return alert(data.error || 'Failed to start Mines game');
    }

    state.balances = data.balances;
    updateWalletUI();

    state.activeGameState = {
      revealedTiles: [],
      mineCount,
      betAmount
    };

    let boardHtml = '<div style="display:grid; grid-template-columns: repeat(5, 1fr); gap:8px; max-width:320px; margin:auto;" id="mines-board">';
    for (let i = 0; i < 25; i++) {
      boardHtml += `<button class="mine-tile" id="mine-tile-${i}" onclick="revealMineTile(${i})">?</button>`;
    }
    boardHtml += '</div>';

    document.getElementById('game-display-area').innerHTML = boardHtml;
    const actionBtn = document.getElementById('btn-primary-action');
    actionBtn.textContent = 'CASHOUT (1.00x)';
    actionBtn.disabled = false;

  } catch (err) {
    console.error('[Mines Start Error]:', err);
  } finally {
    state.isProcessing = false;
  }
}

async function revealMineTile(tileIndex) {
  if (state.isProcessing || !state.activeGameState) return;
  if (state.activeGameState.revealedTiles.includes(tileIndex)) return;

  state.isProcessing = true;
  const token = localStorage.getItem('casino_token');
  
  state.activeGameState.revealedTiles.push(tileIndex);

  try {
    const res = await fetch('/api/play/mines/reveal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ revealedTiles: state.activeGameState.revealedTiles })
    });

    const data = await res.json();
    const tile = document.getElementById(`mine-tile-${tileIndex}`);

    if (data.result?.hitBomb) {
      if (tile) {
        tile.style.background = '#ff0055';
        tile.textContent = '💣';
      }
      alert('BOMB HIT! Game Over.');
      launchGame('mines');
    } else {
      if (tile) {
        tile.style.background = '#00e701';
        tile.style.color = '#000';
        tile.textContent = '💎';
      }
      document.getElementById('btn-primary-action').textContent = `CASHOUT (${data.multiplier}x)`;
    }
  } catch (err) {
    console.error('[Mines Reveal Error]:', err);
  } finally {
    state.isProcessing = false;
  }
}

async function cashoutMines() {
  if (state.isProcessing || !state.activeGameState) return;

  state.isProcessing = true;
  const token = localStorage.getItem('casino_token');

  try {
    const res = await fetch('/api/play/mines/cashout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    });

    const data = await res.json();
    if (res.ok) {
      state.balances = data.balances;
      updateWalletUI();
      alert(`Cashed out successfully for ${data.payout.toFixed(2)} ${state.currency}!`);
      launchGame('mines');
    }
  } catch (err) {
    console.error('[Mines Cashout Error]:', err);
  } finally {
    state.isProcessing = false;
  }
}

/* --- KENO CONTROLLER --- */

function renderKenoBoard() {
  let html = '<div style="display:grid; grid-template-columns: repeat(8, 1fr); gap:6px; max-width:360px; margin:auto;" id="keno-board">';
  for (let i = 1; i <= 40; i++) {
    const isSelected = state.selectedKenoNumbers.includes(i);
    const bg = isSelected ? '#00e701' : '#14222d';
    const color = isSelected ? '#000' : '#fff';
    html += `<div style="background:${bg}; color:${color}; padding:10px; border-radius:4px; font-weight:600; font-size:0.9rem; cursor:pointer; text-align:center; border:1px solid #243542;" onclick="toggleKenoNumber(${i})">${i}</div>`;
  }
  html += '</div>';
  document.getElementById('game-display-area').innerHTML = html;
}

function toggleKenoNumber(num) {
  if (state.selectedKenoNumbers.includes(num)) {
    state.selectedKenoNumbers = state.selectedKenoNumbers.filter(n => n !== num);
  } else if (state.selectedKenoNumbers.length < 10) {
    state.selectedKenoNumbers.push(num);
  }
  renderKenoBoard();
}

/* --- DIRECT GAMES GENERAL ROUTER (Dice, Limbo, Plinko, Keno, Wheel, Hilo, Tower) --- */

async function executeStandardBet(betAmount) {
  if (!state.currentGame) return;

  state.isProcessing = true;
  const token = localStorage.getItem('casino_token');
  const actionBtn = document.getElementById('btn-primary-action');
  actionBtn.disabled = true;

  const params = {};

  if (state.currentGame === 'dice') {
    params.condition = document.getElementById('dice-cond')?.value || 'OVER';
    params.target = parseFloat(document.getElementById('dice-target')?.value || 50);
  } else if (state.currentGame === 'limbo') {
    params.targetMultiplier = parseFloat(document.getElementById('limbo-target')?.value || 2.0);
  } else if (state.currentGame === 'plinko') {
    params.rows = parseInt(document.getElementById('plinko-rows')?.value || 10);
  } else if (state.currentGame === 'keno') {
    params.selectedNumbers = state.selectedKenoNumbers;
  } else if (state.currentGame === 'hilo') {
    params.currentCard = parseInt(document.getElementById('hilo-card')?.value || 7);
    params.guess = document.getElementById('hilo-guess')?.value || 'HIGHER';
  } else if (state.currentGame === 'tower') {
    params.tile = parseInt(document.getElementById('tower-tile')?.value || 0);
  }

  try {
    const res = await fetch(`/api/play/${state.currentGame}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ currency: state.currency, betAmount, params })
    });

    const data = await res.json();
    if (!res.ok) {
      actionBtn.disabled = false;
      state.isProcessing = false;
      return alert(data.error || 'Game error');
    }

    state.balances = data.balances;
    updateWalletUI();

    const display = document.getElementById('game-display-area');
    const statusClass = data.win ? 'text-win' : 'text-loss';

    let html = `
      <div style="text-align:center; padding: 20px;">
        <div class="round-outcome-banner ${statusClass}" style="margin-bottom: 12px; display:inline-block;">
          ${data.multiplier.toFixed(2)}x
        </div>
        <p style="font-weight: 600; font-size: 1rem; color: #b1bad2; margin-bottom: 4px;">
          Payout: ${data.payout ? data.payout.toFixed(2) : '0.00'} ${state.currency}
        </p>
      </div>`;

    display.innerHTML = html;
    updateProvablyFairHash(data.provablyFair?.serverSeedHash);

  } catch (err) {
    console.error(`[${state.currentGame} Error]:`, err);
  } finally {
    actionBtn.disabled = false;
    state.isProcessing = false;
  }
}

/* ==========================================================================
   8. UTILITY & UI HELPERS
   ========================================================================== */

function renderCards(hand) {
  if (!Array.isArray(hand)) return '';
  let html = `<div class="cards-row">`;
  hand.forEach((c) => {
    const isRed = c.suit === '♥' || c.suit === '♦';
    html += `<div class="card-ui ${isRed ? 'red' : ''}">${escapeHTML(String(c.value))}${escapeHTML(c.suit)}</div>`;
  });
  html += `</div>`;
  return html;
}

function updateProvablyFairHash(hash) {
  const elem = document.getElementById('pf-hash');
  if (elem && hash) elem.textContent = hash;
}

function escapeHTML(str) {
  return String(str).replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

function setupGlobalEventListeners() {
  const primaryBtn = document.getElementById('btn-primary-action');
  if (primaryBtn) {
    primaryBtn.addEventListener('click', handlePrimaryAction);
  }
}

window.addEventListener('DOMContentLoaded', initSession);