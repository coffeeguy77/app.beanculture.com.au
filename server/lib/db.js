// Persistence layer (Postgres). Stores admin settings (single JSON blob, cached
// so getSettings() stays sync) and scheduled/recurring pre-orders. Degrades
// gracefully with no DATABASE_URL (settings fall back to defaults; scheduling off).

let pool = null;
let cache = {};
let ready = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function init(attempt = 1) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn('[db] DATABASE_URL not set — admin settings will not persist, scheduling disabled.');
    return;
  }
  const MAX_ATTEMPTS = 6;
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
        payment_id text,
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
    await pool.query('ALTER TABLE scheduled_orders ADD COLUMN IF NOT EXISTS payment_id text');
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
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id bigserial primary key,
        type text not null default 'enquiry',
        name text,
        contact text,
        body text not null,
        handled boolean default false,
        created_at timestamptz default now()
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS messages_ts ON messages (created_at)');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS reservations (
        id bigserial primary key,
        name text,
        phone text,
        email text,
        party integer default 2,
        reserve_at timestamptz,
        notes text,
        status text default 'pending',
        square_order_id text,
        created_at timestamptz default now()
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS reservations_at ON reservations (reserve_at)');

    // ---- Pay It Forward (gift-a-coffee) ----
    // Master ledger. remaining_cents is the only source of truth for spendable
    // balance -- never recomputed client-side. status covers the payment /
    // redemption lifecycle; viewed_at/claimed_at are separate timestamps so we
    // never overload one field for two different concepts (per spec).
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pay_it_forward_gifts (
        id text primary key,
        token text unique not null,
        code text unique not null,
        gift_type text not null default 'DIRECT',
        purchaser_customer_id text,
        purchaser_name text,
        purchaser_phone text,
        purchaser_notify boolean default true,
        recipient_name text,
        recipient_phone text,
        recipient_email text,
        recipient_customer_id text,
        message text,
        value_cents integer not null,
        remaining_cents integer not null,
        currency text default 'AUD',
        payment_method text not null,
        square_payment_id text,
        loyalty_order_id text,
        loyalty_points_used integer,
        status text not null default 'PENDING_PAYMENT',
        sms_status text default 'PENDING',
        sms_attempts integer default 0,
        marketing_consent boolean default false,
        marketing_consent_at timestamptz,
        marketing_consent_source text,
        idempotency_key text,
        created_at timestamptz default now(),
        viewed_at timestamptz,
        claimed_at timestamptz,
        expires_at timestamptz,
        cancelled_at timestamptz,
        updated_at timestamptz default now()
      )
    `);
    await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS pif_gifts_idem ON pay_it_forward_gifts (idempotency_key) WHERE idempotency_key IS NOT NULL');
    await pool.query('CREATE INDEX IF NOT EXISTS pif_gifts_status ON pay_it_forward_gifts (status)');
    await pool.query('CREATE INDEX IF NOT EXISTS pif_gifts_purchaser ON pay_it_forward_gifts (purchaser_customer_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS pif_gifts_recipient_phone ON pay_it_forward_gifts (recipient_phone)');
    await pool.query('CREATE INDEX IF NOT EXISTS pif_gifts_expires ON pay_it_forward_gifts (expires_at)');
    await pool.query('CREATE INDEX IF NOT EXISTS pif_gifts_created ON pay_it_forward_gifts (created_at)');

    // Append-only audit trail -- one row per redemption event. Never overwrite;
    // remaining balance always moves forward via this trail.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pay_it_forward_redemptions (
        id bigserial primary key,
        gift_id text not null references pay_it_forward_gifts(id),
        order_id text,
        amount_cents integer not null,
        remaining_after_cents integer not null,
        redeemed_by_customer_id text,
        created_at timestamptz default now()
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS pif_redemptions_gift ON pay_it_forward_redemptions (gift_id)');

    // Timeline / analytics feed for the admin gift-detail view.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pay_it_forward_events (
        id bigserial primary key,
        gift_id text,
        type text not null,
        meta jsonb,
        created_at timestamptz default now()
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS pif_events_gift ON pay_it_forward_events (gift_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS pif_events_ts ON pay_it_forward_events (created_at)');

    // Kitchen-display per-(order,zone) bump state. Orders themselves live in
    // Square; this only records what each station has done with each ticket.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS kds_tickets (
        order_id text not null,
        zone text not null,
        status text not null default 'new',
        started_at timestamptz,
        bumped_at timestamptz,
        updated_at timestamptz default now(),
        primary key (order_id, zone)
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS kds_updated ON kds_tickets (updated_at)');

    const r = await pool.query("SELECT data FROM app_settings WHERE id = 'main'");
    cache = (r.rows[0] && r.rows[0].data) || {};
    ready = true;
    console.log('[db] connected; settings loaded, scheduling enabled');
  } catch (e) {
    // A transient blip (common when the DB and web service redeploy together)
    // shouldn't disable persistence for the whole deployment — retry a few times
    // with backoff before giving up.
    try { await pool?.end(); } catch {}
    pool = null;
    if (attempt < MAX_ATTEMPTS) {
      const wait = Math.min(1000 * 2 ** (attempt - 1), 8000);
      console.warn(`[db] init attempt ${attempt} failed (${e.message}); retrying in ${wait}ms`);
      await sleep(wait);
      return init(attempt + 1);
    }
    console.error('[db] init failed after retries:', e.message);
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
    paymentId: r.payment_id,
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
    (id, customer_id, name, phone, dine_in, tbl, cart, card_id, payment_id, mode, recurrence, pickup_at, next_run, status, label, last_order_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'active',$14,$15) RETURNING *`;
  const vals = [
    o.id, o.customerId, o.name || null, o.phone || null, !!o.dineIn, o.table || null,
    JSON.stringify(o.cart || []), o.cardId || null, o.paymentId || null, o.mode || 'autocharge',
    o.recurrence ? JSON.stringify(o.recurrence) : null, o.pickupAt, o.nextRun, o.label || null, o.lastOrderId || null,
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
    "UPDATE scheduled_orders SET status='cancelled', updated_at=now() WHERE id=$1 AND customer_id=$2 AND status IN ('active','failed') RETURNING *",
    [id, customerId]
  );
  return r.rows[0] ? rowToScheduled(r.rows[0]) : null;
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
  const [tot, daily, topView, topBuy, contact, sources, products] = await Promise.all([
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
    q(`SELECT coalesce(nullif(ref,''),'direct') AS source, count(*) AS n FROM analytics_events WHERE type='view' AND ts >= $SINCE GROUP BY 1 ORDER BY n DESC LIMIT 12`),
    q(`SELECT ref AS name,
        count(*) FILTER (WHERE type='product_view') AS views,
        count(*) FILTER (WHERE type='add_cart') AS carts,
        coalesce(sum(qty) FILTER (WHERE type='purchase_item'),0) AS purchased,
        coalesce(sum(amount) FILTER (WHERE type='purchase_item'),0) AS revenue
       FROM analytics_events
       WHERE ref IS NOT NULL AND ref <> '' AND type IN ('product_view','add_cart','purchase_item') AND ts >= $SINCE
       GROUP BY ref ORDER BY views DESC, purchased DESC LIMIT 50`),
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
    sources: sources.rows.map((r) => ({ source: r.source, n: num(r.n) })),
    products: products.rows.map((r) => ({ name: r.name, views: num(r.views), carts: num(r.carts), purchased: num(r.purchased), revenue: num(r.revenue) })),
  };
}

