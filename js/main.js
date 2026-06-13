'use strict';

/* Contrôleur principal : écrans, menu, options, calibration, entrées. */

const $ = id => document.getElementById(id);

const DEFAULT_SETTINGS = {
  offsetMs: 0,
  speed: 6,
  volMusic: 80,
  volSfx: 70,
  hitSound: true,
  keys: ['KeyD', 'KeyF', 'KeyJ', 'KeyK'],
  keysX: ['KeyS', 'KeyL'], // lanes bonus gauche / droite
  tutorialDone: false,
  menuView: 'list', // list | grid
  mods: [], // mods de gameplay actifs (ids de GAME_MODS)
};

const GRID_ROWS = 3; // doit suivre grid-template-rows de #song-list.grid-mode

const STYLE_NAMES = {
  wave: 'Synthwave', house: 'House', chip: 'Chiptune', dnb: "Drum'n'bass",
  trance: 'Trance', funk: 'Funk', hard: 'Hardcore', lofi: 'Lo-fi', dub: 'Dubstep',
  techno: 'Techno', trap: 'Trap', metal: 'Métal', disco: 'Disco',
  reggae: 'Reggae', swing: 'Swing', orch: 'Orchestral', psy: 'Psytrance',
};

const MOD_NAMES = {
  roll: 'Roulements', shold: 'Holds mobiles', wide: 'Notes doubles', ghost: 'Fantômes',
};

const FX_NAMES = {
  sway: 'Glissement', split2: 'Scission ×2', split4: 'Scission ×4', split6: 'Scission ×6',
  tilt: 'Bascule', wave: 'Ondulation', pulse: 'Pulsation',
  shake: 'Secousses', orbit: 'Caméra', stutter: 'Latence', portal: 'Portail',
  dance: 'Danse', scatter: 'Dispersion', swap: 'Échangeur',
};

