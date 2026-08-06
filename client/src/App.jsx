import React, { useEffect, useMemo, useState } from 'react';
import { api, formatMoney } from './api.js';
import OrderTypeBar from './components/OrderTypeBar.jsx';
import MenuList from './components/MenuList.jsx';
import ItemModal from './components/ItemModal.jsx';
import CartView from './components/CartView.jsx';
import Checkout from './components/Checkout.jsx';

function readTableFromUrl() {
  const p = new URLSearchParams(window.location.search);
  const t = p.get('table') || p.get('t');
  return t ? t.trim() : '';
}

export default function App() {
  const [config, setConfig] = useState(null);
  const [menu, setMenu] = useState(null);
  const [loadError, setLoadError] = useState('');

  // Order type. If a ?table= is present (QR at the table), default to dine-in.
  const initialTable = readTableFromUrl();
  const [dineIn, setDineIn] = useState(!!initialTable);
  const [table, setTable] = useState(initialTable);
  const [name, setName] = useState('');

  const [cart, setCart] = useState([]);
  const [activeItem, setActiveItem] = useState(null); // item being configured in modal
  const [screen, setScreen] = useState('menu'); // 'menu' | 'cart' | 'checkout' | 'done'
  const [completed, setCompleted] = useState(null);

  useEffect(() => {
    Promise.all([api.getConfig(), api.getMenu()])
      .then(([cfg, m]) => {
        setConfig(cfg);
        setMenu(m);
      })
      .catch((e) => setLoadError(e.message));
  }, []);

  const currency = config?.currency || menu?.currency || 'AUD';

  const cartCount = cart.reduce((n, c) => n + c.quantity, 0);
  const cartTotal = cart.reduce((n, c) => n + c.unitPrice * c.quantity, 0);

  function addToCart(entry) {
    setCart((prev) => [...prev, entry]);
    setActiveItem(null);
  }

  function updateQty(key, delta) {
    setCart((prev) =>
      prev
        .map((c) => (c.key === key ? { ...c, quantity: c.quantity + delta } : c))
        .filter((c) => c.quantity > 0)
    );
  }

  function onPaid(payment, order) {
    setCompleted({ payment, order });
    setCart([]);
    setScreen('done');
  }

  if (loadError) {
    return (
      <div className="screen center">
        <div className="card">
          <h2>Can’t load the menu</h2>
          <p className="muted">{loadError}</p>
          <button className="btn" onClick={() => window.location.reload()}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!config || !menu) {
    return (
      <div className="screen center">
        <div className="brandmark">Bean Culture</div>
        <p className="muted">Loading menu…</p>
      </div>
    );
  }

  if (screen === 'done' && completed) {
    const { payment, order } = completed;
    return (
      <div className="screen center">
        <div className="card success">
          <div className="tick">✓</div>
          <h2>Order placed</h2>
          <p className="muted">
            {order.ticketName ? `Ticket: ${order.ticketName}` : 'Thanks!'}
          </p>
          <p>
            {dineIn
              ? `We’ll bring it to table ${table}.`
              : 'We’ll call your name when it’s ready.'}
          </p>
          {payment.comped && <p className="muted">Test order — no payment was taken.</p>}
          {payment.receiptUrl && (
            <a className="btn ghost" href={payment.receiptUrl} target="_blank" rel="noreferrer">
              View receipt
            </a>
          )}
          <button
            className="btn"
            onClick={() => {
              setCompleted(null);
              setScreen('menu');
            }}
          >
            Start a new order
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brandmark small">Bean Culture</div>
        {screen !== 'menu' && (
          <button className="link" onClick={() => setScreen('menu')}>
            ← Menu
          </button>
        )}
      </header>

      {screen === 'menu' && (
        <>
          <OrderTypeBar
            dineIn={dineIn}
            setDineIn={setDineIn}
            table={table}
            setTable={setTable}
            name={name}
            setName={setName}
          />
          <MenuList menu={menu} currency={currency} onPick={setActiveItem} />
        </>
      )}

      {screen === 'cart' && (
        <CartView
          cart={cart}
          currency={currency}
          onQty={updateQty}
          dineIn={dineIn}
          table={table}
          onCheckout={() => setScreen('checkout')}
          onBack={() => setScreen('menu')}
        />
      )}

      {screen === 'checkout' && (
        <Checkout
          config={config}
          cart={cart}
          currency={currency}
          dineIn={dineIn}
          table={table}
          name={name}
          onPaid={onPaid}
          onBack={() => setScreen('cart')}
        />
      )}

      {activeItem && (
        <ItemModal
          item={activeItem}
          currency={currency}
          onClose={() => setActiveItem(null)}
          onAdd={addToCart}
        />
      )}

      {screen === 'menu' && cartCount > 0 && (
        <button className="cartbar" onClick={() => setScreen('cart')}>
          <span className="badge">{cartCount}</span>
          <span>View order</span>
          <span className="cartbar-total">{formatMoney(cartTotal, currency)}</span>
        </button>
      )}
    </div>
  );
}
