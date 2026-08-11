import React, { useEffect, useRef } from 'react';

// Decorative seasonal effects layer. ONE <canvas> (not hundreds of React
// nodes), animated with requestAnimationFrame, that renders behind dialogs and
// never blocks interaction (pointer-events:none). Driven purely by the active
// event's `preset` + `intensity`; only mounted when the event is date-active.
//
// Guarantees (see the theme spec):
//  • position:fixed; inset:0; aria-hidden; pointer-events:none; no layout shift
//  • ~20–32 particles desktop, ~8–14 mobile, scaled by intensity
//  • pauses on document.hidden, honours prefers-reduced-motion (static glow only)
//  • lazy-inits after first paint; cleans up fully on unmount / preset change
//  • no horizontal overflow (canvas is width:100%, clipped by pointer-events)
//
// Each preset is a compact config: which particle KINDS fall/drift/rise, their
// colours, a base count, an optional short entry BURST (New Year / Lunar) and an
// optional atmospheric SPECIAL layer (fog+bats, lanterns, steam, dawn glow).

// eslint-disable-next-line no-unused-vars
const TAU = Math.PI * 2;

const PRESETS = {
  christmas: {
    count: 28, dir: 'down',
    kinds: [
      { kind: 'flake', color: '#FFFFFF', share: 0.78, size: [2, 5] },
      { kind: 'star', color: '#F1D36C', share: 0.22, size: [3, 6] },
    ],
    glow: 'rgba(11,56,43,.30)',
  },
  newyear: {
    count: 22, dir: 'down',
    kinds: [
      { kind: 'star', color: '#FFF0A3', share: 0.6, size: [2, 5] },
      { kind: 'confetti', colors: ['#F2D66C', '#FFF0A3', '#B88A20'], share: 0.4, size: [4, 8] },
    ],
    burst: { kind: 'confetti', colors: ['#F2D66C', '#FFF0A3', '#B88A20', '#FFFFFF'], count: 46, ms: 2600 },
    glow: 'rgba(209,168,59,.16)',
  },
  australiaday: {
    count: 22, dir: 'diag',
    kinds: [
      { kind: 'leaf', colors: ['#7BA05B', '#5C8A4B', '#9DBE6E'], share: 0.6, size: [6, 12] },
      { kind: 'dot', color: '#E2C14A', share: 0.4, size: [2, 4] },
    ],
    glow: 'rgba(226,193,74,.14)',
  },
  lunarnewyear: {
    count: 20, dir: 'up',
    kinds: [
      { kind: 'ember', color: '#F0BE43', share: 0.55, size: [2, 4] },
      { kind: 'dot', color: '#FFD86B', share: 0.45, size: [2, 3] },
    ],
    burst: { kind: 'confetti', colors: ['#C91E28', '#F0BE43', '#FFD86B'], count: 34, ms: 2600 },
    special: 'lanterns',
    glow: 'rgba(240,100,42,.18)',
  },
  valentines: {
    count: 20, dir: 'diag',
    kinds: [
      { kind: 'petal', colors: ['#F1A8C1', '#E76591', '#FFD2DF'], share: 0.72, size: [6, 12] },
      { kind: 'heart', color: '#F47BA8', share: 0.28, size: [7, 13] },
    ],
    glow: 'rgba(244,123,168,.16)',
  },
  stpatricks: {
    count: 22, dir: 'down',
    kinds: [
      { kind: 'clover', colors: ['#20A05A', '#16864A'], share: 0.66, size: [6, 11] },
      { kind: 'dot', color: '#DFC248', share: 0.34, size: [2, 4] },
    ],
    glow: 'rgba(105,190,80,.14)',
  },
  easter: {
    count: 22, dir: 'down',
    kinds: [
      { kind: 'dot', colors: ['#E8AFC8', '#F2CE72', '#9679C5', '#B7A5D6'], share: 0.6, size: [3, 6] },
      { kind: 'petal', colors: ['#E8AFC8', '#F2CE72'], share: 0.4, size: [6, 11] },
    ],
    special: 'sunrise',
    glow: 'rgba(232,175,200,.18)',
  },
  anzac: {
    count: 5, dir: 'down',
    kinds: [
      { kind: 'mote', color: '#B59A63', share: 0.7, size: [2, 3] },
      { kind: 'poppy', color: '#8D3D39', share: 0.3, size: [7, 12] },
    ],
    special: 'dawn',
    glow: 'rgba(155,113,69,.14)',
  },
  mothersday: {
    count: 20, dir: 'diag',
    kinds: [
      { kind: 'petal', colors: ['#E8B1A3', '#DC5E89', '#F5D0BE'], share: 1, size: [6, 12] },
    ],
    special: 'bloom',
    glow: 'rgba(230,154,177,.16)',
  },
  floriade: {
    count: 22, dir: 'diag',
    kinds: [
      { kind: 'petal', colors: ['#D9583E', '#F0C253', '#EB6B4E', '#E18A5B', '#C7532F'], share: 1, size: [7, 13] },
    ],
    special: 'shimmer',
    glow: 'rgba(231,102,72,.16)',
  },
  fathersday: {
    count: 14, dir: 'up',
    kinds: [
      { kind: 'mote', color: '#EDB958', share: 1, size: [2, 4] },
    ],
    special: 'steam',
    glow: 'rgba(201,133,50,.16)',
  },
  halloween: {
    count: 18, dir: 'up',
    kinds: [
      { kind: 'ember', color: '#FF731A', share: 1, size: [2, 4] },
    ],
    special: 'fogbats',
    glow: 'rgba(233,95,19,.20)',
  },
};

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