const App = {
  engine: new AudioEngine(),
  settings: { ...DEFAULT_SETTINGS },
  scores: {},
  state: 'title', // title | menu | game | results | calib
  game: null,
  selected: 0,
  lastResult: null,
  keyListen: null,
  cards: [],
  view: [], // liste filtrée affichée dans le menu
  filters: { q: '', style: 'all', stars: 'all', fx: 'all', fxSel: new Set() },
  menuRaf: 0,
  menuMusicActive: false,

  /* ---------- Initialisation ---------- */

  init() {
    this.load();
    this.engine.setVolumes(this.settings.volMusic / 100, this.settings.volSfx / 100);

    document.addEventListener('keydown', e => this.onKeyDown(e));
    document.addEventListener('keyup', e => this.onKeyUp(e));
    $('btn-home-solo').addEventListener('click', () => this.launchMode('solo'));
    $('btn-back').addEventListener('click', () => this.goHome());

    // la musique de menu joue aussi sur l'accueil — mais le navigateur exige
    // un premier geste utilisateur avant d'autoriser l'audio
    const firstGesture = () => {
      if (this.state === 'title') {
        this.engine.ensure();
        this.playMenuMusic();
      }
    };
    document.addEventListener('pointerdown', firstGesture, { once: true });
    document.addEventListener('keydown', firstGesture, { once: true });

    // changement d'onglet / fenêtre minimisée : pause + silence
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.state === 'game' && this.game && this.game.state === 'play') {
          this.game.pause(); // met en pause ET suspend l'audio
        } else {
          this.engine.pause();
        }
      } else if (this.state !== 'game') {
        // en jeu, on reste en pause : c'est au joueur de reprendre
        this.engine.resume();
      }
    });

    $('btn-settings').addEventListener('click', () => this.openSettings());
    $('btn-calib').addEventListener('click', () => this.openCalib());
    $('btn-view').addEventListener('click', () => this.toggleView());
    // en vue grille, la molette fait défiler horizontalement
    $('song-list').addEventListener('wheel', e => {
      if (this.settings.menuView !== 'grid') return;
      e.preventDefault();
      $('song-list').scrollLeft += e.deltaY + e.deltaX;
    }, { passive: false });
    $('btn-close-settings').addEventListener('click', () => this.closeSettings());
    $('btn-calib-from-settings').addEventListener('click', () => { this.closeSettings(); this.openCalib(); });
    $('btn-reset-progress').addEventListener('click', e => this.resetProgress(e.currentTarget));

    $('btn-pause-resume').addEventListener('click', () => this.game && this.game.resume());
    $('btn-pause-retry').addEventListener('click', () => this.retry());
    $('btn-pause-quit').addEventListener('click', () => this.quitToMenu());
    $('btn-fail-retry').addEventListener('click', () => this.retry());
    $('btn-fail-quit').addEventListener('click', () => this.quitToMenu());

    $('btn-res-retry').addEventListener('click', () => this.retry());
    $('btn-res-menu').addEventListener('click', () => this.quitToMenu());
    $('btn-res-next').addEventListener('click', () => this.playNext());

    $('btn-calib-apply').addEventListener('click', () => Calib.apply());
    $('btn-calib-redo').addEventListener('click', () => Calib.restart());

    this.initSettingsUI();
    this.initFilters();
    this.initModsUI();
    this.buildMenu();
  },

  /* ---------- Filtres et recherche ---------- */

  initFilters() {
    const styleSel = $('f-style');
    for (const [k, v] of Object.entries(STYLE_NAMES)) {
      const o = document.createElement('option');
      o.value = k; o.textContent = v;
      styleSel.appendChild(o);
    }
    $('f-search').addEventListener('input', () => {
      this.filters.q = $('f-search').value;
      this.refilter();
    });
    styleSel.addEventListener('change', () => {
      this.filters.style = styleSel.value;
      this.refilter();
    });
    $('f-stars').addEventListener('change', () => {
      this.filters.stars = $('f-stars').value;
      this.refilter();
    });
    $('f-fx').addEventListener('change', () => {
      this.filters.fx = $('f-fx').value;
      $('f-fx-panel').classList.toggle('hidden', this.filters.fx !== 'pick');
      this.refilter();
    });
    const panel = $('f-fx-panel');
    for (const [k, v] of Object.entries(FX_NAMES)) {
      const b = document.createElement('button');
      b.className = 'fchip';
      b.textContent = '✨ ' + v;
      b.addEventListener('click', () => {
        if (this.filters.fxSel.has(k)) this.filters.fxSel.delete(k);
        else this.filters.fxSel.add(k);
        b.classList.toggle('on', this.filters.fxSel.has(k));
        this.refilter();
      });
      panel.appendChild(b);
    }
  },

  viewList() {
    const f = this.filters;
    const q = f.q.trim().toLowerCase();
    return this.menuList().filter(s => {
      if (q && !(s.title.toLowerCase().includes(q) || s.sub.toLowerCase().includes(q) ||
        (STYLE_NAMES[s.style] || '').toLowerCase().includes(q))) return false;
      if (f.style !== 'all' && s.style !== f.style) return false;
      if (f.stars !== 'all') {
        if (s.tutorial) return false;
        const [lo, hi] = f.stars.split('-').map(Number);
        if (s.stars < lo || s.stars > hi) return false;
      }
      const fx = s.fx || [];
      if (f.fx === 'any' && !fx.length) return false;
      if (f.fx === 'none' && fx.length) return false;
      if (f.fx === 'pick' && f.fxSel.size && !fx.some(x => f.fxSel.has(x))) return false;
      return true;
    });
  },

  // reconstruit la liste en conservant la sélection si elle survit au filtre
  refilter() {
    const cur = this.view[this.selected];
    this.buildMenu();
    const i = cur ? this.view.indexOf(cur) : -1;
    if (i >= 0) {
      this.selected = i;
      this.updateSelection(true);
    }
  },

  /* ---------- Mods de gameplay ---------- */

  initModsUI() {
    const list = $('mods-list');
    for (const [id, m] of Object.entries(GAME_MODS)) {
      const row = document.createElement('button');
      row.className = 'modrow';
      row.id = 'mod-' + id;
      row.innerHTML = `<span class="mr-icon">${m.icon}</span><span class="mr-name">${m.name}</span>` +
        `<span class="mr-desc">${m.desc}</span><span class="mr-mult">×${m.mult.toFixed(2)}</span>`;
      row.addEventListener('click', () => this.toggleMod(id));
      list.appendChild(row);
    }
    $('btn-mods').addEventListener('click', () => $('modal-mods').classList.remove('hidden'));
    $('btn-close-mods').addEventListener('click', () => $('modal-mods').classList.add('hidden'));
    $('btn-mods-clear').addEventListener('click', () => {
      this.settings.mods = [];
      this.save();
      this.refreshModsUI();
    });
    this.refreshModsUI();
  },

  toggleMod(id) {
    const mods = new Set(this.settings.mods || []);
    if (mods.has(id)) {
      mods.delete(id);
    } else {
      for (const ex of (GAME_MODS[id].excl || [])) mods.delete(ex); // mods incompatibles
      mods.add(id);
    }
    this.settings.mods = [...mods];
    this.save();
    this.engine.uiSound(640);
    this.refreshModsUI();
  },

  refreshModsUI() {
    const mods = this.settings.mods || [];
    for (const id of Object.keys(GAME_MODS)) {
      $('mod-' + id).classList.toggle('on', mods.includes(id));
    }
    let mult = 1;
    mods.forEach(id => { mult *= GAME_MODS[id].mult; });
    $('mods-mult').textContent = '×' + mult.toFixed(2);
    $('btn-mods').textContent = mods.length
      ? `🎛 Mods (${mods.map(id => GAME_MODS[id].icon).join('')})`
      : '🎛 Mods';
  },

  load() {
    try {
      const s = JSON.parse(localStorage.getItem('pulsekeys_settings'));
      if (s) this.settings = { ...DEFAULT_SETTINGS, ...s };
      const sc = JSON.parse(localStorage.getItem('pulsekeys_scores'));
      if (sc) this.scores = sc;
    } catch (e) { /* stockage corrompu : on repart à zéro */ }
  },

  save() {
    localStorage.setItem('pulsekeys_settings', JSON.stringify(this.settings));
    localStorage.setItem('pulsekeys_scores', JSON.stringify(this.scores));
  },

  /* ---------- Écrans ---------- */

  setScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    $('screen-' + name).classList.add('active');
  },

  enterMenu() {
    this.engine.ensure();
    if (this.state === 'title') this.engine.uiSound(520);
    this.state = 'menu';
    this.buildMenu();
    this.setScreen('menu');
    this.startMenuBg();
    this.playMenuMusic();
  },

  // lancement d'un mode depuis l'accueil : la tuile "pop", puis fondu simple
  launchMode(mode) {
    if (this.transitioning || mode !== 'solo') return;
    this.transitioning = true;
    this.engine.ensure();
    this.engine.uiSound(600);
    const tile = $('btn-home-solo');
    tile.classList.add('launching');
    const tr = $('transition');
    setTimeout(() => tr.classList.add('show'), 130); // fondu vers le noir
    setTimeout(() => {
      tile.classList.remove('launching');
      this.enterMenu();
      tr.classList.remove('show'); // fondu de retour à l'écran
      this.transitioning = false;
    }, 380);
  },

  // retour à l'accueil — la musique de menu continue, elle y joue aussi
  goHome() {
    this.state = 'title';
    this.setScreen('title');
    this.engine.uiSound(480);
    this.playMenuMusic();
  },

  /* ---------- Musique de menu (boucle chill) ---------- */

  playMenuMusic() {
    if (this.menuMusicActive) return;
    const m = Composer.menuMusic();
    this.engine.startSong(m.events, m.spb, 0.4, 'lofi', m.loopBeats);
    this.menuMusicActive = true;
  },

  stopMenuMusic() {
    if (!this.menuMusicActive) return;
    this.engine.stopSong();
    this.menuMusicActive = false;
  },

  /* ---------- Menu des morceaux ---------- */

  // liste affichée : le tutoriel en tête, puis les 30 morceaux
  menuList() {
    return [TUTORIAL_DEF, ...SONGS];
  },

  // tous les morceaux sont jouables d'emblée, aucune condition de déblocage
  isUnlocked() {
    return true;
  },

  buildMenu() {
    this.view = this.viewList();
    this.selected = Util.clamp(this.selected, 0, Math.max(0, this.view.length - 1));
    const list = $('song-list');
    list.className = this.settings.menuView === 'grid' ? 'grid-mode' : 'list-mode';
    $('btn-view').textContent = this.settings.menuView === 'grid' ? '☰ Liste' : '▦ Grille';
    list.innerHTML = '';
    this.cards = [];
    if (!this.view.length) {
      list.innerHTML = '<div class="no-result">Aucun morceau ne correspond aux filtres.</div>';
    }
    this.view.forEach((s, i) => {
      const unlocked = this.isUnlocked(i);
      const card = document.createElement('div');
      card.className = 'song-card' + (unlocked ? '' : ' locked') + (s.tutorial ? ' tutorial-card' : '');
      card.style.setProperty('--hue', s.hue);
      const best = this.scores[s.id];
      const grade = best ? `<span class="sc-grade">${best.grade}</span>` : '';
      const fxMark = s.fx && s.fx.length ? '<span class="sc-fx" title="Effets spéciaux">✨</span>' : '';
      const lock = unlocked ? '' : '<span class="sc-lock">🔒</span>';
      const meta = s.tutorial
        ? `<span class="song-stars">📖 Tutoriel</span>`
        : `<span class="song-stars">★ ${s.stars}</span><span class="song-bpm">${s.bpm} BPM</span>`;
      card.innerHTML =
        `<div class="sc-top"><h3>${s.title}</h3>${fxMark}${grade}${lock}</div>` +
        `<div class="song-sub">${s.sub}</div>` +
        `<div class="song-meta">${meta}</div>`;
      // à la lazer : un clic sélectionne, un second clic lance
      card.addEventListener('click', () => {
        if (!unlocked) return;
        if (this.selected === i) {
          this.startSong(s);
        } else {
          this.selected = i;
          this.engine.uiSound(620);
          this.updateSelection();
        }
      });
      list.appendChild(card);
      this.cards.push(card);
    });
    this.updateSelection(true);
  },

  updateSelection(instant) {
    this.cards.forEach((c, i) => c.classList.toggle('selected', i === this.selected));
    const sel = this.cards[this.selected];
    if (sel) sel.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: instant ? 'auto' : 'smooth' });
    this.renderInfo();
  },

  renderInfo() {
    const s = this.view[this.selected];
    if (!s) {
      $('menu-info').innerHTML = '<div class="mi-card"><h2>Aucun résultat</h2>' +
        '<p class="mi-sub">Modifiez la recherche ou les filtres.</p></div>';
      return;
    }
    const unlocked = this.isUnlocked(this.selected);
    const best = this.scores[s.id];
    let chips;
    if (s.tutorial) {
      chips = `<span class="chip">📖 Interactif</span><span class="chip">Toutes les mécaniques</span>`;
    } else {
      const beats = (Array.isArray(s.form) ? s.form : FORMS[s.form]).length * 16;
      const secs = Math.round(beats * 60 / s.bpm);
      const durTxt = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      chips = `<span class="chip stars-chip">★ ${s.stars}</span><span class="chip">${s.bpm} BPM</span>` +
        `<span class="chip">${durTxt}</span><span class="chip">${STYLE_NAMES[s.style] || s.style}</span>`;
    }
    const badges = [];
    if (!s.tutorial && s.mods && s.mods.length) {
      badges.push(...s.mods.map(m => `<span class="mod">${MOD_NAMES[m] || m}</span>`));
    }
    if (!s.tutorial && s.fx && s.fx.length) {
      badges.push(...s.fx.map(f => `<span class="mod fxmod">✨ ${FX_NAMES[f] || f}</span>`));
    }
    const mods = badges.length ? `<div class="mi-mods">${badges.join('')}</div>` : '';
    let bestHtml;
    if (!unlocked) {
      bestHtml = `<div class="mi-best locked-hint">🔒 Terminez d'autres morceaux pour débloquer</div>`;
    } else if (s.tutorial) {
      bestHtml = `<div class="mi-best">${this.settings.tutorialDone ? '✓ Terminé — rejouable à volonté' : 'Recommandé pour commencer !'}</div>`;
    } else if (best) {
      bestHtml = `<div class="mi-best"><span class="bgrade">${best.grade}</span>` +
        `<span>${Util.fmtScore(best.score)} pts</span><span>${best.acc.toFixed(1)}%</span><span>×${best.combo}</span></div>`;
    } else {
      bestHtml = `<div class="mi-best">Jamais joué</div>`;
    }
    $('menu-info').innerHTML =
      `<div class="mi-card${s.tutorial ? ' tut' : ''}" style="--hue:${s.hue}">` +
      `<h2>${s.title}</h2><p class="mi-sub">${s.sub}</p>` +
      `<div class="mi-chips">${chips}</div>${mods}${bestHtml}` +
      `<button id="btn-play" class="btn primary"${unlocked ? '' : ' disabled'}>Jouer <kbd>⏎</kbd></button></div>`;
    $('btn-play').addEventListener('click', () => {
      if (unlocked) this.startSong(s);
    });
  },

  // fond animé du menu : le thème du morceau sélectionné, pulsé à son tempo
  startMenuBg() {
    cancelAnimationFrame(this.menuRaf);
    const c = $('menu-bg');
    const g = c.getContext('2d');
    const loop = () => {
      if (this.state !== 'menu') return;
      this.menuRaf = requestAnimationFrame(loop);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.floor(innerWidth * dpr), h = Math.floor(innerHeight * dpr);
      if (c.width !== w || c.height !== h) {
        c.width = w; c.height = h;
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      const s = this.view[this.selected] || TUTORIAL_DEF;
      const t = performance.now() / 1000;
      const pulse = Math.pow(1 - ((t * s.bpm / 60) % 1), 2.2) * 0.7;
      g.fillStyle = '#06070d';
      g.fillRect(0, 0, innerWidth, innerHeight);
      BG.draw(g, s.bg || 'stars', { W: innerWidth, H: innerHeight, hue: s.hue, t, pulse });
    };
    loop();
  },

  toggleView() {
    this.settings.menuView = this.settings.menuView === 'grid' ? 'list' : 'grid';
    this.save();
    this.engine.uiSound(680);
    this.buildMenu();
  },

  moveSelection(step) {
    const n = this.view.length;
    if (!n) return;
    const dir = Math.sign(step);
    let i = Util.clamp(this.selected + step, 0, n - 1);
    while (i > 0 && i < n - 1 && !this.isUnlocked(i)) i += dir;
    if (!this.isUnlocked(i)) i = this.selected;
    if (i !== this.selected) {
      this.selected = i;
      this.engine.uiSound(620);
      this.updateSelection();
    }
  },

  /* ---------- Partie ---------- */

  startSong(def) {
    this.engine.ensure();
    this.menuMusicActive = false; // le morceau remplace la boucle du menu
    this.engine.uiSound(760);
    if (this.game) this.game.destroy();
    $('pause-overlay').classList.add('hidden');
    $('fail-overlay').classList.add('hidden');
    this.game = new Game(this, def);
    this.state = 'game';
    this.setScreen('game');
    this.game.start();
  },

  retry() {
    if (!this.game) return;
    const def = this.game.def;
    this.game.destroy();
    this.game = null;
    this.startSong(def);
  },

  quitToMenu() {
    if (this.game) { this.game.destroy(); this.game = null; }
    this.enterMenu();
  },

  playNext() {
    if (!this.lastResult) return;
    const i = SONGS.indexOf(this.lastResult.def);
    if (i >= 0 && i + 1 < SONGS.length) {
      const next = SONGS[i + 1];
      const vi = this.view.indexOf(next); // peut être hors filtre : pas grave
      if (vi >= 0) this.selected = vi;
      this.startSong(next);
    }
  },

  onGameEnd(result) {
    this.lastResult = result;
    if (this.game) { this.game.destroy(); this.game = null; }

    const unranked = (result.mods || []).includes('auto');
    let isRecord = false;
    if (result.def.tutorial) {
      this.settings.tutorialDone = true;
      this.save();
    } else if (unranked) {
      // autopilote : partie non classée, rien n'est sauvegardé
    } else {
      const id = result.def.id;
      const prev = this.scores[id];
      isRecord = !prev || result.score > prev.score;
      this.scores[id] = {
        clears: (prev ? prev.clears : 0) + 1,
        score: isRecord ? result.score : prev.score,
        acc: isRecord ? result.acc : prev.acc,
        grade: isRecord ? result.grade : prev.grade,
        combo: Math.max(result.maxCombo, prev ? prev.combo : 0),
      };
      this.save();
    }

    const modIcons = (result.mods || []).map(id => GAME_MODS[id] ? GAME_MODS[id].icon : '').join(' ');
    $('res-title').textContent = result.def.tutorial
      ? 'Tutoriel terminé !'
      : `${result.def.title} — ★ ${result.def.stars}` +
        (modIcons ? `  ${modIcons}` : '') + (unranked ? ' (non classé)' : '');
    $('res-grade').textContent = result.grade;
    $('res-grade').classList.toggle('gF', result.grade === 'D');
    $('res-score').textContent = Util.fmtScore(result.score);
    $('res-acc').textContent = result.acc.toFixed(2) + '%';
    $('res-combo').textContent = result.maxCombo;
    $('res-perfect').textContent = result.counts.PERFECT;
    $('res-great').textContent = result.counts.GREAT;
    $('res-good').textContent = result.counts.GOOD;
    $('res-miss').textContent = result.counts.MISS;
    $('res-bomb').textContent = result.counts.BOMB;
    $('res-record').classList.toggle('hidden', !isRecord);

    const i = SONGS.indexOf(result.def); // -1 pour le tutoriel
    const hasNext = i >= 0 && i + 1 < SONGS.length && this.isUnlocked(i + 2);
    $('btn-res-next').classList.toggle('hidden', !hasNext);

    this.state = 'results';
    this.setScreen('results');
    this.engine.uiSound(880);
  },

  /* ---------- Options ---------- */

  initSettingsUI() {
    const s = this.settings;
    const bind = (id, key, fmt, after) => {
      const el = $(id);
      el.value = s[key];
      $(id + '-val').textContent = fmt(s[key]);
      el.addEventListener('input', () => {
        s[key] = Number(el.value);
        $(id + '-val').textContent = fmt(s[key]);
        if (after) after();
        this.save();
      });
    };
    bind('set-offset', 'offsetMs', v => `${v > 0 ? '+' : ''}${v} ms`);
    bind('set-speed', 'speed', v => v);
    bind('set-music', 'volMusic', v => v + '%', () => this.applyVolumes());
    bind('set-sfx', 'volSfx', v => v + '%', () => this.applyVolumes());

    const hs = $('set-hitsound');
    hs.checked = s.hitSound;
    hs.addEventListener('change', () => { s.hitSound = hs.checked; this.save(); });

    for (let i = 0; i < 4; i++) {
      const btn = $('key-' + i);
      btn.textContent = Util.keyLabel(s.keys[i]);
      btn.addEventListener('click', () => this.listenKey('keys', i));
    }
    for (let i = 0; i < 2; i++) {
      const btn = $('key-x' + i);
      btn.textContent = Util.keyLabel(s.keysX[i]);
      btn.addEventListener('click', () => this.listenKey('keysX', i));
    }
  },

  // lane pour un code touche : 0..3 principales, -1 / 4 lanes bonus
  laneOf(code) {
    const i = this.settings.keys.indexOf(code);
    if (i >= 0) return i;
    const x = this.settings.keysX.indexOf(code);
    if (x >= 0) return x === 0 ? -1 : 4;
    return null;
  },

  _keyBtn(arr, idx) {
    return $(arr === 'keys' ? 'key-' + idx : 'key-x' + idx);
  },

  applyVolumes() {
    this.engine.setVolumes(this.settings.volMusic / 100, this.settings.volSfx / 100);
  },

  refreshSettingsUI() {
    const s = this.settings;
    $('set-offset').value = s.offsetMs;
    $('set-offset-val').textContent = `${s.offsetMs > 0 ? '+' : ''}${s.offsetMs} ms`;
  },

  openSettings() {
    this.refreshSettingsUI();
    $('modal-settings').classList.remove('hidden');
  },

  closeSettings() {
    this.cancelKeyListen();
    $('modal-settings').classList.add('hidden');
  },

  listenKey(arr, idx) {
    this.cancelKeyListen();
    this.keyListen = { arr, idx };
    const btn = this._keyBtn(arr, idx);
    btn.classList.add('listening');
    btn.textContent = '…';
  },

  cancelKeyListen() {
    if (this.keyListen) {
      const { arr, idx } = this.keyListen;
      this.keyListen = null;
      const btn = this._keyBtn(arr, idx);
      btn.classList.remove('listening');
      btn.textContent = Util.keyLabel(this.settings[arr][idx]);
    }
  },

  resetProgress(btn) {
    if (btn.dataset.confirm) {
      this.scores = {};
      this.save();
      delete btn.dataset.confirm;
      btn.textContent = 'Effacer la progression';
      this.buildMenu();
    } else {
      btn.dataset.confirm = '1';
      btn.textContent = 'Confirmer ?';
      setTimeout(() => {
        delete btn.dataset.confirm;
        btn.textContent = 'Effacer la progression';
      }, 2500);
    }
  },

  openCalib() {
    this.stopMenuMusic(); // le métronome a besoin de silence
    this.state = 'calib';
    this.setScreen('calib');
    Calib.open();
  },

  /* ---------- Clavier ---------- */

  onKeyDown(e) {
    // saisie dans un champ (recherche, filtres) : on laisse le champ gérer
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT') {
      if (e.code === 'Escape') e.target.blur();
      return;
    }
    if (!$('modal-mods').classList.contains('hidden')) {
      if (e.code === 'Escape') $('modal-mods').classList.add('hidden');
      return;
    }
    // capture d'une nouvelle touche dans les options
    if (this.keyListen) {
      e.preventDefault();
      const taken = [...this.settings.keys, ...this.settings.keysX];
      if (e.code !== 'Escape' && !taken.includes(e.code)) {
        this.settings[this.keyListen.arr][this.keyListen.idx] = e.code;
        this.save();
      }
      this.cancelKeyListen();
      return;
    }
    if (!$('modal-settings').classList.contains('hidden')) {
      if (e.code === 'Escape') this.closeSettings();
      return;
    }

    switch (this.state) {
      case 'title':
        if (e.code === 'Enter' || e.code === 'Space') this.launchMode('solo');
        break;

      case 'menu': {
        // en grille, gauche/droite saute une colonne (3 morceaux)
        const hStep = this.settings.menuView === 'grid' ? GRID_ROWS : 1;
        if (e.code === 'ArrowDown') { e.preventDefault(); this.moveSelection(1); }
        else if (e.code === 'ArrowUp') { e.preventDefault(); this.moveSelection(-1); }
        else if (e.code === 'ArrowRight') { e.preventDefault(); this.moveSelection(hStep); }
        else if (e.code === 'ArrowLeft') { e.preventDefault(); this.moveSelection(-hStep); }
        else if (e.code === 'KeyG') this.toggleView();
        else if (e.code === 'Escape') this.goHome();
        else if (e.code === 'Enter') {
          const sel = this.view[this.selected];
          if (sel) this.startSong(sel);
        }
        break;
      }

      case 'game': {
        if (e.repeat) return;
        const g = this.game;
        if (!g) break;
        if (g.state === 'failed') {
          if (e.code === 'KeyR') this.retry();
          else if (e.code === 'Escape') this.quitToMenu();
          break;
        }
        if (e.code === 'Escape') {
          e.preventDefault();
          if (g.state === 'paused') g.resume(); else g.pause();
          break;
        }
        if (g.state === 'paused') {
          if (e.code === 'KeyR') this.retry();
          else if (e.code === 'KeyQ') this.quitToMenu();
          break;
        }
        const lane = this.laneOf(e.code);
        if (lane !== null) {
          e.preventDefault();
          g.onLane(lane, true);
        }
        break;
      }

      case 'results':
        if (e.code === 'KeyR') this.retry();
        else if (e.code === 'Escape') this.quitToMenu();
        else if (e.code === 'Enter' && !$('btn-res-next').classList.contains('hidden')) this.playNext();
        break;

      case 'calib':
        Calib.onKey(e);
        break;
    }
  },

  onKeyUp(e) {
    if (this.state === 'game' && this.game) {
      const lane = this.laneOf(e.code);
      if (lane !== null) this.game.onLane(lane, false);
    }
  },
};

