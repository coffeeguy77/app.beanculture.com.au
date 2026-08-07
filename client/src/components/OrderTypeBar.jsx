import React from 'react';

export default function OrderTypeBar({ dineIn, setDineIn, table, setTable, locked, onUnlock }) {
  // Locked = the table came from a scanned QR code. Show it fixed with an ✕ to change.
  if (locked && dineIn && table) {
    return (
      <section className="ordertype">
        <div className="table-lock">
          <div className="table-lock-info">
            <span className="table-lock-eyebrow">Dine in</span>
            <span className="table-lock-table">Table {table}</span>
          </div>
          <button className="table-lock-x" onClick={onUnlock} type="button" aria-label="Change table or order type">
            ✕
          </button>
        </div>
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
        <label className="field">
          <span className="req">Table number</span>
          <input inputMode="numeric" placeholder="e.g. 12" value={table} onChange={(e) => setTable(e.target.value)} />
        </label>
      )}
    </section>
  );
}
