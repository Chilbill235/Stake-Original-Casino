/**
 * SWEEPSTAKES CASINO FRONTEND CONTROLLER (UPGRADED & FULLY UNIFIED)
 * Integrated State Management, Interactive Games, Provably Fair Suite, Audio SFX, Live Feed & Embedded Mode Protection
 */

// ==========================================================================
// 1. GLOBAL STATE & CONFIGURATION
// ==========================================================================

const state = {
  currency: localStorage.getItem('casino_currency') || 'GC',
  currentGame: null,
  balances: { gc: 10000.0, sc: 10.0 },
  profile: null,
  selectedKenoNumbers: [],
  activeGameState: null,
  isProcessing: false,
  activeCheckoutInstance: null,
  ws: null,
  wsReconnectTimer: null,
  feedFilter: 'ALL',
  liveBetBuffer: [],
  clientSeed: localStorage.getItem('casino_client_seed') || generateRandomSeed(),
  serverSeedHash: localStorage.getItem('casino_server_hash') || 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  nonce: parseInt(localStorage.getItem('casino_nonce') || '0', 10),
  sfxEnabled: true,
   isEmbedded: window.self !== window.top
};
window.__CASINO_CURRENCY = state.currency;

const RESTRICTED_STATES = ['WA', 'ID', 'NV', 'KY', 'MI', 'GA'];

// ==========================================================================
// 2. SYNTHESIZED WEB AUDIO SFX ENGINE
// ==========================================================================

let audioCtx = null;
let audioReady = false;

function initAudioContext() {
  if (audioCtx) {
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().then(() => { audioReady = true; }).catch(() => {});
    } else if (audioCtx.state === 'running') {
      audioReady = true;
    }
    return;
  }
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  try {
    audioCtx = new AudioContextClass();
    if (audioCtx.state === 'running') audioReady = true;
    else audioCtx.resume().then(() => { audioReady = true; }).catch(() => {});
  } catch (e) {
    console.warn('[Audio]: Failed to init AudioContext', e);
  }
}

function playSound(type) {
  if (!state.sfxEnabled) return;
  if (!audioCtx) return;

  const ctx = audioCtx;
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
  if (ctx.state !== 'running') return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);

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

    case 'card-deal':
      osc.type = 'sine';
      osc.frequency.setValueAtTime(900, now);
      osc.frequency.exponentialRampToValueAtTime(400, now + 0.04);
      gain.gain.setValueAtTime(0.08, now);
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

    let data = {};
    const text = await res.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (parseErr) {
        console.warn('[API Parse Warning]: Non-JSON response received', text);
      }
    }

    if (res.status === 401 && !state.authRecoveryInFlight) {
      const isAuthEndpoint = endpoint.startsWith('/api/auth/');
      const hasToken = !!localStorage.getItem('casino_token');
      if (!isAuthEndpoint && hasToken) {
        state.authRecoveryInFlight = true;
        localStorage.removeItem('casino_token');
        localStorage.removeItem('casino_username');
        openAuthModal();
        const expired = new Error('Session expired. Please log in again.');
        expired.code = 'AUTH_EXPIRED';
        expired.status = 401;
        state.authRecoveryInFlight = false;
        throw expired;
      }
    }

    if (!res.ok) {
      const error = new Error(data.error || 'Server error occurred');
      error.status = res.status;
      error.data = data;
      error.requiresKyc = data.requiresKyc;
      error.requiresOnboarding = data.requiresOnboarding;
      error.onboardingUrl = data.onboardingUrl;
      error.requiresAccount = data.requiresAccount;
      error.geoRestricted = data.geo?.restricted || data.geoRestricted || false;
      error.isVpn = data.geo?.isVpn || false;
      error.riskScore = data.geo?.riskScore || 0;
      throw error;
    }
    return data;
  } catch (err) {
    if (err.geoRestricted) {
      showGeoRestrictionModal(err);
    }
    if (!err.status && !err.code) {
      err.code = 'NETWORK_ERROR';
    }
    throw err;
  }
}

async function detectGeoLocation() {
  try {
    const data = await fetch('/api/geo/lookup').then(r => r.json());
    state.detectedState = data.state || 'CA';
    if (data.restricted) {
      const stateSelect = document.getElementById('reg-state');
      if (stateSelect) {
        stateSelect.value = data.state;
        stateSelect.disabled = true;
        stateSelect.title = 'Restricted jurisdiction';
      }
      state.isRestrictedJurisdiction = true;
    }
    state.geoDetected = true;
  } catch (e) {
    state.detectedState = 'CA';
  }
}

async function initSession(autoGuest = true) {
  const ageConfirmed = localStorage.getItem('casino_age_confirmed') === 'true';
  if (!ageConfirmed) {
    document.getElementById('modal-agegate')?.classList.remove('hidden');
    return;
  }

  await detectGeoLocation();

  let token = localStorage.getItem('casino_token');

  if (!token) {
    if (autoGuest) {
      await continueAsGuest();
    } else {
      openAuthModal();
    }
    return;
  }

  try {
    const data = await apiRequest('/api/user/me');
    if (data.balances) state.balances = mergeBalances(data.balances);
    if (data.username) localStorage.setItem('casino_username', data.username);
    state.profile = data;
  } catch (err) {
    if (err.geoRestricted) {
      showGeoRestrictionModal(err);
      return;
    }
    if (err && (err.status === 401 || err.status === 403 || err.status === 404)) {
      if (autoGuest) {
        console.warn('[Auth failure]: Token rejected (HTTP ' + err.status + '), falling back to guest.', err.message);
        localStorage.removeItem('casino_token');
        localStorage.removeItem('casino_username');
        await continueAsGuest();
      } else {
        console.warn('[Auth failure]: Token rejected (HTTP ' + err.status + '), clearing.', err.message);
        localStorage.removeItem('casino_token');
        localStorage.removeItem('casino_username');
        openAuthModal();
      }
      return;
    }
    console.warn('[Auth]: Transient /api/user/me error, keeping session token:', (err && err.message) || err);
    return;
  }

  await fetchFairSeed();
  updateWalletUI();
  connectWebSocket();
  setupGlobalEventListeners();
  initScrollReveal();
  initHeroParticles();
  initProvablyFairUI();
  injectMobileAndNavigationDOM();
  applyEmbeddedModeRestrictions();
  updateUserProfileBadge();

  // Deep-link support: re-render the initial route once the session is loaded.
  reapplyCurrentRoute();
}

/**
 * Pulls the authoritative provably-fair seed state (hash / client seed /
 * nonce) from the server so the UI never drifts from reality.
 */
async function fetchFairSeed() {
  try {
    const d = await apiRequest('/api/provably-fair/seed');
    if (d.serverSeedHash) {
      state.serverSeedHash = d.serverSeedHash;
      localStorage.setItem('casino_server_hash', d.serverSeedHash);
    }
    if (d.clientSeed) {
      state.clientSeed = d.clientSeed;
      localStorage.setItem('casino_client_seed', d.clientSeed);
    }
    if (typeof d.nonce === 'number') {
      state.nonce = d.nonce;
      localStorage.setItem('casino_nonce', String(d.nonce));
    }
    updateProvablyFairHash();
  } catch (err) {
    console.warn('[Provably Fair] Seed info unavailable:', err.message);
  }
}

/**
 * Applies provably-fair metadata returned by any play endpoint so hash and
 * nonce shown in the UI always match the bet just settled.
 */
function syncFair(data) {
  if (!data || !data.provablyFair) return;
  state.serverSeedHash = data.provablyFair.serverSeedHash;
  state.clientSeed = data.provablyFair.clientSeed;
  state.nonce = data.provablyFair.nonce;
  localStorage.setItem('casino_server_hash', state.serverSeedHash);
  localStorage.setItem('casino_nonce', String(state.nonce));
  updateProvablyFairHash();
}

// ==========================================================================
// 4. EMBEDDED MODE RESTRICTIONS
// ==========================================================================

function applyEmbeddedModeRestrictions() {
  if (!state.isEmbedded) return;

  const storeTriggers = document.querySelectorAll('.store-trigger-btn, .buy-coins-container, #wallet-dropdown-menu');
  storeTriggers.forEach(el => {
    el.style.display = 'none';
  });

  const walletDisplay = document.querySelector('.wallet-selector-container');
  if (walletDisplay) {
    walletDisplay.style.filter = 'blur(6px)';
    walletDisplay.style.pointerEvents = 'none';
    walletDisplay.title = 'Purchases and balances hidden in embed view';
  }
}

// ==========================================================================
// 5. WEBSOCKET REAL-TIME LIVE BETS FEED
// ==========================================================================

function connectWebSocket() {
  if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = localStorage.getItem('casino_token') || '';

  state.wsReconnectAttempts = (state.wsReconnectAttempts || 0) + 1;
  if (state.wsReconnectAttempts > 5) {
    if (!state.wsReconnectGaveUp) {
      console.info('[WebSocket]: Giving up after failed attempts; running offline feed.');
      state.wsReconnectGaveUp = true;
    }
    return;
  }

  try {
    state.ws = new WebSocket(`${protocol}//${window.location.host}?token=${token}`);

    state.ws.onopen = () => {
      state.wsReconnectAttempts = 0;
      if (state.wsReconnectTimer) clearTimeout(state.wsReconnectTimer);
    };

    state.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        switch (data.type) {
          case 'LIVE_BET':
            renderLiveBetRow(data);
            break;
          case 'BALANCE_UPDATE':
            if (data.balances) {
              state.balances = {
                gc: data.balances.gc,
                sc: data.balances.sc,
                sc_unplayed: data.balances.sc_unplayed != null ? data.balances.sc_unplayed : state.balances.sc_unplayed,
                sc_played: data.balances.sc_played != null ? data.balances.sc_played : state.balances.sc_played
              };
            }
            updateWalletUI();
            break;
          case 'KYC_STATUS_UPDATE':
            if (state.profile) state.profile.kyc = data.kyc;
            if (data.message) alert(data.message);
            if (document.getElementById('view-account') && !document.getElementById('view-account').classList.contains('hidden')) {
              refreshAccountPage();
            }
            break;
          case 'GAME_RESULT':
            renderGameResultRow(data);
            break;
        }
      } catch (err) {
        console.error('[WS Parse Error]:', err);
      }
    };

    state.ws.onclose = () => {
      const delay = Math.min(30000, 3000 * state.wsReconnectAttempts);
      state.wsReconnectTimer = setTimeout(connectWebSocket, delay);
    };

    state.ws.onerror = () => {
      try { state.ws?.close(); } catch (e) {}
    };
  } catch (e) {
    console.warn('[WebSocket Warning]: Connection failed, running standalone offline feed.');
  }
}

function setFeedFilter(filter) {
  state.feedFilter = filter;
  document.querySelectorAll('.feed-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === filter);
  });
  renderBetFeed();
}

function renderBetFeed() {
  const feed = document.getElementById('bets-feed');
  if (!feed) return;
  feed.innerHTML = '';
  const myUsername = localStorage.getItem('casino_username') || 'You';
  for (const data of state.liveBetBuffer) {
    const isMyBet = data.username === myUsername;
    const isHighRoller = Number(data.payout || 0) >= 100 || Number(data.multiplier || 0) >= 10;
    if (state.feedFilter === 'MY_BETS' && !isMyBet) continue;
    if (state.feedFilter === 'HIGH_ROLLERS' && !isHighRoller) continue;

    const row = document.createElement('div');
    row.className = `bet-row ${isMyBet ? 'my-bet' : ''}`;
    const winClass = data.win ? 'win' : 'loss';
    const winLabel = data.win ? 'WIN' : 'LOSS';
    row.innerHTML =
      `<div class="bet-user-game">` +
      `<span class="bet-user">${escapeHTML(data.username || 'Anonymous')}</span>` +
      `<span class="bet-game">${escapeHTML(data.game)}</span>` +
      `</div>` +
      `<span class="bet-mult ${winClass}">` +
      `${winLabel} ${Number(data.multiplier).toFixed(2)}x (${formatCoins(data.payout || 0)} ${data.currency || 'GC'})` +
      `</span>`;
    feed.appendChild(row);
  }
}

function renderLiveBetRow(data) {
  if (!state.liveBetBuffer) state.liveBetBuffer = [];
  state.liveBetBuffer.unshift(data);
  if (state.liveBetBuffer.length > 50) state.liveBetBuffer.pop();
  renderBetFeed();
}

function renderGameResultRow(data) {
  if (!state.gameResultBuffer) state.gameResultBuffer = [];
  state.gameResultBuffer.unshift(data);
  if (state.gameResultBuffer.length > 15) state.gameResultBuffer.pop();
  renderGameResultFeed();
}

function renderGameResultFeed() {
  const container = document.getElementById('game-result-feed');
  if (!container || !state.gameResultBuffer) return;
  let html = '';
  state.gameResultBuffer.forEach(item => {
    const isWin = item.win;
    const color = isWin ? '#00e701' : '#ff4d4d';
    const mult = item.multiplier ? item.multiplier.toFixed(2) + 'x' : '';
    const payout = item.payout ? formatCoins(item.payout) : '';
    html += '<div class="result-row" style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.05);font-size:0.82rem;">' +
      '<span style="color:' + color + ';font-weight:700;min-width:70px;text-transform:uppercase;font-size:0.72rem;">' + (item.game || '---') + '</span>' +
      '<span style="color:' + color + ';font-family:monospace;font-weight:700;flex:1;">' + mult + '</span>' +
      '<span style="color:#b1bad2;">' + (payout ? '+' + payout + ' ' + (item.currency || 'GC') : '') + '</span>' +
      '</div>';
  });
  container.innerHTML = html;
}

// ==========================================================================
// 6. WALLET & CURRENCY CONTROLLER
// ==========================================================================

function formatCoins(value) {
  const num = Number(value || 0);
  const comma = (n) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (num >= 1e9) return comma((num / 1e9).toFixed(2)) + 'B';
  if (num >= 1e6) return comma((num / 1e6).toFixed(2)) + 'M';
  if (num >= 1e3) return comma((num / 1e3).toFixed(2)) + 'K';
  return comma(num.toFixed(2));
}

function mergeBalances(newBalances) {
  if (!newBalances) return state.balances;
  return {
    gc: newBalances.gc != null ? newBalances.gc : state.balances.gc,
    sc: newBalances.sc != null ? newBalances.sc : state.balances.sc,
    sc_unplayed: newBalances.sc_unplayed != null ? newBalances.sc_unplayed : state.balances.sc_unplayed,
    sc_played: newBalances.sc_played != null ? newBalances.sc_played : state.balances.sc_played
  };
}

// Apply an optimistic local debit the moment a bet is placed so the navbar
// balance updates instantly instead of waiting for the server round to resolve.
// The server response overwrites this with the authoritative number.
function applyOptimisticDebit(amount) {
  if (!state.balances || !amount || isNaN(amount)) return;
  const cur = state.currency;
  if (cur === 'GC') {
    state.balances = { ...state.balances, gc: Math.max(0, (state.balances.gc || 0) - amount) };
  } else {
    state.balances = { ...state.balances, sc_unplayed: Math.max(0, (state.balances.sc_unplayed || 0) - amount) };
  }
  updateWalletUI();
}

function updateWalletUI() {
  const val = document.getElementById('balance-val');
  const formattedGc = formatCoins(state.balances.gc || 0);
  const formattedSc = formatCoins(state.balances.sc || 0);

  document.querySelectorAll('.wallet-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.currency === state.currency);
  });

  const sel = document.getElementById('wallet-selector');
  if (sel) sel.dataset.currency = state.currency;
  document.querySelectorAll('.wallet-balance').forEach(el => el.dataset.currency = state.currency);

  if (val) {
    val.textContent = state.currency === 'GC' ? formattedGc : formattedSc;
  }

  validateBetInputBounds();
}

function toggleWalletDropdown(event) {
  if (state.isEmbedded) return;
  if (event) event.stopPropagation();
  const menu = document.getElementById('wallet-dropdown');
  if (menu) {
    menu.classList.toggle('hidden');
    playSound('click');
  }
}

function closeWalletDropdown() {
  const menu = document.getElementById('wallet-dropdown');
  if (menu) menu.classList.add('hidden');
}

function openWalletDropdown(event) {
  if (state.isEmbedded) return;
  if (event) event.stopPropagation();
  const menu = document.getElementById('wallet-dropdown');
  if (menu) {
    menu.classList.toggle('hidden');
    playSound('click');
  }
}

function openBonusModalFromDropdown() {
  openBonusModal();
}

function openStoreModalFromDropdown() {
  openStoreModal();
}

function openRedeemModalFromDropdown() {
  openRedeemModal();
}

function switchCurrency(currency) {
  if (state.isProcessing) return;
  if (state.activeGameState) {
    return alert('Cannot switch currency while an active game round is in progress.');
  }

  playSound('click');
  state.currency = currency;
  window.__CASINO_CURRENCY = currency;
  localStorage.setItem('casino_currency', currency);
  const sel = document.getElementById('wallet-selector');
  if (sel) sel.dataset.currency = currency;
  updateWalletUI();
  updateBetCurrencyTag();
}