/* ---------- Calibration automatique ---------- */

const Calib = {
  BPM: 90,
  WARMUP: 4,
  COUNT: 12,
  taps: [],
  running: false,
  result: null,
  raf: 0,

  open() {
    this.taps = [];
    this.running = false;
    this.result = null;
    $('calib-status').innerHTML = 'Appuyez sur <kbd>Espace</kbd> pour démarrer';
    $('calib-last').textContent = '';
    $('calib-result').classList.add('hidden');
    this.buildDots();
    this._resize();
    this._onResize = () => this._resize();
    window.addEventListener('resize', this._onResize);
    const loop = () => { this.raf = requestAnimationFrame(loop); this.draw(); };
    loop();
  },

  close() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this._onResize);
    App.engine.stopMetronome();
    this.running = false;
  },

  start() {
    this.taps = [];
    this.result = null;
    this.running = true;
    $('calib-result').classList.add('hidden');
    $('calib-status').textContent = 'Tapez Espace sur chaque tic…';
    $('calib-last').textContent = '';
    this.buildDots();
    App.engine.startMetronome(this.BPM);
  },

  restart() { this.start(); },

  buildDots() {
    const total = this.WARMUP + this.COUNT;
    const dots = $('calib-dots');
    dots.innerHTML = '';
    for (let i = 0; i < total; i++) {
      const dot = document.createElement('i');
      if (i < this.taps.length) dot.className = i < this.WARMUP ? 'warm' : 'done';
      dots.appendChild(dot);
    }
  },

  tap() {
    if (!this.running) { this.start(); return; }
    const delta = App.engine.nearestTickDelta(App.engine.ctx.currentTime);
    if (delta === null) return;
    this.taps.push(delta);
    const ms = Math.round(delta * 1000);
    const phase = this.taps.length <= this.WARMUP ? ' (échauffement)' : '';
    $('calib-last').textContent = `${ms > 0 ? '+' : ''}${ms} ms${phase}`;
    this.buildDots();
    const remaining = this.WARMUP + this.COUNT - this.taps.length;
    if (remaining > 0) {
      $('calib-status').textContent = `Encore ${remaining} frappe${remaining > 1 ? 's' : ''}…`;
    } else {
      this.finish();
    }
  },

  finish() {
    this.running = false;
    App.engine.stopMetronome();
    const useful = this.taps.slice(this.WARMUP);
    this.result = Math.round(Util.median(useful) * 1000);
    $('calib-status').textContent = 'Calibration terminée !';
    $('calib-offset-val').textContent = `${this.result > 0 ? '+' : ''}${this.result} ms`;
    $('calib-result').classList.remove('hidden');
  },

  apply() {
    if (this.result === null) return;
    App.settings.offsetMs = Util.clamp(this.result, -150, 150);
    App.save();
    App.engine.uiSound(880);
    this.close();
    App.enterMenu();
  },

  onKey(e) {
    if (e.code === 'Space') {
      e.preventDefault();
      if (e.repeat) return;
      if (this.result === null) this.tap();
    } else if (e.code === 'Escape') {
      this.close();
      App.enterMenu();
    } else if (e.code === 'Enter' && this.result !== null) {
      this.apply();
    } else if (e.code === 'KeyR' && this.result !== null) {
      this.restart();
    }
  },

  _resize() {
    const c = $('calib-canvas');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.floor(innerWidth * dpr);
    c.height = Math.floor(innerHeight * dpr);
    c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  },

  draw() {
    const c = $('calib-canvas');
    const g = c.getContext('2d');
    const W = innerWidth, H = innerHeight;
    g.clearRect(0, 0, W, H);

    const m = App.engine.metro;
    let phase = 0;
    if (m && m.ticks.length && App.engine.ctx) {
      const now = App.engine.ctx.currentTime;
      const first = m.ticks[0];
      if (now > first) phase = ((now - first) % m.interval) / m.interval;
    }
    const pulse = this.running ? Math.pow(1 - phase, 2) : 0.15;
    const cx = W / 2, cy = H * 0.78;
    const r = 34 + pulse * 26;

    g.strokeStyle = `hsla(195, 100%, 65%, ${0.25 + pulse * 0.7})`;
    g.lineWidth = 3;
    g.beginPath(); g.arc(cx, cy, r, 0, 7); g.stroke();

    g.fillStyle = `hsla(195, 100%, 65%, ${0.12 + pulse * 0.45})`;
    g.beginPath(); g.arc(cx, cy, r * 0.62, 0, 7); g.fill();
  },
};

window.addEventListener('DOMContentLoaded', () => App.init());
