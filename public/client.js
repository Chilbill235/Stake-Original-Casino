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

// ==========================================================================
// 2. SYNTHESIZED WEB AUDIO SFX ENGINE
// ==========================================================================

let audioCtx = null;
let audioReady = false;

function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      try {
        audioCtx = new AudioContextClass();
      } catch (e) {
        console.warn('[Audio]: Failed to init AudioContext', e);
      }
    }
  }
  return audioCtx;
}

function initAudioContext() {
  if (audioReady) return;
  const ctx = getAudioContext();
  if (ctx) {
    if (ctx.state === 'suspended') {
      ctx.resume().then(() => { audioReady = true; }).catch(() => {});
    } else if (ctx.state === 'running') {
      audioReady = true;
    }
  }
}

function playSound(type) {
  if (!state.sfxEnabled) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  if (ctx.state === 'suspended') {
    ctx.resume();
  }
  if (ctx.state === 'suspended') return;

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

      if (res.status === 401) {
        localStorage.removeItem('casino_token');
        localStorage.removeItem('casino_username');
        await initSession();
        throw new Error('Session expired. Re-authenticated.');
      }

    if (!res.ok) {
      const error = new Error(data.error || 'Server error occurred');
      error.status = res.status;
      error.data = data;
      error.requiresKyc = data.requiresKyc;
      error.requiresOnboarding = data.requiresOnboarding;
      error.onboardingUrl = data.onboardingUrl;
      throw error;
    }
    return data;
  } catch (err) {
    console.error(`[API Error] ${endpoint}:`, err);
    throw err;
  }
}

