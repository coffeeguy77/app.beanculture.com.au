import React from 'react';

// Storefront appearance picker. Presents the 8 permanent presets as preview
// CARDS grouped by collection, then any server seasonal/event looks, then a
// "Use store theme" reset. Each card previews the page gradient, a light surface
// chip, a primary button chip and an accent dot — no gender labels anywhere.

const GROUPS = [
  { key: 'universal', label: 'Universal' },
  { key: 'bold', label: 'Bold & Rich' },
  { key: 'soft', label: 'Soft & Expressive' },
];

// One preview card. `core` carries the handful of colours we preview from
// (gradient stops + surface/primary/accent); works for both presets and the
// seasonal adapter shape below.
function ThemeCard({ name, core, selected, onClick }) {
  return (
    <button
      type="button"
      className={`theme-card${selected ? ' is-selected' : ''}`}
      onClick={onClick}
      aria-pressed={selected}
    >
      <div
        className="theme-card-preview"
        style={{ background: `linear-gradient(135deg, ${core.start}, ${core.end})` }}
      >
        <span className="theme-card-surface" style={{ background: core.surface }}>
          <span className="theme-card-btn" style={{ background: core.primary }} />
          <span className="theme-card-dot" style={{ background: core.accent }} />
        </span>
        {selected && <span className="theme-card-check" aria-hidden="true">✓</span>}
      </div>
      <span className="theme-card-name">{name}</span>
    </button>
  );
}

export default function ThemePicker({ presets, seasonal, currentId, onApply, onApplySeasonal, onReset, onClose }) {
  const list = presets || [];
  const presetCore = (p) => ({
    start: p.canvasStart, end: p.canvasEnd, surface: p.surface, primary: p.primary, accent: p.accent,
  });
  // Legacy seasonal theme → the same preview shape.
  const seasonalCore = (s) => ({
    start: s.bg || '#211218',
    end: (s.season && s.season.cardBg) || s.accent || s.bg || '#211218',
    surface: s.surface || '#fff9f3',
    primary: s.brand || s.accent,
    accent: s.accent || s.brand,
  });

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <button className="sheet-close" onClick={onClose}>×</button>
        <div className="sheet-body">
          <h2>Bean Culture Collection</h2>
          <p className="muted" style={{ margin: 0 }}>Pick a look — saved on this device, loads next time.</p>

          {GROUPS.map((g) => {
            const items = list.filter((p) => p.collection === g.key);
            if (!items.length) return null;
            return (
              <div key={g.key}>
                <div className="group-title">{g.label}</div>
                <div className="theme-grid">
                  {items.map((p) => (
                    <ThemeCard
                      key={p.id}
                      name={p.name}
                      core={presetCore(p)}
                      selected={p.id === currentId}
                      onClick={() => onApply(p)}
                    />
                  ))}
                </div>
              </div>
            );
          })}

          {seasonal && seasonal.length > 0 && (
            <div>
              <div className="group-title">Seasonal &amp; Events</div>
              <div className="theme-grid">
                {seasonal.map((s) => (
                  <ThemeCard
                    key={s.id}
                    name={s.name}
                    core={seasonalCore(s)}
                    selected={s.id === currentId}
                    onClick={() => onApplySeasonal(s)}
                  />
                ))}
              </div>
            </div>
          )}

          <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
            Every look re-skins the whole storefront. Event looks change the colours only — event banners still appear only during the event itself.
          </p>

          <button className="btn ghost full" onClick={() => { onReset(); onClose(); }}>Use store theme</button>
          <button className="btn full" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
