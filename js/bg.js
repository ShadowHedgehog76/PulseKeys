'use strict';

/*
 * Arrière-plans procéduraux animés, dessinés sur canvas.
 * Chaque morceau a son thème (champ `bg` du morceau) ; le menu réutilise
 * le même rendu pour afficher le fond du morceau sélectionné.
 *
 * BG.draw(g, name, { W, H, hue, t, pulse })
 *  - t     : temps en secondes (horloge murale, toujours croissante)
 *  - pulse : 0..1, retombée à chaque battement (synchronise les fonds au tempo)
 * L'appelant remplit le fond de base (#06070d) avant l'appel.
 */

const BG = (() => {
  const R = Util.mulberry32(20260612);
  const stars = Array.from({ length: 110 }, () => ({
    x: R(), y: R() * 0.9, r: 0.5 + R() * 1.7, p: R() * 6.28,
  }));
  const orbs = Array.from({ length: 22 }, () => ({
    x: R(), y: R(), r: 26 + R() * 80, sp: 0.5 + R(), p: R() * 6.28, ho: (R() - 0.5) * 70,
  }));
  const drops = Array.from({ length: 80 }, () => ({
    x: R(), sp: 0.35 + R() * 0.9, len: 0.05 + R() * 0.11, p: R(), ho: (R() - 0.5) * 50,
  }));
  const towers = Array.from({ length: 36 }, () => ({
    w: 0.018 + R() * 0.045, h: 0.07 + R() * 0.28,
  }));
  const spokes = Array.from({ length: 12 }, (_, i) => ({
    a: (i / 12) * 6.2832, sp: 0.08 + R() * 0.2, alt: i % 2,
  }));

  const P = {
    stars(g, o) {
      g.fillStyle = '#cfd8ff';
      for (const s of stars) {
        const tw = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(o.t * 1.1 + s.p));
        g.globalAlpha = 0.5 * tw;
        g.beginPath();
        g.arc(s.x * o.W, s.y * o.H, s.r, 0, 7);
        g.fill();
      }
      g.globalAlpha = 1;
    },

    city(g, o) {
      const { W, H, hue } = o;
      // étoiles clairsemées au-dessus de la ville
      g.fillStyle = '#cfd8ff';
      for (let i = 0; i < stars.length; i += 2) {
        const s = stars[i];
        if (s.y > 0.55) continue;
        g.globalAlpha = 0.35 * (0.5 + 0.5 * Math.sin(o.t + s.p));
        g.beginPath(); g.arc(s.x * W, s.y * H, s.r, 0, 7); g.fill();
      }
      g.globalAlpha = 1;
      // soleil rétro strié
      const cx = W * 0.68, cy = H * 0.55, r = H * (0.2 + 0.012 * o.pulse);
      const sg = g.createLinearGradient(0, cy - r, 0, cy + r);
      sg.addColorStop(0, `hsla(${hue}, 95%, 65%, 0.5)`);
      sg.addColorStop(1, `hsla(${(hue + 45) % 360}, 95%, 55%, 0.45)`);
      g.fillStyle = sg;
      g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill();
      g.fillStyle = '#06070d';
      for (let k = 0; k < 6; k++) {
        const yy = cy + r * (0.05 + k * 0.16);
        g.fillRect(cx - r - 4, yy, 2 * r + 8, 2.5 + k * 1.6);
      }
      // silhouette de la ville
      const base = H * 0.78;
      g.fillStyle = 'rgba(8, 10, 20, 0.96)';
      g.fillRect(0, base, W, H - base);
      let x = -0.02;
      for (const tw of towers) {
        const bw = tw.w * W, bh = tw.h * H;
        g.fillRect(x * W, base - bh, bw + 1, bh);
        x += tw.w;
        if (x > 1.02) break;
      }
      // ligne d'horizon lumineuse
      g.strokeStyle = `hsla(${hue}, 90%, 60%, ${0.25 + 0.3 * o.pulse})`;
      g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(0, base); g.lineTo(W, base); g.stroke();
    },

    tunnel(g, o) {
      const { W, H, hue } = o;
      const cx = W / 2, cy = H * 0.42;
      const maxR = Math.hypot(W, H) * 0.6;
      for (let k = 0; k < 12; k++) {
        const ph = (o.t * 0.16 + k / 12) % 1;
        const r = Math.pow(ph, 2.2) * maxR;
        g.strokeStyle = `hsla(${(hue + ph * 50) % 360}, 90%, 60%, ${(1 - ph) * (0.18 + 0.25 * o.pulse)})`;
        g.lineWidth = 1.5 + ph * 4;
        g.beginPath(); g.arc(cx, cy, r, 0, 7); g.stroke();
      }
      // rails de fuite
      g.strokeStyle = `hsla(${hue}, 80%, 60%, 0.12)`;
      g.lineWidth = 1;
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        g.beginPath();
        g.moveTo(cx, cy);
        g.lineTo(cx + dx * W, cy + dy * H);
        g.stroke();
      }
    },

    hex(g, o) {
      const { W, H, hue } = o;
      const s = 56, dx = s * 1.5, dy = s * 0.866;
      g.lineWidth = 1.2;
      for (let j = -1; j * dy < H + s; j++) {
        for (let i = -1; i * dx < W + s; i++) {
          const cx = i * dx + (j % 2 ? dx / 2 : 0);
          const cy = j * dy;
          const a = 0.04 + 0.1 * (0.5 + 0.5 * Math.sin(o.t * 1.6 + i * 0.7 + j * 1.3)) * (0.5 + o.pulse);
          g.strokeStyle = `hsla(${(hue + i * 4 + j * 3) % 360}, 85%, 60%, ${a})`;
          g.beginPath();
          for (let k = 0; k < 6; k++) {
            const an = (k / 6) * 6.2832;
            const px = cx + Math.cos(an) * s * 0.55, py = cy + Math.sin(an) * s * 0.55;
            if (k === 0) g.moveTo(px, py); else g.lineTo(px, py);
          }
          g.closePath();
          g.stroke();
        }
      }
    },

    rain(g, o) {
      const { W, H, hue } = o;
      g.lineWidth = 2;
      g.lineCap = 'round';
      for (const d of drops) {
        const y = (((d.p + o.t * d.sp) % 1.15) + 1.15) % 1.15 - 0.075;
        const x = d.x * W;
        g.strokeStyle = `hsla(${(hue + d.ho + 360) % 360}, 90%, 65%, ${0.18 * (0.6 + 0.5 * o.pulse)})`;
        g.beginPath();
        g.moveTo(x, y * H);
        g.lineTo(x, y * H - d.len * H);
        g.stroke();
      }
    },

    waves(g, o) {
      const { W, H, hue } = o;
      g.lineWidth = 2;
      for (let k = 0; k < 5; k++) {
        const yBase = H * (0.24 + k * 0.13);
        const amp = (12 + k * 8) * (0.6 + 0.8 * o.pulse);
        g.strokeStyle = `hsla(${(hue + k * 14) % 360}, 90%, 62%, ${k === 2 ? 0.26 : 0.15})`;
        g.beginPath();
        for (let x = 0; x <= W; x += 14) {
          const y = yBase + Math.sin(x * 0.012 + o.t * (0.8 + k * 0.3) + k * 2) * amp;
          if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.stroke();
      }
    },

    orbs(g, o) {
      const { W, H, hue } = o;
      for (const b of orbs) {
        const x = (b.x + Math.sin(o.t * 0.08 * b.sp + b.p) * 0.05) * W;
        const y = (b.y + Math.cos(o.t * 0.06 * b.sp + b.p * 2) * 0.05) * H;
        const a = 0.05 + 0.05 * o.pulse + 0.03 * Math.sin(o.t * 0.5 + b.p);
        g.fillStyle = `hsla(${(hue + b.ho + 360) % 360}, 85%, 62%, ${a})`;
        g.beginPath(); g.arc(x, y, b.r, 0, 7); g.fill();
        g.fillStyle = `hsla(${(hue + b.ho + 360) % 360}, 90%, 72%, ${a * 1.6})`;
        g.beginPath(); g.arc(x, y, b.r * 0.4, 0, 7); g.fill();
      }
    },

    vortex(g, o) {
      const { W, H, hue } = o;
      const cx = W / 2, cy = H * 0.45;
      const rad = Math.hypot(W, H) * 0.75;
      g.save();
      g.translate(cx, cy);
      for (const s of spokes) {
        const a = s.a + o.t * s.sp * (s.alt ? 1 : -1);
        const wd = 0.12 + 0.06 * o.pulse;
        g.fillStyle = `hsla(${(hue + (s.alt ? 25 : 0)) % 360}, 85%, 58%, ${0.045 + 0.04 * o.pulse})`;
        g.beginPath();
        g.moveTo(0, 0);
        g.arc(0, 0, rad, a - wd, a + wd);
        g.closePath();
        g.fill();
      }
      g.restore();
      // anneaux de pulsation
      for (let k = 0; k < 3; k++) {
        const ph = (o.t * 0.3 + k / 3) % 1;
        g.strokeStyle = `hsla(${hue}, 90%, 65%, ${(1 - ph) * 0.2})`;
        g.lineWidth = 2;
        g.beginPath(); g.arc(cx, cy, 40 + ph * H * 0.55, 0, 7); g.stroke();
      }
    },
  };

  function draw(g, name, o) {
    g.save();
    (P[name] || P.stars)(g, o);
    g.restore();
  }

  return { draw };
})();
