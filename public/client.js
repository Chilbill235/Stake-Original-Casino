/**
 * SWEEPSTAKES CASINO FRONTEND CONTROLLER (UPGRADED & FULLY UNIFIED)
 * Integrated State Management, Interactive Games, Provably Fair Suite, Audio SFX, Live Feed & Embedded Payments
 */

// ==========================================================================
// 1. GLOBAL STATE & CONFIGURATION
// ==========================================================================

const state = {
  currency: localStorage.getItem('casino_currency') || 'GC',
  currentGame: null,
  balances: { gc: 10000.0, sc: 10.0 },
  selectedKenoNumbers: [],
  activeGameState: null,
  isProcessing: false,
  activeCheckoutInstance: null,
  ws: null,
  wsReconnectTimer: null,
  feedFilter: 'ALL',
  clientSeed: localStorage.getItem('casino_client_seed') || generateRandomSeed(),
  serverSeedHash: '',
  nonce: 0,
  sfxEnabled: true
};

// ==========================================================================
// 2. SYNTHESIZED WEB AUDIO SFX ENGINE
// ==========================================================================

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playSound(type) {
  if (!state.sfxEnabled) return;
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);

  switch (type) {
    case 'click':
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, now);
      osc.frequency.exponentialRampToValueAtTime(200, now + 0.05);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.linearRampToValueAtTime(0.01, now + 0.05);
      osc.start(now);
      osc.stop(now + 0.05);
      break;

    case 'win':
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.setValueAtTime(554.37, now + 0.1);
      osc.frequency.setValueAtTime(659.25, now + 0.2);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.linearRampToValueAtTime(0.01, now + 0.4);
      osc.start(now);
      osc.stop(now + 0.4);
      break;

    case 'loss':
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(300, now);
      osc.frequency.linearRampToValueAtTime(120, now + 0.25);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.linearRampToValueAtTime(0.01, now + 0.25);
      osc.start(now);
      osc.stop(now + 0.25);
      break;

    case 'chip':
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1200, now);
      osc.frequency.exponentialRampToValueAtTime(800, now + 0.03);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.linearRampToValueAtTime(0.01, now + 0.03);
      osc.start(now);
      osc.stop(now + 0.03);
      break;

    case 'spin':
      osc.type = 'sine';
      osc.frequency.setValueAtTime(350, now);
      gain.gain.setValueAtTime(0.05, now);
      gain.gain.linearRampToValueAtTime(0.01, now + 0.04);
      osc.start(now);
      osc.stop(now + 0.04);
      break;
  }
}

// ==========================================================================
// 3. HTTP API CLIENT & AUTHORIZATION
// ==========================================================================

async function apiRequest(endpoint, method = 'GET', body = null) {
  const token = localStorage.getItem('casino_token');
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const config = { method, headers };
  if (body) config.body = JSON.stringify(body);

  try {
    const res = await fetch(endpoint, config);
    
    // Safely parse JSON response or handle empty body gracefully
    let data = {};
    const text = await res.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (parseErr) {
        console.warn('[API Parse Warning]: Non-JSON response received', text);
      }
    }

    if (res.status === 401) {
      localStorage.removeItem('casino_token');
      await initSession();
      throw new Error('Session expired. Re-authenticated.');
    }

    if (!res.ok) throw new Error(data.error || 'Server error occurred');
    return data;
  } catch (err) {
    console.error(`[API Error] ${endpoint}:`, err);
    throw err;
  }
}

async function initSession() {
  let token = localStorage.getItem('casino_token');

  try {
    if (!token) {
      const data = await apiRequest('/api/auth/guest', 'POST');
      if (data.token) {
        localStorage.setItem('casino_token', data.token);
        state.balances = data.balances || state.balances;
      }
    } else {
      const data = await apiRequest('/api/user/me');
      if (data.balances) state.balances = data.balances;
    }
  } catch (err) {
    console.warn('[Auth Guest Fallback Mode]: Using local balances.');
  }

  updateWalletUI();
  connectWebSocket();
  setupGlobalEventListeners();
  initProvablyFairUI();
  injectMobileAndNavigationDOM();
}

// ==========================================================================
// 4. WEBSOCKET REAL-TIME LIVE BETS FEED
// ==========================================================================

