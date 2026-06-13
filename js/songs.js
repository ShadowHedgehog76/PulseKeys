'use strict';

/*
 * Compositeur procédural multi-styles + générateur de charts.
 * La musique et les notes sont produites à partir des MÊMES événements,
 * de façon déterministe (graine = id du morceau).
 *
 * Styles musicaux (17) : wave (synthwave), house, chip (8 bits), dnb
 * (drum'n'bass), trance, funk, hard (hardcore), lofi (lo-fi hip-hop),
 * dub (dubstep), techno (basse acide 303), trap (808 glissants), metal
 * (guitares saturées), disco, reggae (one-drop), swing (jazz swingué),
 * orch (orchestral épique), psy (psytrance roulante).
 * Gammes : mineur naturel, mineur harmonique, dorien, phrygien.
 *
 * Chaque morceau possède un "hook" : une phrase mélodique fixe rejouée à
 * chaque refrain (transposée selon l'accord), pour une vraie signature.
 *
 * Types de notes :
 *  - tap   : note simple (peut être "ghost" : elle s'efface à l'approche)
 *  - hold  : note à maintenir (tête + queue)
 *  - shold : hold MOBILE : la tenue glisse vers une lane voisine (flèche)
 *  - roll  : roulement : marteler la touche dans la zone (n frappes requises)
 *  - wide  : note double : deux lanes adjacentes en même temps
 *  - bomb  : à NE PAS frapper (pénalité)
 *  - exp   : ouvre une lane bonus (max 1 par côté, se referme toujours)
 *
 * Lanes : -1 = bonus gauche, 0..3 = principales, 4 = bonus droite.
 */

