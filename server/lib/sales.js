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
  let revenue = 0;
  for (const o of orders) {
    const amt = o.total_money?.amount || 0;
    revenue += amt;
    const when = o.closed_at || o.created_at;
    const day = when ? new Date(when).toISOString().slice(0, 10) : null;
    if (!day) continue;
    const e = dayMap.get(day) || { revenue: 0, orders: 0 };
    e.revenue += amt; e.orders += 1;
    dayMap.set(day, e);
  }
  const count = orders.length;
  const daily = [...dayMap.entries()]
    .map(([day, e]) => ({ day, revenue: e.revenue, orders: e.orders }))
    .sort((a, b) => a.day.localeCompare(b.day));
  return { revenue, orders: count, avgOrder: count ? Math.round(revenue / count) : 0, currency: CURRENCY, daily };
}

module.exports = { salesSummary };
