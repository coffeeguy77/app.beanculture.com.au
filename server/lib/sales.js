// Real sales, straight from Square — completed orders in a date window,
// aggregated for the admin dashboard. (The app's own analytics track behaviour;
// this is the authoritative money figure.)

const { squareFetch, LOCATION_ID, CURRENCY } = require('./squareClient');

async function salesSummary(days = 30) {
  const since = new Date(Date.now() - days * 86400000);
  const orders = [];
  let cursor;
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
    for (const o of data.orders || []) orders.push(o);
    cursor = data.cursor;
  } while (cursor && orders.length < 10000);

  const dayMap = new Map();
  // Best clients: most walk-in POS sales are genuinely anonymous (no name is
  // ever taken at the counter), so a name-based guest bucket is mostly noise.
  // Only orders tied to a real customer_id — a loyalty member, whether they
  // ordered in the app or tapped their account in Square POS — count towards
  // this list; that's also the only case where "best client" is meaningful
  // (the same person, reliably, across visits).
  const clientMap = new Map();
  let revenue = 0;
  for (const o of orders) {
    const amt = o.total_money?.amount || 0;
    revenue += amt;
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
  }
  const count = orders.length;
  const daily = [...dayMap.entries()]
    .map(([day, e]) => ({ day, revenue: e.revenue, orders: e.orders }))
    .sort((a, b) => a.day.localeCompare(b.day));
  const topClientIds = [...clientMap.entries()]
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, 10);
  const topClients = await resolveClientNames(topClientIds);
  return { revenue, orders: count, avgOrder: count ? Math.round(revenue / count) : 0, currency: CURRENCY, daily, topClients };
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
