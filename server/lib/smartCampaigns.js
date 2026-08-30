// Smart Campaigns — the single central resolver.
//
// Given the store settings + a weather reading + the current venue-local time,
// this decides which campaigns are active and turns them into a PLACEMENT PLAN
// (homepage hero slides + per-category banners). The homepage and category views
// consume that plan as plain data — no campaign/weather logic lives in any
// component. Weather is the first campaign type; the shape is deliberately
// generic (trigger_type) so time/stock/loyalty rules can be added later without
// touching the consumers.

const catalog = require('./catalog'); // venueNow()

const HYS_MARGIN = 1.5; // °C — how far past the threshold before a campaign turns OFF
const onState = {};     // campaignId -> currently-on (in-memory hysteresis; single replica)

function hhmm(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  return m ? (+m[1]) * 60 + (+m[2]) : null;
}

// Which weather number a campaign's rule reads.
function sourceValue(weather, source) {
  if (!weather || !weather.ok) return null;
  if (source === 'today_max') return weather.today_max;
  if (source === 'tomorrow_max') return weather.tomorrow_max;
  return weather.current_temperature; // 'current' (default)
}

// Raw temperature-rule match (no hysteresis).
function rawMatch(c, weather) {
  const v = sourceValue(weather, c.weather_source || 'current');
  if (v == null) return false; // no reliable weather → never trigger (graceful fallback)
  const op = c.comparison_operator || 'gte';
  const a = Number(c.threshold_min);
  const b = Number(c.threshold_max);
  if (op === 'between') return Number.isFinite(a) && Number.isFinite(b) && v >= Math.min(a, b) && v <= Math.max(a, b);
  if (!Number.isFinite(a)) return false;
  if (op === 'gte') return v >= a;
  if (op === 'gt') return v > a;
  if (op === 'lte') return v <= a;
  if (op === 'lt') return v < a;
  return false;
}

// Rule match with optional hysteresis: once on, stay on until the temperature is
// clearly (HYS_MARGIN) past the threshold, so it doesn't flap around the edge.
function matchWithHysteresis(c, weather, useHys) {
  const on = rawMatch(c, weather);
  if (!useHys) { onState[c.id] = on; return on; }
  if (!onState[c.id]) { onState[c.id] = on; return on; }
  const v = sourceValue(weather, c.weather_source || 'current');
  if (v == null) { onState[c.id] = false; return false; }
  const op = c.comparison_operator || 'gte';
  const a = Number(c.threshold_min), b = Number(c.threshold_max);
  let stay;
  if (op === 'between') stay = v >= Math.min(a, b) - HYS_MARGIN && v <= Math.max(a, b) + HYS_MARGIN;
  else if (op === 'gte' || op === 'gt') stay = v >= a - HYS_MARGIN;
  else if (op === 'lte' || op === 'lt') stay = v <= a + HYS_MARGIN;
  else stay = on;
  onState[c.id] = stay;
  return stay;
}

// Schedule gate: date range, day-of-week, time-of-day (venue-local).
function scheduleMatch(c, now) {
  if (c.start_date && now.date < c.start_date) return false;
  if (c.end_date && now.date > c.end_date) return false;
  const days = Array.isArray(c.active_days) ? c.active_days.map(Number) : [];
  if (days.length && !days.includes(now.dow)) return false;
  const s = hhmm(c.active_start_time), e = hhmm(c.active_end_time);
  if (s != null && e != null) {
    const inWin = s <= e ? (now.minutes >= s && now.minutes < e) : (now.minutes >= s || now.minutes < e);
    if (!inWin) return false;
  }
  return true;
}

// The core: active campaigns, highest priority first, honouring the global mode.
function getActiveSmartCampaigns({ settings, weather, now }) {
  const sc = (settings && settings.smartCampaigns) || {};
  const opts = sc.options || {};
  const useHys = opts.hysteresis !== false;
  const list = (Array.isArray(sc.weather) ? sc.weather : []).filter((c) => c && c.id && c.active !== false);
  const matched = [];
  for (const c of list) {
    if (!scheduleMatch(c, now)) { onState[c.id] = false; continue; }
    if (!matchWithHysteresis(c, weather, useHys)) continue;
    matched.push(c);
  }
  matched.sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0));
  return (opts.mode || 'highest') === 'all' ? matched : matched.slice(0, 1);
}

