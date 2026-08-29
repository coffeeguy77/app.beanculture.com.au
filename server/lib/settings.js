// App settings: storefront theme (Bean Culture pastel pink), theme presets for
// the customiser, hero slides/ads, and copy. Defaults live here; they can be
// overridden live by setting a SETTINGS_JSON env var in Railway (persists across
// deploys) — the admin page renders/exports that blob.

const DEFAULTS = {
  storeName: 'Bean Culture',
  announcement: '',
  // Store contact + branding.
  contact: { address: '', phone: '', mapsUrl: '', lat: null, lng: null },
  logoUrl: '',
  faviconUrl: '',
  // Store page content (About / Find us page reached from the header).
  storePhoto: '',
  bio: '',
  googleReviewUrl: '',
  supportMessage: '',
  // Opening hours. When useAppHours is on, storeHours (below) is authoritative
  // and overrides Square's business hours. Shape: { MON:[{open:'07:00',close:'15:00'}], … };
  // a day with an empty array is closed. Kitchen hours are separate: when
  // kitchenHoursOn is on, the kitchen (made-to-order categories) uses its own
  // hours; otherwise the kitchen is open whenever the store is. kitchenCategories
  // are made on demand and become unavailable when the kitchen is closed (other
  // categories are pre-made and stay available while the store is open).
  useAppHours: false,
  storeHours: {
    MON: [{ open: '07:00', close: '15:00' }],
    TUE: [{ open: '07:00', close: '15:00' }],
    WED: [{ open: '07:00', close: '15:00' }],
    THU: [{ open: '07:00', close: '15:00' }],
    FRI: [{ open: '07:00', close: '15:00' }],
    SAT: [{ open: '08:00', close: '13:00' }],
    SUN: [],
  },
  kitchenHoursOn: false,
  kitchenHours: {
    MON: [{ open: '07:00', close: '14:00' }],
    TUE: [{ open: '07:00', close: '14:00' }],
    WED: [{ open: '07:00', close: '14:00' }],
    THU: [{ open: '07:00', close: '14:00' }],
    FRI: [{ open: '07:00', close: '14:00' }],
    SAT: [{ open: '08:00', close: '12:30' }],
    SUN: [],
  },
  kitchenCategories: [],
  // Which category the two "order now" CTAs jump to when tapped, by category
  // display name (must match a live menu/section heading exactly). Empty =
  // fall back to the old behaviour (top of the menu / the fulfilment row).
  // kitchenClosingOrderCategory: the "Order now" prompt shown when the kitchen
  // is closing soon (App.jsx notices). preorderCategory: the "Pre-order now"
  // prompt shown when the store itself is currently closed.
  kitchenClosingOrderCategory: 'Lunch',
  preorderCategory: 'Breakfast',
  // Closure dates (annual leave, public holidays). Each entry is either a single
  // day { date:'YYYY-MM-DD' } or a range { from:'YYYY-MM-DD', to:'YYYY-MM-DD' }.
  // annual:true repeats every year on the same month/day(s).
  closures: [],
  // Which Square categories appear in the app (category IDs). Empty = use the
  // "APP" parent category's children automatically (legacy behaviour).
  menuCategories: [],
  // Reservation ticket printing: the variation id of a real Square catalog
  // item to put on each $0 reservation order, so it inherits that item's
  // category print routing (an ad-hoc line item has no category and can
  // silently fail to print). Set from Admin → Reservations → ticket printing
  // setup, which can find/create the item and category in one click. Empty =
  // fall back to SQUARE_RESERVATION_VARIATION_ID (Railway env var) if set,
  // otherwise an ad-hoc line item. reservationItemId is the parent item id
  // (not the variation) — kept alongside so the admin panel can inspect/fix
  // the item's Square category setup without a second lookup.
  reservationVariationId: '',
  // Email address that receives a copy of every new table reservation (set in
  // Admin → Reservations). Overrides the RESERVATION_OWNER_EMAIL env var.
  reservationNotifyEmail: '',
  reservationItemId: '',
  // Custom order for the menu sections on the storefront, as an array of display
  // names (e.g. ['Coffee','All Day Menu',…]). Set from the admin "Menu items
  // offered" ↑/↓ controls. Covers both categories and product sections; names
  // not listed keep their order after the listed ones. Empty = Square's order.
  menuOrder: [],
  // Product sections: hand-picked Square products grouped under a name you
  // choose (e.g. "Breakfast"). They appear as menu sections alongside the
  // category sections, and are surfaced even if their Square category isn't
  // loaded. Each: { id, name, items:[squareItemId], showImages, enabled }.
  productSections: [],
  // Product builder presets: a named "hot link" into ONE variable Square item.
  // Each preset locks a variation and curates which of the item's modifier
  // options the customer sees. Ordered, they submit as the real Square variation
  // + modifier ids, so printers/KDS/reporting work with no new Square products.
  // Each: { id, name, section, sourceItemId, variationId, showImages, enabled,
  //   groups: { [modifierGroupId]: { [modifierId]: 'optional'|'default'|'locked' } } }
  // A modifier not listed is hidden; 'optional' = shown/off, 'default' = shown/on,
  // 'locked' = hidden + always applied (its price is baked into the tile price).
  presets: [],
  // When on, an item that has presets built from it is hidden from the normal
  // menu (its presets represent it), so the big master tile doesn't also show.
  hidePresetSources: true,
  // Combo builder: bundles across DIFFERENT Square items (a burger + a side +
  // a drink) with an automatic dollar-amount discount — our own alternative to
  // Square's native Combo item type, which needs a paid Square Restaurants plan.
  // Nothing is created in Square's Catalog; at checkout the discount is applied
  // as a normal Square order-level discount (server/lib/combos.js), exactly
  // like a coupon, just triggered automatically instead of by a typed code.
  // Each: { id, name, description, image, active, section, discountValue,
  //   groups: [{ id, label, sourceType: 'category'|'items'|'both', categoryName, itemIds:[] }] }
  // A group is satisfied by ANY item in `categoryName` and/or any id in
  // `itemIds` (sourceType picks which of those apply). Every group requires
  // exactly one selection (v1 — no upcharges/min/max like Square's combo UI).
  // `section` places the combo's tile among the storefront's menu sections
  // (default "Combos"). A combo with a group that resolves to zero real items
  // is hidden from the storefront entirely rather than showing broken.
  combos: [],
  // Pay It Forward: buy-a-coffee-for-someone gifting system. Purchasing never
  // creates a live Square order (card payment charges directly, no order_id;
  // points payment creates an invisible bookkeeping order that never prints
  // and never carries a kitchen-routed category) -- only the recipient's
  // actual redemption at checkout creates a real order through the normal
  // pipeline. See server/lib/payItForward.js.
  payItForward: {
    enabled: false,
    // Named coffee presets: { label, valueCents }. A bare number is also accepted
    // (legacy) and rendered as a plain dollar chip.
    suggestedValues: [
      { label: 'Small Coffee', valueCents: 550 },
      { label: 'Large Coffee', valueCents: 650 },
    ],
    allowCustomAmount: true,
    minValueCents: 500,
    maxValueCents: 10000,
    eligibleCategoryIds: [],
    eligibleCategoryNames: [],
    expiryDays: 365,
    allowPointsPayment: true,
    pointsRequiredPerDollar: null,
    smsTemplate: "{{purchaserName}} bought you a coffee at Bean Culture! Tap to claim: {{claimUrl}}",
    messageTemplates: [
      'Thinking of you \u2014 enjoy one on me!',
      'Thanks for everything you do.',
      "Happy Monday, this one's on me.",
      'Just because.',
    ],
    aiMessageSuggestions: false,
    showSocialProofStats: false,
    partialRedemptionAllowed: true,
    noCashChange: true,
  },
  // Loyalty automation. autoEnrollOnSignIn: create a Square Loyalty account on
  // passwordless sign-in. autoEnrollGiftRecipients: enrol a Pay It Forward
  // recipient (by the phone we SMS'd) at redemption so the gifted coffee earns
  // points on their card. firstTransactionBonusPoints: points granted once on a
  // customer's first order (0 = off).
  loyalty: {
    autoEnrollOnSignIn: true,
    autoEnrollGiftRecipients: true,
    firstTransactionBonusPoints: 1,
  },
  // SEO / search-console — editable in Admin -> SEO. Injected into the served
  // HTML head (see seoHead in server/index.js); env vars remain a fallback.
  // googleVerification accepts a full <meta> tag or just the token. headHtml is
  // arbitrary <head> code (other verifications / tracking) injected verbatim.
  seo: {
    googleVerification: '',
    gaMeasurementId: '',
    metaDescription: '',
    ogImage: '',
    headHtml: '',
  },
  // Section display names hidden from the storefront (by name). Used to show/hide
  // product-builder sections from "Menu items offered" without deleting them.
  hiddenSections: [],
  // Default theme — light pastel pink.
  theme: {
    bg: '#fdf1f4',
    surface: '#ffffff',
    ink: '#3b2b30',
    muted: '#9c8890',
    brand: '#b5566e',
    accent: '#d1547a',
    accentInk: '#ffffff',
    line: '#f2dfe6',
  },
  // Presets offered in the theme customiser.
  themePresets: [
    { name: 'Bean Culture Pink', brand: '#b5566e', accent: '#d1547a', bg: '#fdf1f4', ink: '#3b2b30' },
    { name: 'Rose', brand: '#a34a63', accent: '#e0879b', bg: '#fbeef1', ink: '#33232a' },
    { name: 'Latte', brand: '#7a5240', accent: '#b5651d', bg: '#f7f1ea', ink: '#2c2019' },
    { name: 'Matcha', brand: '#4f7a52', accent: '#5a9e63', bg: '#eef5ec', ink: '#25301f' },
    { name: 'Midnight', brand: '#e0879b', accent: '#e0879b', bg: '#1c1720', ink: '#f4eef1' },
  ],
  // Seasonal themes auto-activate between from/to (MM-DD) and are also selectable
  // any time in the theme customiser. `effects` drives the festive overlays.
  // Festive & seasonal themes (Canberra / Australia). Each auto-activates on its
  // date/range (MM-DD), is selectable any time in the customiser, carries a
  // colour scheme, optional falling effect, and an optional banner that is shown
  // #1 in the hero rotation while the theme is active. Owners edit these (dates,
  // colours, banner, enabled) in the admin Theme tab. Variable-date holidays
  // (Easter, Lunar New Year, Mother's/Father's Day) ship with sensible defaults
  // to adjust each year.
  seasonalThemes: [
    {
      id: 'christmas', name: '🎄 Christmas', from: '12-01', to: '12-30', enabled: true,
      theme: { bg: '#073B2A', surface: '#0A4630', ink: '#FFF5DF', muted: '#E9D9B4', brand: '#E9C46A', accent: '#B71320', accentInk: '#FFF5DF', line: 'rgba(216,169,59,0.42)' },
      season: { gold: '#D8A93B', goldLight: '#F1D37B', cream: '#FFF5DF', cream2: '#F7E8C8', red: '#B71320', redDeep: '#961019', green: '#0A4630', greenDeep: '#052D21', cardBg: '#B71320', cardBorder: '#D8A93B', textOnCream: '#33261D' },
      decor: { density: 'rich', perimeter: false, bells: false, snowBank: false },
      effects: { snow: true },
      banner: { title: 'Merry Christmas', subtitle: 'Festive treats & gift-ready coffee bags', cta: 'Order for the holidays', bg: 'linear-gradient(135deg,#0A4630,#B71320)', textColor: '#FFF5DF', link: { type: 'scroll', value: 'menu' } },
    },
    {
      id: 'newyear', name: '🎉 New Year', from: '12-31', to: '01-01', enabled: true,
      theme: { bg: '#0b0f1e', surface: '#141a30', ink: '#f6e9c6', muted: '#b9a96f', brand: '#e7c24a', accent: '#c9a227', accentInk: '#0b0f1e', line: 'rgba(231,194,74,0.4)' },
      effects: { confetti: true },
      banner: { title: 'Happy New Year', subtitle: 'Kick off the year with your favourite', cta: 'Order now', bg: 'linear-gradient(135deg,#141a30,#e7c24a)', textColor: '#fff', link: { type: 'scroll', value: 'menu' } },
    },
    {
      id: 'australiaday', name: '🇦🇺 Australia Day', from: '01-26', to: '01-26', enabled: true,
      theme: { bg: '#0a3d2e', surface: '#0e4a38', ink: '#fbe9a8', muted: '#cbe3c9', brand: '#f4c430', accent: '#1e824c', accentInk: '#08281e', line: 'rgba(244,196,48,0.4)' },
      banner: { title: 'Happy Australia Day', subtitle: 'Green & gold long weekend', cta: 'Order ahead', bg: 'linear-gradient(135deg,#1e824c,#f4c430)', textColor: '#fff', link: { type: 'scroll', value: 'menu' } },
    },
    {
      id: 'lunarnewyear', name: '🧧 Lunar New Year', from: '02-10', to: '02-17', enabled: true,
      theme: { bg: '#5a0f14', surface: '#6d1319', ink: '#ffe9c7', muted: '#e8b98f', brand: '#f6c945', accent: '#d4222a', accentInk: '#fff', line: 'rgba(246,201,69,0.42)' },
      effects: { confetti: true },
      banner: { title: 'Lunar New Year', subtitle: 'Good fortune & good coffee', cta: 'Celebrate with us', bg: 'linear-gradient(135deg,#8a1319,#f6c945)', textColor: '#fff', link: { type: 'scroll', value: 'menu' } },
    },
    {
      id: 'valentines', name: '❤️ Valentine’s Day', from: '02-14', to: '02-14', enabled: true,
      theme: { bg: '#fbe6ee', surface: '#ffffff', ink: '#4a1f2e', muted: '#b3798d', brand: '#d63384', accent: '#e83e8c', accentInk: '#fff', line: '#f6cfe0' },
      effects: { hearts: true },
      banner: { title: 'Happy Valentine’s Day', subtitle: 'Treat someone you love', cta: 'Order a treat', bg: 'linear-gradient(135deg,#ff6b9d,#c02659)', textColor: '#fff', link: { type: 'scroll', value: 'menu' } },
    },
    {
      id: 'stpatricks', name: '☘️ St Patrick’s Day', from: '03-17', to: '03-17', enabled: true,
      theme: { bg: '#0c3b22', surface: '#0f4a2b', ink: '#eaf7d9', muted: '#a9d3ac', brand: '#4caf50', accent: '#f4c430', accentInk: '#0c3b22', line: 'rgba(76,175,80,0.4)' },
      banner: { title: 'Happy St Patrick’s Day', subtitle: 'A little luck with your coffee', cta: 'Order now', bg: 'linear-gradient(135deg,#0f4a2b,#4caf50)', textColor: '#fff', link: { type: 'scroll', value: 'menu' } },
    },
    {
      id: 'easter', name: '🐰 Easter', from: '04-03', to: '04-07', enabled: true,
      theme: { bg: '#fdf3e7', surface: '#ffffff', ink: '#4a3b2a', muted: '#b0a08c', brand: '#8e7cc3', accent: '#f6a5c0', accentInk: '#fff', line: '#efe3d3' },
      effects: { petals: true },
      banner: { title: 'Happy Easter', subtitle: 'Hot cross treats & long-weekend coffee', cta: 'Pre-order for the weekend', bg: 'linear-gradient(135deg,#f6a5c0,#8e7cc3)', textColor: '#fff', link: { type: 'scroll', value: 'menu' } },
    },
    {
      id: 'anzac', name: '🌺 Anzac Day', from: '04-25', to: '04-25', enabled: true,
      theme: { bg: '#2b2620', surface: '#332d26', ink: '#f0e6d2', muted: '#b6a892', brand: '#c1440e', accent: '#7a6f5d', accentInk: '#fff', line: 'rgba(193,68,14,0.4)' },
      banner: { title: 'Lest We Forget', subtitle: 'We honour Anzac Day', cta: 'Order ahead', bg: 'linear-gradient(135deg,#332d26,#c1440e)', textColor: '#f0e6d2', link: { type: 'scroll', value: 'menu' } },
    },
    {
      id: 'mothersday', name: '💐 Mother’s Day', from: '05-10', to: '05-11', enabled: true,
      theme: { bg: '#fbe9f1', surface: '#ffffff', ink: '#4a2436', muted: '#bd8aa2', brand: '#d94f8c', accent: '#f28fb2', accentInk: '#fff', line: '#f4d3e2' },
      effects: { petals: true },
      banner: { title: 'Happy Mother’s Day', subtitle: 'Spoil Mum with a treat', cta: 'Order for Mum', bg: 'linear-gradient(135deg,#f28fb2,#d94f8c)', textColor: '#fff', link: { type: 'scroll', value: 'menu' } },
    },
    {
      id: 'floriade', name: '🌷 Floriade', from: '09-13', to: '10-12', enabled: true,
      theme: { bg: '#fef4e8', surface: '#ffffff', ink: '#3a3320', muted: '#a99d7e', brand: '#e5533c', accent: '#7cb342', accentInk: '#fff', line: '#efe6d0' },
      effects: { petals: true },
      banner: { title: 'Floriade is here', subtitle: 'Canberra’s in bloom — so are we', cta: 'Grab a coffee & go', bg: 'linear-gradient(135deg,#7cb342,#e5533c)', textColor: '#fff', link: { type: 'scroll', value: 'menu' } },
    },
    {
      id: 'fathersday', name: '👔 Father’s Day', from: '09-06', to: '09-07', enabled: true,
      theme: { bg: '#0e2233', surface: '#13314a', ink: '#e6eef5', muted: '#9db4c6', brand: '#3d8bcd', accent: '#c8892f', accentInk: '#fff', line: 'rgba(61,139,205,0.4)' },
      banner: { title: 'Happy Father’s Day', subtitle: 'Sort Dad’s coffee run', cta: 'Order for Dad', bg: 'linear-gradient(135deg,#13314a,#3d8bcd)', textColor: '#fff', link: { type: 'scroll', value: 'menu' } },
    },
    {
      id: 'halloween', name: '🎃 Halloween', from: '10-24', to: '10-31', enabled: true,
      theme: { bg: '#160d1f', surface: '#221434', ink: '#f7e4c4', muted: '#b193c9', brand: '#ff7518', accent: '#7b2ff7', accentInk: '#fff', line: 'rgba(255,117,24,0.4)' },
      banner: { title: 'Spooky season', subtitle: 'Treats worth the haunt', cta: 'Order a treat', bg: 'linear-gradient(135deg,#221434,#ff7518)', textColor: '#fff', link: { type: 'scroll', value: 'menu' } },
    },
  ],
  // Banner box shape (CSS aspect-ratio). All banners share this fixed size;
  // build banners to this shape to fill it edge-to-edge (default 3:2 = 1200x800).
  heroRatio: '3 / 2',
  // Banner auto-scroll: on/off and speed (seconds between slides).
  heroAutoplay: true,
  heroInterval: 5,
  // Maximum storefront width on large screens (px). Caps the whole customer
  // site (header, hero, order bar, content) so nothing over-stretches on wide
  // monitors. Use the string 'full' for an uncapped, edge-to-edge layout.
  siteMaxWidth: 1920,
  // Menu layout: 'onepage' (all categories on one scroll) or 'single' (one
  // category/group at a time, chosen from the footer).
  layoutMode: 'onepage',
  // Top category bar style: 'stacked' (wraps onto rows, expandable) or 'swipe'
  // (single scrolling row). Stacked avoids items running off-screen.
  topMenuStyle: 'stacked',
  // Footer "menu builder": each slot has an icon (from the built-in stroke set)
  // and one OR MORE categories. A multi-category slot combines those sections
  // (e.g. a "Cold" slot with an ice icon = Cold Drinks + Smoothies + Shakes).
  // Available icons: cup, mug, burger, bag, smoothie, can, bean, ice, shake, tea, drink.
  // No hardcoded defaults — the owner builds these, and can auto-add product-
  // builder sections via their Top/Footer toggles (see presetSectionNav).
  footer: [],
  // Top "Browse menu" dock buttons that combine several sections into one
  // (e.g. { label: 'Deals', icon, categories: ['Combos', 'Specials'] }).
  topMenu: [],
  // Per-category icon for the "Browse menu" top dock (name → { icon, iconSvg }).
  // Chosen in Admin → Menu Builder; falls back to an auto-mapped icon by name.
  categoryIcons: {},
  // Global icon size multipliers for the top dock + footer menu (owner-tunable
  // via sliders in Menu Builder). 1 = default; ~0.7–1.6 usable range.
  dockIconScale: 1,
  footerIconScale: 1,
  // Per product-builder-section navigation: { [sectionName]: { top, footer } }.
  // top → the section appears in the top menu links (category chips); footer →
  // it appears as a footer menu link. Set from the Product builder section rows.
  presetSectionNav: {},
  // Hero carousel. Each slide links to a category (by display name), an item id,
  // an external url, or nothing.
  hero: [
    {
      id: 'welcome',
      title: 'Bean Culture',
      subtitle: 'Order ahead — skip the queue',
      cta: 'Browse the menu',
      bg: 'linear-gradient(135deg,#f7c9d6 0%,#d1547a 100%)',
      textColor: '#ffffff',
      link: { type: 'scroll', value: 'menu' },
    },
    {
      id: 'coffee',
      title: 'Specialty coffee',
      subtitle: 'Roasted for Bean Culture',
      cta: 'Order a coffee',
      bg: 'linear-gradient(135deg,#c79a86 0%,#7a5240 100%)',
      textColor: '#ffffff',
      link: { type: 'category', value: 'Coffee' },
    },
    {
      id: 'rewards',
      title: 'Earn as you sip',
      subtitle: '10 points = a free coffee',
      cta: 'Join rewards',
      bg: 'linear-gradient(135deg,#f7c9d6 0%,#b5566e 100%)',
      textColor: '#ffffff',
      link: { type: 'account', value: '' },
    },
  ],
  // ── Availability: kitchen/front-of-house sold-out overrides, per-weekday
  //    exclusion lists, and time+day "menu schedules". All evaluated in the
  //    venue's local time — see catalog.js applyAvailability().
  availability: {
    // Per-item manual overrides, keyed by Square item id:
    //   { mode:'off' }                        → unavailable indefinitely (RED in builder)
    //   { mode:'today', until:'YYYY-MM-DD' }  → sold out until we next open
    //   { mode:'on',    until:'YYYY-MM-DD' }  → forced available today (defeats the
    //                                           day-exclusion list — "make on demand")
    items: {},
    // Auto sold-out lists per weekday (0=Sun … 6=Sat) — e.g. a busy-Saturday list.
    exclusions: { enabled: true, days: {} },
    // Time-of-day + day-of-week menu windows. A category named in a schedule shows
    // ONLY while one of its schedules is active now; categories in no schedule
    // always show.  { id, name, categories:[displayName], days:[0..6],
    //                 start:'07:00', end:'11:00', enabled:true }
    schedules: [],
  },
  // ── Kitchen Display / bump screen (/kds). Stations each show only their
  //    categories' items; an implicit "All orders" lane always exists. Age
  //    thresholds drive the green→amber→red urgency colours.
  // ── Multi-location. Empty = single-site (a "main" location is synthesised from
  //    SQUARE_LOCATION_ID). Each: { id, name, squareLocationId, address, active,
  //    hiddenItemIds:[] }. See server/lib/locations.js.
  locations: [],
  kds: {
    zones: [],          // [{ id, name, categories:[displayName] }]
    lookbackHours: 8,   // how far back to pull live tickets
    amberMin: 6,        // ticket turns amber after this many minutes
    redMin: 12,         // ticket turns red after this many minutes
    sound: true,        // chime on a new ticket
    showPrepStep: true, // show a "Start" (preparing) step before the bump
  },
  // ── Kiosk POS + adaptive KDS (/pos). A staff register that idles on the KDS.
  //    Phase 1: cash + send-to-kitchen tenders; Square Terminal card is next.
  pos: {
    enabled: true,
    deviceName: 'Front counter',
    mode: 'pos_kds',        // 'pos_kds' (idle on KDS) | 'pos' | 'kds'
    autoReturnSec: 3,       // success screen delay before returning to the KDS
    sourceName: 'Bean Culture POS', // Square order source tag for counter sales
    terminalDeviceId: '',   // paired Square Terminal device id for card payments
    terminalName: '',       // friendly name of that reader
  },
  // ── Smart Campaigns: contextual merchandising driven by rules (Weather first;
  //    future: time, holidays, stock, loyalty…). A single server-side resolver
  //    turns these into banner placements the homepage + categories consume — no
  //    per-component rule logic. See server/lib/smartCampaigns.js.
  smartCampaigns: {
    showTemperature: false,   // subtle "☀️ 29°C" in the customer app
    showCondition: true,      // include the little weather icon with the temp
    options: {
      mode: 'highest',        // 'highest' matching campaign only | 'all'
      hysteresis: true,       // prevent flapping around the threshold
    },
    weather: [],              // Weather Campaigns (Phase 2). Shape documented in
                              // smartCampaigns.js — mirrors the hero/banner shapes.
  },
};

