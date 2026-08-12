import React, { useEffect, useRef, useState } from 'react';
import { EFFECT_ASSET_IDS, EFFECT_ASSETS } from '../effectAssets.js';
import { runEffect } from '../effectEngine.js';

// Admin Effect Builder: create, edit, duplicate, enable/disable, make
// customer-selectable, and delete reusable particle-overlay presets. Themes
// and seasonal events reference these by stable `id` (see settings.js) —
// renaming an effect here never breaks an assignment.

const row = { display: 'flex', gap: 8, alignItems: 'center' };
const field = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'var(--fs-sm)' };
const box = { border: '1px solid var(--line)', borderRadius: 12, padding: 10 };
const num = (v, on, opts = {}) => (
  <input type="number" value={v} onChange={(e) => on(Number(e.target.value))} style={{ width: opts.w || 64, padding: '5px 6px', border: '1px solid var(--line)', borderRadius: 8 }} {...opts} />
);

function newEffect() {
  const id = 'eff-custom-' + Date.now().toString(36);
  return {
    id, name: 'New effect', slug: id, builtIn: false, enabled: true, frontendSelectable: false,
    version: 1, renderer: 'canvas-particles', description: '',
    assets: [{ assetId: 'soft-snow-dot', weight: 100 }],
    motion: { directionDegrees: 180, speedMin: 20, speedMax: 50, driftMin: -8, driftMax: 8, sway: 0.5, rotationMin: 0, rotationMax: 360, rotationSpeedMin: -15, rotationSpeedMax: 15, lifetimeMin: 6, lifetimeMax: 12 },
    emission: { density: 0.7, spawnRate: 1, maxParticlesDesktop: 20, maxParticlesMobile: 9, spawnArea: 'top', burstOnLoad: false, burstCount: 0 },
    appearance: {
      sizeMin: 10, sizeMax: 20, opacityMin: 0.5, opacityMax: 0.9,
      colorMode: 'single', colors: ['#FFFFFF'],
      renderMode: 'fill', fillPercentage: 100, strokePercentage: 0, mixedPercentage: 0,
      strokeWidthMin: 1.5, strokeWidthMax: 2.5,
      glowEnabled: false, glowColorMode: 'inherit', glowColors: [], glowBlurMin: 3, glowBlurMax: 8, glowOpacity: 0.5, glowPercentage: 0,
    },
    randomness: { amount: 0.5, assetRandomness: 1, colorRandomness: 1, sizeRandomness: 1, speedRandomness: 1, opacityRandomness: 1, rotationRandomness: 1 },
    accessibility: { reducedMotionMode: 'static-glow' },
  };
}

function perfRating(e) {
  const max = Math.max(e.emission.maxParticlesDesktop, e.emission.maxParticlesMobile * 1.4);
  const glowCost = e.appearance.glowEnabled ? (e.appearance.glowPercentage / 100) * 1.6 : 0;
  const score = max * (0.6 + glowCost) * (e.emission.density || 1);
  if (score > 40) return 'Heavy';
  if (score > 20) return 'Moderate';
  return 'Light';
}

function EffectPreview({ effect, bg }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return undefined;
    return runEffect(ref.current, effect, { reducedMotion: false });
  }, [JSON.stringify(effect)]);
  const bgStyle = {
    current: { background: 'linear-gradient(160deg,#321421,#160f12)' },
    dark: { background: '#160f12' },
    light: { background: '#fff9f3' },
    hero: { background: 'linear-gradient(135deg,#7a2e46,#3a1220)' },
    menu: { background: '#fdf1f4' },
  }[bg] || {};
  return (
    <div style={{ position: 'relative', width: '100%', height: 220, borderRadius: 12, overflow: 'hidden', ...bgStyle }}>
      <canvas ref={ref} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} aria-hidden="true" />
    </div>
  );
}

