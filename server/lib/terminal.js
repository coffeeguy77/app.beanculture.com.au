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
async function createDeviceCode(name, squareLocationId) {
  const data = await squareFetch('/v2/devices/codes', {
    method: 'POST',
    body: {
      idempotency_key: idem(),
      device_code: {
        name: (name || 'Bean Culture POS').slice(0, 50),
        product_type: 'TERMINAL_API',
        // Pair the reader to the SAME Square location its orders are created at.
        // A mismatch makes every checkout fail with INVALID_LOCATION ("the
        // device's location must match the order's location").
        location_id: squareLocationId || LOCATION_ID,
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
async function createCheckout({ amountMoney, deviceId, orderId, referenceId, note, showItemizedCart, skipReceipt }) {
  const checkout = {
    amount_money: amountMoney,
    reference_id: (referenceId || '').slice(0, 40) || undefined,
    note: (note || 'Bean Culture POS').slice(0, 500),
    device_options: {
      device_id: deviceId,
      // Skip the post-payment receipt screen so the Terminal returns to ready
      // straight after the tap, instead of hanging on Print / No receipt. Skipped
      // by default; a POS setting can turn the receipt prompt back on.
      skip_receipt_screen: skipReceipt !== false,
      collect_signature: false,
      // The Terminal's "confirm & pay" itemisation screen. Defaults to TRUE in
      // Square (only when an order is linked). Off by default here so pressing
      // Charge jumps straight to the amount + tap prompt; a POS setting turns the
      // customer-facing confirm screen back on. (Belongs in device_options — the
      // old bug was setting it at the top level, which Square rejects.)
      show_itemized_cart: showItemizedCart === true,
    },
    deadline_duration: 'PT5M', // customer has 5 minutes to tap/insert
  };
  // Associate the payment with our Square order so it reconciles.
  if (orderId) { checkout.order_id = orderId; }
  console.log('[terminal] createCheckout →', JSON.stringify({ deviceId, orderId, amount: amountMoney && amountMoney.amount }));
  const data = await squareFetch('/v2/terminals/checkouts', {
    method: 'POST',
    body: { idempotency_key: idem(), checkout },
  });
  const c = data.checkout || {};
  console.log('[terminal] checkout created ←', JSON.stringify({ id: c.id, status: c.status, deviceId: c.device_options && c.device_options.device_id }));
  return c; // { id, status: 'PENDING', ... }
}

async function getCheckout(id) {
  const data = await squareFetch(`/v2/terminals/checkouts/${id}`);
  return data.checkout;
}

// Print a receipt for an EXISTING payment on the Terminal's built-in printer.
// print_only skips the on-screen receipt-options prompt and prints straight away;
// is_duplicate marks a reprint. (Terminal API "RECEIPT" action.)
async function printReceipt({ deviceId, paymentId, duplicate }) {
  const data = await squareFetch('/v2/terminals/actions', {
    method: 'POST',
    body: {
      idempotency_key: idem(),
      action: {
        type: 'RECEIPT',
        device_id: deviceId,
        receipt_options: { payment_id: paymentId, print_only: true, is_duplicate: duplicate === true },
      },
    },
  });
  return data.action || {};
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
  createCheckout, getCheckout, cancelCheckout, printReceipt, phaseOf,
};