// ---------------------------------------------------------------------------
// Remastered seasonal palettes (schema v2). Each entry is the full 32-token
// semantic recipe that re-skins the ENTIRE storefront (canvas, header, hours/
// countdown, hero frame, controls, cards, cart, checkout, modal, account,
// focus/validation/status states) for that event. Keyed by each theme's STABLE
// id — never by display name — so renames (e.g. floriade → "Tulip Tops"),
// banner media, dates and enabled flags are all preserved untouched.
// buildSeasonalTokens() on the client maps these to the --t-* namespace.
// ---------------------------------------------------------------------------
const SEASONAL_PALETTES = {
  christmas: {
    canvasStart: '#061B17', canvasMid: '#0B382B', canvasEnd: '#681522', canvasGlow: '#B52031',
    surface: '#FFF8E8', surfaceRaised: '#FFFCF4', surfaceTint: '#F1E8D4',
    primary: '#A7192D', primaryHover: '#C1263C', primaryPressed: '#861323',
    accent: '#D8B34A', accentStrong: '#F1D36C',
    text: '#18241F', textMuted: '#68746C', textOnDark: '#FFF8E8', textOnDarkMuted: '#DED3BC', textOnPrimary: '#FFFFFF',
    border: '#CBBF98', borderAccent: '#D8B34A', controlBorder: '#D1B8A5', focus: '#F1D36C',
    heroBorder: '#D8B34A', heroGlow: 'rgba(216,179,74,.22)',
    progressTrack: 'rgba(255,248,232,.22)', progressFillStart: '#A7192D', progressFillEnd: '#F1D36C',
    cartIllustration: '#A7192D', success: '#2B865A', warning: '#D8B34A', danger: '#C1263C',
    shadowColor: 'rgba(2,14,10,.40)', glowColor: 'rgba(181,32,49,.22)',
  },
  newyear: {
    canvasStart: '#070D1B', canvasMid: '#111B38', canvasEnd: '#33245E', canvasGlow: '#D1A83B',
    surface: '#FFF9ED', surfaceRaised: '#FFFDF6', surfaceTint: '#EEE9DC',
    primary: '#B88A20', primaryHover: '#D2A52C', primaryPressed: '#8E6815',
    accent: '#F2D66C', accentStrong: '#FFF0A3',
    text: '#171C2A', textMuted: '#687083', textOnDark: '#FFF9ED', textOnDarkMuted: '#CFCDE0', textOnPrimary: '#13172A',
    border: '#C7B87A', borderAccent: '#E0BE4A', controlBorder: '#C9C2AC', focus: '#F2D66C',
    heroBorder: '#D8B443', heroGlow: 'rgba(242,214,108,.24)',
    progressTrack: 'rgba(255,249,237,.20)', progressFillStart: '#B88A20', progressFillEnd: '#FFF0A3',
    cartIllustration: '#A77B1E', success: '#3B866D', warning: '#D2A52C', danger: '#C54A5A',
    shadowColor: 'rgba(2,5,15,.46)', glowColor: 'rgba(209,168,59,.20)',
  },
  australiaday: {
    canvasStart: '#05231A', canvasMid: '#0A4934', canvasEnd: '#126448', canvasGlow: '#E2C14A',
    surface: '#FFF9E9', surfaceRaised: '#FFFDF4', surfaceTint: '#EAF0DC',
    primary: '#087047', primaryHover: '#0C8957', primaryPressed: '#055638',
    accent: '#E2C14A', accentStrong: '#F2D96A',
    text: '#17271F', textMuted: '#617267', textOnDark: '#FFF9E9', textOnDarkMuted: '#D4E0D5', textOnPrimary: '#FFFFFF',
    border: '#B8C69A', borderAccent: '#D6BC4A', controlBorder: '#B6C7B7', focus: '#E2C14A',
    heroBorder: '#D6BC4A', heroGlow: 'rgba(226,193,74,.22)',
    progressTrack: 'rgba(255,249,233,.22)', progressFillStart: '#087047', progressFillEnd: '#E2C14A',
    cartIllustration: '#087047', success: '#2C865A', warning: '#D3A92D', danger: '#B9424E',
    shadowColor: 'rgba(2,18,12,.40)', glowColor: 'rgba(226,193,74,.18)',
  },
  lunarnewyear: {
    canvasStart: '#260406', canvasMid: '#5B090D', canvasEnd: '#8C151D', canvasGlow: '#F0642A',
    surface: '#FFF6E8', surfaceRaised: '#FFFBF2', surfaceTint: '#F6E2CA',
    primary: '#C91E28', primaryHover: '#E02B34', primaryPressed: '#9E141D',
    accent: '#F0BE43', accentStrong: '#FFD86B',
    text: '#2B1713', textMuted: '#79645C', textOnDark: '#FFF6E8', textOnDarkMuted: '#E8CDBD', textOnPrimary: '#FFFFFF',
    border: '#D7A66C', borderAccent: '#F0BE43', controlBorder: '#DCB49B', focus: '#FFD86B',
    heroBorder: '#F0BE43', heroGlow: 'rgba(240,190,67,.24)',
    progressTrack: 'rgba(255,246,232,.22)', progressFillStart: '#C91E28', progressFillEnd: '#F0BE43',
    cartIllustration: '#C91E28', success: '#2D8956', warning: '#F0BE43', danger: '#B81620',
    shadowColor: 'rgba(30,2,3,.44)', glowColor: 'rgba(240,100,42,.22)',
  },
  valentines: {
    canvasStart: '#270714', canvasMid: '#64132F', canvasEnd: '#9A2852', canvasGlow: '#F47BA8',
    surface: '#FFF6F8', surfaceRaised: '#FFFBFC', surfaceTint: '#F8DFE8',
    primary: '#D52F67', primaryHover: '#E54879', primaryPressed: '#A92050',
    accent: '#F1A8C1', accentStrong: '#FFD2DF',
    text: '#311922', textMuted: '#80646E', textOnDark: '#FFF6F8', textOnDarkMuted: '#EAC8D5', textOnPrimary: '#FFFFFF',
    border: '#E0ADBF', borderAccent: '#F1A8C1', controlBorder: '#DCB4C1', focus: '#F47BA8',
    heroBorder: '#E76591', heroGlow: 'rgba(244,123,168,.25)',
    progressTrack: 'rgba(255,246,248,.22)', progressFillStart: '#D52F67', progressFillEnd: '#F1A8C1',
    cartIllustration: '#D52F67', success: '#4B8068', warning: '#D7A84D', danger: '#C82058',
    shadowColor: 'rgba(29,3,14,.42)', glowColor: 'rgba(244,123,168,.22)',
  },
  stpatricks: {
    canvasStart: '#041A10', canvasMid: '#093B23', canvasEnd: '#126B3D', canvasGlow: '#69BE50',
    surface: '#FFF9E7', surfaceRaised: '#FFFDF4', surfaceTint: '#E8F1D9',
    primary: '#16864A', primaryHover: '#20A05A', primaryPressed: '#0E6638',
    accent: '#DFC248', accentStrong: '#F4DA67',
    text: '#16271D', textMuted: '#647368', textOnDark: '#FFF9E7', textOnDarkMuted: '#CCE0D1', textOnPrimary: '#FFFFFF',
    border: '#AFC798', borderAccent: '#DFC248', controlBorder: '#B1C8B8', focus: '#F4DA67',
    heroBorder: '#CDB13C', heroGlow: 'rgba(223,194,72,.20)',
    progressTrack: 'rgba(255,249,231,.20)', progressFillStart: '#16864A', progressFillEnd: '#DFC248',
    cartIllustration: '#16864A', success: '#16864A', warning: '#DFC248', danger: '#B63C45',
    shadowColor: 'rgba(1,16,9,.42)', glowColor: 'rgba(105,190,80,.18)',
  },
  easter: {
    canvasStart: '#171329', canvasMid: '#3D3266', canvasEnd: '#715C9C', canvasGlow: '#E8AFC8',
    surface: '#FFF9F1', surfaceRaised: '#FFFDF8', surfaceTint: '#EEE7F6',
    primary: '#8065AF', primaryHover: '#9679C5', primaryPressed: '#644D8D',
    accent: '#E8AFC8', accentStrong: '#F2CE72',
    text: '#292238', textMuted: '#756D81', textOnDark: '#FFF9F1', textOnDarkMuted: '#D9D0E7', textOnPrimary: '#FFFFFF',
    border: '#C7B6D8', borderAccent: '#E8AFC8', controlBorder: '#CFC0D8', focus: '#F2CE72',
    heroBorder: '#D6B0D2', heroGlow: 'rgba(232,175,200,.24)',
    progressTrack: 'rgba(255,249,241,.23)', progressFillStart: '#8065AF', progressFillEnd: '#E8AFC8',
    cartIllustration: '#8065AF', success: '#5D8D68', warning: '#D5AE43', danger: '#C64F71',
    shadowColor: 'rgba(12,8,24,.38)', glowColor: 'rgba(232,175,200,.20)',
  },
  anzac: {
    canvasStart: '#11110D', canvasMid: '#302F25', canvasEnd: '#514C39', canvasGlow: '#9B7145',
    surface: '#F5F0E4', surfaceRaised: '#FBF7ED', surfaceTint: '#E6DFCF',
    primary: '#71472D', primaryHover: '#86583A', primaryPressed: '#553522',
    accent: '#B59A63', accentStrong: '#D0B77E',
    text: '#26231C', textMuted: '#706B60', textOnDark: '#F5F0E4', textOnDarkMuted: '#CEC6B5', textOnPrimary: '#FFFFFF',
    border: '#A99C7E', borderAccent: '#B59A63', controlBorder: '#B8AD99', focus: '#D0B77E',
    heroBorder: '#9D8864', heroGlow: 'rgba(155,113,69,.16)',
    progressTrack: 'rgba(245,240,228,.20)', progressFillStart: '#71472D', progressFillEnd: '#B59A63',
    cartIllustration: '#71472D', success: '#4E765C', warning: '#B59A63', danger: '#8D3D39',
    shadowColor: 'rgba(5,5,3,.42)', glowColor: 'rgba(155,113,69,.14)',
  },
  mothersday: {
    canvasStart: '#2A101B', canvasMid: '#652840', canvasEnd: '#98516B', canvasGlow: '#E69AB1',
    surface: '#FFF7F5', surfaceRaised: '#FFFCFA', surfaceTint: '#F7E1E5',
    primary: '#C84976', primaryHover: '#DC5E89', primaryPressed: '#9C345A',
    accent: '#E8B1A3', accentStrong: '#F5D0BE',
    text: '#301D23', textMuted: '#806A70', textOnDark: '#FFF7F5', textOnDarkMuted: '#E7CDD5', textOnPrimary: '#FFFFFF',
    border: '#DCB5B8', borderAccent: '#E8B1A3', controlBorder: '#DDBFC3', focus: '#E69AB1',
    heroBorder: '#D9869F', heroGlow: 'rgba(230,154,177,.23)',
    progressTrack: 'rgba(255,247,245,.23)', progressFillStart: '#C84976', progressFillEnd: '#E8B1A3',
    cartIllustration: '#C84976', success: '#56806A', warning: '#D1A64E', danger: '#B83F66',
    shadowColor: 'rgba(27,6,14,.40)', glowColor: 'rgba(230,154,177,.20)',
  },
  // Stable id `floriade`; display name is admin-set (currently "🌷 Tulip Tops").
  floriade: {
    canvasStart: '#151D0C', canvasMid: '#33481C', canvasEnd: '#687C2D', canvasGlow: '#E76648',
    surface: '#FFF9EC', surfaceRaised: '#FFFDF5', surfaceTint: '#EEF1D7',
    primary: '#D9583E', primaryHover: '#EB6B4E', primaryPressed: '#AC402D',
    accent: '#F0C253', accentStrong: '#F7D874',
    text: '#25291B', textMuted: '#6C735E', textOnDark: '#FFF9EC', textOnDarkMuted: '#D8DFC5', textOnPrimary: '#FFFFFF',
    border: '#BFC99B', borderAccent: '#E18A5B', controlBorder: '#C9C8A9', focus: '#F0C253',
    heroBorder: '#E18A5B', heroGlow: 'rgba(231,102,72,.22)',
    progressTrack: 'rgba(255,249,236,.23)', progressFillStart: '#D9583E', progressFillEnd: '#F0C253',
    cartIllustration: '#D9583E', success: '#5C8A4B', warning: '#D6A938', danger: '#B6433A',
    shadowColor: 'rgba(10,16,4,.38)', glowColor: 'rgba(231,102,72,.20)',
  },
  fathersday: {
    canvasStart: '#061521', canvasMid: '#0A334C', canvasEnd: '#14516E', canvasGlow: '#C98532',
    surface: '#F8F5EC', surfaceRaised: '#FDFBF5', surfaceTint: '#E5ECED',
    primary: '#24719D', primaryHover: '#3288B8', primaryPressed: '#195675',
    accent: '#D49337', accentStrong: '#EDB958',
    text: '#18252C', textMuted: '#627078', textOnDark: '#F8F5EC', textOnDarkMuted: '#CAD6DB', textOnPrimary: '#FFFFFF',
    border: '#9FB8C1', borderAccent: '#C98532', controlBorder: '#AFC1C5', focus: '#EDB958',
    heroBorder: '#C98532', heroGlow: 'rgba(201,133,50,.21)',
    progressTrack: 'rgba(248,245,236,.21)', progressFillStart: '#24719D', progressFillEnd: '#D49337',
    cartIllustration: '#24719D', success: '#3B7B65', warning: '#D49337', danger: '#B74647',
    shadowColor: 'rgba(2,11,18,.43)', glowColor: 'rgba(201,133,50,.18)',
  },
  halloween: {
    canvasStart: '#0D0614', canvasMid: '#231033', canvasEnd: '#421458', canvasGlow: '#E95F13',
    surface: '#FFF5E8', surfaceRaised: '#FFFAF1', surfaceTint: '#EEE2E9',
    primary: '#7625C2', primaryHover: '#8C35DE', primaryPressed: '#571790',
    accent: '#FF731A', accentStrong: '#FF9A45',
    text: '#281C2C', textMuted: '#756879', textOnDark: '#FFF5E8', textOnDarkMuted: '#D8C9DE', textOnPrimary: '#FFFFFF',
    border: '#B89AC8', borderAccent: '#FF731A', controlBorder: '#C4AFC9', focus: '#FF9A45',
    heroBorder: '#FF731A', heroGlow: 'rgba(255,115,26,.27)',
    progressTrack: 'rgba(255,245,232,.21)', progressFillStart: '#7625C2', progressFillEnd: '#FF731A',
    cartIllustration: '#7625C2', success: '#3E8262', warning: '#FF731A', danger: '#C52B46',
    shadowColor: 'rgba(6,2,10,.50)', glowColor: 'rgba(233,95,19,.24)',
  },
};

