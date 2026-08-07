// Card-on-file (Square Cards API).
// A card is tokenized in the browser by the Square Web Payments SDK (we never
// see raw PAN). CreateCard vaults it against the customer; later we can charge
// it server-side (customer-not-present) for scheduled / recurring pre-orders.

const { squareFetch, LOCATION_ID, CURRENCY, idem } = require('./squareClient');

function cardSummary(card) {
  if (!card) return null;
  return {
    id: card.id,
    brand: card.card_brand,
    last4: card.last_4,
    expMonth: card.exp_month,
    expYear: card.exp_year,
    cardholder: card.cardholder_name || '',
    enabled: card.enabled !== false,
  };
}

// Save a tokenized card to a customer's profile.
async function saveCard({ sourceId, customerId, verificationToken, cardholderName }) {
  if (!sourceId) throw new Error('Missing card token');
  if (!customerId) throw new Error('Sign in to save a card');
  const body = {
    idempotency_key: idem(),
    source_id: sourceId,
    card: { customer_id: customerId },
  };
  if (verificationToken) body.verification_token = verificationToken;
  if (cardholderName) body.card.cardholder_name = String(cardholderName).slice(0, 96);
  const data = await squareFetch('/v2/cards', { method: 'POST', body });
  return cardSummary(data.card);
}

// List a customer's saved (enabled) cards.
async function listCards(customerId) {
  if (!customerId) return [];
  const qs = new URLSearchParams({ customer_id: customerId });
  const data = await squareFetch(`/v2/cards?${qs.toString()}`);
  return (data.cards || []).filter((c) => c.enabled !== false).map(cardSummary);
}

// Disable (remove) a saved card. Square disables rather than hard-deletes.
async function disableCard(cardId) {
  if (!cardId) throw new Error('Missing card id');
  const data = await squareFetch(`/v2/cards/${cardId}/disable`, { method: 'POST' });
  return cardSummary(data.card);
}

// Charge a saved card on file (merchant-initiated; no buyer verification needed).
async function chargeSavedCard({ cardId, customerId, orderId, amountMoney, idempotencyKey }) {
  if (!cardId) throw new Error('Missing saved card');
  const body = {
    idempotency_key: idempotencyKey || idem(),
    source_id: cardId,
    customer_id: customerId,
    amount_money: amountMoney,
    order_id: orderId,
    location_id: LOCATION_ID,
    autocomplete: true,
  };
  const data = await squareFetch('/v2/payments', { method: 'POST', body });
  return data.payment;
}

module.exports = { saveCard, listCards, disableCard, chargeSavedCard, cardSummary, CURRENCY };
