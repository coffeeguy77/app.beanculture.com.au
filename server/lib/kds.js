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

function kdsSettings() {
  const s = getSettings().kds || {};
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
  const dineIn = /dine-?in/i.test(tn) || /dine-?in/i.test(note);
  const tableM = tn.match(/^t\s*(\w+)/i) || note.match(/table\s*(\w+)/i);
  const table = tableM ? tableM[1] : '';
  let customerName = '';
  const takeM = tn.match(/takeaway\s+(.+)/i);
  if (takeM) customerName = takeM[1].trim();
  const fulfillment = (order.fulfillments || [])[0] || null;
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
    const appOrigin = /bean culture/i.test((o.source && o.source.name) || '');
    const items = (o.line_items || []).map((li) => ({
      name: li.name || 'Item',
      variation: li.variation_name || '',
      quantity: li.quantity || '1',
      modifiers: (li.modifiers || []).map((m) => m.name).filter(Boolean),
      note: li.note || '',
      categories: (varCat && varCat[li.catalog_object_id]) || [],
    }));

    // Route line items to zones. The All lane always gets everything.
    const zoneItems = { [ALL_ZONE]: items };
    for (const z of zones) {
      const zcats = (z.categories || []).map((c) => String(c).toLowerCase());
      const mine = items.filter((it) => it.categories.some((c) => zcats.includes(String(c).toLowerCase())));
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

async function fetchTickets(squareLocationId, loc) {
  const cfg = kdsSettings();
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
