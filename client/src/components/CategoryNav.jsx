import React from 'react';

export default function CategoryNav({ categories, active, onPick }) {
  if (!categories || categories.length < 2) return null;
  return (
    <div className="catnav">
      {categories.map((c) => (
        <button key={c} className={`chip ${active === c ? 'on' : ''}`} onClick={() => onPick(c)} type="button">
          {c}
        </button>
      ))}
    </div>
  );
}