function connectWebSocket() {
  if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  state.ws = new WebSocket(`${protocol}//${window.location.host}`);

  state.ws.onopen = () => {
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
    state.wsReconnectTimer = setTimeout(connectWebSocket, 3000);
  };

  state.ws.onerror = () => {
    state.ws.close();
  };
}

function setFeedFilter(filter) {
  state.feedFilter = filter;
  document.querySelectorAll('.feed-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === filter);
  });
  const feed = document.getElementById('bets-feed');
  if (feed) feed.innerHTML = '';
}

function renderLiveBetRow(data) {
  const feed = document.getElementById('bets-feed');
  if (!feed) return;

  const myUsername = localStorage.getItem('casino_username') || 'You';
  const isMyBet = data.username === myUsername;
  const isHighRoller = Number(data.payout || 0) >= 100 || Number(data.multiplier || 0) >= 10;

  if (state.feedFilter === 'MY_BETS' && !isMyBet) return;
  if (state.feedFilter === 'HIGH_ROLLERS' && !isHighRoller) return;

  const row = document.createElement('div');
  row.className = `bet-row ${isMyBet ? 'my-bet' : ''}`;
  row.innerHTML = `
    <div class="bet-user-game">
      <span class="bet-user">${escapeHTML(data.username || 'Anonymous')}</span>
      <span class="bet-game">${escapeHTML(data.game)}</span>
    </div>
    <span class="bet-mult ${data.win ? 'win' : 'loss'}">
      ${Number(data.multiplier).toFixed(2)}x (${Number(data.payout || 0).toFixed(2)} ${data.currency || 'GC'})
    </span>
  `;

  feed.prepend(row);
  if (feed.children.length > 15) feed.removeChild(feed.lastChild);
}

// ==========================================================================
// 5. WALLET, SWITCHER & CURRENCY CONTROLLER
// ==========================================================================

