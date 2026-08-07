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
import Checkout from './components/Checkout.jsx';
import Account from './components/Account.jsx';
import ThemePicker from './components/ThemePicker.jsx';
import Admin from './components/Admin.jsx';
import Logo from './components/Logo.jsx';
import SeasonalEffects from './components/SeasonalEffects.jsx';
import SeasonalPerimeter from './components/SeasonalPerimeter.jsx';
import { AccountIcon, CupIcon, BurgerIcon, BagIcon, SmoothieIcon, CanIcon, BeanIcon } from './components/icons.jsx';

// Footer "hot category" shortcuts → jump to that section of the menu.
const HOT_CATEGORIES = [
  { cat: 'COFFEE', label: 'Coffee', Icon: CupIcon },
  { cat: 'ALL DAY MENU', label: 'All Day', Icon: BurgerIcon },
  { cat: 'GRAB AND GO', label: 'Grab & Go', Icon: BagIcon },
  { cat: 'SMOOTHIES', label: 'Smoothies', Icon: SmoothieIcon },
  { cat: 'COLD DRINKS', label: 'Cold Drinks', Icon: CanIcon },
  { cat: 'COFFEE BAGS', label: 'Coffee Bags', Icon: BeanIcon },
];

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
  const [name, setName] = useState(user?.name || '');
  const [cart, setCart] = useState([]);
  const [query, setQuery] = useState('');
  const [activeCat, setActiveCat] = useState(null);

  // Load config + menu; apply theme (saved user theme wins over store default).
  useEffect(() => {
    api.getConfig()
      .then((cfg) => {
        setConfig(cfg);
        const active = resolveTheme(cfg);
        applyTheme(active);
        setActiveTheme(active);
      })
      .catch((e) => setLoadErr(e.message));
    api.getMenu().then(setMenu).catch((e) => setLoadErr(e.message));
  }, []);

  // Admin route
  useEffect(() => {
    if (window.location.pathname.replace(/\/$/, '') === '/admin') setView('admin');
  }, []);

  const currency = config?.currency || menu?.currency || 'AUD';
  const xmas = activeTheme?.id === 'christmas';
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
    if (!q) return menu.categories;
    return menu.categories
      .map((c) => ({
        ...c,
        items: c.items.filter(
          (i) => i.name.toLowerCase().includes(q) || (i.description || '').toLowerCase().includes(q)
        ),
      }))
      .filter((c) => c.items.length);
  }, [menu, query]);

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
          <button className="iconbtn" title="Theme" aria-label="Theme" onClick={() => setShowTheme(true)}>🎨</button>
          <button className="iconbtn" title="Account" aria-label={user ? 'Account' : 'Sign in'} onClick={() => setView('account')}>
            <AccountIcon size={26} />
          </button>
        </div>
      </header>

      {config.announcement ? <div className="announce">{config.announcement}</div> : null}
      {!canOrder && (
        <div className="closed-banner">
          <span>🌙</span>
          <span>
            We’re closed right now{config.hours?.nextOpen ? ` · opens ${config.hours.nextOpen.day} ${config.hours.nextOpen.time?.slice(0,5)}` : ''}.
          </span>
        </div>
      )}
      {canOrder && preorder && (
        <div className="closed-banner"><span>⏰</span><span>Pre-order now — we’ll start it when we open.</span></div>
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
        <>
          <HeroSlider
            hero={config.hero || []}
            onLink={(link) => {
              if (!link) return;
              if (link.type === 'category') setActiveCat(link.value);
              else if (link.type === 'account') setView('account');
            }}
          />
          <OrderTypeBar dineIn={dineIn} setDineIn={setDineIn} table={table} setTable={setTable} />
          <div className="search">
            <input placeholder="Search the menu…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          {!query && (
            <CategoryNav
              categories={menu.categories.map((c) => c.category)}
              active={activeCat}
              onPick={setActiveCat}
            />
          )}
          <MenuList
            categories={filteredMenu}
            currency={currency}
            onPick={setActiveItem}
            scrollTo={activeCat}
            onScrolled={() => setActiveCat(null)}
          />
        </>
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
          name={name} setName={setName} user={user} canOrder={canOrder}
          onPaid={onPaid} onBack={() => setView('cart')}
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

      {(view === 'home' || view === 'account' || view === 'cart') && (
        <nav className="bottomnav catbar">
          {HOT_CATEGORIES.filter((h) =>
            menu.categories.some((c) => c.category.toLowerCase() === h.cat.toLowerCase())
          ).map((h) => {
            const Icon = h.Icon;
            return (
              <button
                key={h.cat}
                className="navitem"
                onClick={() => { setView('home'); setActiveCat(h.cat); }}
                aria-label={h.label}
              >
                <span className="ic"><Icon size={30} /></span>
                <span className="navlabel">{h.label}</span>
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
}
