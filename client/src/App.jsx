import React, { useEffect, useMemo, useState } from 'react';
import { api, formatMoney } from './api.js';
import { applyTheme } from './theme.js';
import { getUser, setUser as saveUser, getSavedTheme, setSavedTheme } from './store.js';
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
        // Priority: the customer's saved choice → active seasonal theme → default.
        const active = getSavedTheme() || cfg.activeSeasonalTheme || cfg.theme;
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
  const canOrder = config?.hours?.canOrderNow !== false;
  const preorder = config?.hours?.preorder;

  const cartCount = cart.reduce((n, c) => n + c.quantity, 0);
  const cartTotal = cart.reduce((n, c) => n + c.unitPrice * c.quantity, 0);

  function updateTheme(t) {
    applyTheme(t);
    setSavedTheme(t);
    setActiveTheme(t);
  }
  function resetTheme() {
    setSavedTheme(null);
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
      <header className="topbar">
        <div className="logo-wrap"><Logo height={26} /></div>
        <div className="icon-row">
          <button className="iconbtn" title="Theme" onClick={() => setShowTheme(true)}>🎨</button>
          <button className="iconbtn" title="Account" onClick={() => setView('account')}>
            {user ? (user.name || '·')[0].toUpperCase() : '☰'}
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

      {(view === 'home' || view === 'account') && (
        <nav className="bottomnav">
          <button className={`navitem ${view === 'home' ? 'on' : ''}`} onClick={() => setView('home')}>
            <span className="ic">🏠</span>Menu
          </button>
          <button className={`navitem ${view === 'account' ? 'on' : ''}`} onClick={() => setView('account')}>
            <span className="ic">👤</span>{user ? 'Account' : 'Sign in'}
          </button>
        </nav>
      )}
    </div>
  );
}
