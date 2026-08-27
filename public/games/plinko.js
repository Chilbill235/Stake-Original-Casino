window.GameRenderers = window.GameRenderers || {};

GameRenderers.PLINKO_ROWS = [8, 10, 12, 14, 16];
GameRenderers.PLINKO_CLIENT_TABLES = {
  8:  [13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13],
  10: [22, 5, 2, 1.4, 0.6, 0.4, 0.6, 1.4, 2, 5, 22],
  12: [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33],
  14: [58, 15, 7, 4, 1.9, 1, 0.5, 0.2, 0.5, 1, 1.9, 4, 7, 15, 58],
  16: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110]
};

GameRenderers.renderPlinko = function(details, multiplier, payout) {
  const display = document.getElementById('game-display-area');
  const rows = details.rows;
  const path = details.path;
  const bucket = details.bucket;
  const table = GameRenderers.PLINGO_CLIENT_TABLES[rows] || GameRenderers.PLINGO_CLIENT_TABLES[16];
  const won = multiplier >= 1;

  let ballPos = 0;
  let step = 0;
  const tickRate = Math.max(30, 500 / rows);

  function renderFrame() {
    const progress = step + 0.5;
    const currentPos = ballPos;
    const nextPos = currentPos + (path[step] || 0);

    let pins = '';
    for (let r = 0; r < rows; r++) {
      pins += '<div style="position:relative;height:28px;margin:2px 0;">';
      for (let p = 0; p <= r; p++) {
        const pinX = r === 0 ? 50 : (p / r) * 100;
        pins += '<div style="position:absolute;left:' + pinX + '%;top:50%;transform:translate(-50%,-50%);width:12px;height:12px;border-radius:50%;background:#4d718a;border:1px solid #2f4553;"></div>';
      }
      pins += '</div>';
    }

    const ballRow = Math.floor(progress);
    const ballOffset = progress - ballRow;
    let ballX = 50;
    if (ballRow > 0 && ballRow <= rows) {
      const leftX = (currentPos / Math.max(1, ballRow)) * 100;
      const rightX = (nextPos / Math.max(1, ballRow)) * 100;
      ballX = leftX + (rightX - leftX) * ballOffset;
    } else if (ballRow > rows) {
      ballX = (ballPos / rows) * 100;
    }

    const ballY = 10 + (progress * 26);

    display.innerHTML =
      '<div style="position:relative;max-width:380px;margin:auto;height:380px;padding:10px;">' +
      '<div style="position:absolute;top:8px;left:0;right:0;text-align:center;font-size:0.72rem;color:#b1bad2;font-weight:600;">Row ' + Math.min(ballRow + 1, rows) + ' / ' + rows + '</div>' +
      pins +
      '<div id="plinko-ball" style="position:absolute;left:' + ballX + '%;top:' + ballY + 'px;transform:translateX(-50%);font-size:1.4rem;width:24px;height:24px;">🔴</div>' +
      '</div>';
  }

  const timer = setInterval(() => {
    if (step >= rows) {
      clearInterval(timer);
      finish();
      return;
    }
    ballPos += path[step] || 0;
    step++;
    playSound('chip');
    renderFrame();
  }, tickRate);

  function finish() {
    renderFrame();

    let bucketsHtml = '<div style="display:flex;justify-content:center;gap:3px;margin-top:20px;">';
    for (let i = 0; i <= rows; i++) {
      const hit = i === bucket;
      const m = table[i];
      const isBig = m >= 10;
      const isMid = m >= 2;
      const col = isBig ? '#00e701' : isMid ? '#8248ff' : m >= 1 ? '#00e701' : '#39424d';
      bucketsHtml += '<div style="min-width:min(30px,7vw);padding:8px 4px;border-radius:4px;text-align:center;font-size:0.65rem;font-weight:800;color:#fff;background:' + col + ';opacity:' + (hit ? '1' : '0.55') + ';transform:' + (hit ? 'scale(1.2)' : 'none') + ';box-shadow:' + (hit ? '0 0 12px rgba(' + (isBig ? '0,231,1' : '130,72,255') + ',.6)' : 'none') + ';">' + m.toFixed(2) + 'x</div>';
    }
    bucketsHtml += '</div>';

    const ballEl = document.getElementById('plinko-ball');

    display.innerHTML =
      '<div style="text-align:center;padding:20px;">' + bucketsHtml +
      '<div style="font-size:2.5rem;font-weight:900;margin:14px 0;color:' + (won ? '#00e701' : '#ff4d4d') + ';">' +
      multiplier.toFixed(2) + 'x ' + (won ? '✅' : '💥') +
      '</div>' +
      '<div style="color:#b1bad2;font-size:0.85rem;">Landed in bucket ' + (bucket + 1) + '/' + (rows + 1) + '</div>';

    if (payout && Number(payout) > 0) {
      display.innerHTML += '<div style="color:#00e701;font-weight:700;margin-top:6px;">Payout: ' + Number(payout).toFixed(2) + ' ' + state.currency + '</div>';
    }
    display.innerHTML += '</div>';

    if (won) playSound('win'); else playSound('loss');
  }
};
