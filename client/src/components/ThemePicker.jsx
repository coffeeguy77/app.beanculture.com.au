import React, { useState } from 'react';

export default function ThemePicker({ presets, seasonal, baseTheme, current, onApply, onReset, onClose }) {
  const start = current || baseTheme;
  const [brand, setBrand] = useState(start.brand || '#b5566e');
  const [accent, setAccent] = useState(start.accent || '#d1547a');
  const [bg, setBg] = useState(start.bg || '#fdf1f4');
  const [ink, setInk] = useState(start.ink || '#3b2b30');

  function apply(next) {
    const t = { brand, accent, bg, ink, ...next };
    if (next?.brand !== undefined) setBrand(next.brand);
    if (next?.accent !== undefined) setAccent(next.accent);
    if (next?.bg !== undefined) setBg(next.bg);
    if (next?.ink !== undefined) setInk(next.ink);
    onApply(t);
  }

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <button className="sheet-close" onClick={onClose}>×</button>
        <div className="sheet-body">
          <h2>Make it yours</h2>
          <p className="muted" style={{ margin: 0 }}>Pick a look — it’s saved on this device and loads next time.</p>

          <div className="swatches">
            {presets.map((p) => (
              <div key={p.name} className="swatch" onClick={() => apply({ brand: p.brand, accent: p.accent, bg: p.bg, ink: p.ink })}>
                <div className="dots">
                  <i style={{ background: p.bg, border: '1px solid #0001' }} />
                  <i style={{ background: p.brand }} />
                  <i style={{ background: p.accent }} />
                </div>
                {p.name}
              </div>
            ))}
          </div>

          {seasonal && seasonal.length > 0 && (
            <div>
              <div className="group-title" style={{ marginTop: 4 }}>Seasonal · festive</div>
              <div className="swatches">
                {seasonal.map((s) => (
                  <div
                    key={s.id}
                    className="swatch"
                    onClick={() => onApply({ ...s })}
                  >
                    <div
                      style={{
                        height: 46, borderRadius: 9, marginBottom: 8, overflow: 'hidden',
                        display: 'grid', placeItems: 'center',
                        background: `radial-gradient(circle at 50% 0%, rgba(24,120,78,0.5), transparent 60%), ${s.bg}`,
                      }}
                    >
                      <div
                        style={{
                          width: '72%', height: 22, borderRadius: 6,
                          background: (s.season && s.season.cardBg) || s.accent,
                          border: `1.5px solid ${(s.season && s.season.gold) || '#D8A93B'}`,
                        }}
                      />
                    </div>
                    {s.name}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="group">
            <div className="group-title">Customise</div>
            <div className="color-row"><span>Brand</span><input type="color" value={brand} onChange={(e) => apply({ brand: e.target.value })} /></div>
            <div className="color-row"><span>Buttons</span><input type="color" value={accent} onChange={(e) => apply({ accent: e.target.value })} /></div>
            <div className="color-row"><span>Background</span><input type="color" value={bg} onChange={(e) => apply({ bg: e.target.value })} /></div>
            <div className="color-row"><span>Text</span><input type="color" value={ink} onChange={(e) => apply({ ink: e.target.value })} /></div>
          </div>

          <button className="btn ghost full" onClick={() => { onReset(); onClose(); }}>Reset to Bean Culture</button>
          <button className="btn full" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
