'use strict';

/*
 * Session de jeu : notes qui tombent, jugements, score, vie, rendu canvas.
 * L'horloge de référence est l'horloge AUDIO (AudioContext.currentTime),
 * corrigée par le décalage de calibration.
 *
 * Lanes : -1 = bonus gauche, 0..3 = principales, 4 = bonus droite.
 * Les tableaux indexés par lane utilisent l'indice (lane + 1), soit 0..5.
 *
 * Unités de score : tap/exp = 1 ; hold/shold/roll/wide = 2 ; bombe = 0.
 */

const JUDGE = {
  PERFECT: { win: 0.040, weight: 1.0,  hp: +1.0,  label: 'PARFAIT', color: '#28e6ff' },
  GREAT:   { win: 0.085, weight: 0.65, hp: +0.6,  label: 'SUPER',   color: '#7dff9b' },
  GOOD:    { win: 0.130, weight: 0.3,  hp: +0.2,  label: 'BIEN',    color: '#ffd166' },
  MISS:    { win: Infinity, weight: 0, hp: -6,    label: 'RATÉ',    color: '#ff4d6d' },
  BOMB:    { win: 0, weight: 0, hp: -10,          label: 'BOMBE !', color: '#ff2244' },
};

// Mods de gameplay : activés depuis le menu, persistés dans les réglages.
// mult = multiplicateur de score (0 = partie non classée, jamais sauvegardée)
const GAME_MODS = {
  ht:       { name: 'Ralenti',      icon: '🐢', desc: 'Musique et notes à 80 %',            mult: 0.5,  excl: ['dt'] },
  dt:       { name: 'Accéléré',     icon: '⚡', desc: 'Musique et notes à 125 %',           mult: 1.12, excl: ['ht'] },
  mirror:   { name: 'Miroir',       icon: '🪞', desc: 'Colonnes inversées (gauche ↔ droite)', mult: 1 },
  hidden:   { name: 'Sans repère',  icon: '🙈', desc: 'Les notes s’effacent à l’approche',  mult: 1.06 },
  flash:    { name: 'Lampe torche', icon: '🔦', desc: 'Seul le bas du champ est éclairé',   mult: 1.12 },
  hardcore: { name: 'Hardcore',     icon: '💀', desc: 'Un seul raté ou bombe = échec',      mult: 1.1,  excl: ['nofail', 'auto'] },
  nofail:   { name: 'Sans échec',   icon: '🛡', desc: 'La vie ne tombe jamais à zéro',      mult: 0.5,  excl: ['hardcore'] },
  auto:     { name: 'Autopilote',   icon: '🤖', desc: 'Le jeu joue tout seul (non classé)', mult: 0,    excl: ['hardcore'] },
};

// applique vitesse (ht/dt) et miroir à la chart — renvoie le taux de lecture
function applyGameMods(mods, chartNotes, laneWindows, composed) {
  const rate = mods.has('dt') ? 1.25 : mods.has('ht') ? 0.8 : 1;
  if (rate !== 1) {
    composed.spb /= rate;
    composed.durationSec /= rate;
    for (const n of chartNotes) {
      n.t /= rate;
      if (n.t2) n.t2 /= rate;
      if (n.tm) n.tm /= rate;
    }
    for (const w of laneWindows) { w.open /= rate; w.close /= rate; }
  }
  if (mods.has('mirror')) {
    const flip = l => (l >= 0 && l <= 3) ? 3 - l : l === -1 ? 4 : l === 4 ? -1 : l;
    for (const n of chartNotes) {
      n.lane = flip(n.lane);
      if (n.lane2 !== undefined && n.lane2 >= -1) {
        n.lane2 = flip(n.lane2);
        if (n.type === 'wide' && n.lane2 < n.lane) {
          const tmp = n.lane; n.lane = n.lane2; n.lane2 = tmp;
        }
      }
      if (n.dir) n.dir = -n.dir;
    }
    for (const w of laneWindows) w.lane = w.lane === -1 ? 4 : -1;
  }
  return rate;
}

const LEAD_IN = 2.6;             // secondes avant la première mesure
const HOLD_RELEASE_GRACE = 0.15; // relâchement anticipé toléré (s)
const SHOLD_TRANS = 0.35;        // fenêtre de transition d'un hold mobile (s)
const WIDE_SYNC = 0.12;          // écart max entre les deux touches d'une wide (s)
const LANE_ANIM = 0.35;          // ouverture/fermeture d'une lane bonus (s)
const ROLL_COLOR = '#ff9f43';

class Game {
  constructor(app, def, opts = {}) {
    this.app = app;
    this.def = def;
    this.engine = app.engine;
    this.canvas = document.getElementById('game-canvas');
    this.gfx = this.canvas.getContext('2d');
    this.tutorial = !!def.tutorial;
    // mode RUSHER : même moteur (toutes les notes + tous les effets), mais
    // le champ est pivoté à l'horizontale (les notes foncent de droite à
    // gauche), sans lignes de lane, et N'IMPORTE QUELLE touche frappe la
    // note la plus proche du récepteur (voir _rusherInput / render).
    this.rusher = !!opts.rusher;

    let chartNotes;
    if (this.tutorial) {
      // déroulé interactif : les notes sont posées en jeu par TutorialScript
      this.composed = Composer.tutorialBacking();
      chartNotes = [];
      this.laneWindows = [];
    } else {
      this.composed = Composer.compose(def);
      const chart = Composer.buildChart(def, this.composed);
      chartNotes = chart.notes;
      this.laneWindows = chart.laneWindows;
    }
    // mode INFINI (roguelite sans fin) : la vie se reporte de segment en
    // segment, les mods/score sont pilotés par le run (boons accumulés).
    this.endless = !!opts.endless;
    this.runInfo = opts.runInfo || null;       // {segment, totalScore, boons} pour le HUD
    this.runScoreMult = opts.scoreMult || 1;   // multiplicateur de score du run
    this.healthMax = opts.healthMax || 100;

    // mods de gameplay : tutoriel/Rusher = aucun ; Infini = ceux du run ; sinon réglages
    const modSrc = this.endless ? (opts.mods || [])
      : (this.tutorial || this.rusher ? [] : (app.settings.mods || []));
    this.mods = new Set(modSrc);
    this.rate = this.mods.size
      ? applyGameMods(this.mods, chartNotes, this.laneWindows, this.composed)
      : 1;
    this.modMult = 1;
    for (const id of this.mods) this.modMult *= GAME_MODS[id] ? GAME_MODS[id].mult : 1;
    this.mAuto = this.mods.has('auto');
    this.mHidden = this.mods.has('hidden');
    this.mFlash = this.mods.has('flash');
    this.mHardcore = this.mods.has('hardcore');
    this.mNoFail = this.mods.has('nofail');

    this.notes = chartNotes.map(n => ({
      t: n.t, t2: n.t2 || 0, lane: n.lane,
      lane2: n.lane2 !== undefined ? n.lane2 : -9,
      tm: n.tm || 0, need: n.need || 0, dir: n.dir || 0,
      type: n.type, ghost: !!n.ghost,
      hit: false, missed: false, holding: false, done: false, broken: false,
      avoided: false, triggered: false, hits: 0, p1: -9, p1Lane: -9,
    }));
    this.duration = this.composed.durationSec;

    this.totalUnits = this.notes.reduce((s, n) => {
      if (n.type === 'bomb') return s;
      if (n.type === 'hold' || n.type === 'shold' || n.type === 'roll' || n.type === 'wide') return s + 2;
      return s + 1;
    }, 0);

    this.state = 'play'; // play | paused | done | failed
    this.score = 0;
    this.earned = 0;
    this.judged = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.health = opts.startHealth != null ? opts.startHealth : 60;
    this.counts = { PERFECT: 0, GREAT: 0, GOOD: 0, MISS: 0, BOMB: 0 };
    this.nextIdx = 0;
    this.activeHolds = [];

    this.fx = [];
    this.judgeFlash = null;
    this.keysDown = new Array(6).fill(false);
    this.bg = def.bg || 'stars';
    // effets spéciaux (modchart) : timeline déterministe par sections
    this.fxTimeline = this.tutorial ? [] : this._buildFxTimeline();
    this._fxOff = null;   // décalage x par lane (sway/split/scatter/portal)
    this._laneFx = null;  // état par lane (dance/stutter/portal)
    this._tilt = 0;       // rotation du champ (rad)
    this._zoom = 1;       // zoom pulsé
    this._waveAmp = 0;    // amplitude d'ondulation des notes
    this._waveT = 0;
    this._camX = 0; this._camY = 0; this._camRot = 0; // caméra (shake/orbit)
    this.raf = 0;
    this.resumeTimer = 0;
    this.script = this.tutorial ? new TutorialScript(this) : null;
  }

  // ajout d'une note en cours de jeu (tutoriel) — t toujours dans le futur,
  // l'ordre chronologique du tableau est donc préservé
  addNote(spec) {
    const n = {
      t: spec.t, t2: spec.t2 || 0, lane: spec.lane,
      lane2: spec.lane2 !== undefined ? spec.lane2 : -9,
      tm: spec.tm || 0, need: spec.need || 0, dir: spec.dir || 0,
      type: spec.type, ghost: !!spec.ghost,
      hit: false, missed: false, holding: false, done: false, broken: false,
      avoided: false, triggered: false, hits: 0, p1: -9, p1Lane: -9,
    };
    this.notes.push(n);
    this.totalUnits += n.type === 'bomb' ? 0
      : (n.type === 'hold' || n.type === 'shold' || n.type === 'roll' || n.type === 'wide') ? 2 : 1;
    return n;
  }

  endTutorial() {
    if (this.state === 'play') this._finish();
  }