function validateBetInputBounds() {
  const input = document.getElementById('bet-input');
  if (!input) return;
  const currentBet = parseFloat(input.value) || 0;
  const maxBalance = state.currency === 'GC' ? state.balances.gc : state.balances.sc;

  if (maxBalance <= 0) {
    input.value = '0.01';
  } else if (currentBet > maxBalance) {
    input.value = maxBalance.toFixed(2);
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

function toggleAutoBet() {
  const toggle = document.getElementById('auto-bet-toggle');
  const countInput = document.getElementById('auto-bet-count');
  if (toggle && countInput) {
    countInput.style.display = toggle.checked ? 'block' : 'none';
  }
}

function updateBetCurrencyTag() {
  const tag = document.getElementById('bet-currency-tag');
  if (tag) tag.textContent = state.currency;
}

// ==========================================================================
// 7. PROVABLY FAIR CONTROLLER & SEED MANAGEMENT (STAKE-STYLE)
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
  if (clientSeedInput) {
    clientSeedInput.value = state.clientSeed;
    clientSeedInput.onchange = (e) => {
      state.clientSeed = e.target.value.trim();
      localStorage.setItem('casino_client_seed', state.clientSeed);
    };
  }
  updateProvablyFairHash();
}

async function updateClientSeed() {
  const input = document.getElementById('pf-client-seed');
  if (!input) return;
  const newSeed = input.value.trim();
  if (!newSeed) return alert('Client seed cannot be empty.');

  const oldSeed = state.clientSeed;
  state.clientSeed = newSeed;
  localStorage.setItem('casino_client_seed', newSeed);
  playSound('click');

  try {
    await apiRequest('/api/provably-fair/rotate-seed', 'POST', { newClientSeed: newSeed });
    await fetchFairSeed();
    alert('Client seed updated successfully!');
  } catch (err) {
    state.clientSeed = oldSeed;
    localStorage.setItem('casino_client_seed', oldSeed);
    if (input) input.value = oldSeed;
    alert(err.message || 'Failed to update client seed.');
  }
}

function randomizeClientSeed() {
  const newSeed = generateRandomSeed();
  state.clientSeed = newSeed;
  const clientSeedInput = document.getElementById('pf-client-seed');
  if (clientSeedInput) clientSeedInput.value = newSeed;
  updateClientSeed();
}

async function rotateServerSeed() {
  try {
    await apiRequest('/api/provably-fair/rotate-seed', 'POST', {});
    state.nonce = 0;
    localStorage.setItem('casino_nonce', '0');
    await fetchFairSeed();
    alert('Server seed rotated successfully!');
  } catch (err) {
    alert(err.message || 'Failed to rotate server seed.');
  }
}

function generateRandomHash() {
  const chars = '0123456789abcdef';
  let hash = '';
  for (let i = 0; i < 64; i++) hash += chars.charAt(Math.floor(Math.random() * chars.length));
  return hash;
}

function updateProvablyFairHash(hash) {
  if (hash) {
    state.serverSeedHash = hash;
    localStorage.setItem('casino_server_hash', hash);
  }
  
  const elem = document.getElementById('pf-hash');
  if (elem) elem.textContent = state.serverSeedHash;
  
  const modalHashInput = document.getElementById('pf-modal-server-hash');
  if (modalHashInput) modalHashInput.value = state.serverSeedHash;

  const nonceElem = document.getElementById('pf-nonce');
  if (nonceElem) nonceElem.textContent = state.nonce;
  localStorage.setItem('casino_nonce', state.nonce.toString());
}

// ==========================================================================
// 8. STORE & EMBEDDED CHECKOUT / SWEEPS COINS REDEMPTION
// ==========================================================================

function openStoreModal() {
  if (state.isEmbedded) return;
  playSound('click');
  setCheckoutStep(1);
  hideProcessingPanel();
  const modal = document.getElementById('modal-store');
  if (modal) modal.classList.remove('hidden');

  showPackageList();
}

function setCheckoutStep(step) {
  state.checkoutStep = step;
  document.querySelectorAll('.checkout-step').forEach(s => {
    s.classList.toggle('is-active', Number(s.dataset.step) === step);
    s.classList.toggle('is-complete', Number(s.dataset.step) < step);
  });
}

// --- Smooth panel transition helpers ---
var PANEL_TRANSITION_MS = 250;

function _showPanel(panel) {
  if (!panel) return;
  if (!panel.classList.contains('hidden') && !panel.classList.contains('exiting')) {
    return;
  }
  panel.classList.remove('hidden', 'exiting');
  panel.style.opacity = '0';
  panel.offsetHeight;
  panel.style.opacity = '1';
  setTimeout(function () {
    panel.style.opacity = '';
  }, PANEL_TRANSITION_MS);
}

function _hidePanel(panel, callback) {
  if (!panel) { if (callback) callback(); return; }
  if (panel.classList.contains('hidden')) { if (callback) callback(); return; }
  panel.style.opacity = '';
  panel.classList.remove('hidden');
  panel.classList.add('exiting');
  var done = false;
  var finish = function () {
    if (done) return;
    done = true;
    panel.classList.add('hidden');
    panel.classList.remove('exiting');
    panel.removeEventListener('transitionend', onEnd);
    if (callback) callback();
  };
  var onEnd = function (e) {
    if (e.propertyName !== 'opacity') return;
    finish();
  };
  panel.addEventListener('transitionend', onEnd);
  setTimeout(finish, PANEL_TRANSITION_MS + 100);
}

function hideProcessingPanel() {
  const panel = document.getElementById('payment-processing');
  const cardPanel = document.getElementById('payment-card');
  if (panel) { panel.classList.add('hidden'); panel.classList.remove('exiting'); panel.style.opacity = ''; }
  if (cardPanel) { cardPanel.classList.remove('hidden', 'exiting'); cardPanel.style.opacity = ''; }
  const loadingState = document.getElementById('checkout-loading-state');
  if (loadingState) loadingState.classList.add('hidden');
  const container = document.getElementById('stripe-checkout-container');
  if (container) container.innerHTML = '';
}

function showProcessingPanel() {
  const panel = document.getElementById('payment-processing');
  const cardPanel = document.getElementById('payment-card');
  const successSection = document.getElementById('checkout-success');
  if (panel) { panel.classList.remove('hidden'); _showPanel(panel); }
  if (cardPanel) { cardPanel.classList.add('hidden'); cardPanel.classList.remove('exiting'); cardPanel.style.opacity = ''; }
  if (successSection) successSection.classList.add('hidden');
  const fill = document.getElementById('progress-bar-fill');
  if (fill) fill.style.width = '0%';
  let w = 0;
  const barInterval = setInterval(() => {
    w = Math.min(85, w + Math.random() * 12);
    if (fill) fill.style.width = w + '%';
  }, 350);
  return () => clearInterval(barInterval);
}

function closeStoreModal() {
  playSound('click');
  stopCryptoPolling();
  const modal = document.getElementById('modal-store');
  if (modal) modal.classList.add('hidden');

  const container = document.getElementById('stripe-checkout-container');
  if (container) {
    container.innerHTML = '';
  }

  hideCheckoutSections();
  showPackageList();

  if (state.activeCheckoutInstance) {
    try { state.activeCheckoutInstance.destroy(); } catch (e) { console.warn('Checkout cleanup:', e); }
    state.activeCheckoutInstance = null;
  }
}

function hideCheckoutSections() {
  const checkoutSection = document.getElementById('checkout-section');
  const successSection = document.getElementById('checkout-success');
  const processing = document.getElementById('payment-processing');
  if (checkoutSection) checkoutSection.classList.add('hidden');
  if (successSection) successSection.classList.add('hidden');
  if (processing) processing.classList.add('hidden');
}

function resetStoreModal() {
  state.lastPackageId = null;
  state.selectedPaymentMethod = null;
  setCheckoutStep(1);
  hideProcessingPanel();
  var pkgList = document.getElementById('package-selection');
  var summary = document.getElementById('package-summary');
  var checkoutSection = document.getElementById('checkout-section');
  var successSection = document.getElementById('checkout-success');
  var cardPanel = document.getElementById('payment-card');
  var cryptoPanel = document.getElementById('payment-crypto');
  var procPanel = document.getElementById('payment-processing');
  if (pkgList) pkgList.classList.remove('hidden');
  if (summary) summary.classList.add('hidden');
  if (checkoutSection) checkoutSection.classList.add('hidden');
  if (successSection) successSection.classList.add('hidden');
  if (cardPanel) { cardPanel.classList.remove('hidden', 'exiting'); cardPanel.style.opacity = ''; }
  if (cryptoPanel) cryptoPanel.classList.add('hidden');
  if (procPanel) procPanel.classList.add('hidden');
  document.querySelectorAll('.payment-method-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelector('.payment-method-btn[data-method="card"]')?.classList.add('active');
  document.querySelectorAll('.package-card').forEach(c => c.classList.remove('selected'));
  if (state.activeCheckoutInstance) {
    try { state.activeCheckoutInstance.destroy(); } catch (e) { console.warn('Checkout cleanup:', e); }
    state.activeCheckoutInstance = null;
  }
}

function selectPackage(packageId) {
  playSound('click');
  state.lastPackageId = packageId;
  document.querySelectorAll('.package-card').forEach(c => c.classList.remove('selected'));
  const selectedCard = document.querySelector('.package-card[data-package="' + packageId + '"]');
  if (selectedCard) selectedCard.classList.add('selected');
  const info = PACKAGE_INFO[packageId];
  if (!info) return;
  document.getElementById('summary-gc').textContent = info.gc;
  document.getElementById('summary-sc').textContent = '+' + info.sc;
  document.getElementById('summary-total').textContent = info.price;
  const summary = document.getElementById('package-summary');
  if (summary) summary.classList.remove('hidden');
}

function resetPackageSelection() {
  playSound('click');
  resetStoreModal();
}

async function proceedToCheckout() {
  const packageId = state.lastPackageId;
  if (!packageId) return;
  playSound('click');
  setCheckoutStep(2);
  const pkgList = document.getElementById('package-selection');
  const summary = document.getElementById('package-summary');
  const checkoutSection = document.getElementById('checkout-section');
  if (pkgList) pkgList.classList.add('hidden');
  if (summary) summary.classList.add('hidden');
  if (checkoutSection) checkoutSection.classList.remove('hidden');

  updateCheckoutSummary(packageId);
  selectPaymentMethod('card');

  try {
    if (state.activeCheckoutInstance) {
      try { state.activeCheckoutInstance.destroy(); } catch (e) { console.warn('Checkout cleanup:', e); }
      state.activeCheckoutInstance = null;
    }
    await loadStripeCheckout(packageId);
  } catch (err) {
    console.error('[Checkout Error]:', err);
    if (err.requiresAccount) {
      alert(err.message || 'Guest accounts cannot purchase coins. Please register a real account first.');
    } else {
      showCheckoutError(err.message || 'Failed to initialize payment.');
    }
    document.querySelectorAll('.package-card').forEach(c => c.classList.remove('selected'));
  }
}

function updateCheckoutSummary(packageId) {
  const info = PACKAGE_INFO[packageId];
  if (!info) return;
  const nameEl = document.getElementById('checkout-package-name');
  const priceEl = document.getElementById('checkout-package-price');
  const gcEl = document.getElementById('checkout-gc');
  const scEl = document.getElementById('checkout-sc');
  const totalEl = document.getElementById('checkout-total');
  if (nameEl) nameEl.textContent = info.gc + ' GC + ' + info.sc + ' Free SC';
  if (priceEl) priceEl.textContent = info.price;
  if (gcEl) gcEl.textContent = info.gc;
  if (scEl) scEl.textContent = '+' + info.sc;
  if (totalEl) totalEl.textContent = info.price;
}

async function loadStripeCheckout(packageId) {
  const container = document.getElementById('stripe-checkout-container');
  if (!container) return;

  // Step 3: show animated processing panel while the secure gateway initializes
  const stopProgress = showProcessingPanel();
  setCheckoutStep(3);

  try {
    const data = await apiRequest('/api/user/buy-coins', 'POST', { packageId });
    if (!data.publishableKey || !data.clientSecret) {
      throw new Error(data.error || 'Invalid session configuration returned from server.');
    }
    const StripeSDK = await loadStripeSdk();
    const stripe = StripeSDK(data.publishableKey);
    const checkoutEl = document.createElement('div');
    checkoutEl.id = 'stripe-checkout-root';
    container.innerHTML = '';
    container.appendChild(checkoutEl);
    state.activeCheckoutInstance = await stripe.initEmbeddedCheckout({
      clientSecret: data.clientSecret,
      onComplete: (result) => {
        playSound('win');
        const pkg = PACKAGE_INFO[packageId] || { gc: '0', sc: '0' };
        stopProgress();
        setCheckoutStep(4);
        showCheckoutSuccess(pkg.gc, pkg.sc);
      }
    });
    state.activeCheckoutInstance.mount(checkoutEl);

    // The Embedded Checkout has initialized — reveal the card panel it was mounted
    // into. Do NOT clear #stripe-checkout-container here (hideProcessingPanel()
    // would wipe the form we just mounted); just swap the panels and stop the
    // "preparing payment gateway" overlay so the card screen is actually visible.
    stopProgress();
    setCheckoutStep(2);
    var procPanel = document.getElementById('payment-processing');
    var cardPanel = document.getElementById('payment-card');
    var loadingState = document.getElementById('checkout-loading-state');
    if (loadingState) loadingState.classList.add('hidden');
    _hidePanel(procPanel, function () {
      _showPanel(cardPanel);
    });
  } catch (err) {
    stopProgress();
    hideProcessingPanel();
    throw err;
  }
}

function selectPaymentMethod(method) {
  if (state.selectedPaymentMethod === method) return;

  const oldMethod = state.selectedPaymentMethod;
  state.selectedPaymentMethod = method;

  document.querySelectorAll('.payment-method-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.method === method);
  });

  const cardPanel = document.getElementById('payment-card');
  const cryptoPanel = document.getElementById('payment-crypto');
  if (!cardPanel || !cryptoPanel) return;

  // Destroy any existing Stripe checkout instance and clear the container
  if (state.activeCheckoutInstance) {
    try { state.activeCheckoutInstance.destroy(); } catch (e) { console.warn('Checkout cleanup:', e); }
    state.activeCheckoutInstance = null;
  }
  const container = document.getElementById('stripe-checkout-container');
  if (container) container.innerHTML = '';

  const oldPanel = oldMethod === 'card' ? cardPanel : cryptoPanel;
  const newPanel = method === 'card' ? cardPanel : cryptoPanel;

  if (!oldMethod) {
    // First selection — just show the new panel
    _showPanel(newPanel);
    return;
  }

  // Animate: fade out old panel, then fade in new panel
  _hidePanel(oldPanel, function () {
    _showPanel(newPanel);
  });
}

function selectCrypto(currency) {
  document.querySelectorAll('.crypto-btn').forEach(btn => btn.classList.remove('active'));
  const activeBtn = document.querySelector('.crypto-btn[onclick="selectCrypto(\'' + currency + '\')"]');
  if (activeBtn) activeBtn.classList.add('active');

  const phantomBlock = document.getElementById('crypto-phantom-block');
  if (phantomBlock) phantomBlock.classList.toggle('hidden', currency !== 'SOL');

  // Fetch the REAL, env-configured merchant address + a QR from the server.
  // (Never show hardcoded placeholder addresses.)
  initiateCryptoPayment(currency);
}

// Build a scannable crypto payment URI for the QR code.
function buildCryptoUri(currency, address, amount) {
  const msg = encodeURIComponent('Casino Deposit');
  switch (currency) {
    case 'BTC':
      return 'bitcoin:' + address + '?message=' + msg + (amount ? '&amount=' + encodeURIComponent(amount) : '');
    case 'ETH':
    case 'BASE':
    case 'POLYGON':
      return 'ethereum:' + address + '?value=' + (amount ? Math.round(parseFloat(amount) * 1e18) : 0) + '&message=' + msg;
    case 'USDT':
      return 'ethereum:' + address + '?message=' + msg;
    case 'USDC':
    case 'SOL':
      return 'solana:' + address + '?message=' + msg + (amount ? '&amount=' + encodeURIComponent(amount) : '');
    default:
      return address;
  }
}
// Generate a QR code for a deposit URI/address LOCALLY (server-side svg).
function qrUrl(data) {
  return '/api/crypto/qr?data=' + encodeURIComponent(data);
}

async function initiateCryptoPayment(currency) {
  const packageId = state.lastPackageId;
  if (!packageId) return;
  const cryptoType = currency || (document.querySelector('.crypto-btn.active .crypto-symbol')
    ? document.querySelector('.crypto-btn.active .crypto-symbol').textContent : 'BTC');
  playSound('click');

  const details = document.getElementById('crypto-payment-details');
  if (details) {
    details.classList.remove('hidden');
    details.innerHTML =
      '<div class="crypto-payment-loading" style="text-align:center;padding:34px;">' +
      '<div class="checkout-spinner"></div>' +
      '<p class="checkout-loading-text">Loading your deposit address…</p>' +
      '<p class="checkout-loading-sub">Generating your secure wallet address</p>' +
      '</div>';
  }

  try {
    const res = await apiRequest('/api/user/crypto-payment/initiate', 'POST', {
      packageId,
      currency: cryptoType
    });
    if (res.success) {
      showCryptoPaymentConfirmation(res, cryptoType);
    } else {
      throw new Error(res.error || 'Failed to initiate crypto payment.');
    }
  } catch (err) {
    if (details) details.innerHTML =
      '<div style="text-align:center;padding:24px;color:var(--accent-red);">⚠ ' + escapeHTML(err.message || err) + '</div>';
  }
}

function showCryptoPaymentConfirmation(res, cryptoType) {
  const pkg = PACKAGE_INFO[state.lastPackageId] || { gc: '0', sc: '0' };
  const address = res.address || '';
  const amount = res.amount || '';
  const uri = buildCryptoUri(cryptoType, address, amount);
  state.activeCryptoPaymentId = res.paymentId || state.activeCryptoPaymentId;

  const details = document.getElementById('crypto-payment-details');
  if (!details) return;
  details.classList.remove('hidden');
  details.innerHTML =
    '<div class="crypto-confirm-flow">' +

      '<!-- QR + Address -->' +
      '<div class="crypto-qr-block">' +
      '  <div class="crypto-qr-wrap">' +
'  <img class="crypto-qr-img" src="' + qrUrl(uri) + '" alt="Scan to pay ' + cryptoType + '" onerror="this.onerror=null;this.classList.add(\'hidden\')" />' +
      '    <div class="crypto-qr-fallback">📱</div>' +
      '  </div>' +
      '  <p class="crypto-qr-caption">Scan the QR code with your wallet to pay, or send manually to the address below.</p>' +
      '</div>' +

      '<!-- Suggested amount -->' +
      '<div class="crypto-amount-card">' +
      '  <label>Suggested amount</label>' +
      '  <div class="crypto-amount-value">' + amount + ' ' + cryptoType + '</div>' +
      '  <p class="crypto-amount-hint">Send <strong>any amount</strong> you want — you will receive the selected package below after confirmation.</p>' +
      '</div>' +

      '<!-- Address (copyable) -->' +
      '<div class="crypto-address-card">' +
      '  <label>Send to this address</label>' +
      '  <div class="crypto-address-row">' +
      '    <code class="crypto-address-code">' + escapeHTML(address) + '</code>' +
      '    <button class="btn-copy" onclick="copyCryptoAddressHandler(\'' + escapeHTML(address).replace(/'/g, '&#39;') + '\', this)">Copy</button>' +
      '  </div>' +
      '</div>' +

      '<!-- What you receive -->' +
      '<div class="crypto-reward-card">' +
      '  <div class="crypto-reward-title">You will receive</div>' +
      '  <div class="crypto-reward-items">' +
      '    <div class="crypto-reward-item"><span class="reward-num">' + pkg.gc + '</span><span class="reward-cap">Gold Coins</span></div>' +
      '    <div class="crypto-reward-item"><span class="reward-num">+' + pkg.sc + '</span><span class="reward-cap">Sweeps Coins</span></div>' +
      '  </div>' +
      '</div>' +

      '<!-- Txid submission -->' +
      '<div class="crypto-confirm-form">' +
      '  <label for="crypto-txid">Transaction ID (txid)</label>' +
      '  <input id="crypto-txid" type="text" placeholder="Paste your transaction hash…" maxlength="128" class="crypto-txid-input" />' +
      '  <label for="crypto-amount-sent" style="margin-top:12px;">Amount you actually sent (optional)</label>' +
      '  <input id="crypto-amount-sent" type="text" placeholder="e.g. 0.00001 BTC" class="crypto-txid-input" />' +
       '  <div class="crypto-confirm-actions">' +
       '    <button class="btn btn-secondary-action" onclick="backToPackages()" style="min-width:110px;">Back</button>' +
       '    <button class="btn btn-primary" onclick="confirmCryptoPayment()" id="btn-confirm-crypto" style="min-width:150px;">Confirm Payment</button>' +
       '  </div>' +
        (cryptoType === 'SOL' ?
          '  <div class="crypto-phantom-inline">' +
          '    <button class="btn-phantom-pay" onclick="payWithPhantom()">' +
          '      <span class="phantom-icon">👻</span> <span>Pay with Phantom (Solana)</span>' +
          '    </button>' +
          '    <p class="phantom-hint">Phantom detected? Sign & send directly — your coins credit instantly after on-chain verification.</p>' +
          '  </div>' : '') +
        '  <div class="crypto-status-row" id="crypto-status-row">' +
        '    <span class="crypto-status-text">Waiting for on-chain confirmation…</span>' +
        '  </div>' +
        '</div>' +
        '</div>';

   state.cryptoPollingTimer = null;
   startCryptoPolling(cryptoType);
 }

var CRYPTO_POLL_INTERVAL_MS = 8000;

async function startCryptoPolling(cryptoType) {
   if (!state.activeCryptoPaymentId) return;
   stopCryptoPolling();
   state.cryptoPollingTimer = setInterval(async () => {
     try {
       const res = await apiRequest('/api/user/crypto-payment/status/' + state.activeCryptoPaymentId);
       const statusRow = document.getElementById('crypto-status-row');
       if (res.status === 'COMPLETED' || res.status === 'CONFIRMED') {
         stopCryptoPolling();
         const pkg = PACKAGE_INFO[state.lastPackageId] || { gc: '0', sc: '0' };
         if (res.balances) {
           state.balances = mergeBalances(res.balances);
           updateWalletUI();
         }
         showCryptoDepositSuccess(pkg, true);
       } else if (statusRow) {
         const elapsed = Math.floor((Date.now() - (state.cryptoInitTime || Date.now())) / 1000);
         statusRow.innerHTML = '<span class="crypto-status-text">Pending on-chain confirmation… (' + elapsed + 's elapsed)</span>';
       }
     } catch (err) {
       console.warn('[Crypto Poll]:', err.message || err);
     }
   }, CRYPTO_POLL_INTERVAL_MS);
   state.cryptoInitTime = Date.now();
 }

function stopCryptoPolling() {
   if (state.cryptoPollingTimer) {
     clearInterval(state.cryptoPollingTimer);
     state.cryptoPollingTimer = null;
   }
 }

async function confirmCryptoPayment() {
  const txidEl = document.getElementById('crypto-txid');
  const amountEl = document.getElementById('crypto-amount-sent');
  const txid = (txidEl ? txidEl.value.trim() : '');
  const amountSent = amountEl ? amountEl.value.trim() : '';
  if (!txid) return alert('Please paste your transaction ID (txid) before confirming.');

  const btn = document.getElementById('btn-confirm-crypto');
  if (btn) { btn.disabled = true; btn.textContent = 'Verifying…'; }

  try {
    const res = await apiRequest('/api/user/crypto-payment/confirm', 'POST', {
      paymentId: state.activeCryptoPaymentId,
      txid,
      amountSent: amountSent || undefined
    });
    if (res.success) {
      const pkg = PACKAGE_INFO[state.lastPackageId] || { gc: '0', sc: '0' };
      if (res.balances) {
        state.balances = mergeBalances(res.balances);
        updateWalletUI();
      }
      showCryptoDepositSuccess(pkg, res.verified);
       stopCryptoPolling();
    } else {
      throw new Error(res.error || 'Payment could not be confirmed.');
    }
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Confirm Payment'; }
    alert('Confirmation error: ' + (err.message || err));
  }
}

function showCryptoDepositSuccess(pkg, verified) {
  const details = document.getElementById('crypto-payment-details');
  if (!details) return;
  details.classList.remove('hidden');
  details.innerHTML =
    '<div class="crypto-success-state">' +
    '<div class="crypto-success-check">' +
    '<div class="crypto-success-checkmark">✓</div>' +
    '<div class="crypto-confetti" id="crypto-confetti"></div>' +
    '</div>' +
    '<h4 class="crypto-success-title">Deposit Confirmed!</h4>' +
    '<p class="crypto-success-sub">' +
    (verified ? 'On-chain verification passed. ' : 'Your transaction is being processed. ') +
    'Your coins have been credited instantly.' +
    '</p>' +
    '<div class="crypto-success-rewards">' +
    '<div class="crypto-success-reward"><span class="crypto-success-num gc">' + pkg.gc + '</span><span class="crypto-success-cap">Gold Coins</span></div>' +
    '<div class="crypto-success-reward"><span class="crypto-success-num sc">+' + pkg.sc + ' SC</span><span class="crypto-success-cap">Sweeps Coins</span></div>' +
    '</div>' +
    '<button class="btn btn-primary" onclick="closeStoreModal()" style="min-width:150px;">Done</button>' +
    '</div>';
  playSound('win');
  animateCryptoConfetti();
  setTimeout(() => { mergeBalances({ sc: (state.balances.sc||0) }); updateWalletUI(); }, 500);
}

function animateCryptoConfetti() {
  const container = document.getElementById('crypto-confetti');
  if (!container) return;
  container.innerHTML = '';
  for (let i = 0; i < 20; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = (Math.random() * 100 - 10) + '%';
    piece.style.animationDelay = (Math.random() * 0.5) + 's';
    piece.style.background = Math.random() > 0.5 ? 'var(--accent-gold)' : 'var(--accent-green)';
    container.appendChild(piece);
  }
}

function copyToClipboard(text) {
  return new Promise((resolve) => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => resolve(true)).catch(fallback);
    } else {
      fallback();
    }
    function fallback() {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = (window.scrollY || 0) + 'px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try { document.execCommand('copy'); resolve(true); }
      catch (e) { resolve(false); }
      document.body.removeChild(ta);
    }
  });
}

async function copyCryptoAddressHandler(address, btn) {
  try { await copyToClipboard(address); } catch (e) {}
  try { playSound('click'); } catch (e) {}
  if (btn) {
    const prev = btn.textContent;
    btn.textContent = 'Copied!';
    btn.disabled = true;
    setTimeout(() => { btn.textContent = prev; btn.disabled = false; }, 1400);
  }
}

// Legacy wrappers kept so the static markup Copy buttons never throw.
function copyCryptoAddress() {
  const el = document.getElementById('crypto-address');
  if (el && el.textContent) copyCryptoAddressHandler(el.textContent, el);
}
function copyCryptoAmount() {
  const el = document.getElementById('crypto-amount');
  if (el && el.textContent) copyToClipboard(el.textContent).catch(() => {});
}

/**
 * Phantom (Solana) wallet payment flow:
 *  1. Detect window.solana (Phantom) — if missing, prompt install.
 *  2. Ask Phantom to connect (publicKey).
 *  3. POST /api/user/crypto-payment/initiate with paymentMethod:'phantom' to lock the
 *     expected amount + get the merchant SOL address.
 *  4. Sign & send a SOL transfer to the merchant wallet.
 *  5. POST /api/user/crypto-payment/phantom-confirm -> backend verifies the on-chain
 *     transfer and credits GC+SC instantly.
 */
async function payWithPhantom() {
  const packageId = state.lastPackageId;
  if (!packageId) return alert('Please pick a coin package first.');

  const provider = (typeof window !== 'undefined' && window.solana && window.solana.isPhantom)
    ? window.solana
    : null;

  if (!provider) {
    return alert('Phantom wallet not detected. Install the Phantom browser extension from phantom.app, then refresh this page.');
  }

  try {
    playSound('click');
    const conn = await provider.connect();
    const fromAddress = conn.publicKey.toString();

    const init = await apiRequest('/api/user/crypto-payment/initiate', 'POST', {
      packageId,
      currency: 'SOL',
      paymentMethod: 'phantom',
      fromAddress
    });
    if (!init.success) throw new Error(init.error || 'Could not initiate payment.');

    state.activeCryptoPaymentId = init.paymentId;
    const merchantAddress = init.address;
    const lamports = Math.round(parseFloat(init.amount) * 1e9);

    const connection = provider._provider || (window.__phantomConnection);
    let txSignature;
    if (typeof solanaWeb3 !== 'undefined') {
      const tx = new solanaWeb3.Transaction();
      tx.add(
        solanaWeb3.SystemProgram.transfer({
          fromPubkey: conn.publicKey,
          toPubkey: new solanaWeb3.PublicKey(merchantAddress),
          lamports
        })
      );
      tx.feePayer = conn.publicKey;
      const { blockhash } = await connection.getRecentBlockhash();
      tx.recentBlockhash = blockhash;
      const { signature } = await provider.signAndSendTransaction(tx);
      txSignature = signature;
    } else {
      const { signature } = await provider.signMessage(
        new TextEncoder().encode(`pay:${init.paymentId}:${lamports}`),
        'utf8'
      );
      txSignature = signature;
    }

    const confirm = await apiRequest('/api/user/crypto-payment/phantom-confirm', 'POST', {
      paymentId: init.paymentId,
      txSignature,
      fromAddress
    });
    if (!confirm.success) throw new Error(confirm.error || 'Confirmation failed.');

    const pkg = PACKAGE_INFO[packageId] || { gc: '0', sc: '0' };
    if (confirm.balances) {
      state.balances = mergeBalances(confirm.balances);
      updateWalletUI();
    }
    showCryptoDepositSuccess(pkg, !!confirm.verified);
  } catch (err) {
    console.error('[Phantom]', err);
    alert('Phantom payment error: ' + (err.message || err));
  }
}

function backToPackages() {
  playSound('click');
  stopCryptoPolling();
  var pkgList = document.getElementById('package-selection');
  var summary = document.getElementById('package-summary');
  var checkoutSection = document.getElementById('checkout-section');
  var successSection = document.getElementById('checkout-success');
  var procPanel = document.getElementById('payment-processing');
  if (checkoutSection) checkoutSection.classList.add('hidden');
  if (successSection) successSection.classList.add('hidden');
  if (procPanel) procPanel.classList.add('hidden');
  if (pkgList) pkgList.classList.remove('hidden');
  if (state.lastPackageId && summary) summary.classList.remove('hidden');
  if (state.activeCheckoutInstance) {
    try { state.activeCheckoutInstance.destroy(); } catch (e) { console.warn('Checkout cleanup:', e); }
    state.activeCheckoutInstance = null;
  }
  var container = document.getElementById('stripe-checkout-container');
  if (container) container.innerHTML = '';
}

function showPackageList() {
  resetStoreModal();
}

function showCheckoutSection() {
  const pkgList = document.querySelector('.package-selection');
  const checkoutSection = document.getElementById('checkout-section');
  if (pkgList) pkgList.classList.add('hidden');
  if (checkoutSection) checkoutSection.classList.remove('hidden');
  document.querySelectorAll('.package-card').forEach(c => c.style.opacity = '0.5');
}

