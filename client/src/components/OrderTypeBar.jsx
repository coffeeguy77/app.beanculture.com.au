import React from 'react';
import { TableLockPill, TableEntry } from './TableControls.jsx';
import ScheduleWhen from './ScheduleWhen.jsx';

export default function OrderTypeBar({ dineIn, setDineIn, table, setTable, lock, onUnlock, onScanned, when, setWhen, at, setAt, hours, onReserve }) {
  const storeOpen = hours?.open !== false;
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
      <div className={`segmented ${onReserve ? 'three' : ''}`}>
        <button className={dineIn === true ? 'seg active' : 'seg'} disabled={!storeOpen}
          onClick={() => storeOpen && setDineIn(true)} type="button"
          style={!storeOpen ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}>
          {storeOpen ? 'Dine in' : 'Dine in · Closed'}
        </button>
        <button className={dineIn === false ? 'seg active' : 'seg'} onClick={() => setDineIn(false)} type="button">
          Takeaway
        </button>
        {onReserve && (
          <button className="seg" onClick={onReserve} type="button">Reserve a table</button>
        )}
      </div>
      {dineIn === null && <p className="muted" style={{ fontSize: 12, margin: 0 }}>Choose dine in or takeaway to continue.</p>}
      {dineIn === true && (
        <TableEntry lock={lock} table={table} setTable={setTable} onUnlock={onUnlock} onScanned={onScanned} />
      )}
      {dineIn === false && setWhen && (() => {
        const effWhen = storeOpen ? when : 'later';
        return (
          <div className="when-row">
            <div className="sw-field when-field">
              <span className="sw-label">When</span>
              <div className="segmented when-seg">
                <button className={effWhen === 'now' ? 'seg active' : 'seg'} disabled={!storeOpen}
                  onClick={() => storeOpen && setWhen('now')} type="button"
                  style={!storeOpen ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}>Now</button>
                <button className={effWhen === 'later' ? 'seg active' : 'seg'} onClick={() => setWhen('later')} type="button">Later</button>
              </div>
            </div>
            {effWhen === 'later' && (
              <ScheduleWhen hours={hours} date={at?.date} time={at?.time}
                onDate={(d) => setAt({ ...(at || {}), date: d })}
                onTime={(t) => setAt({ ...(at || {}), time: t })} />
            )}
            {effWhen === 'now' && (
              <p className="when-now-note">Ordering for immediate pickup</p>
            )}
          </div>
        );
      })()}
    </section>
  );
}
