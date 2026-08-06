// Orders: create (dine-in/table + takeaway forced onto ticket_name), pay,
// and per-customer history. Stamps order.customer_id so history works.

const { squareFetch, LOCATION_ID, idem } = require('./squareClient');

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

async function createOrder({ cart, dineIn, table, name, coupon, customerId }) {
  if (!Array.isArray(cart) || cart.length === 0) throw new Error('Cart is empty');

  const isComp =
    !!COMP_COUPON_CODE &&
    !!coupon &&
    String(coupon).trim().toLowerCase() === COMP_COUPON_CODE.toLowerCase();

  const lineItems = cart.map((ci) => {
    const li = { catalog_object_id: ci.variationId, quantity: String(ci.quantity || 1) };
    if (Array.isArray(ci.modifierIds) && ci.modifierIds.length) {
      li.modifiers = ci.modifierIds.map((id) => ({ catalog_object_id: id }));
    }
    if (ci.note) li.note = String(ci.note).slice(0, 500);
    return li;
  });

  const displayName = name || (dineIn ? `Table ${table || ''}`.trim() : 'Takeaway');

  let fulfillment;
  if (dineIn && DINEIN_FULFILLMENT === 'IN_STORE') {
    fulfillment = { type: 'IN_STORE', state: 'PROPOSED' };
  } else {
    fulfillment = {
      type: 'PICKUP',
      state: 'PROPOSED',
      pickup_details: {
        recipient: { display_name: displayName },
        schedule_type: 'ASAP',
        note: buildNote({ dineIn, table }),
      },
    };
  }

  const order = {
    location_id: LOCATION_ID,
    ticket_name: buildTicketName({ dineIn, table, name }),
    line_items: lineItems,
    fulfillments: [fulfillment],
    note: buildNote({ dineIn, table }),
    source: { name: 'Bean Culture App' },
  };
  if (customerId) order.customer_id = customerId;
  if (isComp) {
    order.discounts = [
      { uid: 'comp', name: `Test comp (${COMP_COUPON_CODE})`, percentage: '100', scope: 'ORDER' },
    ];
  }

  const data = await squareFetch('/v2/orders', {
    method: 'POST',
    body: { order, idempotency_key: idem() },
  });
  return data.order;
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
    })),
  }));
}

module.exports = { createOrder, getOrder, createPayment, payZeroOrder, getHistory };