function updateWalletUI() {
  const tag = document.getElementById('curr-tag');
  const val = document.getElementById('balance-val');
  const optionGc = document.getElementById('wallet-opt-gc');
  const optionSc = document.getElementById('wallet-opt-sc');
  const balanceGcMenu = document.getElementById('menu-bal-gc');
  const balanceScMenu = document.getElementById('menu-bal-sc');

  const formattedGc = Number(state.balances.gc || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  const formattedSc = Number(state.balances.sc || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  if (balanceGcMenu) balanceGcMenu.textContent = formattedGc;
  if (balanceScMenu) balanceScMenu.textContent = formattedSc;

  if (state.currency === 'GC') {
    if (tag) {
      tag.textContent = 'GC';
      tag.className = 'currency-badge-icon';
    }
    if (val) val.textContent = formattedGc;
    if (optionGc) optionGc.classList.add('active');
    if (optionSc) optionSc.classList.remove('active');
  } else {
    if (tag) {
      tag.textContent = 'SC';
      tag.className = 'currency-badge-icon sc-active';
    }
    if (val) val.textContent = formattedSc;
    if (optionSc) optionSc.classList.add('active');
    if (optionGc) optionGc.classList.remove('active');
  }

  validateBetInputBounds();
}

function toggleWalletDropdown(event) {
  if (event) event.stopPropagation();
  const menu = document.getElementById('wallet-dropdown-menu');
  if (menu) {
    menu.classList.toggle('hidden');
    playSound('click');
  }
}

function closeWalletDropdown() {
  const menu = document.getElementById('wallet-dropdown-menu');
  if (menu) menu.classList.add('hidden');
}

function switchCurrency(currency) {
  if (state.isProcessing) return;
  if (state.activeGameState) {
    closeWalletDropdown();
    return alert('Cannot switch currency while an active game round is in progress.');
  }

  playSound('click');
  state.currency = currency;
  localStorage.setItem('casino_currency', currency);
  updateWalletUI();
  closeWalletDropdown();
}

function validateBetInputBounds() {
  const input = document.getElementById('bet-input');
  if (!input) return;
  const currentBet = parseFloat(input.value) || 0;
  const maxBalance = state.currency === 'GC' ? state.balances.gc : state.balances.sc;

  if (currentBet > maxBalance) {
    input.value = maxBalance > 0 ? maxBalance.toFixed(2) : '1.00';
  }
}

function adjustBet(action) {
  playSound('chip');
  const input = document.getElementById('bet-input');
  if (!input) return;

  let currentBet = parseFloat(input.value) || 0;
  const maxBalance = state.currency === 'GC' ? state.balances.gc : state.balances.sc;

  if (action === 'HALF') {
    currentBet = Math.max(0.01, currentBet / 2);
  } else if (action === 'DOUBLE') {
    currentBet = Math.min(maxBalance, currentBet * 2);
  } else if (action === 'MAX') {
    currentBet = Math.max(0.01, maxBalance);
  }

  input.value = currentBet.toFixed(2);
}

// ==========================================================================
// 6. PROVABLY FAIR CONTROLLER
// ==========================================================================

function generateRandomSeed() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let seed = '';
  for (let i = 0; i < 32; i++) seed += chars.charAt(Math.floor(Math.random() * chars.length));
  localStorage.setItem('casino_client_seed', seed);
  return seed;
}

function initProvablyFairUI() {
  const clientSeedInput = document.getElementById('pf-client-seed');
  if (clientSeedInput) clientSeedInput.value = state.clientSeed;
}

async function rotateServerSeed() {
  try {
    const data = await apiRequest('/api/user/rotate-seed', 'POST');
    state.serverSeedHash = data.serverSeedHash;
    state.nonce = 0;
    updateProvablyFairHash(data.serverSeedHash);
    alert('Server seed rotated successfully!');
  } catch (err) {
    alert('Failed to rotate server seed.');
  }
}

function updateProvablyFairHash(hash) {
  if (hash) state.serverSeedHash = hash;
  const elem = document.getElementById('pf-hash');
  if (elem && state.serverSeedHash) elem.textContent = state.serverSeedHash;
  const nonceElem = document.getElementById('pf-nonce');
  if (nonceElem) nonceElem.textContent = state.nonce;
}

// ==========================================================================
// 7. STORE & EMBEDDED CHECKOUT / SWEEPS COINS REDEMPTION
// ==========================================================================

function openStoreModal() {
  playSound('click');
  document.getElementById('modal-store')?.classList.remove('hidden');
}

function closeStoreModal() {
  playSound('click');
  document.getElementById('modal-store')?.classList.add('hidden');
  const container = document.getElementById('checkout-container');
  if (container) {
    container.innerHTML = '';
    container.style.display = 'none';
  }
  if (state.activeCheckoutInstance) {
    try {
      state.activeCheckoutInstance.destroy();
    } catch (e) {
      console.warn('Checkout cleanup warning:', e);
    }
    state.activeCheckoutInstance = null;
  }
}

async function loadStripeSdk() {
  if (window.Stripe) return window.Stripe;
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://js.stripe.com/v3/';
    script.onload = () => resolve(window.Stripe);
    script.onerror = () => reject(new Error('Failed to load payment gateway SDK.'));
    document.head.appendChild(script);
  });
}

async function buyCoinPackage(packageId) {
  try {
    playSound('click');
    openStoreModal();

    let container = document.getElementById('checkout-container');
    if (!container) return;

    container.style.display = 'block';
    container.innerHTML = '<div style="text-align:center; padding:30px; color:#b1bad2; font-weight:600;">Loading secure embedded checkout...</div>';

    if (state.activeCheckoutInstance) {
      try {
        state.activeCheckoutInstance.destroy();
      } catch (e) {
        console.warn('Checkout instance cleanup warning:', e);
      }
      state.activeCheckoutInstance = null;
    }

    const data = await apiRequest('/api/user/buy-coins', 'POST', { packageId });

    if (!data.publishableKey || !data.clientSecret) {
      throw new Error(data.error || 'Invalid session configuration returned from server.');
    }

    const StripeSDK = await loadStripeSdk();
    const stripe = StripeSDK(data.publishableKey);

    container.innerHTML = '';

    state.activeCheckoutInstance = await stripe.initEmbeddedCheckout({
      clientSecret: data.clientSecret,
      uiMode: 'embedded_page',
      onComplete: () => {
        playSound('win');
        alert('Payment completed successfully! Balance refreshed.');
        closeStoreModal();
        initSession();
      }
    });

    state.activeCheckoutInstance.mount('#checkout-container');

  } catch (err) {
    console.error('[Embedded Payment Error]:', err);
    const container = document.getElementById('checkout-container');
    if (container) {
      container.innerHTML = `
        <div style="color:#ff4d4d; text-align:center; padding:20px; font-weight:700; border:1px solid #ff4d4d; border-radius:6px; background:rgba(255,77,77,0.05);">
          ${escapeHTML(err.message || 'Failed to initialize in-page payment.')}
        </div>`;
    } else {
      alert(err.message || 'Failed to connect to checkout service.');
    }
  }
}