// ---- Customer messages (enquiry / feedback / catering) ----
async function insertMessage({ type, name, contact, body }) {
  if (!pool) throw new Error('Messaging is not available right now.');
  const r = await pool.query(
    "INSERT INTO messages (type, name, contact, body) VALUES ($1,$2,$3,$4) RETURNING id, created_at",
    [String(type || 'enquiry').slice(0, 20), (name || '').slice(0, 120), (contact || '').slice(0, 200), String(body || '').slice(0, 4000)]
  );
  return r.rows[0];
}
async function listMessages(limit = 100) {
  if (!pool) return [];
  const r = await pool.query('SELECT id, type, name, contact, body, handled, created_at FROM messages ORDER BY created_at DESC LIMIT $1', [Math.min(limit, 300)]);
  return r.rows.map((m) => ({ id: String(m.id), type: m.type, name: m.name, contact: m.contact, body: m.body, handled: m.handled, createdAt: m.created_at }));
}
async function markMessageHandled(id, handled = true) {
  if (!pool) return;
  await pool.query('UPDATE messages SET handled = $2 WHERE id = $1', [id, !!handled]);
}

// ---- Table reservations ----
async function insertReservation({ name, phone, email, party, reserveAt, notes, squareOrderId }) {
  if (!pool) throw new Error('Reservations are not available right now.');
  const r = await pool.query(
    `INSERT INTO reservations (name, phone, email, party, reserve_at, notes, square_order_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, created_at`,
    [(name || '').slice(0, 120), (phone || '').slice(0, 40), (email || '').slice(0, 160),
      Math.max(1, Math.min(50, parseInt(party, 10) || 2)), reserveAt || null, String(notes || '').slice(0, 1000), squareOrderId || null]
  );
  return r.rows[0];
}
async function listReservations(limit = 200) {
  if (!pool) return [];
  const r = await pool.query('SELECT id, name, phone, email, party, reserve_at, notes, status, created_at FROM reservations ORDER BY reserve_at DESC NULLS LAST LIMIT $1', [Math.min(limit, 500)]);
  return r.rows.map((x) => ({ id: String(x.id), name: x.name, phone: x.phone, email: x.email, party: x.party, reserveAt: x.reserve_at, notes: x.notes, status: x.status, createdAt: x.created_at }));
}
async function setReservationStatus(id, status) {
  if (!pool) return;
  const allowed = ['pending', 'confirmed', 'seated', 'cancelled'];
  await pool.query('UPDATE reservations SET status = $2 WHERE id = $1', [id, allowed.includes(status) ? status : 'pending']);
}
async function deleteReservation(id) {
  if (!pool) return;
  await pool.query('DELETE FROM reservations WHERE id = $1', [id]);
}