  start() {
    this.engine.startSong(this.composed.events, this.composed.spb, LEAD_IN, this.def.style);
    this._resize();
    this._onResize = () => this._resize();
    window.addEventListener('resize', this._onResize);
    const loop = () => { this.raf = requestAnimationFrame(loop); this.frame(); };
    loop();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.resumeTimer);
    window.removeEventListener('resize', this._onResize);
    this.engine.stopSong();
  }

  now() {
    return this.engine.getSongTime() - this.app.settings.offsetMs / 1000;
  }

  _resolved(n) {
    if (n.type === 'bomb') return n.triggered || n.avoided;
    if (n.type === 'roll') return n.done;
    return n.hit || n.missed;
  }

  /* ---------- Entrées ---------- */

  onLane(lane, down) {
    this.keysDown[lane + 1] = down;
    if (this.rusher) {
      if (down) this._pressPulse = performance.now();
      return this._rusherInput(lane, down); // toute touche, tous rails
    }
    if (this.mAuto) return; // autopilote : les entrées n'affectent pas le jeu
    if (this.state !== 'play') return;
    const t = this.now();

    if (!down) {
      // relâchement près de la fin d'une tenue => complétée en avance
      const h = this.activeHolds.find(h => h.lane === lane || (h.type === 'shold' && h.lane2 === lane));
      if (h && h.t2 - t <= HOLD_RELEASE_GRACE) {
        this._endHold(h, 'PERFECT', true);
      }
      // sinon : la validation par frame tranchera (transitions tolérées)
      return;
    }

    // 1) roulement actif sur cette lane ?
    for (let i = this.nextIdx; i < this.notes.length; i++) {
      const n = this.notes[i];
      if (n.t - t > JUDGE.GOOD.win) break;
      if (n.type !== 'roll' || n.done || n.lane !== lane) continue;
      if (t >= n.t - 0.1 && t <= n.t2 + 0.08) {
        n.hits++;
        n.lastHit = performance.now();
        this.fx.push({ lane, t0: performance.now(), judge: 'GOOD' });
        if (this.app.settings.hitSound) this.engine.hitSound();
        return;
      }
    }

    // 2) prise de la nouvelle touche d'un hold mobile ?
    for (const h of this.activeHolds) {
      if (h.type === 'shold' && h.lane2 === lane && Math.abs(t - h.tm) <= SHOLD_TRANS) return;
    }

    // 3) note la plus proche (wide incluse via sa 2e lane)
    let best = null, bestD = Infinity;
    for (let i = this.nextIdx; i < this.notes.length; i++) {
      const n = this.notes[i];
      if (n.t - t > JUDGE.GOOD.win) break;
      if (n.type === 'roll' || this._resolved(n)) continue;
      if (n.lane !== lane && !(n.type === 'wide' && n.lane2 === lane)) continue;
      const dd = Math.abs(n.t - t);
      if (dd < bestD) { bestD = dd; best = n; }
    }
    if (!best || bestD > JUDGE.GOOD.win) return;

    if (best.type === 'bomb') {
      best.triggered = true;
      this._judge('BOMB', lane, true);
      return;
    }

    if (best.type === 'wide') {
      if (best.p1 > -9 && best.p1Lane !== lane && t - best.p1 <= WIDE_SYNC) {
        best.hit = true;
        const dd = Math.max(Math.abs(best.p1 - best.t), Math.abs(t - best.t));
        const j = dd <= JUDGE.PERFECT.win ? 'PERFECT' : dd <= JUDGE.GREAT.win ? 'GREAT' : 'GOOD';
        this._judge(j, best.lane, true, t - best.t, 2);
        this.fx.push({ lane: best.lane2, t0: performance.now(), judge: j });
        if (this.app.settings.hitSound) this.engine.hitSound();
      } else {
        best.p1 = t;
        best.p1Lane = lane;
      }
      return;
    }

    best.hit = true;
    const j = bestD <= JUDGE.PERFECT.win ? 'PERFECT' : bestD <= JUDGE.GREAT.win ? 'GREAT' : 'GOOD';
    this._judge(j, lane, true, t - best.t);
    if (best.type === 'hold' || best.type === 'shold') {
      best.holding = true;
      this.activeHolds.push(best);
    }
    if (this.app.settings.hitSound) this.engine.hitSound();
  }

  // Entrée du mode RUSHER : la touche n'a aucune importance, on agit sur la
  // note la plus proche du récepteur, tous rails confondus (le type de note
  // est respecté : roulement = martèlement, tenue = maintien, double = 2
  // touches, bombe = à éviter).
  _rusherInput(lane, down) {
    if (this.state !== 'play') return;
    const t = this.now();

    if (!down) {
      // plus aucune touche tenue : on clôt les tenues proches de leur fin
      if (!this.keysDown.some(Boolean)) {
        for (const h of [...this.activeHolds]) {
          if (h.t2 - t <= HOLD_RELEASE_GRACE) this._endHold(h, 'PERFECT', true);
        }
      }
      return;
    }

    // 1) roulement actif (n'importe quel rail)
    for (let i = this.nextIdx; i < this.notes.length; i++) {
      const n = this.notes[i];
      if (n.t - t > JUDGE.GOOD.win) break;
      if (n.type !== 'roll' || n.done) continue;
      if (t >= n.t - 0.1 && t <= n.t2 + 0.08) {
        n.hits++;
        n.lastHit = performance.now();
        this.fx.push({ lane: n.lane, t0: performance.now(), judge: 'GOOD' });
        if (this.app.settings.hitSound) this.engine.hitSound();
        return;
      }
    }

    // 2) note la plus proche, tous rails confondus (hors roulements)
    let best = null, bestD = Infinity;
    for (let i = this.nextIdx; i < this.notes.length; i++) {
      const n = this.notes[i];
      if (n.t - t > JUDGE.GOOD.win) break;
      if (n.type === 'roll' || this._resolved(n)) continue;
      const dd = Math.abs(n.t - t);
      if (dd < bestD) { bestD = dd; best = n; }
    }
    if (!best || bestD > JUDGE.GOOD.win) return;

    if (best.type === 'bomb') {
      best.triggered = true;
      this._judge('BOMB', best.lane, true);
      return;
    }

    // note double : deux touches distinctes dans la fenêtre de synchro
    if (best.type === 'wide') {
      if (best.p1 > -9 && best.p1Lane !== lane && t - best.p1 <= WIDE_SYNC) {
        best.hit = true;
        const dd = Math.max(Math.abs(best.p1 - best.t), Math.abs(t - best.t));
        const j = dd <= JUDGE.PERFECT.win ? 'PERFECT' : dd <= JUDGE.GREAT.win ? 'GREAT' : 'GOOD';
        this._judge(j, best.lane, true, t - best.t, 2);
        this.fx.push({ lane: best.lane2, t0: performance.now(), judge: j });
        if (this.app.settings.hitSound) this.engine.hitSound();
      } else {
        best.p1 = t;
        best.p1Lane = lane;
      }
      return;
    }

    best.hit = true;
    const j = bestD <= JUDGE.PERFECT.win ? 'PERFECT' : bestD <= JUDGE.GREAT.win ? 'GREAT' : 'GOOD';
    this._judge(j, best.lane, true, t - best.t);
    if (best.type === 'hold' || best.type === 'shold') {
      best.holding = true;
      this.activeHolds.push(best);
    }
    if (this.app.settings.hitSound) this.engine.hitSound();
  }

  _endHold(h, judge, fxOn) {
    const i = this.activeHolds.indexOf(h);
    if (i >= 0) this.activeHolds.splice(i, 1);
    h.holding = false;
    h.done = true;
    if (judge === 'MISS') h.broken = true;
    const lane = h.type === 'shold' && this.now() >= h.tm ? h.lane2 : h.lane;
    this._judge(judge, lane, fxOn);
  }

  _judge(j, lane, fx, delta = 0, units = 1) {
    const info = JUDGE[j];
    this.counts[j]++;
    this.health = Util.clamp(this.health + info.hp, 0, this.healthMax);
    if (this.tutorial) this.health = Math.max(this.health, 30); // pas d'échec au tutoriel
    if (this.mNoFail) this.health = Math.max(this.health, 1);
    if (this.mHardcore && (j === 'MISS' || j === 'BOMB')) this.health = 0; // mort subite
    if (j === 'BOMB') {
      this.combo = 0;
    } else {
      this.judged += units;
      this.earned += info.weight * units;
      if (j === 'MISS') {
        this.combo = 0;
      } else {
        this.combo++;
        this.maxCombo = Math.max(this.maxCombo, this.combo);
      }
    }
    if (fx) this.fx.push({ lane, t0: performance.now(), judge: j });
    this.judgeFlash = { judge: j, t0: performance.now(), delta };
    this.score = 1000000 * this.earned / (this.totalUnits || 1) * this.modMult * this.runScoreMult;
    if (this.health <= 0 && this.state === 'play') this._fail();
  }

  /* ---------- Pause / fin ---------- */

  pause() {
    if (this.state !== 'play') return;
    this.state = 'paused';
    clearTimeout(this.resumeTimer);
    this.engine.pause();
    // en Infini, pas de "Recommencer" (le run est unique) : on masque le bouton
    document.getElementById('btn-pause-retry').classList.toggle('hidden', !!this.endless);
    document.getElementById('pause-overlay').classList.remove('hidden');
  }

  resume() {
    if (this.state !== 'paused') return;
    document.getElementById('pause-overlay').classList.add('hidden');
    this.resumeTimer = setTimeout(() => {
      this.engine.resume();
      this.state = 'play';
    }, 700);
  }

  _fail() {
    this.state = 'failed';
    this.engine.stopSong();
    if (this.endless) { this.app.onInfiniDeath(this); return; } // pas d'overlay : le run décide
    document.getElementById('fail-overlay').classList.remove('hidden');
  }

  _finish() {
    this.state = 'done';
    const acc = this.totalUnits ? (this.earned / this.totalUnits) * 100 : 0;
    if (this.endless) { this.app.onInfiniSegmentDone(this, acc); return; } // segment réussi
    this.app.onGameEnd({
      def: this.def,
      mode: this.rusher ? 'rusher' : undefined,
      cleared: true,
      score: Math.round(this.score),
      acc,
      maxCombo: this.maxCombo,
      counts: this.counts,
      mods: [...this.mods],
      grade: this.tutorial ? '✓' : Game.gradeFor(acc),
    });
  }

  static gradeFor(acc) {
    if (acc >= 99) return 'SS';
    if (acc >= 94) return 'S';
    if (acc >= 87) return 'A';
    if (acc >= 78) return 'B';
    if (acc >= 65) return 'C';
    return 'D';
  }

  /* ---------- Boucle ---------- */

  frame() {
    const t = this.now();

    if (this.state === 'play') {
      // autopilote : tout est frappé PARFAIT à l'instant exact
      if (this.mAuto) {
        for (let i = this.nextIdx; i < this.notes.length; i++) {
          const n = this.notes[i];
          if (n.t > t) break;
          if (this._resolved(n) || n.type === 'bomb') continue;
          if (n.type === 'roll') {
            if (n.hits < n.need) n.hits = n.need; // la résolution à t2 donnera PARFAIT
          } else if (n.type === 'hold' || n.type === 'shold') {
            if (!n.hit) {
              n.hit = true; n.holding = true;
              this.activeHolds.push(n);
              this._judge('PERFECT', n.lane, true);
            }
          } else if (n.type === 'wide') {
            n.hit = true;
            this._judge('PERFECT', n.lane, true, 0, 2);
            this.fx.push({ lane: n.lane2, t0: performance.now(), judge: 'PERFECT' });
          } else {
            n.hit = true;
            this._judge('PERFECT', n.lane, true);
          }
        }
      }

      for (let i = this.nextIdx; i < this.notes.length; i++) {
        const n = this.notes[i];
        if (n.t > t + 0.001) break;
        if (this._resolved(n)) continue;

        if (n.type === 'roll') {
          if (t > n.t2) {
            n.done = true;
            const ratio = n.hits / n.need;
            const j = ratio >= 1 ? 'PERFECT' : ratio >= 0.65 ? 'GREAT' : ratio >= 0.35 ? 'GOOD' : 'MISS';
            this._judge(j, n.lane, true, 0, 2);
          }
          continue;
        }
        if (t - n.t > JUDGE.GOOD.win) {
          if (n.type === 'bomb') {
            n.avoided = true;
          } else if (n.type === 'hold' || n.type === 'shold') {
            n.missed = true; n.done = true; n.broken = true;
            this._judge('MISS', n.lane, false, 0, 2);
          } else if (n.type === 'wide') {
            n.missed = true;
            this._judge('MISS', n.lane, false, 0, 2);
          } else {
            n.missed = true;
            this._judge('MISS', n.lane, false);
          }
        }
      }
      while (this.nextIdx < this.notes.length && this._resolved(this.notes[this.nextIdx])) this.nextIdx++;

      // validation des tenues (y compris transitions des holds mobiles)
      for (let i = this.activeHolds.length - 1; i >= 0; i--) {
        const h = this.activeHolds[i];
        if (t >= h.t2 || this.mAuto) {
          if (t >= h.t2) this._endHold(h, 'PERFECT', true);
          continue; // autopilote : la tenue ne casse jamais
        }
        const req = h.type === 'shold' && t >= h.tm ? h.lane2 : h.lane;
        const inTrans = h.type === 'shold' && Math.abs(t - h.tm) <= SHOLD_TRANS;
        // en Rusher la tenue reste valide tant qu'une touche (n'importe laquelle) est enfoncée
        const ok = this.rusher
          ? this.keysDown.some(Boolean)
          : this.keysDown[req + 1] ||
            (inTrans && (this.keysDown[h.lane + 1] || this.keysDown[h.lane2 + 1]));
        if (!ok) this._endHold(h, 'MISS', false);
      }

      if (this.script) this.script.update(t);
      if (this.state !== 'play') return; // le script peut terminer la partie
      if (t > this.duration + 0.6) { this._finish(); return; }
    }

    this.render(t);
  }

  /* ---------- Rendu ---------- */

  _resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(innerWidth * dpr);
    this.canvas.height = Math.floor(innerHeight * dpr);
    this.gfx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.W = innerWidth;
    this.H = innerHeight;
    this.laneW = Util.clamp(this.W * 0.075, 58, 100);
    this.pfW = this.laneW * 4;
    this.pfX = (this.W - this.pfW) / 2;
    this.recY = this.H - Math.max(110, this.H * 0.16);
    if (this.rusher) {
      // le champ vertical est pivoté de 90° (rotation pure, sans distorsion) :
      //   axe de chute (y, vers recY)  ->  axe horizontal (vers la gauche)
      //   axe des lanes (x)            ->  axe vertical (rails empilés)
      // rails recentrés verticalement, récepteur calé à gauche de l'écran.
      this.laneW = Util.clamp(this.H * 0.105, 52, 96); // espacement des rails
      this.pfW = this.laneW * 4;
      this.pfX = (this.W - this.pfW) / 2;
      this.recScreenX = Math.max(120, this.W * 0.15);
      // la distance de chute (recY) = largeur disponible : les notes entrent
      // par le bord droit et filent jusqu'au récepteur de gauche
      this.recY = Math.max(this.H * 0.55, this.W - this.recScreenX - 30);
      this._rusDX = this.recScreenX + this.recY;
      this._rusDY = this.H / 2 - this.pfX - this.pfW / 2;
    }
  }

  /* ---------- Effets spéciaux (modchart) ---------- */

  // un effet par section (deux au refrain si la map en a plusieurs),
  // jamais pendant intro/outro, montée/descente en douceur.
  // Les effets "par lane" (stutter/portal/dance/scatter) reçoivent leurs
  // lanes cibles : n'importe lesquelles, collées ou séparées, cumulables.
  _buildFxTimeline() {
    const fxList = this.def.fx || [];
    if (!fxList.length || !this.composed.sections) return [];
    const rng = Util.mulberry32(Util.hashStr(this.def.id + '::fx'));
    const spb = this.composed.spb;
    const tl = [];
    let i = 0;
    const mkEntry = (type, start, end, k) => {
      const e = { type, start, end, k };
      if (type === 'portal') {
        e.lanes = [Math.floor(rng() * 4)]; // une seule lane (elle sera isolée)
      } else if (type === 'swap') {
        // une seule paire échangée à la fois (une entrée par section suffit) ;
        // une lane bonus peut participer si sa fenêtre est ouverte pendant l'effet
        const a = Math.floor(rng() * 4);
        let b = (a + 1 + Math.floor(rng() * 3)) % 4;
        if (rng() < 0.3) {
          const xl = rng() < 0.5 ? -1 : 4;
          const open = (this.laneWindows || []).some(w => w.lane === xl &&
            Math.min(w.close, end) - Math.max(w.open, start) > (end - start) * 0.7);
          if (open) b = xl;
        }
        e.lanes = [a, b];
      } else if (type === 'stutter') {
        const a = Math.floor(rng() * 4);
        e.lanes = [a];
        if (rng() < 0.55) { // parfois une 2e lane, collée ou séparée
          const b = rng() < 0.5 ? Util.clamp(a + (rng() < 0.5 ? 1 : -1), 0, 3) : (a + 2) % 4;
          if (b !== a) e.lanes.push(b);
        }
      } else if (type === 'dance' || type === 'scatter') {
        e.lanes = rng() < 0.5
          ? [-1, 0, 1, 2, 3, 4]
          : [0, 1, 2, 3].filter(() => rng() < 0.7);
        if (!e.lanes.length) e.lanes = [0, 1, 2, 3];
      }
      return e;
    };
    for (const sec of this.composed.sections) {
      if (sec.name === 'intro' || sec.name === 'outro') continue;
      const isChorus = sec.name === 'chorus';
      if (!isChorus && rng() > 0.45) continue;
      const start = sec.start * spb, end = sec.end * spb;
      const type = fxList[i++ % fxList.length];
      tl.push(mkEntry(type, start, end, isChorus ? 1 : 0.55));
      if (isChorus && fxList.length > 1 && rng() < 0.5) {
        const second = fxList[i++ % fxList.length];
        if (second !== type) tl.push(mkEntry(second, start, end, 0.5));
      }
    }
    return tl;
  }

  // force 0..1 de chaque effet à l'instant t (enveloppes lissées)
  _computeFx(t, pulse) {
    this._tilt = 0; this._zoom = 1; this._waveAmp = 0;
    this._fxOff = null; this._waveT = t;
    this._camX = 0; this._camY = 0; this._camRot = 0;
    this._laneFx = null;
    this._swap = null;
    if (!this.fxTimeline.length) return;
    const lw = this.laneW;
    const s = {};
    let lf = null;
    const getLf = () => lf || (lf = {
      y: [0, 0, 0, 0, 0, 0],     // décalage vertical (dance)
      x: [0, 0, 0, 0, 0, 0],     // décalage horizontal individuel (scatter)
      quant: [0, 0, 0, 0, 0, 0], // pas de quantification du défilement (stutter)
      cut: [0, 0, 0, 0, 0, 0],   // intensité du portail
    });
    for (const e of this.fxTimeline) {
      if (t < e.start || t > e.end) continue;
      const env = Math.min(Util.clamp((t - e.start) / 1.2, 0, 1), Util.clamp((e.end - t) / 1.2, 0, 1));
      const k = env * env * (3 - 2 * env) * e.k;
      if (e.type === 'swap') {
        // un seul échange simultané : on garde le plus fort
        if (!this._swap || k > this._swap.k) this._swap = { a: e.lanes[0], b: e.lanes[1], k };
        continue;
      }
      if (!e.lanes) { s[e.type] = Math.max(s[e.type] || 0, k); continue; }
      const L = getLf();
      for (const ln of e.lanes) {
        const i = ln + 1;
        switch (e.type) {
          case 'dance': L.y[i] += Math.sin(t * 2.6 + i * 1.25) * 26 * k; break;
          case 'scatter': L.x[i] += Math.sin(t * (1.0 + i * 0.21) + i * 2.4) * lw * 0.45 * k; break;
          case 'stutter':
            if (k > 0.3) L.quant[i] = Math.max(L.quant[i], (this.composed.spb || 0.5) * 0.5);
            break;
          case 'portal': L.cut[i] = Math.max(L.cut[i], k); break;
        }
      }
    }
    const off = [0, 0, 0, 0, 0, 0]; // indexé par lane + 1
    let any = false;
    if (s.sway) {
      const d = Math.sin(t * 0.9) * lw * 0.9 * s.sway;
      for (let i = 0; i < 6; i++) off[i] += d;
      any = true;
    }
    // scission : les lanes s'écartent en 2, 4 ou 6 groupes (champ recentré)
    const SPLITS = {
      split2: { groups: [0, 0, 0, 1, 1, 1], gap: 1.4 },
      split4: { groups: [0, 0, 1, 2, 3, 3], gap: 0.7 },
      split6: { groups: [0, 1, 2, 3, 4, 5], gap: 0.5 },
    };
    for (const key in SPLITS) {
      if (!s[key]) continue;
      const { groups, gap } = SPLITS[key];
      const gp = gap * lw * s[key];
      const mid = groups[5] / 2;
      for (let i = 0; i < 6; i++) off[i] += (groups[i] - mid) * gp;
      any = true;
    }
    if (lf) {
      // portail : la lane coupée s'isole, ses voisines s'écartent
      for (let i = 0; i < 6; i++) {
        const c = lf.cut[i];
        if (!c) continue;
        const gap = lw * 0.55 * c;
        for (let j = 0; j < 6; j++) {
          if (j < i) off[j] -= gap;
          else if (j > i) off[j] += gap;
        }
        any = true;
      }
      for (let i = 0; i < 6; i++) {
        if (lf.x[i]) { off[i] += lf.x[i]; any = true; }
      }
      this._laneFx = lf;
    }
    if (any) this._fxOff = off;
    if (s.tilt) this._tilt = Math.sin(t * 0.7) * 0.06 * s.tilt;
    if (s.pulse) this._zoom = 1 + pulse * 0.04 * s.pulse;
    if (s.wave) this._waveAmp = 26 * s.wave;
    // caméra : secousses sèches et/ou dérive orbitale lente
    if (s.shake) {
      const a = 9 * s.shake * (0.35 + pulse);
      this._camX += Math.sin(t * 47.3) * a;
      this._camY += Math.cos(t * 39.1) * a * 0.7;
    }
    if (s.orbit) {
      this._camX += Math.sin(t * 0.5) * 24 * s.orbit;
      this._camY += Math.cos(t * 0.37) * 15 * s.orbit;
      this._camRot += Math.sin(t * 0.23) * 0.035 * s.orbit;
    }
  }

  _laneY(lane) { return this._laneFx ? this._laneFx.y[lane + 1] : 0; }
  _laneQuant(lane) { return this._laneFx ? this._laneFx.quant[lane + 1] : 0; }

  // échangeur : au-dessus du point de croisement, la note est dessinée sur
  // l'autre lane de la paire ; elle revient chez elle en travers de la bande
  _swapX(lane, y, amtL, amtR) {
    const s = this._swap;
    if (!s || (lane !== s.a && lane !== s.b)) return 0;
    const yCross = this.recY * 0.5;
    let above = Util.clamp((yCross + 44 - y) / 88, 0, 1); // 1 = bien au-dessus
    if (above <= 0) return 0;
    above = above * above * (3 - 2 * above);
    const other = lane === s.a ? s.b : s.a;
    const rA = this._laneRect(lane, amtL, amtR);
    const rB = this._laneRect(other, amtL, amtR);
    if (rB.a < 0.02) return 0; // lane bonus refermée : pas d'échange
    return (rB.x + rB.w / 2 - (rA.x + rA.w / 2)) * above * s.k * Math.min(rA.a, rB.a);
  }

  // ondulation horizontale d'une note, nulle au récepteur (lecture équitable)
  _waveX(y) {
    if (!this._waveAmp) return 0;
    const fall = Util.clamp((this.recY - y) / this.recY, 0, 1);
    return Math.sin(y * 0.018 + this._waveT * 2.4) * this._waveAmp * fall;
  }

  _laneAmt(lane, t) {
    let a = 0;
    for (const w of this.laneWindows) {
      if (w.lane !== lane) continue;
      const k = Util.clamp(Math.min((t - w.open) / LANE_ANIM, (w.close - t) / LANE_ANIM), 0, 1);
      a = Math.max(a, k * k * (3 - 2 * k));
    }
    return a;
  }

  _laneRect(lane, amtL, amtR) {
    const { pfX, pfW, laneW } = this;
    const off = this._fxOff ? this._fxOff[lane + 1] : 0;
    if (lane === -1) return { x: pfX - laneW * amtL + off, w: laneW * amtL, a: amtL };
    if (lane === 4) return { x: pfX + pfW + off, w: laneW * amtR, a: amtR };
    return { x: pfX + lane * laneW + off, w: laneW, a: 1 };
  }

  render(t) {
    const g = this.gfx, W = this.W, H = this.H;
    const hue = this.def.hue;
    const beat = t / this.composed.spb;
    const beatPhase = beat >= 0 ? beat % 1 : 0;
    const pulse = Math.pow(1 - beatPhase, 2.2);

    g.fillStyle = '#06070d';
    g.fillRect(0, 0, W, H);

    BG.draw(g, this.bg, { W, H, hue, t: performance.now() / 1000, pulse });

    const grad = g.createRadialGradient(W / 2, H, 60, W / 2, H, H * 0.75);
    grad.addColorStop(0, `hsla(${hue}, 95%, 60%, ${0.10 + 0.10 * pulse})`);
    grad.addColorStop(1, 'transparent');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);

    this._computeFx(Math.max(t, 0), pulse);
    // Rusher : on pivote tout le champ à l'horizontale (rotation pure). Les
    // effets sont calculés en amont, dans l'espace du jeu, donc tous conservés.
    if (this.rusher) { g.save(); g.transform(0, 1, -1, 0, this._rusDX, this._rusDY); }
    const warped = this._tilt !== 0 || this._zoom !== 1 ||
      this._camX !== 0 || this._camY !== 0 || this._camRot !== 0;
    if (warped) {
      g.save();
      g.translate(W / 2 + this._camX, this.recY + this._camY);
      g.rotate(this._tilt + this._camRot);
      g.scale(this._zoom, this._zoom);
      g.translate(-W / 2, -this.recY);
    }
    this._renderPlayfield(g, t, hue, pulse);
    if (warped) g.restore();
    if (this.rusher) g.restore();
    this._renderHud(g, t, hue);
    this._renderCaption(g, t);

    if (t < 0) {
      const n = Math.ceil(-t);
      g.textAlign = 'center';
      g.font = `900 ${Math.min(90, W * 0.1)}px Orbitron, sans-serif`;
      g.fillStyle = `hsla(${hue}, 100%, 70%, ${0.4 + 0.6 * (1 - (-t % 1))})`;
      g.fillText(n <= 2 ? String(n) : 'PRÊT', W / 2, H * 0.4);
    }
  }

  _renderPlayfield(g, t, hue, pulse) {
    const { pfX, pfW, laneW, recY, H } = this;
    const speed = 130 + this.app.settings.speed * 75;
    const amtL = this._laneAmt(-1, t);
    const amtR = this._laneAmt(4, t);
    const lanes = [-1, 0, 1, 2, 3, 4];

    if (!this.rusher) {
      // --- mode Solo : fonds de lane + bordures (les "lignes") + récepteurs ---
      // halo lumineux sur chaque bord exposé (extrémités et flancs des scissions)
      const rects = [];
      for (const l of lanes) {
        const r = this._laneRect(l, amtL, amtR);
        if (r.a < 0.02) continue;
        rects.push({ l, r });
        g.fillStyle = `rgba(8, 10, 22, ${0.78 * r.a})`;
        g.fillRect(r.x, 0, r.w, H);
        if (this.keysDown[l + 1]) {
          const ry = recY + this._laneY(l);
          const lg = g.createLinearGradient(0, ry, 0, ry - 260);
          lg.addColorStop(0, `hsla(${hue}, 90%, 60%, ${0.28 * r.a})`);
          lg.addColorStop(1, 'transparent');
          g.fillStyle = lg;
          g.fillRect(r.x, ry - 260, r.w, 260);
        }
      }
      for (let i = 0; i < rects.length; i++) {
        const { l, r } = rects[i];
        const prev = rects[i - 1], next = rects[i + 1];
        const openL = !prev || r.x - (prev.r.x + prev.r.w) > 2;
        const openR = !next || next.r.x - (r.x + r.w) > 2;
        const glow = bonus => bonus
          ? `hsla(45, 100%, 65%, ${(0.4 + 0.3 * pulse) * r.a})`
          : `hsla(${hue}, 90%, 65%, ${(0.35 + 0.3 * pulse) * r.a})`;
        if (openL) {
          g.lineWidth = 2;
          g.strokeStyle = glow(l === -1);
        } else {
          g.lineWidth = 1;
          g.strokeStyle = `rgba(150, 165, 255, ${0.10 * r.a})`;
        }
        g.beginPath(); g.moveTo(r.x, 0); g.lineTo(r.x, H); g.stroke();
        if (openR) {
          g.lineWidth = 2;
          g.strokeStyle = glow(l === 4);
          g.beginPath(); g.moveTo(r.x + r.w, 0); g.lineTo(r.x + r.w, H); g.stroke();
        }
      }

      // récepteurs (un par lane, avec l'étiquette de touche)
      const keys = this.app.settings.keys;
      const keysX = this.app.settings.keysX;
      g.textAlign = 'center';
      for (const l of lanes) {
        const r = this._laneRect(l, amtL, amtR);
        if (r.a < 0.02) continue;
        const ry = recY + this._laneY(l);
        const x = r.x + 5, w = Math.max(r.w - 10, 4);
        const down = this.keysDown[l + 1];
        const bonus = l === -1 || l === 4;
        g.globalAlpha = r.a;
        g.strokeStyle = down ? (bonus ? 'hsl(45, 100%, 70%)' : `hsl(${hue}, 100%, 75%)`)
                             : bonus ? 'rgba(255, 209, 102, 0.7)' : 'rgba(220, 228, 255, 0.55)';
        g.lineWidth = down ? 3 : 2;
        this._rrect(g, x, ry - 13, w, 26, 8);
        g.stroke();
        if (down) {
          g.fillStyle = bonus ? 'hsla(45, 100%, 70%, 0.25)' : `hsla(${hue}, 100%, 70%, 0.25)`;
          this._rrect(g, x, ry - 13, w, 26, 8);
          g.fill();
        }
        g.fillStyle = bonus ? 'rgba(255, 209, 102, 0.6)' : 'rgba(200, 210, 255, 0.4)';
        g.font = '600 13px Rajdhani, sans-serif';
        const label = l === -1 ? Util.keyLabel(keysX[0]) : l === 4 ? Util.keyLabel(keysX[1]) : Util.keyLabel(keys[l]);
        g.fillText(label, r.x + r.w / 2, ry + 38);
        g.globalAlpha = 1;
      }
    } else {
      // --- mode Rusher : pas de lignes de rail, juste la barre de frappe ---
      const flash = Util.clamp(1 - (performance.now() - (this._pressPulse || 0)) / 160, 0, 1);
      const lo = this._laneRect(-1, amtL, amtR), hi = this._laneRect(4, amtL, amtR);
      const yTop = lo.a > 0.02 ? lo.x : this._laneRect(0, amtL, amtR).x;
      const yBot = hi.a > 0.02 ? hi.x + hi.w : this._laneRect(3, amtL, amtR).x + this._laneRect(3, amtL, amtR).w;
      // barre blanche de frappe (devient verticale après rotation)
      g.strokeStyle = `rgba(255, 255, 255, ${0.7 + 0.3 * flash})`;
      g.lineWidth = 4 + 3 * flash;
      g.beginPath(); g.moveTo(yTop - 16, recY); g.lineTo(yBot + 16, recY); g.stroke();
      // pastilles de récepteur sur chaque rail
      for (const l of lanes) {
        const r = this._laneRect(l, amtL, amtR);
        if (r.a < 0.02) continue;
        g.globalAlpha = r.a;
        g.strokeStyle = `rgba(255, 255, 255, ${0.5 + 0.4 * flash})`;
        g.lineWidth = 2;
        g.beginPath(); g.arc(r.x + r.w / 2, recY + this._laneY(l), 12, 0, 7); g.stroke();
        g.globalAlpha = 1;
      }
    }

    // notes
    const laneHue = l => (l === 1 || l === 2) ? (hue + 45) % 360 : hue;
    for (const n of this.notes) {
      if (n.type === 'bomb') { if (n.triggered) continue; }
      else if (n.type === 'roll') { if (n.done) continue; }
      else if (n.type === 'hold' || n.type === 'shold') {
        if (n.done || n.missed) continue;
        if (n.hit && !n.holding) continue;
      }
      else if (n.hit || n.missed) continue;

      const r = this._laneRect(n.lane, amtL, amtR);
      if (r.a < 0.02) continue;
      // effets par lane : danse (décalage vertical) et latence (à-coups)
      const yOff = this._laneY(n.lane);
      const quant = this._laneQuant(n.lane);
      const tEff = quant ? Math.floor(t / quant) * quant : t;
      const savedRecY = this.recY;
      this.recY += yOff; // les aides de dessin lisent this.recY
      const y = this.recY - (n.t - tEff) * speed;
      const topY = n.t2 ? this.recY - (n.t2 - tEff) * speed : y;
      // en Rusher l'axe de chute = la largeur (recY > H), on cale la borne dessus
      const cullHi = (this.rusher ? this.recY : H) + 80;
      if ((y < -80 && topY < -80) || (y > cullHi && topY > cullHi)) {
        this.recY = savedRecY;
        continue;
      }
      let cx = r.x + r.w / 2;
      // wave et swap : seules les notes mono-lane sans durée sont déviées
      if (!n.t2 && n.lane2 === -9) {
        cx += this._waveX(y);
        cx += this._swapX(n.lane, y, amtL, amtR);
      }
      const w = Math.max(r.w - 12, 6);
      let alpha = r.a;
      // mod "sans repère" : les notes s'évanouissent à l'approche
      if (this.mHidden) alpha *= Util.clamp((this.recY - 70 - y) / 230, 0.04, 1);

      if (n.type === 'bomb') {
        if (n.avoided) alpha *= Math.max(0, 1 - (t - n.t - JUDGE.GOOD.win) * 3);
        if (alpha > 0.02) this._drawBomb(g, cx, y, Math.min(w, 40), alpha, t);
      } else if (n.type === 'roll') {
        this._drawRoll(g, n, cx, w, tEff, speed, alpha);
      } else if (n.type === 'shold') {
        this._drawShold(g, n, tEff, speed, amtL, amtR, laneHue(n.lane), alpha);
      } else if (n.type === 'hold') {
        this._drawHold(g, n, cx, w, y, topY, laneHue(n.lane), alpha);
      } else if (n.type === 'wide') {
        this._drawWide(g, n, tEff, speed, amtL, amtR, alpha);
      } else if (n.type === 'exp') {
        this._drawExp(g, cx, y, w, n.dir, alpha);
      } else {
        let skip = false;
        if (n.ghost) {
          const vis = Util.clamp(((n.t - t) - 0.1) / 0.25, 0, 1);
          // contour fantomatique toujours légèrement visible
          g.globalAlpha = alpha * 0.15;
          g.strokeStyle = '#cfd8ff';
          g.lineWidth = 1.5;
          this._rrect(g, cx - w / 2, y - 11, w, 22, 7);
          g.stroke();
          g.globalAlpha = 1;
          if (vis <= 0.02) skip = true;
          alpha *= vis;
        }
        if (!skip) this._drawTap(g, cx, y, w, laneHue(n.lane), alpha);
      }
      this.recY = savedRecY;
    }
    g.shadowBlur = 0;
    g.globalAlpha = 1;

    // portails : bande de néant qui coupe la lane en deux — les notes
    // y disparaissent (la bande est dessinée par-dessus) et ressortent dessous
    if (this._laneFx) {
      for (const l of lanes) {
        const c = this._laneFx.cut[l + 1];
        if (!c) continue;
        const r = this._laneRect(l, amtL, amtR);
        if (r.a < 0.02) continue;
        const yTop = (recY + this._laneY(l)) * 0.45;
        const bandH = 110 * c;
        g.fillStyle = '#06070d';
        g.fillRect(r.x - 2, yTop, r.w + 4, bandH);
        for (const [py, ph] of [[yTop, 265], [yTop + bandH, 25]]) {
          g.shadowBlur = 14;
          g.shadowColor = `hsl(${ph}, 95%, 60%)`;
          g.fillStyle = `hsla(${ph}, 95%, 62%, ${0.85 * c * r.a})`;
          this._rrect(g, r.x + 2, py - 4, r.w - 4, 8, 4);
          g.fill();
        }
        g.shadowBlur = 0;
      }
    }

    // échangeur : croisillon animé entre les deux lanes échangées
    if (this._swap && this._swap.k > 0.04) {
      const s = this._swap;
      const rA = this._laneRect(s.a, amtL, amtR);
      const rB = this._laneRect(s.b, amtL, amtR);
      if (rA.a > 0.02 && rB.a > 0.02) {
        const yC = recY * 0.5;
        const cxA = rA.x + rA.w / 2, cxB = rB.x + rB.w / 2;
        g.globalAlpha = s.k * Math.min(rA.a, rB.a) * 0.8;
        g.setLineDash([9, 9]);
        g.lineDashOffset = -(performance.now() / 28) % 18;
        g.lineWidth = 2.5;
        g.strokeStyle = '#28e6ff';
        g.beginPath(); g.moveTo(cxA, yC - 46); g.lineTo(cxB, yC + 46); g.stroke();
        g.strokeStyle = '#ff3df0';
        g.beginPath(); g.moveTo(cxB, yC - 46); g.lineTo(cxA, yC + 46); g.stroke();
        g.setLineDash([]);
        g.globalAlpha = 1;
      }
    }

    // compteurs de roulement (omis en Rusher : le texte serait pivoté)
    g.font = '700 18px Orbitron, sans-serif';
    for (const n of this.notes) {
      if (this.rusher) break;
      if (n.type !== 'roll' || n.done) continue;
      if (t < n.t - 0.6 || t > n.t2 + 0.05) continue;
      const r = this._laneRect(n.lane, amtL, amtR);
      const recent = n.lastHit && performance.now() - n.lastHit < 90;
      g.fillStyle = recent ? '#ffffff' : ROLL_COLOR;
      g.fillText(`${n.hits}/${n.need}`, r.x + r.w / 2, recY + this._laneY(n.lane) - 54);
    }

    // mod "lampe torche" : seul le bas du champ est éclairé
    if (this.mFlash) {
      const top = this.recY - 310;
      g.fillStyle = 'rgba(4, 5, 10, 0.97)';
      g.fillRect(0, -this.H, this.W, top + this.H);
      const fg = g.createLinearGradient(0, top, 0, this.recY - 130);
      fg.addColorStop(0, 'rgba(4, 5, 10, 0.97)');
      fg.addColorStop(1, 'rgba(4, 5, 10, 0)');
      g.fillStyle = fg;
      g.fillRect(0, top, this.W, this.recY - 130 - top);
    }

    // effets de frappe
    const nowMs = performance.now();
    this.fx = this.fx.filter(f => nowMs - f.t0 < 320);
    for (const f of this.fx) {
      const p = (nowMs - f.t0) / 320;
      const r = this._laneRect(f.lane, amtL, amtR);
      const cx = r.x + r.w / 2;
      g.globalAlpha = 1 - p;
      g.strokeStyle = JUDGE[f.judge].color;
      g.lineWidth = (f.judge === 'BOMB' ? 5 : 3) * (1 - p);
      g.beginPath();
      g.arc(cx, recY + this._laneY(f.lane), 14 + p * (f.judge === 'BOMB' ? 60 : 36), 0, 7);
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  _drawTap(g, cx, y, w, lh, alpha) {
    const h = 22;
    g.globalAlpha = alpha;
    g.shadowBlur = 14;
    g.shadowColor = `hsl(${lh}, 100%, 60%)`;
    const ng = g.createLinearGradient(0, y - h / 2, 0, y + h / 2);
    ng.addColorStop(0, `hsl(${lh}, 100%, 78%)`);
    ng.addColorStop(1, `hsl(${lh}, 95%, 55%)`);
    g.fillStyle = ng;
    this._rrect(g, cx - w / 2, y - h / 2, w, h, 7);
    g.fill();
    g.shadowBlur = 0;
    g.globalAlpha = 1;
  }

  _drawHold(g, n, cx, w, y, topY, lh, alpha) {
    const headY = n.holding ? this.recY : y;
    const bw = w * 0.45;
    g.globalAlpha = alpha * (n.holding ? 0.95 : 0.65);
    if (n.holding) {
      g.shadowBlur = 16;
      g.shadowColor = `hsl(${lh}, 100%, 65%)`;
    }
    const bg = g.createLinearGradient(0, topY, 0, headY);
    bg.addColorStop(0, `hsla(${lh}, 95%, 70%, 0.55)`);
    bg.addColorStop(1, `hsla(${lh}, 95%, 60%, 0.9)`);
    g.fillStyle = bg;
    this._rrect(g, cx - bw / 2, topY, bw, Math.max(headY - topY, 4), bw / 2);
    g.fill();
    g.fillStyle = `hsl(${lh}, 100%, 80%)`;
    this._rrect(g, cx - bw / 2 - 4, topY - 5, bw + 8, 10, 5);
    g.fill();
    g.shadowBlur = 0;
    g.globalAlpha = 1;
    this._drawTap(g, cx, headY, w, lh, alpha);
  }

  _drawShold(g, n, t, speed, amtL, amtR, lh, alpha) {
    const rA = this._laneRect(n.lane, amtL, amtR);
    const rB = this._laneRect(n.lane2, amtL, amtR);
    const cxA = rA.x + rA.w / 2, cxB = rB.x + rB.w / 2;
    const w = Math.max(rA.w - 12, 6);
    const bw = w * 0.45;
    const yHead = n.holding ? this.recY : this.recY - (n.t - t) * speed;
    const yTm = this.recY - (n.tm - t) * speed;
    const yTop = this.recY - (n.t2 - t) * speed;
    const past = t >= n.tm;

    g.globalAlpha = alpha * (n.holding ? 0.95 : 0.65);
    if (n.holding) { g.shadowBlur = 16; g.shadowColor = `hsl(${lh}, 100%, 65%)`; }
    g.strokeStyle = `hsla(${lh}, 95%, 65%, 0.85)`;
    g.lineWidth = bw;
    g.lineCap = 'round';
    g.beginPath();
    if (!past || !n.holding) {
      g.moveTo(cxA, Math.max(yHead, yTm + 14));
      g.lineTo(cxA, yTm + 14);
      g.lineTo(cxB, yTm - 14);
      g.lineTo(cxB, yTop);
    } else {
      g.moveTo(cxB, yHead);
      g.lineTo(cxB, yTop);
    }
    g.stroke();
    g.shadowBlur = 0;

    // flèche de direction au point de transition
    if (t < n.tm + 0.1) {
      const dir = Math.sign(n.lane2 - n.lane);
      const mx = (cxA + cxB) / 2;
      g.strokeStyle = '#ffffff';
      g.lineWidth = 3.5;
      for (const off of [-7, 4]) {
        g.beginPath();
        g.moveTo(mx + dir * (off - 5), yTm - 8);
        g.lineTo(mx + dir * (off + 5), yTm);
        g.lineTo(mx + dir * (off - 5), yTm + 8);
        g.stroke();
      }
    }
    // extrémité
    g.fillStyle = `hsl(${lh}, 100%, 80%)`;
    this._rrect(g, cxB - bw / 2 - 4, yTop - 5, bw + 8, 10, 5);
    g.fill();
    g.globalAlpha = 1;

    const headCx = n.holding && past ? cxB : cxA;
    this._drawTap(g, headCx, yHead, w, lh, alpha);
  }

  _drawRoll(g, n, cx, w, t, speed, alpha) {
    const yBot = Math.min(this.recY - (n.t - t) * speed, t >= n.t ? this.recY : 1e9);
    const yTop = this.recY - (n.t2 - t) * speed;
    const bw = w * 0.78;
    const x = cx - bw / 2;
    g.globalAlpha = alpha;
    g.shadowBlur = 12;
    g.shadowColor = ROLL_COLOR;
    g.fillStyle = 'rgba(255, 159, 67, 0.22)';
    this._rrect(g, x, yTop, bw, Math.max(yBot - yTop, 8), 11);
    g.fill();
    g.strokeStyle = ROLL_COLOR;
    g.lineWidth = 2.5;
    this._rrect(g, x, yTop, bw, Math.max(yBot - yTop, 8), 11);
    g.stroke();
    g.shadowBlur = 0;
    // rayures diagonales animées
    g.save();
    this._rrect(g, x, yTop, bw, Math.max(yBot - yTop, 8), 11);
    g.clip();
    g.strokeStyle = 'rgba(255, 159, 67, 0.55)';
    g.lineWidth = 4;
    const offset = (performance.now() / 24) % 16;
    for (let yy = yTop - 20 + offset; yy < yBot + 20; yy += 16) {
      g.beginPath();
      g.moveTo(x - 6, yy + 12);
      g.lineTo(x + bw + 6, yy - 12);
      g.stroke();
    }
    g.restore();
    g.globalAlpha = 1;
  }

  _drawWide(g, n, t, speed, amtL, amtR, alpha) {
    const rA = this._laneRect(n.lane, amtL, amtR);
    const rB = this._laneRect(n.lane2, amtL, amtR);
    const y = this.recY - (n.t - t) * speed;
    const x0 = rA.x + 6, x1 = rB.x + rB.w - 6;
    const h = 24;
    g.globalAlpha = alpha;
    g.shadowBlur = 16;
    g.shadowColor = '#b78aff';
    const ng = g.createLinearGradient(x0, 0, x1, 0);
    ng.addColorStop(0, '#f3ecff');
    ng.addColorStop(0.5, '#b78aff');
    ng.addColorStop(1, '#f3ecff');
    g.fillStyle = ng;
    this._rrect(g, x0, y - h / 2, x1 - x0, h, 9);
    g.fill();
    g.shadowBlur = 0;
    // repères des deux touches
    g.fillStyle = 'rgba(30, 18, 60, 0.85)';
    for (const cx of [rA.x + rA.w / 2, rB.x + rB.w / 2]) {
      g.beginPath();
      g.arc(cx, y, 5, 0, 7);
      g.fill();
    }
    // moitié déjà pressée
    if (n.p1 > -9 && t - n.p1 <= WIDE_SYNC) {
      const rp = n.p1Lane === n.lane ? rA : rB;
      g.fillStyle = 'rgba(255, 255, 255, 0.5)';
      this._rrect(g, rp.x + 6, y - h / 2, rp.w - 12, h, 9);
      g.fill();
    }
    g.globalAlpha = 1;
  }

  _drawBomb(g, cx, y, size, alpha, t) {
    const r = size * 0.45;
    g.save();
    g.globalAlpha = alpha;
    g.translate(cx, y);
    g.rotate(t * 1.6);
    g.shadowBlur = 18;
    g.shadowColor = '#ff2244';
    g.fillStyle = '#26060e';
    g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill();
    g.strokeStyle = '#ff2244';
    g.lineWidth = 2.5;
    g.beginPath(); g.arc(0, 0, r, 0, 7); g.stroke();
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4;
      g.beginPath();
      g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      g.lineTo(Math.cos(a) * (r + 6), Math.sin(a) * (r + 6));
      g.stroke();
    }
    g.lineWidth = 3;
    g.strokeStyle = '#ff647e';
    g.beginPath();
    g.moveTo(-r * 0.4, -r * 0.4); g.lineTo(r * 0.4, r * 0.4);
    g.moveTo(r * 0.4, -r * 0.4); g.lineTo(-r * 0.4, r * 0.4);
    g.stroke();
    g.restore();
  }

  _drawExp(g, cx, y, w, dir, alpha) {
    g.save();
    g.globalAlpha = alpha;
    g.shadowBlur = 18;
    g.shadowColor = '#ffd166';
    g.fillStyle = '#ffd166';
    this._rrect(g, cx - w / 2, y - 11, w, 22, 7);
    g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = '#26060e';
    g.lineWidth = 3;
    g.lineCap = 'round';
    for (const off of [-5, 5]) {
      g.beginPath();
      g.moveTo(cx + dir * (off - 4), y - 6);
      g.lineTo(cx + dir * (off + 4), y);
      g.lineTo(cx + dir * (off - 4), y + 6);
      g.stroke();
    }
    g.restore();
  }

  _renderCaption(g, t) {
    if (!this.script || !this.script.caption) return;
    const s = this.script;
    const { W } = this;
    const lines = s.caption.split('\n');
    const step = s.steps[s.idx];
    const showProgress = step && step.need && (s.phase === 'practice' || s.phase === 'explain');
    const extra = showProgress ? 1 : 0;
    const boxW = Math.min(W * 0.86, 680);
    const boxH = 36 + (lines.length + extra) * 27;
    const x = (W - boxW) / 2, y = 92;
    g.fillStyle = 'rgba(14, 18, 38, 0.88)';
    this._rrect(g, x, y, boxW, boxH, 14);
    g.fill();
    g.strokeStyle = 'rgba(140, 160, 255, 0.35)';
    g.lineWidth = 1.5;
    this._rrect(g, x, y, boxW, boxH, 14);
    g.stroke();
    g.textAlign = 'center';
    g.font = '600 19px Rajdhani, sans-serif';
    g.fillStyle = '#e8ecff';
    lines.forEach((line, i) => g.fillText(line, W / 2, y + 31 + i * 27));
    if (showProgress) {
      g.font = '700 18px Rajdhani, sans-serif';
      g.fillStyle = '#28e6ff';
      g.fillText(`Réussites : ${s.successes} / ${step.need}`, W / 2, y + 31 + lines.length * 27);
    }
    // feedback éclair sous la boîte
    if (s.flash && performance.now() - s.flash.t0 < 800) {
      const a = 1 - (performance.now() - s.flash.t0) / 800;
      g.globalAlpha = a;
      g.font = '700 22px Rajdhani, sans-serif';
      g.fillStyle = s.flash.ok ? '#7dff9b' : '#ff4d6d';
      g.fillText(s.flash.ok ? '✓' : '✗ Réessayez !', W / 2, y + boxH + 30);
      g.globalAlpha = 1;
    }
  }

  _renderHud(g, t, hue) {
    const { W, pfX, pfW, H } = this;
    const m = 18;

    const prog = Util.clamp(t / this.duration, 0, 1);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fillRect(0, 0, W, 4);
    g.fillStyle = `hsl(${hue}, 95%, 60%)`;
    g.fillRect(0, 0, W * prog, 4);

    if (!this.tutorial) {
      g.textAlign = 'left';
      g.font = '700 30px Rajdhani, sans-serif';
      g.fillStyle = '#e8ecff';
      g.fillText(Util.fmtScore(this.score), m, 46);
      g.font = '500 15px Rajdhani, sans-serif';
      g.fillStyle = 'rgba(180, 190, 230, 0.8)';
      g.fillText('SCORE', m, 64);

      const acc = this.judged ? (this.earned / this.judged) * 100 : 100;
      g.textAlign = 'right';
      g.font = '700 30px Rajdhani, sans-serif';
      g.fillStyle = '#e8ecff';
      g.fillText(acc.toFixed(2) + '%', W - m, 46);
      g.font = '500 15px Rajdhani, sans-serif';
      g.fillStyle = 'rgba(180, 190, 230, 0.8)';
      g.fillText('PRÉCISION', W - m, 64);
    }

    g.textAlign = 'center';
    g.font = '600 15px Rajdhani, sans-serif';
    g.fillStyle = 'rgba(180, 190, 230, 0.7)';
    g.fillText(this.tutorial
      ? `TUTORIEL — étape ${Math.max(this.script.idx, 0) + 1} / ${this.script.steps.length}`
      : this.endless && this.runInfo
        ? `${this.runInfo.label} — Segment ${this.runInfo.segment} · ${this.def.title} ★${this.def.stars}`
        : `${this.def.title} — ★ ${this.def.stars}`, W / 2, 28);
    if (this.endless && this.runInfo) {
      // score total du run (segments précédents + courant) + boons actifs
      const icons = [...this.mods].map(id => (GAME_MODS[id] || {}).icon || '').join(' ');
      g.font = '700 16px Rajdhani, sans-serif';
      g.fillStyle = `hsl(${hue}, 95%, 72%)`;
      g.fillText('TOTAL ' + Util.fmtScore(this.runInfo.totalScore + this.score)
        + (icons ? '   ' + icons : ''), W / 2, 78);
    }
    if (this.mods.size && !this.endless) {
      g.font = '600 14px Rajdhani, sans-serif';
      g.fillText([...this.mods].map(id => (GAME_MODS[id] || {}).icon || '').join(' ')
        + (this.modMult !== 1 ? `  ×${this.modMult.toFixed(2)}` : ''), W / 2, 78);
    }
    if (this.rusher) {
      g.font = '700 14px Rajdhani, sans-serif';
      g.fillStyle = `hsla(${hue}, 100%, 72%, 0.9)`;
      g.fillText('🏁 RUSHER — n\'importe quelle touche', W / 2, 78);
    }

    const hbW = pfW * 0.9, hbX = pfX + (pfW - hbW) / 2, hbY = 44;
    g.fillStyle = 'rgba(255,255,255,0.1)';
    this._rrect(g, hbX, hbY, hbW, 8, 4); g.fill();
    const hpRatio = this.health / 100;
    g.fillStyle = hpRatio > 0.5 ? `hsl(${hue}, 90%, 60%)` : hpRatio > 0.25 ? '#ffd166' : '#ff4d6d';
    if (hpRatio > 0) { this._rrect(g, hbX, hbY, hbW * hpRatio, 8, 4); g.fill(); }

    // autopilote : filigrane permanent, impossible de confondre avec une vraie partie
    if (this.mAuto) {
      const aa = 0.16 + 0.08 * Math.sin(performance.now() / 380);
      g.textAlign = 'center';
      g.font = `900 ${Math.min(72, W * 0.07)}px Orbitron, sans-serif`;
      g.fillStyle = `rgba(40, 230, 255, ${aa})`;
      g.fillText('AUTOPILOT', W / 2, H * 0.55);
      g.font = '600 16px Rajdhani, sans-serif';
      g.fillStyle = `rgba(180, 190, 230, ${aa + 0.15})`;
      g.fillText('partie non classée', W / 2, H * 0.55 + 28);
    }

    const nowMs = performance.now();
    if (this.combo >= 2) {
      const since = this.judgeFlash ? nowMs - this.judgeFlash.t0 : 999;
      const pop = since < 120 ? 1 + 0.25 * (1 - since / 120) : 1;
      g.save();
      g.translate(W / 2, H * 0.38);
      g.scale(pop, pop);
      g.font = '900 56px Orbitron, sans-serif';
      g.fillStyle = `hsla(${hue}, 100%, 75%, 0.9)`;
      g.shadowColor = `hsl(${hue}, 100%, 60%)`;
      g.shadowBlur = 22;
      g.fillText(String(this.combo), 0, 0);
      g.shadowBlur = 0;
      g.font = '600 16px Rajdhani, sans-serif';
      g.fillStyle = 'rgba(220, 228, 255, 0.65)';
      g.fillText('COMBO', 0, 24);
      g.restore();
    }

    if (this.judgeFlash) {
      const since = nowMs - this.judgeFlash.t0;
      if (since < 500) {
        const info = JUDGE[this.judgeFlash.judge];
        const a = since < 350 ? 1 : 1 - (since - 350) / 150;
        // en Rusher le champ est centré : on affiche le jugement vers le bas
        const jy = this.rusher ? H * 0.86 : this.recY - 110;
        g.textAlign = 'center';
        g.globalAlpha = a;
        g.font = '900 30px Orbitron, sans-serif';
        g.fillStyle = info.color;
        g.shadowColor = info.color;
        g.shadowBlur = 16;
        g.fillText(info.label, W / 2, jy);
        g.shadowBlur = 0;
        const jj = this.judgeFlash.judge;
        if (jj !== 'MISS' && jj !== 'PERFECT' && jj !== 'BOMB') {
          const ms = Math.round(this.judgeFlash.delta * 1000);
          g.font = '600 14px Rajdhani, sans-serif';
          g.fillStyle = 'rgba(220,228,255,0.7)';
          g.fillText(ms > 0 ? `+${ms} ms (tard)` : `${ms} ms (tôt)`, W / 2, jy + 22);
        }
        g.globalAlpha = 1;
      }
    }
  }

  _rrect(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
}

/*
 * Déroulé interactif du tutoriel : pour chaque touche puis chaque mécanique,
 * on explique, on laisse le joueur s'exercer, et on ne passe à la suite
 * qu'après le nombre de réussites requis. Un raté fait simplement
 * réapparaître une note d'exercice.
 */
class TutorialScript {
  constructor(game) {
    this.g = game;
    const K = game.app.settings.keys.map(Util.keyLabel);
    const KX = game.app.settings.keysX.map(Util.keyLabel);

    this.steps = [
      { text: 'Bienvenue dans PULSE//KEYS !\nLes notes tombent vers la ligne lumineuse en bas.', wait: 3.4 },
      { text: `Touche ${K[0]} = 1re colonne (tout à gauche).\nFrappez la note pile quand elle touche la ligne !`, need: 3, spawn: () => this.tap(0) },
      { text: `Touche ${K[1]} = 2e colonne.\nÀ vous !`, need: 3, spawn: () => this.tap(1) },
      { text: `Touche ${K[2]} = 3e colonne.\nContinuez !`, need: 3, spawn: () => this.tap(2) },
      { text: `Touche ${K[3]} = 4e colonne (tout à droite).\nDernière des touches principales !`, need: 3, spawn: () => this.tap(3) },
      { text: `Enchaînez maintenant sur les 4 colonnes\n(${K[0]} ${K[1]} ${K[2]} ${K[3]}) !`, need: 6, spawn: () => this.tap(this.cycle()) },
      { text: 'NOTE LONGUE : frappez la tête puis MAINTENEZ\nla touche jusqu’au bout de la traîne.', need: 2, spawn: () => this.hold() },
      { text: 'ROULEMENT (zone rayée orange) : martelez la touche !\nAtteignez le quota affiché au-dessus du récepteur.', need: 2, spawn: () => this.roll() },
      { text: 'HOLD MOBILE : la tenue glisse vers la colonne voisine.\nSuivez la flèche et changez de touche sans lâcher !', need: 2, spawn: () => this.shold() },
      { text: 'NOTE DOUBLE (barre violette) : frappez les DEUX\ntouches en même temps.', need: 2, spawn: () => this.wide() },
      { text: 'NOTE FANTÔME : elle s’efface en approchant,\nseul un fin contour reste. Gardez le rythme !', need: 3, spawn: () => this.ghost() },
      { text: 'BOMBE : n’appuyez PAS sur sa touche !\nLaissez-la passer pour réussir.', need: 2, spawn: () => this.bomb() },
      { text: `CHEVRON DORÉ : il ouvre la lane bonus à DROITE.\nFrappez-le, puis jouez les notes avec ${KX[1]} !`, need: 4, spawn: () => this.bonus(1), teardown: () => this.closeSide() },
      { text: `Pareil à GAUCHE : chevron,\npuis les notes bonus avec ${KX[0]} !`, need: 4, spawn: () => this.bonus(0), teardown: () => this.closeSide() },
      { text: 'Certaines maps (marquées ✨) ont des EFFETS SPÉCIAUX :\nle champ de jeu bouge, mais vos touches ne changent JAMAIS.', wait: 3.8 },
      { text: 'GLISSEMENT : le champ oscille de gauche à droite.\nSuivez vos colonnes des yeux !', need: 3, spawn: () => this.tap(this.cycle()), setup: () => this.fxOn('sway'), teardown: () => this.fxOff() },
      { text: 'SCISSION : les colonnes s’écartent en groupes\n(×2, ×4, voire ×6 sur certaines maps) !', need: 3, spawn: () => this.tap(this.cycle()), setup: () => this.fxOn('split4'), teardown: () => this.fxOff() },
      { text: 'BASCULE + PULSATION : le champ s’incline\net zoome au rythme. Restez concentré !', need: 3, spawn: () => this.tap(this.cycle()), setup: () => { this.fxOn('tilt'); this.fxOn('pulse'); }, teardown: () => this.fxOff() },
      { text: 'ONDULATION : les notes serpentent en tombant…\nmais arrivent toujours droit sur le récepteur !', need: 3, spawn: () => this.tap(this.cycle()), setup: () => this.fxOn('wave'), teardown: () => this.fxOff() },
      { text: 'CAMÉRA : secousses et dérive orbitale.\nLe champ entier voyage — gardez le cap !', need: 3, spawn: () => this.tap(this.cycle()), setup: () => { this.fxOn('orbit', 0.8); this.fxOn('shake', 0.5); }, teardown: () => this.fxOff() },
      { text: 'DANSE & DISPERSION : chaque colonne\nvit sa propre vie, indépendamment des autres !', need: 3, spawn: () => this.tap(this.cycle()), setup: () => { this.fxOn('dance', 0.8, [0, 1, 2, 3]); this.fxOn('scatter', 0.5, [0, 1, 2, 3]); }, teardown: () => this.fxOff() },
      { text: 'LATENCE : sur les colonnes touchées, les notes\ndescendent par À-COUPS. Fiez-vous à la musique !', need: 3, spawn: () => this.tap(1 + (this.cycleI++ % 2)), setup: () => this.fxOn('stutter', 1, [1, 2]), teardown: () => this.fxOff() },
      { text: 'PORTAIL : la colonne s’isole et se coupe en deux.\nLes notes traversent le néant et ressortent dessous !', need: 3, spawn: () => this.tap(2), setup: () => this.fxOn('portal', 1, [2]), teardown: () => this.fxOff() },
      { text: 'ÉCHANGEUR : le HAUT de deux colonnes est échangé.\nLes notes se croisent puis reviennent chez elles !', need: 4, spawn: () => this.tap(1 + (this.cycleI++ % 2)), setup: () => this.fxOn('swap', 1, [1, 2]), teardown: () => this.fxOff() },
      { text: 'Vous savez tout !\nPetit enchaînement final pour la forme…', need: 6, spawn: () => this.finale() },
      { text: 'Tutoriel terminé, bravo ! 🎉\nLes 70 morceaux vous attendent !', wait: 3.0, last: true },
    ];

    this.idx = -1;
    this.phase = 'between';
    this.timer = 0;
    this.successes = 0;
    this.watch = [];
    this.caption = null;
    this.flash = null;
    this.cycleI = 0;
    this.finaleI = 0;
    this.curWindow = null;
    this.sideOpen = false;
    this.activeFx = [];
  }

  /* ----- démonstration des effets spéciaux ----- */

  // pousse une fenêtre d'effet "ouverte" dans la timeline du jeu
  // (lanes : cibles des effets par lane — stutter/portal/dance/scatter)
  fxOn(type, k = 0.8, lanes) {
    const t = this.g.now();
    const e = { type, start: t, end: t + 9e3, k };
    if (lanes) e.lanes = lanes;
    this.g.fxTimeline.push(e);
    this.activeFx.push(e);
  }

  // referme les effets actifs (l'enveloppe assure la descente en douceur)
  fxOff() {
    const t = this.g.now();
    for (const e of this.activeFx) e.end = t + 1.2;
    this.activeFx = [];
  }

  update(t) {
    if (t < 0) return; // décompte d'intro
    switch (this.phase) {
      case 'between': {
        this.idx++;
        if (this.idx >= this.steps.length) { this.g.endTutorial(); return; }
        const s = this.steps[this.idx];
        this.caption = s.text;
        this.successes = 0;
        this.watch = [];
        this.flash = null;
        this.sideOpen = false;
        this.phase = s.need ? 'explain' : 'wait';
        this.timer = t + (s.need ? 2.6 : (s.wait || 3));
        if (s.setup) s.setup(); // l'effet démarre pendant l'explication
        break;
      }
      case 'wait': {
        if (t >= this.timer) {
          if (this.steps[this.idx].last) { this.g.endTutorial(); return; }
          this.phase = 'between';
        }
        break;
      }
      case 'explain': {
        if (t >= this.timer) {
          this.steps[this.idx].spawn();
          this.phase = 'practice';
        }
        break;
      }
      case 'practice': {
        const s = this.steps[this.idx];
        for (const n of this.watch) {
          if (n._counted || !this.g._resolved(n)) continue;
          // un hold est "résolu" dès la tête ; on attend la fin de la tenue
          if ((n.type === 'hold' || n.type === 'shold') && !n.done) continue;
          n._counted = true;
          const ok = this.isSuccess(n);
          if (ok) this.successes++;
          this.flash = { ok, t0: performance.now() };
        }
        const pending = this.watch.some(n => !n._counted);
        if (!pending) {
          if (this.successes >= s.need) {
            if (s.teardown) s.teardown();
            this.caption = '✓ Bien joué !';
            this.phase = 'wait';
            this.timer = t + 1.2;
          } else {
            s.spawn(); // on remet une note d'exercice
          }
        }
        break;
      }
    }
  }

  isSuccess(n) {
    if (n.type === 'bomb') return n.avoided;
    if (n.type === 'roll') return n.hits >= n.need * 0.65;
    if (n.type === 'hold' || n.type === 'shold') return n.hit && !n.broken;
    return n.hit;
  }

  /* ----- générateurs d'exercices (les notes arrivent dans ~1,8 s) ----- */

  add(spec) {
    const n = this.g.addNote(spec);
    this.watch.push(n);
    return n;
  }

  t0() { return this.g.now() + 1.8; }

  cycle() {
    const lanes = [0, 1, 2, 3, 2, 1];
    return lanes[this.cycleI++ % lanes.length];
  }

  tap(lane) { this.add({ t: this.t0(), lane, type: 'tap' }); }

  ghost() { this.add({ t: this.t0(), lane: this.cycle(), type: 'tap', ghost: true }); }

  hold() {
    const lane = 1 + (this.cycleI++ % 2);
    const t = this.t0();
    this.add({ t, t2: t + 1.2, lane, type: 'hold' });
  }

  roll() {
    const lane = 1 + (this.cycleI++ % 2);
    const t = this.t0();
    this.add({ t, t2: t + 1.6, lane, type: 'roll', need: 6 });
  }

  shold() {
    const fromLane = 1 + (this.cycleI++ % 2);
    const toLane = fromLane === 1 ? 2 : 1;
    const t = this.t0();
    this.add({ t, t2: t + 2.2, tm: t + 1.1, lane: fromLane, lane2: toLane, type: 'shold' });
  }

  wide() {
    const pairs = [[1, 2], [0, 1], [2, 3]];
    const [a, b] = pairs[this.cycleI++ % pairs.length];
    this.add({ t: this.t0(), lane: a, lane2: b, type: 'wide' });
  }

  bomb() { this.add({ t: this.t0(), lane: 1 + (this.cycleI++ % 2), type: 'bomb' }); }

  bonus(side) {
    const xLane = side === 1 ? 4 : -1;
    if (!this.sideOpen) {
      // 1re vague : le chevron qui ouvre la lane (l'ouverture est temporelle,
      // elle a lieu même si le chevron est raté)
      const tArr = this.t0();
      this.curWindow = { lane: xLane, open: tArr, close: tArr + 600 };
      this.g.laneWindows.push(this.curWindow);
      this.sideOpen = true;
      this.add({ t: tArr, lane: side === 1 ? 3 : 0, type: 'exp', dir: side === 1 ? 1 : -1 });
    } else {
      this.add({ t: this.t0(), lane: xLane, type: 'tap' });
    }
  }

  closeSide() {
    if (this.curWindow) {
      this.curWindow.close = this.g.now() + 0.8;
      this.curWindow = null;
    }
    this.sideOpen = false;
  }

  finale() {
    const t = this.t0();
    switch (this.finaleI++ % 6) {
      case 0: this.add({ t, lane: 0, type: 'tap' }); break;
      case 1: this.add({ t, lane: 3, type: 'tap' }); break;
      case 2: this.add({ t, lane: 1, lane2: 2, type: 'wide' }); break;
      case 3: this.add({ t, t2: t + 1.0, lane: 2, type: 'hold' }); break;
      case 4: this.add({ t, t2: t + 1.2, lane: 1, type: 'roll', need: 5 }); break;
      default: this.add({ t, lane: this.cycle(), type: 'tap' }); break;
    }
  }
}
