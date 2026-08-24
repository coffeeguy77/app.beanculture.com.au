const path = require('path');
const crypto = require('crypto');
const express = require('express');

const sq = require('./lib/squareClient');
const catalog = require('./lib/catalog');
const orders = require('./lib/orders');
const customers = require('./lib/customers');
const loyalty = require('./lib/loyalty');
const hours = require('./lib/hours');
const { getSettings, activeSeasonal, seasonalForPicker } = require('./lib/settings');
const cloudinary = require('./lib/cloudinary');
const squareImages = require('./lib/squareImages');
const coupons = require('./lib/coupons');
const sales = require('./lib/sales');
const db = require('./lib/db');
const cards = require('./lib/cards');
const giftcards = require('./lib/giftcards');
const scheduler = require('./lib/scheduled');
const notify = require('./lib/notify');
const payItForward = require('./lib/payItForward');

const PREORDER_TZ = process.env.PREORDER_TZ || process.env.SEASON_TZ || 'Australia/Sydney';
const PREORDER_MAX_DAYS = Number(process.env.PREORDER_MAX_DAYS || 14);

const app = express();
app.use(express.json({ limit: '12mb' }));

function adminOk(req) {
  const pass = process.env.ADMIN_PASSCODE || '';
  return !pass || req.query.pass === pass || (req.body && req.body.pass === pass);
}
app.use((req, _res, next) => {
  if (req.path.startsWith('/api')) console.log(`${req.method} ${req.path}`);
  next();
});

// A build id that changes on every deploy — the client compares it and reloads
// itself when a new version is live, so nobody is ever stuck on a stale app.
const BUILD_ID = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.RAILWAY_DEPLOYMENT_ID || String(Date.now());

// ---- Public config: Square SDK ids + storefront settings + hours snapshot ----
app.get('/api/config', async (_req, res) => {
  // Never let a browser, proxy, or CDN cache this — it drives live flags like
  // `reservations` (tied to DB health) and the build id the client polls to
  // detect a new deploy; a cached stale response would silently hide features.
  res.setHeader('Cache-Control', 'no-store');
  const settings = getSettings();
  let hoursStatus = null;
  try {
    hoursStatus = await hours.getStatus();
  } catch (e) {
    hoursStatus = { open: true, canOrderNow: true };
  }
  res.json({
    build: BUILD_ID,
    applicationId: sq.APPLICATION_ID,
    locationId: sq.LOCATION_ID,
    environment: sq.ENV,
    currency: sq.CURRENCY,
    storeName: settings.storeName,
    announcement: settings.announcement,
    contact: settings.contact,
    logoUrl: settings.logoUrl,
    faviconUrl: settings.faviconUrl,
    storePhoto: settings.storePhoto,
    bio: settings.bio,
    googleReviewUrl: settings.googleReviewUrl,
    supportMessage: settings.supportMessage,
    theme: settings.theme,
    themePresets: settings.themePresets,
    seasonalThemes: seasonalForPicker(settings),
    effects: (settings.effects && settings.effects.presets || [])
      .filter((e) => e.enabled !== false)
      .map((e) => ({
        id: e.id, name: e.name, slug: e.slug, description: e.description,
        frontendSelectable: !!e.frontendSelectable, renderer: e.renderer,
        assets: e.assets, motion: e.motion, emission: e.emission,
        appearance: e.appearance, randomness: e.randomness, accessibility: e.accessibility,
      })),
    activeSeasonalTheme: activeSeasonal(settings),
    hero: settings.hero,
    heroRatio: settings.heroRatio,
    heroAutoplay: settings.heroAutoplay,
    heroInterval: settings.heroInterval,
    siteMaxWidth: settings.siteMaxWidth,
    layoutMode: settings.layoutMode,
    topMenuStyle: settings.topMenuStyle,
    footer: settings.footer,
    topMenu: settings.topMenu || [],
    categoryIcons: settings.categoryIcons || {},
    dockIconScale: settings.dockIconScale || 1,
    footerIconScale: settings.footerIconScale || 1,
    kitchenClosingOrderCategory: settings.kitchenClosingOrderCategory || '',
    preorderCategory: settings.preorderCategory || '',
    cloudinary: cloudinary.configured(),
    hours: hoursStatus,
    scheduling: {
      enabled: db.enabled,          // recurring / auto-charge need the database
      savedCards: true,             // card-on-file is available (Square Cards API)
      timezone: PREORDER_TZ,
      maxDaysAhead: PREORDER_MAX_DAYS,
    },
    reservations: db.enabled,       // table booking needs the database
  });
});

// ---- Menu (live from Square Catalog, short cache) ----
let menuCache = { data: null, at: 0 };
const MENU_TTL_MS = Number(process.env.MENU_TTL_MS || 45_000);
app.get('/api/menu', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const now = Date.now();
    if (menuCache.data && now - menuCache.at < MENU_TTL_MS) return res.json(menuCache.data);
    const menu = await catalog.getMenu();
    menuCache = { data: menu, at: now };
    res.json(menu);
  } catch (err) {
    console.error('menu error', err.message);
    res.status(502).json({ error: 'Could not load menu', detail: err.message });
  }
});

