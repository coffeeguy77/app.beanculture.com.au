// Real sales, straight from Square — completed orders in a date window,
// aggregated for the admin dashboard. (The app's own analytics track behaviour;
// this is the authoritative money figure.)

const { squareFetch, LOCATION_ID, CURRENCY } = require('./squareClient');

// ── Retail coffee-bag mix (by weight) ──
// The owner wants the RETAIL bagging ratio, so wholesale bags — the ones sold at
// the $30 and $35 price points — are excluded. The size is read from the line
// item's name + variation as an ACTUAL weight (any "…g" / "…kg" written there),
// so whatever the bags are called in Square, the real grams are picked up and
// bucketed — not just a hard-coded 200/500/1000. The per-unit (catalog) price
// decides retail vs wholesale: a 500g at $38 counts, a 500g at $35 is skipped.
const WHOLESALE_UNIT_CENTS = new Set([3000, 3500]); // $30 and $35 wholesale price points

// Pull a bag weight in grams from a line item, or null if there's no weight on it.
// Handles kg/kilo and g/gm/gms/gram(s), with or without a space (1kg, 1 kg, 500g,
// 500 g, 250gm, 1kilo, 0.5kg). Guards to a sensible bag range so a stray number
// (a price, a "16oz") isn't mistaken for a weight.
function bagGrams(li) {
  const s = `${li.name || ''} ${li.variation_name || ''}`.toLowerCase();
  let m = s.match(/(\d+(?:\.\d+)?)\s*(?:kg|kilo(?:gram)?s?)\b/);
  if (m) { const g = Math.round(parseFloat(m[1]) * 1000); if (g >= 50 && g <= 10000) return g; }
  m = s.match(/(\d{2,4})\s*g(?:ms?|rams?)?\b/);
  if (m) { const g = parseInt(m[1], 10); if (g >= 50 && g <= 10000) return g; }
  return null;
}

// A readable label for a weight in grams (950 → "950g", 1000 → "1kg", 1500 → "1.5kg").
function gramsLabel(g) {
  return g >= 1000 ? `${Math.round((g / 1000) * 100) / 100}kg` : `${g}g`;
}

// Per-unit price in cents, preferring the catalog base price (the true price
// point, unaffected by order-level discounts), falling back to net ÷ quantity.
function unitCents(li, qty) {
  if (li.base_price_money && li.base_price_money.amount != null) return li.base_price_money.amount;
  const gross = (li.gross_sales_money && li.gross_sales_money.amount)
    || (li.total_money && li.total_money.amount) || 0;
  return qty ? Math.round(gross / qty) : gross;
}

// Every distinct Square location id the business uses, so the bag scan covers all
// stores (not just the default). Falls back to the env default location.
function allSquareLocationIds() {
  try {
    const locations = require('./locations');
    const ids = [...new Set((locations.list() || []).map((l) => l.squareLocationId).filter(Boolean))];
    if (!ids.includes(LOCATION_ID)) ids.unshift(LOCATION_ID);
    return ids.length ? ids : [LOCATION_ID];
  } catch { return [LOCATION_ID]; }
}

