import React from 'react';

export default function CategoryNav({ categories, active, onPick, variant = 'stacked' }) {
  // Show the bar whenever there's at least one section (a single top item is
  // still worth showing). Stacked = wrap onto rows so items are never lost;
  // swipe = a single horizontally-scrolling row.
  if (!categories || categories.length === 0) return null;
  const stacked = variant !== 'swipe';
  return (
    <div className={`catnav ${stacked ? 'stacked' : ''}`}>
      {categories.map((c) => (
        <button key={c} className={`chip ${active === c ? 'on' : ''}`} onClick={() => onPick(c)} type="button">
          {c}
        </button>
      ))}
    </div>
  );
}
