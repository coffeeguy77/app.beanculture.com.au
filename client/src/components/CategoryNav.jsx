import React, { useState, useRef, useEffect } from 'react';

export default function CategoryNav({ categories, active, onPick, variant = 'stacked' }) {
  const stacked = variant !== 'swipe';
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const ref = useRef(null);

  // In stacked mode, only show the expand/collapse toggle when the chips would
  // wrap onto more than one row (so a short menu stays clean).
  useEffect(() => {
    if (!stacked || !ref.current) { setOverflowing(false); return; }
    const el = ref.current;
    const check = () => setOverflowing(el.scrollHeight > 52);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [stacked, categories]);

  if (!categories || categories.length < 2) return null;

  const collapsed = stacked && overflowing && !expanded;
  return (
    <div className={`catnav ${stacked ? 'stacked' : ''} ${collapsed ? 'collapsed' : ''}`} ref={ref}>
      {categories.map((c) => (
        <button key={c} className={`chip ${active === c ? 'on' : ''}`} onClick={() => onPick(c)} type="button">
          {c}
        </button>
      ))}
      {stacked && overflowing && (
        <button type="button" className="catnav-toggle" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Less ▲' : 'More ▼'}
        </button>
      )}
    </div>
  );
}
