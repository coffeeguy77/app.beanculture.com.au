// Pay It Forward: buy-a-coffee-for-someone-else gifting.
//
// Architecture (non-negotiable): PURCHASE -> VOUCHER -> RECIPIENT -> REDEMPTION
// -> REAL ORDER. Buying a gift must NEVER create a live cafe order -- card
// payment charges the buyer directly with no order_id (same pattern as
// giftcards.js's chargeForLoad); points payment must attach to a real
// Square order because Square's loyalty API requires one, so that order is
// built with no kitchen-routed category and auto-completed instantly, never
// printed, never seen on a bump/KDS screen. Only the recipient's actual
// redemption at checkout creates a normal Square order through the
// unmodified ordering pipeline.
//
// This module owns: voucher generation, eligibility resolution (fail-closed
// against configured coffee categories), the purchase flow (card + points),
// SMS delivery, claim/view/consent tracking, checkout-time redemption
// (reserve/confirm/release), and the admin read models (list/detail/KPIs).
// The Postgres ledger (server/lib/db.js) is the single source of truth for
// balance -- Square is never treated as the master record for gift value.

const crypto = require('crypto');
const { squareFetch, CURRENCY, LOCATION_ID, idem } = require('./squareClient');
const { getSettings } = require('./settings');
const { cleanName } = require('./catalog');
const customers = require('./customers');
const loyalty = require('./loyalty');
const notify = require('./notify');
const db = require('./db');

const APP_URL = (process.env.APP_URL || 'https://app.beanculture.com.au').replace(/\/+$/, '');
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L -- avoids misreads over the phone

function genToken() {
  return crypto.randomBytes(24).toString('base64url');
}
function genCode() {
  let s = '';
  for (let i = 0; i < 5; i++) s += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return `BC-${s}`;
}
function genId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function pifSettings() {
  return getSettings().payItForward || {};
}

function claimUrl(token) {
  return `${APP_URL}/gift/${token}`;
}

// ---- Eligibility (section 13/34 -- fail closed, never silently allow everything) ----

// Minimal raw catalog read, same shape/spirit as combos.js's loadRawCatalog:
// independent of storefront visibility settings, so eligibility always
// reflects the real Square catalog.
async function loadRawCatalog() {
  const objects = [];
  let cursor;
  do {
    const qs = new URLSearchParams({ types: 'ITEM,CATEGORY' });
    if (cursor) qs.set('cursor', cursor);
    const data = await squareFetch(`/v2/catalog/list?${qs.toString()}`);
    if (data.objects) objects.push(...data.objects);
    cursor = data.cursor;
  } while (cursor);

  const categoriesById = new Map(); // id -> cleaned name
  const itemsById = new Map();      // itemId -> { categoryIds: Set, variationIds: Map<id, priceCents> }
  for (const obj of objects) {
    if (obj.is_deleted) continue;
    if (obj.type === 'CATEGORY') {
      categoriesById.set(obj.id, cleanName(obj.category_data?.name || ''));
    } else if (obj.type === 'ITEM') {
      const d = obj.item_data || {};
      const categoryIds = new Set();
      for (const c of d.categories || []) if (c && c.id) categoryIds.add(c.id);
      if (d.reporting_category?.id) categoryIds.add(d.reporting_category.id);
      if (d.category_id) categoryIds.add(d.category_id);
      const variationIds = new Map();
      for (const v of d.variations || []) {
        if (v.is_deleted) continue;
        variationIds.set(v.id, (v.item_variation_data?.price_money?.amount) || 0);
      }
      itemsById.set(obj.id, { categoryIds, variationIds });
    }
  }
  return { categoriesById, itemsById };
}

