import React, { useEffect, useState } from 'react';

// A bold "order by" hero banner that ticks live (mm:ss) rather than only
// updating whenever the app happens to re-fetch /api/config. `closesInMin` is
// a snapshot taken at the last config fetch — we anchor it to a real Date once
// and count down against the clock from there, so the countdown stays accurate
// between polls. Renders nothing once we're outside the "soon" window.
export default function KitchenClosingBanner({ closesInMin, closesLabel, categories, onOrderNow, className = '' }) {
  const [target, setTarget] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setTarget(closesInMin != null ? Date.now() + closesInMin * 60000 : null);
    setNow(Date.now());
  }, [closesInMin]);

  useEffect(() => {
    if (target == null) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);

  if (target == null) return null;
  const msLeft = target - now;
  if (msLeft <= 0 || msLeft > 30 * 60 * 1000) return null;

  const totalSec = Math.floor(msLeft / 1000);
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  const countdown = `${mm}:${String(ss).padStart(2, '0')}`;
  const cats = (categories || []).join(' & ');

  return (
    <div className={`kitchen-hero ${className}`}>
      <div className="kitchen-hero-top">
        <span className="kitchen-hero-eyebrow">Kitchen closing soon</span>
        <span className="kitchen-hero-clock" aria-label={`${mm} minutes ${ss} seconds left`}>{countdown}</span>
      </div>
      <div className="kitchen-hero-main">
        {closesLabel ? `Order by ${closesLabel}` : 'Order now'}
        {cats ? <span className="kitchen-hero-cats"> — {cats}</span> : null}
      </div>
      {onOrderNow && <button type="button" className="kitchen-hero-btn" onClick={onOrderNow}>Order now</button>}
    </div>
  );
}
