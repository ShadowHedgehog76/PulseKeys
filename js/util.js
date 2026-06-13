'use strict';

const Util = {
  // PRNG déterministe : même graine => même musique et même chart
  mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },

  hashStr(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  },

  clamp(v, a, b) { return v < a ? a : v > b ? b : v; },
  lerp(a, b, t) { return a + (b - a) * t; },
  pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; },
  midiFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); },

  median(arr) {
    const s = [...arr].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  },

  fmtScore(n) {
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  },

  keyLabel(code) {
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    const map = {
      Space: 'Espace', ArrowLeft: '←', ArrowDown: '↓', ArrowUp: '↑', ArrowRight: '→',
      Semicolon: ';', Comma: ',', Period: '.', Slash: '/', Quote: "'",
      BracketLeft: '[', BracketRight: ']',
    };
    return map[code] || code;
  },
};
