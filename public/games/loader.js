window.GameLoader = {
  loaded: {},

  async init() {
    await this.loadScript('games/shared.js');
  },

  loadScript(path) {
    return new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = path;
      script.onload = () => resolve();
      script.onerror = () => { console.warn('[GameLoader] Failed to load ' + path); resolve(); };
      document.head.appendChild(script);
    });
  },

  load(gameName) {
    const scripts = {
      slots: 'games/slots.js',
      plinko: 'games/plinko.js',
      wheel: 'games/wheel.js',
      crash: 'games/crash.js',
      dice: 'games/dice.js',
      baccarat: 'games/baccarat.js',
      keno: 'games/keno.js',
      tower: 'games/tower.js',
      mines: 'games/mines.js',
      blackjack: 'games/blackjack.js',
      hilo: 'games/hilo.js',
      limbo: 'games/limbo.js'
    };

    return new Promise((resolve) => {
      const scriptPath = scripts[gameName];
      if (!scriptPath) { resolve(); return; }
      if (this.loaded[gameName]) { resolve(); return; }

      const script = document.createElement('script');
      script.src = scriptPath;
      script.onload = () => { this.loaded[gameName] = true; resolve(); };
      script.onerror = () => { console.warn('[GameLoader] Failed to load ' + scriptPath); this.loaded[gameName] = true; resolve(); };
      document.head.appendChild(script);
    });
  }
};

window.GameLoader.init();
