import React, { useLayoutEffect, useRef, useState } from 'react';

export default function CategoryNav({ categories, active, onPick, variant = 'stacked' }) {
  const stacked = variant !== 'swipe';
  const ref = useRef(null);
  // Indices at which to start a new (balanced) row. Empty = single centered row.
  const [breaks, setBreaks] = useState([]);

  useLayoutEffect(() => {
    if (!stacked || !ref.current) { setBreaks([]); return; }
    const el = ref.current;
    const compute = () => {
      const chips = [...el.querySelectorAll('.chip')];
      if (chips.length < 2) { setBreaks((p) => (p.length ? [] : p)); return; }
      const cw = el.clientWidth;
      const gap = 8;
      const ws = chips.map((c) => c.offsetWidth);
      // How many rows does the content naturally need (greedy width packing)?
      let lines = 1, u = 0;
      for (const w of ws) {
        if (u === 0) u = w;
        else if (u + gap + w <= cw + 0.5) u += gap + w;
        else { lines += 1; u = w; }
      }
      if (lines <= 1) { setBreaks((p) => (p.length ? [] : p)); return; }
      // Aim for equal total width per row; fill greedily to that target so each
      // row fits and rows look evenly balanced (and stay centered via CSS).
      const total = ws.reduce((a, b) => a + b, 0) + gap * (ws.length - 1);
      const targetW = total / lines;
      const br = [];
      u = 0; let cnt = 0; let placed = 1;
      for (let i = 0; i < ws.length; i++) {
        const w = ws[i];
        const next = cnt === 0 ? w : u + gap + w;
        if (cnt > 0 && next > targetW && placed < lines) { br.push(i); u = w; cnt = 1; placed += 1; }
        else { u = next; cnt += 1; }
      }
      setBreaks((prev) => (prev.length === br.length && prev.every((v, i) => v === br[i]) ? prev : br));
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
  if (stacked && breaks.length) {
    const brset = new Set(breaks);
    content = [];
    categories.forEach((c, i) => {
      if (brset.has(i)) content.push(<span key={`br${i}`} className="catnav-break" aria-hidden="true" />);
      content.push(chips[i]);
    });
  }

  return <div className={`catnav ${stacked ? 'stacked' : ''}`} ref={ref}>{content}</div>;
}