// ---- Pay It Forward (gift-a-coffee) ----
function rowToGift(r) {
  if (!r) return null;
  return {
    id: r.id,
    token: r.token,
    code: r.code,
    giftType: r.gift_type,
    purchaserCustomerId: r.purchaser_customer_id,
    purchaserName: r.purchaser_name,
    purchaserPhone: r.purchaser_phone,
    purchaserNotify: r.purchaser_notify,
    recipientName: r.recipient_name,
    recipientPhone: r.recipient_phone,
    recipientEmail: r.recipient_email,
    recipientCustomerId: r.recipient_customer_id,
    message: r.message,
    valueCents: r.value_cents,
    remainingCents: r.remaining_cents,
    currency: r.currency,
    paymentMethod: r.payment_method,
    squarePaymentId: r.square_payment_id,
    loyaltyOrderId: r.loyalty_order_id,
    loyaltyPointsUsed: r.loyalty_points_used,
    status: r.status,
    smsStatus: r.sms_status,
    smsAttempts: r.sms_attempts,
    marketingConsent: r.marketing_consent,
    marketingConsentAt: r.marketing_consent_at,
    marketingConsentSource: r.marketing_consent_source,
    createdAt: r.created_at,
    viewedAt: r.viewed_at,
    claimedAt: r.claimed_at,
    expiresAt: r.expires_at,
    cancelledAt: r.cancelled_at,
    updatedAt: r.updated_at,
  };
}

async function pifInsertGift(g) {
  if (!pool) throw new Error('Pay It Forward is not available right now (no database configured)');
  const q = `INSERT INTO pay_it_forward_gifts
    (id, token, code, gift_type, purchaser_customer_id, purchaser_name, purchaser_phone, purchaser_notify,
     recipient_name, recipient_phone, recipient_email, message, value_cents, remaining_cents, currency,
     payment_method, status, expires_at, idempotency_key)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
    ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
    RETURNING *`;
  const vals = [
    g.id, g.token, g.code, g.giftType || 'DIRECT', g.purchaserCustomerId || null, g.purchaserName || null,
    g.purchaserPhone || null, g.purchaserNotify !== false, g.recipientName || null, g.recipientPhone || null,
    g.recipientEmail || null, g.message || null, g.valueCents, g.valueCents, g.currency || 'AUD',
    g.paymentMethod, g.status || 'PENDING_PAYMENT', g.expiresAt || null, g.idempotencyKey || null,
  ];
  const r = await pool.query(q, vals);
  if (r.rows[0]) return rowToGift(r.rows[0]);
  if (g.idempotencyKey) {
    const existing = await pool.query('SELECT * FROM pay_it_forward_gifts WHERE idempotency_key = $1', [g.idempotencyKey]);
    return rowToGift(existing.rows[0]);
  }
  return null;
}

