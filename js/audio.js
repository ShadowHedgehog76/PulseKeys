'use strict';

/*
 * Moteur audio : tout est synthétisé en temps réel via Web Audio.
 * Aucun fichier audio. Le séquenceur planifie les événements avec
 * un "lookahead" sur l'horloge audio (précision à l'échantillon près).
 *
 * Chaîne de mixage :
 *   instruments → bus du morceau (+ sidechain sur les kicks)
 *               → envois vers délai ping-pong stéréo et réverbe à convolution
 *   musique/sfx → master → EQ (low shelf + high shelf) → compresseur
 *               → saturation douce → sortie
 * Tous les instruments sont multi-couches et spatialisés en stéréo.
 */

const Synth = {
  noiseBuf: null,

  noise(ctx) {
    if (!this.noiseBuf) {
      const len = ctx.sampleRate * 2;
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    return src;
  },

  env(ctx, t, peak, decay, attack = 0.002) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  },

  // panoramique stéréo (gain neutre si StereoPanner indisponible)
  pan(ctx, v) {
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Util.clamp(v, -1, 1);
      return p;
    }
    return ctx.createGain();
  },

  // saturation douce (courbes mises en cache par intensité)
  dist(ctx, k) {
    this._distCurves = this._distCurves || {};
    if (!this._distCurves[k]) {
      const n = 1024, c = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * 2 - 1;
        c[i] = Math.tanh(k * x) / Math.tanh(k);
      }
      this._distCurves[k] = c;
    }
    const ws = ctx.createWaveShaper();
    ws.curve = this._distCurves[k];
    return ws;
  },

  send(ctx, from, to, amount) {
    if (!to) return;
    const g = ctx.createGain();
    g.gain.value = amount;
    from.connect(g).connect(to);
  },

  /* ---------- Batterie ---------- */

  kick(ctx, bus, t, vel, hard) {
    // corps : sinus glissant
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(hard ? 250 : 170, t);
    o.frequency.exponentialRampToValueAtTime(hard ? 48 : 42, t + (hard ? 0.16 : 0.11));
    const g = this.env(ctx, t, (hard ? 0.78 : 0.9) * vel, hard ? 0.36 : 0.26);
    if (hard) o.connect(this.dist(ctx, 10)).connect(g).connect(bus.out);
    else o.connect(g).connect(bus.out);
    o.start(t); o.stop(t + (hard ? 0.55 : 0.32));
    // clic d'attaque : souffle bref filtré haut
    const n = this.noise(ctx);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 4000;
    const cg = this.env(ctx, t, 0.22 * vel, 0.018, 0.001);
    n.connect(hp).connect(cg).connect(bus.out);
    n.start(t); n.stop(t + 0.05);
  },

  snare(ctx, bus, t, vel) {
    // souffle principal
    const n = this.noise(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1750; bp.Q.value = 0.7;
    const g = this.env(ctx, t, 0.55 * vel, 0.16);
    n.connect(bp).connect(g).connect(bus.out);
    n.start(t); n.stop(t + 0.25);
    this.send(ctx, g, bus.verbIn, 0.16);
    // grésillement haut
    const n2 = this.noise(ctx);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 6200;
    const g2 = this.env(ctx, t, 0.28 * vel, 0.21, 0.001);
    n2.connect(hp).connect(g2).connect(bus.out);
    n2.start(t); n2.stop(t + 0.28);
    // corps tonal : deux brèves couches accordées
    const o = ctx.createOscillator();
    o.type = 'triangle'; o.frequency.value = 196;
    const g3 = this.env(ctx, t, 0.32 * vel, 0.06);
    o.connect(g3).connect(bus.out);
    o.start(t); o.stop(t + 0.1);
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.setValueAtTime(330, t);
    o2.frequency.exponentialRampToValueAtTime(180, t + 0.05);
    const g4 = this.env(ctx, t, 0.2 * vel, 0.05, 0.001);
    o2.connect(g4).connect(bus.out);
    o2.start(t); o2.stop(t + 0.09);
  },

  clap(ctx, bus, t, vel) {
    const n = this.noise(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1250; bp.Q.value = 1.1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    for (let i = 0; i < 3; i++) {
      const tt = t + i * 0.012;
      g.gain.exponentialRampToValueAtTime(0.42 * vel, tt + 0.003);
      g.gain.exponentialRampToValueAtTime(0.07 * vel, tt + 0.011);
    }
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    n.connect(bp).connect(g).connect(bus.out);
    n.start(t); n.stop(t + 0.24);
    this.send(ctx, g, bus.verbIn, 0.3);
  },

  tom(ctx, bus, t, midi, vel) {
    const f = Util.midiFreq(midi || 50);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f * 1.8, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.15);
    const g = this.env(ctx, t, 0.5 * vel, 0.26);
    const pn = this.pan(ctx, Util.clamp((53 - (midi || 53)) * 0.06, -0.5, 0.5));
    o.connect(g).connect(pn).connect(bus.out);
    o.start(t); o.stop(t + 0.34);
    this.send(ctx, g, bus.verbIn, 0.18);
    // frappe : bruit bref
    const n = this.noise(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = f * 4; bp.Q.value = 1;
    const ng = this.env(ctx, t, 0.15 * vel, 0.02, 0.001);
    n.connect(bp).connect(ng).connect(bus.out);
    n.start(t); n.stop(t + 0.05);
  },

  // rimshot (reggae) : clic accordé très bref
  rim(ctx, bus, t, vel) {
    const o = ctx.createOscillator();
    o.type = 'sine'; o.frequency.value = 1750;
    const g = this.env(ctx, t, 0.3 * vel, 0.025, 0.001);
    o.connect(g).connect(bus.out);
    o.start(t); o.stop(t + 0.06);
    const n = this.noise(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 3200; bp.Q.value = 1.5;
    const g2 = this.env(ctx, t, 0.2 * vel, 0.02, 0.001);
    n.connect(bp).connect(g2).connect(bus.out);
    n.start(t); n.stop(t + 0.05);
  },

  // cymbale ride (swing) : banc métallique plus grave et plus long
  ride(ctx, bus, t, vel) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 7800; bp.Q.value = 0.7;
    const g = this.env(ctx, t, 0.16 * vel, 0.42, 0.001);
    bp.connect(g).connect(bus.out);
    for (const r of [2, 3, 4.16, 5.43, 6.79]) {
      const o = ctx.createOscillator();
      o.type = 'square'; o.frequency.value = 110 * r;
      const og = ctx.createGain(); og.gain.value = 0.2;
      o.connect(og).connect(bp);
      o.start(t); o.stop(t + 0.55);
    }
    // "ping" de la baguette
    const o2 = ctx.createOscillator();
    o2.type = 'sine'; o2.frequency.value = 5200;
    const g2 = this.env(ctx, t, 0.06 * vel, 0.25, 0.001);
    o2.connect(g2).connect(bus.out);
    o2.start(t); o2.stop(t + 0.3);
  },

  // charley métallique : banc de carrés inharmoniques (façon 808)
  hat(ctx, bus, t, vel, open) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 9800; bp.Q.value = 0.9;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 7200;
    const dec = open ? 0.32 : 0.05;
    const g = this.env(ctx, t, 0.42 * vel, dec, 0.001);
    bp.connect(hp).connect(g).connect(bus.out);
    for (const r of [2, 3, 4.16, 5.43, 6.79, 8.21]) {
      const o = ctx.createOscillator();
      o.type = 'square'; o.frequency.value = 130 * r;
      const og = ctx.createGain(); og.gain.value = 0.22;
      o.connect(og).connect(bp);
      o.start(t); o.stop(t + dec + 0.08);
    }
  },

  /* ---------- Basses ---------- */

  // basse hybride : sub sinus + saws filtrées avec enveloppe de filtre
  bass(ctx, bus, t, midi, dur, vel) {
    const f = Util.midiFreq(midi);
    const dest = bus.duck || bus.out;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5 * vel, t + 0.006);
    g.gain.setValueAtTime(0.5 * vel, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.07);
    g.connect(dest);
    // sub
    const o0 = ctx.createOscillator();
    o0.type = 'sine'; o0.frequency.value = f;
    const sg = ctx.createGain(); sg.gain.value = 0.5;
    o0.connect(sg).connect(g);
    o0.start(t); o0.stop(t + dur + 0.12);
    // couche saw mordante
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.Q.value = 4;
    lp.frequency.setValueAtTime(1100, t);
    lp.frequency.exponentialRampToValueAtTime(280, t + Math.max(dur, 0.1));
    const drv = this.dist(ctx, 2.5);
    const wg = ctx.createGain(); wg.gain.value = 0.42;
    lp.connect(drv).connect(wg).connect(g);
    for (const det of [0, 9]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
      o.connect(lp);
      o.start(t); o.stop(t + dur + 0.12);
    }
  },

  // sub profond légèrement saturé + harmonique de définition
  // slide (demi-tons) : glissé d'attaque façon 808 de trap
  sub(ctx, bus, t, midi, dur, vel, slide) {
    const f = Util.midiFreq(midi);
    const dest = bus.duck || bus.out;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.52 * vel, t + 0.01);
    g.gain.setValueAtTime(0.52 * vel, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.1);
    g.connect(dest);
    const o = ctx.createOscillator();
    o.type = 'sine';
    if (slide) {
      o.frequency.setValueAtTime(f * Math.pow(2, slide / 12), t);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.09);
    } else {
      o.frequency.value = f;
    }
    o.connect(this.dist(ctx, 3)).connect(g);
    o.start(t); o.stop(t + dur + 0.15);
    // harmonique +12 discrète (rend le sub audible sur petites enceintes)
    const o2 = ctx.createOscillator();
    o2.type = 'triangle'; o2.frequency.value = f * 2;
    const hg = ctx.createGain(); hg.gain.value = 0.18;
    o2.connect(hg).connect(g);
    o2.start(t); o2.stop(t + dur + 0.15);
  },

  // basse wobble (dubstep) : filtre balayé par LFO + panoramique mouvant
  wob(ctx, bus, t, midi, dur, vel, rate = 4) {
    const f = Util.midiFreq(midi);
    const dest = bus.duck || bus.out;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.Q.value = 8; lp.frequency.value = f * 4;
    const lfo = ctx.createOscillator();
    lfo.type = 'sine'; lfo.frequency.value = rate;
    const lg = ctx.createGain(); lg.gain.value = f * 3.2;
    lfo.connect(lg).connect(lp.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.38 * vel, t + 0.02);
    g.gain.setValueAtTime(0.38 * vel, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.12);
    const pn = this.pan(ctx, 0);
    if (pn.pan) {
      const pg = ctx.createGain(); pg.gain.value = 0.3;
      lfo.connect(pg).connect(pn.pan); // le wobble voyage dans l'image stéréo
    }
    const o = ctx.createOscillator();
    o.type = 'sawtooth'; o.frequency.value = f;
    const o2 = ctx.createOscillator();
    o2.type = 'square'; o2.frequency.value = f / 2;
    o.connect(lp); o2.connect(lp);
    lp.connect(g).connect(pn).connect(dest);
    o.start(t); o2.start(t); lfo.start(t);
    o.stop(t + dur + 0.2); o2.stop(t + dur + 0.2); lfo.stop(t + dur + 0.2);
  },

  // basse acide façon TB-303 : saw + filtre très résonant balayé
  acid(ctx, bus, t, midi, dur, vel) {
    const f = Util.midiFreq(midi);
    const dest = bus.duck || bus.out;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.Q.value = 14;
    lp.frequency.setValueAtTime(Math.min(f * 10, 4200), t);
    lp.frequency.exponentialRampToValueAtTime(f * 1.6, t + Math.max(dur * 0.9, 0.12));
    const g = this.env(ctx, t, 0.3 * vel, Math.max(dur, 0.18), 0.003);
    const o = ctx.createOscillator();
    o.type = 'sawtooth'; o.frequency.value = f;
    o.connect(lp).connect(this.dist(ctx, 2)).connect(g).connect(dest);
    o.start(t); o.stop(t + dur + 0.25);
    this.send(ctx, g, bus.verbIn, 0.08);
  },

  // guitare saturée (métal) : saws désaccordées → disto lourde → filtre.
  // mute = palm mute (chug court et sombre) ; midis = power chord possible
  gtr(ctx, bus, t, midis, dur, vel, mute) {
    const drv = this.dist(ctx, 9);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = mute ? 1800 : 3600; lp.Q.value = 0.7;
    const g = ctx.createGain();
    const peak = 0.34 * vel;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.004);
    if (mute) {
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    } else {
      g.gain.setValueAtTime(peak * 0.85, t + dur);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.12);
    }
    drv.connect(lp).connect(g).connect(bus.out);
    this.send(ctx, g, bus.verbIn, 0.07);
    const stop = t + (mute ? 0.22 : dur + 0.18);
    for (const m of midis) {
      for (const det of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth'; o.frequency.value = Util.midiFreq(m); o.detune.value = det;
        const og = ctx.createGain(); og.gain.value = 0.4;
        o.connect(og).connect(drv);
        o.start(t); o.stop(stop);
      }
    }
  },

  // zap FM (psytrance) : index de modulation qui s'effondre + piqué de hauteur
  zap(ctx, bus, t, midi, dur, vel) {
    const f = Util.midiFreq(midi);
    const car = ctx.createOscillator();
    car.type = 'sine';
    car.frequency.setValueAtTime(f * 1.8, t);
    car.frequency.exponentialRampToValueAtTime(f, t + 0.06);
    const mod = ctx.createOscillator();
    mod.type = 'sine'; mod.frequency.value = f * 1.99;
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(f * 6, t);
    mg.gain.exponentialRampToValueAtTime(f * 0.3, t + 0.12);
    mod.connect(mg).connect(car.frequency);
    const g = this.env(ctx, t, 0.26 * vel, Math.max(dur, 0.15), 0.002);
    car.connect(g).connect(bus.out);
    this.send(ctx, g, bus.delayIn, 0.25);
    this.send(ctx, g, bus.verbIn, 0.15);
    car.start(t); mod.start(t);
    car.stop(t + dur + 0.3); mod.stop(t + dur + 0.3);
  },

  /* ---------- Mélodiques ---------- */

  // piano électrique simple : deux partiels + marteau, filtré par la vélocité
  piano(ctx, bus, t, midis, dur, vel) {
    for (const m of midis) {
      const f = Util.midiFreq(m);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 1600 + vel * 2600;
      const g = ctx.createGain();
      const peak = 0.26 * vel / Math.sqrt(midis.length);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + 0.004);
      g.gain.exponentialRampToValueAtTime(peak * 0.25, t + Math.min(dur, 1.6));
      g.gain.exponentialRampToValueAtTime(0.0001, t + Math.min(dur, 1.6) + 0.22);
      const pn = this.pan(ctx, ((m % 12) - 6) / 20);
      lp.connect(g).connect(pn).connect(bus.out);
      const o1 = ctx.createOscillator();
      o1.type = 'triangle'; o1.frequency.value = f;
      o1.connect(lp);
      const o2 = ctx.createOscillator();
      o2.type = 'sine'; o2.frequency.value = f * 2.01;
      const og2 = ctx.createGain(); og2.gain.value = 0.35;
      o2.connect(og2).connect(lp);
      o1.start(t); o2.start(t);
      o1.stop(t + dur + 0.4); o2.stop(t + dur + 0.4);
      this.send(ctx, g, bus.verbIn, 0.22);
    }
    // marteau
    const n = this.noise(ctx);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 3000;
    const hg = this.env(ctx, t, 0.05 * vel, 0.012, 0.001);
    n.connect(hp).connect(hg).connect(bus.out);
    n.start(t); n.stop(t + 0.04);
  },

  // ensemble de cordes soutenu (orchestral, disco) — musique seule
  strings(ctx, bus, t, midis, dur, vel) {
    const dest = bus.duck || bus.out;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 2200; lp.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vel, t + Math.min(0.22, dur * 0.3));
    g.gain.setValueAtTime(vel, t + dur * 0.85);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.5);
    lp.connect(g).connect(dest);
    this.send(ctx, g, bus.verbIn, 0.45);
    // vibrato d'ensemble
    const vib = ctx.createOscillator();
    vib.type = 'sine'; vib.frequency.value = 5;
    const vg = ctx.createGain();
    vg.gain.setValueAtTime(0, t);
    vg.gain.setValueAtTime(0, t + 0.3);
    vg.gain.linearRampToValueAtTime(7, t + 0.8);
    vib.connect(vg);
    vib.start(t); vib.stop(t + dur + 0.6);
    midis.forEach((m, i) => {
      const pn = this.pan(ctx, i === 0 ? -0.4 : i === 1 ? 0.4 : 0);
      pn.connect(lp);
      for (const det of [-10, 10]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth'; o.frequency.value = Util.midiFreq(m); o.detune.value = det;
        vg.connect(o.detune);
        const og = ctx.createGain(); og.gain.value = 0.45;
        o.connect(og).connect(pn);
        o.start(t); o.stop(t + dur + 0.6);
      }
    });
  },

  // cordes courtes détachées : l'ostinato orchestral (chartable)
  ost(ctx, bus, t, midi, dur, vel) {
    const f = Util.midiFreq(midi);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 2600;
    const g = ctx.createGain();
    const peak = 0.24 * vel;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(dur * 0.95, 0.15));
    const pn = this.pan(ctx, ((midi % 12) - 6) / 18);
    lp.connect(g).connect(pn).connect(bus.out);
    this.send(ctx, g, bus.verbIn, 0.2);
    for (const det of [-8, 8]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
      o.connect(lp);
      o.start(t); o.stop(t + dur + 0.2);
    }
  },

  // cuivres : saws avec attaque progressive et "scoop" de hauteur
  brass(ctx, bus, t, midi, dur, vel) {
    const f = Util.midiFreq(midi);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.Q.value = 1;
    lp.frequency.setValueAtTime(1400, t);
    lp.frequency.linearRampToValueAtTime(3200, t + Math.min(0.18, dur * 0.5));
    const g = ctx.createGain();
    const peak = 0.3 * vel;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.05);
    g.gain.setValueAtTime(peak * 0.85, t + Math.max(dur * 0.85, 0.08));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.18);
    lp.connect(g).connect(bus.out);
    this.send(ctx, g, bus.verbIn, 0.28);
    for (const det of [-6, 0, 6]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f * 0.97, t); // petit scoop d'attaque
      o.frequency.linearRampToValueAtTime(f, t + 0.06);
      o.detune.value = det;
      const og = ctx.createGain(); og.gain.value = 0.4;
      o.connect(og).connect(lp);
      o.start(t); o.stop(t + dur + 0.25);
    }
  },

  // lead supersaw : voix détunées réparties en deux ailes stéréo,
  // enveloppe de filtre + vibrato différé
  lead(ctx, bus, t, midi, dur, vel, wave = 'sawtooth', fat = false) {
    const f = Util.midiFreq(midi);
    const peak = (wave === 'square' ? 0.24 : 0.3) * vel;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.012);
    g.gain.setValueAtTime(peak * 0.8, t + Math.max(dur * 0.85, 0.05));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.15);
    g.connect(bus.out);
    this.send(ctx, g, bus.delayIn, 0.3);
    this.send(ctx, g, bus.verbIn, 0.22);
    // vibrato qui s'installe après l'attaque
    const vib = ctx.createOscillator();
    vib.type = 'sine'; vib.frequency.value = 5.2;
    const vg = ctx.createGain();
    vg.gain.setValueAtTime(0, t);
    vg.gain.setValueAtTime(0, t + 0.14);
    vg.gain.linearRampToValueAtTime(9, t + Math.min(0.5, 0.14 + dur * 0.5));
    vib.connect(vg);
    vib.start(t); vib.stop(t + dur + 0.2);
    // deux ailes stéréo, chacune avec son filtre enveloppé
    const dets = fat ? [-18, -9, -3, 3, 9, 18] : (wave === 'square' ? [-5, 5] : [-8, -3, 3, 8]);
    const sides = {};
    for (const side of [-1, 1]) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.Q.value = 0.9;
      lp.frequency.setValueAtTime(Math.min(f * 7, wave === 'square' ? 5200 : 7000), t);
      lp.frequency.exponentialRampToValueAtTime(Math.min(f * 2.8, 2600), t + Math.max(dur * 0.7, 0.12));
      const pn = this.pan(ctx, side * (fat ? 0.55 : 0.3));
      lp.connect(pn).connect(g);
      sides[side] = lp;
    }
    dets.forEach((det, i) => {
      const o = ctx.createOscillator();
      o.type = wave; o.frequency.value = f; o.detune.value = det;
      vg.connect(o.detune);
      const og = ctx.createGain();
      og.gain.value = 2.1 / dets.length;
      o.connect(og).connect(sides[i % 2 ? 1 : -1]);
      o.start(t); o.stop(t + dur + 0.18);
    });
  },

  // saw pincée au filtre fermant vite (funk, skanks)
  pluck(ctx, bus, t, midi, dur, vel) {
    const f = Util.midiFreq(midi);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.Q.value = 3;
    lp.frequency.setValueAtTime(Math.min(f * 9, 5200), t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(f * 1.4, 320), t + 0.18);
    const g = this.env(ctx, t, 0.32 * vel, Math.max(0.18, Math.min(dur, 0.4)), 0.002);
    const pn = this.pan(ctx, ((midi % 12) - 6) / 18);
    lp.connect(g).connect(pn).connect(bus.out);
    for (const det of [-5, 5]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
      o.connect(lp);
      o.start(t); o.stop(t + 0.55);
    }
    this.send(ctx, g, bus.delayIn, 0.22);
    this.send(ctx, g, bus.verbIn, 0.15);
  },

  // cloche FM (lo-fi) : porteuse + modulateur inharmonique + partiel haut
  bell(ctx, bus, t, midi, dur, vel) {
    const f = Util.midiFreq(midi);
    const g = this.env(ctx, t, 0.28 * vel, Math.max(0.7, dur), 0.003);
    const pn = this.pan(ctx, ((midi % 12) - 6) / 16);
    g.connect(pn).connect(bus.out);
    this.send(ctx, g, bus.delayIn, 0.3);
    this.send(ctx, g, bus.verbIn, 0.45);
    const car = ctx.createOscillator();
    car.type = 'sine'; car.frequency.value = f;
    const mod = ctx.createOscillator();
    mod.type = 'sine'; mod.frequency.value = f * 3.01;
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(f * 2.2, t);
    mg.gain.exponentialRampToValueAtTime(f * 0.05, t + 0.55);
    mod.connect(mg).connect(car.frequency);
    car.connect(g);
    // partiel cristallin qui s'éteint vite
    const o2 = ctx.createOscillator();
    o2.type = 'sine'; o2.frequency.value = f * 4.2;
    const g2 = this.env(ctx, t, 0.07 * vel, 0.25, 0.002);
    o2.connect(g2).connect(pn);
    car.start(t); mod.start(t); o2.start(t);
    car.stop(t + dur + 1.1); mod.stop(t + dur + 1.1); o2.stop(t + 0.4);
  },

  arp(ctx, bus, t, midi, vel) {
    const o = ctx.createOscillator();
    o.type = 'square'; o.frequency.value = Util.midiFreq(midi);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 3200;
    const g = this.env(ctx, t, 0.15 * vel, 0.13, 0.003);
    const pn = this.pan(ctx, ((midi % 12) - 6) / 14); // l'arpège voyage dans l'image
    o.connect(lp).connect(g).connect(pn).connect(bus.out);
    this.send(ctx, g, bus.delayIn, 0.32);
    this.send(ctx, g, bus.verbIn, 0.15);
    o.start(t); o.stop(t + 0.2);
  },

  // accord plaqué court (house) : saws filtrées + transitoire
  stab(ctx, bus, t, midis, vel) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 2100;
    const g = this.env(ctx, t, 0.28 * vel, 0.2, 0.004);
    const pn = this.pan(ctx, ((midis[0] % 12) - 6) / 20);
    lp.connect(g).connect(pn).connect(bus.out);
    this.send(ctx, g, bus.verbIn, 0.22);
    for (const m of midis) {
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth'; o.frequency.value = Util.midiFreq(m); o.detune.value = det;
        const og = ctx.createGain(); og.gain.value = 0.5;
        o.connect(og).connect(lp);
        o.start(t); o.stop(t + 0.3);
      }
    }
  },

  // nappe stéréo : voix panoramiquées, filtre animé par un LFO lent
  pad(ctx, bus, t, midis, dur, vel) {
    const dest = bus.duck || bus.out;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 1000; lp.Q.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.type = 'sine'; lfo.frequency.value = 0.13;
    const lg = ctx.createGain(); lg.gain.value = 280;
    lfo.connect(lg).connect(lp.frequency);
    lfo.start(t); lfo.stop(t + dur + 0.8);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vel, t + Math.min(0.8, dur * 0.4));
    g.gain.setValueAtTime(vel, t + dur * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.6);
    lp.connect(g).connect(dest);
    this.send(ctx, g, bus.verbIn, 0.5);
    midis.forEach((m, i) => {
      const pn = this.pan(ctx, i === 0 ? -0.45 : i === 1 ? 0.45 : 0);
      pn.connect(lp); // le filtre préserve la stéréo des entrées panoramiquées
      for (const det of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth'; o.frequency.value = Util.midiFreq(m); o.detune.value = det;
        const og = ctx.createGain(); og.gain.value = 0.5;
        o.connect(og).connect(pn);
        o.start(t); o.stop(t + dur + 0.7);
      }
    });
  },

  // montée de bruit stéréo avant les refrains
  riser(ctx, bus, t, dur, vel) {
    for (const side of [-1, 1]) {
      const n = this.noise(ctx);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.Q.value = 1.4;
      bp.frequency.setValueAtTime(side < 0 ? 320 : 380, t);
      bp.frequency.exponentialRampToValueAtTime(side < 0 ? 4800 : 5600, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.11 * vel, t + dur);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.08);
      const pn = this.pan(ctx, side * 0.5);
      n.connect(bp).connect(g).connect(pn).connect(bus.out);
      n.start(t); n.stop(t + dur + 0.15);
    }
    const sg = ctx.createGain(); sg.gain.value = 1;
    // petite queue de réverbe sur la montée
    this.send(ctx, sg, bus.verbIn, 0.3);
  },
};

