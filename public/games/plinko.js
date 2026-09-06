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
  const table = GameRenderers.PLINKO_CLIENT_TABLES[rows] || GameRenderers.PLINKO_CLIENT_TABLES[16];
  const won = multiplier >= 1;
  const risk = details.risk || 'MEDIUM';

  let ballPos = 0;
  let step = 0;
  const tickRate = Math.max(20, 300 / rows);

  function renderFrame() {
    const progress = step + 0.5;
    const currentPos = ballPos;
    const nextPos = currentPos + (path[step] || 0);

    let pins = '';
    for (let r = 0; r < rows; r++) {
      pins += '<div class="plinko-row">';
      for (let p = 0; p <= r; p++) {
        const pinX = r === 0 ? 50 : (p / r) * 100;
        pins += '<div class="plinko-peg" style="position:absolute;left:' + pinX + '%;top:50%;transform:translate(-50%,-50%);"></div>';
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
      '<div class="plinko-board">' +
      '<div class="plinko-info">Row ' + Math.min(ballRow + 1, rows) + ' / ' + rows + ' • Risk: ' + risk + '</div>' +
      pins +
      '<div id="plinko-ball" class="plinko-ball" style="left:' + ballX + '%;top:' + ballY + 'px;">🔴</div>' +
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

    let bucketsHtml = '<div class="plinko-buckets">';
    for (let i = 0; i <= rows; i++) {
      const hit = i === bucket;
      const m = table[i];
      const isBig = m >= 10;
      const isMid = m >= 2;
      const col = isBig ? '#00e701' : isMid ? '#8248ff' : m >= 1 ? '#00e701' : '#39424d';
      const bucketCls = 'plinko-bucket' + (hit ? ' highlight' : '');
      bucketsHtml += '<div class="' + bucketCls + '" style="background:' + col + ';opacity:' + (hit ? '1' : '0.55') + ';transform:' + (hit ? 'scale(1.2)' : 'none') + ';box-shadow:' + (hit ? '0 0 12px rgba(' + (isBig ? '0,231,1' : '130,72,255') + ',.6)' : 'none') + ';">' + m.toFixed(2) + 'x</div>';
    }
    bucketsHtml += '</div>';

    const ballEl = document.getElementById('plinko-ball');

    display.innerHTML =
      '<div class="plinko-result">' + bucketsHtml +
      '<div class="plinko-multiplier" style="color:' + (won ? '#00e701' : '#ff4d4d') + ';">' +
      multiplier.toFixed(2) + 'x ' + (won ? '✅' : '💥') +
      '</div>' +
      '<div class="plinko-detail">Landed in bucket ' + (bucket + 1) + '/' + (rows + 1) + '</div>';

    if (payout && Number(payout) > 0) {
      display.innerHTML += '<div class="plinko-payout">Payout: ' + Number(payout).toFixed(2) + ' ' + state.currency + '</div>';
    }
    display.innerHTML += '</div>';

    if (won) playSound('win'); else playSound('loss');
  }
};
