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

module.exports = {
  init, getOverrides, saveOverrides,
  insertScheduled, listScheduledByCustomer, cancelScheduled, claimDue, updateScheduled,
  get enabled() { return !!pool; },
};