// profondeur du sidechain (pompage sur les kicks) par style
const DUCK_DEPTH = {
  house: 0.45, trance: 0.5, dub: 0.45, hard: 0.5,
  wave: 0.25, funk: 0.2, lofi: 0.15, dnb: 0.2, chip: 0,
  techno: 0.5, psy: 0.5, disco: 0.35, trap: 0.3,
  metal: 0.15, reggae: 0.1, swing: 0, orch: 0,
};

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.cur = null;
    this.metro = null;
    this.volMusic = 0.8;
    this.volSfx = 0.7;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    // EQ de master : assise dans le grave + air dans l'aigu
    const lowShelf = ctx.createBiquadFilter();
    lowShelf.type = 'lowshelf'; lowShelf.frequency.value = 90; lowShelf.gain.value = 1.5;
    const highShelf = ctx.createBiquadFilter();
    highShelf.type = 'highshelf'; highShelf.frequency.value = 7500; highShelf.gain.value = 2;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    comp.attack.value = 0.004; comp.release.value = 0.18;
    const clip = Synth.dist(ctx, 1.5); // saturation douce de bus, colle le mix
    this.master.connect(lowShelf).connect(highShelf).connect(comp).connect(clip).connect(ctx.destination);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.volMusic;
    this.musicBus.connect(this.master);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.volSfx;
    this.sfxBus.connect(this.master);

    // réverbe à convolution partagée (réponse impulsionnelle générée)
    this.verbBus = ctx.createGain();
    const conv = ctx.createConvolver();
    conv.buffer = this._makeIR(2.4, 2.8);
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass'; damp.frequency.value = 4200;
    const ret = ctx.createGain(); ret.gain.value = 0.8;
    this.verbBus.connect(conv).connect(damp).connect(ret).connect(this.musicBus);
  }

  _makeIR(seconds, decay) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const ir = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return ir;
  }

  setVolumes(music, sfx) {
    this.volMusic = music; this.volSfx = sfx;
    if (this.ctx) {
      this.musicBus.gain.value = music;
      this.sfxBus.gain.value = sfx;
    }
  }

  /* ---------- Lecture d'un morceau ---------- */

  // loopBeats : si fourni, le morceau boucle sans couture tous les N temps
  startSong(events, spb, leadIn, style, loopBeats) {
    this.ensure();
    this.stopSong();
    const ctx = this.ctx;

    const gain = ctx.createGain();
    gain.gain.value = 1;
    gain.connect(this.musicBus);

    // sidechain : nappes et basses passent par ce gain, creusé à chaque kick
    const duckGain = ctx.createGain();
    duckGain.gain.value = 1;
    duckGain.connect(gain);

    // délai "dotted 8th" ping-pong stéréo pour leads/arps
    const delayIn = ctx.createGain();
    const dL = ctx.createDelay(2), dR = ctx.createDelay(2);
    dL.delayTime.value = spb * 0.75;
    dR.delayTime.value = spb * 0.75;
    const mkFb = () => {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 2400;
      const fb = ctx.createGain(); fb.gain.value = 0.32;
      lp.connect(fb);
      return { lp, fb };
    };
    const fbL = mkFb(), fbR = mkFb();
    delayIn.connect(dL);
    dL.connect(fbL.lp); fbL.fb.connect(dR);
    dR.connect(fbR.lp); fbR.fb.connect(dL);
    const wet = ctx.createGain(); wet.gain.value = 0.45;
    const pL = Synth.pan(ctx, -0.6), pR = Synth.pan(ctx, 0.6);
    dL.connect(pL).connect(wet);
    dR.connect(pR).connect(wet);
    wet.connect(gain);

    // envoi de réverbe propre au morceau (coupé avec lui)
    const verbIn = ctx.createGain();
    verbIn.gain.value = 1;
    verbIn.connect(this.verbBus);

    const s = {
      events, spb, idx: 0,
      t0: ctx.currentTime + leadIn,
      bus: { out: gain, duck: duckGain, delayIn, verbIn },
      gain, duckGain, verbIn,
      duckDepth: DUCK_DEPTH[style] !== undefined ? DUCK_DEPTH[style] : 0.2,
      loopBeats: loopBeats || 0,
      timer: 0,
    };
    s.timer = setInterval(() => this._tick(), 25);
    this.cur = s;
    this._tick();
  }

  _tick() {
    const s = this.cur;
    if (!s || !s.events.length) return;
    const horizon = this.ctx.currentTime + 0.16;
    for (;;) {
      if (s.idx >= s.events.length) {
        if (!s.loopBeats) break;
        s.idx = 0;
        s.t0 += s.loopBeats * s.spb; // reprise sans couture
      }
      const ev = s.events[s.idx];
      const when = s.t0 + ev.t * s.spb;
      if (when > horizon) break;
      this._play(ev, Math.max(when, this.ctx.currentTime + 0.003), s);
      s.idx++;
    }
  }

  _duck(s, t) {
    if (!s.duckDepth) return;
    const p = s.duckGain.gain;
    p.cancelScheduledValues(t);
    p.setValueAtTime(1 - s.duckDepth, t);
    p.linearRampToValueAtTime(1, t + Math.min(0.26, s.spb * 0.85));
  }

  _play(ev, t, s) {
    const ctx = this.ctx, bus = s.bus;
    const dur = (ev.dur || 0.5) * s.spb;
    switch (ev.inst) {
      case 'kick': Synth.kick(ctx, bus, t, ev.vel, ev.hard); this._duck(s, t); break;
      case 'snare': Synth.snare(ctx, bus, t, ev.vel); break;
      case 'clap': Synth.clap(ctx, bus, t, ev.vel); break;
      case 'rim': Synth.rim(ctx, bus, t, ev.vel); break;
      case 'tom': Synth.tom(ctx, bus, t, ev.midi, ev.vel); break;
      case 'hat': Synth.hat(ctx, bus, t, ev.vel, ev.open); break;
      case 'ride': Synth.ride(ctx, bus, t, ev.vel); break;
      case 'bass': Synth.bass(ctx, bus, t, ev.midi, dur, ev.vel); break;
      case 'sub': Synth.sub(ctx, bus, t, ev.midi, dur, ev.vel, ev.slide); break;
      case 'wob': Synth.wob(ctx, bus, t, ev.midi, dur, ev.vel, ev.rate); break;
      case 'acid': Synth.acid(ctx, bus, t, ev.midi, dur, ev.vel); break;
      case 'gtr': Synth.gtr(ctx, bus, t, Array.isArray(ev.midi) ? ev.midi : [ev.midi], dur, ev.vel, ev.mute); break;
      case 'lead': Synth.lead(ctx, bus, t, ev.midi, dur, ev.vel, ev.wave, ev.fat); break;
      case 'pluck': Synth.pluck(ctx, bus, t, ev.midi, dur, ev.vel); break;
      case 'bell': Synth.bell(ctx, bus, t, ev.midi, dur, ev.vel); break;
      case 'piano': Synth.piano(ctx, bus, t, Array.isArray(ev.midi) ? ev.midi : [ev.midi], dur, ev.vel); break;
      case 'brass': Synth.brass(ctx, bus, t, ev.midi, dur, ev.vel); break;
      case 'ost': Synth.ost(ctx, bus, t, ev.midi, dur, ev.vel); break;
      case 'zap': Synth.zap(ctx, bus, t, ev.midi, dur, ev.vel); break;
      case 'arp': Synth.arp(ctx, bus, t, ev.midi, ev.vel); break;
      case 'stab': Synth.stab(ctx, bus, t, ev.midi, ev.vel); break;
      case 'strings': Synth.strings(ctx, bus, t, ev.midi, dur, ev.vel); break;
      case 'riser': Synth.riser(ctx, bus, t, dur, ev.vel); break;
      case 'pad': Synth.pad(ctx, bus, t, ev.midi, dur, ev.vel); break;
    }
  }

  getSongTime() {
    if (!this.cur) return 0;
    return this.ctx.currentTime - this.cur.t0;
  }

  pause() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  stopSong() {
    const s = this.cur;
    if (!s) return;
    clearInterval(s.timer);
    this.cur = null;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const t = this.ctx.currentTime;
    s.gain.gain.setValueAtTime(s.gain.gain.value, t);
    s.gain.gain.linearRampToValueAtTime(0, t + 0.15);
    s.verbIn.gain.setValueAtTime(1, t);
    s.verbIn.gain.linearRampToValueAtTime(0, t + 0.2);
    setTimeout(() => {
      try { s.gain.disconnect(); s.verbIn.disconnect(); } catch (e) { /* déjà coupé */ }
    }, 500);
  }

  /* ---------- Effets sonores ---------- */

  hitSound() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle'; o.frequency.value = 1900;
    const g = Synth.env(ctx, t, 0.14, 0.03, 0.001);
    o.connect(g).connect(this.sfxBus);
    o.start(t); o.stop(t + 0.05);
  }

  uiSound(freq = 700) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine'; o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 1.5, t + 0.07);
    const g = Synth.env(ctx, t, 0.12, 0.09, 0.004);
    o.connect(g).connect(this.sfxBus);
    o.start(t); o.stop(t + 0.13);
  }

  /* ---------- Métronome (calibration) ---------- */

  startMetronome(bpm) {
    this.ensure();
    this.stopMetronome();
    const ctx = this.ctx;
    const m = {
      interval: 60 / bpm,
      next: ctx.currentTime + 0.8,
      ticks: [],
      timer: 0,
    };
    m.timer = setInterval(() => {
      const horizon = ctx.currentTime + 0.15;
      while (m.next < horizon) {
        this._tickSound(m.next);
        m.ticks.push(m.next);
        if (m.ticks.length > 80) m.ticks.shift();
        m.next += m.interval;
      }
    }, 25);
    this.metro = m;
  }

  _tickSound(t) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine'; o.frequency.value = 932;
    const g = Synth.env(ctx, t, 0.5, 0.07, 0.001);
    o.connect(g).connect(this.sfxBus);
    o.start(t); o.stop(t + 0.12);
    const o2 = ctx.createOscillator();
    o2.type = 'square'; o2.frequency.value = 2800;
    const g2 = Synth.env(ctx, t, 0.08, 0.015, 0.001);
    o2.connect(g2).connect(this.sfxBus);
    o2.start(t); o2.stop(t + 0.03);
  }

  stopMetronome() {
    if (this.metro) {
      clearInterval(this.metro.timer);
      this.metro = null;
    }
  }

  // Écart (s) entre un instant donné et le tic le plus proche
  nearestTickDelta(t) {
    const m = this.metro;
    if (!m || !m.ticks.length) return null;
    let best = null;
    for (const tick of m.ticks) {
      const d = t - tick;
      if (best === null || Math.abs(d) < Math.abs(best)) best = d;
    }
    if (Math.abs(best) > m.interval * 0.5) return null;
    return best;
  }
}