async function salesSummary(days = 30) {
  const since = new Date(Date.now() - days * 86400000);
  const dayMap = new Map();
  // Best clients: most walk-in POS sales are genuinely anonymous (no name is
  // ever taken at the counter), so a name-based guest bucket is mostly noise.
  // Only orders tied to a real customer_id — a loyalty member, whether they
  // ordered in the app or tapped their account in Square POS — count towards
  // this list; that's also the only case where "best client" is meaningful
  // (the same person, reliably, across visits).
  const clientMap = new Map();
  // App-only breakdown: the owner wants to see, on the dashboard, how much the
  // MOBILE APP is taking each day and every individual app order (not the POS
  // counter sales that dominate the combined figure). App orders are stamped
  // source.name "Bean Culture App" at creation (orders.js), so we can split
  // them out cleanly from walk-in Square POS sales.
  const appDayMap = new Map();
  let appRevenue = 0, appCount = 0;
  const appList = [];
  let revenue = 0, count = 0;
  // Retail bag mix: units + revenue per size (grams), across ALL stores' completed
  // orders (counter + app), wholesale excluded. Keyed by actual grams.
  const bagMix = new Map();
  let bagWholesaleUnits = 0, bagWholesaleRevenue = 0;
  // Diagnostic: busiest line items that carried NO weight, so a zero bag count can
  // show what's actually selling (to spot bags named without a gram/kg figure).
  const candidateMap = new Map();
  const bagScanLocationIds = allSquareLocationIds();
  let cursor, pages = 0;
  // Aggregate each page as it arrives (rather than collecting every order into
  // one array and capping at 10k) so a full 365-day window with high order
  // volume is never silently truncated — memory stays bounded to the maps, and
  // we page up to 200×500 = 100k orders.
  do {
    const data = await squareFetch('/v2/orders/search', {
      method: 'POST',
      body: {
        location_ids: bagScanLocationIds,
        query: {
          filter: {
            date_time_filter: { closed_at: { start_at: since.toISOString() } },
            state_filter: { states: ['COMPLETED'] },
          },
          sort: { sort_field: 'CLOSED_AT', sort_order: 'DESC' },
        },
        limit: 500,
        ...(cursor ? { cursor } : {}),
      },
    });
    for (const o of data.orders || []) {
      const amt = o.total_money?.amount || 0;
      const when = o.closed_at || o.created_at;
      const day = when ? new Date(when).toISOString().slice(0, 10) : null;

      // Retail bag mix — scan EVERY store's orders for bagged beans by weight.
      for (const li of (o.line_items || [])) {
        const qty = Math.max(0, parseFloat(li.quantity) || 0);
        if (!qty) continue;
        const g = bagGrams(li);
        const lineRev = (li.total_money && li.total_money.amount) || 0;
        if (g == null) {
          const label = `${li.name || 'Item'}${li.variation_name ? ' · ' + li.variation_name : ''}`;
          const c = candidateMap.get(label) || { units: 0 };
          c.units += qty; candidateMap.set(label, c);
          continue;
        }
        if (WHOLESALE_UNIT_CENTS.has(unitCents(li, qty))) { bagWholesaleUnits += qty; bagWholesaleRevenue += lineRev; continue; }
        const b = bagMix.get(g) || { units: 0, revenue: 0 };
        b.units += qty; b.revenue += lineRev;
        bagMix.set(g, b);
      }

      // Headline revenue / orders / clients / app stay scoped to the primary
      // location so those figures are unchanged (per-store detail is in Compare
      // stores); only the bag mix spans all stores.
      if (o.location_id && o.location_id !== LOCATION_ID) continue;
      revenue += amt; count += 1;
      if (day) {
        const e = dayMap.get(day) || { revenue: 0, orders: 0 };
        e.revenue += amt; e.orders += 1;
        dayMap.set(day, e);
      }
      if (o.customer_id) {
        const ce = clientMap.get(o.customer_id) || { revenue: 0, orders: 0 };
        ce.revenue += amt; ce.orders += 1;
        clientMap.set(o.customer_id, ce);
      }
      // App order? Tally its day + keep the individual order for the list.
      if (/bean culture/i.test((o.source && o.source.name) || '')) {
        appRevenue += amt; appCount += 1;
        if (day) {
          const ae = appDayMap.get(day) || { revenue: 0, orders: 0 };
          ae.revenue += amt; ae.orders += 1;
          appDayMap.set(day, ae);
        }
        // Orders arrive newest-first; keep the most recent 300 so the payload
        // stays bounded even over a long window.
        if (appList.length < 300) {
          appList.push({
            id: o.id,
            at: when || null,
            name: appOrderName(o),
            total: amt,
            items: (o.line_items || []).map((li) => ({
              name: li.name || 'Item',
              variation: li.variation_name || '',
              qty: li.quantity || '1',
              amount: (li.total_money && li.total_money.amount) || 0,
              modifiers: (li.modifiers || []).map((m) => m.name).filter(Boolean).join(', '),
            })),
          });
        }
      }
    }
    cursor = data.cursor;
    pages += 1;
  } while (cursor && pages < 200);

  const daily = [...dayMap.entries()]
    .map(([day, e]) => ({ day, revenue: e.revenue, orders: e.orders }))
    .sort((a, b) => a.day.localeCompare(b.day));
  const topClientIds = [...clientMap.entries()]
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, 10);
  const topClients = await resolveClientNames(topClientIds);
  const appDaily = [...appDayMap.entries()]
    .map(([day, e]) => ({ day, revenue: e.revenue, orders: e.orders }))
    .sort((a, b) => a.day.localeCompare(b.day));
  const app = {
    revenue: appRevenue,
    orders: appCount,
    avgOrder: appCount ? Math.round(appRevenue / appCount) : 0,
    daily: appDaily,
    // Newest first for the "each order" list.
    list: appList.sort((a, b) => String(b.at || '').localeCompare(String(a.at || ''))),
  };
  // Assemble the retail bag mix from WHATEVER weights actually sold, smallest
  // first, each with its share of retail units and a ratio against the smallest
  // selling size for an at-a-glance "200g : 500g : 1kg" reading.
  const bagSizes = [...bagMix.entries()]
    .map(([g, b]) => ({ grams: g, label: gramsLabel(g), units: Math.round(b.units), revenue: b.revenue }))
    .sort((a, b) => a.grams - b.grams);
  const bagTotalUnits = bagSizes.reduce((n, s) => n + s.units, 0);
  const bagTotalRevenue = bagSizes.reduce((n, s) => n + s.revenue, 0);
  const minUnits = Math.min(...bagSizes.map((s) => s.units).filter((u) => u > 0), Infinity);
  // Diagnostic: top no-weight items (only surfaced by the UI when nothing matched).
  const topItems = [...candidateMap.entries()]
    .map(([label, c]) => ({ label, units: Math.round(c.units) }))
    .sort((a, b) => b.units - a.units)
    .slice(0, 15);
  const bags = {
    sizes: bagSizes.map((s) => ({
      ...s,
      pct: bagTotalUnits ? Math.round((s.units / bagTotalUnits) * 1000) / 10 : 0,
      ratio: Number.isFinite(minUnits) && minUnits > 0 ? Math.round((s.units / minUnits) * 10) / 10 : 0,
    })),
    totalUnits: bagTotalUnits,
    totalRevenue: bagTotalRevenue,
    wholesaleExcludedUnits: Math.round(bagWholesaleUnits),
    wholesaleExcludedRevenue: bagWholesaleRevenue,
    storesScanned: bagScanLocationIds.length,
    // Shown only when nothing was detected, to reveal how bags are actually named.
    topItems,
  };
  return { revenue, orders: count, avgOrder: count ? Math.round(revenue / count) : 0, currency: CURRENCY, daily, topClients, app, bags };
}

