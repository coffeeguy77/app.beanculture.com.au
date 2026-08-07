const path = require('path');
const express = require('express');

const sq = require('./lib/squareClient');
const catalog = require('./lib/catalog');
const orders = require('./lib/orders');
const customers = require('./lib/customers');
const loyalty = require('./lib/loyalty');
const hours = require('./lib/hours');
const { getSettings, activeSeasonal, seasonalForPicker } = require('./lib/settings');
const cloudinary = require('./lib/cloudinary');
const db = require('./lib/db');
const cards = require('./lib/cards');
const scheduler = require('./lib/scheduled');

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
    const { cart, dineIn, table, name, coupon, customerId, pickupAt, loyalty: loy } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }
    if (dineIn && !table) {
      return res.status(400).json({ error: 'Table number is required for dine-in orders' });
    }
    const order = await orders.createOrder({ cart, dineIn: !!dineIn, table, name, coupon, customerId, pickupAt });

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
    const { sourceId, orderId, totalMoney, verificationToken, buyerEmail, customerId } =
      req.body || {};
    if (!orderId) return res.status(400).json({ error: 'Missing order id' });

    // $0 order (comp or fully covered by loyalty): complete without a card.
    if (!totalMoney || totalMoney.amount === 0) {
      const fresh = await orders.getOrder(orderId);
      await orders.payZeroOrder(orderId, fresh.version);
      return res.json({ status: 'COMPLETED', comped: true });
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
    const { cart, dineIn, table, name, phone, customerId, cardId, recurrence, pickupAt, label } = req.body || {};
    if (!customerId) return res.status(400).json({ error: 'Please sign in to schedule an order.' });
    if (!cardId) return res.status(400).json({ error: 'A saved card is required for scheduled orders.' });
    if (!Array.isArray(cart) || !cart.length) return res.status(400).json({ error: 'Your order is empty.' });
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required.' });
    if (dineIn && !table) return res.status(400).json({ error: 'Table number is required for dine-in.' });
    const plan = scheduler.planSchedule({ recurrence, pickupAt });
    const id = 'sch_' + sq.idem();
    const row = await db.insertScheduled({
      id, customerId, name, phone, dineIn: !!dineIn, table,
      cart, cardId, mode: 'autocharge', recurrence: recurrence || { type: 'none' },
      pickupAt: plan.pickupAt, nextRun: plan.nextRun, label,
    });
    res.json({ scheduled: row });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.post('/api/scheduled/:id/cancel', async (req, res) => {
  try {
    const { customerId } = req.body || {};
    const ok = await db.cancelScheduled(req.params.id, customerId);
    res.json({ ok });
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

app.get('/api/health', (_req, res) => res.json({ ok: true, env: sq.ENV }));

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

// ---- Admin: force a menu re-sync (clears the cache immediately) ----
app.post('/api/admin/sync', (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  menuCache = { data: null, at: 0 };
  res.json({ ok: true });
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
app.use(express.static(clientDist));
app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));

const PORT = process.env.PORT || 8080;
db.init().finally(() => {
  scheduler.start();
  app.listen(PORT, () => console.log(`Bean Culture app on :${PORT} (Square env: ${sq.ENV})`));
});