// Resolves the admin's configured eligible categories against the real
// catalog. Prefers stored category IDs (stable); names are only a fallback /
// display label. FAILS CLOSED: if nothing resolves, returns an empty
// eligible set (no items discountable) rather than defaulting to "all items"
// -- a broken config should never accidentally widen what a voucher can buy.
async function resolveEligibility() {
  const settings = pifSettings();
  const idx = await loadRawCatalog();
  const configuredIds = new Set((settings.eligibleCategoryIds || []).filter(Boolean));
  const configuredNames = new Set((settings.eligibleCategoryNames || []).map((n) => cleanName(String(n)).toLowerCase()).filter(Boolean));

  const resolvedCategoryIds = new Set();
  let anyIdVanished = false;
  for (const id of configuredIds) {
    if (idx.categoriesById.has(id)) resolvedCategoryIds.add(id);
    else anyIdVanished = true;
  }
  if (!resolvedCategoryIds.size && configuredNames.size) {
    for (const [id, name] of idx.categoriesById) {
      if (configuredNames.has(name.toLowerCase())) resolvedCategoryIds.add(id);
    }
  }

  const eligibleItemIds = new Set();
  if (resolvedCategoryIds.size) {
    for (const [itemId, item] of idx.itemsById) {
      for (const catId of item.categoryIds) {
        if (resolvedCategoryIds.has(catId)) { eligibleItemIds.add(itemId); break; }
      }
    }
  }

  const warning = (!configuredIds.size && !configuredNames.size)
    ? 'No eligible categories configured yet -- Pay It Forward vouchers cannot discount anything until you choose coffee categories in Settings.'
    : (!resolvedCategoryIds.size
      ? 'Pay It Forward category configuration requires attention -- none of the configured categories were found in Square. Vouchers cannot discount anything until this is fixed.'
      : (anyIdVanished
        ? 'One or more Pay It Forward categories no longer exist in Square -- some eligible items may be missing. Review Settings.'
        : null));

  return { idx, eligibleItemIds, resolvedCategoryIds, ok: eligibleItemIds.size > 0, warning };
}

// Sum of cents across cart lines whose item resolves into the eligible set.
// Never trusts a client-sent "eligible" flag -- always re-derives from the
// fresh catalog scan above.
// Returns eligible CART-ARRAY INDEXES (not uids) -- orders.js builds its
// Square line_items 1:1 index-aligned with the cart array it's given, so an
// index here maps directly onto which Square line item to attach the
// LINE_ITEM-scope discount to, with no need for the client to invent/send
// its own line uids.
function eligibleLineValueCents(cart, idx, eligibleItemIds) {
  let total = 0;
  const eligibleIndexes = [];
  const list = Array.isArray(cart) ? cart : [];
  for (let i = 0; i < list.length; i++) {
    const line = list[i];
    if (!line || !line.variationId) continue;
    let owningItem = null;
    for (const [itemId, item] of idx.itemsById) {
      if (item.variationIds.has(line.variationId)) { owningItem = itemId; break; }
    }
    if (!owningItem || !eligibleItemIds.has(owningItem)) continue;
    const unitPrice = idx.itemsById.get(owningItem).variationIds.get(line.variationId) || 0;
    const qty = Math.max(1, parseInt(line.quantity, 10) || 1);
    total += unitPrice * qty;
    eligibleIndexes.push(i);
  }
  return { totalCents: total, eligibleIndexes };
}

// ---- Purchase ----

function clampValue(valueCents, settings) {
  const min = settings.minValueCents || 0;
  const max = settings.maxValueCents || Infinity;
  const v = Math.round(Number(valueCents) || 0);
  return Math.max(min, Math.min(max, v));
}

async function createPendingGift({ valueCents, paymentMethod, purchaserCustomerId, purchaserName, purchaserPhone, purchaserNotify, recipientName, recipientPhone, recipientEmail, message, idempotencyKey, giftType }) {
  const settings = pifSettings();
  const id = genId('pif');
  const token = genToken();
  const code = genCode();
  const expiresAt = settings.expiryDays ? new Date(Date.now() + settings.expiryDays * 86400000).toISOString() : null;
  const g = await db.pifInsertGift({
    id, token, code, giftType: giftType || 'DIRECT',
    purchaserCustomerId, purchaserName, purchaserPhone, purchaserNotify,
    recipientName, recipientPhone: customers.normalizePhone(recipientPhone), recipientEmail,
    message, valueCents, paymentMethod, status: 'PENDING_PAYMENT', expiresAt, idempotencyKey,
  });
  return g;
}

async function finishGiftAfterPurchase(gift) {
  await db.pifActivate(gift.id);
  const fresh = await db.pifGetById(gift.id);
  sendGiftSms(fresh).catch((e) => console.warn('[payItForward] SMS send failed:', e.message));
  return fresh;
}

