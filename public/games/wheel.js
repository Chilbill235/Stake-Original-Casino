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
  const finalRotation = ((winningIndex * 30) + 15) % 360;
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
    segmentsHtml += '<div style="position:absolute; left:' + x + 'px; top:' + y + 'px; transform:translate(-50%,-50%); font-size:0.55rem; font-weight:700; color:rgba(255,255,255,0.7); text-shadow:0 0 3px rgba(0,0,0,.8); pointer-events:none; white-space:nowrap; text-shadow:0 0 3px rgba(0,0,0,.9);">' + seg.label + '</div>';
  });

  const wonColor = won ? '#00e701' : '#ff4d4d';
  const winningSeg = wheelSegs[winningIndex];

  display.innerHTML =
    '<div id="wheel-result" style="text-align:center;padding:10px;position:relative;">' +
    '<div id="wheel-spin" style="position:relative; width:min(230px,55vw); height:min(230px,55vw); margin:20px auto; border-radius:50%; background:conic-gradient(' +
    wheelSegs.map((s, i) => WHEEL_COLORS[s.color] + ' ' + (i * 30) + 'deg ' + ((i + 1) * 30) + 'deg' + (i < 11 ? ',' : '')).join('') +
    '); border:5px solid #243542; box-shadow:0 0 24px rgba(0,0,0,.6); transition:transform ' + spinDuration + 'ms cubic-bezier(0.25,0.1,0.25,1); transform:rotate(0deg); cursor:default;">' +
    segmentsHtml +
    '<div style="position:absolute; top:-14px; left:50%; transform:translateX(-50%); width:0; height:0; border-left:10px solid transparent; border-right:10px solid transparent; border-top:16px solid #ffc700; filter:drop-shadow(0 0 4px rgba(255,199,0,.8);"></div>' +
    '<div style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); width:14px; height:14px; border-radius:50%; background:#ffc700; box-shadow:0 0 8px rgba(255,199,0,1); z-index:2;"></div>' +
    '</div>' +
    '<div id="wheel-multiplier" style="font-size:2.5rem; font-weight:900; color:#b1bad2; min-height:1.5em; margin:12px 0;">Spinning...</div>' +
    '<div id="wheel-subtext" style="color:#b1bad2; font-weight:600; font-size:0.9rem;">Waiting for the wheel to stop...</div>' +
    '</div>';

  playSound('spin');

  const wheel = document.getElementById('wheel-spin');
  if (wheel) {
    setTimeout(() => {
      wheel.style.transform = 'rotate(' + totalRotation + 'deg)';
    }, 50);
  }

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
