import React from 'react';
import { formatMoney } from '../api.js';

export default function CartView({ cart, currency, onQty, onRemove, onClear, dineIn, table, onCheckout, onBack, kitchenBanner, unavailableKeys }) {
  const total = cart.reduce((n, c) => n + c.unitPrice * c.quantity, 0);
  const hasUnavailable = cart.some((c) => unavailableKeys?.has(c.key));
  if (cart.length === 0) {
    return (
      <main className="page">
        {kitchenBanner}
        <div className="empty">Your order is empty.</div>
        <button className="btn full" onClick={onBack}>Back to menu</button>
      </main>
    );
  }
  return (
    <main className="page">
      <button className="link" onClick={onBack}>← Menu</button>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <h2>Your order</h2>
        {onClear && <button className="link cart-clear" onClick={onClear}>Clear</button>}
      </div>
      <span className="context-pill">{dineIn ? `Dine in · Table ${table || '—'}` : 'Takeaway'}</span>
      <ul className="cart-list">
        {cart.map((c) => {
          const unavailable = unavailableKeys?.has(c.key);
          return (
          <li key={c.key} className={`cart-line ${unavailable ? 'unavailable' : ''}`}>
            <div className="cart-line-main">
              <div className="cart-line-name">{c.itemName}{c.variationName ? ` · ${c.variationName}` : ''}</div>
              {c.modifierNames?.length > 0 && <div className="cart-line-sub">{c.modifierNames.join(', ')}</div>}
              {c.note && <div className="cart-line-sub">“{c.note}”</div>}
              {unavailable && <div className="cart-line-warn">Kitchen closed — remove to check out</div>}
            </div>
            <div className="cart-line-right">
              {unavailable ? (
                <span>{c.quantity}</span>
              ) : (
                <div className="stepper sm">
                  <button onClick={() => onQty(c.key, -1)}>−</button>
                  <span>{c.quantity}</span>
                  <button onClick={() => onQty(c.key, 1)}>+</button>
                </div>
              )}
              <div style={{ fontWeight: 700 }}>{formatMoney(c.unitPrice * c.quantity, currency)}</div>
              {onRemove && <button className="cart-remove" onClick={() => onRemove(c.key)} aria-label={`Remove ${c.itemName}`}>✕</button>}
            </div>
          </li>
          );
        })}
      </ul>
      {hasUnavailable && <p className="cart-unavailable-note">Remove the unavailable item{cart.filter((c) => unavailableKeys?.has(c.key)).length > 1 ? 's' : ''} above to check out.</p>}
      <div className="totals">
        <div className="row grand"><span>Total</span><span>{formatMoney(total, currency)}</span></div>
      </div>
      {kitchenBanner}
      <button className="btn full" disabled={hasUnavailable} onClick={onCheckout}>Go to payment · {formatMoney(total, currency)}</button>
    </main>
  );
}