// Map a campaign's destination to the app's existing banner link shape (reused by
// the homepage HeroSlider onLink handler and the category banner).
function destToLink(c) {
  const t = c.destination_type || 'none';
  if (t === 'category') return { type: 'category', value: c.destination_id || '' };
  if (t === 'item') return { type: 'item', value: c.destination_id || '' };
  if (t === 'scroll') return { type: 'scroll', value: 'menu' };
  if (t === 'account') return { type: 'account', value: '' };
  if (t === 'payitforward') return { type: 'payitforward', value: '' };
  if (t === 'url') return { type: 'url', value: c.destination_url || '' };
  return { type: 'none', value: '' };
}

// One campaign → its homepage slide + category placement (shared by the live
// resolver and the admin preview, so a preview looks exactly like the real thing).
function campaignToSlides(c, { heroSlides, byCategory }) {
  // Per-store targeting: an empty/absent list means "all stores"; a non-empty
  // list limits the placement to those location ids (the frontend filters on it).
  const locations = Array.isArray(c.locations) ? c.locations.filter(Boolean) : [];
  if (c.homepage_enabled && c.homepage_artwork) {
    heroSlides.push({
      id: `smart-${c.id}`,
      campaignId: c.id,
      title: c.homepage_title || '',
      subtitle: c.homepage_subtitle || '',
      cta: c.cta_text || '',
      image: c.homepage_artwork,
      mobileImage: c.homepage_mobile_artwork || '',
      alt: c.homepage_alt_text || c.name || '',
      // How the artwork fills the banner box: cover (default) | contain | fill.
      fit: c.homepage_fit || 'cover',
      locations,
      link: destToLink(c),
    });
  }
  if (c.category_enabled && c.category_id && (c.category_artwork || c.category_title)) {
    const key = String(c.category_id).toLowerCase();
    if (!byCategory[key]) {
      byCategory[key] = {
        campaignId: c.id,
        image: c.category_artwork || '',
        mobileImage: c.category_mobile_artwork || '',
        title: c.category_title || '',
        cta: c.cta_text || '',
        fit: c.category_fit || 'cover',
        locations,
        link: destToLink(c),
        position: c.category_position || 'before', // before | after | replace
      };
    }
  }
}

// Turn the active campaigns into a placement plan the frontend consumes as data.
function resolveSmartPlacements({ settings, weather, now = catalog.venueNow() }) {
  const active = getActiveSmartCampaigns({ settings, weather, now });
  const heroSlides = [];
  const byCategory = {};
  for (const c of active) campaignToSlides(c, { heroSlides, byCategory });
  return { heroSlides, byCategory, activeCampaignIds: active.map((c) => c.id) };
}

// ── Admin preview: force one campaign onto the homepage for a few minutes,
// regardless of the weather, so the owner can see exactly how it looks. Held in
// memory (a short-lived test), auto-expiring; never persisted. ──
let preview = null; // { campaign, until }
const PREVIEW_MS = 5 * 60 * 1000;
function setPreview(campaign, ms = PREVIEW_MS) {
  if (!campaign || typeof campaign !== 'object') throw new Error('No campaign to preview');
  preview = { campaign, until: Date.now() + Math.max(30000, Math.min(ms, 30 * 60000)) };
  return preview.until;
}
function clearPreview() { preview = null; }
function activePreview() {
  if (preview && Date.now() < preview.until) return preview;
  preview = null;
  return null;
}
// The slide plan for the active preview campaign (empty when no preview).
function previewPlan() {
  const p = activePreview();
  if (!p) return null;
  const heroSlides = [];
  const byCategory = {};
  // Preview ignores active/enabled toggles for the homepage banner so you can
  // test a paused or still-being-built campaign.
  campaignToSlides({ ...p.campaign, homepage_enabled: p.campaign.homepage_enabled !== false }, { heroSlides, byCategory });
  return { heroSlides, byCategory, until: p.until, campaignId: p.campaign.id };
}

function _resetStateForTest() { for (const k of Object.keys(onState)) delete onState[k]; }

module.exports = {
  getActiveSmartCampaigns, resolveSmartPlacements, campaignToSlides,
  setPreview, clearPreview, activePreview, previewPlan,
  rawMatch, scheduleMatch, destToLink, _resetStateForTest,
};
