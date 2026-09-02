import React, { useState } from 'react';
import QRScanner from './QRScanner.jsx';

// Stage 2 — scanned/locked: big solid pill, tap ✕ to step down.
export function TableLockPill({ table, onUnlock }) {
  return (
    <div className="table-lock">
      <div className="table-lock-info">
        <span className="table-lock-eyebrow">Dine in</span>
        <span className="table-lock-table">Table {table}</span>
      </div>
      <button className="table-lock-x" onClick={onUnlock} type="button" aria-label="Change table or order type">
        ✕
      </button>
    </div>
  );
}

// Stages 1 & 0 for the table field, plus the Scan button + camera.
//   lock === 1 → solid (non-editable) chip; ✕ steps down to manual entry.
//   lock === 0 → editable table-number input.
// `user` (the signed-in account) unlocks a PRIVATE quick-pick — "Shaun's Desk"
// only ever appears for the owner's own phone number, no one else.
const OWNER_DESK_PHONE = '0414631463';
const OWNER_DESK_LABEL = "Shaun's Desk";
function normalisePhone(p) {
  let d = (p || '').replace(/\D/g, '');
  if (d.startsWith('61')) d = '0' + d.slice(2);      // +61 4… → 04…
  if (d.length === 9 && d[0] === '4') d = '0' + d;    // 4146… → 04146…
  return d;
}
export function TableEntry({ lock, table, setTable, onUnlock, onScanned, user }) {
  const [scanOpen, setScanOpen] = useState(false);
  const semi = lock === 1 && table;
  const isOwner = normalisePhone(user?.phone) === OWNER_DESK_PHONE;
  const onDesk = table === OWNER_DESK_LABEL;
  return (
    <>
      <div className={`dinein-row ${semi ? 'semi' : ''}`}>
        {semi ? (
          <div className="table-chip">
            <span>Table {table}</span>
            <button className="table-chip-x" type="button" onClick={onUnlock} aria-label="Enter table number manually">✕</button>
          </div>
        ) : onDesk ? (
          <div className="table-chip special-table-chip">
            <span>⭐ {OWNER_DESK_LABEL}</span>
            <button className="table-chip-x" type="button" onClick={() => setTable('')} aria-label="Choose a different table">✕</button>
          </div>
        ) : (
          <label className="field dinein-field">
            <span className="req">Table number</span>
            <input inputMode="numeric" placeholder="e.g. 12" value={table} onChange={(e) => setTable(e.target.value)} />
          </label>
        )}
        <button className="btn ghost scan-btn" type="button" onClick={() => setScanOpen(true)}>
          <ScanIcon /> Scan
        </button>
      </div>
      {isOwner && !onDesk && !semi && (
        <button type="button" className="special-table-btn" onClick={() => setTable(OWNER_DESK_LABEL)}>
          <span>⭐ {OWNER_DESK_LABEL}</span>
          <span className="special-table-tag">Special Table</span>
        </button>
      )}
      {scanOpen && (
        <QRScanner onClose={() => setScanOpen(false)} onResult={(v) => { setScanOpen(false); onScanned && onScanned(v); }} />
      )}
    </>
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