function showCheckoutLoading() {
  const checkoutSection = document.getElementById('checkout-section');
  const container = document.getElementById('stripe-checkout-container');
  if (!checkoutSection || !container) return;
  checkoutSection.classList.remove('hidden');
  container.innerHTML =
    '<div class="checkout-loading">' +
    '<div class="checkout-spinner"></div>' +
    '<p class="checkout-loading-text">Initializing secure checkout...</p>' +
    '<p class="checkout-loading-sub">Please wait while we prepare your payment gateway</p>' +
    '</div>';
}

function showCheckoutError(message) {
  setCheckoutStep(2);
  hideProcessingPanel();
  const container = document.getElementById('stripe-checkout-container');
  if (!container) return;
  container.innerHTML =
    '<div class="checkout-error-state" style="text-align:center; padding:40px 20px;">' +
    '<div class="checkout-error-icon">!</div>' +
    '<h4 class="checkout-error-title">Checkout Error</h4>' +
    '<p class="checkout-error-text">' + escapeHTML(message) + '</p>' +
    '<div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">' +
    '<button class="btn btn-primary" onclick="retryCheckout()" style="min-width:120px;">Retry</button>' +
    '<button class="btn btn-secondary-action" onclick="showPackageList()">Back to Packages</button>' +
    '</div>' +
    '</div>';
  if (state.activeCheckoutInstance) {
    try { state.activeCheckoutInstance.destroy(); } catch (e) { console.warn('Checkout cleanup:', e); }
    state.activeCheckoutInstance = null;
  }
}

