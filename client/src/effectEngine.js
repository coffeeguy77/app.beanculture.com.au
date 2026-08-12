// Reusable particle Effects Engine — the single pooled-particle renderer behind
// every built-in and admin-authored effect (snow, hearts, petals, sparkles,
// confetti, and anything created in the Effect Builder). One <canvas>, one
// requestAnimationFrame loop, SVG assets pre-rasterised to offscreen canvases
// and drawn with ctx.drawImage (never one DOM node per particle).
//
// This module is framework-agnostic; EffectOverlay.jsx is the thin React
// wrapper that owns the <canvas> element and calls runEffect()/cleanup().

import { svgForAsset } from './effectAssets.js';

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---- Defaults: any field an admin-authored (or older/partial) preset omits
// falls back to these, so the engine never crashes on incomplete data. ----
const DEFAULT_MOTION = {
  directionDegrees: 180, // 0 = up, 90 = right, 180 = down, 270 = left
  speedMin: 20, speedMax: 55,
  driftMin: -8, driftMax: 8,
  sway: 0.5,
  rotationMin: 0, rotationMax: 360,
  rotationSpeedMin: -20, rotationSpeedMax: 20,
  lifetimeMin: 6, lifetimeMax: 14,
};
const DEFAULT_EMISSION = {
  density: 1,
  spawnRate: 1,
  maxParticlesDesktop: 28,
  maxParticlesMobile: 12,
  spawnArea: 'top',
  burstOnLoad: false,
  burstCount: 0,
};
const DEFAULT_APPEARANCE = {
  sizeMin: 10, sizeMax: 22,
  opacityMin: 0.5, opacityMax: 0.9,
  colorMode: 'single',
  colors: ['#FFFFFF'],
  renderMode: 'fill',
  fillPercentage: 100, strokePercentage: 0, mixedPercentage: 0,
  strokeWidthMin: 1.5, strokeWidthMax: 2.5,
  glowEnabled: false,
  glowColorMode: 'inherit',
  glowColors: [],
  glowBlurMin: 3, glowBlurMax: 8,
  glowOpacity: 0.5,
  glowPercentage: 0,
};
const DEFAULT_RANDOMNESS = { amount: 0.5, assetRandomness: 1, colorRandomness: 1, sizeRandomness: 1, speedRandomness: 1, opacityRandomness: 1, rotationRandomness: 1 };
const DEFAULT_ACCESSIBILITY = { reducedMotionMode: 'static-glow' };

export function resolvePreset(preset) {
  const p = preset || {};
  return {
    id: p.id, name: p.name || 'Effect', renderer: p.renderer || 'canvas-particles',
    assets: (p.assets && p.assets.length ? p.assets : [{ assetId: 'soft-snow-dot', weight: 1 }]),
    motion: { ...DEFAULT_MOTION, ...(p.motion || {}) },
    emission: { ...DEFAULT_EMISSION, ...(p.emission || {}) },
    appearance: { ...DEFAULT_APPEARANCE, ...(p.appearance || {}) },
    randomness: { ...DEFAULT_RANDOMNESS, ...(p.randomness || {}) },
    accessibility: { ...DEFAULT_ACCESSIBILITY, ...(p.accessibility || {}) },
    glowColorHex: p.glowColorHex,
  };
}

function pickWeighted(assets) {
  const total = assets.reduce((s, a) => s + (a.weight || 1), 0) || 1;
  let r = Math.random() * total;
  for (const a of assets) { r -= (a.weight || 1); if (r <= 0) return a.assetId; }
  return assets[0].assetId;
}

function pickColor(appearance) {
  const { colorMode, colors } = appearance;
  if (colorMode === 'single') return colors[0] || '#FFFFFF';
  if (colorMode === 'palette') return colors.length ? colors[(Math.random() * colors.length) | 0] : '#FFFFFF';
  // 'random' — restrained hue-limited random (avoid neon by clamping saturation/lightness).
  const h = Math.random() * 360, s = 45 + Math.random() * 25, l = 55 + Math.random() * 25;
  return `hsl(${h.toFixed(0)},${s.toFixed(0)}%,${l.toFixed(0)}%)`;
}

function pickRenderMode(appearance) {
  const { renderMode, fillPercentage, strokePercentage, mixedPercentage } = appearance;
  if (renderMode !== 'random') return renderMode;
  const total = clamp(fillPercentage, 0, 100) + clamp(strokePercentage, 0, 100) + clamp(mixedPercentage, 0, 100) || 100;
  const r = Math.random() * total;
  if (r < fillPercentage) return 'fill';
  if (r < fillPercentage + strokePercentage) return 'stroke';
  return 'mixed';
}

