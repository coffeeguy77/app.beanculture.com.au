// App-managed coupon codes. Stored in settings.coupons (edited in the admin) and
// applied to the Square order as an order-level discount at checkout. Square then
// computes the discounted total, which is what the customer actually pays.

const { CURRENCY } = require('./squareClient');
const { getSettings } = require('./settings');

function all() {
  return (getSettings().coupons || []).filter((c) => c && c.code);
}

// Find a coupon by code, regardless of eligibility (active/expiry/conditions are
// judged by isEligible so the checkout can explain WHY a code doesn't apply).
// Returns null only when no such code exists at all.
function find(code) {
  if (!code) return null;
  const norm = String(code).trim().toLowerCase();
  return all().find((x) => String(x.code).trim().toLowerCase() === norm) || null;
}

// Days between two MM-DD dates, ignoring year (so a birthday matches every year).
// Wraps across Dec→Jan, so 12-31 and 01-01 are 1 day apart.
function mmddDistance(a, b) {
  const pa = String(a || '').match(/(\d{1,2})-(\d{1,2})$/);
  const pb = String(b || '').match(/(\d{1,2})-(\d{1,2})$/);
  if (!pa || !pb) return null;
  const doy = (m, d) => {
    const cum = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    return (cum[(Number(m) - 1) % 12] || 0) + Number(d);
  };
  const da = doy(pa[1], pa[2]);
  const db = doy(pb[1], pb[2]);
  const raw = Math.abs(da - db);
  return Math.min(raw, 365 - raw);
}

// Is a coupon usable right now, for this customer? Pure + context-driven so both
// /api/coupon (checkout preview) and the order pipeline judge it identically, and
// the checkout can show a clear reason. ctx: { now?:Date, orderCount?:number|null,
// birthday?:'MM-DD'|null }.
function isEligible(c, ctx = {}) {
  if (!c) return { ok: false, reason: 'not_found' };
  if (c.active === false) return { ok: false, reason: 'inactive' };
  const now = ctx.now instanceof Date ? ctx.now : new Date();

  if (c.startDate) {
    const start = new Date(`${c.startDate}T00:00:00`);
    if (!isNaN(start.getTime()) && now < start) return { ok: false, reason: 'not_started' };
  }
  if (c.expiry) {
    const end = new Date(`${c.expiry}T23:59:59`);
    if (!isNaN(end.getTime()) && now > end) return { ok: false, reason: 'expired' };
  }
  if (Array.isArray(c.days) && c.days.length) {
    const dow = now.getDay(); // 0=Sun … 6=Sat
    if (!c.days.map(Number).includes(dow)) return { ok: false, reason: 'wrong_day' };
  }
  if (c.firstVisitOnly) {
    // Unknown history (not signed in / lookup failed) can't be verified → deny,
    // so a first-visit deal can't be farmed by signing out.
    if (ctx.orderCount == null || Number(ctx.orderCount) > 0) return { ok: false, reason: 'not_first_visit' };
  }
  if (c.birthdayOnly) {
    const win = Number.isFinite(Number(c.birthdayWindowDays)) ? Math.max(0, Math.min(31, Number(c.birthdayWindowDays))) : 0;
    const todayMMDD = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const dist = ctx.birthday ? mmddDistance(todayMMDD, ctx.birthday) : null;
    if (dist == null || dist > win) return { ok: false, reason: 'not_birthday' };
  }
  return { ok: true, reason: '' };
}

// True when a coupon needs customer context (history / birthday) to judge — the
// checkout must be signed in for these to validate.
function needsCustomer(c) {
  return !!(c && (c.firstVisitOnly || c.birthdayOnly));
}

// A Square order discount object for a coupon. percent/comp → percentage;
// amount → fixed money off (value stored in dollars, sent in minor units).
function discountFor(c) {
  if (!c) return null;
  const name = `Coupon ${String(c.code).toUpperCase()}`;
  const type = c.type || 'percent';
  // 'upgrade' (any size for the price of a small) is computed per line item from
  // the live catalog in orders.js — it has no fixed order-level discount here.
  if (type === 'upgrade') return null;
  if (type === 'comp') return { uid: 'coupon', name, percentage: '100', scope: 'ORDER' };
  if (type === 'amount') {
    const cents = Math.max(0, Math.round((Number(c.value) || 0) * 100));
    return { uid: 'coupon', name, amount_money: { amount: cents, currency: CURRENCY }, scope: 'ORDER' };
  }
  const pct = Math.max(0, Math.min(100, Number(c.value) || 0));
  return { uid: 'coupon', name, percentage: String(pct), scope: 'ORDER' };
}

// A short human label for the checkout ("10% off", "$5 off", "Free order").
function label(c) {
  if (!c) return '';
  const type = c.type || 'percent';
  if (type === 'comp') return 'Free order';
  if (type === 'upgrade') return 'Any size for the price of a small';
  if (type === 'amount') return `$${(Number(c.value) || 0).toFixed(2).replace(/\.00$/, '')} off`;
  return `${Number(c.value) || 0}% off`;
}

// A short note describing any eligibility conditions, for the checkout to show.
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function conditionLabel(c) {
  if (!c) return '';
  const bits = [];
  if (c.firstVisitOnly) bits.push('First visit only');
  if (c.birthdayOnly) bits.push('Birthday treat');
  if (Array.isArray(c.days) && c.days.length && c.days.length < 7) {
    bits.push(`${c.days.map(Number).sort().map((d) => DOW[d]).join('/')} only`);
  }
  return bits.join(' · ');
}

module.exports = { find, discountFor, label, conditionLabel, isEligible, needsCustomer, mmddDistance, all };
