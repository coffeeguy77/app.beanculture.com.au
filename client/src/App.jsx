import React, { useEffect, useMemo, useState } from 'react';
import { api, formatMoney, imgUrl } from './api.js';
import { applyTheme } from './theme.js';
import { getUser, setUser as saveUser, getSavedTheme, setSavedTheme, getSeasonOptOut, setSeasonOptOut, getStoredOrder, setStoredOrder } from './store.js';
import HeroSlider from './components/HeroSlider.jsx';
import OrderTypeBar from './components/OrderTypeBar.jsx';
import CategoryNav from './components/CategoryNav.jsx';
import MenuList from './components/MenuList.jsx';
import ItemModal from './components/ItemModal.jsx';
import CartView from './components/CartView.jsx';
import CartPanel from './components/CartPanel.jsx';
import Checkout from './components/Checkout.jsx';
import Account from './components/Account.jsx';
import ThemePicker from './components/ThemePicker.jsx';
import Admin from './components/Admin.jsx';
import Logo from './components/Logo.jsx';
import SeasonalEffects from './components/SeasonalEffects.jsx';
import SeasonalPerimeter from './components/SeasonalPerimeter.jsx';
import { AccountIcon, ThemeIcon, StoreIcon, SlotIcon } from './components/icons.jsx';
import StorePage from './components/StorePage.jsx';
import StoreContact from './components/StoreContact.jsx';
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
  const [activeCat, setActiveCat] = useState(null);
  const [activeGroup, setActiveGroup] = useState(null); // category names shown in 'single' layout

  // Load config + menu; apply theme (saved user theme wins over store default).
  useEffect(() => {
    api.getConfig()
      .then((cfg) => {
        setConfig(cfg);
        const active = resolveTheme(cfg);
        applyTheme(active);
        setActiveTheme(active);
        if (cfg.layoutMode === 'single' && cfg.footer && cfg.footer[0]) {
          setActiveGroup(cfg.footer[0].categories);
        }
      })
      .catch((e) => setLoadErr(e.message));
    api.getMenu().then(setMenu).catch((e) => setLoadErr(e.message));
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

  // On wide layouts the cart lives in the sidebar — no separate cart page.
  useEffect(() => {
    if (wide && view === 'cart') setView('home');
  }, [wide, view]);

  // Bottom-nav slots. Start from the footer builder groups (keeping only
  // categories that exist in the live menu), then AUTO-ADD a button for any
  // menu category that isn't already covered by a group. This guarantees every
  // category you switch on in "Categories in the app" is reachable from the
  // bottom nav — you don't have to also wire it into the footer builder.
  const footerSlots = useMemo(() => {
    if (!menu) return [];
    const configured = (config?.footer || [])
      .map((slot) => ({
        ...slot,
        cats: (slot.categories || []).filter((cat) =>
          menu.categories.some((c) => c.category.toLowerCase() === cat.toLowerCase())
        ),
      }))
      .filter((slot) => slot.cats.length);
    const covered = new Set();
    configured.forEach((s) => s.cats.forEach((c) => covered.add(c.toLowerCase())));
    const extras = menu.categories
      .map((c) => c.category)
      .filter((name) => !covered.has(name.toLowerCase()))
      .map((name) => ({ label: name, icon: 'tag', cats: [name], categories: [name] }));
    return [...configured, ...extras];
  }, [config, menu]);
  const canOrder = config?.hours?.canOrderNow !== false;
  const preorder = config?.hours?.preorder;
  const storeOpen = config?.hours?.open !== false;
  const kitchen = config?.hours?.kitchen || null;
  // Made-to-order categories are only unavailable when the store is OPEN but the
  // kitchen has shut (fridge items stay available). When the whole store is
  // closed, everything is pre-orderable for later, so nothing is disabled here.
  const kitchenClosedCats = (storeOpen && kitchen && kitchen.open === false) ? (kitchen.categories || []) : [];

  const cartCount = cart.reduce((n, c) => n + c.quantity, 0);
  const cartTotal = cart.reduce((n, c) => n + c.unitPrice * c.quantity, 0);

  // Theme priority: admin preview → auto seasonal (unless opted out) → saved → default.
  // Seasonal is ephemeral and never overwrites the saved user theme.
  function resolveTheme(cfg) {
    const previewId = readPreview();
    if (previewId === 'off') return cfg.theme;
    if (previewId) {
      const s = (cfg.seasonalThemes || []).find((x) => x.id === previewId);
      if (s) return s;
    }
    if (!getSeasonOptOut() && cfg.activeSeasonalTheme) return cfg.activeSeasonalTheme;
    const saved = getSavedTheme();
    if (saved) {
      // A saved seasonal choice always uses the CURRENT server definition, so
      // colour/decoration updates propagate (the saved copy can be stale).
      if (saved.id) {
        const cur = (cfg.seasonalThemes || []).find((x) => x.id === saved.id);
        return cur || saved;
      }
      return saved;
    }
    return cfg.theme;
  }

  function updateTheme(t) {
    const seasonal = !!(t.id && t.season);
    setSavedTheme(t); // a manual pick persists across refresh
    setSeasonOptOut(!seasonal); // choosing a non-seasonal theme opts out of the auto seasonal skin
    applyTheme(t);
    setActiveTheme(t);
  }
  function resetTheme() {
    setSavedTheme(null);
    setSeasonOptOut(false);
    const a = (config && (config.activeSeasonalTheme || config.theme)) || null;
    if (a) {
      applyTheme(a);
      setActiveTheme(a);
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
  const seasonBanner = config?.activeSeasonalTheme?.banner || null;
  const heroSlides = seasonBanner
    ? [{ id: 'season-banner', ...seasonBanner }, ...(config.hero || [])]
    : (config.hero || []);

  return (
    <div className={`app${(view === 'store' || (!wide && view === 'checkout')) ? ' app-flush' : ''}`}>
      {activeTheme?.effects && <SeasonalEffects effects={activeTheme.effects} />}
      {activeTheme?.id && activeTheme?.decor?.perimeter && (
        <SeasonalPerimeter id={activeTheme.id} decor={activeTheme.decor} />
      )}
      <header className="topbar">
        <button className="logo-wrap" onClick={() => { setView('home'); setActiveCat(null); }} aria-label="Home">
          {config.logoUrl ? <img src={imgUrl(config.logoUrl, 200)} alt={config.storeName || 'Home'} style={{ height: 36, width: 'auto', display: 'block' }} fetchpriority="high" /> : <Logo height={33} />}
        </button>
        <div className="icon-row">
          <button className="iconbtn" title="About / contact" aria-label="Store info" onClick={() => setView('store')}><StoreIcon size={22} /></button>
          <button className="iconbtn" title="Theme" aria-label="Theme" onClick={() => setShowTheme(true)}><ThemeIcon size={22} /></button>
          <button className="iconbtn" title="Account" aria-label={user ? 'Account' : 'Sign in'} onClick={() => setView('account')}>
            <AccountIcon size={26} />
          </button>
        </div>
      </header>

      {config.announcement ? <div className="announce">{config.announcement}</div> : null}
      {(() => {
        const h = config.hours || {};
        const label = h.nextOpen?.label;
        const scrollMenu = () => { const el = document.querySelector('.menu'); if (el) el.scrollIntoView({ behavior: 'smooth' }); };
        if (!storeOpen) {
          if (preorder) {
            return (
              <div className="closed-banner preorder-banner">
                <span>We’re closed{label ? ` — we reopen ${label}` : ''}. Pre-order now — we’ll start it when we open.</span>
                <button className="btn" onClick={() => { setDineIn(false); setPreWhen('later'); scrollMenu(); }}>Pre-order now</button>
              </div>
            );
          }
          return (
            <div className="closed-banner">
              <span>We’re closed right now{label ? ` — we reopen ${label}` : ''}.</span>
            </div>
          );
        }
        // Store open: nudge if the kitchen is about to close.
        const k = h.kitchen?.closesInMin;
        if (k != null && k > 0 && k <= 60) {
          return (
            <div className="closed-banner kitchen-soon">
              <span>🔥 Kitchen closes in {k} min{k === 1 ? '' : 's'} — order now!</span>
              <button className="btn" onClick={scrollMenu}>Order now</button>
            </div>
          );
        }
        return null;
      })()}

      {view === 'account' && (
        <Account
          user={user}
          currency={currency}
          config={config}
          onSignIn={onSignIn}
          onSignOut={onSignOut}
          onReorder={reorder}
          onBack={() => setView('home')}
        />
      )}

      {view === 'store' && (
        <StorePage config={config} onTrack={track} onBack={() => setView('home')} />
      )}

      {showLayout && (
        <div className="layout">
          <div className="main-col">
            <HeroSlider
              hero={heroSlides}
              ratio={config.heroRatio}
              autoplay={config.heroAutoplay !== false}
              interval={config.heroInterval}
              onLink={(link) => {
                if (!link || link.type === 'none') return;
                if (link.type === 'category') setActiveCat(link.value);
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
                when={preWhen} setWhen={setPreWhen} at={preAt} setAt={setPreAt} hours={config.hours} />
            )}
            <div className="search">
              <input placeholder="Search the menu…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            {!query && (
              <CategoryNav
                categories={menu.categories.map((c) => c.category)}
                active={layoutMode === 'single' ? (activeGroup && activeGroup.length === 1 ? activeGroup[0] : null) : activeCat}
                onPick={(cat) => {
                  // Category chips are sticky, so just swap the list below — don't
                  // yank the page to the top.
                  if (layoutMode === 'single') setActiveGroup([cat]);
                  else setActiveCat(cat);
                }}
              />
            )}
            <MenuList
              categories={filteredMenu}
              currency={currency}
              onPick={(item) => { setActiveItem(item); track('product_view', { ref: item.name }); }}
              scrollTo={activeCat}
              onScrolled={() => setActiveCat(null)}
              kitchenClosedCats={kitchenClosedCats}
            />
            <StoreContact contact={config.contact} onTrack={track} />
            <InstallButton />
          </div>
          <aside className={`cart-aside${view === 'checkout' ? ' is-checkout' : ''}`}>
            {view === 'checkout' ? (
              <div className="aside-checkout">{checkoutEl}</div>
            ) : (
              <CartPanel
                cart={cart} currency={currency} onQty={updateQty}
                onRemove={removeItem} onClear={clearCart}
                dineIn={dineIn} table={table}
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
          dineIn={dineIn} table={table}
          onCheckout={() => setView('checkout')} onBack={() => setView('home')}
        />
      )}

      {!wide && view === 'checkout' && checkoutEl}

      {activeItem && (
        <ItemModal item={activeItem} currency={currency} onClose={() => setActiveItem(null)} onAdd={addToCart} />
      )}
      {showTheme && (
        <ThemePicker
          presets={config.themePresets || []} seasonal={config.seasonalThemes || []} baseTheme={config.theme}
          current={getSavedTheme()} onApply={updateTheme} onReset={resetTheme} onClose={() => setShowTheme(false)}
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
                  if (layoutMode === 'single') { setActiveGroup(slot.cats); setView('home'); scrollToMenu(); }
                  else { setView('home'); setActiveCat(slot.cats[0]); }
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
