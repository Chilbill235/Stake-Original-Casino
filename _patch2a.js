// _patch2a.js — client.js targeted surgery: replace existing functions
const fs = require('fs');
const p = 'D:/Casino/public/client.js';
let s = fs.readFileSync(p, 'utf8');

function findFnEnd(src, fnStart) {
  // Scan from fnStart, skipping strings/templates/comments, return offset of
  // the closing brace of the first top-level '{' encountered.
  let i = src.indexOf('{', fnStart);
  const firstBrace = i;
  let depth = 0;
  let st = 'code';
  for (; i < src.length; i++) {
    const ch = src[i];
    const nx = src[i + 1];
    if (st === 'code') {
      if (ch === '/' && nx === '/') { st = 'line'; i++; continue; }
      if (ch === '/' && nx === '*') { st = 'block'; i++; continue; }
      if (ch === "'") { st = 'sq'; continue; }
      if (ch === '"') { st = 'dq'; continue; }
      if (ch === '`') { st = 'tpl'; continue; }
      if (ch === '{') depth++;
      if (ch === '}') { depth--; if (depth === 0) return i + 1; }
    } else if (st === 'sq') {
      if (ch === '\\\\') i++;
      else if (ch === "'") st = 'code';
    } else if (st === 'dq') {
      if (ch === '\\\\') i++;
      else if (ch === '"') st = 'code';
    } else if (st === 'tpl') {
      if (ch === '\\\\') i++;
      else if (ch === '`') st = 'code';
    } else if (st === 'line') {
      if (ch === '\n') st = 'code';
    } else if (st === 'block') {
      if (ch === '*' && nx === '/') { st = 'code'; i++; }
    }
  }
  throw new Error('unbalanced scan from offset ' + firstBrace);
}

function replaceFn(name, newSrc) {
  const asyncSig = `async function ${name}(`;
  const plainSig = `function ${name}(`;
  let start = -1;
  if (s.includes(asyncSig)) start = s.indexOf(asyncSig);
  else if (s.includes(plainSig)) start = s.indexOf(plainSig);
  else throw new Error('fn not found: ' + name);
  const end = findFnEnd(s, start);
  s = s.slice(0, start) + newSrc.trim() + s.slice(end);
  console.log('[ok] replaced', name);
}

// ---------------------------------------------------------------------------
// 1. initSession — persist username, pull authoritative seed state
// ---------------------------------------------------------------------------
replaceFn('initSession', `
async function initSession() {
  let token = localStorage.getItem('casino_token');

  try {
    if (!token) {
      const data = await apiRequest('/api/auth/guest', 'POST');
      if (data.token) {
        localStorage.setItem('casino_token', data.token);
        if (data.user && data.user.username) {
          localStorage.setItem('casino_username', data.user.username);
        }
        state.balances = data.balances || state.balances;
      }
    } else {
      const data = await apiRequest('/api/user/me');
      if (data.balances) state.balances = data.balances;
      if (data.username) localStorage.setItem('casino_username', data.username);
    }
  } catch (err) {
    console.warn('[Auth Guest Fallback Mode]: Using local balances.');
  }

  await fetchFairSeed();
  updateWalletUI();
  connectWebSocket();
  setupGlobalEventListeners();
  initProvablyFairUI();
  injectMobileAndNavigationDOM();
  applyEmbeddedModeRestrictions();
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
`);

// ---------------------------------------------------------------------------
// 2. Provably-fair controls now hit the REAL endpoints
// ---------------------------------------------------------------------------
replaceFn('updateClientSeed', `
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
`);

replaceFn('rotateServerSeed', `
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
`);

// ---------------------------------------------------------------------------
// 3. Dice odds preview writes to the DOM
// ---------------------------------------------------------------------------
replaceFn('updateDiceOdds', `
function updateDiceOdds() {
  const cond = document.getElementById('dice-cond')?.value || 'OVER';
  const target = parseFloat(document.getElementById('dice-target')?.value || 50);
  const winChance = cond === 'OVER' ? (100 - target) : target;
  const multiplier = winChance > 0 ? (99 / winChance) : 0;
  const out = document.getElementById('dice-payout-preview');
  if (out) {
    out.textContent = \`Win Chance: \${winChance.toFixed(2)}%  •  Payout: \${multiplier > 0 ? multiplier.toFixed(4) + 'x' : '—'}\`;
  }
  return multiplier;
}
`);

// ---------------------------------------------------------------------------
// 4. Mines flow — NO offline simulation; server is authoritative
// ---------------------------------------------------------------------------
replaceFn('startMinesGame', `
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
`);

replaceFn('revealMineTile', `
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

    const tile = document.getElementById(\`mine-tile-\${tileIndex}\`);

    if (data.hitBomb) {
      playSound('loss');
      if (tile) {
        tile.style.background = '#ff4d4d';
        tile.textContent = '💣';
      }
      // Reveal where every bomb was hiding
      (data.board || []).forEach((v, i) => {
        if (v === 'BOMB') {
          const b = document.getElementById(\`mine-tile-\${i}\`);
          if (b && i !== tileIndex) { b.textContent = '💣'; b.style.opacity = '0.55'; }
        }
      });
      alert('BOMB HIT! Game Over.');
      const bets = state.activeGameState.betAmount;
      state.activeGameState = null;
      launchGame('mines');
      void bets;
    } else {
      playSound('win');
      if (tile) {
        tile.style.background = '#00e701';
        tile.style.color = '#000';
        tile.textContent = '💎';
      }
      state.activeGameState.revealedTiles.push(tileIndex);
      state.activeGameState.currentMultiplier = data.multiplier;

      if (data.cashedOut || data.autoCashout) {
        // Whole board cleared — server auto-cashed out for us
        if (data.balances) { state.balances = data.balances; updateWalletUI(); }
        alert(\`Board cleared! Auto-cashout \${data.multiplier.toFixed(2)}x — +\${data.payout.toFixed(2)} \${state.currency}\`);
        state.activeGameState = null;
        launchGame('mines');
      } else {
        document.getElementById('btn-primary-action').textContent =
          \`CASHOUT (\${data.multiplier.toFixed(2)}x)\`;
      }
    }
  } catch (err) {
    alert(err.message || 'Error revealing tile');
  } finally {
    state.isProcessing = false;
  }
}
`);