async function pifGetById(id) {
  if (!pool || !id) return null;
  const r = await pool.query('SELECT * FROM pay_it_forward_gifts WHERE id = $1', [id]);
  return rowToGift(r.rows[0]);
}

async function pifGetByToken(token) {
  if (!pool || !token) return null;
  const r = await pool.query('SELECT * FROM pay_it_forward_gifts WHERE token = $1', [token]);
  return rowToGift(r.rows[0]);
}

async function pifGetByCode(code) {
  if (!pool || !code) return null;
  const r = await pool.query('SELECT * FROM pay_it_forward_gifts WHERE code = $1', [String(code).toUpperCase()]);
  return rowToGift(r.rows[0]);
}

async function pifSetPaymentResult(id, { status, squarePaymentId, loyaltyOrderId, loyaltyPointsUsed }) {
  if (!pool) return null;
  const r = await pool.query(
    `UPDATE pay_it_forward_gifts SET status=$2, square_payment_id=coalesce($3,square_payment_id),
     loyalty_order_id=coalesce($4,loyalty_order_id), loyalty_points_used=coalesce($5,loyalty_points_used),
     updated_at=now() WHERE id=$1 RETURNING *`,
    [id, status, squarePaymentId || null, loyaltyOrderId || null, loyaltyPointsUsed || null]
  );
  return rowToGift(r.rows[0]);
}

async function pifSetGiftValue(id, valueCents) {
  if (!pool) return null;
  const r = await pool.query(
    'UPDATE pay_it_forward_gifts SET value_cents=$2, remaining_cents=$2, updated_at=now() WHERE id=$1 RETURNING *',
    [id, Math.round(valueCents)]
  );
  return rowToGift(r.rows[0]);
}

async function pifMarkViewed(token) {
  if (!pool) return null;
  const r = await pool.query(
    "UPDATE pay_it_forward_gifts SET viewed_at = coalesce(viewed_at, now()), updated_at = now() WHERE token = $1 RETURNING *",
    [token]
  );
  return rowToGift(r.rows[0]);
}

async function pifMarkClaimed(token, { recipientCustomerId, marketingConsent, marketingConsentSource }) {
  if (!pool) return null;
  const r = await pool.query(
    `UPDATE pay_it_forward_gifts SET claimed_at = coalesce(claimed_at, now()),
     recipient_customer_id = coalesce($2, recipient_customer_id),
     marketing_consent = coalesce($3, marketing_consent),
     marketing_consent_at = CASE WHEN $3 THEN now() ELSE marketing_consent_at END,
     marketing_consent_source = coalesce($4, marketing_consent_source),
     updated_at = now()
     WHERE token = $1 RETURNING *`,
    [token, recipientCustomerId || null, marketingConsent === true, marketingConsentSource || null]
  );
  return rowToGift(r.rows[0]);
}

async function pifUpdateSms(id, { status, incrementAttempts }) {
  if (!pool) return;
  await pool.query(
    'UPDATE pay_it_forward_gifts SET sms_status = coalesce($2, sms_status), sms_attempts = sms_attempts + $3, updated_at = now() WHERE id = $1',
    [id, status || null, incrementAttempts ? 1 : 0]
  );
}