function showCheckoutSuccess(gc, sc) {
  const pkgList = document.querySelector('.package-selection');
  const checkoutSection = document.getElementById('checkout-section');
  const successSection = document.getElementById('checkout-success');
  const successDetails = document.getElementById('success-details');
  const confettiContainer = document.getElementById('confetti-container');

  if (pkgList) pkgList.classList.add('hidden');
  if (checkoutSection) checkoutSection.classList.add('hidden');
  if (successSection) successSection.classList.remove('hidden');

  if (state.activeCheckoutInstance) {
    try { state.activeCheckoutInstance.destroy(); } catch (e) { console.warn('Checkout cleanup:', e); }
    state.activeCheckoutInstance = null;
  }

  if (confettiContainer) {
    confettiContainer.innerHTML = '';
    for (let i = 0; i < 12; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.style.left = (Math.random() * 100 - 10) + '%';
      piece.style.animationDelay = (Math.random() * 0.5) + 's';
      piece.style.background = Math.random() > 0.5 ? '#ffc700' : '#00e701';
      confettiContainer.appendChild(piece);
    }
  }

  if (successDetails) {
    successDetails.innerHTML =
      '<div class="summary-row"><span class="summary-label">Gold Coins Added</span><span class="summary-value gc-val">' + gc + '</span></div>' +
      '<div class="summary-row"><span class="summary-label">Sweeps Coins Added</span><span class="summary-value sc-val">+' + sc + '</span></div>';
  }

   setTimeout(() => {
     initSessionFromToken();
     setTimeout(() => closeStoreModal(), 3000);
   }, 100);
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

const PACKAGE_INFO = {
  pack_10:  { gc: '15,000', sc: '15.00', price: '$9.99' },
  pack_20:  { gc: '25,000', sc: '25.00', price: '$19.99' },
  pack_50:  { gc: '55,000', sc: '55.00', price: '$49.99' },
  pack_100: { gc: '100,000', sc: '105.00', price: '$99.99' }
};

function updatePackageSummary(packageId) {
  const info = PACKAGE_INFO[packageId];
  const summary = document.getElementById('package-summary');
  if (!info || !summary) return;

  document.getElementById('summary-gc').textContent = info.gc;
  document.getElementById('summary-sc').textContent = '+' + info.sc;
  document.getElementById('summary-total').textContent = info.price;
  summary.classList.remove('hidden');
}

function showCheckoutBackButton() {
  const existing = document.querySelector('.checkout-back-btn');
  if (existing) return;
  const btn = document.createElement('button');
  btn.className = 'btn btn-sm btn-ghost checkout-back-btn';
  btn.style.cssText = 'position:absolute; top:16px; left:16px; z-index:10;';
  btn.innerHTML = '← Back to Packages';
  btn.onclick = showPackageList;
  const container = document.getElementById('stripe-checkout-container');
  if (container) container.appendChild(btn);
}

async function buyCoinPackage(packageId) {
  if (state.isEmbedded) return;
  const testMode = !!(state.flags && state.flags.allowGuestPayments);
  if (!testMode && state.profile && (state.profile.isGuest || (state.profile.email && state.profile.email.endsWith('@guest.casino')))) {
    alert('Guest accounts cannot purchase coins. Please register a real account first.');
    return;
  }
  openStoreModal();
  selectPackage(packageId);
}

async function retryCheckout() {
  if (state.lastPackageId) {
    buyCoinPackage(state.lastPackageId);
  } else {
    showPackageList();
  }
}

function openRedeemModal() {
  if (state.isEmbedded) return;
  // TEST MODE: when ALLOW_GUEST_PAYMENTS is enabled on the server, skip the
  // guest + KYC gates so the deposit/withdrawal flow can be exercised end-to-end.
  const testMode = !!(state.flags && state.flags.allowGuestPayments);
  if (!testMode) {
    if (state.profile?.isGuest || (state.profile?.email && state.profile.email.endsWith('@guest.casino'))) {
      alert('Guest accounts cannot redeem Sweeps Coins. Please register a real account first.');
      return;
    }
    if (state.profile?.kyc?.status !== 'VERIFIED') {
      alert('Identity verification (KYC) is required to redeem Sweeps Coins for cash. Please complete verification in your Profile first.');
      return;
    }
  }
  const redeemable = (state.balances.sc_played || 0);
  if (redeemable < 50) {
    alert('You need at least 50.00 SC (redeemable) to request a withdrawal. Keep playing!');
    return;
  }
  playSound('click');

     const availBal = document.getElementById('redeem-available-bal');
  const wageredBal = document.getElementById('redeem-wagered-bal');
  if (availBal) availBal.textContent = formatCoins(state.balances.sc_unplayed || 0) + ' SC';
  if (wageredBal) wageredBal.textContent = formatCoins(state.balances.sc_played || 0) + ' SC';

  updateRedeemPreview();
  document.getElementById('modal-redeem')?.classList.remove('hidden');
}

function closeRedeemModal() {
  playSound('click');
  document.getElementById('modal-redeem')?.classList.add('hidden');
}

function updateRedeemPreview() {
  const input = document.getElementById('redeem-input');
  const usdValue = document.getElementById('redeem-usd-value');
  if (!input || !usdValue) return;
  const amount = parseFloat(input.value) || 0;
  usdValue.textContent = '$' + amount.toFixed(2) + ' USD';
}

async function submitRedeem() {
  if (state.isEmbedded) return;
  const input = document.getElementById('redeem-input');
  const amount = parseFloat(input?.value);

  if (isNaN(amount) || amount < 50) {
    return alert('Minimum redemption limit is 50.00 Sweeps Coins (SC).');
  }

  if (amount > (state.balances.sc_played || 0)) {
    return alert(`Insufficient redeemable SC balance. You have ${formatCoins(state.balances.sc_played || 0)} SC eligible for redemption. (Unplayed SC must be wagered 1x first).`);
  }

  playSound('click');

  try {
    const data = await apiRequest('/api/user/withdraw-sc', 'POST', { amount });

    if (data.requiresOnboarding && data.onboardingUrl) {
      window.location.href = data.onboardingUrl;
      return;
    }

    state.balances = mergeBalances(data.balances);
    updateWalletUI();
    alert(data.message || 'Redemption request submitted successfully.');
    closeRedeemModal();
  } catch (err) {
    if (err.requiresKyc) {
      alert(err.message + ' Please complete KYC verification in your Profile first.');
      closeRedeemModal();
      setTimeout(() => openAccountPage(), 300);
    } else {
      alert(err.message || 'Redemption request failed.');
    }
  }
}

// ==========================================================================
// 9. LOBBY & NAVIGATION ROUTING
// ==========================================================================

function showLobby() {
  playSound('click');
  if (!document.getElementById('view-lobby')) {
    window.location.href = '/';
    return;
  }
  history.pushState(null, '', '/');
  setActiveSidebarLink('/');
  document.getElementById('view-lobby')?.classList.remove('hidden');
  document.getElementById('view-game')?.classList.add('hidden');
  document.getElementById('view-account')?.classList.add('hidden');
  document.getElementById('view-bonus')?.classList.add('hidden');
  document.getElementById('view-challenges')?.classList.add('hidden');
  document.getElementById('view-rakeback')?.classList.add('hidden');
  document.querySelector('.main-layout')?.classList.remove('is-game');
  state.currentGame = null;
  state.activeGameState = null;
  state.isProcessing = false;
  if (state.crashIntervalHandle) {
    clearInterval(state.crashIntervalHandle);
    state.crashIntervalHandle = null;
  }
  state.crashCashOutEarly = false;
  state.crashAutoTarget = null;
  clearGameControls();
  closeGlobalFeed();

  const betsSidebar = document.getElementById('global-bets-sidebar');
  if (betsSidebar) betsSidebar.classList.add('hidden');
  const closeBtn = document.getElementById('global-bets-close');
  if (closeBtn) closeBtn.classList.add('hidden');
  const fab = document.getElementById('global-bets-fab');
  if (fab) fab.classList.add('hidden');
  const lobbyBetsBtn = document.getElementById('lobby-bets-btn');
  if (lobbyBetsBtn) lobbyBetsBtn.classList.remove('hidden');
}

function openGlobalFeedFromLobby() {
  playSound('click');
  const sidebar = document.getElementById('global-bets-sidebar');
  if (sidebar) sidebar.classList.remove('hidden');
  const closeBtn = document.getElementById('global-bets-close');
  if (closeBtn) closeBtn.classList.remove('hidden');
  const lobbyBetsBtn = document.getElementById('lobby-bets-btn');
  if (lobbyBetsBtn) lobbyBetsBtn.classList.add('hidden');
}

function closeGlobalFeed() {
  const drawer = document.getElementById('global-bets-drawer');
  if (drawer) drawer.classList.remove('open');
  const sidebar = document.getElementById('global-bets-sidebar');
  if (sidebar) sidebar.classList.add('hidden');
  const fab = document.getElementById('global-bets-fab');
  if (fab) fab.classList.add('hidden');
  const closeBtn = document.getElementById('global-bets-close');
  if (closeBtn) closeBtn.classList.add('hidden');
  const inGame = document.querySelector('.main-layout')?.classList.contains('is-game');
  if (!inGame) {
    const lobbyBetsBtn = document.getElementById('lobby-bets-btn');
    if (lobbyBetsBtn) lobbyBetsBtn.classList.remove('hidden');
  }
}

function showGlobalFeed() {
  const sidebar = document.getElementById('global-bets-sidebar');
  if (sidebar) sidebar.classList.remove('hidden');
  const fab = document.getElementById('global-bets-fab');
  if (fab) fab.classList.remove('hidden');
  const closeBtn = document.getElementById('global-bets-close');
  if (closeBtn) closeBtn.classList.remove('hidden');
  const lobbyBetsBtn = document.getElementById('lobby-bets-btn');
  if (lobbyBetsBtn) lobbyBetsBtn.classList.add('hidden');
}

function toggleGlobalFeed() {
  const sidebar = document.getElementById('global-bets-sidebar');
  if (sidebar) {
    sidebar.classList.toggle('hidden');
  }
}

function clearGameControls() {
  const options = document.getElementById('game-controls-options');
  if (options) options.innerHTML = '';
}

function filterLobbyGames(category) {
  playSound('click');
  document.querySelectorAll('.pill-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.category === category);
  });

  const cards = document.querySelectorAll('.game-card');
  cards.forEach(card => {
    if (category === 'ALL' || card.dataset.category === category) {
      card.style.display = '';
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

async function launchGame(gameId) {
  playSound('click');
  if (!document.getElementById('view-game')) {
    window.location.href = '/' + gameId;
    return;
  }
  state.currentGame = gameId;
  state.activeGameState = null;
  state.isProcessing = false;

  if (window.GameLoader) await window.GameLoader.load(gameId);

  document.getElementById('view-lobby')?.classList.add('hidden');
  document.getElementById('view-game')?.classList.remove('hidden');
  document.getElementById('active-game-title').textContent = gameId.toUpperCase();
  document.querySelector('.main-layout')?.classList.add('is-game');
  const betsSidebar = document.getElementById('global-bets-sidebar');
  if (betsSidebar) betsSidebar.classList.add('hidden');
  // Show FAB during game for mobile toggling
  const betsFab = document.getElementById('global-bets-fab');
  if (betsFab) betsFab.classList.remove('hidden');
  const lobbyBetsBtn = document.getElementById('lobby-bets-btn');
  if (lobbyBetsBtn) lobbyBetsBtn.classList.add('hidden');

  if (window.location.pathname !== '/' + gameId) {
    history.pushState(null, '', '/' + gameId);
  }

  const options = document.getElementById('game-controls-options');
  const actionBtn = document.getElementById('btn-primary-action');
  const betBar = document.getElementById('bet-bar');

   if (betBar) betBar.style.display = 'flex';
  options.innerHTML = '';
  actionBtn.disabled = false;
  updateBetCurrencyTag();

  const crashSidebar = document.getElementById('crash-sidebar');
  if (crashSidebar) {
    if (gameId === 'crash') {
      crashSidebar.classList.remove('hidden');
    } else {
      crashSidebar.classList.add('hidden');
    }
  }

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
        </div>
        <div class="control-group" style="grid-column: 1 / -1;">
          <div style="display:flex;gap:4px;flex-wrap:wrap;">
            <button class="btn-quick-target" onclick="setDiceTarget('OVER',25)">25x</button>
            <button class="btn-quick-target" onclick="setDiceTarget('OVER',50)">50x</button>
            <button class="btn-quick-target" onclick="setDiceTarget('OVER',75)">75x</button>
            <button class="btn-quick-target" onclick="setDiceTarget('OVER',90)">90x</button>
            <button class="btn-quick-target" onclick="setDiceTarget('OVER',96)">96x</button>
          </div>
        </div>
        <div class="control-group" style="grid-column: 1 / -1;">
          <div id="dice-payout-preview" style="font-size:0.75rem; color:#b1bad2; font-weight:600; padding:6px 8px; background:#14222d; border-radius:4px;">Win Chance: 50.00%  •  Payout: 1.9800x</div>
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
        </div>
        <div class="control-group" style="grid-column: 1 / -1;">
          <label class="control-label">Auto Cashout Multiplier</label>
          <input type="number" id="mines-auto-cashout" value="0" step="0.1" min="1.01" max="10000" class="control-input" placeholder="0 = disabled">
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

    case 'baccarat':
      options.innerHTML = `
        <div class="control-group" style="grid-column: 1 / -1;">
          <label class="control-label">Main Bet</label>
          <select id="baccarat-bet" class="control-select">
            <option value="PLAYER" selected>Player — pays 2x</option>
            <option value="BANKER">Banker — pays 1.95x</option>
            <option value="TIE">Tie — pays 9x</option>
          </select>
        </div>
        <div style="display:flex;gap:6px;grid-column:1/-1;flex-wrap:wrap;">
          <label style="display:flex;align-items:center;gap:4px;font-size:0.75rem;color:var(--text-secondary);cursor:pointer;"><input type="checkbox" id="baccarat-sb-pair" style="margin:0;"> Player Pair (11x)</label>
          <label style="display:flex;align-items:center;gap:4px;font-size:0.75rem;color:var(--text-secondary);cursor:pointer;"><input type="checkbox" id="baccarat-sb-banker" style="margin:0;"> Banker Pair (11x)</label>
        </div>
        <div class="control-group" style="grid-column: 1 / -1;">
           <button type="button" class="btn-secondary-action btn-full game-action-btn" onclick="revealBaccaratCards()">REVEAL CARDS</button>
         </div>`;
       break;

    case 'hilo':
      options.innerHTML = `
        <div class="control-group" style="grid-column: 1 / -1; color:#b1bad2; font-size:0.85rem; font-weight:600;">
          Guess HIGHER or LOWER than your base card. Correct guesses compound your multiplier — cash out anytime. Ties lose.
        </div>`;
      break;

    case 'crash':
      options.innerHTML = `
        <div class="control-group" style="grid-column: 1 / -1;">
          <label class="control-label">Auto Cashout Target</label>
          <input type="number" id="crash-target" value="2.00" step="0.01" min="1.01" max="1000000" class="control-input">
        </div>`;
      break;

    case 'keno':
      state.selectedKenoNumbers = [];
      if (window.GameRenderers && window.GameRenderers.renderKenoBoard) {
        window.GameRenderers.renderKenoBoard({ drawn: [], locked: false });
      } else {
        renderKenoBoard();
      }
      options.innerHTML = `
        <div class="control-group" style="grid-column: 1 / -1;">
          <label class="control-label">Picks</label>
          <div style="display:flex;gap:4px;flex-wrap:wrap;">
            <button class="btn-quick-target" onclick="setKenoPicks(1)">1</button>
            <button class="btn-quick-target" onclick="setKenoPicks(3)">3</button>
            <button class="btn-quick-target" onclick="setKenoPicks(5)">5</button>
            <button class="btn-quick-target" onclick="setKenoPicks(8)">8</button>
            <button class="btn-quick-target" onclick="setKenoPicks(10)">10</button>
          </div>
        </div>
        <div class="control-group" style="grid-column: 1 / -1;">
          <div id="keno-payout-table">${window.GameRenderers && GameRenderers.kenoPayoutTable ? GameRenderers.kenoPayoutTable() : ''}</div>
        </div>`;
      break;

    case 'blackjack':
      actionBtn.textContent = 'DEAL HAND';
      break;

    case 'slots':
      actionBtn.textContent = 'SPIN REELS';
      options.innerHTML = `
        <div class="control-group" style="grid-column: 1 / -1;">
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <label style="display:flex;align-items:center;gap:3px;font-size:0.7rem;color:#b1bad2;cursor:pointer;"><input type="checkbox" id="slots-lines-1" checked style="margin:0;"> 1 Line</label>
            <label style="display:flex;align-items:center;gap:3px;font-size:0.7rem;color:#b1bad2;cursor:pointer;"><input type="checkbox" id="slots-lines-3" checked style="margin:0;"> 3 Lines</label>
            <label style="display:flex;align-items:center;gap:3px;font-size:0.7rem;color:#b1bad2;cursor:pointer;"><input type="checkbox" id="slots-lines-5" checked style="margin:0;"> 5 Lines</label>
          </div>
        </div>
        <div class="control-group" style="grid-column: 1 / -1;">
          <button class="btn-buy-bonus" onclick="buySlotsBonus()">BUY BONUS (100x bet)</button>
          <div style="font-size:0.7rem;color:#b1bad2;margin-top:4px;text-align:center;">Free spins: 3+ ⭐ symbols trigger 10 free spins</div>
        </div>
        <div class="control-group" style="grid-column: 1 / -1;">
          <div style="text-align:center;font-size:0.7rem;color:#b1bad2;font-weight:600;">Progressive Jackpots: Mini • Minor • Major • Grand</div>
        </div>`;
      break;
  }

  if (!['mines', 'tower', 'blackjack', 'slots'].includes(gameId)) {
    actionBtn.textContent = 'PLACE BET';
  }

  document.getElementById('game-display-area').innerHTML = `
    <div class="game-placeholder-text">Place your bet to begin.</div>`;
}

// ==========================================================================
// 10. PRIMARY ACTION DISPATCHER & GAME ENGINES
// ==========================================================================

function handlePrimaryAction() {
  if (state.isProcessing) return;

  const currentBalance = state.currency === 'GC' ? state.balances.gc : state.balances.sc;
  const betInput = document.getElementById('bet-input');
  const betAmount = parseFloat(betInput?.value || 0);

  if (state.activeGameState) {
    if (state.currentGame === 'mines') return cashoutMines();
    if (state.currentGame === 'tower') return cashoutTower();
    if (state.currentGame === 'hilo') return cashoutHilo();
    if (state.currentGame === 'blackjack') return blackjackAction('stand');
  }

  if (isNaN(betAmount) || betAmount <= 0) {
    return alert('Please enter a valid bet amount.');
  }

  if (betAmount > currentBalance) {
    return alert(`Insufficient ${state.currency} balance.`);
  }

  switch (state.currentGame) {
    case 'mines':     return startMinesGame(betAmount);
    case 'tower':     return startTowerGame(betAmount);
    case 'limbo':     return executeLimboBet(betAmount);
    case 'dice':      return executeDiceBet(betAmount);
    case 'blackjack': return startBlackjackGame(betAmount);
    case 'hilo':      return startHiloGame(betAmount);
    default:          return executeStandardBet(betAmount);
  }
}

/* --- MINES ENGINE --- */
async function startMinesGame(betAmount) {
  state.isProcessing = true;
  playSound('chip');
  const mineCount = parseInt(document.getElementById('mines-count')?.value || 3);
  const autoCashoutVal = parseFloat(document.getElementById('mines-auto-cashout')?.value || 0);

  // Optimistic debit
  applyOptimisticDebit(betAmount);

  try {
    const data = await apiRequest('/api/play/mines/start', 'POST', {
      currency: state.currency,
      betAmount,
      mineCount
    });

    state.balances = mergeBalances(data.balances);
    updateWalletUI();

    state.activeGameState = {
      gameId: data.gameId,
      type: 'mines',
      revealedTiles: [],
      mineCount,
      betAmount,
      currentMultiplier: 1.00,
      autoCashout: autoCashoutVal > 0 ? autoCashoutVal : null
    };

    if (window.GameRenderers && window.GameRenderers.renderMinesBoard) {
      window.GameRenderers.renderMinesBoard();
    } else {
      renderMinesGrid();
    }
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
    boardHtml += `<button class="game-btn-action" style="padding:16px; font-weight:700; background:var(--bg-card); color:var(--text-primary); border:1px solid var(--border-color); border-radius:4px; cursor:pointer;" id="mine-tile-${i}" onclick="revealMineTile(${i})">?</button>`;
  }
  boardHtml += '</div>';
  document.getElementById('game-display-area').innerHTML = boardHtml;
}

async function revealMineTile(tileIndex) {
  if (state.isProcessing || !state.activeGameState) return;
  if (state.activeGameState.revealedTiles.includes(tileIndex)) return;

  state.isProcessing = true;
  playSound('click');

  try {
    const data = await apiRequest('/api/play/mines/reveal', 'POST', {
      gameId: state.activeGameState.gameId,
      tileIndex
    });

     if (data.hitBomb) {
      playSound('loss');
      if (window.GameRenderers && window.GameRenderers.renderMinesLoss) {
        window.GameRenderers.renderMinesLoss(data);
      } else {
        const tile = document.getElementById(`mine-tile-${tileIndex}`);
        if (tile) { tile.style.background = '#ff4d4d'; tile.textContent = '💣'; }
        (data.board || []).forEach((v, i) => {
          if (v === 'BOMB') {
            const b = document.getElementById(`mine-tile-${i}`);
            if (b && i !== tileIndex) { b.textContent = '💣'; b.style.opacity = '0.55'; }
          }
        });
      }
      clearGameControls();
      state.activeGameState = null;
      setTimeout(() => { launchGame('mines'); }, 3000);
    } else {
      playSound('win');
      state.activeGameState.revealedTiles.push(tileIndex);
      state.activeGameState.currentMultiplier = data.multiplier;

      if (window.GameRenderers && window.GameRenderers.renderMinesBoard) {
        window.GameRenderers.renderMinesBoard();
      } else {
        const tile = document.getElementById(`mine-tile-${tileIndex}`);
        if (tile) { tile.style.background = '#00e701'; tile.style.color = '#000'; tile.textContent = '💎'; }
      }

      if (data.cashedOut || data.autoCashout || state.crashCashOutEarly) {
        if (data.balances) { state.balances = mergeBalances(data.balances); updateWalletUI(); }
        if (window.GameRenderers && window.GameRenderers.renderMinesWin) {
          window.GameRenderers.renderMinesWin(data);
        } else {
           alert(`Board cleared! Auto-cashout ${data.multiplier.toFixed(2)}x — +${formatCoins(data.payout)} ${state.currency}`);
        }
        setTimeout(() => { state.activeGameState = null; launchGame('mines'); }, 3000);
      } else {
        document.getElementById('btn-primary-action').textContent = `CASHOUT (${data.multiplier.toFixed(2)}x)`;
      }
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

    if (window.GameRenderers && window.GameRenderers.renderMinesWin) {
      window.GameRenderers.renderMinesWin({ ...data, payout: data.payout });
      playSound('win');
      state.balances = mergeBalances(data.balances);
      updateWalletUI();
    } else {
      state.balances = mergeBalances(data.balances);
      updateWalletUI();
      alert(`Cashed out successfully for ${formatCoins(data.payout)} ${state.currency}!`);
    }
  clearGameControls();
  state.activeGameState = null;
  setTimeout(() => { launchGame('mines'); }, 3000);
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

  applyOptimisticDebit(betAmount);

  try {
    const data = await apiRequest('/api/play/tower/start', 'POST', {
      currency: state.currency,
      betAmount,
      difficulty
    });

    state.balances = mergeBalances(data.balances);
    updateWalletUI();

    state.activeGameState = {
      gameId: data.gameId,
      type: 'tower',
      currentFloor: 0,
      tilesPerFloor: data.tilesPerFloor || 3,
      difficulty,
      multiplier: 1.00,
      betAmount
    };

    if (window.GameRenderers && window.GameRenderers.renderTower) {
      window.GameRenderers.renderTower();
    } else {
      renderTowerBoard();
    }
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
  actionBtn.disabled = state.activeGameState.currentFloor === 0;

  const tiles = state.activeGameState.tilesPerFloor || 3;

  let html = '<div style="display:flex; flex-direction:column-reverse; gap:8px; max-width:320px; margin:auto;">';
  for (let floor = 0; floor < 8; floor++) {
    const isCurrent = floor === state.activeGameState.currentFloor;
    const isPassed = floor < state.activeGameState.currentFloor;

    html += `<div style="display:flex; gap:8px; opacity:${isCurrent || isPassed ? '1' : '0.4'};">`;
    for (let tile = 0; tile < tiles; tile++) {
      html += `<button class="game-btn-action" style="flex:1; padding:12px; background:var(--bg-card); color:var(--text-primary); border:1px solid var(--border-color); border-radius:4px; cursor:pointer;" ${isCurrent ? `onclick="pickTowerTile(${floor}, ${tile})"` : 'disabled'}>
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
      state.activeGameState.multiplier = data.multiplier;

      if (data.cashedOut || data.autoCashout) {
        state.balances = mergeBalances(data.balances);
        updateWalletUI();
        const display = document.getElementById('game-display-area');
        if (display) {
          display.innerHTML = '<div style="text-align:center;padding:24px;">' +
            '<div style="font-size:2.5rem;font-weight:900;color:#00e701;">✅ TOWER COMPLETED</div>' +
            '<div style="color:#b1bad2;font-size:0.9rem;margin-top:8px;">Final Multiplier: ' + data.multiplier.toFixed(2) + 'x</div>' +
             '<div style="color:#00e701;font-weight:700;margin-top:4px;">Payout: ' + formatCoins(Number(data.payout)) + ' ' + state.currency + '</div>' +
            '</div>';
        }
        clearGameControls();
        state.activeGameState = null;
        setTimeout(() => { launchGame('tower'); }, 2500);
      } else {
         state.activeGameState.currentFloor = data.currentFloor;
         if (window.GameRenderers && window.GameRenderers.renderTower) {
           window.GameRenderers.renderTower();
         } else {
           renderTowerBoard();
         }
      }
     } else {
      playSound('loss');
      const display = document.getElementById('game-display-area');
      if (display) {
        display.innerHTML = '<div style="text-align:center;padding:24px;">' +
          '<div style="font-size:2.5rem;font-weight:900;color:#ff4d4d;">💥 TRAP HIT</div>' +
          '<div style="color:#b1bad2;font-size:0.9rem;margin-top:8px;">Tower collapsed at floor ' + state.activeGameState.currentFloor + '</div>' +
          '<div style="color:#ff4d4d;font-weight:700;margin-top:4px;">Lost ' + formatCoins(state.activeGameState.betAmount) + ' ' + state.currency + '</div>' +
          '</div>';
      }
      clearGameControls();
      state.activeGameState = null;
      setTimeout(() => { launchGame('tower'); }, 2500);
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

    const display = document.getElementById('game-display-area');
    if (display) {
      display.innerHTML = '<div style="text-align:center;padding:24px;">' +
        '<div style="font-size:2.5rem;font-weight:900;color:#00e701;">✅ CASHED OUT</div>' +
        '<div style="color:#b1bad2;font-size:0.9rem;margin-top:8px;">Multiplier: ' + data.multiplier.toFixed(2) + 'x</div>' +
        '            <div style="color:#00e701;font-weight:700;margin-top:4px;">+' + formatCoins(Number(data.payout)) + ' ' + state.currency + '</div>' +
        '</div>';
    }
    state.balances = mergeBalances(data.balances);
    updateWalletUI();
    setTimeout(() => {
      state.activeGameState = null;
      launchGame('tower');
    }, 2000);
  } catch (err) {
    alert(err.message || 'Tower cashout failed');
  } finally {
    state.isProcessing = false;
  }
}

/* --- CRASH ENGINE --- */
function stopCrashCashout() {
  state.crashCashOutEarly = true;
  playSound('click');
}

function autoCrashCashout(target) {
  if (typeof target === 'number' && target > 1) {
    state.crashAutoTarget = target;
  } else {
    const input = prompt('Set auto-cashout multiplier:', '2.00');
    if (input) state.crashAutoTarget = parseFloat(input);
  }
  playSound('click');
}

/* --- LIMBO ENGINE --- */
async function executeLimboBet(betAmount) {
  state.isProcessing = true;
  playSound('chip');
  const targetMultiplier = parseFloat(document.getElementById('limbo-target')?.value || 2.0);
  const actionBtn = document.getElementById('btn-primary-action');
  const display = document.getElementById('game-display-area');

  actionBtn.disabled = true;
  applyOptimisticDebit(betAmount);

  try {
    const data = await apiRequest('/api/play/limbo', 'POST', {
      currency: state.currency,
      betAmount,
      params: { targetMultiplier }
    });

    syncFair(data);

    const finalResult = data.details.resultMultiplier;

    if (window.GameRenderers && GameRenderers.renderLimbo) {
      GameRenderers.renderLimbo(finalResult, data.win, data.payout, targetMultiplier);
      if (data.win) GameRenderers.addLimboHistory(finalResult, true);
      else GameRenderers.addLimboHistory(finalResult, false);
    } else {
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
            ${progress === 1 && data.win ? `<div style="margin-top:10px; color:#00e701; font-weight:800;">WIN — paid ${formatCoins(data.payout)} ${state.currency}</div>` : ''}
          </div>`;

        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          if (data.win) playSound('win'); else playSound('loss');
          actionBtn.disabled = false;
          state.isProcessing = false;
        }
      }

      requestAnimationFrame(animate);
    }

    state.balances = mergeBalances(data.balances);
    updateWalletUI();

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
  const out = document.getElementById('dice-payout-preview');
  if (out) {
    out.innerHTML = `<span style="color:#00e701;font-weight:700">${winChance.toFixed(1)}% win chance</span>  •  <span style="color:#b1bad2">Payout: ${multiplier > 0 ? multiplier.toFixed(4) + 'x' : '—'}</span>`;
  }
  return multiplier;
}

function setDiceTarget(cond, target) {
  const condSel = document.getElementById('dice-cond');
  const targetInput = document.getElementById('dice-target');
  if (condSel) condSel.value = cond;
  if (targetInput) targetInput.value = target;
  updateDiceOdds();
}

async function executeDiceBet(betAmount) {
  state.isProcessing = true;
  playSound('chip');
  const condition = document.getElementById('dice-cond')?.value || 'OVER';
  const target = parseFloat(document.getElementById('dice-target')?.value || 50);

  applyOptimisticDebit(betAmount);

  try {
    const data = await apiRequest('/api/play/dice', 'POST', {
      currency: state.currency,
      betAmount,
      params: { condition, target }
    });

    syncFair(data);

    if (window.GameRenderers && window.GameRenderers.renderDice) {
      window.GameRenderers.renderDice(data.details, data.win);
    } else {
      renderDiceResult(data.details, data.win);
    }
    if (data.win) playSound('win'); else playSound('loss');

    state.balances = mergeBalances(data.balances);
    updateWalletUI();
   } catch (err) {
    alert(err.message || 'Dice bet failed');
  } finally {
    state.isProcessing = false;
  }
}

function revealBaccaratCards() {
  if (!state.baccaratPendingReveal) return;
  if (window.GameRenderers && window.GameRenderers.revealBaccaratCards) {
    window.GameRenderers.revealBaccaratCards();
  }
  const btn = document.querySelector('#game-controls-options button[onclick="revealBaccaratCards()"]');
  if (btn) btn.style.display = 'none';
}

function renderDiceResult(details, win) {
  const display = document.getElementById('game-display-area');
  const roll = details.rolled;
  const target = details.target;
  const cond = details.condition || 'OVER';
  const winColor = '#00e701';
  const loseColor = '#ff4d4d';

  let zoneLeft, zoneWidth;
  if (cond === 'OVER') { zoneLeft = target; zoneWidth = 100 - target; }
  else { zoneLeft = 0; zoneWidth = target; }

  display.innerHTML = `
    <div style="max-width:430px; margin:auto; text-align:center;">
      <div style="font-size:3rem; font-weight:900; color:${win ? winColor : loseColor};">${roll.toFixed(2)}</div>
      <div style="position:relative; height:14px; border-radius:7px; margin:22px 0 26px; background:#14222d; border:1px solid #243542; overflow:visible;">
        <div style="position:absolute; top:0; bottom:0; left:${zoneLeft}%; width:${zoneWidth}%; background:${win ? winColor : loseColor}; opacity:0.35; border-radius:7px;"></div>
        <div style="position:absolute; top:-5px; bottom:-5px; left:calc(${Math.min(99.2, Math.max(0, roll))}% - 2px); width:4px; background:#fff; border-radius:2px;"></div>
        <div style="position:absolute; top:110%; left:${zoneLeft}%; transform:translateX(-50%); font-size:0.7rem; color:#b1bad2;">${target.toFixed(2)}</div>
      </div>
      <p style="font-weight:700; color:${win ? winColor : loseColor};">${win ? 'WIN' : 'LOSS'}${win ? ' • ' + details.winChance.toFixed(2) + '% chance' : ''}</p>
    </div>`;

  const autoChk = document.getElementById('auto-bet-toggle');
  if (autoChk && autoChk.checked) {
    const count = parseInt(document.getElementById('auto-bet-count')?.value || '0') || 0;
    state.autoBetRemaining = count > 0 ? count : Infinity;
    state.autoBetGame = state.currentGame;
  }
}

/* --- KENO BOARD --- */

async function placeKenoBet() {
  if (state.isProcessing || !state.currentGame) return;
  if (state.selectedKenoNumbers.length === 0) {
    return alert('Please select at least 1 number.');
  }
  const betInput = document.getElementById('bet-input');
  const betAmount = parseFloat(betInput?.value || 0);
  if (isNaN(betAmount) || betAmount <= 0) {
    return alert('Please enter a valid bet amount.');
  }
  const currentBalance = state.currency === 'GC' ? state.balances.gc : state.balances.sc;
  if (betAmount > currentBalance) {
    return alert(`Insufficient ${state.currency} balance.`);
  }
  executeStandardBet(betAmount);
}

function renderKenoBoard(opts = {}) {
  const drawn = opts.drawn || [];
  const drawnSet = new Set(drawn);
  const pickSet = new Set(state.selectedKenoNumbers);
  const locked = !!opts.locked;

  let html = '<div style="display:grid; grid-template-columns: repeat(8, minmax(30px, 1fr)); gap:6px; max-width:420px; margin:auto;" id="keno-board">';
  for (let i = 1; i <= 40; i++) {
    const isPicked = pickSet.has(i);
    const isDrawn = drawnSet.has(i);
    let bg = '#14222d';
    let color = '#fff';
    let border = '1px solid #243542';
    let glow = 'none';
    if (isDrawn && isPicked) { bg = '#00e701'; color = '#000'; border = '2px solid #fff'; glow = '0 0 10px rgba(0,231,1,.55)'; }
    else if (isDrawn) { bg = '#8248ff'; color = '#fff'; }
    else if (isPicked) { bg = '#00e701'; color = '#000'; }
    html += `<div style="background:${bg}; color:${color}; padding:10px 4px; border-radius:4px; font-weight:600; font-size:0.9rem; cursor:${locked ? 'default' : 'pointer'}; text-align:center; border:${border}; box-shadow:${glow};" onclick="${locked ? '' : 'toggleKenoNumber(' + i + ')'}">${i}</div>`;
  }
  html += '</div>';
  if (drawn.length) {
    const hits = state.selectedKenoNumbers.filter(n => drawnSet.has(n)).length;
    html += `<div style="text-align:center; margin-top:12px; color:#b1bad2; font-size:0.9rem; font-weight:600;">${hits} / ${state.selectedKenoNumbers.length} picks hit</div>`;
  }
  document.getElementById('game-display-area').innerHTML = html;
}

function toggleKenoNumber(num) {
  if (window.GameRenderers && window.GameRenderers.toggleKenoNumber) {
    window.GameRenderers.toggleKenoNumber(num);
  } else {
    playSound('click');
    if (state.selectedKenoNumbers.includes(num)) {
      state.selectedKenoNumbers = state.selectedKenoNumbers.filter(n => n !== num);
    } else if (state.selectedKenoNumbers.length < 10) {
      state.selectedKenoNumbers.push(num);
    }
    renderKenoBoard();
  }
}

function setKenoPicks(count) {
  const nums = [];
  while (nums.length < count) {
    const n = Math.floor(Math.random() * 40) + 1;
    if (!nums.includes(n)) nums.push(n);
  }
  state.selectedKenoNumbers = nums;
  playSound('chip');
  if (window.GameRenderers && GameRenderers.renderKenoBoard) {
    GameRenderers.renderKenoBoard({ drawn: [], locked: false });
  } else {
    renderKenoBoard();
  }
}

function quickPickKeno() {
  if (window.GameRenderers && GameRenderers.quickPickKeno) {
    GameRenderers.quickPickKeno();
  } else {
    setKenoPicks(5);
  }
}

async function buySlotsBonus() {
  if (state.isProcessing) return;
  const betInput = document.getElementById('bet-input');
  const betAmount = parseFloat(betInput?.value || 0);
  if (isNaN(betAmount) || betAmount <= 0) {
    return alert('Please enter a valid bet amount.');
  }
  const bonusCost = betAmount * 100;
  const currentBalance = state.currency === 'GC' ? state.balances.gc : state.balances.sc;
  if (bonusCost > currentBalance) {
    return alert(`Insufficient ${state.currency} balance. Bonus costs ${formatCoins(bonusCost)} ${state.currency}.`);
  }
  state.isProcessing = true;
  playSound('chip');
  applyOptimisticDebit(bonusCost);
  try {
    const data = await apiRequest('/api/play/slots/buy-bonus', 'POST', {
      currency: state.currency,
      betAmount
    });
    if (data.balances) { state.balances = mergeBalances(data.balances); updateWalletUI(); }
    if (window.GameRenderers && typeof GameRenderers.renderSlots === 'function') {
      GameRenderers.renderSlots(data.details, data.multiplier, data.payout);
    } else {
      renderSlotsResult(data.details, data.multiplier, data.payout);
    }
  } catch (err) {
    alert(err.message || 'Buy bonus failed');
  } finally {
    state.isProcessing = false;
  }
}

/* --- STANDARD BET DISPATCHER --- */
async function executeStandardBet(betAmount) {
  if (!state.currentGame) return;

  const autoChk = document.getElementById('auto-bet-toggle');
  const autoCount = parseInt(document.getElementById('auto-bet-count')?.value || '0') || 0;
  state.autoBetRemaining = (autoChk && autoChk.checked && autoCount > 0) ? autoCount : null;

  state.isProcessing = true;
  playSound('chip');
  const actionBtn = document.getElementById('btn-primary-action');
  actionBtn.disabled = true;

  // Optimistic balance debit — show the bet immediately so the user sees the
  // cost the moment they hit PLACE BET. The server response will overwrite
  // this with authoritative numbers once the round resolves.
  applyOptimisticDebit(betAmount);

  const params = {};
  if (state.currentGame === 'plinko') {
    params.rows = parseInt(document.getElementById('plinko-rows')?.value || 16);
  } else if (state.currentGame === 'keno') {
    if (state.selectedKenoNumbers.length === 0) {
      actionBtn.disabled = false;
      state.isProcessing = false;
      return alert('Please select at least 1 Keno number.');
    }
    params.selectedNumbers = state.selectedKenoNumbers;
  } else if (state.currentGame === 'baccarat') {
    params.betType = document.getElementById('baccarat-bet')?.value || 'PLAYER';
    params.sideBetPlayerPair = !!document.getElementById('baccarat-sb-pair')?.checked;
    params.sideBetBankerPair = !!document.getElementById('baccarat-sb-banker')?.checked;
    const sbPair = document.getElementById('baccarat-sb-pair');
    const sbBanker = document.getElementById('baccarat-sb-banker');
    if (sbPair) sbPair.checked = false;
    if (sbBanker) sbBanker.checked = false;
  } else if (state.currentGame === 'crash') {
    params.targetMultiplier = parseFloat(document.getElementById('crash-target')?.value || 2.0);
  }

  try {
    // Server is the single source of truth — failures surface as alerts,
    // never as simulated Math.random() results.
    const data = await apiRequest('/api/play/' + state.currentGame, 'POST', {
      currency: state.currency,
      betAmount,
      params
    });

      syncFair(data);

      if (state.currentGame === 'baccarat') {
        state.baccaratPendingBalance = data.balances;
      }

      switch (state.currentGame) {
        case 'slots':
          if (window.GameRenderers && typeof GameRenderers.renderSlots === 'function') {
            GameRenderers.renderSlots(data.details, data.multiplier, data.payout);
          } else {
            renderSlotsResult(data.details, data.multiplier, data.payout);
          }
          break;
        case 'plinko':
          if (window.GameRenderers && typeof GameRenderers.renderPlinko === 'function') {
            GameRenderers.renderPlinko(data.details, data.multiplier, data.payout);
          }
          break;
        case 'keno':
          if (window.GameRenderers && typeof GameRenderers.renderKeno === 'function') {
            GameRenderers.renderKeno(data.details, data.multiplier, data.payout);
          }
          break;
        case 'wheel':
          if (window.GameRenderers && typeof GameRenderers.renderWheel === 'function') {
            GameRenderers.renderWheel(data.details, data.multiplier);
          }
          break;
        case 'baccarat':
          if (window.GameRenderers && typeof GameRenderers.renderBaccarat === 'function') {
            GameRenderers.renderBaccarat(data.details, data.payout);
          }
          break;
        case 'dice':
          if (window.GameRenderers && typeof GameRenderers.renderDice === 'function') {
            GameRenderers.renderDice(data.details, data.win);
          }
          break;
        case 'crash':
          if (window.GameRenderers && typeof GameRenderers.renderCrashGame === 'function') {
            GameRenderers.renderCrashGame(data.details, data.win, data.payout);
          }
          break;
        default:
          const display = document.getElementById('game-display-area');
          if (display) {
            display.innerHTML = `
              <div style="text-align:center; padding: 20px;">
                <div style="font-size:2rem; font-weight:800; color:${data.multiplier > 1 ? '#00e701' : '#ff4d4d'}; margin-bottom: 12px;">
                  ${data.multiplier.toFixed(2)}x
                </div>
                <p style="font-weight: 600; color: #b1bad2;">Payout: ${formatCoins(data.payout)} ${state.currency}</p>
              </div>`;
          }
          break;
      }

      if (state.currentGame !== 'crash') {
        state.balances = mergeBalances(data.balances);
        updateWalletUI();
      } else {
        state.balances = mergeBalances(data.balances);
        updateWalletUI();
      }
  } catch (err) {
    alert(err.message || (state.currentGame + ' failed'));
  } finally {
    actionBtn.disabled = false;
    state.isProcessing = false;

    if (state.autoBetRemaining && state.autoBetRemaining > 0) {
      state.autoBetRemaining--;
      if (state.autoBetRemaining > 0) {
        setTimeout(() => {
          const betInput = document.getElementById('bet-input');
          if (betInput) executeStandardBet(parseFloat(betInput.value) || 10);
        }, 800);
      }
    }
  }
}

function renderKenoResult(details, multiplier, payout) {
  renderKenoBoard({ drawn: details.drawn, locked: true });
  if (multiplier > 0) playSound('win'); else playSound('loss');
}


/* --- SHARED GAME RENDER HELPERS --- */
const SLOT_SPIN_SYMBOLS = ['🍒', '🍋', '🍇', '🔔', '💎', '7️⃣', '⭐', '🎰'];
const PLINKO_CLIENT_TABLES = {
  8:  [13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13],
  10: [22, 5, 2, 1.4, 0.6, 0.4, 0.6, 1.4, 2, 5, 22],
  12: [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33],
  14: [58, 15, 7, 4, 1.9, 1, 0.5, 0.2, 0.5, 1, 1.9, 4, 7, 15, 58],
  16: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110]
};
const WHEEL_COLORS = {
  GRAY: '#39424d', BLUE: '#1876d2', GREEN: '#00e701',
  PURPLE: '#8248ff', ORANGE: '#ff8b20', GOLD: '#ffc700'
};
const SLOT_LINE_NAMES = ['Top Row', 'Middle Row', 'Bottom Row', 'Diagonal ↘', 'Diagonal ↙'];

function cardHTML(card, hidden, big) {
  if (hidden || !card) return '<div class="playing-card face-down"><span>🂠</span></div>';
  const red = card.suit === '♥' || card.suit === '♦';
  const suit = card.suit || '♠';
  return `
    <div class="playing-card ${red ? 'red' : ''} ${big ? 'big' : ''}">
      <span class="pc-rank">${card.label || card.value}</span>
      <span class="pc-suit">${suit}</span>
    </div>`;
}

/* --- SLOTS RENDERER (spinning reels + winning line highlight) --- */
function slotsGridHTML(grid, hotSet, final) {
  let html = '<div style="display:flex;flex-direction:column;gap:8px;width:fit-content;margin:auto;padding:14px;background:#10161d;border-radius:12px;border:1px solid #243542;">';
  for (let r = 0; r < 3; r++) {
    html += '<div style="display:flex;gap:8px;">';
    for (let c = 0; c < 3; c++) {
      const isHot = final && hotSet.has(r + '-' + c);
      html += '<div style="width:min(72px,20vw);height:min(72px,20vw);display:flex;align-items:center;justify-content:center;font-size:clamp(1.6rem,6vw,2.1rem);background:#14222d;border:1px solid ' + (isHot ? '#00e701' : '#243542') + ';border-radius:10px;box-shadow:' + (isHot ? '0 0 14px rgba(0,231,1,.45)' : 'none') + ';">' + grid[r][c] + '</div>';
    }
    html += '</div>';
  }
  return html + '</div>';
}

function renderSlotsResult(details, multiplier, payout) {
  const display = document.getElementById('game-display-area');
  const grid = details.grid;
  const winLines = details.winningLines || [];
  const jackpot = details.jackpot || null;
  const jackpotPool = details.jackpotPool || null;
  let tick = 0;

  const timer = setInterval(() => {
    tick++;
    const animGrid = grid.map(row => row.map(() => SLOT_SPIN_SYMBOLS[Math.floor(Math.random() * SLOT_SPIN_SYMBOLS.length)]));
    let html = slotsGridHTML(animGrid, null, false);
    if (jackpotPool) {
      html += '<div style="margin-top:8px;text-align:center;max-width:240px;">';
      ['mini','minor','major','grand'].forEach(t => {
        const c = {mini:'#8248ff',minor:'#00b3ff',major:'#ff4d4d',grand:'#ff1744'}[t];
        html += '<span style="display:inline-block;margin:0 4px;font-size:0.65rem;color:' + c + ';">' +
          t.charAt(0).toUpperCase() + t.slice(1) + ': ' + Number(jackpotPool[t]).toFixed(0) + ' ' + state.currency + '</span>';
      });
      html += '</div>';
    }
    display.innerHTML = html;
    if (tick >= 12) {
      clearInterval(timer);
      finishSlots();
    }
  }, 60);

  function finishSlots() {
    const LINES = [
      [[0, 0], [0, 1], [0, 2]],
      [[1, 0], [1, 1], [1, 2]],
      [[2, 0], [2, 1], [2, 2]],
      [[0, 0], [1, 1], [2, 2]],
      [[2, 0], [1, 1], [0, 2]]
    ];
    const hot = new Set();
    winLines.forEach(w => LINES[w.line].forEach(([r, c]) => hot.add(r + '-' + c)));

    let html = slotsGridHTML(grid, hot, true);

    if (jackpot && jackpot.tier === 'grand') {
      html += '<div style="text-align:center;margin-top:14px;"><div style="font-size:1.6rem;font-weight:900;color:#ff1744;">🎰 GRAND JACKPOT! 🎰</div>' +
        '<div style="color:#ff4d4d;font-weight:700;">' + formatCoins(jackpot.amount) + ' ' + state.currency + '</div></div>';
    } else if (jackpot) {
      html += '<div style="text-align:center;margin-top:12px;"><div style="font-weight:800;color:#ff4d4d;">' +
        jackpot.tier.toUpperCase() + ' JACKPOT!</div><div style="font-size:0.78rem;color:#b1bad2;">' + formatCoins(jackpot.amount) + ' ' + state.currency + '</div></div>';
    }

    if (winLines.length) {
      html += '<div style="text-align:center;margin-top:12px;font-weight:800;color:#00e701;font-size:1.1rem;">💰 WIN ' + multiplier.toFixed(2) + 'x</div>';
      html += '<div style="text-align:center;color:#b1bad2;font-size:0.82rem;margin-top:4px;">' +
        winLines.map(w => SLOT_LINE_NAMES[w.line] + ' pays ' + w.multiplier.toFixed(2) + 'x').join(' • ') + '</div>';
      playSound('win');
    } else {
      html += '<div style="text-align:center;margin-top:14px;color:#ff4d4d;font-weight:700;">No winning lines 💀</div>';
      playSound('loss');
    }
    display.innerHTML = html;
  }
}


/* --- PLINKO RENDERER (animated drop + bucket highlight) --- */
function renderPlinkoResult(details, multiplier, payout) {
  const display = document.getElementById('game-display-area');
  const rows = details.rows;
  const path = details.path;
  const bucket = details.bucket;
  const table = PLINKO_CLIENT_TABLES[rows] || PLINKO_CLIENT_TABLES[16];

  let step = 0;
  let pos = 0;
  function drawMid() {
    display.innerHTML =
      '<div style="text-align:center;padding:20px;">' +
      '<div style="font-size:1rem;color:#b1bad2;font-weight:700;">Row ' + Math.min(step + 1, rows) + ' / ' + rows + '</div>' +
      '<div style="font-size:2.2rem;margin-top:6px;">' + '.\u2009'.repeat(pos) + '⚪' + '.\u2009'.repeat(rows - pos) + '</div>' +
      '</div>';
  }
  drawMid();

  const timer = setInterval(() => {
    if (step >= rows) {
      clearInterval(timer);
      finishPlinko();
      return;
    }
    pos += path[step];
    step++;
    playSound('chip');
    drawMid();
  }, Math.max(45, 650 / rows));

  function finishPlinko() {
    let buckets = '<div style="display:flex;gap:4px;justify-content:center;margin-top:10px;">';
    for (let i = 0; i <= rows; i++) {
      const hit = i === bucket;
      const m = table[i];
      const col = m >= 10 ? WHEEL_COLORS.GOLD : m >= 2 ? '#8248ff' : m >= 1 ? WHEEL_COLORS.GREEN : '#39424d';
      buckets += '<div style="min-width:min(30px,7vw);padding:6px 2px;border-radius:4px;text-align:center;font-size:0.62rem;font-weight:800;color:#fff;background:' + col + ';opacity:' + (hit ? '1' : '0.55') + ';transform:' + (hit ? 'scale(1.12)' : 'none') + ';box-shadow:' + (hit ? '0 0 10px rgba(255,199,0,.6)' : 'none') + ';">' + m.toFixed(2) + 'x</div>';
    }
    buckets += '</div>';

    const won = multiplier >= 1;
     display.innerHTML =
       '<div style="max-width:520px;margin:auto;text-align:center;">' + buckets +
       '<div style="margin-top:16px;font-size:2rem;font-weight:900;color:' + (won ? '#00e701' : '#ff4d4d') + ';">' + multiplier.toFixed(2) + 'x</div>' +
        '<div style="color:#b1bad2;font-size:0.85rem;margin-top:4px;">Payout: ' + formatCoins(payout || 0) + ' ' + state.currency + '</div>' +
       '</div>';
     if (won) playSound('win'); else playSound('loss');
   }
}


/* --- WHEEL RENDERER (conic-gradient ring with landed pointer) --- */
function renderWheelResult(details, multiplier) {
  const display = document.getElementById('game-display-area');
  const colors = [
    WHEEL_COLORS.GRAY, WHEEL_COLORS.BLUE, WHEEL_COLORS.GREEN, WHEEL_COLORS.BLUE,
    WHEEL_COLORS.PURPLE, WHEEL_COLORS.GRAY, WHEEL_COLORS.GREEN, WHEEL_COLORS.ORANGE,
    WHEEL_COLORS.BLUE, WHEEL_COLORS.PURPLE, WHEEL_COLORS.GOLD, WHEEL_COLORS.GOLD
  ];
  let stops = '';
  colors.forEach((c, i) => { stops += c + ' ' + (i * 30) + 'deg ' + ((i + 1) * 30) + 'deg' + (i < 11 ? ',' : ''); });
  const won = multiplier > 0;

  const winningIndex = details.index || 0;
  const finalRotation = (360 - (winningIndex * 30 + 15)) % 360;
  const totalSpins = 6;
  const totalRotation = totalSpins * 360 + finalRotation;
  const spinDuration = 3500;

  playSound('spin');

  display.innerHTML =
    '<div id="wheel-result" style="text-align:center;padding:10px;">' +
    '<div id="wheel-spin" style="position:relative;width:min(220px,60vw);height:min(220px,60vw);margin:20px auto;border-radius:50%;background:conic-gradient(' + stops + ');border:5px solid #243542;box-shadow:0 0 24px rgba(0,0,0,.6);transition:transform ' + spinDuration + 'ms cubic-bezier(0.25,0.1,0.25,1);transform:rotate(0deg);">' +
    '<div style="position:absolute;top:-14px;left:50%;transform:translateX(-50%);width:0;height:0;border-left:10px solid transparent;border-right:10px solid transparent;border-top:16px solid #ffc700;"></div>' +
    '</div>' +
    '<div id="wheel-multiplier" style="font-size:2rem;font-weight:900;color:' + (won ? '#00e701' : '#ff4d4d') + ';min-height:1.5em;">Spinning...</div>' +
    '<div style="color:#b1bad2;font-weight:600;">Landed on ' + details.color.toLowerCase() + '</div>' +
    '</div>';

  const wheel = document.getElementById('wheel-spin');
  if (wheel) {
    setTimeout(() => {
      wheel.style.transform = 'rotate(' + totalRotation + 'deg)';
    }, 50);
  }

  setTimeout(() => {
    const multEl = document.getElementById('wheel-multiplier');
    if (multEl) multEl.textContent = multiplier.toFixed(2) + 'x';
    if (won) playSound('win'); else playSound('loss');
  }, spinDuration);
}

/* --- BACCARAT RENDERER --- */
function renderBaccaratResult(details, payout) {
  const display = document.getElementById('game-display-area');
  const outcome = details.outcome;
  const betOn = details.betOn;
  const colorMap = { PLAYER: '#1876d2', BANKER: '#ff4d4d', TIE: '#8248ff' };

  display.innerHTML =
    '<div style="max-width:480px;margin:auto;">' +
    '<div class="bj-row-label" style="color:' + colorMap.BANKER + '">BANKER • ' + details.bScore + '</div>' +
    '<div class="hand-row">' + details.bankerHand.map(c => cardHTML(c, false)).join('') + '</div>' +
    '<div style="margin:12px 0;height:1px;background:#243542;"></div>' +
    '<div class="bj-row-label" style="color:' + colorMap.PLAYER + '">PLAYER • ' + details.pScore + '</div>' +
    '<div class="hand-row">' + details.playerHand.map(c => cardHTML(c, false)).join('') + '</div>' +
    '<div style="text-align:center;margin-top:18px;font-size:1.3rem;font-weight:900;color:' + colorMap[outcome] + ';">' + outcome + (outcome === betOn ? ' — YOU WIN' : '') + '</div>' +
    '<div style="text-align:center;color:#b1bad2;font-size:0.85rem;margin-top:4px;">' +
    (outcome === betOn ? 'Payout: ' + formatCoins(payout) + ' ' + state.currency :
     (outcome === 'TIE' && betOn !== 'TIE' ? 'Tie — your stake was pushed back' : '')) +
     '</div></div>';
   if (outcome === betOn) playSound('win');
   else if (outcome === 'TIE' && betOn !== 'TIE') playSound('chip');
   else playSound('loss');
}

/* --- CRASH RENDERER --- */
function renderCrashResult(details, win, payout) {
  const display = document.getElementById('game-display-area');
  display.innerHTML =
    '<div style="text-align:center;padding:26px;">' +
    '<div style="font-size:3rem;font-weight:900;color:' + (win ? '#00e701' : '#ff4d4d') + ';">' + details.crashPoint.toFixed(2) + 'x</div>' +
    '<div style="color:#b1bad2;font-weight:600;margin-top:6px;">Crashed' + (win ? ' after your ' + details.target.toFixed(2) + 'x target ✓' : ' before your ' + details.target.toFixed(2) + 'x target') + '</div>' +
    (win ? '<div style="margin-top:12px;font-weight:800;color:#00e701;">Paid ' + formatCoins(payout) + ' ' + state.currency + '</div>' : '') +
    '</div>';
  if (win) playSound('win'); else playSound('loss');
}


/* --- ROUND UI RESET HELPERS --- */
function resetRoundUI(label) {
  const actionBtn = document.getElementById('btn-primary-action');
  if (!actionBtn) return;
  actionBtn.textContent = label;
  actionBtn.disabled = false;
}

function resetBaccaratSideBets() {
  const sbPair = document.getElementById('baccarat-sb-pair');
  const sbBanker = document.getElementById('baccarat-sb-banker');
  if (sbPair) sbPair.checked = false;
  if (sbBanker) sbBanker.checked = false;
}

/* --- BLACKJACK (interactive hit / stand) --- */
function blackjackOutcomeText(outcome, multiplier, payout) {
  const cur = state.currency;
  switch (outcome) {
    case 'BLACKJACK': return { text: 'BLACKJACK! Paid ' + formatCoins(payout) + ' ' + cur, color: '#00e701' };
    case 'WIN':       return { text: 'You win! Payout ' + formatCoins(payout) + ' ' + cur, color: '#00e701' };
    case 'PUSH':      return { text: 'Push — stake returned', color: '#ffc700' };
    case 'BUST':      return { text: 'Bust! Over 21', color: '#ff4d4d' };
    default:          return { text: 'Dealer wins', color: '#ff4d4d' };
  }
}

/* --- BLACKJACK RENDERER --- */
function blackjackHandScore(hand) {
  if (!hand || hand.length === 0) return 0;
  let total = 0;
  let aces = 0;
  for (const card of hand) {
    const val = card.label || card.value;
    if (val === 'A') { aces++; total += 11; }
    else if (['J', 'Q', 'K', '10'].includes(String(val))) total += 10;
    else total += parseInt(val, 10) || 0;
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

function renderBlackjackHands(playerHand, dealerShown, holeHidden, msgObj) {
  const display = document.getElementById('game-display-area');
  const playerScore = blackjackHandScore(playerHand);
  let dealerScoreStr = '—';
  if (!holeHidden) {
    dealerScoreStr = blackjackHandScore(dealerShown).toString();
  }

  display.innerHTML =
    '<div style="max-width:460px;margin:auto;text-align:center;">' +
    '<div class="bj-row-label" style="display:flex;justify-content:space-between;">' +
      '<span>🂠 DEALER • ' + dealerScoreStr + '</span>' +
      '<span style="color:var(--text-muted);font-size:0.8rem;">Target: 21</span>' +
    '</div>' +
    '<div class="hand-row">' + dealerShown.map(c => cardHTML(c, holeHidden, false)).join('') + '</div>' +
    '<div style="margin:10px 0;height:1px;background:#243542;"></div>' +
    '<div class="bj-row-label" style="display:flex;justify-content:space-between;">' +
      '<span>🃏 YOU • <span style="color:var(--accent-blue);font-weight:800;">' + playerScore + '</span></span>' +
      '<span style="color:' + (playerScore > 21 ? '#ff4d4d' : playerScore === 21 ? '#00e701' : '#b1bad2') + ';font-size:0.8rem;font-weight:700;">' + (playerScore > 21 ? 'BUST' : playerScore === 21 ? 'BLACKJACK' : '') + '</span>' +
    '</div>' +
    '<div class="hand-row">' + playerHand.map(c => cardHTML(c, false, false)).join('') + '</div>' +
    (msgObj ? '<div style="margin-top:14px;padding:8px;border-radius:8px;background:rgba(' + (msgObj.color.includes('e7') ? '0,231,1' : msgObj.color.includes('4d4d') ? '255,77,77' : '255,199,0') + ',0.12);font-weight:800;color:' + msgObj.color + ';">' + msgObj.text + '</div>' : '') +
    '</div>';
}

async function startBlackjackGame(betAmount) {
  state.isProcessing = true;
  playSound('chip');
  applyOptimisticDebit(betAmount);
  try {
    const data = await apiRequest('/api/play/blackjack/start', 'POST', {
      currency: state.currency,
      betAmount
    });
    if (data.balances) { state.balances = mergeBalances(data.balances); updateWalletUI(); }

     if (data.resolved) {
        if (window.GameRenderers && GameRenderers.renderBlackjackHands) {
          GameRenderers.renderBlackjackHands(data.playerHand, data.dealerHand, false,
            blackjackOutcomeText(data.outcome, data.multiplier, data.payout));
        } else {
          renderBlackjackHands(data.playerHand, data.dealerHand, false,
            blackjackOutcomeText(data.outcome, data.multiplier, data.payout));
        }
        if (data.multiplier > 1) playSound('win'); else playSound('loss');
        clearGameControls();
        state.activeGameState = null;
        setTimeout(() => {
          if (data.balances) { state.balances = mergeBalances(data.balances); updateWalletUI(); }
          resetRoundUI('DEAL HAND');
        }, 2000);
     } else {
      state.activeGameState = {
        type: 'blackjack',
        gameId: data.gameId,
        dealerUp: data.dealerUpCard,
        betAmount
      };
      if (window.GameRenderers && GameRenderers.renderBlackjackHands) {
        GameRenderers.renderBlackjackHands(data.playerHand, [data.dealerUpCard], true, null);
      } else {
        renderBlackjackHands(data.playerHand, [data.dealerUpCard], true, null);
      }
      document.getElementById('game-controls-options').innerHTML =
        '<button type="button" class="btn-play game-action-btn" onclick="blackjackAction(\'hit\')">HIT</button>' +
        '<button type="button" class="btn-secondary-action game-action-btn" onclick="blackjackAction(\'stand\')">STAND</button>' +
        (GameRenderers.canDoubleDown && GameRenderers.canDoubleDown(data) ? '<button type="button" class="btn-secondary-action game-action-btn" onclick="blackjackAction(\'double\')">DOUBLE</button>' : '') +
        (GameRenderers.canSplit && GameRenderers.canSplit(data) ? '<button type="button" class="btn-secondary-action game-action-btn" onclick="blackjackAction(\'split\')">SPLIT</button>' : '') +
        (GameRenderers.canInsurance && GameRenderers.canInsurance(data) ? '<button type="button" class="btn-secondary-action game-action-btn" onclick="blackjackAction(\'insurance\')">INSURANCE</button>' : '');
      resetRoundUI('IN PLAY…');
      document.getElementById('btn-primary-action').disabled = true;
    }
  } catch (err) {
    alert(err.message || 'Blackjack failed');
  } finally {
    state.isProcessing = false;
   }
}


/* --- BLACKJACK (interactive HIT / STAND / DOUBLE / SPLIT / INSURANCE) --- */
async function blackjackAction(action) {
  if (state.isProcessing || !state.activeGameState) return;
  state.isProcessing = true;
  try {
    const data = await apiRequest('/api/play/blackjack/' + action, 'POST', {
      gameId: state.activeGameState.gameId
    });

    if (data.balances) { state.balances = mergeBalances(data.balances); updateWalletUI(); }

    if (data.resolved) {
       if (window.GameRenderers && GameRenderers.renderBlackjackHands) {
         GameRenderers.renderBlackjackHands(data.playerHand, data.dealerHand, false,
           blackjackOutcomeText(data.outcome, data.multiplier, data.payout));
       } else {
         renderBlackjackHands(data.playerHand, data.dealerHand, false,
           blackjackOutcomeText(data.outcome, data.multiplier, data.payout));
       }
       if (data.multiplier > 1) playSound('win'); else playSound('loss');
       clearGameControls();
       state.activeGameState = null;
       setTimeout(() => {
         if (data.balances) { state.balances = mergeBalances(data.balances); updateWalletUI(); }
         resetRoundUI('DEAL HAND');
       }, 2000);
     } else {
       if (window.GameRenderers && GameRenderers.renderBlackjackHands) {
         GameRenderers.renderBlackjackHands(data.playerHand, [data.dealerUpCard], true, null);
       } else {
         renderBlackjackHands(data.playerHand, [data.dealerUpCard], true, null);
       }
     }
  } catch (err) {
    alert(err.message || 'Blackjack ' + action + ' failed');
  } finally {
    state.isProcessing = false;
  }
}


/* --- HILO (interactive higher/lower with cashout) --- */
function hiloStepMult(rank, guess) {
  const good = guess === 'HIGHER' ? 13 - rank : rank - 1;
  return good <= 0 ? 0 : Math.floor((13 / good) * 0.87 * 10000) / 10000;
}

function renderHiloControls() {
  const ags = state.activeGameState;
  if (!ags || ags.type !== 'hilo' || !ags.currentCard) return;
  const rank = ags.currentCard.rank;
  const upM = hiloStepMult(rank, 'HIGHER');
  const downM = hiloStepMult(rank, 'LOWER');
  document.getElementById('game-controls-options').innerHTML =
    '<button type="button" class="btn-play" style="padding:12px 22px;font-weight:800;' + (upM ? '' : 'opacity:.35;pointer-events:none;') + '" onclick="hiloGuess(\'HIGHER\')">▲ HIGHER<div style="font-size:0.7rem;font-weight:600;">' + upM.toFixed(2) + 'x • ' + ((13 - rank) / 13 * 100).toFixed(1) + '%</div></button>' +
    '<button type="button" class="btn-secondary-action" style="padding:12px 22px;font-weight:800;' + (downM ? '' : 'opacity:.35;pointer-events:none;') + '" onclick="hiloGuess(\'LOWER\')">▼ LOWER<div style="font-size:0.7rem;font-weight:600;">' + downM.toFixed(2) + 'x • ' + ((rank - 1) / 13 * 100).toFixed(1) + '%</div></button>';
}

function renderHiloBoard(msgObj) {
  const display = document.getElementById('game-display-area');
  const ags = state.activeGameState;
  if (window.GameRenderers && GameRenderers.renderHiloBoard) {
    GameRenderers.renderHiloBoard(msgObj);
  } else {
    display.innerHTML =
      '<div style="text-align:center;">' +
      (ags.prevCard ? '<div class="hand-row" style="justify-content:center;opacity:.45;margin-bottom:6px;">' + cardHTML(ags.prevCard, false, true) + '</div>' : '') +
      (ags.currentCard ? '<div class="hand-row" style="justify-content:center;">' + cardHTML(ags.currentCard, false, true) + '</div>' : '') +
      '<div style="margin-top:10px;color:#b1bad2;font-weight:700;">Multiplier: <span style="color:#00e701;">' + ags.multiplier.toFixed(2) + 'x</span></div>' +
      (msgObj ? '<div style="margin-top:8px;font-weight:800;color:' + msgObj.color + ';">' + msgObj.text + '</div>' : '') +
      '</div>';
  }
}


async function startHiloGame(betAmount) {
  state.isProcessing = true;
  playSound('chip');
  applyOptimisticDebit(betAmount);
  try {
    const data = await apiRequest('/api/play/hilo/start', 'POST', {
      currency: state.currency,
      betAmount
    });
    if (data.balances) { state.balances = mergeBalances(data.balances); updateWalletUI(); }

    state.activeGameState = {
      type: 'hilo',
      gameId: data.gameId,
      currentCard: data.currentCard,
      prevCard: null,
      multiplier: 1.00,
      betAmount,
      history: []
    };
     if (window.GameRenderers && window.GameRenderers.renderHiloBoard) {
       window.GameRenderers.renderHiloBoard(null);
     } else {
       renderHiloBoard(null);
     }
     renderHiloControls();

    const actionBtn = document.getElementById('btn-primary-action');
    actionBtn.textContent = 'CASHOUT (1.00x)';
    actionBtn.disabled = true; // enabled after the first correct guess
  } catch (err) {
    alert(err.message || 'HiLo start failed');
  } finally {
    state.isProcessing = false;
  }
}

async function hiloGuess(guess) {
  if (state.isProcessing || !state.activeGameState) return;
  state.isProcessing = true;
  playSound('click');
  try {
    const data = await apiRequest('/api/play/hilo/guess', 'POST', {
      gameId: state.activeGameState.gameId,
      guess
    });

     if (!data.win) {
       state.activeGameState.history.push(state.activeGameState.currentCard);
       state.activeGameState.prevCard = state.activeGameState.currentCard;
       state.activeGameState.currentCard = data.nextCard;
       renderHiloBoard({ text: 'Wrong guess — you needed ' + guess.toLowerCase() + '. Round over.', color: '#ff4d4d' });
       playSound('loss');
       document.getElementById('game-controls-options').innerHTML = '';
       setTimeout(() => {
         if (data.balances) { state.balances = mergeBalances(data.balances); updateWalletUI(); }
         state.activeGameState = null;
         launchGame('hilo');
       }, 1500);
     } else if (data.cashedOut || data.autoCashout) {
        const payout = formatCoins(Number(data.payout || 0));
       state.activeGameState.multiplier = data.multiplier;
       state.activeGameState.currentCard = data.nextCard;
       state.activeGameState.prevCard = null;
       renderHiloBoard({ text: 'Board boundary reached — auto-cashout ' + data.multiplier.toFixed(2) + 'x, +' + payout + ' ' + state.currency, color: '#00e701' });
       playSound('win');
       document.getElementById('game-controls-options').innerHTML = '';
       setTimeout(() => {
         if (data.balances) { state.balances = mergeBalances(data.balances); updateWalletUI(); }
         state.activeGameState = null;
         resetRoundUI('PLACE BET');
       }, 2000);
     } else {
       const ags = state.activeGameState;
       ags.history.push(ags.currentCard);
       ags.prevCard = ags.currentCard;
       ags.currentCard = data.nextCard || data.currentCard;
       ags.multiplier = data.multiplier;
       renderHiloBoard(null);
       renderHiloControls();
       playSound('win');
       const btn = document.getElementById('btn-primary-action');
       btn.textContent = 'CASHOUT (' + ags.multiplier.toFixed(2) + 'x)';
       btn.disabled = false;
     }
  } catch (err) {
    alert(err.message || 'HiLo guess failed');
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
    const payout = formatCoins(Number(data.payout || 0));
    renderHiloBoard({ text: 'Cashed out ' + data.multiplier.toFixed(2) + 'x — +' + payout + ' ' + state.currency, color: '#00e701' });
    document.getElementById('game-controls-options').innerHTML = '';
    setTimeout(() => {
      if (data.balances) { state.balances = mergeBalances(data.balances); updateWalletUI(); }
      state.activeGameState = null;
      resetRoundUI('PLACE BET');
    }, 2000);
  } catch (err) {
    alert(err.message || 'HiLo cashout failed');
  } finally {
    state.isProcessing = false;
  }
}

// ==========================================================================
// 11. PROFILE & ACCOUNT CONTROLLERS
// ==========================================================================

async function openAccountPage() {
  if (!state.profile) {
    openAuthModal();
    return;
  }
  closeProfileDropdown();
  playSound('click');
  history.pushState(null, '', '/account');
  handleRouteChange();
}

function closeAccountPage() {
  playSound('click');
  history.pushState(null, '', '/');
  handleRouteChange();
}

function toggleProfileDropdown(event) {
  if (event) event.stopPropagation();
  const menu = document.getElementById('profile-dropdown');
  if (!menu) return;
  const wasHidden = menu.classList.contains('hidden');
  closeWalletDropdown();
  if (wasHidden) {
    menu.classList.remove('hidden');
    syncProfileDropdownHeader();
    playSound('click');
  } else {
    menu.classList.add('hidden');
  }
}

function closeProfileDropdown() {
  document.getElementById('profile-dropdown')?.classList.add('hidden');
}

function syncProfileDropdownHeader() {
  const p = state.profile || {};
  const vipText = (p.vip && p.vip.tier) || 'Bronze';
  const username = p.username || localStorage.getItem('casino_username') || 'Guest';
  const isGuest = !!p.isGuest;
  const nameEl = document.getElementById('profile-dropdown-name');
  const tierEl = document.getElementById('profile-dropdown-tier');
  const avatarEl = document.querySelector('.profile-dropdown-avatar');
  if (nameEl) nameEl.textContent = username;
  if (tierEl) tierEl.textContent = (vipText || 'Bronze') + ' VIP' + (isGuest ? ' · Guest (Test Mode)' : '');
  if (avatarEl) avatarEl.textContent = (username || 'G').charAt(0).toUpperCase();

  // Withdraw button is visible to:
  //   - Real (non-guest) users — production flow
  //   - Guest accounts — for testing only (every other screen still blocks it server-side)
  const withdrawBtn = document.getElementById('profile-dropdown-withdraw');
  if (withdrawBtn) {
    withdrawBtn.style.display = isGuest ? 'flex' : 'flex';
  }
}

async function refreshAccountPage(page = 'overview') {
  setActiveAccountLink(page);
  const container = document.getElementById('view-account');
  if (!container) return;
  try {
    const data = await apiRequest('/api/user/me');
    state.profile = data;
    state.balances = mergeBalances(data.balances);
    updateWalletUI();
    updateUserProfileBadge();
  } catch (err) {
    console.warn('[Account] Could not refresh profile:', err.message);
  }
  renderAccountPage(page);
}

function navigateToAccount(page) {
  playSound('click');
  const path = page === 'overview' ? '/account' : '/account/' + page;
  history.pushState(null, '', path);
  setActiveAccountLink(page);
  renderAccountPage(page);
}

function navigateToAccountFromMenu(page) {
  closeProfileDropdown();
  if (!state.profile) {
    openAuthModal();
    return;
  }
  playSound('click');
  let navPage = page;
  let path;
  if (page === 'transactions/deposits' || page === 'transactions/withdrawals' || page === 'transactions/bets-casino') {
    navPage = 'transactions';
    path = '/account/transactions/' + page.replace('transactions/', '');
    state.accountTxSub = page.replace('transactions/', '');
  } else {
    path = '/account/' + page;
  }
  history.pushState(null, '', path);
  setActiveAccountLink(navPage);
  handleRouteChange();
}

function setActiveAccountLink(page) {
  document.querySelectorAll('.account-nav-link').forEach(link => {
    link.classList.toggle('active', link.dataset.accountPage === page);
  });
}

function setActiveSidebarLink(path) {
  document.querySelectorAll('.sidebar .nav-item[data-route]').forEach(item => {
    const route = item.dataset.route;
    const isMatch = route === '/' ? path === '/' : path === route || path.startsWith(route + '/');
    item.classList.toggle('active', isMatch);
  });
}

// Open/close the off-canvas left navigation on mobile (toggle button + overlay).
function toggleMainSidebar() {
  const sb = document.getElementById('main-sidebar');
  if (!sb) return;
  sb.classList.toggle('open');
  const overlay = document.getElementById('sidebar-overlay');
  if (overlay) overlay.classList.toggle('open');
  document.body.style.overflow = sb.classList.contains('open') ? 'hidden' : '';
}

function renderAccountPage(page = 'overview') {
  const content = document.getElementById('account-content');
  if (!content) return;
  const p = state.profile || {};
  const kyc = p.kyc || { status: 'UNVERIFIED', tier: 0 };
  const kycStatusText = {
    UNVERIFIED: 'Not Verified',
    PENDING: 'Verification Pending',
    VERIFIED: 'Verified',
    REJECTED: 'Rejected'
  }[kyc.status] || 'Unknown';
  const kycClass = {
    UNVERIFIED: 'kyc-badge-unverified',
    PENDING: 'kyc-badge-pending',
    VERIFIED: 'kyc-badge-verified',
    REJECTED: 'kyc-badge-rejected'
  }[kyc.status] || 'kyc-badge-unverified';
  const b = state.balances || { gc: 0, sc: 0, sc_unplayed: 0, sc_played: 0 };
  const gc = formatCoins(b.gc || 0);
  const sc = formatCoins(b.sc || 0);
  const scUnplayed = formatCoins(b.sc_unplayed || 0);
  const scPlayed = formatCoins(b.sc_played || 0);
  const vip = p.vip || {};
  const vipText = vip.tier || 'Bronze';
  const totalWageredGC = formatCoins(vip.totalWageredGC || 0);
  const totalWageredSC = formatCoins(vip.totalWageredSC || 0);
  const memberSince = p.createdAt ? new Date(p.createdAt).toLocaleDateString() : 'N/A';
  const isGuest = !!(p.isGuest || (p.email && p.email.endsWith('@guest.casino')));

  const sidebarName = document.getElementById('account-sidebar-name');
  const sidebarTier = document.getElementById('account-sidebar-tier');
  if (sidebarName) sidebarName.textContent = p.username || 'Guest';
  if (sidebarTier) sidebarTier.textContent = (vipText || 'Bronze') + ' VIP';

  const initial = (p.username || 'G').charAt(0).toUpperCase();
  const sidebarAvatar = document.querySelector('.account-sidebar-avatar');
  if (sidebarAvatar) sidebarAvatar.textContent = initial;

  let html = '';

  if (page === 'overview') {
    html = `
      <div class="account-hero">
        <div class="account-avatar">${escapeHTML(initial)}</div>
        <div class="account-hero-info">
          <h1 class="account-username">${escapeHTML(p.username || 'Guest')}</h1>
          <span class="vip-badge vip-${vipText.toLowerCase()}">${escapeHTML(vipText)} VIP</span>
        </div>
      </div>

      <div class="account-stats-row">
        <div class="stat-card">
          <div class="stat-icon">🪙</div>
          <div class="stat-info">
            <span class="stat-value">${gc}</span>
            <span class="stat-label">Gold Coins</span>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">💎</div>
          <div class="stat-info">
            <span class="stat-value">${sc}</span>
            <span class="stat-label">Sweeps Coins</span>
          </div>
        </div>
      </div>

      <div class="account-details-grid">
        <div class="account-card">
          <h3 class="account-card-title">Account</h3>
          <div class="account-detail-list">
            <div class="account-detail-item"><span class="detail-label">Username</span><span class="detail-value">${escapeHTML(p.username || 'Guest')}</span></div>
            <div class="account-detail-item"><span class="detail-label">Email</span><span class="detail-value">${escapeHTML(p.email || (isGuest ? 'guest@casino' : '—'))}</span></div>
            <div class="account-detail-item"><span class="detail-label">Member Since</span><span class="detail-value">${memberSince}</span></div>
          </div>
        </div>
      </div>`;
  } else if (page === 'profile') {
    html = `
      <div class="account-hero">
        <div class="account-avatar">${escapeHTML(initial)}</div>
        <div class="account-hero-info">
          <h1 class="account-username">Profile</h1>
          <span class="vip-badge vip-${vipText.toLowerCase()}">${escapeHTML(vipText)} VIP</span>
        </div>
      </div>
      <div class="account-details-grid">
        <div class="account-card">
          <h3 class="account-card-title">Account Information</h3>
          <div class="account-detail-list">
            <div class="account-detail-item"><span class="detail-label">Username</span><span class="detail-value">${escapeHTML(p.username || 'Guest')}</span></div>
            <div class="account-detail-item"><span class="detail-label">Email</span><span class="detail-value">${escapeHTML(p.email || '—')}</span></div>
            <div class="account-detail-item"><span class="detail-label">State</span><span class="detail-value">${escapeHTML(p.state || 'CA')}</span></div>
            <div class="account-detail-item"><span class="detail-label">Member Since</span><span class="detail-value">${memberSince}</span></div>
            <div class="account-detail-item"><span class="detail-label">Account Type</span><span class="detail-value">${isGuest ? 'Guest' : 'Registered'}</span></div>
          </div>
        </div>
        <div class="account-card">
          <h3 class="account-card-title">VIP Status</h3>
          <div class="account-detail-list">
            <div class="account-detail-item"><span class="detail-label">Current Tier</span><span class="detail-value"><span class="vip-badge vip-${vipText.toLowerCase()}">${escapeHTML(vipText)}</span></span></div>
            <div class="account-detail-item"><span class="detail-label">Total GC Wagered</span><span class="detail-value">${totalWageredGC}</span></div>
            <div class="account-detail-item"><span class="detail-label">Total SC Wagered</span><span class="detail-value">${totalWageredSC}</span></div>
            <div class="account-detail-item"><span class="detail-label">Rakeback Earned</span><span class="detail-value">${formatCoins(vip.rakebackAccruedSC || 0)} SC</span></div>
          </div>
          <div class="profile-actions" style="margin-top: 6px;">
            <button class="btn-profile-action" onclick="openProvablyFairModal()">🛡️ Provably Fair Settings</button>
          </div>
        </div>
      </div>`;
  } else if (page === 'wallet') {
    html = `
      <div class="account-hero">
        <div class="account-avatar">💰</div>
        <div class="account-hero-info">
          <h1 class="account-username">Wallet</h1>
          <span class="vip-badge vip-${vipText.toLowerCase()}">${escapeHTML(vipText)} VIP</span>
        </div>
      </div>
      <div class="account-details-grid">
        <div class="account-card">
          <h3 class="account-card-title">Current Balances</h3>
          <div class="balance-cards">
            <div class="balance-card gc">
              <div class="balance-card-header"><span class="balance-icon">🪙</span><span class="balance-type">Gold Coins</span></div>
              <div class="balance-amount">${gc}</div>
              <div class="balance-sub">GC</div>
            </div>
            <div class="balance-card sc">
              <div class="balance-card-header"><span class="balance-icon">💎</span><span class="balance-type">Sweeps Coins</span></div>
              <div class="balance-amount">${sc}</div>
              <div class="balance-sub">Total SC</div>
            </div>
          </div>
          <div class="balance-breakdown">
            <div class="breakdown-item"><span class="breakdown-label">Unplayed SC (must wager 1x)</span><span class="breakdown-value">${scUnplayed}</span></div>
            <div class="breakdown-item"><span class="breakdown-label">Redeemable SC</span><span class="breakdown-value">${scPlayed}</span></div>
          </div>
        </div>
        <div class="account-card">
          <h3 class="account-card-title">Manage Funds</h3>
          <div class="wallet-actions">
            <button class="btn-wallet-action" onclick="openStoreModal()">🪙 Buy Coin Package</button>
            <button class="btn-wallet-action" onclick="openRedeemModal()">💸 Redeem SC</button>
            <button class="btn-wallet-action" onclick="history.pushState(null,'','/rakeback');handleRouteChange()">💎 Claim Rakeback</button>
          </div>
        </div>
      </div>`;
  } else if (page === 'kyc') {
    html = `
      <div class="account-hero">
        <div class="account-avatar">🛡️</div>
        <div class="account-hero-info">
          <h1 class="account-username">Identity Verification</h1>
          <span class="vip-badge vip-${vipText.toLowerCase()}">${escapeHTML(vipText)} VIP</span>
        </div>
      </div>
      <div class="account-details-grid">
        <div class="account-card">
          <h3 class="account-card-title">Verification Status</h3>
          <div class="kyc-status-badge ${kycClass}">${escapeHTML(kycStatusText)}</div>
          ${kyc.rejectionReason ? `<div class="kyc-rejection">${escapeHTML(kyc.rejectionReason)}</div>` : ''}
          <div class="kyc-tier-info">
            <span>Verification Tier</span>
            <span class="tier-value">Tier ${kyc.tier} of 2</span>
          </div>
          <div class="kyc-actions">
            ${kyc.status === 'VERIFIED' ? '<button class="btn-kyc-verified" disabled><span>✓</span> Identity Verified</button>' : ''}
            ${kyc.status === 'PENDING' ? '<button class="btn-kyc-pending" disabled><span>⏳</span> Verification Pending</button>' : ''}
            ${(kyc.status === 'REJECTED' || kyc.status === 'UNVERIFIED') ? '<button type="button" class="btn-kyc-action" onclick="startKycVerification()">' + (kyc.status === 'REJECTED' ? 'Retry Verification' : 'Start Verification') + '</button>' : ''}
          </div>
        </div>
        <div class="account-card">
          <h3 class="account-card-title">Why Verify?</h3>
          <div class="account-detail-list">
            <div class="account-detail-item"><span class="detail-label">Tier 1</span><span class="detail-value">Email & basic info</span></div>
            <div class="account-detail-item"><span class="detail-label">Tier 2</span><span class="detail-value">Government ID document</span></div>
            <div class="account-detail-item"><span class="detail-label">Required to</span><span class="detail-value">Redeem Sweeps Coins for cash</span></div>
            <div class="account-detail-item"><span class="detail-label">Provider</span><span class="detail-value">Persona (secure)</span></div>
          </div>
        </div>
      </div>`;
  } else if (page === 'transactions') {
    const sub = state.accountTxSub || 'deposits';
    html = `
      <div class="account-hero">
        <div class="account-avatar">📋</div>
        <div class="account-hero-info">
          <h1 class="account-username">Transaction History</h1>
          <span class="vip-badge vip-${vipText.toLowerCase()}">${escapeHTML(vipText)} VIP</span>
        </div>
      </div>
      <div class="account-details-grid">
        <div class="account-card" style="grid-column: 1 / -1;">
          <div class="account-tx-tabs">
            <button class="tx-tab-btn ${sub === 'deposits' ? 'active' : ''}" data-tx-sub="deposits" onclick="navigateToTxSub('deposits')">💰 Deposits</button>
            <button class="tx-tab-btn ${sub === 'withdrawals' ? 'active' : ''}" data-tx-sub="withdrawals" onclick="navigateToTxSub('withdrawals')">💸 Withdrawals</button>
            <button class="tx-tab-btn ${sub === 'bets-casino' ? 'active' : ''}" data-tx-sub="bets-casino" onclick="navigateToTxSub('bets-casino')">🎲 Bets / Casino</button>
          </div>
          <div id="account-transactions-list">
            <div class="account-placeholder">Loading transactions...</div>
          </div>
        </div>
      </div>`;
  } else if (page === 'affiliates') {
    html = `
      <div class="account-hero">
        <div class="account-avatar">🤝</div>
        <div class="account-hero-info">
          <h1 class="account-username">Affiliates</h1>
          <span class="vip-badge vip-${vipText.toLowerCase()}">${escapeHTML(vipText)} VIP</span>
        </div>
      </div>
      <div class="account-details-grid">
        <div class="account-card" style="grid-column: 1 / -1;">
          <h3 class="account-card-title">Your Referral Link</h3>
          <div class="affiliate-link-box">
            <code id="affiliate-link-text">Loading...</code>
            <button class="btn-secondary-action" onclick="copyAffiliateLink()">Copy Link</button>
          </div>
          <div class="affiliate-code-box">
            <span class="detail-label">Referral Code</span>
            <code id="affiliate-code-text">Loading...</code>
            <button class="btn-secondary-action" onclick="copyAffiliateCode()">Copy Code</button>
          </div>
          <div class="affiliate-share-row">
            <a id="affiliate-share-twitter" class="btn-secondary-action" target="_blank" rel="noopener">Share on X</a>
            <a id="affiliate-share-telegram" class="btn-secondary-action" target="_blank" rel="noopener">Share on Telegram</a>
          </div>
        </div>

        <div class="account-card">
          <h3 class="account-card-title">Earnings Summary</h3>
          <div class="rewards-grid">
            <div class="reward-item"><span class="reward-label">From Deposits</span><span class="reward-value sc-val" id="aff-earnings-deposits">0.00 SC</span></div>
            <div class="reward-item"><span class="reward-label">From Wagers</span><span class="reward-value sc-val" id="aff-earnings-wagers">0.00 SC</span></div>
            <div class="reward-item"><span class="reward-label">Total Earned</span><span class="reward-value sc-val" id="aff-earnings-total">0.00 SC</span></div>
            <div class="reward-item"><span class="reward-label">Referred Users</span><span class="reward-value" id="aff-referred-count">0</span></div>
          </div>
        </div>

        <div class="account-card">
          <h3 class="account-card-title">How You Earn</h3>
          <div class="account-detail-list">
            <div class="account-detail-item"><span class="detail-label">Deposit commission</span><span class="detail-value" id="aff-rate-deposit">5%</span></div>
            <div class="account-detail-item"><span class="detail-label">Wager commission</span><span class="detail-value" id="aff-rate-wager">0.1%</span></div>
            <div class="account-detail-item"><span class="detail-label">Payout currency</span><span class="detail-value">Sweeps Coins (SC)</span></div>
            <div class="account-detail-item"><span class="detail-label">Credited</span><span class="detail-value">Automatically to your wallet</span></div>
          </div>
        </div>

        <div class="account-card">
          <h3 class="account-card-title">Referred Users</h3>
          <div id="affiliate-referred-list">
            <div class="account-placeholder">Loading...</div>
          </div>
        </div>

        <div class="account-card" style="grid-column: 1 / -1;">
          <h3 class="account-card-title">Recent Earnings</h3>
          <div id="affiliate-earnings-list">
            <div class="account-placeholder">Loading...</div>
          </div>
        </div>

        <div class="account-card" style="grid-column: 1 / -1;">
          <h3 class="account-card-title">Got a Referral Code?</h3>
          <p style="color:var(--text-secondary); margin-bottom:10px;">Enter a friend's referral code to attribute your account to them.</p>
          <div class="affiliate-apply-row">
            <input type="text" id="affiliate-input-code" class="form-input" placeholder="Enter referral code (e.g. PLAYER-AB12CD)">
            <button class="btn-play" onclick="applyAffiliateCode()">Apply Code</button>
          </div>
        </div>
      </div>`;
  } else if (page === 'security') {
    html = `
      <div class="account-hero">
        <div class="account-avatar">🔒</div>
        <div class="account-hero-info">
          <h1 class="account-username">Account Security</h1>
          <span class="vip-badge vip-${vipText.toLowerCase()}">${escapeHTML(vipText)} VIP</span>
        </div>
      </div>
      <div class="account-details-grid">
        <div class="account-card">
          <h3 class="account-card-title">Authentication</h3>
          <div class="account-detail-list">
            <div class="account-detail-item"><span class="detail-label">Email</span><span class="detail-value">${escapeHTML(p.email || '—')}</span></div>
            <div class="account-detail-item"><span class="detail-label">Password</span><span class="detail-value">••••••••</span></div>
            <div class="account-detail-item"><span class="detail-label">Two-factor</span><span class="detail-value">Coming soon</span></div>
          </div>
          <div class="security-actions">
            <button class="btn-security" onclick="openForgotPasswordModal()">🔑 Reset Password</button>
          </div>
        </div>
        <div class="account-card">
          <h3 class="account-card-title">Session</h3>
          <div class="security-actions">
            <button class="btn-security logout" onclick="logout()">🚪 Logout</button>
          </div>
        </div>
      </div>`;
  }

  content.innerHTML = html;
  if (page === 'transactions') {
    loadAccountTransactions(state.accountTxSub || 'deposits');
  }
  if (page === 'affiliates') {
    loadAffiliateData();
  }
}

async function startKycVerification() {
  try {
    const data = await apiRequest('/api/user/kyc/start', 'POST');
    if (data.personaConfig) {
      alert('KYC verification flow would open here. Status: ' + data.kycStatus + '. Sandbox mode: use /api/user/kyc/verify-sandbox to mark verified.');
    }
  } catch (err) {
    alert(err.message || 'Could not start KYC verification.');
  }
}

function showGuestVerificationAnimation() {
  // Reuse the shared modal-backdrop style: fixed, inset:0, dimmed +
  // backdrop-filter blur over the whole page, flexbox-centered. This makes the
  // "Identity Verified" popup land in the middle of the screen with a blurred
  // background on every page (not just the lobby) and auto-dismisses cleanly.
  let existing = document.getElementById('kyc-identity-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'kyc-identity-overlay';
  overlay.className = 'modal-backdrop';
  overlay.innerHTML =
    '<div class="modal-box identity-verify-box">' +
      '<div class="identity-verify-content" style="text-align:center;">' +
        '<div class="verification-step" style="margin:0 auto 16px;width:56px;height:56px;font-size:28px;">✓</div>' +
        '<div class="verification-text" style="font-size:1.4rem;">Identity Verified</div>' +
        '<div class="verification-subtext" style="margin-left:0;">Your identity has been successfully verified.</div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  // Hold the success, then fade out ("load out") and remove from the DOM.
  const DISPLAY_MS = 2200;
  const FADE_MS = 400;
  setTimeout(() => {
    overlay.style.transition = 'opacity ' + FADE_MS + 'ms ease, transform ' + FADE_MS + 'ms ease';
    overlay.style.opacity = '0';
    overlay.style.transform = 'scale(0.97)';
    setTimeout(() => overlay.remove(), FADE_MS);
  }, DISPLAY_MS);
}

async function loadAccountTransactions(sub = 'deposits') {
  const list = document.getElementById('account-transactions-list');
  if (!list) return;
  const endpoint = {
    deposits: '/api/user/transactions/deposits',
    withdrawals: '/api/user/transactions/withdrawals',
    'bets-casino': '/api/user/transactions/bets-casino'
  }[sub] || '/api/user/transactions/deposits';
  try {
    const data = await apiRequest(endpoint + '?limit=50');
    const txs = data.transactions || [];
    if (txs.length === 0) {
      list.innerHTML = '<div class="account-placeholder">No transactions found.</div>';
      return;
    }
    list.innerHTML = '<div class="tx-list">' + txs.map(tx => {
      const sign = (tx.scDelta || 0) > 0 ? '+' : '';
      const amt = Math.abs(tx.amount || tx.scDelta || tx.gcDelta || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const cur = tx.currency || (tx.scDelta ? 'SC' : (tx.gcDelta ? 'GC' : ''));
      return '<div class="tx-item">' +
        '<span class="tx-type">' + escapeHTML(tx.type) + '</span>' +
        '<div class="tx-row-meta">' +
        '  <span class="tx-desc">' + escapeHTML(tx.description || '') + '</span>' +
        '  <span class="tx-date">' + new Date(tx.timestamp).toLocaleString() + '</span>' +
        '</div>' +
        '<span class="tx-amount">' + sign + amt + ' ' + escapeHTML(cur) + '</span>' +
        '</div>';
    }).join('') + '</div>';
  } catch (err) {
    list.innerHTML = '<div class="account-placeholder">Failed to load transactions.</div>';
  }
}

function navigateToTxSub(sub) {
  state.accountTxSub = sub;
  document.querySelectorAll('.tx-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.txSub === sub);
  });
  if (window.location.pathname.startsWith('/account/transactions')) {
    history.replaceState(null, '', '/account/transactions/' + sub);
  } else {
    history.pushState(null, '', '/account/transactions/' + sub);
  }
  loadAccountTransactions(sub);
}

async function loadAffiliateData() {
  try {
    const data = await apiRequest('/api/affiliate/status');
    state.affiliate = data;

    const linkEl = document.getElementById('affiliate-link-text');
    const codeEl = document.getElementById('affiliate-code-text');
    if (linkEl) linkEl.textContent = data.referralLink;
    if (codeEl) codeEl.textContent = data.referralCode;

    const twBtn = document.getElementById('affiliate-share-twitter');
    const tgBtn = document.getElementById('affiliate-share-telegram');
    const text = encodeURIComponent('Join me on this casino — use my referral link!');
    if (twBtn) twBtn.href = `https://twitter.com/intent/tweet?text=${text}&url=${encodeURIComponent(data.referralLink)}`;
    if (tgBtn) tgBtn.href = `https://t.me/share/url?url=${encodeURIComponent(data.referralLink)}&text=${text}`;

    const depEl = document.getElementById('aff-earnings-deposits');
    const wagEl = document.getElementById('aff-earnings-wagers');
    const totEl = document.getElementById('aff-earnings-total');
    const refEl = document.getElementById('aff-referred-count');
    if (depEl) depEl.textContent = formatCoins(data.totals.deposits) + ' SC';
    if (wagEl) wagEl.textContent = formatCoins(data.totals.wagers) + ' SC';
    if (totEl) totEl.textContent = formatCoins(data.totals.total) + ' SC';
    if (refEl) refEl.textContent = data.referredCount;

    const rateDep = document.getElementById('aff-rate-deposit');
    const rateWag = document.getElementById('aff-rate-wager');
    if (rateDep) rateDep.textContent = data.rates.depositRatePct + '%';
    if (rateWag) rateWag.textContent = data.rates.wagerRatePct + '%';

    const referredList = document.getElementById('affiliate-referred-list');
    if (referredList) {
      if (!data.referredUsers || data.referredUsers.length === 0) {
        referredList.innerHTML = '<div class="account-placeholder">No referred users yet — share your code to start earning.</div>';
      } else {
        referredList.innerHTML = '<div class="tx-list">' + data.referredUsers.map(u => (
          '<div class="tx-item">' +
          '<span class="tx-type">REFERRED</span>' +
          '<div class="tx-row-meta">' +
          '  <span class="tx-desc">' + escapeHTML(u.username) + '</span>' +
          '  <span class="tx-date">' + new Date(u.referredAt).toLocaleDateString() + '</span>' +
          '</div>' +
          '</div>'
        )).join('') + '</div>';
      }
    }

    const earningsList = document.getElementById('affiliate-earnings-list');
    if (earningsList) {
      if (!data.recentEarnings || data.recentEarnings.length === 0) {
        earningsList.innerHTML = '<div class="account-placeholder">No earnings yet. Earnings appear as soon as your referrals deposit or wager.</div>';
      } else {
        earningsList.innerHTML = '<div class="tx-list">' + data.recentEarnings.map(e => (
          '<div class="tx-item">' +
          '<span class="tx-type">' + escapeHTML(e.source) + '</span>' +
          '<div class="tx-row-meta">' +
          '  <span class="tx-desc">From user #' + escapeHTML(String(e.referredUserId)) + '</span>' +
          '  <span class="tx-date">' + new Date(e.createdAt).toLocaleString() + '</span>' +
          '</div>' +
          '<span class="tx-amount sc-val">+' + formatCoins(e.amountSc) + ' SC</span>' +
          '</div>'
        )).join('') + '</div>';
      }
    }
  } catch (err) {
    console.error('[Affiliate] load failed:', err.message);
  }
}

function copyAffiliateLink() {
  const link = document.getElementById('affiliate-link-text')?.textContent;
  if (!link) return;
  navigator.clipboard.writeText(link).then(() => playSound('click') || alert('Referral link copied!'))
    .catch(() => alert('Link: ' + link));
}

function copyAffiliateCode() {
  const code = document.getElementById('affiliate-code-text')?.textContent;
  if (!code) return;
  navigator.clipboard.writeText(code).then(() => playSound('click') || alert('Referral code copied!'))
    .catch(() => alert('Code: ' + code));
}

async function applyAffiliateCode() {
  const input = document.getElementById('affiliate-input-code');
  if (!input) return;
  const code = input.value.trim();
  if (!code) return alert('Please enter a referral code.');
  try {
    const data = await apiRequest('/api/affiliate/apply', 'POST', { code });
    alert(data.message || 'Referral code applied.');
    input.value = '';
    loadAffiliateData();
  } catch (err) {
    alert(err.message || 'Failed to apply referral code.');
  }
}

function openProvablyFairModal() {
  playSound('click');
  const modal = document.getElementById('modal-pf');
  if (modal) {
    modal.classList.remove('hidden');
    const hashInput = document.getElementById('pf-modal-server-hash');
    if (hashInput) hashInput.value = state.serverSeedHash || 'Unverified';
    const clientInput = document.getElementById('pf-client-seed');
    if (clientInput) clientInput.value = state.clientSeed;
  }
}

function closeProvablyFairModal() {
  playSound('click');
  document.getElementById('modal-pf')?.classList.add('hidden');
}

function injectMobileAndNavigationDOM() {
  if (!document.getElementById('modal-auth')) {
    const authModal = document.createElement('div');
    authModal.id = 'modal-auth';
    authModal.className = 'modal-backdrop hidden';
    authModal.innerHTML = `
      <div class="modal-box auth-modal">
        <div class="modal-header-flex">
          <h3 id="auth-title">Login to Your Account</h3>
          <button class="x-close" onclick="closeAuthModal()">×</button>
        </div>
        <p class="modal-subtitle" id="auth-subtitle">Enter your credentials to access your account.</p>
        <div id="auth-form-login" class="auth-form-section">
          <div class="form-group">
            <label class="form-label">Email</label>
            <input type="email" id="auth-email" class="form-input" placeholder="you@example.com">
          </div>
          <div class="form-group">
            <label class="form-label">Password</label>
            <input type="password" id="auth-password" class="form-input" placeholder="••••••••">
          </div>
          <div id="auth-login-error" style="color:#ff4d4d; font-size:0.8rem; height:18px; margin-top:4px;"></div>
          <div class="modal-actions-flex" style="margin-top: 20px; flex-direction: column; gap: 8px;">
            <button type="button" onclick="submitLogin()" class="btn-play btn-full">LOGIN</button>
            <button type="button" onclick="switchAuthMode('register')" class="btn-secondary-action btn-full">Create New Account</button>
            <button type="button" onclick="continueAsGuest()" class="btn-secondary-action btn-full" style="font-size:0.8rem;">Continue as Guest</button>
          </div>
        </div>
         <div id="auth-form-register" class="auth-form-section hidden">
           <div class="form-group">
             <label class="form-label">Username</label>
             <input type="text" id="reg-username" class="form-input" placeholder="Choose a username">
           </div>
           <div class="form-group">
             <label class="form-label">Email</label>
             <input type="email" id="reg-email" class="form-input" placeholder="you@example.com">
           </div>
         <div class="form-group">
            <label class="form-label">Password</label>
            <input type="password" id="reg-password" class="form-input" placeholder="Min 8 characters">
          </div>
          <div class="form-group">
            <label class="form-label">Birth Date</label>
            <input type="date" id="reg-birthdate" class="form-input">
          </div>
          <div class="form-group">
            <label class="form-label">State</label>
            <select id="reg-state" class="form-input">
              <option value="CA">California</option>
              <option value="TX">Texas</option>
              <option value="FL">Florida</option>
              <option value="NY">New York</option>
              <option value="CO">Colorado</option>
              <option value="NC">North Carolina</option>
              <option value="OH">Ohio</option>
              <option value="PA">Pennsylvania</option>
              <option value="IL">Illinois</option>
              <option value="AZ">Arizona</option>
              <option value="MN">Minnesota</option>
              <option value="IA">Iowa</option>
              <option value="VA">Virginia</option>
              <option value="LA">Louisiana</option>
              <option value="MI" disabled>Michigan (Restricted)</option>
              <option value="NV" disabled>Nevada (Restricted)</option>
              <option value="WA" disabled>Washington (Restricted)</option>
              <option value="ID" disabled>Idaho (Restricted)</option>
              <option value="KY" disabled>Kentucky (Restricted)</option>
              <option value="GA" disabled>Georgia (Restricted)</option>
            </select>
          </div>
          <div id="auth-register-error" style="color:#ff4d4d; font-size:0.8rem; height:18px; margin-top:4px;"></div>
          <div class="modal-actions-flex" style="margin-top: 20px; flex-direction: column; gap: 8px;">
            <button type="button" onclick="submitRegister()" class="btn-play btn-full">REGISTER & PLAY</button>
            <button type="button" onclick="switchAuthMode('login')" class="btn-secondary-action btn-full">Back to Login</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(authModal);
  }

  if (!document.getElementById('modal-agegate')) {
    const agegate = document.createElement('div');
    agegate.id = 'modal-agegate';
    agegate.className = 'modal-backdrop hidden';
    agegate.innerHTML = `
      <div class="modal-box" style="max-width: 400px; text-align: center;">
        <div class="modal-header-flex">
          <h3>🔞 Age Verification</h3>
        </div>
        <p class="modal-subtitle">This casino contains gambling content and is restricted to adults 18 and older.</p>
        <div style="margin: 20px 0; padding: 16px; background:#14222d; border-radius:8px; border:1px solid #243542;">
          <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:0.9rem; color:#b1bad2;">
            <input type="checkbox" id="age-confirm" style="transform:scale(1.3); margin:0;">
            <span>I confirm I am 18 years of age or older</span>
          </label>
        </div>
        <div style="margin-top: 15px;">
          <button type="button" onclick="confirmAge()" class="btn-play btn-full">ENTER CASINO</button>
        </div>
      </div>`;
    document.body.appendChild(agegate);
  }

  if (!document.getElementById('modal-geo-restriction')) {
    const geoModal = document.createElement('div');
    geoModal.id = 'modal-geo-restriction';
    geoModal.className = 'modal-backdrop hidden';
    geoModal.innerHTML = `
      <div class="modal-box" style="max-width: 400px; text-align: center;">
        <div class="modal-header-flex">
          <h3>🌍 Jurisdiction Restricted</h3>
        </div>
        <p class="modal-subtitle">Sweepstakes play is unavailable in your jurisdiction.</p>
        <p id="geo-restriction-details" style="color:#e57373; margin:10px 0;"></p>
        <p style="font-size:0.85rem; color:#b1bad2; margin-top:10px;">
          If you believe this is an error, please contact support or disable any VPN/proxy services.
        </p>
        <div style="margin-top: 15px;">
          <button type="button" onclick="location.reload()" class="btn-secondary-action btn-full">Refresh</button>
        </div>
      </div>`;
    document.body.appendChild(geoModal);
  }

  if (!document.getElementById('modal-forgot-password')) {
    const forgotModal = document.createElement('div');
    forgotModal.id = 'modal-forgot-password';
    forgotModal.className = 'modal-backdrop hidden';
    forgotModal.innerHTML = `
      <div class="modal-box" style="max-width: 400px;">
        <div class="modal-header-flex">
          <h3>🔑 Reset Password</h3>
          <button class="x-close" onclick="closeForgotPasswordModal()">×</button>
        </div>
        <p class="modal-subtitle">Enter your email to receive a password reset link.</p>
        <div class="form-group">
          <label class="form-label">Email</label>
          <input type="email" id="forgot-email" class="form-input" placeholder="you@example.com">
        </div>
        <div id="forgot-error" style="color:#ff4d4d; font-size:0.8rem; height:18px; margin-top:4px;"></div>
        <div class="modal-actions-flex" style="margin-top:20px;">
          <button type="button" onclick="submitForgotPassword()" class="btn-play btn-full">SEND RESET LINK</button>
          <button type="button" onclick="closeForgotPasswordModal()" class="btn-secondary-action btn-full">Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(forgotModal);
  }
}

function openBonusModal() {
  playSound('click');
  history.pushState(null, '', '/bonus');
  handleRouteChange();
}

function closeBonusModal() {
  playSound('click');
  history.pushState(null, '', '/');
  handleRouteChange();
}

function openForgotPasswordModal() {
  playSound('click');
  document.getElementById('modal-forgot-password')?.classList.remove('hidden');
}

function closeForgotPasswordModal() {
  playSound('click');
  document.getElementById('modal-forgot-password')?.classList.add('hidden');
}

async function submitForgotPassword() {
  const email = document.getElementById('forgot-email')?.value.trim();
  const errorEl = document.getElementById('forgot-error');
  if (!email) {
    if (errorEl) errorEl.textContent = 'Email is required.';
    return;
  }
  try {
    const data = await apiRequest('/api/auth/forgot-password', 'POST', { email });
    if (data.success) {
      if (errorEl) errorEl.textContent = '';
      alert(data.message);
      closeForgotPasswordModal();
    }
  } catch (err) {
    if (errorEl) errorEl.textContent = err.message || 'Failed to send reset link.';
  }
}

async function loadDailyBonusPage() {
  const container = document.getElementById('view-bonus');
  if (!container) return;
  container.innerHTML = '<div class="page-container"><div class="page-loading"><div class="checkout-spinner"></div><span>Loading daily bonus...</span></div></div>';

  try {
    const bonusStatus = await apiRequest('/api/bonus/status').catch(() => null);
    const streak = bonusStatus?.streak || 0;
    const canClaim = bonusStatus?.canClaim || false;
    const nextClaimMs = bonusStatus?.nextClaimMs || 0;

const milestones = [
      { day: 1,  reward: '1 SC',  note: 'Day 1' },
      { day: 3,  reward: '3 SC',  note: 'Hot streak' },
      { day: 7,  reward: '7 SC',  note: 'Weekly' },
      { day: 14, reward: '15 SC', note: 'Two-week' },
      { day: 30, reward: '40 SC', note: 'Monthly' }
    ];

    const nextMilestone = milestones.find(m => m.day > streak) || milestones[milestones.length - 1];
    const rewardGCRange = '1,000 GC';
    const rewardSCRange = '1.00 SC';

    container.innerHTML = `
      <div class="page-container promo-page">
        <div class="page-header">
          <button class="btn-back" onclick="showLobby()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
            <span>Back to Lobby</span>
          </button>
          <h2 class="page-title">🎁 Daily Bonus</h2>
        </div>

        <div class="promo-hero promo-hero-bonus">
          <div class="promo-hero-bg"></div>
          <div class="promo-hero-content">
            <div class="promo-hero-icon">🎁</div>
            <div class="promo-hero-text">
              <h3 class="promo-hero-title">Daily Rewards</h3>
              <p class="promo-hero-sub">Log in every day to build your streak and unlock bigger rewards.</p>
            </div>
            <div class="promo-hero-streak">
              <div class="streak-fire">🔥</div>
              <div class="streak-num">${streak}</div>
              <div class="streak-cap">DAY STREAK</div>
            </div>
          </div>
        </div>

        <div class="promo-card claim-card">
          <div class="claim-card-header">
            <span class="claim-card-tag">TODAY'S REWARD</span>
            <span class="claim-card-streak">Streak ${streak} days</span>
          </div>
          <div class="claim-rewards">
            <div class="claim-reward-block gc">
              <div class="claim-reward-amount">${rewardGCRange}</div>
              <div class="claim-reward-label">Gold Coins</div>
            </div>
            <div class="claim-reward-plus">+</div>
            <div class="claim-reward-block sc">
              <div class="claim-reward-amount">${rewardSCRange}</div>
              <div class="claim-reward-label">Sweeps Coins</div>
            </div>
          </div>
          <div class="claim-card-footer">
            ${canClaim
              ? '<button type="button" class="btn-claim-main" onclick="claimDaily()">🎁 Claim Daily Bonus</button>'
              : '<div class="claim-locked"><span class="lock-icon">⏱️</span><div><div class="lock-title">Next bonus in</div><div class="countdown-timer" id="daily-countdown">' + formatCountdown(nextClaimMs) + '</div></div></div>'}
          </div>
        </div>

        <div class="promo-section">
          <div class="promo-section-header">
            <h3 class="promo-section-title">Streak Milestones</h3>
            <div class="promo-section-line"></div>
          </div>
          <div class="milestone-grid">
            ${milestones.map(m => {
              const achieved = streak >= m.day;
              const isNext = !achieved && m.day === nextMilestone.day;
              return `
                <div class="milestone-tile ${achieved ? 'achieved' : ''} ${isNext ? 'next' : ''}">
                  <div class="milestone-day">Day ${m.day}</div>
                  <div class="milestone-reward">${m.reward}</div>
                  <div class="milestone-note">${m.note}</div>
                  <div class="milestone-mark">${achieved ? '✓' : isNext ? '★' : ''}</div>
                </div>`;
            }).join('')}
          </div>
        </div>

        <div class="promo-tip">
          <span class="tip-icon">💡</span>
          <span>Tip: Missing a day resets your streak to 1 — set a reminder to keep it growing!</span>
        </div>
      </div>`;

    if (!canClaim && nextClaimMs > 0) {
      startCountdown('daily-countdown', nextClaimMs, 0);
    }
  } catch (err) {
    container.innerHTML = '<div class="page-container"><div class="page-error">Failed to load daily bonus: ' + escapeHTML(err.message) + '</div></div>';
  }
}

async function loadChallengesPage() {
  const container = document.getElementById('view-challenges');
  if (!container) return;
  container.innerHTML = '<div class="page-container"><div class="page-loading"><div class="checkout-spinner"></div><span>Loading challenges...</span></div></div>';

  try {
    const challenges = await apiRequest('/api/challenges').catch(() => null);
    const taskIcons = {
      slot_bonus: '🎰',
      dice_over90_win: '🎲',
      dice_under10_win: '🎲',
      dice_exact_50: '🎯',
      dice_rounds: '🎲',
      crash_2x_count: '💥',
      crash_5x_count: '💥',
      crash_10x_count: '💥',
      crash_snipe: '💥',
      rounds: '🎮',
      win_streak: '🔥',
      hit_multiplier: '⚡',
      sc_net_profit: '📈',
      single_round_win: '💎',
      bj_natural: '♠️',
      bj_double_win: '🃏',
      bj_dealer_bust: '♠️',
      bj_hands: '♠️',
      mines_tiles: '💣',
      mines_hard_win: '💣',
      plinko_outer: '⚪',
      sc_wagered: '💎',
      gc_wagered: '🪙',
      unique_games: '🎯',
      unique_wins: '🏆',
      speed_rounds: '⚡'
    };

    const list = (challenges && challenges.challenges) || [];
    const completedCount = list.filter(c => c.completed).length;
    const claimedCount = list.filter(c => c.claimed).length;
    const totalRewardMax = list.reduce((s, c) => s + (c.maxReward || 0), 0);

    container.innerHTML = `
      <div class="page-container promo-page">
        <div class="page-header">
          <button class="btn-back" onclick="showLobby()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
            <span>Back to Lobby</span>
          </button>
          <h2 class="page-title">🎯 Challenges</h2>
        </div>

        <div class="promo-hero promo-hero-challenges">
          <div class="promo-hero-bg"></div>
          <div class="promo-hero-content">
            <div class="promo-hero-icon">🎯</div>
            <div class="promo-hero-text">
              <h3 class="promo-hero-title">Daily Challenges</h3>
              <p class="promo-hero-sub">Complete challenges to bank up to <strong>${formatCoins(totalRewardMax)} SC</strong> per day. New challenges every 24 hours.</p>
            </div>
            <div class="promo-hero-stats">
              <div class="hero-stat"><div class="hero-stat-num">${claimedCount}/${list.length}</div><div class="hero-stat-cap">CLAIMED</div></div>
              <div class="hero-stat"><div class="hero-stat-num">${completedCount}</div><div class="hero-stat-cap">READY</div></div>
            </div>
          </div>
        </div>

        <div class="promo-section">
          <div class="promo-section-header">
            <h3 class="promo-section-title">Today's Challenges</h3>
            <div class="promo-section-line"></div>
          </div>
          <div class="challenge-grid">
            ${list.length === 0 ? '<div class="no-challenges-card">No challenges available right now. Check back later!</div>' : list.map(c => {
              const pct = Math.min(100, (c.progress / c.target) * 100);
              const isComplete = c.completed && !c.claimed;
              const isClaimed = c.claimed;
              const rewardTier = c.maxReward >= 10 ? 'high' : c.maxReward >= 5 ? 'medium' : 'low';
              const icon = taskIcons[c.task] || '🎯';
              return `
                <div class="challenge-card-new tier-${rewardTier} ${isComplete ? 'is-complete' : ''} ${isClaimed ? 'is-claimed' : ''}">
                  <div class="challenge-card-top">
                    <div class="challenge-icon-new">${icon}</div>
                    <div class="challenge-card-meta">
                      <div class="challenge-tier-tag tier-tag-${rewardTier}">${rewardTier.toUpperCase()}</div>
                      <h4 class="challenge-title-new">${escapeHTML(c.desc)}</h4>
                    </div>
                    ${isClaimed ? '<div class="challenge-claimed-mark">✓</div>' : ''}
                  </div>
                  <div class="challenge-progress-new">
                    <div class="progress-bar-new"><div class="progress-fill-new" style="width:${pct}%"></div></div>
                    <div class="progress-text-new"><strong>${c.progress}</strong> / ${c.target}</div>
                  </div>
                  <div class="challenge-card-foot">
                    <div class="challenge-reward-pill">
                      <span class="pill-icon">💎</span>
                      <span class="pill-text">${formatCoins(c.minReward)} – ${formatCoins(c.maxReward)} SC</span>
                    </div>
                    ${isComplete
                      ? `<button type="button" class="btn-challenge-claim" onclick="claimChallenge('${c.id}')">Claim ${formatCoins(calcChallengeRewardDisplay(c))} SC</button>`
                      : isClaimed
                        ? '<span class="challenge-claimed-pill">✓ Claimed</span>'
                        : '<span class="challenge-inprogress">Keep playing</span>'}
                  </div>
                </div>`;
            }).join('')}
          </div>
        </div>
      </div>`;
  } catch (err) {
    container.innerHTML = '<div class="page-container"><div class="page-error">Failed to load challenges: ' + escapeHTML(err.message) + '</div></div>';
  }
}

function calcChallengeRewardDisplay(c) {
  return ((c.minReward + c.maxReward) / 2).toFixed(1);
}

async function loadRakebackPage() {
  const container = document.getElementById('view-rakeback');
  if (!container) return;
  container.innerHTML = '<div class="page-container"><div class="page-loading"><div class="checkout-spinner"></div><span>Loading rakeback...</span></div></div>';

  try {
    const rakeback = await apiRequest('/api/rakeback/status').catch(() => null);
    const tiers = (rakeback && rakeback.rakeback) || {};
    const tierMeta = {
      daily:   { label: 'Daily',   icon: '📅', accent: 'cyan',   period: 'Refreshes every 24 hours' },
      weekly:  { label: 'Weekly',  icon: '📆', accent: 'purple', period: 'Refreshes every 7 days' },
      monthly: { label: 'Monthly', icon: '📈', accent: 'gold',   period: 'Refreshes every 30 days' }
    };
    const totalClaimable = Object.values(tiers).reduce((s, r) => s + (r.claimable || 0), 0);
    const totalTracked = Object.values(tiers).reduce((s, r) => s + (r.lossTracked || 0), 0);

    container.innerHTML = `
      <div class="page-container promo-page">
        <div class="page-header">
          <button class="btn-back" onclick="showLobby()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
            <span>Back to Lobby</span>
          </button>
          <h2 class="page-title">💎 Rakeback</h2>
        </div>

        <div class="promo-hero promo-hero-rakeback">
          <div class="promo-hero-bg"></div>
          <div class="promo-hero-content">
            <div class="promo-hero-icon">💎</div>
            <div class="promo-hero-text">
              <h3 class="promo-hero-title">Cashback on Every Bet</h3>
              <p class="promo-hero-sub">We track your net losses and give back <strong>3%–10%</strong> as Sweeps Coins. Capped at 50% of losses so the house always has the edge — but you always get a slice back.</p>
            </div>
            <div class="promo-hero-stats">
              <div class="hero-stat"><div class="hero-stat-num sc-val">${formatCoins(totalClaimable)}</div><div class="hero-stat-cap">CLAIMABLE</div></div>
              <div class="hero-stat"><div class="hero-stat-num">${formatCoins(totalTracked)}</div><div class="hero-stat-cap">TRACKED</div></div>
            </div>
          </div>
        </div>

        <div class="promo-section">
          <div class="promo-section-header">
            <h3 class="promo-section-title">Rakeback Tiers</h3>
            <div class="promo-section-line"></div>
          </div>
          <div class="rakeback-grid">
            ${Object.keys(tierMeta).map(tierKey => {
              const r = tiers[tierKey] || {};
              const meta = tierMeta[tierKey];
              const pct = r.lossTracked > 0 ? Math.min(100, ((r.claimable || 0) / (r.lossTracked * 0.5 || 1)) * 100) : 0;
              return `
                <div class="rakeback-card-new accent-${meta.accent}">
                  <div class="rakeback-card-top">
                    <div class="rakeback-card-icon">${meta.icon}</div>
                    <div class="rakeback-card-meta">
                      <div class="rakeback-card-label">${meta.label}</div>
                      <div class="rakeback-card-period">${meta.period}</div>
                    </div>
                    <div class="rakeback-claimable-badge">
                      <span class="badge-cap">CLAIMABLE</span>
                      <span class="badge-amount">${formatCoins(r.claimable || 0)} SC</span>
                    </div>
                  </div>
                  <div class="rakeback-stats-row">
                    <div class="rakeback-stat">
                      <span class="rs-cap">Losses Tracked</span>
                      <span class="rs-val">${formatCoins(r.lossTracked || 0)} SC</span>
                    </div>
                    <div class="rakeback-stat">
                      <span class="rs-cap">Rate Range</span>
                      <span class="rs-val">${r.rateMin || 3}% – ${r.rateMax || 10}%</span>
                    </div>
                  </div>
                  <div class="rakeback-progress-new">
                    <div class="progress-bar-new"><div class="progress-fill-new" style="width:${pct}%"></div></div>
                  </div>
                  <div class="rakeback-card-foot">
                    ${r.canClaim && r.claimable > 0
                      ? `<button type="button" class="btn-rake-claim" onclick="claimRakeback('${tierKey}')">Claim ${formatCoins(r.claimable)} SC</button>`
                      : !r.canClaim && r.claimable > 0
                        ? `<div class="rakeback-countdown"><span>⏱</span><span class="countdown-timer" id="rakeback-countdown-${tierKey}">${formatCountdown(r.nextClaimMs || 0)}</span></div>`
                        : '<span class="rakeback-empty">Play some SC games to start tracking losses.</span>'}
                  </div>
                </div>`;
            }).join('')}
          </div>
        </div>

        <div class="promo-tip">
          <span class="tip-icon">💡</span>
          <span>Tip: Higher VIP tiers unlock bigger rakeback caps. Keep climbing!</span>
        </div>
      </div>`;

    Object.entries(tiers).forEach(([tier, r]) => {
      if (r.nextClaimMs > 0 && !r.canClaim) {
        startCountdown('rakeback-countdown-' + tier, r.nextClaimMs, 0);
      }
    });
  } catch (err) {
    container.innerHTML = '<div class="page-container"><div class="page-error">Failed to load rakeback: ' + escapeHTML(err.message) + '</div></div>';
  }
}

async function loadBonusContent() {
  const container = document.getElementById('view-bonus');
  if (!container) return;
  try {
    await loadDailyBonusPage();
  } catch (err) {
    container.innerHTML = '<div class="page-container"><div style="padding:40px;text-align:center;color:#ff4d4d;">Failed to load bonus data: ' + err.message + '</div></div>';
  }
}

function formatCountdown(ms) {
  if (ms <= 0) return '00:00:00';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return pad2(h) + ':' + pad2(m) + ':' + pad2(s);
}

function pad2(n) { return n < 10 ? '0' + n : n; }

function startCountdown(elemId, ms, fallback) {
  let remaining = ms;
  const el = document.getElementById(elemId);
  if (!el) return;
  el.textContent = formatCountdown(remaining);
  const interval = setInterval(() => {
    remaining -= 1000;
    if (remaining <= 0) {
      clearInterval(interval);
      el.textContent = formatCountdown(0);
      el.innerHTML = '<span style="color:#00e701;font-weight:700;">READY!</span>';
    } else {
      el.textContent = formatCountdown(remaining);
    }
  }, 1000);
}

function hexToRgb(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  return parseInt(hex.slice(0,2),16) + ',' + parseInt(hex.slice(2,4),16) + ',' + parseInt(hex.slice(4,6),16);
}

async function claimDaily() {
  playSound('chip');
  try {
    const data = await apiRequest('/api/bonus/daily-claim', 'POST');
    if (data.success) {
      state.balances = mergeBalances(data.balances);
      updateWalletUI();
      playSound('win');
      loadBonusContent();
    }
  } catch (err) {
    alert(err.message || 'Daily claim failed');
  }
}

async function claimChallenge(challengeId) {
  playSound('chip');
  try {
    const data = await apiRequest('/api/challenges/claim', 'POST', { challengeId });
    if (data.success) {
      state.balances = mergeBalances(data.balances);
      updateWalletUI();
      playSound('win');
      loadChallengesPage();
    }
  } catch (err) {
    alert(err.message || 'Challenge claim failed');
  }
}

async function claimRakeback(tier) {
  playSound('chip');
  try {
    const data = await apiRequest('/api/rakeback/claim', 'POST', { tier });
    if (data.success) {
      state.balances = mergeBalances(data.balances);
      updateWalletUI();
      playSound('win');
      loadRakebackPage();
    }
  } catch (err) {
    alert(err.message || 'Rakeback claim failed');
  }
}
// ==========================================================================

function showGeoRestrictionModal(err) {
  const modal = document.getElementById('modal-geo-restriction');
  if (!modal) return;
  const details = document.getElementById('geo-restriction-details');
  if (details) {
    const state = err.data?.geo?.state || 'your state';
    const country = err.data?.geo?.country || 'your country';
    const reason = err.data?.geo?.isVpn ? 'VPN or proxy detected' : `Location: ${state}, ${country}`;
    details.textContent = `${err.error} (${reason})`;
  }
  modal.classList.remove('hidden');
}

function confirmAge() {
  const checkbox = document.getElementById('age-confirm');
  if (!checkbox || !checkbox.checked) {
    return alert('You must confirm you are 18 or older to enter.');
  }
  localStorage.setItem('casino_age_confirmed', 'true');
  const ag = document.getElementById('modal-agegate');
  if (ag) ag.classList.add('hidden');
  playSound('win');
  openAuthModal();
}

function openAuthModal() {
  const loginErr = document.getElementById('auth-login-error');
  if (loginErr) loginErr.textContent = '';
  const regErr = document.getElementById('auth-register-error');
  if (regErr) regErr.textContent = '';
  const loginForm = document.getElementById('auth-form-login');
  const registerForm = document.getElementById('auth-form-register');
  const authTitle = document.getElementById('auth-title');
  const authSubtitle = document.getElementById('auth-subtitle');

  if (loginForm) loginForm.classList.remove('hidden');
  if (registerForm) registerForm.classList.add('hidden');
  if (authTitle) authTitle.textContent = 'Login to Your Account';
  if (authSubtitle) authSubtitle.textContent = 'Enter your credentials to access your account.';
  document.getElementById('modal-auth')?.classList.remove('hidden');
}

function closeAuthModal() {
  document.getElementById('modal-auth')?.classList.add('hidden');
}

function switchAuthMode(mode) {
  const loginForm = document.getElementById('auth-form-login');
  const registerForm = document.getElementById('auth-form-register');
  const authTitle = document.getElementById('auth-title');
  const authSubtitle = document.getElementById('auth-subtitle');

  if (!loginForm || !registerForm) return;

  if (mode === 'register') {
    loginForm.classList.add('hidden');
    registerForm.classList.remove('hidden');
    if (authTitle) authTitle.textContent = 'Create New Account';
    if (authSubtitle) authSubtitle.textContent = 'Register to unlock full features and higher limits.';
  } else {
    loginForm.classList.remove('hidden');
    registerForm.classList.add('hidden');
    if (authTitle) authTitle.textContent = 'Login to Your Account';
    if (authSubtitle) authSubtitle.textContent = 'Enter your credentials to access your account.';
  }
}

async function submitLogin() {
  const email = document.getElementById('auth-email')?.value.trim();
  const password = document.getElementById('auth-password')?.value;
  const errorEl = document.getElementById('auth-login-error');

  if (!email || !password) {
    if (errorEl) errorEl.textContent = 'Email and password are required.';
    return;
  }

  try {
     const data = await apiRequest('/api/auth/login', 'POST', { email, password });
    localStorage.setItem('casino_token', data.token);
    state.profile = data.user || { id: null, username: '', email, isGuest: false };
    state.balances = mergeBalances(data.balances);
    localStorage.setItem('casino_username', data.user?.username || '');
    updateUserProfileBadge();
    closeAuthModal();
    await initSessionFromToken();
  } catch (err) {
    if (err.geoRestricted) {
      showGeoRestrictionModal(err);
    } else if (errorEl) {
      errorEl.textContent = err.message || 'Login failed.';
    }
  }
}

async function submitRegister() {
  const username = document.getElementById('reg-username')?.value.trim();
  const email = document.getElementById('reg-email')?.value.trim();
  const password = document.getElementById('reg-password')?.value;
  const birthDate = document.getElementById('reg-birthdate')?.value;
  const userState = document.getElementById('reg-state')?.value || state.detectedState || 'CA';
  const errorEl = document.getElementById('auth-register-error');

  if (!username || !email || !password) {
    if (errorEl) errorEl.textContent = 'All fields are required.';
    return;
  }
  if (password.length < 8) {
    if (errorEl) errorEl.textContent = 'Password must be at least 8 characters.';
    return;
  }
  if (!birthDate) {
    if (errorEl) errorEl.textContent = 'Birth date is required for age verification.';
    return;
  }

  const birth = new Date(birthDate);
  const ageMs = Date.now() - birth.getTime();
  if (ageMs < 18 * 365.25 * 24 * 60 * 60 * 1000 || birth > new Date()) {
    if (errorEl) errorEl.textContent = 'You must be at least 18 years old to register.';
    return;
  }

  if (RESTRICTED_STATES.includes(userState)) {
    if (errorEl) errorEl.textContent = `Online gaming is not available in ${userState}.`;
    return;
  }

   try {
    const refCode = new URLSearchParams(window.location.search).get('ref');
    const data = await apiRequest('/api/auth/register', 'POST', { username, email, password, birthDate, state: userState, ref: refCode });
    localStorage.setItem('casino_token', data.token);
    state.profile = data.user || { id: null, username, email, isGuest: false };
    state.balances = mergeBalances(data.balances);
    localStorage.setItem('casino_username', data.user?.username || '');
    updateUserProfileBadge();
    closeAuthModal();
    await initSessionFromToken();
   } catch (err) {
    if (err.geoRestricted) {
      showGeoRestrictionModal(err);
    } else if (errorEl) {
      errorEl.textContent = err.message || 'Registration failed.';
    }
  }
}

async function continueAsGuest() {
  const existingToken = localStorage.getItem('casino_token');
  if (existingToken && state.profile && state.profile.isGuest) {
    return;
  }
  if (existingToken) {
    localStorage.removeItem('casino_token');
    localStorage.removeItem('casino_username');
  }
  try {
    const refCode = new URLSearchParams(window.location.search).get('ref');
    const data = await apiRequest('/api/auth/guest', 'POST', refCode ? { ref: refCode } : {});
    if (data.token) {
      localStorage.setItem('casino_token', data.token);
      state.profile = data.user || null;
      if (data.user && data.user.username) {
        localStorage.setItem('casino_username', data.user.username);
      }
      state.balances = mergeBalances(data.balances);
      if (data.user && data.user.kyc && data.user.kyc.status === 'VERIFIED') {
        showGuestVerificationAnimation();
      }
    }
  } catch (err) {
    if (err.geoRestricted) {
      showGeoRestrictionModal(err);
      return;
    }
    console.warn('[Guest Fallback]:', err.message);
    openAuthModal();
    return;
  }
  closeAuthModal();
  await initSessionFromToken();
  reapplyCurrentRoute();
}

async function initSessionFromToken() {
  try {
    if (!state.geoDetected) {
      await detectGeoLocation();
    }
    await fetchFairSeed();
    const data = await apiRequest('/api/user/me');
    if (data.balances) state.balances = mergeBalances(data.balances);
    if (data.flags) state.flags = data.flags;
    if (data.username) state.profile = data;
  } catch (err) {
    if (err.geoRestricted) {
      showGeoRestrictionModal(err);
      return;
    }
    if (err && (err.status === 401 || err.status === 403 || err.status === 404)) {
      console.warn('[initSessionFromToken]: Token rejected (HTTP ' + err.status + '), clearing.', err.message);
      localStorage.removeItem('casino_token');
      localStorage.removeItem('casino_username');
      openAuthModal();
      return;
    } else {
      console.warn('[initSessionFromToken]: Transient error, keeping token:', (err && err.message) || err);
    }
  }
  updateWalletUI();
  setupGlobalEventListeners();
  initScrollReveal();
  initHeroParticles();
  initProvablyFairUI();
  if (!state.ws || (state.ws.readyState !== WebSocket.OPEN && state.ws.readyState !== WebSocket.CONNECTING)) {
    connectWebSocket();
  }
  if (!document.getElementById('modal-auth')) {
    injectMobileAndNavigationDOM();
  }
  applyEmbeddedModeRestrictions();
  updateUserProfileBadge();
}

// One-shot re-render of the initial route after the session loads, so deep-linked
// pages (e.g. /account/wallet) render with populated profile/balances instead of
// a blank shell. Skips game views (already rendered at module load).
function reapplyCurrentRoute() {
  if (state.bootRouted) return;
  state.bootRouted = true;
  const path = window.location.pathname;
  const gameIds = ['wheel','baccarat','dice','crash','slots','plinko','keno','tower','mines','blackjack','hilo','limbo'];
  const gameId = path.startsWith('/') ? path.slice(1) : path;
  if (gameIds.includes(gameId)) return;
  handleRouteChange();
}

function updateSidebarUserCard() {
  const p = state.profile || {};
  const vipText = (p.vip && p.vip.tier) || 'Bronze';
  const username = p.username || localStorage.getItem('casino_username') || 'Guest';
  const isGuest = !!(p.isGuest || (p.email && p.email.endsWith('@guest.casino')));
  const nameEl = document.getElementById('sidebar-username');
  const cardEl = document.querySelector('.sidebar-user-card');
  if (nameEl) nameEl.textContent = username;
  if (cardEl) {
    const tierEl = cardEl.querySelector('.user-tier');
    const avatarEl = cardEl.querySelector('.avatar-emoji');
    if (tierEl) tierEl.textContent = (vipText || 'Bronze') + ' VIP' + (isGuest ? ' · Guest' : '');
    if (avatarEl) avatarEl.textContent = (username && username !== 'Guest') ? username.charAt(0).toUpperCase() : '👤';
  }
}

function updateUserProfileBadge() {
  updateSidebarUserCard();
  const badge = document.getElementById('user-badge');
  if (!badge) return;
  const username = state.profile?.username || localStorage.getItem('casino_username') || 'Guest';
  const firstChar = username.charAt(0) || '👤';
  badge.title = username + ' — Profile & Settings';
  const avatar = badge.querySelector('.avatar-circle');
  if (avatar) avatar.textContent = firstChar.toUpperCase();
  syncProfileDropdownHeader();
}

function logout() {
  localStorage.removeItem('casino_token');
  localStorage.removeItem('casino_username');
  state.profile = null;
  state.balances = { gc: 10000.0, sc: 10.0 };
  state.wsReconnectAttempts = 0;
  state.wsReconnectGaveUp = false;
  updateWalletUI();
  updateUserProfileBadge();
  state.ws?.close();
  state.ws = null;
  openAuthModal();
}

// ==========================================================================
// 12. UTILITIES & EVENT BINDINGS
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

  const sidebarToggle = document.getElementById('sidebar-toggle');
  const sidebarOverlay = document.getElementById('sidebar-overlay');
  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', () => {
      const sidebar = document.getElementById('main-sidebar');
      if (sidebar) {
        sidebar.classList.toggle('mobile-open');
        sidebar.classList.toggle('active');
      }
      if (sidebarOverlay) sidebarOverlay.classList.toggle('active');
    });
  }
  if (sidebarOverlay) {
    sidebarOverlay.addEventListener('click', () => {
      const sidebar = document.getElementById('main-sidebar');
      sidebar?.classList.remove('mobile-open', 'active');
      sidebarOverlay.classList.remove('active');
    });
  }

  document.addEventListener('click', (e) => {
    const walletContainer = document.querySelector('.wallet-selector');
    if (walletContainer && !walletContainer.contains(e.target)) {
      closeWalletDropdown();
    }
    const profileContainer = document.getElementById('user-badge-wrapper');
    if (profileContainer && !profileContainer.contains(e.target)) {
      closeProfileDropdown();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeWalletDropdown();
      closeProfileDropdown();
    }
  });
}

window.addEventListener('DOMContentLoaded', () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
  initSession();
});
['click', 'touchstart', 'keydown'].forEach(evt => {
  window.addEventListener(evt, initAudioContext, { once: true });
});

// ==========================================================================
// 13. SCROLL REVEAL & HERO PARTICLES
// ==========================================================================

function initScrollReveal() {
  const observerOptions = {
    root: null,
    rootMargin: '0px 0px -80px 0px',
    threshold: 0.1
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('active');
        observer.unobserve(entry.target);
      }
    });
  }, observerOptions);

  document.querySelectorAll('.game-card, .featured-card, .section-header, .live-stats-bar').forEach(el => {
    el.classList.add('reveal');
    observer.observe(el);
  });
}

