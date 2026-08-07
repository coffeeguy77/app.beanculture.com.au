// App settings: storefront theme (Bean Culture pastel pink), theme presets for
// the customiser, hero slides/ads, and copy. Defaults live here; they can be
// overridden live by setting a SETTINGS_JSON env var in Railway (persists across
// deploys) — the admin page renders/exports that blob.

const DEFAULTS = {
  storeName: 'Bean Culture',
  announcement: '',
  // Store contact + branding.
  contact: { address: '', phone: '', mapsUrl: '' },
  logoUrl: '',
  faviconUrl: '',
  // Closure dates (annual leave, public holidays). Each entry is either a single
  // day { date:'YYYY-MM-DD' } or a range { from:'YYYY-MM-DD', to:'YYYY-MM-DD' }.
  // annual:true repeats every year on the same month/day(s).
  closures: [],
  // Which Square categories appear in the app (category IDs). Empty = use the
  // "APP" parent category's children automatically (legacy behaviour).
  menuCategories: [],
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
  // Seasonal themes auto-activate between from/to (MM-DD) and are also selectable
  // any time in the theme customiser. `effects` drives the festive overlays.
  seasonalThemes: [
    {
      id: 'christmas',
      name: 'Christmas',
      from: '12-01',
      to: '12-30',
      // Base variables (fallback look before the seasonal stylesheet applies).
      theme: {
        bg: '#073B2A',
        surface: '#0A4630',
        ink: '#FFF5DF',
        muted: '#E9D9B4',
        brand: '#E9C46A',
        accent: '#B71320',
        accentInk: '#FFF5DF',
        line: 'rgba(216,169,59,0.42)',
      },
      // Semantic seasonal tokens consumed by seasonal.css.
      season: {
        gold: '#D8A93B',
        goldLight: '#F1D37B',
        cream: '#FFF5DF',
        cream2: '#F7E8C8',
        red: '#B71320',
        redDeep: '#961019',
        green: '#0A4630',
        greenDeep: '#052D21',
        cardBg: '#B71320',
        cardBorder: '#D8A93B',
        textOnCream: '#33261D',
      },
      decor: { density: 'rich', perimeter: false, bells: false, snowBank: false },
      effects: { snow: true },
    },
  ],
  // Banner box shape (CSS aspect-ratio). All banners share this fixed size;
  // build banners to this shape to fill it edge-to-edge (default 3:2 = 1200x800).
  heroRatio: '3 / 2',
  // Banner auto-scroll: on/off and speed (seconds between slides).
  heroAutoplay: true,
  heroInterval: 5,
  // Menu layout: 'onepage' (all categories on one scroll) or 'single' (one
  // category/group at a time, chosen from the footer).
  layoutMode: 'onepage',
  // Footer "menu builder": each slot has an icon (from the built-in stroke set)
  // and one OR MORE categories. A multi-category slot combines those sections
  // (e.g. a "Cold" slot with an ice icon = Cold Drinks + Smoothies + Shakes).
  // Available icons: cup, mug, burger, bag, smoothie, can, bean, ice, shake, tea, drink.
  footer: [
    { label: 'Coffee', icon: 'cup', categories: ['COFFEE'] },
    { label: 'All Day', icon: 'burger', categories: ['ALL DAY MENU'] },
    { label: 'Grab & Go', icon: 'bag', categories: ['GRAB AND GO'] },
    { label: 'Smoothies', icon: 'smoothie', categories: ['SMOOTHIES'] },
    { label: 'Cold Drinks', icon: 'can', categories: ['COLD DRINKS'] },
    { label: 'Coffee Bags', icon: 'bean', categories: ['COFFEE BAGS'] },
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

const db = require('./db');

function getSettings() {
  let env = {};
  if (process.env.SETTINGS_JSON) {
    try {
      env = JSON.parse(process.env.SETTINGS_JSON);
    } catch (e) {
      console.error('[settings] SETTINGS_JSON is not valid JSON:', e.message);
    }
  }
  // Precedence: DEFAULTS < SETTINGS_JSON env < admin edits stored in the DB.
  const merged = deepMerge(DEFAULTS, env);
  return deepMerge(merged, db.getOverrides());
}

// Today's MM-DD in the cafe's timezone.
function todayMMDD(tz) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz || process.env.SEASON_TZ || 'Australia/Sydney',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const m = {};
  for (const p of parts) m[p.type] = p.value;
  return `${m.month}-${m.day}`;
}

// The seasonal theme active for a given MM-DD (or null). Handles year-wrap ranges.
function activeSeasonal(settings, mmdd) {
  const day = mmdd || todayMMDD();
  for (const s of settings.seasonalThemes || []) {
    const inRange = s.from <= s.to ? day >= s.from && day <= s.to : day >= s.from || day <= s.to;
    if (inRange) return flatten(s);
  }
  return null;
}

function flatten(s) {
  return { id: s.id, name: s.name, ...s.theme, season: s.season || null, decor: s.decor || {}, effects: s.effects || {} };
}

// Seasonal themes flattened for the picker and for admin preview.
function seasonalForPicker(settings) {
  return (settings.seasonalThemes || []).map(flatten);
}

// Does a closure entry (single day or range, optionally annual) cover fullDate
// ('YYYY-MM-DD')? Used by hours + the scheduler.
function closureMatches(closure, fullDate) {
  if (!closure) return false;
  const md = String(fullDate).slice(5);
  if (closure.from && closure.to) {
    if (closure.annual) {
      const f = String(closure.from).slice(5);
      const t = String(closure.to).slice(5);
      return f <= t ? (md >= f && md <= t) : (md >= f || md <= t); // handle year-wrap
    }
    return fullDate >= closure.from && fullDate <= closure.to;
  }
  if (closure.date) return closure.date === fullDate || (closure.annual && String(closure.date).slice(5) === md);
  return false;
}
function isClosedDate(closures, fullDate) {
  return (closures || []).some((c) => closureMatches(c, fullDate));
}

module.exports = { getSettings, DEFAULTS, todayMMDD, activeSeasonal, seasonalForPicker, closureMatches, isClosedDate };