const SCALES = {
  minor:  [0, 2, 3, 5, 7, 8, 10],
  harm:   [0, 2, 3, 5, 7, 8, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phryg:  [0, 1, 3, 5, 7, 8, 10],
};

const FORMS = {
  A: ['intro', 'verse', 'verse', 'chorus', 'verse', 'outro'],
  B: ['intro', 'verse', 'chorus', 'verse', 'chorus', 'chorus', 'outro'],
  C: ['intro', 'verse', 'chorus', 'verse', 'break', 'chorus', 'chorus', 'verse', 'outro'],
  D: ['intro', 'verse', 'chorus', 'verse', 'chorus', 'break', 'chorus', 'chorus', 'verse', 'chorus', 'outro'],
  E: ['intro', 'verse', 'chorus', 'verse', 'chorus', 'break', 'chorus', 'chorus', 'verse', 'chorus', 'chorus', 'break', 'outro'],
  F: ['intro', 'verse', 'chorus', 'verse', 'chorus', 'break', 'chorus', 'chorus', 'verse', 'chorus', 'break', 'chorus', 'chorus', 'chorus', 'outro'],
};

// fx : effets spéciaux visuels (modchart) déclenchés par sections —
// sway (glissement), split2/4/6 (scission des lanes), tilt (bascule),
// wave (ondulation des notes), pulse (zoom au tempo)
function S(id, title, sub, style, bpm, stars, hue, root, scale, prog, form, mods, bg, fx) {
  return { id, title, sub, style, bpm, stars, hue, root, scale, prog, form, mods: mods || [], bg: bg || 'stars', fx: fx || [] };
}

const SONGS = [
  // ★1 — découverte
  S('first-pulse',     'First Pulse',        'Initiation',             'wave',   92,  1, 190, 45, 'minor',  [0, 5, 2, 6], 'A', [], 'stars'),
  S('soft-static',     'Soft Static',        'Premiers pas lo-fi',     'lofi',   76,  1, 35,  45, 'dorian', [0, 5, 3, 4], 'A', [], 'orbs'),
  // ★2
  S('neon-district',   'Neon District',      'Balade nocturne',        'wave',   108, 2, 280, 43, 'minor',  [0, 3, 5, 4], 'B', [], 'city'),
  S('midnight-mall',   'Midnight Mall',      'Groove fluo',            'house',  118, 2, 315, 45, 'minor',  [0, 5, 2, 4], 'B', ['wide'], 'orbs'),
  S('corner-groove',   'Corner Groove',      'Funk de quartier',       'funk',   104, 2, 150, 45, 'dorian', [0, 3, 5, 4], 'B', [], 'waves'),
  S('pixel-avenue',    'Pixel Avenue',       '8 bits, 4 lanes',        'chip',   120, 2, 110, 48, 'dorian', [0, 3, 4, 6], 'B', ['roll'], 'hex'),
  S('low-tide',        'Low Tide',           'Marée basse, basse lourde', 'dub', 138, 2, 210, 43, 'minor',  [0, 5, 3, 4], 'B', ['shold'], 'rain'),
  S('mirrorball',      'Mirrorball',         'Boule à facettes',       'disco',  118, 2, 310, 45, 'dorian', [0, 3, 5, 4], 'B', [], 'orbs', ['pulse']),
  S('island-skank',    'Island Skank',       'Contretemps des îles',   'reggae', 82,  2, 140, 45, 'dorian', [0, 5, 3, 4], 'B', [], 'waves'),
  S('velvet-skyline',  'Velvet Skyline',     'Holds voyageurs',        'wave',   104, 2, 255, 43, 'minor',  [0, 5, 3, 6], 'B', ['shold'], 'city'),
  // ★3 — ça se corse
  S('chrome-runner',   'Chrome Runner',      'Cadence soutenue',       'wave',   126, 3, 330, 47, 'minor',  [0, 5, 3, 6], 'C', [], 'tunnel', ['orbit']),
  S('glass-harbor',    'Glass Harbor',       'Reflets mouvants',       'trance', 130, 3, 185, 45, 'harm',   [0, 5, 2, 4], 'C', ['shold'], 'waves'),
  S('vinyl-sunset',    'Vinyl Sunset',       'Coucher de soleil 33 tours', 'lofi', 82, 3, 25, 44, 'dorian', [0, 5, 2, 4], 'C', ['ghost'], 'city'),
  S('drumline-protocol', 'Drumline Protocol', 'Place aux roulements',  'house',  124, 3, 35,  47, 'minor',  [0, 3, 5, 4], 'C', ['roll'], 'waves'),
  S('brass-machine',   'Brass Machine',      'La machine à groove',    'funk',   112, 3, 95,  46, 'minor',  [0, 3, 5, 6], 'C', ['roll'], 'waves'),
  S('cassette-ghosts', 'Cassette Ghosts',    'Souvenirs effacés',      'wave',   112, 3, 290, 44, 'dorian', [0, 5, 3, 4], 'C', ['ghost'], 'orbs'),
  S('first-rave',      'First Rave',         'Premier mur de son',     'hard',   150, 3, 320, 45, 'minor',  [0, 5, 3, 4], 'B', ['wide'], 'vortex'),
  S('warehouse-pulse', 'Warehouse Pulse',    'Sous-sol berlinois',     'techno', 128, 3, 160, 45, 'minor',  [0, 5, 3, 4], 'C', [], 'tunnel'),
  S('velvet-808',      'Velvet 808',         'Le sub qui glisse',      'trap',   140, 3, 285, 43, 'minor',  [0, 3, 5, 4], 'B', ['shold'], 'orbs'),
  S('overture',        'Overture',           'Lever de rideau',        'orch',   110, 3, 220, 45, 'harm',   [0, 5, 3, 4], 'C', [], 'stars'),
  S('copper-circuit',  'Copper Circuit',     'Double soudure',         'chip',   134, 3, 20,  46, 'minor',  [0, 2, 5, 4], 'C', ['wide'], 'hex', ['swap']),
  // ★4
  S('overclock',       'Overclock',          'Ça commence à piquer',   'wave',   140, 4, 25,  45, 'minor',  [0, 2, 5, 6], 'D', [], 'vortex'),
  S('bassline-avenue', 'Bassline Avenue',    'La basse vous balade',   'house',  126, 4, 345, 43, 'minor',  [0, 5, 2, 6], 'C', ['shold'], 'city'),
  S('wobble-street',   'Wobble Street',      'La rue qui tangue',      'dub',    140, 4, 265, 44, 'phryg',  [0, 1, 5, 4], 'C', ['shold'], 'rain'),
  S('breakpoint',      'Breakpoint',         'Cassures de rythme',     'dnb',    168, 4, 150, 45, 'minor',  [0, 3, 5, 6], 'C', ['roll'], 'rain', ['stutter']),
  S('slap-circuit',    'Slap Circuit',       'Basse claquée',          'funk',   116, 4, 130, 47, 'dorian', [0, 5, 3, 4], 'C', ['wide', 'roll'], 'waves'),
  S('midnight-study',  'Midnight Study',     'Révisions nocturnes',    'lofi',   86,  4, 255, 46, 'minor',  [0, 5, 2, 6], 'C', ['ghost', 'shold'], 'orbs'),
  S('roots-mountain',  'Roots Mountain',     'Racines profondes',      'reggae', 88,  4, 120, 43, 'minor',  [0, 3, 5, 4], 'C', ['shold'], 'city'),
  S('speakeasy',       'Speakeasy',          'Bar clandestin',         'swing',  136, 4, 40,  45, 'minor',  [0, 5, 2, 6], 'C', ['ghost'], 'city'),
  S('phantom-express', 'Phantom Express',    'Dernier wagon invisible', 'wave',  138, 4, 265, 47, 'phryg',  [0, 1, 5, 4], 'C', ['ghost'], 'rain'),
  // ★5
  S('hyperdrive',      'Hyperdrive',         'Réflexes exigés',        'wave',   158, 5, 140, 48, 'minor',  [0, 5, 2, 4], 'E', [], 'tunnel'),
  S('prism-overdrive', 'Prism Overdrive',    'Spectre élargi',         'trance', 140, 5, 200, 46, 'minor',  [0, 5, 3, 4], 'D', ['wide'], 'tunnel'),
  S('kick-parade',     'Kick Parade',        'Le défilé des grosses caisses', 'hard', 155, 5, 5, 44, 'harm', [0, 5, 2, 4], 'D', ['roll'], 'vortex'),
  S('rolling-thunder', 'Rolling Thunder',    'Tonnerre roulant',       'dnb',    172, 5, 50,  44, 'minor',  [0, 3, 6, 4], 'D', ['roll'], 'rain'),
  S('deep-pressure',   'Deep Pressure',      'Pression des profondeurs', 'dub',  142, 5, 190, 45, 'minor',  [0, 3, 5, 4], 'D', ['roll', 'shold'], 'tunnel'),
  S('velvet-funk',     'Velvet Funk',        'Groove de velours',      'funk',   120, 5, 330, 45, 'dorian', [0, 5, 3, 6], 'D', ['shold', 'wide'], 'waves', ['swap']),
  S('iron-gallop',     'Iron Gallop',        'Galop de fer',           'metal',  164, 5, 15,  42, 'phryg',  [0, 1, 5, 4], 'D', ['roll'], 'vortex'),
  S('roller-boogie',   'Roller Boogie',      'Patins et paillettes',   'disco',  122, 5, 45,  46, 'dorian', [0, 5, 3, 6], 'D', ['wide', 'shold'], 'waves'),
  S('third-eye',       'Third Eye',          'Transe rampante',        'psy',    145, 5, 275, 45, 'phryg',  [0, 1, 5, 4], 'D', ['shold'], 'tunnel', ['pulse', 'tilt', 'orbit']),
  S('serpentine',      'Serpentine',         'Les holds serpentent',   'trance', 138, 5, 130, 45, 'harm',   [0, 5, 2, 6], 'D', ['shold'], 'waves', ['wave']),
  // ★6
  S('singularity',     'Singularity',        'Au-delà de la limite',   'wave',   174, 6, 0,   44, 'minor',  [0, 3, 6, 4], 'F', [], 'vortex', ['orbit', 'shake']),
  S('static-mirage',   'Static Mirage',      'Parasites visuels',      'chip',   144, 6, 280, 48, 'dorian', [0, 4, 5, 6], 'D', ['ghost'], 'rain', ['wave', 'stutter']),
  S('tape-warp',       'Tape Warp',          'La bande qui fond',      'lofi',   90,  6, 290, 47, 'phryg',  [0, 1, 3, 4], 'D', ['ghost', 'roll'], 'orbs'),
  S('double-helix',    'Double Helix',       'Deux brins entrelacés',  'wave',   150, 6, 175, 45, 'minor',  [0, 5, 2, 4], 'D', ['wide', 'shold'], 'waves', ['split2', 'swap']),
  S('hammerstorm',     'Hammerstorm',        'Le marteau-pilon',       'hard',   158, 6, 15,  46, 'harm',   [0, 3, 5, 4], 'E', ['roll', 'wide'], 'vortex'),
  S('funk-overload',   'Funk Overload',      'Surchauffe du groove',   'funk',   124, 6, 60,  44, 'minor',  [0, 3, 6, 4], 'E', ['roll', 'shold'], 'waves'),
  S('acid-reactor',    'Acid Reactor',       'La 303 en fusion',       'techno', 132, 6, 100, 45, 'phryg',  [0, 1, 5, 4], 'E', ['roll', 'shold'], 'vortex', ['tilt', 'pulse']),
  S('percussion-factory', 'Percussion Factory', "L'usine à toms",      'house',  130, 6, 40,  43, 'minor',  [0, 3, 5, 4], 'D', ['roll', 'wide'], 'hex', ['dance']),
  // ★7
  S('night-stalker',   'Night Stalker',      'Il rôde sans être vu',   'dnb',    174, 7, 240, 44, 'phryg',  [0, 1, 3, 4], 'E', ['ghost'], 'city', ['stutter']),
  S('hat-storm',       'Hat Storm',          'Avalanche de charleys',  'trap',   146, 7, 265, 44, 'phryg',  [0, 1, 3, 4], 'E', ['roll', 'ghost'], 'rain'),
  S('charleston-chase', 'Charleston Chase',  'Poursuite swing',        'swing',  152, 7, 50,  46, 'harm',   [0, 5, 2, 4], 'E', ['roll', 'wide'], 'city', ['sway', 'dance']),
  S('quicksilver',     'Quicksilver',        'Vif-argent',             'trance', 154, 7, 90,  46, 'minor',  [0, 5, 3, 6], 'E', ['shold', 'roll'], 'tunnel', ['sway', 'scatter']),
  S('bass-quake',      'Bass Quake',         'Séisme de sub',          'dub',    144, 7, 230, 43, 'phryg',  [0, 1, 5, 6], 'E', ['shold', 'wide'], 'rain'),
  S('rave-spiral',     'Rave Spiral',        'La spirale infernale',   'hard',   162, 7, 340, 45, 'minor',  [0, 5, 2, 6], 'E', ['roll', 'ghost'], 'tunnel', ['tilt', 'pulse', 'shake']),
  S('smoke-rings',     'Smoke Rings',        'Volutes hypnotiques',    'lofi',   94,  7, 275, 45, 'dorian', [0, 5, 3, 4], 'E', ['ghost', 'shold'], 'city'),
  S('broadside',       'Broadside',          'Bordée de canons',       'chip',   156, 7, 10,  47, 'minor',  [0, 2, 5, 6], 'E', ['wide', 'roll'], 'hex'),
  // ★8
  S('adrenaline-rush', 'Adrenaline Rush',    'Pic de tension',         'dnb',    176, 8, 0,   45, 'harm',   [0, 5, 2, 4], 'E', ['roll', 'shold'], 'vortex', ['shake', 'stutter']),
  S('groove-titan',    'Groove Titan',       'Le titan du funk',       'funk',   128, 8, 120, 46, 'minor',  [0, 3, 5, 6], 'E', ['roll', 'wide', 'shold'], 'hex', ['dance', 'scatter']),
  S('pressure-drop',   'Pressure Drop',      'Chute de pression',      'dub',    146, 8, 205, 44, 'harm',   [0, 5, 2, 4], 'F', ['roll', 'wide'], 'rain'),
  S('crimson-riff',    'Crimson Riff',       'Le riff écarlate',       'metal',  176, 8, 0,   43, 'phryg',  [0, 1, 3, 4], 'E', ['roll', 'wide'], 'vortex', ['swap', 'shake']),
  S('dragon-march',    'Dragon March',       'La marche du dragon',    'orch',   144, 8, 355, 43, 'phryg',  [0, 1, 5, 4], 'F', ['roll', 'shold', 'wide'], 'vortex', ['pulse', 'split2', 'shake']),
  S('spectral-divide', 'Spectral Divide',    'La frontière invisible', 'wave',   160, 8, 270, 44, 'phryg',  [0, 1, 5, 6], 'E', ['ghost', 'wide'], 'stars', ['portal']),
  // ★9
  S('maximum-voltage', 'Maximum Voltage',    'Haute tension',          'trance', 162, 9, 55,  46, 'harm',   [0, 3, 5, 4], 'F', ['roll', 'shold', 'wide'], 'tunnel'),
  S('goa-storm',       'Goa Storm',          'Tempête hypnotique',     'psy',    148, 9, 290, 46, 'phryg',  [0, 1, 3, 4], 'F', ['roll', 'shold', 'ghost'], 'tunnel', ['tilt', 'wave', 'orbit']),
  S('gigahertz',       'Gigahertz',          'Au-delà du mur du son',  'hard',   166, 9, 355, 46, 'phryg',  [0, 1, 5, 4], 'F', ['roll', 'wide', 'ghost'], 'vortex'),
  S('abyss-signal',    'Abyss Signal',       'Signal des abysses',     'dub',    148, 9, 250, 45, 'phryg',  [0, 1, 3, 4], 'F', ['shold', 'ghost', 'wide'], 'tunnel', ['portal', 'stutter']),
  S('phantom-cascade', 'Phantom Cascade',    'Chute libre spectrale',  'chip',   166, 9, 300, 48, 'minor',  [0, 5, 2, 6], 'F', ['ghost', 'shold'], 'rain', ['wave', 'split4']),
  // ★10 — boss finaux
  S('overdrive-king',  'Overdrive King',     'Le roi de la saturation', 'hard',  170, 10, 30, 45, 'harm',   [0, 5, 2, 4], 'F', ['roll', 'shold', 'wide', 'ghost'], 'vortex', ['tilt', 'split2', 'pulse', 'shake']),
  S('final-groove',    'FINAL//GROOVE',      'Le groove de la fin',    'funk',   132, 10, 310, 46, 'phryg', [0, 1, 5, 4], 'F', ['roll', 'shold', 'wide', 'ghost'], 'hex', ['wave', 'split6', 'dance', 'scatter']),
  S('omega-point',     'OMEGA//POINT',       'Le jugement dernier',    'wave',   184, 10, 350, 45, 'phryg', [0, 1, 5, 4], 'F', ['roll', 'shold', 'wide', 'ghost'], 'vortex', ['split4', 'sway', 'portal', 'stutter', 'swap']),
];

const TUTORIAL_DEF = {
  id: 'tutorial', title: 'Tutoriel', sub: 'Apprenez toutes les mécaniques',
  bpm: 90, stars: 0, hue: 200, tutorial: true, bg: 'stars',
};

const Composer = (() => {

  function scalePitch(root, idx, scale) {
    const i = ((idx % 7) + 7) % 7;
    return root + 12 * Math.floor(idx / 7) + scale[i];
  }

  const LEAD_RHYTHMS = {
    intro:  [[8], [0, 8], [12], [4, 12]],
    verse:  [[0, 6, 8], [0, 3, 8, 11], [4, 8, 14], [0, 8, 10, 14], [2, 6, 10]],
    chorus: [[0, 2, 4, 8, 10, 12], [0, 3, 6, 8, 11, 14], [0, 4, 6, 8, 12, 14], [0, 2, 8, 10, 12, 14]],
    break:  [[0, 8], [0, 10], [4, 12]],
    outro:  [[0], [8]],
  };

  function compose(def) {
    const rng = Util.mulberry32(Util.hashStr(def.id));
    const st = def.style || 'wave';
    const scale = SCALES[def.scale || 'minor'];
    const form = Array.isArray(def.form) ? def.form : FORMS[def.form];
    // feel "halftime" : caisse claire (ou rim) sur le 3e temps
    const half = ['lofi', 'dub', 'trap', 'reggae'].includes(st);
    // contretemps traînants (lo-fi léger, swing jazz marqué, reggae subtil)
    const swing = st === 'lofi' ? 0.45 : st === 'swing' ? 0.55 : st === 'reggae' ? 0.3 : 0;
    const ev = [];
    const push = (bar, q, inst, midi, dur, vel, strength, extra) => {
      const qq = swing && q % 4 === 2 ? q + swing : q;
      const e = { t: bar * 4 + qq / 4, q, inst, midi, dur, vel, strength };
      if (extra) Object.assign(e, extra);
      ev.push(e);
    };

    const leadRoot = def.root + 24 + (st === 'hard' || st === 'metal' ? 12 : 0);
    const bassRoot = def.root - 12;
    const padRoot = def.root + 12;
    const melInst = st === 'lofi' || st === 'trap' ? 'bell'
      : st === 'funk' ? 'pluck'
      : st === 'swing' ? 'piano'
      : st === 'orch' ? 'brass'
      : 'lead';
    const leadWave = st === 'chip' ? 'square' : st === 'wave' && rng() < 0.35 ? 'square' : 'sawtooth';
    const leadFat = ['trance', 'hard', 'dub', 'metal', 'psy', 'techno'].includes(st);
    const durMul = st === 'trance' ? 1.35 : st === 'orch' ? 1.25 : half ? 1.2 : 1;
    const verseKickPat = Util.pick(rng, [[0, 8], [0, 8, 10], [0, 6, 8], [0, 8, 14]]);
    const hardEx = st === 'hard' ? { hard: true } : null;
    // les styles halftime restent aérés en bas du classement, mais leurs
    // arrangements se chargent aux étoiles élevées (sinon charts trop vides)
    const busy = half && def.stars >= 4;
    let mel = 7 + Math.floor(rng() * 3);

    // hook de refrain : phrase fixe rejouée à chaque refrain, transposée
    // selon l'accord du moment — la signature mélodique du morceau
    const hookRhythm = Util.pick(rng, (half && def.stars < 6)
      ? [[0, 4, 8, 12], [0, 3, 8, 11], [0, 6, 8, 14], [0, 4, 10, 12]]
      : LEAD_RHYTHMS.chorus);
    const hookSteps = hookRhythm.map((q, i) => i === 0 ? 0 : Util.pick(rng, [-3, -2, -1, 1, 1, 2, 2, 3]));
    const hookBase = 4 + Math.floor(rng() * 4);
    const snap = (m, chordIdx) => {
      let best = m, bd = 99;
      for (const c of [chordIdx[0], chordIdx[1], chordIdx[2], chordIdx[0] + 7, chordIdx[1] + 7]) {
        const dd = Math.abs(c - m);
        if (dd < bd) { bd = dd; best = c; }
      }
      return best;
    };

    const sections = [];
    let bar = 0;
    form.forEach((sec, si) => {
      sections.push({ name: sec, start: si * 16, end: (si + 1) * 16 });
      const nextSec = form[si + 1] || 'outro';
      for (let b = 0; b < 4; b++, bar++) {
        const deg = def.prog[b % def.prog.length];
        const chordIdx = [deg, deg + 2, deg + 4];
        const chordMidis = chordIdx.map(i => scalePitch(padRoot, i, scale));
        const lastBar = b === 3;
        let kicks = []; // partagé entre batterie et basse (les 808 suivent les kicks)

        // ----- Nappe -----
        if (sec !== 'outro' || b < 2) {
          push(bar, 0, 'pad', chordMidis, 4, st === 'dnb' ? 0.09 : st === 'hard' ? 0.07 : 0.13, 0);
        }

        // ----- Batterie -----
        if (sec === 'verse' || sec === 'chorus') {
          if (['house', 'trance', 'hard', 'techno', 'disco', 'psy'].includes(st)) kicks = [0, 4, 8, 12];
          else if (st === 'dnb') kicks = rng() < 0.35 ? [0, 6, 10] : [0, 10];
          else if (st === 'funk') kicks = sec === 'chorus'
            ? Util.pick(rng, [[0, 4, 7, 10], [0, 4, 10, 13]])
            : Util.pick(rng, [[0, 7, 10], [0, 3, 10], [0, 6, 10]]);
          else if (st === 'lofi') kicks = sec === 'chorus' ? [0, 7, 10] : [0, 10];
          else if (st === 'dub') kicks = sec === 'chorus' ? [0, 10] : [0];
          else if (st === 'trap') kicks = Util.pick(rng, [[0, 7, 10], [0, 3, 11], [0, 7, 11, 14]]);
          else if (st === 'metal') kicks = sec === 'chorus'
            ? [0, 2, 4, 6, 8, 10, 12, 14]
            : Util.pick(rng, [[0, 6, 8, 14], [0, 3, 8, 11], [0, 6, 8, 12]]);
          else if (st === 'reggae') kicks = sec === 'chorus' ? [8, 14] : [8]; // one-drop
          else if (st === 'swing') kicks = [0, 8];
          else if (st === 'orch') kicks = []; // les timbales s'en chargent
          else kicks = sec === 'chorus' ? [0, 4, 8, 12] : verseKickPat;
          for (const q of kicks) push(bar, q, 'kick', 0, 0, 1, 0.9, hardEx);

          // timbales (orchestral)
          if (st === 'orch') {
            const timps = sec === 'chorus' ? [0, 4, 8, 12] : [0, 8];
            for (const q of timps) push(bar, q, 'tom', 38, 0, 0.9, 0.9);
          }

          const snQs = half ? [8] : [4, 12];
          const snInst = st === 'reggae' ? 'rim' : 'snare';
          for (const q of snQs) {
            push(bar, q, snInst, 0, 0,
              (st === 'hard' || st === 'orch') && sec === 'verse' ? 0.55 : 0.9, 0.95);
          }
          // claps de renfort au refrain
          if (sec === 'chorus' && ['house', 'trance', 'funk', 'hard', 'dub', 'disco', 'techno'].includes(st)) {
            for (const q of snQs) push(bar, q, 'clap', 0, 0, 0.65, 0.2, { noChart: true });
          }
          if (lastBar && (nextSec === 'chorus' || sec === 'chorus') && !half) {
            push(bar, 14, 'snare', 0, 0, 0.55, 0.6);
            if (sec === 'chorus') push(bar, 15, 'snare', 0, 0, 0.45, 0.55);
          }
          // fill de toms à l'approche d'un refrain
          if (lastBar && nextSec === 'chorus' && ['wave', 'house', 'funk', 'dnb', 'lofi', 'metal', 'orch', 'disco'].includes(st)) {
            push(bar, 12, 'tom', st === 'orch' ? 45 : 57, 0, 0.75, 0.55);
            push(bar, 13, 'tom', st === 'orch' ? 41 : 53, 0, 0.8, 0.55);
            push(bar, 15, 'tom', st === 'orch' ? 38 : 48, 0, 0.9, 0.6);
          }
          // montée avant chaque refrain
          if (lastBar && nextSec === 'chorus' && !['lofi', 'reggae', 'swing', 'orch'].includes(st)) {
            push(bar, 0, 'riser', 0, 4, st === 'hard' ? 0.9 : 0.7, 0, { noChart: true });
          }

          // charleys par style
          if (st === 'techno') {
            for (const q of [2, 6, 10, 14]) push(bar, q, 'hat', 0, 0, 0.35, 0.3);
            if (sec === 'chorus') {
              for (let q = 1; q < 16; q += 2) push(bar, q, 'hat', 0, 0, 0.12, 0.22);
              push(bar, 10, 'hat', 0, 0, 0.4, 0.45, { open: true });
            }
          } else if (st === 'trap') {
            for (let q = 0; q < 16; q++) push(bar, q, 'hat', 0, 0, q % 4 === 0 ? 0.28 : 0.15, 0.24);
            // rafales de doubles-croches doublées (signature trap)
            if (sec === 'chorus' || rng() < 0.4) {
              for (const q of [7, 15]) push(bar, q + 0.5, 'hat', 0, 0, 0.18, 0.3);
            }
          } else if (st === 'metal') {
            for (let q = 0; q < 16; q += 2) push(bar, q, 'hat', 0, 0, 0.2, 0.25);
            if (sec === 'chorus') for (const q of [0, 8]) push(bar, q, 'hat', 0, 0, 0.45, 0.5, { open: true });
          } else if (st === 'disco') {
            for (const q of [2, 6, 10, 14]) push(bar, q, 'hat', 0, 0, 0.45, 0.32, { open: true });
            if (sec === 'chorus') for (let q = 0; q < 16; q += 2) push(bar, q, 'hat', 0, 0, 0.14, 0.22);
          } else if (st === 'reggae') {
            for (const q of [2, 6, 10, 14]) push(bar, q, 'hat', 0, 0, 0.25, 0.28);
            for (const q of [0, 4, 8, 12]) push(bar, q, 'hat', 0, 0, 0.12, 0.2);
          } else if (st === 'swing') {
            // motif de ride swingué : ding… ding-ga-ding
            for (const q of [0, 4, 8, 12]) push(bar, q, 'ride', 0, 0, 0.5, 0.35);
            for (const q of [6, 14]) push(bar, q, 'ride', 0, 0, 0.3, 0.3);
          } else if (st === 'orch') {
            if (sec === 'chorus') push(bar, 0, 'hat', 0, 0, 0.5, 0.5, { open: true }); // cymbale
          } else if (st === 'psy') {
            for (const q of [2, 6, 10, 14]) push(bar, q, 'hat', 0, 0, 0.35, 0.3, { open: true });
            if (sec === 'chorus') for (let q = 1; q < 16; q += 2) push(bar, q, 'hat', 0, 0, 0.1, 0.22);
          } else if (st === 'house' || st === 'trance') {
            for (const q of [2, 6, 10, 14]) push(bar, q, 'hat', 0, 0, 0.42, 0.3, { open: true });
            if (sec === 'chorus') for (let q = 0; q < 16; q += 2) push(bar, q, 'hat', 0, 0, 0.16, 0.25);
          } else if (st === 'chip') {
            for (let q = 0; q < 16; q++) push(bar, q, 'hat', 0, 0, q % 2 ? 0.1 : 0.16, 0.25);
          } else if (st === 'dnb') {
            for (const q of [2, 7, 9, 13]) push(bar, q, 'hat', 0, 0, 0.25, 0.3);
            if (rng() < 0.45) push(bar, Util.pick(rng, [3, 7, 11, 15]), 'snare', 0, 0, 0.28, 0.2, { noChart: true });
          } else if (st === 'funk') {
            for (let q = 0; q < 16; q++) push(bar, q, 'hat', 0, 0, q % 4 === 0 ? 0.3 : 0.15, 0.22);
            push(bar, 7, 'hat', 0, 0, 0.38, 0.4, { open: true });
          } else if (st === 'hard') {
            for (const q of [2, 6, 10, 14]) push(bar, q, 'hat', 0, 0, 0.35, 0.3, { open: sec === 'chorus' });
          } else if (st === 'lofi') {
            if (busy) for (let q = 0; q < 16; q++) push(bar, q, 'hat', 0, 0, q % 4 === 0 ? 0.2 : 0.12, 0.25);
            else for (let q = 0; q < 16; q += 2) push(bar, q, 'hat', 0, 0, q % 4 ? 0.22 : 0.13, 0.25);
            if (rng() < 0.3) push(bar, 14, 'hat', 0, 0, 0.28, 0.35, { open: true });
          } else if (st === 'dub') {
            if (busy && sec === 'chorus') for (let q = 0; q < 16; q++) push(bar, q, 'hat', 0, 0, q % 2 ? 0.09 : 0.15, 0.25);
            else if (busy) for (let q = 0; q < 16; q += 2) push(bar, q, 'hat', 0, 0, 0.15, 0.25);
            else {
              for (const q of [2, 6, 10, 14]) push(bar, q, 'hat', 0, 0, 0.22, 0.28);
              if (sec === 'chorus') for (const q of [5, 13]) push(bar, q, 'hat', 0, 0, 0.15, 0.2);
            }
          } else if (sec === 'chorus') {
            for (let q = 0; q < 16; q++) {
              if (q === 14) continue;
              push(bar, q, 'hat', 0, 0, q % 2 ? 0.22 : 0.4, 0.3);
            }
            push(bar, 14, 'hat', 0, 0, 0.5, 0.5, { open: true });
          } else {
            for (let q = 0; q < 16; q += 2) push(bar, q, 'hat', 0, 0, q % 4 ? 0.42 : 0.3, 0.3);
          }
        } else if (sec === 'intro') {
          if (bar >= 2) { push(bar, 0, 'kick', 0, 0, 0.8, 0.9, hardEx); push(bar, 8, 'kick', 0, 0, 0.8, 0.9, hardEx); }
          if (bar >= 2) for (let q = 0; q < 16; q += 2) push(bar, q, 'hat', 0, 0, 0.25, 0.3);
        } else if (sec === 'break') {
          push(bar, 0, 'kick', 0, 0, 0.7, 0.9);
          for (let q = 2; q < 16; q += 4) push(bar, q, 'hat', 0, 0, 0.2, 0.3);
          if (lastBar && nextSec === 'chorus' && st !== 'lofi') {
            push(bar, 0, 'riser', 0, 4, 0.8, 0, { noChart: true });
          }
        } else if (sec === 'outro') {
          push(bar, 0, 'kick', 0, 0, 0.7, 0.9);
        }

        // crash en tête de refrain
        if (sec === 'chorus' && b === 0) {
          push(bar, 0, 'hat', 0, 0, st === 'hard' ? 0.75 : 0.6, 0.55, { open: true });
        }

        // ----- Basse par style -----
        if (sec === 'verse' || sec === 'chorus') {
          const bm = scalePitch(bassRoot, deg, scale);
          if (st === 'house') {
            for (const q of [2, 6, 10, 14]) push(bar, q, 'bass', bm, 0.45, 0.85, 0.5);
          } else if (st === 'trance') {
            for (let q = 1; q < 16; q++) push(bar, q, 'bass', bm, 0.18, q % 2 ? 0.5 : 0.7, 0.5);
          } else if (st === 'dnb') {
            push(bar, 0, 'sub', bm - 12, 2, 0.9, 0.5);
            push(bar, 8, 'sub', bm - 12, 1.5, 0.75, 0.5);
          } else if (st === 'chip') {
            for (let q = 0; q < 16; q += 2) {
              push(bar, q, 'bass', bm + (q % 4 === 2 ? 12 : 0), 0.4, 0.8, 0.5);
            }
          } else if (st === 'funk') {
            const line = Util.pick(rng, [[0, 3, 6, 10, 12], [0, 3, 7, 10, 14], [0, 6, 7, 10, 13]]);
            for (const q of line) {
              const idx = q === 7 || q === 13 ? deg + 7 : q === 14 ? deg + 4 : deg;
              push(bar, q, 'bass', scalePitch(bassRoot, idx, scale), 0.3, q === 0 ? 0.9 : 0.7, 0.5);
            }
          } else if (st === 'hard') {
            // stabs de basse à contretemps, l'ossature du hardcore
            for (const q of [2, 6, 10, 14]) push(bar, q, 'sub', bm, 0.4, 0.85, 0.5);
          } else if (st === 'lofi') {
            push(bar, 0, 'sub', bm, 2.2, 0.75, 0.5);
            push(bar, 10, 'sub', bm, 1.2, 0.6, 0.5);
          } else if (st === 'dub') {
            push(bar, 0, 'wob', bm, sec === 'chorus' ? 3.4 : 2.4, 0.85, 0.5, { rate: Util.pick(rng, [2, 3, 4, 6]) });
            if (sec === 'chorus') push(bar, 14, 'wob', bm, 0.5, 0.7, 0.45, { rate: 8 });
          } else if (st === 'techno') {
            // grondement à contretemps + ligne acide 303
            for (const q of [2, 6, 10, 14]) push(bar, q, 'sub', bm - 12, 0.4, 0.7, 0.45);
            const line = Util.pick(rng, [[0, 3, 6, 8, 11, 14], [0, 2, 6, 7, 10, 13], [1, 4, 6, 9, 12, 14]]);
            for (const q of line) {
              const idx = deg + Util.pick(rng, [0, 0, 0, 7, 3, -1]);
              push(bar, q, 'acid', scalePitch(bassRoot + 12, idx, scale), 0.22,
                sec === 'chorus' ? 0.8 : 0.6, 0.5);
            }
          } else if (st === 'trap') {
            // 808 glissants sur les kicks
            const slides = [0, 0, 5, 7, -5];
            kicks.forEach((q, i) => {
              push(bar, q, 'sub', bm, q === 0 ? 1.6 : 0.9, 0.9, 0.5,
                i > 0 ? { slide: Util.pick(rng, slides) } : null);
            });
          } else if (st === 'metal') {
            // chugs en palm mute + power chords sur les têtes de mesure
            push(bar, 0, 'gtr', [bm + 12, bm + 19], 1.6, 0.9, 0.5);
            for (let q = 2; q < 16; q += 2) {
              if (sec === 'verse' && q % 4 === 0 && rng() < 0.3) continue; // respirations
              push(bar, q, 'gtr', [bm + 12], 0.2, 0.7, 0.45, { mute: true });
            }
            push(bar, 0, 'sub', bm, 1.8, 0.6, 0, { noChart: true });
          } else if (st === 'disco') {
            // basse octave : la signature du disco
            for (let q = 0; q < 16; q += 2) {
              push(bar, q, 'bass', bm + (q % 4 === 2 ? 12 : 0), 0.4, 0.85, 0.5);
            }
          } else if (st === 'reggae') {
            if (rng() < 0.15) {
              push(bar, 0, 'sub', bm, 1.4, 0.85, 0.5); // mesure aérée
            } else {
              const line = Util.pick(rng, [[0, 6, 10], [0, 5, 10, 12], [0, 10]]);
              for (const q of line) {
                push(bar, q, 'sub', scalePitch(bassRoot, q === 12 ? deg + 4 : deg, scale), 0.7, 0.85, 0.5);
              }
            }
          } else if (st === 'swing') {
            // walking bass : noires qui marchent vers l'accord suivant
            const walk = [deg, deg + 2, deg + 4, deg + (rng() < 0.5 ? 5 : 3)];
            walk.forEach((idx, i) => {
              push(bar, i * 4, 'sub', scalePitch(bassRoot + 12, idx, scale), 0.85, 0.75, 0.5);
            });
          } else if (st === 'orch') {
            push(bar, 0, 'sub', bm, 3.6, 0.65, 0.5);
          } else if (st === 'psy') {
            // basse roulante : toutes les doubles-croches sauf les temps
            for (let q = 0; q < 16; q++) {
              if (q % 4 === 0) continue;
              push(bar, q, 'bass', bm, 0.16, q % 2 ? 0.55 : 0.7, 0.5);
            }
          } else {
            for (let q = 0; q < 16; q += 2) {
              const oct = (q === 6 || q === 14) && rng() < 0.5 ? 7 : 0;
              push(bar, q, 'bass', scalePitch(bassRoot, deg + oct, scale), 0.45, 0.85, 0.5);
            }
          }
        } else if (sec === 'break' || sec === 'outro') {
          if (st === 'dub') push(bar, 0, 'wob', scalePitch(bassRoot, deg, scale), 3.6, 0.7, 0.5, { rate: 1.5 });
          else push(bar, 0, 'bass', scalePitch(bassRoot, deg, scale), 3.6, 0.7, 0.5);
        } else if (sec === 'intro' && bar >= 1) {
          push(bar, 0, 'bass', scalePitch(bassRoot, deg, scale), 1.8, 0.6, 0.5);
          push(bar, 8, 'bass', scalePitch(bassRoot, deg, scale), 1.8, 0.6, 0.5);
        }

        // ----- Stabs / skanks — musique uniquement -----
        if (st === 'house' && (sec === 'verse' || sec === 'chorus' || sec === 'break')) {
          const qs = sec === 'chorus' ? [2, 7, 10] : sec === 'break' ? [0, 8] : [4, 12];
          for (const q of qs) push(bar, q, 'stab', chordMidis, 0, 0.5, 0);
        } else if (st === 'funk' && (sec === 'verse' || sec === 'chorus')) {
          for (const q of [2, 6, 10, 14]) {
            if (rng() < 0.7) push(bar, q, 'pluck', chordMidis[1] + 12, 0.18, 0.45, 0, { noChart: true });
          }
        } else if (st === 'lofi' && (sec === 'verse' || sec === 'break')) {
          if (b % 2 === 0) push(bar, Util.pick(rng, [2, 6]), 'bell', chordMidis[2], 1.2, 0.2, 0, { noChart: true });
        } else if (st === 'reggae' && (sec === 'verse' || sec === 'chorus')) {
          // le skank : accords plaqués sur les temps 2 et 4 (chartable, c'est le groove)
          for (const q of [4, 12]) push(bar, q, 'pluck', chordMidis[1] + 12, 0.16, 0.55, 0.45);
        } else if (st === 'disco' && (sec === 'verse' || sec === 'chorus')) {
          push(bar, 0, 'stab', chordMidis, 0, 0.55, 0);
          for (const q of [2, 6, 10, 14]) {
            if (rng() < 0.6) push(bar, q, 'pluck', chordMidis[1] + 12, 0.15, 0.4, 0, { noChart: true });
          }
        } else if (st === 'swing' && (sec === 'verse' || sec === 'chorus')) {
          // comping piano à contretemps
          for (const q of [2, 6, 10, 14]) {
            if (rng() < 0.65) push(bar, q, 'piano', chordMidis, 0.4, 0.5, 0, { noChart: true });
          }
        } else if (st === 'orch' && sec !== 'outro') {
          // ostinato de cordes détachées sur les notes de l'accord
          const step = sec === 'chorus' ? 1 : 2;
          for (let q = 0; q < 16; q += step) {
            const tone = [0, 1, 2, 1][(q / step) % 4];
            push(bar, q, 'ost', chordMidis[tone], step / 4 * 0.9,
              sec === 'chorus' ? 0.55 : 0.45, q % 4 === 0 ? 0.42 : 0.35);
          }
          // nappes de cordes soutenues
          push(bar, 0, 'strings', chordMidis, 4, 0.16, 0, { noChart: true });
        } else if (st === 'psy' && (sec === 'verse' || sec === 'chorus')) {
          if (rng() < 0.5) {
            push(bar, Util.pick(rng, [4, 12]), 'zap', scalePitch(leadRoot, deg + 4, scale), 0.4, 0.7, 0.5);
          }
        } else if (st === 'techno' && sec === 'break') {
          push(bar, 0, 'stab', chordMidis, 0, 0.45, 0);
        }

        // ----- Arpèges -----
        const arpOk = !half && !['funk', 'metal', 'swing', 'orch'].includes(st);
        const arpQs = arpOk && sec === 'chorus'
          ? (st === 'dnb' ? [0, 2, 4, 6, 8, 10, 12, 14] : Array.from({ length: 16 }, (_, i) => i))
          : (sec === 'verse' && (st === 'chip' || st === 'trance' || st === 'hard') ? [0, 2, 4, 6, 8, 10, 12, 14] : null);
        if (arpQs) {
          for (const q of arpQs) {
            const tone = [0, 1, 2, 1][q % 4];
            const idx = chordIdx[tone] + (q % 8 >= 4 ? 7 : 0);
            push(bar, q, 'arp', scalePitch(leadRoot, idx, scale), 0.2, sec === 'chorus' ? 0.8 : 0.5,
              sec === 'chorus' ? 0.45 : 0.4);
          }
        }

        // ----- Mélodie -----
        if (sec === 'chorus') {
          // le hook, transposé par l'accord du moment
          const tShift = deg > 3 ? deg - 7 : deg;
          let mh = hookBase;
          for (let i = 0; i < hookRhythm.length; i++) {
            const q = hookRhythm[i];
            mh = Util.clamp(mh + hookSteps[i], 0, 13);
            let idx = q % 4 === 0 ? snap(mh, chordIdx) : mh;
            idx = Util.clamp(idx + tShift, 0, 14);
            const nextQ = i + 1 < hookRhythm.length ? hookRhythm[i + 1] : 16;
            const dur = Math.max(0.25, ((nextQ - q) / 4) * 0.9 * durMul);
            push(bar, q, melInst, scalePitch(leadRoot, idx, scale), dur, 1,
              q % 4 === 0 ? 0.8 : 0.65, { wave: leadWave, fat: leadFat });
            // seconde voix 8 bits en harmonie
            if (st === 'chip') {
              push(bar, q, 'lead', scalePitch(leadRoot, idx + 5, scale), dur * 0.8, 0.35, 0,
                { wave: 'square', noChart: true });
            }
            mel = idx;
          }
        } else {
          const leadSet = (['dnb', 'hard', 'metal', 'techno', 'psy'].includes(st) || half) && sec === 'verse'
            ? LEAD_RHYTHMS.break : LEAD_RHYTHMS[sec];
          const rhythm = Util.pick(rng, leadSet);
          for (let i = 0; i < rhythm.length; i++) {
            const q = rhythm[i];
            const strong = q % 4 === 0;
            if (strong) {
              let best = chordIdx[0], bd = 99;
              for (const c of chordIdx.concat(chordIdx.map(x => x + 7))) {
                const d = Math.abs(c - mel);
                if (d < bd || (d === bd && rng() < 0.5)) { bd = d; best = c; }
              }
              mel = best;
            } else {
              mel = Util.clamp(mel + Util.pick(rng, [-2, -1, -1, 1, 1, 2]), 0, 13);
            }
            const nextQ = i + 1 < rhythm.length ? rhythm[i + 1] : 16;
            const dur = Math.max(0.25, ((nextQ - q) / 4) * 0.9 * durMul);
            push(bar, q, melInst, scalePitch(leadRoot, mel, scale), dur, 0.85,
              strong ? 0.8 : 0.65, { wave: leadWave, fat: leadFat });
          }
        }
      }
    });

    ev.sort((a, b) => a.t - b.t);
    const spb = 60 / def.bpm;
    return { events: ev, spb, durationSec: bar * 4 * spb + 1.5, sections };
  }

  /* ---------- Paramètres de chart par difficulté (★1 à ★10) ---------- */

  const CHART_PARAMS = [
    { gGap: 0.42,  lGap: 0.55,  hatP: 0,    arpP: 0,    chordProb: 0,    holdP: 0.85, xGap: 0.50, bombEvery: 0,  rollP: 0,    sholdP: 0,    wideP: 0,    ghostP: 0 },
    { gGap: 0.26,  lGap: 0.42,  hatP: 0,    arpP: 0,    chordProb: 0,    holdP: 0.70, xGap: 0.45, bombEvery: 13, rollP: 0,    sholdP: 0,    wideP: 0,    ghostP: 0 },
    { gGap: 0.20,  lGap: 0.33,  hatP: 0,    arpP: 0,    chordProb: 0,    holdP: 0.60, xGap: 0.40, bombEvery: 11, rollP: 0.18, sholdP: 0,    wideP: 0.12, ghostP: 0 },
    { gGap: 0.150, lGap: 0.26,  hatP: 0.25, arpP: 0.35, chordProb: 0.35, holdP: 0.50, xGap: 0.33, bombEvery: 9,  rollP: 0.25, sholdP: 0.18, wideP: 0.20, ghostP: 0 },
    { gGap: 0.110, lGap: 0.21,  hatP: 0.4,  arpP: 0.55, chordProb: 0.55, holdP: 0.40, xGap: 0.28, bombEvery: 8,  rollP: 0.32, sholdP: 0.25, wideP: 0.28, ghostP: 0.06 },
    { gGap: 0.085, lGap: 0.16,  hatP: 0.6,  arpP: 0.85, chordProb: 0.7,  holdP: 0.30, xGap: 0.24, bombEvery: 7,  rollP: 0.38, sholdP: 0.30, wideP: 0.35, ghostP: 0.08 },
    { gGap: 0.078, lGap: 0.145, hatP: 0.7,  arpP: 0.9,  chordProb: 0.75, holdP: 0.28, xGap: 0.22, bombEvery: 7,  rollP: 0.42, sholdP: 0.35, wideP: 0.40, ghostP: 0.10 },
    { gGap: 0.072, lGap: 0.135, hatP: 0.78, arpP: 0.95, chordProb: 0.8,  holdP: 0.26, xGap: 0.21, bombEvery: 6,  rollP: 0.46, sholdP: 0.40, wideP: 0.45, ghostP: 0.13 },
    { gGap: 0.067, lGap: 0.125, hatP: 0.85, arpP: 1,    chordProb: 0.85, holdP: 0.24, xGap: 0.20, bombEvery: 6,  rollP: 0.50, sholdP: 0.45, wideP: 0.50, ghostP: 0.16 },
    { gGap: 0.062, lGap: 0.115, hatP: 0.9,  arpP: 1,    chordProb: 0.9,  holdP: 0.22, xGap: 0.19, bombEvery: 5,  rollP: 0.55, sholdP: 0.50, wideP: 0.55, ghostP: 0.20 },
  ];

  const MOD_FLOOR = { roll: 0.5, shold: 0.45, wide: 0.5, ghost: 0.25 };

  // équivalences chart des nouveaux instruments
  const INST_ALIAS = {
    clap: 'snare', rim: 'snare', tom: 'kick', ride: 'hat',
    pluck: 'lead', bell: 'lead', piano: 'lead', brass: 'lead', zap: 'lead',
    sub: 'bass', wob: 'bass', acid: 'bass', gtr: 'bass', ost: 'arp',
  };

  // une note occupe-t-elle cette lane (en comptant lane2 des wides/sholds) ?
  function occupies(n, lane) {
    return n.lane === lane || n.lane2 === lane;
  }
  function noteEnd(n) { return n.t2 || n.t; }

  function buildChart(def, composed) {
    const d = def.stars;
    const P = CHART_PARAMS[d - 1];
    const mods = def.mods || [];
    const mp = m => mods.includes(m) ? Math.max(P[m + 'P'], MOD_FLOOR[m]) : P[m + 'P'];
    const rollP = mp('roll'), sholdP = mp('shold'), wideP = mp('wide'), ghostP = mp('ghost');
    const spb = composed.spb;
    const rng = Util.mulberry32(Util.hashStr(def.id + '::chart'));
    const halfStyle = def.style === 'lofi' || def.style === 'dub';

    // 1) Candidats
    const cands = [];
    for (const e of composed.events) {
      if (e.noChart || e.inst === 'pad' || e.inst === 'stab' || e.inst === 'riser' || e.inst === 'strings') continue;
      const inst = INST_ALIAS[e.inst] || e.inst;
      let keep = false, str = e.strength;
      switch (inst) {
        case 'kick': keep = d >= 2 ? true : (e.q === 0 || e.q === 8); break;
        case 'snare': keep = true; break;
        case 'lead':
          keep = d >= 2 || e.q % 4 === 0;
          if (d <= 2 && e.q % 4 === 0) str = 0.96;
          break;
        case 'bass': keep = d >= 3 && (d >= 5 || e.q % 4 === 0); break;
        case 'hat':
          keep = e.open ? d >= 3 : (d >= 4 ? rng() < P.hatP : d === 3 && halfStyle && rng() < 0.5);
          if (e.open) str = Math.max(str, 0.4);
          break;
        case 'arp': keep = d >= 4 && rng() < P.arpP; break;
      }
      if (keep) {
        cands.push({
          t: e.t * spb, q: e.q, inst,
          midi: Array.isArray(e.midi) ? e.midi[0] : e.midi,
          dur: (e.dur || 0) * spb,
          str,
        });
      }
    }

    // 2) Filtre de densité par priorité
    cands.sort((a, b) => b.str - a.str || a.t - b.t);
    const accT = [], acc = [];
    for (const c of cands) {
      let lo = 0, hi = accT.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (accT[m] < c.t) lo = m + 1; else hi = m; }
      if (lo < accT.length && accT[lo] - c.t < P.gGap) continue;
      if (lo > 0 && c.t - accT[lo - 1] < P.gGap) continue;
      accT.splice(lo, 0, c.t);
      acc.push(c);
    }
    acc.sort((a, b) => a.t - b.t);

    // 3) Accords sur les snares de temps forts
    if (P.chordProb > 0) {
      for (const c of acc) {
        if (c.inst === 'snare' && (c.q === 4 || c.q === 12 || c.q === 8) && rng() < P.chordProb) c.chord = true;
      }
    }

    // 4) Attribution des colonnes
    const lastT = [-9, -9, -9, -9];
    let melLane = 1 + Math.floor(rng() * 2), melMidi = 0;
    let kickSide = 0, snSide = 0;
    let notes = [];

    for (const c of acc) {
      let pref;
      switch (c.inst) {
        case 'kick': pref = kickSide ? [3, 0, 2, 1] : [0, 3, 1, 2]; kickSide ^= 1; break;
        case 'snare': pref = snSide ? [2, 1, 3, 0] : [1, 2, 0, 3]; snSide ^= 1; break;
        case 'hat': pref = rng() < 0.5 ? [3, 2, 1, 0] : [2, 3, 0, 1]; break;
        case 'bass': pref = rng() < 0.5 ? [0, 1, 2, 3] : [1, 0, 3, 2]; break;
        default: {
          if (c.midi > melMidi) melLane = Util.clamp(melLane + (c.midi - melMidi > 3 ? 2 : 1), 0, 3);
          else if (c.midi < melMidi) melLane = Util.clamp(melLane - (melMidi - c.midi > 3 ? 2 : 1), 0, 3);
          melMidi = c.midi;
          pref = [melLane, Util.clamp(melLane + 1, 0, 3), Util.clamp(melLane - 1, 0, 3), 3 - melLane];
        }
      }

      let lane = -1;
      for (const L of pref) {
        if (c.t - lastT[L] >= P.lGap) { lane = L; break; }
      }
      if (lane < 0) {
        if (d >= 3) {
          lane = 0;
          for (let L = 1; L < 4; L++) if (lastT[L] < lastT[lane]) lane = L;
        } else continue;
      }
      lastT[lane] = c.t;
      notes.push({ t: c.t, lane, type: 'tap', inst: c.inst, dur: c.dur });

      if (c.chord) {
        const half = lane < 2 ? [2, 3] : [0, 1];
        const order = lastT[half[0]] <= lastT[half[1]] ? half : [half[1], half[0]];
        for (const L of order) {
          if (c.t - lastT[L] >= P.lGap) {
            lastT[L] = c.t;
            notes.push({ t: c.t, lane: L, type: 'tap', inst: 'chord', dur: 0 });
            break;
          }
        }
      }
    }

    // 5) Holds : issus des leads/basses tenus
    //    (boostés si le morceau met les holds mobiles en avant)
    const holdP = mods.includes('shold') ? Math.max(P.holdP, 0.55) : P.holdP;
    const prevByLane = {};
    for (const n of notes) {
      const p = prevByLane[n.lane];
      if (p && (p.inst === 'lead' || p.inst === 'bass') && p.dur >= 0.42) {
        const tail = Math.min(p.t + Math.min(p.dur, 2.2), n.t - 0.25);
        if (tail - p.t >= 0.35 && rng() < holdP) { p.type = 'hold'; p.t2 = tail; }
      }
      prevByLane[n.lane] = n;
    }
    for (const lane in prevByLane) {
      const p = prevByLane[lane];
      if ((p.inst === 'lead' || p.inst === 'bass') && p.dur >= 0.42 && p.type === 'tap' && rng() < holdP) {
        p.type = 'hold';
        p.t2 = p.t + Math.min(p.dur, 1.4);
      }
    }

    // 6) Roulements : sur les fills de fin de section (vers/dans un refrain).
    //    La zone remplace les notes qui s'y trouvaient.
    if (rollP > 0) {
      const placeRoll = sec => {
        const z0 = (sec.end - 2) * spb;
        const z1 = sec.end * spb - Math.max(0.35 * spb, 0.3);
        const lane = Math.floor(rng() * 4);
        for (const n of notes) {
          const overlap = n.t < z1 + 0.25 && noteEnd(n) > z0 - 0.25;
          if (overlap && (occupies(n, lane) || d <= 4)) n.cut = true;
        }
        const need = Util.clamp(Math.round((z1 - z0) * (4.5 + d * 0.8)), 3, 14);
        notes.push({ t: z0, t2: z1, lane, type: 'roll', need, inst: 'roll', dur: 0 });
      };
      const eligible = (sec, si) => {
        const next = composed.sections[si + 1];
        return sec.name === 'chorus' || (next && next.name === 'chorus');
      };
      composed.sections.forEach((sec, si) => {
        if (eligible(sec, si) && rng() < rollP) placeRoll(sec);
      });
      notes = notes.filter(n => !n.cut);
    }

    // 7) Holds mobiles : un hold assez long glisse vers une lane voisine.
    //    Les taps qui gêneraient le passage sont délogés (le shold est la star).
    if (sholdP > 0) {
      for (const n of notes) {
        if (n.type !== 'hold' || n.cut || n.t2 - n.t < 0.7 || rng() >= sholdP) continue;
        const dirs = n.lane === 0 ? [1] : n.lane === 3 ? [-1] : (rng() < 0.5 ? [1, -1] : [-1, 1]);
        for (const dir of dirs) {
          const lane2 = n.lane + dir;
          const tm = n.t + (n.t2 - n.t) * (0.4 + rng() * 0.2);
          const conflicts = notes.filter(o => o !== n && !o.cut && occupies(o, lane2) &&
            o.t < n.t2 + 0.3 && noteEnd(o) > tm - 0.4);
          if (conflicts.some(o => o.type !== 'tap')) continue; // holds/rolls/wides restent prioritaires
          conflicts.forEach(o => { o.cut = true; });
          n.type = 'shold'; n.lane2 = lane2; n.tm = tm;
          break;
        }
      }
      // sholds synthétiques : dans les charts denses les holds sources sont
      // rares/courts, on creuse donc un couloir dédié dans couplets et breaks
      const tryPlaceShold = sec => {
        const span = Util.clamp(3 * spb, 1.1, 2.0);
        for (const off of [4, 8, 12]) { // 2e, 3e puis 4e mesure de la section
          const t0 = (sec.start + off) * spb;
          const t2 = t0 + span;
          const tm = t0 + span * (0.45 + rng() * 0.1);
          for (const lane of (rng() < 0.5 ? [1, 2] : [2, 1])) {
            for (const dir of (rng() < 0.5 ? [-1, 1] : [1, -1])) {
              const lane2 = lane + dir;
              const zone = notes.filter(o => !o.cut && (occupies(o, lane) || occupies(o, lane2)) &&
                o.t < t2 + 0.3 && noteEnd(o) > t0 - 0.25);
              if (zone.some(o => o.type !== 'tap')) continue;
              zone.forEach(o => { o.cut = true; });
              notes.push({ t: t0, t2, lane, lane2, tm, type: 'shold', inst: 'lead', dur: 0 });
              return true;
            }
          }
        }
        return false;
      };
      let placedAny = notes.some(n => n.type === 'shold' && !n.cut);
      for (const sec of composed.sections) {
        if (sec.name !== 'verse' && sec.name !== 'break') continue;
        if (rng() >= sholdP) continue;
        if (tryPlaceShold(sec)) placedAny = true;
      }
      // garantie : un morceau qui met les holds mobiles en avant en a toujours
      if (mods.includes('shold') && !placedAny) {
        for (const sec of composed.sections) {
          if (sec.name !== 'verse' && sec.name !== 'break') continue;
          if (tryPlaceShold(sec)) break;
        }
      }
      notes = notes.filter(n => !n.cut);
    }

    // 8) Notes doubles : accords adjacents fusionnés + accents de début de refrain
    if (wideP > 0) {
      const rollBlock = (tt, lanes) => notes.some(r => r.type === 'roll' &&
        lanes.includes(r.lane) && tt > r.t - 0.25 && tt < r.t2 + 0.25);
      // accords existants -> wide si lanes adjacentes
      for (let i = 0; i < notes.length; i++) {
        const a = notes[i];
        if (a.type !== 'tap' || a.cut) continue;
        for (let j = i + 1; j < notes.length && notes[j].t - a.t < 1e-4; j++) {
          const b2 = notes[j];
          if (b2.type !== 'tap' || b2.cut) continue;
          if (Math.abs(a.lane - b2.lane) === 1 && !rollBlock(a.t, [a.lane, b2.lane]) && rng() < wideP) {
            a.type = 'wide';
            a.lane2 = Math.max(a.lane, b2.lane);
            a.lane = Math.min(a.lane, b2.lane);
            b2.cut = true;
          }
          break;
        }
      }
      // accents de début de refrain
      for (const sec of composed.sections) {
        if (sec.name !== 'chorus' || rng() >= wideP) continue;
        const t0 = sec.start * spb;
        const a = notes.find(n => n.type === 'tap' && !n.cut && n.lane >= 0 && n.lane <= 3 && Math.abs(n.t - t0) < 0.05);
        if (!a) continue;
        const nb = a.lane === 3 ? 2 : a.lane + 1;
        if (rollBlock(a.t, [a.lane, nb])) continue;
        const free = !notes.some(o => o !== a && !o.cut && occupies(o, nb) &&
          o.t < a.t + P.lGap && noteEnd(o) > a.t - P.lGap);
        if (free) {
          a.type = 'wide';
          a.lane2 = Math.max(a.lane, nb);
          a.lane = Math.min(a.lane, nb);
        }
      }
      notes = notes.filter(n => !n.cut);
    }

    // 9) Notes fantômes : des taps qui s'effacent à l'approche
    if (ghostP > 0) {
      for (const n of notes) {
        if (n.type === 'tap' && n.lane >= 0 && n.lane <= 3 && n.t > 8 && rng() < ghostP) n.ghost = true;
      }
    }

    // 10) Lanes bonus (refrains) : max 1 par côté, fermeture garantie
    const laneWindows = [];
    const choruses = composed.sections.filter(s => s.name === 'chorus');
    let side = rng() < 0.5 ? 0 : 1;
    choruses.forEach((sec, i) => {
      if (d <= 3 && i % 2 === 1) return;
      const open = sec.start * spb;
      const close = sec.end * spb;
      const sides = [side];
      if (d >= 5 && i === choruses.length - 1) sides.push(1 - side);
      for (const sd of sides) {
        const xLane = sd === 0 ? -1 : 4;
        laneWindows.push({ lane: xLane, open, close });

        const mLane = sd === 0 ? 0 : 3;
        for (const n of notes) {
          if (occupies(n, mLane) && n.t < open + 0.32 && noteEnd(n) > open - 0.32) n.cut = true;
          else if (d <= 2 && Math.abs(n.t - open) < 0.2) n.cut = true;
        }
        notes.push({ t: open, lane: mLane, type: 'exp', dir: sd === 0 ? -1 : 1, inst: 'exp', dur: 0 });

        const from = open + Math.max(2.2 * spb, 1.0);
        const to = close - Math.max(1.2 * spb, 0.6);
        let last = -9;
        for (const e of composed.events) {
          if (!['lead', 'pluck', 'bell', 'piano', 'brass', 'zap', 'ost', 'arp', 'kick'].includes(e.inst)) continue;
          if (e.noChart) continue;
          const te = e.t * spb;
          if (te < from || te > to) continue;
          if (te - last < P.xGap) continue;
          if (rng() > 0.55) continue;
          if (d <= 2 && notes.some(n => !n.cut && n.lane >= 0 && n.lane <= 3 && Math.abs(n.t - te) < 0.13)) continue;
          last = te;
          notes.push({ t: te, lane: xLane, type: 'tap', inst: 'x', dur: 0 });
        }
      }
      side = 1 - side;
    });
    notes = notes.filter(n => !n.cut);

    // 10 bis) Garanties de mods : les exemplaires placés plus haut ont pu être
    //     coupés par l'ouverture des lanes bonus (qui nettoie les lanes 0/3).
    //     On replace donc sur les lanes centrales 1-2, jamais coupées.
    if (mods.includes('roll') && !notes.some(n => n.type === 'roll')) {
      for (let si = 0; si < composed.sections.length; si++) {
        const sec = composed.sections[si];
        const next = composed.sections[si + 1];
        if (sec.name !== 'chorus' && !(next && next.name === 'chorus')) continue;
        const z0 = (sec.end - 2) * spb;
        const z1 = sec.end * spb - Math.max(0.35 * spb, 0.3);
        if (notes.some(n => n.type === 'exp' && n.t > z0 - 0.3 && n.t < z1 + 0.3)) continue;
        const lane = 1 + Math.floor(rng() * 2);
        for (const n of notes) {
          const overlap = n.t < z1 + 0.25 && noteEnd(n) > z0 - 0.25;
          if (overlap && (occupies(n, lane) || d <= 4) && n.type !== 'exp') n.cut = true;
        }
        const need = Util.clamp(Math.round((z1 - z0) * (4.5 + d * 0.8)), 3, 14);
        notes.push({ t: z0, t2: z1, lane, type: 'roll', need, inst: 'roll', dur: 0 });
        notes = notes.filter(n => !n.cut);
        break;
      }
    }
    if (mods.includes('wide') && !notes.some(n => n.type === 'wide')) {
      const inRoll = tt => notes.some(r => r.type === 'roll' &&
        (r.lane === 1 || r.lane === 2) && tt > r.t - 0.25 && tt < r.t2 + 0.25);
      for (const a of notes) {
        if (a.type !== 'tap' || a.ghost || a.t < 4) continue;
        if (a.lane !== 1 && a.lane !== 2) continue;
        const nb = a.lane === 1 ? 2 : 1;
        if (inRoll(a.t)) continue;
        const free = !notes.some(o => o !== a && occupies(o, nb) &&
          o.t < a.t + P.lGap && noteEnd(o) > a.t - P.lGap);
        if (free) {
          a.type = 'wide';
          a.lane2 = Math.max(a.lane, nb);
          a.lane = Math.min(a.lane, nb);
          break;
        }
      }
    }

    // 11) Bombes : dans les espaces libres
    if (P.bombEvery > 0) {
      const target = Math.floor(composed.durationSec / P.bombEvery);
      const totalBeats = composed.sections[composed.sections.length - 1].end;
      const margin = d >= 5 ? 0.35 : 0.5;
      let placed = 0, lastBomb = -9;
      for (let half = 0; half < totalBeats * 2 && placed < target; half++) {
        const t = half * 0.5 * spb;
        if (t < 4 || t > composed.durationSec - 2.5) continue;
        if (t - lastBomb < 3.5) continue;
        if (rng() > 0.4) continue;
        if (notes.some(n => Math.abs(n.t - t) < 0.13 || (n.t2 && Math.abs(n.t2 - t) < 0.13))) continue;
        const order = [0, 1, 2, 3].sort(() => rng() - 0.5);
        let lane = -1;
        for (const L of order) {
          const conflict = notes.some(n => occupies(n, L) && t > n.t - margin && t < noteEnd(n) + margin);
          if (!conflict) { lane = L; break; }
        }
        if (lane < 0) continue;
        notes.push({ t, lane, type: 'bomb', inst: 'bomb', dur: 0 });
        lastBomb = t;
        placed++;
      }
    }

    notes.sort((a, b) => a.t - b.t || a.lane - b.lane);
    return { notes, laneWindows };
  }

  /* ---------- Tutoriel : fond musical long (le déroulé est interactif,
     piloté par TutorialScript dans game.js — il attend les réussites
     du joueur, donc pas de durée prédéfinie) ---------- */

  function tutorialBacking() {
    const bpm = 90, spb = 60 / bpm;
    const root = 45, scale = SCALES.minor;
    const prog = [0, 5, 3, 4];
    const BARS = 600; // ~26 min : largement assez, planifié paresseusement
    const ev = [];

    for (let bar = 0; bar < BARS; bar++) {
      const deg = prog[bar % 4];
      const chordMidis = [deg, deg + 2, deg + 4].map(i => scalePitch(root + 12, i, scale));
      ev.push({ t: bar * 4, inst: 'pad', midi: chordMidis, dur: 4, vel: 0.12 });
      ev.push({ t: bar * 4, inst: 'bass', midi: scalePitch(root - 12, deg, scale), dur: 3.6, vel: 0.6 });
      for (const q of [0, 8]) ev.push({ t: bar * 4 + q / 4, inst: 'kick', vel: 0.85 });
      for (let q = 0; q < 16; q += 2) ev.push({ t: bar * 4 + q / 4, inst: 'hat', vel: 0.22 });
      if (bar % 2 === 1) {
        ev.push({ t: bar * 4 + 2, inst: 'lead', midi: scalePitch(root + 24, deg + 2, scale), dur: 1.2, vel: 0.45, wave: 'sawtooth' });
      }
    }
    ev.sort((a, b) => a.t - b.t);
    return { events: ev, spb, durationSec: BARS * 4 * spb + 1.5 };
  }

  /* ---------- Thème du menu : boucle chill de 16 mesures ---------- */

  function menuMusic() {
    const bpm = 96, spb = 60 / bpm;
    const root = 45, scale = SCALES.dorian;
    const prog = [0, 5, 3, 4];
    const BARS = 16;
    const rng = Util.mulberry32(Util.hashStr('menu-theme'));
    const ev = [];
    let mel = 7;

    for (let bar = 0; bar < BARS; bar++) {
      const deg = prog[bar % 4];
      const chordIdx = [deg, deg + 2, deg + 4];
      const chordMidis = chordIdx.map(i => scalePitch(root + 12, i, scale));
      const B = bar * 4;

      ev.push({ t: B, inst: 'pad', midi: chordMidis, dur: 4, vel: 0.13 });
      ev.push({ t: B, inst: 'sub', midi: scalePitch(root - 12, deg, scale), dur: 2.8, vel: 0.5 });
      // batterie feutrée, feel halftime
      ev.push({ t: B, inst: 'kick', vel: 0.55 });
      ev.push({ t: B + 2.5, inst: 'kick', vel: 0.4 });
      ev.push({ t: B + 2, inst: 'snare', vel: 0.32 });
      for (let q = 0; q < 16; q += 2) {
        ev.push({ t: B + q / 4 + (q % 4 === 2 ? 0.11 : 0), inst: 'hat', vel: q % 4 ? 0.13 : 0.08 });
      }
      // cloches : petites phrases sur les notes de l'accord, une mesure sur deux
      if (bar % 2 === 1) {
        for (const q of [0, 6, 10]) {
          mel = Util.clamp(mel + Util.pick(rng, [-2, -1, 1, 1, 2]), 2, 12);
          let best = chordIdx[0], bd = 99;
          for (const c of chordIdx.concat(chordIdx.map(x => x + 7))) {
            const d = Math.abs(c - mel);
            if (d < bd) { bd = d; best = c; }
          }
          ev.push({ t: B + q / 4, inst: 'bell', midi: scalePitch(root + 24, q === 0 ? best : mel, scale), dur: 1.1, vel: 0.3 });
        }
      }
      // arpège pincé discret dans la seconde moitié de la boucle
      if (bar >= 8) {
        for (const q of [2, 8, 14]) {
          const idx = chordIdx[(q / 2) % 3 | 0] + 7;
          ev.push({ t: B + q / 4, inst: 'pluck', midi: scalePitch(root + 24, idx, scale), dur: 0.3, vel: 0.22 });
        }
      }
    }
    ev.sort((a, b) => a.t - b.t);
    return { events: ev, spb, loopBeats: BARS * 4 };
  }

  return { compose, buildChart, tutorialBacking, menuMusic };
})();
