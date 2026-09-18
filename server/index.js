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
const customTables = require('./lib/customTables');
const COMP_COUPON_CODE = (process.env.COMP_COUPON_CODE || '').trim();
const sales = require('./lib/sales');
const db = require('./lib/db');
const cards = require('./lib/cards');
const giftcards = require('./lib/giftcards');
const scheduler = require('./lib/scheduled');
const notify = require('./lib/notify');
const payItForward = require('./lib/payItForward');
const kds = require('./lib/kds');
const terminal = require('./lib/terminal');
const waiterSplit = require('./lib/waiterSplit');
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
// The DEDICATED waiter reader for a store (table service). Kept separate from the
// counter POS terminal so the two never contend for one device. Falls back: this
// store's waiter reader → the global waiter reader → (last resort) the store's
// counter POS reader, so a single-terminal café can still take a card at the
// table before it buys a second unit.
function waiterTerminalFor(pos, locId) {
  const map = (pos && pos.waiterTerminalByLocation) || {};
  const perLoc = locId && map[locId];
  if (perLoc && perLoc.deviceId) return { deviceId: perLoc.deviceId, name: perLoc.name || 'Waiter Terminal' };
  if (pos.waiterTerminalDeviceId) return { deviceId: pos.waiterTerminalDeviceId, name: pos.waiterTerminalName || 'Waiter Terminal' };
  return posTerminalFor(pos, locId);
}
// A human-readable note stamped onto the Square PAYMENT so the transaction — and
// Square's own receipt — says what was paid for: the table, the item names when
// it's an item split, and the payer. e.g. "T77 · Fritters, Wine — Rob". Kept
// within Square's note length. This is what makes split payments legible in the
// Square Dashboard and lets a customer be given a meaningful receipt.
function waiterPayNote({ order, lineUids, who, label }) {
  const booth = (order && order.metadata && order.metadata.bc_booth) || (order && order.ticket_name) || '';
  const byUid = {};
  for (const li of ((order && order.line_items) || [])) if (li.uid) byUid[li.uid] = li.name || 'Item';
  const names = [...new Set((lineUids || []).map((u) => byUid[u]).filter(Boolean))];
  const parts = [];
  if (booth) parts.push('T' + booth);
  if (names.length) parts.push(names.join(', '));
  else if (label) parts.push(label);
  let s = parts.join(' · ') || 'Waiter';
  if (who) s += ' — ' + who;
  return s.slice(0, 480);
}
// A store's effective waiter settings: its own per-store override if set, else
// the global default. Keeps single-store setups working unchanged.
function effectiveWaiter(pos, locId) {
  pos = pos || {};
  const enPer = (pos.waiterEnabledByLocation || {})[locId];
  const pinPer = (pos.waiterPinByLocation || {})[locId];
  const tblPer = (pos.waiterTablesByLocation || {})[locId];
  const modePer = (pos.waiterPinModeByLocation || {})[locId];
  const staffPer = (pos.waiterStaffByLocation || {})[locId];
  const mode = (modePer === 'staff' || modePer === 'single') ? modePer : (pos.waiterPinMode === 'staff' ? 'staff' : 'single');
  const staff = Array.isArray(staffPer) ? staffPer : (Array.isArray(pos.waiterStaff) ? pos.waiterStaff : []);
  const suspPer = (pos.waiterSuspendedByLocation || {})[locId];
  const suspended = suspPer != null ? !!suspPer : (pos.waiterSuspended === true);
  return {
    enabled: enPer != null ? !!enPer : (pos.waiterEnabled === true),
    suspended,
    pin: (pinPer != null && pinPer !== '') ? String(pinPer) : String(pos.waiterPin || ''),
    tables: Array.isArray(tblPer) ? tblPer : (Array.isArray(pos.waiterTables) ? pos.waiterTables : []),
    mode,
    staff: staff.map((s) => ({ id: String(s.id || ''), name: String(s.name || ''), pin: String(s.pin || '') })).filter((s) => s.name && s.pin),
  };
}
// A store's enabled payment methods for the register/waiter (card/cash), from the
// per-store map with a sensible default of both on.
function paymentsFor(pos, locId) {
  const x = ((pos && pos.paymentsByLocation) || {})[locId];
  return { card: !x || x.card !== false, cash: !x || x.cash !== false, unpaid: !x || x.unpaid !== false };
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
    // Show customers the live "your order" tracker (bump-driven). Default on.
    orderTracker: settings.orderTracker !== false,
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

// Short-lived cache for the heavy analytics endpoints (each paginates Square
// SearchOrders across every store). Repeated dashboard/POS loads reuse the last
// result instead of re-hitting Square and tripping the rate limit (429).
const _analyticsCache = new Map();
function analyticsCache(key, ttlMs) { const h = _analyticsCache.get(key); return (h && Date.now() - h.at < ttlMs) ? h.data : null; }
function analyticsCacheSet(key, data) { if (_analyticsCache.size > 200) _analyticsCache.clear(); _analyticsCache.set(key, { at: Date.now(), data }); }
app.get('/api/menu', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const now = Date.now();
    // Resolve the requested store (falls back to the default/main location).
    const loc = locations.resolve(req.query.location).id;
    // The POS asks with ?pos=1 — that feed can include POS-only sections (and
    // their price overrides) that the app must never see, so it is cached under
    // a separate key from the app's menu for the same store.
    const isPos = req.query.pos === '1';
    const cacheKey = isPos ? `${loc}#pos` : loc;
    const hit = menuByLoc[cacheKey];
    if (hit && hit.data && now - hit.at < MENU_TTL_MS) return res.json(hit.data);
    let menu = await catalog.getMenu({ location: loc, pos: isPos });
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
    // Takeaway-only store → the per-product "cup / service" choice is not a
    // decision to make: hide it entirely and lock it to Takeaway. Driven purely
    // by this store's Order-types setting (admin/stores): when Dine-in is off and
    // Takeaway on, any cup/service modifier group (one that offers a Takeaway /
    // BYO / Keep Cup option) is DROPPED from the product, and its Takeaway option
    // is added to the item's locked modifiers so every order is still stamped
    // "Takeaway" without anyone choosing it. So a coffee is just Size + Coffee
    // Style; milk and extras stay optional. One rule, every product, applied to
    // both the app and the POS (shared feed).
    if (Array.isArray(menu.categories)) {
      const ful = locations.fulfilmentFor(locations.resolve(loc));
      if (ful.takeaway && !ful.dineIn) {
        const isServiceGroup = (mods) => (mods || []).some((m) => /take\s*away|byo|keep\s*cup/i.test(m.name || ''));
        const isTakeaway = (n) => /take\s*away/i.test(String(n || ''));
        const lockItem = (it) => {
          if (!Array.isArray(it.modifierGroups) || !it.modifierGroups.length) return it;
          let changed = false;
          const lockIds = [...(it.lockedModifierIds || [])];
          const lockNames = [...(it.lockedModifierNames || [])];
          const kept = [];
          for (const g of it.modifierGroups) {
            if (!isServiceGroup(g.modifiers)) { kept.push(g); continue; }
            // Drop this cup/service group; lock its Takeaway option so the order
            // still carries the takeaway cup (barista/receipt), no UI needed.
            const ta = (g.modifiers || []).find((m) => isTakeaway(m.name));
            if (ta && !lockIds.includes(ta.id)) { lockIds.push(ta.id); lockNames.push(ta.name); }
            changed = true;
          }
          return changed ? { ...it, modifierGroups: kept, lockedModifierIds: lockIds, lockedModifierNames: lockNames } : it;
        };
        menu = {
          ...menu,
          categories: menu.categories.map((c) => ({ ...c, items: (c.items || []).map(lockItem) })),
        };
      }
    }
    menuByLoc[cacheKey] = { data: menu, at: now };
    if (!isPos && loc === locations.resolve(null).id) menuCache = { data: menu, at: now }; // keep legacy field warm
    res.json(menu);
  } catch (err) {
    console.error('menu error', err.message);
    res.status(502).json({ error: 'Could not load menu', detail: err.message });
  }
});

// Live order status for the customer app — the KDS drives it, no SMS needed.
// 'new' (received) → 'preparing' → 'ready' (collect) → 'done' (bumped/collected).
// Public + cheap (one indexed lookup); returns 'new' for anything unknown.
app.get('/api/order-status', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const orderId = String(req.query.orderId || req.query.id || '').trim();
  if (!orderId) return res.status(400).json({ error: 'Missing orderId' });
  try {
    const states = await db.kdsGetStates([orderId]).catch(() => ({}));
    const zones = states[orderId] || {};
    const SYNTH = new Set(['__paid__', '__notified__']);   // internal markers, not kitchen state
    const entries = Object.entries(zones).filter(([z]) => !SYNTH.has(z));
    const st = entries.map(([, v]) => (v && v.status) || 'new');
    let status = 'new';
    if (st.length) {
      if (st.some((s) => s === 'ready')) status = 'ready';
      else if (st.every((s) => s === 'done')) status = 'done';
      else if (st.some((s) => s === 'preparing')) status = 'preparing';
    }
    // Custom "ready" message: a per-station override (kds.zones[].customerMessage)
    // wins over the café-wide default (orderReadyMessage); empty = the tracker's
    // built-in wording. When several stations are ready, the MOST RECENTLY bumped
    // one drives the text, so the customer sees the coffee message when coffee is
    // bumped, then the food message when the kitchen bumps.
    let message;
    if (status === 'ready') {
      const settings = getSettings();
      const zoneMsg = {};
      const collect = (arr) => { for (const z of (arr || [])) { const m = z && z.customerMessage && String(z.customerMessage).trim(); if (z && z.id && m) zoneMsg[z.id] = m; } };
      collect(settings.kds && settings.kds.zones);
      for (const loc of Object.values(settings.kdsByLocation || {})) collect(loc && loc.zones);
      const readyZones = entries
        .filter(([, v]) => v && v.status === 'ready')
        .sort((a, b) => new Date(b[1].bumpedAt || 0) - new Date(a[1].bumpedAt || 0));
      const topZoneId = readyZones.length ? readyZones[0][0] : null;
      message = (topZoneId && zoneMsg[topZoneId]) || (settings.orderReadyMessage && String(settings.orderReadyMessage).trim()) || undefined;
    }
    // When staff last hit "Notify" (and how many times) — lets the customer app
    // re-chime if they were re-notified after missing the first alert.
    const notif = zones['__notified__'] || null;
    const notifiedAt = notif && notif.bumpedAt ? notif.bumpedAt : undefined;
    const notifyCount = (notif && notif.notifyCount) || 0;
    res.json({ orderId, status, message, notifiedAt, notifyCount });
  } catch { res.json({ orderId, status: 'new' }); }
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
    const loy = await loyalty.getCustomerLoyalty(phone);
    // Tell this signed-in customer which private custom table(s) are theirs —
    // resolved server-side so the phone list is never exposed (see customTables).
    loy.customTables = customTables.forPhone(phone);
    res.json(loy);
  } catch (e) {
    res.json({ active: false, error: e.message });
  }
});

