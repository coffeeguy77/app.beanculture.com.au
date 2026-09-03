// Custom Tables — private, phone-gated quick-pick tables for regulars.
//
// The owner defines these in Admin → Orders & Service → Custom Tables. Each is a
// mobile number → a custom table label the app offers ONLY to that signed-in
// customer (e.g. "Shaun's Desk", or "AUDI" for a regular who wants her order
// brought to her car), with an optional coupon that the checkout auto-applies
// when the table is picked.
//
// Privacy: the full list (which contains customers' phone numbers) is NEVER sent
// to the public /api/config. It is resolved server-side per signed-in user —
// the client asks "what's mine?" via /api/loyalty?phone=… and only ever learns
// its own entries (label + coupon, never the phone list).

const { getSettings } = require('./settings');

// Australian mobile numbers get typed a dozen ways (+61, spaces, leading 0…).
// Normalise to a bare 04xxxxxxxx so a match is reliable regardless of format.
function normalisePhone(p) {
  let d = String(p == null ? '' : p).replace(/\D/g, '');
  if (d.startsWith('61')) d = '0' + d.slice(2);      // +61 4… → 04…
  if (d.length === 9 && d[0] === '4') d = '0' + d;    // 4146…  → 04146…
  return d;
}

// All configured custom tables, sanitised. Internal use (admin/order side) —
// this DOES include phone numbers, so never hand the raw result to a customer.
function all() {
  const list = getSettings().customTables;
  if (!Array.isArray(list)) return [];
  return list
    .map((t) => ({
      phone: normalisePhone(t && t.phone),
      label: String((t && t.label) || '').trim().slice(0, 40),
      coupon: String((t && t.coupon) || '').trim().slice(0, 40),
    }))
    .filter((t) => t.phone && t.label);
}

// The custom tables that belong to one signed-in customer, by phone. Returns
// only what that customer may see: the table label and its coupon — NEVER the
// phone number or anyone else's entries.
function forPhone(phone) {
  const norm = normalisePhone(phone);
  if (!norm) return [];
  return all()
    .filter((t) => t.phone === norm)
    .map((t) => ({ label: t.label, coupon: t.coupon || '' }));
}

// The coupon a given (customer, table label) pair should auto-apply, if any.
// Used to re-validate server-side so a tampered client can't attach a custom
// table's coupon to an order it isn't entitled to.
function couponFor(phone, label) {
  const wanted = String(label || '').trim();
  const mine = forPhone(phone).find((t) => t.label === wanted);
  return mine ? mine.coupon : '';
}

module.exports = { all, forPhone, couponFor, normalisePhone };
