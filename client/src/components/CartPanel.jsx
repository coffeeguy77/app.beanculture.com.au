import React from 'react';
import { formatMoney, imgUrl, comboDiscountFor } from '../api.js';
import CartEmptyIllustration from './CartEmptyIllustration.jsx';

// Persistent cart shown as a sidebar on desktop / landscape-tablet layouts.
// Mirrors CartView's content but stays visible beside the menu.
// Group flat cart lines into single items vs. combo instances (several lines
// sharing one comboInstanceId, added together by ComboModal), so a combo shows
// as one card with one quantity control instead of N separate confusing rows.
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

export default function CartPanel({ cart, currency, onQty, onRemove, onClear, onComboQty, onRemoveCombo, onEditCombo, dineIn, table, onCheckout, summary, unavailableKeys, isFreeCat }) {
  // Complimentary event lines cost nothing and show no price. The cart total is
  // the PAID lines only (retail beans etc.).
  const lineFree = (c) => (isFreeCat ? isFreeCat(c.category) : false) && !c.comboInstanceId;
  const gross = cart.reduce((n, c) => n + (lineFree(c) ? 0 : c.unitPrice * c.quantity), 0);
  const comboSavings = comboDiscountFor(cart);
  const total = Math.max(0, gross - comboSavings);
  const anyFree = cart.some(lineFree);
  const count = cart.reduce((n, c) => n + c.quantity, 0);
  const hasUnavailable = cart.some((c) => unavailableKeys?.has(c.key));
  const empty = cart.length === 0;
  const grouped = groupCart(cart);

  return (
    <div className="cart-panel">
      <div className="cart-panel-head">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <h2>Your order</h2>
          {!empty && onClear && (
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

      {empty ? (
        <div className="cart-panel-empty">
          <CartEmptyIllustration />
          <p className="cart-empty-title">Your order is empty</p>
          <p className="cart-empty-sub">Choose something delicious from the menu.</p>
        </div>
      ) : (
        <ul className="cart-list cart-panel-list">
          {grouped.map((g) => {
            if (g.type === 'combo') {
              const qty = g.lines[0]?.quantity || 1;
              const comboDisc = (g.lines[0]?.comboDiscount || 0) * qty;
              const comboTotal = Math.max(0, g.lines.reduce((n, l) => n + l.unitPrice * l.quantity, 0) - comboDisc);
              return (
                <li key={g.instanceId} className="cart-line cart-line-combo">
                  <div className="cl-main">
                    <div className="cl-head">
                      <span className="cl-name">🍔 {g.name}</span>
                      <span className="cl-price">{formatMoney(comboTotal, currency)}</span>
                    </div>
                    <div className="cl-sub">{g.lines.map((l) => l.itemName).join(' + ')}</div>
                    {comboDisc > 0 && <div className="cl-sub cl-combo-save">Combo saving −{formatMoney(comboDisc, currency)}</div>}
                    <div className="cl-controls">
                      <div className="stepper sm">
                        <button onClick={() => onComboQty(g.instanceId, -1)} aria-label="Decrease">−</button>
                        <span>{qty}</span>
                        <button onClick={() => onComboQty(g.instanceId, 1)} aria-label="Increase">+</button>
                      </div>
                      {onEditCombo && <button className="cl-remove" onClick={() => onEditCombo(g.instanceId)} aria-label={`Edit ${g.name}`}>Edit</button>}
                      {onRemoveCombo && <button className="cl-remove" onClick={() => onRemoveCombo(g.instanceId)} aria-label={`Remove ${g.name}`}>Remove</button>}
                    </div>
                  </div>
                </li>
              );
            }
            const c = g.line;
            const unavailable = unavailableKeys?.has(c.key);
            return (
              <li key={c.key} className={`cart-line ${unavailable ? 'unavailable' : ''}`}>
                {c.image && <img className="cl-img" src={imgUrl(c.image, 100)} alt="" />}
                <div className="cl-main">
                  <div className="cl-head">
                    <span className="cl-name">{c.itemName}{c.variationName ? ` · ${c.variationName}` : ''}</span>
                    <span className="cl-price">{lineFree(c) ? 'Free' : formatMoney(c.unitPrice * c.quantity, currency)}</span>
                  </div>
                  {c.modifierNames?.length > 0 && <div className="cl-sub">{c.modifierNames.join(', ')}</div>}
                  {c.note && <div className="cl-sub">“{c.note}”</div>}
                  {unavailable && <div className="cart-line-warn">Kitchen closed — remove to check out</div>}
                  <div className="cl-controls">
                    {unavailable ? (
                      <span className="cl-qty-static">Qty {c.quantity}</span>
                    ) : (
                      <div className="stepper sm">
                        <button onClick={() => onQty(c.key, -1)} aria-label="Decrease">−</button>
                        <span>{c.quantity}</span>
                        <button onClick={() => onQty(c.key, 1)} aria-label="Increase">+</button>
                      </div>
                    )}
                    {onRemove && <button className="cl-remove" onClick={() => onRemove(c.key)} aria-label={`Remove ${c.itemName}`}>Remove</button>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="cart-panel-foot">
        {empty ? (
          <>
            <div className="totals"><div className="row grand"><span>Subtotal</span><span>$0.00</span></div></div>
            <button className="btn full" disabled aria-disabled="true">View order</button>
            <p className="cart-foot-helper">Add items to get started</p>
          </>
        ) : (
          <>
            {hasUnavailable && <p className="cart-unavailable-note">Remove the unavailable item{cart.filter((c) => unavailableKeys?.has(c.key)).length > 1 ? 's' : ''} above to check out.</p>}
            <div className="totals">
              {comboSavings > 0 && <div className="row cl-combo-save"><span>Combo savings</span><span>−{formatMoney(comboSavings, currency)}</span></div>}
              <div className="row grand"><span>Total</span><span>{anyFree && total === 0 ? 'Complimentary' : formatMoney(total, currency)}</span></div>
            </div>
            <button className="btn full" disabled={hasUnavailable} onClick={onCheckout}>
              Go to payment · {count} {count === 1 ? 'item' : 'items'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
