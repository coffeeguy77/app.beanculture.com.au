// Real sales, straight from Square — completed orders in a date window,
// aggregated for the admin dashboard. (The app's own analytics track behaviour;
// this is the authoritative money figure.)

const { squareFetch, LOCATION_ID, CURRENCY } = require('./squareClient');

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
  let cursor, pages = 0;
  // Aggregate each page as it arrives (rather than collecting every order into
  // one array and capping at 10k) so a full 365-day window with high order
  // volume is never silently truncated — memory stays bounded to the maps, and
  // we page up to 200×500 = 100k orders.
  do {
    const data = await squareFetch('/v2/orders/search', {
      method: 'POST',
      body: {
        location_ids: [LOCATION_ID],
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
      revenue += amt; count += 1;
      const when = o.closed_at || o.created_at;
      const day = when ? new Date(when).toISOString().slice(0, 10) : null;
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
  return { revenue, orders: count, avgOrder: count ? Math.round(revenue / count) : 0, currency: CURRENCY, daily, topClients, app };
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
