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

// Small effect-type glyph per seasonal preset (id-keyed).
const EFFECT_ICON = {
  christmas: '❄', newyear: '✨', australiaday: '🍃', lunarnewyear: '🏮',
  valentines: '🌹', stpatricks: '☘', easter: '🌸', anzac: '🌺',
  mothersday: '💐', floriade: '🌷', fathersday: '☕', halloween: '🦇',
};

// Small glyph per Effects Engine slug, used in the customer overlay selector.
const OVERLAY_ICON = {
  snow: '❄', hearts: '💗', petals: '🌸', sparkles: '✨', confetti: '🎉',
  clover: '☘', eucalyptus: '🍃', bats: '🦇', embers: '🔥',
  'lunar-celebration': '🏮', 'halloween-atmosphere': '🦇',
};

// One preview card. `core` carries the handful of colours we preview from
// (gradient stops + surface/primary/accent); works for both presets and the
// seasonal adapter shape below. `effectIcon`/`eventActive` are seasonal-only.
function ThemeCard({ name, core, selected, onClick, effectIcon, eventActive }) {
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
        {effectIcon && <span className="theme-card-fx" aria-hidden="true">{effectIcon}</span>}
        {eventActive && <span className="theme-card-live">● Event active</span>}
        {selected && <span className="theme-card-check" aria-hidden="true">✓</span>}
      </div>
      <span className="theme-card-name" style={{ color: core.primary }}>{name}</span>
    </button>
  );
}

export default function ThemePicker({ presets, seasonal, currentId, activeSeasonalId, effects, effectPref, onApplyEffect, onApply, onApplySeasonal, onReset, onClose }) {
  const list = presets || [];
  const presetCore = (p) => ({
    start: p.canvasStart, end: p.canvasEnd, surface: p.surface, primary: p.primary, accent: p.accent,
  });
  // Seasonal theme → the same preview shape. Remastered themes carry the full
  // `palette`; preview the real canvas gradient + surface + primary + accent.
  const seasonalCore = (s) => {
    const p = s.palette;
    if (p) return { start: p.canvasStart, end: p.canvasEnd, surface: p.surface, primary: p.primary, accent: p.accent };
    return {
      start: s.bg || '#211218',
      end: (s.season && s.season.cardBg) || s.accent || s.bg || '#211218',
      surface: s.surface || '#fff9f3',
      primary: s.brand || s.accent,
      accent: s.accent || s.brand,
    };
  };

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
                    effectIcon={EFFECT_ICON[(s.effectsConfig && s.effectsConfig.effectPreset) || s.id]}
                    eventActive={s.id === activeSeasonalId}
                    onClick={() => onApplySeasonal(s)}
                  />
                ))}
              </div>
            </div>
          )}

          <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
            Event banners and animated effects appear only during the configured event dates. The colour scheme can be used at any time.
          </p>

          {effects && effects.length > 0 && (
            <div>
              <div className="group-title">Effect overlay</div>
              <p className="muted" style={{ margin: '0 0 8px', fontSize: 12.5 }}>
                Add a particle overlay to any theme — it never changes the colour scheme or loads an event banner on its own.
              </p>
              <div className="fx-radio-group" role="radiogroup" aria-label="Effect overlay">
                <label className="fx-radio">
                  <input
                    type="radio" name="fx-overlay"
                    checked={!effectPref || effectPref.mode === 'theme-default'}
                    onChange={() => onApplyEffect({ mode: 'theme-default' })}
                  />
                  <span>Theme default</span>
                </label>
                <label className="fx-radio">
                  <input
                    type="radio" name="fx-overlay"
                    checked={effectPref?.mode === 'none'}
                    onChange={() => onApplyEffect({ mode: 'none' })}
                  />
                  <span>None</span>
                </label>
                {effects.map((e) => (
                  <label key={e.id} className="fx-radio">
                    <input
                      type="radio" name="fx-overlay"
                      checked={effectPref?.mode === 'custom' && effectPref?.effectId === e.id}
                      onChange={() => onApplyEffect({ mode: 'custom', effectId: e.id })}
                    />
                    <span aria-hidden="true">{OVERLAY_ICON[e.slug] || '✦'}</span>
                    <span>{e.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <button className="btn ghost full" onClick={() => { onReset(); onClose(); }}>Use store theme</button>
          <button className="btn full" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
