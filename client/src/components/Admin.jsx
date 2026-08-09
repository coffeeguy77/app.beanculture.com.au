import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { SlotIcon } from './icons.jsx';
import IconPicker from './IconPicker.jsx';
import HoursEditor from './HoursEditor.jsx';
import { formatMoney, api } from '../api.js';

const LINK_TYPES = ['scroll', 'category', 'item', 'account', 'url', 'none'];
// Built-in festive themes ship with the app and can be turned Off but not deleted.
const BUILTIN_SEASONAL = ['christmas', 'newyear', 'australiaday', 'lunarnewyear', 'valentines', 'stpatricks', 'easter', 'anzac', 'mothersday', 'floriade', 'fathersday', 'halloween'];

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
  { id: 'users', label: 'Users', Icon: InsightsIcon },
  { id: 'coupons', label: 'Coupons', Icon: BannerIcon },
  { id: 'push', label: 'Push', Icon: BannerIcon },
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
  const [allProducts, setAllProducts] = useState([]);
  const [sqCats, setSqCats] = useState([]);
  const [catsLocked, setCatsLocked] = useState(true);
  const [expanded, setExpanded] = useState({});
  const [secSearch, setSecSearch] = useState({}); // product-section id -> search text
  const [imgBusy, setImgBusy] = useState(null);      // item id currently uploading
  const [imgOverride, setImgOverride] = useState({}); // item id -> freshly uploaded url
  const [users, setUsers] = useState(null);          // loyalty customers (Users tab)
  const [usersBusy, setUsersBusy] = useState(false);
  const [userQuery, setUserQuery] = useState('');
  const [userSort, setUserSort] = useState('recent'); // recent | oldest | points | earned | redeemed
  const [userFilter, setUserFilter] = useState('all'); // all | active | redeemers | new
  const [notifyStatus, setNotifyStatus] = useState(null); // { sms, email }
  const [push, setPush] = useState({ channel: 'sms', subject: '', message: '', link: '' });
  const [pushBusy, setPushBusy] = useState(false);
  const [pushResult, setPushResult] = useState(null);
  const [tab, setTab] = useState('store');
  const [qrFrom, setQrFrom] = useState(1);
  const [qrTo, setQrTo] = useState(12);
  const [qrCodes, setQrCodes] = useState([]);
  const [qrBusy, setQrBusy] = useState(false);
  const [qrFg, setQrFg] = useState('#2b2126');
  const [qrBg, setQrBg] = useState('#ffffff');
  const [qrSize, setQrSize] = useState(190);
  const [analytics, setAnalytics] = useState(null);
  const [dashboard, setDashboard] = useState(null); // real sales + signups
  const [aDays, setADays] = useState(30);
  const [msgs, setMsgs] = useState(null);
  const [resv, setResv] = useState(null);
  const [resvChannels, setResvChannels] = useState({});
  const [newClosure, setNewClosure] = useState({ date: '', annual: false, label: '' });
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  // Load analytics when the Insights tab is opened / period changes.
  useEffect(() => {
    if (tab !== 'insights') return;
    setAnalytics(null);
    fetch(`/api/admin/analytics?days=${aDays}&pass=${encodeURIComponent(pass)}`)
      .then((r) => r.json()).then((d) => setAnalytics(d.analytics || { empty: true })).catch(() => setAnalytics({ error: true }));
    setDashboard(null);
    api.adminDashboard(pass, aDays).then(setDashboard).catch(() => setDashboard({ error: true }));
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
      try {
        const sc = await fetch(`/api/admin/square-categories?pass=${encodeURIComponent(p || '')}`);
        if (sc.ok) { const sd = await sc.json(); setSqCats(sd.categories || []); }
      } catch {}
      try {
        const pr = await fetch(`/api/admin/products?pass=${encodeURIComponent(p || '')}`);
        if (pr.ok) { const pd = await pr.json(); setAllProducts(pd.products || []); }
      } catch {}
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(''); }, []);
  useEffect(() => {
    if (tab === 'push') {
      if (notifyStatus === null) api.adminNotifyStatus(pass).then(setNotifyStatus).catch(() => setNotifyStatus({ sms: false, email: false }));
      if (users === null && !usersBusy) loadUsers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function loadMessages() {
    try { const d = await api.adminMessages(pass); setMsgs(d.messages || []); }
    catch (e) { alert('Could not load messages: ' + e.message); }
  }
  async function toggleHandled(m) {
    const next = !m.handled;
    setMsgs((xs) => (xs || []).map((x) => (x.id === m.id ? { ...x, handled: next } : x)));
    try { await api.markMessage(pass, m.id, next); } catch {}
  }
  async function loadReservations() {
    try { const d = await api.adminReservations(pass); setResv(d.reservations || []); setResvChannels({ sms: d.sms, email: d.email }); }
    catch (e) { alert('Could not load reservations: ' + e.message); }
  }
  async function loadUsers() {
    setUsersBusy(true);
    try { const d = await api.adminCustomers(pass); setUsers(d.users || []); }
    catch (e) { alert('Could not load users: ' + e.message); }
    finally { setUsersBusy(false); }
  }
  async function sendBroadcast() {
    if (!push.message.trim()) { alert('Write a message first.'); return; }
    const audience = users ? users.length : null;
    if (!window.confirm(`Send this ${push.channel === 'sms' ? 'SMS' : 'email'} to your loyalty members${audience != null ? ` (${audience})` : ''}? This sends for real and can’t be undone.`)) return;
    setPushBusy(true); setPushResult(null);
    try { setPushResult(await api.adminBroadcast(pass, push)); }
    catch (e) { alert('Send failed: ' + e.message); }
    finally { setPushBusy(false); }
  }
  async function setResvStatus(r, status) {
    setResv((xs) => (xs || []).map((x) => (x.id === r.id ? { ...x, status } : x)));
    try { await api.setReservationStatus(pass, r.id, status); } catch {}
  }

  // Footer buttons can point at whole categories AND hand-picked product
  // sections, so include the product-section names here (deduped, case-insensitive).
  const cats = (() => {
    const names = [
      ...(data?.categories || []).map((c) => c.name),
      ...((s?.productSections || []).map((ps) => (ps.name || '').trim()).filter(Boolean)),
    ];
    const seen = new Set();
    return names.filter((n) => { const k = n.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  })();

  // ---- generic setters ----
  const set = (patch) => setS((cur) => ({ ...cur, ...patch }));
  const setTheme = (k, v) => setS((cur) => ({ ...cur, theme: { ...cur.theme, [k]: v } }));
  const setContact = (k, v) => setS((cur) => ({ ...cur, contact: { ...(cur.contact || {}), [k]: v } }));

  // ---- closures (single day or date range) ----
  const closures = s?.closures || [];
  const addClosure = () => {
    const c = { annual: !!newClosure.annual };
    if (newClosure.label) c.label = newClosure.label;
    if (newClosure.range) {
      if (!newClosure.from || !newClosure.to) return;
      c.from = newClosure.from; c.to = newClosure.to;
    } else {
      if (!newClosure.date) return;
      c.date = newClosure.date;
    }
    set({ closures: [...closures, c] });
    setNewClosure({ date: '', from: '', to: '', annual: false, label: '', range: newClosure.range });
  };
  const rmClosure = (i) => set({ closures: closures.filter((_, j) => j !== i) });

  // ---- which Square categories appear in the app ----
  // ---- Categories in the app (ID-based, robust) ----
  // Every category is identified by its stable Square id, so uppercase / mixed
  // case duplicates (e.g. "COLD DRINKS" vs "Cold drinks") never collide, and
  // toggling one category can never drop the others. menuCategories is stored as
  // a list of ids; older saved values (names) are matched and migrated on save.
  const catKey = (n) => (n || '').trim().toLowerCase();
  const allCats = (() => {
    const list = (sqCats || []).filter((c) => !c.isParent); // [{id, name, rawName, isParent}]
    return list.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  })();
  // Match a saved entry (id or name) to a category. Exact id → exact name →
  // case-insensitive, so case-only duplicates ("COLD DRINKS" vs "Cold drinks")
  // migrate to the right one instead of colliding.
  const findCat = (e) =>
    allCats.find((c) => c.id === e) ||
    allCats.find((c) => c.rawName === e || c.name === e) ||
    allCats.find((c) => catKey(c.rawName) === catKey(e) || catKey(c.name) === catKey(e));
  const selectedCatIds = (() => {
    const raw = s?.menuCategories || [];
    if (raw.length === 0) {
      // Not curated yet → seed with whatever is live on the app right now.
      const live = new Set((cats || []).map(catKey));
      return new Set(allCats.filter((c) => live.has(catKey(c.name)) || live.has(catKey(c.rawName))).map((c) => c.id));
    }
    const ids = new Set();
    for (const e of raw) { const hit = findCat(e); if (hit) ids.add(hit.id); }
    return ids;
  })();
  const isCatSelected = (c) => selectedCatIds.has(c.id);
  const toggleCat = (c) => {
    const ids = new Set(selectedCatIds);      // start from the FULL current set…
    if (ids.has(c.id)) ids.delete(c.id); else ids.add(c.id); // …flip just this one…
    set({ menuCategories: [...ids] });         // …and store ids (never drops the rest)
  };

  // ---- seasonal / festive theme scheduler ----
  const seasonalThemes = s?.seasonalThemes || [];
  // Festive dates are stored as recurring month-day (e.g. "12-01"); the date
  // input needs a full year just to render, so we pin it to the current year.
  const seasonYear = new Date().getFullYear();
  const setSeasonal = (arr) => set({ seasonalThemes: arr });
  const updSeasonal = (i, patch) => setSeasonal(seasonalThemes.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  const updSeasonalTheme = (i, k, v) => setSeasonal(seasonalThemes.map((t, j) => (j === i ? { ...t, theme: { ...(t.theme || {}), [k]: v } } : t)));
  const updSeasonalBanner = (i, patch) => setSeasonal(seasonalThemes.map((t, j) => (j === i ? { ...t, banner: { ...(t.banner || {}), ...patch } } : t)));
  const rmSeasonal = (i) => setSeasonal(seasonalThemes.filter((_, j) => j !== i));
  const addSeasonal = () => setSeasonal([...seasonalThemes, {
    id: 'custom' + Math.random().toString(36).slice(2, 7), name: '✨ Custom event', from: '01-01', to: '01-01', enabled: true,
    theme: { bg: '#fdf1f4', surface: '#ffffff', ink: '#3b2b30', muted: '#9c8890', brand: '#b5566e', accent: '#d1547a', accentInk: '#ffffff', line: '#f2dfe6' },
    effects: {}, banner: { title: '', subtitle: '', cta: 'Order now', bg: 'linear-gradient(135deg,#f7c9d6,#d1547a)', textColor: '#ffffff', link: { type: 'scroll', value: 'menu' } },
  }]);

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

  // ---- product sections (hand-picked products under an owner-named heading) ----
  const productSections = s?.productSections || [];
  const setSections = (arr) => set({ productSections: arr });
  const addSection = () =>
    setSections([...productSections, { id: 'sec' + Date.now().toString(36), name: 'New section', items: [], showImages: true }]);
  const updSection = (id, patch) => setSections(productSections.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const rmSection = (id) => setSections(productSections.filter((x) => x.id !== id));
  const sectionHasItem = (sec, itemId) => Array.isArray(sec.items) && sec.items.includes(itemId);
  const toggleSectionItem = (id, itemId) =>
    setSections(productSections.map((x) => {
      if (x.id !== id) return x;
      const cur = Array.isArray(x.items) ? x.items : [];
      return { ...x, items: cur.includes(itemId) ? cur.filter((i) => i !== itemId) : [...cur, itemId] };
    }));

  // ---- menu section order (storefront): categories AND product sections ----
  // Everything is ordered by s.menuOrder (display names). Anything not yet in
  // that list falls to the end. Units carry their type so we can render each.
  const menuOrder = s?.menuOrder || [];
  const orderRank = (name) => {
    const i = menuOrder.findIndex((n) => String(n).toLowerCase() === String(name).toLowerCase());
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const orderedUnits = [
    ...adminCat.map((c) => ({ type: 'cat', name: c.category, cat: c })),
    ...productSections.map((ps) => ({ type: 'section', name: ps.name || '', section: ps })),
  ].sort((a, b) => orderRank(a.name) - orderRank(b.name));
  const moveUnit = (name, dir) => setS((cur) => {
    // Authoritative order = the units as currently shown; swap two of them.
    const base = orderedUnits.map((u) => u.name);
    const i = base.findIndex((n) => n.toLowerCase() === String(name).toLowerCase());
    const j = i + dir;
    if (i < 0 || j < 0 || j >= base.length) return cur;
    const arr = [...base];
    [arr[i], arr[j]] = [arr[j], arr[i]];
    return { ...cur, menuOrder: arr };
  });

  // ---- coupons ----
  const couponList = s?.coupons || [];
  const setCoupons = (arr) => set({ coupons: arr });
  const addCoupon = () => setCoupons([...couponList, { code: '', type: 'percent', value: 10, expiry: '', active: true }]);
  const updCoupon = (i, patch) => setCoupons(couponList.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const rmCoupon = (i) => setCoupons(couponList.filter((_, j) => j !== i));

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

  // Push a real photo straight into the Square catalog item as its primary image
  // (overrides the AI image everywhere Square is used).
  function uploadSquareImage(file, objectId) {
    if (!file) return;
    const reader = new FileReader();
    setImgBusy(objectId);
    reader.onload = async () => {
      try {
        const r = await fetch(`/api/admin/catalog/image?pass=${encodeURIComponent(pass)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ objectId, dataUri: reader.result, primary: true }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Upload failed');
        setImgOverride((m) => ({ ...m, [objectId]: d.url }));
      } catch (e) { alert('Photo upload failed: ' + e.message); }
      finally { setImgBusy(null); }
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
      await load(pass); // re-pull categories + catalog so counts/lists refresh without a page reload
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
                  <div className="group-title">Store page</div>
                  <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>The About / contact page customers reach from the store button in the header. Opening hours and address/phone come from Square + Contact above.</p>
                  <div style={{ ...row, marginBottom: 10 }}>
                    <div className="muted" style={{ fontSize: 12, minWidth: 92 }}>Store photo</div>
                    {s.storePhoto ? <img src={s.storePhoto} alt="" style={{ height: 44, borderRadius: 8 }} /> : <span className="muted" style={{ fontSize: 12 }}>None</span>}
                    <label className="btn ghost" style={{ padding: '8px 12px', fontSize: 13, cursor: 'pointer' }}>Upload<input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files[0]; if (f) uploadImage(f, (url) => set({ storePhoto: url }), 'store'); }} /></label>
                    {s.storePhoto && <button className="link" style={{ color: '#c0392b' }} onClick={() => set({ storePhoto: '' })}>Remove</button>}
                  </div>
                  <label className="field"><span>Bio / about</span><textarea rows={3} value={s.bio || ''} onChange={(e) => set({ bio: e.target.value })} placeholder="A short story about your café…" /></label>
                  <label className="field" style={{ marginTop: 10 }}><span>Google review link</span><input value={s.googleReviewUrl || ''} onChange={(e) => set({ googleReviewUrl: e.target.value })} placeholder="https://g.page/r/…/review" /></label>
                  <label className="field" style={{ marginTop: 10 }}><span>“Support us” message (optional)</span><textarea rows={2} value={s.supportMessage || ''} onChange={(e) => set({ supportMessage: e.target.value })} placeholder="Leave blank for a friendly default." /></label>
                </div>

                <div className="card" style={card}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div className="group-title" style={{ margin: 0 }}>Customer messages</div>
                    <button type="button" className="btn ghost" style={{ padding: '6px 12px', fontSize: 13 }} onClick={loadMessages}>{msgs === null ? 'Load' : 'Refresh'}</button>
                  </div>
                  <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>Enquiries, feedback and catering requests sent from the store page.</p>
                  {msgs === null && <p className="muted" style={{ fontSize: 12 }}>Tap Load to see messages.</p>}
                  {msgs && msgs.length === 0 && <p className="muted" style={{ fontSize: 12 }}>No messages yet.</p>}
                  {msgs && msgs.map((m) => (
                    <div key={m.id} className="history-item" style={{ opacity: m.handled ? 0.55 : 1 }}>
                      <div className="history-top">
                        <span><span className="pill" style={{ textTransform: 'capitalize' }}>{m.type}</span> {m.name || 'Anonymous'}</span>
                        <span className="muted" style={{ fontSize: 12 }}>{new Date(m.createdAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}</span>
                      </div>
                      {m.contact && <div className="muted" style={{ fontSize: 12, margin: '2px 0' }}>{m.contact}</div>}
                      <div style={{ fontSize: 14, whiteSpace: 'pre-line' }}>{m.body}</div>
                      <button className="link" style={{ padding: 0, fontSize: 13 }} onClick={() => toggleHandled(m)}>{m.handled ? 'Mark unread' : 'Mark done'}</button>
                    </div>
                  ))}
                </div>

                <div className="card" style={card}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div className="group-title" style={{ margin: 0 }}>Reservations</div>
                    <button type="button" className="btn ghost" style={{ padding: '6px 12px', fontSize: 13 }} onClick={loadReservations}>{resv === null ? 'Load' : 'Refresh'}</button>
                  </div>
                  <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    Table bookings from the app. Alerts: {resvChannels.sms ? 'SMS on' : 'SMS off'} · {resvChannels.email ? 'email on' : 'email off'}. Each booking also creates a $0 Square order so it prints + shows in Square.
                  </p>
                  {resv === null && <p className="muted" style={{ fontSize: 12 }}>Tap Load to see reservations.</p>}
                  {resv && resv.length === 0 && <p className="muted" style={{ fontSize: 12 }}>No reservations yet.</p>}
                  {resv && resv.map((r) => (
                    <div key={r.id} className="history-item" style={{ opacity: r.status === 'cancelled' ? 0.5 : 1 }}>
                      <div className="history-top">
                        <span><strong>{r.party} {r.party === 1 ? 'guest' : 'guests'}</strong> · {r.name || '—'}</span>
                        <span className={`pill`} style={{ textTransform: 'capitalize', background: r.status === 'confirmed' ? '#e6f6ec' : r.status === 'seated' ? '#eef' : r.status === 'cancelled' ? '#fdecec' : '#f4eef1' }}>{r.status}</span>
                      </div>
                      <div className="muted" style={{ fontSize: 13, margin: '3px 0' }}>
                        {r.reserveAt ? new Date(r.reserveAt).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—'} · {r.phone || ''}{r.email ? ` · ${r.email}` : ''}
                      </div>
                      {r.notes && <div style={{ fontSize: 13 }}>{r.notes}</div>}
                      <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
                        {['confirmed', 'seated', 'cancelled'].filter((st) => st !== r.status).map((st) => (
                          <button key={st} className="link" style={{ padding: 0, fontSize: 13, textTransform: 'capitalize', color: st === 'cancelled' ? '#c0392b' : undefined }} onClick={() => setResvStatus(r, st)}>Mark {st}</button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="card" style={card}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                    <div className="group-title" style={{ margin: 0 }}>Opening hours</div>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }} className="muted">
                      <input type="checkbox" checked={!!s.useAppHours} onChange={(e) => set({ useAppHours: e.target.checked })} /> Set my own hours (override Square)
                    </label>
                  </div>
                  <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    {s.useAppHours ? 'These hours decide when the app is open and when customers can order “now”.' : 'Currently using your Square location hours. Tick above to set hours here instead.'}
                  </p>
                  {s.useAppHours && <HoursEditor value={s.storeHours} onChange={(v) => set({ storeHours: v })} />}
                </div>

                <div className="card" style={card}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                    <div className="group-title" style={{ margin: 0 }}>Kitchen hours</div>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }} className="muted">
                      <input type="checkbox" checked={!!s.kitchenHoursOn} onChange={(e) => set({ kitchenHoursOn: e.target.checked })} /> Kitchen has its own hours
                    </label>
                  </div>
                  <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    Made-to-order categories are only available while the kitchen is open. Everything else (pre-made / fridge items) stays available whenever the store is open. Leave off to keep the kitchen open whenever the store is.
                  </p>
                  {s.kitchenHoursOn && (
                    <>
                      <HoursEditor value={s.kitchenHours} onChange={(v) => set({ kitchenHours: v })} />
                      <div className="group-title" style={{ marginTop: 14, fontSize: 13 }}>Made-to-order categories</div>
                      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>Tick the categories the kitchen makes on demand. These go unavailable when the kitchen closes.</p>
                      {cats.length === 0 && <p className="muted" style={{ fontSize: 12 }}>No categories loaded yet.</p>}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {cats.map((c) => {
                          const on = (s.kitchenCategories || []).includes(c);
                          return (
                            <button key={c} type="button" className={`chip ${on ? 'on' : ''}`}
                              onClick={() => set({ kitchenCategories: on ? (s.kitchenCategories || []).filter((x) => x !== c) : [...(s.kitchenCategories || []), c] })}>
                              {on ? '✓ ' : ''}{c}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>

                <div className="card" style={card}>
                  <div className="group-title">Closed dates</div>
                  <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>Annual leave, public holidays. Closed days can’t be booked for pre-orders. Use a range for multi-day closures (e.g. late Dec – mid Jan). Tick “every year” for recurring dates.</p>
                  <div className="segmented" style={{ maxWidth: 280, marginBottom: 10 }}>
                    <button type="button" className={!newClosure.range ? 'seg active' : 'seg'} onClick={() => setNewClosure((c) => ({ ...c, range: false }))}>Single day</button>
                    <button type="button" className={newClosure.range ? 'seg active' : 'seg'} onClick={() => setNewClosure((c) => ({ ...c, range: true }))}>Date range</button>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    {newClosure.range ? (
                      <>
                        <label className="field" style={{ flex: '1 1 120px' }}><span>From</span><input type="date" value={newClosure.from || ''} onChange={(e) => setNewClosure((c) => ({ ...c, from: e.target.value }))} /></label>
                        <label className="field" style={{ flex: '1 1 120px' }}><span>To</span><input type="date" value={newClosure.to || ''} onChange={(e) => setNewClosure((c) => ({ ...c, to: e.target.value }))} /></label>
                      </>
                    ) : (
                      <label className="field" style={{ flex: '1 1 130px' }}><span>Date</span><input type="date" value={newClosure.date || ''} onChange={(e) => setNewClosure((c) => ({ ...c, date: e.target.value }))} /></label>
                    )}
                    <label className="field" style={{ flex: '2 1 150px' }}><span>Label</span><input value={newClosure.label || ''} onChange={(e) => setNewClosure((c) => ({ ...c, label: e.target.value }))} placeholder="e.g. Summer break" /></label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, paddingBottom: 12, whiteSpace: 'nowrap' }}><input type="checkbox" checked={!!newClosure.annual} onChange={(e) => setNewClosure((c) => ({ ...c, annual: e.target.checked }))} /> Every year</label>
                    <button className="btn" onClick={addClosure}>Add</button>
                  </div>
                  {closures.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      {closures.map((c, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderTop: '1px solid var(--line)' }}>
                          <span>{c.from ? `${c.from} → ${c.to}` : c.date}{c.annual ? ' · every year' : ''}{c.label ? ` · ${c.label}` : ''}</span>
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

                {/* ── Real sales + signups (from Square) ── */}
                {!dashboard && <div className="card" style={{ ...card, textAlign: 'center' }}><div className="spinner" /></div>}
                {dashboard && !dashboard.error && (() => {
                  const sl = dashboard.sales || {};
                  const su = dashboard.signups || {};
                  const salesOk = sl && !sl.error;
                  const signupsOk = su && !su.error;
                  const cur = sl.currency || 'AUD';
                  const sDaily = (salesOk && sl.daily) || [];
                  const maxRev = Math.max(1, ...sDaily.map((d) => d.revenue));
                  const gDaily = (signupsOk && su.daily) || [];
                  const maxSign = Math.max(1, ...gDaily.map((d) => d.n));
                  const tiles = [
                    salesOk && { label: 'Revenue', v: formatMoney(sl.revenue, cur) },
                    salesOk && { label: 'Orders', v: sl.orders },
                    salesOk && { label: 'Avg order', v: formatMoney(sl.avgOrder, cur) },
                    signupsOk && { label: 'New signups', v: su.newInRange },
                    signupsOk && { label: 'Members', v: su.totalMembers },
                  ].filter(Boolean);
                  return (
                    <>
                      <div className="group-title" style={{ marginBottom: 8 }}>Sales &amp; signups <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>· live from Square</span></div>
                      {(!salesOk || !signupsOk) && (
                        <p className="muted" style={{ fontSize: 12, margin: '0 0 8px' }}>
                          {!salesOk && 'Sales couldn’t load — your Square token needs the Orders (read) permission. '}
                          {!signupsOk && 'Signups need the Square loyalty program enabled.'}
                        </p>
                      )}
                      {tiles.length > 0 && (
                        <div className="stat-tiles">
                          {tiles.map((x) => <div key={x.label} className="stat-tile"><div className="stat-v">{x.v}</div><div className="stat-l">{x.label}</div></div>)}
                        </div>
                      )}
                      {salesOk && (
                        <div className="card" style={card}>
                          <div className="group-title">Daily revenue</div>
                          <div className="chart-bars">
                            {sDaily.length === 0 && <span className="muted" style={{ fontSize: 12 }}>No completed sales in this period.</span>}
                            {sDaily.slice(-30).map((d, i) => (
                              <div key={i} className="chart-col" title={`${d.day}: ${formatMoney(d.revenue, cur)} · ${d.orders} order${d.orders === 1 ? '' : 's'}`}>
                                <div className="bar bar-buys" style={{ height: `${(d.revenue / maxRev) * 100}%` }} />
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {signupsOk && (
                        <div className="card" style={card}>
                          <div className="group-title">New loyalty signups</div>
                          <div className="chart-bars">
                            {gDaily.length === 0 && <span className="muted" style={{ fontSize: 12 }}>No new signups in this period.</span>}
                            {gDaily.slice(-30).map((d, i) => (
                              <div key={i} className="chart-col" title={`${d.day}: ${d.n} signup${d.n === 1 ? '' : 's'}`}>
                                <div className="bar bar-signup" style={{ height: `${(d.n / maxSign) * 100}%` }} />
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="group-title" style={{ margin: '18px 0 8px' }}>App engagement</div>
                    </>
                  );
                })()}

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
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div className="group-title" style={{ margin: 0 }}>Categories in the app</div>
                    <button type="button" className={`chip ${catsLocked ? 'on' : ''}`} onClick={() => setCatsLocked((v) => !v)}
                      style={{ fontSize: 12 }} title={catsLocked ? 'Locked — tap to make changes' : 'Unlocked — tap to lock'}>
                      {catsLocked ? '🔒 Locked' : '🔓 Unlocked'}
                    </button>
                  </div>
                  <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                    Tap any category to show or hide it in the app — including your uppercase Square ones. Changes apply
                    to the customer menu when you press <strong>Save changes</strong>.{catsLocked ? ' Unlock to make changes.' : ''}
                  </p>
                  {allCats.length === 0 && <p className="muted" style={{ fontSize: 12 }}>No Square categories loaded yet — create categories in Square, then Sync.</p>}
                  {(() => {
                    const showing = allCats.filter(isCatSelected);
                    const addable = allCats.filter((c) => !isCatSelected(c));
                    const chip = (c, active) => (
                      <button key={c.id} type="button" className={`chip ${active ? 'on' : ''}`}
                        disabled={catsLocked}
                        onClick={() => { if (!catsLocked) toggleCat(c); }}
                        style={catsLocked ? { opacity: active ? 0.85 : 0.5, cursor: 'not-allowed' } : undefined}
                        title={catsLocked ? 'Unlock to change' : (active ? 'Tap to hide' : 'Tap to show')}>
                        {active ? '✓ ' : '+ '}{c.name}{active ? '  ✕' : ''}
                      </button>
                    );
                    return (
                      <>
                        {showing.length > 0 && (
                          <>
                            <p className="muted" style={{ fontSize: 11, margin: '10px 0 6px', textTransform: 'uppercase', letterSpacing: 0.4 }}>Showing in the app · tap to hide</p>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{showing.map((c) => chip(c, true))}</div>
                          </>
                        )}
                        {addable.length > 0 && (
                          <>
                            <p className="muted" style={{ fontSize: 11, margin: '14px 0 6px', textTransform: 'uppercase', letterSpacing: 0.4 }}>Hidden · tap to show</p>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{addable.map((c) => chip(c, false))}</div>
                          </>
                        )}
                      </>
                    );
                  })()}
                </div>

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
                    Build the menu from whole categories and/or hand-picked <strong>product sections</strong>. Tick a
                    category to offer it; expand to offer only certain items. Add a product section to group individual
                    products (e.g. “Breakfast”) under a name you choose — handy for a product that shouldn’t pull in its
                    whole category. Use ↑/↓ to set the order everything appears on the storefront.
                  </p>
                  {adminCat.length === 0 && <p className="muted" style={{ fontSize: 12 }}>Loading catalog…</p>}
                  {orderedUnits.map((u, idx) => {
                    if (u.type === 'section') {
                      const sec = u.section;
                      const isOpen = !!expanded[sec.id];
                      const q = (secSearch[sec.id] || '').toLowerCase();
                      const picked = Array.isArray(sec.items) ? sec.items.length : 0;
                      return (
                        <div key={sec.id} style={{ border: '1px solid var(--accent)', borderRadius: 12, padding: 10, marginBottom: 10, background: 'var(--brand-soft)' }}>
                          <div style={{ ...row, justifyContent: 'space-between' }}>
                            <label style={{ ...row, flex: 1, minWidth: 0 }}>
                              <span title="Product section" style={{ fontSize: 15 }}>🧩</span>
                              <input value={sec.name || ''} onChange={(e) => updSection(sec.id, { name: e.target.value })} placeholder="Section name"
                                style={{ fontWeight: 700, flex: 1, minWidth: 0, padding: '6px 8px', border: '1px solid var(--line)', borderRadius: 8 }} />
                              <span className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{picked} picked</span>
                            </label>
                            <label style={{ ...row, cursor: 'pointer', fontSize: 12 }} className="muted" title="Show product images for this section">
                              <input type="checkbox" checked={sec.showImages !== false} onChange={(e) => updSection(sec.id, { showImages: e.target.checked })} />
                              <span>Images</span>
                            </label>
                            <button className="link" title="Move up" disabled={idx === 0} style={{ opacity: idx === 0 ? 0.3 : 1 }} onClick={() => moveUnit(u.name, -1)}>↑</button>
                            <button className="link" title="Move down" disabled={idx === orderedUnits.length - 1} style={{ opacity: idx === orderedUnits.length - 1 ? 0.3 : 1 }} onClick={() => moveUnit(u.name, 1)}>↓</button>
                            <button className="link" onClick={() => setExpanded((x) => ({ ...x, [sec.id]: !isOpen }))}>{isOpen ? '▲' : '▼'}</button>
                            <button className="link" style={{ color: '#c0392b' }} title="Remove section" onClick={() => rmSection(sec.id)}>✕</button>
                          </div>
                          {isOpen && (
                            <div style={{ marginTop: 8, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
                              <input placeholder="Search products…" value={secSearch[sec.id] || ''}
                                onChange={(e) => setSecSearch((x) => ({ ...x, [sec.id]: e.target.value }))}
                                style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 10, marginBottom: 8 }} />
                              {allProducts.length === 0 && <p className="muted" style={{ fontSize: 12 }}>Loading products…</p>}
                              <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                                {allProducts
                                  .filter((p) => !q || p.name.toLowerCase().includes(q) || (p.category || '').toLowerCase().includes(q))
                                  .map((p) => (
                                    <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', cursor: 'pointer' }}>
                                      <input type="checkbox" checked={sectionHasItem(sec, p.id)} onChange={() => toggleSectionItem(sec.id, p.id)} />
                                      {p.image
                                        ? <img src={p.image} alt="" style={{ width: 30, height: 30, borderRadius: 6, objectFit: 'cover', flex: 'none' }} />
                                        : <span style={{ width: 30, height: 30, borderRadius: 6, background: 'var(--surface)', flex: 'none', display: 'grid', placeItems: 'center', fontSize: 14 }}>🍽️</span>}
                                      <span style={{ fontSize: 14, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                                      {p.category && <span className="muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{p.category}</span>}
                                    </label>
                                  ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    }
                    const c = u.cat;
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
                          <button className="link" title="Move up" disabled={idx === 0}
                            style={{ opacity: idx === 0 ? 0.3 : 1 }}
                            onClick={() => moveUnit(c.category, -1)}>↑</button>
                          <button className="link" title="Move down" disabled={idx === orderedUnits.length - 1}
                            style={{ opacity: idx === orderedUnits.length - 1 ? 0.3 : 1 }}
                            onClick={() => moveUnit(c.category, 1)}>↓</button>
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
                              {c.items.map((it) => {
                                const img = imgOverride[it.id] || it.image;
                                return (
                                  <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', flex: 1, minWidth: 0 }}>
                                      <input type="checkbox" checked={itemOffered(c.category, it.id)} disabled={!on}
                                        onChange={() => toggleItem(c.category, it.id, allIds)} />
                                      {img
                                        ? <img src={img} alt="" style={{ width: 34, height: 34, borderRadius: 8, objectFit: 'cover', flex: 'none' }} />
                                        : <span style={{ width: 34, height: 34, borderRadius: 8, background: 'var(--brand-soft)', flex: 'none', display: 'grid', placeItems: 'center', fontSize: 15 }}>🍽️</span>}
                                      <span style={{ fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</span>
                                    </label>
                                    <label className="btn ghost" title="Upload a real photo to this Square item"
                                      style={{ padding: '5px 10px', fontSize: 12, cursor: imgBusy === it.id ? 'default' : 'pointer', flex: 'none', opacity: imgBusy === it.id ? 0.6 : 1 }}>
                                      {imgBusy === it.id ? 'Uploading…' : (img ? 'Replace' : 'Photo')}
                                      <input type="file" accept="image/*" style={{ display: 'none' }} disabled={imgBusy === it.id}
                                        onChange={(e) => { const f = e.target.files[0]; if (f) uploadSquareImage(f, it.id); e.target.value = ''; }} />
                                    </label>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <button className="btn ghost full" onClick={addSection}>+ Add product section</button>
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
                        {sl.link?.type === 'item' && (
                          <select value={sl.link?.value || ''}
                            onChange={(e) => { const opt = e.target.selectedOptions[0]; updSlide(i, { link: { ...sl.link, value: e.target.value, label: opt ? opt.text : '' } }); }}
                            style={{ flex: 1, padding: 8, borderRadius: 10, border: '1px solid var(--line)' }}>
                            <option value="">{adminCat.length ? '— pick a product —' : 'Loading products…'}</option>
                            {adminCat.map((c) => (
                              <optgroup key={c.category} label={c.category}>
                                {c.items.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
                              </optgroup>
                            ))}
                          </select>
                        )}
                        {sl.link?.type === 'url' && (
                          <input type="url" inputMode="url" value={sl.link?.value || ''}
                            onChange={(e) => updSlide(i, { link: { ...sl.link, value: e.target.value } })}
                            placeholder="https://…  (opens in a new tab)"
                            style={{ flex: 1, padding: '8px 10px', borderRadius: 10, border: '1px solid var(--line)' }} />
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

            {/* ───────── USERS (loyalty customers) ───────── */}
            {tab === 'users' && (
              <div className="card" style={card}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <div className="group-title" style={{ margin: 0 }}>Users · loyalty members</div>
                  <button type="button" className="btn ghost" style={{ padding: '6px 12px', fontSize: 13 }} disabled={usersBusy} onClick={loadUsers}>{usersBusy ? 'Loading…' : (users === null ? 'Load' : 'Refresh')}</button>
                </div>
                <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>Everyone enrolled in your Square loyalty program — name, contact, points and when they joined. Pulled live from Square.</p>
                {users === null && !usersBusy && <p className="muted" style={{ fontSize: 13 }}>Tap Load to fetch your loyalty members.</p>}
                {users && users.length === 0 && <p className="muted" style={{ fontSize: 13 }}>No loyalty members yet.</p>}
                {users && users.length > 0 && (() => {
                  const fmtJoined = (iso) => iso ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
                  const now = Date.now();
                  const q = userQuery.trim().toLowerCase();
                  // filter
                  let rows = users.filter((u) => {
                    if (q && !`${u.name} ${u.phone} ${u.email}`.toLowerCase().includes(q)) return false;
                    if (userFilter === 'active' && !(u.points > 0)) return false;
                    if (userFilter === 'redeemers' && !(u.redemptions > 0)) return false;
                    if (userFilter === 'new' && !(u.enrolledAt && (now - new Date(u.enrolledAt).getTime()) <= 30 * 86400000)) return false;
                    return true;
                  });
                  // sort
                  const ts = (x) => x ? new Date(x).getTime() : 0;
                  rows = rows.slice().sort((a, b) => {
                    switch (userSort) {
                      case 'oldest': return ts(a.enrolledAt) - ts(b.enrolledAt);
                      case 'points': return (b.points || 0) - (a.points || 0);
                      case 'earned': return (b.lifetimePoints || 0) - (a.lifetimePoints || 0);
                      case 'redeemed': return (b.redemptions || 0) - (a.redemptions || 0) || (b.redeemedPoints || 0) - (a.redeemedPoints || 0);
                      default: return ts(b.enrolledAt) - ts(a.enrolledAt); // recent
                    }
                  });
                  const totalRedeemers = users.filter((u) => u.redemptions > 0).length;
                  const totalActive = users.filter((u) => u.points > 0).length;
                  const SEL = { padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 10, fontSize: 13 };
                  const chip = (key, label) => (
                    <button type="button" className={`chip ${userFilter === key ? 'on' : ''}`} onClick={() => setUserFilter(key)}>{label}</button>
                  );
                  return (
                    <>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '4px 0 8px' }}>
                        <input value={userQuery} onChange={(e) => setUserQuery(e.target.value)} placeholder="Search name / phone / email"
                          style={{ flex: 1, minWidth: 180, padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 10 }} />
                        <select value={userSort} onChange={(e) => setUserSort(e.target.value)} style={SEL} title="Sort">
                          <option value="recent">Newest joined</option>
                          <option value="oldest">Oldest joined</option>
                          <option value="points">Most points</option>
                          <option value="earned">Most earned (lifetime)</option>
                          <option value="redeemed">Most redemptions</option>
                        </select>
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
                        {chip('all', `All ${users.length}`)}
                        {chip('active', `Has points ${totalActive}`)}
                        {chip('redeemers', `Redeemed ${totalRedeemers}`)}
                        {chip('new', 'Joined ≤30 days')}
                        <span className="muted" style={{ fontSize: 13, fontWeight: 700, marginLeft: 'auto' }}>{rows.length} shown</span>
                      </div>
                      <div className="admin-users">
                        {rows.map((u) => (
                          <div key={u.id} className="user-row">
                            <div className="user-main">
                              <div className="user-name">{u.name || 'Guest'}</div>
                              <div className="muted" style={{ fontSize: 12.5 }}>{[u.phone, u.email].filter(Boolean).join(' · ') || '—'}</div>
                            </div>
                            <div className="user-meta">
                              <span className="user-pts">{u.points} pts</span>
                              <span className="muted" style={{ fontSize: 11.5 }}>
                                {u.lifetimePoints} earned{u.redemptions > 0 ? ` · ${u.redemptions} redeemed` : ''}
                              </span>
                              <span className="muted" style={{ fontSize: 11.5 }}>Joined {fmtJoined(u.enrolledAt)}</span>
                            </div>
                          </div>
                        ))}
                        {rows.length === 0 && <p className="muted" style={{ fontSize: 13 }}>No members match.</p>}
                      </div>
                    </>
                  );
                })()}
              </div>
            )}

            {/* ───────── COUPONS ───────── */}
            {tab === 'coupons' && (
              <div className="card" style={card}>
                <div className="group-title">Coupons</div>
                <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>Create codes customers type at checkout. The discount is applied to the Square order, so they only pay the reduced total. Remember to press <strong>Save changes</strong>.</p>
                {couponList.length === 0 && <p className="muted" style={{ fontSize: 13 }}>No coupons yet — add one below.</p>}
                {couponList.map((c, i) => (
                  <div key={i} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 12, marginBottom: 10 }}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <input value={c.code || ''} onChange={(e) => updCoupon(i, { code: e.target.value.toUpperCase().replace(/\s+/g, '') })} placeholder="CODE"
                        style={{ flex: '1 1 120px', minWidth: 0, padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 10, fontWeight: 700, letterSpacing: 0.5 }} />
                      <select value={c.type || 'percent'} onChange={(e) => updCoupon(i, { type: e.target.value })}
                        style={{ padding: 8, borderRadius: 10, border: '1px solid var(--line)' }}>
                        <option value="percent">% off</option>
                        <option value="amount">$ off</option>
                        <option value="comp">Free (100%)</option>
                      </select>
                      {c.type !== 'comp' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          {c.type === 'amount' && <span className="muted">$</span>}
                          <input inputMode="decimal" value={c.value ?? ''} onChange={(e) => updCoupon(i, { value: parseFloat(e.target.value) || 0 })}
                            style={{ width: 70, padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 10 }} />
                          {c.type === 'percent' && <span className="muted">%</span>}
                        </div>
                      )}
                      <button className="link" style={{ color: '#c0392b' }} onClick={() => rmCoupon(i)}>Remove</button>
                    </div>
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
                      <label style={{ ...row, fontSize: 13 }} className="muted">
                        <span>Expires</span>
                        <input type="date" value={c.expiry || ''} onChange={(e) => updCoupon(i, { expiry: e.target.value })}
                          style={{ padding: '6px 8px', border: '1px solid var(--line)', borderRadius: 10 }} />
                        {c.expiry && <button className="link" style={{ fontSize: 12, padding: 2 }} onClick={() => updCoupon(i, { expiry: '' })}>clear</button>}
                      </label>
                      <label style={{ ...row, cursor: 'pointer', fontSize: 13 }}>
                        <input type="checkbox" checked={c.active !== false} onChange={(e) => updCoupon(i, { active: e.target.checked })} />
                        <span>{c.active !== false ? 'Active' : 'Off'}</span>
                      </label>
                    </div>
                  </div>
                ))}
                <button className="btn ghost full" style={{ marginTop: 4 }} onClick={addCoupon}>+ Add coupon</button>
              </div>
            )}

            {/* ───────── PUSH (broadcast SMS / email) ───────── */}
            {tab === 'push' && (
              <div className="card" style={card}>
                <div className="group-title">Push · message your customers</div>
                <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
                  Send a message to everyone in your Square loyalty program. This web app can’t push to phone lock-screens (that needs a native app), so messages go out by SMS or email. Only message customers who’ve opted in.
                </p>

                {notifyStatus && !notifyStatus.sms && !notifyStatus.email && (
                  <p className="error-text" style={{ fontSize: 13 }}>No channels are set up yet. Add Twilio (SMS) and/or Resend (email) env vars in Railway to enable this.</p>
                )}

                <div className="segmented" style={{ maxWidth: 320, marginBottom: 12 }}>
                  <button type="button" className={push.channel === 'sms' ? 'seg active' : 'seg'} disabled={notifyStatus && !notifyStatus.sms}
                    onClick={() => setPush((p) => ({ ...p, channel: 'sms' }))} style={notifyStatus && !notifyStatus.sms ? { opacity: 0.5 } : undefined}>
                    SMS{notifyStatus && !notifyStatus.sms ? ' (off)' : ''}
                  </button>
                  <button type="button" className={push.channel === 'email' ? 'seg active' : 'seg'} disabled={notifyStatus && !notifyStatus.email}
                    onClick={() => setPush((p) => ({ ...p, channel: 'email' }))} style={notifyStatus && !notifyStatus.email ? { opacity: 0.5 } : undefined}>
                    Email{notifyStatus && !notifyStatus.email ? ' (off)' : ''}
                  </button>
                </div>

                {push.channel === 'email' && (
                  <label className="field" style={{ marginBottom: 10 }}><span>Subject</span>
                    <input value={push.subject} onChange={(e) => setPush((p) => ({ ...p, subject: e.target.value }))} placeholder="e.g. This weekend at Bean Culture" /></label>
                )}
                <label className="field" style={{ marginBottom: 10 }}><span>Message</span>
                  <textarea rows={4} value={push.message} onChange={(e) => setPush((p) => ({ ...p, message: e.target.value }))}
                    placeholder={push.channel === 'sms' ? 'Keep it short — SMS is billed per message.' : 'Your message…'} /></label>
                <label className="field" style={{ marginBottom: 12 }}><span>Link (optional)</span>
                  <input inputMode="url" value={push.link} onChange={(e) => setPush((p) => ({ ...p, link: e.target.value }))} placeholder="https://app.beanculture.com.au" /></label>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                  <span className="muted" style={{ fontSize: 12.5 }}>
                    {users === null ? 'Counting audience…' : `To ${users.length} loyalty member${users.length === 1 ? '' : 's'}${push.channel === 'sms' ? ` · ${users.filter((u) => u.phone).length} with a phone` : ` · ${users.filter((u) => u.email).length} with an email`}`}
                  </span>
                  <button className="btn" disabled={pushBusy || !push.message.trim() || (notifyStatus && !notifyStatus[push.channel])}
                    onClick={sendBroadcast}>{pushBusy ? 'Sending…' : `Send ${push.channel === 'sms' ? 'SMS' : 'email'}`}</button>
                </div>

                {pushResult && (
                  <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>
                    ✓ Sent to <strong>{pushResult.sent}</strong>{pushResult.skipped ? ` · ${pushResult.skipped} skipped (no ${push.channel === 'sms' ? 'phone' : 'email'})` : ''}{pushResult.failed ? ` · ${pushResult.failed} failed` : ''}.
                  </p>
                )}
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
              <>
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

                <div className="card" style={card}>
                  <div className="group-title">Festive &amp; seasonal themes</div>
                  <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
                    Auto-activate on their dates (a single day or a range). Guests can override. Each shows its banner
                    #1 in the hero while active. Adjust variable holidays (Easter, Lunar New Year, Mother’s/Father’s Day) each year.
                  </p>
                  <div className="admin-bannergrid">
                    {seasonalThemes.map((t, i) => {
                      const img = t.banner?.image || (typeof t.banner?.bg === 'string' && (t.banner.bg.match(/url\((['"]?)(.*?)\1\)/) || [])[2]) || '';
                      return (
                        <div key={i} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 10, opacity: t.enabled === false ? 0.6 : 1 }}>
                          <div style={{ ...row, justifyContent: 'space-between' }}>
                            <input value={t.name || ''} onChange={(e) => updSeasonal(i, { name: e.target.value })} style={{ flex: 1, minWidth: 0, fontWeight: 700, border: 'none', background: 'transparent', fontSize: 15 }} />
                            <label style={{ ...row, fontSize: 12 }} className="muted"><input type="checkbox" checked={t.enabled !== false} onChange={(e) => updSeasonal(i, { enabled: e.target.checked })} /> On</label>
                            {BUILTIN_SEASONAL.includes(t.id)
                              ? <span title="Built-in festive theme — turn it Off to hide it" style={{ width: 14 }} />
                              : <button className="link" style={{ color: '#c0392b' }} onClick={() => rmSeasonal(i)}>✕</button>}
                          </div>
                          <div style={{ ...row, marginTop: 6, gap: 8 }}>
                            <label className="field" style={{ flex: 1 }}><span>From</span><input type="date" value={`${seasonYear}-${t.from}`} onChange={(e) => e.target.value && updSeasonal(i, { from: e.target.value.slice(5) })} /></label>
                            <label className="field" style={{ flex: 1 }}><span>To</span><input type="date" value={`${seasonYear}-${t.to}`} onChange={(e) => e.target.value && updSeasonal(i, { to: e.target.value.slice(5) })} /></label>
                          </div>
                          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
                            {['brand', 'accent', 'bg', 'ink'].map((k) => (
                              <label key={k} style={{ ...row, fontSize: 11 }} className="muted"><span style={{ textTransform: 'capitalize' }}>{k}</span>
                                <input type="color" value={(t.theme && t.theme[k]) || '#000000'} onChange={(e) => updSeasonalTheme(i, k, e.target.value)} style={{ width: 30, height: 24, border: 'none', background: 'none' }} /></label>
                            ))}
                          </div>
                          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8, fontSize: 12 }} className="muted">
                            {['snow', 'hearts', 'petals', 'confetti'].map((fx) => (
                              <label key={fx} style={{ ...row }}><input type="checkbox" checked={!!(t.effects && t.effects[fx])} onChange={(e) => updSeasonal(i, { effects: { ...(t.effects || {}), [fx]: e.target.checked } })} /> {fx}</label>
                            ))}
                          </div>
                          <div style={{ marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
                            <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>Banner (shown #1 while active)</div>
                            {img && <img src={img} alt="" style={{ width: '100%', borderRadius: 8, marginBottom: 6 }} />}
                            <input value={t.banner?.title || ''} onChange={(e) => updSeasonalBanner(i, { title: e.target.value })} placeholder="Banner title" style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 10, marginBottom: 6 }} />
                            <input value={t.banner?.subtitle || ''} onChange={(e) => updSeasonalBanner(i, { subtitle: e.target.value })} placeholder="Subtitle" style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 10, marginBottom: 6 }} />
                            <div style={{ ...row, gap: 8 }}>
                              <input value={t.banner?.cta || ''} onChange={(e) => updSeasonalBanner(i, { cta: e.target.value })} placeholder="Button text" style={{ flex: 1, minWidth: 0, padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 10 }} />
                              <label className="btn ghost" style={{ padding: '8px 12px', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}>Image
                                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files[0]; if (f) uploadImage(f, (url) => updSeasonalBanner(i, { image: url, bg: `url(${url}) center/contain no-repeat` }), 'themes'); }} /></label>
                            </div>
                            {/* Destination — same options as the hero banners */}
                            <div style={{ ...row, gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                              <span className="muted" style={{ fontSize: 12 }}>Tapping goes to</span>
                              <select value={t.banner?.link?.type || 'scroll'} onChange={(e) => updSeasonalBanner(i, { link: { ...(t.banner?.link || {}), type: e.target.value } })} style={{ padding: 8, borderRadius: 10, border: '1px solid var(--line)' }}>
                                {LINK_TYPES.map((lt) => <option key={lt} value={lt}>{lt}</option>)}
                              </select>
                              {t.banner?.link?.type === 'category' && (
                                <select value={t.banner?.link?.value || ''} onChange={(e) => updSeasonalBanner(i, { link: { ...(t.banner?.link || {}), value: e.target.value } })} style={{ flex: 1, minWidth: 120, padding: 8, borderRadius: 10, border: '1px solid var(--line)' }}>
                                  <option value="">— category —</option>
                                  {cats.map((c) => <option key={c} value={c}>{c}</option>)}
                                </select>
                              )}
                              {t.banner?.link?.type === 'item' && (
                                <select value={t.banner?.link?.value || ''}
                                  onChange={(e) => { const opt = e.target.selectedOptions[0]; updSeasonalBanner(i, { link: { ...(t.banner?.link || {}), value: e.target.value, label: opt ? opt.text : '' } }); }}
                                  style={{ flex: 1, minWidth: 120, padding: 8, borderRadius: 10, border: '1px solid var(--line)' }}>
                                  <option value="">{adminCat.length ? '— pick a product —' : 'Loading products…'}</option>
                                  {adminCat.map((c) => (
                                    <optgroup key={c.category} label={c.category}>
                                      {c.items.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
                                    </optgroup>
                                  ))}
                                </select>
                              )}
                              {t.banner?.link?.type === 'url' && (
                                <input type="url" inputMode="url" value={t.banner?.link?.value || ''} onChange={(e) => updSeasonalBanner(i, { link: { ...(t.banner?.link || {}), value: e.target.value } })} placeholder="https://…" style={{ flex: 1, minWidth: 120, padding: '8px 10px', borderRadius: 10, border: '1px solid var(--line)' }} />
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <button className="btn ghost full" style={{ marginTop: 10 }} onClick={addSeasonal}>+ Add custom event theme</button>
                </div>
              </>
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
