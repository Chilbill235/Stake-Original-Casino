/**
 * SWEEPSTAKES CASINO FRONTEND CONTROLLER (UPGRADED & FULLY UNIFIED)
 * Integrated State Management, Interactive Games, Provably Fair Suite, Audio SFX, Live Feed & Embedded Payments
 */

// ==========================================================================
// 1. GLOBAL STATE & CONFIGURATION
// ==========================================================================

const state = {
  currency: localStorage.getItem('casino_currency') || 'GC', // Persistent currency choice
  currentGame: null,
  balances: { gc: 10000.0, sc: 10.0 },
  selectedKenoNumbers: [],
  activeGameState: null, // Persistent multi-step state (Mines, Blackjack, Hilo, Tower)
  isProcessing: false,   // In-flight request lock
  activeCheckoutInstance: null,
  ws: null,
  wsReconnectTimer: null,
  feedFilter: 'ALL',     // 'ALL', 'MY_BETS', 'HIGH_ROLLERS'
  clientSeed: localStorage.getItem('casino_client_seed') || generateRandomSeed(),
  serverSeedHash: '',
  nonce: 0,
  sfxEnabled: true
};

// ==========================================================================
// 2. SYNTHESIZED WEB AUDIO SFX ENGINE (Zero External Files)
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
    const data = await res.json();

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

  state.ws.onerror = (err) => {
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
    <span><strong>${escapeHTML(data.username || 'Anonymous')}</strong> (${escapeHTML(data.game)})</span>
    <span style="color: ${data.win ? '#00e701' : '#ff0055'}; font-weight:700;">
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
      tag.className = 'currency-badge-icon badge-gc';
    }
    if (val) val.textContent = formattedGc;
    if (optionGc) optionGc.classList.add('active');
    if (optionSc) optionSc.classList.remove('active');
  } else {
    if (tag) {
      tag.textContent = 'SC';
      tag.className = 'currency-badge-icon badge-sc';
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
  } else if (action === '25%') {
    currentBet = Math.max(0.01, maxBalance * 0.25);
  } else if (action === '50%') {
    currentBet = Math.max(0.01, maxBalance * 0.5);
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
  if (container) container.innerHTML = '';
  if (state.activeCheckoutInstance) {
    try {
      state.activeCheckoutInstance.destroy();
    } catch (e) {
      console.warn('Checkout cleanup warning:', e);
    }
    state.activeCheckoutInstance = null;
  }
}

/**
 * Dynamically loads Stripe.js v3 SDK if not present in window scope.
 */
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

/**
 * Embedded Payment Checkout Integration
 */
async function buyCoinPackage(packageId) {
  try {
    playSound('click');
    openStoreModal();

    let container = document.getElementById('checkout-container');

    // Auto-create embedded container element inside store modal if missing
    if (!container) {
      const modalContent = document.querySelector('#modal-store .modal-content') || document.getElementById('modal-store') || document.body;
      container = document.createElement('div');
      container.id = 'checkout-container';
      container.style.marginTop = '15px';
      container.style.minHeight = '400px';
      modalContent.appendChild(container);
    }

    container.style.display = 'block';
    container.innerHTML = '<div style="text-align:center; padding:30px; color:#b1bad2; font-weight:600;">Loading secure embedded checkout...</div>';

    // Clean up active checkout instance if running
    if (state.activeCheckoutInstance) {
      try {
        state.activeCheckoutInstance.destroy();
      } catch (e) {
        console.warn('Checkout instance cleanup warning:', e);
      }
      state.activeCheckoutInstance = null;
    }

    // 1. Fetch Session Data from API
    const data = await apiRequest('/api/user/buy-coins', 'POST', { packageId });

    if (!data.publishableKey || !data.clientSecret) {
      throw new Error(data.error || 'Invalid session configuration returned from server.');
    }

    // 2. Load SDK dynamically & init Stripe
    const StripeSDK = await loadStripeSdk();
    const stripe = StripeSDK(data.publishableKey);

    container.innerHTML = ''; // Clear loading text

    // 3. Initialize Embedded Checkout
    state.activeCheckoutInstance = await stripe.initEmbeddedCheckout({
      clientSecret: data.clientSecret,
      onComplete: () => {
        playSound('win');
        alert('Payment completed successfully! Balance refreshed.');
        closeStoreModal();
        initSession();
      }
    });

    // 4. Mount Embedded Payment UI directly into the in-page container
    state.activeCheckoutInstance.mount('#checkout-container');

  } catch (err) {
    console.error('[Embedded Payment Error]:', err);
    const container = document.getElementById('checkout-container');
    if (container) {
      container.innerHTML = `
        <div style="color:#ff0055; text-align:center; padding:20px; font-weight:700; border:1px solid #ff0055; border-radius:6px; background:rgba(255,0,85,0.05);">
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
// 8. LOBBY, SEARCH & CATEGORY FILTERING
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

// ==========================================================================
// 9. GAME LAUNCH ROUTER
// ==========================================================================

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
        <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
          <select id="dice-cond" class="game-select" onchange="updateDiceOdds()">
            <option value="OVER">OVER</option>
            <option value="UNDER">UNDER</option>
          </select>
          <input type="number" id="dice-target" value="50.00" step="0.01" min="0.01" max="98.99" class="game-input" oninput="updateDiceOdds()">
          <span id="dice-win-chance" style="color:#00e701; font-weight:700;">Chance: 49.50%</span>
        </div>`;
      setTimeout(updateDiceOdds, 50);
      break;

    case 'limbo':
      options.innerHTML = `
        <label style="font-weight:700;">Target Multiplier: </label>
        <input type="number" id="limbo-target" value="2.00" step="0.1" min="1.01" max="10000" class="game-input">`;
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
        <label style="font-weight:700;">Start Level: </label>
        <span style="color:#b1bad2;">Guess Higher or Lower continuously to build multiplier</span>`;
      actionBtn.textContent = 'START HILO';
      break;

    case 'tower':
      options.innerHTML = `
        <label style="font-weight:700;">Difficulty: </label>
        <select id="tower-difficulty" class="game-select">
          <option value="EASY">Easy (2/3 Safe)</option>
          <option value="MEDIUM" selected>Medium (1/2 Safe)</option>
          <option value="HARD">Hard (1/3 Safe)</option>
        </select>`;
      actionBtn.textContent = 'START TOWER';
      break;

    case 'mines':
      options.innerHTML = `
        <label style="font-weight:700;">Mines Count: </label>
        <input type="number" id="mines-count" value="3" min="1" max="24" class="game-input">`;
      actionBtn.textContent = 'START MINES';
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

    case 'wheel':
      options.innerHTML = `
        <label style="font-weight:700;">Risk: </label>
        <select id="wheel-risk" class="game-select">
          <option value="LOW">Low</option>
          <option value="MEDIUM" selected>Medium</option>
          <option value="HIGH">High</option>
        </select>`;
      actionBtn.textContent = 'SPIN WHEEL';
      break;
  }

  if (!['mines', 'hilo', 'tower', 'blackjack', 'slots', 'wheel'].includes(gameId)) {
    actionBtn.textContent = 'PLACE BET';
  }

  document.getElementById('game-display-area').innerHTML = `
    <div style="color:#b1bad2; font-weight:700; text-align:center; padding: 40px; font-size:1.1rem;">
      Place your bet to begin.
    </div>`;
}

// ==========================================================================
// 10. PRIMARY ACTION DISPATCHER
// ==========================================================================

function handlePrimaryAction() {
  if (state.isProcessing) return;

  const currentBalance = state.currency === 'GC' ? state.balances.gc : state.balances.sc;
  const betInput = document.getElementById('bet-input');
  const betAmount = parseFloat(betInput?.value || 0);

  if (state.activeGameState) {
    if (state.currentGame === 'mines') return cashoutMines();
    if (state.currentGame === 'hilo') return cashoutHilo();
    if (state.currentGame === 'tower') return cashoutTower();
  }

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
      startMinesGame(betAmount);
      break;
    case 'hilo':
      startHiloGame(betAmount);
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
    case 'wheel':
      executeWheelBet(betAmount);
      break;
    default:
      executeStandardBet(betAmount);
      break;
  }
}

// ==========================================================================
// 11. INTERACTIVE GAME ENGINES
// ==========================================================================

/* --- BLACKJACK --- */
async function startBlackjackRound(betAmount) {
  state.isProcessing = true;
  playSound('chip');
  const actionBtn = document.getElementById('btn-primary-action');
  actionBtn.disabled = true;

  try {
    const data = await apiRequest('/api/play/blackjack/deal', 'POST', {
      currency: state.currency,
      betAmount,
      clientSeed: state.clientSeed
    });

    state.balances = data.balances;
    updateWalletUI();
    state.nonce++;

    if (data.isFinished) {
      state.activeGameState = null;
      renderBlackjackBoard(data, false);
      if (data.win) playSound('win'); else playSound('loss');
    } else {
      state.activeGameState = { id: data.gameId, betAmount };
      renderBlackjackBoard(data, true);
    }
  } catch (err) {
    alert(err.message || 'Blackjack initialization failed');
  } finally {
    state.isProcessing = false;
    actionBtn.disabled = false;
  }
}

async function handleBlackjackAction(action) {
  if (state.isProcessing || !state.activeGameState) return;

  state.isProcessing = true;
  playSound('click');

  try {
    const data = await apiRequest(`/api/play/blackjack/${action}`, 'POST', {
      gameId: state.activeGameState.id
    });

    if (data.balances) {
      state.balances = data.balances;
      updateWalletUI();
    }

    if (data.isFinished) {
      state.activeGameState = null;
      renderBlackjackBoard(data, false);
      if (data.win) playSound('win'); else playSound('loss');
    } else {
      renderBlackjackBoard(data, true);
    }
  } catch (err) {
    alert(err.message || 'Blackjack action failed');
  } finally {
    state.isProcessing = false;
  }
}

function renderBlackjackBoard(data, inProgress) {
  const display = document.getElementById('game-display-area');
  const options = document.getElementById('game-controls-options');
  const actionBtn = document.getElementById('btn-primary-action');

  let statusText = 'GAME IN PROGRESS';
  let statusClass = 'text-info';

  if (!inProgress) {
    statusClass = data.win ? 'text-win' : (data.multiplier === 1 ? 'text-push' : 'text-loss');
    statusText = data.win 
      ? `YOU WIN! (${data.multiplier.toFixed(2)}x)` 
      : (data.multiplier === 1 ? 'PUSH (TIE)' : 'HOUSE WINS');
  }

  display.innerHTML = `
    <div class="bj-table-grid">
      <div class="round-outcome-banner ${statusClass}">${statusText}</div>
      <div class="bj-hand-section">
        <span class="bj-label">Dealer Hand (${inProgress ? '?' : data.details.dealerScore})</span>
        ${renderCards(data.details.dealerHand)}
      </div>
      <div class="bj-hand-section">
        <span class="bj-label">Your Hand (${data.details.playerScore})</span>
        ${renderCards(data.details.playerHand)}
      </div>
    </div>`;

  if (inProgress) {
    actionBtn.style.display = 'none';
    options.innerHTML = `
      <div style="display:flex; gap:8px; width:100%; justify-content:center;">
        <button class="game-btn-action" onclick="handleBlackjackAction('hit')">HIT</button>
        <button class="game-btn-action" onclick="handleBlackjackAction('stand')">STAND</button>
        <button class="game-btn-action" onclick="handleBlackjackAction('double')" ${data.details.canDouble ? '' : 'disabled'}>DOUBLE</button>
      </div>`;
  } else {
    actionBtn.style.display = 'block';
    actionBtn.textContent = 'DEAL HAND';
    options.innerHTML = '';
  }

  updateProvablyFairHash(data.provablyFair?.serverSeedHash);
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
  let boardHtml = '<div class="mines-grid" id="mines-board">';
  for (let i = 0; i < 25; i++) {
    boardHtml += `<button class="mine-tile" id="mine-tile-${i}" onclick="revealMineTile(${i})">?</button>`;
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
        tile.style.background = '#ff0055';
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

/* --- HILO ENGINE --- */
async function startHiloGame(betAmount) {
  state.isProcessing = true;
  playSound('chip');

  try {
    const data = await apiRequest('/api/play/hilo/start', 'POST', {
      currency: state.currency,
      betAmount,
      clientSeed: state.clientSeed
    });

    state.balances = data.balances;
    updateWalletUI();
    state.nonce++;

    state.activeGameState = {
      gameId: data.gameId,
      currentCard: data.card,
      currentMultiplier: 1.00
    };

    renderHiloBoard(data.card, 1.00, true);
  } catch (err) {
    alert(err.message || 'Hilo start failed');
  } finally {
    state.isProcessing = false;
  }
}

async function guessHilo(guess) {
  if (state.isProcessing || !state.activeGameState) return;

  state.isProcessing = true;
  playSound('click');

  try {
    const data = await apiRequest('/api/play/hilo/guess', 'POST', {
      gameId: state.activeGameState.gameId,
      guess
    });

    if (data.win) {
      playSound('win');
      state.activeGameState.currentCard = data.nextCard;
      state.activeGameState.currentMultiplier = data.multiplier;
      renderHiloBoard(data.nextCard, data.multiplier, true);
    } else {
      playSound('loss');
      alert(`Wrong guess! Drawn card was ${data.nextCard.value}${data.nextCard.suit}.`);
      state.activeGameState = null;
      launchGame('hilo');
    }
  } catch (err) {
    alert(err.message || 'Hilo guess failed');
  } finally {
    state.isProcessing = false;
  }
}

async function cashoutHilo() {
  if (state.isProcessing || !state.activeGameState) return;
  state.isProcessing = true;
  playSound('win');

  try {
    const data = await apiRequest('/api/play/hilo/cashout', 'POST', {
      gameId: state.activeGameState.gameId
    });

    state.balances = data.balances;
    updateWalletUI();
    alert(`Cashed out for ${data.payout.toFixed(2)} ${state.currency}!`);
    state.activeGameState = null;
    launchGame('hilo');
  } catch (err) {
    alert(err.message || 'Hilo cashout failed');
  } finally {
    state.isProcessing = false;
  }
}

function renderHiloBoard(card, multiplier, inProgress) {
  const display = document.getElementById('game-display-area');
  const options = document.getElementById('game-controls-options');
  const actionBtn = document.getElementById('btn-primary-action');

  display.innerHTML = `
    <div style="text-align:center; padding: 20px;">
      <div class="round-outcome-banner text-win" style="margin-bottom:12px;">Multiplier: ${multiplier.toFixed(2)}x</div>
      <div style="font-size: 1.2rem; margin-bottom: 10px; color:#b1bad2;">Current Card:</div>
      ${renderCards([card])}
    </div>`;

  if (inProgress) {
    actionBtn.textContent = `CASHOUT (${multiplier.toFixed(2)}x)`;
    options.innerHTML = `
      <div style="display:flex; gap:10px; justify-content:center;">
        <button class="game-btn-action" onclick="guessHilo('HIGHER')">HIGHER OR EQUAL ▲</button>
        <button class="game-btn-action" onclick="guessHilo('LOWER')">LOWER OR EQUAL ▼</button>
      </div>`;
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

  let html = '<div class="tower-grid" style="display:flex; flex-direction:column-reverse; gap:8px; max-width:280px; margin:auto;">';
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

/* --- ANIMATED SLOTS ENGINE --- */
async function executeAnimatedSlots(betAmount) {
  state.isProcessing = true;
  playSound('chip');
  const actionBtn = document.getElementById('btn-primary-action');
  const display = document.getElementById('game-display-area');
  actionBtn.disabled = true;

  try {
    const data = await apiRequest('/api/play/slots', 'POST', {
      currency: state.currency,
      betAmount,
      clientSeed: state.clientSeed
    });

    state.balances = data.balances;
    updateWalletUI();
    state.nonce++;

    display.innerHTML = `
      <div class="slot-container">
        <div class="slot-reel blur-spin" id="reel-0"><span>🍒</span></div>
        <div class="slot-reel blur-spin" id="reel-1"><span>🍋</span></div>
        <div class="slot-reel blur-spin" id="reel-2"><span>💎</span></div>
      </div>`;

    let spinInterval = setInterval(() => playSound('spin'), 100);

    setTimeout(() => {
      const r0 = document.getElementById('reel-0');
      if (r0) { r0.classList.remove('blur-spin'); r0.innerHTML = `<span>${data.result[1][0]}</span>`; }
    }, 400);

    setTimeout(() => {
      const r1 = document.getElementById('reel-1');
      if (r1) { r1.classList.remove('blur-spin'); r1.innerHTML = `<span>${data.result[1][1]}</span>`; }
    }, 800);

    setTimeout(() => {
      clearInterval(spinInterval);
      const r2 = document.getElementById('reel-2');
      if (r2) { r2.classList.remove('blur-spin'); r2.innerHTML = `<span>${data.result[1][2]}</span>`; }

      setTimeout(() => {
        if (data.win) playSound('win'); else playSound('loss');
        const statusClass = data.win ? 'text-win' : 'text-loss';
        display.innerHTML = `
          <div style="text-align:center;">
            <div class="round-outcome-banner ${statusClass}" style="margin-bottom: 12px;">${data.multiplier.toFixed(2)}x Payout</div>
            <div class="slot-container">
              ${data.result[1].map(s => `<div class="slot-reel"><span>${s}</span></div>`).join('')}
            </div>
          </div>`;
        actionBtn.disabled = false;
        state.isProcessing = false;
        updateProvablyFairHash(data.provablyFair?.serverSeedHash);
      }, 300);
    }, 1200);

  } catch (err) {
    alert(err.message || 'Slots spin failed');
    actionBtn.disabled = false;
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
          <div style="font-size: 3.5rem; font-weight: 800; color: ${progress === 1 ? (data.win ? '#00e701' : '#ff0055') : '#fff'};">
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

  const label = document.getElementById('dice-win-chance');
  if (label) {
    label.textContent = `Chance: ${Math.max(0, winChance).toFixed(2)}% (${multiplier.toFixed(2)}x)`;
  }
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
    const statusClass = data.win ? 'text-win' : 'text-loss';

    display.innerHTML = `
      <div style="text-align:center; padding: 20px;">
        <div class="round-outcome-banner ${statusClass}" style="margin-bottom: 12px; font-size:2rem;">
          Rolled: ${data.details.rolled.toFixed(2)}
        </div>
        <p style="font-weight: 600; font-size: 1.1rem; color: #b1bad2;">
          ${data.win ? 'WIN' : 'LOSS'} - Target: ${condition} ${target.toFixed(2)} (${data.multiplier.toFixed(2)}x)
        </p>
      </div>`;

    updateProvablyFairHash(data.provablyFair?.serverSeedHash);
  } catch (err) {
    alert(err.message || 'Dice bet failed');
  } finally {
    state.isProcessing = false;
  }
}

/* --- WHEEL ENGINE --- */
async function executeWheelBet(betAmount) {
  state.isProcessing = true;
  playSound('chip');
  const risk = document.getElementById('wheel-risk')?.value || 'MEDIUM';

  try {
    const data = await apiRequest('/api/play/wheel', 'POST', {
      currency: state.currency,
      betAmount,
      params: { risk },
      clientSeed: state.clientSeed
    });

    state.balances = data.balances;
    updateWalletUI();
    state.nonce++;

    if (data.win) playSound('win'); else playSound('loss');

    const display = document.getElementById('game-display-area');
    const statusClass = data.win ? 'text-win' : 'text-loss';

    display.innerHTML = `
      <div style="text-align:center; padding: 20px;">
        <div class="round-outcome-banner ${statusClass}" style="margin-bottom: 12px; font-size:2rem;">
          ${data.multiplier.toFixed(2)}x
        </div>
        <p style="font-weight: 600; font-size: 1.1rem; color: #b1bad2;">
          Landed on Segment: ${data.details.segment}
        </p>
      </div>`;

    updateProvablyFairHash(data.provablyFair?.serverSeedHash);
  } catch (err) {
    alert(err.message || 'Wheel bet failed');
  } finally {
    state.isProcessing = false;
  }
}

/* --- BACCARAT ENGINE --- */
async function executeBaccaratRound(betAmount) {
  state.isProcessing = true;
  playSound('chip');
  const target = document.getElementById('baccarat-target')?.value || 'PLAYER';
  const actionBtn = document.getElementById('btn-primary-action');
  const display = document.getElementById('game-display-area');

  actionBtn.disabled = true;

  try {
    const data = await apiRequest('/api/play/baccarat', 'POST', {
      currency: state.currency,
      betAmount,
      params: { target },
      clientSeed: state.clientSeed
    });

    state.balances = data.balances;
    updateWalletUI();
    state.nonce++;

    display.innerHTML = `<p style="color:#00e701; font-weight:600; text-align:center; padding:20px;">Dealing Cards...</p>`;

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
    }, 400);

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
    }, 800);

    setTimeout(() => {
      if (data.win) playSound('win'); else playSound('loss');
      const statusClass = data.win ? 'text-win' : 'text-loss';
      display.innerHTML = `
        <div class="bj-table-grid">
          <div class="round-outcome-banner ${statusClass}">${data.multiplier.toFixed(2)}x - ${data.details.outcome} WIN</div>
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
    }, 1200);

  } catch (err) {
    alert(err.message || 'Baccarat failed');
    actionBtn.disabled = false;
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
    alert(err.message || `${state.currentGame} failed`);
  } finally {
    actionBtn.disabled = false;
    state.isProcessing = false;
  }
}

// ==========================================================================
// 12. UTILITY & EVENT BINDINGS
// ==========================================================================

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

  const clientSeedInput = document.getElementById('pf-client-seed');
  if (clientSeedInput) {
    clientSeedInput.addEventListener('change', (e) => {
      state.clientSeed = e.target.value || generateRandomSeed();
      localStorage.setItem('casino_client_seed', state.clientSeed);
    });
  }

  const audioBtn = document.getElementById('btn-toggle-sfx');
  if (audioBtn) {
    audioBtn.addEventListener('click', () => {
      state.sfxEnabled = !state.sfxEnabled;
      audioBtn.textContent = state.sfxEnabled ? '🔊 SFX ON' : '🔇 SFX OFF';
    });
  }

  // Dismiss wallet menu on outside click
  document.addEventListener('click', (e) => {
    const container = document.querySelector('.wallet-selector-container');
    if (container && !container.contains(e.target)) {
      closeWalletDropdown();
    }
  });
}

window.addEventListener('DOMContentLoaded', initSession);