function openRedeemModal() { playSound('click'); document.getElementById('modal-redeem')?.classList.remove('hidden'); }
function closeRedeemModal() { playSound('click'); document.getElementById('modal-redeem')?.classList.add('hidden'); }

async function submitRedeem() {
  const input = document.getElementById('redeem-input');
  const amount = parseFloat(input?.value);

  if (isNaN(amount) || amount < 100) {
    return alert('Minimum redemption limit is 100.00 Sweeps Coins (SC).');
  }

  try {
    playSound('click');
    const data = await apiRequest('/api/user/withdraw-sc', 'POST', { amount });

    if (data.requiresOnboarding && data.onboardingUrl) {
      window.location.href = data.onboardingUrl;
      return;
    }

    state.balances = data.balances;
    updateWalletUI();
    alert(data.message || 'Redemption request submitted successfully.');
    closeRedeemModal();
  } catch (err) {
    alert(err.message || 'Redemption request failed.');
  }
}

// ==========================================================================
// 8. LOBBY & NAVIGATION ROUTING
// ==========================================================================

function showLobby() {
  playSound('click');
  document.getElementById('view-lobby')?.classList.remove('hidden');
  document.getElementById('view-game')?.classList.add('hidden');
  state.currentGame = null;
  state.activeGameState = null;
  state.isProcessing = false;
}

function filterLobbyGames(category) {
  playSound('click');
  document.querySelectorAll('.cat-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.category === category);
  });

  const cards = document.querySelectorAll('.game-card');
  cards.forEach(card => {
    if (category === 'ALL' || card.dataset.category === category) {
      card.style.display = 'flex';
    } else {
      card.style.display = 'none';
    }
  });
}

function searchLobbyGames(query) {
  const term = query.toLowerCase().trim();
  const cards = document.querySelectorAll('.game-card');
  cards.forEach(card => {
    const title = card.querySelector('.game-card-title')?.textContent.toLowerCase() || '';
    card.style.display = title.includes(term) ? 'flex' : 'none';
  });
}

function launchGame(gameId) {
  playSound('click');
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

  switch (gameId) {
    case 'dice':
      options.innerHTML = `
        <div class="control-group">
          <label class="control-label">Condition</label>
          <select id="dice-cond" class="control-select" onchange="updateDiceOdds()">
            <option value="OVER">OVER</option>
            <option value="UNDER">UNDER</option>
          </select>
        </div>
        <div class="control-group">
          <label class="control-label">Target Number</label>
          <input type="number" id="dice-target" value="50.00" step="0.01" min="0.01" max="98.99" class="control-input" oninput="updateDiceOdds()">
        </div>`;
      setTimeout(updateDiceOdds, 50);
      break;

    case 'limbo':
      options.innerHTML = `
        <div class="control-group" style="grid-column: 1 / -1;">
          <label class="control-label">Target Multiplier</label>
          <input type="number" id="limbo-target" value="2.00" step="0.1" min="1.01" max="10000" class="control-input">
        </div>`;
      break;

    case 'plinko':
      options.innerHTML = `
        <div class="control-group" style="grid-column: 1 / -1;">
          <label class="control-label">Row Count</label>
          <select id="plinko-rows" class="control-select">
            <option value="8">8 Rows</option>
            <option value="10" selected>10 Rows</option>
            <option value="12">12 Rows</option>
            <option value="14">14 Rows</option>
            <option value="16">16 Rows</option>
          </select>
        </div>`;
      break;

    case 'mines':
      options.innerHTML = `
        <div class="control-group" style="grid-column: 1 / -1;">
          <label class="control-label">Mines Count</label>
          <input type="number" id="mines-count" value="3" min="1" max="24" class="control-input">
        </div>`;
      actionBtn.textContent = 'START MINES';
      break;

    case 'tower':
      options.innerHTML = `
        <div class="control-group" style="grid-column: 1 / -1;">
          <label class="control-label">Difficulty Level</label>
          <select id="tower-difficulty" class="control-select">
            <option value="EASY">Easy (2/3 Safe)</option>
            <option value="MEDIUM" selected>Medium (1/2 Safe)</option>
            <option value="HARD">Hard (1/3 Safe)</option>
          </select>
        </div>`;
      actionBtn.textContent = 'START TOWER';
      break;

    case 'keno':
      state.selectedKenoNumbers = [];
      renderKenoBoard();
      break;

    case 'blackjack':
      actionBtn.textContent = 'DEAL HAND';
      break;

    case 'slots':
      actionBtn.textContent = 'SPIN REELS';
      break;
  }

  if (!['mines', 'hilo', 'tower', 'blackjack', 'slots', 'wheel'].includes(gameId)) {
    actionBtn.textContent = 'PLACE BET';
  }

  document.getElementById('game-display-area').innerHTML = `
    <div class="game-placeholder-text">Place your bet to begin.</div>`;
}