async function pifReserve(giftId, amountCents, { redeemedByCustomerId } = {}) {
  if (!pool) throw new Error('Pay It Forward is not available right now (no database configured)');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query('SELECT * FROM pay_it_forward_gifts WHERE id = $1 FOR UPDATE', [giftId]);
    const row = cur.rows[0];
    if (!row) { await client.query('ROLLBACK'); return { ok: false, reason: 'not_found' }; }
    if (!['ACTIVE', 'PARTIALLY_REDEEMED'].includes(row.status)) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'not_redeemable', status: row.status };
    }
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'expired' };
    }
    const amount = Math.max(0, Math.min(Math.round(amountCents), row.remaining_cents));
    if (amount <= 0) { await client.query('ROLLBACK'); return { ok: false, reason: 'zero_amount' }; }
    const remainingAfter = row.remaining_cents - amount;
    const newStatus = remainingAfter <= 0 ? 'REDEEMED' : 'PARTIALLY_REDEEMED';
    await client.query(
      'UPDATE pay_it_forward_gifts SET remaining_cents = $2, status = $3, updated_at = now() WHERE id = $1',
      [giftId, remainingAfter, newStatus]
    );
    const ins = await client.query(
      'INSERT INTO pay_it_forward_redemptions (gift_id, order_id, amount_cents, remaining_after_cents, redeemed_by_customer_id) VALUES ($1,NULL,$2,$3,$4) RETURNING id',
      [giftId, amount, remainingAfter, redeemedByCustomerId || null]
    );
    await client.query('COMMIT');
    return { ok: true, redemptionId: ins.rows[0].id, amountCents: amount, remainingCents: remainingAfter, status: newStatus };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function pifConfirmRedemption(redemptionId, orderId) {
  if (!pool) return null;
  const r = await pool.query('UPDATE pay_it_forward_redemptions SET order_id = $2 WHERE id = $1 RETURNING gift_id, amount_cents, remaining_after_cents', [redemptionId, orderId]);
  const row = r.rows[0];
  if (!row) return null;
  await pool.query(
    "INSERT INTO pay_it_forward_events (gift_id, type, meta) VALUES ($1, 'redeemed', $2)",
    [row.gift_id, JSON.stringify({ redemptionId, orderId, amountCents: row.amount_cents, remainingAfter: row.remaining_after_cents })]
  );
  return { giftId: row.gift_id, amountCents: row.amount_cents, remainingAfterCents: row.remaining_after_cents };
}

