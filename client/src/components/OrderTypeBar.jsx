import React from 'react';
import { TableLockPill, TableEntry } from './TableControls.jsx';

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function OrderTypeBar({ dineIn, setDineIn, table, setTable, lock, onUnlock, onScanned, when, setWhen, at, setAt }) {
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
      {dineIn === false && setWhen && (
        <>
          <div className="segmented">
            <button className={when === 'now' ? 'seg active' : 'seg'} onClick={() => setWhen('now')} type="button">Now</button>
            <button className={when === 'later' ? 'seg active' : 'seg'} onClick={() => setWhen('later')} type="button">Later</button>
          </div>
          {when === 'later' && (
            <div className="dinein-row">
              <label className="field" style={{ flex: 1 }}><span>Date</span>
                <input type="date" min={todayStr()} value={at?.date || ''} onChange={(e) => setAt({ ...(at || {}), date: e.target.value })} /></label>
              <label className="field" style={{ flex: 1 }}><span>Time</span>
                <input type="time" value={at?.time || '08:00'} onChange={(e) => setAt({ ...(at || {}), time: e.target.value })} /></label>
            </div>
          )}
        </>
      )}
    </section>
  );
}
