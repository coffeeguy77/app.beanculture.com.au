// Order surcharges applied server-side as Square service charges (so they show
// on the receipt and reconcile in Square). Two kinds, both configurable:
//   • weekend surcharge — a % added on the chosen days (Sat/Sun by default) plus
//     any listed public-holiday dates. Applied to the item subtotal.
//   • card surcharge — a % added when the customer pays by card (POS: tender is
//     card; app: a card payment, not gift balance/comp). Applied to the total,
//     so it covers the amount actually charged.
//
// These are authoritative: the client only estimates a line for transparency;
// Square recomputes the real total from what we attach here.

const { getSettings } = require('./settings');
const { venueNow } = require('./catalog');

function cfg() {
  const s = getSettings().surcharges || {};
  return { weekend: s.weekend || {}, card: s.card || {}, holiday: s.holiday || {} };
}

// Is `now` a weekend-surcharge day? days: array of dow (0=Sun … 6=Sat).
function isWeekendDay(now, weekend) {
  const days = Array.isArray(weekend.days) && weekend.days.length ? weekend.days : [0, 6];
  if (days.includes(now.dow)) return true;
  const hol = Array.isArray(weekend.publicHolidays) ? weekend.publicHolidays : [];
  return hol.includes(now.date); // 'YYYY-MM-DD'
}

// Is today one of the public-holiday surcharge dates? (Independent of weekends:
// a dedicated surcharge that only applies on the exact dates listed.)
function isHolidayDate(now, holiday) {
  const dates = Array.isArray(holiday.dates) ? holiday.dates : [];
  return dates.includes(now.date); // 'YYYY-MM-DD'
}

function pct(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Whether a surcharge applies at a given store. Empty/absent `locations` list =
// applies everywhere; otherwise only at the listed store ids.
function appliesAtLocation(conf, locationId) {
  const locs = Array.isArray(conf.locations) ? conf.locations.filter(Boolean) : [];
  return !locs.length || (!!locationId && locs.includes(locationId));
}

// Build the Square order.service_charges array for this order.
function serviceChargesFor({ now = venueNow(), cardPayment = false, locationId = null } = {}) {
  const { weekend, card, holiday } = cfg();
  const out = [];
  // Public-holiday surcharge takes priority: when today is a listed holiday here,
  // it applies and SUPPRESSES the weekend surcharge for the day (so a holiday
  // that falls on a weekend is never double-charged).
  const hp = pct(holiday.percent);
  const holidayActive = !!holiday.enabled && hp > 0 && isHolidayDate(now, holiday) && appliesAtLocation(holiday, locationId);
  if (holidayActive) {
    out.push({
      uid: 'sc-holiday',
      name: (holiday.label || 'Public Holiday Surcharge').slice(0, 255),
      percentage: String(hp),
      calculation_phase: 'SUBTOTAL_PHASE',
    });
  }
  const wp = pct(weekend.percent);
  if (!holidayActive && weekend.enabled && wp > 0 && isWeekendDay(now, weekend) && appliesAtLocation(weekend, locationId)) {
    out.push({
      uid: 'sc-weekend',
      name: (weekend.label || 'Weekend surcharge').slice(0, 255),
      percentage: String(wp),
      calculation_phase: 'SUBTOTAL_PHASE',
    });
  }
  const cp = pct(card.percent);
  if (cardPayment && card.enabled && cp > 0 && appliesAtLocation(card, locationId)) {
    out.push({
      uid: 'sc-card',
      name: (card.label || 'Card surcharge').slice(0, 255),
      percentage: String(cp),
      calculation_phase: 'TOTAL_PHASE', // on the whole amount charged (incl. any weekend surcharge)
    });
  }
  return out;
}

// Slim config for the client so it can show an estimate before paying.
function publicConfig() {
  const { weekend, card, holiday } = cfg();
  const now = venueNow();
  const holidayOn = !!holiday.enabled && pct(holiday.percent) > 0;
  const holidayToday = holidayOn && isHolidayDate(now, holiday);
  return {
    // A dedicated public-holiday surcharge on specific dates. When active today it
    // takes priority over the weekend surcharge (see serviceChargesFor).
    holiday: {
      enabled: holidayOn,
      percent: pct(holiday.percent),
      label: holiday.label || 'Public Holiday Surcharge',
      activeToday: holidayToday,
      locations: Array.isArray(holiday.locations) ? holiday.locations : [],
    },
    weekend: {
      enabled: !!weekend.enabled && pct(weekend.percent) > 0,
      percent: pct(weekend.percent),
      label: weekend.label || 'Weekend surcharge',
      // Suppressed on a holiday date (never both on the same day).
      activeToday: !!weekend.enabled && pct(weekend.percent) > 0 && isWeekendDay(now, weekend) && !holidayToday,
      locations: Array.isArray(weekend.locations) ? weekend.locations : [],
    },
    card: {
      enabled: !!card.enabled && pct(card.percent) > 0,
      percent: pct(card.percent),
      label: card.label || 'Card surcharge',
      locations: Array.isArray(card.locations) ? card.locations : [],
    },
  };
}

// The order-level surcharge(s) active RIGHT NOW at a given store — for the CDS
// band and any "a surcharge applies today" notice. Card surcharge is excluded
// (it's tender-specific, shown at payment). Returns [{ label, percent }].
function activeOrderSurcharges(locationId = null, now = venueNow()) {
  const { weekend, holiday } = cfg();
  const out = [];
  const hp = pct(holiday.percent);
  const holidayActive = !!holiday.enabled && hp > 0 && isHolidayDate(now, holiday) && appliesAtLocation(holiday, locationId);
  if (holidayActive) out.push({ label: holiday.label || 'Public Holiday Surcharge', percent: hp });
  const wp = pct(weekend.percent);
  if (!holidayActive && weekend.enabled && wp > 0 && isWeekendDay(now, weekend) && appliesAtLocation(weekend, locationId)) {
    out.push({ label: weekend.label || 'Weekend surcharge', percent: wp });
  }
  return out;
}

module.exports = { serviceChargesFor, publicConfig, isWeekendDay, isHolidayDate, activeOrderSurcharges };
