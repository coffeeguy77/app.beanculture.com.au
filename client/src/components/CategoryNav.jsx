import React, { useLayoutEffect, useRef, useState } from 'react';

export default function CategoryNav({ categories, active, onPick, variant = 'stacked' }) {
  const stacked = variant !== 'swipe';
  const ref = useRef(null);
  // Balanced number of items per row (0 = fits on one line, no forced breaks).
  const [perRow, setPerRow] = useState(0);

  useLayoutEffect(() => {
    if (!stacked || !ref.current) { setPerRow(0); return; }
    const el = ref.current;
    const compute = () => {
      const chips = [...el.querySelectorAll('.chip')];
      if (chips.length < 2) { setPerRow(0); return; }
      const cw = el.clientWidth;
      const gap = 8;
      // Greedily pack by width to find how many natural lines are needed.
      let lines = 1, used = 0;
      for (const c of chips) {
        const w = c.offsetWidth;
        if (used === 0) used = w;
        else if (used + gap + w <= cw + 0.5) used += gap + w;
        else { lines += 1; used = w; }
      }
      // Even split: ceil(total / lines) per row, centered. 0 when it all fits.
      const target = lines <= 1 ? 0 : Math.ceil(chips.length / lines);
      setPerRow((prev) => (prev === target ? prev : target));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [categories, stacked]);

  if (!categories || categories.length === 0) return null;

  const chips = categories.map((c) => (
    <button key={c} className={`chip ${active === c ? 'on' : ''}`} onClick={() => onPick(c)} type="button">{c}</button>
  ));

  let content = chips;
  if (stacked && perRow > 0 && perRow < categories.length) {
    content = [];
    categories.forEach((c, i) => {
      if (i > 0 && i % perRow === 0) content.push(<span key={`br${i}`} className="catnav-break" aria-hidden="true" />);
      content.push(chips[i]);
    });
  }

  return <div className={`catnav ${stacked ? 'stacked' : ''}`} ref={ref}>{content}</div>;
}
