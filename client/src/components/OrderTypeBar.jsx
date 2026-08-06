import React from 'react';

// The control that fixes Shaun's whole problem: make the customer state
// dine-in + table, or takeaway, up front — pre-filled from the table QR code
// but always editable.
export default function OrderTypeBar({ dineIn, setDineIn, table, setTable, name, setName }) {
  return (
    <section className="ordertype">
      <div className="segmented">
        <button
          className={dineIn ? 'seg active' : 'seg'}
          onClick={() => setDineIn(true)}
          type="button"
        >
          Dine in
        </button>
        <button
          className={!dineIn ? 'seg active' : 'seg'}
          onClick={() => setDineIn(false)}
          type="button"
        >
          Takeaway
        </button>
      </div>

      {dineIn ? (
        <label className="field">
          <span>Table number</span>
          <input
            inputMode="numeric"
            placeholder="e.g. 12"
            value={table}
            onChange={(e) => setTable(e.target.value)}
          />
        </label>
      ) : (
        <label className="field">
          <span>Name for the order</span>
          <input
            placeholder="e.g. Shaun"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
      )}
    </section>
  );
}