// Per-event decorative-effect defaults (schema v2). `effectPreset` is the
// animation recipe (keyed by theme id); `intensity` scales density/flourish.
// These are DEFAULTS only — an admin's saved effectsConfig overrides per-field.
const SEASONAL_EFFECTS = {
  christmas: { effectsEnabled: true, effectPreset: 'christmas', intensity: 'standard' },
  newyear: { effectsEnabled: true, effectPreset: 'newyear', intensity: 'celebratory' },
  australiaday: { effectsEnabled: true, effectPreset: 'australiaday', intensity: 'standard' },
  lunarnewyear: { effectsEnabled: true, effectPreset: 'lunarnewyear', intensity: 'celebratory' },
  valentines: { effectsEnabled: true, effectPreset: 'valentines', intensity: 'subtle' },
  stpatricks: { effectsEnabled: true, effectPreset: 'stpatricks', intensity: 'standard' },
  easter: { effectsEnabled: true, effectPreset: 'easter', intensity: 'subtle' },
  anzac: { effectsEnabled: true, effectPreset: 'anzac', intensity: 'subtle' },
  mothersday: { effectsEnabled: true, effectPreset: 'mothersday', intensity: 'subtle' },
  floriade: { effectsEnabled: true, effectPreset: 'floriade', intensity: 'standard' },
  fathersday: { effectsEnabled: true, effectPreset: 'fathersday', intensity: 'subtle' },
  halloween: { effectsEnabled: true, effectPreset: 'halloween', intensity: 'standard' },
};


