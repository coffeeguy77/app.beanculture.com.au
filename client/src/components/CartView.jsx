import React from 'react';
import { formatMoney } from '../api.js';

export default function CartView({ cart, currency, onQty, dineIn, table, onCheckout, onBack }) {
  const total = cart.reduce((n, c) => n + c.unitPrice * c.quantity, 0);
  if (cart.length === 0) {
    return (
      <main className="page">
        <div className="empty">Your order is empty.</div>
        <button className="btn full" onClick={onBack}>Back to menu</button>
      </main>
    );
  }
  return (
    <main className="page">
      <button className="link" onClick={onBack}>← Menu</button>
      <h2>Your order</h2>
      <span className="context-pill">{dineIn ? `Dine in · Table ${table || '—'}` : 'Takeaway'}</span>
      <ul className="cart-list">
        {cart.map((c) => (
          <li key={c.key} className="cart-line">
            <div className="cart-line-main">
              <div className="cart-line-name">{c.itemName}{c.variationName ? ` · ${c.variationName}` : ''}</div>
              {c.modifierNames?.length > 0 && <div className="cart-line-sub">{c.modifierNames.join(', ')}</div>}
              {c.note && <div className="cart-line-sub">“{c.note}”</div>}
            </div>
            <div className="cart-line-right">
              <div className="stepper sm">
                <button onClick={() => onQty(c.key, -1)}>−</button>
                <span>{c.quantity}</span>
                <button onClick={() => onQty(c.key, 1)}>+</button>
              </div>
              <div style={{ fontWeight: 700 }}>{formatMoney(c.unitPrice * c.quantity, currency)}</div>
            </div>
          </li>
        ))}
      </ul>
      <div className="totals">
        <div className="row grand"><span>Total</span><span>{formatMoney(total, currency)}</span></div>
      </div>
      <button className="btn full" onClick={onCheckout}>Go to payment · {formatMoney(total, currency)}</button>
    </main>
  );
}
