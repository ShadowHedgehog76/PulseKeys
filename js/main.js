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
  menuView: 'list', // list | grid | music
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
  mode: 'solo',   // mode de jeu choisi à l'accueil : solo | rusher
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
    $('btn-home-rusher').addEventListener('click', () => this.launchMode('rusher'));
    $('btn-home-infini').addEventListener('click', () => this.launchMode('infini'));
    $('btn-home-roguelite').addEventListener('click', () => this.launchMode('roguelite'));
    $('btn-back').addEventListener('click', () => this.goHome());
    $('btn-io-again').addEventListener('click', () => { $('infini-over').classList.add('hidden'); Infini.again(); });
    $('btn-io-home').addEventListener('click', () => { $('infini-over').classList.add('hidden'); this.goHome(); });

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
        // ne pas relancer un juke-box que le joueur a volontairement mis en pause
        if (!(this.settings.menuView === 'music' && this.jukeActive && !this.jukePlaying)) {
          this.engine.resume();
        }
      }
    });

    $('btn-settings').addEventListener('click', () => this.openSettings());
    $('btn-calib').addEventListener('click', () => this.openCalib());
    // onglets d'affichage : liste / grille / musique
    document.querySelectorAll('#view-tabs .view-tab').forEach(tab => {
      tab.addEventListener('click', () => this.setView(tab.dataset.view));
    });
    // en vue grille ou musique, la molette fait défiler horizontalement
    $('song-list').addEventListener('wheel', e => {
      if (this.settings.menuView === 'list') return;
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
    this.applyMenuMode();
    this.buildMenu();
    this.setScreen('menu');
    this.startMenuBg();
    // en vue musique, c'est le juke-box qui pilote l'audio (déclenché par buildMenu)
    if (this.settings.menuView !== 'music') this.playMenuMusic();
  },

  // lancement d'un mode depuis l'accueil : la tuile "pop", puis fondu simple
  launchMode(mode) {
    if (this.transitioning || !['solo', 'rusher', 'infini', 'roguelite'].includes(mode)) return;
    this.transitioning = true;
    this.mode = mode;
    this.engine.ensure();
    this.engine.uiSound(600);
    const tileId = { solo: 'btn-home-solo', rusher: 'btn-home-rusher',
      infini: 'btn-home-infini', roguelite: 'btn-home-roguelite' }[mode];
    const tile = $(tileId);
    tile.classList.add('launching');
    const tr = $('transition');
    setTimeout(() => tr.classList.add('show'), 130); // fondu vers le noir
    setTimeout(() => {
      tile.classList.remove('launching');
      // Infini / Roguelite démarrent un run directement ; les autres passent par le menu
      if (mode === 'infini' || mode === 'roguelite') Infini.start(mode);
      else this.enterMenu();
      tr.classList.remove('show'); // fondu de retour à l'écran
      this.transitioning = false;
    }, 380);
  },

  /* ---------- Mode Infini (délégation au contrôleur de run) ---------- */

  onInfiniSegmentDone(game) { Infini.onSegmentDone(game); },
  onInfiniDeath(game) { Infini.onDeath(game); },

  // adapte l'en-tête du menu au mode courant (badge + masque les mods en Rusher)
  applyMenuMode() {
    const rush = this.mode === 'rusher';
    $('btn-mods').style.display = rush ? 'none' : '';
    const count = document.querySelector('.menu-count');
    if (count) {
      count.innerHTML = rush
        ? '<b style="color:hsl(320 100% 72%)">🏁 RUSHER</b> · n\'importe quelle touche · les notes foncent vers la gauche'
        : '70 morceaux + tutoriel · 17 styles · ★1 à ★10';
    }
  },

  // retour à l'accueil — la musique de menu continue, elle y joue aussi
  goHome() {
    this.jukeStop(); // si on écoutait un morceau, on repasse à la boucle d'accueil
    this.state = 'title';
    this.setScreen('title');
    this.engine.uiSound(480);
    this.playMenuMusic();
  },

  /* ---------- Musique de menu (boucle chill) ---------- */

  playMenuMusic() {
    if (this.menuMusicActive) return;
    this.jukeActive = false; this.jukePlaying = false; // le juke-box cède la place
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

  // liste affichée : le tutoriel en tête, puis les morceaux
  // (le tutoriel n'existe pas en mode Rusher : gameplay différent)
  menuList() {
    return this.mode === 'rusher' ? [...SONGS] : [TUTORIAL_DEF, ...SONGS];
  },

  // clé de score : on sépare les classements Solo et Rusher
  scoreKey(s) {
    return (this.mode === 'rusher' ? 'rush::' : '') + s.id;
  },

  // tous les morceaux sont jouables d'emblée, aucune condition de déblocage
  isUnlocked() {
    return true;
  },

  buildMenu() {
    this.view = this.viewList();
    this.selected = Util.clamp(this.selected, 0, Math.max(0, this.view.length - 1));
    const mode = this.settings.menuView;
    const list = $('song-list');
    list.className = mode + '-mode';
    this.refreshViewTabs();
    // la vue musique est un lecteur (juke-box), pas une simple liste
    if (mode === 'music') { this.buildMusicPlayer(); return; }
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
      const best = this.scores[this.scoreKey(s)];
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

  // Vue musique = un vrai lecteur : on ÉCOUTE les morceaux synthétisés
  // (platine + transport + barre de progression) au lieu de juste les choisir.
  buildMusicPlayer() {
    const list = $('song-list');
    this.cards = [];
    if (!this.view.length) {
      list.innerHTML = '<div class="no-result">Aucun morceau ne correspond aux filtres.</div>';
      return;
    }
    list.innerHTML =
      '<div class="juke">' +
        '<div class="juke-stage">' +
          '<div class="juke-vinyl" id="juke-vinyl"><span class="juke-center" id="juke-center"></span></div>' +
          '<div class="juke-now">' +
            '<span class="juke-eyebrow">♪ EN ÉCOUTE</span>' +
            '<h3 class="juke-title" id="juke-title"></h3>' +
            '<p class="juke-meta" id="juke-meta"></p>' +
            '<div class="juke-bar"><i id="juke-fill"></i></div>' +
            '<div class="juke-time"><span id="juke-cur">0:00</span><span id="juke-dur">0:00</span></div>' +
            '<div class="juke-transport">' +
              '<button class="juke-btn" id="juke-prev" title="Précédent">⏮</button>' +
              '<button class="juke-btn juke-main" id="juke-play" title="Lecture / pause">⏸</button>' +
              '<button class="juke-btn" id="juke-next" title="Suivant">⏭</button>' +
              '<button class="btn primary juke-go" id="juke-go">▶ Jouer <kbd>⏎</kbd></button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="juke-playlist" id="juke-playlist"></div>' +
      '</div>';
    const pl = $('juke-playlist');
    this.view.forEach((s, i) => {
      const best = this.scores[this.scoreKey(s)];
      const row = document.createElement('div');
      row.className = 'juke-row' + (s.tutorial ? ' tutorial-row' : '');
      row.style.setProperty('--hue', s.hue);
      const num = s.tutorial ? '📖' : s.stars + '★';
      const fxMark = s.fx && s.fx.length ? ' <span class="sc-fx">✨</span>' : '';
      const sub = s.tutorial ? 'Tutoriel' : (STYLE_NAMES[s.style] || s.style) + ' · ' + s.bpm + ' BPM';
      row.innerHTML =
        `<span class="jr-num">${num}</span>` +
        `<span class="jr-main"><span class="jr-title">${s.title}${fxMark}</span>` +
        `<span class="jr-sub">${sub}</span></span>` +
        (best ? `<span class="jr-grade">${best.grade}</span>` : '') +
        '<span class="jr-eq"><i></i><i></i><i></i></span>';
      row.addEventListener('click', () => {
        if (this.selected === i) { this.jukeToggle(); return; }
        this.selected = i;
        this.engine.uiSound(620);
        this.updateSelection();
      });
      pl.appendChild(row);
      this.cards.push(row);
    });
    $('juke-prev').addEventListener('click', () => this.moveSelection(-1));
    $('juke-next').addEventListener('click', () => this.moveSelection(1));
    $('juke-play').addEventListener('click', () => this.jukeToggle());
    $('juke-go').addEventListener('click', () => { const s = this.view[this.selected]; if (s) this.startSong(s); });
    this.updateSelection(true);
  },

  updateSelection(instant) {
    this.cards.forEach((c, i) => c.classList.toggle('selected', i === this.selected));
    const sel = this.cards[this.selected];
    if (sel) sel.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: instant ? 'auto' : 'smooth' });
    this.renderInfo();
    if (this.settings.menuView === 'music') this.jukeSelect(this.view[this.selected]);
  },

  /* ---------- Juke-box (écoute des morceaux dans la vue musique) ---------- */

  // change le morceau écouté ; anti-rebond pour ne pas relancer l'audio à
  // chaque cran de défilement (la platine se met à jour visuellement aussitôt)
  jukeSelect(def) {
    if (!def) return;
    this.jukeDef = def;
    this.renderJukeStage(def);
    clearTimeout(this._jukeTimer);
    this._jukeTimer = setTimeout(() => this.jukeStart(def), 240);
  },

  renderJukeStage(def) {
    const v = $('juke-vinyl');
    if (!v) return;
    v.style.setProperty('--hue', def.hue);
    $('juke-center').textContent = def.tutorial ? '📖' : '★' + def.stars;
    $('juke-title').textContent = def.title;
    $('juke-meta').textContent = def.tutorial
      ? 'Tutoriel interactif · ' + def.sub
      : (STYLE_NAMES[def.style] || def.style) + ' · ' + def.bpm + ' BPM · ' + def.sub;
    $('juke-dur').textContent = this._fmtTime(this._jukeDur(def));
    $('juke-cur').textContent = '0:00';
    $('juke-fill').style.width = '0%';
  },

  jukeStart(def) {
    if (this.state !== 'menu' || this.settings.menuView !== 'music' || !def) return;
    this.engine.ensure();
    const composed = def.tutorial ? Composer.tutorialBacking() : Composer.compose(def);
    const last = composed.sections && composed.sections[composed.sections.length - 1];
    const loopBeats = last ? last.end : Math.round((composed.durationSec - 1.5) / composed.spb);
    this.engine.startSong(composed.events, composed.spb, 0.15, def.style, loopBeats);
    this._jukeComposed = composed;
    this._jukeLoopBeats = loopBeats;
    this.jukeDef = def;
    this.jukeActive = true;
    this.jukePlaying = true;
    this.menuMusicActive = false;
    this._updateJukePlayBtn();
  },

  jukeToggle() {
    if (!this.jukeActive) { this.jukeStart(this.view[this.selected]); return; }
    this.jukePlaying = !this.jukePlaying;
    if (this.jukePlaying) this.engine.resume(); else this.engine.pause();
    this.engine.uiSound(560);
    this._updateJukePlayBtn();
  },

  _updateJukePlayBtn() {
    const b = $('juke-play');
    if (b) b.textContent = this.jukePlaying ? '⏸' : '▶';
    const v = $('juke-vinyl');
    if (v) v.classList.toggle('spin', this.jukePlaying);
    const j = document.querySelector('.juke');
    if (j) j.classList.toggle('paused', !this.jukePlaying);
  },

  // arrête le juke-box (changement de vue, retour accueil, lancement de partie)
  jukeStop() {
    clearTimeout(this._jukeTimer);
    if (this.jukeActive) this.engine.stopSong();
    this.jukeActive = false;
    this.jukePlaying = false;
  },

  _jukeDur(def) {
    if (this._jukeComposed && this.jukeDef === def) return this._jukeLoopBeats * this._jukeComposed.spb;
    const beats = def.tutorial ? 64 : (Array.isArray(def.form) ? def.form : FORMS[def.form]).length * 16;
    return beats * 60 / def.bpm;
  },

  _fmtTime(s) {
    s = Math.max(0, Math.round(s));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  },

  // met à jour la barre de progression à chaque frame (appelé depuis startMenuBg)
  _tickJuke() {
    const fill = $('juke-fill');
    if (!fill || !this.jukeActive) return;
    const dur = this._jukeDur(this.jukeDef);
    let t = this.engine.getSongTime();
    if (t < 0) t = 0;
    const pos = dur > 0 ? ((t % dur) + dur) % dur : 0;
    fill.style.width = (dur > 0 ? pos / dur * 100 : 0).toFixed(2) + '%';
    $('juke-cur').textContent = this._fmtTime(pos);
  },

  renderInfo() {
    const s = this.view[this.selected];
    if (!s) {
      $('menu-info').innerHTML = '<div class="mi-card"><h2>Aucun résultat</h2>' +
        '<p class="mi-sub">Modifiez la recherche ou les filtres.</p></div>';
      return;
    }
    const unlocked = this.isUnlocked(this.selected);
    const best = this.scores[this.scoreKey(s)];
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
      if (this.settings.menuView === 'music') this._tickJuke();
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

  VIEWS: ['list', 'grid', 'music'],

  refreshViewTabs() {
    document.querySelectorAll('#view-tabs .view-tab').forEach(tab => {
      tab.classList.toggle('on', tab.dataset.view === this.settings.menuView);
    });
  },

  setView(mode) {
    if (!this.VIEWS.includes(mode) || mode === this.settings.menuView) return;
    const wasMusic = this.settings.menuView === 'music';
    this.settings.menuView = mode;
    this.save();
    this.engine.uiSound(680);
    // bascule audio : entrer dans la vue musique coupe la boucle de menu
    // (le juke-box prend le relais via buildMenu) ; en sortir la rétablit
    if (mode === 'music') this.stopMenuMusic();
    else if (wasMusic) { this.jukeStop(); this.playMenuMusic(); }
    this.buildMenu();
  },

  // touche G : fait défiler les affichages liste → grille → musique → …
  cycleView() {
    const i = this.VIEWS.indexOf(this.settings.menuView);
    this.setView(this.VIEWS[(i + 1) % this.VIEWS.length]);
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
    clearTimeout(this._jukeTimer);
    this.jukeActive = false; this.jukePlaying = false; // fin de l'écoute juke-box
    this.menuMusicActive = false; // le morceau remplace la boucle du menu
    this.engine.uiSound(760);
    if (this.game) this.game.destroy();
    $('pause-overlay').classList.add('hidden');
    $('fail-overlay').classList.add('hidden');
    this.game = new Game(this, def, { rusher: this.mode === 'rusher' });
    this.state = 'game';
    this.setScreen('game');
    this.game.start();
  },

  retry() {
    if (Infini.run.active) return; // pas de retry en Infini / Roguelite
    if (!this.game) return;
    const def = this.game.def;
    this.game.destroy();
    this.game = null;
    this.startSong(def);
  },

  quitToMenu() {
    // en Infini / Roguelite, quitter met fin au run (et affiche le bilan)
    if (Infini.run.active) { Infini.endRun('quit'); return; }
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
      // classements séparés Solo / Rusher (même préfixe que scoreKey)
      const id = (result.mode === 'rusher' ? 'rush::' : '') + result.def.id;
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
    const modeTag = result.mode === 'rusher' ? '  🏁 RUSHER' : '';
    $('res-title').textContent = result.def.tutorial
      ? 'Tutoriel terminé !'
      : `${result.def.title} — ★ ${result.def.stars}` + modeTag +
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
    this.jukeStop();
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
        else if (e.code === 'KeyR') this.launchMode('rusher');
        else if (e.code === 'KeyI') this.launchMode('infini');
        else if (e.code === 'KeyA') this.launchMode('roguelite');
        break;

      case 'infiniChoice':
        if (e.code === 'Digit1' || e.code === 'Numpad1') Infini.pick(0);
        else if (e.code === 'Digit2' || e.code === 'Numpad2') Infini.pick(1);
        else if (e.code === 'Digit3' || e.code === 'Numpad3') Infini.pick(2);
        else if (e.code === 'Escape') Infini.endRun('quit');
        break;

      case 'infiniOver':
        if (e.code === 'KeyR') { $('infini-over').classList.add('hidden'); Infini.again(); }
        else if (e.code === 'Escape' || e.code === 'Enter') { $('infini-over').classList.add('hidden'); this.goHome(); }
        break;

      case 'menu': {
        // en grille, gauche/droite saute une colonne (3 morceaux)
        const hStep = this.settings.menuView === 'grid' ? GRID_ROWS : 1;
        if (e.code === 'ArrowDown') { e.preventDefault(); this.moveSelection(1); }
        else if (e.code === 'ArrowUp') { e.preventDefault(); this.moveSelection(-1); }
        else if (e.code === 'ArrowRight') { e.preventDefault(); this.moveSelection(hStep); }
        else if (e.code === 'ArrowLeft') { e.preventDefault(); this.moveSelection(-hStep); }
        else if (e.code === 'KeyG') this.cycleView();
        else if (e.code === 'Space' && this.settings.menuView === 'music') { e.preventDefault(); this.jukeToggle(); }
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
