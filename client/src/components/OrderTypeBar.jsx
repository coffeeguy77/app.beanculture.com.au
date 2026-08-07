import React from 'react';

export default function OrderTypeBar({ dineIn, setDineIn, table, setTable }) {
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