// Density multipliers per intensity, and count clamps per environment.
const INTENSITY = { subtle: 0.72, standard: 1, celebratory: 1.15 };

function makeParticle(cfg, W, H, seedTop) {
  // Weighted kind selection.
  let r = Math.random(), k = cfg.kinds[0];
  for (const kd of cfg.kinds) { if (r < kd.share) { k = kd; break; } r -= kd.share; }
  const color = k.color || pick(k.colors);
  const size = rand(k.size[0], k.size[1]);
  const up = cfg.dir === 'up';
  // Start spread across the viewport on first fill (seedTop) so nothing "rains
  // in" from one edge; afterwards respawn just off the leading edge.
  const y = seedTop ? rand(0, H) : (up ? H + size : -size - rand(0, H * 0.4));
  const speed = rand(0.25, 0.75) * (up ? -1 : 1) * (size < 4 ? 1.3 : 1);
  const driftBase = cfg.dir === 'diag' ? rand(0.35, 0.9) : rand(-0.25, 0.25);
  return {
    kind: k.kind, color, size,
    x: rand(0, W), y,
    vy: speed * 22, vx: driftBase * 22,
    sway: rand(0.4, 1.1), swayAmp: rand(6, 18), phase: rand(0, TAU),
    rot: rand(0, TAU), vrot: rand(-1, 1) * 1.4,
    op: rand(0.45, 0.92),
    flick: rand(0.6, 1.4),
  };
}

