import React, { useEffect, useMemo } from 'react';

const DAYS_SQ = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const WD_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad = (n) => String(n).padStart(2, '0');

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
  return m === 0 ? `${hh}${ap}` : `${hh}:${pad(m)}${ap}`;
}

// Date + time chooser that ONLY offers days the store is open (closed weekdays and
// closed dates are skipped entirely — never selectable) and times inside that
// day's opening hours. Each date reads like "Monday, 11/08/2026".
export default function ScheduleWhen({ hours, date, time, onDate, onTime, maxDays = 14 }) {
  const openDays = hours?.openDays || null; // weekday indices (0=Sun) the store opens
  const closures = hours?.closures || [];
  const weekly = hours?.weekly || {};

  // Bookable 15-min slots for a given weekday, filtered past "now" if it's today.
  function slotsFor(wd, isToday) {
    const periods = (weekly[DAYS_SQ[wd]] || []).filter((p) => p.startMin != null && p.endMin != null);
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes() + 15; // 15-min lead
    const slots = [];
    for (const p of periods) {
      let end = p.endMin; if (end <= p.startMin) end += 24 * 60;
      for (let m = Math.ceil(p.startMin / 15) * 15; m <= end - 15; m += 15) {
        if (isToday && m < nowMin) continue;
        const hh = Math.floor(m / 60) % 24, mm = m % 60;
        slots.push({ v: `${pad(hh)}:${pad(mm)}`, label: fmt12(hh, mm) });
      }
    }
    return slots;
  }

  const dates = useMemo(() => {
    const out = [];
    const now = new Date();
    const todayDs = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    for (let i = 0; i < 90 && out.length < maxDays; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      const wd = d.getDay();
      const ds = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      if (openDays && !openDays.includes(wd)) continue;
      if (closures.some((c) => closureHit(c, ds))) continue;
      // Skip today if there are no bookable times left (past closing) — but only
      // when we actually know the day's hours.
      if (ds === todayDs && (weekly[DAYS_SQ[wd]] || []).length && slotsFor(wd, true).length === 0) continue;
      out.push({ ds, wd, label: `${WD_FULL[wd]}, ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}` });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openDays, closures, maxDays, weekly]);

  // Keep the chosen date valid — default to the first available open day.
  const selDate = dates.some((x) => x.ds === date) ? date : (dates[0] && dates[0].ds);
  useEffect(() => {
    if (selDate && selDate !== date) onDate(selDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selDate]);

  const times = useMemo(() => {
    const day = dates.find((x) => x.ds === selDate);
    if (!day) return [];
    const now = new Date();
    const isToday = selDate === `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    return slotsFor(day.wd, isToday);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selDate, dates, weekly]);

  // Keep the chosen time valid for the selected day.
  useEffect(() => {
    if (times.length && !times.some((t) => t.v === time)) onTime(times[0].v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selDate, times.length]);

  if (dates.length === 0) {
    return <p className="muted" style={{ fontSize: 13, margin: '4px 0 0' }}>No open days available right now.</p>;
  }

  return (
    <div className="dinein-row">
      <label className="field" style={{ flex: 1 }}><span>Day</span>
        <select value={selDate || ''} onChange={(e) => onDate(e.target.value)}>
          {dates.map((d) => <option key={d.ds} value={d.ds}>{d.label}</option>)}
        </select>
      </label>
      <label className="field" style={{ flex: 1 }}><span>Time</span>
        {times.length > 0 ? (
          <select value={time || ''} onChange={(e) => onTime(e.target.value)}>
            {times.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
          </select>
        ) : (
          <input type="time" value={time || '08:00'} onChange={(e) => onTime(e.target.value)} />
        )}
      </label>
    </div>
  );
}