// Charge the buyer's card with NO order_id -- exactly the giftcards.js
// chargeForLoad pattern -- so nothing can route to a kitchen printer or KDS.
async function chargeCardDirect({ sourceId, verificationToken, amountMoney, customerId }) {
  const body = { source_id: sourceId, idempotency_key: idem(), amount_money: amountMoney, location_id: LOCATION_ID, autocomplete: true };
  if (verificationToken) body.verification_token = verificationToken;
  if (customerId) body.customer_id = customerId;
  const data = await squareFetch('/v2/payments', { method: 'POST', body });
  return data.payment;
}

async function purchaseWithCard({ sourceId, verificationToken, valueCents, purchaserCustomerId, purchaserName, purchaserPhone, purchaserNotify, recipientName, recipientPhone, recipientEmail, message, idempotencyKey }) {
  const settings = pifSettings();
  if (!settings.enabled) throw new Error('Pay It Forward is not currently available.');
  const value = clampValue(valueCents, settings);
  const gift = await createPendingGift({
    valueCents: value, paymentMethod: 'card', purchaserCustomerId, purchaserName, purchaserPhone, purchaserNotify,
    recipientName, recipientPhone, recipientEmail, message, idempotencyKey,
  });
  if (!gift) throw new Error('This gift purchase was already processed.');
  if (gift.status !== 'PENDING_PAYMENT') return gift; // idempotent replay
  try {
    const payment = await chargeCardDirect({ sourceId, verificationToken, amountMoney: { amount: value, currency: CURRENCY }, customerId: purchaserCustomerId });
    await db.pifSetPaymentResult(gift.id, { status: 'ACTIVE', squarePaymentId: payment.id });
    await db.pifLogEvent(gift.id, 'purchased', { method: 'card', valueCents: value, paymentId: payment.id });
    return finishGiftAfterPurchase(await db.pifGetById(gift.id));
  } catch (e) {
    await db.pifSetPaymentResult(gift.id, { status: 'PAYMENT_FAILED' });
    await db.pifLogEvent(gift.id, 'payment_failed', { method: 'card', error: e.message });
    throw e;
  }
}

// Points payment: Square's loyalty reward API requires a real order_id, so we
// create one purely for loyalty bookkeeping -- no printable category, no
// kitchen routing, auto-completed instantly. Accepted resolution to that
// Square platform limitation, confirmed with the store owner.
async function purchaseWithPoints({ rewardTierId, loyaltyAccountId, purchaserCustomerId, purchaserName, purchaserPhone, purchaserNotify, recipientName, recipientPhone, recipientEmail, message, idempotencyKey }) {
  const settings = pifSettings();
  if (!settings.enabled) throw new Error('Pay It Forward is not currently available.');
  if (!settings.allowPointsPayment) throw new Error('Points payment is not enabled for Pay It Forward.');
  if (!purchaserCustomerId) throw new Error('Please sign in to gift with points.');

  const bookkeepingOrder = {
    location_id: LOCATION_ID,
    ticket_name: 'PAY IT FORWARD (internal)',
    line_items: [{ name: 'Pay It Forward gift (loyalty)', quantity: '1', base_price_money: { amount: 0, currency: CURRENCY } }],
    note: 'Internal loyalty bookkeeping only -- not a customer order, never fulfilled.',
    source: { name: 'Bean Culture App' },
    customer_id: purchaserCustomerId,
  };
  const created = await squareFetch('/v2/orders', { method: 'POST', body: { order: bookkeepingOrder, idempotency_key: idem() } });
  const orderId = created.order.id;

  const gift = await createPendingGift({
    valueCents: 0, paymentMethod: 'points', purchaserCustomerId, purchaserName, purchaserPhone, purchaserNotify,
    recipientName, recipientPhone, recipientEmail, message, idempotencyKey,
  });
  if (!gift) throw new Error('This gift purchase was already processed.');
  try {
    const reward = await loyalty.createReward({ loyaltyAccountId, rewardTierId, orderId });
    // Read the real, Square-calculated discount off the order Square just
    // built -- never invent our own points-to-dollars conversion. Fetched and
    // completed directly (not via orders.js) to avoid a circular require --
    // orders.js itself calls into this module for checkout-time redemption.
    const finalOrderData = await squareFetch(`/v2/orders/${orderId}`);
    const finalOrder = finalOrderData.order;
    const discountCents = (finalOrder.discounts || []).reduce((s, d) => s + (d.applied_money?.amount || 0), 0);
    if (!discountCents) throw new Error('Square did not apply a reward discount to this order.');
    await squareFetch(`/v2/orders/${orderId}/pay`, { method: 'POST', body: { idempotency_key: idem(), order_version: finalOrder.version, payment_ids: [] } }).catch(() => {});
    await db.pifSetPaymentResult(gift.id, { status: 'ACTIVE', loyaltyOrderId: orderId, loyaltyPointsUsed: reward.points });
    await db.pifSetGiftValue(gift.id, discountCents);
    await db.pifLogEvent(gift.id, 'purchased', { method: 'points', valueCents: discountCents, loyaltyOrderId: orderId, rewardId: reward.id });
    return finishGiftAfterPurchase(await db.pifGetById(gift.id));
  } catch (e) {
    await db.pifSetPaymentResult(gift.id, { status: 'PAYMENT_FAILED' });
    await db.pifLogEvent(gift.id, 'payment_failed', { method: 'points', error: e.message });
    throw e;
  }
}