// ── Effects Engine: reusable particle-overlay presets ──────────────────────
// A stable-ID entity independent of theme palette and seasonal banner (see
// client/src/effectEngine.js for the renderer that consumes this shape).
// Seasonal events and themes reference an effect by `id`, never by name, so
// renaming an effect in the Effect Builder never breaks an assignment.
const EFFECT_PRESETS = [
  {
    id: 'eff-snow', name: 'Snow', slug: 'snow', builtIn: true, enabled: true, frontendSelectable: true,
    version: 1, renderer: 'canvas-particles', description: 'Drifting snowflakes in white, ivory and pale blue.',
    assets: [
      { assetId: 'snowflake-1', weight: 35 }, { assetId: 'snowflake-2', weight: 25 },
      { assetId: 'snowflake-3', weight: 20 }, { assetId: 'soft-snow-dot', weight: 20 },
    ],
    motion: { directionDegrees: 180, speedMin: 18, speedMax: 46, driftMin: -10, driftMax: 10, sway: 0.6, rotationMin: 0, rotationMax: 360, rotationSpeedMin: -15, rotationSpeedMax: 15, lifetimeMin: 8, lifetimeMax: 16 },
    emission: { density: 1.3, spawnRate: 1, maxParticlesDesktop: 60, maxParticlesMobile: 26, spawnArea: 'top', burstOnLoad: false, burstCount: 0 },
    appearance: {
      sizeMin: 10, sizeMax: 22, opacityMin: 0.45, opacityMax: 0.9,
      colorMode: 'palette', colors: ['#FFFFFF', '#F7FBFF', '#DDEEFF', '#F4E5C1'],
      renderMode: 'random', fillPercentage: 20, strokePercentage: 50, mixedPercentage: 30,
      strokeWidthMin: 1.6, strokeWidthMax: 2.6,
      glowEnabled: true, glowColorMode: 'inherit', glowColors: [], glowBlurMin: 3, glowBlurMax: 8, glowOpacity: 0.5, glowPercentage: 20,
    },
    randomness: { amount: 0.6, assetRandomness: 1, colorRandomness: 0.7, sizeRandomness: 0.8, speedRandomness: 0.7, opacityRandomness: 0.6, rotationRandomness: 1 },
    accessibility: { reducedMotionMode: 'static-glow' },
  },
  {
    id: 'eff-hearts', name: 'Hearts', slug: 'hearts', builtIn: true, enabled: true, frontendSelectable: true,
    version: 2, renderer: 'canvas-particles', description: 'Soft rose and blush hearts drifting diagonally.',
    assets: [{ assetId: 'heart-outline', weight: 60 }, { assetId: 'heart-filled', weight: 40 }],
    motion: { directionDegrees: 160, speedMin: 16, speedMax: 38, driftMin: -6, driftMax: 14, sway: 0.5, rotationMin: -20, rotationMax: 20, rotationSpeedMin: -10, rotationSpeedMax: 10, lifetimeMin: 7, lifetimeMax: 13 },
    emission: { density: 1.3, spawnRate: 1, maxParticlesDesktop: 42, maxParticlesMobile: 20, spawnArea: 'top', burstOnLoad: false, burstCount: 0 },
    appearance: {
      sizeMin: 13, sizeMax: 28, opacityMin: 0.55, opacityMax: 0.95,
      colorMode: 'palette', colors: ['#F1A8C1', '#E76591', '#FFD2DF'],
      renderMode: 'random', fillPercentage: 40, strokePercentage: 30, mixedPercentage: 30,
      strokeWidthMin: 2, strokeWidthMax: 3, glowEnabled: true, glowColorMode: 'inherit', glowColors: [], glowBlurMin: 3, glowBlurMax: 7, glowOpacity: 0.5, glowPercentage: 20,
    },
    randomness: { amount: 0.5, assetRandomness: 1, colorRandomness: 0.6, sizeRandomness: 0.7, speedRandomness: 0.6, opacityRandomness: 0.6, rotationRandomness: 0.8 },
    accessibility: { reducedMotionMode: 'static-glow' },
  },
  {
    id: 'eff-petals', name: 'Petals', slug: 'petals', builtIn: true, enabled: true, frontendSelectable: true,
    version: 2, renderer: 'canvas-particles', description: 'Tumbling botanical petals, diagonal fall.',
    assets: [{ assetId: 'petal-round', weight: 40 }, { assetId: 'petal-curved', weight: 35 }, { assetId: 'tulip-petal', weight: 25 }],
    motion: { directionDegrees: 160, speedMin: 16, speedMax: 42, driftMin: -10, driftMax: 16, sway: 0.7, rotationMin: 0, rotationMax: 360, rotationSpeedMin: -30, rotationSpeedMax: 30, lifetimeMin: 7, lifetimeMax: 15 },
    emission: { density: 1.4, spawnRate: 1, maxParticlesDesktop: 46, maxParticlesMobile: 22, spawnArea: 'top', burstOnLoad: false, burstCount: 0 },
    appearance: {
      sizeMin: 11, sizeMax: 30, opacityMin: 0.55, opacityMax: 0.95,
      colorMode: 'palette', colors: ['#E8AFC8', '#F2CE72', '#F5D0BE'],
      renderMode: 'fill', fillPercentage: 100, strokePercentage: 0, mixedPercentage: 0,
      strokeWidthMin: 1.5, strokeWidthMax: 2, glowEnabled: false, glowColorMode: 'inherit', glowColors: [], glowBlurMin: 2, glowBlurMax: 5, glowOpacity: 0.4, glowPercentage: 0,
    },
    randomness: { amount: 0.7, assetRandomness: 1, colorRandomness: 0.7, sizeRandomness: 1, speedRandomness: 0.7, opacityRandomness: 0.6, rotationRandomness: 1 },
    accessibility: { reducedMotionMode: 'static-glow' },
  },
  {
    id: 'eff-sparkles', name: 'Sparkles', slug: 'sparkles', builtIn: true, enabled: true, frontendSelectable: true,
    version: 2, renderer: 'canvas-particles', description: 'Slow-fading points of light, low density.',
    assets: [{ assetId: 'sparkle', weight: 50 }, { assetId: 'star', weight: 30 }, { assetId: 'soft-snow-dot', weight: 20 }],
    motion: { directionDegrees: 180, speedMin: 6, speedMax: 18, driftMin: -6, driftMax: 6, sway: 0.4, rotationMin: 0, rotationMax: 360, rotationSpeedMin: -8, rotationSpeedMax: 8, lifetimeMin: 5, lifetimeMax: 10 },
    emission: { density: 0.9, spawnRate: 1, maxParticlesDesktop: 28, maxParticlesMobile: 13, spawnArea: 'viewport', burstOnLoad: false, burstCount: 0 },
    appearance: {
      sizeMin: 6, sizeMax: 16, opacityMin: 0.2, opacityMax: 0.95,
      colorMode: 'palette', colors: ['#FFF7DA', '#FFE9A8', '#FFFFFF'],
      renderMode: 'fill', fillPercentage: 100, strokePercentage: 0, mixedPercentage: 0,
      strokeWidthMin: 1, strokeWidthMax: 2, glowEnabled: true, glowColorMode: 'inherit', glowColors: [], glowBlurMin: 4, glowBlurMax: 10, glowOpacity: 0.6, glowPercentage: 40,
    },
    randomness: { amount: 0.6, assetRandomness: 1, colorRandomness: 0.5, sizeRandomness: 0.6, speedRandomness: 0.5, opacityRandomness: 1, rotationRandomness: 0.6 },
    accessibility: { reducedMotionMode: 'static-glow' },
  },
  {
    id: 'eff-confetti', name: 'Confetti', slug: 'confetti', builtIn: true, enabled: true, frontendSelectable: true,
    version: 2, renderer: 'canvas-particles', description: 'Initial burst plus a light continuous fall.',
    assets: [{ assetId: 'confetti-strip', weight: 40 }, { assetId: 'confetti-circle', weight: 35 }, { assetId: 'confetti-diamond', weight: 25 }],
    motion: { directionDegrees: 180, speedMin: 40, speedMax: 90, driftMin: -20, driftMax: 20, sway: 0.5, rotationMin: 0, rotationMax: 360, rotationSpeedMin: -60, rotationSpeedMax: 60, lifetimeMin: 3, lifetimeMax: 6 },
    emission: { density: 0.75, spawnRate: 1, maxParticlesDesktop: 32, maxParticlesMobile: 15, spawnArea: 'top', burstOnLoad: true, burstCount: 55 },
    appearance: {
      sizeMin: 8, sizeMax: 16, opacityMin: 0.7, opacityMax: 1,
      colorMode: 'palette', colors: ['#F2D66C', '#FFF0A3', '#B88A20', '#E4536B', '#5AA9E6'],
      renderMode: 'fill', fillPercentage: 100, strokePercentage: 0, mixedPercentage: 0,
      strokeWidthMin: 1, strokeWidthMax: 1.5, glowEnabled: false, glowColorMode: 'inherit', glowColors: [], glowBlurMin: 2, glowBlurMax: 4, glowOpacity: 0.3, glowPercentage: 0,
    },
    randomness: { amount: 0.7, assetRandomness: 1, colorRandomness: 1, sizeRandomness: 0.6, speedRandomness: 0.8, opacityRandomness: 0.4, rotationRandomness: 1 },
    accessibility: { reducedMotionMode: 'off' },
  },
  {
    id: 'eff-clover', name: 'Clover', slug: 'clover', builtIn: true, enabled: true, frontendSelectable: false,
    version: 2, renderer: 'canvas-particles', description: 'Gentle falling clover, green with occasional gold.',
    assets: [{ assetId: 'clover', weight: 100 }],
    motion: { directionDegrees: 170, speedMin: 14, speedMax: 32, driftMin: -6, driftMax: 10, sway: 0.5, rotationMin: -15, rotationMax: 15, rotationSpeedMin: -8, rotationSpeedMax: 8, lifetimeMin: 7, lifetimeMax: 14 },
    emission: { density: 0.8, spawnRate: 1, maxParticlesDesktop: 26, maxParticlesMobile: 12, spawnArea: 'top', burstOnLoad: false, burstCount: 0 },
    appearance: {
      sizeMin: 10, sizeMax: 20, opacityMin: 0.5, opacityMax: 0.9,
      colorMode: 'palette', colors: ['#20A05A', '#16864A', '#DFC248'],
      renderMode: 'fill', fillPercentage: 100, strokePercentage: 0, mixedPercentage: 0,
      strokeWidthMin: 1, strokeWidthMax: 1.5, glowEnabled: false, glowColorMode: 'inherit', glowColors: [], glowBlurMin: 2, glowBlurMax: 4, glowOpacity: 0.3, glowPercentage: 0,
    },
    randomness: { amount: 0.5, assetRandomness: 0, colorRandomness: 0.6, sizeRandomness: 0.6, speedRandomness: 0.6, opacityRandomness: 0.5, rotationRandomness: 0.7 },
    accessibility: { reducedMotionMode: 'static-glow' },
  },
  {
    id: 'eff-eucalyptus', name: 'Eucalyptus', slug: 'eucalyptus', builtIn: true, enabled: true, frontendSelectable: false,
    version: 2, renderer: 'canvas-particles', description: 'Slow diagonal sage-green leaves.',
    assets: [{ assetId: 'eucalyptus', weight: 100 }],
    motion: { directionDegrees: 155, speedMin: 12, speedMax: 30, driftMin: -8, driftMax: 12, sway: 0.6, rotationMin: 0, rotationMax: 360, rotationSpeedMin: -12, rotationSpeedMax: 12, lifetimeMin: 8, lifetimeMax: 16 },
    emission: { density: 0.9, spawnRate: 1, maxParticlesDesktop: 30, maxParticlesMobile: 14, spawnArea: 'top', burstOnLoad: false, burstCount: 0 },
    appearance: {
      sizeMin: 12, sizeMax: 24, opacityMin: 0.5, opacityMax: 0.9,
      colorMode: 'palette', colors: ['#7BA05B', '#5C8A4B', '#9DBE6E'],
      renderMode: 'fill', fillPercentage: 100, strokePercentage: 0, mixedPercentage: 0,
      strokeWidthMin: 1, strokeWidthMax: 1.5, glowEnabled: false, glowColorMode: 'inherit', glowColors: [], glowBlurMin: 2, glowBlurMax: 4, glowOpacity: 0.3, glowPercentage: 0,
    },
    randomness: { amount: 0.5, assetRandomness: 0, colorRandomness: 0.6, sizeRandomness: 0.7, speedRandomness: 0.6, opacityRandomness: 0.5, rotationRandomness: 0.8 },
    accessibility: { reducedMotionMode: 'static-glow' },
  },
  {
    id: 'eff-bats', name: 'Bats', slug: 'bats', builtIn: true, enabled: true, frontendSelectable: false,
    version: 2, renderer: 'canvas-particles', description: 'Restrained silhouettes, low count, no storm.',
    assets: [{ assetId: 'bat', weight: 100 }],
    motion: { directionDegrees: 100, speedMin: 30, speedMax: 60, driftMin: -14, driftMax: 14, sway: 0.9, rotationMin: 0, rotationMax: 0, rotationSpeedMin: 0, rotationSpeedMax: 0, lifetimeMin: 6, lifetimeMax: 12 },
    emission: { density: 0.55, spawnRate: 1, maxParticlesDesktop: 12, maxParticlesMobile: 6, spawnArea: 'edges', burstOnLoad: false, burstCount: 0 },
    appearance: {
      sizeMin: 16, sizeMax: 30, opacityMin: 0.7, opacityMax: 0.95,
      colorMode: 'single', colors: ['#140A1C'],
      renderMode: 'fill', fillPercentage: 100, strokePercentage: 0, mixedPercentage: 0,
      strokeWidthMin: 1, strokeWidthMax: 1.5, glowEnabled: false, glowColorMode: 'inherit', glowColors: [], glowBlurMin: 2, glowBlurMax: 4, glowOpacity: 0.3, glowPercentage: 0,
    },
    randomness: { amount: 0.4, assetRandomness: 0, colorRandomness: 0, sizeRandomness: 0.5, speedRandomness: 0.5, opacityRandomness: 0.3, rotationRandomness: 0 },
    accessibility: { reducedMotionMode: 'off' },
  },
  {
    id: 'eff-embers', name: 'Embers', slug: 'embers', builtIn: true, enabled: true, frontendSelectable: false,
    version: 2, renderer: 'canvas-particles', description: 'Amber sparks drifting upward, variable glow.',
    assets: [{ assetId: 'ember', weight: 70 }, { assetId: 'soft-snow-dot', weight: 30 }],
    motion: { directionDegrees: 0, speedMin: 14, speedMax: 34, driftMin: -8, driftMax: 8, sway: 0.5, rotationMin: 0, rotationMax: 0, rotationSpeedMin: 0, rotationSpeedMax: 0, lifetimeMin: 4, lifetimeMax: 9 },
    emission: { density: 0.75, spawnRate: 1, maxParticlesDesktop: 28, maxParticlesMobile: 13, spawnArea: 'top', burstOnLoad: false, burstCount: 0 },
    appearance: {
      sizeMin: 4, sizeMax: 10, opacityMin: 0.4, opacityMax: 0.9,
      colorMode: 'palette', colors: ['#F0BE43', '#FF8A3D', '#FFD86B'],
      renderMode: 'fill', fillPercentage: 100, strokePercentage: 0, mixedPercentage: 0,
      strokeWidthMin: 1, strokeWidthMax: 1.5, glowEnabled: true, glowColorMode: 'inherit', glowColors: [], glowBlurMin: 2, glowBlurMax: 6, glowOpacity: 0.6, glowPercentage: 50,
    },
    randomness: { amount: 0.6, assetRandomness: 0.5, colorRandomness: 0.7, sizeRandomness: 0.7, speedRandomness: 0.7, opacityRandomness: 0.7, rotationRandomness: 0 },
    accessibility: { reducedMotionMode: 'static-glow' },
  },
  {
    id: 'eff-lunar-celebration', name: 'Lunar Celebration', slug: 'lunar-celebration', builtIn: true, enabled: true, frontendSelectable: false,
    version: 2, renderer: 'canvas-particles', description: 'Embers with a short confetti flourish (combined preset — one render loop).',
    assets: [{ assetId: 'ember', weight: 55 }, { assetId: 'confetti-circle', weight: 25 }, { assetId: 'confetti-strip', weight: 20 }],
    motion: { directionDegrees: 0, speedMin: 16, speedMax: 38, driftMin: -10, driftMax: 10, sway: 0.5, rotationMin: 0, rotationMax: 360, rotationSpeedMin: -20, rotationSpeedMax: 20, lifetimeMin: 4, lifetimeMax: 9 },
    emission: { density: 0.75, spawnRate: 1, maxParticlesDesktop: 30, maxParticlesMobile: 14, spawnArea: 'top', burstOnLoad: true, burstCount: 36 },
    appearance: {
      sizeMin: 5, sizeMax: 12, opacityMin: 0.45, opacityMax: 0.9,
      colorMode: 'palette', colors: ['#C91E28', '#F0BE43', '#FFD86B'],
      renderMode: 'fill', fillPercentage: 100, strokePercentage: 0, mixedPercentage: 0,
      strokeWidthMin: 1, strokeWidthMax: 1.5, glowEnabled: true, glowColorMode: 'inherit', glowColors: [], glowBlurMin: 2, glowBlurMax: 6, glowOpacity: 0.55, glowPercentage: 30,
    },
    randomness: { amount: 0.6, assetRandomness: 0.6, colorRandomness: 0.7, sizeRandomness: 0.7, speedRandomness: 0.7, opacityRandomness: 0.6, rotationRandomness: 0.8 },
    accessibility: { reducedMotionMode: 'static-glow' },
  },
  {
    id: 'eff-halloween-atmosphere', name: 'Halloween Atmosphere', slug: 'halloween-atmosphere', builtIn: true, enabled: true, frontendSelectable: false,
    version: 2, renderer: 'canvas-particles', description: 'Bats with low-density embers (combined preset — one render loop).',
    assets: [{ assetId: 'bat', weight: 50 }, { assetId: 'ember', weight: 50 }],
    motion: { directionDegrees: 95, speedMin: 20, speedMax: 50, driftMin: -12, driftMax: 12, sway: 0.7, rotationMin: 0, rotationMax: 0, rotationSpeedMin: 0, rotationSpeedMax: 0, lifetimeMin: 5, lifetimeMax: 10 },
    emission: { density: 0.55, spawnRate: 1, maxParticlesDesktop: 18, maxParticlesMobile: 8, spawnArea: 'edges', burstOnLoad: false, burstCount: 0 },
    appearance: {
      sizeMin: 8, sizeMax: 24, opacityMin: 0.5, opacityMax: 0.9,
      colorMode: 'palette', colors: ['#140A1C', '#FF731A'],
      renderMode: 'fill', fillPercentage: 100, strokePercentage: 0, mixedPercentage: 0,
      strokeWidthMin: 1, strokeWidthMax: 1.5, glowEnabled: true, glowColorMode: 'single', glowColors: ['#FF731A'], glowBlurMin: 2, glowBlurMax: 5, glowOpacity: 0.5, glowPercentage: 15,
    },
    randomness: { amount: 0.5, assetRandomness: 0.5, colorRandomness: 0.4, sizeRandomness: 0.7, speedRandomness: 0.6, opacityRandomness: 0.5, rotationRandomness: 0 },
    accessibility: { reducedMotionMode: 'off' },
  },
];
const EFFECTS_SCHEMA_VERSION = 1;
DEFAULTS.effects = { version: EFFECTS_SCHEMA_VERSION, presets: EFFECT_PRESETS };

