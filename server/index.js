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
const kds = require('./lib/kds');
const terminal = require('./lib/terminal');
const locations = require('./lib/locations');
const surcharges = require('./lib/surcharges');

// Resolve the card terminal for a store: its own paired reader if set, else the
// default/global one (single-site, or before a per-store reader is paired).
function posTerminalFor(pos, locId) {
  const map = (pos && pos.terminalByLocation) || {};
  const perLoc = locId && map[locId];
  if (perLoc && perLoc.deviceId) return { deviceId: perLoc.deviceId, name: perLoc.name || 'Terminal' };
  return { deviceId: pos.terminalDeviceId || '', name: pos.terminalName || 'Terminal' };
}
const weather = require('./lib/weather');
const smartCampaigns = require('./lib/smartCampaigns');

const PREORDER_TZ = process.env.PREORDER_TZ || process.env.SEASON_TZ || 'Australia/Sydney';
const PREORDER_MAX_DAYS = Number(process.env.PREORDER_MAX_DAYS || 14);

const app = express();
// Keep the raw request body so the Square webhook route can verify its HMAC
// signature (the signature is computed over the exact bytes Square sent).
app.use(express.json({ limit: '12mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));

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
    // Stores the customer can order from. Single-site deploys get one entry.
    // Hidden stores (event booths) are still listed so a ?loc= link resolves
    // them, but they never count towards "multiLocation" (the picker filters
    // them out, so they mustn't trigger a picker on their own).
    locations: locations.publicList(),
    multiLocation: locations.publicList().filter((l) => !l.hidden).length > 1,
    // Flat postage fee (minor units) for retail beans shipped from an event.
    eventShippingFee: settings.eventShippingFee != null ? settings.eventShippingFee : 1000,
    surcharges: surcharges.publicConfig(),
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
    // Optional subtle temperature display. Never blocks app load: we serve the
    // cached reading instantly and refresh in the background. null when the
    // toggle is off or no reading is available yet.
    weather: await (async () => {
      const sc = settings.smartCampaigns || {};
      if (!sc.showTemperature) return null;
      const pub = weather.publicWeather(await weather.forConfig());
      if (pub && sc.showCondition === false) { pub.condition = null; pub.conditionLabel = null; }
      return pub;
    })(),
    // Central resolver output: the homepage + category views consume this plan
    // as plain data. Empty (no-op) when no weather campaign is active — behaviour
    // is then identical to before. Never blocks: weather is cached/bounded.
    smartCampaigns: await (async () => {
      // Admin "Preview on homepage" forces one campaign to the top for a few
      // minutes regardless of weather — it wins over the normal resolution.
      const pv = smartCampaigns.previewPlan();
      const sc = settings.smartCampaigns || {};
      const hasCampaigns = Array.isArray(sc.weather) && sc.weather.some((c) => c && c.active !== false && (c.homepage_enabled || c.category_enabled));
      if (!hasCampaigns && !pv) return { heroSlides: [], byCategory: {} };
      let heroSlides = []; let byCategory = {};
      if (hasCampaigns) {
        let wx = null; try { wx = await weather.forConfig(); } catch {}
        try {
          const plan = smartCampaigns.resolveSmartPlacements({ settings, weather: wx, now: catalog.venueNow() });
          heroSlides = plan.heroSlides; byCategory = plan.byCategory;
        } catch (e) { console.warn('[smartCampaigns] resolve failed:', e.message); }
      }
      if (pv) {
        // Preview banner first; drop any normal slide for the same campaign so it
        // isn't shown twice.
        heroSlides = [...pv.heroSlides, ...heroSlides.filter((s) => s.campaignId !== pv.campaignId)];
        byCategory = { ...byCategory, ...pv.byCategory };
      }
      return { heroSlides, byCategory, previewUntil: pv ? pv.until : undefined };
    })(),
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
// Per-location menu cache (locations differ only by which items they offer).
let menuByLoc = {};
function bustMenuCache() { menuCache = { data: null, at: 0 }; menuByLoc = {}; }
const MENU_TTL_MS = Number(process.env.MENU_TTL_MS || 45_000);
app.get('/api/menu', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const now = Date.now();
    // Resolve the requested store (falls back to the default/main location).
    const loc = locations.resolve(req.query.location).id;
    const hit = menuByLoc[loc];
    if (hit && hit.data && now - hit.at < MENU_TTL_MS) return res.json(hit.data);
    let menu = await catalog.getMenu({ location: loc });
    // Curated event menu: if this store lists specific sections, show ONLY those
    // (in the order the store chose) and treat them as primary nav so the single
    // curated section behaves like a normal top-level menu at the event.
    const only = locations.menuSectionsFor(loc);
    if (only.length && Array.isArray(menu.categories)) {
      const rank = new Map(only.map((n, i) => [n, i]));
      const kept = menu.categories
        .filter((c) => rank.has(String(c.category || '').toLowerCase()))
        .map((c) => ({ ...c, topNav: true, eventOnly: false }));
      kept.sort((a, b) => rank.get(String(a.category).toLowerCase()) - rank.get(String(b.category).toLowerCase()));
      menu = { ...menu, categories: kept };
    } else if (Array.isArray(menu.categories)) {
      // A normal store never shows an "Event locations" section — those only
      // appear where a store's event menu explicitly names them (above).
      menu = { ...menu, categories: menu.categories.filter((c) => !c.eventOnly) };
    }
    menuByLoc[loc] = { data: menu, at: now };
    if (loc === locations.resolve(null).id) menuCache = { data: menu, at: now }; // keep legacy field warm
    res.json(menu);
  } catch (err) {
    console.error('menu error', err.message);
    res.status(502).json({ error: 'Could not load menu', detail: err.message });
  }
});

// Per-store open/closed status + that store's current weather. The customer app
// calls this whenever the chosen store changes, so the closed banner, reopen
// countdown and temperature chip all reflect the selected location.
app.get('/api/hours', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const locId = req.query.location || req.query.loc || '';
    const status = await hours.getStatus(locId);
    let wx = null;
    try { const loc = locations.resolve(locId); wx = weather.publicWeather(await weather.forConfig(3000, loc)); } catch {}
    res.json({ ...status, weather: wx });
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

// ---- Enrol a walk-up customer (name + phone) at an event ----
// Finds or creates the Square customer, drops them into the loyalty program, and
// hands the app their identity so the device remembers them for fast reorders.
app.post('/api/loyalty/enroll', async (req, res) => {
  try {
    const { phone, name } = req.body || {};
    if (!phone || !String(phone).trim()) return res.status(400).json({ error: 'Phone is required' });
    const cust = await customers.findOrCreate({ phone, name });
    const acct = await loyalty.enrollAccount({ phone: cust.phone, customerId: cust.customerId }).catch(() => null);
    res.json({
      customerId: cust.customerId,
      name: cust.name,
      phone: cust.phone,
      loyaltyAccountId: acct ? acct.id : null,
      points: acct ? acct.balance || 0 : 0,
    });
  } catch (e) {
    res.status(400).json({ error: 'Could not enrol', detail: e.message });
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
    const { cart, dineIn, table, name, coupon, customerId, phone, pickupAt, note, loyalty: loy, pifVoucher, locationId, cardPayment, shipping: shipReq } = req.body || {};
    const squareLocationId = locations.squareIdFor(locationId);
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
    // Event first order: name + phone are required at an event store; enrol the
    // customer so they're recognised for faster future ordering (and dropped into
    // Square loyalty). No-op if they're already signed in.
    if (!effectiveCustomerId && phone) {
      try {
        const cust = await customers.findOrCreate({ phone, name });
        effectiveCustomerId = cust.customerId;
        orderPhone = cust.phone;
        loyalty.enrollAccount({ phone: cust.phone, customerId: cust.customerId }).catch(() => {});
      } catch (e) { console.error('event enrol failed', e.message); }
    }
    // Free/complimentary is decided by the STORE, never the client. A store may
    // be wholly free (original event flag) OR free only for certain categories
    // (coffees free, retail beans paid) — the order code classifies each line
    // authoritatively from the catalog. Retail beans can be posted for a flat
    // shipping fee (set in settings, never trusted from the client).
    const freeCategories = [...locations.freeCategoriesFor(locationId)];
    const freeOrder = locations.isFree(locationId) && freeCategories.length === 0;
    const sNow = getSettings();
    const shipFee = Number(sNow.eventShippingFee != null ? sNow.eventShippingFee : 1000) || 0;
    const shipping = (freeCategories.length && shipReq && shipReq.address && String(shipReq.address).trim())
      ? { fee: shipFee, address: shipReq.address, label: 'Shipping' } : null;
    const evLoc = locations.resolve(locationId);
    const eventId = evLoc && evLoc.type === 'event' ? evLoc.id : undefined;
    const order = await orders.createOrder({ cart, dineIn: !!dineIn, table, name, coupon, customerId: effectiveCustomerId, pickupAt, note, pifVoucher, squareLocationId, cardPayment: cardPayment !== false, free: freeOrder, freeCategories, shipping, eventId, appLocationId: evLoc ? evLoc.id : undefined });

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
      // When we enrolled a walk-up event customer, hand back their identity so the
      // app can remember them on the device (one-tap reorders at the event).
      customer: (effectiveCustomerId && !customerId) ? { customerId: effectiveCustomerId, name: name || '', phone: orderPhone || '' } : undefined,
    });
  } catch (err) {
    console.error('order error', err.message);
    res.status(400).json({ error: err.pifReason ? err.message : 'Could not create order', detail: err.message, pifReason: err.pifReason || undefined });
  }
});