replaceFn('cashoutMines', `
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
    alert(\`Cashed out successfully for \${Number(data.payout).toFixed(2)} \${state.currency}!\`);
    state.activeGameState = null;
    launchGame('mines');
  } catch (err) {
    alert(err.message || 'Mines cashout failed');
  } finally {
    state.isProcessing = false;
  }
}
`);

// ---------------------------------------------------------------------------
// 5. Tower flow — no simulation, server-authoritative
// ---------------------------------------------------------------------------
replaceFn('startTowerGame', `
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

    renderTowerBoard();
  } catch (err) {
    alert(err.message || 'Tower start failed');
  } finally {
    state.isProcessing = false;
  }
}
`);

replaceFn('renderTowerBoard', `
function renderTowerBoard() {
  const display = document.getElementById('game-display-area');
  const actionBtn = document.getElementById('btn-primary-action');
  actionBtn.textContent = \`CASHOUT (\${state.activeGameState.multiplier.toFixed(2)}x)\`;
  actionBtn.disabled = state.activeGameState.currentFloor === 0;

  const tiles = state.activeGameState.tilesPerFloor || 3;

  let html = '<div style="display:flex; flex-direction:column-reverse; gap:8px; max-width:320px; margin:auto;">';
  for (let floor = 0; floor < 8; floor++) {
    const isCurrent = floor === state.activeGameState.currentFloor;
    const isPassed = floor < state.activeGameState.currentFloor;

    html += \`<div style="display:flex; gap:8px; opacity:\${isCurrent || isPassed ? '1' : '0.4'};">\`;
    for (let tile = 0; tile < tiles; tile++) {
      html += \`<button class="game-btn-action" style="flex:1; padding:12px; background:var(--bg-card); color:var(--text-primary); border:1px solid var(--border-color); border-radius:4px; cursor:pointer;" \${isCurrent ? \`onclick="pickTowerTile(\${floor}, \${tile})"\` : 'disabled'}>
        \${isPassed ? '✓' : '?'}
      </button>\`;
    }
    html += '</div>';
  }
  html += '</div>';

  display.innerHTML = html;
}
`);

replaceFn('pickTowerTile', `
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
        alert(\`TOWER COMPLETED! \${data.multiplier.toFixed(2)}x — +\${Number(data.payout).toFixed(2)} \${state.currency}\`);
        state.activeGameState = null;
        launchGame('tower');
      } else {
        state.activeGameState.currentFloor = data.currentFloor;
        renderTowerBoard();
      }
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
`);

replaceFn('cashoutTower', `
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
    alert(\`Cashed out for \${Number(data.payout).toFixed(2)} \${state.currency}!\`);
    state.activeGameState = null;
    launchGame('tower');
  } catch (err) {
    alert(err.message || 'Tower cashout failed');
  } finally {
    state.isProcessing = false;
  }
}
`);

// ---------------------------------------------------------------------------
// 6. Dice & Limbo — no simulation; render real visuals
// ---------------------------------------------------------------------------
replaceFn('executeDiceBet', `
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

    state.balances = data.balances;
    updateWalletUI();
    syncFair(data);

    if (data.win) playSound('win'); else playSound('loss');
    renderDiceResult(data.details, data.win);
  } catch (err) {
    alert(err.message || 'Dice bet failed');
  } finally {
    state.isProcessing = false;
  }
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

  display.innerHTML = \`
    <div style="max-width:430px; margin:auto; text-align:center;">
      <div style="font-size:3rem; font-weight:900; color:\${win ? winColor : loseColor};">\${roll.toFixed(2)}</div>
      <div style="position:relative; height:14px; border-radius:7px; margin:22px 0 26px; background:#14222d; border:1px solid #243542; overflow:visible;">
        <div style="position:absolute; top:0; bottom:0; left:\${zoneLeft}%; width:\${zoneWidth}%; background:\${win ? winColor : loseColor}; opacity:0.35; border-radius:7px;"></div>
        <div style="position:absolute; top:-5px; bottom:-5px; left:calc(\${Math.min(99.2, Math.max(0, roll))}% - 2px); width:4px; background:#fff; border-radius:2px;"></div>
        <div style="position:absolute; top:110%; left:\${zoneLeft}%; transform:translateX(-50%); font-size:0.7rem; color:#b1bad2;">\${target.toFixed(2)}</div>
      </div>
      <p style="font-weight:700; color:\${win ? winColor : loseColor};">\${win ? 'WIN' : 'LOSS'}\${win ? ' • ' + details.winChance.toFixed(2) + '% chance' : ''}</p>
    </div>\`;
}
`);

fs.writeFileSync(p, s);
console.log('[done] saved, size:', s.length);
