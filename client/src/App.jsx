import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, formatMoney, imgUrl, comboDiscountFor } from './api.js';
import { applyTheme } from './theme.js';
import { STOREFRONT_THEMES, resolvePreset, applyStoreTheme, presetSwatch, buildTokens, seasonalAsPreset } from './themes.js';
import { getUser, setUser as saveUser, getSavedTheme, setSavedTheme, getSeasonOptOut, setSeasonOptOut, getStoredOrder, setStoredOrder, getFavorites, saveFavorites, getStoredThemeBlob, saveStoredTheme, getEffectPreference, setEffectPreference } from './store.js';
import HeroSlider from './components/HeroSlider.jsx';
import OrderTypeBar from './components/OrderTypeBar.jsx';
import MenuDock from './components/MenuDock.jsx';
import MenuList from './components/MenuList.jsx';
import ItemModal from './components/ItemModal.jsx';
import ComboModal from './components/ComboModal.jsx';
import KitchenClosingCountdown from './components/KitchenClosingCountdown.jsx';
import CartView from './components/CartView.jsx';
import CartPanel from './components/CartPanel.jsx';
import Checkout from './components/Checkout.jsx';
import Account from './components/Account.jsx';
import ThemePicker from './components/ThemePicker.jsx';
import Admin from './components/Admin.jsx';
import Logo from './components/Logo.jsx';
import EffectOverlay from './components/EffectOverlay.jsx';
import SeasonalPerimeter from './components/SeasonalPerimeter.jsx';
import { AccountIcon, ThemeIcon, StoreIcon, SlotIcon, CartIcon, HeartIcon } from './components/icons.jsx';
import Favorites from './components/Favorites.jsx';
import StorePage from './components/StorePage.jsx';
import ReservationForm from './components/ReservationForm.jsx';
import InstallButton from './components/InstallButton.jsx';
import { track, trackItems } from './analytics.js';

// Admin/dev preview: ?themePreview=christmas (or ?season=christmas) forces a
// seasonal theme regardless of date; ?season=off forces the base theme.
function readPreview() {
  const p = new URLSearchParams(window.location.search);
  return p.get('themePreview') || p.get('season') || '';
}

function readTable() {
  const p = new URLSearchParams(window.location.search);
  const t = p.get('table') || p.get('t');
  return t ? t.trim() : '';
}

// Category name → icon name, shared by the footer dock and the "Browse menu"
// category dock so both use one consistent mapping.
function iconFor(n) {
  const s = (n || '').toLowerCase();
  if (s.includes('coffee')) return 'cup';
  if (s.includes('tea')) return 'tea';
  if (s.includes('cold')) return 'can';
  if (s.includes('shake')) return 'shake';
  if (s.includes('smooth')) return 'smoothie';
  if (s.includes('cake') || s.includes('pastr')) return 'bag';
  if (s.includes('ice')) return 'ice';
  if (s.includes('lunch') || s.includes('breakfast') || s.includes('food') || s.includes('wrap') || s.includes('burger') || s.includes('all day')) return 'burger';
  if (s.includes('bean') || s.includes('bag')) return 'bean';
  return 'drink';
}

// Build a short human summary of a scheduled "later" pickup time, e.g.
// "Tue 11 Aug, 8:00am", from the existing preAt {date:'YYYY-MM-DD', time:'HH:MM'}.
function fmtWhen(at) {
  if (!at?.date) return '';
  const [y, mo, d] = at.date.split('-').map(Number);
  const dt = new Date(y, mo - 1, d);
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let time = '';
  if (at.time) {
    const [hh, mm] = at.time.split(':').map(Number);
    const ap = hh >= 12 ? 'pm' : 'am';
    let h = hh % 12; if (h === 0) h = 12;
    time = `${h}:${String(mm).padStart(2, '0')}${ap}`;
  }
  return `${WD[dt.getDay()]} ${d} ${MO[mo - 1]}${time ? `, ${time}` : ''}`;
}

// Display-only location label for the header (NOT a store switcher). Tries to
// pull a suburb out of the contact address, else falls back to the store name.
function locationLabel(config) {
  const addr = config?.contact?.address || '';
  const parts = addr.split(',').map((s) => s.trim()).filter(Boolean);
  // Prefer the suburb: the last comma-segment that has no street number, with any
  // state code / postcode stripped (e.g. "U5, 47-49 Vicars St, Mitchell" → Mitchell).
  const clean = (seg) => seg
    .replace(/\b\d{4}\b/, '')
    .replace(/\b(ACT|NSW|VIC|QLD|SA|WA|TAS|NT)\b/i, '')
    .trim();
  for (let i = parts.length - 1; i >= 0; i--) {
    const seg = clean(parts[i]);
    if (seg && !/\d/.test(seg)) return seg;
  }
  return config?.storeName || '';
}

// Slim, self-contained operational notice strip that lives inside the sticky
// shell. Shows ONE notice at a time; rotates through several every ~6s (unless
// reduced-motion) with compact ‹ › controls and per-notice dismissal.
function SiteNotice({ notices }) {
  const [dismissed, setDismissed] = useState(() => new Set());
  const [idx, setIdx] = useState(0);
  const list = (notices || []).filter((n) => !dismissed.has(n.id));

  useEffect(() => { if (idx >= list.length) setIdx(0); }, [list.length, idx]);

  useEffect(() => {
    if (list.length <= 1) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % list.length), 6000);
    return () => clearInterval(t);
  }, [list.length]);

  if (!list.length) return null;
  const n = list[Math.min(idx, list.length - 1)];

  // The kitchen-closing notice gets its own rich countdown widget (numbered
  // digits + progress bar) instead of the generic icon/text row -- it's
  // self-contained (own CTA), so the rotation arrows/dots are hidden while
  // it's showing rather than overlapping a taller, multi-row layout.
  if (n.reopen && n.minsUntil != null) {
    return (
      <div className="site-notice site-notice--reopen site-notice--kitchen" role="status">
        <KitchenClosingCountdown
          minutes={n.minsUntil}
          elapsedMin={n.elapsedMin}
          windowMin={n.minsUntil}
          eyebrow="We’re closed"
          subLabel={n.reopenLabel ? `We reopen ${n.reopenLabel}` : 'Reopening soon'}
          heading={n.reopenLabel ? `We reopen ${n.reopenLabel}` : 'Reopening soon'}
          sub2="Pre-order now — we’ll have it ready when we open"
          ctaLabel="Pre-order now"
          onOrderNow={n.cta?.onClick}
        />
      </div>
    );
  }

  if (n.id === 'kitchen') {
    return (
      <div className={`site-notice site-notice--${n.type || 'warning'} site-notice--kitchen`} role="status">
        <KitchenClosingCountdown
          closesInMin={n.closesInMin}
          windowMin={30}
          closesLabel={n.closesLabel}
          categories={n.categories}
          onOrderNow={n.cta?.onClick}
        />
      </div>
    );
  }

  return (
    <div className={`site-notice site-notice--${n.type || 'informational'}`} role="status">
      {list.length > 1 && (
        <button className="notice-nav" onClick={() => setIdx((i) => (i - 1 + list.length) % list.length)} aria-label="Previous notice" type="button">‹</button>
      )}
      <div className="notice-live" aria-live="polite">
        <div className="notice-body">
          {n.icon && <span className="notice-ic" aria-hidden="true">{n.icon}</span>}
          <span className="notice-text">{n.text}</span>
          {n.cta && (
            <button className="notice-cta" onClick={n.cta.onClick} type="button">{n.cta.label}</button>
          )}
        </div>
      </div>
      {list.length > 1 && (
        <div className="notice-dots" aria-hidden="true">
          {list.map((_, i) => <span key={i} className={i === Math.min(idx, list.length - 1) ? 'on' : ''} />)}
        </div>
      )}
      {list.length > 1 && (
        <button className="notice-nav" onClick={() => setIdx((i) => (i + 1) % list.length)} aria-label="Next notice" type="button">›</button>
      )}
      {n.dismissible && (
        <button className="notice-dismiss" onClick={() => setDismissed((s) => new Set(s).add(n.id))} aria-label="Dismiss notice" type="button">✕</button>
      )}
    </div>
  );
}