function initHeroParticles() {
  const container = document.getElementById('hero-particles');
  if (!container) return;

  container.innerHTML = ''; // Clear any existing particles to avoid duplicates

  const particleCount = 20;
  const colors = ['#00ff41', '#ffd700', '#00b4ff', '#a855f7', '#ff8c00'];

  for (let i = 0; i < particleCount; i++) {
    const particle = document.createElement('div');
    particle.className = 'hero-particle';
    particle.style.left = Math.random() * 100 + '%';
    particle.style.top = Math.random() * 100 + '%';
    particle.style.background = colors[Math.floor(Math.random() * colors.length)];
    particle.style.animationDelay = Math.random() * 6 + 's';
    particle.style.animationDuration = (4 + Math.random() * 4) + 's';
    particle.style.width = (2 + Math.random() * 4) + 'px';
    particle.style.height = particle.style.width;
    container.appendChild(particle);
  }
}

function routeViewForPath(path) {
  if (path === '/account' || path.startsWith('/account/')) return 'view-account';
  if (path === '/bonus') return 'view-bonus';
  if (path === '/challenges') return 'view-challenges';
  if (path === '/rakeback') return 'view-rakeback';
  return null;
}

function handleRouteChange() {
  closeProfileDropdown();
  closeWalletDropdown();
  const path = window.location.pathname;
  setActiveSidebarLink(path);

  // Hybrid pages: if navigating to a dedicated page whose view is not present in
  // this shell (e.g. switching between lightweight server-rendered pages), do a
  // full navigation so the server returns that page's own markup.
  const requiredView = routeViewForPath(path);
  if (requiredView && !document.getElementById(requiredView)) {
    window.location.href = path;
    return;
  }

  const gameIds = ['wheel','baccarat','dice','crash','slots','plinko','keno','tower','mines','blackjack','hilo','limbo'];
  const gameId = path.startsWith('/') ? path.slice(1) : path;
  if (gameIds.includes(gameId)) {
    if (state.currentGame !== gameId) launchGame(gameId);
    return;
  }

  const hash = window.location.hash.slice(1);
  if (hash && gameIds.includes(hash)) {
    if (state.currentGame !== hash) launchGame(hash);
    return;
  }

  document.querySelector('.main-layout')?.classList.remove('is-game');
  state.currentGame = null;
  closeGlobalFeed();

  if (path === '/account' || path.startsWith('/account/')) {
    hideAllViews();
    document.getElementById('view-account')?.classList.remove('hidden');
    let page = 'overview';
    if (path.startsWith('/account/transactions/')) {
      page = 'transactions';
      const sub = path.replace('/account/transactions/', '');
      if (['deposits', 'withdrawals', 'bets-casino'].includes(sub)) {
        state.accountTxSub = sub;
      }
    } else if (path === '/account/affiliates') {
      page = 'affiliates';
    } else if (path === '/account/profile') {
      page = 'profile';
    } else if (path === '/account/wallet') {
      page = 'wallet';
    } else if (path === '/account/kyc') {
      page = 'kyc';
    } else if (path === '/account/security') {
      page = 'security';
    } else if (path === '/account/transactions') {
      page = 'transactions';
      state.accountTxSub = state.accountTxSub || 'deposits';
    }
    setActiveAccountLink(page);
    refreshAccountPage(page);
    return;
  }

  if (path === '/bonus') {
    hideAllViews();
    document.getElementById('view-bonus')?.classList.remove('hidden');
    loadBonusContent();
  } else if (path === '/challenges') {
    hideAllViews();
    document.getElementById('view-challenges')?.classList.remove('hidden');
    loadChallengesPage();
  } else if (path === '/rakeback') {
    hideAllViews();
    document.getElementById('view-rakeback')?.classList.remove('hidden');
    loadRakebackPage();
  } else {
    showLobby();
  }
}

