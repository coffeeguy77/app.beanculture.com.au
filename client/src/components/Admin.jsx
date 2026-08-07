import React, { useEffect, useState } from 'react';
import { ICONS } from './icons.jsx';

const ICON_NAMES = ['cup', 'mug', 'burger', 'bag', 'smoothie', 'can', 'bean', 'ice', 'shake', 'tea', 'drink'];
const LINK_TYPES = ['scroll', 'category', 'account', 'none'];

export default function Admin({ onExit }) {
  const [pass, setPass] = useState('');
  const [needPass, setNeedPass] = useState(false);
  const [data, setData] = useState(null);
  const [s, setS] = useState(null); // editable settings
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [syncMsg, setSyncMsg] = useState('');

  async function load(p) {
    setError('');
    try {
      const res = await fetch(`/api/admin/overview?pass=${encodeURIComponent(p || '')}`);
      if (res.status === 401) { setNeedPass(true); return; }
      const d = await res.json();
      setData(d);
      setS(JSON.parse(JSON.stringify(d.settings)));
      setNeedPass(false);
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(''); }, []);

  const cats = (data?.categories || []).map((c) => c.name);

  // ---- generic setters ----
  const set = (patch) => setS((cur) => ({ ...cur, ...patch }));
  const setTheme = (k, v) => setS((cur) => ({ ...cur, theme: { ...cur.theme, [k]: v } }));

  // ---- footer builder ----
  const footer = s?.footer || [];
  const setFooter = (arr) => set({ footer: arr });
  const addSlot = () => setFooter([...footer, { label: 'New', icon: 'cup', categories: [] }]);
  const updSlot = (i, patch) => setFooter(footer.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const rmSlot = (i) => setFooter(footer.filter((_, j) => j !== i));
  const moveSlot = (i, d) => {
    const j = i + d; if (j < 0 || j >= footer.length) return;
    const a = [...footer]; [a[i], a[j]] = [a[j], a[i]]; setFooter(a);
  };
  const toggleSlotCat = (i, cat) => {
    const slot = footer[i];
    const has = slot.categories.some((c) => c.toLowerCase() === cat.toLowerCase());
    updSlot(i, { categories: has ? slot.categories.filter((c) => c.toLowerCase() !== cat.toLowerCase()) : [...slot.categories, cat] });
  };

  // ---- hero / banners ----
  const hero = s?.hero || [];
  const setHero = (arr) => set({ hero: arr });
  const addSlide = () => setHero([...hero, { id: 'slide' + (hero.length + 1), title: '', subtitle: '', cta: '', bg: 'linear-gradient(135deg,#f7c9d6,#d1547a)', textColor: '#ffffff', link: { type: 'scroll', value: '' } }]);
  const updSlide = (i, patch) => setHero(hero.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const rmSlide = (i) => setHero(hero.filter((_, j) => j !== i));
  const moveSlide = (i, d) => { const j = i + d; if (j < 0 || j >= hero.length) return; const a = [...hero]; [a[i], a[j]] = [a[j], a[i]]; setHero(a); };

  function uploadImage(file, cb) {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const r = await fetch(`/api/admin/upload?pass=${encodeURIComponent(pass)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataUri: reader.result, folder: 'banners' }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Upload failed');
        cb(d.url);
      } catch (e) { alert('Upload failed: ' + e.message); }
    };
    reader.readAsDataURL(file);
  }

  async function syncNow() {
    setSyncMsg('Syncing…');
    try { const r = await fetch(`/api/admin/sync?pass=${encodeURIComponent(pass)}`, { method: 'POST' }); setSyncMsg(r.ok ? 'Menu re-synced from Square.' : 'Sync failed.'); }
    catch { setSyncMsg('Sync failed.'); }
    setTimeout(() => setSyncMsg(''), 3500);
  }

  async function save() {
    setSaving(true); setSavedMsg('');
    try {
      const r = await fetch(`/api/admin/settings?pass=${encodeURIComponent(pass)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: s }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Save failed');
      setSavedMsg('Saved — live now.');
    } catch (e) { setSavedMsg('Save failed: ' + e.message); }
    finally { setSaving(false); setTimeout(() => setSavedMsg(''), 5000); }
  }

  if (needPass) {
    return (
      <div className="app"><main className="page">
        <h2>Control panel</h2>
        <label className="field"><span>Passcode</span><input type="password" value={pass} onChange={(e) => setPass(e.target.value)} /></label>
        <button className="btn full" style={{ marginTop: 12 }} onClick={() => load(pass)}>Enter</button>
        {error && <p className="error-text">{error}</p>}
        <button className="link center-link" onClick={onExit}>← Back to store</button>
      </main></div>
    );
  }
  if (!s) return <div className="app"><div className="center-screen"><div className="spinner" /></div></div>;

  const h = data.hours || {};
  const card = { marginBottom: 14 };
  const row = { display: 'flex', gap: 8, alignItems: 'center' };

  return (
    <div className="app"><main className="page" style={{ paddingBottom: 90 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button className="link" onClick={onExit}>← Store</button>
        {!data.dbEnabled && <span className="muted" style={{ fontSize: 11 }}>⚠ DB off — changes won’t persist</span>}
      </div>
      <h2>Control panel</h2>

      {/* Status + tools */}
      <div className="card" style={card}>
        <div style={{ fontWeight: 800, color: h.open ? '#2e7d51' : 'var(--brand)' }}>{h.open ? '● Open now' : '● Closed'}</div>
        <div className="muted" style={{ fontSize: 12 }}>{h.timezone} · {h.hasHours ? 'hours from Square' : 'no hours set in Square'}</div>
        <button className="btn full" style={{ marginTop: 12 }} onClick={syncNow}>Sync menu from Square now</button>
        {syncMsg && <p className="muted" style={{ fontSize: 13, margin: '6px 0 0' }}>{syncMsg}</p>}
      </div>

      {/* Store basics */}
      <div className="card" style={card}>
        <div className="group-title">Store</div>
        <label className="field"><span>Store name</span><input value={s.storeName || ''} onChange={(e) => set({ storeName: e.target.value })} /></label>
        <label className="field" style={{ marginTop: 10 }}><span>Announcement bar (blank = hidden)</span>
          <input value={s.announcement || ''} onChange={(e) => set({ announcement: e.target.value })} placeholder="e.g. Public holiday hours today" /></label>
      </div>

      {/* Layout */}
      <div className="card" style={card}>
        <div className="group-title">Menu layout</div>
        <label style={{ ...row, marginBottom: 6 }}><input type="radio" checked={s.layoutMode !== 'single'} onChange={() => set({ layoutMode: 'onepage' })} /> One page (all categories scroll)</label>
        <label style={row}><input type="radio" checked={s.layoutMode === 'single'} onChange={() => set({ layoutMode: 'single' })} /> Single category (one at a time)</label>
      </div>

      {/* Footer / menu builder */}
      <div className="card" style={card}>
        <div className="group-title">Footer menu builder</div>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>Each button = an icon + one or more categories.</p>
        {footer.map((slot, i) => {
          const Icon = ICONS[slot.icon] || ICONS.cup;
          return (
            <div key={i} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 10, marginBottom: 10 }}>
              <div style={{ ...row, justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--brand)', display: 'flex', alignItems: 'center', gap: 6 }}><Icon size={26} /></span>
                <div style={row}>
                  <button className="link" onClick={() => moveSlot(i, -1)}>↑</button>
                  <button className="link" onClick={() => moveSlot(i, 1)}>↓</button>
                  <button className="link" style={{ color: '#c0392b' }} onClick={() => rmSlot(i)}>Remove</button>
                </div>
              </div>
              <div style={{ ...row, marginTop: 6 }}>
                <input value={slot.label || ''} onChange={(e) => updSlot(i, { label: e.target.value })} placeholder="Label"
                  style={{ flex: 1, padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 10 }} />
                <select value={slot.icon} onChange={(e) => updSlot(i, { icon: e.target.value })} style={{ padding: '8px', borderRadius: 10, border: '1px solid var(--line)' }}>
                  {ICON_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {cats.map((c) => {
                  const on = slot.categories.some((x) => x.toLowerCase() === c.toLowerCase());
                  return <button key={c} onClick={() => toggleSlotCat(i, c)} className={`chip ${on ? 'on' : ''}`} style={{ fontSize: 11, padding: '5px 9px' }}>{c}</button>;
                })}
              </div>
            </div>
          );
        })}
        <button className="btn ghost full" onClick={addSlot}>+ Add footer button</button>
      </div>

      {/* Banners */}
      <div className="card" style={card}>
        <div className="group-title">Banners (hero carousel)</div>
        {!data.cloudinary && <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>Add Cloudinary keys in Railway to enable image upload; you can still paste a URL.</p>}
        {hero.map((sl, i) => (
          <div key={i} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 10, marginBottom: 10 }}>
            <div style={{ height: 70, borderRadius: 8, marginBottom: 8, background: sl.bg, backgroundSize: 'cover', backgroundPosition: 'center', display: 'flex', alignItems: 'flex-end', padding: 8, color: sl.textColor || '#fff' }}>
              <strong>{sl.title || '(no title)'}</strong>
            </div>
            <div style={{ ...row, justifyContent: 'flex-end', marginBottom: 6 }}>
              <button className="link" onClick={() => moveSlide(i, -1)}>↑</button>
              <button className="link" onClick={() => moveSlide(i, 1)}>↓</button>
              <button className="link" style={{ color: '#c0392b' }} onClick={() => rmSlide(i)}>Remove</button>
            </div>
            <input style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 10, marginBottom: 6 }} value={sl.title || ''} onChange={(e) => updSlide(i, { title: e.target.value })} placeholder="Title" />
            <input style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 10, marginBottom: 6 }} value={sl.subtitle || ''} onChange={(e) => updSlide(i, { subtitle: e.target.value })} placeholder="Subtitle" />
            <input style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 10, marginBottom: 6 }} value={sl.cta || ''} onChange={(e) => updSlide(i, { cta: e.target.value })} placeholder="Button text (optional)" />
            <div style={{ ...row, marginBottom: 6 }}>
              <select value={sl.link?.type || 'scroll'} onChange={(e) => updSlide(i, { link: { ...sl.link, type: e.target.value } })} style={{ padding: 8, borderRadius: 10, border: '1px solid var(--line)' }}>
                {LINK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              {sl.link?.type === 'category' && (
                <select value={sl.link?.value || ''} onChange={(e) => updSlide(i, { link: { ...sl.link, value: e.target.value } })} style={{ flex: 1, padding: 8, borderRadius: 10, border: '1px solid var(--line)' }}>
                  <option value="">— category —</option>
                  {cats.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              )}
            </div>
            <div style={row}>
              <label className="btn ghost" style={{ padding: '8px 12px', fontSize: 13, cursor: 'pointer' }}>
                Upload image
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files[0]; if (f) uploadImage(f, (url) => updSlide(i, { bg: `url(${url}) center/cover`, image: url })); }} />
              </label>
              <input style={{ flex: 1, padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 10, fontSize: 11 }} value={sl.bg || ''} onChange={(e) => updSlide(i, { bg: e.target.value })} placeholder="background (gradient or url(...) center/cover)" />
            </div>
          </div>
        ))}
        <button className="btn ghost full" onClick={addSlide}>+ Add banner</button>
      </div>

      {/* Theme default */}
      <div className="card" style={card}>
        <div className="group-title">Default theme</div>
        {['brand', 'accent', 'bg', 'ink'].map((k) => (
          <div key={k} style={{ ...row, justifyContent: 'space-between', padding: '6px 0', borderTop: '1px solid var(--line)' }}>
            <span style={{ textTransform: 'capitalize' }}>{k === 'bg' ? 'Background' : k === 'ink' ? 'Text' : k}</span>
            <input type="color" value={(s.theme && s.theme[k]) || '#000000'} onChange={(e) => setTheme(k, e.target.value)} style={{ width: 44, height: 32, border: 'none', background: 'none' }} />
          </div>
        ))}
      </div>

      {/* Sticky save bar */}
      <div style={{ position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: 0, width: '100%', maxWidth: 'var(--app-w)', padding: 12, background: 'var(--surface)', borderTop: '1px solid var(--line)', display: 'flex', gap: 10, alignItems: 'center' }}>
        <span className="muted" style={{ fontSize: 12, flex: 1 }}>{savedMsg}</span>
        <button className="btn" style={{ minWidth: 140 }} disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save changes'}</button>
      </div>
    </main></div>
  );
}
