// Multi-location support. One Square account, several locations (each its own
// Square location id, and — configured in Square — its own bank account). The
// customer picks a store; that choice decides which Square location an order and
// its payment are created against (so takings land in the right location's
// books/deposits) and which items show (per-location availability).
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

// The configured locations, always non-empty. Each: { id, name, squareLocationId,
// address, active, hiddenItemIds:[] }. A blank squareLocationId falls back to the
// env default so a half-configured second location can't misroute money.
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
  }));
}

// Only the locations a customer may pick (active). Falls back to all if none active.
function active() {
  const a = list().filter((l) => l.active);
  return a.length ? a : list();
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
function publicList() {
  // `_default` flags the synthesised single-store fallback so the client can
  // tell a genuinely-configured single store (show its name in the header) from
  // a plain single-site deploy that never touched Locations (show nothing).
  return active().map((l) => ({ id: l.id, name: l.name, address: l.address, squareLocationId: l.squareLocationId, _default: !!l._default }));
}

module.exports = { list, active, resolve, squareIdFor, hiddenSet, publicList, slug };
