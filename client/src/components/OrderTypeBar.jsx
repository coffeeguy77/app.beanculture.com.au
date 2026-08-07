import React from 'react';
import { TableLockPill, TableEntry } from './TableControls.jsx';

export default function OrderTypeBar({ dineIn, setDineIn, table, setTable, lock, onUnlock, onScanned }) {
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
        <button className={dineIn ? 'seg active' : 'seg'} onClick={() => setDineIn(true)} type="button">
          Dine in
        </button>
        <button className={!dineIn ? 'seg active' : 'seg'} onClick={() => setDineIn(false)} type="button">
          Takeaway
        </button>
      </div>
      {dineIn && (
        <TableEntry lock={lock} table={table} setTable={setTable} onUnlock={onUnlock} onScanned={onScanned} />
      )}
    </section>
  );
}
