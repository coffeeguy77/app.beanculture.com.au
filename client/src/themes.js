// Storefront theme engine — the rich, per-preset token model.
//
// Each launch preset is authored from a HANDFUL of core colours (canvas
// gradient stops, surface, primary, accent, text). buildTokens() derives the
// full `--t-*` namespace that `.store-shell` consumes (every fallback in
// styles.css is the Espresso Plum hex, so an un-set token = the current look).
//
// applyStoreTheme(preset) writes that namespace onto :root. Because Espresso
// Plum's derived/overridden tokens equal those exact fallbacks, selecting it
// explicitly renders pixel-identical to the un-themed default.

import { mix, lighten, luminance, rgbaFrom, readableInk } from './theme.js';

// camelCase logical token → CSS custom property (`primaryHover` → `--t-primary-hover`).
function toVar(name) {
  return '--t-' + name.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
}

// Turn a logical {tokenName: value} object into the flat {'--t-…': value} map
// that gets written to :root.
function toCssVars(logical) {
  const out = {};
  for (const [k, v] of Object.entries(logical)) {
    if (v != null) out[toVar(k)] = v;
  }
  return out;
}

// Derive the full logical token set from a preset's core colours. Any field in
// `preset.overrides` replaces the derived value verbatim (used to pin Espresso
// Plum exactly onto the historical hex where a formula would drift).
export function buildTokens(preset) {
  const p = preset || {};
  const canvasStart = p.canvasStart || '#321421';
  const canvasEnd = p.canvasEnd || '#160f12';
  const canvasMid = p.canvasMid || mix(canvasStart, canvasEnd, 0.5);
  const canvasGlow = p.canvasGlow || p.primary || '#9e2753';
  const surface = p.surface || '#fff9f3';
  const primary = p.primary || '#9e2753';
  const accent = p.accent || '#e8b65c';
  const text = p.text || '#241816';

  // Primary family.
  const primaryHover = mix(primary, '#ffffff', 0.12);
  const primaryBright = mix(primary, '#ffffff', 0.28);
  const primaryDeep = mix(primary, canvasEnd, 0.45);
  const plum = mix(canvasEnd, primary, 0.35);

  // Accent.
  const accentStrong = mix(accent, '#ffffff', 0.22);

  // Light surfaces (cards floating on the dark canvas).
  const surfaceRaised = mix(surface, '#ffffff', 0.5);
  const surfaceTint = mix(surface, primary, 0.08);
  const surfaceTintStrong = mix(surface, primary, 0.16);

  // Text.
  const textMuted = mix(text, surface, 0.42);
  const textOnDark = mix('#ffffff', accent, 0.06); // warm near-white
  const textOnDarkMuted = mix(textOnDark, canvasMid, 0.28);
  const headingOnDark = textOnDark;
  // On-canvas link must stay legible on the dark canvas — lighten a too-dark
  // primary until it reads (target luminance ~0.5+).
  let linkOnDark = primaryBright;
  let guard = 0;
  while (luminance(linkOnDark) < 0.5 && guard++ < 6) linkOnDark = lighten(linkOnDark, 0.18);

  // Borders / controls.
  const border = mix(surface, text, 0.16);
  const borderAccent = mix(primary, surface, 0.42);
  const controlBorder = mix(primary, surface, 0.55);
  const controlBorderHover = mix(primary, surface, 0.4);
  const controlBorderFocus = primary;

  // Progress.
  const progressTrack = rgbaFrom(surfaceTint || accent, 0.28);
  const progressStart = primary;
  const progressEnd = primaryBright;

  // Theme-tinted shadows + focus ring (tinted by the deepest canvas tone).
  const shadowCard = `0 2px 4px ${rgbaFrom(canvasEnd, 0.16)}, 0 12px 28px ${rgbaFrom(canvasEnd, 0.22)}`;
  const shadowRaised = `0 4px 10px ${rgbaFrom(canvasEnd, 0.2)}, 0 22px 48px ${rgbaFrom(canvasEnd, 0.3)}`;
  const focusRing = `0 0 0 3px ${rgbaFrom(accent, 0.42)}`;

  // Full-page gradient (glow radial + depth radial + vertical fade).
  const canvasGradient =
    `radial-gradient(circle at 18% 4%, ${rgbaFrom(canvasGlow, 0.2)}, transparent 32%), ` +
    `radial-gradient(circle at 82% 30%, ${rgbaFrom(canvasEnd, 0.28)}, transparent 38%), ` +
    `linear-gradient(180deg, ${canvasStart} 0%, ${canvasMid} 46%, ${canvasEnd} 100%)`;

  const heroBorder = rgbaFrom(borderAccent, 0.5);
  const heroGlow = rgbaFrom(accent, 0.15);
  const illustration = primaryBright;
  const textOnPrimary = readableInk(primary);

  const logical = {
    canvasStart, canvasMid, canvasEnd,
    plum, primaryDeep, primary, primaryHover, primaryBright,
    accent, accentStrong,
    surface, surfaceRaised, surfaceTint, surfaceTintStrong,
    text, textMuted, textOnDark, textOnDarkMuted, headingOnDark, linkOnDark,
    border, borderAccent,
    controlBorder, controlBorderHover, controlBorderFocus,
    progressTrack, progressStart, progressEnd,
    shadowCard, shadowRaised, focusRing, canvasGradient,
    heroBorder, heroGlow, illustration, textOnPrimary,
    // Light checkout surface is constant across presets (accessible dark-on-light).
    checkoutFieldBg: '#fff', checkoutPrimaryText: '#fff', checkoutError: '#b9385d',
    ...(p.overrides || {}),
  };

  return toCssVars(logical);
}

