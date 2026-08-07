// Square Gift Cards: prepaid balance (top-up), buying a digital eGift card for
// someone, adding a received card to an account, and paying with balance.
// A card payment funds each load; the payment id is passed as the
// buyer_payment_instrument for the ACTIVATE/LOAD activity.

const { squareFetch, LOCATION_ID, CURRENCY, moneyToNumber, idem } = require('./squareClient');

// Charge the buyer's card (no order) to fund a gift-card load.
async function chargeForLoad({ sourceId, amountMoney, verificationToken, customerId }) {
  const body = {
    source_id: sourceId,
    idempotency_key: idem(),
    amount_money: amountMoney,
    location_id: LOCATION_ID,
    autocomplete: true,
  };
  if (verificationToken) body.verification_token = verificationToken;
  if (customerId) body.customer_id = customerId;
  const data = await squareFetch('/v2/payments', { method: 'POST', body });
  return data.payment;
}

async function createGiftCard() {
  const data = await squareFetch('/v2/gift-cards', {
    method: 'POST',
    body: { idempotency_key: idem(), location_id: LOCATION_ID, gift_card: { type: 'DIGITAL', gan_source: 'SQUARE' } },
  });
  return data.gift_card;
}

async function activity(type, giftCardId, amountMoney, paymentId) {
  const details = { amount_money: amountMoney, buyer_payment_instrument_ids: [paymentId] };
  const gift_card_activity = { type, location_id: LOCATION_ID, gift_card_id: giftCardId };
  if (type === 'ACTIVATE') gift_card_activity.activate_activity_details = details;
  else gift_card_activity.load_activity_details = details;
  const data = await squareFetch('/v2/gift-cards/activities', {
    method: 'POST',
    body: { idempotency_key: idem(), gift_card_activity },
  });
  return data.gift_card_activity;
}

async function linkCustomer(giftCardId, customerId) {
  const data = await squareFetch(`/v2/gift-cards/${giftCardId}/link-customer`, {
    method: 'POST',
    body: { customer_id: customerId },
  });
  return data.gift_card;
}

async function fromGan(gan) {
  const data = await squareFetch('/v2/gift-cards/from-gan', { method: 'POST', body: { gan } });
  return data.gift_card;
}

function summary(gc) {
  if (!gc) return null;
  return { id: gc.id, gan: gc.gan, balance: moneyToNumber(gc.balance_money) || 0, state: gc.state };
}

// A signed-in customer's active gift card (their prepaid balance), or null.
async function customerCard(customerId) {
  if (!customerId) return null;
  const qs = new URLSearchParams({ customer_id: customerId, state: 'ACTIVE' });
  const data = await squareFetch(`/v2/gift-cards?${qs.toString()}`);
  const cards = (data.gift_cards || []).filter((c) => c.state === 'ACTIVE');
  return cards[0] || null;
}

async function getBalance(customerId) {
  const gc = await customerCard(customerId);
  return summary(gc);
}

// Top up the signed-in customer's balance (create their card if needed).
async function topUp({ customerId, sourceId, amountMoney, verificationToken }) {
  if (!customerId) throw new Error('Please sign in to top up.');
  const payment = await chargeForLoad({ sourceId, amountMoney, verificationToken, customerId });
  let gc = await customerCard(customerId);
  if (gc) {
    await activity('LOAD', gc.id, amountMoney, payment.id);
  } else {
    gc = await createGiftCard();
    await activity('ACTIVATE', gc.id, amountMoney, payment.id);
    await linkCustomer(gc.id, customerId);
  }
  return summary(await fromGan(gc.gan));
}

// Buy a digital gift card for someone else — returns the code to share/deliver.
async function buyGift({ sourceId, amountMoney, verificationToken, customerId }) {
  const payment = await chargeForLoad({ sourceId, amountMoney, verificationToken, customerId });
  const gc = await createGiftCard();
  await activity('ACTIVATE', gc.id, amountMoney, payment.id);
  return summary(await fromGan(gc.gan));
}

// Add a received gift card (by code) to the signed-in customer's balance.
async function addToAccount({ customerId, gan }) {
  if (!customerId) throw new Error('Please sign in.');
  const gc = await fromGan(String(gan).replace(/\s+/g, ''));
  if (!gc) throw new Error('That gift card code was not found.');
  await linkCustomer(gc.id, customerId);
  return summary(gc);
}

// Pay for an order with a gift card (its GAN is the payment source).
async function payWithGiftCard({ gan, orderId, amountMoney, customerId }) {
  const body = {
    source_id: gan,
    idempotency_key: idem(),
    amount_money: amountMoney,
    order_id: orderId,
    location_id: LOCATION_ID,
    autocomplete: true,
  };
  if (customerId) body.customer_id = customerId;
  const data = await squareFetch('/v2/payments', { method: 'POST', body });
  return data.payment;
}

module.exports = { getBalance, topUp, buyGift, addToAccount, payWithGiftCard, balanceFromGan: async (g) => summary(await fromGan(g)), CURRENCY };
