// Kitchen Display System — assembles live "tickets" from Square orders and
// merges in each station's bump state (stored in our DB, keyed by order+zone).
//
// Design notes:
// - Orders live in Square; we pull recent ones (SearchOrders) and treat a ticket
//   as active until its zone is bumped in OUR db (bump state is intentionally
//   separate from Square — see the KDS scoping decisions).
// - App orders (source.name "Bean Culture App") are flagged so the screen can
//   highlight them.
// - Square order line items carry only a variation id, so we resolve each line's
//   category via catalog.getVariationCategoryMap() to route it to a station/zone.
// - An implicit "All orders" lane (id '__all__') always exists so nothing is
//   ever lost, and a single-screen cafe can just use that.

const { squareFetch, LOCATION_ID } = require('./squareClient');
const catalog = require('./catalog');
const db = require('./db');
const { getSettings } = require('./settings');

const ALL_ZONE = '__all__';

// Where an order came from, by its Square source name. 'Bean Culture POS' is the
// counter POS; 'Bean Culture App' is a customer self-order (app / walk-around QR).
// The POS name also contains "bean culture", so POS must be tested FIRST — that
// was the bug where counter orders showed as APP on the board.
function originOf(order) {
  const name = String((order && order.source && order.source.name) || '');
  if (/pos/i.test(name)) return 'pos';
  if (/bean culture|app/i.test(name)) return 'app';
  return 'other';
}

function kdsSettings(locationId) {
  // Per-location override wins; otherwise the shared default config. A location
  // is only "customised" once it has its own entry with stations — until then it
  // inherits the default (which is the original single-screen HQ setup), so no
  // existing configuration is ever lost when a second site is added.
  const all = getSettings();
  const override = locationId && all.kdsByLocation && all.kdsByLocation[locationId];
  const s = (override && typeof override === 'object' ? override : (all.kds || {}));
  return {
    zones: Array.isArray(s.zones) ? s.zones.filter((z) => z && z.id) : [],
    lookbackHours: Math.max(1, Math.min(48, Number(s.lookbackHours) || 8)),
    amberMin: Number(s.amberMin) >= 0 ? Number(s.amberMin) : 6,
    redMin: Number(s.redMin) >= 0 ? Number(s.redMin) : 12,
    sound: s.sound !== false,
    showPrepStep: s.showPrepStep !== false,
  };
}

// Pull dine-in / table / customer-name signals out of the Square ticket name +
// note (the app encodes them there — "T5 DINE-IN", "TAKEAWAY Alex", etc.).
function parseTicketMeta(order) {
  const tn = (order.ticket_name || '').trim();
  const note = (order.note || '').trim();
  const md = order.metadata || {};
  const appOrigin = originOf(order) === 'app';
  // Dine-in: trust the explicit metadata flag first (set at order creation);
  // only fall back to text-parsing for legacy/POS orders that lack it.
  const dineIn = md.bc_dinein === '1' ? true
    : md.bc_dinein === '0' ? false
    : (/dine-?in/i.test(tn) || /dine-?in/i.test(note));
  // Table only matters for dine-in. Prefer the raw label stashed in bc_booth
  // (covers named tables like "Shaun's Desk"); the T<n> regex requires DIGITS so
  // it can't wrongly grab "AKEAWAY" out of "TAKEAWAY".
  let table = '';
  if (dineIn) {
    if (md.bc_booth) table = String(md.bc_booth).trim();
    else { const tableM = tn.match(/^t\s*(\d+)/i) || note.match(/table\s*(\w+)/i); if (tableM) table = tableM[1]; }
  }
  const fulfillment = (order.fulfillments || [])[0] || null;
  const recipient = fulfillment && fulfillment.pickup_details && fulfillment.pickup_details.recipient;
  // Ticket label, in priority order:
  //  • app orders carry the buyer's own name in metadata (bc_name) — most reliable;
  //  • Square POS orders show the cashier-typed name/ticket (the Square ticket
  //    name, or the fulfillment recipient) rather than a random order id;
  //  • legacy app takeaway tickets encoded it as "TAKEAWAY <name>".
  let customerName = '';
  if (md.bc_name) customerName = String(md.bc_name).trim();
  else if (!appOrigin) customerName = tn || (recipient && recipient.display_name ? String(recipient.display_name).trim() : '');
  else { const takeM = tn.match(/takeaway\s+(.+)/i); if (takeM) customerName = takeM[1].trim(); }
  return {
    dineIn,
    table,
    customerName,
    fulfillmentType: fulfillment ? fulfillment.type : '',
    note,
  };
}

