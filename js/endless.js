'use strict';

/*
 * Modes sans fin — deux variantes pilotées par `run.kind` :
 *
 *  - INFINI : des morceaux sont GÉNÉRÉS à la volée (jamais deux fois les mêmes)
 *    et enchaînés SANS AUCUNE interruption. Une seule vie qui se reporte de
 *    segment en segment, la difficulté monte ; ça ne s'arrête qu'à la mort ou
 *    si le joueur quitte. Aucun choix entre les segments.
 *
 *  - ROGUELITE : même génération sans fin, mais entre chaque segment un CHOIX
 *    d'amélioration (boon) parmi trois — certaines gratuites, d'autres avec
 *    contrepartie (plus de score contre plus de risque).
 *
 * Chaque segment réutilise le moteur Game (option `endless`).
 * Globals utilisés : App, Game, GAME_MODS, Util, $.
 */

const Infini = {
  // --- catalogue de génération ---
  STYLES: ['wave', 'house', 'chip', 'dnb', 'trance', 'funk', 'hard', 'techno',
    'trap', 'metal', 'disco', 'psy', 'lofi', 'dub'],
  BG_THEMES: ['stars', 'city', 'tunnel', 'hex', 'rain', 'waves', 'orbs', 'vortex'],
  FX_POOL: ['sway', 'pulse', 'tilt', 'wave', 'orbit', 'split2', 'split4',
    'shake', 'scatter', 'dance', 'stutter', 'portal', 'swap'],
  PROGS: [[0, 5, 2, 6], [0, 3, 5, 4], [0, 5, 3, 4], [0, 1, 5, 4],
    [0, 5, 2, 4], [0, 3, 6, 4], [0, 2, 5, 6], [0, 4, 5, 6]],
  SCALEK: ['minor', 'harm', 'dorian', 'phryg'],
  // bpm de référence par style (la difficulté en rajoute)
  BPM: {
    wave: 120, house: 122, chip: 130, dnb: 170, trance: 140, funk: 116,
    hard: 158, techno: 130, trap: 142, metal: 168, disco: 120, psy: 146,
    lofi: 84, dub: 142,
  },
  TITLE_A: ['Neon', 'Hyper', 'Void', 'Crimson', 'Astral', 'Chrome', 'Glitch',
    'Solar', 'Phantom', 'Turbo', 'Cosmic', 'Vapor', 'Iron', 'Lunar', 'Static',
    'Quantum', 'Velvet', 'Savage', 'Prism', 'Nitro'],
  TITLE_B: ['Pulse', 'Drive', 'Storm', 'Circuit', 'Mirage', 'Cascade', 'Engine',
    'Horizon', 'Protocol', 'Surge', 'Rush', 'Echo', 'Vortex', 'Bloom', 'Signal',
    'Override', 'Frenzy', 'Odyssey', 'Reactor', 'Spiral'],

  run: { active: false },

  /* ---------- catalogue des améliorations roguelite ---------- */
  BOONS: [
    { id: 'heal', icon: '❤️', name: 'Réparation', risk: false,
      desc: () => '+25 de vie immédiatement',
      apply: r => { r.health = Math.min(r.healthMax, r.health + 25); } },
    { id: 'healBig', icon: '💚', name: 'Régénération', risk: false,
      desc: () => '+45 de vie immédiatement',
      apply: r => { r.health = Math.min(r.healthMax, r.health + 45); } },
    { id: 'maxhp', icon: '🛡', name: 'Blindage', risk: false,
      desc: () => 'Vie maximale +20 (et +20 de vie)',
      apply: r => { r.healthMax += 20; r.health += 20; } },
    { id: 'regen', icon: '♻️', name: 'Récupération', risk: false,
      desc: r => `Soin de fin de segment porté à +${r.healPerClear + 8}`,
      apply: r => { r.healPerClear += 8; } },
    { id: 'score', icon: '✨', name: 'Multiplicateur', risk: false,
      desc: r => `Score ×${(r.scoreMult * 1.25).toFixed(2)} (cumulatif)`,
      apply: r => { r.scoreMult *= 1.25; } },
    { id: 'shield', icon: '🪬', name: 'Seconde chance', risk: false,
      desc: r => `Survis à une mort (${r.shield + 1} en réserve)`,
      apply: r => { r.shield += 1; } },
    // contreparties : gros score contre plus de risque
    { id: 'adrenaline', icon: '⚡', name: 'Adrénaline', risk: true,
      desc: () => 'Score ×1.4 — mais tout accélère (+25%)',
      apply: r => { r.scoreMult *= 1.4; r.forcedMods.add('dt'); } },
    { id: 'torch', icon: '🔦', name: 'Funambule', risk: true,
      desc: () => 'Score ×1.5 — mais lampe torche (champ assombri)',
      apply: r => { r.scoreMult *= 1.5; r.forcedMods.add('flash'); } },
    { id: 'blind', icon: '🙈', name: 'À l’aveugle', risk: true,
      desc: () => 'Score ×1.4 — mais les notes s’effacent à l’approche',
      apply: r => { r.scoreMult *= 1.4; r.forcedMods.add('hidden'); } },
    { id: 'mirror', icon: '🪞', name: 'Miroir', risk: true,
      desc: () => 'Score ×1.25 — mais colonnes inversées en permanence',
      apply: r => { r.scoreMult *= 1.25; r.forcedMods.add('mirror'); } },
    { id: 'chaos', icon: '🌀', name: 'Chaos', risk: true,
      desc: () => 'Score ×1.3 — mais +1 effet spécial à chaque morceau',
      apply: r => { r.scoreMult *= 1.3; r.extraFx += 1; } },
    { id: 'overheat', icon: '🔥', name: 'Surchauffe', risk: true,
      desc: () => 'Score ×1.6 — mais +2★ de difficulté permanente',
      apply: r => { r.scoreMult *= 1.6; r.extraStars += 2; } },
  ],

  /* ---------- cycle de vie du run ---------- */

  // kind : 'infini' (génération continue, aucun choix) ou 'roguelite' (choix entre segments)
  start(kind) {
    this.lastKind = kind || 'infini';
    this.run = {
      active: true,
      kind: this.lastKind,
      seed: (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0,
      segment: 1,
      scoreTotal: 0,
      maxCombo: 0,
      startMs: performance.now(),
      health: 70,
      healthMax: 100,
      scoreMult: 1,
      extraStars: 0,
      extraFx: 0,
      shield: 0,
      healPerClear: 8,
      forcedMods: new Set(),
    };
    $('infini-choice').classList.add('hidden');
    $('infini-over').classList.add('hidden');
    this._nextSegment();
  },

  // relance un run du même type (bouton « Nouveau run »)
  again() { this.start(this.lastKind); },

  _nextSegment() {
    const def = this._generateDef();
    if (App.game) { App.game.destroy(); App.game = null; }
    $('pause-overlay').classList.add('hidden');
    $('fail-overlay').classList.add('hidden');
    App.stopMenuMusic();
    App.menuMusicActive = false;
    App.state = 'game';
    App.setScreen('game');
    App.game = new Game(App, def, {
      endless: true,
      startHealth: this.run.health,
      healthMax: this.run.healthMax,
      mods: [...this.run.forcedMods],
      scoreMult: this.run.scoreMult,
      runInfo: {
        segment: this.run.segment,
        totalScore: this.run.scoreTotal,
        label: this.run.kind === 'roguelite' ? '🎲 ROGUELITE' : '♾ INFINI',
      },
    });
    App.game.start();
  },

  // segment réussi : on encaisse le score, on soigne un peu, puis…
  //  - en Roguelite : on propose un choix d'amélioration ;
  //  - en Infini : on enchaîne directement (jamais d'arrêt).
  onSegmentDone(game) {
    this.run.scoreTotal += Math.round(game.score);
    this.run.maxCombo = Math.max(this.run.maxCombo, game.maxCombo);
    this.run.health = Math.min(this.run.healthMax, game.health + this.run.healPerClear);
    this.run.segment++;
    game.destroy();
    App.game = null;
    if (this.run.kind === 'roguelite') this._showChoice();
    else this._nextSegment();
  },

  // mort : si un bouclier est en réserve, on ressuscite ; sinon le run s'achève
  onDeath(game) {
    this.run.scoreTotal += Math.round(game.score);
    this.run.maxCombo = Math.max(this.run.maxCombo, game.maxCombo);
    game.destroy();
    App.game = null;
    if (this.run.shield > 0) {
      this.run.shield--;
      this.run.health = Math.round(this.run.healthMax * 0.5);
      this.run.segment++;
      this.run.revived = true;
      this._showChoice();
      return;
    }
    this.endRun('death');
  },

  /* ---------- choix roguelite ---------- */

  _showChoice() {
    this.choices = this._rollChoices(3);
    const wrap = $('ic-cards');
    wrap.innerHTML = '';
    this.choices.forEach((b, i) => {
      const card = document.createElement('button');
      card.className = 'ic-card' + (b.risk ? ' risky' : '');
      card.innerHTML =
        `<span class="ic-key">${i + 1}</span>` +
        `<span class="ic-icon">${b.icon}</span>` +
        `<span class="ic-name">${b.name}</span>` +
        `<span class="ic-desc">${b.desc(this.run)}</span>`;
      card.addEventListener('click', () => this.pick(i));
      wrap.appendChild(card);
    });
    $('ic-seg').textContent = this.run.segment - 1;
    $('ic-life').textContent = Math.round(this.run.health) + ' / ' + this.run.healthMax;
    $('ic-total').textContent = Util.fmtScore(this.run.scoreTotal);
    $('ic-revive').classList.toggle('hidden', !this.run.revived);
    this.run.revived = false;
    App.playMenuMusic();
    $('infini-choice').classList.remove('hidden');
    App.state = 'infiniChoice';
  },

  _rollChoices(n) {
    let pool = this.BOONS.slice();
    // si la vie est basse, on garantit au moins une option de soin dans l'offre
    const lowLife = this.run.health < this.run.healthMax * 0.4;
    const picks = [];
    if (lowLife) {
      const heals = pool.filter(b => b.id === 'heal' || b.id === 'healBig');
      const h = heals[Math.floor(Math.random() * heals.length)];
      picks.push(h);
      pool = pool.filter(b => b !== h);
    }
    while (picks.length < n && pool.length) {
      const i = Math.floor(Math.random() * pool.length);
      picks.push(pool.splice(i, 1)[0]);
    }
    return picks;
  },

  pick(i) {
    if (App.state !== 'infiniChoice' || !this.choices) return;
    const b = this.choices[i];
    if (!b) return;
    b.apply(this.run);
    App.engine.uiSound(720);
    $('infini-choice').classList.add('hidden');
    this.choices = null;
    this._nextSegment();
  },

  /* ---------- fin de run ---------- */

  endRun(reason) {
    this.run.active = false;
    if (App.game) { App.game.destroy(); App.game = null; }
    $('pause-overlay').classList.add('hidden');
    $('fail-overlay').classList.add('hidden');
    $('infini-choice').classList.add('hidden');

    const segs = this.run.segment - 1; // segments réellement franchis
    const bestKey = this.run.kind + '::best'; // classements séparés Infini / Roguelite
    const prevBest = (App.scores[bestKey] || {}).score || 0;
    const isRecord = this.run.scoreTotal > prevBest;
    if (isRecord) {
      App.scores[bestKey] = { score: this.run.scoreTotal, segs, combo: this.run.maxCombo };
      App.save();
    }
    const modeName = this.run.kind === 'roguelite' ? 'ROGUELITE' : 'INFINI';
    $('io-reason').textContent = (reason === 'quit' ? 'RUN ABANDONNÉ' : 'RUN TERMINÉ') + ' · ' + modeName;
    $('io-title').textContent = segs > 0
      ? `${segs} segment${segs > 1 ? 's' : ''} survécu${segs > 1 ? 's' : ''}`
      : 'Première chute…';
    $('io-segs').textContent = segs;
    $('io-score').textContent = Util.fmtScore(this.run.scoreTotal);
    $('io-combo').textContent = this.run.maxCombo;
    $('io-best').textContent = Util.fmtScore(Math.max(prevBest, this.run.scoreTotal));
    $('io-record').classList.toggle('hidden', !isRecord);

    App.playMenuMusic();
    App.state = 'infiniOver';
    $('infini-over').classList.remove('hidden');
    App.engine.uiSound(reason === 'quit' ? 360 : 240);
  },

  /* ---------- génération procédurale d'un morceau ---------- */

  _generateDef() {
    const r = this.run;
    const seg = r.segment;
    const rnd = a => a[Math.floor(Math.random() * a.length)];
    const stars = Util.clamp(2 + Math.floor(seg * 0.55) + r.extraStars, 1, 10);
    const style = rnd(this.STYLES);

    // formes de plus en plus longues : segments courts et nerveux au début
    const form = seg < 3 ? ['verse', 'chorus']
      : seg < 6 ? ['intro', 'verse', 'chorus', 'outro']
      : ['intro', 'verse', 'chorus', 'chorus', 'outro'];

    // mécaniques de chart selon la difficulté
    const mods = [];
    if (stars >= 3 && Math.random() < 0.8) mods.push('roll');
    if (stars >= 4 && Math.random() < 0.6) mods.push('ghost');
    if (stars >= 5) { if (Math.random() < 0.7) mods.push('shold'); if (Math.random() < 0.6) mods.push('wide'); }

    // effets spéciaux : un peu à partir de ★4, plus avec le boon "Chaos"
    const nFx = Util.clamp(Math.floor((stars - 3) / 2) + r.extraFx, 0, 4);
    const fxPool = this.FX_POOL.slice();
    const fx = [];
    for (let k = 0; k < nFx && fxPool.length; k++) {
      fx.push(fxPool.splice(Math.floor(Math.random() * fxPool.length), 1)[0]);
    }

    const bpm = Util.clamp((this.BPM[style] || 124) + Math.floor(seg * 1.5), 80, 200);
    const title = rnd(this.TITLE_A) + ' ' + rnd(this.TITLE_B);

    return {
      id: `infini::${r.seed}::${seg}`,
      title,
      sub: `Segment ${seg} · généré`,
      style,
      bpm,
      stars,
      hue: Math.floor(Math.random() * 360),
      root: 43 + Math.floor(Math.random() * 6),
      scale: rnd(this.SCALEK),
      prog: rnd(this.PROGS),
      form,
      mods,
      bg: rnd(this.BG_THEMES),
      fx,
    };
  },
};