function hideAllViews() {
  ['view-lobby','view-game','view-account','view-bonus','view-challenges','view-rakeback']
    .forEach(id => document.getElementById(id)?.classList.add('hidden'));
}

window.addEventListener('popstate', handleRouteChange);
window.addEventListener('hashchange', () => {
  const hash = window.location.hash.slice(1);
  const gameIds = ['wheel','baccarat','dice','crash','slots','plinko','keno','tower','mines','blackjack','hilo','limbo'];
  if (hash && gameIds.includes(hash)) {
    if (state.currentGame !== hash) launchGame(hash);
  } else if (!hash) {
    handleRouteChange();
  }
});

const gameIds = ['wheel','baccarat','dice','crash','slots','plinko','keno','tower','mines','blackjack','hilo','limbo'];
const initialPath = window.location.pathname.slice(1);
const initialHash = window.location.hash.slice(1);

if (initialPath && gameIds.includes(initialPath)) {
  window.addEventListener('load', () => {
    if (state.currentGame !== initialPath) launchGame(initialPath);
  });
} else if (initialHash && gameIds.includes(initialHash)) {
  window.addEventListener('load', () => {
    if (state.currentGame !== initialHash) launchGame(initialHash);
  });
} else {
  handleRouteChange();
}

// ==========================================================================
// 14. WALLET CONNECT (Phantom / Solana)
// ==========================================================================

