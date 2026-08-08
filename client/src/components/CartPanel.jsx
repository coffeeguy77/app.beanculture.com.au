import React from 'react';
import { formatMoney } from '../api.js';

// Persistent cart shown as a sidebar on desktop / landscape-tablet layouts.
// Mirrors CartView's content but stays visible beside the menu.
export default function CartPanel({ cart, currency, onQty, onRemove, onClear, dineIn, table, onCheckout }) {
  const total = cart.reduce((n, c) => n + c.unitPrice * c.quantity, 0);
  const count = cart.reduce((n, c) => n + c.quantity, 0);

  return (
    <div className="cart-panel">
      <div className="cart-panel-head">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <h2>Your order</h2>
          {cart.length > 0 && onClear && <button className="link cart-clear" onClick={onClear}>Clear</button>}
        </div>
        <span className="context-pill">{dineIn ? `Dine in · Table ${table || '—'}` : 'Takeaway'}</span>
      </div>

      {cart.length === 0 ? (
        <div className="cart-panel-empty">
          <div className="empty">Your order is empty.</div>
          <p className="muted" style={{ fontSize: 13 }}>Add items from the menu and they’ll appear here.</p>
        </div>
      ) : (
        <>
          <ul className="cart-list cart-panel-list">
            {cart.map((c) => (
              <li key={c.key} className="cart-line">
                <div className="cart-line-main">
                  <div className="cart-line-name">{c.itemName}{c.variationName ? ` · ${c.variationName}` : ''}</div>
                  {c.modifierNames?.length > 0 && <div className="cart-line-sub">{c.modifierNames.join(', ')}</div>}
                  {c.note && <div className="cart-line-sub">“{c.note}”</div>}
                </div>
                <div className="cart-line-right">
                  <div className="stepper sm">
                    <button onClick={() => onQty(c.key, -1)} aria-label="Decrease">−</button>
                    <span>{c.quantity}</span>
                    <button onClick={() => onQty(c.key, 1)} aria-label="Increase">+</button>
                  </div>
                  <div style={{ fontWeight: 700 }}>{formatMoney(c.unitPrice * c.quantity, currency)}</div>
                  {onRemove && <button className="cart-remove" onClick={() => onRemove(c.key)} aria-label={`Remove ${c.itemName}`}>✕</button>}
                </div>
              </li>
            ))}
          </ul>
          <div className="cart-panel-foot">
            <div className="totals">
              <div className="row grand"><span>Total</span><span>{formatMoney(total, currency)}</span></div>
            </div>
            <button className="btn full" onClick={onCheckout}>
              Go to payment · {count} {count === 1 ? 'item' : 'items'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