// ==========================================================================
// 9. PRIMARY ACTION DISPATCHER & GAME ENGINES
// ==========================================================================

function handlePrimaryAction() {
  if (state.isProcessing) return;

  const currentBalance = state.currency === 'GC' ? state.balances.gc : state.balances.sc;
  const betInput = document.getElementById('bet-input');
  const betAmount = parseFloat(betInput?.value || 0);

  if (state.activeGameState) {
    if (state.currentGame === 'mines') return cashoutMines();
    if (state.currentGame === 'tower') return cashoutTower();
  }

  if (isNaN(betAmount) || betAmount <= 0) {
    return alert('Please enter a valid bet amount.');
  }

  if (betAmount > currentBalance) {
    return alert(`Insufficient ${state.currency} balance.`);
  }

  switch (state.currentGame) {
    case 'mines':
      startMinesGame(betAmount);
      break;
    case 'tower':
      startTowerGame(betAmount);
      break;
    case 'limbo':
      executeLimboBet(betAmount);
      break;
    case 'dice':
      executeDiceBet(betAmount);
      break;
    default:
      executeStandardBet(betAmount);
      break;
  }
}

/* --- MINES ENGINE --- */
async function startMinesGame(betAmount) {
  state.isProcessing = true;
  playSound('chip');
  const mineCount = parseInt(document.getElementById('mines-count')?.value || 3);

  try {
    const data = await apiRequest('/api/play/mines/start', 'POST', {
      currency: state.currency,
      betAmount,
      mineCount,
      clientSeed: state.clientSeed
    });

    state.balances = data.balances;
    updateWalletUI();
    state.nonce++;

    state.activeGameState = {
      gameId: data.gameId,
      revealedTiles: [],
      mineCount,
      betAmount,
      currentMultiplier: 1.00
    };

    renderMinesGrid();
    const actionBtn = document.getElementById('btn-primary-action');
    actionBtn.textContent = 'CASHOUT (1.00x)';
    actionBtn.disabled = false;
  } catch (err) {
    alert(err.message || 'Failed to start Mines');
  } finally {
    state.isProcessing = false;
  }
}

function renderMinesGrid() {
  let boardHtml = '<div style="display:grid; grid-template-columns: repeat(5, 1fr); gap:8px; max-width:320px; margin:auto;" id="mines-board">';
  for (let i = 0; i < 25; i++) {
    boardHtml += `<button class="game-btn-action" style="padding:16px; font-weight:700;" id="mine-tile-${i}" onclick="revealMineTile(${i})">?</button>`;
  }
  boardHtml += '</div>';
  document.getElementById('game-display-area').innerHTML = boardHtml;
}

async function revealMineTile(tileIndex) {
  if (state.isProcessing || !state.activeGameState) return;
  if (state.activeGameState.revealedTiles.includes(tileIndex)) return;

  state.isProcessing = true;
  playSound('click');
  state.activeGameState.revealedTiles.push(tileIndex);

  try {
    const data = await apiRequest('/api/play/mines/reveal', 'POST', {
      gameId: state.activeGameState.gameId,
      tileIndex
    });

    const tile = document.getElementById(`mine-tile-${tileIndex}`);

    if (data.hitBomb) {
      playSound('loss');
      if (tile) {
        tile.style.background = '#ff4d4d';
        tile.textContent = '💣';
      }
      alert('BOMB HIT! Game Over.');
      state.activeGameState = null;
      launchGame('mines');
    } else {
      playSound('win');
      if (tile) {
        tile.style.background = '#00e701';
        tile.style.color = '#000';
        tile.textContent = '💎';
      }
      state.activeGameState.currentMultiplier = data.multiplier;
      document.getElementById('btn-primary-action').textContent = `CASHOUT (${data.multiplier.toFixed(2)}x)`;
    }
  } catch (err) {
    alert(err.message || 'Error revealing tile');
  } finally {
    state.isProcessing = false;
  }
}

