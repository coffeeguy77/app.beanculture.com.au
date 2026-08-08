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
  // Store page content (About / Find us page reached from the header).
  storePhoto: '',
  bio: '',
  googleReviewUrl: '',
  supportMessage: '',
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
  // Festive & seasonal themes (Canberra / Australia). Each auto-activates on its
  // date/range (MM-DD), is selectable any time in the customiser, carries a
  // colour scheme, optional falling effect, and an optional banner that is shown
  // #1 in the hero rotation while the theme is active. Owners edit these (dates,
  // colours, banner, enabled) in the admin Theme tab. Variable-date holidays
  // (Easter, Lunar New Year, Mother's/Father's Day) ship with sensible defaults
  // to adjust each year.
  seasonalThemes: [
    {
      id: 'christmas', name: '🎄 Christmas', from: '12-01', to: '12-30', enabled: true,
      theme: { bg: '#073B2A', surface: '#0A4630', ink: '#FFF5DF', muted: '#E9D9B4', brand: '#E9C46A', accent: '#B71320', accentInk: '#FFF5DF', line: 'rgba(216,169,59,0.42)' },
      season: { gold: '#D8A93B', goldLight: '#F1D37B', cream: '#FFF5DF', cream2: '#F7E8C8', red: '#B71320', redDeep: '#961019', green: '#0A4630', greenDeep: '#052D21', cardBg: '#B71320', cardBorder: '#D8A93B', textOnCream: '#33261D' },
      decor: { density: 'rich', perimeter: false, bells: false, snowBank: false },
      effects: { snow: true },
      banner: { title: 'Merry Christmas', subtitle: 'Festive treats & gift-ready coffee bags', cta: 'Order for the holidays', bg: 'linear-gradient(135deg,#0A4630,#B71320)', textColor: '#FFF5DF', link: { type: 'scroll', value: 'menu' } },
    },
    {
      id: 'newyear', name: '🎉 New Year', from: '12-31', to: '01-01', enabled: true,
      theme: { bg: '#0b0f1e', surface: '#141a30', ink: '#f6e9c6', muted: '#b9a96f', brand: '#e7c24a', accent: '#c9a227', accentInk: '#0b0f1e', line: 'rgba(231,194,74,0.4)' },
      effects: { confetti: true },
      banner: { title: 'Happy New Year', subtitle: 'Kick off the year with your favourite', cta: 'Order now', bg: 'linear-gradient(135deg,#141a30,#e7c24a)', textColor: '#fff', link: { type: 'scroll', value: 'menu' } },
    },
    {
      id: 'australiaday', name: '🇦🇺 Australia Day', from: '01-26', to: '01-26', enabled: true,
      theme: { bg: '#0a3d2e', surface: '#0e4a38', ink: '#fbe9a8', muted: '#cbe3c9', brand: '#f4c430', accent: '#1e824c', accentInk: '#08281e', line: 'rgba(244,196,48,0.4)' },
      banner: { title: 'Happy Australia Day', subtitle: 'Green & gold long weekend', cta: 'Order ahead', bg: 'linear-gradient(135deg,#1e824c,#f4c430)', textColor: '#fff', link: { type: 'scroll', value: 'menu' } },
    },
    {
      id: 'lunarnewyear', name: '🧧 Lunar New Year', from: '02-10', to: '02-17', enabled: true,
      theme: { bg: '#5a0f14', surface: '#6d1319', ink: '#ffe9c7', muted: '#e8b98f', brand: '#f6c945', accent: '#d4222a', accentInk: '#fff', line: 'rgba(246,201,69,0.42)' },
      effects: { confetti: true },
      banner: { title: 'Lunar New Year', subtitle: 'Good fortune & good coffee', cta: 'Celebrate with us', bg: 'linear-gradient(135deg,#8a1319,#f6c945)', textColor: '#fff', link: { type: 'scroll', value: 'menu' } },
    },
    {
      id: 'valentines', name: '❤️ Valentine’s Day', from: '02-14', to: '02-14', enabled: true,
      theme: { bg: '#fbe6ee', surface: '#ffffff', ink: '#4a1f2e', muted: '#b3798d', brand: '#d63384', accent: '#e83e8c', accentInk: '#fff', line: '#f6cfe0' },
      effects: { hearts: true },
      banner: { title: 'Happy Valentine’s Day', subtitle: 'Treat someone you love', cta: 'Order a treat', bg: 'linear-gradient(135deg,#ff6b9d,#c02659)', textColor: '#fff', link: { type: 'scroll', value: 'menu' } },
    },
    {
      id: 'stpatricks', name: '☘️ St Patrick’s Day', from: '03-17', to: '03-17', enabled: true,
      theme: { bg: '#0c3b22', surface: '#0f4a2b', ink: '#eaf7d9', muted: '#a9d3ac', brand: '#4caf50', accent: '#f4c430', accentInk: '#0c3b22', line: 'rgba(76,175,80,0.4)' },
      banner: { title: 'Happy St Patrick’s Day', subtitle: 'A little luck with your coffee', cta: 'Order now', bg: 'linear-gradient(135deg,#0f4a2b,#4caf50)', textColor: '#fff', link: { type: 'scroll', value: 'menu' } },
    },
    {
      id: 'easter', name: '🐰 Easter', from: '04-03', to: '04-07', enabled: true,
      theme: { bg: '#fdf3e7', surface: '#ffffff', ink: '#4a3b2a', muted: '#b0a08c', brand: '#8e7cc3', accent: '#f6a5c0', accentInk: '#fff', line: '#efe3d3' },
      effects: { petals: true },
      banner: { title: 'Happy Easter', subtitle: 'Hot cross treats & long-weekend coffee', cta: 'Pre-order for the weekend', bg: 'linear-gradient(135deg,#f6a5c0,#8e7cc3)', textColor: '#fff', link: { type: 'scroll', value: 'menu' } },
    },
    {
      id: 'anzac', name: '🌺 Anzac Day', from: '04-25', to: '04-25', enabled: true,
      theme: { bg: '#2b2620', surface: '#332d26', ink: '#f0e6d2', muted: '#b6a892', brand: '#c1440e', accent: '#7a6f5d', accentInk: '#fff', line: 'rgba(193,68,14,0.4)' },
      banner: { title: 'Lest We Forget', subtitle: 'We honour Anzac Day', cta: 'Order ahead', bg: 'linear-gradient(135deg,#332d26,#c1440e)', textColor: '#f0e6d2', link: { type: 'scroll', value: 'menu' } },
    },
    {
      id: 'mothersday', name: '💐 Mother’s Day', from: '05-10', to: '05-11', enabled: true,
      theme: { bg: '#fbe9f1', surface: '#ffffff', ink: '#4a2436', muted: '#bd8aa2', brand: '#d94f8c', accent: '#f28fb2', accentInk: '#fff', line: '#f4d3e2' },
      effects: { petals: true },
      banner: { title: 'Happy Mother’s Day', subtitle: 'Spoil Mum with a treat', cta: 'Order for Mum', bg: 'linear-gradient(135deg,#f28fb2,#d94f8c)', textColor: '#fff', link: { type: 'scroll', value: 'menu' } },
    },
    {
      id: 'floriade', name: '🌷 Floriade', from: '09-13', to: '10-12', enabled: true,
      theme: { bg: '#fef4e8', surface: '#ffffff', ink: '#3a3320', muted: '#a99d7e', brand: '#e5533c', accent: '#7cb342', accentInk: '#fff', line: '#efe6d0' },
      effects: { petals: true },
      banner: { title: 'Floriade is here', subtitle: 'Canberra’s in bloom — so are we', cta: 'Grab a coffee & go', bg: 'linear-gradient(135deg,#7cb342,#e5533c)', textColor: '#fff', link: { type: 'scroll', value: 'menu' } },
    },
    {
      id: 'fathersday', name: '👔 Father’s Day', from: '09-06', to: '09-07', enabled: true,
      theme: { bg: '#0e2233', surface: '#13314a', ink: '#e6eef5', muted: '#9db4c6', brand: '#3d8bcd', accent: '#c8892f', accentInk: '#fff', line: 'rgba(61,139,205,0.4)' },
      banner: { title: 'Happy Father’s Day', subtitle: 'Sort Dad’s coffee run', cta: 'Order for Dad', bg: 'linear-gradient(135deg,#13314a,#3d8bcd)', textColor: '#fff', link: { type: 'scroll', value: 'menu' } },
    },
    {
      id: 'halloween', name: '🎃 Halloween', from: '10-24', to: '10-31', enabled: true,
      theme: { bg: '#160d1f', surface: '#221434', ink: '#f7e4c4', muted: '#b193c9', brand: '#ff7518', accent: '#7b2ff7', accentInk: '#fff', line: 'rgba(255,117,24,0.4)' },
      banner: { title: 'Spooky season', subtitle: 'Treats worth the haunt', cta: 'Order a treat', bg: 'linear-gradient(135deg,#221434,#ff7518)', textColor: '#fff', link: { type: 'scroll', value: 'menu' } },
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
  const full = deepMerge(merged, db.getOverrides());
  return reconcileSeasonal(full);
}

// Built-in festive themes must ALWAYS be present, even if an old saved settings
// blob replaced the whole seasonalThemes array (arrays replace wholesale on
// merge). We rebuild the list from the DEFAULTS by id: each built-in is patched
// by any saved override with the same id (so enabled/dates/colours/banner edits
// persist), and any saved theme whose id isn't a built-in is a custom event and
// is appended. This keeps the 12 Canberra festive themes from ever disappearing.
const BUILTIN_SEASONAL_IDS = new Set(DEFAULTS.seasonalThemes.map((t) => t.id));
function reconcileSeasonal(settings) {
  const saved = Array.isArray(settings.seasonalThemes) ? settings.seasonalThemes : [];
  const savedById = new Map(saved.map((t) => [t.id, t]));
  const out = DEFAULTS.seasonalThemes.map((def) => {
    const ov = savedById.get(def.id);
    return ov ? deepMerge(def, ov) : def;
  });
  for (const t of saved) {
    if (t && t.id && !BUILTIN_SEASONAL_IDS.has(t.id)) out.push(t);
  }
  return { ...settings, seasonalThemes: out };
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
function spanDays(from, to) {
  const doy = (mmdd) => { const [m, d] = String(mmdd).split('-').map(Number); return (m || 1) * 31 + (d || 1); };
  const a = doy(from), b = doy(to);
  return a <= b ? b - a : (372 - a + b); // year-wrap counts as a long span
}
// The active seasonal theme for a day; on overlap, the most specific (shortest
// span) wins so a single-day holiday beats a multi-week window.
function activeSeasonal(settings, mmdd) {
  const day = mmdd || todayMMDD();
  let best = null, bestSpan = Infinity;
  for (const s of settings.seasonalThemes || []) {
    if (s.enabled === false) continue;
    const inRange = s.from <= s.to ? day >= s.from && day <= s.to : day >= s.from || day <= s.to;
    if (!inRange) continue;
    const span = spanDays(s.from, s.to);
    if (span < bestSpan) { best = s; bestSpan = span; }
  }
  return best ? flatten(best) : null;
}

function flatten(s) {
  return {
    id: s.id, name: s.name, ...s.theme,
    season: s.season || null, decor: s.decor || {}, effects: s.effects || {},
    banner: s.banner || null,
  };
}

// Seasonal themes flattened for the picker and for admin preview (enabled only).
function seasonalForPicker(settings) {
  return (settings.seasonalThemes || []).filter((s) => s.enabled !== false).map(flatten);
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
