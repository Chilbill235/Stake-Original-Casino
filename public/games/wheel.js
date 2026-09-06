window.GameRenderers = window.GameRenderers || {};

GameRenderers.renderWheel = function(details, multiplier) {
  const display = document.getElementById('game-display-area');
  const wheelSegs = [
    { mult: 0, color: 'GRAY', label: '0x' }, { mult: 1.2, color: 'BLUE', label: '1.2x' },
    { mult: 1.5, color: 'GREEN', label: '1.5x' }, { mult: 2, color: 'BLUE', label: '2x' },
    { mult: 3, color: 'PURPLE', label: '3x' }, { mult: 0, color: 'GRAY', label: '0x' },
    { mult: 1.2, color: 'GREEN', label: '1.2x' }, { mult: 1.5, color: 'ORANGE', label: '1.5x' },
    { mult: 2, color: 'BLUE', label: '2x' }, { mult: 5, color: 'PURPLE', label: '5x' },
    { mult: 10, color: 'GOLD', label: '10x' }, { mult: 50, color: 'GOLD', label: '50x' }
  ];
  const WHEEL_COLORS = {
    GRAY: '#39424d', BLUE: '#1876d2', GREEN: '#00e701',
    PURPLE: '#8248ff', ORANGE: '#ff8b20', GOLD: '#ffc700'
  };
  const winningIndex = details.index || 0;
  const won = multiplier > 0;
  const finalRotation = ((360 - (winningIndex * 30 + 15)) % 360);
  const totalSpins = 6;
  const totalRotation = totalSpins * 360 + finalRotation;
  const spinDuration = 3500;

  let segmentsHtml = '';
  wheelSegs.forEach((seg, i) => {
    const angle = i * 30;
    const midAngle = angle + 15;
    const radius = 80;
    const x = 100 + radius * Math.cos((midAngle - 90) * Math.PI / 180);
    const y = 100 + radius * Math.sin((midAngle - 90) * Math.PI / 180);
    segmentsHtml += '<div class="wheel-label" style="left:' + x + 'px; top:' + y + 'px; transform:translate(-50%,-50%) rotate(' + (midAngle + 90) + 'deg);">' + seg.label + '</div>';
  });

  const wonColor = won ? '#00e701' : '#ff4d4d';
  const winningSeg = wheelSegs[winningIndex];

  display.innerHTML =
    '<div class="wheel-result">' +
    '<div class="wheel-container">' +
    '<div id="wheel-spin" class="wheel-spin" style="background:conic-gradient(' +
    wheelSegs.map((s, i) => WHEEL_COLORS[s.color] + ' ' + (i * 30) + 'deg ' + ((i + 1) * 30) + 'deg' + (i < 11 ? ',' : '')).join('') +
    ');">' +
    segmentsHtml +
    '<div class="wheel-pointer"></div>' +
    '<div class="wheel-center"></div>' +
    '</div>' +
    '</div>' +
    '<div id="wheel-multiplier" class="wheel-multiplier">Spinning...</div>' +
    '<div id="wheel-subtext" class="wheel-subtext">Waiting for the wheel to stop...</div>' +
    '</div>';

  if (GameRenderers.wheelHistory && GameRenderers.wheelHistory.length > 0) {
    display.innerHTML += '<div class="wheel-history"><div class="history-title">Previous</div><div class="history-items">';
    GameRenderers.wheelHistory.slice(0, 8).forEach(h => {
      display.innerHTML += '<div class="history-item ' + (h.won ? 'h-win' : 'h-loss') + '">' + h.value + 'x</div>';
    });
    display.innerHTML += '</div></div>';
  }

  playSound('spin');

  const wheel = document.getElementById('wheel-spin');
  if (wheel) {
    setTimeout(() => {
      wheel.style.transform = 'rotate(' + totalRotation + 'deg)';
    }, 50);
  }

  GameRenderers.addWheelHistory(multiplier, won);

  setTimeout(() => {
    const multEl = document.getElementById('wheel-multiplier');
    const subEl = document.getElementById('wheel-subtext');
    if (multEl) {
      multEl.textContent = multiplier.toFixed(2) + 'x';
      multEl.style.color = wonColor;
    }
    if (subEl) {
      subEl.innerHTML = 'Landed on <span style="color:' + WHEEL_COLORS[winningSeg.color] + '; font-weight:800;">' + winningSeg.color.toLowerCase() + '</span> — ' +
        '<span style="color:' + wonColor + '; font-weight:800;">' + (won ? '🎯 ' + multiplier.toFixed(2) + 'x WIN' : '💥 NO WIN') + '</span>';
    }
    const wheelEl = document.getElementById('wheel-spin');
    if (wheelEl) {
      wheelEl.style.boxShadow = '0 0 30px rgba(' + (won ? '0,231,1' : '255,77,77') + ',0.6)';
    }
    if (won) playSound('win'); else playSound('loss');
  }, spinDuration);
};

GameRenderers.addWheelHistory = function(multiplier, won) {
  if (!GameRenderers.wheelHistory) GameRenderers.wheelHistory = [];
  GameRenderers.wheelHistory.unshift({ value: multiplier.toFixed(2), won, time: Date.now() });
  GameRenderers.wheelHistory = GameRenderers.wheelHistory.slice(0, 15);
};