// ---- SMS delivery ----

async function sendGiftSms(gift, { isResend } = {}) {
  const settings = pifSettings();
  if (!gift.recipientPhone) return false;
  const url = claimUrl(gift.token);
  const template = settings.smsTemplate || '{{purchaserName}} sent you a coffee! Claim it: {{claimUrl}}';
  const body = template
    .replace(/{{\s*purchaserName\s*}}/g, gift.purchaserName || 'Someone')
    .replace(/{{\s*claimUrl\s*}}/g, url)
    .replace(/{{\s*code\s*}}/g, gift.code);
  await db.pifUpdateSms(gift.id, { incrementAttempts: true });
  const ok = await notify.sendSMS(gift.recipientPhone, body);
  await db.pifUpdateSms(gift.id, { status: ok ? 'SENT' : 'FAILED' });
  await db.pifLogEvent(gift.id, isResend ? 'sms_resent' : 'sms_sent', { ok });
  return ok;
}

// ---- Claim / view ----

// Public, sanitized view for the claim page -- never exposes purchaser
// account details, never lets the message be scraped without the token.
async function publicGiftView(token) {
  const gift = await db.pifGetByToken(token);
  if (!gift) return null;
  return {
    token: gift.token,
    giftType: gift.giftType,
    purchaserName: gift.purchaserName || 'Someone',
    recipientName: gift.recipientName,
    message: gift.message,
    valueCents: gift.valueCents,
    remainingCents: gift.remainingCents,
    currency: gift.currency,
    status: gift.status,
    expiresAt: gift.expiresAt,
    claimedAt: gift.claimedAt,
  };
}

async function markViewed(token) {
  return db.pifMarkViewed(token);
}

async function claim(token, { recipientCustomerId, marketingConsent, marketingConsentSource } = {}) {
  return db.pifMarkClaimed(token, { recipientCustomerId, marketingConsent, marketingConsentSource });
}

// ---- Checkout-time redemption ----

// Step 1 of 2 -- call before creating the real Square order. Validates the
// voucher, re-derives eligible line value from the fresh catalog, reserves
// (atomically decrements) the balance, and returns which line uids the
// resulting Square LINE_ITEM-scope discount should attach to. If Square
// order/payment creation subsequently fails, the caller MUST call
// releaseReservation so the customer's balance is never lost.
async function reserveForCheckout({ tokenOrCode, cart, redeemedByCustomerId }) {
  const gift = tokenOrCode.startsWith('BC-') ? await db.pifGetByCode(tokenOrCode) : await db.pifGetByToken(tokenOrCode);
  if (!gift) return { ok: false, reason: 'not_found' };
  if (!['ACTIVE', 'PARTIALLY_REDEEMED'].includes(gift.status)) return { ok: false, reason: 'not_redeemable', status: gift.status };

  const { idx, eligibleItemIds, ok, warning } = await resolveEligibility();
  if (!ok) return { ok: false, reason: 'no_eligible_categories', warning };
  const { totalCents, eligibleIndexes } = eligibleLineValueCents(cart, idx, eligibleItemIds);
  if (!totalCents) return { ok: false, reason: 'no_eligible_items_in_cart' };

  const amount = Math.min(totalCents, gift.remainingCents);
  const reservation = await db.pifReserve(gift.id, amount, { redeemedByCustomerId });
  if (!reservation.ok) return reservation;

  return {
    ok: true,
    giftId: gift.id,
    redemptionId: reservation.redemptionId,
    amountCents: reservation.amountCents,
    remainingCents: reservation.remainingCents,
    eligibleIndexes,
  };
}

