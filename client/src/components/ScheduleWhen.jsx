import React, { useEffect, useMemo, useState } from 'react';

const WD_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WD_MINI = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']; // Monday-first header
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');
const dstr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function closureHit(c, ds) {
  if (!c) return false;
  const md = ds.slice(5);
  if (c.from && c.to) {
    if (c.annual) { const f = c.from.slice(5), t = c.to.slice(5); return f <= t ? (md >= f && md <= t) : (md >= f || md <= t); }
    return ds >= c.from && ds <= c.to;
  }
  if (c.date) return c.date === ds || (c.annual && String(c.date).slice(5) === md);
  return false;
}
function fmt12(h, m) {
  const ap = h >= 12 ? 'pm' : 'am';
  let hh = h % 12; if (hh === 0) hh = 12;
  return `${hh}:${pad(m)}${ap}`;
}
function labelForDate(ds) {
  if (!ds) return 'Pick a day';
  const [y, mo, d] = ds.split('-').map(Number);
  const dt = new Date(y, mo - 1, d);
  return `${WD_SHORT[dt.getDay()]}, ${d} ${MONTHS[mo - 1]} ${y}`;
}

// Date + time chooser: two site-styled buttons. Tapping "day" opens a calendar
// (closed weekdays and closed dates are greyed and unselectable); tapping "time"
// opens a list of slots inside that day's opening hours.
export default function ScheduleWhen({ hours, date, time, onDate, onTime, maxDays = 14 }) {
  const openDays = hours?.openDays || null;
  const closures = hours?.closures || [];
  const weekly = hours?.weekly || {};
  const DAYS_SQ = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

  const [open, setOpen] = useState(null); // 'date' | 'time' | null
  const today = useMemo(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }, []);
  const maxDate = useMemo(() => { const d = new Date(today); d.setDate(d.getDate() + maxDays); return d; }, [today, maxDays]);

  function bookable(ds, wd) {
    if (ds < dstr(today) || ds > dstr(maxDate)) return false;
    if (openDays && !openDays.includes(wd)) return false;
    if (closures.some((c) => closureHit(c, ds))) return false;
    return true;
  }
  function bookableDs(ds) {
    const [y, mo, d] = ds.split('-').map(Number);
    return bookable(ds, new Date(y, mo - 1, d).getDay());
  }
  function slotsFor(ds) {
    const [y, mo, d] = ds.split('-').map(Number);
    const wd = new Date(y, mo - 1, d).getDay();
    const periods = (weekly[DAYS_SQ[wd]] || []).filter((p) => p.startMin != null && p.endMin != null);
    const now = new Date();
    const isToday = ds === dstr(today);
    const nowMin = now.getHours() * 60 + now.getMinutes() + 15;
    const out = [];
    for (const p of periods) {
      let end = p.endMin; if (end <= p.startMin) end += 24 * 60;
      for (let mm = Math.ceil(p.startMin / 15) * 15; mm <= end - 15; mm += 15) {
        if (isToday && mm < nowMin) continue;
        out.push({ v: `${pad(Math.floor(mm / 60) % 24)}:${pad(mm % 60)}`, label: fmt12(Math.floor(mm / 60) % 24, mm % 60) });
      }
    }
    return out;
  }
  // First bookable day that still has selectable slots — skips closed days/dates
  // and skips today once its remaining slots have passed.
  const firstDs = useMemo(() => {
    let firstAny = null;
    for (let i = 0; i <= maxDays; i++) {
      const d = new Date(today); d.setDate(d.getDate() + i);
      const ds = dstr(d);
      if (!bookable(ds, d.getDay())) continue;
      if (firstAny == null) firstAny = ds;
      if (slotsFor(ds).length) return ds;
    }
    return firstAny || dstr(today);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today, maxDays, openDays, closures, weekly]);

  // Only honour the incoming date if it is genuinely bookable; otherwise snap to
  // the first available day (guards against a seeded closed day, e.g. a Sunday).
  const selDs = (date && bookableDs(date)) ? date : firstDs;
  useEffect(() => { if (selDs && selDs !== date) onDate(selDs); /* eslint-disable-next-line */ }, [selDs]);

  const times = useMemo(() => slotsFor(selDs), [selDs, weekly]); // eslint-disable-line
  useEffect(() => { if (times.length && !times.some((t) => t.v === time)) onTime(times[0].v); /* eslint-disable-next-line */ }, [selDs, times.length]);

  // Calendar month state
  const [view, setView] = useState(() => { const [y, m] = selDs.split('-').map(Number); return { y, m: m - 1 }; });
  useEffect(() => { const [y, m] = selDs.split('-').map(Number); setView({ y, m: m - 1 }); }, [selDs]);
  const weeks = useMemo(() => {
    const first = new Date(view.y, view.m, 1);
    const startOffset = (first.getDay() + 6) % 7; // Monday-first
    const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < startOffset; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(view.y, view.m, d));
    while (cells.length % 7) cells.push(null);
    const w = []; for (let i = 0; i < cells.length; i += 7) w.push(cells.slice(i, i + 7));
    return w;
  }, [view]);
  const canPrev = view.y > today.getFullYear() || (view.y === today.getFullYear() && view.m > today.getMonth());
  const canNext = view.y < maxDate.getFullYear() || (view.y === maxDate.getFullYear() && view.m < maxDate.getMonth());

  const timeLabel = (() => { const t = times.find((x) => x.v === time) || times[0]; return t ? t.label : (time || '—'); })();

  return (
    <div className="sw">
      <div className="sw-row">
        <div className="sw-field">
          <span className="sw-label">Day</span>
          <button type="button" className={`sw-btn ${open === 'date' ? 'active' : ''}`} onClick={() => setOpen(open === 'date' ? null : 'date')}>
            <span className="sw-ic" aria-hidden="true">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3.5" y="5" width="17" height="16" rx="2.5" /><path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" /></svg>
            </span>
            {labelForDate(selDs)}
          </button>
          {open === 'date' && (
            <>
              <div className="sw-scrim" onClick={() => setOpen(null)} />
              <div className="sw-pop cal">
                <div className="cal-head">
                  <button type="button" className="cal-nav" disabled={!canPrev} onClick={() => setView((v) => ({ y: v.m === 0 ? v.y - 1 : v.y, m: (v.m + 11) % 12 }))}>‹</button>
                  <strong>{MONTHS[view.m]} {view.y}</strong>
                  <button type="button" className="cal-nav" disabled={!canNext} onClick={() => setView((v) => ({ y: v.m === 11 ? v.y + 1 : v.y, m: (v.m + 1) % 12 }))}>›</button>
                </div>
                <div className="cal-grid cal-dow">{WD_MINI.map((w) => <span key={w}>{w}</span>)}</div>
                <div className="cal-grid">
                  {weeks.flat().map((d, i) => {
                    if (!d) return <span key={i} className="cal-cell empty" />;
                    const ds = dstr(d);
                    const ok = bookable(ds, d.getDay());
                    const isSel = ds === selDs;
                    return (
                      <button key={i} type="button" disabled={!ok}
                        className={`cal-cell ${isSel ? 'sel' : ''} ${!ok ? 'off' : ''}`}
                        onClick={() => { onDate(ds); setOpen(null); }}>{d.getDate()}</button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="sw-field">
          <span className="sw-label">Time</span>
          <button type="button" className={`sw-btn ${open === 'time' ? 'active' : ''}`} disabled={times.length === 0} onClick={() => setOpen(open === 'time' ? null : 'time')}>
            <span className="sw-ic" aria-hidden="true">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>
            </span>
            {timeLabel}
          </button>
          {open === 'time' && times.length > 0 && (
            <>
              <div className="sw-scrim" onClick={() => setOpen(null)} />
              <div className="sw-pop times">
                {times.map((t) => (
                  <button key={t.v} type="button" className={`time-opt ${t.v === time ? 'sel' : ''}`} onClick={() => { onTime(t.v); setOpen(null); }}>{t.label}</button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
