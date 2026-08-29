// Square Terminal API — card-present payments on a paired Square reader, for the
// Kiosk POS. Single Bean Culture merchant (the app's existing access token); no
// OAuth. Everything is server-mediated: the browser never sees Square tokens.
//
// Pairing: create a device code (a 6-char code staff type into the Terminal),
// poll until it reports PAIRED, then store the resulting device_id. Payments:
// create a Terminal Checkout against that device for a given order+amount, then
// learn the outcome from webhooks with a polling fallback (never trust only the
// initiating browser). Cancels are explicit.

const { squareFetch, LOCATION_ID, idem } = require('./squareClient');

// ── Pairing ────────────────────────────────────────────────────────────────
async function createDeviceCode(name) {
  const data = await squareFetch('/v2/devices/codes', {
    method: 'POST',
    body: {
      idempotency_key: idem(),
      device_code: {
        name: (name || 'Bean Culture POS').slice(0, 50),
        product_type: 'TERMINAL_API',
        location_id: LOCATION_ID,
      },
    },
  });
  return data.device_code; // { id, code, status, device_id?, pair_by, ... }
}

async function getDeviceCode(id) {
  const data = await squareFetch(`/v2/devices/codes/${id}`);
  return data.device_code;
}

// Paired readers we could send a checkout to (device_id + friendly name/status).
async function listDevices() {
  const data = await squareFetch('/v2/devices').catch(() => ({ devices: [] }));
  return (data.devices || []).map((d) => ({
    id: d.id,
    name: (d.attributes && d.attributes.name) || d.id,
    model: (d.attributes && d.attributes.model) || '',
    status: (d.status && d.status.category) || '',
  }));
}

// ── Checkout (payment) ───────────────────────────────────────────────────────
// amountMoney: { amount, currency }; deviceId: paired reader; orderId associates
// the resulting payment with our Square order so it reads as paid + reconciles.
async function createCheckout({ amountMoney, deviceId, orderId, referenceId, note }) {
  const checkout = {
    amount_money: amountMoney,
    reference_id: (referenceId || '').slice(0, 40) || undefined,
    note: (note || 'Bean Culture POS').slice(0, 500),
    device_options: {
      device_id: deviceId,
      skip_receipt_screen: false,
      collect_signature: false,
    },
    deadline_duration: 'PT5M', // customer has 5 minutes to tap/insert
  };
  if (orderId) checkout.order_id = orderId;
  const data = await squareFetch('/v2/terminals/checkouts', {
    method: 'POST',
    body: { idempotency_key: idem(), checkout },
  });
  return data.checkout; // { id, status: 'PENDING', ... }
}

async function getCheckout(id) {
  const data = await squareFetch(`/v2/terminals/checkouts/${id}`);
  return data.checkout;
}

async function cancelCheckout(id) {
  try {
    const data = await squareFetch(`/v2/terminals/checkouts/${id}/cancel`, { method: 'POST', body: {} });
    return data.checkout;
  } catch (e) {
    // Already completed/canceled — surface current state to the caller.
    try { return await getCheckout(id); } catch { throw e; }
  }
}

// Normalise Square's TerminalCheckout.status into our small state machine.
//   PENDING / IN_PROGRESS   → waiting (customer interacting)
//   COMPLETED               → paid
//   CANCELED / CANCEL_REQUESTED → canceled
// Anything else is treated as still-waiting until a terminal state arrives.
function phaseOf(checkout) {
  const s = (checkout && checkout.status) || '';
  if (s === 'COMPLETED') return 'paid';
  if (s === 'CANCELED') return 'canceled';
  if (s === 'CANCEL_REQUESTED') return 'canceling';
  return 'waiting';
}

module.exports = {
  createDeviceCode, getDeviceCode, listDevices,
  createCheckout, getCheckout, cancelCheckout, phaseOf,
};
