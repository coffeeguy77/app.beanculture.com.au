import React, { useEffect, useRef, useState } from 'react';
import { formatMoney } from '../api.js';

// Customer-facing display: a second screen (tablet / phone / monitor) that mirrors
// the POS's live order as staff build it, then shows a thank-you when paid. It
// polls a per-station channel the POS pushes to — no login, just a station code
// shared with the POS (?s=<code> in the URL). Standalone route: /display.
export default function PosDisplay() {
  const params = new URLSearchParams(window.location.search);
  const station = params.get('s') || params.get('station') || 'main';
  const [state, setState] = useState(null);
  const [offline, setOffline] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const r = await fetch(`/api/pos/display/state?station=${encodeURIComponent(station)}`, { cache: 'no-store' });
        const d = await r.json();
        if (alive) { setState(d); setOffline(false); }
      } catch { if (alive) setOffline(true); }
      if (alive) timer.current = setTimeout(tick, 1500);
    }
    tick();
    return () => { alive = false; if (timer.current) clearTimeout(timer.current); };
  }, [station]);

  const currency = (state && state.currency) || 'AUD';
  const storeName = (state && state.storeName) || 'Bean Culture';
  const status = state ? state.status : 'idle';
  const cart = (state && state.cart) || [];
  const hasOrder = cart.length > 0;

  return (
    <div className="cd-root">
      <div className="cd-head">
        {state && state.logo
          ? <img className="cd-logo" src={state.logo} alt="" />
          : <div className="cd-store">{storeName}</div>}
        {offline && <div className="cd-offline">Reconnecting…</div>}
      </div>

      {status === 'paid' ? (
        <div className="cd-center">
          <div className="cd-thanks-tick">✓</div>
          <div className="cd-thanks">Thank you!</div>
          {state.total > 0 && <div className="cd-thanks-sub">Paid {formatMoney(state.total, currency)}</div>}
          {state.change > 0 && <div className="cd-change">Change {formatMoney(state.change, currency)}</div>}
        </div>
      ) : hasOrder ? (
        <div className="cd-order">
          <div className="cd-order-head">
            <span>Your order</span>
            {state.name ? <span className="cd-order-name">{state.name}</span> : null}
          </div>
          <div className="cd-items">
            {cart.map((c, i) => (
              <div key={i} className="cd-item">
                <span className="cd-qty">{c.quantity > 1 ? `${c.quantity}×` : ''}</span>
                <span className="cd-item-main">
                  <span className="cd-item-name">{c.name}{c.variation ? ` · ${c.variation}` : ''}</span>
                  {c.options && c.options.length > 0 && <span className="cd-item-opts">{c.options.join(' · ')}</span>}
                </span>
                <span className="cd-item-price">{formatMoney((c.amount || 0) * (c.quantity || 1), currency)}</span>
              </div>
            ))}
          </div>
          <div className="cd-total">
            <span>Total</span>
            <span>{formatMoney(state.total, currency)}</span>
          </div>
        </div>
      ) : (
        <div className="cd-center">
          <div className="cd-welcome">Welcome</div>
          <div className="cd-welcome-sub">{storeName}</div>
        </div>
      )}
    </div>
  );
}