export const STOREFRONT_THEMES = [
  {
    id: 'espresso-plum',
    name: 'Espresso Plum',
    collection: 'universal',
    canvasStart: '#321421',
    canvasMid: '#211218',
    canvasEnd: '#160f12',
    canvasGlow: '#9e2753',
    surface: '#FFF9F3',
    primary: '#9E2753',
    accent: '#E8B65C',
    text: '#241816',
    // Pin every token that would otherwise drift onto the exact historical hex,
    // so Espresso Plum is pixel-identical whether it's the default (no tokens
    // set → CSS fallbacks) or explicitly selected (tokens set → these values).
    overrides: {
      plum: '#431426',
      primaryDeep: '#56162f',
      primaryHover: '#d94e78',
      primaryBright: '#ef7385',
      accentStrong: '#f2d28e',
      surfaceRaised: '#fffdf9',
      surfaceTint: '#f4e2e5',
      surfaceTintStrong: '#ecd1d7',
      textMuted: '#75645f',
      textOnDark: '#fff8f1',
      textOnDarkMuted: '#d9c9c5',
      headingOnDark: '#fff8f1',
      linkOnDark: '#ef7385',
      border: '#ddc2bd',
      borderAccent: '#c98998',
      controlBorder: '#d9a0ad',
      controlBorderHover: '#c77f91',
      controlBorderFocus: '#d94e78',
      progressTrack: 'rgba(244,226,229,0.28)',
      progressStart: '#9e2753',
      progressEnd: '#ef7385',
      shadowCard: '0 2px 4px rgba(15,6,10,.16), 0 12px 28px rgba(15,6,10,.22)',
      shadowRaised: '0 4px 10px rgba(15,6,10,.20), 0 22px 48px rgba(15,6,10,.30)',
      focusRing: '0 0 0 3px rgba(232,182,92,.42)',
      heroBorder: 'rgba(201,137,152,.35)',
      illustration: '#C34870',
      canvasGradient:
        'radial-gradient(circle at 18% 4%, rgba(158,39,83,.20), transparent 32%), ' +
        'radial-gradient(circle at 82% 30%, rgba(67,20,38,.28), transparent 38%), ' +
        'linear-gradient(180deg, #321421 0%, #211218 46%, #160f12 100%)',
    },
  },
  {
    id: 'salted-caramel',
    name: 'Salted Caramel',
    collection: 'universal',
    // Warm caramel / toasted sugar / brass.
    canvasStart: '#59331D',
    canvasEnd: '#1D130D',
    canvasGlow: '#7A4A22',
    surface: '#FFF8ED',
    primary: '#A94F22',
    accent: '#F0B84D',
    text: '#2C1B12',
  },
  {
    id: 'pistachio-cream',
    name: 'Pistachio Cream',
    collection: 'universal',
    // Sage radial glow, cream cards with a faint green tint, champagne accents.
    canvasStart: '#39523D',
    canvasEnd: '#142019',
    canvasGlow: '#3E6B4E',
    surface: '#FCF8E9',
    primary: '#477A58',
    accent: '#D6B85B',
    text: '#1D2A21',
  },
  {
    id: 'tiramisu',
    name: 'Tiramisu',
    collection: 'universal',
    // Mocha → cocoa gradient, mascarpone surfaces, biscuit-gold highlights.
    canvasStart: '#49372D',
    canvasEnd: '#171310',
    canvasGlow: '#79513B',
    surface: '#FFF9F0',
    primary: '#79513B',
    accent: '#D6A85D',
    text: '#261C17',
  },
  {
    id: 'black-sesame',
    name: 'Black Sesame',
    collection: 'bold',
    // Near-black graphite, stone/ivory cards, metallic-gold focus.
    canvasStart: '#262830',
    canvasEnd: '#090A0C',
    canvasGlow: '#343846',
    surface: '#F8F4EC',
    primary: '#343846',
    accent: '#D5A94E',
    text: '#17181C',
  },
  {
    id: 'blueberry-roast',
    name: 'Blueberry Roast',
    collection: 'bold',
    // Indigo bloom glow, porcelain surfaces, burnished gold, navy-tinted shadows.
    canvasStart: '#252C58',
    canvasEnd: '#0D1221',
    canvasGlow: '#2E3A78',
    surface: '#F7F4F0',
    primary: '#3E4A89',
    accent: '#C69748',
    text: '#171B2B',
  },
  {
    id: 'strawberry-mousse',
    name: 'Strawberry Mousse',
    collection: 'soft',
    // Dark berry canvas with a strawberry glow, whipped-cream cards.
    canvasStart: '#7B3048',
    canvasEnd: '#35151F',
    canvasGlow: '#C34870',
    surface: '#FFF8F5',
    primary: '#C34870',
    accent: '#F0A4AD',
    text: '#321B22',
  },
  {
    id: 'taro-velvet',
    name: 'Taro Velvet',
    collection: 'soft',
    // Aubergine gradient, lavender bloom, vanilla-lilac surfaces, rose accents.
    canvasStart: '#5A3D68',
    canvasEnd: '#201527',
    canvasGlow: '#6B4A80',
    surface: '#FCF7FF',
    primary: '#805798',
    accent: '#E3A5BE',
    text: '#2A1D30',
  },
];

