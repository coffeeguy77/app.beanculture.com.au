import React from 'react';
import { formatMoney } from '../api.js';

export default function CartView({ cart, currency, onQty, dineIn, table, onCheckout, onBack }) {
  const total = cart.reduce((n, c) => n + c.unitPrice * c.quantity, 0);

  if (cart.length === 0) {
    return (
      <main className="cartview">
        <p className="muted">Your order is empty.</p>
        <button className="btn ghost" onClick={onBack}>
          Back to menu
        </button>
      </main>
    );
  }

  return (
    <main className="cartview">
      <h2>Your order</h2>
      <div className="order-context">
        {dineIn ? `Dine in · Table ${table || '—'}` : 'Takeaway'}
      </div>

      <ul className="cart-list">
        {cart.map((c) => (
          <li key={c.key} className="cart-line">
            <div className="cart-line-main">
              <div className="cart-line-name">
                {c.itemName}
                {c.variationName ? ` · ${c.variationName}` : ''}
              </div>
              {c.modifierNames?.length > 0 && (
                <div className="cart-line-mods">{c.modifierNames.join(', ')}</div>
              )}
              {c.note && <div className="cart-line-note">“{c.note}”</div>}
            </div>
            <div className="cart-line-right">
              <div className="stepper small">
                <button onClick={() => onQty(c.key, -1)} type="button">
                  −
                </button>
                <span>{c.quantity}</span>
                <button onClick={() => onQty(c.key, 1)} type="button">
                  +
                </button>
              </div>
              <div className="cart-line-price">
                {formatMoney(c.unitPrice * c.quantity, currency)}
              </div>
            </div>
          </li>
        ))}
      </ul>

      <div className="cart-total-row">
        <span>Total</span>
        <span>{formatMoney(total, currency)}</span>
      </div>

      <button className="btn full" onClick={onCheckout} type="button">
        Go to payment · {formatMoney(total, currency)}
      </button>
      <button className="link center-link" onClick={onBack} type="button">
        Add more items
      </button>
    </main>
  );
}
