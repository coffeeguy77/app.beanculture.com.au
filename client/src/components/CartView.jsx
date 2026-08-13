import React from 'react';
import { formatMoney, comboDiscountFor } from '../api.js';

// See CartPanel.jsx for why: groups combo-linked lines into one card.
function groupCart(cart) {
  const out = [];
  const seen = new Set();
  for (const c of cart) {
    if (c.comboInstanceId) {
      if (seen.has(c.comboInstanceId)) continue;
      seen.add(c.comboInstanceId);
      out.push({ type: 'combo', instanceId: c.comboInstanceId, name: c.comboName, lines: cart.filter((x) => x.comboInstanceId === c.comboInstanceId) });
    } else {
      out.push({ type: 'single', line: c });
    }
  }
  return out;
}

export default function CartView({ cart, currency, onQty, onRemove, onClear, onComboQty, onRemoveCombo, dineIn, table, onCheckout, onBack, kitchenBanner, unavailableKeys }) {
  const comboSavings = comboDiscountFor(cart);
  const total = Math.max(0, cart.reduce((n, c) => n + c.unitPrice * c.quantity, 0) - comboSavings);
  const hasUnavailable = cart.some((c) => unavailableKeys?.has(c.key));
  const grouped = groupCart(cart);
  if (cart.length === 0) {
    return (
      <main className="page cart-page">
        {kitchenBanner}
        <div className="empty">Your order is empty.</div>
        <button className="btn full" onClick={onBack}>Back to menu</button>
      </main>
    );
  }
  return (
    <main className="page cart-page">
      <button className="link" onClick={onBack}>← Menu</button>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <h2>Your order</h2>
        {onClear && <button className="link cart-clear" onClick={onClear}>Clear</button>}
      </div>
      <span className="context-pill">{dineIn ? `Dine in · Table ${table || '—'}` : 'Takeaway'}</span>
      <ul className="cart-list">
        {grouped.map((g) => {
          if (g.type === 'combo') {
            const qty = g.lines[0]?.quantity || 1;
            const comboDisc = (g.lines[0]?.comboDiscount || 0) * qty;
            const comboTotal = Math.max(0, g.lines.reduce((n, l) => n + l.unitPrice * l.quantity, 0) - comboDisc);
            return (
              <li key={g.instanceId} className="cart-line cart-line-combo">
                <div className="cart-line-main">
                  <div className="cart-line-name">🍔 {g.name}</div>
                  <div className="cart-line-sub">{g.lines.map((l) => l.itemName).join(' + ')}</div>
                  {comboDisc > 0 && <div className="cart-line-sub cl-combo-save">Combo saving −{formatMoney(comboDisc, currency)}</div>}
                </div>
                <div className="cart-line-right">
                  <div className="stepper sm">
                    <button onClick={() => onComboQty(g.instanceId, -1)}>−</button>
                    <span>{qty}</span>
                    <button onClick={() => onComboQty(g.instanceId, 1)}>+</button>
                  </div>
                  <div style={{ fontWeight: 700 }}>{formatMoney(comboTotal, currency)}</div>
                  {onRemoveCombo && <button className="cart-remove" onClick={() => onRemoveCombo(g.instanceId)} aria-label={`Remove ${g.name}`}>✕</button>}
                </div>
              </li>
            );
          }
          const c = g.line;
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
        {comboSavings > 0 && <div className="row cl-combo-save"><span>Combo savings</span><span>−{formatMoney(comboSavings, currency)}</span></div>}
        <div className="row grand"><span>Total</span><span>{formatMoney(total, currency)}</span></div>
      </div>
      {kitchenBanner}
      <button className="btn full" disabled={hasUnavailable} onClick={onCheckout}>Go to payment · {formatMoney(total, currency)}</button>
    </main>
  );
}
