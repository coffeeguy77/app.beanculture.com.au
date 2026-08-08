import React from 'react';
import { TableLockPill, TableEntry } from './TableControls.jsx';
import ScheduleWhen from './ScheduleWhen.jsx';

export default function OrderTypeBar({ dineIn, setDineIn, table, setTable, lock, onUnlock, onScanned, when, setWhen, at, setAt, hours }) {
  const storeOpen = hours?.open !== false;
  const nextLabel = hours?.nextOpen?.label;
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
              <ScheduleWhen hours={hours} date={at?.date} time={at?.time}
                onDate={(d) => setAt({ ...(at || {}), date: d })}
                onTime={(t) => setAt({ ...(at || {}), time: t })} />
            )}
          </>
        );
      })()}
    </section>
  );
}
