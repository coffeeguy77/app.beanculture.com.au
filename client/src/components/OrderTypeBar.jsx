import React from 'react';
import { TableLockPill, TableEntry } from './TableControls.jsx';

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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

export default function OrderTypeBar({ dineIn, setDineIn, table, setTable, lock, onUnlock, onScanned, when, setWhen, at, setAt, hours }) {
  const storeOpen = hours?.open !== false;
  const nextLabel = hours?.nextOpen?.label;
  const openDays = hours?.openDays || null;
  const closures = hours?.closures || [];
  function laterClosed(ds) {
    if (!ds) return null;
    if (openDays) { const wd = new Date(`${ds}T12:00:00`).getDay(); if (!openDays.includes(wd)) return 'we’re closed that day'; }
    if (closures.some((c) => closureHit(c, ds))) return 'we’re closed that date';
    return null;
  }
  // Stage 2 — scanned: prominent solid pill only, no toggle.
  if (lock >= 2 && dineIn && table) {
    return (
      <section className="ordertype">
        <TableLockPill table={table} onUnlock={onUnlock} />
      </section>
    );
  }

  return (
    <section className="ordertype">
      <div className="segmented">
        <button className={dineIn === true ? 'seg active' : 'seg'} onClick={() => setDineIn(true)} type="button">
          Dine in
        </button>
        <button className={dineIn === false ? 'seg active' : 'seg'} onClick={() => setDineIn(false)} type="button">
          Takeaway
        </button>
      </div>
      {dineIn === null && <p className="muted" style={{ fontSize: 12, margin: 0 }}>Choose dine in or takeaway to continue.</p>}
      {dineIn === true && (
        <TableEntry lock={lock} table={table} setTable={setTable} onUnlock={onUnlock} onScanned={onScanned} />
      )}
      {dineIn === false && setWhen && (() => {
        const effWhen = storeOpen ? when : 'later';
        const dateClosed = effWhen === 'later' ? laterClosed(at?.date) : null;
        return (
          <>
            {!storeOpen && (
              <p className="muted" style={{ fontSize: 12.5, margin: '2px 0 0' }}>
                We’re closed{nextLabel ? ` — we reopen ${nextLabel}` : ''}. Order ahead for later:
              </p>
            )}
            <div className="segmented">
              <button className={effWhen === 'now' ? 'seg active' : 'seg'} disabled={!storeOpen}
                onClick={() => storeOpen && setWhen('now')} type="button"
                style={!storeOpen ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}>Now</button>
              <button className={effWhen === 'later' ? 'seg active' : 'seg'} onClick={() => setWhen('later')} type="button">Later</button>
            </div>
            {effWhen === 'later' && (
              <>
                <div className="dinein-row">
                  <label className="field" style={{ flex: 1 }}><span>Date</span>
                    <input type="date" min={todayStr()} value={at?.date || ''} onChange={(e) => setAt({ ...(at || {}), date: e.target.value })} /></label>
                  <label className="field" style={{ flex: 1 }}><span>Time</span>
                    <input type="time" value={at?.time || '08:00'} onChange={(e) => setAt({ ...(at || {}), time: e.target.value })} /></label>
                </div>
                {dateClosed && <p className="error-text" style={{ fontSize: 12.5, margin: '4px 0 0' }}>Sorry, {dateClosed} — please pick another day.</p>}
              </>
            )}
          </>
        );
      })()}
    </section>
  );
}