// Map each built-in seasonal event to its default built-in effect by STABLE ID
// (never by display name, so renaming an effect never breaks the assignment).
const SEASONAL_EFFECT_IDS = {
  christmas: 'eff-snow', newyear: 'eff-confetti', australiaday: 'eff-eucalyptus',
  lunarnewyear: 'eff-lunar-celebration', valentines: 'eff-hearts', stpatricks: 'eff-clover',
  easter: 'eff-petals', anzac: 'eff-petals', mothersday: 'eff-petals', floriade: 'eff-petals',
  fathersday: 'eff-embers', halloween: 'eff-halloween-atmosphere',
};

// Schema version for the seasonal records. Bumped when the palette/effects model
// changes so migrations can run idempotently.
const SEASONAL_SCHEMA_VERSION = 2;

// Attach the remastered palette + effect defaults onto the built-in seasonal
// records IN PLACE (by stable id). Purely additive: names, dates, banners,
// links, enabled flags and legacy effect flags are left exactly as authored.
for (const t of DEFAULTS.seasonalThemes) {
  if (SEASONAL_PALETTES[t.id]) t.palette = SEASONAL_PALETTES[t.id];
  t.effectsConfig = SEASONAL_EFFECTS[t.id] || { effectsEnabled: false, effectPreset: t.id, intensity: 'standard' };
  t.effectsConfig.effectId = t.effectsConfig.effectId || SEASONAL_EFFECT_IDS[t.id] || null;
  t.schemaVersion = SEASONAL_SCHEMA_VERSION;
}

