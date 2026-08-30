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
  return { weekend: s.weekend || {}, card: s.card || {} };
}

// Is `now` a weekend-surcharge day? days: array of dow (0=Sun … 6=Sat).
function isWeekendDay(now, weekend) {
  const days = Array.isArray(weekend.days) && weekend.days.length ? weekend.days : [0, 6];
  if (days.includes(now.dow)) return true;
  const hol = Array.isArray(weekend.publicHolidays) ? weekend.publicHolidays : [];
  return hol.includes(now.date); // 'YYYY-MM-DD'
}

function pct(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Build the Square order.service_charges array for this order.
function serviceChargesFor({ now = venueNow(), cardPayment = false } = {}) {
  const { weekend, card } = cfg();
  const out = [];
  const wp = pct(weekend.percent);
  if (weekend.enabled && wp > 0 && isWeekendDay(now, weekend)) {
    out.push({
      uid: 'sc-weekend',
      name: (weekend.label || 'Weekend surcharge').slice(0, 255),
      percentage: String(wp),
      calculation_phase: 'SUBTOTAL_PHASE',
    });
  }
  const cp = pct(card.percent);
  if (cardPayment && card.enabled && cp > 0) {
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
  const { weekend, card } = cfg();
  const now = venueNow();
  return {
    weekend: {
      enabled: !!weekend.enabled && pct(weekend.percent) > 0,
      percent: pct(weekend.percent),
      label: weekend.label || 'Weekend surcharge',
      activeToday: !!weekend.enabled && pct(weekend.percent) > 0 && isWeekendDay(now, weekend),
    },
    card: {
      enabled: !!card.enabled && pct(card.percent) > 0,
      percent: pct(card.percent),
      label: card.label || 'Card surcharge',
    },
  };
}

module.exports = { serviceChargesFor, publicConfig, isWeekendDay };
