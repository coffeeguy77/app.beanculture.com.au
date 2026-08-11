// Theme engine: turn a small theme object into CSS variables, deriving any
// missing tokens (surface/line/muted/ink-on-accent) from the base colours so a
// user only needs to pick brand / accent / background.

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const int = parseInt(n, 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}
export function rgbToHex(r, g, b) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
export function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}
export function mix(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex(A.r + (B.r - A.r) * t, A.g + (B.g - A.g) * t, A.b + (B.b - A.b) * t);
}
// Blend toward white by t (0..1). Convenience wrapper over mix().
export function lighten(hex, t) {
  return mix(hex, '#ffffff', t);
}
export function rgbaFrom(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}
export function readableInk(bg) {
  return luminance(bg) > 0.55 ? '#2b2126' : '#ffffff';
}

export function deriveTheme(t) {
  const bg = t.bg || '#fdf1f4';
  const dark = luminance(bg) < 0.4;
  const ink = t.ink || (dark ? '#f4eef1' : '#3b2b30');
  const brand = t.brand || '#b5566e';
  const accent = t.accent || brand;
  return {
    bg,
    surface: t.surface || (dark ? mix(bg, '#ffffff', 0.08) : '#ffffff'),
    ink,
    muted: t.muted || (dark ? mix(ink, bg, 0.45) : mix(ink, bg, 0.5)),
    brand,
    accent,
    accentInk: t.accentInk || readableInk(accent),
    line: t.line || (dark ? mix(bg, '#ffffff', 0.14) : mix(bg, ink, 0.1)),
  };
}

export function applyTheme(t) {
  const d = deriveTheme(t);
  const root = document.documentElement;
  root.style.setProperty('--bg', d.bg);
  root.style.setProperty('--surface', d.surface);
  root.style.setProperty('--ink', d.ink);
  root.style.setProperty('--muted', d.muted);
  root.style.setProperty('--brand', d.brand);
  root.style.setProperty('--accent', d.accent);
  root.style.setProperty('--accent-ink', d.accentInk);
  root.style.setProperty('--line', d.line);
  root.style.setProperty('--brand-soft', rgbaFrom(d.brand, 0.1));
  root.style.setProperty('--accent-soft', rgbaFrom(d.accent, 0.12));
  // Seasonal layer: set semantic season tokens and flip the data-season switch
  // that activates seasonal.css across every component. Removing it restores the
  // base/brand theme instantly (nothing is mutated permanently).
  if (t && t.id && t.season) {
    root.dataset.season = t.id;
    const s = t.season;
    for (const [k, v] of Object.entries(s)) {
      root.style.setProperty(`--season-${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}`, v);
    }
  } else {
    delete root.dataset.season;
  }

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', d.bg);
  return d;
}
