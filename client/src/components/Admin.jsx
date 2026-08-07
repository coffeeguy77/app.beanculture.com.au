import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { SlotIcon } from './icons.jsx';
import IconPicker from './IconPicker.jsx';
import { formatMoney } from '../api.js';

const LINK_TYPES = ['scroll', 'category', 'account', 'url', 'none'];

function TopRow({ name, n, max }) {
  return (
    <div className="top-row">
      <div className="top-top"><span className="top-name">{name}</span><span className="muted">{n}</span></div>
      <div className="top-track"><div className="top-fill" style={{ width: `${Math.round((n / (max || 1)) * 100)}%` }} /></div>
    </div>
  );
}

// ---- Tab icons (stroke) ----
const svg = (paths) => (p) => (
  <svg width={p.size || 20} height={p.size || 20} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths}</svg>
);
const StoreIcon = svg(<>
  <path d="M3 9l1.5-5h15L21 9" /><path d="M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9" />
  <path d="M3 9a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0" /><path d="M9 20v-5h6v5" />
</>);
const MenuIcon = svg(<>
  <line x1="9" y1="6" x2="20" y2="6" /><line x1="9" y1="12" x2="20" y2="12" /><line x1="9" y1="18" x2="20" y2="18" />
  <circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" />
</>);
const BannerIcon = svg(<>
  <rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8.5" cy="10" r="1.5" /><path d="M21 16l-5-5-9 8" />
</>);
const QrIcon = svg(<>
  <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" />
  <path d="M14 14h3v3M21 14v3M14 21h3M21 18v3" />
</>);
const ThemeIcon2 = svg(<>
  <path d="M12 3a9 9 0 1 0 0 18c1 0 1.6-.9 1.2-1.8-.5-1 .2-2.2 1.4-2.2H16a5 5 0 0 0 5-5c0-4.4-4-8-9-8z" />
  <circle cx="7.5" cy="11" r="1" /><circle cx="10.5" cy="7.5" r="1" /><circle cx="15" cy="8" r="1" />
</>);
const InsightsIcon = svg(<>
  <path d="M4 20V11" /><path d="M10 20V4" /><path d="M16 20v-6" /><path d="M3 20h18" />
</>);

const TABS = [
  { id: 'store', label: 'Store', Icon: StoreIcon },
  { id: 'insights', label: 'Insights', Icon: InsightsIcon },
  { id: 'menu', label: 'Menu', Icon: MenuIcon },
  { id: 'banners', label: 'Banners', Icon: BannerIcon },
  { id: 'tables', label: 'Tables', Icon: QrIcon },
  { id: 'theme', label: 'Theme', Icon: ThemeIcon2 },
];