function drawParticle(ctx, p, t) {
  const x = p.x + Math.sin(t * p.sway + p.phase) * p.swayAmp;
  ctx.save();
  ctx.translate(x, p.y);
  ctx.globalAlpha = p.op;
  switch (p.kind) {
    case 'flake': {
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color; ctx.shadowBlur = p.size * 1.6;
      ctx.beginPath(); ctx.arc(0, 0, p.size, 0, TAU); ctx.fill();
      break;
    }
    case 'dot': case 'mote': {
      ctx.fillStyle = p.color;
      if (p.kind === 'mote') { ctx.globalAlpha = p.op * 0.5; }
      ctx.beginPath(); ctx.arc(0, 0, p.size, 0, TAU); ctx.fill();
      break;
    }
    case 'ember': {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = p.op * (0.6 + 0.4 * Math.sin(t * p.flick * 3 + p.phase));
      ctx.fillStyle = p.color; ctx.shadowColor = p.color; ctx.shadowBlur = p.size * 3;
      ctx.beginPath(); ctx.arc(0, 0, p.size, 0, TAU); ctx.fill();
      break;
    }
    case 'star': {
      ctx.strokeStyle = p.color; ctx.lineWidth = Math.max(1, p.size / 3);
      ctx.shadowColor = p.color; ctx.shadowBlur = p.size;
      const s = p.size;
      ctx.beginPath();
      ctx.moveTo(-s, 0); ctx.lineTo(s, 0); ctx.moveTo(0, -s); ctx.lineTo(0, s);
      ctx.stroke();
      break;
    }
    case 'confetti': {
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      break;
    }
    case 'leaf': {
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.ellipse(0, 0, p.size, p.size / 2.6, 0, 0, TAU); ctx.fill();
      break;
    }
    case 'petal': {
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      const s = p.size;
      ctx.beginPath();
      ctx.moveTo(0, -s);
      ctx.quadraticCurveTo(s * 0.7, -s * 0.2, 0, s);
      ctx.quadraticCurveTo(-s * 0.7, -s * 0.2, 0, -s);
      ctx.fill();
      break;
    }
    case 'poppy': {
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      for (let i = 0; i < 4; i++) {
        ctx.rotate(TAU / 4);
        ctx.beginPath(); ctx.ellipse(0, -p.size * 0.5, p.size * 0.5, p.size * 0.7, 0, 0, TAU); ctx.fill();
      }
      ctx.fillStyle = '#2A1410';
      ctx.beginPath(); ctx.arc(0, 0, p.size * 0.22, 0, TAU); ctx.fill();
      break;
    }
    case 'heart': {
      ctx.globalAlpha = p.op * 0.4;
      ctx.fillStyle = p.color; ctx.shadowColor = p.color; ctx.shadowBlur = p.size * 2;
      const s = p.size * 0.5;
      ctx.beginPath();
      ctx.moveTo(0, s * 0.6);
      ctx.bezierCurveTo(s, -s * 0.5, s * 1.6, s * 0.6, 0, s * 1.6);
      ctx.bezierCurveTo(-s * 1.6, s * 0.6, -s, -s * 0.5, 0, s * 0.6);
      ctx.fill();
      break;
    }
    case 'clover': {
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      const r = p.size * 0.38;
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * TAU - Math.PI / 2;
        ctx.beginPath(); ctx.arc(Math.cos(a) * r, Math.sin(a) * r, r, 0, TAU); ctx.fill();
      }
      break;
    }
    default: {
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(0, 0, p.size, 0, TAU); ctx.fill();
    }
  }
  ctx.restore();
}