// ---- Pay (card token, or complete a $0 order for comp/full-loyalty) ----
app.post('/api/pay', async (req, res) => {
  try {
    const { sourceId, orderId, totalMoney, verificationToken, buyerEmail, customerId, payWith, locationId } =
      req.body || {};
    if (!orderId) return res.status(400).json({ error: 'Missing order id' });
    const squareLocationId = locations.squareIdFor(locationId);

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
      squareLocationId,
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
app.post('/api/admin/messages/delete', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    await db.deleteMessage(req.body?.id);
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
  // Per-location open/closed (+ event countdown) so the dashboard can show every
  // store at a glance, not just the main one.
  let locationStatuses = [];
  try {
    const list = locations.active();
    locationStatuses = await Promise.all(list.map(async (l) => {
      const st = await hours.getStatus(l.id).catch(() => null);
      return {
        id: l.id, name: l.name, type: l.type || 'physical', hidden: !!l.hidden,
        open: st ? !!st.open : null,
        canOrderNow: st ? st.canOrderNow !== false : null,
        opening: st && st.opening ? { label: st.opening.label, daysUntil: st.opening.daysUntil } : null,
        nextOpenLabel: st && st.nextOpen ? st.nextOpen.label : null,
        ended: st ? !!st.ended : false,
      };
    }));
  } catch {}
  res.json({
    settings,
    hours: hoursStatus,
    locationStatuses,
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
    bustMenuCache(); // category/item changes go live immediately
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- Admin: fast per-item sold-out toggle (kitchen / front-of-house) ----
// Writes only availability.items[id] into the persisted overrides so a busy
// service can flip stock without round-tripping the whole settings blob.
//   mode: 'off'   → unavailable indefinitely (highlighted in the product builder)
//         'today' → sold out until we next open (auto-clears)
//         'on'    → force available today (overrides the day-exclusion list)
//         'clear' → remove any override (back to normal)
app.post('/api/admin/availability/item', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id, mode } = req.body || {};
    if (!id || typeof id !== 'string') return res.status(400).json({ error: 'Missing item id' });
    if (!['off', 'today', 'on', 'clear'].includes(mode)) return res.status(400).json({ error: 'Bad mode' });

    const ov = db.getOverrides() || {};
    ov.availability = ov.availability || {};
    ov.availability.items = ov.availability.items || {};

    if (mode === 'clear') {
      delete ov.availability.items[id];
    } else if (mode === 'off') {
      ov.availability.items[id] = { mode: 'off', setAt: new Date().toISOString() };
    } else {
      // 'today' and 'on' both auto-clear the next day we open.
      const settings = getSettings();
      const until = catalog.nextOpenDate(settings, catalog.venueNow().date);
      ov.availability.items[id] = { mode, until, setAt: new Date().toISOString() };
    }

    await db.saveOverrides(ov);
    bustMenuCache();
    res.json({ ok: true, items: ov.availability.items });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- Admin: the ids of products actually OFFERED in the app menu ----
// Selection applied (only offered items) but WITHOUT the time/sold-out overlay,
// so the Sold-Out and Day-Exclusion tools show every offered product even when a
// menu schedule is currently hiding its category. The admin filters the full
// Square product list down to these ids so it never wades through items the app
// doesn't sell.
app.get('/api/admin/offered-products', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  res.setHeader('Cache-Control', 'no-store');
  try {
    const menu = await catalog.getMenu({ skipAvailability: true });
    const ids = new Set();
    // Also return the offered items WITH their display names and the id the
    // menu itself uses (e.g. a preset's `preset:<id>`, not the raw Square item
    // id). Tools like per-location availability need the menu id so ticking an
    // item stores an id the menu's hide-filter actually matches, and need the
    // name to render — the raw Square product list (getAllProducts) uses a
    // different id space for preset-built menus and won't intersect at all.
    const products = [];
    const seen = new Set();
    for (const sec of (menu.categories || [])) {
      if (sec.isCombo) continue; // combos are derived, not individually stocked
      for (const it of (sec.items || [])) {
        if (!it || !it.id) continue;
        ids.add(it.id);
        if (!seen.has(it.id)) {
          seen.add(it.id);
          products.push({ id: it.id, name: it.name || 'Item', category: sec.category || '' });
        }
      }
    }
    res.json({ ids: [...ids], products });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  Kitchen Display System (/kds bump screen)
// ═══════════════════════════════════════════════════════════════════════════
// Live updates: Square webhooks (when configured) ping every connected screen
// via SSE for instant refresh; each screen also polls on a slow safety timer so
// a missed webhook — or no webhook configured at all — is never fatal.
const kdsClients = new Set(); // open SSE responses
function kdsBroadcast(reason) {
  const line = `event: changed\ndata: ${JSON.stringify({ reason, at: Date.now() })}\n\n`;
  for (const res of kdsClients) { try { res.write(line); } catch {} }
}

// Zone config + display thresholds for the screen (no order data).
// ── Kiosk POS ──────────────────────────────────────────────────────────────
// Staff register + adaptive KDS (/pos). Reuses the customer catalogue, the
// shared item-config logic, orders.createOrder and the KDS. Phase 1 tenders:
// cash (Square CASH payment) and send-to-kitchen (unpaid OPEN order). Card via
// Square Terminal is the next phase.
app.get('/api/pos/config', (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  const s = getSettings();
  const p = s.pos || {};
  res.json({
    deviceName: p.deviceName || 'Front counter',
    mode: ['pos_kds', 'pos', 'kds'].includes(p.mode) ? p.mode : 'pos_kds',
    autoReturnSec: Number(p.autoReturnSec) >= 0 ? Number(p.autoReturnSec) : 3,
    staff: 'Staff',
    logoUrl: s.logoUrl || '',
    storeName: s.storeName || 'Bean Culture',
    locations: locations.publicList(),
    surcharges: surcharges.publicConfig(),
    terminalDeviceId: p.terminalDeviceId || '',
    terminalName: p.terminalName || '',
    terminalByLocation: p.terminalByLocation || {},
    dbEnabled: db.enabled,
  });
});

app.post('/api/pos/order', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { cart, dineIn, table, name, tender, cashGiven, locationId } = req.body || {};
    if (!Array.isArray(cart) || cart.length === 0) return res.status(400).json({ error: 'Cart is empty' });
    if (!['cash', 'unpaid', 'card'].includes(tender)) return res.status(400).json({ error: 'Unsupported tender' });
    const pos = getSettings().pos || {};
    const squareLocationId = locations.squareIdFor(locationId);
    const posTerminal = posTerminalFor(pos, locationId);
    if (tender === 'card' && !posTerminal.deviceId) {
      return res.status(400).json({ error: 'No card terminal is paired for this store. Pair one in POS setup first.' });
    }

    // Server-authoritative order: Square re-prices from the variation/modifier
    // ids, so the client total is display-only and cannot be tampered with.
    const posFreeCategories = [...locations.freeCategoriesFor(locationId)];
    const posEvLoc = locations.resolve(locationId);
    const order = await orders.createOrder({
      cart, dineIn: !!dineIn, table: table || '', name: name || '',
      source: pos.sourceName || 'Bean Culture POS', squareLocationId, cardPayment: tender === 'card',
      free: locations.isFree(locationId) && posFreeCategories.length === 0,
      freeCategories: posFreeCategories,
      eventId: posEvLoc && posEvLoc.type === 'event' ? posEvLoc.id : undefined,
      appLocationId: posEvLoc ? posEvLoc.id : undefined,
    });
    const amount = order.total_money ? order.total_money.amount : 0;
    const currency = (order.total_money && order.total_money.currency) || sq.CURRENCY;

    // ── Card: start a Terminal checkout and hand the client a checkout id to
    //    watch. Authoritative completion arrives by webhook + polling, never
    //    from the browser, so a disconnect can't lose or double a charge. ──
    if (tender === 'card') {
      try {
        const checkout = await terminal.createCheckout({
          amountMoney: { amount, currency },
          deviceId: posTerminal.deviceId,
          orderId: order.id,
          referenceId: order.id,
          note: `${pos.deviceName || 'POS'} · ${name || (dineIn ? 'Dine-in' : 'Takeaway')}`,
        });
        try { await db.posPaymentUpsert({ checkoutId: checkout.id, squareOrderId: order.id, deviceId: posTerminal.deviceId, amount, status: 'waiting' }); } catch {}
        return res.json({
          orderId: order.id, checkoutId: checkout.id, total: amount, currency,
          tender: 'card', status: 'waiting', terminalName: posTerminal.name || pos.deviceName || 'Terminal',
        });
      } catch (e) {
        // Checkout couldn't start — cancel the just-created order so no orphan
        // hits the kitchen, and surface the reason.
        console.warn('[pos] terminal checkout FAILED:', e.message);
        await orders.cancelOrder(order.id).catch(() => {});
        return res.status(502).json({ error: `Could not start the card payment: ${e.message}` });
      }
    }

    let payment = null;
    if (tender === 'cash') {
      const given = Math.max(amount, Math.round(Number(cashGiven) || amount));
      payment = await orders.createCashPayment({
        orderId: order.id,
        amountMoney: { amount, currency },
        buyerSuppliedMoney: { amount: given, currency },
        squareLocationId,
      });
    }
    // 'unpaid' leaves the order OPEN in Square; it still appears on the KDS.

    // Best-effort audit row (only when a DB is configured).
    try {
      if (db.enabled && typeof db.posRecordOrder === 'function') {
        await db.posRecordOrder({
          squareOrderId: order.id, squarePaymentId: payment ? payment.id : null,
          source: pos.sourceName || 'Bean Culture POS', tender, amount,
          status: tender === 'cash' ? 'paid' : 'unpaid',
          deviceName: pos.deviceName || 'Front counter',
        });
      }
    } catch (e) { console.warn('[pos] audit record failed:', e.message); }

    res.json({ orderId: order.id, total: amount, currency, tender, paymentId: payment ? payment.id : null });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Reconcile a Terminal checkout to our state machine. Idempotent — safe to call
// from the client poll AND the webhook; whichever arrives first wins, the other
// is a no-op. `fallbackOrderId` covers DB-less deployments (no persisted row).
async function reconcileCheckout(id, checkoutObj, fallbackOrderId) {
  const c = checkoutObj || await terminal.getCheckout(id);
  const phase = terminal.phaseOf(c);
  const paymentId = (c.payment_ids && c.payment_ids[0]) || null;
  console.log('[terminal] reconcile', JSON.stringify({ id, sqStatus: c.status, phase, cancelReason: c.cancel_reason || null, deviceId: c.device_options && c.device_options.device_id }));
  const row = await db.posPaymentGet(id).catch(() => null);
  const orderId = (row && row.square_order_id) || fallbackOrderId || null;
  const pos = getSettings().pos || {};
  if (phase === 'paid') {
    await db.posPaymentSetStatus(id, 'paid', paymentId).catch(() => {});
    if (orderId) {
      try {
        await db.posRecordOrder({
          squareOrderId: orderId, squarePaymentId: paymentId,
          source: pos.sourceName || 'Bean Culture POS', tender: 'card',
          amount: (c.amount_money && c.amount_money.amount) || (row ? row.amount : 0),
          status: 'paid', deviceName: pos.deviceName || 'Front counter',
        });
      } catch {}
    }
  } else if (phase === 'canceled') {
    await db.posPaymentSetStatus(id, 'canceled', null).catch(() => {});
    if (orderId) await orders.cancelOrder(orderId).catch(() => {}); // drop it off the KDS
  } else {
    await db.posPaymentSetStatus(id, phase, paymentId).catch(() => {});
  }
  return { status: phase, orderId, paymentId, amount: (c.amount_money && c.amount_money.amount) || 0 };
}

// Poll a checkout's status (client fallback to the webhook; never trusts only
// the browser for the source of truth — this always re-reads Square).
app.get('/api/pos/checkout/:id', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const out = await reconcileCheckout(req.params.id, null, req.query.orderId);
    res.json(out);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// Cancel an in-progress checkout (staff pressed Cancel).
app.post('/api/pos/checkout/:id/cancel', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const c = await terminal.cancelCheckout(req.params.id);
    const out = await reconcileCheckout(req.params.id, c, (req.body && req.body.orderId));
    res.json(out);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ── Terminal pairing (from POS setup) ──
app.post('/api/pos/terminal/pair', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const dc = await terminal.createDeviceCode((req.body && req.body.name) || (getSettings().pos || {}).deviceName);
    res.json({ id: dc.id, code: dc.code, status: dc.status, deviceId: dc.device_id || '' });
  } catch (e) { res.status(502).json({ error: e.message }); }
});
app.get('/api/pos/terminal/pair/:id', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const dc = await terminal.getDeviceCode(req.params.id);
    res.json({ id: dc.id, code: dc.code, status: dc.status, deviceId: dc.device_id || '', name: dc.name || '' });
  } catch (e) { res.status(502).json({ error: e.message }); }
});
app.get('/api/pos/terminal/devices', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const devices = await terminal.listDevices();
    const current = (getSettings().pos || {}).terminalDeviceId || '';
    console.log('[terminal] devices', JSON.stringify({ current, devices: devices.map((d) => ({ id: d.id, name: d.name, status: d.status })) }));
    res.json({ devices, current });
  } catch (e) { res.status(502).json({ error: e.message }); }
});
// Assign the reader this venue uses for card payments (persists to settings).
app.post('/api/pos/terminal/select', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (!db.enabled) return res.status(400).json({ error: 'A database is required to save the terminal selection.' });
  try {
    const { deviceId, name, locationId } = req.body || {};
    if (!deviceId) return res.status(400).json({ error: 'Missing device id' });
    const ov = db.getOverrides() || {};
    ov.pos = ov.pos || {};
    if (locationId) {
      // Per-store reader (multi-location): this store's POS uses this terminal.
      ov.pos.terminalByLocation = { ...(ov.pos.terminalByLocation || {}), [locationId]: { deviceId: String(deviceId), name: String(name || '').slice(0, 60) } };
    } else {
      ov.pos.terminalDeviceId = String(deviceId);
      ov.pos.terminalName = String(name || '').slice(0, 60);
    }
    await db.saveOverrides(ov);
    res.json({ ok: true, terminalDeviceId: String(deviceId), terminalName: String(name || '').slice(0, 60) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
// Forget the paired reader (e.g. it was unpaired on the device itself). Clears
// this store's reader (or the default one) so the POS stops trying to reach it.
app.post('/api/pos/terminal/disconnect', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (!db.enabled) return res.status(400).json({ error: 'A database is required to change the terminal.' });
  try {
    const { locationId } = req.body || {};
    const ov = db.getOverrides() || {};
    ov.pos = ov.pos || {};
    if (locationId && ov.pos.terminalByLocation && ov.pos.terminalByLocation[locationId]) {
      const m = { ...ov.pos.terminalByLocation }; delete m[locationId]; ov.pos.terminalByLocation = m;
    } else {
      ov.pos.terminalDeviceId = ''; ov.pos.terminalName = '';
    }
    await db.saveOverrides(ov);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/admin/kds/config', (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  const cfg = kds.kdsSettings();
  res.json({ ...cfg, allZone: kds.ALL_ZONE, dbEnabled: db.enabled, locations: locations.publicList() });
});

// The live ticket feed (scoped to the screen's chosen store).
app.get('/api/admin/kds/tickets', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  res.setHeader('Cache-Control', 'no-store');
  try {
    // Events share the main store's Square location, so scope the board to the
    // chosen screen: an event screen shows only that event's tickets, and a
    // café/pop-up screen never shows event tickets (they belong to the booth).
    const loc = locations.resolve(req.query.location);
    const data = await kds.fetchTickets(locations.squareIdFor(req.query.location), loc);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Set a station's status for one ticket (new | preparing | done). Recall = 'new'.
app.post('/api/admin/kds/bump', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { orderId, zone, status } = req.body || {};
    if (!orderId || !zone) return res.status(400).json({ error: 'Missing orderId or zone' });
    if (!['new', 'preparing', 'done'].includes(status)) return res.status(400).json({ error: 'Bad status' });
    const row = await db.kdsSetStatus(orderId, zone, status);
    kdsBroadcast('bump');
    res.json({ ok: true, row });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Server-Sent Events stream — screens subscribe and get a ping whenever tickets
// change. EventSource can't send headers, so auth rides in the query string.
app.get('/api/admin/kds/stream', (req, res) => {
  if (!adminOk(req)) return res.status(401).end();
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  res.write('retry: 3000\n\n');
  res.write(`event: hello\ndata: ${Date.now()}\n\n`);
  kdsClients.add(res);
  const keepAlive = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25000);
  req.on('close', () => { clearInterval(keepAlive); kdsClients.delete(res); });
});

// Square webhook receiver — verifies the HMAC signature, then just nudges the
// screens to refetch (it never mutates data, so a spoofed ping is harmless, but
// we still verify when a signature key is configured).
// ---- Twilio SMS delivery-status callback ----
// Twilio POSTs (form-encoded) the delivery status of each message we send —
// queued → sent → delivered, or failed/undelivered. We just record the latest
// few in memory so the admin can see whether texts are landing; nothing here
// affects ordering. Point Twilio's "Status callback URL" at /api/twilio/status.
const twilioStatuses = []; // ring buffer of { at, sid, to, status, errorCode, from }
app.post('/api/twilio/status', express.urlencoded({ extended: false }), (req, res) => {
  try {
    const b = req.body || {};
    if (b.MessageSid || b.SmsSid || b.MessageStatus || b.SmsStatus) {
      twilioStatuses.unshift({
        at: new Date().toISOString(),
        sid: b.MessageSid || b.SmsSid || '',
        to: b.To || '',
        from: b.From || '',
        status: b.MessageStatus || b.SmsStatus || '',
        errorCode: b.ErrorCode || '',
      });
      if (twilioStatuses.length > 100) twilioStatuses.length = 100;
      if (b.ErrorCode) console.warn('[twilio] delivery issue', b.MessageStatus, b.ErrorCode, b.To);
    }
  } catch (e) { console.error('[twilio] status error', e.message); }
  // Twilio wants a fast 2xx; an empty 204 is fine (no TwiML needed).
  res.status(204).end();
});
app.get('/api/admin/twilio/status', (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  res.json({ configured: notify.smsConfigured, recent: twilioStatuses.slice(0, 50) });
});

app.post('/api/square/webhook', (req, res) => {
  try {
    const key = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY || '';
    if (key) {
      const sig = req.get('x-square-hmacsha256-signature') || '';
      const url = process.env.SQUARE_WEBHOOK_URL || `https://${req.get('host')}${req.originalUrl}`;
      const body = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body || {});
      const expected = crypto.createHmac('sha256', key).update(url + body).digest('base64');
      const a = Buffer.from(sig); const b = Buffer.from(expected);
      const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
      if (!ok) return res.status(401).json({ error: 'bad signature' });
    }
    const type = (req.body && req.body.type) || '';
    // Order/payment/refund events all mean "tickets may have changed".
    if (!type || /order|payment|refund/i.test(type)) kdsBroadcast(type || 'webhook');
    // Terminal checkout updates drive the POS card state machine. Reconcile in
    // the background so Square still gets a fast 200 (handler stays idempotent).
    if (/terminal\.checkout/i.test(type)) {
      const c = req.body && req.body.data && req.body.data.object && req.body.data.object.checkout;
      if (c && c.id) reconcileCheckout(c.id, c).catch((e) => console.warn('[pos] webhook reconcile failed:', e.message));
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(200).json({ ok: false }); // never make Square retry-storm us
  }
});

// ---- Admin: live weather status (for the Smart Campaigns screen) ----
app.get('/api/admin/weather', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try { res.json({ weather: await weather.getWeather() }); }
  catch (e) { res.json({ weather: { ok: false, reason: e.message } }); }
});
let lastWeatherRefresh = 0;
app.post('/api/admin/weather/refresh', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  // Respect the provider: force a refresh at most once every 30s.
  const force = Date.now() - lastWeatherRefresh > 30000;
  if (force) lastWeatherRefresh = Date.now();
  try { res.json({ weather: await weather.getWeather({ force }), refreshed: force }); }
  catch (e) { res.json({ weather: { ok: false, reason: e.message } }); }
});
// ---- Admin: Smart Campaign homepage preview (force one to the top for a few
//      minutes so the owner can see it live, regardless of the weather). ----
app.post('/api/admin/smartcampaigns/preview', (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { campaign, minutes } = req.body || {};
    if (!campaign || !campaign.homepage_artwork) return res.status(400).json({ error: 'Add homepage artwork first, then preview.' });
    const ms = (Number(minutes) > 0 ? Number(minutes) : 5) * 60000;
    const until = smartCampaigns.setPreview(campaign, ms);
    res.json({ ok: true, until });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/admin/smartcampaigns/preview/stop', (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  smartCampaigns.clearPreview();
  res.json({ ok: true });
});
// ---- Admin: sales by store & source (app self-order vs counter POS) ----
// Authoritative from Square: completed orders per location, bucketed by day and
// classified by order source. Used by the Locations tab's analytics.
function saleSource(name) {
  const n = String(name || '').toLowerCase();
  if (n.includes('pos')) return 'pos';        // 'Bean Culture POS' (counter)
  if (n.includes('app') || n.includes('bean culture')) return 'app'; // 'Bean Culture App' (self-order)
  return 'other';                              // Square POS / other integrations
}
function dayInTz(iso, tz) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso)); }
  catch { return String(iso).slice(0, 10); }
}
app.get('/api/admin/analytics/sales', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const days = Math.max(1, Math.min(90, parseInt(req.query.days, 10) || 7));
    const tz = (getSettings().contact && getSettings().contact.timezone) || 'Australia/Sydney';
    const startAt = new Date(Date.now() - days * 86400000).toISOString();
    const stores = locations.active();
    const out = [];
    for (const store of stores) {
      const byDay = {}; // date -> { app, pos, other, total }
      const totals = { app: 0, pos: 0, other: 0, total: 0, count: 0 };
      let cursor; let pages = 0;
      do {
        const data = await sq.squareFetch('/v2/orders/search', {
          method: 'POST',
          body: {
            location_ids: [store.squareLocationId],
            cursor,
            query: {
              filter: { date_time_filter: { created_at: { start_at: startAt } }, state_filter: { states: ['COMPLETED'] } },
              sort: { sort_field: 'CREATED_AT', sort_order: 'DESC' },
            },
            limit: 500,
          },
        }).catch(() => ({}));
        for (const o of (data.orders || [])) {
          const amt = (o.total_money && o.total_money.amount) || 0;
          const src = saleSource(o.source && o.source.name);
          const d = dayInTz(o.created_at, tz);
          const row = byDay[d] || (byDay[d] = { app: 0, pos: 0, other: 0, total: 0 });
          row[src] += amt; row.total += amt;
          totals[src] += amt; totals.total += amt; totals.count += 1;
        }
        cursor = data.cursor; pages += 1;
      } while (cursor && pages < 6);
      const daily = Object.keys(byDay).sort().map((date) => ({ date, ...byDay[date] }));
      out.push({ id: store.id, name: store.name, daily, totals });
    }
    res.json({ days, currency: sq.CURRENCY, stores: out });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ---- Admin: "who did we give a free coffee to" — the event guest log ----
// For an event store, every complimentary order is a captured lead: the person
// enrolled with name + mobile, and the booth they ordered from is on the order.
// This joins those comp orders to their Square customer (name + phone) so the
// owner sees e.g. "Bill · 0404 040 404 · Microsoft Booth · 9:14am". Read-only,
// derived live from Square — nothing new is stored.
// Shared event aggregation: pulls the completed Square orders for one or more
// event stores over `days` and derives the free-coffee guest list, booth
// breakdown, cups given, paid sales and the app-vs-counter split. Used by the
// admin guest log AND the organiser /stats page.
async function aggregateEventStats(sqLocIds, days, eventId) {
  const startAt = new Date(Date.now() - days * 86400000).toISOString();
  const orders = [];
  for (const locId of sqLocIds) {
    let cursor; let pages = 0;
    do {
      const data = await sq.squareFetch('/v2/orders/search', {
        method: 'POST',
        body: {
          location_ids: [locId], cursor,
          query: {
            filter: { date_time_filter: { created_at: { start_at: startAt } }, state_filter: { states: ['COMPLETED'] } },
            sort: { sort_field: 'CREATED_AT', sort_order: 'DESC' },
          },
          limit: 500,
        },
      }).catch(() => ({}));
      for (const o of (data.orders || [])) orders.push(o);
      cursor = data.cursor; pages += 1;
    } while (cursor && pages < 6);
  }
  const isCompOrder = (o) =>
    (o.metadata && o.metadata.bc_free === 'event') ||
    (o.discounts || []).some((d) => /complimentary \(event\)/i.test(d.name || ''));
  const boothOf = (o) => {
    if (o.metadata && o.metadata.bc_booth) return o.metadata.bc_booth;
    const note = (o.fulfillments && o.fulfillments[0] && o.fulfillments[0].pickup_details && o.fulfillments[0].pickup_details.note) || o.note || '';
    const m = /DINE-IN ·\s*([^·]+)/i.exec(note);
    return m ? m[1].trim() : '';
  };
  const cupsOf = (o) => (o.line_items || []).reduce((n, li) => n + (Number(li.quantity) || 0), 0);
  // CRITICAL: events share the main store's Square location, so the raw order
  // search returns ALL of Bean Culture's takings there. Restrict everything to
  // THIS event's orders — matched by the event-id tag (bc_event) so two events on
  // one Square location don't bleed together; untagged legacy comp orders still
  // count when a single event is requested. Never the whole cafe's income.
  const isEventOrder = (o) => (eventId
    ? (o.metadata && o.metadata.bc_event === eventId) || (!(o.metadata && o.metadata.bc_event) && isCompOrder(o))
    : isCompOrder(o));
  const eventOrders = orders.filter(isEventOrder);
  // Free-coffee guest rows are the complimentary orders among this event's orders
  // (a paid beans-only order is an event order but not a "free coffee given").
  const rows = eventOrders.filter(isCompOrder).map((o) => ({
    customerId: o.customer_id || null, booth: boothOf(o), at: o.created_at,
    paid: (o.total_money && o.total_money.amount) || 0, cups: cupsOf(o),
  }));
  // Join Square customers for name + phone (bulk, chunked).
  const ids = [...new Set(rows.map((r) => r.customerId).filter(Boolean))];
  const custMap = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    try {
      const data = await sq.squareFetch('/v2/customers/bulk-retrieve', { method: 'POST', body: { customer_ids: ids.slice(i, i + 100) } });
      for (const [id, r] of Object.entries(data.responses || {})) if (r.customer) custMap.set(id, r.customer);
    } catch { /* thinner detail on a failed chunk */ }
  }
  const guests = rows.map((r) => {
    const c = r.customerId ? custMap.get(r.customerId) : null;
    const name = c ? ([c.given_name, c.family_name].filter(Boolean).join(' ').trim() || c.company_name || c.nickname || '') : '';
    return { name: name || 'Guest', phone: (c && c.phone_number) || '', booth: r.booth || '', at: r.at, paidExtra: r.paid > 0 };
  }).sort((a, b) => new Date(b.at) - new Date(a.at));
  const byBoothMap = {};
  for (const r of rows) { const b = r.booth || '—'; byBoothMap[b] = (byBoothMap[b] || 0) + r.cups; }
  const byBooth = Object.entries(byBoothMap).map(([booth, cups]) => ({ booth, cups })).sort((a, b) => b.cups - a.cups);
  let paidSales = 0; let paidOrders = 0; const bySource = { app: 0, pos: 0, other: 0 };
  for (const o of eventOrders) {
    const amt = (o.total_money && o.total_money.amount) || 0;
    if (amt > 0) { paidSales += amt; paidOrders += 1; } // paid beans within the event
    bySource[saleSource(o.source && o.source.name)] += 1;
  }
  const uniqueGuests = new Set(rows.filter((r) => r.customerId).map((r) => r.customerId)).size + rows.filter((r) => !r.customerId).length;
  return {
    guests, byBooth, bySource,
    freeOrders: rows.length, freeCups: rows.reduce((n, r) => n + r.cups, 0),
    uniqueGuests, paidSales, paidOrders, totalOrders: eventOrders.length,
    currency: sq.CURRENCY,
  };
}

app.get('/api/admin/analytics/event-guests', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const days = Math.max(1, Math.min(120, parseInt(req.query.days, 10) || 30));
    const stores = req.query.location ? [locations.resolve(req.query.location)] : locations.active();
    const sqLocIds = [...new Set(stores.map((s) => s.squareLocationId).filter(Boolean))];
    const eventId = req.query.location ? locations.resolve(req.query.location).id : undefined;
    const stats = await aggregateEventStats(sqLocIds, days, eventId);
    res.json({ days, count: stats.guests.length, guests: stats.guests });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ---- Organiser stats page (public, gated by the event's private share code) ----
// The event owner shares /stats?event=<id>&key=<code>. We validate the code
// against that event's statsCode, then return the full picture: totals, booth
// breakdown, app-vs-counter split, and the guest list (name + mobile + booth).
app.get('/api/stats', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const eventId = String(req.query.event || '');
    const key = String(req.query.key || '');
    const ev = locations.resolve(eventId);
    if (!ev || ev.id !== eventId || !ev.statsCode || key !== ev.statsCode) {
      return res.status(403).json({ error: 'Invalid or missing access code.' });
    }
    const days = Math.max(1, Math.min(120, parseInt(req.query.days, 10) || 30));
    const sqLocIds = [ev.squareLocationId].filter(Boolean);
    const stats = await aggregateEventStats(sqLocIds, days, ev.id);
    res.json({ event: { id: ev.id, name: ev.name }, days, ...stats });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ---- Admin: list this Square account's locations (id + name) so the Locations
//      setup can offer a dropdown instead of hunting for the id in Square. ----
app.get('/api/admin/square-locations', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const data = await sq.squareFetch('/v2/locations');
    const list = (data.locations || [])
      .filter((l) => (l.status || 'ACTIVE') === 'ACTIVE')
      .map((l) => ({ id: l.id, name: l.name || l.id, address: (l.address && [l.address.address_line_1, l.address.locality].filter(Boolean).join(', ')) || '' }));
    res.json({ locations: list });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ---- Admin: read the Square location's coordinates (to prefill store lat/lng) ----
app.get('/api/admin/square-location-geo', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const data = await sq.squareFetch(`/v2/locations/${sq.LOCATION_ID}`);
    const c = data.location && data.location.coordinates;
    if (c && Number.isFinite(c.latitude) && Number.isFinite(c.longitude)) {
      res.json({ lat: c.latitude, lng: c.longitude, name: data.location.name || '' });
    } else {
      res.json({ lat: null, lng: null, error: 'Square has no coordinates for this location' });
    }
  } catch (e) { res.status(502).json({ error: e.message }); }
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
  bustMenuCache();
  res.json({ ok: true });
});

// ---- Admin: upload a real photo to a Square catalog item (replaces AI image) ----
app.post('/api/admin/catalog/image', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { objectId, dataUri, caption, primary } = req.body || {};
    if (!objectId || !dataUri) return res.status(400).json({ error: 'objectId and image are required.' });
    const out = await squareImages.uploadItemImage({ objectId, dataUri, caption, primary: primary !== false });
    bustMenuCache(); // show the new image immediately
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

// Rewrite the served HTML shell so that installing a PWA from /kds creates a
// dedicated "Bean Culture KDS" home-screen app (start_url:/kds) rather than the
// customer app. We only need to point the manifest + Apple web-app hints at the
// KDS variants; installing from any other path keeps the customer manifest.
function kdsShell(html) {
  return html
    .replace(/<link rel="manifest" href="\/manifest\.webmanifest"\s*\/?>/,
             '<link rel="manifest" href="/kds.webmanifest" />')
    .replace(/<link rel="apple-touch-icon"[^>]*>/,
             '<link rel="apple-touch-icon" href="/icons/kds-icon-180.png?v=20260829" />')
    .replace(/<meta name="apple-mobile-web-app-title" content="[^"]*"\s*\/?>/,
             '<meta name="apple-mobile-web-app-title" content="Bean Culture KDS" />')
    .replace(/<meta name="theme-color" content="[^"]*"\s*\/?>/,
             '<meta name="theme-color" content="#12161b" />');
}

// Same idea for the Kiosk POS: installing from /pos gives a dedicated
// "Bean Culture POS" home-screen app (start_url:/pos), separate from both the
// customer app and the KDS.
function posShell(html) {
  return html
    .replace(/<link rel="manifest" href="\/manifest\.webmanifest"\s*\/?>/,
             '<link rel="manifest" href="/pos.webmanifest" />')
    .replace(/<link rel="apple-touch-icon"[^>]*>/,
             '<link rel="apple-touch-icon" href="/icons/pos-icon-180.png?v=20260829" />')
    .replace(/<meta name="apple-mobile-web-app-title" content="[^"]*"\s*\/?>/,
             '<meta name="apple-mobile-web-app-title" content="Bean Culture POS" />')
    .replace(/<meta name="theme-color" content="[^"]*"\s*\/?>/,
             '<meta name="theme-color" content="#3d0e20" />');
}

app.get('*', async (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  const isKds = req.path === '/kds' || req.path === '/bump' || req.path.startsWith('/kds/');
  const isPos = req.path === '/pos' || req.path.startsWith('/pos/');
  let head = seoHead(req), body = '', title = '';
  try {
    if (isKds) {
      title = 'Bean Culture · Kitchen screen';
    } else if (isPos) {
      title = 'Bean Culture · POS';
    } else if (/^\/(item|menu)\//i.test(req.path)) {
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
  if (isKds) html = kdsShell(html);
  else if (isPos) html = posShell(html);
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
  purgeExcludedPresets();
  // Keep the weather cache warm whenever the temperature display or a weather
  // campaign is in use, so the customer chip / campaigns always have a fresh
  // reading without any request having to wait on the provider.
  weather.startWarmer(() => {
    const sc = getSettings().smartCampaigns || {};
    return sc.showTemperature === true || (Array.isArray(sc.weather) && sc.weather.some((c) => c && c.active !== false));
  });
  // Non-destructive Pay It Forward expiry sweep (status change only, rows
  // are never deleted) -- runs shortly after boot, then hourly.
  setTimeout(() => payItForward.sweepExpired().catch((e) => console.warn('[payItForward] expiry sweep failed:', e.message)), 20000);
  setInterval(() => payItForward.sweepExpired().catch((e) => console.warn('[payItForward] expiry sweep failed:', e.message)), 60 * 60 * 1000);
  // Prune the product builder against Square a few times a day: drop tiles whose
  // Square variation was deleted. It never auto-CREATES tiles — new variations
  // are pulled in only when the owner clicks "Sync new variations from Square"
  // in the admin (so deleted items never silently return). First run after boot.
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
    // IMPORTANT: this background job only PRUNES — it removes tiles whose Square
    // variation no longer exists and trims dead variation ids off combined
    // tiles. It must NEVER auto-create new tiles. Auto-adding here is what made
    // deleted items (the "extra teas") reappear after every deploy: the owner
    // deletes a tile, but the shared source item is still referenced by a
    // sibling tile, so the old code re-created a tile for the "uncovered"
    // variation on the next run. New variations are pulled in only when the
    // owner clicks "Sync new variations from Square" in the admin (which honours
    // the deleted-variations list). Predictable and owner-controlled.
    const reconciled = []; let removedDead = 0, trimmed = 0;
    for (const p of presets) {
      const cfg = configs[p.sourceItemId];
      if (!cfg) { reconciled.push(p); continue; }
      const alive = vids(p).filter((vid) => cfg.variations.some((v) => v.id === vid));
      if (!alive.length) { removedDead++; continue; }
      if (alive.length !== vids(p).length) trimmed++;
      reconciled.push({ ...p, variationId: alive[0], variationIds: alive.length > 1 ? alive : undefined });
    }
    if (!removedDead && !trimmed) return; // nothing structural changed
    const overrides = { ...(db.getOverrides() || {}), presets: reconciled };
    await db.saveOverrides(overrides);
    bustMenuCache();
    console.log(`[sync] presets pruned against Square — -${removedDead} removed, ${trimmed} trimmed (no auto-add)`);
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

// One-time cleanup: earlier the background sync would re-create tiles the owner
// had deleted (the "extra teas kept coming back" bug). Now that auto-add is gone,
// this removes any tile that is still sitting in the saved presets for a
// variation the owner explicitly deleted (recorded in builderExcludedVariationIds),
// so they don't have to delete it one more time. Purely subtractive and only
// touches variations the owner already chose to remove — never deletes anything
// that isn't already on the deleted list.
async function purgeExcludedPresets() {
  try {
    if (!db.enabled) return;
    const overrides = db.getOverrides() || {};
    const excluded = new Set(Array.isArray(overrides.builderExcludedVariationIds) ? overrides.builderExcludedVariationIds : []);
    if (!excluded.size || !Array.isArray(overrides.presets) || !overrides.presets.length) return;
    const vids = (p) => (Array.isArray(p.variationIds) && p.variationIds.length ? p.variationIds : [p.variationId].filter(Boolean));
    const before = overrides.presets.length;
    const kept = overrides.presets.filter((p) => !vids(p).some((v) => excluded.has(v)));
    if (kept.length === before) return; // nothing to purge
    await db.saveOverrides({ ...overrides, presets: kept });
    bustMenuCache();
    console.log(`[migrate] purged ${before - kept.length} previously-deleted tile(s) that had been re-created`);
  } catch (e) { console.error('[migrate] purge excluded presets failed:', e.message); }
}
