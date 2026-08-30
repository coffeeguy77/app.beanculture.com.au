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

// Fulfilment options for a location: each store's own toggle if set, else a
// sensible default from its type. Physical = dine-in + takeaway + reservations;
// Pop-up = takeaway only (tick dine-in on if it has a table/booth setup);
// Event = booth/table ordering only (free), no takeaway or reservations.
function typeFulfilmentDefaults(type) {
  if (type === 'popup') return { dineIn: false, takeaway: true, reservations: false };
  if (type === 'event') return { dineIn: true, takeaway: false, reservations: false };
  return { dineIn: true, takeaway: true, reservations: true };
}
function fulfilmentFor(l) {
  const def = typeFulfilmentDefaults(l && l.type);
  const f = (l && l.fulfilment) || {};
  return {
    dineIn: f.dineIn != null ? !!f.dineIn : def.dineIn,
    takeaway: f.takeaway != null ? !!f.takeaway : def.takeaway,
    reservations: f.reservations != null ? !!f.reservations : def.reservations,
  };
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
    type: (l.type === 'popup' || l.type === 'event') ? l.type : 'physical',
    // Free / no-payment ordering (corporate event hire — complimentary coffees).
    // Defaults on for an Event store; overridable per store either way.
    free: l.free != null ? !!l.free : (l.type === 'event'),
    // Complimentary categories (by display name) at this event store — those
    // items show no price and go straight to the kitchen; everything else is a
    // normal PAID item (e.g. retail coffee beans). Empty list + free:true means
    // the WHOLE store is complimentary (the original event behaviour).
    freeCategories: Array.isArray(l.freeCategories) ? l.freeCategories.filter(Boolean) : [],
    // The event menu: the ONLY sections (categories / Product-Builder sections)
    // shown at this store — a short, curated list so event guests get few, fast
    // choices. Empty = show the whole menu (normal stores). Names are matched
    // case-insensitively against the storefront section names.
    menuSections: Array.isArray(l.menuSections) ? l.menuSections.filter(Boolean) : [],
    // Hidden from the public store picker — reachable only by its own QR / booth
    // link (?loc=…). Events default to hidden (found via booth QR at the event
    // only); overridable per store.
    hidden: l.hidden != null ? !!l.hidden : (l.type === 'event'),
    // Per-store fulfilment overrides ({ dineIn, takeaway, reservations }); any
    // key left undefined falls back to the type default (see fulfilmentFor).
    fulfilment: (l.fulfilment && typeof l.fulfilment === 'object') ? l.fulfilment : null,
    startDate: l.startDate || '',
    endDate: l.endDate || '',
    // Event stores: explicit dated sessions ([{date, open, close}]) — each day
    // its own hours. Drives the countdown + ordering gate (see hours.js).
    sessions: Array.isArray(l.sessions) ? l.sessions.filter((x) => x && x.date) : [],
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

// Whether this store gives complimentary (free / no-payment) orders. The order
// code is server-authoritative on this — never trust a client "free" flag.
function isFree(locId) {
  return !!resolve(locId).free;
}

// The complimentary category names (lowercased) for a store — the per-category
// event model. Empty set means "no per-category list"; combine with isFree()
// for the whole-store-free case. Server-authoritative (never trust the client).
function freeCategoriesFor(locId) {
  const l = resolve(locId);
  return new Set((l.freeCategories || []).map((n) => String(n).toLowerCase()));
}

// The curated event menu for a store: the only storefront sections shown there
// (lowercased names). Empty array means "no restriction — show everything".
function menuSectionsFor(locId) {
  const l = resolve(locId);
  return (l.menuSections || []).map((n) => String(n).toLowerCase());
}

// The "Visit" store page every Event borrows by default, so an event always
// points customers to a real cafe afterwards (e.g. the Mitchell Roastery).
// Chosen globally in settings.eventDefaultStorePageLocId; null when unset or the
// target has no store page. Never falls back to an event's own page.
function eventDefaultStorePage() {
  const s = getSettings();
  const id = s.eventDefaultStorePageLocId;
  if (!id) return null;
  const l = list().find((x) => x.id === id && x.type !== 'event');
  return (l && l.storePage) ? l.storePage : null;
}

// Shape for the client. Includes squareLocationId because the browser card SDK
// (Square.payments) is already initialised with a Square location id — it must
// tokenise against the store the customer chose so the charge lands there.
// Also carries pop-up window + status so the app can show the "Store Opening"
// teaser and its countdown, and a per-store weather label + store-page presence.
function publicList() {
  const today = todayISO();
  const eventDefaultSP = eventDefaultStorePage();
  return active().map((l) => {
    const state = popupState(l, today);
    // An event borrows the configured default store page (e.g. Mitchell
    // Roastery) when it hasn't got its own, so customers always learn where to
    // find the cafe after the event.
    const sp = l.storePage || (l.type === 'event' ? eventDefaultSP : null);
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
      hasStorePage: !!sp,
      // Per-store "Visit" page content (photo, blurb, phone, map). Only what the
      // page needs to render — falls back to the global store info on the client.
      storePage: sp ? {
        photo: sp.photo || '',
        bio: sp.bio || '',
        phone: sp.phone || '',
        mapsUrl: sp.mapsUrl || '',
      } : null,
      // Which order types this store offers, so the app can show only the
      // relevant choices (e.g. takeaway-only at a pop-up).
      fulfilment: fulfilmentFor(l),
      // Complimentary ordering (no payment) — the app hides the card step.
      free: !!l.free,
      // Complimentary categories at this event; everything else stays paid.
      freeCategories: Array.isArray(l.freeCategories) ? l.freeCategories : [],
      // Hidden from the store picker (event booths etc.) — the app still resolves
      // it when reached by ?loc=, but never lists it as a choosable store.
      hidden: !!l.hidden,
    };
  });
}

module.exports = {
  list, active, resolve, squareIdFor, hiddenSet, isFree, freeCategoriesFor,
  menuSectionsFor, eventDefaultStorePage, publicList, slug,
  popupState, todayISO, dayDiff, fulfilmentFor, typeFulfilmentDefaults,
};