async function confirmReservation(redemptionId, orderId) {
  const result = await db.pifConfirmRedemption(redemptionId, orderId);
  if (result) notifyPurchaserOfRedemption(result).catch((e) => console.warn('[payItForward] purchaser notify failed:', e.message));
  return result;
}

// Best-effort, opt-out-able purchaser notification ("Sarah just enjoyed the
// coffee you sent her") -- uses the existing SMS infra, never blocks the
// redemption itself, and never overshares (no order contents, no recipient
// message).
async function notifyPurchaserOfRedemption({ giftId, remainingAfterCents }) {
  const gift = await db.pifGetById(giftId);
  if (!gift || gift.purchaserNotify === false || !gift.purchaserPhone) return;
  const firstName = (gift.recipientName || 'They').split(' ')[0];
  const body = remainingAfterCents > 0
    ? `☕ ${firstName} just used part of the coffee you sent — nice one!`
    : `☕ ${firstName} just enjoyed the coffee you sent them. Nice work — you made someone's day.`;
  await notify.sendSMS(gift.purchaserPhone, body);
  await db.pifLogEvent(giftId, 'purchaser_notified', {});
}
async function releaseReservation(redemptionId) {
  return db.pifReleaseRedemption(redemptionId);
}

// Builds the Square order discount object for a reservation -- LINE_ITEM
// scope, attached only to the eligible line uids, so a voucher can never
// discount a Coke, a t-shirt, or a bag of beans sitting in the same cart.
function discountForReservation(reservation) {
  return {
    discount: {
      uid: `pif-${reservation.redemptionId}`,
      name: 'Pay It Forward gift',
      amount_money: { amount: reservation.amountCents, currency: CURRENCY },
      scope: 'LINE_ITEM',
    },
    eligibleIndexes: reservation.eligibleIndexes,
  };
}

// ---- Account views ----

async function giftsForCustomer(customerId, phone) {
  const [sent, received] = await Promise.all([
    db.pifListByPurchaser(customerId),
    phone ? db.pifListByRecipientPhone(customers.normalizePhone(phone)) : [],
  ]);
  return { sent, received };
}

// ---- Admin ----

async function adminList(opts) { return db.pifListAdmin(opts); }
async function adminDetail(id) {
  const gift = await db.pifGetById(id);
  if (!gift) return null;
  const [events, redemptions] = await Promise.all([db.pifEvents(id), db.pifRedemptions(id)]);
  return { gift, events, redemptions };
}
async function adminResendSms(id) {
  const gift = await db.pifGetById(id);
  if (!gift) throw new Error('Gift not found');
  if (gift.status === 'PENDING_PAYMENT') throw new Error('This gift has not been paid for yet.');
  await sendGiftSms(gift, { isResend: true });
  return db.pifGetById(id);
}
async function adminCancel(id) {
  const gift = await db.pifCancel(id);
  if (gift) await db.pifLogEvent(id, 'cancelled', {});
  return gift;
}
async function adminRefund(id, status = 'REFUNDED') {
  const gift = await db.pifRefund(id, status);
  if (gift) await db.pifLogEvent(id, 'refunded', { status });
  return gift;
}
async function adminKpis(days) { return db.pifKpis(days); }
async function adminEligibility() { return resolveEligibility(); }

// ---- Expiry sweep (non-destructive) ----
async function sweepExpired() {
  const ids = await db.pifExpireDue();
  for (const id of ids) await db.pifLogEvent(id, 'expired', {});
  return ids;
}

module.exports = {
  resolveEligibility, eligibleLineValueCents, loadRawCatalog,
  purchaseWithCard, purchaseWithPoints,
  publicGiftView, markViewed, claim,
  reserveForCheckout, confirmReservation, releaseReservation, discountForReservation,
  giftsForCustomer,
  adminList, adminDetail, adminResendSms, adminCancel, adminRefund, adminKpis, adminEligibility,
  sweepExpired, claimUrl, sendGiftSms,
};
