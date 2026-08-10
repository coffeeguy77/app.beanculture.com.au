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
  // Best clients: grouped by the logged-in customer_id when the order was
  // placed signed-in, otherwise by the name typed at checkout (pickup
  // recipient) so guest regulars still show up, just not de-duplicated
  // across visits the way a real account is.
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
    const name = (o.fulfillments || []).find((f) => f.pickup_details)?.pickup_details?.recipient?.display_name
      || o.ticket_name || 'Guest';
    const key = o.customer_id || `name:${name.toLowerCase()}`;
    const ce = clientMap.get(key) || { name, revenue: 0, orders: 0, lastAt: null };
    ce.revenue += amt; ce.orders += 1;
    if (!ce.lastAt || (when && when > ce.lastAt)) ce.lastAt = when;
    clientMap.set(key, ce);
  }
  const count = orders.length;
  const daily = [...dayMap.entries()]
    .map(([day, e]) => ({ day, revenue: e.revenue, orders: e.orders }))
    .sort((a, b) => a.day.localeCompare(b.day));
  const topClients = [...clientMap.values()]
    .filter((c) => c.name && c.name !== 'Guest')
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);
  return { revenue, orders: count, avgOrder: count ? Math.round(revenue / count) : 0, currency: CURRENCY, daily, topClients };
}

module.exports = { salesSummary };