// ---- Raster cache: pre-render each unique (asset, colour, mode) combo to an
// offscreen canvas ONCE, then drawImage() it per particle every frame. ----
const rasterCache = new Map();
function getRaster(assetId, color, mode, strokeWidth) {
  const key = `${assetId}|${mode}|${color}|${strokeWidth}`;
  const cached = rasterCache.get(key);
  if (cached) return cached; // { canvas, ready } — canvas may still be loading (ready=false)
  const entry = { canvas: null, ready: false };
  rasterCache.set(key, entry);
  const markup = svgForAsset(assetId, color, mode, strokeWidth);
  if (!markup) return entry;
  const img = new Image();
  img.onload = () => {
    const size = 96;
    const off = document.createElement('canvas');
    off.width = size; off.height = size;
    const c = off.getContext('2d');
    c.drawImage(img, 0, 0, size, size);
    entry.canvas = off; entry.ready = true;
  };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup);
  return entry;
}

function makeParticle(preset, W, H, seed) {
  const { motion, emission, appearance, randomness } = preset;
  const assetId = pickWeighted(preset.assets);
  const size = rand(appearance.sizeMin, appearance.sizeMax) * (0.4 + 0.6 * randomness.sizeRandomness) + appearance.sizeMin * (1 - randomness.sizeRandomness) * 0.4;
  const color = pickColor(appearance);
  const mode = pickRenderMode(appearance);
  const strokeWidth = rand(appearance.strokeWidthMin, appearance.strokeWidthMax);
  const dirRad = (motion.directionDegrees * Math.PI) / 180;
  const speed = rand(motion.speedMin, motion.speedMax) * (0.5 + 0.5 * randomness.speedRandomness);
  const vx = Math.sin(dirRad) * speed;
  const vy = -Math.cos(dirRad) * speed;
  const drift = rand(motion.driftMin, motion.driftMax);
  const glow = appearance.glowEnabled && Math.random() * 100 < appearance.glowPercentage;
  const glowColor = appearance.glowColorMode === 'single' && appearance.glowColors[0]
    ? appearance.glowColors[0]
    : appearance.glowColorMode === 'palette' && appearance.glowColors.length
      ? appearance.glowColors[(Math.random() * appearance.glowColors.length) | 0]
      : color;

  // Spawn position: 'top' respawns above the viewport (classic falling snow);
  // 'viewport' scatters across the whole canvas on first fill; 'edges' enters
  // from the leading side (used by horizontal-ish effects like bats).
  const area = emission.spawnArea;
  let x, y;
  if (seed && area === 'viewport') { x = rand(0, W); y = rand(0, H); }
  else if (area === 'edges') { x = vx >= 0 ? -size : W + size; y = rand(0, H); }
  else { x = rand(0, W); y = vy >= 0 ? -size - rand(0, H * 0.4) : H + size + rand(0, H * 0.4); if (seed) y = rand(0, H); }

  return {
    assetId, color, mode, strokeWidth, glow, glowColor, size,
    x, y, vx: vx + drift * 0.3, vy,
    driftAmp: Math.abs(drift), swayFreq: motion.sway * rand(0.7, 1.3), phase: rand(0, TAU),
    rot: (rand(motion.rotationMin, motion.rotationMax) * Math.PI) / 180,
    vrot: (rand(motion.rotationSpeedMin, motion.rotationSpeedMax) * Math.PI) / 180,
    op: rand(appearance.opacityMin, appearance.opacityMax),
    isBurst: false,
  };
}

// Density used to be scaled directly against maxParticlesDesktop/Mobile, which
// made it a no-op above density=1: base = max*density was then immediately
// clamped back down to max, so raising density from 1 to 3 (or 100, clamped
// to 3) never produced a single extra particle — max was quietly acting as
// BOTH the scaling reference and the ceiling. Fixed: density now scales a
// fixed reference baseline (independent of the ceiling), so admins get real,
// visible headroom between "1x" and the configured Desktop/Mobile max, which
// remains the one true hard ceiling.
const DENSITY_BASELINE_DESKTOP = 22;
const DENSITY_BASELINE_MOBILE = 9;
function envInfo(preset) {
  const mobile = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width:767px)').matches;
  const conn = (typeof navigator !== 'undefined' && navigator.connection) || {};
  const lowPower = !!conn.saveData || (typeof navigator !== 'undefined' && navigator.deviceMemory && navigator.deviceMemory <= 3);
  const max = mobile ? preset.emission.maxParticlesMobile : preset.emission.maxParticlesDesktop;
  const baseline = mobile ? DENSITY_BASELINE_MOBILE : DENSITY_BASELINE_DESKTOP;
  const base = Math.round(baseline * clamp(preset.emission.density, 0, 3));
  const n = clamp(base, mobile ? 4 : 6, max) * (lowPower ? 0.6 : 1);
  return { mobile, lowPower, n: Math.max(4, Math.round(n)) };
}