function AssetPicker({ assets, onChange }) {
  const ids = assets.map((a) => a.assetId);
  const toggle = (id) => {
    if (ids.includes(id)) onChange(assets.filter((a) => a.assetId !== id));
    else onChange([...assets, { assetId: id, weight: 25 }]);
  };
  const setWeight = (id, w) => onChange(assets.map((a) => (a.assetId === id ? { ...a, weight: w } : a)));
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {EFFECT_ASSET_IDS.map((id) => {
        const a = assets.find((x) => x.assetId === id);
        const on = !!a;
        return (
          <div key={id} style={{ ...row, border: '1px solid var(--line)', borderRadius: 10, padding: '4px 8px', background: on ? 'var(--brand-soft)' : 'transparent' }}>
            <label style={{ ...row, fontSize: 'var(--fs-sm)', cursor: 'pointer' }}>
              <input type="checkbox" checked={on} onChange={() => toggle(id)} />
              {EFFECT_ASSETS[id].label}
            </label>
            {on && num(a.weight, (v) => setWeight(id, v), { w: 46, min: 0 })}
          </div>
        );
      })}
    </div>
  );
}

function PaletteEditor({ colors, onChange }) {
  const set = (i, v) => onChange(colors.map((c, j) => (j === i ? v : c)));
  const add = () => onChange([...colors, '#FFFFFF']);
  const rm = (i) => onChange(colors.filter((_, j) => j !== i));
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      {colors.map((c, i) => (
        <div key={i} style={{ ...row, gap: 4 }}>
          <input type="color" value={c} onChange={(e) => set(i, e.target.value)} style={{ width: 30, height: 26, border: 'none', background: 'none' }} />
          <button className="link" style={{ color: '#c0392b', fontSize: 12 }} onClick={() => rm(i)}>✕</button>
        </div>
      ))}
      <button className="link" onClick={add}>+ Colour</button>
    </div>
  );
}