// A human label for an app order in the dashboard list: the buyer's own name
// (bc_name) first, then the ticket name (stripping the legacy "TAKEAWAY "
// prefix), then the fulfillment recipient, and finally a short order code.
function appOrderName(o) {
  const md = o.metadata || {};
  if (md.bc_name) return String(md.bc_name).trim();
  const tn = (o.ticket_name || '').trim();
  if (tn) {
    const takeM = tn.match(/takeaway\s+(.+)/i);
    return (takeM ? takeM[1] : tn).trim();
  }
  const f = (o.fulfillments || [])[0];
  const rn = f && f.pickup_details && f.pickup_details.recipient && f.pickup_details.recipient.display_name;
  if (rn) return String(rn).trim();
  return `#${String(o.id || '').slice(-4)}`;
}

// Square orders only carry a customer_id, not a name — look the real people
// up so "Best clients" reads as names, not IDs. Best-effort: if the lookup
// fails for any reason, fall back to a short id-based label rather than
// dropping the row.
async function resolveClientNames(entries) {
  if (!entries.length) return [];
  let responses = {};
  try {
    const data = await squareFetch('/v2/customers/bulk-retrieve', {
      method: 'POST',
      body: { customer_ids: entries.map(([id]) => id) },
    });
    responses = data.responses || {};
  } catch {
    responses = {};
  }
  return entries.map(([id, stats]) => {
    const c = responses[id]?.customer;
    const name = c ? [c.given_name, c.family_name].filter(Boolean).join(' ').trim() || c.company_name || c.nickname : '';
    return { name: name || `Customer #${id.slice(-6)}`, revenue: stats.revenue, orders: stats.orders };
  });
}

module.exports = { salesSummary };
