import React, { useEffect, useRef, useState } from 'react';
import { formatMoney } from '../api.js';

// Customer-facing display (CDS): a second screen (tablet / phone / monitor) that
// mirrors the POS's live order as staff build it, shows a thank-you when paid,
// and — when the counter is idle — cycles the store's chosen adverts (any banner
// flagged for the CDS) or a branded welcome. Polls a per-station channel the POS
// pushes to. Standalone route: /display?s=<code>. Purely a display: no taps.
export default function PosDisplay() {
  const params = new URLSearchParams(window.location.search);
  const station = params.get('s') || params.get('station') || 'main';
  const loc = params.get('loc') || '';   // which store this display is for (per-site ads + name)
  const [state, setState] = useState(null);
  const [offline, setOffline] = useState(false);
  const [adIdx, setAdIdx] = useState(0);
  const timer = useRef(null);

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const r = await fetch(`/api/pos/display/state?station=${encodeURIComponent(station)}${loc ? `&loc=${encodeURIComponent(loc)}` : ''}`, { cache: 'no-store' });
        const d = await r.json();
        if (alive) { setState(d); setOffline(false); }
      } catch { if (alive) setOffline(true); }
      if (alive) timer.current = setTimeout(tick, 1500);
    }
    tick();
    return () => { alive = false; if (timer.current) clearTimeout(timer.current); };
  }, [station, loc]);

  const currency = (state && state.currency) || 'AUD';
  const storeName = (state && state.storeName) || 'Bean Culture';
  const status = state ? state.status : 'idle';
  const cart = (state && state.cart) || [];
  const hasOrder = cart.length > 0;
  const cds = (state && state.cds) || {};
  const ads = cds.ads || [];
  const idle = !hasOrder && status !== 'paid';
  const [reset, setReset] = useState(0);       // bumped on a manual swipe to restart auto-rotate
  const touch = useRef(0);

  const nextAd = () => { if (ads.length) { setAdIdx((i) => (i + 1) % ads.length); setReset((k) => k + 1); } };
  const prevAd = () => { if (ads.length) { setAdIdx((i) => (i - 1 + ads.length) % ads.length); setReset((k) => k + 1); } };

  // Auto-rotate idle adverts (restarts whenever the customer swipes).
  useEffect(() => {
    if (!idle || ads.length < 2) { setAdIdx((i) => (idle ? i : 0)); return; }
    const iv = setInterval(() => setAdIdx((i) => (i + 1) % ads.length), (cds.adIntervalSec || 6) * 1000);
    return () => clearInterval(iv);
  }, [idle, ads.length, cds.adIntervalSec, reset]);

  const onTouchStart = (e) => { touch.current = e.touches[0].clientX; };
  const onTouchEnd = (e) => { const dx = e.changedTouches[0].clientX - touch.current; if (Math.abs(dx) > 45) { dx < 0 ? nextAd() : prevAd(); } };

  // Fullscreen fallback for when the CDS runs in a browser TAB (not installed as a
  // home-screen app): a single tap requests fullscreen, which hides the Android
  // status bar (clock / battery / wifi). Installed as a PWA it's already fullscreen
  // via the manifest. Silently ignored where unsupported (iOS Safari).
  const goFullscreen = () => {
    try {
      const el = document.documentElement;
      if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().catch(() => {});
    } catch { /* unsupported — no-op */ }
  };

  return (
    // No `pointer-events:none` — the customer can swipe the banners and scroll a
    // long order — but there are no links/buttons, so nothing is "clickable".
    <div className="cd-root" style={{ userSelect: 'none' }} onClick={goFullscreen}>
      {offline && <div className="cd-offline">Reconnecting…</div>}

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
      ) : ads.length > 0 ? (
        // Idle adverts (banners flagged "Show on CDS"). Swipe to change.
        (() => {
          const ad = ads[adIdx % ads.length] || ads[0];
          return (
            <div className="cd-ad" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} style={ad.image ? undefined : { background: ad.bg || 'var(--cd-bg, #16265e)' }}>
              {ad.image && <img className="cd-ad-img" src={ad.image} alt="" draggable="false" />}
              {(ad.title || ad.subtitle) && (
                <div className="cd-ad-cap" style={{ color: ad.textColor || '#fff' }}>
                  {ad.title && <div className="cd-ad-title">{ad.title}</div>}
                  {ad.subtitle && <div className="cd-ad-sub">{ad.subtitle}</div>}
                </div>
              )}
              {/* Customer display: no on-screen arrows or position dots (it's not a
                  touch control for customers). Swipe still changes the advert. */}
            </div>
          );
        })()
      ) : (
        // Branded welcome: logo above the greeting.
        <div className="cd-center">
          {cds.logo && <img className="cd-welcome-logo" src={cds.logo} alt="" />}
          <div className="cd-welcome">{cds.welcomeTitle || 'Welcome'}</div>
          <div className="cd-welcome-sub">{cds.welcomeSub || storeName}</div>
        </div>
      )}
    </div>
  );
}