function deepMerge(base, over) {
  if (Array.isArray(over)) return over;
  if (over && typeof over === 'object' && !Array.isArray(over)) {
    const out = { ...base };
    for (const k of Object.keys(over)) out[k] = deepMerge(base ? base[k] : undefined, over[k]);
    return out;
  }
  return over === undefined ? base : over;
}

const db = require('./db');

function getSettings() {
  let env = {};
  if (process.env.SETTINGS_JSON) {
    try {
      env = JSON.parse(process.env.SETTINGS_JSON);
    } catch (e) {
      console.error('[settings] SETTINGS_JSON is not valid JSON:', e.message);
    }
  }
  // Precedence: DEFAULTS < SETTINGS_JSON env < admin edits stored in the DB.
  const merged = deepMerge(DEFAULTS, env);
  const full = deepMerge(merged, db.getOverrides());
  return reconcileClosures(reconcileEffects(reconcileSeasonal(full)));
}

// Built-in festive themes must ALWAYS be present, even if an old saved settings
// blob replaced the whole seasonalThemes array (arrays replace wholesale on
// merge). We rebuild the list from the DEFAULTS by id: each built-in is patched
// by any saved override with the same id (so enabled/dates/colours/banner edits
// persist), and any saved theme whose id isn't a built-in is a custom event and
// is appended. This keeps the 12 Canberra festive themes from ever disappearing.
const BUILTIN_SEASONAL_IDS = new Set(DEFAULTS.seasonalThemes.map((t) => t.id));
function reconcileSeasonal(settings) {
  const saved = Array.isArray(settings.seasonalThemes) ? settings.seasonalThemes : [];
  const savedById = new Map(saved.map((t) => [t.id, t]));
  const out = DEFAULTS.seasonalThemes.map((def) => {
    const ov = savedById.get(def.id);
    return ov ? deepMerge(def, ov) : def;
  });
  for (const t of saved) {
    if (t && t.id && !BUILTIN_SEASONAL_IDS.has(t.id)) out.push(t);
  }
  return { ...settings, seasonalThemes: out };
}