// Wide layout = desktop + landscape tablet (persistent side cart).
function useMediaQuery(query) {
  const get = () => (typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener ? mq.addEventListener('change', on) : mq.addListener(on);
    return () => (mq.removeEventListener ? mq.removeEventListener('change', on) : mq.removeListener(on));
  }, [query]);
  return matches;
}

export default function App() {
  const [config, setConfig] = useState(null);
  const [menu, setMenu] = useState(null);
  const [loadErr, setLoadErr] = useState('');

  const [user, setUserState] = useState(getUser());
  const [view, setView] = useState('home'); // home | cart | checkout | done | account | admin
  const [activeItem, setActiveItem] = useState(null);
  const [showTheme, setShowTheme] = useState(false);
  const [completed, setCompleted] = useState(null);
  const [activeTheme, setActiveTheme] = useState(null);
  // Effects Engine: the customer's overlay choice, independent from the theme
  // palette above. { mode: 'theme-default' | 'none' | 'custom', effectId? }
  const [effectPref, setEffectPrefState] = useState(() => getEffectPreference());
  const setEffectPref = (pref) => { setEffectPrefState(pref); setEffectPreference(pref); };
  // Ref-based memo cache for the resolved effect preset (NOT useMemo: this
  // component has an early `return` for the loading state below, and hooks
  // must never be called conditionally — a useMemo placed after that return
  // would be skipped on the first render and added on a later one, which is
  // exactly React error #310, "rendered more hooks than previous render".
  // A ref declared here, before any early return, sidesteps that entirely —
  // everything that reads/writes it afterwards is plain JS, not a hook.
  const effectMemoRef = useRef({ seasonalDeps: null, seasonal: null, resolvedDeps: null, resolved: null });

  const initialTable = readTable();
  // A previously-saved order (survives a browser refresh). A fresh QR scan
  // (initialTable) always wins over the saved dine-in/table.
  const stored = getStoredOrder();
  const [dineIn, setDineIn] = useState(initialTable ? true : (stored ? stored.dineIn : false));
  const [table, setTable] = useState(initialTable || stored?.table || '');
  // Table lock level: 2 = scanned (solid pill), 1 = solid chip (not editable),
  // 0 = manual entry. Each ✕ steps down one level.
  const [tableLock, setTableLock] = useState(initialTable ? 2 : 0);
  const unlockTable = () => setTableLock((l) => Math.max(0, l - 1));

  // Takeaway timing: now (default) or later (scheduled via the calendar).
  const [preWhen, setPreWhen] = useState('now');
  const _tmr = new Date(Date.now() + 86400000);
  const [preAt, setPreAt] = useState({
    date: `${_tmr.getFullYear()}-${String(_tmr.getMonth() + 1).padStart(2, '0')}-${String(_tmr.getDate()).padStart(2, '0')}`,
    time: '08:00',
  });

  // Handle a QR scanned in-app: the code holds a URL like .../?table=7 (or a
  // bare number). Pull out the table, switch to Dine in and lock it in.
  function applyScannedTable(raw) {
    let t = '';
    try { const u = new URL(raw); t = u.searchParams.get('table') || u.searchParams.get('t') || ''; } catch {}
    if (!t) { const m = String(raw).match(/(?:table|t)=([^&\s]+)/i); if (m) t = m[1]; }
    if (!t) { const n = String(raw).match(/\d+/); if (n) t = n[0]; }
    t = String(t || '').trim();
    if (t) { setTable(t); setDineIn(true); setTableLock(2); }
  }
  const [name, setName] = useState(user?.name || stored?.name || '');
  const [cart, setCart] = useState(() => stored?.cart || []);
  const [query, setQuery] = useState('');
  const [activeCat, setActiveCat] = useState(null); // one-shot scroll target for MenuList
  const [scrollTick, setScrollTick] = useState(0); // nonce so the same target re-fires a scroll
  const [spyCat, setSpyCat] = useState(null); // persistent "current section" for the dock highlight
  const [activeGroup, setActiveGroup] = useState(null); // category names shown in 'single' layout

  // Sticky-shell measuring + header scroll state. Downstream sticky offsets read
  // the CSS vars --shell-h (shell height) and --dock-h (category dock height) so
  // nothing hardcodes a pixel offset.
  const headerRef = useRef(null);
  const hoursRef = useRef(null);
  // Footer dock cycling: repeated presses of the SAME slot step through its
  // categories (e.g. an "All Day" slot = [Breakfast, Lunch]).
  const footerCycle = useRef({ slot: -1, idx: 0 });
  const [shellH, setShellH] = useState(0);
  const [dockH, setDockH] = useState(0);
  const [scrolled, setScrolled] = useState(false);

  const buildRef = useRef(null); // live build id, to detect a new deploy
  // Load config + menu; apply theme (saved user theme wins over store default).
  useEffect(() => {
    api.getConfig()
      .then((cfg) => {
        setConfig(cfg);
        buildRef.current = cfg.build || null;
        // The storefront PALETTE is driven by the token engine (applyStoreTheme);
        // the returned object (a seasonal theme or null) still feeds activeTheme
        // for its --season-* decor + effects/perimeter overlays.
        const active = applyThemeForLoad(cfg);
        setActiveTheme(active);
      })
      .catch((e) => setLoadErr(e.message));
    api.getMenu().then(setMenu).catch((e) => setLoadErr(e.message));
  }, []);

  // Single-layout default: activate the FIRST top-nav category (e.g. Coffee) so
  // its dock tile renders active on load showing its real live count, and the
  // Coffee items are what's shown. Config + menu load separately, so this waits
  // for the menu and only seeds when no group has been chosen yet.
  useEffect(() => {
    if (!menu || !config) return;
    if ((config.layoutMode || 'onepage') !== 'single') return;
    if (activeGroup && activeGroup.length) return;
    const first = menu.categories.find((c) => c.topNav !== false);
    if (first) setActiveGroup([first.category]);
  }, [menu, config, activeGroup]);

  // Auto-update: when the tab is re-shown, check the live build id and refresh
  // config/menu. If a NEW deploy is live, reload once so nobody is stuck stale.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      api.getConfig().then((cfg) => {
        if (buildRef.current && cfg.build && cfg.build !== buildRef.current) { window.location.reload(); return; }
        buildRef.current = cfg.build || buildRef.current;
        setConfig(cfg);
      }).catch(() => {});
      api.getMenu().then(setMenu).catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // Admin route
  useEffect(() => {
    if (window.location.pathname.replace(/\/$/, '') === '/admin') setView('admin');
  }, []);

  // Analytics: one visit event per load; apply a custom favicon if configured.
  useEffect(() => {
    if (!config) return;
    track('view');
    if (config.faviconUrl) {
      let link = document.querySelector('link[rel="icon"]');
      if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
      link.href = config.faviconUrl;
    }
  }, [config]);

  // Track entering checkout (funnel step) once per entry.
  const prevView = React.useRef('home');
  useEffect(() => {
    if (view === 'checkout' && prevView.current !== 'checkout') track('checkout');
    prevView.current = view;
  }, [view]);

  // ── Favourite orders (localStorage, namespaced per signed-in user) ──────
  const uid = user?.id || user?.customerId || null;
  const [favorites, setFavorites] = useState(() => getFavorites(uid));
  // Reload the correct list when the signed-in user changes.
  useEffect(() => { setFavorites(getFavorites(uid)); }, [uid]);
  function persistFavs(next) { setFavorites(next); saveFavorites(uid, next); }
  const favId = () => String(Date.now()) + Math.random().toString(36).slice(2, 6);
  // Build cart-shaped line items from a past order, exactly like reorder() does —
  // we only ever keep the items, never a table/fulfilment choice.
  function favItemsFrom(order) {
    return (order.items || []).filter((it) => it.variationId).map((it) => ({
      variationId: it.variationId, itemName: it.name, variationName: it.variation || '',
      modifierIds: it.modifierIds || [], modifierNames: it.modifierNames || [],
      unitPrice: it.unitPrice || 0, quantity: Number(it.quantity) || 1, note: '',
    }));
  }
  function addFavorite(order, name) {
    const items = favItemsFrom(order);
    if (!items.length) return false;
    persistFavs([{ id: favId(), name: (name && name.trim()) || 'My order', items, createdAt: Date.now() }, ...favorites]);
    track('favorite_add');
    return true;
  }
  function removeFavorite(id) { persistFavs(favorites.filter((f) => f.id !== id)); }
  function renameFavorite(id, name) {
    persistFavs(favorites.map((f) => (f.id === id ? { ...f, name: name.trim() || f.name } : f)));
  }
  // Load a favourite into the cart and drop the customer into the cart so they
  // choose Dine in / Takeaway + pay. Never auto-select a table — force a fresh
  // fulfilment choice (matches reorder's setDineIn(null)).
  function orderFavorite(fav) {
    if (!fav.items?.length) return;
    setCart(fav.items.map((it) => ({
      ...it,
      key: `${it.variationId}:${(it.modifierIds || []).join(',')}:fav${Math.random().toString(36).slice(2, 5)}`,
    })));
    setDineIn(null); setTable(''); setTableLock(0);
    setView(wide ? 'home' : 'cart');
    track('favorite_order');
    window.scrollTo({ top: 0 });
  }

  // Reorder a past order: reload its items; force a fresh Dine in / Takeaway
  // choice (their table may have changed since).
  function reorder(order) {
    const entries = (order.items || []).filter((it) => it.variationId).map((it) => ({
      key: `${it.variationId}:${(it.modifierIds || []).join(',')}:re`,
      variationId: it.variationId, itemName: it.name, variationName: it.variation || '',
      modifierIds: it.modifierIds || [], modifierNames: it.modifierNames || [],
      unitPrice: it.unitPrice || 0, quantity: Number(it.quantity) || 1, note: '',
    }));
    if (!entries.length) return;
    setCart(entries);
    setDineIn(null); setTable(''); setTableLock(0);
    setView('home');
    setActiveCat(null);
    track('reorder');
    window.scrollTo({ top: 0 });
  }

  // Bring the menu list up to just under the sticky header + category bar,
  // WITHOUT jumping all the way to the top (hero). Used when switching category
  // from the bottom nav so you land on the category, category chips still in view.
  function scrollToMenu() {
    const run = () => {
      const menuEl = document.querySelector('.menu');
      if (!menuEl) return;
      const bar = document.querySelector('.topbar');
      const nav = document.querySelector('.catnav');
      const offset = (bar?.offsetHeight || 64) + (nav?.offsetHeight || 48);
      const absTop = menuEl.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({ top: Math.max(0, absTop - offset) });
    };
    // Run after the view/category has re-rendered.
    requestAnimationFrame(() => requestAnimationFrame(run));
  }

  const currency = config?.currency || menu?.currency || 'AUD';
  const layoutMode = config?.layoutMode || 'onepage';
  const xmas = activeTheme?.id === 'christmas';
  const wide = useMediaQuery('(min-width: 900px)'); // desktop + landscape tablet
  const isMobile = useMediaQuery('(max-width: 767px)'); // phones only (tablet 768-899 unchanged)

  // On wide layouts the cart lives in the sidebar — no separate cart page.
  useEffect(() => {
    if (wide && view === 'cart') setView('home');
  }, [wide, view]);

  // Bottom-nav slots come ONLY from the footer builder groups you set up (kept to
  // categories that exist in the live menu). Categories not in a group are still
  // reachable from the top category chips — we don't auto-add stray buttons.
  // Footer = sections with the "Footer" toggle on. The Footer menu builder can
  // group some into a single labelled button (e.g. "Food" = Breakfast + Lunch);
  // any footer-on section not in a group gets its own button (icon by name).
  const footerSlots = useMemo(() => {
    if (!menu) return [];
    const live = menu.categories.filter((c) => c.footerNav === true);
    // Any section that exists in the live menu can be placed in a footer button —
    // explicitly grouping it into a footer button IS the intent to show it, even
    // if its own "Footer" toggle is off (e.g. Combos / Specials, which default to
    // the top bar). Auto buttons below still only appear for Footer-toggled ones.
    const allNames = new Set(menu.categories.map((c) => c.category.toLowerCase()));
    const grouped = new Set();
    const manual = (config?.footer || [])
      .map((slot) => ({ ...slot, cats: (slot.categories || []).filter((cat) => allNames.has(cat.toLowerCase())) }))
      .filter((slot) => slot.cats.length);
    manual.forEach((slot) => slot.cats.forEach((c) => grouped.add(c.toLowerCase())));
    const auto = live
      .filter((c) => !grouped.has(c.category.toLowerCase()))
      .map((c) => ({ label: c.category, icon: iconFor(c.category), categories: [c.category], cats: [c.category] }));
    return [...manual, ...auto];
  }, [config, menu]);
  const canOrder = config?.hours?.canOrderNow !== false;
  const preorder = config?.hours?.preorder;
  const storeOpen = config?.hours?.open !== false;
  const kitchen = config?.hours?.kitchen || null;
  // Made-to-order categories are only unavailable when the store is OPEN but the
  // kitchen has shut (fridge items stay available). When the whole store is
  // closed, everything is pre-orderable for later, so nothing is disabled here.
  //
  // For a SCHEDULED ("Later") takeaway pickup, "closed" must be evaluated at the
  // chosen future time, not right now — otherwise you can book a 2:30pm pickup
  // for a kitchen that closes at 2pm and still add Lunch items to the cart.
  const DAYS_SQ = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const fmt12 = (hhmm) => {
    if (!hhmm) return '';
    const [h, m] = hhmm.split(':').map(Number);
    const ap = h >= 12 ? 'pm' : 'am';
    let hh = h % 12; if (hh === 0) hh = 12;
    return m ? `${hh}:${String(m).padStart(2, '0')}${ap}` : `${hh}${ap}`;
  };
  const dstrLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const kitchenStatusAt = (weekly, ds, hhmm) => {
    const [y, mo, d] = ds.split('-').map(Number);
    const dow = new Date(y, mo - 1, d).getDay();
    const periods = (weekly?.[DAYS_SQ[dow]] || []).filter((p) => p.startMin != null && p.endMin != null);
    const [hh, mm] = hhmm.split(':').map(Number);
    const minutes = hh * 60 + mm;
    let openNow = false;
    for (const p of periods) {
      let end = p.endMin; if (end <= p.startMin) end += 24 * 60;
      if (minutes >= p.startMin && minutes < end) { openNow = true; break; }
    }
    const last = periods[periods.length - 1];
    return { open: openNow, closesLabel: last ? fmt12(last.end) : null };
  };
  const schedLater = dineIn === false && preWhen === 'later' && !!(preAt?.date && preAt?.time);
  let kitchenClosedCats = [];
  if (storeOpen && kitchen && kitchen.hasHours && kitchen.weekly) {
    const now = new Date();
    const ds = schedLater ? preAt.date : dstrLocal(now);
    const hhmm = schedLater ? preAt.time : `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    if (!kitchenStatusAt(kitchen.weekly, ds, hhmm).open) kitchenClosedCats = kitchen.categories || [];
  } else if (storeOpen && kitchen && !schedLater && kitchen.open === false) {
    kitchenClosedCats = kitchen.categories || [];
  }
  const kitchenClosedSet = new Set((kitchenClosedCats || []).map((x) => (x || '').toLowerCase()));
  // If the kitchen closes while an item sits in the cart (e.g. mid-shop), flag
  // it as unavailable and block checkout until it's removed — never silently
  // let a customer pay for something the kitchen can no longer make.
  const cartUnavailableKeys = new Set(
    cart.filter((c) => c.category && kitchenClosedSet.has(String(c.category).toLowerCase())).map((c) => c.key)
  );
  // Compact "Takeaway · Now" / "Takeaway · Tue 11 Aug, 8:00am" / "Dine in ·
  // Table 4" label for the cart sidebar's fulfilment badge.
  const fulfilmentLabel = dineIn
    ? `Dine in · Table ${table || '—'}`
    : (schedLater ? `Takeaway · ${fmtWhen(preAt)}` : 'Takeaway · Now');

  const cartCount = cart.reduce((n, c) => n + c.quantity, 0);
  const cartTotal = Math.max(0, cart.reduce((n, c) => n + c.unitPrice * c.quantity, 0) - comboDiscountFor(cart));

  // Apply the storefront theme on load with this precedence, returning the theme
  // object that should drive activeTheme (seasonal effects/perimeter) or null:
  //   preview (?season=/​?themePreview=) → auto seasonal (unless opted out) →
  //   saved permanent/seasonal blob → store default preset → espresso fallback.
  // The PALETTE always flows through applyStoreTheme (the --t-* token engine); a
  // seasonal ALSO gets the legacy applyTheme() so its --season-*/data-season
  // decorations render on top.
  function applyThemeForLoad(cfg) {
    const previewId = readPreview();
    // Admin/dev preview forces a seasonal palette + decor regardless of date.
    if (previewId && previewId !== 'off') {
      const s = (cfg.seasonalThemes || []).find((x) => x.id === previewId);
      if (s) { applyTheme(s); applyStoreTheme(seasonalAsPreset(s)); return s; }
    }
    // (a) Auto seasonal, unless the customer opted out or forced it off.
    if (previewId !== 'off' && !getSeasonOptOut() && cfg.activeSeasonalTheme) {
      applyTheme(cfg.activeSeasonalTheme);
      applyStoreTheme(seasonalAsPreset(cfg.activeSeasonalTheme));
      return cfg.activeSeasonalTheme;
    }
    // (b) A saved store-theme blob (the source of truth for a manual pick).
    const blob = getStoredThemeBlob();
    if (blob && blob.id) {
      // A hand-picked seasonal palette keeps its decor (but never its banner).
      const seasonal = (cfg.seasonalThemes || []).find((x) => x.id === blob.id);
      if (seasonal) { applyTheme(seasonal); applyStoreTheme(seasonalAsPreset(seasonal)); return seasonal; }
      document.documentElement.removeAttribute('data-season');
      applyStoreTheme(resolvePreset(blob.id));
      return null;
    }
    // (c) Store default preset (espresso fallback is inherent in the CSS).
    document.documentElement.removeAttribute('data-season');
    applyStoreTheme(resolvePreset(cfg.defaultThemeId || 'espresso-plum'));
    return null;
  }

  // Picking one of the 8 permanent presets: re-skin via the token engine, drop
  // any seasonal decor/effects, and persist the blob (source of truth on reload).
  function updateTheme(preset) {
    applyStoreTheme(preset);
    document.documentElement.removeAttribute('data-season');
    setActiveTheme(null);
    saveStoredTheme({ id: preset.id, v: 1, ts: Date.now(), explicit: true, tokens: buildTokens(preset) });
    setSavedTheme(null); // clear any legacy custom-colour override
    setSeasonOptOut(true); // a manual permanent pick isn't overridden by auto-seasonal
  }
  // "Use store theme": clear every override and re-apply the store default (or the
  // in-window auto seasonal), matching the load precedence.
  function resetTheme() {
    saveStoredTheme(null);
    setSavedTheme(null);
    setSeasonOptOut(false);
    if (!config) return;
    if (!getSeasonOptOut() && config.activeSeasonalTheme) {
      applyTheme(config.activeSeasonalTheme);
      applyStoreTheme(seasonalAsPreset(config.activeSeasonalTheme));
      setActiveTheme(config.activeSeasonalTheme);
    } else {
      document.documentElement.removeAttribute('data-season');
      applyStoreTheme(resolvePreset(config.defaultThemeId || 'espresso-plum'));
      setActiveTheme(null);
    }
  }
  function onSignIn(u) {
    setUserState(u);
    saveUser(u);
    if (u?.name && !name) setName(u.name);
  }
  function onSignOut() {
    setUserState(null);
    saveUser(null);
  }

  function addToCart(entry) {
    setCart((prev) => {
      const existing = prev.find((c) => c.key === entry.key);
      if (existing)
        return prev.map((c) => (c.key === entry.key ? { ...c, quantity: c.quantity + entry.quantity } : c));
      return [...prev, entry];
    });
    track('add_cart', { ref: entry.itemName, qty: entry.quantity });
    setActiveItem(null);
  }
  // A combo adds several linked cart lines at once (one per group choice),
  // tagged with a shared comboInstanceId so the cart can group/remove/adjust
  // them together as one unit — see ComboModal. Always appended fresh (never
  // merged with an existing instance), so ordering the same combo twice makes
  // two clearly separate combo cards rather than silently merging quantities.
  function addComboToCart(entries, meta) {
    setCart((prev) => [...prev, ...entries]);
    track('add_cart', { ref: meta?.comboName || 'Combo', qty: meta?.quantity || 1 });
    setActiveItem(null);
  }
  function updateComboQty(instanceId, delta) {
    setCart((prev) => {
      const next = prev.map((c) => (c.comboInstanceId === instanceId ? { ...c, quantity: c.quantity + delta } : c));
      const stillHas = next.some((c) => c.comboInstanceId === instanceId && c.quantity > 0);
      return stillHas ? next : next.filter((c) => c.comboInstanceId !== instanceId);
    });
  }
  function removeCombo(instanceId) {
    setCart((prev) => prev.filter((c) => c.comboInstanceId !== instanceId));
  }
  // Edit a combo: drop the current instance and reopen its builder so the
  // customer can re-pick. Keeps combos atomic — we never let them tweak one
  // component of a live bundle (that's what broke the discount).
  function editCombo(instanceId) {
    const line = cart.find((c) => c.comboInstanceId === instanceId);
    if (!line) return;
    const comboItem = (menu.categories || []).flatMap((c) => c.items || []).find((i) => i.isCombo && i.comboId === line.comboId);
    removeCombo(instanceId);
    if (comboItem) setActiveItem(comboItem);
  }
  function trackPurchase(order) {
    trackItems('purchase_item', cart.map((c) => ({ name: c.itemName, qty: c.quantity, amount: c.unitPrice * c.quantity })));
    track('purchase', { amount: order?.totalMoney?.amount || cartTotal });
  }
  function updateQty(key, delta) {
    setCart((prev) =>
      prev.map((c) => (c.key === key ? { ...c, quantity: c.quantity + delta } : c)).filter((c) => c.quantity > 0)
    );
  }
  function removeItem(key) {
    setCart((prev) => prev.filter((c) => c.key !== key));
  }
  function clearCart() {
    setCart([]);
    if (!wide) setView('home');
  }
  // Persist the in-progress order so a browser refresh never loses it.
  useEffect(() => {
    setStoredOrder({ cart, dineIn, table, name });
  }, [cart, dineIn, table, name]);

  // When the store is closed, takeaway "now" isn't possible — default to "later".
  useEffect(() => {
    if (config?.hours?.open === false && preWhen === 'now') setPreWhen('later');
  }, [config, preWhen]);

  // Warm up the Square payments SDK as soon as there's something in the cart, so
  // the card form + wallet buttons are ready the instant checkout opens (instead
  // of downloading the SDK only once you get there).
  useEffect(() => {
    if (!config || cart.length === 0 || window.Square || document.getElementById('sq-sdk')) return;
    const src = config.environment === 'sandbox'
      ? 'https://sandbox.web.squarecdn.com/v1/square.js'
      : 'https://web.squarecdn.com/v1/square.js';
    const s = document.createElement('script');
    s.id = 'sq-sdk'; s.src = src; s.async = true;
    document.head.appendChild(s);
  }, [config, cart.length]);
  function onPaid(payment, order, meta) {
    trackPurchase(order);
    setCompleted({ payment, order, meta: meta || {} });
    setCart([]);
    setView('done');
  }
  function onScheduledOrder(scheduled, meta) {
    trackPurchase(null);
    setCompleted({ scheduled, meta: meta || {} });
    setCart([]);
    setView('done');
  }

  // Live search across all loaded categories
  const filteredMenu = useMemo(() => {
    if (!menu) return null;
    const q = query.trim().toLowerCase();
    if (q) {
      return menu.categories
        .map((c) => ({
          ...c,
          items: c.items.filter(
            (i) => i.name.toLowerCase().includes(q) || (i.description || '').toLowerCase().includes(q)
          ),
        }))
        .filter((c) => c.items.length);
    }
    if (layoutMode === 'single' && activeGroup && activeGroup.length) {
      const set = new Set(activeGroup.map((s) => s.toLowerCase()));
      return menu.categories.filter((c) => set.has(c.category.toLowerCase()));
    }
    return menu.categories;
  }, [menu, query, layoutMode, activeGroup]);

  // Header shadow only after the page has scrolled past a small threshold. One
  // passive listener that flips a boolean at the crossing — no per-pixel setState.
  useEffect(() => {
    let last = false;
    const onScroll = () => { const s = window.scrollY > 6; if (s !== last) { last = s; setScrolled(s); } };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Measure the two independent sticky bands — header + hours — into their own
  // CSS vars and their sum into --shell-h. Both are direct children of the page
  // so each sticks to the viewport; downstream offsets (dock top, cart top,
  // section scroll-margin) read --shell-h. A ResizeObserver on each element
  // picks up height changes (tall closed notice, rotating strip); a window
  // resize listener catches reflow that doesn't resize the elements themselves.
  useEffect(() => {
    const root = document.documentElement;
    const measure = () => {
      const header = headerRef.current;
      const hours = hoursRef.current;
      const hh = header ? Math.round(header.getBoundingClientRect().height) : 0;
      const oh = hours ? Math.round(hours.getBoundingClientRect().height) : 0;
      root.style.setProperty('--header-h', hh + 'px');
      root.style.setProperty('--hours-h', oh + 'px');
      root.style.setProperty('--shell-h', (hh + oh) + 'px');
      setShellH(hh + oh);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (headerRef.current) ro.observe(headerRef.current);
    if (hoursRef.current) ro.observe(hoursRef.current);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [config, menu, view]);

  // Measure the category dock height into --dock-h for section scroll offsets.
  useEffect(() => {
    const root = document.documentElement;
    const dock = document.querySelector('.menu-dock-wrap');
    if (!dock) { root.style.setProperty('--dock-h', '0px'); setDockH(0); return; }
    const measure = () => {
      const h = Math.round(dock.getBoundingClientRect().height);
      setDockH(h);
      root.style.setProperty('--dock-h', h + 'px');
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(dock);
    return () => ro.disconnect();
  }, [view, wide, query, layoutMode, filteredMenu]);

  // Scroll-spy: as menu sections cross the sticky offset, highlight the dock tab.
  // A single trip-line IntersectionObserver — no unthrottled scroll handler.
  // Only in the multi-section (default) layout, not single-group mode.
  useEffect(() => {
    const inLayout = view === 'home' || (wide && view === 'checkout');
    if (!inLayout || query || layoutMode === 'single') return;
    const sections = [...document.querySelectorAll('.menu section[data-cat]')];
    if (!sections.length) return;
    const offset = shellH + dockH + 8;
    const io = new IntersectionObserver(
      (entries) => { entries.forEach((e) => { if (e.isIntersecting) setSpyCat(e.target.getAttribute('data-cat')); }); },
      { rootMargin: `-${offset}px 0px -${Math.max(0, window.innerHeight - offset - 4)}px 0px`, threshold: 0 }
    );
    sections.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, [view, wide, query, layoutMode, filteredMenu, shellH, dockH]);

  if (loadErr && !config) {
    return (
      <div className="app">
        <div className="center-screen">
          <div className="card">
            <h2 className="serif">Can’t load right now</h2>
            <p className="muted">{loadErr}</p>
            <button className="btn" onClick={() => window.location.reload()}>Retry</button>
          </div>
        </div>
      </div>
    );
  }
  if (!config || !menu) {
    return (
      <div className="app">
        <div className="center-screen">
          <div style={{ color: 'var(--brand)', marginBottom: 4 }}><Logo height={46} /></div>
          <div className="spinner" />
        </div>
      </div>
    );
  }

  if (view === 'admin') return <Admin config={config} onExit={() => { window.history.pushState({}, '', '/'); setView('home'); }} />;

  if (view === 'done' && completed) {
    const { payment, order, scheduled, meta = {} } = completed;
    if (scheduled) {
      return (
        <div className="app">
          <div className="center-screen">
            <div className="card center" style={{ maxWidth: 380 }}>
              <div className="tick">✓</div>
              <h2 className="serif">{meta.recurring ? 'Repeating order set up' : 'Pre-order scheduled'}</h2>
              <p>{meta.recurring
                ? `We’ll place this order and charge your saved card ${meta.when || 'on schedule'}.`
                : `We’ll have it ready for ${meta.when || 'your chosen time'} and charge your saved card then.`}</p>
              <p className="muted" style={{ fontSize: 13 }}>Manage or cancel it any time from your Account.</p>
              <button className="btn full" onClick={() => { setCompleted(null); setView('home'); }}>Done</button>
            </div>
          </div>
        </div>
      );
    }
    const pickupAt = meta.pickupAt ? new Date(meta.pickupAt) : null;
    return (
      <div className="app">
        <div className="center-screen">
          <div className="card center" style={{ maxWidth: 380 }}>
            <div className="tick">✓</div>
            <h2 className="serif">{pickupAt ? 'Pre-order confirmed' : 'Order placed'}</h2>
            {order.ticketName && <p className="muted">Ticket: {order.ticketName}</p>}
            {pickupAt
              ? <p>Ready {pickupAt.toLocaleString('en-AU', { weekday: 'short', hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' })}{dineIn ? ` · table ${table}` : ''}.</p>
              : <p>{dineIn ? `We’ll bring it to table ${table}.` : `Thanks ${name || ''} — we’ll call your name.`}</p>}
            {payment.comped && <p className="muted">No card charged.</p>}
            {payment.receiptUrl && (
              <a className="link" href={payment.receiptUrl} target="_blank" rel="noreferrer">View receipt</a>
            )}
            <button className="btn full" onClick={() => { setCompleted(null); setView('home'); }}>
              Start a new order
            </button>
          </div>
        </div>
      </div>
    );
  }

  // On wide layouts the checkout lives in the cart sidebar (true one-page).
  const checkoutEl = (
    <Checkout
      config={config} cart={cart} currency={currency} onQty={updateQty}
      onComboQty={updateComboQty} onRemoveCombo={removeCombo} onEditCombo={editCombo}
      dineIn={dineIn} setDineIn={setDineIn} table={table} setTable={setTable}
      tableLock={tableLock} onUnlockTable={unlockTable} onScanTable={applyScannedTable}
      name={name} setName={setName} user={user} canOrder={canOrder}
      preWhen={preWhen} preAt={preAt}
      onPaid={onPaid} onScheduled={onScheduledOrder} onBack={() => setView(wide ? 'home' : 'cart')}
    />
  );
  const showLayout = view === 'home' || (wide && view === 'checkout');

  // A festive/custom theme's banner is shown #1 in the hero rotation ONLY when
  // the theme is auto-active for today's date (a scheduled event). A theme a
  // customer picks by hand from the appearance menu changes colours only — it
  // never injects the banner (so nobody sees "Merry Christmas" in April just
  // because they tried the Christmas look).
  // The event whose date window is ACTIVE right now (server-computed), or an
  // admin/dev preview override. Banner + animated effects are gated on THIS —
  // never on a palette the customer hand-picked out of season. So a manual
  // Christmas-in-April shows Christmas colours but no banner and no snow.
  const previewSeasonalId = readPreview();
  const eventSeasonal = (previewSeasonalId && previewSeasonalId !== 'off'
    ? (config.seasonalThemes || []).find((x) => x.id === previewSeasonalId)
    : null) || config?.activeSeasonalTheme || null;
  const seasonBanner = eventSeasonal?.banner || null;
  const heroSlides = seasonBanner
    ? [{ id: 'season-banner', ...seasonBanner }, ...(config.hero || [])]
    : (config.hero || []);
  // Resolve the active event's decorative-effect config (schema v2), with a
  // back-compat fallback that maps a pre-v2 record's old effect flags to a
  // preset so saved data never breaks.
  const prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Effects Engine resolution. Themes/seasonal events reference a reusable
  // effect by stable id (never by name) — `config.effects` is the enabled,
  // customer-safe list published by /api/config (see server/lib/settings.js).
  const EFFECT_INTENSITY = { subtle: 0.72, standard: 1, celebratory: 1.15 };
  const effectsList = config.effects || [];
  const findEffect = (id) => effectsList.find((e) => e.id === id) || null;
  // The active event's OWN assigned effect — only meaningful while its date
  // window is active (banner + effect always gated on the date, never on a
  // palette a customer hand-picked out of season).
  // Memoised on primitive fields only (not object identity) — App re-renders
  // often (scroll state, ticking countdowns, etc.), and EffectOverlay's own
  // effect restarts whenever the `preset` prop reference changes. Without
  // this, a fresh object literal every render would cancel+restart the
  // engine's boot before its idle-callback ever fires, so the canvas would
  // exist but never actually draw a single particle.
  const seasonalEc = eventSeasonal?.effectsConfig;
  const seasonalDeps = [eventSeasonal?.id, seasonalEc?.effectsEnabled, seasonalEc?.effectId, seasonalEc?.intensity, effectsList];
  const seasonalDepsChanged = !effectMemoRef.current.seasonalDeps
    || seasonalDeps.some((v, i) => v !== effectMemoRef.current.seasonalDeps[i]);
  if (seasonalDepsChanged) {
    effectMemoRef.current.seasonal = (() => {
      if (!eventSeasonal || !seasonalEc || seasonalEc.effectsEnabled === false || !seasonalEc.effectId) return null;
      const e = findEffect(seasonalEc.effectId);
      if (!e) return null;
      const mult = EFFECT_INTENSITY[seasonalEc.intensity] || 1;
      return { ...e, emission: { ...e.emission, density: (e.emission?.density ?? 1) * mult } };
    })();
    effectMemoRef.current.seasonalDeps = seasonalDeps;
  }
  const seasonalEffectPreset = effectMemoRef.current.seasonal;
  // The customer's independent overlay choice always wins over the seasonal
  // default: an explicit "none" suppresses even an active seasonal effect; an
  // explicit custom pick runs any time (and never triggers a seasonal banner
  // on its own). "theme-default" falls back to the seasonal effect above,
  // which is itself null outside the event's date window. A disabled/deleted
  // custom choice falls back to theme-default rather than crashing.
  const resolvedDeps = [effectPref?.mode, effectPref?.effectId, seasonalEffectPreset, effectsList];
  const resolvedDepsChanged = !effectMemoRef.current.resolvedDeps
    || resolvedDeps.some((v, i) => v !== effectMemoRef.current.resolvedDeps[i]);
  if (resolvedDepsChanged) {
    effectMemoRef.current.resolved = (() => {
      if (effectPref?.mode === 'custom') {
        const e = findEffect(effectPref.effectId);
        if (e && e.frontendSelectable !== false) return e;
      } else if (effectPref?.mode === 'none') {
        return null;
      }
      return seasonalEffectPreset;
    })();
    effectMemoRef.current.resolvedDeps = resolvedDeps;
  }
  const resolvedEffectPreset = effectMemoRef.current.resolved;

  // "Browse menu" dock data — real categories, live item counts, icon by name.
  const catIcons = config.categoryIcons || {};
  const dockCategories = menu.categories
    .filter((c) => c.topNav !== false)
    .map((c) => {
      const chosen = catIcons[c.category] || catIcons[(c.category || '').toLowerCase()];
      return { name: c.category, count: (c.items || []).length, iconName: chosen?.icon || iconFor(c.category), iconSvg: chosen?.iconSvg || null };
    });
  const dockActive = layoutMode === 'single'
    ? (activeGroup && activeGroup.length === 1 ? activeGroup[0] : null)
    : (spyCat || activeCat);
  // Picking a category: single-layout swaps the shown group; default layout
  // scroll-spies + scrolls to the section (activeCat drives MenuList's scroll).
  const pickCategory = (cat) => {
    setQuery('');
    footerCycle.current = { slot: -1, idx: 0 }; // a dock/search pick resets footer cycling
    if (layoutMode === 'single') { setActiveGroup([cat]); setActiveCat(cat); }
    else { setSpyCat(cat); setActiveCat(cat); }
    setScrollTick((t) => t + 1);
  };
  // Primary-nav "Coffee" → first coffee-ish category, only if one exists.
  const coffeeCat = menu.categories.find((c) => (c.category || '').toLowerCase().includes('coffee') && c.topNav !== false) || null;
  const goMenu = () => { setView('home'); setQuery(''); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const locLabel = locationLabel(config);
  // Nav active state on the ordering page: only "Menu" is active on home; the
  // Coffee link is a category shortcut and is NEVER shown active. Category
  // selection must not drive nav active state (that caused Menu + Coffee both on).
  const navActive = (key) => {
    if (key === 'menu') return view === 'home';
    if (key === 'store') return view === 'store';
    return false;
  };

  // Operational notices for the sticky strip — built from existing hours/kitchen/
  // announcement logic, urgent/operational before promotional.
  const nHours = config.hours || {};
  const nLabel = nHours.nextOpen?.label;
  const scrollMenu = () => { const el = document.querySelector('.menu'); if (el) el.scrollIntoView({ behavior: 'smooth' }); };
  // Pre-order CTA lands the customer on the fulfilment row (Dine in / Takeaway /
  // Reserve) just under the sticky stack — not the search box or the dock.
  const scrollToOrderType = () => {
    // Scroll the WINDOW (not element.scrollIntoView): scrollIntoView + sticky
    // siblings leaves the sticky header mis-painted until the next scroll event
    // in some browsers, so compute the target manually and use window.scrollTo,
    // which recomputes the sticky stack correctly. Offset by the measured
    // header+hours height (--shell-h) so the fulfilment row lands just below it.
    const el = document.querySelector('.ordertype');
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const shellH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--shell-h'), 10) || 130;
    const y = el.getBoundingClientRect().top + window.scrollY - shellH - 14;
    window.scrollTo({ top: Math.max(0, y), behavior: reduce ? 'auto' : 'smooth' });
  };
  // Jump to a named category heading (falls back to the old default behaviour
  // when the configured name is blank or doesn't match a live category — e.g.
  // the owner hasn't set it yet, or renamed/removed that section in Square).
  const jumpToCategory = (name, fallback) => {
    const want = String(name || '').trim().toLowerCase();
    const match = want && menu?.categories?.find((c) => (c.category || '').trim().toLowerCase() === want);
    if (match) { setView('home'); pickCategory(match.category); } else { fallback(); }
  };
  const notices = [];
  if (!storeOpen) {
    if (preorder) {
      const no = nHours.nextOpen;
      notices.push({
        id: 'closed', type: 'urgent', icon: '●',
        reopen: true,
        minsUntil: no?.minsUntil,
        elapsedMin: nHours.closedSinceMin,
        reopenLabel: no?.label,
        text: `We’re closed${nLabel ? ` — we reopen ${nLabel}` : ''}. Pre-order now — we’ll start it when we open.`,
        cta: { label: 'Pre-order now', onClick: () => { setDineIn(false); setPreWhen('later'); jumpToCategory(config.preorderCategory, () => { setView('home'); scrollToOrderType(); }); } },
      });
    } else {
      notices.push({ id: 'closed', type: 'urgent', icon: '●', text: `We’re closed right now${nLabel ? ` — we reopen ${nLabel}` : ''}.` });
    }
  } else {
    const k = nHours.kitchen?.closesInMin;
    if (k != null && k > 0 && k <= 60) {
      const closeAt = new Date(Date.now() + k * 60000);
      const closesLabel = fmt12(`${String(closeAt.getHours()).padStart(2, '0')}:${String(closeAt.getMinutes()).padStart(2, '0')}`);
      notices.push({
        id: 'kitchen', type: 'warning', icon: '🔥',
        text: `Kitchen closes in ${k} min${k === 1 ? '' : 's'} — order now.`,
        closesInMin: k,
        closesLabel,
        categories: nHours.kitchen?.categories || [],
        cta: { label: 'Order now', onClick: () => jumpToCategory(config.kitchenClosingOrderCategory, () => { setView('home'); scrollMenu(); }) },
      });
    }
  }
  if (config.announcement) notices.push({ id: 'announce', type: 'promotional', text: config.announcement, dismissible: true });

  return (
    <div className={`app store-shell${(view === 'store' || view === 'reserve' || (!wide && view === 'checkout')) ? ' app-flush' : ''}`}
      style={{ '--dock-icon-scale': config.dockIconScale || 1, '--footer-icon-scale': config.footerIconScale || 1 }}>
      {resolvedEffectPreset && (
        <EffectOverlay
          preset={resolvedEffectPreset}
          active
          reducedMotion={prefersReducedMotion}
        />
      )}
      {eventSeasonal?.id && activeTheme?.id === eventSeasonal.id && activeTheme?.decor?.perimeter && (
        <SeasonalPerimeter id={activeTheme.id} decor={activeTheme.decor} />
      )}

      <header ref={headerRef} className={`site-header${scrolled ? ' is-scrolled' : ''}`}>
        <div className="site-header-inner">
          <button className="logo-wrap sh-logo" onClick={goMenu} aria-label="Home">
            {config.logoUrl ? <img src={imgUrl(config.logoUrl, 400)} alt={config.storeName || 'Home'} className="topbar-logo" fetchpriority="high" /> : <Logo />}
          </button>
          <button
            type="button"
            className="iconbtn fav-headerbtn"
            aria-label={`Favourites${favorites.length ? `, ${favorites.length}` : ''}`}
            title="Favourites"
            onClick={() => setView('favorites')}
          >
            <HeartIcon size={20} />
            {favorites.length > 0 && <span className="fav-count" aria-hidden="true">{favorites.length > 9 ? '9+' : favorites.length}</span>}
          </button>
          <nav className="site-nav" aria-label="Primary">
            <button type="button" className={`site-nav-link${navActive('menu') ? ' on' : ''}`} onClick={goMenu}>Menu</button>
            {coffeeCat && (
              <button type="button" className="site-nav-link" onClick={() => { setView('home'); pickCategory(coffeeCat.category); }}>Coffee</button>
            )}
            <button type="button" className={`site-nav-link${navActive('store') ? ' on' : ''}`} onClick={() => setView('store')}>Our story</button>
            <button type="button" className={`site-nav-link${view === 'store' ? ' on' : ''}`} onClick={() => setView('store')}>Visit</button>
          </nav>
          <div className="site-header-right">
            <div className="icon-row">
              <button className="iconbtn" title="About / contact" aria-label="Store info" onClick={() => setView('store')}><StoreIcon size={22} /></button>
              <button className="iconbtn theme-headerbtn" title="Theme" aria-label="Theme" onClick={() => setShowTheme(true)}><ThemeIcon size={22} /></button>
              {isMobile && (
                <button
                  className="iconbtn cart-iconbtn"
                  title="Cart"
                  aria-label={cartCount > 0 ? `Cart, ${cartCount} item${cartCount === 1 ? '' : 's'}` : 'Cart, empty'}
                  onClick={() => setView('cart')}
                >
                  <CartIcon size={22} />
                  {cartCount > 0 && <span className="cart-badge" aria-hidden="true">{cartCount > 9 ? '9+' : cartCount}</span>}
                </button>
              )}
              <button className="iconbtn" title="Account" aria-label={user ? 'Account' : 'Sign in'} onClick={() => setView('account')}>
                <AccountIcon size={26} />
              </button>
              {isMobile && <span className="sr-only" aria-live="polite">{cartCount > 0 ? `${cartCount} item${cartCount === 1 ? '' : 's'} in cart` : 'Cart empty'}</span>}
            </div>
          </div>
        </div>
      </header>
      {notices.length > 0 && (view === 'home' || !isMobile) && (
        <div ref={hoursRef} className="hours-bar">
          <div className="hours-inner"><SiteNotice notices={notices} /></div>
        </div>
      )}

      {view === 'account' && (
        <Account
          user={user}
          currency={currency}
          config={config}
          onSignIn={onSignIn}
          onSignOut={onSignOut}
          onReorder={reorder}
          onFavorite={(order) => {
            const name = window.prompt('Name this favourite (so you recognise it later)', 'My usual');
            if (name === null) return;
            const ok = addFavorite(order, name);
            if (!ok) window.alert('This order has no reorderable items.');
            return ok;
          }}
          onTheme={() => setShowTheme(true)}
          onBack={() => setView('home')}
        />
      )}

      {view === 'favorites' && (
        <Favorites
          favorites={favorites}
          currency={currency}
          onOrder={orderFavorite}
          onRemove={removeFavorite}
          onRename={renameFavorite}
          onBack={() => setView('home')}
          onExploreMenu={() => setView('account')}
        />
      )}

      {view === 'store' && (
        <StorePage config={config} onTrack={track} onBack={() => setView('home')} />
      )}

      {view === 'reserve' && (
        <ReservationForm config={config} user={user} onTrack={track} onBack={() => setView('home')} />
      )}

      {showLayout && (
        <div className="layout store-layout">
          <div className="main-col store-main">
            <HeroSlider
              hero={heroSlides}
              ratio={config.heroRatio}
              autoplay={config.heroAutoplay !== false}
              interval={config.heroInterval}
              onLink={(link) => {
                if (!link || link.type === 'none') return;
                if (link.type === 'category') { setActiveCat(link.value); setScrollTick((t) => t + 1); }
                else if (link.type === 'item' && link.value) {
                  // Open the product directly (e.g. a "steak sandwich" banner → its
                  // item card), scanning every category for the matching id.
                  let found = null; let foundCat = null;
                  for (const c of (menu.categories || [])) {
                    const it = (c.items || []).find((x) => x.id === link.value);
                    if (it) { found = it; foundCat = c.category; break; }
                  }
                  // A hero banner can point at an item whose category is sold out
                  // or currently kitchen-closed — don't let the banner bypass that;
                  // jump to the (now visibly unavailable) category instead of
                  // opening an Add-to-cart modal for something you can't actually buy.
                  const shut = found && (found.soldOut || kitchenClosedSet.has((foundCat || '').toLowerCase()));
                  if (found && !shut) setActiveItem({ ...found, category: foundCat });
                  else if (found) {
                    setActiveCat(foundCat); setScrollTick((t) => t + 1);
                    const el = document.querySelector('.menu'); if (el) el.scrollIntoView({ behavior: 'smooth' });
                  }
                  else { const el = document.querySelector('.menu'); if (el) el.scrollIntoView({ behavior: 'smooth' }); }
                }
                else if (link.type === 'account') setView('account');
                else if (link.type === 'url' && link.value) {
                  const u = /^https?:\/\//i.test(link.value) ? link.value : `https://${link.value}`;
                  window.open(u, '_blank', 'noopener,noreferrer');
                }
                else if (link.type === 'scroll') { const el = document.querySelector('.menu'); if (el) el.scrollIntoView({ behavior: 'smooth' }); }
              }}
            />
            {!(wide && view === 'checkout') && (
              <OrderTypeBar dineIn={dineIn} setDineIn={setDineIn} table={table} setTable={setTable} lock={tableLock} onUnlock={unlockTable} onScanned={applyScannedTable}
                when={preWhen} setWhen={setPreWhen} at={preAt} setAt={setPreAt} hours={config.hours}
                onReserve={config.reservations ? () => setView('reserve') : null} />
            )}
            <div className="search">
              <input placeholder="Search the menu…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            {!query && (
              <MenuDock categories={dockCategories} active={dockActive} onPick={pickCategory} />
            )}
            <MenuList
              categories={filteredMenu}
              currency={currency}
              onPick={(item) => { setActiveItem(item); track('product_view', { ref: item.name }); }}
              scrollTo={activeCat}
              scrollKey={scrollTick}
              onScrolled={() => setActiveCat(null)}
              kitchenClosedCats={kitchenClosedCats}
            />
            {!isMobile && <InstallButton />}
          </div>
          <aside className={`cart-aside store-cart${view === 'checkout' ? ' is-checkout' : ''}`}>
            {view === 'checkout' ? (
              <div className="aside-checkout">{checkoutEl}</div>
            ) : (
              <CartPanel
                cart={cart} currency={currency} onQty={updateQty}
                onRemove={removeItem} onClear={clearCart}
                onComboQty={updateComboQty} onRemoveCombo={removeCombo} onEditCombo={editCombo}
                dineIn={dineIn} table={table}
                summary={fulfilmentLabel}
                unavailableKeys={cartUnavailableKeys}
                onCheckout={() => setView('checkout')}
              />
            )}
          </aside>
        </div>
      )}

      {!wide && view === 'cart' && (
        <CartView
          cart={cart} currency={currency} onQty={updateQty}
          onRemove={removeItem} onClear={clearCart}
          onComboQty={updateComboQty} onRemoveCombo={removeCombo} onEditCombo={editCombo}
          dineIn={dineIn} table={table}
          unavailableKeys={cartUnavailableKeys}
          onCheckout={() => setView('checkout')} onBack={() => setView('home')}
        />
      )}

      {!wide && view === 'checkout' && checkoutEl}

      {activeItem && (
        activeItem.isCombo
          ? <ComboModal item={activeItem} currency={currency} onClose={() => setActiveItem(null)} onAdd={addComboToCart} />
          : <ItemModal item={activeItem} currency={currency} onClose={() => setActiveItem(null)} onAdd={addToCart} />
      )}
      {showTheme && (
        <ThemePicker
          presets={STOREFRONT_THEMES}
          seasonal={config.seasonalThemes || []}
          activeSeasonalId={config?.activeSeasonalTheme?.id || null}
          currentId={getStoredThemeBlob()?.id || 'espresso-plum'}
          effects={effectsList.filter((e) => e.frontendSelectable)}
          effectPref={effectPref}
          onApplyEffect={setEffectPref}
          onApply={updateTheme}
          onApplySeasonal={(s) => {
            // A hand-picked seasonal palette re-skins + keeps decor, and persists
            // as the blob — but NEVER injects its banner (hero only prepends the
            // server date-gated config.activeSeasonalTheme.banner).
            applyTheme(s);
            applyStoreTheme(seasonalAsPreset(s));
            setActiveTheme(s);
            saveStoredTheme({ id: s.id, v: 1, ts: Date.now(), explicit: true, tokens: buildTokens(seasonalAsPreset(s)) });
            setSavedTheme(null);
            setSeasonOptOut(true);
          }}
          onReset={resetTheme}
          onClose={() => setShowTheme(false)}
        />
      )}

      {view === 'home' && cartCount > 0 && (
        <button className="cartbar" onClick={() => setView('cart')}>
          <span className="badge">{cartCount}</span>
          <span>View order</span>
          <span className="cartbar-total">{formatMoney(cartTotal, currency)}</span>
        </button>
      )}

      {(view === 'home' || view === 'account' || view === 'cart') && footerSlots.length > 0 && (
        <nav className="bottomnav catbar">
          {footerSlots.map((slot, i) => {
            const activeSlot =
              layoutMode === 'single' &&
              activeGroup &&
              slot.cats.length === activeGroup.length &&
              slot.cats.every((c) => activeGroup.includes(c));
            return (
              <button
                key={i}
                className={`navitem ${activeSlot ? 'on' : ''}`}
                onClick={() => {
                  setQuery('');
                  if (layoutMode === 'single') {
                    // Same icon pressed again → advance to the next category in
                    // this slot; a different icon → start at its first category.
                    const same = footerCycle.current.slot === i;
                    const idx = same ? (footerCycle.current.idx + 1) % slot.cats.length : 0;
                    footerCycle.current = { slot: i, idx };
                    setActiveGroup(slot.cats);
                    setView('home');
                    setActiveCat(slot.cats[idx]); // scrolls to that category's title
                    setScrollTick((t) => t + 1);
                  } else { setView('home'); setActiveCat(slot.cats[0]); setScrollTick((t) => t + 1); }
                }}
                aria-label={slot.label}
              >
                <span className="ic"><SlotIcon icon={slot.icon} iconSvg={slot.iconSvg} size={30} /></span>
                {slot.label ? <span className="navlabel">{slot.label}</span> : null}
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
}
