// Orders: create (dine-in/table + takeaway forced onto ticket_name), pay,
// and per-customer history. Stamps order.customer_id so history works.

const { squareFetch, LOCATION_ID, idem, CURRENCY } = require('./squareClient');
const coupons = require('./coupons');
const combos = require('./combos');
const payItForward = require('./payItForward');

const DINEIN_FULFILLMENT = (process.env.SQUARE_DINEIN_FULFILLMENT || 'PICKUP').toUpperCase();
const COMP_COUPON_CODE = (process.env.COMP_COUPON_CODE || '').trim();

function buildTicketName({ dineIn, table, name }) {
  let t;
  if (dineIn) t = table ? `T${table} DINE-IN` : 'DINE-IN';
  else {
    t = 'TAKEAWAY';
    if (name) t += ` ${name}`;
  }
  return t.slice(0, 30);
}

function buildNote({ dineIn, table }) {
  return dineIn ? `DINE-IN · Table ${table || '?'}` : 'TAKEAWAY';
}

async function createOrder({ cart, dineIn, table, name, coupon, customerId, pickupAt, idempotencyKey, note: customerNote, pifVoucher }) {
  if (!Array.isArray(cart) || cart.length === 0) throw new Error('Cart is empty');
  // Bake any per-combo locked modifiers into the combo lines before pricing, so
  // an item the owner locked into a combo (e.g. chips) is always charged even if
  // a tampered client left it off. No-op for carts without a combo.
  cart = await combos.applyLockedMods(cart);

  const isComp =
    !!COMP_COUPON_CODE &&
    !!coupon &&
    String(coupon).trim().toLowerCase() === COMP_COUPON_CODE.toLowerCase();

  // Every line item gets a stable uid so a Pay It Forward voucher's
  // LINE_ITEM-scope discount can be attached to exactly the eligible lines
  // (never the whole order) -- see the pifReservation block below. The uid is
  // just an array index; it only needs to be unique within this one order.
  const lineItems = cart.map((ci, i) => {
    const li = { uid: `li${i}`, catalog_object_id: ci.variationId, quantity: String(ci.quantity || 1) };
    if (Array.isArray(ci.modifierIds) && ci.modifierIds.length) {
      li.modifiers = ci.modifierIds.map((id) => ({ catalog_object_id: id }));
    }
    if (ci.note) li.note = String(ci.note).slice(0, 500);
    return li;
  });

  const displayName = name || (dineIn ? `Table ${table || ''}`.trim() : 'Takeaway');

  // A future pickup time turns this into a scheduled order (kitchen sees the time).
  const scheduled = pickupAt && new Date(pickupAt).getTime() > Date.now() + 60_000;

  let fulfillment;
  if (dineIn && DINEIN_FULFILLMENT === 'IN_STORE' && !scheduled) {
    fulfillment = { type: 'IN_STORE', state: 'PROPOSED' };
  } else {
    const pickup_details = {
      recipient: { display_name: displayName },
      note: buildNote({ dineIn, table }),
    };
    if (scheduled) {
      pickup_details.schedule_type = 'SCHEDULED';
      pickup_details.pickup_at = new Date(pickupAt).toISOString();
    } else {
      pickup_details.schedule_type = 'ASAP';
    }
    fulfillment = { type: 'PICKUP', state: 'PROPOSED', pickup_details };
  }

  const cleanNote = customerNote ? String(customerNote).trim().slice(0, 250) : '';
  if (cleanNote) fulfillment.pickup_details && (fulfillment.pickup_details.note = `${fulfillment.pickup_details.note} · ${cleanNote}`.slice(0, 500));
  const order = {
    location_id: LOCATION_ID,
    ticket_name: buildTicketName({ dineIn, table, name }),
    line_items: lineItems,
    fulfillments: [fulfillment],
    note: (buildNote({ dineIn, table }) + (cleanNote ? ` · ${cleanNote}` : '')).slice(0, 500),
    source: { name: 'Bean Culture App' },
  };
  if (customerId) order.customer_id = customerId;

  // A Pay It Forward voucher takes priority over (never stacks with) a combo
  // or typed coupon, same precedent as combo-beats-coupon below. The balance
  // is atomically reserved here, BEFORE we touch Square, so two simultaneous
  // redemption attempts against the same gift can't both succeed. If Square
  // order creation subsequently fails, the reservation is released in the
  // catch block below so the customer's balance is never lost to a failed
  // checkout.
  let pifReservation = null;
  if (isComp) {
    order.discounts = [
      { uid: 'comp', name: `Test comp (${COMP_COUPON_CODE})`, percentage: '100', scope: 'ORDER' },
    ];
  } else if (pifVoucher) {
    const reservation = await payItForward.reserveForCheckout({ tokenOrCode: pifVoucher, cart, redeemedByCustomerId: customerId });
    if (!reservation.ok) {
      const err = new Error(pifReservationErrorMessage(reservation));
      err.pifReason = reservation.reason;
      err.pifWarning = reservation.warning;
      throw err;
    }
    pifReservation = reservation;
    const { discount, eligibleIndexes } = payItForward.discountForReservation(reservation);
    order.discounts = [discount];
    for (const idx of eligibleIndexes) {
      if (lineItems[idx]) lineItems[idx].applied_discounts = [{ discount_uid: discount.uid }];
    }
  } else {
    // Combo Builder discounts are re-derived and re-validated server-side from
    // the cart's comboId/comboInstanceId/comboGroupId tags (see combos.js) —
    // never trust a discount amount from the client. A combo in the cart takes
    // priority over a typed coupon rather than stacking with one.
    const comboDiscounts = await combos.discountsForCart(cart);
    if (comboDiscounts.length) {
      order.discounts = comboDiscounts;
    } else if (coupon) {
      // App-managed coupon → order-level discount (Square recomputes the total).
      const c = coupons.find(coupon);
      const d = c && coupons.discountFor(c);
      if (d) order.discounts = [d];
    }
  }

  try {
    const data = await squareFetch('/v2/orders', {
      method: 'POST',
      body: { order, idempotency_key: idempotencyKey || idem() },
    });
    if (pifReservation) await payItForward.confirmReservation(pifReservation.redemptionId, data.order.id);
    return data.order;
  } catch (e) {
    if (pifReservation) await payItForward.releaseReservation(pifReservation.redemptionId).catch(() => {});
    throw e;
  }
}