// Built-in effect presets must always be present too (same pattern as
// seasonal themes): rebuilt from EFFECT_PRESETS by id, patched by any saved
// admin edit with the same id (so enabled/frontendSelectable/tuning changes
// persist and a built-in can even be fully re-authored), and any saved effect
// whose id isn't a built-in is a custom admin-created effect and is appended.
const BUILTIN_EFFECT_IDS = new Set(EFFECT_PRESETS.map((e) => e.id));
function reconcileEffects(settings) {
  const eff = settings.effects && typeof settings.effects === 'object' ? settings.effects : { version: EFFECTS_SCHEMA_VERSION, presets: [] };
  const saved = Array.isArray(eff.presets) ? eff.presets : [];
  const savedById = new Map(saved.map((e) => [e.id, e]));
  const out = EFFECT_PRESETS.map((def) => {
    const ov = savedById.get(def.id);
    if (!ov) return def;
    // The admin panel's Save action currently persists a full snapshot of
    // every preset (not just the one edited), so a saved override can go
    // stale the moment we ship improved built-in tuning underneath it — the
    // old snapshot's emission/appearance/motion values would otherwise
    // silently shadow the new defaults forever. Each built-in preset carries
    // a `version`; when the saved snapshot predates the current built-in
    // version we treat its tuning as stale and take the fresh default,
    // while still honouring genuine admin toggles (enabled /
    // frontendSelectable) carried in that same snapshot. A saved preset
    // whose version is current (e.g. re-saved after an admin's own edit)
    // continues to deep-merge normally, so real customisation still sticks.
    if ((ov.version || 0) < def.version) {
      const fresh = { ...def };
      if (ov.enabled !== undefined) fresh.enabled = ov.enabled;
      if (ov.frontendSelectable !== undefined) fresh.frontendSelectable = ov.frontendSelectable;
      return fresh;
    }
    return deepMerge(def, ov);
  });
  for (const e of saved) {
    if (e && e.id && !BUILTIN_EFFECT_IDS.has(e.id)) out.push(e);
  }
  return { ...settings, effects: { version: EFFECTS_SCHEMA_VERSION, presets: out } };
}