function drawParticle(ctx, p) {
  const raster = getRaster(p.assetId, p.color, p.mode, p.strokeWidth);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rot);
  ctx.globalAlpha = p.op;
  if (p.glow && raster.ready) {
    ctx.shadowColor = p.glowColor;
    ctx.shadowBlur = p.size * 0.7;
  }
  if (raster.ready) {
    ctx.drawImage(raster.canvas, -p.size / 2, -p.size / 2, p.size, p.size);
  } else {
    // Fallback while the tiny SVG rasterises (first frame or two only): a
    // soft dot in the particle's own colour, never a blank gap.
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(0, 0, p.size / 3, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

// Runs one effect on `canvas` until the returned cleanup function is called.
// `opts.reducedMotion` renders a single static glow (no animation) per the
// preset's accessibility.reducedMotionMode, matching prefers-reduced-motion.
export function runEffect(canvas, rawPreset, opts = {}) {
  const preset = resolvePreset(rawPreset);
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return () => {};

  let raf = 0, running = false, started = false;
  let W = 0, H = 0, dpr = 1;
  let particles = [], burst = [];
  let startT = 0, lastT = 0;

  // Size from the canvas element's own rendered box, not always window
  // dimensions — this lets the exact same engine drive both the fullscreen
  // storefront overlay (canvas styled position:fixed;inset:0, so its rect IS
  // the viewport) and a small embedded preview box in the Effect Builder.
  const resize = () => {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    W = Math.max(1, Math.round(rect.width || window.innerWidth));
    H = Math.max(1, Math.round(rect.height || window.innerHeight));
    canvas.width = Math.floor(W * dpr); canvas.height = Math.floor(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const fill = () => {
    const e = envInfo(preset);
    particles = Array.from({ length: e.n }, () => makeParticle(preset, W, H, true));
    if (preset.emission.burstOnLoad && preset.emission.burstCount) {
      const bn = Math.round(preset.emission.burstCount * (e.mobile ? 0.5 : 1));
      burst = Array.from({ length: bn }, () => {
        const pp = makeParticle(preset, W, H, false);
        pp.y = rand(-H * 0.2, H * 0.1); pp.x = rand(0, W);
        pp.vy = Math.abs(pp.vy) * 2 + 40; pp.isBurst = true;
        return pp;
      });
    }
  };

  const step = (now) => {
    if (!running) return;
    const t = (now - startT) / 1000;
    const dt = Math.min(0.05, (now - lastT) / 1000 || 0.016);
    lastT = now;
    ctx.clearRect(0, 0, W, H);
    const all = burst.length ? particles.concat(burst) : particles;
    const stillBurst = [];
    for (const p of all) {
      p.x += p.vx * dt + Math.sin(t * p.swayFreq + p.phase) * p.driftAmp * dt;
      p.y += p.vy * dt;
      p.rot += p.vrot * dt;
      if (p.x < -60) p.x = W + 60; if (p.x > W + 60) p.x = -60;
      const offBottom = p.y > H + p.size + 8, offTop = p.y < -p.size - 8;
      if (offBottom || offTop) {
        if (p.isBurst) continue; // let burst particles drain, not respawn
        p.y = p.vy >= 0 ? -p.size : H + p.size;
        p.x = rand(0, W);
      }
      if (p.isBurst) stillBurst.push(p);
      drawParticle(ctx, p);
    }
    burst = stillBurst;
    raf = requestAnimationFrame(step);
  };

  const start = () => {
    if (running) return;
    running = true; startT = performance.now(); lastT = startT;
    raf = requestAnimationFrame(step);
  };
  const stop = () => { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; };

  const onVis = () => { if (document.hidden) stop(); else if (started) start(); };
  const onResize = () => { resize(); fill(); };

  const boot = () => {
    started = true;
    resize(); fill();
    if (!document.hidden) start();
  };

  let idle;
  if (opts.reducedMotion) {
    // No animation loop at all — the React layer renders a static glow div
    // instead of mounting this canvas when reducedMotionMode requires it.
  } else if (window.requestIdleCallback) {
    idle = window.requestIdleCallback(boot, { timeout: 800 });
  } else {
    idle = setTimeout(boot, 300);
  }

  window.addEventListener('resize', onResize, { passive: true });
  document.addEventListener('visibilitychange', onVis);
  let ro;
  if (window.ResizeObserver) {
    ro = new ResizeObserver(() => onResize());
    ro.observe(canvas);
  }

  return () => {
    stop();
    if (window.cancelIdleCallback && typeof idle === 'number') window.cancelIdleCallback(idle);
    clearTimeout(idle);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('visibilitychange', onVis);
    if (ro) ro.disconnect();
    if (ctx) ctx.clearRect(0, 0, W, H);
    particles = []; burst = [];
  };
}