export default function SeasonalEffects({ preset, active = true, intensity = 'standard', reducedMotion = false }) {
  const canvasRef = useRef(null);
  const cfg = preset && PRESETS[preset];

  useEffect(() => {
    if (!active || !cfg || reducedMotion) return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return undefined;

    // Environment: mobile density + low-power/save-data → fewer particles, no
    // heavy atmospheric layers.
    const mql = window.matchMedia('(max-width:767px)');
    const conn = navigator.connection || {};
    let raf = 0, running = false, started = false;
    let W = 0, H = 0, dpr = 1;
    let particles = [], burst = [], special = null;
    let startT = 0, lastT = 0;

    const env = () => {
      const mobile = mql.matches;
      const lowPower = !!conn.saveData || (navigator.deviceMemory && navigator.deviceMemory <= 3);
      const mult = (INTENSITY[intensity] || 1) * (mobile ? 0.45 : 1) * (lowPower ? 0.6 : 1);
      let n = Math.round(cfg.count * mult);
      n = Math.max(mobile ? 6 : 8, Math.min(mobile ? 14 : 32, n));
      return { mobile, lowPower, n };
    };

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = window.innerWidth; H = window.innerHeight;
      canvas.width = Math.floor(W * dpr); canvas.height = Math.floor(H * dpr);
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const initSpecial = (e) => {
      if (!cfg.special || e.lowPower) return null;
      if (cfg.special === 'lanterns') {
        return { type: 'lanterns', items: Array.from({ length: e.mobile ? 2 : 3 }, () => ({ x: rand(0.1, 0.9) * W, y: rand(0.15, 0.6) * H, r: rand(30, 60), ph: rand(0, TAU), c: '#F0642A' })) };
      }
      if (cfg.special === 'fogbats') {
        return {
          type: 'fogbats',
          fog: Array.from({ length: e.mobile ? 2 : 3 }, (_, i) => ({ x: rand(0, W), y: rand(0.2, 0.8) * H, r: rand(160, 300), v: rand(4, 9) * (i % 2 ? 1 : -1) })),
          bats: Array.from({ length: 2 }, () => ({ x: rand(0, W), y: rand(0.15, 0.55) * H, v: rand(40, 70) * (Math.random() < 0.5 ? 1 : -1), s: rand(10, 16), ph: rand(0, TAU), wait: rand(0, 6) })),
        };
      }
      if (cfg.special === 'steam') {
        return { type: 'steam', cols: Array.from({ length: e.mobile ? 2 : 4 }, () => ({ x: rand(0.1, 0.9) * W, ph: rand(0, TAU), w: rand(18, 34) })) };
      }
      return { type: cfg.special }; // sunrise / dawn / bloom / shimmer = drawn glow
    };

    const fill = () => {
      const e = env();
      particles = Array.from({ length: e.n }, () => makeParticle(cfg, W, H, true));
      special = initSpecial(e);
      if (cfg.burst) {
        const bn = Math.round(cfg.burst.count * (e.mobile ? 0.5 : 1));
        burst = Array.from({ length: bn }, () => {
          const pp = makeParticle({ ...cfg, dir: 'down', kinds: [{ kind: cfg.burst.kind, colors: cfg.burst.colors, share: 1, size: [4, 9] }] }, W, H, false);
          pp.y = rand(-H * 0.3, 0); pp.vy = rand(60, 140); pp.vx = rand(-40, 40);
          return pp;
        });
      }
    };

    const drawSpecialBack = (t) => {
      if (!special) return;
      if (special.type === 'sunrise' || special.type === 'bloom' || special.type === 'shimmer') {
        const g = ctx.createRadialGradient(W / 2, H, H * 0.1, W / 2, H, H * 0.9);
        g.addColorStop(0, cfg.glow); g.addColorStop(1, 'transparent');
        ctx.save(); ctx.globalAlpha = special.type === 'shimmer' ? 0.5 + 0.2 * Math.sin(t) : 0.7; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore();
      } else if (special.type === 'dawn') {
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, 'transparent'); g.addColorStop(1, cfg.glow);
        ctx.save(); ctx.globalAlpha = 0.6; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore();
      } else if (special.type === 'lanterns') {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        for (const l of special.items) {
          const yy = l.y + Math.sin(t * 0.5 + l.ph) * 10;
          const g = ctx.createRadialGradient(l.x, yy, 0, l.x, yy, l.r);
          g.addColorStop(0, 'rgba(255,180,90,.5)'); g.addColorStop(1, 'transparent');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(l.x, yy, l.r, 0, TAU); ctx.fill();
        }
        ctx.restore();
      } else if (special.type === 'fogbats') {
        ctx.save();
        for (const f of special.fog) {
          f.x += f.v * 0.016; if (f.x < -f.r) f.x = W + f.r; if (f.x > W + f.r) f.x = -f.r;
          const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r);
          g.addColorStop(0, 'rgba(120,90,150,.10)'); g.addColorStop(1, 'transparent');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, TAU); ctx.fill();
        }
        ctx.restore();
      } else if (special.type === 'steam') {
        ctx.save(); ctx.globalAlpha = 0.10; ctx.strokeStyle = '#FDFBF5'; ctx.lineWidth = 2;
        for (const c of special.cols) {
          ctx.beginPath();
          for (let yy = H; yy > H * 0.4; yy -= 8) {
            const off = Math.sin((yy / 40) + t + c.ph) * c.w;
            const xx = c.x + off;
            if (yy === H) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
          }
          ctx.stroke();
        }
        ctx.restore();
      }
    };

    const drawBats = (t, dt) => {
      if (!special || special.type !== 'fogbats') return;
      ctx.save(); ctx.fillStyle = 'rgba(10,4,16,.85)';
      for (const b of special.bats) {
        if (b.wait > 0) { b.wait -= dt; continue; }
        b.x += b.v * dt;
        if (b.x < -30) b.x = W + 30; if (b.x > W + 30) b.x = -30;
        const flap = Math.sin(t * 8 + b.ph) * 0.5;
        const s = b.s, y = b.y + Math.sin(t + b.ph) * 6, dir = Math.sign(b.v) || 1;
        ctx.save(); ctx.translate(b.x, y); ctx.scale(dir, 1);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(-s, -s * (0.4 + flap), -s * 1.8, -s * 0.1);
        ctx.quadraticCurveTo(-s, s * 0.2, 0, s * 0.3);
        ctx.quadraticCurveTo(s, s * 0.2, s * 1.8, -s * 0.1);
        ctx.quadraticCurveTo(s, -s * (0.4 + flap), 0, 0);
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    };

    const step = (now) => {
      if (!running) return;
      const t = (now - startT) / 1000;
      const dt = Math.min(0.05, (now - lastT) / 1000 || 0.016);
      lastT = now;
      ctx.clearRect(0, 0, W, H);

      drawSpecialBack(t);

      const cull = [];
      const all = burst.length ? particles.concat(burst) : particles;
      for (const p of all) {
        p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vrot * dt;
        const off = p.vy < 0 ? p.y < -p.size - 4 : p.y > H + p.size + 4;
        if (p.x < -40) p.x = W + 40; if (p.x > W + 40) p.x = -40;
        if (off) {
          if (p.isBurst) { cull.push(p); continue; }
          // Respawn from the leading edge.
          p.y = p.vy < 0 ? H + p.size : -p.size;
          p.x = rand(0, W);
        }
        drawParticle(ctx, p, t);
      }
      // Expire the entry burst after its window, then let it drain.
      if (burst.length && t * 1000 > cfg.burst.ms) burst = [];

      drawBats(t, dt);

      raf = requestAnimationFrame(step);
    };

    const start = () => {
      if (running) return;
      running = true; startT = performance.now(); lastT = startT;
      raf = requestAnimationFrame(step);
    };
    const stop = () => { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; };

    const onVis = () => {
      if (document.hidden) stop();
      else if (started) start();
    };
    const onResize = () => { resize(); fill(); };

    // Lazy-init after first paint so effects never delay LCP / first interaction.
    const boot = () => {
      started = true;
      resize(); fill();
      if (!document.hidden) start();
    };
    const idle = window.requestIdleCallback
      ? window.requestIdleCallback(boot, { timeout: 800 })
      : setTimeout(boot, 450);

    window.addEventListener('resize', onResize, { passive: true });
    document.addEventListener('visibilitychange', onVis);

    return () => {
      stop();
      if (window.cancelIdleCallback && typeof idle === 'number') window.cancelIdleCallback(idle);
      clearTimeout(idle);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVis);
      if (ctx) ctx.clearRect(0, 0, W, H);
      particles = []; burst = []; special = null;
    };
  }, [preset, active, intensity, reducedMotion, cfg]);

  if (!active || !cfg) return null;

  // Reduced motion: no particles, just a single static low-opacity glow (no
  // pulsing/flashing), so the palette still feels seasonal without animation.
  if (reducedMotion) {
    return (
      <div
        className="fx-glow"
        aria-hidden="true"
        style={{ background: `radial-gradient(circle at 50% 100%, ${cfg.glow}, transparent 70%)` }}
      />
    );
  }

  return <canvas ref={canvasRef} className="fx-canvas" aria-hidden="true" />;
}
