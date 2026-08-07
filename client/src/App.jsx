import React, { useEffect, useMemo, useState } from 'react';
import { api, formatMoney } from './api.js';
import { applyTheme } from './theme.js';
import { getUser, setUser as saveUser, getSavedTheme, setSavedTheme, getSeasonOptOut, setSeasonOptOut } from './store.js';
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
import { AccountIcon, ThemeIcon, ICONS } from './components/icons.jsx';

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
  const [dineIn, setDineIn] = useState(!!initialTable);
  const [table, setTable] = useState(initialTable);
  // A table scanned from a QR (?table=N) is locked in until the guest taps ✕.
  const [tableLocked, setTableLocked] = useState(!!initialTable);
  const unlockTable = () => setTableLocked(false);
  const [name, setName] = useState(user?.name || '');
  const [cart, setCart] = useState([]);
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

  const currency = config?.currency || menu?.currency || 'AUD';
  const layoutMode = config?.layoutMode || 'onepage';
  const xmas = activeTheme?.id === 'christmas';
  const wide = useMediaQuery('(min-width: 900px)'); // desktop + landscape tablet

  // On wide layouts the cart lives in the sidebar — no separate cart page.
  useEffect(() => {
    if (wide && view === 'cart') setView('home');
  }, [wide, view]);

  // Footer slots from config → only keep categories that exist in the live menu.
  const footerSlots = useMemo(() => {
    if (!config?.footer || !menu) return [];
    return config.footer
      .map((slot) => ({
        ...slot,
        cats: (slot.categories || []).filter((cat) =>
          menu.categories.some((c) => c.category.toLowerCase() === cat.toLowerCase())
        ),
      }))
      .filter((slot) => slot.cats.length);
  }, [config, menu]);
  const canOrder = config?.hours?.canOrderNow !== false;
  const preorder = config?.hours?.preorder;

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
    setActiveItem(null);
  }
  function updateQty(key, delta) {
    setCart((prev) =>
      prev.map((c) => (c.key === key ? { ...c, quantity: c.quantity + delta } : c)).filter((c) => c.quantity > 0)
    );
  }
  function onPaid(payment, order) {
    setCompleted({ payment, order });
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
          <div className="serif" style={{ fontSize: 30, color: 'var(--brand)' }}>Bean Culture</div>
          <div className="spinner" />
        </div>
      </div>
    );
  }

  if (view === 'admin') return <Admin config={config} onExit={() => { window.history.pushState({}, '', '/'); setView('home'); }} />;

  if (view === 'done' && completed) {
    const { payment, order } = completed;
    return (
      <div className="app">
        <div className="center-screen">
          <div className="card center" style={{ maxWidth: 380 }}>
            <div className="tick">✓</div>
            <h2 className="serif">Order placed</h2>
            {order.ticketName && <p className="muted">Ticket: {order.ticketName}</p>}
            <p>{dineIn ? `We’ll bring it to table ${table}.` : `Thanks ${name || ''} — we’ll call your name.`}</p>
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

  return (
    <div className="app">
      {activeTheme?.effects && <SeasonalEffects effects={activeTheme.effects} />}
      {activeTheme?.id && activeTheme?.decor?.perimeter && (
        <SeasonalPerimeter id={activeTheme.id} decor={activeTheme.decor} />
      )}
      <header className="topbar">
        <button className="logo-wrap" onClick={() => { setView('home'); setActiveCat(null); }} aria-label="Home">
          <Logo height={33} />
        </button>
        <div className="icon-row">
          <button className="iconbtn" title="Theme" aria-label="Theme" onClick={() => setShowTheme(true)}><ThemeIcon size={22} /></button>
          <button className="iconbtn" title="Account" aria-label={user ? 'Account' : 'Sign in'} onClick={() => setView('account')}>
            <AccountIcon size={26} />
          </button>
        </div>
      </header>

      {config.announcement ? <div className="announce">{config.announcement}</div> : null}
      {!canOrder && (
        <div className="closed-banner">
          <span>
            We’re closed right now{config.hours?.nextOpen ? ` · opens ${config.hours.nextOpen.day} ${config.hours.nextOpen.time?.slice(0,5)}` : ''}.
          </span>
        </div>
      )}
      {canOrder && preorder && (
        <div className="closed-banner"><span>Pre-order now — we’ll start it when we open.</span></div>
      )}

      {view === 'account' && (
        <Account
          user={user}
          currency={currency}
          onSignIn={onSignIn}
          onSignOut={onSignOut}
          onBack={() => setView('home')}
        />
      )}

      {view === 'home' && (
        <div className="layout">
          <div className="main-col">
            <HeroSlider
              hero={config.hero || []}
              ratio={config.heroRatio}
              autoplay={config.heroAutoplay !== false}
              interval={config.heroInterval}
              onLink={(link) => {
                if (!link) return;
                if (link.type === 'category') setActiveCat(link.value);
                else if (link.type === 'account') setView('account');
              }}
            />
            <OrderTypeBar dineIn={dineIn} setDineIn={setDineIn} table={table} setTable={setTable} locked={tableLocked} onUnlock={unlockTable} />
            <div className="search">
              <input placeholder="Search the menu…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            {!query && (
              <CategoryNav
                categories={menu.categories.map((c) => c.category)}
                active={layoutMode === 'single' ? (activeGroup && activeGroup.length === 1 ? activeGroup[0] : null) : activeCat}
                onPick={(cat) => {
                  if (layoutMode === 'single') { setActiveGroup([cat]); window.scrollTo({ top: 0 }); }
                  else setActiveCat(cat);
                }}
              />
            )}
            <MenuList
              categories={filteredMenu}
              currency={currency}
              onPick={setActiveItem}
              scrollTo={activeCat}
              onScrolled={() => setActiveCat(null)}
            />
          </div>
          <aside className="cart-aside">
            <CartPanel
              cart={cart} currency={currency} onQty={updateQty}
              dineIn={dineIn} table={table}
              onCheckout={() => setView('checkout')}
            />
          </aside>
        </div>
      )}

      {view === 'cart' && (
        <CartView
          cart={cart} currency={currency} onQty={updateQty}
          dineIn={dineIn} table={table}
          onCheckout={() => setView('checkout')} onBack={() => setView('home')}
        />
      )}

      {view === 'checkout' && (
        <Checkout
          config={config} cart={cart} currency={currency}
          dineIn={dineIn} setDineIn={setDineIn} table={table} setTable={setTable}
          tableLocked={tableLocked} onUnlockTable={unlockTable}
          name={name} setName={setName} user={user} canOrder={canOrder}
          onPaid={onPaid} onBack={() => setView(wide ? 'home' : 'cart')}
        />
      )}

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
            const Icon = ICONS[slot.icon] || ICONS.cup;
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
                  if (layoutMode === 'single') { setActiveGroup(slot.cats); setView('home'); window.scrollTo({ top: 0 }); }
                  else { setView('home'); setActiveCat(slot.cats[0]); }
                }}
                aria-label={slot.label}
              >
                <span className="ic"><Icon size={30} /></span>
                {slot.label ? <span className="navlabel">{slot.label}</span> : null}
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
}