export default function Admin({ onExit }) {
  const [pass, setPass] = useState('');
  const [needPass, setNeedPass] = useState(false);
  const [data, setData] = useState(null);
  const [s, setS] = useState(null); // editable settings
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [syncMsg, setSyncMsg] = useState('');
  const [adminCat, setAdminCat] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [tab, setTab] = useState('store');
  const [qrFrom, setQrFrom] = useState(1);
  const [qrTo, setQrTo] = useState(12);
  const [qrCodes, setQrCodes] = useState([]);
  const [qrBusy, setQrBusy] = useState(false);
  const [qrFg, setQrFg] = useState('#2b2126');
  const [qrBg, setQrBg] = useState('#ffffff');
  const [qrSize, setQrSize] = useState(190);
  const [analytics, setAnalytics] = useState(null);
  const [aDays, setADays] = useState(30);
  const [newClosure, setNewClosure] = useState({ date: '', annual: false, label: '' });
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  // Load analytics when the Insights tab is opened / period changes.
  useEffect(() => {
    if (tab !== 'insights') return;
    setAnalytics(null);
    fetch(`/api/admin/analytics?days=${aDays}&pass=${encodeURIComponent(pass)}`)
      .then((r) => r.json()).then((d) => setAnalytics(d.analytics || { empty: true })).catch(() => setAnalytics({ error: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, aDays]);

  async function generateQR() {
    setQrBusy(true);
    try {
      const from = Math.max(1, parseInt(qrFrom, 10) || 1);
      const to = Math.max(from, parseInt(qrTo, 10) || from);
      const nums = [];
      for (let n = from; n <= to && nums.length < 200; n++) nums.push(n);
      const codes = await Promise.all(
        nums.map(async (n) => {
          const url = `${origin}/?table=${n}`;
          const img = await QRCode.toDataURL(url, {
            margin: 1, width: 512, errorCorrectionLevel: 'M',
            color: { dark: qrFg, light: qrBg },
          });
          return { n, url, img };
        })
      );
      setQrCodes(codes);
    } catch (e) {
      alert('QR generation failed: ' + e.message);
    } finally {
      setQrBusy(false);
    }
  }
  // Re-bake existing codes when the colours change.
  useEffect(() => {
    if (qrCodes.length) generateQR();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrFg, qrBg]);

  async function load(p) {
    setError('');
    try {
      const res = await fetch(`/api/admin/overview?pass=${encodeURIComponent(p || '')}`);
      if (res.status === 401) { setNeedPass(true); return; }
      const d = await res.json();
      setData(d);
      setS(JSON.parse(JSON.stringify(d.settings)));
      setNeedPass(false);
      try {
        const cr = await fetch(`/api/admin/catalog?pass=${encodeURIComponent(p || '')}`);
        if (cr.ok) { const cd = await cr.json(); setAdminCat(cd.categories || []); }
      } catch {}
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(''); }, []);

  const cats = (data?.categories || []).map((c) => c.name);

  // ---- generic setters ----
  const set = (patch) => setS((cur) => ({ ...cur, ...patch }));
  const setTheme = (k, v) => setS((cur) => ({ ...cur, theme: { ...cur.theme, [k]: v } }));
  const setContact = (k, v) => setS((cur) => ({ ...cur, contact: { ...(cur.contact || {}), [k]: v } }));

  // ---- closures ----
  const closures = s?.closures || [];
  const addClosure = () => {
    if (!newClosure.date) return;
    set({ closures: [...closures, { ...newClosure }].sort((a, b) => String(a.date).localeCompare(String(b.date))) });
    setNewClosure({ date: '', annual: false, label: '' });
  };
  const rmClosure = (i) => set({ closures: closures.filter((_, j) => j !== i) });

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

  // ---- menu items offered (category / item chooser) ----
  const ms = s?.menuSelection || {};
  const setMS = (cat, patch) =>
    setS((cur) => {
      const prev = (cur.menuSelection || {})[cat] || { enabled: true, items: null };
      return { ...cur, menuSelection: { ...(cur.menuSelection || {}), [cat]: { ...prev, ...patch } } };
    });
  const catEnabled = (cat) => (ms[cat]?.enabled ?? true);
  const showImages = (cat) => (ms[cat]?.showImages ?? true);
  const itemOffered = (cat, id) => {
    const sel = ms[cat];
    if (!sel || sel.items == null) return true;
    return sel.items.includes(id);
  };
  const setCatEnabled = (cat, on) => setMS(cat, { enabled: on });
  const setAllItems = (cat, allIds, on) => setMS(cat, { enabled: true, items: on ? null : [] });
  const toggleItem = (cat, id, allIds) => {
    const sel = ms[cat];
    let cur = sel && sel.items != null ? [...sel.items] : [...allIds];
    cur = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    const items = allIds.length && cur.length === allIds.length ? null : cur;
    setMS(cat, { enabled: true, items });
  };
  const offeredCount = (cat, allIds) => {
    const sel = ms[cat];
    if (!sel || sel.items == null) return allIds.length;
    return sel.items.filter((id) => allIds.includes(id)).length;
  };

  // ---- hero / banners ----
  const hero = s?.hero || [];
  const setHero = (arr) => set({ hero: arr });
  const addSlide = () => setHero([...hero, { id: 'slide' + (hero.length + 1), title: '', subtitle: '', cta: '', bg: 'linear-gradient(135deg,#f7c9d6,#d1547a)', textColor: '#ffffff', link: { type: 'scroll', value: '' } }]);
  const updSlide = (i, patch) => setHero(hero.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const rmSlide = (i) => setHero(hero.filter((_, j) => j !== i));
  const moveSlide = (i, d) => { const j = i + d; if (j < 0 || j >= hero.length) return; const a = [...hero]; [a[i], a[j]] = [a[j], a[i]]; setHero(a); };

  function uploadImage(file, cb, folder = 'banners') {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const r = await fetch(`/api/admin/upload?pass=${encodeURIComponent(pass)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataUri: reader.result, folder }),
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
    <div className="admin-root">
      <div className="admin-shell">
        <div className="admin-head">
          <button className="link" onClick={onExit}>← Store</button>
          <h2 style={{ margin: 0, fontFamily: 'Georgia, serif' }}>Control panel</h2>
          {!data.dbEnabled
            ? <span className="muted" style={{ fontSize: 11 }}>⚠ DB off — changes won’t persist</span>
            : <span style={{ width: 60 }} />}
        </div>

        <div className="admin-layout">
          <nav className="admin-tabs">
            {TABS.map((t) => (
              <button key={t.id} className={`admin-tab ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)} type="button">
                <t.Icon size={20} /><span>{t.label}</span>
              </button>
            ))}
          </nav>

          <div className="admin-panel">
            {/* ───────── STORE ───────── */}
            {tab === 'store' && (
              <>
                <div className="card" style={card}>
                  <div style={{ fontWeight: 800, color: h.open ? '#2e7d51' : 'var(--brand)' }}>{h.open ? '● Open now' : '● Closed'}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{h.timezone} · {h.hasHours ? 'hours from Square' : 'no hours set in Square'}</div>
                  <button className="btn full" style={{ marginTop: 12 }} onClick={syncNow}>Sync menu from Square now</button>
                  {syncMsg && <p className="muted" style={{ fontSize: 13, margin: '6px 0 0' }}>{syncMsg}</p>}
                </div>
                <div className="card" style={card}>
                  <div className="group-title">Store details</div>
                  <label className="field"><span>Store name</span><input value={s.storeName || ''} onChange={(e) => set({ storeName: e.target.value })} /></label>
                  <label className="field" style={{ marginTop: 10 }}><span>Announcement bar (blank = hidden)</span>
                    <input value={s.announcement || ''} onChange={(e) => set({ announcement: e.target.value })} placeholder="e.g. Public holiday hours today" /></label>
                </div>

                <div className="card" style={card}>
                  <div className="group-title">Contact &amp; location</div>
                  <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>Shown on the storefront with tap-to-call and directions (both tracked in Insights).</p>
                  <label className="field"><span>Address</span><input value={s.contact?.address || ''} onChange={(e) => setContact('address', e.target.value)} placeholder="123 Main St, Suburb NSW" /></label>
                  <label className="field" style={{ marginTop: 10 }}><span>Phone</span><input value={s.contact?.phone || ''} onChange={(e) => setContact('phone', e.target.value)} placeholder="+61 2 1234 5678" /></label>
                  <label className="field" style={{ marginTop: 10 }}><span>Map link (optional — built from the address if blank)</span><input value={s.contact?.mapsUrl || ''} onChange={(e) => setContact('mapsUrl', e.target.value)} placeholder="https://maps.google.com/…" /></label>
                </div>

                <div className="card" style={card}>
                  <div className="group-title">Branding</div>
                  {!data.cloudinary && <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>Add Cloudinary keys in Railway to upload images.</p>}
                  <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                    <div>
                      <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Logo (header)</div>
                      <div style={{ ...row }}>
                        {s.logoUrl ? <img src={s.logoUrl} alt="" style={{ height: 34, background: '#f6eef1', borderRadius: 6 }} /> : <span className="muted" style={{ fontSize: 12 }}>Default</span>}
                        <label className="btn ghost" style={{ padding: '8px 12px', fontSize: 13, cursor: 'pointer' }}>Upload<input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files[0]; if (f) uploadImage(f, (url) => set({ logoUrl: url }), 'logo'); }} /></label>
                        {s.logoUrl && <button className="link" style={{ color: '#c0392b' }} onClick={() => set({ logoUrl: '' })}>Reset</button>}
                      </div>
                    </div>
                    <div>
                      <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Favicon (browser tab)</div>
                      <div style={{ ...row }}>
                        {s.faviconUrl ? <img src={s.faviconUrl} alt="" style={{ height: 28, width: 28, borderRadius: 6 }} /> : <span className="muted" style={{ fontSize: 12 }}>Default</span>}
                        <label className="btn ghost" style={{ padding: '8px 12px', fontSize: 13, cursor: 'pointer' }}>Upload<input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files[0]; if (f) uploadImage(f, (url) => set({ faviconUrl: url }), 'favicon'); }} /></label>
                        {s.faviconUrl && <button className="link" style={{ color: '#c0392b' }} onClick={() => set({ faviconUrl: '' })}>Reset</button>}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="card" style={card}>
                  <div className="group-title">Closed dates</div>
                  <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>Annual leave, public holidays. Closed days can’t be booked for pre-orders. Tick “every year” for dates that recur (e.g. Christmas).</p>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <label className="field" style={{ flex: '1 1 130px' }}><span>Date</span><input type="date" value={newClosure.date} onChange={(e) => setNewClosure((c) => ({ ...c, date: e.target.value }))} /></label>
                    <label className="field" style={{ flex: '2 1 150px' }}><span>Label</span><input value={newClosure.label} onChange={(e) => setNewClosure((c) => ({ ...c, label: e.target.value }))} placeholder="e.g. Christmas Day" /></label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, paddingBottom: 12, whiteSpace: 'nowrap' }}><input type="checkbox" checked={newClosure.annual} onChange={(e) => setNewClosure((c) => ({ ...c, annual: e.target.checked }))} /> Every year</label>
                    <button className="btn" onClick={addClosure}>Add</button>
                  </div>
                  {closures.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      {closures.map((c, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderTop: '1px solid var(--line)' }}>
                          <span>{c.date}{c.annual ? ' · every year' : ''}{c.label ? ` · ${c.label}` : ''}</span>
                          <button className="link" style={{ color: '#c0392b' }} onClick={() => rmClosure(i)}>Remove</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* ───────── INSIGHTS ───────── */}
            {tab === 'insights' && (
              <>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
                  <span className="muted" style={{ fontSize: 13 }}>Last</span>
                  {[7, 30, 90].map((d) => <button key={d} className={`chip ${aDays === d ? 'on' : ''}`} onClick={() => setADays(d)}>{d} days</button>)}
                </div>
                {!analytics && <div className="card" style={{ ...card, textAlign: 'center' }}><div className="spinner" /></div>}
                {analytics && (analytics.error || analytics.empty) && <div className="card" style={card}><p className="muted" style={{ margin: 0 }}>No analytics yet — data appears as customers use the app.</p></div>}
                {analytics && !analytics.error && !analytics.empty && (() => {
                  const t = analytics.totals || {};
                  const conv = t.visitors ? Math.round((t.purchases / t.visitors) * 100) : 0;
                  const tiles = [
                    { label: 'Visitors', v: t.visitors },
                    { label: 'Product views', v: t.productViews },
                    { label: 'Orders', v: t.purchases },
                    { label: 'Conversion', v: `${conv}%` },
                    { label: 'Revenue', v: formatMoney(t.revenue, 'AUD') },
                    { label: 'Contact taps', v: t.contactClicks },
                  ];
                  const funnel = [
                    { label: 'Visitors', v: t.visitors },
                    { label: 'Viewed a product', v: t.productViews },
                    { label: 'Added to cart', v: t.addCart },
                    { label: 'Reached checkout', v: t.checkouts },
                    { label: 'Ordered', v: t.purchases },
                  ];
                  const daily = analytics.daily || [];
                  const maxDaily = Math.max(1, ...daily.map((d) => Math.max(d.views, d.purchases)));
                  return (
                    <>
                      <div className="stat-tiles">
                        {tiles.map((x) => <div key={x.label} className="stat-tile"><div className="stat-v">{x.v}</div><div className="stat-l">{x.label}</div></div>)}
                      </div>
                      <div className="card" style={card}>
                        <div className="group-title">Daily visits &amp; orders</div>
                        <div className="chart-bars">
                          {daily.length === 0 && <span className="muted" style={{ fontSize: 12 }}>No data yet.</span>}
                          {daily.slice(-30).map((d, i) => (
                            <div key={i} className="chart-col" title={`${d.day}: ${d.views} visits, ${d.purchases} orders`}>
                              <div className="bar bar-views" style={{ height: `${(d.views / maxDaily) * 100}%` }} />
                              <div className="bar bar-buys" style={{ height: `${(d.purchases / maxDaily) * 100}%` }} />
                            </div>
                          ))}
                        </div>
                        <div className="chart-legend"><span><i className="sw sw-views" /> Visits</span><span><i className="sw sw-buys" /> Orders</span></div>
                      </div>
                      <div className="card" style={card}>
                        <div className="group-title">Checkout funnel</div>
                        {funnel.map((f) => {
                          const pct = t.visitors ? Math.round((f.v / t.visitors) * 100) : 0;
                          return (
                            <div key={f.label} className="funnel-row">
                              <div className="funnel-top"><span>{f.label}</span><span className="muted">{f.v} · {pct}%</span></div>
                              <div className="funnel-track"><div className="funnel-fill" style={{ width: `${pct}%` }} /></div>
                            </div>
                          );
                        })}
                      </div>
                      <div className="ins-two">
                        <div className="card" style={card}>
                          <div className="group-title">Most viewed</div>
                          {(analytics.topViewed || []).length === 0 && <p className="muted" style={{ fontSize: 12 }}>No data yet.</p>}
                          {(analytics.topViewed || []).map((p) => <TopRow key={p.name} name={p.name} n={p.n} max={analytics.topViewed[0]?.n || 1} />)}
                        </div>
                        <div className="card" style={card}>
                          <div className="group-title">Most purchased</div>
                          {(analytics.topPurchased || []).length === 0 && <p className="muted" style={{ fontSize: 12 }}>No data yet.</p>}
                          {(analytics.topPurchased || []).map((p) => <TopRow key={p.name} name={p.name} n={p.n} max={analytics.topPurchased[0]?.n || 1} />)}
                        </div>
                      </div>
                    </>
                  );
                })()}
              </>
            )}

            {/* ───────── MENU ───────── */}
            {tab === 'menu' && (
              <>
                <div className="card" style={card}>
                  <div className="group-title">Menu layout</div>
                  <label style={{ ...row, marginBottom: 6 }}><input type="radio" checked={s.layoutMode !== 'single'} onChange={() => set({ layoutMode: 'onepage' })} /> One page (all categories scroll)</label>
                  <label style={row}><input type="radio" checked={s.layoutMode === 'single'} onChange={() => set({ layoutMode: 'single' })} /> Single category (one at a time)</label>
                </div>

                <div className="card" style={card}>
                  <div className="group-title">Footer menu builder</div>
                  <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>Each button = an icon + one or more categories.</p>
                  {footer.map((slot, i) => (
                    <div key={i} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 10, marginBottom: 10 }}>
                      <div style={{ ...row, gap: 10 }}>
                        <IconPicker value={{ icon: slot.icon, iconSvg: slot.iconSvg }} brand={s.theme?.brand} onChange={(v) => updSlot(i, v)} />
                        <input value={slot.label || ''} onChange={(e) => updSlot(i, { label: e.target.value })} placeholder="Label"
                          style={{ flex: 1, minWidth: 0, padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 10 }} />
                        <div style={row}>
                          <button className="link" onClick={() => moveSlot(i, -1)}>↑</button>
                          <button className="link" onClick={() => moveSlot(i, 1)}>↓</button>
                          <button className="link" style={{ color: '#c0392b' }} onClick={() => rmSlot(i)}>✕</button>
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                        {cats.map((c) => {
                          const on = slot.categories.some((x) => x.toLowerCase() === c.toLowerCase());
                          return <button key={c} onClick={() => toggleSlotCat(i, c)} className={`chip ${on ? 'on' : ''}`} style={{ fontSize: 11, padding: '5px 9px' }}>{c}</button>;
                        })}
                      </div>
                    </div>
                  ))}
                  <button className="btn ghost full" onClick={addSlot}>+ Add footer button</button>
                </div>

                <div className="card" style={card}>
                  <div className="group-title">Menu items offered</div>
                  <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
                    Tick a category to offer it in the app. Expand to offer the whole category or only certain items —
                    smarter for app ordering &amp; delivery.
                  </p>
                  {adminCat.length === 0 && <p className="muted" style={{ fontSize: 12 }}>Loading catalog…</p>}
                  {adminCat.map((c) => {
                    const allIds = c.items.map((i) => i.id);
                    const on = catEnabled(c.category);
                    const isOpen = !!expanded[c.category];
                    const nOffered = offeredCount(c.category, allIds);
                    const partial = on && ms[c.category]?.items != null;
                    return (
                      <div key={c.category} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 10, marginBottom: 10, opacity: on ? 1 : 0.55 }}>
                        <div style={{ ...row, justifyContent: 'space-between' }}>
                          <label style={{ ...row, cursor: 'pointer', flex: 1 }}>
                            <input type="checkbox" checked={on} onChange={(e) => setCatEnabled(c.category, e.target.checked)} />
                            <span style={{ fontWeight: 700 }}>{c.category}</span>
                            <span className="muted" style={{ fontSize: 12 }}>
                              {partial ? `${nOffered}/${c.items.length} items` : `all ${c.items.length}`}
                            </span>
                          </label>
                          <label style={{ ...row, cursor: 'pointer', fontSize: 12 }} className="muted" title="Show product images for this category">
                            <input type="checkbox" checked={showImages(c.category)} disabled={!on}
                              onChange={(e) => setMS(c.category, { showImages: e.target.checked })} />
                            <span>Images</span>
                          </label>
                          <button className="link" onClick={() => setExpanded((x) => ({ ...x, [c.category]: !isOpen }))}>
                            {isOpen ? '▲' : '▼'}
                          </button>
                        </div>
                        {isOpen && (
                          <div style={{ marginTop: 8, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
                            <div style={{ ...row, gap: 8, marginBottom: 8 }}>
                              <button className="link" onClick={() => setAllItems(c.category, allIds, true)}>Offer all</button>
                              <span className="muted">·</span>
                              <button className="link" onClick={() => setAllItems(c.category, allIds, false)}>Offer none</button>
                            </div>
                            <div className="admin-itemgrid">
                              {c.items.map((it) => (
                                <label key={it.id} style={{ ...row, cursor: 'pointer', padding: '4px 0' }}>
                                  <input type="checkbox" checked={itemOffered(c.category, it.id)} disabled={!on}
                                    onChange={() => toggleItem(c.category, it.id, allIds)} />
                                  <span style={{ fontSize: 14 }}>{it.name}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* ───────── BANNERS ───────── */}
            {tab === 'banners' && (
              <div className="card" style={card}>
                <div className="group-title">Banners (hero carousel)</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', margin: '2px 0 12px', paddingBottom: 12, borderBottom: '1px solid var(--line)' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input type="checkbox" checked={s.heroAutoplay !== false} onChange={(e) => set({ heroAutoplay: e.target.checked })} />
                    <span>Auto-scroll banners</span>
                  </label>
                  {s.heroAutoplay !== false && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 180px', minWidth: 160 }}>
                      <span className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>Every {Number(s.heroInterval) || 5}s</span>
                      <input type="range" min="2" max="15" step="1" value={Number(s.heroInterval) || 5}
                        onChange={(e) => set({ heroInterval: Number(e.target.value) })} style={{ flex: 1 }} />
                    </label>
                  )}
                </div>
                {!data.cloudinary && <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>Add Cloudinary keys in Railway to enable image upload; you can still paste a URL.</p>}
                <div className="admin-bannergrid">
                  {hero.map((sl, i) => (
                    <div key={i} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 10 }}>
                      {(() => {
                        const img = sl.image || (typeof sl.bg === 'string' && (sl.bg.match(/url\((['"]?)(.*?)\1\)/) || [])[2]) || '';
                        return img ? (
                          <div style={{ borderRadius: 8, marginBottom: 8, overflow: 'hidden', position: 'relative', background: '#f3f3f3' }}>
                            <img src={img} alt="" style={{ width: '100%', height: 'auto', display: 'block' }} />
                            {sl.title && <strong style={{ position: 'absolute', left: 8, bottom: 8, color: sl.textColor || '#fff', textShadow: '0 1px 3px rgba(0,0,0,.5)' }}>{sl.title}</strong>}
                          </div>
                        ) : (
                          <div style={{ height: 70, borderRadius: 8, marginBottom: 8, background: sl.bg, backgroundSize: 'cover', backgroundPosition: 'center', display: 'flex', alignItems: 'flex-end', padding: 8, color: sl.textColor || '#fff' }}>
                            <strong>{sl.title || '(no title)'}</strong>
                          </div>
                        );
                      })()}
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
                          <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files[0]; if (f) uploadImage(f, (url) => updSlide(i, { image: url, bg: `url(${url}) center/contain no-repeat` })); }} />
                        </label>
                        <input style={{ flex: 1, padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 10, fontSize: 11 }} value={sl.bg || ''} onChange={(e) => updSlide(i, { bg: e.target.value })} placeholder="background (gradient or url(...) center/cover)" />
                      </div>
                    </div>
                  ))}
                </div>
                <button className="btn ghost full" style={{ marginTop: 10 }} onClick={addSlide}>+ Add banner</button>
              </div>
            )}

            {/* ───────── TABLES (QR) ───────── */}
            {tab === 'tables' && (
              <div className="card" style={card}>
                <div className="group-title">Table QR codes</div>
                <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
                  Generate a QR for each table. Scanning it opens the app with <strong>Dine in</strong> and that
                  table number locked in — the guest taps ✕ only if they need to change it. Print and place one on each table.
                </p>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <label className="field" style={{ flex: '1 1 90px', minWidth: 80 }}><span>From table</span>
                    <input type="number" min="1" value={qrFrom} onChange={(e) => setQrFrom(e.target.value)} /></label>
                  <label className="field" style={{ flex: '1 1 90px', minWidth: 80 }}><span>To table</span>
                    <input type="number" min="1" value={qrTo} onChange={(e) => setQrTo(e.target.value)} /></label>
                  <button className="btn" style={{ minWidth: 120 }} disabled={qrBusy} onClick={generateQR}>
                    {qrBusy ? 'Generating…' : 'Generate'}
                  </button>
                </div>
                <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', marginTop: 14 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="muted" style={{ fontSize: 13 }}>Code colour</span>
                    <input type="color" value={qrFg} onChange={(e) => setQrFg(e.target.value)} style={{ width: 40, height: 30, border: 'none', background: 'none', cursor: 'pointer' }} />
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="muted" style={{ fontSize: 13 }}>Background</span>
                    <input type="color" value={qrBg} onChange={(e) => setQrBg(e.target.value)} style={{ width: 40, height: 30, border: 'none', background: 'none', cursor: 'pointer' }} />
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 200px', minWidth: 180 }}>
                    <span className="muted" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>Size {qrSize}px</span>
                    <input type="range" min="120" max="320" step="10" value={qrSize} onChange={(e) => setQrSize(Number(e.target.value))} style={{ flex: 1 }} />
                  </label>
                </div>
                {qrCodes.length > 0 && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '14px 0 2px' }}>
                      <span className="muted" style={{ fontSize: 12 }}>{qrCodes.length} table{qrCodes.length === 1 ? '' : 's'} · links to {origin || 'this site'}</span>
                      <button className="link" onClick={() => window.print()}>🖨 Print cards</button>
                    </div>
                    <div className="qr-print" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${Math.min(qrSize + 48, 300)}px, 1fr))` }}>
                      {qrCodes.map((q) => (
                        <div key={q.n} className="qr-card">
                          <div className="qr-card-brand">{(s && s.storeName) || 'Bean Culture'}</div>
                          <div className="qr-card-scan">Scan to order</div>
                          <img src={q.img} alt={`Table ${q.n} QR code`} style={{ width: qrSize, maxWidth: '100%' }} />
                          <div className="qr-card-table">Table {q.n}</div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ───────── THEME ───────── */}
            {tab === 'theme' && (
              <div className="card" style={card}>
                <div className="group-title">Default theme</div>
                <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>The store’s base colours (guests can still pick their own theme).</p>
                {['brand', 'accent', 'bg', 'ink'].map((k) => (
                  <div key={k} style={{ ...row, justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid var(--line)' }}>
                    <span style={{ textTransform: 'capitalize' }}>{k === 'bg' ? 'Background' : k === 'ink' ? 'Text' : k}</span>
                    <input type="color" value={(s.theme && s.theme[k]) || '#000000'} onChange={(e) => setTheme(k, e.target.value)} style={{ width: 44, height: 32, border: 'none', background: 'none' }} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Sticky save bar */}
      <div className="admin-savebar">
        <div className="admin-savebar-inner">
          <span className="muted" style={{ fontSize: 12, flex: 1 }}>{savedMsg}</span>
          <button className="btn" style={{ minWidth: 140 }} disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save changes'}</button>
        </div>
      </div>
    </div>
  );
}
