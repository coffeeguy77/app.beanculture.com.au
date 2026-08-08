// App-managed coupon codes. Stored in settings.coupons (edited in the admin) and
// applied to the Square order as an order-level discount at checkout. Square then
// computes the discounted total, which is what the customer actually pays.

const { CURRENCY } = require('./squareClient');
const { getSettings } = require('./settings');

function all() {
  return (getSettings().coupons || []).filter((c) => c && c.code);
}

// Find a usable coupon by code (active + not expired). Returns null otherwise.
function find(code) {
  if (!code) return null;
  const norm = String(code).trim().toLowerCase();
  const c = all().find((x) => String(x.code).trim().toLowerCase() === norm);
  if (!c) return null;
  if (c.active === false) return null;
  if (c.expiry) {
    const end = new Date(`${c.expiry}T23:59:59`);
    if (!isNaN(end.getTime()) && Date.now() > end.getTime()) return null;
  }
  return c;
}

// A Square order discount object for a coupon. percent/comp → percentage;
// amount → fixed money off (value stored in dollars, sent in minor units).
function discountFor(c) {
  if (!c) return null;
  const name = `Coupon ${String(c.code).toUpperCase()}`;
  const type = c.type || 'percent';
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
  if (type === 'amount') return `$${(Number(c.value) || 0).toFixed(2).replace(/\.00$/, '')} off`;
  return `${Number(c.value) || 0}% off`;
}

module.exports = { find, discountFor, label, all };