app.get('/api/hours', async (_req, res) => {
  try {
    res.json(await hours.getStatus());
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ---- Passwordless sign-in (phone -> Square customer) ----
app.post('/api/auth', async (req, res) => {
  try {
    const { phone, name } = req.body || {};
    const who = await customers.findOrCreate({ phone, name });
    // Auto-enrol the customer in Square Loyalty on sign-in (best-effort).
    if (getSettings().loyalty?.autoEnrollOnSignIn) {
      loyalty.enrollAccount({ phone: who.phone, customerId: who.customerId }).catch(() => {});
    }
    res.json(who);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- Loyalty balance + affordable reward tiers for a phone ----
app.get('/api/loyalty', async (req, res) => {
  try {
    const phone = req.query.phone;
    if (!phone) return res.json({ active: false });
    res.json(await loyalty.getCustomerLoyalty(phone));
  } catch (e) {
    res.json({ active: false, error: e.message });
  }
});

// ---- Order history for a signed-in customer ----
app.get('/api/history', async (req, res) => {
  try {
    const { customerId } = req.query;
    res.json({ orders: await orders.getHistory(customerId) });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ---- Create an order (with optional loyalty redemption) ----
app.post('/api/orders', async (req, res) => {
  try {
    const { cart, dineIn, table, name, coupon, customerId, phone, pickupAt, note, loyalty: loy, pifVoucher } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }
    if (dineIn && !table) {
      return res.status(400).json({ error: 'Table number is required for dine-in orders' });
    }
    const lset = getSettings().loyalty || {};
    // A Pay It Forward recipient who isn't signed in: enrol them by the phone we
    // texted the gift to, and stamp the order with their customer id so the free
    // gifted coffee earns points on their card.
    let effectiveCustomerId = customerId;
    let orderPhone = phone;
    if (!effectiveCustomerId && pifVoucher && lset.autoEnrollGiftRecipients) {
      try {
        const rcpt = await payItForward.recipientForVoucher(pifVoucher);
        if (rcpt && rcpt.recipientPhone) {
          const cust = await customers.findOrCreate({ phone: rcpt.recipientPhone, name: rcpt.recipientName });
          effectiveCustomerId = cust.customerId;
          orderPhone = cust.phone;
          await loyalty.enrollAccount({ phone: cust.phone, customerId: cust.customerId });
        }
      } catch (e) { console.error('pif recipient enrol failed', e.message); }
    }
    const order = await orders.createOrder({ cart, dineIn: !!dineIn, table, name, coupon, customerId: effectiveCustomerId, pickupAt, note, pifVoucher });

    let rewardApplied = false;
    if (loy && loy.accountId && loy.tierId) {
      try {
        await loyalty.createReward({
          loyaltyAccountId: loy.accountId,
          rewardTierId: loy.tierId,
          orderId: order.id,
        });
        rewardApplied = true;
      } catch (e) {
        console.error('loyalty reward failed', e.message);
      }
    }

    // First-transaction welcome point (best-effort, fire-and-forget so it never
    // delays the order response). Granted once when this is the customer's first
    // order.
    if (lset.firstTransactionBonusPoints > 0 && effectiveCustomerId) {
      (async () => {
        try {
          const hist = await orders.getHistory(effectiveCustomerId, 5);
          if ((hist?.length || 0) === 1) {
            let ph = orderPhone;
            if (!ph) { const c = await customers.get(effectiveCustomerId); ph = c && c.phone_number; }
            if (ph) {
              const acct = (await loyalty.getAccountByPhone(ph)) || (await loyalty.enrollAccount({ phone: ph, customerId: effectiveCustomerId }));
              if (acct && acct.id) await loyalty.adjustPoints({ accountId: acct.id, points: lset.firstTransactionBonusPoints, reason: 'Welcome — first order' });
            }
          }
        } catch (e) { console.error('welcome point failed', e.message); }
      })();
    }

    const fresh = rewardApplied ? await orders.getOrder(order.id) : order;
    res.json({
      orderId: fresh.id,
      totalMoney: fresh.total_money,
      version: fresh.version,
      ticketName: fresh.ticket_name,
      rewardApplied,
    });
  } catch (err) {
    console.error('order error', err.message);
    res.status(400).json({ error: err.pifReason ? err.message : 'Could not create order', detail: err.message, pifReason: err.pifReason || undefined });
  }
});

// ---- Pay (card token, or complete a $0 order for comp/full-loyalty) ----
app.post('/api/pay', async (req, res) => {
  try {
    const { sourceId, orderId, totalMoney, verificationToken, buyerEmail, customerId, payWith } =
      req.body || {};
    if (!orderId) return res.status(400).json({ error: 'Missing order id' });

    // $0 order (comp or fully covered by loyalty): complete without a card.
    if (!totalMoney || totalMoney.amount === 0) {
      const fresh = await orders.getOrder(orderId);
      await orders.payZeroOrder(orderId, fresh.version);
      return res.json({ status: 'COMPLETED', comped: true });
    }

    // Pay from the customer's prepaid gift-card balance.
    if (payWith === 'balance') {
      const gc = await giftcards.getBalance(customerId);
      if (!gc || !gc.gan) return res.status(402).json({ error: 'No balance available' });
      if (gc.balance < totalMoney.amount) return res.status(402).json({ error: 'Not enough balance — top up or pay by card.' });
      const payment = await giftcards.payWithGiftCard({ gan: gc.gan, orderId, amountMoney: totalMoney, customerId });
      return res.json({ status: payment.status, paymentId: payment.id, paidWithBalance: true });
    }

    if (!sourceId) return res.status(400).json({ error: 'Missing payment token' });
    const payment = await orders.createPayment({
      sourceId,
      orderId,
      amountMoney: totalMoney,
      verificationToken,
      buyerEmail,
      customerId,
    });
    res.json({ status: payment.status, paymentId: payment.id, receiptUrl: payment.receipt_url });
  } catch (err) {
    console.error('payment error', err.message);
    res.status(402).json({ error: 'Payment failed', detail: err.message });
  }
});

// ---- Saved cards (card-on-file) ----
app.get('/api/cards', async (req, res) => {
  try {
    const { customerId } = req.query;
    if (!customerId) return res.json({ cards: [] });
    res.json({ cards: await cards.listCards(customerId) });
  } catch (e) {
    res.json({ cards: [], error: e.message });
  }
});
app.post('/api/cards', async (req, res) => {
  try {
    const { sourceId, customerId, verificationToken, cardholderName } = req.body || {};
    const card = await cards.saveCard({ sourceId, customerId, verificationToken, cardholderName });
    res.json({ card });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.post('/api/cards/:id/disable', async (req, res) => {
  try {
    await cards.disableCard(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- Scheduled / recurring pre-orders (auto-charged from a saved card) ----
app.get('/api/scheduled', async (req, res) => {
  try {
    const { customerId } = req.query;
    res.json({ orders: await db.listScheduledByCustomer(customerId) });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});
app.post('/api/scheduled', async (req, res) => {
  try {
    if (!db.enabled) return res.status(400).json({ error: 'Scheduling is not available right now.' });
    const { cart, dineIn, table, name, phone, customerId, cardId, recurrence, pickupAt, label, amount } = req.body || {};
    if (!customerId) return res.status(400).json({ error: 'Please sign in to schedule an order.' });
    if (!cardId) return res.status(400).json({ error: 'A saved card is required for scheduled orders.' });
    if (!Array.isArray(cart) || !cart.length) return res.status(400).json({ error: 'Your order is empty.' });
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required.' });
    if (dineIn && !table) return res.status(400).json({ error: 'Table number is required for dine-in.' });

    const plan = scheduler.planSchedule({ recurrence, pickupAt });
    const isRecurring = recurrence && recurrence.type && recurrence.type !== 'none';
    // Delayed capture is possible when a single pickup is within the ~7-day
    // online authorization window; otherwise we do a funds check then void.
    const withinCapture = !isRecurring &&
      (new Date(plan.pickupAt).getTime() - Date.now()) <= (7 * 86400000 - 3600000);

    let paymentId = null, lastOrderId = null, mode = 'autocharge';
    try {
      if (withinCapture) {
        // Create the order now (kitchen sees it scheduled), authorize (hold) the
        // funds, and capture at pickup. A decline here = insufficient funds.
        const order = await orders.createOrder({ cart, dineIn: !!dineIn, table, name, customerId, pickupAt: plan.pickupAt });
        const payment = await orders.authorizePayment({ sourceId: cardId, orderId: order.id, amountMoney: order.total_money, customerId });
        paymentId = payment.id; lastOrderId = order.id; mode = 'capture';
      } else {
        // Recurring / far-out: verify the card has funds now, then void the hold.
        const amt = { amount: Math.max(50, Number(amount) || 0), currency: sq.CURRENCY };
        const payment = await orders.authorizePayment({ sourceId: cardId, amountMoney: amt, customerId });
        await orders.cancelPayment(payment.id);
        mode = 'autocharge';
      }
    } catch (e) {
      return res.status(402).json({ error: e.message, declined: true });
    }

    const id = 'sch_' + sq.idem();
    const row = await db.insertScheduled({
      id, customerId, name, phone, dineIn: !!dineIn, table,
      cart, cardId, paymentId, mode, recurrence: recurrence || { type: 'none' },
      pickupAt: plan.pickupAt, nextRun: plan.nextRun, label, lastOrderId,
    });
    res.json({ scheduled: row });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.post('/api/scheduled/:id/cancel', async (req, res) => {
  try {
    const { customerId } = req.body || {};
    const row = await db.cancelScheduled(req.params.id, customerId);
    // Release the authorization hold if this was a pending delayed capture.
    if (row && row.mode === 'capture' && row.paymentId) {
      try { await orders.cancelPayment(row.paymentId); } catch {}
    }
    res.json({ ok: !!row });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- Gift cards: prepaid balance, gifting, redeem ----
app.get('/api/giftcard/balance', async (req, res) => {
  try {
    const { customerId } = req.query;
    if (!customerId) return res.json({ balance: 0 });
    const b = await giftcards.getBalance(customerId);
    res.json(b || { balance: 0 });
  } catch (e) {
    res.json({ balance: 0, error: e.message });
  }
});
app.post('/api/giftcard/topup', async (req, res) => {
  try {
    const { customerId, sourceId, amount, verificationToken } = req.body || {};
    if (!sourceId) return res.status(400).json({ error: 'Missing payment token' });
    const amountMoney = { amount: Math.max(100, Number(amount) || 0), currency: giftcards.CURRENCY };
    res.json(await giftcards.topUp({ customerId, sourceId, amountMoney, verificationToken }));
  } catch (e) {
    res.status(402).json({ error: e.message });
  }
});
app.post('/api/giftcard/buy', async (req, res) => {
  try {
    const { sourceId, amount, verificationToken, customerId } = req.body || {};
    if (!sourceId) return res.status(400).json({ error: 'Missing payment token' });
    const amountMoney = { amount: Math.max(500, Number(amount) || 0), currency: giftcards.CURRENCY };
    res.json(await giftcards.buyGift({ sourceId, amountMoney, verificationToken, customerId }));
  } catch (e) {
    res.status(402).json({ error: e.message });
  }
});
app.post('/api/giftcard/redeem', async (req, res) => {
  try {
    const { customerId, gan } = req.body || {};
    if (!gan) return res.status(400).json({ error: 'Enter a gift card code' });
    res.json(await giftcards.addToAccount({ customerId, gan }));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- Pay It Forward: buy-a-coffee-for-someone gifting ----------------------
// Purchasing a gift NEVER creates a live cafe order (see server/lib/payItForward.js
// for the full reasoning) -- only the recipient's actual redemption, wired
// into the existing /api/orders route above via `pifVoucher`, creates a real
// Square order through the unmodified ordering pipeline.

// Small in-memory sliding-window limiter for the public claim/lookup
// endpoints (section 31's rate-limit requirement) -- no new dependency
// needed, consistent with this app's other hand-rolled abuse guards (the
// captcha above). Per-IP, resets naturally as old entries age out.
const pifRateBuckets = new Map();
function pifRateLimited(req, limit = 20, windowMs = 5 * 60 * 1000) {
  const key = req.ip || req.headers['x-forwarded-for'] || 'unknown';
  const now = Date.now();
  const hits = (pifRateBuckets.get(key) || []).filter((t) => now - t < windowMs);
  hits.push(now);
  pifRateBuckets.set(key, hits);
  if (pifRateBuckets.size > 5000) pifRateBuckets.clear(); // crude memory guard
  return hits.length > limit;
}

// Sanitized, public config for the purchase flow -- no admin secrets.
app.get('/api/pay-it-forward/config', (_req, res) => {
  const s = getSettings().payItForward || {};
  // Normalise presets to { label, valueCents }. Accept legacy bare numbers
  // (cents) so old saved settings keep working; drop anything without a value.
  const presets = (s.suggestedValues || [])
    .map((v) => (v && typeof v === 'object')
      ? { label: String(v.label || '').trim(), valueCents: Math.round(v.valueCents || v.value || 0) }
      : { label: '', valueCents: Math.round(Number(v) || 0) })
    .filter((p) => p.valueCents > 0);
  res.json({
    enabled: !!s.enabled,
    suggestedValues: presets,
    minValueCents: s.minValueCents || 0,
    maxValueCents: s.maxValueCents || 0,
    allowCustomAmount: s.allowCustomAmount !== false,
    allowPointsPayment: !!s.allowPointsPayment,
    messageTemplates: s.messageTemplates || [],
    expiryDays: s.expiryDays || null,
    showSocialProofStats: !!s.showSocialProofStats,
    currency: sq.CURRENCY,
  });
});

// Frontend social-proof stats -- deliberately no names/PII, admin-toggleable.
app.get('/api/pay-it-forward/stats', async (_req, res) => {
  try {
    const s = getSettings().payItForward || {};
    if (!s.enabled || !s.showSocialProofStats) return res.json({ enabled: false });
    const k = await payItForward.adminKpis(3650);
    res.json({
      enabled: true,
      coffeesGifted: k ? k.giftsPurchased : 0,
      coffeesRedeemed: k ? k.fullyRedeemed : 0,
      outstanding: k ? k.outstandingCount : 0,
    });
  } catch (e) {
    res.json({ enabled: false });
  }
});

app.post('/api/pay-it-forward/purchase/card', async (req, res) => {
  try {
    const { sourceId, verificationToken, valueCents, purchaserCustomerId, purchaserName, purchaserPhone, purchaserNotify, recipientName, recipientPhone, recipientEmail, message, idempotencyKey } = req.body || {};
    if (!sourceId) return res.status(400).json({ error: 'Missing payment token' });
    if (!recipientPhone) return res.status(400).json({ error: 'Recipient mobile number is required' });
    if (!idempotencyKey) return res.status(400).json({ error: 'Missing idempotency key' });
    const gift = await payItForward.purchaseWithCard({
      sourceId, verificationToken, valueCents, purchaserCustomerId, purchaserName, purchaserPhone, purchaserNotify,
      recipientName, recipientPhone, recipientEmail, message: message ? String(message).slice(0, 500) : '', idempotencyKey,
    });
    res.json({ ok: true, token: gift.token, code: gift.code, valueCents: gift.valueCents, claimUrl: payItForward.claimUrl(gift.token) });
  } catch (e) {
    console.error('pay-it-forward card purchase error', e.message);
    res.status(402).json({ error: e.message });
  }
});

app.post('/api/pay-it-forward/purchase/points', async (req, res) => {
  try {
    const { rewardTierId, loyaltyAccountId, purchaserCustomerId, purchaserName, purchaserPhone, purchaserNotify, recipientName, recipientPhone, recipientEmail, message, idempotencyKey } = req.body || {};
    if (!recipientPhone) return res.status(400).json({ error: 'Recipient mobile number is required' });
    if (!rewardTierId || !loyaltyAccountId) return res.status(400).json({ error: 'Missing loyalty details' });
    if (!idempotencyKey) return res.status(400).json({ error: 'Missing idempotency key' });
    const gift = await payItForward.purchaseWithPoints({
      rewardTierId, loyaltyAccountId, purchaserCustomerId, purchaserName, purchaserPhone, purchaserNotify,
      recipientName, recipientPhone, recipientEmail, message: message ? String(message).slice(0, 500) : '', idempotencyKey,
    });
    res.json({ ok: true, token: gift.token, code: gift.code, valueCents: gift.valueCents, claimUrl: payItForward.claimUrl(gift.token) });
  } catch (e) {
    console.error('pay-it-forward points purchase error', e.message);
    res.status(402).json({ error: e.message });
  }
});

// ---- Public claim experience ----
app.get('/api/gift/:token', async (req, res) => {
  try {
    if (pifRateLimited(req, 60)) return res.status(429).json({ error: 'Too many requests, please try again shortly.' });
    const gift = await payItForward.publicGiftView(req.params.token);
    if (!gift) return res.status(404).json({ error: 'Gift not found' });
    payItForward.markViewed(req.params.token).catch(() => {});
    res.json({ gift });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.post('/api/gift/:token/claim', async (req, res) => {
  try {
    if (pifRateLimited(req, 20)) return res.status(429).json({ error: 'Too many requests, please try again shortly.' });
    const { recipientPhone, recipientName, marketingConsent } = req.body || {};
    let recipientCustomerId;
    if (recipientPhone) {
      const c = await customers.findOrCreate({ phone: recipientPhone, name: recipientName });
      recipientCustomerId = c && c.id;
    }
    const gift = await payItForward.claim(req.params.token, {
      recipientCustomerId, marketingConsent: marketingConsent === true, marketingConsentSource: 'claim_page',
    });
    if (!gift) return res.status(404).json({ error: 'Gift not found' });
    res.json({ ok: true, customerId: recipientCustomerId || null });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
// Manual backup-code lookup (rate-limited per section 8/31).
app.post('/api/gift/lookup', async (req, res) => {
  try {
    if (pifRateLimited(req, 10)) return res.status(429).json({ error: 'Too many attempts, please try again shortly.' });
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ error: 'Enter a gift code' });
    const gift = await payItForward.publicGiftView(String(code).trim().toUpperCase());
    if (!gift) return res.status(404).json({ error: 'That code was not found' });
    res.json({ gift });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- Customer account: My Coffee Gifts (Sent/Received) ----
app.get('/api/gifts', async (req, res) => {
  try {
    const { customerId, phone } = req.query;
    if (!customerId && !phone) return res.json({ sent: [], received: [] });
    res.json(await payItForward.giftsForCustomer(customerId, phone));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- Admin: Pay It Forward dashboard, gift management, settings support ----
app.get('/api/admin/pay-it-forward/eligibility', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { ok, warning, resolvedCategoryIds } = await payItForward.adminEligibility();
    res.json({ ok, warning: warning || null, resolvedCategoryCount: resolvedCategoryIds.size });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});
app.get('/api/admin/pay-it-forward/kpis', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    res.json(await payItForward.adminKpis(Number(req.query.days) || 90));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});
app.get('/api/admin/pay-it-forward/gifts', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { status, search, limit, offset } = req.query;
    res.json(await payItForward.adminList({ status: status || undefined, search: search || undefined, limit: Number(limit) || 100, offset: Number(offset) || 0 }));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});
app.get('/api/admin/pay-it-forward/gifts/:id', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const detail = await payItForward.adminDetail(req.params.id);
    if (!detail) return res.status(404).json({ error: 'Not found' });
    res.json(detail);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});
app.post('/api/admin/pay-it-forward/gifts/:id/resend-sms', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    res.json({ gift: await payItForward.adminResendSms(req.params.id) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.post('/api/admin/pay-it-forward/gifts/:id/cancel', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const gift = await payItForward.adminCancel(req.params.id);
    if (!gift) return res.status(400).json({ error: 'This gift cannot be cancelled (already used or not active).' });
    res.json({ gift });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.post('/api/admin/pay-it-forward/gifts/:id/refund', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { status } = req.body || {};
    res.json({ gift: await payItForward.adminRefund(req.params.id, status || 'REFUNDED') });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- Analytics: ingest events (best-effort, never blocks the UI) ----
app.post('/api/track', async (req, res) => {
  try {
    const events = (req.body && req.body.events) || [];
    await db.track(events);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false });
  }
});
app.get('/api/admin/analytics', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const days = Number(req.query.days) || 30;
    res.json({ analytics: await db.getAnalytics(days), dbEnabled: db.enabled });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ---- Admin: real sales + loyalty signups for the dashboard ----
app.get('/api/admin/dashboard', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  const days = Math.max(1, Math.min(365, Number(req.query.days) || 30));
  const [salesR, signupsR] = await Promise.all([
    sales.salesSummary(days).catch((e) => ({ error: e.message })),
    loyalty.signupStats(days).catch((e) => ({ error: e.message })),
  ]);
  res.json({ sales: salesR, signups: signupsR });
});

app.get('/api/health', (_req, res) => res.json({ ok: true, env: sq.ENV }));

// ---- Lightweight, stateless spam capture (honeypot + a small maths question) ----
const CAPTCHA_SECRET = process.env.CAPTCHA_SECRET || crypto.randomBytes(24).toString('hex');
function signCaptcha(a, b, exp) {
  const payload = `${a}.${b}.${exp}`;
  const sig = crypto.createHmac('sha256', CAPTCHA_SECRET).update(payload).digest('base64url');
  return `${Buffer.from(payload).toString('base64url')}.${sig}`;
}
function verifyCaptcha(token, answer) {
  try {
    const [p, sig] = String(token || '').split('.');
    if (!p || !sig) return false;
    const payload = Buffer.from(p, 'base64url').toString();
    const expect = crypto.createHmac('sha256', CAPTCHA_SECRET).update(payload).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return false;
    const [a, b, exp] = payload.split('.').map(Number);
    if (Date.now() > exp) return false;
    return Number(answer) === a + b;
  } catch { return false; }
}
app.get('/api/captcha', (_req, res) => {
  const a = 1 + Math.floor(Math.random() * 8);
  const b = 1 + Math.floor(Math.random() * 8);
  const exp = Date.now() + 10 * 60 * 1000;
  res.json({ token: signCaptcha(a, b, exp), question: `${a} + ${b}` });
});

// ---- Customer messages: enquiry / feedback / catering ----
app.post('/api/message', async (req, res) => {
  try {
    const { type, name, contact, body, captchaToken, captchaAnswer, company } = req.body || {};
    // Honeypot: real people never fill the hidden "company" field. Pretend success.
    if (company) return res.json({ ok: true });
    if (!verifyCaptcha(captchaToken, captchaAnswer)) {
      return res.status(400).json({ error: 'Please answer the quick maths question.', captchaFailed: true });
    }
    if (!body || !String(body).trim()) return res.status(400).json({ error: 'Please add a message.' });
    const allowed = ['enquiry', 'feedback', 'catering'];
    const t = allowed.includes(type) ? type : 'enquiry';
    const saved = await db.insertMessage({ type: t, name, contact, body });
    res.json({ ok: true, id: saved?.id ? String(saved.id) : null });
  } catch (e) {
    res.status(503).json({ error: e.message });
  }
});
app.get('/api/admin/messages', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    res.json({ messages: await db.listMessages(200), dbEnabled: db.enabled });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});
app.post('/api/admin/messages/handled', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    await db.markMessageHandled(req.body?.id, req.body?.handled !== false);
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ---- Table reservations ----
app.post('/api/reserve', async (req, res) => {
  try {
    const { name, phone, email, party, at, notes, captchaToken, captchaAnswer, company } = req.body || {};
    if (company) return res.json({ ok: true }); // honeypot
    if (!verifyCaptcha(captchaToken, captchaAnswer)) return res.status(400).json({ error: 'Please answer the quick maths question.', captchaFailed: true });
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Please add your name.' });
    if (!phone || !String(phone).trim()) return res.status(400).json({ error: 'Please add a contact number.' });
    if (!at) return res.status(400).json({ error: 'Please choose a date and time.' });

    // Best-effort Square order (so it prints + shows in Square). Never blocks the booking.
    let squareOrderId = null;
    try {
      const o = await orders.createReservationOrder({ name, phone, email, partySize: party, at, notes, variationId: getSettings().reservationVariationId });
      squareOrderId = o?.id || null;
    } catch (e) { console.error('[reserve] Square order failed:', e.message); }

    const saved = await db.insertReservation({ name, phone, email, party, reserveAt: at, notes, squareOrderId });

    // Fire notifications in the background (don't make the customer wait). The
    // owner copy goes to the admin-configured reservationNotifyEmail if set.
    notify.reservationNotify({ name, phone, email, party, reserveAt: at, notes }, { ownerEmail: getSettings().reservationNotifyEmail }).catch(() => {});

    res.json({ ok: true, id: saved?.id ? String(saved.id) : null });
  } catch (e) {
    res.status(503).json({ error: e.message });
  }
});
app.get('/api/admin/reservations', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    res.json({ reservations: await db.listReservations(200), dbEnabled: db.enabled, sms: notify.smsConfigured, email: notify.emailConfigured });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});
// Diagnostic: pull the actual Square order for one reservation, straight from
// Square (not our DB) — confirms whether the order really exists, which
// location it's filed under, and its fulfillment/state, so a "nothing prints"
// report can be narrowed to "no order was ever created" vs. "order exists but
// something about routing/printing itself is the problem".
// Diagnostic: every Square location on this account, so a "the order exists
// but nothing showed up on the till" report can be checked against whether
// the printer/POS device is actually signed into the SAME location this app
// is configured to submit orders to (SQUARE_LOCATION_ID).
app.get('/api/admin/square-locations', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const data = await sq.squareFetch('/v2/locations');
    res.json({
      configuredLocationId: sq.LOCATION_ID,
      locations: (data.locations || []).map((l) => ({ id: l.id, name: l.name, status: l.status })),
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});
app.get('/api/admin/reservations/square-order', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const id = req.query.orderId;
    if (!id) return res.status(400).json({ error: 'orderId is required.' });
    const order = await orders.getOrder(id);
    res.json({
      id: order?.id,
      locationId: order?.location_id,
      state: order?.state,
      ticketName: order?.ticket_name,
      createdAt: order?.created_at,
      lineItems: (order?.line_items || []).map((li) => ({ name: li.name, catalogObjectId: li.catalog_object_id, note: li.note })),
      fulfillments: (order?.fulfillments || []).map((f) => ({ type: f.type, state: f.state, pickupDetails: f.pickup_details })),
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});
app.post('/api/admin/reservations/status', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    await db.setReservationStatus(req.body?.id, req.body?.status);
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});
app.post('/api/admin/reservations/delete', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    if (!req.body?.id) return res.status(400).json({ error: 'id is required.' });
    await db.deleteReservation(req.body.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ---- Admin: reservation ticket printing — find or auto-create the catalog
// item that reservation orders are placed against (see server/lib/orders.js
// createReservationOrder). Lets the owner self-serve this instead of it being
// a manual, API-console-only setup step. ----
app.get('/api/admin/reservation-item/search', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    res.json({ items: await catalog.searchItemsByName(req.query.q || 'Table Reservation') });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});
app.post('/api/admin/reservation-item/create', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { name, categoryId } = req.body || {};
    if (!categoryId) return res.status(400).json({ error: 'Pick a category first.' });
    const result = await catalog.createReservationCatalogItem({ name, categoryId });
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});
// Diagnostic: exactly what Square has on file for the linked reservation item —
// reporting_category is the field printer/KDS auto-print routing actually
// keys off, which can silently differ from the (possibly several) categories
// shown in the Dashboard's item editor.
app.get('/api/admin/reservation-item/inspect', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'No item id (pass ?id=<Square item id>, not the variation id).' });
    res.json(await catalog.inspectItem(id));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});
app.post('/api/admin/reservation-item/fix-category', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { itemId, categoryId } = req.body || {};
    if (!itemId || !categoryId) return res.status(400).json({ error: 'itemId and categoryId are required.' });
    res.json(await catalog.setReportingCategory(itemId, categoryId));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});
// One-click reservation printing setup: finds-or-creates the "Reservations"
// category and the "Table Reservation" item in one call, self-healing an
// existing item's reporting_category if it's pointed at the wrong category
// (see catalog.setupReservationPrinting), then saves the resulting variation
// id straight into settings — no separate Save-changes click needed.
app.post('/api/admin/reservation-item/setup', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { categoryName, itemName } = req.body || {};
    const result = await catalog.setupReservationPrinting({ categoryName, itemName });
    const overrides = { ...(db.getOverrides() || {}), reservationVariationId: result.variationId, reservationItemId: result.itemId };
    await db.saveOverrides(overrides);
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ---- Admin: export current settings + status (gated by a passcode) ----
app.get('/api/admin/overview', async (req, res) => {
  const pass = process.env.ADMIN_PASSCODE || '';
  if (pass && req.query.pass !== pass) return res.status(401).json({ error: 'Unauthorized' });
  const settings = getSettings();
  let hoursStatus = null;
  let menu = null;
  try {
    hoursStatus = await hours.getStatus();
  } catch {}
  try {
    menu = await catalog.getFullMenu(); // includes new/empty categories for the builder
  } catch {}
  res.json({
    settings,
    hours: hoursStatus,
    cloudinary: cloudinary.configured(),
    dbEnabled: db.enabled, // drives the admin "changes won't persist" banner
    categories: menu ? menu.categories.map((c) => ({ name: c.category, count: c.items.length })) : [],
    settingsJsonHint:
      'To change theme/hero/announcement live, set a SETTINGS_JSON env var in Railway with the edited settings object.',
  });
});

// ---- Admin: read + save the full editable settings (persisted in Postgres) ----
app.get('/api/admin/settings', (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  res.json({ settings: getSettings(), dbEnabled: db.enabled });
});
app.post('/api/admin/settings', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { settings } = req.body || {};
    if (!settings || typeof settings !== 'object') return res.status(400).json({ error: 'Missing settings' });
    await db.saveOverrides(settings);
    menuCache = { data: null, at: 0 }; // category/item changes go live immediately
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- Admin: full catalog (all items per category) for the item chooser ----
app.get('/api/admin/catalog', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const full = await catalog.getFullMenu();
    res.json({
      categories: full.categories.map((c) => ({
        category: c.category,
        items: c.items.map((i) => ({ id: i.id, name: i.name })),
      })),
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ---- Admin: every Square category (to choose which appear in the app) ----
app.get('/api/admin/square-categories', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    res.json({ categories: await catalog.getAllCategories() });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ---- Admin: every Square product (to hand-pick into product sections) ----
app.get('/api/admin/products', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    res.json({ products: await catalog.getAllProducts() });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ---- Admin: one item's full config (variations + modifiers) for the builder ----
app.get('/api/admin/item-config', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const cfg = await catalog.getItemConfig(String(req.query.id || ''));
    if (!cfg) return res.status(404).json({ error: 'Item not found' });
    res.json({ item: cfg });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ---- Validate a coupon code (for the checkout to show the discount) ----
app.get('/api/coupon', (req, res) => {
  try {
    const c = coupons.find(req.query.code || '');
    if (!c) return res.json({ valid: false });
    res.json({ valid: true, code: String(c.code).toUpperCase(), type: c.type || 'percent', value: Number(c.value) || 0, comp: (c.type || 'percent') === 'comp', label: coupons.label(c) });
  } catch (e) { res.json({ valid: false }); }
});

// ---- Admin: customers enrolled via Square loyalty ----
app.get('/api/admin/customers', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    res.json({ users: await loyalty.listLoyaltyUsers() });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- Admin: which broadcast channels are configured ----
app.get('/api/admin/notify-status', (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  res.json({ sms: !!notify.smsConfigured, email: !!notify.emailConfigured });
});

// ---- Admin: broadcast a message (SMS or email) to loyalty members ----
app.post('/api/admin/broadcast', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { channel, subject, message, link } = req.body || {};
    if (!message || !String(message).trim()) return res.status(400).json({ error: 'Message is required.' });
    if (channel === 'sms' && !notify.smsConfigured) return res.status(400).json({ error: 'SMS isn’t configured yet — add the Twilio env vars in Railway.' });
    if (channel === 'email' && !notify.emailConfigured) return res.status(400).json({ error: 'Email isn’t configured yet — add the Resend env vars in Railway.' });
    if (channel !== 'sms' && channel !== 'email') return res.status(400).json({ error: 'Pick a channel.' });

    const users = await loyalty.listLoyaltyUsers();
    const text = String(message).trim() + (link ? `\n\n${String(link).trim()}` : '');
    let sent = 0, skipped = 0, failed = 0;
    for (const u of users) {
      const to = channel === 'sms' ? u.phone : u.email;
      if (!to) { skipped++; continue; }
      const ok = channel === 'sms'
        ? await notify.sendSMS(to, text)
        : await notify.sendEmail(to, subject || 'Bean Culture', text);
      if (ok) sent++; else failed++;
    }
    res.json({ sent, skipped, failed, total: users.length });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- Admin: send a single TEST message to one recipient (preview before broadcast) ----
app.post('/api/admin/broadcast/test', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { channel, subject, message, link, to } = req.body || {};
    if (!message || !String(message).trim()) return res.status(400).json({ error: 'Message is required.' });
    if (!to || !String(to).trim()) return res.status(400).json({ error: `Add a test ${channel === 'sms' ? 'phone number' : 'email address'}.` });
    if (channel === 'sms' && !notify.smsConfigured) return res.status(400).json({ error: 'SMS isn’t configured yet — add the Twilio env vars in Railway.' });
    if (channel === 'email' && !notify.emailConfigured) return res.status(400).json({ error: 'Email isn’t configured yet — add the Resend env vars in Railway.' });
    if (channel !== 'sms' && channel !== 'email') return res.status(400).json({ error: 'Pick a channel.' });
    const text = String(message).trim() + (link ? `\n\n${String(link).trim()}` : '');
    const ok = channel === 'sms'
      ? await notify.sendSMS(String(to).trim(), text)
      : await notify.sendEmail(String(to).trim(), `[TEST] ${subject || 'Bean Culture'}`, text);
    if (!ok) return res.status(400).json({ error: 'Test send failed — check the number/email and provider config.' });
    res.json({ ok: true, to: String(to).trim() });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- Admin: force a menu re-sync (clears the cache immediately) ----
app.post('/api/admin/sync', (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  menuCache = { data: null, at: 0 };
  res.json({ ok: true });
});

// ---- Admin: upload a real photo to a Square catalog item (replaces AI image) ----
app.post('/api/admin/catalog/image', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { objectId, dataUri, caption, primary } = req.body || {};
    if (!objectId || !dataUri) return res.status(400).json({ error: 'objectId and image are required.' });
    const out = await squareImages.uploadItemImage({ objectId, dataUri, caption, primary: primary !== false });
    menuCache = { data: null, at: 0 }; // show the new image immediately
    res.json(out);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- Admin: upload an image (banner/icon) to Cloudinary ----
app.post('/api/admin/upload', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { dataUri, folder } = req.body || {};
    const url = await cloudinary.upload(dataUri, folder);
    res.json({ url });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- Serve the built client (single service) ----
const clientDist = path.join(__dirname, '..', 'client', 'dist');
// Apple Pay domain verification. Register the site's domain in the Square
// Developer Dashboard (Apple Pay tab), then paste the association file contents
// into the APPLE_PAY_DOMAIN_ASSOCIATION env var. Served here as plain text so
// Apple Pay can verify the domain — no code redeploy needed to update it.
app.get('/.well-known/apple-developer-merchantid-domain-association', (_req, res) => {
  const body = process.env.APPLE_PAY_DOMAIN_ASSOCIATION;
  if (!body) return res.status(404).send('Apple Pay domain association not configured.');
  res.type('text/plain').send(body);
});

// Cache policy: Vite fingerprints /assets/* filenames, so they can be cached
// forever (a new deploy = new filenames). index.html + the service worker must
// stay fresh so new deploys are picked up immediately; icons/images cache a day.
app.use(express.static(clientDist, {
  index: false,
  setHeaders: (res, filePath) => {
    if (/[\\/]assets[\\/].+\.(js|css|woff2?)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (/(index\.html|sw\.js|service-worker\.js|manifest\.webmanifest)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  },
}));
// ---- SEO: inject verification, Google Analytics, meta + social + JSON-LD into
// the served HTML from env vars + store settings (no client rebuild needed),
// and serve robots.txt + sitemap.xml. Set GOOGLE_SITE_VERIFICATION and
// GA_MEASUREMENT_ID (G-XXXX) in Railway; description/image fall back to your
// store settings. ----
const fs = require('fs');
let _indexHtmlCache = null;
function indexHtml() {
  if (_indexHtmlCache == null) {
    try { _indexHtmlCache = fs.readFileSync(path.join(clientDist, 'index.html'), 'utf8'); }
    catch { _indexHtmlCache = '<!doctype html><html><head></head><body><div id="root"></div></body></html>'; }
  }
  return _indexHtmlCache;
}
function seoEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function baseUrl(req) {
  const env = process.env.PUBLIC_BASE_URL;
  if (env) return env.replace(/\/$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  return `${proto}://${req.headers.host}`;
}
// ── SEO helpers: slugs, cached menu snapshot, per-page meta + crawlable body ──
function slugify(str) {
  return String(str || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}
let seoMenuCache = { data: null, at: 0 };
async function seoMenu() {
  const now = Date.now();
  if (seoMenuCache.data && now - seoMenuCache.at < 60000) return seoMenuCache.data;
  try { const m = await catalog.getMenu(); seoMenuCache = { data: m, at: now }; return m; }
  catch { return seoMenuCache.data || { categories: [] }; }
}
function bustSeoMenu() { seoMenuCache = { data: null, at: 0 }; }
function lowestPrice(item) {
  const prices = ((item && item.variations) || []).map((v) => v.price).filter((n) => typeof n === 'number');
  return prices.length ? Math.min(...prices) : null;
}
function money(cents) {
  if (cents == null) return '';
  try { return new Intl.NumberFormat('en-AU', { style: 'currency', currency: sq.CURRENCY || 'AUD' }).format(cents / 100); }
  catch { return '$' + (cents / 100).toFixed(2); }
}
function resolvePath(menu, pathname) {
  const cats = (menu && menu.categories) || [];
  let m = pathname.match(/^\/item\/([^/]+)\/?$/i);
  if (m) {
    const slug = decodeURIComponent(m[1]).toLowerCase();
    for (const c of cats) for (const it of (c.items || [])) if (slugify(it.name) === slug) return { type: 'item', item: it, category: c.category };
    return { type: 'item', notFound: true };
  }
  m = pathname.match(/^\/menu\/([^/]+)\/?$/i);
  if (m) {
    const slug = decodeURIComponent(m[1]).toLowerCase();
    const c = cats.find((c) => slugify(c.category) === slug);
    return c ? { type: 'category', category: c } : { type: 'category', notFound: true };
  }
  return null;
}

function seoHead(req, o = {}) {
  const s = getSettings();
  const storeName = s.storeName || 'Bean Culture';
  const seo = s.seo || {};
  const name = o.title || storeName;
  const desc = String(o.description || seo.metaDescription || process.env.SEO_DESCRIPTION || s.bio || s.supportMessage || `Order ahead from ${storeName} — skip the queue.`).replace(/\s+/g, ' ').trim().slice(0, 300);
  const base = baseUrl(req);
  const url = o.url || (base + '/');
  const img = o.image || seo.ogImage || process.env.SEO_IMAGE || s.storePhoto || `${base}/icons/icon-512.png`;
  const tel = (s.contact && s.contact.phone) || '';
  const addr = (s.contact && s.contact.address) || '';
  const gsv = String(seo.googleVerification || process.env.GOOGLE_SITE_VERIFICATION || '').trim();
  const ga = String(seo.gaMeasurementId || process.env.GA_MEASUREMENT_ID || '').trim();
  const p = [];
  p.push(`<meta name="description" content="${seoEsc(desc)}">`);
  p.push(`<link rel="canonical" href="${seoEsc(url)}">`);
  p.push('<meta name="robots" content="index,follow">');
  if (gsv) p.push(/<(meta|script|link)/i.test(gsv) ? gsv : `<meta name="google-site-verification" content="${seoEsc(gsv)}">`);
  p.push(`<meta property="og:type" content="${o.ogType || 'website'}">`);
  p.push(`<meta property="og:site_name" content="${seoEsc(storeName)}">`);
  p.push(`<meta property="og:title" content="${seoEsc(name)}">`);
  p.push(`<meta property="og:description" content="${seoEsc(desc)}">`);
  p.push(`<meta property="og:url" content="${seoEsc(url)}">`);
  if (img) p.push(`<meta property="og:image" content="${seoEsc(img)}">`);
  p.push('<meta name="twitter:card" content="summary_large_image">');
  p.push(`<meta name="twitter:title" content="${seoEsc(name)}">`);
  p.push(`<meta name="twitter:description" content="${seoEsc(desc)}">`);
  if (img) p.push(`<meta name="twitter:image" content="${seoEsc(img)}">`);
  let lds = o.jsonld;
  if (!lds || !lds.length) {
    const ld = { '@context': 'https://schema.org', '@type': 'CafeOrCoffeeShop', name: storeName, url: base + '/', image: img };
    if (tel) ld.telephone = tel;
    if (addr) ld.address = { '@type': 'PostalAddress', streetAddress: addr };
    lds = [ld];
  }
  for (const ld of lds) p.push(`<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`);
  if (ga) {
    p.push(`<script async src="https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga)}"></script>`);
    p.push(`<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config',${JSON.stringify(ga)});</script>`);
  }
  if (seo.headHtml && String(seo.headHtml).trim()) p.push(String(seo.headHtml));
  return p.join('\n    ');
}

// Per-page SEO head + crawlable body for /item and /menu pages.
function pageSeoAndBody(req, hit, menu) {
  const s = getSettings();
  const storeName = s.storeName || 'Bean Culture';
  const base = baseUrl(req);
  if (!hit || hit.notFound) return null;
  if (hit.type === 'item' && hit.item) {
    const it = hit.item;
    const price = lowestPrice(it);
    const url = `${base}/item/${slugify(it.name)}`;
    const title = `${it.name} — ${storeName}`;
    const desc = (it.description ? String(it.description) : `${it.name} at ${storeName}. Order ahead and skip the queue.`).replace(/\s+/g, ' ').trim().slice(0, 300);
    const productLd = {
      '@context': 'https://schema.org', '@type': 'Product', name: it.name, url,
      brand: { '@type': 'Brand', name: storeName },
    };
    if (it.description) productLd.description = String(it.description).slice(0, 500);
    if (it.image) productLd.image = it.image;
    if (price != null) productLd.offers = { '@type': 'Offer', price: (price / 100).toFixed(2), priceCurrency: sq.CURRENCY || 'AUD', availability: it.soldOut ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock', url };
    const head = seoHead(req, { title, description: desc, image: it.image || undefined, url, ogType: 'product', jsonld: [productLd] });
    const body = `<main class="seo-boot"><h1>${seoEsc(it.name)}</h1>${it.description ? `<p>${seoEsc(it.description)}</p>` : ''}<p><strong>${seoEsc(money(price))}</strong> &middot; ${seoEsc(hit.category || '')} &middot; ${seoEsc(storeName)}</p><p><a href="/">See the full ${seoEsc(storeName)} menu</a></p></main>`;
    return { head, body, title };
  }
  if (hit.type === 'category' && hit.category) {
    const c = hit.category;
    const items = (c.items || []);
    const url = `${base}/menu/${slugify(c.category)}`;
    const title = `${c.category} — ${storeName}`;
    const desc = `${c.category} at ${storeName} — ${items.slice(0, 6).map((i) => i.name).join(', ')}. Order ahead online.`.replace(/\s+/g, ' ').trim().slice(0, 300);
    const listLd = { '@context': 'https://schema.org', '@type': 'ItemList', name: title, url,
      itemListElement: items.slice(0, 50).map((i, idx) => ({ '@type': 'ListItem', position: idx + 1, name: i.name, url: `${base}/item/${slugify(i.name)}` })) };
    const head = seoHead(req, { title, description: desc, url, jsonld: [listLd] });
    const body = `<main class="seo-boot"><h1>${seoEsc(c.category)}</h1><ul>${items.map((i) => `<li><a href="/item/${slugify(i.name)}">${seoEsc(i.name)}</a>${(i.variations && i.variations.length) ? ' — ' + seoEsc(money(lowestPrice(i))) : ''}</li>`).join('')}</ul><p><a href="/">Full menu</a></p></main>`;
    return { head, body, title };
  }
  return null;
}

// Homepage crawlable menu outline (React replaces #root on boot).
function homeBody(menu, req) {
  const s = getSettings(); const storeName = s.storeName || 'Bean Culture';
  const cats = (menu && menu.categories) || [];
  if (!cats.length) return '';
  const secs = cats.map((c) => `<section><h2><a href="/menu/${slugify(c.category)}">${seoEsc(c.category)}</a></h2><ul>${(c.items || []).map((i) => `<li><a href="/item/${slugify(i.name)}">${seoEsc(i.name)}</a>${(i.variations && i.variations.length) ? ' — ' + seoEsc(money(lowestPrice(i))) : ''}</li>`).join('')}</ul></section>`).join('');
  return `<main class="seo-boot"><h1>${seoEsc(storeName)} — Menu</h1>${secs}</main>`;
}

app.get('/robots.txt', (req, res) => {
  const url = baseUrl(req);
  res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /gift/\nSitemap: ${url}/sitemap.xml\n`);
});

app.get('/sitemap.xml', async (req, res) => {
  const url = baseUrl(req);
  const today = new Date().toISOString().slice(0, 10);
  const menu = await seoMenu();
  const cats = (menu && menu.categories) || [];
  const entries = [{ loc: `${url}/`, pri: '1.0', freq: 'daily' }];
  const seenC = new Set(), seenI = new Set();
  for (const c of cats) {
    const cs = slugify(c.category); if (cs && !seenC.has(cs)) { seenC.add(cs); entries.push({ loc: `${url}/menu/${cs}`, pri: '0.8', freq: 'weekly' }); }
    for (const it of (c.items || [])) { const is = slugify(it.name); if (is && !seenI.has(is)) { seenI.add(is); entries.push({ loc: `${url}/item/${is}`, pri: '0.6', freq: 'weekly' }); } }
  }
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    entries.map((e) => `  <url><loc>${seoEsc(e.loc)}</loc><lastmod>${today}</lastmod><changefreq>${e.freq}</changefreq><priority>${e.pri}</priority></url>`).join('\n') +
    `\n</urlset>\n`;
  res.type('application/xml').send(body);
});

// Admin: regenerate (bust) the sitemap/menu cache; returns the URL count.
app.post('/api/admin/seo/rebuild-sitemap', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  bustSeoMenu();
  const menu = await seoMenu();
  const cats = (menu && menu.categories) || [];
  const cS = new Set(), iS = new Set();
  for (const c of cats) { const cs = slugify(c.category); if (cs) cS.add(cs); for (const it of (c.items || [])) { const is = slugify(it.name); if (is) iS.add(is); } }
  res.json({ ok: true, urls: 1 + cS.size + iS.size, categories: cS.size, products: iS.size, at: new Date().toISOString() });
});

app.get('*', async (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  let head = seoHead(req), body = '', title = '';
  try {
    if (/^\/(item|menu)\//i.test(req.path)) {
      const menu = await seoMenu();
      const pg = pageSeoAndBody(req, resolvePath(menu, req.path), menu);
      if (pg) { head = pg.head; body = pg.body; title = pg.title; }
    } else if (req.path === '/' || req.path === '') {
      body = homeBody(await seoMenu(), req);
    }
  } catch { /* fall back to base head */ }
  let html = indexHtml().replace('</head>', `    ${head}\n  </head>`);
  if (title) html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${seoEsc(title)}</title>`);
  if (body) html = html.replace('<div id="root">', `<div id="root">${body}`);
  res.type('html').send(html);
});

const PORT = process.env.PORT || 8080;
// Start serving immediately so Railway's health check passes, then bring up the
// database in the background (with retries). getSettings() falls back to the
// built-in defaults until the DB is ready, so a slow/blipping DB never blocks
// the storefront from loading.
app.listen(PORT, () => console.log(`Bean Culture app on :${PORT} (Square env: ${sq.ENV})`));
db.init().finally(() => {
  scheduler.start();
  seedPresetNavFooter();
  // Non-destructive Pay It Forward expiry sweep (status change only, rows
  // are never deleted) -- runs shortly after boot, then hourly.
  setTimeout(() => payItForward.sweepExpired().catch((e) => console.warn('[payItForward] expiry sweep failed:', e.message)), 20000);
  setInterval(() => payItForward.sweepExpired().catch((e) => console.warn('[payItForward] expiry sweep failed:', e.message)), 60 * 60 * 1000);
  // Auto-sync the product builder with Square a few times a day (incl. each
  // morning) so newly-added variations appear and deleted ones are cleaned up
  // without anyone pressing Sync. First run shortly after boot.
  setTimeout(syncPresetsWithSquare, 30000);
  setInterval(syncPresetsWithSquare, 6 * 60 * 60 * 1000);
});

// Reconcile settings.presets against live Square variations and persist. Adds a
// tile for each new variation (new sizes join a tile you've already combined;
// everything else adds separately), drops tiles whose variation was deleted.
// Prices need no sync — the storefront always reads them live.
async function syncPresetsWithSquare() {
  if (!db.enabled) return;
  try {
    const settings = getSettings();
    const presets = settings.presets || [];
    if (!presets.length) return;
    const vids = (p) => (Array.isArray(p.variationIds) && p.variationIds.length ? p.variationIds : [p.variationId].filter(Boolean));
    const sourceIds = [...new Set(presets.map((p) => p.sourceItemId).filter(Boolean))];
    const configs = {};
    for (const id of sourceIds) { try { const cfg = await catalog.getItemConfig(id); if (cfg) configs[id] = cfg; } catch {} }
    if (!Object.keys(configs).length) return; // couldn't reach Square — skip this run
    const coveredBySource = {}; const sectionBySource = {};
    for (const p of presets) {
      if (!coveredBySource[p.sourceItemId]) coveredBySource[p.sourceItemId] = new Set();
      vids(p).forEach((v) => coveredBySource[p.sourceItemId].add(v));
      if (!sectionBySource[p.sourceItemId]) sectionBySource[p.sourceItemId] = p.section || 'Specials';
    }
    const reconciled = []; let removedDead = 0;
    for (const p of presets) {
      const cfg = configs[p.sourceItemId];
      if (!cfg) { reconciled.push(p); continue; }
      const alive = vids(p).filter((vid) => cfg.variations.some((v) => v.id === vid));
      if (!alive.length) { removedDead++; continue; }
      reconciled.push({ ...p, variationId: alive[0], variationIds: alive.length > 1 ? alive : undefined });
    }
    const combinedForSource = {};
    for (const p of reconciled) if (vids(p).length > 1 && !combinedForSource[p.sourceItemId]) combinedForSource[p.sourceItemId] = p;
    let added = 0, extended = 0;
    const newId = () => 'pre' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    for (const id of sourceIds) {
      const cfg = configs[id]; if (!cfg) continue;
      const covered = coveredBySource[id] || new Set();
      for (const v of cfg.variations) {
        if (covered.has(v.id)) continue;
        covered.add(v.id);
        const combo = combinedForSource[id];
        if (combo) { combo.variationIds = [...vids(combo), v.id]; combo.variationId = combo.variationIds[0]; extended++; }
        else { reconciled.push({ id: newId(), name: v.name || cfg.name, section: sectionBySource[id] || 'Specials', sourceItemId: id, variationId: v.id, groups: {}, showImages: true }); added++; }
      }
    }
    if (!added && !extended && !removedDead) return; // nothing structural changed
    const overrides = { ...(db.getOverrides() || {}), presets: reconciled };
    await db.saveOverrides(overrides);
    menuCache = { data: null, at: 0 };
    console.log(`[sync] presets reconciled with Square — +${added} tiles, +${extended} sizes, -${removedDead} removed`);
  } catch (e) { console.error('[sync] preset auto-sync failed:', e.message); }
}

// One-time migration: now that Top/Footer toggles are authoritative for builder
// sections, seed footer:true for any builder section that was already wired into
// a footer button, so existing menus don't disappear. Runs once (guarded flag),
// only ADDS where no nav entry exists yet — never overrides your choices.
async function seedPresetNavFooter() {
  try {
    if (!db.enabled) return;
    const settings = getSettings();
    if (settings.presetNavSeeded) return;
    const overrides = { ...(db.getOverrides() || {}) };
    const footerRefs = new Set();
    for (const slot of settings.footer || []) for (const c of slot.categories || []) footerRefs.add(String(c).toLowerCase());
    const nav = { ...(overrides.presetSectionNav || settings.presetSectionNav || {}) };
    let seeded = 0;
    for (const p of settings.presets || []) {
      const name = (p.section || '').trim();
      if (name && footerRefs.has(name.toLowerCase()) && !nav[name]) { nav[name] = { footer: true }; seeded++; }
    }
    overrides.presetSectionNav = nav;
    overrides.presetNavSeeded = true;
    await db.saveOverrides(overrides);
    console.log(`[migrate] preset nav: seeded footer:true for ${seeded} section(s)`);
  } catch (e) { console.error('[migrate] preset nav seed failed:', e.message); }
}
