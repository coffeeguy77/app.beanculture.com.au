// Multi-location support. One Square account, several locations (each its own
// Square location id, and — configured in Square — its own bank account). The
// customer picks a store; that choice decides which Square location an order and
// its payment are created against (so takings land in the right location's
// books/deposits) and which items show (per-location availability).
//
// A location may be a permanent PHYSICAL store or a time-boxed POP-UP (a market
// stall, a one-month garden kiosk). A pop-up carries startDate/endDate: before
// it opens the app shows a "Store Opening" teaser; after it ends the store drops
// out of the picker automatically.
//
// Backward-compatible: with no locations configured we synthesise a single
// "main" location from the existing SQUARE_LOCATION_ID env, so nothing changes
// for a single-site deploy.

const sq = require('./squareClient');
const { getSettings } = require('./settings');

function slug(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'loc';
}

// Today's date (YYYY-MM-DD) in the venue timezone, for pop-up window maths.
function todayISO(tz = 'Australia/Sydney') {
  try {
    const p = {};
    for (const part of new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())) p[part.type] = part.value;
    return `${p.year}-${p.month}-${p.day}`;
  } catch { return new Date().toISOString().slice(0, 10); }
}

// Whole-day difference b - a for 'YYYY-MM-DD' strings (UTC-safe).
function dayDiff(aISO, bISO) {
  const a = new Date(`${aISO}T00:00:00Z`).getTime();
  const b = new Date(`${bISO}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86400000);
}

// Pop-up lifecycle for a location relative to `today`:
//   'upcoming' — a pop-up whose startDate is still in the future
//   'ended'    — a pop-up whose endDate has passed
//   'live'     — everything else (physical stores, or a pop-up within its window)
function popupState(l, today = todayISO()) {
  if (!l || l.type !== 'popup') return 'live';
  if (l.startDate && dayDiff(today, l.startDate) > 0) return 'upcoming';
  if (l.endDate && dayDiff(today, l.endDate) < 0) return 'ended';
  return 'live';
}

// The configured locations, always non-empty. A blank squareLocationId falls
// back to the env default so a half-configured second location can't misroute
// money. Carries the full per-store config (hours, weather, pop-up window,
// store page) so the resolver below is the single source of truth.
function list() {
  const s = getSettings();
  const raw = Array.isArray(s.locations) ? s.locations.filter((l) => l && l.id) : [];
  if (!raw.length) {
    return [{
      id: 'main',
      name: s.storeName || 'Main',
      squareLocationId: sq.LOCATION_ID,
      address: (s.contact && s.contact.address) || '',
      active: true,
      hiddenItemIds: [],
      type: 'physical',
      _default: true,
    }];
  }
  return raw.map((l) => ({
    id: l.id,
    name: l.name || l.id,
    squareLocationId: l.squareLocationId || sq.LOCATION_ID,
    address: l.address || '',
    active: l.active !== false,
    hiddenItemIds: Array.isArray(l.hiddenItemIds) ? l.hiddenItemIds : [],
    type: l.type === 'popup' ? 'popup' : 'physical',
    startDate: l.startDate || '',
    endDate: l.endDate || '',
    // Per-store weekly hours ({ MON:[{open,close}], … }); blank → falls back to
    // the global store hours / Square hours in hours.js.
    hours: (l.hours && typeof l.hours === 'object') ? l.hours : null,
    closures: Array.isArray(l.closures) ? l.closures : null,
    // Per-store weather coordinates (Sutton ≠ Mitchell). Blank → global.
    weather: (l.weather && (l.weather.lat != null || l.weather.lng != null)) ? l.weather : null,
    // Per-store "Visit" page content (photo, blurb). Blank → the global store info.
    storePage: (l.storePage && typeof l.storePage === 'object') ? l.storePage : null,
  }));
}

// Locations a customer may pick right now: active, and — for pop-ups — not past
// their end date. Upcoming pop-ups ARE included (so the app can tease them);
// callers use popupState()/publicList().status to gate ordering. Falls back to
// the full list if that leaves nothing.
function active() {
  const today = todayISO();
  const all = list();
  const pickable = all.filter((l) => l.active && popupState(l, today) !== 'ended');
  if (pickable.length) return pickable;
  const anyActive = all.filter((l) => l.active);
  return anyActive.length ? anyActive : all;
}

function resolve(locId) {
  const all = list();
  return (locId && all.find((l) => l.id === locId)) || all[0];
}

function squareIdFor(locId) {
  return resolve(locId).squareLocationId || sq.LOCATION_ID;
}

function hiddenSet(locId) {
  return new Set(resolve(locId).hiddenItemIds || []);
}

// Shape for the client. Includes squareLocationId because the browser card SDK
// (Square.payments) is already initialised with a Square location id — it must
// tokenise against the store the customer chose so the charge lands there.
// Also carries pop-up window + status so the app can show the "Store Opening"
// teaser and its countdown, and a per-store weather label + store-page presence.
function publicList() {
  const today = todayISO();
  return active().map((l) => {
    const state = popupState(l, today);
    return {
      id: l.id,
      name: l.name,
      address: l.address,
      squareLocationId: l.squareLocationId,
      _default: !!l._default,
      type: l.type,
      startDate: l.startDate || '',
      endDate: l.endDate || '',
      // 'upcoming' (pop-up not open yet) | 'live'. 'ended' is filtered out above.
      status: state,
      daysUntilOpen: (l.type === 'popup' && l.startDate) ? Math.max(0, dayDiff(today, l.startDate)) : null,
      hasStorePage: !!l.storePage,
    };
  });
}

module.exports = {
  list, active, resolve, squareIdFor, hiddenSet, publicList, slug,
  popupState, todayISO, dayDiff,
};
