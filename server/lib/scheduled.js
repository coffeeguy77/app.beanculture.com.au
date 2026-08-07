// Scheduler for auto-charged pre-orders and recurring standing orders.
// Prepaid ("pay now") scheduled orders don't come through here — they are
// created + paid at checkout with a future pickup_at. This module handles the
// deferred cases: at (pickup − lead) it creates the Square order and charges
// the customer's saved card on file. Runs in-process; claims rows atomically so
// a restart or overlap can't double-charge.

const db = require('./db');
const orders = require('./orders');
const cards = require('./cards');
const { getSettings, isClosedDate } = require('./settings');

const TZ = process.env.PREORDER_TZ || process.env.SEASON_TZ || 'Australia/Sydney';
const LEAD_MIN = Number(process.env.PREORDER_LEAD_MIN || 15);
const WDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Convert a wall-clock time in a timezone to the corresponding UTC instant.
function zonedWallToUtc(y, m, d, hh, mm, tz) {
  const asUTC = Date.UTC(y, m - 1, d, hh, mm, 0);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = {};
  for (const part of dtf.formatToParts(new Date(asUTC))) p[part.type] = part.value;
  const tzAsUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return new Date(asUTC - (tzAsUTC - asUTC));
}

function isClosureDate(fullDate) {
  let closures = [];
  try { closures = getSettings().closures || []; } catch {}
  return isClosedDate(closures, fullDate);
}

// Next occurrence (UTC Date) strictly after `after` for a recurrence rule.
// Skips closure dates (annual leave / public holidays) so we never auto-charge
// for a day we're not open.
function nextOccurrence(rec, after, tz = TZ) {
  const [hh, mm] = String((rec && rec.time) || '08:00').split(':').map(Number);
  const weekly = rec && rec.type === 'weekly' && Array.isArray(rec.days) && rec.days.length;
  const days = weekly ? rec.days : [0, 1, 2, 3, 4, 5, 6];
  for (let i = 0; i <= 400; i++) {
    const probe = new Date(after.getTime() + i * 86400000);
    const dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit' });
    const p = {};
    for (const part of dtf.formatToParts(probe)) p[part.type] = part.value;
    const wd = WDAYS.indexOf(p.weekday);
    if (!days.includes(wd)) continue;
    const fullDate = `${p.year}-${p.month}-${p.day}`;
    if (isClosureDate(fullDate)) continue;
    const cand = zonedWallToUtc(+p.year, +p.month, +p.day, hh, mm, tz);
    if (cand.getTime() > after.getTime()) return cand;
  }
  return null;
}

const leadMs = () => LEAD_MIN * 60 * 1000;

// Given a new schedule request, compute its first pickup + fire time.
// recurrence.type: 'none' (one-off, needs pickupAt) | 'daily' | 'weekly'.
function planSchedule({ recurrence, pickupAt }) {
  const rec = recurrence || { type: 'none' };
  if (rec.type === 'none') {
    const pu = new Date(pickupAt);
    if (isNaN(pu.getTime())) throw new Error('Invalid pickup time');
    return { pickupAt: pu.toISOString(), nextRun: new Date(pu.getTime() - leadMs()).toISOString() };
  }
  const pu = nextOccurrence(rec, new Date(), TZ);
  if (!pu) throw new Error('Could not work out the next occurrence');
  return { pickupAt: pu.toISOString(), nextRun: new Date(pu.getTime() - leadMs()).toISOString() };
}

async function processOne(row) {
  // Deterministic keys per occurrence so a retry after a crash can't create a
  // second order or double-charge — Square returns the original result.
  const base = `${row.id}:${new Date(row.pickupAt).getTime()}`;
  try {
    // Delayed-capture path: the order + authorization already exist; just capture.
    if (row.mode === 'capture' && row.paymentId) {
      await orders.completePayment(row.paymentId);
      await db.updateScheduled(row.id, { status: 'done', lastError: null });
      return;
    }
    const order = await orders.createOrder({
      cart: row.cart, dineIn: row.dineIn, table: row.table,
      name: row.name, customerId: row.customerId, pickupAt: row.pickupAt,
      idempotencyKey: `${base}:order`,
    });
    const total = order.total_money;
    if (!total || total.amount === 0) {
      const fresh = await orders.getOrder(order.id);
      await orders.payZeroOrder(order.id, fresh.version);
    } else {
      await cards.chargeSavedCard({
        cardId: row.cardId, customerId: row.customerId, orderId: order.id, amountMoney: total,
        idempotencyKey: `${base}:pay`,
      });
    }
    // Success — reschedule recurring, otherwise complete.
    const rec = row.recurrence;
    if (rec && rec.type && rec.type !== 'none') {
      const next = nextOccurrence(rec, new Date(row.pickupAt), TZ);
      if (next) {
        await db.updateScheduled(row.id, {
          status: 'active', pickupAt: next.toISOString(),
          nextRun: new Date(next.getTime() - leadMs()).toISOString(),
          lastOrderId: order.id, lastError: null,
        });
        return;
      }
    }
    await db.updateScheduled(row.id, { status: 'done', lastOrderId: order.id, lastError: null });
  } catch (e) {
    console.error('[scheduler] order failed', row.id, e.message);
    await db.updateScheduled(row.id, { status: 'failed', lastError: e.message });
  }
}

async function tick() {
  const due = await db.claimDue(20);
  for (const row of due) await processOne(row);
}

let timer = null;
function start() {
  if (!db.enabled) {
    console.log('[scheduler] disabled (no database) — pay-now scheduled orders still work.');
    return;
  }
  if (timer) return;
  timer = setInterval(() => tick().catch((e) => console.error('[scheduler] tick error', e.message)), 60_000);
  tick().catch((e) => console.error('[scheduler] initial tick error', e.message));
  console.log(`[scheduler] running (tz=${TZ}, lead=${LEAD_MIN}m)`);
}

module.exports = { start, planSchedule, nextOccurrence, tick };