// ---- Loyalty points ledger (earned / redeemed) for the account popup ----
app.get('/api/loyalty/history', async (req, res) => {
  try {
    const phone = req.query.phone;
    if (!phone) return res.json({ balance: 0, events: [] });
    res.json(await loyalty.getCustomerHistory(phone));
  } catch (e) {
    res.json({ balance: 0, events: [], error: e.message });
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

// Build the customer signals a coupon's conditions need (first-visit history,
// birthday), but ONLY when the coupon actually has such a condition — a plain
// %/$ coupon pays for no extra Square lookups. Judged server-side so the client
// can't fake a first visit or birthday.
async function couponContextFor(customerId, couponObj) {
  const ctx = { now: new Date(), orderCount: null, birthday: null };
  if (!customerId || !coupons.needsCustomer(couponObj)) return ctx;
  const [hist, bd] = await Promise.all([
    couponObj.firstVisitOnly ? orders.getHistory(customerId, 5).catch(() => null) : Promise.resolve(null),
    couponObj.birthdayOnly ? customers.getBirthday(customerId).catch(() => '') : Promise.resolve(''),
  ]);
  if (Array.isArray(hist)) ctx.orderCount = hist.length;
  ctx.birthday = bd || null;
  return ctx;
}

// ---- Create an order (with optional loyalty redemption) ----
app.post('/api/orders', async (req, res) => {
  try {
    const { cart, dineIn, table, name, coupon, customerId, phone, pickupAt, note, loyalty: loy, pifVoucher, locationId, cardPayment, shipping: shipReq, src } = req.body || {};
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
    // Hold every app order back from the kitchen until its payment completes
    // (released in /api/pay). A comp/$0 order is released moments later by its
    // zero-payment, so the only orders left hidden are ones that never paid.
    const couponContext = await couponContextFor(effectiveCustomerId, coupon ? coupons.find(coupon) : null);
    // Birthday gift: on the customer's birthday (and only if they've bought before
    // and haven't used it this year) auto-apply a $ credit toward their order. It
    // is claimed for the year when the order is PAID (see /api/pay), so an
    // abandoned checkout never burns the gift. Skipped when a coupon/PIF is in play.
    let birthdayGift;
    if (!coupon && !pifVoucher && !freeOrder) {
      const bel = await birthdayEligibility(effectiveCustomerId).catch(() => ({ eligible: false }));
      if (bel.eligible && bel.valueCents > 0) birthdayGift = { cents: bel.valueCents, year: bel.year };
    }
    const order = await orders.createOrder({ cart, dineIn: !!dineIn, table, name, coupon, couponContext, customerId: effectiveCustomerId, pickupAt, note, pifVoucher, squareLocationId, cardPayment: cardPayment !== false, free: freeOrder, freeCategories, shipping, eventId, appLocationId: evLoc ? evLoc.id : undefined, src, birthdayGift, holdForPayment: true });

    // Loyalty free coffees: redeem `quantity` of them (default 1). Each reward
    // frees one eligible drink and burns one tier's worth of points (Square). We
    // create them one at a time and re-read the order after each: while the total
    // keeps dropping we keep going; the moment a reward discounts nothing (no
    // eligible item left) we delete THAT reward (returning its points) and stop.
    // So a customer is only ever charged points for coffees actually made free.
    let rewardApplied = 0;   // how many free coffees actually came off
    let rewardRequested = 0;
    let rewardError;
    let rewardFresh;         // latest re-read order (reused for the response)
    if (loy && loy.accountId && loy.tierId) {
      rewardRequested = Math.max(1, Math.min(20, parseInt(loy.quantity, 10) || 1));
      let cur = order;
      for (let i = 0; i < rewardRequested; i++) {
        const beforeAmt = (cur.total_money && cur.total_money.amount) || 0;
        if (beforeAmt <= 0) break;   // whole order already free — nothing left to discount
        let reward;
        try {
          reward = await loyalty.createReward({ loyaltyAccountId: loy.accountId, rewardTierId: loy.tierId, orderId: order.id });
        } catch (e) { console.error('loyalty reward failed', e.message); if (rewardApplied === 0) rewardError = 'create_failed'; break; }
        let check;
        try { check = await orders.getOrder(order.id); }
        catch (e) { console.error('loyalty reward verify failed', e.message); if (reward && reward.id) await loyalty.deleteReward(reward.id); if (rewardApplied === 0) rewardError = 'create_failed'; break; }
        const afterAmt = (check.total_money && check.total_money.amount) || 0;
        if (afterAmt < beforeAmt) { rewardApplied += 1; cur = check; rewardFresh = check; }
        else { if (reward && reward.id) await loyalty.deleteReward(reward.id); if (rewardApplied === 0) rewardError = 'no_discount'; break; }
      }
      // Tag the order so order history can badge it "Free coffee ×N" (best-effort).
      if (rewardApplied > 0) {
        try { rewardFresh = await orders.stampMeta(order.id, { bc_loyfree: String(rewardApplied) }); } catch (e) { console.warn('loyfree tag failed', e.message); }
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

    const fresh = rewardApplied > 0 ? (rewardFresh || await orders.getOrder(order.id)) : order;
    res.json({
      orderId: fresh.id,
      totalMoney: fresh.total_money,
      version: fresh.version,
      ticketName: fresh.ticket_name,
      rewardApplied,          // how many free coffees actually came off (0 = none)
      rewardRequested,        // how many the customer asked to redeem
      rewardError: rewardError || undefined,
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

    // Mark an order paid to the kitchen screen: our own DB marker is the
    // reliable release signal (Square's tender/metadata can lag), and the Square
    // metadata release is a secondary. Best-effort — never fail the payment on it.
    const release = async () => {
      await db.kdsMarkPaid(orderId).catch(() => {});
      await orders.releaseHold(orderId).catch(() => {});
      // Birthday gift: now that the order is actually PAID, mark the gift claimed
      // for the year (so it can't be used again). Held/abandoned orders never
      // reach here, so an unfinished checkout doesn't burn the gift.
      try {
        const o = await orders.getOrder(orderId);
        const yr = o && o.metadata && o.metadata.bc_bday;
        const cid = o && o.customer_id;
        if (yr && cid) await db.birthdayClaim(cid, Number(yr)).catch(() => {});
      } catch {}
    };

    // $0 order (comp or fully covered by loyalty): complete without a card.
    if (!totalMoney || totalMoney.amount === 0) {
      const fresh = await orders.getOrder(orderId);
      await orders.payZeroOrder(orderId, fresh.version);
      await release(); // now paid → let the kitchen see it
      return res.json({ status: 'COMPLETED', comped: true });
    }

    // Pay from the customer's prepaid gift-card balance.
    if (payWith === 'balance') {
      const gc = await giftcards.getBalance(customerId);
      if (!gc || !gc.gan) return res.status(402).json({ error: 'No balance available' });
      if (gc.balance < totalMoney.amount) return res.status(402).json({ error: 'Not enough balance — top up or pay by card.' });
      const payment = await giftcards.payWithGiftCard({ gan: gc.gan, orderId, amountMoney: totalMoney, customerId });
      if (payment.status === 'COMPLETED' || payment.status === 'APPROVED') {
        await release();
        // Award loyalty points for this paid order (best-effort, never blocks pay).
        loyalty.accumulateForOrder({ customerId, orderId, locationId: squareLocationId }).catch(() => {});
      }
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
    // Only a completed/approved charge releases the order to the kitchen. A
    // declined charge leaves it held (hidden), so nothing unpaid gets cooked.
    if (payment.status === 'COMPLETED' || payment.status === 'APPROVED') {
      await release();
      // Award loyalty points for this paid order. Square does NOT auto-accrue for
      // custom (Orders+Payments API) checkouts — we must call accumulate. Best-
      // effort + idempotent per order, and never blocks the payment response.
      loyalty.accumulateForOrder({ customerId, orderId, locationId: squareLocationId }).catch(() => {});
    }
    res.json({ status: payment.status, paymentId: payment.id, receiptUrl: payment.receipt_url });
  } catch (err) {
    console.error('payment error', err.message);
    res.status(402).json({ error: 'Payment failed', detail: err.message });
  }
});

// Cancel an app order whose payment failed or was abandoned, so it can never
// reach the kitchen. Called by the app the moment checkout fails or the customer
// backs out. Safe by design: it only cancels an order still stamped bc_hold='1'
// (an app order awaiting payment) that carries no payment — it can't touch a paid
// or counter order. This is the reliable guard against a declined/abandoned
// checkout being cooked, on top of the KDS hold-hide and the periodic sweep.
app.post('/api/orders/:id/cancel', async (req, res) => {
  try {
    const orderId = req.params.id;
    if (!orderId) return res.status(400).json({ error: 'Missing order id' });
    const cur = await orders.getOrder(orderId).catch(() => null);
    if (!cur) return res.json({ ok: true, already: true });
    const md = cur.metadata || {};
    if (md.bc_hold !== '1') return res.json({ ok: false, reason: 'not_held' }); // never cancel a real/paid order
    if (Array.isArray(cur.tenders) && cur.tenders.length) return res.json({ ok: false, reason: 'paid' });
    const paid = await db.kdsGetPaid([orderId]).catch(() => new Set());
    if (paid.has(orderId)) return res.json({ ok: false, reason: 'paid' });
    await orders.cancelOrder(orderId);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
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

// ---- Admin: settings backups (automatic versioned snapshots) ----
// Every save snapshots the previous settings; these let the admin see recent
// versions and roll back if a save wiped something (e.g. a Product Builder section).
app.get('/api/admin/settings/backups', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    res.json({ backups: await db.listSettingsBackups(40) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/settings/restore', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const id = (req.body || {}).id;
    if (!id) return res.status(400).json({ error: 'Missing backup id' });
    const restored = await db.restoreSettingsBackup(id);
    bustMenuCache();
    res.json({ ok: true, settings: restored });
  } catch (e) { res.status(400).json({ error: e.message }); }
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
          // sourceId = the underlying Square item id (for preset tiles). Lets the
          // admin reflect/clear a sold-out flag saved under either id space.
          products.push({ id: it.id, name: it.name || 'Item', category: sec.category || '', sourceId: it.presetSourceItemId || null });
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
    // Idle seconds before a combined POS+KDS device flips the register back to
    // the kitchen screen — but only when there are orders waiting (0 = never).
    kdsIdleSec: Number(p.kdsIdleSec) >= 0 ? Number(p.kdsIdleSec) : 60,
    staff: 'Staff',
    logoUrl: s.logoUrl || '',
    storeName: s.storeName || 'Bean Culture',
    locations: locations.publicList(),
    surcharges: surcharges.publicConfig(),
    terminalDeviceId: p.terminalDeviceId || '',
    terminalName: p.terminalName || '',
    terminalByLocation: p.terminalByLocation || {},
    hasManagerPin: !!p.managerPin,   // refunds require a manager PIN; is one set?
    paymentsByLocation: p.paymentsByLocation || {}, // per-store {card,cash,unpaid}
    terminalShowCart: p.terminalShowCart === true,  // show the confirm/itemised screen on the Terminal
    terminalSkipReceipt: p.terminalSkipReceipt !== false, // skip the post-payment receipt screen (default on)
    // "Dine in" keyword trigger — words that flip a counter order to DINE IN.
    dineInKeywords: Array.isArray(p.dineInKeywords) ? p.dineInKeywords : [],
    // Waiter mode (portable table-service register) — for the admin settings UI.
    // Global defaults + per-store overrides so each store can be configured on its
    // own. PINs are sent as booleans (has-a-pin), never the codes themselves.
    waiterEnabled: p.waiterEnabled === true,
    hasWaiterPin: !!p.waiterPin,
    waiterPin: p.waiterPin || '',                 // single-mode PIN, shown to the owner
    waiterPinByLoc: p.waiterPinByLocation || {},  // per-store single-mode PINs (owner-visible)
    waiterTables: Array.isArray(p.waiterTables) ? p.waiterTables : [],
    waiterTerminalDeviceId: p.waiterTerminalDeviceId || '',
    waiterTerminalName: p.waiterTerminalName || '',
    waiterTerminalByLocation: p.waiterTerminalByLocation || {},
    waiterEnabledByLocation: p.waiterEnabledByLocation || {},
    waiterTablesByLocation: p.waiterTablesByLocation || {},
    // PIN mode + staff roster. Roster PINs are NEVER sent back — only names — so
    // staff who open settings can't read each other's codes.
    waiterPinMode: p.waiterPinMode === 'staff' ? 'staff' : 'single',
    waiterPinModeByLocation: p.waiterPinModeByLocation || {},
    waiterStaff: (Array.isArray(p.waiterStaff) ? p.waiterStaff : []).map((s) => ({ id: s.id, name: s.name })),
    waiterStaffByLocation: Object.fromEntries(Object.entries(p.waiterStaffByLocation || {}).map(([k, arr]) => [k, (Array.isArray(arr) ? arr : []).map((s) => ({ id: s.id, name: s.name }))])),
    waiterSuspended: p.waiterSuspended === true,
    waiterSuspendedByLocation: p.waiterSuspendedByLocation || {},
    dbEnabled: db.enabled,
  });
});

// Terminal options: show/hide the customer-facing itemised confirm screen.
app.post('/api/pos/terminal-options', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (!db.enabled) return res.status(400).json({ error: 'A database is required to save this.' });
  try {
    const ov = db.getOverrides() || {};
    ov.pos = ov.pos || {};
    const b = req.body || {};
    if (b.showItemizedCart !== undefined) ov.pos.terminalShowCart = b.showItemizedCart === true;
    // skipReceipt: only change it when the client sends it, so the two toggles are independent.
    if (b.skipReceipt !== undefined) ov.pos.terminalSkipReceipt = b.skipReceipt === true;
    // Dine-in keyword trigger: accept an array, or a comma/newline-separated
    // string, and store a clean de-duplicated, lower-cased list (max 40).
    if (b.dineInKeywords !== undefined) {
      const raw = Array.isArray(b.dineInKeywords) ? b.dineInKeywords : String(b.dineInKeywords || '').split(/[\n,]/);
      const seen = new Set();
      const list = [];
      for (const k of raw) {
        const v = String(k || '').trim().toLowerCase().slice(0, 40);
        if (v && !seen.has(v)) { seen.add(v); list.push(v); }
        if (list.length >= 40) break;
      }
      ov.pos.dineInKeywords = list;
    }
    await db.saveOverrides(ov);
    res.json({ ok: true, terminalShowCart: ov.pos.terminalShowCart, terminalSkipReceipt: ov.pos.terminalSkipReceipt !== false, dineInKeywords: ov.pos.dineInKeywords });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ---- Customer display: a second screen mirrors the POS's live order ----
// The POS pushes its current cart here (keyed by a station code the display page
// also uses); the display polls the state. In-memory + short-lived — it's a live
// mirror, so there's nothing to persist.
const posDisplays = new Map(); // station -> { at, data }
app.post('/api/pos/display/push', (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  const { station, cart, total, name, dineIn, table, status } = req.body || {};
  const key = String(station || 'main').slice(0, 60);
  posDisplays.set(key, { at: Date.now(), data: {
    cart: Array.isArray(cart) ? cart.slice(0, 100).map((c) => ({
      name: String(c.name || 'Item').slice(0, 120),
      variation: c.variation ? String(c.variation).slice(0, 80) : '',
      options: Array.isArray(c.options) ? c.options.slice(0, 12).map((o) => String(o).slice(0, 60)) : [],
      quantity: Number(c.quantity) || 1,
      amount: Number(c.amount) || 0,
    })) : [],
    total: Number(total) || 0,
    name: name ? String(name).slice(0, 60) : '',
    dineIn: !!dineIn,
    table: table ? String(table).slice(0, 40) : '',
    status: ['building', 'paid', 'idle'].includes(status) ? status : 'building',
    change: Number(req.body && req.body.change) || 0,
  } });
  if (posDisplays.size > 50) { const cutoff = Date.now() - 3600000; for (const [k, v] of posDisplays) if (v.at < cutoff) posDisplays.delete(k); }
  res.json({ ok: true });
});
app.get('/api/pos/display/state', (req, res) => {
  const key = String(req.query.station || 'main').slice(0, 60);
  const hit = posDisplays.get(key);
  const s = getSettings();
  // Which STORE this display belongs to: an explicit ?loc, else the station code
  // when it is itself a real location id (an admin/POS CDS link uses the location
  // id as the station). This lets each site show its own name and its own ads.
  let loc = String(req.query.loc || '').slice(0, 80);
  let locIds = [];
  try { locIds = locations.publicList().map((l) => l.id); } catch {}
  if (!loc && locIds.includes(key)) loc = key;
  const store = loc ? locations.resolve(loc) : null;
  const storeName = (store && store.name) || s.storeName || 'Bean Culture';
  const logo = (s.theme && (s.theme.logo || s.theme.logoUrl)) || (s.contact && s.contact.logo) || '';
  const fresh = hit && (Date.now() - hit.at < 90000);
  // CDS idle look + adverts: any hero/banner slide flagged `cds` becomes an idle
  // advert. Sent every poll so the display picks up changes without a reload.
  // A banner shows on THIS store's CDS when it targets all stores (no locations
  // set) or explicitly includes this location — the same per-site tick the banner
  // already uses on the storefront.
  const cdsCfg = s.cds || {};
  const showsHere = (h) => !Array.isArray(h.locations) || h.locations.length === 0 || (loc && h.locations.includes(loc));
  const toAd = (h) => ({ image: h.image || '', bg: h.bg || '', title: h.title || '', subtitle: h.subtitle || '', textColor: h.textColor || '#ffffff', fit: h.fit || 'cover' });
  // Two sources, in order: the dedicated CDS-only banners (Admin → Marketing →
  // Customer Display), then any storefront hero banner the admin also ticked
  // "Show on Customer Display" (legacy/shared). Both honour per-store targeting.
  const cdsOnly = (Array.isArray(s.cdsBanners) ? s.cdsBanners : []).filter((h) => h && showsHere(h)).map(toAd);
  const heroFlagged = (Array.isArray(s.hero) ? s.hero : []).filter((h) => h && h.cds && showsHere(h)).map(toAd);
  const ads = [...cdsOnly, ...heroFlagged];
  const cds = {
    welcomeTitle: cdsCfg.welcomeTitle || 'Welcome',
    welcomeSub: cdsCfg.welcomeSub || '',
    logo: cdsCfg.logo || logo || '',
    adIntervalSec: Number(cdsCfg.adIntervalSec) > 0 ? Number(cdsCfg.adIntervalSec) : 6,
    ratio: s.heroRatio || '3 / 2',
    ads,
  };
  res.json({ storeName, logo, currency: sq.CURRENCY, cds, ...(fresh ? hit.data : { cart: [], total: 0, name: '', status: 'idle', change: 0 }) });
});

// Enable/disable the payment methods a store's POS offers (Card / Cash / Unpaid).
app.post('/api/pos/payments', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (!db.enabled) return res.status(400).json({ error: 'A database is required to save payment methods.' });
  try {
    const { locationId, payments } = req.body || {};
    if (!locationId) return res.status(400).json({ error: 'Missing store.' });
    const p = payments || {};
    const clean = { card: p.card !== false, cash: p.cash !== false, unpaid: p.unpaid !== false };
    if (!clean.card && !clean.cash && !clean.unpaid) return res.status(400).json({ error: 'At least one payment method must stay on.' });
    const ov = db.getOverrides() || {};
    ov.pos = ov.pos || {};
    ov.pos.paymentsByLocation = { ...(ov.pos.paymentsByLocation || {}), [locationId]: clean };
    await db.saveOverrides(ov);
    res.json({ ok: true, payments: clean });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Today's orders for the store, for the cash-up panel: tender, amount, refund,
// items and (for unpaid/comp) the reason. The client tallies Card/Cash/Unpaid,
// filters, and drills into an order.
app.get('/api/pos/day', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const tz = (getSettings().contact && getSettings().contact.timezone) || 'Australia/Sydney';
    // Which local day to tally. ?date=YYYY-MM-DD picks a past day (cash-up "yesterday");
    // default is today. Validated to a plain date so it can't inject anything.
    const reqDate = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? req.query.date : null;
    const today = reqDate || dayInTz(new Date().toISOString(), tz);
    const cacheKey = `day|${req.query.location || ''}|${today}`;
    const cached = analyticsCache(cacheKey, 30_000);
    if (cached) return res.json(cached);
    const squareLocationId = locations.squareIdFor(req.query.location);
    // Query a generous UTC window around noon of the chosen local day (covers the
    // whole local day incl. DST for AU timezones), then filter precisely by tz-day.
    const base = Date.parse(`${today}T12:00:00Z`);
    const startAt = new Date(base - 24 * 3600 * 1000).toISOString();
    const endAt = new Date(base + 24 * 3600 * 1000).toISOString();
    const data = await sq.squareFetch('/v2/orders/search', {
      method: 'POST',
      body: {
        location_ids: [squareLocationId],
        query: {
          filter: { date_time_filter: { created_at: { start_at: startAt, end_at: endAt } }, state_filter: { states: ['COMPLETED', 'OPEN'] } },
          sort: { sort_field: 'CREATED_AT', sort_order: 'DESC' },
        },
        limit: 500,
      },
    });
    const orders = [];
    for (const o of (data.orders || [])) {
      if (o.state === 'CANCELED') continue;
      if (dayInTz(o.created_at, tz) !== today) continue;   // only the chosen local day
      const md = o.metadata || {};
      // Skip app orders still HELD for payment that were never paid (declined /
      // abandoned card checkouts): they aren't real sales, so they must not show
      // as phantom "unpaid" takings. A paid one has a tender (bc_hold flips to '0').
      if (md.bc_hold === '1' && !((o.tenders || []).length)) continue;
      const total = (o.total_money && o.total_money.amount) || 0;
      const refunded = (o.refunds || []).filter((r) => (r.status || '').toUpperCase() !== 'REJECTED').reduce((s, r) => s + ((r.amount_money && r.amount_money.amount) || 0), 0);
      const tenders = o.tenders || [];
      // Classify: an OPEN order with no tender is an unpaid "send to kitchen".
      let tender = 'unpaid';
      if (tenders.length) {
        const t0 = (tenders[0].type || '').toUpperCase();
        tender = t0 === 'CASH' ? 'cash' : (t0 === 'CARD' || t0 === 'SQUARE_GIFT_CARD' || t0 === 'WALLET') ? 'card' : 'card';
      }
      const paymentId = (tenders.find((t) => t.payment_id) || {}).payment_id || (o.payment_ids && o.payment_ids[0]) || null;
      orders.push({
        orderId: o.id, createdAt: o.created_at,
        tender, total, refunded, paymentId,
        source: (o.source && o.source.name) || 'Square',
        name: md.bc_name || o.ticket_name || '',
        reason: md.bc_reason || '',
        free: total === 0 || md.bc_free === 'event',
        items: (o.line_items || []).map((li) => ({ name: li.name || 'Item', variation: li.variation_name || '', quantity: li.quantity || '1', amount: (li.total_money && li.total_money.amount) || 0 })),
      });
    }
    const tot = { card: { n: 0, v: 0 }, cash: { n: 0, v: 0 }, unpaid: { n: 0, v: 0 }, refunds: 0 };
    for (const o of orders) { tot[o.tender].n += 1; tot[o.tender].v += o.total; tot.refunds += o.refunded; }
    const payload = { date: today, currency: sq.CURRENCY, orders, totals: tot };
    analyticsCacheSet(cacheKey, payload);
    res.json(payload);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// Set or change the manager PIN that gates refunds. First-time set is open (an
// unconfigured till during setup); changing an existing PIN requires the current
// one, so a staff member with only the POS passcode can't quietly reset it.
app.post('/api/pos/manager-pin', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (!db.enabled) return res.status(400).json({ error: 'A database is required to set the manager PIN.' });
  try {
    const { pin, currentPin } = req.body || {};
    const next = String(pin || '').trim();
    if (!/^\d{4,8}$/.test(next)) return res.status(400).json({ error: 'PIN must be 4–8 digits.' });
    const existing = (getSettings().pos || {}).managerPin || '';
    if (existing && String(currentPin || '').trim() !== existing) return res.status(403).json({ error: 'Current manager PIN is incorrect.' });
    const ov = db.getOverrides() || {};
    ov.pos = ov.pos || {};
    ov.pos.managerPin = next;
    await db.saveOverrides(ov);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Recent paid orders for this store, for the refund picker — items, totals, how
// much is still refundable, and the payment id each refund goes against.
app.get('/api/pos/recent-orders', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const squareLocationId = locations.squareIdFor(req.query.location);
    const startAt = new Date(Date.now() - 3 * 86400000).toISOString();
    const data = await sq.squareFetch('/v2/orders/search', {
      method: 'POST',
      body: {
        location_ids: [squareLocationId],
        query: {
          filter: { date_time_filter: { created_at: { start_at: startAt } }, state_filter: { states: ['COMPLETED', 'OPEN'] } },
          sort: { sort_field: 'CREATED_AT', sort_order: 'DESC' },
        },
        limit: 40,
      },
    });
    const out = [];
    for (const o of (data.orders || [])) {
      const tenders = o.tenders || [];
      if (!tenders.length) continue;   // nothing captured → nothing to refund
      const total = (o.total_money && o.total_money.amount) || 0;
      const refunded = (o.refunds || []).filter((r) => (r.status || '').toUpperCase() !== 'REJECTED').reduce((s, r) => s + ((r.amount_money && r.amount_money.amount) || 0), 0);
      if (total - refunded <= 0) continue;
      out.push({
        orderId: o.id,
        createdAt: o.created_at,
        source: (o.source && o.source.name) || 'Square',
        total, refunded, currency: (o.total_money && o.total_money.currency) || sq.CURRENCY,
        paymentId: tenders[0].payment_id || tenders[0].id || '',
        tender: (tenders[0].type || '').toLowerCase(),
        name: (o.metadata && o.metadata.bc_name) || o.ticket_name || '',
        items: (o.line_items || []).map((li) => ({
          name: li.name || 'Item',
          variation: li.variation_name || '',
          quantity: li.quantity || '1',
          amount: (li.total_money && li.total_money.amount) || 0,
        })),
      });
    }
    res.json({ orders: out, currency: sq.CURRENCY });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// Issue a refund against a payment (partial or full). Square refunds by AMOUNT,
// so an item-level refund is just the sum of the chosen lines. Manager-PIN gated.
app.post('/api/pos/refund', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { paymentId, amount, reason, managerPin } = req.body || {};
    const pin = (getSettings().pos || {}).managerPin || '';
    if (!pin) return res.status(400).json({ error: 'Set a manager PIN in POS Settings before issuing refunds.' });
    if (String(managerPin || '').trim() !== pin) return res.status(403).json({ error: 'Incorrect manager PIN.' });
    const amt = Math.round(Number(amount) || 0);
    if (!paymentId) return res.status(400).json({ error: 'Missing payment reference.' });
    if (!(amt > 0)) return res.status(400).json({ error: 'Refund amount must be greater than zero.' });
    const refund = await sq.squareFetch('/v2/refunds', {
      method: 'POST',
      body: {
        idempotency_key: require('crypto').randomUUID(),
        payment_id: paymentId,
        amount_money: { amount: amt, currency: sq.CURRENCY },
        reason: String(reason || 'POS refund').slice(0, 192),
      },
    });
    res.json({ ok: true, refund: refund.refund || refund });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/pos/order', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { cart, dineIn, table, name, tender, cashGiven, locationId, reason } = req.body || {};
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
      posOverrideLocation: locationId || (posEvLoc && posEvLoc.id) || undefined, // apply POS-only price overrides
      reason: (tender === 'unpaid' || locations.isFree(locationId)) ? reason : undefined,
      // Card orders are held OFF the kitchen screen until the Terminal payment
      // completes — so a cancelled/declined card checkout never reaches the
      // kitchen (same as app orders). Cash/unpaid are intentional sends and show
      // straight away. Released in reconcileCheckout when the payment succeeds.
      holdForPayment: tender === 'card',
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
          showItemizedCart: pos.terminalShowCart === true,
          skipReceipt: pos.terminalSkipReceipt !== false, // default: skip the receipt screen
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
      // Payment went through → release the KDS hold so the ticket appears now
      // (the order was held off-screen while the card was being taken).
      await db.kdsMarkPaid(orderId).catch(() => {});
      await orders.releaseHold(orderId).catch(() => {});
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

// Print (or reprint) a receipt for a completed payment on the Terminal's printer.
app.post('/api/pos/print-receipt', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { paymentId, location, duplicate } = req.body || {};
    if (!paymentId) return res.status(400).json({ error: 'No payment to print (card sales only).' });
    const pos = getSettings().pos || {};
    const posTerminal = posTerminalFor(pos, location);
    if (!posTerminal.deviceId) return res.status(400).json({ error: 'No Square Terminal paired at this store.' });
    const action = await terminal.printReceipt({ deviceId: posTerminal.deviceId, paymentId, duplicate: duplicate === true });
    res.json({ ok: true, actionId: action.id || null, status: action.status || 'PENDING' });
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
    // Pair the reader to this POS location's Square location so its checkouts
    // match the order location (otherwise → INVALID_LOCATION on every payment).
    const squareLocationId = locations.squareIdFor(req.body && req.body.locationId);
    const dc = await terminal.createDeviceCode((req.body && req.body.name) || (getSettings().pos || {}).deviceName, squareLocationId);
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
    const pos = getSettings().pos || {};
    // Readers the owner has removed stay hidden from the list (Square has no API
    // to delete a device, so we hide it our side — incl. old/offline ones).
    const hidden = new Set(Array.isArray(pos.hiddenDevices) ? pos.hiddenDevices : []);
    const all = await terminal.listDevices();
    const devices = all.filter((d) => !hidden.has(d.id));
    const current = pos.terminalDeviceId || '';
    console.log('[terminal] devices', JSON.stringify({ current, hidden: [...hidden], devices: devices.map((d) => ({ id: d.id, name: d.name, status: d.status })) }));
    res.json({ devices, current });
  } catch (e) { res.status(502).json({ error: e.message }); }
});
// Permanently hide a reader from this app (Square can't delete devices via API).
// Also clears it from any store's selection so the POS stops using it.
app.post('/api/pos/terminal/remove', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (!db.enabled) return res.status(400).json({ error: 'A database is required to remove a reader.' });
  try {
    const { deviceId } = req.body || {};
    if (!deviceId) return res.status(400).json({ error: 'Missing device id' });
    const ov = db.getOverrides() || {};
    ov.pos = ov.pos || {};
    const hidden = new Set(Array.isArray(ov.pos.hiddenDevices) ? ov.pos.hiddenDevices : []);
    hidden.add(String(deviceId));
    ov.pos.hiddenDevices = [...hidden];
    // Drop it from the default selection and any per-store selection.
    if (ov.pos.terminalDeviceId === deviceId) { ov.pos.terminalDeviceId = ''; ov.pos.terminalName = ''; }
    if (ov.pos.terminalByLocation) {
      const m = { ...ov.pos.terminalByLocation };
      for (const k of Object.keys(m)) if (m[k] && m[k].deviceId === deviceId) delete m[k];
      ov.pos.terminalByLocation = m;
    }
    await db.saveOverrides(ov);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
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
    // Selecting a reader un-hides it (it's clearly wanted again).
    if (Array.isArray(ov.pos.hiddenDevices) && ov.pos.hiddenDevices.includes(String(deviceId))) {
      ov.pos.hiddenDevices = ov.pos.hiddenDevices.filter((x) => x !== String(deviceId));
    }
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

// ─────────────────────────────────────────────────────────────────────────────
// Waiter mode (/waiter) — a portable table-service register. Unlike the counter
// POS (which is gated by the full admin password), waiter mode is gated by its
// own short PIN so a roaming phone never has to hold the admin password. A waiter
// opens a tab on a table, adds items (which go straight to the kitchen), then
// settles by card on the dedicated waiter Terminal, by cash, or leaves the tab
// open to settle later. All money moves are server-mediated via Square.
// ─────────────────────────────────────────────────────────────────────────────

// Validate the waiter PIN sent with a request. Returns the pos settings when OK,
// or null. Reads the PIN from body or query so both GET and POST calls work.
// Resolve a waiter request. Returns { pos, locationId } on success (locationId is
// the store the PIN belongs to — a per-store PIN selects its store at login), or
// null. The counter POS (admin) bypasses the PIN and can manage any store.
function waiterAuthEx(req) {
  const pos = getSettings().pos || {};
  if (adminOk(req)) return { pos, locationId: req.query.location || (req.body && req.body.locationId) || '' };
  const given = String((req.body && req.body.pin) || req.query.pin || '').trim();
  if (!given) return null;
  // Does this PIN unlock a given store? In single mode it must equal the store's
  // PIN; in staff mode it must equal one roster member's PIN (and we learn who).
  const tryStore = (lid) => {
    const e = effectiveWaiter(pos, lid);
    if (!e.enabled || e.suspended) return null;   // suspended = emergency lock-out
    if (e.mode === 'staff') {
      const m = e.staff.find((s) => s.pin === given);
      return m ? { pos, locationId: lid, staffName: m.name, mode: 'staff' } : null;
    }
    return (e.pin && given === e.pin) ? { pos, locationId: lid, mode: 'single' } : null;
  };
  const reqLoc = req.query.location || (req.body && req.body.locationId) || '';
  if (reqLoc) return tryStore(reqLoc);
  // Fresh login (no store yet): try each store, then the global default. The PIN
  // selects its store.
  let ids = [];
  try { ids = locations.publicList().map((l) => l.id); } catch {}
  for (const lid of [...ids, '']) { const r = tryStore(lid); if (r) return r; }
  return null;
}
function waiterAuth(req) { const r = waiterAuthEx(req); return r ? r.pos : null; }

// What a waiter device needs to run: store list, preset tables, whether a card
// reader is available, currency and logo. Never leaks the admin password or the
// PIN back.
app.get('/api/waiter/config', (req, res) => {
  const auth = waiterAuthEx(req);
  if (!auth) return res.status(401).json({ error: 'Wrong PIN, or waiter mode is off.' });
  const pos = auth.pos;
  const s = getSettings();
  // The store the PIN resolved to (per-store PIN selects the store at login).
  const locId = auth.locationId || req.query.location || '';
  const term = waiterTerminalFor(pos, locId);
  const eff = effectiveWaiter(pos, locId);
  const pay = paymentsFor(pos, locId);
  res.json({
    storeName: s.storeName || 'Bean Culture',
    logo: (s.theme && (s.theme.logo || s.theme.logoUrl)) || (s.contact && s.contact.logo) || s.logoUrl || '',
    currency: sq.CURRENCY,
    locations: locations.publicList(),
    location: locId,                       // the app should lock onto this store
    tables: eff.tables,
    payments: { card: pay.card, cash: pay.cash },  // per-store cash/card availability
    hasTerminal: !!term.deviceId,
    terminalName: term.name || 'Terminal',
    pinMode: eff.mode,                     // 'single' | 'staff'
    // In staff mode the PIN identifies the waiter, so the app skips the name prompt.
    waiterName: (auth.mode === 'staff' && auth.staffName) ? auth.staffName : '',
  });
});

// In single-PIN mode a waiter types their own name. To avoid two "Tim"s on a
// shift, the app claims its name here: the server returns a de-duplicated name
// (Tim, Tim2, Tim3…). Held in memory per store, keyed by a per-device id so the
// same device can re-claim its own name without bumping the number. Entries lapse
// after 12h of inactivity.
const waiterNames = new Map(); // locId -> Map(nameLower -> { cid, name, at })
function claimWaiterName(locId, wanted, cid) {
  const now = Date.now(), TTL = 12 * 3600 * 1000;
  let reg = waiterNames.get(locId); if (!reg) { reg = new Map(); waiterNames.set(locId, reg); }
  for (const [k, v] of reg) if (now - v.at > TTL) reg.delete(k);
  const base = String(wanted || '').trim().slice(0, 40) || 'Waiter';
  // If this device already holds a name, release its old claim first.
  for (const [k, v] of reg) if (v.cid === cid) reg.delete(k);
  let name = base, n = 1;
  while (true) {
    const held = reg.get(name.toLowerCase());
    if (!held || held.cid === cid) break;   // free, or ours
    n += 1; name = `${base}${n}`;
  }
  reg.set(name.toLowerCase(), { cid, name, at: now });
  return name;
}
app.post('/api/waiter/claim-name', (req, res) => {
  const auth = waiterAuthEx(req);
  if (!auth) return res.status(401).json({ error: 'Wrong PIN, or waiter mode is off.' });
  const cid = String((req.body && req.body.cid) || '').slice(0, 64) || 'anon';
  const name = claimWaiterName(auth.locationId || '', (req.body && req.body.name) || '', cid);
  res.json({ name });
});

// Open tabs for a store: every OPEN Square order this app tagged as a waiter tab.
// Square has no metadata filter on SearchOrders, so we pull recent OPEN orders
// and keep the ones marked bc_waiter (same pattern as the held-order sweep).
app.get('/api/waiter/tabs', async (req, res) => {
  const pos = waiterAuth(req);
  if (!pos) return res.status(401).json({ error: 'Wrong PIN, or waiter mode is off.' });
  try {
    const squareLocationId = locations.squareIdFor(req.query.location);
    const startAt = new Date(Date.now() - 24 * 3600000).toISOString();
    const data = await sq.squareFetch('/v2/orders/search', {
      method: 'POST',
      body: {
        location_ids: [squareLocationId],
        query: {
          filter: { date_time_filter: { created_at: { start_at: startAt } }, state_filter: { states: ['OPEN'] } },
          sort: { sort_field: 'CREATED_AT', sort_order: 'DESC' },
        },
        limit: 100,
      },
    });
    const tabs = [];
    for (const o of (data.orders || [])) {
      const md = o.metadata || {};
      if (md.bc_waiter !== '1') continue;
      const total = (o.total_money && o.total_money.amount) || 0;
      const tenderPaid = (o.tenders || []).reduce((s, t) => s + ((t.amount_money && t.amount_money.amount) || 0), 0);
      // What's still owing at a glance. A split table's remaining comes from its
      // billing overlay; a plain tab subtracts Square tenders plus any standalone
      // (partial) captures. Falls back to the full total if a lookup fails.
      let remaining = Math.max(0, total - tenderPaid);
      try {
        if (md.bc_session) {
          const row = await db.waiterSessionByOrder(o.id);
          if (row) remaining = waiterSplit.computeSession(row.data || {}, o).remaining;
          else remaining = Math.max(0, total - tenderPaid - (await db.posPaidTotalForOrder(o.id)));
        } else {
          remaining = Math.max(0, total - tenderPaid - (await db.posPaidTotalForOrder(o.id)));
        }
      } catch {}
      tabs.push({
        tabId: o.id,
        sessionId: md.bc_session || '',   // set → this is a split (group-tab) table
        by: md.bc_by || '',               // the waiter who opened it (for "my tables")
        table: md.bc_booth || o.ticket_name || '',
        name: md.bc_name || '',
        createdAt: o.created_at,
        total,
        remaining,
        paid: Math.max(0, total - remaining),
        currency: (o.total_money && o.total_money.currency) || sq.CURRENCY,
        itemCount: (o.line_items || []).reduce((n, li) => n + (Number(li.quantity) || 1), 0),
        items: (o.line_items || []).map((li) => ({
          name: li.name || 'Item', variation: li.variation_name || '',
          quantity: li.quantity || '1', amount: (li.total_money && li.total_money.amount) || 0,
          modifiers: (li.modifiers || []).map((m) => m.name).filter(Boolean),
        })),
      });
    }
    // Merge in OPEN TABLES that have no active order (a table the waiter has
    // opened but not ordered on yet, or one that's been settled but not cleared).
    // A table with a live order shows its order row; the empty marker is hidden.
    try {
      const rawLoc = req.query.location || '';
      const opens = await db.openTablesList(rawLoc);
      const taken = new Set(tabs.map((t) => String(t.table || '').trim().toLowerCase()));
      for (const e of opens) {
        const key = String(e.table_label || '').trim().toLowerCase();
        if (taken.has(key)) continue;   // a live order already represents this table
        tabs.push({
          openId: e.id, empty: true,
          sessionId: e.session_id || '', mode: e.mode || 'together',
          by: e.opened_by || '', table: e.table_label || '', name: '',
          createdAt: e.created_at, total: 0, currency: sq.CURRENCY, itemCount: 0, items: [],
        });
      }
    } catch (e) { console.warn('[waiter] open tables merge failed:', e.message); }
    res.json({ tabs, currency: sq.CURRENCY });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// Mark a table taken (before any order). Idempotent per (location, table).
app.post('/api/waiter/table/open', async (req, res) => {
  const pos = waiterAuth(req);
  if (!pos) return res.status(401).json({ error: 'Wrong PIN, or waiter mode is off.' });
  if (!db.enabled) return res.json({ ok: true });   // no DB → open tables just aren't tracked
  try {
    const { table, mode, sessionId, locationId, by } = req.body || {};
    if (!String(table || '').trim()) return res.status(400).json({ error: 'Pick a table first.' });
    const row = await db.openTableUpsert({ location: locationId || '', tableLabel: String(table).trim(), mode: mode === 'groups' ? 'groups' : 'together', sessionId: sessionId || '', openedBy: String((req.body && req.body.by) || by || '').slice(0, 40) });
    res.json({ ok: true, openId: row ? row.id : '' });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// Close/clear a table (removes the "taken" marker). Used for an empty table, or
// once a party has left and paid.
app.post('/api/waiter/table/close', async (req, res) => {
  const pos = waiterAuth(req);
  if (!pos) return res.status(401).json({ error: 'Wrong PIN, or waiter mode is off.' });
  try { if (req.body && req.body.openId) await db.openTableClose(req.body.openId); res.json({ ok: true }); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

// Open a new tab (no tabId) or add another round to an existing one (tabId set).
// Either way the items land on an OPEN Square order that the kitchen sees now.
app.post('/api/waiter/tab', async (req, res) => {
  const pos = waiterAuth(req);
  if (!pos) return res.status(401).json({ error: 'Wrong PIN, or waiter mode is off.' });
  try {
    const { cart, table, name, tabId, locationId } = req.body || {};
    const by = String((req.body && req.body.by) || '').trim().slice(0, 40);
    if (!Array.isArray(cart) || cart.length === 0) return res.status(400).json({ error: 'Add at least one item.' });
    const squareLocationId = locations.squareIdFor(locationId);
    const posOverrideLocation = locationId || undefined;
    if (tabId) {
      const order = await orders.addToOrder(tabId, cart, { posOverrideLocation, squareLocationId });
      return res.json({ tabId: order.id, total: (order.total_money && order.total_money.amount) || 0, currency: (order.total_money && order.total_money.currency) || sq.CURRENCY });
    }
    if (!String(table || '').trim()) return res.status(400).json({ error: 'Pick a table first.' });
    const order = await orders.createOrder({
      cart, dineIn: true, table: String(table).trim(), name: name ? String(name).trim() : '',
      source: 'Bean Culture Waiter', squareLocationId,
      appLocationId: (locations.resolve(locationId) || {}).id || undefined,
      posOverrideLocation,
      // A tab is a live table order: it must reach the kitchen immediately, so it
      // is never held for payment (payment comes later when the tab is settled).
      holdForPayment: false,
    });
    // Tag it as a waiter tab so it shows in the tab list (and only there), plus
    // the waiter who opened it so the KDS docket can show "by <name>".
    try { await orders.stampMeta(order.id, { bc_waiter: '1', bc_by: by || '' }); } catch (e) { console.warn('[waiter] tag failed:', e.message); }
    res.json({ tabId: order.id, total: (order.total_money && order.total_money.amount) || 0, currency: (order.total_money && order.total_money.currency) || sq.CURRENCY });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// Settle a tab. tender 'cash' takes a Square CASH payment (closes the order);
// 'card' starts a Terminal checkout on the waiter reader (client then polls
// /api/waiter/checkout/:id). Leaving the tab open needs no call — the order just
// stays OPEN until it's settled.
app.post('/api/waiter/tab/close', async (req, res) => {
  const pos = waiterAuth(req);
  if (!pos) return res.status(401).json({ error: 'Wrong PIN, or waiter mode is off.' });
  try {
    const { tabId, tender, cashGiven, locationId } = req.body || {};
    if (!tabId) return res.status(400).json({ error: 'Missing tab.' });
    if (!['cash', 'card'].includes(tender)) return res.status(400).json({ error: 'Choose cash or card.' });
    { const pm = paymentsFor(pos, locationId); if (tender === 'cash' && !pm.cash) return res.status(400).json({ error: 'Cash is turned off for this store.' }); if (tender === 'card' && !pm.card) return res.status(400).json({ error: 'Card is turned off for this store.' }); }
    const order = await orders.getOrder(tabId);
    if (!order) return res.status(404).json({ error: 'Tab not found.' });
    if (String(order.state) !== 'OPEN') return res.status(400).json({ error: 'That tab is already settled.' });
    const total = (order.total_money && order.total_money.amount) || 0;
    const currency = (order.total_money && order.total_money.currency) || sq.CURRENCY;
    // Settle only the BALANCE. Earlier split payments are standalone captures (not
    // Square tenders), so the order still reads its full total — subtract both the
    // real tenders and our captures, or the terminal would ask for the whole bill
    // again (and cash would double-charge).
    const tenderPaid = (order.tenders || []).reduce((s, t) => s + ((t.amount_money && t.amount_money.amount) || 0), 0);
    let captured = 0;
    try { if (db.enabled) captured = await db.posPaidTotalForOrder(tabId); } catch {}
    const amount = Math.max(0, total - tenderPaid - captured);
    if (!(amount > 0)) return res.status(400).json({ error: 'This tab is already fully paid.' });
    const linkOrder = amount === total;   // link the order only when nothing's been paid yet
    const noteLabel = waiterPayNote({ order, label: linkOrder ? 'Full bill' : 'Balance' });
    const squareLocationId = locations.squareIdFor(locationId) || order.location_id;

    if (tender === 'card') {
      const term = waiterTerminalFor(pos, locationId);
      if (!term.deviceId) return res.status(400).json({ error: 'No waiter Terminal is set. Pair one in POS setup → Waiter mode.' });
      try {
        const checkout = await terminal.createCheckout({
          amountMoney: { amount, currency }, deviceId: term.deviceId, orderId: linkOrder ? tabId : undefined, referenceId: tabId,
          note: noteLabel, showItemizedCart: pos.terminalShowCart === true, skipReceipt: pos.terminalSkipReceipt !== false,
        });
        try { await db.posPaymentUpsert({ checkoutId: checkout.id, squareOrderId: tabId, deviceId: term.deviceId, amount, status: 'waiting', note: noteLabel, tender: 'card' }); } catch {}
        return res.json({ tender: 'card', checkoutId: checkout.id, tabId, total: amount, currency, status: 'waiting', terminalName: term.name || 'Terminal' });
      } catch (e) {
        console.warn('[waiter] settle card checkout FAILED:', 'order=' + tabId, 'amount=' + amount, e.message);
        return res.status(502).json({ error: `Could not start the card payment: ${e.message}` });
      }
    }
    // Cash → the balance. Link (and let Square close the order) only if it's the
    // whole bill; a partial balance is a standalone capture, reconciled by us.
    const given = Math.max(amount, Math.round(Number(cashGiven) || amount));
    let payment;
    try {
      payment = await orders.createCashPayment({
        orderId: linkOrder ? tabId : undefined, amountMoney: { amount, currency },
        buyerSuppliedMoney: { amount: given, currency }, squareLocationId, note: noteLabel,
      });
    } catch (e) {
      console.warn('[waiter] settle cash FAILED:', 'order=' + tabId, 'amount=' + amount, e.message);
      return res.status(502).json({ error: `Could not record the cash payment: ${e.message}` });
    }
    if (!linkOrder) { try { await db.posPaymentUpsert({ checkoutId: 'cash:' + ((payment && payment.id) || Date.now()), squareOrderId: tabId, deviceId: 'cash', amount, status: 'paid', note: noteLabel, tender: 'cash' }); } catch {} }
    try {
      if (db.enabled && typeof db.posRecordOrder === 'function') {
        await db.posRecordOrder({ squareOrderId: tabId, squarePaymentId: payment ? payment.id : null, source: 'Bean Culture Waiter', tender: 'cash', amount, status: 'paid', deviceName: 'Waiter' });
      }
    } catch {}
    res.json({ tender: 'cash', tabId, total: amount, currency, change: Math.max(0, given - amount), status: 'paid', paymentId: payment ? payment.id : null });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// One tab's live money state, for the split-bill workspace: total, how much has
// already been paid (sum of tenders), what's left, and each payment taken so far
// with its payer name (from the tender/payment note). Recomputed from Square each
// call so the "remaining" a split works against is always authoritative.
app.get('/api/waiter/tab/:id', async (req, res) => {
  const pos = waiterAuth(req);
  if (!pos) return res.status(401).json({ error: 'Wrong PIN, or waiter mode is off.' });
  try {
    const order = await orders.getOrder(req.params.id);
    if (!order) return res.status(404).json({ error: 'Tab not found.' });
    const total = (order.total_money && order.total_money.amount) || 0;
    const tenders = order.tenders || [];
    const tenderPaid = tenders.reduce((s, t) => s + ((t.amount_money && t.amount_money.amount) || 0), 0);
    // Partial split payments are standalone captures (not Square tenders) — pull them
    // in so the balance drops and each shows up with its payer name and tender.
    let captures = [];
    try { if (db.enabled) captures = await db.posPaymentsPaidForOrder(order.id); } catch {}
    const capturePaid = captures.reduce((s, c) => s + (Number(c.amount) || 0), 0);
    const paid = Math.min(total, tenderPaid + capturePaid);
    // Which line items have been paid, and by whom — from the uids each "by item"
    // capture recorded — so the item split view keeps them marked across reloads.
    const paidByUid = {};
    for (const c of captures) {
      for (const u of String(c.line_uids || '').split(',').filter(Boolean)) {
        if (!paidByUid[u]) paidByUid[u] = { name: (c.note || '').replace(/^Split:\s*/i, '') || '', tender: (c.tender || '').toLowerCase() };
      }
    }
    res.json({
      tabId: order.id,
      state: order.state,
      table: (order.metadata && order.metadata.bc_booth) || order.ticket_name || '',
      total, paid, remaining: Math.max(0, total - paid),
      currency: (order.total_money && order.total_money.currency) || sq.CURRENCY,
      paidUids: Object.keys(paidByUid),
      items: (order.line_items || []).map((li) => ({
        uid: li.uid || '', name: li.name || 'Item', variation: li.variation_name || '',
        quantity: li.quantity || '1',
        amount: (li.total_money && li.total_money.amount) || 0,
        modifiers: (li.modifiers || []).map((m) => m.name).filter(Boolean),
        paid: !!paidByUid[li.uid || ''],
        paidBy: (paidByUid[li.uid || ''] && paidByUid[li.uid || ''].name) || '',
        paidTender: (paidByUid[li.uid || ''] && paidByUid[li.uid || ''].tender) || '',
      })),
      payments: [
        ...tenders.map((t) => ({
          amount: (t.amount_money && t.amount_money.amount) || 0,
          tender: (t.type || '').toLowerCase(),
          name: (t.note || '').replace(/^Split:\s*/i, '') || '',
          paymentId: t.payment_id || t.id || null,
        })),
        ...captures.map((c) => ({
          amount: Number(c.amount) || 0,
          tender: (c.tender || '').toLowerCase(),   // never assume card — show the real tender (blank if unknown legacy row)
          name: (c.note || '').replace(/^Split:\s*/i, '') || '',
          // The Square payment id, so a receipt can be reprinted on the terminal.
          // Cash captures encode it in the checkout id ("cash:<paymentId>").
          paymentId: c.square_payment_id || (String(c.checkout_id || '').startsWith('cash:') ? c.checkout_id.slice(5) : null),
        })),
      ],
    });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// Take ONE payment toward a tab — the heart of split billing. `amount` is the
// slice being paid now (one person's items, an even share, a percentage…), and
// the optional `payerName` is written onto the payment so "who paid what" is
// legible afterwards. Cash settles instantly; card returns a checkoutId to poll.
// The order stays OPEN until the running total of payments covers it, then Square
// closes it — so any number of split payments compose naturally.
app.post('/api/waiter/tab/pay', async (req, res) => {
  const pos = waiterAuth(req);
  if (!pos) return res.status(401).json({ error: 'Wrong PIN, or waiter mode is off.' });
  try {
    const { tabId, amount, tender, cashGiven, payerName, locationId } = req.body || {};
    const lineUids = Array.isArray(req.body && req.body.lineUids) ? req.body.lineUids.filter(Boolean).map(String) : [];
    if (!tabId) return res.status(400).json({ error: 'Missing tab.' });
    if (!['cash', 'card'].includes(tender)) return res.status(400).json({ error: 'Choose cash or card.' });
    { const pm = paymentsFor(pos, locationId); if (tender === 'cash' && !pm.cash) return res.status(400).json({ error: 'Cash is turned off for this store.' }); if (tender === 'card' && !pm.card) return res.status(400).json({ error: 'Card is turned off for this store.' }); }
    const want = Math.round(Number(amount) || 0);
    if (!(want > 0)) return res.status(400).json({ error: 'Enter an amount to pay.' });
    const order = await orders.getOrder(tabId);
    if (!order) return res.status(404).json({ error: 'Tab not found.' });
    if (String(order.state) !== 'OPEN') return res.status(400).json({ error: 'That tab is already settled.' });
    const total = (order.total_money && order.total_money.amount) || 0;
    const paid = (order.tenders || []).reduce((s, t) => s + ((t.amount_money && t.amount_money.amount) || 0), 0);
    // Partial card payments are captured standalone (Square won't attach a partial
    // checkout to the order), so they aren't Square tenders — subtract them here so
    // the remaining is right and a card slice can't be charged twice.
    let cardCaptured = 0;
    try { if (db.enabled) cardCaptured = await db.posPaidTotalForOrder(tabId); } catch {}
    const remaining = Math.max(0, total - paid - cardCaptured);
    if (want > remaining) return res.status(400).json({ error: `Only ${(remaining / 100).toFixed(2)} left to pay on this tab.` });
    const currency = (order.total_money && order.total_money.currency) || sq.CURRENCY;
    const squareLocationId = locations.squareIdFor(locationId) || order.location_id;
    const who = String(payerName || '').trim().slice(0, 60);
    // Square payment note = table · items · payer, so the transaction/receipt says
    // what was bought. The app's own capture note stays just the payer name.
    const note = waiterPayNote({ order, lineUids, who, label: 'Split' });
    // Link the order only when this one payment settles the ENTIRE order (Square's
    // rule for both card checkouts and cash payments); any split/partial is taken
    // standalone and reconciled via the captured-payment total on this order.
    const linkOrder = total > 0 && want === total;

    if (tender === 'card') {
      const term = waiterTerminalFor(pos, locationId);
      if (!term.deviceId) return res.status(400).json({ error: 'No waiter Terminal is set. Pair one in POS setup → Waiter mode.' });
      try {
        const checkout = await terminal.createCheckout({
          amountMoney: { amount: want, currency }, deviceId: term.deviceId, orderId: linkOrder ? tabId : undefined, referenceId: tabId,
          note, showItemizedCart: pos.terminalShowCart === true, skipReceipt: pos.terminalSkipReceipt !== false,
        });
        try { await db.posPaymentUpsert({ checkoutId: checkout.id, squareOrderId: tabId, deviceId: term.deviceId, amount: want, status: 'waiting', note: who, tender: 'card', lineUids }); } catch {}
        return res.json({ tender: 'card', checkoutId: checkout.id, tabId, amount: want, currency, status: 'waiting', payerName: who, terminalName: term.name || 'Terminal' });
      } catch (e) {
        console.warn('[waiter] split card checkout FAILED:', 'device=' + term.deviceId, 'order=' + tabId, 'amount=' + want, e.message);
        return res.status(502).json({ error: `Could not start the card payment: ${e.message}` });
      }
    }
    const given = Math.max(want, Math.round(Number(cashGiven) || want));
    let payment;
    try {
      payment = await orders.createCashPayment({
        orderId: linkOrder ? tabId : undefined, amountMoney: { amount: want, currency },
        buyerSuppliedMoney: { amount: given, currency }, squareLocationId, note,
      });
    } catch (e) {
      console.warn('[waiter] split cash payment FAILED:', 'order=' + tabId, 'amount=' + want, e.message);
      return res.status(502).json({ error: `Could not record the cash payment: ${e.message}` });
    }
    // A standalone (partial) cash capture isn't a Square tender, so record it here
    // too — that's what lets "remaining" subtract it and prevents a double-charge.
    if (!linkOrder) { try { await db.posPaymentUpsert({ checkoutId: 'cash:' + ((payment && payment.id) || Date.now()), squareOrderId: tabId, deviceId: 'cash', amount: want, status: 'paid', note: who, tender: 'cash', lineUids }); } catch {} }
    try {
      if (db.enabled && typeof db.posRecordOrder === 'function') {
        await db.posRecordOrder({ squareOrderId: tabId, squarePaymentId: payment ? payment.id : null, source: 'Bean Culture Waiter', tender: 'cash', amount: want, status: 'paid', deviceName: `Waiter${who ? ' · ' + who : ''}` });
      }
    } catch {}
    res.json({ tender: 'cash', tabId, amount: want, currency, change: Math.max(0, given - want), status: 'paid', payerName: who, paymentId: payment ? payment.id : null });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// Print a receipt on the WAITER's Terminal for a completed payment (card or cash).
// Lets floor staff hand a customer a printed receipt — e.g. someone claiming food.
app.post('/api/waiter/print-receipt', async (req, res) => {
  const pos = waiterAuth(req);
  if (!pos) return res.status(401).json({ error: 'Wrong PIN, or waiter mode is off.' });
  try {
    const { paymentId, locationId, duplicate } = req.body || {};
    if (!paymentId) return res.status(400).json({ error: 'No payment to print.' });
    const term = waiterTerminalFor(pos, locationId);
    if (!term.deviceId) return res.status(400).json({ error: 'No waiter Terminal is set to print on.' });
    const action = await terminal.printReceipt({ deviceId: term.deviceId, paymentId, duplicate: duplicate === true });
    res.json({ ok: true, actionId: action.id || null, status: action.status || 'PENDING' });
  } catch (e) { console.warn('[waiter] print receipt FAILED:', e.message); res.status(502).json({ error: e.message }); }
});

// Poll a waiter card checkout. Unlike the counter POS, a cancelled/declined card
// must NOT delete the tab — the food is already ordered — it just stays open to
// try again or settle another way.
app.get('/api/waiter/checkout/:id', async (req, res) => {
  const pos = waiterAuth(req);
  if (!pos) return res.status(401).json({ error: 'Wrong PIN, or waiter mode is off.' });
  try {
    const c = await terminal.getCheckout(req.params.id);
    const phase = terminal.phaseOf(c);
    const paymentId = (c.payment_ids && c.payment_ids[0]) || null;
    if (phase === 'paid') {
      await db.posPaymentSetStatus(req.params.id, 'paid', paymentId).catch(() => {});
      const orderId = req.query.tabId || null;
      if (orderId) {
        try { await db.posRecordOrder({ squareOrderId: orderId, squarePaymentId: paymentId, source: 'Bean Culture Waiter', tender: 'card', amount: (c.amount_money && c.amount_money.amount) || 0, status: 'paid', deviceName: 'Waiter' }); } catch {}
      }
    } else if (phase === 'canceled') {
      await db.posPaymentSetStatus(req.params.id, 'canceled', null).catch(() => {});
      // Deliberately do NOT cancel the order — the tab stays open.
    }
    res.json({ status: phase, paymentId, amount: (c.amount_money && c.amount_money.amount) || 0 });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// Cancel an in-progress waiter card checkout (staff pressed Cancel). Tab stays open.
app.post('/api/waiter/checkout/:id/cancel', async (req, res) => {
  const pos = waiterAuth(req);
  if (!pos) return res.status(401).json({ error: 'Wrong PIN, or waiter mode is off.' });
  try {
    const c = await terminal.cancelCheckout(req.params.id);
    await db.posPaymentSetStatus(req.params.id, terminal.phaseOf(c), null).catch(() => {});
    res.json({ status: terminal.phaseOf(c) });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ── Split-billing "sessions": group tabs + shared tabs on ONE table order ─────
// The table is one Square order; the overlay (groups, shared tabs, line→tab
// assignment, weighted parties) lives in our DB and is turned into per-group /
// per-person amounts by waiterSplit. Each group settles as one partial payment.

const emptyOrder = (currency) => ({ total_money: { amount: 0, currency: currency || sq.CURRENCY }, line_items: [], tenders: [], state: 'OPEN' });

async function loadSessionRow(idOrOrder) {
  let row = await db.waiterSessionGet(idOrOrder);
  if (!row) row = await db.waiterSessionByOrder(idOrOrder);
  return row;
}

// Build the full response for a session: the editable overlay + the computed
// split state (reading the live Square order when one exists yet).
async function sessionResponse(row, pos, locId) {
  const data = row.data || {};
  let order = null;
  if (row.square_order_id) { try { order = await orders.getOrder(row.square_order_id); } catch {} }
  const state = waiterSplit.computeSession(data, order || emptyOrder(sq.CURRENCY));
  const term = waiterTerminalFor(pos, locId || data.locationId);
  return {
    sessionId: row.id,
    tabId: row.square_order_id || '',
    table: data.table || '',
    overlay: { groups: data.groups || [], shared: data.shared || [], assign: data.assign || {}, paid: data.paid || {} },
    state,
    hasTerminal: !!term.deviceId,
    terminalName: term.name || 'Terminal',
    currency: state.currency,
  };
}

// Create a new split table (no items yet).
app.post('/api/waiter/session', async (req, res) => {
  const pos = waiterAuth(req);
  if (!pos) return res.status(401).json({ error: 'Wrong PIN, or waiter mode is off.' });
  if (!db.enabled) return res.status(400).json({ error: 'A database is required for split billing.' });
  try {
    const { table, locationId } = req.body || {};
    if (!String(table || '').trim()) return res.status(400).json({ error: 'Pick a table first.' });
    const id = require('crypto').randomUUID();
    const data = { table: String(table).trim(), locationId: locationId || '', mode: 'groups', groups: [], shared: [], assign: {}, paid: {} };
    const row = await db.waiterSessionUpsert(id, null, data);
    res.json(await sessionResponse(row, pos, locationId));
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// Read a session (by our session id, or by the Square order id from the tab list).
app.get('/api/waiter/session/:id', async (req, res) => {
  const pos = waiterAuth(req);
  if (!pos) return res.status(401).json({ error: 'Wrong PIN, or waiter mode is off.' });
  try {
    const row = await loadSessionRow(req.params.id);
    if (!row) return res.status(404).json({ error: 'Table session not found.' });
    res.json(await sessionResponse(row, pos, req.query.location));
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// Replace the tab DEFINITIONS (add/rename/remove a group or shared tab, edit a
// shared tab's parties/weights). Does not touch line assignment or payments.
app.post('/api/waiter/session/tabs', async (req, res) => {
  const pos = waiterAuth(req);
  if (!pos) return res.status(401).json({ error: 'Wrong PIN, or waiter mode is off.' });
  try {
    const { sessionId, groups, shared } = req.body || {};
    const row = await loadSessionRow(sessionId);
    if (!row) return res.status(404).json({ error: 'Table session not found.' });
    const data = row.data || {};
    if (Array.isArray(groups)) data.groups = groups.slice(0, 40).map((g) => ({ id: String(g.id || require('crypto').randomUUID()), name: String(g.name || 'Group').slice(0, 40), people: Math.max(1, Math.min(99, Math.round(Number(g.people) || 1))) }));
    if (Array.isArray(shared)) data.shared = shared.slice(0, 20).map((s) => ({
      id: String(s.id || require('crypto').randomUUID()), name: String(s.name || 'Shared').slice(0, 40),
      mode: s.mode === 'pct' ? 'pct' : 'parts',
      parties: (Array.isArray(s.parties) ? s.parties : []).slice(0, 40).map((p) => ({ id: String(p.id || require('crypto').randomUUID()), ref: p.ref || null, name: String(p.name || '').slice(0, 40), weight: Math.max(0, Number(p.weight) || 0) })),
    }));
    const updated = await db.waiterSessionUpsert(row.id, row.square_order_id, data);
    res.json(await sessionResponse(updated, pos, req.body.locationId));
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// Order a round INTO a group tab. Creates the table's Square order on the first
// round, appends on later ones. Each line carries the group name so the kitchen
// ticket tells the runner whose it is, and the new lines are assigned to that tab.
app.post('/api/waiter/session/order', async (req, res) => {
  const pos = waiterAuth(req);
  if (!pos) return res.status(401).json({ error: 'Wrong PIN, or waiter mode is off.' });
  try {
    const { sessionId, tabId, cart, locationId } = req.body || {};
    const by = String((req.body && req.body.by) || '').trim().slice(0, 40);
    if (!Array.isArray(cart) || cart.length === 0) return res.status(400).json({ error: 'Add at least one item.' });
    const row = await loadSessionRow(sessionId);
    if (!row) return res.status(404).json({ error: 'Table session not found.' });
    const data = row.data || {};
    const tab = (data.groups || []).find((g) => g.id === tabId) || (data.shared || []).find((s) => s.id === tabId);
    if (!tab) return res.status(400).json({ error: 'Choose which tab these items go on.' });
    const squareLocationId = locations.squareIdFor(locationId || data.locationId);
    const posOverrideLocation = (locationId || data.locationId) || undefined;
    // Prefix each line's note with the tab name (kitchen/runner sees the group).
    const labelled = cart.map((ci) => ({ ...ci, note: `${tab.name}${ci.note ? ' · ' + ci.note : ''}`.slice(0, 500) }));

    let order;
    if (!row.square_order_id) {
      order = await orders.createOrder({
        cart: labelled, dineIn: true, table: String(data.table || '').trim(), name: '',
        source: 'Bean Culture Waiter', squareLocationId,
        appLocationId: (locations.resolve(locationId || data.locationId) || {}).id || undefined,
        posOverrideLocation, holdForPayment: false,
      });
      try { await orders.stampMeta(order.id, { bc_waiter: '1', bc_session: row.id, bc_by: by || '' }); } catch (e) { console.warn('[waiter] tag failed:', e.message); }
      if (by && !data.openedBy) data.openedBy = by;
    } else {
      order = await orders.addToOrder(row.square_order_id, labelled, { posOverrideLocation, squareLocationId });
    }
    // Assign the newly-added lines (the last cart.length of them) to this tab, and
    // record which waiter added each one (attribution).
    const newLines = (order.line_items || []).slice(-cart.length);
    data.assign = data.assign || {};
    data.addedBy = data.addedBy || {};
    for (const li of newLines) if (li.uid) { data.assign[li.uid] = tabId; if (by) data.addedBy[li.uid] = by; }
    const updated = await db.waiterSessionUpsert(row.id, order.id, data);
    res.json(await sessionResponse(updated, pos, locationId));
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// Move a single line to a different tab (fix a mis-tap, or shift a shared item).
app.post('/api/waiter/session/assign', async (req, res) => {
  const pos = waiterAuth(req);
  if (!pos) return res.status(401).json({ error: 'Wrong PIN, or waiter mode is off.' });
  try {
    const { sessionId, lineUid, tabId } = req.body || {};
    const row = await loadSessionRow(sessionId);
    if (!row) return res.status(404).json({ error: 'Table session not found.' });
    const data = row.data || {};
    data.assign = data.assign || {};
    if (tabId) data.assign[lineUid] = tabId; else delete data.assign[lineUid];
    const updated = await db.waiterSessionUpsert(row.id, row.square_order_id, data);
    res.json(await sessionResponse(updated, pos, req.body.locationId));
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// Settle ONE payer — a group (its items + its share of shared tabs) or an ad-hoc
// shared-item guest — as a single partial payment against the table order.
app.post('/api/waiter/session/pay', async (req, res) => {
  const pos = waiterAuth(req);
  if (!pos) return res.status(401).json({ error: 'Wrong PIN, or waiter mode is off.' });
  try {
    const { sessionId, payerId, tender, cashGiven, locationId } = req.body || {};
    const by = String((req.body && req.body.by) || '').trim().slice(0, 40);
    if (!['cash', 'card'].includes(tender)) return res.status(400).json({ error: 'Choose cash or card.' });
    const row = await loadSessionRow(sessionId);
    if (!row || !row.square_order_id) return res.status(404).json({ error: 'This table has no items yet.' });
    const data = row.data || {};
    { const pm = paymentsFor(pos, locationId || data.locationId); if (tender === 'cash' && !pm.cash) return res.status(400).json({ error: 'Cash is turned off for this store.' }); if (tender === 'card' && !pm.card) return res.status(400).json({ error: 'Card is turned off for this store.' }); }
    const order = await orders.getOrder(row.square_order_id);
    if (!order) return res.status(404).json({ error: 'Table order not found.' });
    const session = waiterSplit.computeSession(data, order);
    const left = Math.round(waiterSplit.remainingFor(session, payerId));
    if (!(left > 0)) return res.status(400).json({ error: 'That tab is already paid.' });
    // A partial amount lets a group pay part cash + part card. Default is the
    // whole of what they have left; never more than that, or the table balance.
    const want = req.body && req.body.amount != null ? Math.round(Number(req.body.amount) || 0) : left;
    const amount = Math.min(Math.max(0, want), left, session.remaining);
    if (!(amount > 0)) return res.status(400).json({ error: 'Enter an amount to pay.' });
    const g = session.groups.find((x) => x.id === payerId);
    const a = session.adhoc.find((x) => x.id === payerId);
    const who = (g && g.name) || (a && a.name) || '';
    const note = waiterPayNote({ order, who, label: g ? 'Group' : 'Split share' }) + (by ? ` (${by})` : '');
    const currency = session.currency;
    const squareLocationId = locations.squareIdFor(locationId || data.locationId) || order.location_id;
    // Square rejects BOTH a Terminal checkout and a cash payment that is linked to
    // an order but doesn't pay it in full. A split pays one payer's share (a
    // partial), so we link the order only on a single full-table settlement and
    // otherwise take the money standalone — the paidByPayer overlay tracks the
    // split and drives "remaining", not the Square tenders.
    const orderTotal = (order.total_money && order.total_money.amount) || 0;
    const linkOrder = orderTotal > 0 && amount === orderTotal;

    if (tender === 'card') {
      const term = waiterTerminalFor(pos, locationId || data.locationId);
      if (!term.deviceId) return res.status(400).json({ error: 'No waiter Terminal is set. Pair one in POS setup → Waiter mode.' });
      let checkout;
      try {
        checkout = await terminal.createCheckout({
          amountMoney: { amount, currency }, deviceId: term.deviceId, orderId: linkOrder ? order.id : undefined, referenceId: order.id,
          note, showItemizedCart: pos.terminalShowCart === true, skipReceipt: pos.terminalSkipReceipt !== false,
        });
      } catch (e) {
        console.warn('[waiter] session card checkout FAILED:', 'device=' + term.deviceId, 'order=' + order.id, e.message);
        return res.status(502).json({ error: `Could not start the card payment: ${e.message}` });
      }
      try { await db.posPaymentUpsert({ checkoutId: checkout.id, squareOrderId: order.id, deviceId: term.deviceId, amount, status: 'waiting' }); } catch {}
      return res.json({ tender: 'card', checkoutId: checkout.id, sessionId: row.id, payerId, amount, currency, status: 'waiting', payerName: who, terminalName: term.name || 'Terminal' });
    }
    // Cash: record the actual note tendered so change is on the record (Square
    // stores buyer_supplied_money + change_back_money) — no "what did I hand you?".
    const given = Math.max(amount, Math.round(Number(cashGiven) || amount));
    let payment;
    try {
      payment = await orders.createCashPayment({ orderId: linkOrder ? order.id : undefined, amountMoney: { amount, currency }, buyerSuppliedMoney: { amount: given, currency }, squareLocationId, note });
    } catch (e) {
      console.warn('[waiter] session cash payment FAILED:', 'order=' + order.id, 'amount=' + amount, e.message);
      return res.status(502).json({ error: `Could not record the cash payment: ${e.message}` });
    }
    data.paidByPayer = data.paidByPayer || {};
    data.paidByPayer[payerId] = (Number(data.paidByPayer[payerId]) || 0) + amount;
    await db.waiterSessionUpsert(row.id, order.id, data);
    try { if (db.enabled && typeof db.posRecordOrder === 'function') await db.posRecordOrder({ squareOrderId: order.id, squarePaymentId: payment ? payment.id : null, source: 'Bean Culture Waiter', tender: 'cash', amount, status: 'paid', deviceName: `Waiter${who ? ' · ' + who : ''}${by ? ' / ' + by : ''}` }); } catch {}
    res.json({ tender: 'cash', sessionId: row.id, payerId, amount, currency, tendered: given, change: Math.max(0, given - amount), status: 'paid', payerName: who });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// Mark a payer settled after a successful CARD payment (the client calls this
// once the Terminal checkout completes).
app.post('/api/waiter/session/mark-paid', async (req, res) => {
  const pos = waiterAuth(req);
  if (!pos) return res.status(401).json({ error: 'Wrong PIN, or waiter mode is off.' });
  try {
    const { sessionId, payerId, amount } = req.body || {};
    const row = await loadSessionRow(sessionId);
    if (!row) return res.status(404).json({ error: 'Table session not found.' });
    const data = row.data || {};
    data.paidByPayer = data.paidByPayer || {};
    if (payerId) {
      // A specific amount (a card partial) adds to what this payer has paid;
      // without one, treat it as "settle whatever is left" for this payer.
      if (amount != null) data.paidByPayer[payerId] = (Number(data.paidByPayer[payerId]) || 0) + Math.max(0, Math.round(Number(amount) || 0));
      else if (row.square_order_id) {
        try {
          const order = await orders.getOrder(row.square_order_id);
          const session = waiterSplit.computeSession(data, order);
          const owed = waiterSplit.owedFor(session, payerId);
          data.paidByPayer[payerId] = owed;
        } catch { data.paidByPayer[payerId] = (Number(data.paidByPayer[payerId]) || 0); }
      }
    }
    const updated = await db.waiterSessionUpsert(row.id, row.square_order_id, data);
    res.json(await sessionResponse(updated, pos, req.body.locationId));
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// Admin: save waiter-mode settings (enable, PIN, preset tables, waiter Terminal).
app.post('/api/pos/waiter-settings', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (!db.enabled) return res.status(400).json({ error: 'A database is required to save waiter settings.' });
  try {
    const b = req.body || {};
    const loc = b.locationId ? String(b.locationId) : '';   // '' = the global default
    const ov = db.getOverrides() || {};
    ov.pos = ov.pos || {};
    const setMap = (key, val) => { const m = { ...(ov.pos[key] || {}) }; if (val === undefined) delete m[loc]; else m[loc] = val; ov.pos[key] = m; };
    // Every PIN must be unique across ALL stores and staff (the code identifies
    // the person AND the location). `otherPins` is the set already in use, minus
    // the slot(s) this request is about to overwrite.
    const cur = getSettings().pos || {};
    const otherPins = (exKind, exLoc) => {
      const set = new Set();
      const add = (pin, kind, l) => { if (pin && !(kind === exKind && (l || '') === (exLoc || ''))) set.add(String(pin)); };
      add(cur.waiterPin, 'single', '');
      for (const [l, p] of Object.entries(cur.waiterPinByLocation || {})) add(p, 'single', l);
      for (const st of (cur.waiterStaff || [])) add(st.pin, 'staff', '');
      for (const [l, arr] of Object.entries(cur.waiterStaffByLocation || {})) for (const st of (arr || [])) add(st.pin, 'staff', l);
      return set;
    };

    if (b.enabled !== undefined) {
      if (loc) setMap('waiterEnabledByLocation', b.enabled === true);
      else ov.pos.waiterEnabled = b.enabled === true;
    }
    if (b.pin !== undefined) {
      const next = String(b.pin || '').trim();
      if (next && !/^\d{4,8}$/.test(next)) return res.status(400).json({ error: 'Waiter PIN must be 4–8 digits.' });
      if (next && otherPins('single', loc).has(next)) return res.status(400).json({ error: `PIN ${next} is already used somewhere else — every PIN must be unique.` });
      if (loc) setMap('waiterPinByLocation', next || undefined);   // empty clears the override → falls back to global
      else ov.pos.waiterPin = next;
    }
    if (b.tables !== undefined) {
      const raw = Array.isArray(b.tables) ? b.tables : String(b.tables || '').split(/[\n,]/);
      const seen = new Set(); const list = [];
      for (const t of raw) {
        const v = String(t || '').trim().slice(0, 40);
        if (v && !seen.has(v.toLowerCase())) { seen.add(v.toLowerCase()); list.push(v); }
        if (list.length >= 100) break;
      }
      if (loc) setMap('waiterTablesByLocation', list);
      else ov.pos.waiterTables = list;
    }
    if (b.terminalDeviceId !== undefined) {
      const dev = String(b.terminalDeviceId || '');
      const nm = String(b.terminalName || '').slice(0, 60);
      if (loc) {
        const m = { ...(ov.pos.waiterTerminalByLocation || {}) };
        if (dev) m[loc] = { deviceId: dev, name: nm }; else delete m[loc];
        ov.pos.waiterTerminalByLocation = m;
      } else {
        ov.pos.waiterTerminalDeviceId = dev;
        ov.pos.waiterTerminalName = nm;
      }
    }
    if (b.pinMode !== undefined) {
      const m = b.pinMode === 'staff' ? 'staff' : 'single';
      if (loc) setMap('waiterPinModeByLocation', m); else ov.pos.waiterPinMode = m;
    }
    if (b.staff !== undefined) {
      // Merge with the existing roster by id so a name edit doesn't require
      // re-typing the (masked) PIN. Names are de-duplicated with a numeric suffix.
      const existing = loc ? ((ov.pos.waiterStaffByLocation || {})[loc] || []) : (ov.pos.waiterStaff || []);
      const byId = new Map(existing.map((s) => [s.id, s]));
      const seenName = new Set(); const out = [];
      for (const raw of (Array.isArray(b.staff) ? b.staff : []).slice(0, 60)) {
        let name = String(raw.name || '').trim().slice(0, 40); if (!name) continue;
        const provided = raw.pin != null && String(raw.pin).trim() ? String(raw.pin).trim() : '';
        const pin = provided || (byId.get(raw.id) ? byId.get(raw.id).pin : '');
        if (provided && !/^\d{4,8}$/.test(provided)) return res.status(400).json({ error: `PIN for ${name} must be 4–8 digits.` });
        if (!pin) continue; // a staff member with no PIN can't log in — skip
        let base = name, n = 1, key = name.toLowerCase();
        while (seenName.has(key)) { n += 1; name = `${base}${n}`; key = name.toLowerCase(); }
        seenName.add(key);
        out.push({ id: raw.id || require('crypto').randomUUID(), name, pin });
      }
      const pins = out.map((s) => s.pin);
      if (new Set(pins).size !== pins.length) return res.status(400).json({ error: 'Two staff have the same PIN — each needs a unique one.' });
      const others = otherPins('staff', loc);
      const clash = out.find((s) => others.has(s.pin));
      if (clash) return res.status(400).json({ error: `${clash.name}’s PIN is already used somewhere else — every PIN must be unique.` });
      if (loc) setMap('waiterStaffByLocation', out); else ov.pos.waiterStaff = out;
    }
    if (b.suspended !== undefined) {
      if (loc) setMap('waiterSuspendedByLocation', b.suspended === true ? true : undefined);
      else ov.pos.waiterSuspended = b.suspended === true;
    }
    await db.saveOverrides(ov);
    const p = ov.pos; const eff = effectiveWaiter(p, loc);
    res.json({ ok: true, locationId: loc, waiterEnabled: eff.enabled, suspended: eff.suspended, hasWaiterPin: !!eff.pin, waiterTables: eff.tables, waiterPinMode: eff.mode, waiterStaff: eff.staff.map((s) => ({ id: s.id, name: s.name })) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/admin/kds/config', (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  // The screen may ask for a specific location's stations (per-location KDS);
  // default to the shared config when none is given.
  const cfg = kds.kdsSettings(req.query.location);
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
    const data = await kds.fetchTickets(locations.squareIdFor(req.query.location), loc, req.query.location);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Set a station's status for one ticket (new | preparing | done). Recall = 'new'.
// Text/email an app customer that their order is ready to collect. Best-effort:
// only fires for orders tied to a customer we can reach; failures are swallowed
// so they never block the kitchen's bump.
async function notifyOrderReady(orderId) {
  try {
    // Channel choice (Admin → Kitchen Screen → Notifications). 'app' = the free
    // in-app tracker only, so we send no SMS/email push here. 'sms'/'both' push.
    const channel = (getSettings().notifications || {}).readyChannel || 'app';
    if (channel !== 'sms' && channel !== 'both') return;
    const order = await orders.getOrder(orderId);
    if (!order) return;
    // Prefer the Square customer's contact; fall back to a phone/email captured
    // on the order itself (bc_phone/bc_email) so a guest / walk-around-QR order
    // that gave a number can still be told it's ready.
    const md = order.metadata || {};
    let cust = null;
    if (order.customer_id) cust = await customers.get(order.customer_id).catch(() => null);
    const phone = (cust && cust.phone_number) || md.bc_phone || '';
    const email = (cust && cust.email_address) || md.bc_email || '';
    if (!phone && !email) return;                          // no way to reach them
    const store = getSettings().storeName || 'Bean Culture';
    const who = md.bc_name || (cust && cust.given_name) || '';
    const msg = `${who ? who + ', y' : 'Y'}our ${store} order is ready for collection ☕`;
    if (phone && notify.smsConfigured) { await notify.sendSMS(phone, msg, { purpose: 'order_ready', orderId }); return; }
    if (email && notify.emailConfigured) { await notify.sendEmail(email, `Your ${store} order is ready`, msg); return; }
  } catch (e) { console.warn('[kds] ready-notify failed:', e.message); }
}

app.post('/api/admin/kds/bump', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { orderId, orderIds, zone, status } = req.body || {};
    if (!zone) return res.status(400).json({ error: 'Missing zone' });
    if (!['new', 'preparing', 'ready', 'done'].includes(status)) return res.status(400).json({ error: 'Bad status' });
    // Bulk: bump every listed order in this station in one request (used by
    // "Bump all"). Falls back to the single-order form for the per-ticket button.
    const ids = Array.isArray(orderIds) ? orderIds.filter(Boolean) : (orderId ? [orderId] : []);
    if (!ids.length) return res.status(400).json({ error: 'Missing orderId(s)' });
    const rows = [];
    for (const id of ids) rows.push(await db.kdsSetStatus(id, zone, status));
    // "Ready" → text/email the customer their order is ready for collection.
    // Once per order (guarded by a synthetic '__notified__' marker), and only
    // for app orders that carry a customer we can reach.
    if (status === 'ready') {
      const states = await db.kdsGetStates(ids).catch(() => ({}));
      for (const id of ids) {
        if (states[id] && states[id].__notified__) continue;
        notifyOrderReady(id).catch(() => {});
        await db.kdsSetStatus(id, '__notified__', 'ready').catch(() => {});
      }
    }
    kdsBroadcast('bump');
    res.json({ ok: true, count: rows.length, row: rows[0], rows });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Notify: tell an app customer their order is ready — WITHOUT clearing the ticket
// (that's Bump). Marks the order's station(s) 'ready' so the customer's live
// tracker flips to "ready", records the notification (count + timestamp) so staff
// can see how long ago they were told, and re-sends the SMS/email each press so a
// customer who didn't hear the first chime can be reminded. The ticket stays on
// screen (dimmed) until staff Bump it once the order is collected.
app.post('/api/admin/kds/notify', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { orderId, zone, zones } = req.body || {};
    if (!orderId) return res.status(400).json({ error: 'Missing orderId' });
    // The station lane(s) to mark ready — a single zone, or the order's real
    // stations when notifying from the "All orders" lane.
    const targets = (Array.isArray(zones) ? zones : [zone]).filter(Boolean);
    if (!targets.length) return res.status(400).json({ error: 'Missing zone' });
    for (const z of targets) await db.kdsSetStatus(orderId, z, 'ready');
    // Record this notification (count++ / last-notified = now).
    const n = await db.kdsNotify(orderId);
    // Re-send the SMS/email each press — the whole point of Notify-again is to
    // remind a customer who missed it. Best-effort; never blocks the response.
    notifyOrderReady(orderId).catch(() => {});
    kdsBroadcast('bump');
    res.json({ ok: true, notifyCount: n.count, notifiedAt: n.at });
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
// Store comparison: one row of headline metrics per store over `days` —
// order count, revenue, the app-vs-POS split and how many came in via the
// walk-around QR (bc_src='qr'). Feeds the Insights "Compare stores" table.
app.get('/api/admin/analytics/compare', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const tz = (getSettings().contact && getSettings().contact.timezone) || 'Australia/Sydney';
    // range wins over days: today (local), week (Mon→now), or a rolling N days.
    const range = String(req.query.range || '').toLowerCase();
    const days = Math.max(1, Math.min(90, parseInt(req.query.days, 10) || 7));
    const cacheKey = `compare|${range}|${days}`;
    const cached = analyticsCache(cacheKey, 60_000);
    if (cached) return res.json(cached);
    const todayStr = dayInTz(new Date().toISOString(), tz);
    let mondayStr = todayStr;
    if (range === 'week') {
      const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const wd = names.indexOf(new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(new Date()));
      const daysSinceMon = (wd + 6) % 7;
      mondayStr = dayInTz(new Date(Date.now() - daysSinceMon * 86400000).toISOString(), tz);
    }
    // How far back to actually fetch, then filter precisely by local day.
    const lookbackDays = range === 'today' ? 2 : range === 'week' ? 9 : days;
    const startAt = new Date(Date.now() - lookbackDays * 86400000).toISOString();
    const withinRange = (iso) => {
      if (range === 'today') return dayInTz(iso, tz) === todayStr;
      if (range === 'week') return dayInTz(iso, tz) >= mondayStr;   // YYYY-MM-DD sorts lexically
      return true;   // rolling window already bounded by startAt
    };
    const stores = locations.active();
    const out = [];
    for (const store of stores) {
      const m = { id: store.id, name: store.name, orders: 0, revenue: 0, app: 0, pos: 0, other: 0, qr: 0 };
      let cursor; let pages = 0;
      do {
        const data = await sq.squareFetch('/v2/orders/search', {
          method: 'POST',
          body: {
            location_ids: [store.squareLocationId], cursor,
            query: {
              // Include OPEN as well as COMPLETED: POS/app card orders keep a
              // fulfilment and usually stay OPEN after payment, so a COMPLETED-only
              // filter dropped every one (0 POS, $0 revenue). Gate on "paid" below.
              filter: { date_time_filter: { created_at: { start_at: startAt } }, state_filter: { states: ['COMPLETED', 'OPEN'] } },
              sort: { sort_field: 'CREATED_AT', sort_order: 'DESC' },
            },
            limit: 500,
          },
        }).catch(() => ({}));
        for (const o of (data.orders || [])) {
          // Attribute each order to exactly one store — same rule as the KDS:
          // an event store gets only its bc_event-tagged orders; a normal store
          // gets orders that aren't an event's and aren't tagged to a different
          // store sharing its Square location (untagged POS/counter orders count).
          const md = o.metadata || {};
          if (o.state === 'CANCELED') continue;
          if (!withinRange(o.created_at)) continue;
          // Paid only: COMPLETED (incl. free $0 comps) or OPEN with a tender.
          // Excludes held/abandoned card checkouts + plain unpaid tickets so
          // takings aren't inflated by non-sales.
          const paid = o.state === 'COMPLETED' || (Array.isArray(o.tenders) && o.tenders.length > 0);
          if (!paid) continue;
          if (md.bc_hold === '1' && !((o.tenders || []).length)) continue;
          if (store.type === 'event') { if (md.bc_event !== store.id) continue; }
          else { if (md.bc_event) continue; if (md.bc_store && md.bc_store !== store.id) continue; }
          m.orders += 1;
          m.revenue += (o.total_money && o.total_money.amount) || 0;
          m[saleSource(o.source && o.source.name)] += 1;
          if (o.metadata && o.metadata.bc_src === 'qr') m.qr += 1;
        }
        cursor = data.cursor; pages += 1;
      } while (cursor && pages < 6);
      out.push(m);
    }
    const totals = out.reduce((t, s) => ({
      orders: t.orders + s.orders, revenue: t.revenue + s.revenue,
      app: t.app + s.app, pos: t.pos + s.pos, other: t.other + s.other, qr: t.qr + s.qr,
    }), { orders: 0, revenue: 0, app: 0, pos: 0, other: 0, qr: 0 });
    const payload = { days, range: range || null, currency: sq.CURRENCY, stores: out, totals };
    analyticsCacheSet(cacheKey, payload);
    res.json(payload);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

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
              // Include OPEN as well as COMPLETED: app orders keep a PICKUP
              // fulfilment and usually stay OPEN after payment, so a COMPLETED-only
              // filter hides every app sale. We gate on "paid" below instead.
              filter: { date_time_filter: { created_at: { start_at: startAt } }, state_filter: { states: ['COMPLETED', 'OPEN'] } },
              sort: { sort_field: 'CREATED_AT', sort_order: 'DESC' },
            },
            limit: 500,
          },
        }).catch(() => ({}));
        for (const o of (data.orders || [])) {
          const amt = (o.total_money && o.total_money.amount) || 0;
          // A real sale = paid: COMPLETED, or OPEN with a tender. Skips unpaid /
          // abandoned app tickets (held, no tender) so they aren't counted.
          const paid = o.state === 'COMPLETED' || (Array.isArray(o.tenders) && o.tenders.length > 0);
          if (!paid || amt <= 0) continue;
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

// ---- Admin: App sales report — every app (self-order) sale by day, plus the
// best customer for the period. Period = days (1 = today … up to 366). App orders
// are counted whether COMPLETED or paid-OPEN, so nothing is missed. ----
app.get('/api/admin/analytics/app-sales', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const tz = (getSettings().contact && getSettings().contact.timezone) || 'Australia/Sydney';
    // Two modes: a single venue-local DAY (date=YYYY-MM-DD, what the dashboard
    // card uses — "today or the date you selected") or a rolling N-day window.
    const dateParam = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : null;
    const days = Math.max(1, Math.min(366, parseInt(req.query.days, 10) || 1));
    const cacheKey = dateParam ? `appsales|date|${dateParam}` : `appsales|days|${days}`;
    const cached = analyticsCache(cacheKey, 60_000);
    if (cached) return res.json(cached);
    // For a specific date, scan from ~26h before its UTC midnight (covers the AU
    // tz offset) and filter precisely by the venue-local day below.
    const startAt = dateParam
      ? new Date(new Date(dateParam + 'T00:00:00Z').getTime() - 26 * 3600000).toISOString()
      : new Date(Date.now() - days * 86400000).toISOString();
    // Bound the date view to ~2 days around the chosen day so a past date doesn't
    // scan every order since; the precise venue-local day filter runs below.
    const endAt = dateParam ? new Date(new Date(dateParam + 'T00:00:00Z').getTime() + 26 * 3600000).toISOString() : null;
    const stores = locations.active();
    const byDay = {};              // date -> { total, count }
    const byCust = new Map();      // customerId -> { total, count }
    const collected = [];          // { o, storeName } — full orders for detail
    let total = 0, count = 0, guestTotal = 0, guestCount = 0;
    for (const store of stores) {
      let cursor; let pages = 0;
      do {
        const data = await sq.squareFetch('/v2/orders/search', {
          method: 'POST',
          body: {
            location_ids: [store.squareLocationId], cursor,
            query: { filter: { date_time_filter: { created_at: { start_at: startAt, ...(endAt ? { end_at: endAt } : {}) } }, state_filter: { states: ['COMPLETED', 'OPEN'] } }, sort: { sort_field: 'CREATED_AT', sort_order: 'DESC' } },
            limit: 500,
          },
        }).catch(() => ({}));
        for (const o of (data.orders || [])) {
          if (saleSource(o.source && o.source.name) !== 'app') continue; // app self-order only
          const amt = (o.total_money && o.total_money.amount) || 0;
          const paid = o.state === 'COMPLETED' || (Array.isArray(o.tenders) && o.tenders.length > 0);
          if (!paid || amt <= 0) continue;
          const day = dayInTz(o.created_at, tz);
          if (dateParam && day !== dateParam) continue;   // only the chosen day
          const r = byDay[day] || (byDay[day] = { total: 0, count: 0 });
          r.total += amt; r.count += 1; total += amt; count += 1;
          const cid = o.customer_id || null;
          if (cid) { const c = byCust.get(cid) || { total: 0, count: 0 }; c.total += amt; c.count += 1; byCust.set(cid, c); }
          else { guestTotal += amt; guestCount += 1; }
          if (collected.length < 200) collected.push({ o, storeName: store.name });
        }
        cursor = data.cursor; pages += 1;
      } while (cursor && pages < 12);
    }
    const ranked = [...byCust.entries()].sort((a, b) => b[1].total - a[1].total);
    const topIds = ranked.slice(0, 10).map(([id]) => id);
    collected.sort((a, b) => new Date(b.o.created_at) - new Date(a.o.created_at));
    const joinIds = [...new Set([...topIds, ...collected.map((c) => c.o.customer_id).filter(Boolean)])];
    const custMap = new Map();
    for (let i = 0; i < joinIds.length; i += 100) {
      try {
        const d = await sq.squareFetch('/v2/customers/bulk-retrieve', { method: 'POST', body: { customer_ids: joinIds.slice(i, i + 100) } });
        for (const [id, r] of Object.entries(d.responses || {})) if (r.customer) custMap.set(id, r.customer);
      } catch { /* thinner names on a failed chunk */ }
    }
    const nameOf = (id) => { const c = id && custMap.get(id); return c ? ([c.given_name, c.family_name].filter(Boolean).join(' ').trim() || c.company_name || c.nickname || '') : ''; };
    const phoneOf = (id) => { const c = id && custMap.get(id); return (c && c.phone_number) || ''; };
    const topCustomers = ranked.slice(0, 10).map(([id, v]) => ({ name: nameOf(id) || 'Guest', phone: phoneOf(id), total: v.total, count: v.count }));
    const daily = Object.keys(byDay).sort().map((date) => ({ date, ...byDay[date] }));
    // ── Per-order detail: items, payment method, and points used / earned. ──
    const tenderMap = { CARD: 'Card', CASH: 'Cash', SQUARE_GIFT_CARD: 'Gift card', WALLET: 'Wallet', BANK_ACCOUNT: 'Bank', BUY_NOW_PAY_LATER: 'Afterpay', EXTERNAL: 'External', OTHER: 'Other' };
    const tenderLabel = (o) => { const t = [...new Set((o.tenders || []).map((x) => tenderMap[x.type] || x.type).filter(Boolean))]; return t.join(', ') || (o.state === 'COMPLETED' ? 'Paid' : '—'); };
    const detailList = collected.slice(0, dateParam ? 80 : 60);
    // The loyalty "points earned" lookup is one call per order, so only do it for
    // a bounded single-day view (where the owner is inspecting individual sales).
    const wantPoints = !!dateParam && detailList.length <= 60;
    const orders = [];
    for (const { o, storeName } of detailList) {
      const cid = o.customer_id || null;
      let pointsEarned = null;
      if (wantPoints) { try { const ev = await loyalty.eventsForOrder(o.id); pointsEarned = ev.earned; } catch { pointsEarned = null; } }
      orders.push({
        id: o.id,
        at: o.created_at,
        total: (o.total_money && o.total_money.amount) || 0,
        amount: (o.total_money && o.total_money.amount) || 0,
        store: storeName,
        name: cid ? (nameOf(cid) || 'Guest') : 'Guest',
        phone: cid ? phoneOf(cid) : '',
        payment: tenderLabel(o),
        freeCoffees: Number((o.metadata || {}).bc_loyfree) || 0,  // free coffees redeemed
        pointsEarned,  // Stars accumulated (null when not looked up)
        items: (o.line_items || []).map((li) => ({
          qty: li.quantity || '1',
          name: li.name || 'Item',
          variation: li.variation_name || '',
          modifiers: (li.modifiers || []).map((m) => m.name).filter(Boolean).join(', '),
          amount: (li.total_money && li.total_money.amount) || 0,
        })),
      });
    }
    const payload = { date: dateParam, days: dateParam ? undefined : days, currency: sq.CURRENCY, total, count, daily, topCustomers, best: topCustomers[0] || null, guestTotal, guestCount, orders, sales: orders };
    analyticsCacheSet(cacheKey, payload);
    res.json(payload);
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
app.get('/api/coupon', async (req, res) => {
  try {
    const code = String(req.query.code || '').trim();
    // The built-in comp code (env COMP_COUPON_CODE) rings up 100% off — the
    // order pipeline already honours it; surface it here too so the checkout
    // shows "Complimentary" instead of a price the buyer would still see.
    if (COMP_COUPON_CODE && code.toLowerCase() === COMP_COUPON_CODE.toLowerCase()) {
      return res.json({ valid: true, code: code.toUpperCase(), type: 'comp', value: 100, comp: true, label: 'Complimentary' });
    }
    const c = coupons.find(code);
    if (!c) return res.json({ valid: false });
    // Judge the coupon's conditions with the signed-in customer's real context.
    const ctx = await couponContextFor(req.query.customerId, c);
    const elig = coupons.isEligible(c, ctx);
    const type = c.type || 'percent';
    if (!elig.ok) {
      return res.json({ valid: false, reason: elig.reason, code: String(c.code).toUpperCase(), condition: coupons.conditionLabel(c), label: coupons.label(c) });
    }
    res.json({
      valid: true,
      code: String(c.code).toUpperCase(),
      type,
      value: Number(c.value) || 0,
      comp: type === 'comp',
      upgrade: type === 'upgrade',
      label: coupons.label(c),
      condition: coupons.conditionLabel(c),
    });
  } catch (e) { res.json({ valid: false }); }
});

// ---- Customer birthday (for the birthday gift; locked once set) ----
// Stored on the Square customer with a blank year; we keep only month + day.
app.get('/api/profile/birthday', async (req, res) => {
  try {
    const bd = await customers.getBirthday(req.query.customerId);
    res.json({ birthday: bd || '', locked: !!bd });
  } catch (e) { res.json({ birthday: '', locked: false }); }
});
app.post('/api/profile/birthday', async (req, res) => {
  try {
    const { customerId, birthday } = req.body || {};
    if (!customerId) return res.status(400).json({ error: 'Please sign in first.' });
    // Locked once set: the customer confirms it ONCE and can't change it in the
    // app afterwards (an owner can amend it in Square if it was a genuine error).
    const existing = await customers.getBirthday(customerId).catch(() => '');
    if (existing) return res.status(409).json({ error: 'Your birthday is already set and locked. Contact us if it needs correcting.', birthday: existing, locked: true });
    const saved = await customers.setBirthday(customerId, birthday);
    res.json({ ok: true, birthday: saved, locked: true });
  } catch (e) { res.status(400).json({ error: e.message || 'Could not save your birthday.' }); }
});

// Today's month-day / year in the venue timezone.
function todayMMDDInTz(tz) {
  const p = {}; for (const x of new Intl.DateTimeFormat('en-CA', { timeZone: tz, month: '2-digit', day: '2-digit' }).formatToParts(new Date())) p[x.type] = x.value;
  return `${p.month}-${p.day}`;
}
function yearInTz(tz) { return Number(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric' }).format(new Date())); }

// Is this signed-in customer eligible for their birthday gift right now?
async function birthdayEligibility(customerId) {
  const s = getSettings().birthday || {};
  const valueCents = Math.max(0, Number(s.valueCents) || 0);
  if (!s.enabled) return { eligible: false, reason: 'disabled' };
  if (!customerId) return { eligible: false, reason: 'not_signed_in', valueCents };
  const tz = (getSettings().contact && getSettings().contact.timezone) || 'Australia/Sydney';
  const bday = await customers.getBirthday(customerId).catch(() => '');
  const base = { valueCents, bday, title: s.bannerTitle, message: s.bannerMessage };
  if (!bday) return { eligible: false, reason: 'no_birthday', ...base };
  const win = Math.max(0, Math.min(31, Number(s.windowDays) || 0));
  const dist = coupons.mmddDistance(todayMMDDInTz(tz), bday);
  if (dist == null || dist > win) return { eligible: false, reason: 'not_birthday', ...base };
  // Must have COMPLETED an app purchase before the birthday (a prior order).
  const hist = await orders.getHistory(customerId, 5).catch(() => []);
  if (!(hist && hist.length >= 1)) return { eligible: false, reason: 'no_purchase', ...base };
  const year = yearInTz(tz);
  if (await db.birthdayRedeemedThisYear(customerId, year).catch(() => false)) return { eligible: false, reason: 'already_used', ...base };
  return { eligible: true, year, ...base };
}

// Client checks this on checkout / home to show the birthday banner + gift.
app.get('/api/birthday/offer', async (req, res) => {
  try {
    const el = await birthdayEligibility(req.query.customerId);
    const s = getSettings().birthday || {};
    res.json({ ...el, terms: s.terms || '', bannerImage: s.bannerImage || '' });
  } catch (e) { res.json({ eligible: false, reason: 'error' }); }
});

// Days until the next occurrence of a MM-DD birthday (0 = today).
function daysUntilMMDD(todayMMDD, bMMDD) {
  const [tm, td] = String(todayMMDD).split('-').map(Number);
  const [bm, bd] = String(bMMDD).split('-').map(Number);
  const t = Date.UTC(2001, (tm || 1) - 1, td || 1);
  let b = Date.UTC(2001, (bm || 1) - 1, bd || 1);
  if (b < t) b = Date.UTC(2002, (bm || 1) - 1, bd || 1);
  return Math.round((b - t) / 86400000);
}

// Total paid spend + order count per customer over a window (cached).
async function spendByCustomer(days = 365) {
  const cacheKey = `spendcust|${days}`;
  const cached = analyticsCache(cacheKey, 300000);
  if (cached) return cached;
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const map = {};
  for (const store of locations.active()) {
    let cursor; let pages = 0;
    do {
      const data = await sq.squareFetch('/v2/orders/search', {
        method: 'POST',
        body: { location_ids: [store.squareLocationId], cursor, query: { filter: { date_time_filter: { created_at: { start_at: since } }, state_filter: { states: ['COMPLETED', 'OPEN'] } } }, limit: 500 },
      }).catch(() => ({}));
      for (const o of (data.orders || [])) {
        const cid = o.customer_id; if (!cid) continue;
        const paid = o.state === 'COMPLETED' || (Array.isArray(o.tenders) && o.tenders.length > 0);
        if (!paid) continue;
        const e = map[cid] || (map[cid] = { cents: 0, orders: 0 });
        e.cents += (o.total_money && o.total_money.amount) || 0; e.orders += 1;
      }
      cursor = data.cursor; pages += 1;
    } while (cursor && pages < 20);
  }
  analyticsCacheSet(cacheKey, map);
  return map;
}

// ---- Admin: birthday roster — who's next, who's spent the most, redeemed? ----
app.get('/api/admin/birthdays', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const tz = (getSettings().contact && getSettings().contact.timezone) || 'Australia/Sydney';
    const todayMMDD = todayMMDDInTz(tz);
    const year = yearInTz(tz);
    const [users, spend, redeemed] = await Promise.all([
      loyalty.listLoyaltyUsers(),
      spendByCustomer(365).catch(() => ({})),
      db.birthdayRedeemedSet(year).catch(() => new Set()),
    ]);
    const rows = users.filter((u) => u.birthday && u.customerId).map((u) => {
      const sp = spend[u.customerId] || { cents: 0, orders: 0 };
      const daysUntil = daysUntilMMDD(todayMMDD, u.birthday);
      return {
        customerId: u.customerId, name: u.name || 'Member', phone: u.phone || '',
        birthday: u.birthday, daysUntil, isToday: daysUntil === 0,
        redeemedThisYear: redeemed.has(u.customerId),
        spendCents: sp.cents, spendOrders: sp.orders,
        points: u.points, lifetimePoints: u.lifetimePoints,
      };
    });
    rows.sort((a, b) => a.daysUntil - b.daysUntil || b.spendCents - a.spendCents);
    res.json({ rows, currency: sq.CURRENCY, year });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Admin: set/correct a customer's birthday (bypasses the in-app lock) ----
app.post('/api/admin/birthday/set', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { customerId, birthday } = req.body || {};
    if (!customerId) return res.status(400).json({ error: 'Missing customer' });
    const saved = await customers.setBirthday(customerId, birthday);
    res.json({ ok: true, birthday: saved });
  } catch (e) { res.status(400).json({ error: e.message || 'Could not save.' }); }
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

// ---- Admin: manually adjust a member's loyalty points (Square-authoritative) ----
// points can be positive (grant) or negative (deduct). reason shows in Square's
// loyalty history. Returns the fresh balance so the Users list updates in place.
app.post('/api/admin/loyalty/adjust', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { accountId, points, reason } = req.body || {};
    const n = Math.trunc(Number(points));
    if (!accountId) return res.status(400).json({ error: 'Missing account' });
    if (!Number.isFinite(n) || n === 0) return res.status(400).json({ error: 'Enter a non-zero whole number of points' });
    const ok = await loyalty.adjustPoints({ accountId, points: n, reason: reason || (n > 0 ? 'Manual grant' : 'Manual deduction') });
    if (!ok) return res.status(400).json({ error: 'Square rejected the adjustment (a deduction cannot exceed the current balance).' });
    const bal = await loyalty.getBalance(accountId);
    res.json({ ok: true, points: bal ? bal.balance : null, lifetimePoints: bal ? bal.lifetime : null });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ---- Admin: enrol a new loyalty member (name + phone) ----
app.post('/api/admin/loyalty/enroll', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { phone, name } = req.body || {};
    if (!phone || !String(phone).trim()) return res.status(400).json({ error: 'Phone is required' });
    const cust = await customers.findOrCreate({ phone, name });
    const acct = await loyalty.enrollAccount({ phone: cust.phone, customerId: cust.customerId });
    if (!acct) return res.status(400).json({ error: 'Loyalty program is not active, or enrolment failed.' });
    res.json({ ok: true, user: {
      id: acct.id, customerId: cust.customerId, name: cust.name || '', phone: cust.phone,
      email: '', points: acct.balance || 0, lifetimePoints: acct.balance || 0, redeemedPoints: 0,
      redemptions: 0, lastRedeemedAt: null, enrolledAt: new Date().toISOString(), existed: !!acct.existed,
    } });
  } catch (e) { res.status(400).json({ error: e.message || 'Could not enrol' }); }
});

// ---- Admin: one member's full points ledger ----
app.get('/api/admin/loyalty/history', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { accountId } = req.query;
    if (!accountId) return res.status(400).json({ error: 'Missing account' });
    res.json({ events: await loyalty.accountHistory(accountId, 50) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ---- Admin: edit a member's Square profile (name / email / phone) ----
app.post('/api/admin/loyalty/profile', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { customerId, name, email, phone } = req.body || {};
    if (!customerId) return res.status(400).json({ error: 'Missing customer' });
    const c = await customers.updateProfile(customerId, { name, email, phone });
    res.json({ ok: true, name: (c && c.given_name) || '', email: (c && c.email_address) || '', phone: (c && c.phone_number) || '' });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ---- Admin: which broadcast channels are configured ----
app.get('/api/admin/notify-status', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  const n = getSettings().notifications || {};
  const cfg = n.smsCredits || {};
  const enforce = !!cfg.enforce;
  const lowAt = Number(cfg.lowAt) >= 0 ? Number(cfg.lowAt) : 20;
  const [counts, balance] = await Promise.all([
    db.smsCounts().catch(() => ({ total: 0, last30: 0, month: 0 })),
    enforce ? db.smsCreditsGet().catch(() => 0) : Promise.resolve(null),
  ]);
  res.json({
    sms: !!notify.smsConfigured,
    email: !!notify.emailConfigured,
    readyChannel: ['app', 'sms', 'both'].includes(n.readyChannel) ? n.readyChannel : 'app',
    smsCounts: counts,
    credits: { enforce, lowAt, balance, low: enforce && balance != null && balance <= lowAt, empty: enforce && balance != null && balance <= 0 },
    dbEnabled: db.enabled,
  });
});

// ---- Admin: set the order-ready notification channel + SMS credit policy ----
// Read-modify-write of the overrides (safe partial save), like the POS options.
app.post('/api/admin/notify-config', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (!db.enabled) return res.status(400).json({ error: 'A database is required to save this.' });
  try {
    const b = req.body || {};
    const ov = db.getOverrides() || {};
    ov.notifications = ov.notifications || {};
    if (b.readyChannel !== undefined) {
      if (!['app', 'sms', 'both'].includes(b.readyChannel)) return res.status(400).json({ error: 'Bad channel' });
      ov.notifications.readyChannel = b.readyChannel;
    }
    if (b.enforce !== undefined || b.lowAt !== undefined) {
      ov.notifications.smsCredits = { ...(ov.notifications.smsCredits || {}) };
      if (b.enforce !== undefined) ov.notifications.smsCredits.enforce = b.enforce === true;
      if (b.lowAt !== undefined) ov.notifications.smsCredits.lowAt = Math.max(0, parseInt(b.lowAt, 10) || 0);
    }
    await db.saveOverrides(ov);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ---- Admin: top up (or adjust) the prepaid SMS credit balance ----
app.post('/api/admin/sms-credits', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (!db.enabled) return res.status(400).json({ error: 'A database is required to store credits.' });
  try {
    const add = Math.round(Number((req.body || {}).add) || 0);
    if (!add) return res.status(400).json({ error: 'Nothing to add' });
    const balance = await db.smsCreditsAdd(add);
    res.json({ ok: true, balance });
  } catch (e) { res.status(400).json({ error: e.message }); }
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
// Apple Pay domain verification. The association file is committed at
// server/apple-pay-domain-association.txt and served EXACTLY as Apple expects
// (the file is the source of truth — an env var truncates on large values,
// which makes Apple report a "partial response"). Read once at boot; the
// APPLE_PAY_DOMAIN_ASSOCIATION env var is only a fallback if the file is absent.
const APPLE_PAY_ASSOC = (() => {
  try { return require('fs').readFileSync(path.join(__dirname, 'apple-pay-domain-association.txt'), 'utf8'); }
  catch { return process.env.APPLE_PAY_DOMAIN_ASSOCIATION || ''; }
})();
app.get('/.well-known/apple-developer-merchantid-domain-association', (_req, res) => {
  if (!APPLE_PAY_ASSOC) return res.status(404).send('Apple Pay domain association not configured.');
  res.type('text/plain').send(APPLE_PAY_ASSOC);
});

// Customer Display (CDS) web app manifest — served DYNAMICALLY so the installed
// home-screen icon sticks to the location it was saved from. The display page is
// /display?s=<station>; whatever station the icon was installed from is baked
// into start_url here, so relaunching the CDS app always reopens that screen.
// Registered before express.static so it wins over any static file of this name.
app.get('/cds.webmanifest', (req, res) => {
  const s = String(req.query.s || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60);
  const start = s ? `/display?s=${encodeURIComponent(s)}` : '/display';
  res.setHeader('Cache-Control', 'no-cache');
  res.type('application/manifest+json').send(JSON.stringify({
    name: s ? `Bean Culture CDS · ${s}` : 'Bean Culture CDS',
    short_name: 'CDS',
    description: 'Bean Culture customer display screen.',
    start_url: start,
    scope: '/display',
    id: start,                      // unique per station → each location installs as its own CDS app
    // Fullscreen so the installed CDS hides the Android status bar (clock/battery/
    // wifi) and runs edge-to-edge. display_override lets browsers pick fullscreen
    // first and fall back to standalone if unsupported.
    display: 'fullscreen',
    display_override: ['fullscreen', 'standalone'],
    orientation: 'landscape',
    background_color: '#16265e',
    theme_color: '#16265e',
    icons: [
      { src: '/icons/cds-icon-192.png?v=20260916', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/cds-icon-512.png?v=20260916', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/cds-icon-1024.png?v=20260916', sizes: '1024x1024', type: 'image/png', purpose: 'any' },
      { src: '/icons/cds-maskable-512.png?v=20260916', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }, null, 2));
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

// Same idea for the FOH / waiter table-service app: installing from /foh gives a
// dedicated "Bean Culture FOH" home-screen app (start_url:/foh), its own icon.
function fohShell(html) {
  return html
    .replace(/<link rel="manifest" href="\/manifest\.webmanifest"\s*\/?>/,
             '<link rel="manifest" href="/foh.webmanifest" />')
    .replace(/<link rel="apple-touch-icon"[^>]*>/,
             '<link rel="apple-touch-icon" href="/icons/foh-icon-180.png?v=20260916" />')
    .replace(/<meta name="apple-mobile-web-app-title" content="[^"]*"\s*\/?>/,
             '<meta name="apple-mobile-web-app-title" content="Bean Culture FOH" />')
    .replace(/<meta name="theme-color" content="[^"]*"\s*\/?>/,
             '<meta name="theme-color" content="#103a34" />');
}

// Customer Display (CDS): installing from /display?s=<station> gives a dedicated
// "Bean Culture CDS" home-screen app whose manifest (and therefore start_url) is
// pinned to that station, so the saved icon always reopens that location's screen.
function displayShell(html, station) {
  const s = String(station || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60);
  const href = s ? `/cds.webmanifest?s=${encodeURIComponent(s)}` : '/cds.webmanifest';
  return html
    .replace(/<link rel="manifest" href="\/manifest\.webmanifest"\s*\/?>/,
             `<link rel="manifest" href="${href}" />`)
    .replace(/<link rel="apple-touch-icon"[^>]*>/,
             '<link rel="apple-touch-icon" href="/icons/cds-icon-180.png?v=20260916" />')
    .replace(/<meta name="apple-mobile-web-app-title" content="[^"]*"\s*\/?>/,
             `<meta name="apple-mobile-web-app-title" content="${s ? 'CDS · ' + seoEsc(s) : 'Bean Culture CDS'}" />`)
    .replace(/<meta name="theme-color" content="[^"]*"\s*\/?>/,
             '<meta name="theme-color" content="#16265e" />');
}

app.get('*', async (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  const isKds = req.path === '/kds' || req.path === '/bump' || req.path.startsWith('/kds/');
  const isPos = req.path === '/pos' || req.path.startsWith('/pos/');
  const isFoh = req.path === '/foh' || req.path === '/waiter' || req.path.startsWith('/foh/');
  const isDisplay = req.path === '/display';
  let head = seoHead(req), body = '', title = '';
  try {
    if (isKds) {
      title = 'Bean Culture · Kitchen screen';
    } else if (isPos) {
      title = 'Bean Culture · POS';
    } else if (isFoh) {
      title = 'Bean Culture · FOH';
    } else if (isDisplay) {
      title = 'Bean Culture · Display';
    } else if (/^\/(item|menu)\//i.test(req.path)) {
      const menu = await seoMenu();
      const pg = pageSeoAndBody(req, resolvePath(menu, req.path), menu);
      if (pg) { head = pg.head; body = pg.body; title = pg.title; }
    } else if (req.path === '/' || req.path === '') {
      body = homeBody(await seoMenu(), req);
    }
  } catch { /* fall back to base head */ }
  // Stamp the LOADED page with the running deploy id so the client can tell when
  // it's stale (a resumed home-screen PWA on an old bundle) and reload itself.
  const buildTag = `<script>window.__BUILD__=${JSON.stringify(BUILD_ID)};</script>`;
  let html = indexHtml().replace('</head>', `    ${head}\n    ${buildTag}\n  </head>`);
  if (title) html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${seoEsc(title)}</title>`);
  if (body) html = html.replace('<div id="root">', `<div id="root">${body}`);
  if (isKds) html = kdsShell(html);
  else if (isPos) html = posShell(html);
  else if (isFoh) html = fohShell(html);
  else if (isDisplay) html = displayShell(html, req.query.s);
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
  // NOTE: purgeExcludedPresets() and syncPresetsWithSquare() are DISABLED. They
  // automatically deleted the owner's hand-built Product Builder tiles on every
  // boot / timer (a partial or mismatched Square read, or a stale "excluded"
  // list, wiped whole categories like COFFEE and persisted it). Tile removal is
  // now owner-controlled only — via an explicit delete, or the manual "Sync new
  // variations" button (which is additive-only). Nothing deletes tiles on its own.
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
  // Cancel app orders held for payment that were never paid (declined/abandoned
  // checkouts), so they don't linger as OPEN orders in Square. Runs every 15 min.
  setTimeout(() => orders.sweepHeldOrders().catch(() => {}), 60000);
  setInterval(() => orders.sweepHeldOrders().catch(() => {}), 2 * 60 * 1000);
  // (Automatic product-builder pruning removed — see note above. It was deleting
  // real tiles and persisting the loss on every deploy.)
});

// Reconcile settings.presets against live Square variations and persist. Adds a
// tile for each new variation (new sizes join a tile you've already combined;
// everything else adds separately), drops tiles whose variation was deleted.
// Prices need no sync — the storefront always reads them live.
async function syncPresetsWithSquare() {
  return; // DISABLED: auto-pruning deleted the owner's hand-built tiles. Never run.
  // eslint-disable-next-line no-unreachable
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
  return; // DISABLED: this deleted rebuilt tiles whose variation was on the old "excluded" list. Never run.
  // eslint-disable-next-line no-unreachable
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
