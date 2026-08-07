// Persistence layer (Postgres). Stores admin settings (single JSON blob, cached
// so getSettings() stays sync) and scheduled/recurring pre-orders. Degrades
// gracefully with no DATABASE_URL (settings fall back to defaults; scheduling off).

let pool = null;
let cache = {};
let ready = false;

async function init() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn('[db] DATABASE_URL not set — admin settings will not persist, scheduling disabled.');
    return;
  }
  try {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: url,
      ssl: url.includes('localhost') ? undefined : { rejectUnauthorized: false },
      max: 4,
    });
    await pool.query(
      'CREATE TABLE IF NOT EXISTS app_settings (id text primary key, data jsonb not null default \'{}\'::jsonb)'
    );
    await pool.query(`
      CREATE TABLE IF NOT EXISTS scheduled_orders (
        id text primary key,
        customer_id text,
        name text,
        phone text,
        dine_in boolean default false,
        tbl text,
        cart jsonb not null default '[]'::jsonb,
        card_id text,
        mode text default 'autocharge',
        recurrence jsonb,
        pickup_at timestamptz,
        next_run timestamptz,
        status text default 'active',
        label text,
        last_order_id text,
        last_error text,
        created_at timestamptz default now(),
        updated_at timestamptz default now()
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS scheduled_due ON scheduled_orders (status, next_run)');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS analytics_events (
        id bigserial primary key,
        type text not null,
        ref text,
        session text,
        qty integer default 1,
        amount integer default 0,
        ts timestamptz default now()
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS analytics_ts ON analytics_events (ts)');
    await pool.query('CREATE INDEX IF NOT EXISTS analytics_type ON analytics_events (type)');
    const r = await pool.query("SELECT data FROM app_settings WHERE id = 'main'");
    cache = (r.rows[0] && r.rows[0].data) || {};
    ready = true;
    console.log('[db] connected; settings loaded, scheduling enabled');
  } catch (e) {
    console.error('[db] init failed:', e.message);
    pool = null;
  }
}

function getOverrides() {
  return cache || {};
}

async function saveOverrides(obj) {
  cache = obj || {};
  if (!pool) throw new Error('No database configured (DATABASE_URL missing)');
  await pool.query(
    "INSERT INTO app_settings (id, data) VALUES ('main', $1) ON CONFLICT (id) DO UPDATE SET data = $1",
    [cache]
  );
}

// ---- Scheduled / recurring pre-orders ----
function rowToScheduled(r) {
  if (!r) return null;
  return {
    id: r.id,
    customerId: r.customer_id,
    name: r.name,
    phone: r.phone,
    dineIn: r.dine_in,
    table: r.tbl,
    cart: r.cart,
    cardId: r.card_id,
    mode: r.mode,
    recurrence: r.recurrence,
    pickupAt: r.pickup_at,
    nextRun: r.next_run,
    status: r.status,
    label: r.label,
    lastOrderId: r.last_order_id,
    lastError: r.last_error,
    createdAt: r.created_at,
  };
}

async function insertScheduled(o) {
  if (!pool) throw new Error('Scheduling is not available (no database configured)');
  const q = `INSERT INTO scheduled_orders
    (id, customer_id, name, phone, dine_in, tbl, cart, card_id, mode, recurrence, pickup_at, next_run, status, label)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'active',$13) RETURNING *`;
  const vals = [
    o.id, o.customerId, o.name || null, o.phone || null, !!o.dineIn, o.table || null,
    JSON.stringify(o.cart || []), o.cardId || null, o.mode || 'autocharge',
    o.recurrence ? JSON.stringify(o.recurrence) : null, o.pickupAt, o.nextRun, o.label || null,
  ];
  const r = await pool.query(q, vals);
  return rowToScheduled(r.rows[0]);
}

async function listScheduledByCustomer(customerId) {
  if (!pool || !customerId) return [];
  const r = await pool.query(
    "SELECT * FROM scheduled_orders WHERE customer_id = $1 AND status IN ('active','failed') ORDER BY next_run ASC",
    [customerId]
  );
  return r.rows.map(rowToScheduled);
}

async function cancelScheduled(id, customerId) {
  if (!pool) throw new Error('No database configured');
  const r = await pool.query(
    "UPDATE scheduled_orders SET status='cancelled', updated_at=now() WHERE id=$1 AND customer_id=$2 AND status IN ('active','failed') RETURNING id",
    [id, customerId]
  );
  return r.rowCount > 0;
}

// Atomically claim due orders so a restart / overlap can't double-charge.
async function claimDue(limit = 20) {
  if (!pool) return [];
  const r = await pool.query(
    `UPDATE scheduled_orders SET status='processing', updated_at=now()
     WHERE id IN (
       SELECT id FROM scheduled_orders
       WHERE (status='active' AND next_run <= now())
          OR (status='processing' AND updated_at < now() - interval '10 minutes')
       ORDER BY next_run ASC LIMIT $1 FOR UPDATE SKIP LOCKED
     ) RETURNING *`,
    [limit]
  );
  return r.rows.map(rowToScheduled);
}

async function updateScheduled(id, patch) {
  if (!pool) return;
  const sets = [];
  const vals = [];
  let i = 1;
  const map = {
    status: 'status', nextRun: 'next_run', pickupAt: 'pickup_at',
    lastOrderId: 'last_order_id', lastError: 'last_error',
  };
  for (const k of Object.keys(patch)) {
    if (map[k]) { sets.push(`${map[k]} = $${i++}`); vals.push(patch[k]); }
  }
  if (!sets.length) return;
  sets.push('updated_at = now()');
  vals.push(id);
  await pool.query(`UPDATE scheduled_orders SET ${sets.join(', ')} WHERE id = $${i}`, vals);
}

// ---- Analytics ----
async function track(events) {
  if (!pool || !Array.isArray(events) || !events.length) return;
  const rows = events.slice(0, 50);
  const vals = [];
  const ph = rows.map((e, i) => {
    const b = i * 5;
    vals.push(String(e.type || 'view').slice(0, 40), (e.ref || null) && String(e.ref).slice(0, 120),
      (e.session || null) && String(e.session).slice(0, 64), Number(e.qty) || 1, Number(e.amount) || 0);
    return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5})`;
  });
  await pool.query(`INSERT INTO analytics_events (type, ref, session, qty, amount) VALUES ${ph.join(',')}`, vals);
}

