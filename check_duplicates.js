fetch('http://localhost:3000/account')
  .then(r => r.text())
  .then(t => {
    const lines = t.split('\n');
    lines.forEach((line, i) => {
      if (line.includes('id="global-bets-drawer"')) {
        console.log((i+1) + ': ' + line.trim());
      }
    });
    console.log('Total lines:', lines.length);
  })
  .catch(e => console.log('Error:', e.message));
