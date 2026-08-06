// App settings: storefront theme (Bean Culture pastel pink), theme presets for
// the customiser, hero slides/ads, and copy. Defaults live here; they can be
// overridden live by setting a SETTINGS_JSON env var in Railway (persists across
// deploys) — the admin page renders/exports that blob.

const DEFAULTS = {
  storeName: 'Bean Culture',
  announcement: '',
  // Default theme — light pastel pink.
  theme: {
    bg: '#fdf1f4',
    surface: '#ffffff',
    ink: '#3b2b30',
    muted: '#9c8890',
    brand: '#b5566e',
    accent: '#d1547a',
    accentInk: '#ffffff',
    line: '#f2dfe6',
  },
  // Presets offered in the theme customiser.
  themePresets: [
    { name: 'Bean Culture Pink', brand: '#b5566e', accent: '#d1547a', bg: '#fdf1f4', ink: '#3b2b30' },
    { name: 'Rose', brand: '#a34a63', accent: '#e0879b', bg: '#fbeef1', ink: '#33232a' },
    { name: 'Latte', brand: '#7a5240', accent: '#b5651d', bg: '#f7f1ea', ink: '#2c2019' },
    { name: 'Matcha', brand: '#4f7a52', accent: '#5a9e63', bg: '#eef5ec', ink: '#25301f' },
    { name: 'Midnight', brand: '#e0879b', accent: '#e0879b', bg: '#1c1720', ink: '#f4eef1' },
  ],
  // Hero carousel. Each slide links to a category (by display name), an item id,
  // an external url, or nothing.
  hero: [
    {
      id: 'welcome',
      title: 'Bean Culture',
      subtitle: 'Order ahead — skip the queue',
      cta: 'Browse the menu',
      bg: 'linear-gradient(135deg,#f7c9d6 0%,#d1547a 100%)',
      textColor: '#ffffff',
      link: { type: 'scroll', value: 'menu' },
    },
    {
      id: 'coffee',
      title: 'Specialty coffee',
      subtitle: 'Roasted for Bean Culture',
      cta: 'Order a coffee',
      bg: 'linear-gradient(135deg,#c79a86 0%,#7a5240 100%)',
      textColor: '#ffffff',
      link: { type: 'category', value: 'Coffee' },
    },
    {
      id: 'rewards',
      title: 'Earn as you sip',
      subtitle: '10 points = a free coffee',
      cta: 'Join rewards',
      bg: 'linear-gradient(135deg,#f7c9d6 0%,#b5566e 100%)',
      textColor: '#ffffff',
      link: { type: 'account', value: '' },
    },
  ],
};

function deepMerge(base, over) {
  if (Array.isArray(over)) return over;
  if (over && typeof over === 'object' && !Array.isArray(over)) {
    const out = { ...base };
    for (const k of Object.keys(over)) out[k] = deepMerge(base ? base[k] : undefined, over[k]);
    return out;
  }
  return over === undefined ? base : over;
}

function getSettings() {
  let over = {};
  if (process.env.SETTINGS_JSON) {
    try {
      over = JSON.parse(process.env.SETTINGS_JSON);
    } catch (e) {
      console.error('[settings] SETTINGS_JSON is not valid JSON:', e.message);
    }
  }
  return deepMerge(DEFAULTS, over);
}

module.exports = { getSettings, DEFAULTS };
