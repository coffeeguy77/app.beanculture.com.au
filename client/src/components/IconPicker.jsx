import React, { useEffect, useRef, useState } from 'react';
import { SlotIcon, ICON_LIBRARY } from './icons.jsx';

// Icon chooser: a grid of built-in stroke icons plus a live search of a public
// stroke-icon library (Iconify: lucide + tabler + phosphor). Picking a searched
// icon fetches its SVG once and stores it in settings, so the storefront has no
// runtime dependency on the icon CDN.
const ICONIFY = 'https://api.iconify.design';
const SETS = 'lucide,tabler,ph';

export default function IconPicker({ value, brand = '#b5566e', onChange }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef(null);
  const hex = encodeURIComponent(brand || '#b5566e');

  useEffect(() => {
    if (!open) return;
    if (!q.trim()) { setResults([]); return; }
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await fetch(`${ICONIFY}/search?query=${encodeURIComponent(q.trim())}&limit=60&prefixes=${SETS}`);
        const d = await r.json();
        setResults(d.icons || []);
      } catch { setResults([]); }
      setSearching(false);
    }, 300);
    return () => clearTimeout(timer.current);
  }, [q, open]);

  async function pickSearched(name) {
    try {
      const r = await fetch(`${ICONIFY}/${name.replace(':', '/')}.svg`);
      const svg = await r.text();
      if (svg && /<svg/i.test(svg)) {
        onChange({ icon: name, iconSvg: svg });
        setOpen(false);
      }
    } catch { /* ignore */ }
  }

  return (
    <div className="iconpick">
      <button type="button" className="iconpick-current" onClick={() => setOpen((o) => !o)} title="Change icon">
        <SlotIcon icon={value?.icon} iconSvg={value?.iconSvg} size={26} />
        <span className="iconpick-caret">▾</span>
      </button>

      {open && (
        <div className="iconpick-panel">
          <input className="iconpick-search" autoFocus placeholder="Search icons (e.g. coffee, taco, cake…)"
            value={q} onChange={(e) => setQ(e.target.value)} />

          {q.trim() ? (
            <div className="iconpick-grid">
              {searching && <div className="muted" style={{ fontSize: 12, gridColumn: '1 / -1' }}>Searching…</div>}
              {!searching && results.length === 0 && <div className="muted" style={{ fontSize: 12, gridColumn: '1 / -1' }}>No icons found.</div>}
              {results.map((name) => (
                <button key={name} type="button" className="iconpick-cell" title={name} onClick={() => pickSearched(name)}>
                  <img src={`${ICONIFY}/${name.replace(':', '/')}.svg?color=${hex}&height=26`} alt="" width="26" height="26" loading="lazy" />
                </button>
              ))}
            </div>
          ) : (
            <>
              <div className="iconpick-label">Built-in</div>
              <div className="iconpick-grid">
                {ICON_LIBRARY.map((name) => (
                  <button key={name} type="button"
                    className={`iconpick-cell ${!value?.iconSvg && value?.icon === name ? 'on' : ''}`}
                    title={name} onClick={() => { onChange({ icon: name, iconSvg: null }); setOpen(false); }}
                    style={{ color: brand }}>
                    <SlotIcon icon={name} size={26} />
                  </button>
                ))}
              </div>
              <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>Or search thousands more above (all stroke icons).</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
