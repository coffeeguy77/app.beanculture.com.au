import React, { useState } from 'react';
import QRScanner from './QRScanner.jsx';

export default function OrderTypeBar({ dineIn, setDineIn, table, setTable, locked, onUnlock, onScanned }) {
  const [scanOpen, setScanOpen] = useState(false);

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
        <>
          <div className="dinein-row">
            <label className="field dinein-field">
              <span className="req">Table number</span>
              <input inputMode="numeric" placeholder="e.g. 12" value={table} onChange={(e) => setTable(e.target.value)} />
            </label>
            <button className="btn ghost scan-btn" type="button" onClick={() => setScanOpen(true)}>
              <ScanIcon /> Scan
            </button>
          </div>
          {scanOpen && (
            <QRScanner
              onClose={() => setScanOpen(false)}
              onResult={(value) => { setScanOpen(false); onScanned && onScanned(value); }}
            />
          )}
        </>
      )}
    </section>
  );
}

function ScanIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2" />
      <line x1="4" y1="12" x2="20" y2="12" />
    </svg>
  );
}
