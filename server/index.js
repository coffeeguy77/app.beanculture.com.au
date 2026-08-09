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

// ---- Public config: Square SDK ids + storefront settings + hours snapshot ----
app.get('/api/config', async (_req, res) => {
  const settings = getSettings();
  let hoursStatus = null;
  try {
    hoursStatus = await hours.getStatus();
  } catch (e) {
    hoursStatus = { open: true, canOrderNow: true };
  }
  res.json({
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
    activeSeasonalTheme: activeSeasonal(settings),
    hero: settings.hero,
    heroRatio: settings.heroRatio,
    heroAutoplay: settings.heroAutoplay,
    heroInterval: settings.heroInterval,
    layoutMode: settings.layoutMode,
    footer: settings.footer,
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
    const { cart, dineIn, table, name, coupon, customerId, pickupAt, note, loyalty: loy } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }
    if (dineIn && !table) {
      return res.status(400).json({ error: 'Table number is required for dine-in orders' });
    }
    const order = await orders.createOrder({ cart, dineIn: !!dineIn, table, name, coupon, customerId, pickupAt, note });

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
    res.status(400).json({ error: 'Could not create order', detail: err.message });
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
      const o = await orders.createReservationOrder({ name, phone, partySize: party, at, notes });
      squareOrderId = o?.id || null;
    } catch (e) { console.error('[reserve] Square order failed:', e.message); }

    const saved = await db.insertReservation({ name, phone, email, party, reserveAt: at, notes, squareOrderId });

    // Fire notifications in the background (don't make the customer wait).
    notify.reservationNotify({ name, phone, email, party, reserveAt: at, notes }).catch(() => {});

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
app.post('/api/admin/reservations/status', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    await db.setReservationStatus(req.body?.id, req.body?.status);
    res.json({ ok: true });
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
app.get('*', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(clientDist, 'index.html'));
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
    // Diagnostic: show what Square returns per source vs what's covered.
    for (const id of sourceIds) {
      const cfg = configs[id];
      if (cfg && /tea/i.test(cfg.name)) console.log(`[sync-diag] ${JSON.stringify(cfg.name)} id=${id} names=${JSON.stringify(cfg.variations.map((v) => v.name))}`);
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