// Map a legacy seasonal theme ({ bg, surface, ink, brand, accent }) onto a
// preset core so buildTokens/applyStoreTheme can re-skin the storefront palette
// with it. The OLD applyTheme still layers this theme's --season-* decorations
// and data-season effects on top — this only drives the base --t-* palette.
export function seasonalAsPreset(s) {
  const bg = s.bg || '#211218';
  const surface = s.surface || '#fff9f3';
  return {
    id: s.id,
    name: s.name,
    collection: 'seasonal',
    canvasStart: lighten(bg, 0.10),
    canvasMid: bg,
    canvasEnd: mix(bg, '#000000', 0.35),
    canvasGlow: s.brand || s.accent,
    surface,
    primary: s.brand || s.accent,
    accent: s.accent || s.brand,
    text: luminance(surface) > 0.5 ? '#241816' : '#fff8f1',
  };
}

const DEFAULT_PRESET_ID = 'espresso-plum';

// Look up a preset by id, falling back to Espresso Plum.
export function resolvePreset(id) {
  return (
    STOREFRONT_THEMES.find((t) => t.id === id) ||
    STOREFRONT_THEMES.find((t) => t.id === DEFAULT_PRESET_ID)
  );
}

// Small swatch descriptor for pickers (core colours only).
export function presetSwatch(p) {
  return { id: p.id, name: p.name, collection: p.collection, canvas: p.canvasMid || mix(p.canvasStart, p.canvasEnd, 0.5), primary: p.primary, accent: p.accent };
}

// Apply a resolved preset: write the full --t-* namespace to :root, then keep
// the legacy --brand/--accent/--bg (used outside .store-shell) and the
// theme-color meta in sync. Idempotent — safe to call after the pre-paint
// inline script has already seeded the tokens.
export function applyStoreTheme(preset) {
  // Accept a full preset object or a bare { id } — resolve the latter.
  let p = preset;
  if (!p || !p.canvasStart) p = resolvePreset(p?.id);
  const map = buildTokens(p);
  const root = document.documentElement;
  for (const [k, v] of Object.entries(map)) root.style.setProperty(k, v);

  // Legacy aliases for any non-storefront consumers (spinner, generic .btn, etc).
  root.style.setProperty('--brand', p.primary || '#9E2753');
  root.style.setProperty('--accent', p.accent || '#E8B65C');
  root.style.setProperty('--bg', p.canvasMid || map['--t-canvas-mid'] || '#211218');

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', p.canvasMid || map['--t-canvas-mid'] || '#211218');
  return map;
}