async function getAnalytics(days = 30) {
  if (!pool) return null;
  const since = `now() - interval '${Math.max(1, Math.min(365, days))} days'`;
  const q = (sql) => pool.query(sql.replace('$SINCE', since));
  const [tot, daily, topView, topBuy, contact] = await Promise.all([
    q(`SELECT
        count(*) FILTER (WHERE type='view') AS views,
        count(DISTINCT session) FILTER (WHERE type='view') AS visitors,
        count(*) FILTER (WHERE type='product_view') AS product_views,
        count(*) FILTER (WHERE type='add_cart') AS add_cart,
        count(*) FILTER (WHERE type='checkout') AS checkouts,
        count(*) FILTER (WHERE type='purchase') AS purchases,
        coalesce(sum(amount) FILTER (WHERE type='purchase'),0) AS revenue,
        count(*) FILTER (WHERE type LIKE 'contact_%') AS contact_clicks
       FROM analytics_events WHERE ts >= $SINCE`),
    q(`SELECT to_char(date_trunc('day', ts), 'YYYY-MM-DD') AS day,
        count(*) FILTER (WHERE type='view') AS views,
        count(*) FILTER (WHERE type='purchase') AS purchases
       FROM analytics_events WHERE ts >= $SINCE GROUP BY 1 ORDER BY 1`),
    q(`SELECT ref, count(*) AS n FROM analytics_events WHERE type='product_view' AND ts >= $SINCE AND ref IS NOT NULL GROUP BY ref ORDER BY n DESC LIMIT 8`),
    q(`SELECT ref, sum(qty) AS n FROM analytics_events WHERE type='purchase_item' AND ts >= $SINCE AND ref IS NOT NULL GROUP BY ref ORDER BY n DESC LIMIT 8`),
    q(`SELECT type, count(*) AS n FROM analytics_events WHERE type LIKE 'contact_%' AND ts >= $SINCE GROUP BY type`),
  ]);
  const t = tot.rows[0] || {};
  const num = (x) => Number(x || 0);
  return {
    days,
    totals: {
      views: num(t.views), visitors: num(t.visitors), productViews: num(t.product_views),
      addCart: num(t.add_cart), checkouts: num(t.checkouts), purchases: num(t.purchases),
      revenue: num(t.revenue), contactClicks: num(t.contact_clicks),
    },
    daily: daily.rows.map((r) => ({ day: r.day, views: num(r.views), purchases: num(r.purchases) })),
    topViewed: topView.rows.map((r) => ({ name: r.ref, n: num(r.n) })),
    topPurchased: topBuy.rows.map((r) => ({ name: r.ref, n: num(r.n) })),
    contact: contact.rows.map((r) => ({ type: r.type, n: num(r.n) })),
  };
}

module.exports = {
  init, getOverrides, saveOverrides,
  insertScheduled, listScheduledByCustomer, cancelScheduled, claimDue, updateScheduled,
  track, getAnalytics,
  get enabled() { return !!pool; },
};