async function cashoutMines() {
  if (state.isProcessing || !state.activeGameState) return;

  state.isProcessing = true;
  playSound('win');

  try {
    const data = await apiRequest('/api/play/mines/cashout', 'POST', {
      gameId: state.activeGameState.gameId
    });

    state.balances = data.balances;
    updateWalletUI();
    alert(`Cashed out successfully for ${data.payout.toFixed(2)} ${state.currency}!`);
    state.activeGameState = null;
    launchGame('mines');
  } catch (err) {
    alert(err.message || 'Mines cashout failed');
  } finally {
    state.isProcessing = false;
  }
}

/* --- TOWER ENGINE --- */
async function startTowerGame(betAmount) {
  state.isProcessing = true;
  playSound('chip');
  const difficulty = document.getElementById('tower-difficulty')?.value || 'MEDIUM';

  try {
    const data = await apiRequest('/api/play/tower/start', 'POST', {
      currency: state.currency,
      betAmount,
      difficulty,
      clientSeed: state.clientSeed
    });

    state.balances = data.balances;
    updateWalletUI();
    state.nonce++;

    state.activeGameState = {
      gameId: data.gameId,
      currentFloor: 0,
      difficulty,
      multiplier: 1.00
    };

    renderTowerBoard();
  } catch (err) {
    alert(err.message || 'Tower start failed');
  } finally {
    state.isProcessing = false;
  }
}

function renderTowerBoard() {
  const display = document.getElementById('game-display-area');
  const actionBtn = document.getElementById('btn-primary-action');
  actionBtn.textContent = `CASHOUT (${state.activeGameState.multiplier.toFixed(2)}x)`;

  let html = '<div style="display:flex; flex-direction:column-reverse; gap:8px; max-width:280px; margin:auto;">';
  for (let floor = 0; floor < 8; floor++) {
    const isCurrent = floor === state.activeGameState.currentFloor;
    const isPassed = floor < state.activeGameState.currentFloor;

    html += `<div style="display:flex; gap:8px; opacity:${isCurrent || isPassed ? '1' : '0.4'};">`;
    for (let tile = 0; tile < 3; tile++) {
      html += `<button class="game-btn-action" style="flex:1; padding:12px;" ${isCurrent ? `onclick="pickTowerTile(${floor}, ${tile})"` : 'disabled'}>
        ${isPassed ? '✓' : '?'}
      </button>`;
    }
    html += '</div>';
  }
  html += '</div>';

  display.innerHTML = html;
}

async function pickTowerTile(floor, tile) {
  if (state.isProcessing || !state.activeGameState) return;
  state.isProcessing = true;
  playSound('click');

  try {
    const data = await apiRequest('/api/play/tower/pick', 'POST', {
      gameId: state.activeGameState.gameId,
      tile
    });

    if (data.win) {
      playSound('win');
      state.activeGameState.currentFloor++;
      state.activeGameState.multiplier = data.multiplier;
      if (state.activeGameState.currentFloor >= 8) {
        alert('TOWER COMPLETED!');
        return cashoutTower();
      }
      renderTowerBoard();
    } else {
      playSound('loss');
      alert('TRAP HIT! Tower collapsed.');
      state.activeGameState = null;
      launchGame('tower');
    }
  } catch (err) {
    alert(err.message || 'Tower tile pick failed');
  } finally {
    state.isProcessing = false;
  }
}

async function cashoutTower() {
  if (state.isProcessing || !state.activeGameState) return;
  state.isProcessing = true;
  playSound('win');

  try {
    const data = await apiRequest('/api/play/tower/cashout', 'POST', {
      gameId: state.activeGameState.gameId
    });

    state.balances = data.balances;
    updateWalletUI();
    alert(`Cashed out for ${data.payout.toFixed(2)} ${state.currency}!`);
    state.activeGameState = null;
    launchGame('tower');
  } catch (err) {
    alert(err.message || 'Tower cashout failed');
  } finally {
    state.isProcessing = false;
  }
}

