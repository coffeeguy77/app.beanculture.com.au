// Built-in SVG particle shape library for the Effects Engine.
//
// Each entry is a small, self-contained SVG string on a 0 0 64 64 viewBox,
// using `currentColor` for fill/stroke so the renderer can recolour a shape
// per-particle without needing a separate asset per colour. Kept deliberately
// simple (one or two path/shape primitives) so they stay crisp when rasterised
// small and cheap to pre-render once per (asset, colour, mode) combination.
//
// `strokeable: true` means the shape reads well in stroke-only mode (an
// outline heart, a star drawn as lines); `strokeable: false` shapes (soft
// dots, confetti) are fill-only and the renderer falls back to fill even if
// a stroke mode was requested.

const svg = (inner, extra = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" ${extra}>${inner}</svg>`;

export const EFFECT_ASSETS = {
  // ── Snow ────────────────────────────────────────────────────────────────
  'snowflake-1': {
    label: 'Snowflake (six-point)',
    strokeable: true,
    svg: svg(`<g fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
      ${[0, 60, 120].map((a) => `<line x1="32" y1="8" x2="32" y2="56" transform="rotate(${a} 32 32)"/>`).join('')}
      ${[0, 60, 120].map((a) => `<path d="M32 16 L26 22 M32 16 L38 22 M32 48 L26 42 M32 48 L38 42" transform="rotate(${a} 32 32)"/>`).join('')}
    </g>`),
  },
  'snowflake-2': {
    label: 'Snowflake (crystal)',
    strokeable: true,
    svg: svg(`<g fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      ${[0, 45, 90, 135].map((a) => `<line x1="32" y1="6" x2="32" y2="58" transform="rotate(${a} 32 32)"/>`).join('')}
      ${[0, 45, 90, 135].map((a) => `<path d="M32 14 L24 19 M32 14 L40 19" transform="rotate(${a} 32 32)"/>`).join('')}
    </g>`),
  },
  'snowflake-3': {
    label: 'Snowflake (star)',
    strokeable: true,
    svg: svg(`<g fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round">
      ${[0, 60, 120].map((a) => `<line x1="32" y1="10" x2="32" y2="54" transform="rotate(${a} 32 32)"/>`).join('')}
      <circle cx="32" cy="32" r="3.5" fill="currentColor" stroke="none"/>
    </g>`),
  },
  'soft-snow-dot': {
    label: 'Soft snow dot',
    strokeable: false,
    svg: svg(`<circle cx="32" cy="32" r="14" fill="currentColor"/>`),
  },
  // ── Sparkle / star ─────────────────────────────────────────────────────
  sparkle: {
    label: 'Four-point sparkle',
    strokeable: true,
    svg: svg(`<path d="M32 4 C33 22 34 30 32 32 C30 30 31 22 32 4 Z M32 60 C31 42 30 34 32 32 C34 34 33 42 32 60 Z
      M4 32 C22 31 30 30 32 32 C30 34 22 33 4 32 Z M60 32 C42 33 34 34 32 32 C34 30 42 31 60 32 Z" fill="currentColor"/>`),
  },
  star: {
    label: 'Five-point star',
    strokeable: true,
    svg: svg(`<path d="M32 6 L38.5 24.5 L58 25 L42.5 37 L48 56 L32 45 L16 56 L21.5 37 L6 25 L25.5 24.5 Z" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>`),
  },
  // ── Hearts ─────────────────────────────────────────────────────────────
  'heart-outline': {
    label: 'Heart outline',
    strokeable: true,
    svg: svg(`<path d="M32 54 C10 40 6 26 14 17 C20 10 30 12 32 22 C34 12 44 10 50 17 C58 26 54 40 32 54 Z" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linejoin="round"/>`),
  },
  'heart-filled': {
    label: 'Heart filled',
    strokeable: false,
    svg: svg(`<path d="M32 54 C10 40 6 26 14 17 C20 10 30 12 32 22 C34 12 44 10 50 17 C58 26 54 40 32 54 Z" fill="currentColor"/>`),
  },
  // ── Petals / botanical ─────────────────────────────────────────────────
  'petal-round': {
    label: 'Round petal',
    strokeable: true,
    svg: svg(`<path d="M32 6 C46 14 46 34 32 58 C18 34 18 14 32 6 Z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>`),
  },
  'petal-curved': {
    label: 'Curved petal',
    strokeable: true,
    svg: svg(`<path d="M30 8 C48 12 52 30 34 40 C24 46 12 40 12 28 C12 16 20 8 30 8 Z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>`),
  },
  'tulip-petal': {
    label: 'Tulip petal',
    strokeable: true,
    svg: svg(`<path d="M32 6 C42 16 44 32 38 50 C34 56 30 56 26 50 C20 32 22 16 32 6 Z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>`),
  },
  eucalyptus: {
    label: 'Eucalyptus leaf',
    strokeable: true,
    svg: svg(`<path d="M32 6 C48 18 48 46 32 58 C16 46 16 18 32 6 Z" fill="currentColor"/>
      <line x1="32" y1="10" x2="32" y2="54" stroke="rgba(0,0,0,.18)" stroke-width="1.4"/>`),
  },
  clover: {
    label: 'Clover / shamrock',
    strokeable: false,
    svg: svg(`<g fill="currentColor">
      <circle cx="32" cy="20" r="11"/><circle cx="20" cy="36" r="11"/><circle cx="44" cy="36" r="11"/>
      <path d="M32 32 L32 58" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>
    </g>`),
  },
  // ── Confetti ───────────────────────────────────────────────────────────
  'confetti-strip': {
    label: 'Confetti strip',
    strokeable: false,
    svg: svg(`<rect x="18" y="26" width="28" height="12" rx="3" fill="currentColor"/>`),
  },
  'confetti-circle': {
    label: 'Confetti circle',
    strokeable: false,
    svg: svg(`<circle cx="32" cy="32" r="12" fill="currentColor"/>`),
  },
  'confetti-diamond': {
    label: 'Confetti diamond',
    strokeable: false,
    svg: svg(`<path d="M32 8 L52 32 L32 56 L12 32 Z" fill="currentColor"/>`),
  },
  // ── Atmospheric ────────────────────────────────────────────────────────
  lantern: {
    label: 'Lantern',
    strokeable: false,
    svg: svg(`<g fill="currentColor"><rect x="24" y="6" width="16" height="6" rx="2"/><rect x="20" y="16" width="24" height="32" rx="8"/><rect x="24" y="50" width="16" height="6" rx="2"/></g>`),
  },
  ember: {
    label: 'Ember',
    strokeable: false,
    svg: svg(`<circle cx="32" cy="32" r="9" fill="currentColor"/>`),
  },
  bat: {
    label: 'Bat silhouette',
    strokeable: false,
    svg: svg(`<path d="M32 28 C28 16 14 12 6 18 C14 20 20 24 24 30 C14 30 6 36 4 46 C14 42 22 40 28 34 C29 40 30 46 32 50 C34 46 35 40 36 34 C42 40 50 42 60 46 C58 36 50 30 40 30 C44 24 50 20 58 18 C50 12 36 16 32 28 Z" fill="currentColor"/>`),
  },
  'coffee-bean': {
    label: 'Coffee bean',
    strokeable: false,
    svg: svg(`<g fill="currentColor"><path d="M32 6 C48 6 56 20 56 32 C56 46 46 58 32 58 C18 58 8 46 8 32 C8 20 16 6 32 6 Z"/></g>
      <path d="M32 8 C26 20 26 44 32 56" fill="none" stroke="rgba(0,0,0,.35)" stroke-width="3" stroke-linecap="round"/>`),
  },
  'coffee-steam': {
    label: 'Coffee steam curl',
    strokeable: true,
    svg: svg(`<path d="M26 58 C18 46 34 40 26 28 C20 18 32 10 28 4" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>`),
  },
};

export const EFFECT_ASSET_IDS = Object.keys(EFFECT_ASSETS);

// Render an asset's raw SVG string with a colour baked in (canvas can't read
// currentColor, so we substitute it before rasterising). `mode` chooses
// fill-only / stroke-only / mixed presentation for shapes that support it.
export function svgForAsset(assetId, color, mode = 'fill', strokeWidth = 2) {
  const asset = EFFECT_ASSETS[assetId];
  if (!asset) return null;
  let markup = asset.svg;
  const canStroke = asset.strokeable;
  if (mode === 'stroke' && canStroke) {
    markup = markup.replace(/currentColor/g, color).replace(/stroke-width="[\d.]+"/g, `stroke-width="${strokeWidth}"`);
  } else {
    markup = markup.replace(/currentColor/g, color);
  }
  return markup;
}
