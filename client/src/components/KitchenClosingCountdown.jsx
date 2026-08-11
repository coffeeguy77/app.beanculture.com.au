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
export default function KitchenClosingCountdown({ closesInMin, minutes, elapsedMin, closesLabel, categories, windowMin = 60, onOrderNow, eyebrow = 'Kitchen closing', heading, subLabel, sub2, ctaLabel = 'Order now' }) {
  // Absolute window {start,end} in epoch ms — anchored to Date.now() + the
  // server-provided offsets ONCE, so the countdown AND the progress bar are
  // both derived from real timestamps and survive a page refresh (on reload the
  // offsets shrink but Date.now() grows by the same amount, so start/end resolve
  // to the same absolute instants). Progress is never based on time-since-mount.
  const [win, setWin] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  const mins = minutes != null ? minutes : closesInMin;

  useEffect(() => {
    if (mins == null) { setWin(null); return; }
    const t = Date.now();
    const end = t + mins * 60000;
    // windowStart: real elapsed offset if given (closed interval), else derive
    // from the fixed window size (kitchen = final `windowMin` minutes).
    const start = elapsedMin != null ? (t - elapsedMin * 60000) : (end - windowMin * 60000);
    setWin({ start, end });
    setNow(t);
  }, [mins, elapsedMin, windowMin]);

  useEffect(() => {
    if (!win) return undefined;
    const tick = () => setNow(Date.now());
    const id = setInterval(tick, 1000);
    // Recompute immediately on tab re-show / device wake so a backgrounded tab
    // doesn't display a stale countdown/progress.
    const onVis = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [win]);

  if (!win) return null;
  const msLeft = Math.max(0, win.end - now);
  const totalSec = Math.floor(msLeft / 1000);
  const days = Math.floor(totalSec / 86400);
  const hrs = Math.floor((totalSec % 86400) / 3600);
  const min = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  const pad = (n) => String(n).padStart(2, '0');

  // Real elapsed-through-the-interval progress from absolute timestamps.
  const span = Math.max(1, win.end - win.start);
  const progress = Math.min(1, Math.max(0, (now - win.start) / span));

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
          <span className="kc-icon"><ClockIcon size={32} /></span>
          <div className="kc-label">
            <div className="kc-eyebrow">{eyebrow}</div>
            {(subLabel != null ? subLabel : (closesLabel && `Order before ${closesLabel}`)) && (
              <div className="kc-sub">{subLabel != null ? subLabel : `Order before ${closesLabel}`}</div>
            )}
          </div>
          <div className="kc-digits">
            {digits.map((d) => (
              <div className="kc-digit" key={d.label}>
                <span className="kc-digit-n">{pad(d.v)}</span>
                <span className="kc-digit-l">{d.label.toUpperCase()}</span>
              </div>
            ))}
          </div>
          {onOrderNow && <button type="button" className="kc-cta" onClick={onOrderNow}>{ctaLabel}</button>}
        </div>
        <div className="kc-progress"><div className="kc-progress-fill" style={{ width: `${progress * 100}%` }} /></div>
      </div>

      {/* Tablet: standalone centred card. */}
      <div className="kc kc-tablet">
        {(heading != null ? heading : (closesLabel && `Kitchen closes at ${closesLabel}`)) && (
          <h3 className="kc-heading">{heading != null ? heading : `Kitchen closes at ${closesLabel}`}</h3>
        )}
        <p className="kc-sub2">{sub2 != null ? sub2 : `Order now from ${catText}`}</p>
        <div className="kc-digits">
          {digits.map((d) => (
            <div className="kc-digit" key={d.label}>
              <span className="kc-digit-n">{pad(d.v)}</span>
              <span className="kc-digit-l">{d.label.toUpperCase()}</span>
            </div>
          ))}
        </div>
        {onOrderNow && <button type="button" className="kc-cta kc-cta-full" onClick={onOrderNow}>{ctaLabel}</button>}
      </div>

      {/* Mobile: premium two-row card. Row 1 = status + full countdown (Days/
          Hrs/Min/Sec so an 8-hour closure never collapses to just MM:SS); Row 2
          = reopen line + CTA; progress bar spans below. */}
      <div className="kc kc-mobile">
        <div className="kc-mrow kc-mrow-top">
          <span className="kc-icon-sm"><ClockIcon size={26} /></span>
          <span className="kc-meyebrow">{eyebrow}</span>
          <div className="kc-mdigits">
            {digits.map((d) => (
              <div className="kc-mdigit" key={d.label}>
                <span className="kc-mdigit-n">{pad(d.v)}</span>
                <span className="kc-mdigit-l">{d.label.toUpperCase()}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="kc-mrow kc-mrow-bot">
          {(subLabel != null ? subLabel : (closesLabel && `Order before ${closesLabel}`)) && (
            <span className="kc-msub">{subLabel != null ? subLabel : `Order before ${closesLabel}`}</span>
          )}
          {onOrderNow && <button type="button" className="kc-mcta" onClick={onOrderNow}>{ctaLabel}</button>}
        </div>
        <div className="kc-progress"><div className="kc-progress-fill" style={{ width: `${progress * 100}%` }} /></div>
      </div>
    </>
  );
}