/* --- LIMBO ENGINE --- */
async function executeLimboBet(betAmount) {
  state.isProcessing = true;
  playSound('chip');
  const targetMultiplier = parseFloat(document.getElementById('limbo-target')?.value || 2.0);
  const actionBtn = document.getElementById('btn-primary-action');
  const display = document.getElementById('game-display-area');

  actionBtn.disabled = true;

  try {
    const data = await apiRequest('/api/play/limbo', 'POST', {
      currency: state.currency,
      betAmount,
      params: { targetMultiplier },
      clientSeed: state.clientSeed
    });

    state.balances = data.balances;
    updateWalletUI();
    state.nonce++;

    const finalResult = data.details.resultMultiplier;
    let current = 1.00;
    const duration = 1000;
    const startTime = performance.now();

    function animate(now) {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      current = 1.00 + (finalResult - 1.00) * Math.pow(progress, 2);

      display.innerHTML = `
        <div style="text-align:center; padding: 30px;">
          <div style="font-size: 3.5rem; font-weight: 800; color: ${progress === 1 ? (data.win ? '#00e701' : '#ff4d4d') : '#fff'};">
            ${current.toFixed(2)}x
          </div>
          <div style="color:#b1bad2; font-weight:600;">Target: ${targetMultiplier.toFixed(2)}x</div>
        </div>`;

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        if (data.win) playSound('win'); else playSound('loss');
        actionBtn.disabled = false;
        state.isProcessing = false;
        updateProvablyFairHash(data.provablyFair?.serverSeedHash);
      }
    }

    requestAnimationFrame(animate);

  } catch (err) {
    alert(err.message || 'Limbo bet failed');
    actionBtn.disabled = false;
    state.isProcessing = false;
  }
}

/* --- DICE ENGINE --- */
function updateDiceOdds() {
  const cond = document.getElementById('dice-cond')?.value || 'OVER';
  const target = parseFloat(document.getElementById('dice-target')?.value || 50);
  const winChance = cond === 'OVER' ? (100 - target) : target;
  const multiplier = winChance > 0 ? (99 / winChance) : 0;
  // Can be rendered if a feedback element exists
}

async function executeDiceBet(betAmount) {
  state.isProcessing = true;
  playSound('chip');
  const condition = document.getElementById('dice-cond')?.value || 'OVER';
  const target = parseFloat(document.getElementById('dice-target')?.value || 50);

  try {
    const data = await apiRequest('/api/play/dice', 'POST', {
      currency: state.currency,
      betAmount,
      params: { condition, target },
      clientSeed: state.clientSeed
    });

    state.balances = data.balances;
    updateWalletUI();
    state.nonce++;

    if (data.win) playSound('win'); else playSound('loss');

    const display = document.getElementById('game-display-area');
    display.innerHTML = `
      <div style="text-align:center; padding: 20px;">
        <div style="font-size:2.5rem; font-weight:800; color:${data.win ? '#00e701' : '#ff4d4d'}; margin-bottom: 12px;">
          Rolled: ${data.details.rolled.toFixed(2)}
        </div>
        <p style="font-weight: 600; color: #b1bad2;">
          ${data.win ? 'WIN' : 'LOSS'} (${data.multiplier.toFixed(2)}x)
        </p>
      </div>`;

    updateProvablyFairHash(data.provablyFair?.serverSeedHash);
  } catch (err) {
    alert(err.message || 'Dice bet failed');
  } finally {
    state.isProcessing = false;
  }
}

/* --- KENO BOARD --- */
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
  playSound('click');
  if (state.selectedKenoNumbers.includes(num)) {
    state.selectedKenoNumbers = state.selectedKenoNumbers.filter(n => n !== num);
  } else if (state.selectedKenoNumbers.length < 10) {
    state.selectedKenoNumbers.push(num);
  }
  renderKenoBoard();
}