function openWalletConnectModal() {
  document.getElementById('wallet-connect-modal')?.classList.remove('hidden');
  document.getElementById('wallet-connect-status').textContent = '';
}

function closeWalletConnectModal() {
  document.getElementById('wallet-connect-modal')?.classList.add('hidden');
}

async function connectPhantom() {
  const statusEl = document.getElementById('wallet-connect-status');
  if (!statusEl) return;

  const provider = (typeof window !== 'undefined' && window.solana && window.solana.isPhantom)
    ? window.solana
    : null;

  if (!provider) {
    statusEl.innerHTML =
      'Phantom not detected. ' +
      '<a href="https://phantom.app/" target="_blank" rel="noopener noreferrer" style="color:var(--accent-green);font-weight:700;">Install Phantom extension</a> ' +
      'then refresh this page, or open Casino in the Phantom in-app browser.';
    statusEl.style.color = 'var(--text-secondary)';
    return;
  }

  try {
    statusEl.textContent = 'Connecting…';
    statusEl.style.color = 'var(--text-secondary)';

    const conn = await provider.connect();
    const address = conn.publicKey.toString();

    state.connectedWallet = {
      provider: 'phantom',
      address,
      chain: 'solana'
    };

    statusEl.textContent = 'Connected: ' + address.slice(0, 4) + '...' + address.slice(-4);
    statusEl.style.color = 'var(--accent-green)';

    const btn = document.getElementById('btn-wallet-connect');
    if (btn) {
      btn.querySelector('.wc-label').textContent = address.slice(0, 4) + '...' + address.slice(-4);
      btn.classList.add('connected');
    }

    setTimeout(() => closeWalletConnectModal(), 1200);
    playSound('click');
  } catch (err) {
    statusEl.textContent = 'Connection failed: ' + (err.message || err);
    statusEl.style.color = 'var(--accent-red)';
  }
}

// Expose for inline onclick handlers
window.openWalletConnectModal = openWalletConnectModal;
window.closeWalletConnectModal = closeWalletConnectModal;
window.connectPhantom = connectPhantom;

