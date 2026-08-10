import React from 'react';
import { formatMoney } from '../api.js';
import { MugIcon } from './icons.jsx';

// Persistent cart shown as a sidebar on desktop / landscape-tablet layouts.
// Mirrors CartView's content but stays visible beside the menu.
export default function CartPanel({ cart, currency, onQty, onRemove, onClear, dineIn, table, onCheckout, summary }) {
  const total = cart.reduce((n, c) => n + c.unitPrice * c.quantity, 0);
  const count = cart.reduce((n, c) => n + c.quantity, 0);

  return (
    <div className="cart-panel">
      <div className="cart-panel-head">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <h2>Your order</h2>
          {cart.length > 0 && onClear && (
            <button
              type="button"
              className="cart-clear"
              aria-label="Clear all items from your order"
              onClick={() => { if (cart.length && !window.confirm('Remove all items from your order?')) return; onClear(); }}
            >
              Clear
            </button>
          )}
        </div>
        <span className="context-pill">{summary || (dineIn ? `Dine in · Table ${table || '—'}` : 'Takeaway')}</span>
      </div>

      {cart.length === 0 ? (
        <div className="cart-panel-empty">
          <span className="cart-empty-cup" aria-hidden="true"><MugIcon size={34} /></span>
          <div className="empty">Your order is empty.</div>
          <p className="muted" style={{ fontSize: 13 }}>Add items from the menu and they’ll appear here.</p>
        </div>
      ) : (
        <>
          <ul className="cart-list cart-panel-list">
            {cart.map((c) => (
              <li key={c.key} className="cart-line">
                <div className="cl-head">
                  <span className="cl-name">{c.itemName}{c.variationName ? ` · ${c.variationName}` : ''}</span>
                  <span className="cl-price">{formatMoney(c.unitPrice * c.quantity, currency)}</span>
                </div>
                {c.modifierNames?.length > 0 && <div className="cl-sub">{c.modifierNames.join(', ')}</div>}
                {c.note && <div className="cl-sub">“{c.note}”</div>}
                <div className="cl-controls">
                  <div className="stepper sm">
                    <button onClick={() => onQty(c.key, -1)} aria-label="Decrease">−</button>
                    <span>{c.quantity}</span>
                    <button onClick={() => onQty(c.key, 1)} aria-label="Increase">+</button>
                  </div>
                  {onRemove && <button className="cl-remove" onClick={() => onRemove(c.key)} aria-label={`Remove ${c.itemName}`}>Remove</button>}
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