/* --- STANDARD BET DISPATCHER --- */
async function executeStandardBet(betAmount) {
  if (!state.currentGame) return;

  state.isProcessing = true;
  playSound('chip');
  const actionBtn = document.getElementById('btn-primary-action');
  actionBtn.disabled = true;

  const params = {};
  if (state.currentGame === 'plinko') {
    params.rows = parseInt(document.getElementById('plinko-rows')?.value || 10);
  } else if (state.currentGame === 'keno') {
    if (state.selectedKenoNumbers.length === 0) {
      actionBtn.disabled = false;
      state.isProcessing = false;
      return alert('Please select at least 1 Keno number.');
    }
    params.selectedNumbers = state.selectedKenoNumbers;
  }

  try {
    const data = await apiRequest(`/api/play/${state.currentGame}`, 'POST', {
      currency: state.currency,
      betAmount,
      params,
      clientSeed: state.clientSeed
    });

    state.balances = data.balances;
    updateWalletUI();
    state.nonce++;

    if (data.win) playSound('win'); else playSound('loss');

    const display = document.getElementById('game-display-area');
    display.innerHTML = `
      <div style="text-align:center; padding: 20px;">
        <div style="font-size:2rem; font-weight:800; color:${data.win ? '#00e701' : '#ff4d4d'}; margin-bottom: 12px;">
          ${data.multiplier.toFixed(2)}x
        </div>
        <p style="font-weight: 600; color: #b1bad2;">Payout: ${data.payout ? data.payout.toFixed(2) : '0.00'} ${state.currency}</p>
      </div>`;

    updateProvablyFairHash(data.provablyFair?.serverSeedHash);
  } catch (err) {
    alert(err.message || `${state.currentGame} failed`);
  } finally {
    actionBtn.disabled = false;
    state.isProcessing = false;
  }
}

// ==========================================================================
// 10. PROFILE & MODAL CONTROLLERS
// ==========================================================================

function openProfileModal() {
  playSound('click');
  document.getElementById('modal-profile')?.classList.remove('hidden');
}

function closeProfileModal() {
  playSound('click');
  document.getElementById('modal-profile')?.classList.add('hidden');
}

function openProvablyFairModal() {
  playSound('click');
  const modal = document.getElementById('modal-pf');
  if (modal) {
    modal.classList.remove('hidden');
    const hashInput = document.getElementById('pf-modal-server-hash');
    if (hashInput) hashInput.value = state.serverSeedHash || 'Unverified';
  }
}

function closeProvablyFairModal() {
  playSound('click');
  document.getElementById('modal-pf')?.classList.add('hidden');
}

function injectMobileAndNavigationDOM() {
  if (!document.getElementById('modal-profile')) {
    const profileModal = document.createElement('div');
    profileModal.id = 'modal-profile';
    profileModal.className = 'modal-backdrop hidden';
    profileModal.innerHTML = `
      <div class="modal-box" style="max-width: 400px;">
        <div class="modal-header-flex">
          <h3>👤 User Profile</h3>
          <button class="x-close" onclick="closeProfileModal()">×</button>
        </div>
        <p class="modal-subtitle">Manage your account settings and preferences.</p>
        <div class="form-group" style="margin: 15px 0;">
          <label class="form-label">Session Status</label>
          <input type="text" class="form-input" readonly value="Authenticated Guest">
        </div>
        <div class="modal-actions-flex" style="margin-top: 20px;">
          <button type="button" onclick="closeProfileModal()" class="btn-play btn-full">Close</button>
        </div>
      </div>`;
    document.body.appendChild(profileModal);
  }
}

// ==========================================================================
// 11. UTILITIES & EVENT BINDINGS
// ==========================================================================

function escapeHTML(str) {
  return String(str).replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

function setupGlobalEventListeners() {
  const primaryBtn = document.getElementById('btn-primary-action');
  if (primaryBtn) {
    primaryBtn.removeEventListener('click', handlePrimaryAction);
    primaryBtn.addEventListener('click', handlePrimaryAction);
  }

  const audioBtn = document.getElementById('btn-toggle-sfx');
  if (audioBtn) {
    audioBtn.addEventListener('click', () => {
      state.sfxEnabled = !state.sfxEnabled;
      audioBtn.textContent = state.sfxEnabled ? '🔊 SFX ON' : '🔇 SFX OFF';
    });
  }

  document.addEventListener('click', (e) => {
    const container = document.querySelector('.wallet-selector-container');
    if (container && !container.contains(e.target)) {
      closeWalletDropdown();
    }
  });
}

window.addEventListener('DOMContentLoaded', initSession);