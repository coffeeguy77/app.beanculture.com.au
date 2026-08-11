import React, { useEffect, useState } from 'react';
import { ClockIcon } from './icons.jsx';

// Live "kitchen closing soon" countdown, ticking every second against a real
// Date target (not just re-derived from the last /api/config poll) so it
// stays accurate between polls. One data source, three responsive markups
// (desktop inline banner / tablet card / mobile compact bar) toggled purely
// via CSS so there's no layout-detection logic to keep in sync.
//
// `windowMin` is the size of the countdown window the notice appears within
// (SiteNotice currently only surfaces this once <=60 min remain) -- used
// only to size the progress bar, not to gate visibility.
export default function KitchenClosingCountdown({ closesInMin, closesLabel, categories, windowMin = 60, onOrderNow }) {
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
  const msLeft = Math.max(0, target - now);
  const totalSec = Math.floor(msLeft / 1000);
  const days = Math.floor(totalSec / 86400);
  const hrs = Math.floor((totalSec % 86400) / 3600);
  const min = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  const pad = (n) => String(n).padStart(2, '0');

  const windowSec = Math.max(1, windowMin * 60);
  const progress = Math.min(1, Math.max(0, 1 - totalSec / windowSec));

  const catList = (categories || []).filter(Boolean);
  const catText = catList.length ? catList.join(', ') : 'the kitchen menu';

  const digits = [
    { label: 'Days', v: days },
    { label: 'Hrs', v: hrs },
    { label: 'Min', v: min },
    { label: 'Sec', v: sec },
  ];

  return (
    <>
      {/* Desktop: wide inline banner. */}
      <div className="kc kc-desktop">
        <div className="kc-row">
          <span className="kc-icon"><ClockIcon size={52} /></span>
          <div className="kc-label">
            <div className="kc-eyebrow">Kitchen closing</div>
            {closesLabel && <div className="kc-sub">Order before {closesLabel}</div>}
          </div>
          <div className="kc-digits">
            {digits.map((d) => (
              <div className="kc-digit" key={d.label}>
                <span className="kc-digit-n">{pad(d.v)}</span>
                <span className="kc-digit-l">{d.label.toUpperCase()}</span>
              </div>
            ))}
          </div>
          {onOrderNow && <button type="button" className="kc-cta" onClick={onOrderNow}>Order now</button>}
        </div>
        <div className="kc-progress"><div className="kc-progress-fill" style={{ width: `${progress * 100}%` }} /></div>
      </div>

      {/* Tablet: standalone centred card. */}
      <div className="kc kc-tablet">
        {closesLabel && <h3 className="kc-heading">Kitchen closes at {closesLabel}</h3>}
        <p className="kc-sub2">Order now from {catText}</p>
        <div className="kc-digits">
          {digits.map((d) => (
            <div className="kc-digit" key={d.label}>
              <span className="kc-digit-n">{pad(d.v)}</span>
              <span className="kc-digit-l">{d.label.toUpperCase()}</span>
            </div>
          ))}
        </div>
        {onOrderNow && <button type="button" className="kc-cta kc-cta-full" onClick={onOrderNow}>Order now</button>}
      </div>

      {/* Mobile: compact two-row bar. */}
      <div className="kc kc-mobile">
        <div className="kc-mrow">
          <span className="kc-icon-sm"><ClockIcon size={34} /></span>
          <span className="kc-meyebrow">Kitchen closing</span>
          <span className="kc-mtime">{pad(min)}:{pad(sec)}</span>
        </div>
        <div className="kc-mrow">
          {closesLabel && <span className="kc-msub">Order before {closesLabel}</span>}
          {onOrderNow && <button type="button" className="kc-mcta" onClick={onOrderNow}>Order now</button>}
        </div>
        <div className="kc-progress"><div className="kc-progress-fill" style={{ width: `${progress * 100}%` }} /></div>
      </div>
    </>
  );
}