function Editor({ effect, onChange, seasonalThemes }) {
  const patch = (section, p) => onChange({ ...effect, [section]: { ...effect[section], ...p } });
  const usedBy = (seasonalThemes || []).filter((t) => t.effectsConfig?.effectId === effect.id).map((t) => t.name);
  const rating = perfRating(effect);
  const warnMobile = effect.emission.maxParticlesMobile > 16 || (effect.appearance.sizeMax > 64);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.1fr) minmax(0,1fr)', gap: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={box}>
          <div className="group-title">Name</div>
          <input value={effect.name} onChange={(e) => onChange({ ...effect, name: e.target.value })} style={{ width: '100%', padding: '7px 9px', border: '1px solid var(--line)', borderRadius: 8, fontWeight: 700 }} />
          <textarea value={effect.description || ''} onChange={(e) => onChange({ ...effect, description: e.target.value })} placeholder="Description (admin-only)" rows={2}
            style={{ width: '100%', marginTop: 6, padding: '7px 9px', border: '1px solid var(--line)', borderRadius: 8, fontFamily: 'inherit', fontSize: 'var(--fs-sm)' }} />
          <div style={{ ...row, marginTop: 8, gap: 14, fontSize: 'var(--fs-sm)' }} className="muted">
            <label style={row}><input type="checkbox" checked={effect.enabled !== false} onChange={(e) => onChange({ ...effect, enabled: e.target.checked })} /> Enabled</label>
            <label style={row}><input type="checkbox" checked={!!effect.frontendSelectable} onChange={(e) => onChange({ ...effect, frontendSelectable: e.target.checked })} /> Available to customers</label>
          </div>
          {usedBy.length > 0 && <p className="muted" style={{ fontSize: 'var(--fs-xs)', marginTop: 6 }}>Used by: {usedBy.join(', ')}</p>}
        </div>

        <div style={box}>
          <div className="group-title">SVG assets (weighted)</div>
          <AssetPicker assets={effect.assets} onChange={(a) => onChange({ ...effect, assets: a })} />
        </div>

        <div style={box}>
          <div className="group-title">Motion</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <label style={field}>Direction (°)
              {num(effect.motion.directionDegrees, (v) => patch('motion', { directionDegrees: v }), { min: 0, max: 360 })}
            </label>
            <label style={field}>Speed min/max (px/s)
              <div style={row}>{num(effect.motion.speedMin, (v) => patch('motion', { speedMin: v }))}–{num(effect.motion.speedMax, (v) => patch('motion', { speedMax: v }))}</div>
            </label>
            <label style={field}>Drift min/max
              <div style={row}>{num(effect.motion.driftMin, (v) => patch('motion', { driftMin: v }))}–{num(effect.motion.driftMax, (v) => patch('motion', { driftMax: v }))}</div>
            </label>
            <label style={field}>Sway
              {num(effect.motion.sway, (v) => patch('motion', { sway: v }), { step: 0.1, min: 0, max: 2 })}
            </label>
            <label style={field}>Rotation min/max (°)
              <div style={row}>{num(effect.motion.rotationMin, (v) => patch('motion', { rotationMin: v }))}–{num(effect.motion.rotationMax, (v) => patch('motion', { rotationMax: v }))}</div>
            </label>
            <label style={field}>Rotation speed min/max
              <div style={row}>{num(effect.motion.rotationSpeedMin, (v) => patch('motion', { rotationSpeedMin: v }))}–{num(effect.motion.rotationSpeedMax, (v) => patch('motion', { rotationSpeedMax: v }))}</div>
            </label>
          </div>
          <div style={{ ...row, gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            {[['Down', 180], ['Diagonal left', 220], ['Diagonal right', 140], ['Up', 0], ['Drift', 90]].map(([label, deg]) => (
              <button key={label} type="button" className="link" onClick={() => patch('motion', { directionDegrees: deg })}>{label}</button>
            ))}
          </div>
        </div>

        <div style={box}>
          <div className="group-title">Emission</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <label style={field}>Density
              {num(effect.emission.density, (v) => patch('emission', { density: v }), { step: 0.1, min: 0, max: 3 })}
            </label>
            <label style={field}>Desktop max
              {num(effect.emission.maxParticlesDesktop, (v) => patch('emission', { maxParticlesDesktop: v }), { min: 1, max: 80 })}
            </label>
            <label style={field}>Mobile max
              {num(effect.emission.maxParticlesMobile, (v) => patch('emission', { maxParticlesMobile: v }), { min: 1, max: 40 })}
            </label>
            <label style={field}>Spawn region
              <select value={effect.emission.spawnArea} onChange={(e) => patch('emission', { spawnArea: e.target.value })} style={{ padding: '5px 6px', borderRadius: 8, border: '1px solid var(--line)' }}>
                <option value="top">Top</option><option value="viewport">Viewport</option><option value="edges">Edges</option>
              </select>
            </label>
            <label style={{ ...row, fontSize: 'var(--fs-sm)' }}><input type="checkbox" checked={!!effect.emission.burstOnLoad} onChange={(e) => patch('emission', { burstOnLoad: e.target.checked })} /> Initial burst</label>
            {effect.emission.burstOnLoad && (
              <label style={field}>Burst count
                {num(effect.emission.burstCount, (v) => patch('emission', { burstCount: v }), { min: 0, max: 120 })}
              </label>
            )}
          </div>
          <p style={{ margin: '8px 0 0', fontSize: 'var(--fs-sm)' }} className={rating === 'Heavy' ? '' : 'muted'}>
            Estimated performance: <strong>{rating}</strong>{warnMobile && <span style={{ color: '#c0392b' }}> — may perform poorly on mobile at these settings</span>}
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={box}>
          <div className="group-title">Live preview</div>
          <PreviewTabs effect={effect} />
        </div>

        <div style={box}>
          <div className="group-title">Appearance</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <label style={field}>Size min/max (px)
              <div style={row}>{num(effect.appearance.sizeMin, (v) => patch('appearance', { sizeMin: v }), { min: 4, max: 96 })}–{num(effect.appearance.sizeMax, (v) => patch('appearance', { sizeMax: v }), { min: 4, max: 96 })}</div>
            </label>
            <label style={field}>Opacity min/max
              <div style={row}>{num(effect.appearance.opacityMin, (v) => patch('appearance', { opacityMin: v }), { step: 0.05, min: 0, max: 1 })}–{num(effect.appearance.opacityMax, (v) => patch('appearance', { opacityMax: v }), { step: 0.05, min: 0, max: 1 })}</div>
            </label>
            <label style={field}>Colour mode
              <select value={effect.appearance.colorMode} onChange={(e) => patch('appearance', { colorMode: e.target.value })} style={{ padding: '5px 6px', borderRadius: 8, border: '1px solid var(--line)' }}>
                <option value="single">Single</option><option value="palette">Palette</option><option value="random">Fully random</option>
              </select>
            </label>
            <label style={field}>Fill/stroke mode
              <select value={effect.appearance.renderMode} onChange={(e) => patch('appearance', { renderMode: e.target.value })} style={{ padding: '5px 6px', borderRadius: 8, border: '1px solid var(--line)' }}>
                <option value="fill">Solid fill</option><option value="stroke">Stroke only</option><option value="mixed">Mixed</option><option value="random">Random per particle</option>
              </select>
            </label>
          </div>
          {effect.appearance.colorMode !== 'random' && (
            <div style={{ marginTop: 8 }}>
              <PaletteEditor colors={effect.appearance.colors} onChange={(c) => patch('appearance', { colors: c })} />
            </div>
          )}
          {effect.appearance.renderMode === 'random' && (
            <div style={{ ...row, gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
              <label style={field}>Fill %{num(effect.appearance.fillPercentage, (v) => patch('appearance', { fillPercentage: v }), { min: 0, max: 100 })}</label>
              <label style={field}>Stroke %{num(effect.appearance.strokePercentage, (v) => patch('appearance', { strokePercentage: v }), { min: 0, max: 100 })}</label>
              <label style={field}>Mixed %{num(effect.appearance.mixedPercentage, (v) => patch('appearance', { mixedPercentage: v }), { min: 0, max: 100 })}</label>
            </div>
          )}
        </div>

        <div style={box}>
          <div className="group-title">Outer glow</div>
          <label style={{ ...row, fontSize: 'var(--fs-sm)' }}><input type="checkbox" checked={!!effect.appearance.glowEnabled} onChange={(e) => patch('appearance', { glowEnabled: e.target.checked })} /> Glow enabled</label>
          {effect.appearance.glowEnabled && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 8 }}>
              <label style={field}>Applies to %{num(effect.appearance.glowPercentage, (v) => patch('appearance', { glowPercentage: v }), { min: 0, max: 100 })}</label>
              <label style={field}>Blur min/max
                <div style={row}>{num(effect.appearance.glowBlurMin, (v) => patch('appearance', { glowBlurMin: v }))}–{num(effect.appearance.glowBlurMax, (v) => patch('appearance', { glowBlurMax: v }))}</div>
              </label>
              <label style={field}>Opacity{num(effect.appearance.glowOpacity, (v) => patch('appearance', { glowOpacity: v }), { step: 0.05, min: 0, max: 1 })}</label>
            </div>
          )}
        </div>

        <div style={box}>
          <div className="group-title">Randomness</div>
          <label style={field}>Master amount
            <input type="range" min={0} max={1} step={0.05} value={effect.randomness.amount} onChange={(e) => patch('randomness', { amount: Number(e.target.value) })} />
          </label>
        </div>

        <div style={box}>
          <div className="group-title">Accessibility</div>
          <label style={field}>Reduced-motion behaviour
            <select value={effect.accessibility.reducedMotionMode} onChange={(e) => patch('accessibility', { reducedMotionMode: e.target.value })} style={{ padding: '5px 6px', borderRadius: 8, border: '1px solid var(--line)' }}>
              <option value="off">No effect</option><option value="static-glow">Static glow only</option><option value="reduced">Reduced motion</option>
            </select>
          </label>
        </div>
      </div>
    </div>
  );
}