// Pure transform: Square orders + variation→category map + saved bump states +
// config → the ticket list the screen renders. Kept side-effect-free so it can
// be unit-tested without Square or the DB.
function buildTickets(orders, varCat, states, cfg, now = Date.now()) {
  const zones = Array.isArray(cfg.zones) ? cfg.zones.filter((z) => z && z.id) : [];
  return (orders || []).map((o) => {
    const meta = parseTicketMeta(o);
    const origin = originOf(o);
    const appOrigin = origin === 'app';
    const posOrigin = origin === 'pos';
    const items = (o.line_items || []).map((li) => ({
      name: li.name || 'Item',
      variation: li.variation_name || '',
      quantity: li.quantity || '1',
      modifiers: (li.modifiers || []).map((m) => m.name).filter(Boolean),
      note: li.note || '',
      categories: (varCat && varCat[li.catalog_object_id]) || [],
    }));

    // Route line items to zones. The All lane always gets everything. A line
    // goes to a station if its CATEGORY is on that station (or the product is
    // explicitly included via z.items), MINUS any products unticked for this
    // station in Advanced mode (z.hiddenItems). That's how breakfast/lunch get
    // split across Kitchen and FOH — same category, some items hidden per side.
    const zoneItems = { [ALL_ZONE]: items };
    for (const z of zones) {
      const zcats = (z.categories || []).map((c) => String(c).toLowerCase());
      const zitems = new Set((z.items || []).map((n) => String(n).trim().toLowerCase()));
      const zhidden = new Set((z.hiddenItems || []).map((n) => String(n).trim().toLowerCase()));
      const mine = items.filter((it) => {
        const nm = String(it.name || '').trim().toLowerCase();
        if (zhidden.has(nm)) return false;   // unticked for this station
        return it.categories.some((c) => zcats.includes(String(c).toLowerCase())) || zitems.has(nm);
      });
      if (mine.length) zoneItems[z.id] = mine;
    }

    const st = (states && states[o.id]) || {};
    const zoneStatus = {};
    for (const zid of Object.keys(zoneItems)) zoneStatus[zid] = (st[zid] && st[zid].status) || 'new';

    return {
      orderId: o.id,
      createdAt: o.created_at,
      ageSec: Math.max(0, Math.round((now - new Date(o.created_at).getTime()) / 1000)),
      appOrigin,
      posOrigin,
      source: (o.source && o.source.name) || 'Square',
      ticketName: o.ticket_name || '',
      dineIn: meta.dineIn,
      table: meta.table,
      customerName: meta.customerName,
      fulfillmentType: meta.fulfillmentType,
      note: meta.note,
      zoneItems,
      zoneStatus,
    };
  });
}

async function fetchTickets(squareLocationId, loc, locationId) {
  const cfg = kdsSettings(locationId);
  const startAt = new Date(Date.now() - cfg.lookbackHours * 3600 * 1000).toISOString();
  const data = await squareFetch('/v2/orders/search', {
    method: 'POST',
    body: {
      location_ids: [squareLocationId || LOCATION_ID],
      query: {
        filter: {
          date_time_filter: { created_at: { start_at: startAt } },
          state_filter: { states: ['OPEN', 'COMPLETED'] },
        },
        sort: { sort_field: 'CREATED_AT', sort_order: 'DESC' },
      },
      return_entries: false,
      limit: 150,
    },
  });
  // An app checkout creates its Square order BEFORE charging (stamped bc_hold),
  // so a declined/abandoned checkout must never reach the kitchen. A held order
  // is shown the moment payment is confirmed — and "confirmed" is decided from
  // OUR OWN database (the '__paid__' marker written by /api/pay), which is the
  // only fully reliable signal: Square's order search does not always return the
  // payment tender straight away, and the metadata release can lag, so a paid
  // order must never depend on either of those to appear. Tender/COMPLETED are
  // kept as extra fail-open signals.
  const allIds = (data.orders || []).map((o) => o && o.id).filter(Boolean);
  const paidSet = await db.kdsGetPaid(allIds).catch(() => new Set());
  const stillUnpaid = (o) => {
    const m = o.metadata || {};
    if (m.bc_hold !== '1') return false;   // not a held app order
    if (paidSet.has(o.id)) return false;   // our DB says the payment went through
    if (o.state === 'COMPLETED') return false;
    if (Array.isArray(o.tenders) && o.tenders.length) return false;
    return true;
  };
  let orders = (data.orders || []).filter((o) => o && o.state !== 'CANCELED' && !stillUnpaid(o));
  // Leak detector: a held (bc_hold='1') order should only be visible once it is
  // genuinely paid. Log any that slip through, with the reason, so a real leak
  // (an unpaid order reaching the kitchen) is captured instead of guessed at.
  for (const o of orders) {
    if (o.metadata && o.metadata.bc_hold === '1') {
      const why = paidSet.has(o.id) ? 'db-paid-marker'
        : (o.state === 'COMPLETED' ? 'order-COMPLETED'
        : (Array.isArray(o.tenders) && o.tenders.length ? 'has-tender' : 'UNKNOWN'));
      console.warn(`[kds] held order shown on screen id=${o.id} reason=${why} state=${o.state} tenders=${(o.tenders || []).length}`);
    }
  }
  // Several app stores can share ONE Square location (events run on the café's),
  // so split the board by the screen's chosen store using the order's store tag:
  //  • an EVENT screen shows only that event's tickets (bc_event);
  //  • any other screen shows its own store's tickets (bc_store), plus untagged
  //    legacy orders, and never an event's tickets.
  if (loc && loc.type === 'event') {
    orders = orders.filter((o) => o.metadata && o.metadata.bc_event === loc.id);
  } else if (loc) {
    orders = orders.filter((o) => {
      const m = o.metadata || {};
      if (m.bc_event) return false;          // events belong to the booth board
      if (m.bc_store) return m.bc_store === loc.id; // tagged → only its own store
      return true;                            // untagged legacy order → show it
    });
  }
  const [varCat, states] = await Promise.all([
    catalog.getVariationCategoryMap().catch(() => ({})),
    db.kdsGetStates(orders.map((o) => o.id)).catch(() => ({})),
  ]);
  return { tickets: buildTickets(orders, varCat, states, cfg), config: cfg, allZone: ALL_ZONE };
}

module.exports = { fetchTickets, buildTickets, parseTicketMeta, kdsSettings, ALL_ZONE };
