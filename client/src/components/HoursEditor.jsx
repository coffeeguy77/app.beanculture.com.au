import React from 'react';

const DAYS = [['Mon', 'MON'], ['Tue', 'TUE'], ['Wed', 'WED'], ['Thu', 'THU'], ['Fri', 'FRI'], ['Sat', 'SAT'], ['Sun', 'SUN']];

// Simple weekly hours editor — one open/close period per day (Open/Closed toggle).
// value shape: { MON:[{open:'07:00',close:'15:00'}], … } ; [] = closed that day.
export default function HoursEditor({ value, onChange, disabled }) {
  const get = (key) => (value && value[key] && value[key][0]) || null;
  const setDay = (key, patch) => {
    const cur = get(key) || { open: '07:00', close: '15:00' };
    onChange({ ...(value || {}), [key]: [{ ...cur, ...patch }] });
  };
  const setClosed = (key, closed) => {
    onChange({ ...(value || {}), [key]: closed ? [] : [get(key) || { open: '07:00', close: '15:00' }] });
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? 'none' : 'auto' }}>
      {DAYS.map(([label, key]) => {
        const p = get(key);
        const open = !!p;
        return (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ width: 38, fontWeight: 700, fontSize: 14 }}>{label}</span>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }} className="muted">
              <input type="checkbox" checked={open} onChange={(e) => setClosed(key, !e.target.checked)} /> Open
            </label>
            {open ? (
              <>
                <input type="time" value={p.open} onChange={(e) => setDay(key, { open: e.target.value })}
                  style={{ padding: '6px 8px', border: '1px solid var(--line)', borderRadius: 8 }} />
                <span className="muted">to</span>
                <input type="time" value={p.close} onChange={(e) => setDay(key, { close: e.target.value })}
                  style={{ padding: '6px 8px', border: '1px solid var(--line)', borderRadius: 8 }} />
              </>
            ) : (
              <span className="muted" style={{ fontSize: 13 }}>Closed</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