async function pifReleaseRedemption(redemptionId) {
  if (!pool) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query('SELECT * FROM pay_it_forward_redemptions WHERE id = $1 AND order_id IS NULL FOR UPDATE', [redemptionId]);
    const row = cur.rows[0];
    if (!row) { await client.query('ROLLBACK'); return; }
    const g = await client.query('SELECT remaining_cents, value_cents FROM pay_it_forward_gifts WHERE id = $1 FOR UPDATE', [row.gift_id]);
    const gift = g.rows[0];
    if (gift) {
      const restored = Math.min(gift.remaining_cents + row.amount_cents, gift.value_cents);
      const status = restored >= gift.value_cents ? 'ACTIVE' : 'PARTIALLY_REDEEMED';
      await client.query('UPDATE pay_it_forward_gifts SET remaining_cents = $2, status = $3, updated_at = now() WHERE id = $1', [row.gift_id, restored, status]);
    }
    await client.query('DELETE FROM pay_it_forward_redemptions WHERE id = $1', [redemptionId]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function pifActivate(id) {
  if (!pool) return null;
  const r = await pool.query(
    "UPDATE pay_it_forward_gifts SET status = 'ACTIVE', updated_at = now() WHERE id = $1 AND status = 'PENDING_PAYMENT' RETURNING *",
    [id]
  );
  return rowToGift(r.rows[0]);
}

async function pifCancel(id) {
  if (!pool) return null;
  const r = await pool.query(
    `UPDATE pay_it_forward_gifts SET status = 'CANCELLED', cancelled_at = now(), updated_at = now()
     WHERE id = $1 AND status = 'ACTIVE' AND remaining_cents = value_cents RETURNING *`,
    [id]
  );
  return rowToGift(r.rows[0]);
}

async function pifRefund(id, refundStatus = 'REFUNDED') {
  if (!pool) return null;
  const r = await pool.query(
    "UPDATE pay_it_forward_gifts SET status = $2, updated_at = now() WHERE id = $1 RETURNING *",
    [id, refundStatus]
  );
  return rowToGift(r.rows[0]);
}

async function pifExpireDue(limit = 200) {
  if (!pool) return [];
  const r = await pool.query(
    `UPDATE pay_it_forward_gifts SET status = 'EXPIRED', updated_at = now()
     WHERE id IN (
       SELECT id FROM pay_it_forward_gifts
       WHERE status IN ('ACTIVE','PARTIALLY_REDEEMED') AND expires_at IS NOT NULL AND expires_at < now()
       LIMIT $1
     ) RETURNING id`,
    [limit]
  );
  return r.rows.map((x) => x.id);
}

async function pifListByPurchaser(customerId, limit = 100) {
  if (!pool || !customerId) return [];
  const r = await pool.query(
    'SELECT * FROM pay_it_forward_gifts WHERE purchaser_customer_id = $1 ORDER BY created_at DESC LIMIT $2',
    [customerId, Math.min(limit, 300)]
  );
  return r.rows.map(rowToGift);
}

async function pifListByRecipientPhone(phone, limit = 100) {
  if (!pool || !phone) return [];
  const r = await pool.query(
    "SELECT * FROM pay_it_forward_gifts WHERE recipient_phone = $1 AND status != 'PENDING_PAYMENT' ORDER BY created_at DESC LIMIT $2",
    [phone, Math.min(limit, 300)]
  );
  return r.rows.map(rowToGift);
}

async function pifListAdmin({ status, search, limit = 100, offset = 0 } = {}) {
  if (!pool) return { rows: [], total: 0 };
  const clauses = [];
  const vals = [];
  let i = 1;
  if (status) { clauses.push(`status = $${i++}`); vals.push(status); }
  if (search) {
    clauses.push(`(recipient_name ILIKE $${i} OR recipient_phone ILIKE $${i} OR purchaser_name ILIKE $${i} OR code ILIKE $${i})`);
    vals.push(`%${search}%`); i++;
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const r = await pool.query(`SELECT * FROM pay_it_forward_gifts ${where} ORDER BY created_at DESC LIMIT $${i} OFFSET $${i + 1}`, [...vals, Math.min(limit, 300), offset]);
  const c = await pool.query(`SELECT count(*) FROM pay_it_forward_gifts ${where}`, vals);
  return { rows: r.rows.map(rowToGift), total: Number(c.rows[0]?.count || 0) };
}

async function pifEvents(giftId, limit = 100) {
  if (!pool || !giftId) return [];
  const r = await pool.query('SELECT * FROM pay_it_forward_events WHERE gift_id = $1 ORDER BY created_at ASC LIMIT $2', [giftId, limit]);
  return r.rows.map((e) => ({ id: String(e.id), giftId: e.gift_id, type: e.type, meta: e.meta, createdAt: e.created_at }));
}

async function pifLogEvent(giftId, type, meta) {
  if (!pool) return;
  await pool.query('INSERT INTO pay_it_forward_events (gift_id, type, meta) VALUES ($1,$2,$3)', [giftId, type, meta ? JSON.stringify(meta) : null]);
}

async function pifRedemptions(giftId) {
  if (!pool || !giftId) return [];
  const r = await pool.query('SELECT * FROM pay_it_forward_redemptions WHERE gift_id = $1 ORDER BY created_at ASC', [giftId]);
  return r.rows.map((x) => ({
    id: String(x.id), giftId: x.gift_id, orderId: x.order_id, amountCents: x.amount_cents,
    remainingAfterCents: x.remaining_after_cents, redeemedByCustomerId: x.redeemed_by_customer_id, createdAt: x.created_at,
  }));
}

async function pifKpis(days = 90) {
  if (!pool) return null;
  const since = `now() - interval '${Math.max(1, Math.min(730, days))} days'`;
  const q = (sql) => pool.query(sql.replace('$SINCE', since));
  const [totals, byMethod, daily, outstanding] = await Promise.all([
    q(`SELECT
        count(*) FILTER (WHERE status != 'PENDING_PAYMENT') AS gifts_purchased,
        coalesce(sum(value_cents) FILTER (WHERE status != 'PENDING_PAYMENT'),0) AS value_gifted,
        coalesce(sum(value_cents - remaining_cents) FILTER (WHERE status != 'PENDING_PAYMENT'),0) AS value_redeemed,
        count(*) FILTER (WHERE status = 'REDEEMED') AS fully_redeemed,
        count(DISTINCT recipient_customer_id) FILTER (WHERE recipient_customer_id IS NOT NULL) AS unique_recipients
       FROM pay_it_forward_gifts WHERE created_at >= $SINCE`),
    q(`SELECT payment_method, count(*) AS n, coalesce(sum(value_cents),0) AS v
       FROM pay_it_forward_gifts WHERE status != 'PENDING_PAYMENT' AND created_at >= $SINCE GROUP BY payment_method`),
    q(`SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
        count(*) FILTER (WHERE status != 'PENDING_PAYMENT') AS gifted,
        coalesce(sum(value_cents) FILTER (WHERE status != 'PENDING_PAYMENT'),0) AS gifted_value
       FROM pay_it_forward_gifts WHERE created_at >= $SINCE GROUP BY 1 ORDER BY 1`),
    q(`SELECT count(*) AS n, coalesce(sum(remaining_cents),0) AS v FROM pay_it_forward_gifts WHERE status IN ('ACTIVE','PARTIALLY_REDEEMED')`),
  ]);
  const t = totals.rows[0] || {};
  const out = outstanding.rows[0] || {};
  const num = (x) => Number(x || 0);
  return {
    days,
    giftsPurchased: num(t.gifts_purchased),
    valueGiftedCents: num(t.value_gifted),
    valueRedeemedCents: num(t.value_redeemed),
    fullyRedeemed: num(t.fully_redeemed),
    uniqueRecipients: num(t.unique_recipients),
    redemptionRate: num(t.gifts_purchased) ? num(t.fully_redeemed) / num(t.gifts_purchased) : 0,
    outstandingCount: num(out.n),
    outstandingValueCents: num(out.v),
    byMethod: byMethod.rows.map((r) => ({ method: r.payment_method, count: num(r.n), valueCents: num(r.v) })),
    daily: daily.rows.map((r) => ({ day: r.day, gifted: num(r.gifted), giftedValueCents: num(r.gifted_value) })),
  };
}

// ---- Kitchen display (per order+zone bump state) ----
async function kdsGetStates(orderIds) {
  if (!pool || !orderIds || !orderIds.length) return {};
  const r = await pool.query(
    'SELECT order_id, zone, status, started_at, bumped_at FROM kds_tickets WHERE order_id = ANY($1)',
    [orderIds]
  );
  const out = {};
  for (const x of r.rows) {
    (out[x.order_id] = out[x.order_id] || {})[x.zone] = {
      status: x.status, startedAt: x.started_at, bumpedAt: x.bumped_at,
    };
  }
  return out;
}
async function kdsSetStatus(orderId, zone, status) {
  if (!pool) throw new Error('The kitchen screen needs the database to remember bumps.');
  const r = await pool.query(
    `INSERT INTO kds_tickets (order_id, zone, status, started_at, bumped_at, updated_at)
     VALUES ($1, $2, $3,
       CASE WHEN $3 = 'preparing' THEN now() ELSE NULL END,
       CASE WHEN $3 = 'done' THEN now() ELSE NULL END,
       now())
     ON CONFLICT (order_id, zone) DO UPDATE SET
       status = $3,
       started_at = CASE WHEN $3 = 'preparing' AND kds_tickets.started_at IS NULL THEN now() ELSE kds_tickets.started_at END,
       bumped_at = CASE WHEN $3 = 'done' THEN now() ELSE NULL END,
       updated_at = now()
     RETURNING order_id, zone, status`,
    [orderId, zone, status]
  );
  return r.rows[0];
}

module.exports = {
  init, getOverrides, saveOverrides,
  kdsGetStates, kdsSetStatus,
  insertScheduled, listScheduledByCustomer, cancelScheduled, claimDue, updateScheduled,
  track, getAnalytics,
  insertMessage, listMessages, markMessageHandled,
  insertReservation, listReservations, setReservationStatus, deleteReservation,
  pifInsertGift, pifGetById, pifGetByToken, pifGetByCode, pifSetPaymentResult, pifSetGiftValue,
  pifMarkViewed, pifMarkClaimed, pifUpdateSms, pifReserve, pifConfirmRedemption, pifReleaseRedemption,
  pifActivate, pifCancel, pifRefund,
  pifExpireDue, pifListByPurchaser, pifListByRecipientPhone, pifListAdmin,
  pifEvents, pifLogEvent, pifRedemptions, pifKpis,
  get enabled() { return !!pool; },
};