function PreviewTabs({ effect }) {
  const [bg, setBg] = useState('current');
  const [paused, setPaused] = useState(false);
  const [nonce, setNonce] = useState(0);
  return (
    <div>
      <div style={{ ...row, gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        {[['current', 'Current theme'], ['dark', 'Dark background'], ['light', 'Light background'], ['hero', 'Hero/banner sample'], ['menu', 'Product/menu sample']].map(([k, l]) => (
          <button key={k} type="button" className="link" style={{ fontWeight: bg === k ? 800 : 600 }} onClick={() => setBg(k)}>{l}</button>
        ))}
        <button type="button" className="link" onClick={() => setNonce((n) => n + 1)}>Reset</button>
      </div>
      {!paused && <EffectPreview key={bg + nonce} effect={effect} bg={bg} />}
      {paused && <div style={{ height: 220, borderRadius: 12, background: '#eee', display: 'grid', placeItems: 'center' }} className="muted">Paused</div>}
      <button type="button" className="link" style={{ marginTop: 6 }} onClick={() => setPaused((p) => !p)}>{paused ? '▶ Play' : '❚❚ Pause'}</button>
    </div>
  );
}

export default function EffectBuilder({ effects, seasonalThemes, onChange }) {
  const [editingId, setEditingId] = useState(null);
  const list = effects || [];
  const editing = list.find((e) => e.id === editingId) || null;

  const setList = (arr) => onChange(arr);
  const update = (id, patch) => setList(list.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  const add = () => { const e = newEffect(); setList([...list, e]); setEditingId(e.id); };
  const duplicate = (id) => {
    const src = list.find((e) => e.id === id);
    if (!src) return;
    const copy = { ...src, id: 'eff-custom-' + Date.now().toString(36), name: src.name + ' (copy)', builtIn: false };
    setList([...list, copy]);
    setEditingId(copy.id);
  };
  const remove = (id) => {
    const usedBy = (seasonalThemes || []).filter((t) => t.effectsConfig?.effectId === id).map((t) => t.name);
    if (usedBy.length) {
      if (!window.confirm(`"${list.find((e) => e.id === id)?.name}" is used by: ${usedBy.join(', ')}. Those events will fall back to no effect. Delete anyway?`)) return;
    }
    setList(list.filter((e) => e.id !== id));
    if (editingId === id) setEditingId(null);
  };

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="group-title">Effects</div>
      <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 0 }}>
        Reusable particle overlays. Assign one to a seasonal event above (by name, in that event's Effect dropdown),
        or let customers pick one for any theme from the storefront appearance menu.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {list.map((e) => {
          const usedBy = (seasonalThemes || []).filter((t) => t.effectsConfig?.effectId === e.id);
          return (
            <div key={e.id} style={{ ...row, justifyContent: 'space-between', border: '1px solid var(--line)', borderRadius: 10, padding: '8px 10px', opacity: e.enabled === false ? 0.55 : 1 }}>
              <div style={{ ...row, gap: 10, minWidth: 0 }}>
                <strong style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</strong>
                {e.builtIn && <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>Built-in</span>}
                {e.frontendSelectable && <span style={{ fontSize: 'var(--fs-xs)', color: '#2e7d4f' }}>Customer-selectable</span>}
                {usedBy.length > 0 && <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>· used by {usedBy.map((t) => t.name).join(', ')}</span>}
              </div>
              <div style={{ ...row, gap: 6, flex: 'none' }}>
                <label style={{ ...row, fontSize: 'var(--fs-xs)' }} className="muted"><input type="checkbox" checked={e.enabled !== false} onChange={(ev) => update(e.id, { enabled: ev.target.checked })} /> On</label>
                <button className="link" onClick={() => setEditingId(editingId === e.id ? null : e.id)}>{editingId === e.id ? 'Close' : 'Edit'}</button>
                <button className="link" onClick={() => duplicate(e.id)}>Duplicate</button>
                <button className="link" style={{ color: '#c0392b' }} onClick={() => remove(e.id)}>Delete</button>
              </div>
            </div>
          );
        })}
      </div>
      <button className="btn ghost full" style={{ marginTop: 10 }} onClick={add}>+ New effect</button>

      {editing && (
        <div style={{ marginTop: 16, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
          <Editor effect={editing} onChange={(patch) => update(editing.id, patch)} seasonalThemes={seasonalThemes} />
        </div>
      )}
    </div>
  );
}