// Today's MM-DD in the cafe's timezone.
function todayMMDD(tz) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz || process.env.SEASON_TZ || 'Australia/Sydney',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const m = {};
  for (const p of parts) m[p.type] = p.value;
  return `${m.month}-${m.day}`;
}

// The seasonal theme active for a given MM-DD (or null). Handles year-wrap ranges.
function spanDays(from, to) {
  const doy = (mmdd) => { const [m, d] = String(mmdd).split('-').map(Number); return (m || 1) * 31 + (d || 1); };
  const a = doy(from), b = doy(to);
  return a <= b ? b - a : (372 - a + b); // year-wrap counts as a long span
}
// The active seasonal theme for a day; on overlap, the most specific (shortest
// span) wins so a single-day holiday beats a multi-week window.
function activeSeasonal(settings, mmdd) {
  const day = mmdd || todayMMDD();
  let best = null, bestSpan = Infinity;
  for (const s of settings.seasonalThemes || []) {
    if (s.enabled === false) continue;
    const inRange = s.from <= s.to ? day >= s.from && day <= s.to : day >= s.from || day <= s.to;
    if (!inRange) continue;
    const span = spanDays(s.from, s.to);
    if (span < bestSpan) { best = s; bestSpan = span; }
  }
  return best ? flatten(best) : null;
}

function flatten(s) {
  return {
    id: s.id, name: s.name, ...s.theme,
    season: s.season || null, decor: s.decor || {}, effects: s.effects || {},
    // Remastered token recipe + event-aware effect config (schema v2). Falls
    // back to the built-in defaults by id if a saved override predates v2.
    palette: s.palette || SEASONAL_PALETTES[s.id] || null,
    effectsConfig: s.effectsConfig || { ...(SEASONAL_EFFECTS[s.id] || { effectsEnabled: false, effectPreset: s.id, intensity: 'standard' }), effectId: SEASONAL_EFFECT_IDS[s.id] || null },
    banner: s.banner || null,
  };
}

// Seasonal themes flattened for the picker and for admin preview (enabled only).
function seasonalForPicker(settings) {
  return (settings.seasonalThemes || []).filter((s) => s.enabled !== false).map(flatten);
}

// Does a closure entry (single day or range, optionally annual) cover fullDate
// ('YYYY-MM-DD')? Used by hours + the scheduler.
function closureMatches(closure, fullDate) {
  if (!closure) return false;
  const md = String(fullDate).slice(5);
  if (closure.from && closure.to) {
    if (closure.annual) {
      const f = String(closure.from).slice(5);
      const t = String(closure.to).slice(5);
      return f <= t ? (md >= f && md <= t) : (md >= f || md <= t); // handle year-wrap
    }
    return fullDate >= closure.from && fullDate <= closure.to;
  }
  if (closure.date) return closure.date === fullDate || (closure.annual && String(closure.date).slice(5) === md);
  return false;
}

// Canberra (ACT) public holidays for 2026 & 2027, per the official ACT Government
// gazette (act.gov.au). Weekend holidays include their gazetted additional day.
// These are kept as built-in closed dates so the café is always closed on them;
// remove any from this list to trade on that day.
const ACT_PUBLIC_HOLIDAYS = [
  // 2026
  { date: '2026-01-01', label: "New Year's Day" },
  { date: '2026-01-26', label: 'Australia Day' },
  { date: '2026-03-09', label: 'Canberra Day' },
  { date: '2026-04-03', label: 'Good Friday' },
  { date: '2026-04-04', label: 'Easter Saturday' },
  { date: '2026-04-05', label: 'Easter Sunday' },
  { date: '2026-04-06', label: 'Easter Monday' },
  { date: '2026-04-25', label: 'Anzac Day' },
  { date: '2026-04-27', label: 'Anzac Day (additional)' },
  { date: '2026-06-01', label: 'Reconciliation Day' },
  { date: '2026-06-08', label: "King's Birthday" },
  { date: '2026-10-05', label: 'Labour Day' },
  { date: '2026-12-25', label: 'Christmas Day' },
  { date: '2026-12-26', label: 'Boxing Day' },
  { date: '2026-12-28', label: 'Boxing Day (additional)' },
  // 2027
  { date: '2027-01-01', label: "New Year's Day" },
  { date: '2027-01-26', label: 'Australia Day' },
  { date: '2027-03-08', label: 'Canberra Day' },
  { date: '2027-03-26', label: 'Good Friday' },
  { date: '2027-03-27', label: 'Easter Saturday' },
  { date: '2027-03-28', label: 'Easter Sunday' },
  { date: '2027-03-29', label: 'Easter Monday' },
  { date: '2027-04-26', label: 'Anzac Day' },
  { date: '2027-05-31', label: 'Reconciliation Day' },
  { date: '2027-06-14', label: "King's Birthday" },
  { date: '2027-10-04', label: 'Labour Day' },
  { date: '2027-12-25', label: 'Christmas Day' },
  { date: '2027-12-27', label: 'Christmas Day (additional)' },
  { date: '2027-12-26', label: 'Boxing Day' },
  { date: '2027-12-28', label: 'Boxing Day (additional)' },
];

// Ensure the ACT public holidays are present in the closures list. Skips any
// date already covered by an existing closure (e.g. the Christmas shutdown
// range) so the admin list stays clean, and never duplicates a date.
function reconcileClosures(settings) {
  const existing = Array.isArray(settings.closures) ? settings.closures : [];
  const merged = [...existing];
  for (const h of ACT_PUBLIC_HOLIDAYS) {
    if (existing.some((c) => closureMatches(c, h.date))) continue; // already closed
    if (merged.some((c) => c.date === h.date)) continue;           // no duplicates
    merged.push({ date: h.date, label: h.label });
  }
  return { ...settings, closures: merged };
}

function isClosedDate(closures, fullDate) {
  return (closures || []).some((c) => closureMatches(c, fullDate));
}

module.exports = { getSettings, DEFAULTS, todayMMDD, activeSeasonal, seasonalForPicker, closureMatches, isClosedDate };