function pifReservationErrorMessage(reservation) {
  switch (reservation.reason) {
    case 'not_found': return 'That gift code or link was not found.';
    case 'not_redeemable': return `This gift is ${String(reservation.status || '').toLowerCase().replace(/_/g, ' ')} and can no longer be used.`;
    case 'expired': return 'This gift has expired.';
    case 'no_eligible_categories': return reservation.warning || 'This gift cannot be used right now — please contact the store.';
    case 'no_eligible_items_in_cart': return 'Add an eligible coffee to your cart to use this gift.';
    case 'zero_amount': return 'This gift has no remaining balance.';
    default: return 'This gift could not be applied to your order.';
  }
}

async function getOrder(orderId) {
  const data = await squareFetch(`/v2/orders/${orderId}`);
  return data.order;
}

async function createPayment({ sourceId, orderId, amountMoney, verificationToken, buyerEmail, customerId }) {
  const body = {
    source_id: sourceId,
    idempotency_key: idem(),
    amount_money: amountMoney,
    order_id: orderId,
    location_id: LOCATION_ID,
    autocomplete: true,
  };
  if (verificationToken) body.verification_token = verificationToken;
  if (buyerEmail) body.buyer_email_address = buyerEmail;
  if (customerId) body.customer_id = customerId;
  const data = await squareFetch('/v2/payments', { method: 'POST', body });
  return data.payment;
}

// Authorize (hold) a card without charging — the funds check for pre-orders.
// autocomplete:false holds the amount; online auth is valid ~7 days, then we
// either complete (capture) at pickup or cancel (void). A decline here means
// the customer has no funds / the card failed, surfaced immediately.
async function authorizePayment({ sourceId, orderId, amountMoney, customerId, verificationToken }) {
  const body = {
    source_id: sourceId,
    idempotency_key: idem(),
    amount_money: amountMoney,
    autocomplete: false,
    location_id: LOCATION_ID,
  };
  if (orderId) body.order_id = orderId;
  if (customerId) body.customer_id = customerId;
  if (verificationToken) body.verification_token = verificationToken;
  const data = await squareFetch('/v2/payments', { method: 'POST', body });
  return data.payment;
}
async function completePayment(paymentId) {
  const data = await squareFetch(`/v2/payments/${paymentId}/complete`, { method: 'POST', body: {} });
  return data.payment;
}
async function cancelPayment(paymentId) {
  try {
    const data = await squareFetch(`/v2/payments/${paymentId}/cancel`, { method: 'POST', body: {} });
    return data.payment;
  } catch (e) { return null; }
}

// Pay a $0 order (comp or fully loyalty-covered) so it completes and routes to KDS.
async function payZeroOrder(orderId, orderVersion) {
  const body = {
    idempotency_key: idem(),
    order_version: orderVersion,
    payment_ids: [],
  };
  const data = await squareFetch(`/v2/orders/${orderId}/pay`, { method: 'POST', body });
  return data.order;
}

