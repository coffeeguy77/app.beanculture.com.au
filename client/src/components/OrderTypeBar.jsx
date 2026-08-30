import React from 'react';
import { TableLockPill, TableEntry } from './TableControls.jsx';
import ScheduleWhen from './ScheduleWhen.jsx';

export default function OrderTypeBar({ dineIn, setDineIn, table, setTable, lock, onUnlock, onScanned, when, setWhen, at, setAt, hours, onReserve, allowDineIn = true, allowTakeaway = true, dineInLabel = 'Dine in' }) {
  const storeOpen = hours?.open !== false;
  // Stage 2 — scanned: prominent solid pill only, no toggle.
  if (lock >= 2 && dineIn && table) {
    return (
      <section className="ordertype">
        <TableLockPill table={table} onUnlock={onUnlock} />
      </section>
    );
  }

  // How many order-type choices this store actually offers. With a single
  // option there's nothing to toggle, so the segmented bar is hidden and we go
  // straight to that option's controls (table entry, or takeaway timing).
  const choiceCount = (allowDineIn ? 1 : 0) + (allowTakeaway ? 1 : 0) + (onReserve ? 1 : 0);
  const showSeg = choiceCount > 1;

  return (
    <section className="ordertype">
      {showSeg && (
        <div className={`segmented ${(allowDineIn && onReserve) ? 'three' : ''}`}>
          {allowDineIn && (
            <button className={dineIn === true ? 'seg active' : 'seg'} disabled={!storeOpen}
              onClick={() => storeOpen && setDineIn(true)} type="button"
              style={!storeOpen ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}>
              {storeOpen ? dineInLabel : `${dineInLabel} · Closed`}
            </button>
          )}
          {allowTakeaway && (
            <button className={dineIn === false ? 'seg active' : 'seg'} onClick={() => setDineIn(false)} type="button">
              Takeaway
            </button>
          )}
          {onReserve && (
            <button className="seg" onClick={onReserve} type="button">Reserve a table</button>
          )}
        </div>
      )}
      {showSeg && dineIn === null && <p className="muted" style={{ fontSize: 12, margin: 0 }}>Choose {allowDineIn ? `${dineInLabel.toLowerCase()} or ` : ''}takeaway to continue.</p>}
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