async function initSession() {
  const ageConfirmed = localStorage.getItem('casino_age_confirmed') === 'true';
  if (!ageConfirmed) {
    document.getElementById('modal-agegate')?.classList.remove('hidden');
    return;
  }

  let token = localStorage.getItem('casino_token');

  if (!token) {
    await continueAsGuest();
    return;
  }

  try {
    const data = await apiRequest('/api/user/me');
    if (data.balances) state.balances = data.balances;
    if (data.username) localStorage.setItem('casino_username', data.username);
    state.profile = data;
  } catch (err) {
    console.warn('[Auth failure]: Token invalid, falling back to guest.', err.message);
    localStorage.removeItem('casino_token');
    await continueAsGuest();
    return;
  }

  await fetchFairSeed();
  updateWalletUI();
  connectWebSocket();
  setupGlobalEventListeners();
  initProvablyFairUI();
  injectMobileAndNavigationDOM();
  applyEmbeddedModeRestrictions();
  updateUserProfileBadge();
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
  
  try {
    state.ws = new WebSocket(`${protocol}//${window.location.host}?token=${token}`);

    state.ws.onopen = () => {
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
            state.balances = { gc: data.balances.gc, sc: data.balances.sc_unplayed + data.balances.sc_played };
            updateWalletUI();
            break;
          case 'KYC_STATUS_UPDATE':
            if (state.profile) state.profile.kyc = data.kyc;
            if (data.message) alert(data.message);
            if (document.getElementById('modal-profile') && !document.getElementById('modal-profile').classList.contains('hidden')) {
              refreshProfileModal();
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
      state.wsReconnectTimer = setTimeout(connectWebSocket, 3000);
    };

    state.ws.onerror = () => {
      state.ws?.close();
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
      `${winLabel} ${Number(data.multiplier).toFixed(2)}x (${Number(data.payout || 0).toFixed(2)} ${data.currency || 'GC'})` +
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
    const payout = item.payout ? Number(item.payout).toFixed(2) : '';
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
  if (state.isEmbedded) return;
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

function openWalletDropdown(event) {
  if (state.isEmbedded) return;
  if (event) event.stopPropagation();
  const menu = document.getElementById('wallet-dropdown-menu');
  if (menu) {
    menu.classList.toggle('hidden');
    playSound('click');
  }
}

function openBonusModalFromDropdown() {
  closeWalletDropdown();
  openBonusModal();
}

function switchCurrency(currency) {
  if (state.isProcessing) return;
  if (state.activeGameState) {
    closeWalletDropdown();
    return alert('Cannot switch currency while an active game round is in progress.');
  }

  playSound('click');
  state.currency = currency;
  window.__CASINO_CURRENCY = currency;
  localStorage.setItem('casino_currency', currency);
  updateWalletUI();
  updateBetCurrencyTag();
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

  state.clientSeed = newSeed;
  localStorage.setItem('casino_client_seed', newSeed);
  playSound('click');

  try {
    // Rotating the server seed alongside the client seed keeps past results verifiable
    await apiRequest('/api/provably-fair/rotate-seed', 'POST', { newClientSeed: newSeed });
    await fetchFairSeed();
    alert('Client seed updated successfully!');
  } catch (err) {
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
  const modal = document.getElementById('modal-store');
  if (modal) modal.classList.remove('hidden');

  showPackageList();
}

function closeStoreModal() {
  playSound('click');
  const modal = document.getElementById('modal-store');
  if (modal) modal.classList.add('hidden');

  const container = document.getElementById('checkout-container');
  if (container) {
    container.innerHTML = '';
  }

  const checkoutSection = document.getElementById('checkout-section');
  if (checkoutSection) checkoutSection.classList.add('hidden');

  const successSection = document.getElementById('checkout-success');
  if (successSection) successSection.classList.add('hidden');

  showPackageList();

  if (state.activeCheckoutInstance) {
    try { state.activeCheckoutInstance.destroy(); } catch (e) { console.warn('Checkout cleanup:', e); }
    state.activeCheckoutInstance = null;
  }
}

function showPackageList() {
  const pkgList = document.querySelector('.package-selection');
  const summary = document.getElementById('package-summary');
  const checkoutSection = document.getElementById('checkout-section');
  const successSection = document.getElementById('checkout-success');
  if (pkgList) pkgList.classList.remove('hidden');
  if (summary) summary.classList.add('hidden');
  if (checkoutSection) checkoutSection.classList.add('hidden');
  if (successSection) successSection.classList.add('hidden');
  document.querySelectorAll('.package-card').forEach(c => c.style.opacity = '');
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
  const container = document.getElementById('checkout-container');
  if (!checkoutSection || !container) return;
  checkoutSection.classList.remove('hidden');
  checkoutSection.classList.add('checkout-loading');

  container.innerHTML =
    '<div style="text-align:center;">' +
    '<div class="checkout-spinner"></div>' +
    '<p class="checkout-loading-text">Initializing secure checkout...</p>' +
    '<p class="checkout-loading-sub">Please wait while we prepare your payment gateway</p>' +
    '</div>';
}

function showCheckoutError(message) {
  const checkoutSection = document.getElementById('checkout-section');
  const container = document.getElementById('checkout-container');
  if (!checkoutSection || !container) return;
  checkoutSection.classList.remove('checkout-loading');

  container.innerHTML =
    '<div style="text-align:center; padding:40px 20px;">' +
    '<div style="width:64px; height:64px; border:2px solid var(--accent-red); border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 20px; color:var(--accent-red); font-size:1.8rem;">!</div>' +
    '<h4 style="color:var(--accent-red); margin-bottom:8px;">Checkout Error</h4>' +
    '<p style="color:var(--text-secondary); margin-bottom:20px; font-size:0.9rem;">' + escapeHTML(message) + '</p>' +
    '<div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">' +
    '<button class="btn btn-primary" onclick="retryCheckout()" style="min-width:120px;">Retry</button>' +
    '<button class="btn btn-secondary-action" onclick="showPackageList()">Back to Packages</button>' +
    '</div>' +
    '</div>';
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
    setTimeout(() => closeStoreModal(), 2000);
  }, 1500);
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
  pack_10:  { gc: '15,000', sc: '15.00', price: '$10.00' },
  pack_20:  { gc: '25,000', sc: '25.00', price: '$20.00' },
  pack_50:  { gc: '55,000', sc: '55.00', price: '$50.00' },
  pack_100: { gc: '100,000', sc: '105.00', price: '$100.00' }
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
  document.getElementById('checkout-container').appendChild(btn);
}

async function buyCoinPackage(packageId) {
  if (state.isEmbedded) return;
  state.lastPackageId = packageId;
  try {
    playSound('click');
    openStoreModal();

    const container = document.getElementById('checkout-container');
    if (!container) return;

    updatePackageSummary(packageId);
    showCheckoutBackButton();
    showCheckoutSection();
    showCheckoutLoading();

    if (state.activeCheckoutInstance) {
      try { state.activeCheckoutInstance.destroy(); } catch (e) { console.warn('Checkout cleanup:', e); }
      state.activeCheckoutInstance = null;
    }

    const data = await apiRequest('/api/user/buy-coins', 'POST', { packageId });

    if (!data.publishableKey || !data.clientSecret) {
      throw new Error(data.error || 'Invalid session configuration returned from server.');
    }

    const StripeSDK = await loadStripeSdk();
    const stripe = StripeSDK(data.publishableKey);

    const checkoutEl = document.createElement('div');
    checkoutEl.id = 'stripe-checkout-root';
    checkoutEl.style.marginTop = '20px';
    container.innerHTML = '';
    container.appendChild(checkoutEl);

    state.activeCheckoutInstance = await stripe.initEmbeddedCheckout({
      clientSecret: data.clientSecret,
      onComplete: (result) => {
        playSound('win');
        const pkg = PACKAGE_INFO[packageId] || { gc: '0', sc: '0' };
        showCheckoutSuccess(pkg.gc, pkg.sc);
      }
    });

    state.activeCheckoutInstance.mount(checkoutEl);

    const checkoutSection = document.getElementById('checkout-section');
    if (checkoutSection) checkoutSection.classList.remove('checkout-loading');

  } catch (err) {
    console.error('[Embedded Payment Error]:', err);
    showCheckoutError(err.message || 'Failed to initialize in-page payment.');
    document.querySelectorAll('.package-card').forEach(c => c.style.opacity = '');
  }
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
  if (state.profile?.kyc?.status !== 'VERIFIED') {
    alert('Identity verification (KYC) is required to redeem Sweeps Coins for cash. Please complete verification in your Profile first.');
    return;
  }
  playSound('click');
  document.getElementById('modal-redeem')?.classList.remove('hidden');
}

function closeRedeemModal() { 
  playSound('click'); 
  document.getElementById('modal-redeem')?.classList.add('hidden'); 
}

async function submitRedeem() {
  if (state.isEmbedded) return;
  const input = document.getElementById('redeem-input');
  const amount = parseFloat(input?.value);

  if (isNaN(amount) || amount < 50) {
    return alert('Minimum redemption limit is 50.00 Sweeps Coins (SC).');
  }

  playSound('click');

  try {
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
    if (err.requiresKyc) {
      alert(err.message + ' Please complete KYC verification in your Profile first.');
      closeRedeemModal();
      setTimeout(() => openProfileModal(), 300);
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
  document.getElementById('view-lobby')?.classList.remove('hidden');
  document.getElementById('view-game')?.classList.add('hidden');
  state.currentGame = null;
  state.activeGameState = null;
  state.isProcessing = false;
  window.location.hash = '';
  clearGameControls();
}

function clearGameControls() {
  const options = document.getElementById('game-controls-options');
  if (options) options.innerHTML = '';
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

async function launchGame(gameId) {
  playSound('click');
  state.currentGame = gameId;
  state.activeGameState = null;
  state.isProcessing = false;

  if (window.GameLoader) await window.GameLoader.load(gameId);

  document.getElementById('view-lobby')?.classList.add('hidden');
  document.getElementById('view-game')?.classList.remove('hidden');
  document.getElementById('active-game-title').textContent = gameId.toUpperCase();

  if (window.location.hash !== '#' + gameId) {
    window.location.hash = '#' + gameId;
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
        window.GameRenderers.renderKenoBoard();
      } else {
        renderKenoBoard();
      }
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

  try {
    const data = await apiRequest('/api/play/mines/start', 'POST', {
      currency: state.currency,
      betAmount,
      mineCount
    });

    state.balances = data.balances;
    updateWalletUI();

    state.activeGameState = {
      gameId: data.gameId,
      type: 'mines',
      revealedTiles: [],
      mineCount,
      betAmount,
      currentMultiplier: 1.00
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

      if (data.cashedOut || data.autoCashout) {
        if (data.balances) { state.balances = data.balances; updateWalletUI(); }
        if (window.GameRenderers && window.GameRenderers.renderMinesWin) {
          window.GameRenderers.renderMinesWin(data);
        } else {
          alert(`Board cleared! Auto-cashout ${data.multiplier.toFixed(2)}x — +${data.payout.toFixed(2)} ${state.currency}`);
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
      setTimeout(() => {
        state.balances = data.balances || state.balances;
        updateWalletUI();
      }, 1000);
    } else {
    state.balances = data.balances || state.balances;
    updateWalletUI();
    alert(`Cashed out successfully for ${Number(data.payout).toFixed(2)} ${state.currency}!`);
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

  try {
    const data = await apiRequest('/api/play/tower/start', 'POST', {
      currency: state.currency,
      betAmount,
      difficulty
    });

    state.balances = data.balances;
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
        state.balances = data.balances;
        updateWalletUI();
        const display = document.getElementById('game-display-area');
        if (display) {
          display.innerHTML = '<div style="text-align:center;padding:24px;">' +
            '<div style="font-size:2.5rem;font-weight:900;color:#00e701;">✅ TOWER COMPLETED</div>' +
            '<div style="color:#b1bad2;font-size:0.9rem;margin-top:8px;">Final Multiplier: ' + data.multiplier.toFixed(2) + 'x</div>' +
            '<div style="color:#00e701;font-weight:700;margin-top:4px;">Payout: ' + Number(data.payout).toFixed(2) + ' ' + state.currency + '</div>' +
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
          '<div style="color:#ff4d4d;font-weight:700;margin-top:4px;">Lost ' + Number(state.activeGameState.betAmount).toFixed(2) + ' ' + state.currency + '</div>' +
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
        '<div style="color:#00e701;font-weight:700;margin-top:4px;">+' + Number(data.payout).toFixed(2) + ' ' + state.currency + '</div>' +
        '</div>';
    }
    setTimeout(() => {
      state.balances = data.balances || state.balances;
      updateWalletUI();
      state.activeGameState = null;
      launchGame('tower');
    }, 2000);
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
      params: { targetMultiplier }
    });

    syncFair(data);

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
          ${progress === 1 && data.win ? `<div style="margin-top:10px; color:#00e701; font-weight:800;">WIN — paid ${Number(data.payout).toFixed(2)} ${state.currency}</div>` : ''}
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

    setTimeout(() => {
      state.balances = data.balances || state.balances;
      updateWalletUI();
    }, 1100);

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

    setTimeout(() => {
      state.balances = data.balances || state.balances;
      updateWalletUI();
    }, 500);
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

      switch (state.currentGame) {
        case 'slots':    GameRenderers.renderSlots(data.details, data.multiplier, data.payout); break;
        case 'plinko':   GameRenderers.renderPlinko(data.details, data.multiplier, data.payout); break;
        case 'keno':     GameRenderers.renderKeno(data.details, data.multiplier, data.payout); break;
        case 'wheel':    GameRenderers.renderWheel(data.details, data.multiplier); break;
        case 'baccarat': GameRenderers.renderBaccarat(data.details, data.payout); break;
        case 'dice':     GameRenderers.renderDice(data.details, data.win); break;
        case 'crash':    GameRenderers.renderCrashGame(data.details, data.win, data.payout); break;
        default:
          const display = document.getElementById('game-display-area');
          if (display) {
            display.innerHTML = `
              <div style="text-align:center; padding: 20px;">
                <div style="font-size:2rem; font-weight:800; color:${data.multiplier > 1 ? '#00e701' : '#ff4d4d'}; margin-bottom: 12px;">
                  ${data.multiplier.toFixed(2)}x
                </div>
                <p style="font-weight: 600; color: #b1bad2;">Payout: ${Number(data.payout).toFixed(2)} ${state.currency}</p>
              </div>`;
          }
          break;
      }

      if (state.currentGame !== 'crash' && state.currentGame !== 'wheel' && state.currentGame !== 'slots' && state.currentGame !== 'plinko' && state.currentGame !== 'baccarat') {
        state.balances = data.balances || state.balances;
        updateWalletUI();
      } else if (state.currentGame === 'baccarat') {
        state.balances = data.balances || state.balances;
        updateWalletUI();
      } else {
        setTimeout(() => {
          state.balances = data.balances || state.balances;
          updateWalletUI();
        }, 2800);
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
        '<div style="color:#ff4d4d;font-weight:700;">' + jackpot.amount.toFixed(2) + ' ' + state.currency + '</div></div>';
    } else if (jackpot) {
      html += '<div style="text-align:center;margin-top:12px;"><div style="font-weight:800;color:#ff4d4d;">' +
        jackpot.tier.toUpperCase() + ' JACKPOT!</div><div style="font-size:0.78rem;color:#b1bad2;">' + jackpot.amount.toFixed(2) + ' ' + state.currency + '</div></div>';
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
       '<div style="color:#b1bad2;font-size:0.85rem;margin-top:4px;">Payout: ' + Number(payout || 0).toFixed(2) + ' ' + state.currency + '</div>' +
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
    (outcome === betOn ? 'Payout: ' + Number(payout).toFixed(2) + ' ' + state.currency :
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
    (win ? '<div style="margin-top:12px;font-weight:800;color:#00e701;">Paid ' + Number(payout).toFixed(2) + ' ' + state.currency + '</div>' : '') +
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

/* --- BLACKJACK (interactive hit / stand) --- */
function blackjackOutcomeText(outcome, multiplier, payout) {
  const cur = state.currency;
  switch (outcome) {
    case 'BLACKJACK': return { text: 'BLACKJACK! Paid ' + Number(payout).toFixed(2) + ' ' + cur, color: '#00e701' };
    case 'WIN':       return { text: 'You win! Payout ' + Number(payout).toFixed(2) + ' ' + cur, color: '#00e701' };
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
  try {
    const data = await apiRequest('/api/play/blackjack/start', 'POST', {
      currency: state.currency,
      betAmount
    });
    if (data.balances) { state.balances = data.balances; updateWalletUI(); }

     if (data.resolved) {
        renderBlackjackHands(data.playerHand, data.dealerHand, false,
          blackjackOutcomeText(data.outcome, data.multiplier, data.payout));
        if (data.multiplier > 1) playSound('win'); else playSound('loss');
        clearGameControls();
        state.activeGameState = null;
        setTimeout(() => {
          if (data.balances) { state.balances = data.balances; updateWalletUI(); }
          resetRoundUI('DEAL HAND');
        }, 2000);
     } else {
      state.activeGameState = {
        type: 'blackjack',
        gameId: data.gameId,
        dealerUp: data.dealerUpCard,
        betAmount
      };
      renderBlackjackHands(data.playerHand, [data.dealerUpCard], true, null);
      document.getElementById('game-controls-options').innerHTML =
        '<button type="button" class="btn-play game-action-btn" onclick="blackjackAction(\'hit\')">HIT</button>' +
        '<button type="button" class="btn-secondary-action game-action-btn" onclick="blackjackAction(\'stand\')">STAND</button>';
      resetRoundUI('IN PLAY…');
      document.getElementById('btn-primary-action').disabled = true;
    }
  } catch (err) {
    alert(err.message || 'Blackjack failed');
  } finally {
    state.isProcessing = false;
   }
}


/* --- BLACKJACK (interactive HIT / STAND) --- */
async function blackjackAction(action) {
  if (state.isProcessing || !state.activeGameState) return;
  state.isProcessing = true;
  try {
    const data = await apiRequest('/api/play/blackjack/' + action, 'POST', {
      gameId: state.activeGameState.gameId
    });

    if (data.balances) { state.balances = data.balances; updateWalletUI(); }

    if (data.resolved) {
       renderBlackjackHands(data.playerHand, data.dealerHand, false,
         blackjackOutcomeText(data.outcome, data.multiplier, data.payout));
       if (data.multiplier > 1) playSound('win'); else playSound('loss');
       clearGameControls();
       state.activeGameState = null;
       setTimeout(() => {
         if (data.balances) { state.balances = data.balances; updateWalletUI(); }
         resetRoundUI('DEAL HAND');
       }, 2000);
     } else {
       renderBlackjackHands(data.playerHand, [data.dealerUpCard], true, null);
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
  display.innerHTML =
    '<div style="text-align:center;">' +
    (ags.prevCard ? '<div class="hand-row" style="justify-content:center;opacity:.45;margin-bottom:6px;">' + cardHTML(ags.prevCard, false, true) + '</div>' : '') +
    (ags.currentCard ? '<div class="hand-row" style="justify-content:center;">' + cardHTML(ags.currentCard, false, true) + '</div>' : '') +
    '<div style="margin-top:10px;color:#b1bad2;font-weight:700;">Multiplier: <span style="color:#00e701;">' + ags.multiplier.toFixed(2) + 'x</span></div>' +
    (msgObj ? '<div style="margin-top:8px;font-weight:800;color:' + msgObj.color + ';">' + msgObj.text + '</div>' : '') +
    '</div>';
}


async function startHiloGame(betAmount) {
  state.isProcessing = true;
  playSound('chip');
  try {
    const data = await apiRequest('/api/play/hilo/start', 'POST', {
      currency: state.currency,
      betAmount
    });
    if (data.balances) { state.balances = data.balances; updateWalletUI(); }

    state.activeGameState = {
      type: 'hilo',
      gameId: data.gameId,
      currentCard: data.currentCard,
      prevCard: null,
      multiplier: 1.00,
      betAmount
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
       state.activeGameState.prevCard = state.activeGameState.currentCard;
       state.activeGameState.currentCard = data.nextCard;
       renderHiloBoard({ text: 'Wrong guess — you needed ' + guess.toLowerCase() + '. Round over.', color: '#ff4d4d' });
       playSound('loss');
       document.getElementById('game-controls-options').innerHTML = '';
       setTimeout(() => {
         if (data.balances) { state.balances = data.balances; updateWalletUI(); }
         state.activeGameState = null;
         launchGame('hilo');
       }, 1500);
     } else if (data.cashedOut || data.autoCashout) {
       const payout = Number(data.payout || 0).toFixed(2);
       state.activeGameState.multiplier = data.multiplier;
       state.activeGameState.currentCard = data.nextCard;
       state.activeGameState.prevCard = null;
       renderHiloBoard({ text: 'Board boundary reached — auto-cashout ' + data.multiplier.toFixed(2) + 'x, +' + payout + ' ' + state.currency, color: '#00e701' });
       playSound('win');
       document.getElementById('game-controls-options').innerHTML = '';
       setTimeout(() => {
         if (data.balances) { state.balances = data.balances; updateWalletUI(); }
         state.activeGameState = null;
         resetRoundUI('PLACE BET');
       }, 2000);
    } else {
      const ags = state.activeGameState;
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
    const payout = Number(data.payout || 0).toFixed(2);
    renderHiloBoard({ text: 'Cashed out ' + data.multiplier.toFixed(2) + 'x — +' + payout + ' ' + state.currency, color: '#00e701' });
    document.getElementById('game-controls-options').innerHTML = '';
    setTimeout(() => {
      if (data.balances) { state.balances = data.balances; updateWalletUI(); }
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
// 11. PROFILE & MODAL CONTROLLERS
// ==========================================================================

async function openProfileModal() {
  if (!state.profile) {
    openAuthModal();
    return;
  }
  playSound('click');
  await refreshProfileModal();
  document.getElementById('modal-profile')?.classList.remove('hidden');
}

function closeProfileModal() {
  playSound('click');
  document.getElementById('modal-profile')?.classList.add('hidden');
}

async function refreshProfileModal() {
  const modal = document.getElementById('modal-profile');
  if (!modal) return;
  try {
    const data = await apiRequest('/api/user/me');
    state.profile = data;
    state.balances = data.balances || state.balances;
    updateWalletUI();
  } catch (err) {
    console.warn('[Profile] Could not refresh profile:', err.message);
  }
  renderProfileModal(modal);
}

async function startKycVerification() {
  try {
    playSound('click');
    const data = await apiRequest('/api/user/kyc/start', 'POST');
    if (data.personaConfig) {
      const pc = data.personaConfig;

      if (pc.templateId === 'itmpl_sandbox_default') {
        alert('Persona template not configured. Using sandbox verification.');
        await verifyKycSandbox();
        return;
      }

      if (!window.Persona && !document.getElementById('persona-script')) {
        const script = document.createElement('script');
        script.id = 'persona-script';
        script.src = `https://withpersona.com/${pc.templateId}/build.js`;
        script.async = true;
        script.onload = () => {
          if (window.Persona) {
            window.Persona.start({
              templateId: pc.templateId,
              referenceId: pc.referenceId,
              environment: pc.environment
            });
          }
        };
        script.onerror = () => {
          alert('Failed to load identity verification. Please try the sandbox option.');
        };
        document.head.appendChild(script);
      } else if (window.Persona) {
        window.Persona.start({
          templateId: pc.templateId,
          referenceId: pc.referenceId,
          environment: pc.environment
        });
      } else {
        alert('Persona SDK not available. Reference ID: ' + pc.referenceId);
      }
    }
  } catch (err) {
    alert(err.message || 'Failed to start KYC verification.');
  }
}

async function verifyKycSandbox() {
  try {
    playSound('click');
    const data = await apiRequest('/api/user/kyc/verify-sandbox', 'POST');
    alert(data.message || 'KYC verified successfully!');
    state.profile = data.kyc ? { ...state.profile, kyc: data.kyc } : state.profile;
    await refreshProfileModal();
  } catch (err) {
    alert(err.message || 'KYC verification failed.');
  }
}

function renderProfileModal(modal) {
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

  const gc = Number(state.balances.gc || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sc = Number(state.balances.sc || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

let kycControls = '';
  if (kyc.status === 'VERIFIED') {
    kycControls = '<button type="button" class="btn-secondary-action btn-full" disabled style="color:#00e701;">&#10003; Identity Verified</button>';
  } else if (kyc.status === 'PENDING') {
    kycControls = '<button type="button" class="btn-secondary-action btn-full" disabled style="color:#b1bad2;">&#8230; Verification in Progress</button>';
  } else if (kyc.status === 'REJECTED') {
    kycControls = '<button type="button" class="btn-play btn-full" onclick="startKycVerification()" style="margin-bottom:8px;">Retry Verification</button>' +
                  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? '<button type="button" class="btn-secondary-action btn-full" onclick="verifyKycSandbox()" style="font-size:0.75rem;">Sandbox Verify (Test)</button>' : '');
  } else {
    kycControls = '<button type="button" class="btn-play btn-full" onclick="startKycVerification()" style="margin-bottom:8px;">Verify Identity (Persona)</button>' +
                  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? '<button type="button" class="btn-secondary-action btn-full" onclick="verifyKycSandbox()" style="font-size:0.75rem;">Sandbox Verify (Test)</button>' : '');
  }

  const vip = p.vip || {};
  const vipText = vip.tier || 'Bronze';

  modal.innerHTML = `
    <div class="modal-box" style="max-width: 420px;">
      <div class="modal-header-flex">
        <h3>👤 User Profile</h3>
        <button class="x-close" onclick="closeProfileModal()">×</button>
      </div>
      <p class="modal-subtitle">Manage your account and verification status.</p>
      <div class="form-group">
        <label class="form-label">Username</label>
        <input type="text" class="form-input" readonly value="${escapeHTML(p.username || 'Guest')}">
      </div>
      <div class="form-group">
        <label class="form-label">Email</label>
        <input type="text" class="form-input" readonly value="${escapeHTML(p.email || 'guest@casino')}">
      </div>
      <div class="form-group">
        <label class="form-label">VIP Tier</label>
        <input type="text" class="form-input" readonly value="${escapeHTML(vipText)}">
      </div>
      <div class="form-group">
        <label class="form-label">Gold Coins (GC)</label>
        <input type="text" class="form-input" readonly value="${gc}">
      </div>
      <div class="form-group">
        <label class="form-label">Sweeps Coins (SC)</label>
        <input type="text" class="form-input" readonly value="${sc}">
       </div>
       <div class="form-group">
         <label class="form-label">Unplayed SC</label>
         <input type="text" class="form-input" readonly value="${Number(state.balances.sc_unplayed || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}">
       </div>
       <div class="form-group">
         <label class="form-label">Redeemable SC</label>
         <input type="text" class="form-input" readonly value="${Number(state.balances.sc_played || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}">
       </div>
       <div class="form-group">
         <label class="form-label">Rakeback Accrued</label>
         <input type="text" class="form-input" readonly value="${Number(p.vip?.rakebackAccruedSC || 0).toFixed(2) + ' SC'}">
       </div>
      <div class="form-group" style="margin-top: 10px;">
        <label class="form-label">KYC Status</label>
        <div style="display:flex; align-items:center; gap:8px; margin-top:4px;">
          <span class="kyc-badge ${kycClass}">${escapeHTML(kycStatusText)}</span>
          <span style="font-size:0.75rem; color:#b1bad2;">Tier ${kyc.tier} of 2</span>
        </div>
      </div>
      ${kyc.rejectionReason ? `<div class="form-group"><label class="form-label">Rejection Reason</label><input type="text" class="form-input" readonly value="${escapeHTML(kyc.rejectionReason)}"></div>` : ''}
      <div class="modal-actions-flex" style="margin-top: 20px; flex-direction:column; gap:8px;">
        ${kycControls}
        <button type="button" onclick="logout()" class="btn-secondary-action btn-full" style="color:var(--accent-red);">Logout</button>
        <button type="button" onclick="closeProfileModal()" class="btn-secondary-action btn-full">Close</button>
      </div>
    </div>`;
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
        <p class="modal-subtitle">Loading...</p>
        <div class="modal-actions-flex" style="margin-top: 20px;">
          <button type="button" onclick="closeProfileModal()" class="btn-play btn-full">Close</button>
        </div>
      </div>`;
    document.body.appendChild(profileModal);
  }

  // Bonus Pages Modals
  if (!document.getElementById('modal-bonus')) {
    const bonusModal = document.createElement('div');
    bonusModal.id = 'modal-bonus';
    bonusModal.className = 'modal-backdrop hidden';
    bonusModal.innerHTML = `
      <div class="modal-box bonus-modal" style="max-width: 600px;">
        <div class="modal-header-flex">
          <h3>🎁 Daily Bonuses</h3>
          <button class="x-close" onclick="closeBonusModal()">×</button>
        </div>
        <p class="modal-subtitle">Claim daily rewards, complete challenges, and collect rakeback.</p>
        <div id="bonus-content">
          <div style="padding:20px;text-align:center;color:#b1bad2;">Loading bonus data...</div>
        </div>
        <div class="modal-actions-flex" style="margin-top:20px;">
          <button type="button" onclick="closeBonusModal()" class="btn-secondary-action btn-full">Close</button>
        </div>
      </div>`;
    document.body.appendChild(bonusModal);
  }
}

function openBonusModal() {
  playSound('click');
  document.getElementById('modal-bonus')?.classList.remove('hidden');
  loadBonusContent();
}

function closeBonusModal() {
  playSound('click');
  document.getElementById('modal-bonus')?.classList.add('hidden');
}

async function loadBonusContent() {
  const content = document.getElementById('bonus-content');
  if (!content) return;
  content.innerHTML = '<div style="padding:20px;text-align:center;color:#b1bad2;">Loading bonus data...</div>';

  try {
    const [bonusStatus, challenges, rakeback] = await Promise.all([
      apiRequest('/api/bonus/status').catch(() => null),
      apiRequest('/api/challenges').catch(() => null),
      apiRequest('/api/rakeback/status').catch(() => null)
    ]);

    let html = '';

    // Daily Claim Card
    html += '<div class="bonus-card" style="margin-bottom:16px;">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">';
    html += '<h4 style="margin:0;font-size:1.05rem;">🎁 Daily Claim</h4>';
    html += '</div>';
    html += '<div style="font-size:0.85rem;color:#b1bad2;margin-bottom:10px;">Reward: <span style="color:#00e701;font-weight:700;">10,000 GC + 10.00 SC</span></div>';

    if (bonusStatus && bonusStatus.canClaim) {
      html += '<button type="button" class="btn-play btn-full game-action-btn" onclick="claimDaily()">Claim 10,000 GC + 10.00 SC</button>';
    } else if (bonusStatus) {
      const nextMs = bonusStatus.nextClaimMs || 0;
      html += '<div style="display:flex;align-items:center;gap:8px;">';
      html += '<span class="countdown-timer" id="daily-countdown" style="font-family:monospace;font-size:1.15rem;font-weight:800;color:#ff914d;">' + formatCountdown(nextMs) + '</span>';
      html += '<span style="color:#b1bad2;font-size:0.8rem;">until next claim</span>';
      html += '</div>';
    } else {
      html += '<button type="button" class="btn-play btn-full" onclick="claimDaily()">Claim Now</button>';
    }
    html += '</div>';

    // Challenges Card
    html += '<div class="bonus-card" style="margin-bottom:16px;">';
    html += '<h4 style="margin:0 0 8px;font-size:1.05rem;">🎯 Daily Challenges</h4>';
    if (challenges && challenges.challenges) {
      challenges.challenges.forEach(c => {
        const pct = Math.min(100, (c.progress / c.target) * 100);
        html += '<div style="margin-bottom:8px;">';
        html += '<div style="display:flex;justify-content:space-between;font-size:0.8rem;">';
        html += '<span style="color:#b1bad2;">' + c.desc + '</span>';
        html += '<span style="color:#b1bad2;">' + c.progress + '/' + c.target + '</span>';
        html += '</div>';
        html += '<div style="background:#14222d;border-radius:4px;height:6px;overflow:hidden;">';
        html += '<div style="width:' + pct + '%;height:100%;background:linear-gradient(90deg,#00e701,#ffc700);"></div>';
        html += '</div>';
        if (c.completed && !c.claimed) {
          html += '<button type="button" class="btn-play btn-full game-action-btn" style="margin-top:4px;font-size:0.8rem;padding:6px 12px;" onclick="claimChallenge(\'' + c.id + '\')">Claim ' + c.minReward + '-' + c.maxReward + ' SC</button>';
        } else if (c.claimed) {
          html += '<span style="font-size:0.75rem;color:#00e701;">Claimed ✓</span>';
        } else {
          html += '<span style="font-size:0.75rem;color:#b1bad2;">Reward: ' + c.minReward + '-' + c.maxReward + ' SC</span>';
        }
        html += '</div>';
      });
    }
    html += '</div>';

    // Rakeback Cards
    html += '<div class="bonus-card">';
    html += '<h4 style="margin:0 0 8px;font-size:1.05rem;">💎 Rakeback Dashboard</h4>';
    if (rakeback && rakeback.rakeback) {
      ['daily', 'weekly', 'monthly'].forEach(tier => {
        const r = rakeback.rakeback[tier];
        const color = tier === 'daily' ? '#00b3ff' : tier === 'weekly' ? '#8248ff' : '#ff4d4d';
        html += '<div style="background:rgba(' + hexToRgb(color) + ',0.06);border:1px solid rgba(' + hexToRgb(color) + ',0.3);border-radius:8px;padding:10px;margin-bottom:8px;">';
        html += '<div style="display:flex;justify-content:space-between;">';
        html += '<span style="font-weight:700;color:' + color + '">' + tier.charAt(0).toUpperCase() + ' Rakeback</span>';
        html += '<span style="font-size:0.75rem;color:#b1bad2;">' + r.period + '</span>';
        html += '</div>';
        html += '<div style="font-size:0.85rem;color:#b1bad2;margin-top:4px;">Loss tracked: <span style="color:#ff4d4d;">' + r.lossTracked.toFixed(2) + ' SC</span></div>';
        html += '<div style="font-size:0.8rem;color:#b1bad2;">Rate: ' + r.rateMin + '% - ' + r.rateMax + '% • Claimable: <span style="color:#00e701;font-weight:700;">' + r.claimable.toFixed(2) + ' SC</span></div>';
        if (r.canClaim) {
          html += '<button type="button" class="btn-play btn-full game-action-btn" style="margin-top:6px;font-size:0.8rem;padding:6px 12px;" onclick="claimRakeback(\'' + tier + '\')">Claim ' + r.claimable.toFixed(2) + ' SC</button>';
        } else if (r.claimable > 0) {
          html += '<div style="font-family:monospace;font-size:0.9rem;color:#ff914d;margin-top:4px;">' + formatCountdown(r.nextClaimMs) + '</div>';
        } else {
          html += '<button type="button" class="btn-secondary-action btn-full" style="margin-top:6px;font-size:0.8rem;padding:6px 12px;" disabled>No losses to rebate</button>';
        }
        html += '</div>';
      });
    }
    html += '</div>';

    content.innerHTML = html;

    // Start countdown timers
    if (bonusStatus && !bonusStatus.canClaim && bonusStatus.nextClaimMs > 0) {
      startCountdown('daily-countdown', bonusStatus.nextClaimMs, 0);
    }
    if (rakeback && rakeback.rakeback) {
      ['daily', 'weekly', 'monthly'].forEach(tier => {
        const r = rakeback.rakeback[tier];
        if (!r.canClaim && r.nextClaimMs > 0) {
          startCountdown('rakeback-countdown-' + tier, r.nextClaimMs, 0);
        }
      });
    }

  } catch (err) {
    content.innerHTML = '<div style="padding:20px;text-align:center;color:#ff4d4d;">Failed to load bonus data: ' + err.message + '</div>';
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
      state.balances = data.balances;
      updateWalletUI();
      playSound('win');
      document.getElementById('bonus-content').innerHTML =
        '<div style="padding:30px;text-align:center;">' +
        '<div style="font-size:1.8rem;font-weight:900;color:#00e701;">✅ Claimed!</div>' +
        '<div style="color:#b1bad2;font-size:0.9rem;margin-top:8px;">+' + data.claimed.gc + ' GC + ' + data.claimed.sc.toFixed(2) + ' SC</div>' +
        '</div>';
      setTimeout(() => loadBonusContent(), 1500);
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
      state.balances = data.balances;
      updateWalletUI();
      playSound('win');
      alert('Challenge claimed! +' + data.reward.toFixed(2) + ' SC');
      loadBonusContent();
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
      state.balances = data.balances;
      updateWalletUI();
      playSound('win');
      alert(tier.charAt(0).toUpperCase() + tier.slice(1) + ' rakeback claimed! +' + data.claimed.toFixed(2) + ' SC');
      loadBonusContent();
    }
  } catch (err) {
    alert(err.message || 'Rakeback claim failed');
  }
}
// ==========================================================================

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

function closeWalletDropdown() {
  document.getElementById('wallet-dropdown-menu')?.classList.add('hidden');
}

function openStoreModalFromDropdown() {
  closeWalletDropdown();
  openStoreModal();
}

function openRedeemModalFromDropdown() {
  closeWalletDropdown();
  openRedeemModal();
}

function openAuthModal() {
  const loginErr = document.getElementById('auth-login-error');
  if (loginErr) loginErr.textContent = '';
  const regErr = document.getElementById('auth-register-error');
  if (regErr) regErr.textContent = '';
  document.getElementById('auth-form-login').classList.remove('hidden');
  document.getElementById('auth-form-register').classList.add('hidden');
  document.getElementById('auth-title').textContent = 'Login to Your Account';
  document.getElementById('auth-subtitle').textContent = 'Enter your credentials to access your account.';
  document.getElementById('modal-auth')?.classList.remove('hidden');
}

function closeAuthModal() {
  document.getElementById('modal-auth')?.classList.add('hidden');
}

function switchAuthMode(mode) {
  if (mode === 'register') {
    document.getElementById('auth-form-login').classList.add('hidden');
    document.getElementById('auth-form-register').classList.remove('hidden');
    document.getElementById('auth-title').textContent = 'Create New Account';
    document.getElementById('auth-subtitle').textContent = 'Register to unlock full features and higher limits.';
  } else {
    document.getElementById('auth-form-login').classList.remove('hidden');
    document.getElementById('auth-form-register').classList.add('hidden');
    document.getElementById('auth-title').textContent = 'Login to Your Account';
    document.getElementById('auth-subtitle').textContent = 'Enter your credentials to access your account.';
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
    state.profile = data.user;
    state.balances = data.balances || state.balances;
    localStorage.setItem('casino_username', data.user?.username || '');
    updateUserProfileBadge();
    closeAuthModal();
    await initSessionFromToken();
  } catch (err) {
    if (errorEl) errorEl.textContent = err.message || 'Login failed.';
  }
}

async function submitRegister() {
  const username = document.getElementById('reg-username')?.value.trim();
  const email = document.getElementById('reg-email')?.value.trim();
  const password = document.getElementById('reg-password')?.value;
  const birthDate = document.getElementById('reg-birthdate')?.value;
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
  if (ageMs < 18 * 365 * 24 * 60 * 60 * 1000 || birth > new Date()) {
    if (errorEl) errorEl.textContent = 'You must be at least 18 years old to register.';
    return;
  }

  try {
    const data = await apiRequest('/api/auth/register', 'POST', { username, email, password, birthDate });
    localStorage.setItem('casino_token', data.token);
    state.profile = data.user;
    state.balances = data.balances || state.balances;
    localStorage.setItem('casino_username', data.user?.username || '');
    updateUserProfileBadge();
    closeAuthModal();
    await initSessionFromToken();
  } catch (err) {
    if (errorEl) errorEl.textContent = err.message || 'Registration failed.';
  }
}

async function continueAsGuest() {
  try {
    const data = await apiRequest('/api/auth/guest', 'POST');
    if (data.token) {
      localStorage.setItem('casino_token', data.token);
      state.profile = data.user || null;
      if (data.user && data.user.username) {
        localStorage.setItem('casino_username', data.user.username);
      }
      state.balances = data.balances || state.balances;
    }
  } catch (err) {
    console.warn('[Guest Fallback]:', err.message);
  }
  closeAuthModal();
  await initSessionFromToken();
}

async function initSessionFromToken() {
  try {
    await fetchFairSeed();
    const data = await apiRequest('/api/user/me');
    if (data.balances) state.balances = data.balances;
    if (data.username) state.profile = data;
  } catch (err) {
    console.warn('[initSessionFromToken]: Auth failure, clearing token.', err.message);
    localStorage.removeItem('casino_token');
  }
  updateWalletUI();
  if (!state.ws || (state.ws.readyState !== WebSocket.OPEN && state.ws.readyState !== WebSocket.CONNECTING)) {
    connectWebSocket();
  }
  if (!document.getElementById('modal-profile')) {
    injectMobileAndNavigationDOM();
  }
  applyEmbeddedModeRestrictions();
  updateUserProfileBadge();
}

function updateUserProfileBadge() {
  const badge = document.getElementById('user-badge');
  if (!badge) return;
  const username = state.profile?.username || localStorage.getItem('casino_username') || 'Guest';
  const firstChar = username.charAt(0) || '👤';
  badge.title = username + ' — Profile & Settings';
  const avatar = badge.querySelector('.avatar-circle');
  if (avatar) avatar.textContent = firstChar.toUpperCase();
}

function logout() {
  localStorage.removeItem('casino_token');
  localStorage.removeItem('casino_username');
  state.profile = null;
  state.balances = { gc: 10000.0, sc: 10.0 };
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

  const audioBtn = document.getElementById('btn-toggle-sfx');
  if (audioBtn) {
    audioBtn.addEventListener('click', () => {
      state.sfxEnabled = !state.sfxEnabled;
      audioBtn.textContent = state.sfxEnabled ? '🔊 SFX ON' : '🔇 SFX OFF';
    });
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
    const container = document.querySelector('.wallet-selector-container');
    if (container && !container.contains(e.target)) {
      closeWalletDropdown();
    }
  });
}

window.addEventListener('DOMContentLoaded', initSession);
['click', 'touchstart', 'keydown'].forEach(evt => {
  window.addEventListener(evt, initAudioContext, { once: true });
});

window.addEventListener('hashchange', () => {
  const hash = window.location.hash.slice(1);
  if (hash && ['wheel','baccarat','dice','crash','slots','plinko','keno','tower','mines','blackjack','hilo','limbo'].includes(hash)) {
    if (state.currentGame !== hash) launchGame(hash);
  }
});

if (window.location.hash) {
  const hash = window.location.hash.slice(1);
  if (['wheel','baccarat','dice','crash','slots','plinko','keno','tower','mines','blackjack','hilo','limbo'].includes(hash)) {
    window.addEventListener('load', () => {
      if (state.currentGame !== hash) launchGame(hash);
    });
  }
}