async function getHistory(customerId, limit = 25) {
  if (!customerId) return [];
  const data = await squareFetch('/v2/orders/search', {
    method: 'POST',
    body: {
      location_ids: [LOCATION_ID],
      query: {
        filter: { customer_filter: { customer_ids: [customerId] } },
        sort: { sort_field: 'CREATED_AT', sort_order: 'DESC' },
      },
      return_entries: false,
      limit,
    },
  });
  const orders = data.orders || [];
  return orders.map((o) => ({
    id: o.id,
    createdAt: o.created_at,
    state: o.state,
    ticketName: o.ticket_name,
    total: o.total_money,
    items: (o.line_items || []).map((li) => ({
      name: li.name,
      variation: li.variation_name,
      quantity: li.quantity,
      total: li.total_money,
      // For "reorder": enough to rebuild a cart entry.
      variationId: li.catalog_object_id,
      modifierIds: (li.modifiers || []).map((m) => m.catalog_object_id).filter(Boolean),
      modifierNames: (li.modifiers || []).map((m) => m.name).filter(Boolean),
      unitPrice: li.total_money && li.quantity ? Math.round(li.total_money.amount / Number(li.quantity)) : (li.base_price_money?.amount ?? null),
    })),
  }));
}

// A $0 "Table reservation" order so the booking lands in Square + auto-prints on
// the store's receipt/kitchen printer (no restaurant subscription needed).
//
// IMPORTANT: most Square printer routing only auto-prints items that belong to
// a routed print category. A bare ad-hoc line item (no catalog_object_id) has
// no category, so it can silently fail to print even though the order shows up
// fine in the Square dashboard. Pass `variationId` (from settings.reservationVariationId,
// set via Admin → Store → Reservations, which can find or auto-create the item)
// to reference a real catalog item instead, so the ticket inherits its
// category's printer routing, same as normal orders. Falls back to the
// SQUARE_RESERVATION_VARIATION_ID env var (legacy/manual setup) if unset.
const RESERVATION_VARIATION_ID_ENV = (process.env.SQUARE_RESERVATION_VARIATION_ID || '').trim();

async function createReservationOrder({ name, phone, email, partySize, at, notes, variationId }) {
  const when = at ? new Date(at) : null;
  // Spelled out on the printed ticket in full, not just relying on Square's
  // own pickup_at rendering (which varies by printer template) — this is the
  // one place staff actually read who's coming in, when, and how many.
  const whenLabel = when
    ? when.toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
    : null;
  const detail = [
    'Table reservation',
    whenLabel && `When: ${whenLabel}`,
    `${partySize || '?'} guest(s)`,
    name && `Name: ${name}`,
    phone && `Ph: ${phone}`,
    email && `Email: ${email}`,
    notes && `Notes: ${notes}`,
  ].filter(Boolean).join(' · ').slice(0, 500);
  // Deliberately ASAP, never SCHEDULED, even though the reservation itself is
  // for a future time: Square's default prep-time-based ticket printing holds
  // a SCHEDULED order's ticket back until shortly before its pickup_at, which
  // for a table booking days out means the ticket would never print anywhere
  // near "now" when the owner actually wants to know about it. The real
  // booking time is already spelled out in the note text above (and on the
  // ticket) — this only controls when Square decides to print/notify.
  const pickup_details = {
    recipient: { display_name: name || 'Reservation' },
    note: detail,
    schedule_type: 'ASAP',
  };
  const resolvedVariationId = (variationId || RESERVATION_VARIATION_ID_ENV || '').trim();
  const lineItem = resolvedVariationId
    ? { catalog_object_id: resolvedVariationId, quantity: '1', note: detail }
    : { name: 'Table reservation', quantity: '1', base_price_money: { amount: 0, currency: CURRENCY }, note: detail };
  const order = {
    location_id: LOCATION_ID,
    ticket_name: `RESERVATION · ${(name || 'Guest')} (${partySize || '?'})`.slice(0, 60),
    line_items: [lineItem],
    fulfillments: [{ type: 'PICKUP', state: 'PROPOSED', pickup_details }],
    note: detail,
    source: { name: 'Bean Culture App' },
  };
  const data = await squareFetch('/v2/orders', { method: 'POST', body: { order, idempotency_key: idem() } });
  return data.order;
}

module.exports = { createOrder, getOrder, createPayment, authorizePayment, completePayment, cancelPayment, payZeroOrder, getHistory, createReservationOrder };
