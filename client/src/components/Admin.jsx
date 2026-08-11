import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { SlotIcon } from './icons.jsx';
import IconPicker from './IconPicker.jsx';
import HoursEditor from './HoursEditor.jsx';
import Insights from './Insights.jsx';
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

const BuildIcon = svg(<>
  <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.7 2.7-2-2 2.7-2.7z" />
</>);
const TABS = [
  { id: 'store', label: 'Store', Icon: StoreIcon },
  { id: 'insights', label: 'Insights', Icon: InsightsIcon },
  { id: 'menubuilder', label: 'Menu Builder', Icon: MenuIcon },
  { id: 'productbuilder', label: 'Product Builder', Icon: BuildIcon },
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
  const [secPickerOpen, setSecPickerOpen] = useState({}); // product-section id -> full catalog open
  const [srcOpen, setSrcOpen] = useState({}); // preset id -> source picker expanded
  const [srcShowAll, setSrcShowAll] = useState({}); // picker id -> show full list
  const [bannerOpen, setBannerOpen] = useState({}); // section name -> banner config open
  const [itemConfigs, setItemConfigs] = useState({}); // itemId -> full config for the builder
  const [srcSearch, setSrcSearch] = useState({}); // picker id -> search text
  const [srcCat, setSrcCat] = useState({});       // picker id -> category filter
  const [genItemId, setGenItemId] = useState(''); // quick-generate: chosen source item
  const [genSelected, setGenSelected] = useState(() => new Set()); // quick-generate: multi-select item ids
  const [combineSel, setCombineSel] = useState(() => new Set()); // preset ids selected to combine
  const [syncBusy, setSyncBusy] = useState(false); // product-builder sync running
  const [genSection, setGenSection] = useState('Breakfast'); // quick-generate: target section
  const [genBusy, setGenBusy] = useState(false);
  const [menuSub, setMenuSub] = useState('categories'); // Menu tab sub-section
  const [collapsedSecs, setCollapsedSecs] = useState({}); // preset section name -> collapsed
  const [deleteLock, setDeleteLock] = useState(true); // guard against accidental section deletes
  const [removedCats, setRemovedCats] = useState(() => new Set()); // categories removed this session
  const [drag, setDrag] = useState(null);       // { list, index } being dragged
  const [dragOver, setDragOver] = useState(null); // `${list}:${index}` currently hovered
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
  const [insCustomers, setInsCustomers] = useState(null); // loyalty members for Top customers
  const [insRefreshing, setInsRefreshing] = useState(false);
  const [insSync, setInsSync] = useState(null); // Date of last successful insights load
  const [msgs, setMsgs] = useState(null);
  const [resv, setResv] = useState(null);
  const [resvChannels, setResvChannels] = useState({});
  const [newClosure, setNewClosure] = useState({ date: '', annual: false, label: '' });
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  // Reload every Insights data source: analytics + Square dashboard + loyalty members.
  function reloadInsights() {
    setInsRefreshing(true);
    setAnalytics(null);
    setDashboard(null);
    const aP = fetch(`/api/admin/analytics?days=${aDays}&pass=${encodeURIComponent(pass)}`)
      .then((r) => r.json()).then((d) => setAnalytics(d.analytics || { empty: true }))
      .catch(() => { setAnalytics({ error: true }); throw new Error('analytics'); });
    const dP = api.adminDashboard(pass, aDays).then(setDashboard)
      .catch(() => { setDashboard({ error: true }); throw new Error('dashboard'); });
    const cP = api.adminCustomers(pass).then((d) => setInsCustomers((d && d.users) || []))
      .catch(() => { setInsCustomers([]); throw new Error('customers'); });
    Promise.allSettled([aP, dP, cP]).then((res) => {
      if (res.some((r) => r.status === 'fulfilled')) setInsSync(new Date());
      setInsRefreshing(false);
    });
  }

  // Load analytics when the Insights tab is opened / period changes.
  useEffect(() => {
    if (tab !== 'insights') return;
    reloadInsights();
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
  // Fetch the full config (variations + modifiers) for any item used by a preset.
  useEffect(() => {
    const ids = [...new Set((s?.presets || []).map((p) => p.sourceItemId).filter(Boolean))];
    ids.forEach((id) => {
      if (itemConfigs[id]) return;
      fetch(`/api/admin/item-config?id=${encodeURIComponent(id)}&pass=${encodeURIComponent(pass)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d && d.item) setItemConfigs((x) => ({ ...x, [id]: d.item })); })
        .catch(() => {});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s?.presets]);
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
      ...((s?.presets || []).map((p) => (p.section || '').trim()).filter(Boolean)),
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
    // Nothing hardcoded: an empty selection means no categories are shown.
    if (raw.length === 0) return new Set();
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
  // Remove a category from the app entirely (from Menu items offered), by display
  // name — drops every matching Square category id from menuCategories.
  const removeCategoryFromApp = (displayName) => {
    const ids = new Set(selectedCatIds);
    for (const cc of allCats) {
      if ((cc.name || '').toLowerCase() === displayName.toLowerCase() || (cc.rawName || '').toLowerCase() === displayName.toLowerCase()) ids.delete(cc.id);
    }
    set({ menuCategories: [...ids] });
    setRemovedCats((prev) => new Set(prev).add(displayName.toLowerCase()));
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

  // ---- product builder presets (named hot-links into one variable item) ----
  const presets = s?.presets || [];
  const setPresets = (arr) => set({ presets: arr });
  const addPreset = () =>
    setPresets([...presets, { id: 'pre' + Date.now().toString(36), name: 'New preset', section: 'Breakfast', sourceItemId: '', variationId: '', groups: {}, showImages: true }]);
  const updPreset = (id, patch) => setPresets(presets.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const rmPreset = (id) => setPresets(presets.filter((x) => x.id !== id));
  // Cycle a modifier through Off → Show → Default → Lock → Off for a preset.
  const CYCLE = { undefined: 'optional', off: 'optional', optional: 'default', default: 'locked', locked: undefined };
  const cyclePresetMod = (presetId, groupId, modId) =>
    setPresets(presets.map((p) => {
      if (p.id !== presetId) return p;
      const groups = { ...(p.groups || {}) };
      const g = { ...(groups[groupId] || {}) };
      const next = CYCLE[g[modId] || 'off'];
      if (next) g[modId] = next; else delete g[modId];
      if (Object.keys(g).length) groups[groupId] = g; else delete groups[groupId];
      return { ...p, groups };
    }));
  // ---- generic drag-and-drop reordering (works alongside the ↑/↓ buttons) ----
  const reorderArray = (arr, from, to) => { const a = [...arr]; const [x] = a.splice(from, 1); a.splice(to, 0, x); return a; };
  const dragHandle = (list, index) => ({
    className: 'drag-handle', draggable: true, title: 'Drag to reorder', role: 'button', 'aria-label': 'Drag to reorder',
    onDragStart: (e) => { setDrag({ list, index }); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', String(index)); } catch (err) {} },
    onDragEnd: () => { setDrag(null); setDragOver(null); },
  });
  const dropZone = (list, index, onReorder) => ({
    onDragOver: (e) => { if (drag && drag.list === list) { e.preventDefault(); if (dragOver !== `${list}:${index}`) setDragOver(`${list}:${index}`); } },
    onDragLeave: () => setDragOver((k) => (k === `${list}:${index}` ? null : k)),
    onDrop: (e) => { e.preventDefault(); if (drag && drag.list === list && drag.index !== index) onReorder(drag.index, index); setDrag(null); setDragOver(null); },
  });
  const isDragOver = (list, index) => dragOver === `${list}:${index}`;
  // Presets displayed grouped by section; this order is also what drag reorders.
  const presetsSorted = [...presets].sort((a, b) => (a.section || '').localeCompare(b.section || ''));
  // Per-section top/footer nav inclusion (product-builder sections).
  const presetSectionNav = s?.presetSectionNav || {};
  const setSectionNav = (name, patch) => set({ presetSectionNav: { ...presetSectionNav, [name]: { ...(presetSectionNav[name] || {}), ...patch } } });
  // Existing section names offered as quick-pick chips (or type a new one).
  const existingSectionNames = [...new Set([
    ...presets.map((p) => (p.section || '').trim()),
    ...(s?.productSections || []).map((p) => (p.name || '').trim()),
    ...adminCat.map((c) => c.category),
  ].filter(Boolean))].sort();
  const renderSectionChips = (current, onPick) => (
    existingSectionNames.length ? (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
        {existingSectionNames.map((n) => (
          <button key={n} type="button" onClick={() => onPick(n)}
            className={`chip ${current && String(current).toLowerCase() === n.toLowerCase() ? 'on' : ''}`}
            style={{ fontSize: 'var(--fs-xs)', padding: '4px 8px' }}>{n}</button>
        ))}
      </div>
    ) : null
  );

  const newPresetId = () => 'pre' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const presetVids = (p) => (Array.isArray(p.variationIds) && p.variationIds.length ? p.variationIds : [p.variationId].filter(Boolean));
  const isCombined = (p) => presetVids(p).length > 1;
  const toggleCombineSel = (id) => setCombineSel((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  // Merge the given tiles (must share a source item) into one tile with a size toggle.
  const combinePresets = (ids) => {
    const chosen = presets.filter((p) => ids.includes(p.id));
    if (chosen.length < 2) return;
    const src = chosen[0].sourceItemId;
    if (!chosen.every((p) => p.sourceItemId === src)) { alert('Combine only works on tiles built from the SAME source product.'); return; }
    const vids = [];
    for (const p of chosen) for (const v of presetVids(p)) if (v && !vids.includes(v)) vids.push(v);
    const cfg = itemConfigs[src];
    const base = chosen[0];
    const combined = { ...base, id: newPresetId(), variationId: vids[0], variationIds: vids, name: cfg?.name || base.name };
    const anchor = presets.findIndex((p) => p.id === base.id);
    const remaining = presets.filter((p) => !ids.includes(p.id));
    remaining.splice(Math.min(Math.max(0, anchor), remaining.length), 0, combined);
    setPresets(remaining);
    setCombineSel((prev) => { const n = new Set(prev); ids.forEach((id) => n.delete(id)); return n; });
  };
  // Split a combined tile back into one tile per variation.
  const splitPreset = (id) => {
    const idx = presets.findIndex((p) => p.id === id);
    if (idx < 0) return;
    const p = presets[idx];
    const cfg = itemConfigs[p.sourceItemId];
    const parts = presetVids(p).map((vid, i) => {
      const v = cfg && cfg.variations.find((x) => x.id === vid);
      return { ...p, id: i === 0 ? p.id : newPresetId(), variationId: vid, variationIds: undefined, name: (v && v.name) || p.name };
    });
    const arr = [...presets]; arr.splice(idx, 1, ...parts); setPresets(arr);
  };
  // Sync the product builder with Square: add tiles for newly-added variations,
  // drop variations that were deleted (prices are already live from Square).
  async function syncBuilder() {
    setSyncBusy(true);
    setSyncMsg('Syncing with Square…');
    try {
      const sourceIds = [...new Set(presets.map((p) => p.sourceItemId).filter(Boolean))];
      const configs = {};
      // Fetch FRESH from Square (bypass the cached configs) so newly-added
      // variations are seen; also refresh the cache for the editors.
      for (const id of sourceIds) {
        try {
          const r = await fetch(`/api/admin/item-config?id=${encodeURIComponent(id)}&pass=${encodeURIComponent(pass)}`);
          if (r.ok) { const d = await r.json(); if (d && d.item) configs[id] = d.item; }
        } catch (err) { /* skip this item */ }
      }
      if (Object.keys(configs).length) setItemConfigs((x) => ({ ...x, ...configs }));
      const coveredBySource = {};
      const sectionBySource = {};
      for (const p of presets) {
        if (!coveredBySource[p.sourceItemId]) coveredBySource[p.sourceItemId] = new Set();
        presetVids(p).forEach((v) => coveredBySource[p.sourceItemId].add(v));
        if (!sectionBySource[p.sourceItemId]) sectionBySource[p.sourceItemId] = p.section || 'Specials';
      }
      let removedDead = 0, trimmed = 0;
      const reconciled = [];
      for (const p of presets) {
        const cfg = configs[p.sourceItemId];
        if (!cfg) { reconciled.push(p); continue; }
        const alive = presetVids(p).filter((vid) => cfg.variations.some((v) => v.id === vid));
        if (!alive.length) { removedDead++; continue; }
        if (alive.length !== presetVids(p).length) trimmed++;
        reconciled.push({ ...p, variationId: alive[0], variationIds: alive.length > 1 ? alive : undefined });
      }
      // A product you've already combined (size toggle) auto-absorbs its new
      // sizes; everything else adds as a separate tile.
      const combinedForSource = {};
      for (const p of reconciled) if (isCombined(p) && !combinedForSource[p.sourceItemId]) combinedForSource[p.sourceItemId] = p;
      const added = []; let extended = 0;
      for (const id of sourceIds) {
        const cfg = configs[id]; if (!cfg) continue;
        const covered = coveredBySource[id] || new Set();
        for (const v of cfg.variations) {
          if (covered.has(v.id)) continue;
          covered.add(v.id);
          const combo = combinedForSource[id];
          if (combo) { combo.variationIds = [...presetVids(combo), v.id]; combo.variationId = combo.variationIds[0]; extended++; }
          else { reconciled.push({ id: newPresetId(), name: v.name || cfg.name, section: sectionBySource[id] || 'Specials', sourceItemId: id, variationId: v.id, groups: {}, showImages: true }); added.push(v.name || cfg.name); }
        }
      }
      setPresets(reconciled);
      const parts = [added.length ? `added ${added.length} new tile(s) (${added.slice(0, 4).join(', ')}${added.length > 4 ? '…' : ''})` : 'no new tiles'];
      if (extended) parts.push(`added ${extended} new size(s) to combined tile(s)`);
      if (removedDead) parts.push(`removed ${removedDead} tile(s) whose variation was deleted`);
      if (trimmed) parts.push(`trimmed ${trimmed} combined tile(s)`);
      setSyncMsg(`Sync: ${parts.join('; ')}. Prices update automatically. Press Save changes to keep new/removed tiles.`);
    } catch (e) {
      setSyncMsg('Sync failed: ' + (e.message || 'unknown error'));
    } finally { setSyncBusy(false); }
  }
  // Toggle which variations a combined tile offers.
  const toggleVariationId = (pid, vid) => setPresets(presets.map((p) => {
    if (p.id !== pid) return p;
    const cur = presetVids(p);
    const next = cur.includes(vid) ? cur.filter((x) => x !== vid) : [...cur, vid];
    if (!next.length) return p;
    return { ...p, variationIds: next, variationId: next[0] };
  }));
  // Duplicate a preset right below itself (name + " copy") so you can quickly
  // spin off variants and just tweak the name/options.
  const dupPreset = (id) => {
    const i = presets.findIndex((x) => x.id === id);
    if (i < 0) return;
    const src = presets[i];
    const copy = { ...src, id: newPresetId(), name: (src.name || '') + ' copy', groups: JSON.parse(JSON.stringify(src.groups || {})) };
    const arr = [...presets];
    arr.splice(i + 1, 0, copy);
    setPresets(arr);
  };
  // Ensure an item's config is loaded, returning it.
  async function ensureItemConfig(id) {
    if (!id) return null;
    if (itemConfigs[id]) return itemConfigs[id];
    const r = await fetch(`/api/admin/item-config?id=${encodeURIComponent(id)}&pass=${encodeURIComponent(pass)}`);
    if (!r.ok) return null;
    const d = await r.json();
    if (d && d.item) { setItemConfigs((x) => ({ ...x, [id]: d.item })); return d.item; }
    return null;
  }
  // Quick generate: one preset per variation of the chosen item (locked to that
  // variation, no options yet — tweak/duplicate after).
  async function generatePresets() {
    const ids = [...genSelected];
    if (!ids.length) return;
    setGenBusy(true);
    try {
      const section = (genSection || '').trim() || 'Specials';
      const made = [];
      for (const id of ids) {
        const cfg = await ensureItemConfig(id);
        if (!cfg || !cfg.variations.length) continue;
        const multi = cfg.variations.length > 1;
        for (const v of cfg.variations) {
          const nm = (v.name && v.name.trim()) ? (multi && !v.name.toLowerCase().includes(cfg.name.toLowerCase()) ? `${cfg.name} ${v.name}` : v.name) : cfg.name;
          made.push({ id: newPresetId(), name: nm, section, sourceItemId: id, variationId: v.id, groups: {}, showImages: true });
        }
      }
      if (made.length) setPresets([...presets, ...made]);
      setGenSelected(new Set());
    } finally { setGenBusy(false); }
  }
  // Multi-select source picker for the generator (tick items / select all).
  function renderGenPicker() {
    const pickerId = 'gen';
    const q = (srcSearch[pickerId] || '').toLowerCase();
    const catf = srcCat[pickerId] || '';
    const list = allProducts.filter((p) => {
      const cats = p.categories || (p.category ? [p.category] : []);
      if (catf && !cats.some((c) => c.toLowerCase() === catf.toLowerCase())) return false;
      if (q && !(p.name.toLowerCase().includes(q) || cats.join(' ').toLowerCase().includes(q))) return false;
      return true;
    });
    const showList = !!q || !!catf || !!srcShowAll[pickerId];
    const allSelected = list.length > 0 && list.every((p) => genSelected.has(p.id));
    const toggleAll = () => setGenSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) list.forEach((p) => next.delete(p.id)); else list.forEach((p) => next.add(p.id));
      return next;
    });
    const toggleOne = (id) => setGenSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    return (
      <div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
          <input placeholder="Search items…" value={srcSearch[pickerId] || ''} onChange={(e) => setSrcSearch((x) => ({ ...x, [pickerId]: e.target.value }))}
            style={{ flex: '1 1 150px', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 10 }} />
          <select value={catf} onChange={(e) => setSrcCat((x) => ({ ...x, [pickerId]: e.target.value }))}
            style={{ padding: 8, borderRadius: 10, border: '1px solid var(--line)' }}>
            <option value="">All categories</option>
            {productCategories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {!showList ? (
          <button className="link" onClick={() => setSrcShowAll((x) => ({ ...x, [pickerId]: true }))} style={{ fontSize: 'var(--fs-base)' }}>Show all items…</button>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 4 }}>
              <button className="link" onClick={toggleAll}>{allSelected ? 'Clear all' : `Select all (${list.length})`}</button>
              {genSelected.size > 0 && <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{genSelected.size} selected</span>}
            </div>
            <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>
              {allProducts.length === 0 && <p className="muted" style={{ fontSize: 'var(--fs-sm)', padding: 8 }}>Loading items…</p>}
              {list.length === 0 && allProducts.length > 0 && <p className="muted" style={{ fontSize: 'var(--fs-sm)', padding: 8 }}>No matching items.</p>}
              {list.map((p) => {
                const cats = p.categories || (p.category ? [p.category] : []);
                return (
                  <label key={p.id} style={{ display: 'flex', width: '100%', gap: 8, alignItems: 'center', padding: '6px 8px', borderBottom: '1px solid var(--line)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={genSelected.has(p.id)} onChange={() => toggleOne(p.id)} />
                    {p.image
                      ? <img src={p.image} alt="" style={{ width: 30, height: 30, borderRadius: 6, objectFit: 'cover', flex: 'none' }} />
                      : <span style={{ width: 30, height: 30, borderRadius: 6, background: 'var(--brand-soft)', flex: 'none', display: 'grid', placeItems: 'center', fontSize: 'var(--fs-md)' }}>🍽️</span>}
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 'var(--fs-md)', display: 'block' }}>{p.name}</span>
                      {cats.length ? <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>{cats.join(' · ')}</span> : null}
                    </span>
                  </label>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
  }

  // ---- shared searchable source-item picker (used by generator + presets) ----
  const productCategories = [...new Set(allProducts.flatMap((p) => p.categories || (p.category ? [p.category] : [])))].sort();
  function renderSourcePicker(pickerId, currentId, onPick) {
    const q = (srcSearch[pickerId] || '').toLowerCase();
    const catf = srcCat[pickerId] || '';
    const list = allProducts.filter((p) => {
      const cats = p.categories || (p.category ? [p.category] : []);
      if (catf && !cats.some((c) => c.toLowerCase() === catf.toLowerCase())) return false;
      if (q && !(p.name.toLowerCase().includes(q) || cats.join(' ').toLowerCase().includes(q))) return false;
      return true;
    });
    const current = allProducts.find((p) => p.id === currentId);
    // Keep the list hidden until you search, pick a category, or press "show all".
    const showList = !!q || !!catf || !!srcShowAll[pickerId];
    return (
      <div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
          <input placeholder="Search items…" value={srcSearch[pickerId] || ''} onChange={(e) => setSrcSearch((x) => ({ ...x, [pickerId]: e.target.value }))}
            style={{ flex: '1 1 150px', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 10 }} />
          <select value={catf} onChange={(e) => setSrcCat((x) => ({ ...x, [pickerId]: e.target.value }))}
            style={{ padding: 8, borderRadius: 10, border: '1px solid var(--line)' }}>
            <option value="">All categories</option>
            {productCategories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {current && <div className="muted" style={{ fontSize: 'var(--fs-sm)', marginBottom: 4 }}>Selected: <strong>{current.name}</strong>{(current.categories || []).length ? ` · in ${current.categories.join(', ')}` : ''}</div>}
        {!showList ? (
          <button className="link" onClick={() => setSrcShowAll((x) => ({ ...x, [pickerId]: true }))} style={{ fontSize: 'var(--fs-base)' }}>Show all items…</button>
        ) : (
          <>
            {srcShowAll[pickerId] && !q && !catf && (
              <button className="link" onClick={() => setSrcShowAll((x) => ({ ...x, [pickerId]: false }))} style={{ fontSize: 'var(--fs-sm)', marginBottom: 4 }}>▲ Hide list</button>
            )}
            <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>
              {allProducts.length === 0 && <p className="muted" style={{ fontSize: 'var(--fs-sm)', padding: 8 }}>Loading items…</p>}
              {list.length === 0 && allProducts.length > 0 && <p className="muted" style={{ fontSize: 'var(--fs-sm)', padding: 8 }}>No matching items.</p>}
              {list.map((p) => {
                const cats = p.categories || (p.category ? [p.category] : []);
                return (
                  <button key={p.id} onClick={() => onPick(p.id)} type="button"
                    style={{ display: 'flex', width: '100%', textAlign: 'left', gap: 8, alignItems: 'center', padding: '6px 8px', border: 'none', borderBottom: '1px solid var(--line)', background: currentId === p.id ? 'var(--brand-soft)' : 'transparent', cursor: 'pointer' }}>
                    {p.image
                      ? <img src={p.image} alt="" style={{ width: 30, height: 30, borderRadius: 6, objectFit: 'cover', flex: 'none' }} />
                      : <span style={{ width: 30, height: 30, borderRadius: 6, background: 'var(--brand-soft)', flex: 'none', display: 'grid', placeItems: 'center', fontSize: 'var(--fs-md)' }}>🍽️</span>}
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 'var(--fs-md)', display: 'block' }}>{p.name}</span>
                      {cats.length ? <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>{cats.join(' · ')}</span> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
  }

  // ---- hide/show whole sections by name (from "Menu items offered") ----
  const hiddenSections = s?.hiddenSections || [];
  const isSectionHidden = (name) => hiddenSections.some((n) => n.toLowerCase() === String(name).toLowerCase());
  const toggleSectionHidden = (name) => set({
    hiddenSections: isSectionHidden(name)
      ? hiddenSections.filter((n) => n.toLowerCase() !== String(name).toLowerCase())
      : [...hiddenSections, name],
  });

  // ---- menu section order (storefront): categories, product sections AND
  // product-builder sections. Everything is ordered by s.menuOrder (display
  // names). Anything not yet in that list falls to the end.
  const menuOrder = s?.menuOrder || [];
  const orderRank = (name) => {
    const i = menuOrder.findIndex((n) => String(n).toLowerCase() === String(name).toLowerCase());
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const visibleCats = adminCat.filter((c) => !removedCats.has((c.category || '').toLowerCase()));
  const unitNamesLower = new Set([
    ...visibleCats.map((c) => c.category.toLowerCase()),
    ...productSections.map((ps) => (ps.name || '').toLowerCase()),
  ]);
  // Only LIVE builder sections (Top or Footer enabled) appear in this list — it
  // reflects exactly what's on the storefront. Enable a section in Product builder.
  const presetSectionUnits = [...new Set(presets.map((p) => (p.section || '').trim()).filter(Boolean))]
    .filter((name) => !unitNamesLower.has(name.toLowerCase()))
    .filter((name) => { const nav = presetSectionNav[name] || {}; return nav.top === true || nav.footer === true; })
    .map((name) => ({ type: 'presetsec', name, count: presets.filter((p) => (p.section || '').trim().toLowerCase() === name.toLowerCase()).length }));
  const orderedUnits = [
    ...visibleCats.map((c) => ({ type: 'cat', name: c.category, cat: c })),
    ...productSections.map((ps) => ({ type: 'section', name: ps.name || '', section: ps })),
    ...presetSectionUnits,
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
            ? <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>⚠ DB off — changes won’t persist</span>
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
                  <div className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{h.timezone} · {h.hasHours ? 'hours from Square' : 'no hours set in Square'}</div>
                  <button className="btn full" style={{ marginTop: 12 }} onClick={syncNow}>Sync menu from Square now</button>
                  {syncMsg && <p className="muted" style={{ fontSize: 'var(--fs-base)', margin: '6px 0 0' }}>{syncMsg}</p>}
                </div>
                <div className="card" style={card}>
                  <div className="group-title">Store details</div>
                  <label className="field"><span>Store name</span><input value={s.storeName || ''} onChange={(e) => set({ storeName: e.target.value })} /></label>
                  <label className="field" style={{ marginTop: 10 }}><span>Announcement bar (blank = hidden)</span>
                    <input value={s.announcement || ''} onChange={(e) => set({ announcement: e.target.value })} placeholder="e.g. Public holiday hours today" /></label>
                </div>

                <div className="card" style={card}>
                  <div className="group-title">Contact &amp; location</div>
                  <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 0 }}>Shown on the storefront with tap-to-call and directions (both tracked in Insights).</p>
                  <label className="field"><span>Address</span><input value={s.contact?.address || ''} onChange={(e) => setContact('address', e.target.value)} placeholder="123 Main St, Suburb NSW" /></label>
                  <label className="field" style={{ marginTop: 10 }}><span>Phone</span><input value={s.contact?.phone || ''} onChange={(e) => setContact('phone', e.target.value)} placeholder="+61 2 1234 5678" /></label>
                  <label className="field" style={{ marginTop: 10 }}><span>Map link (optional — built from the address if blank)</span><input value={s.contact?.mapsUrl || ''} onChange={(e) => setContact('mapsUrl', e.target.value)} placeholder="https://maps.google.com/…" /></label>
                </div>

                <div className="card" style={card}>
                  <div className="group-title">Branding</div>
                  {!data.cloudinary && <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 0 }}>Add Cloudinary keys in Railway to upload images.</p>}
                  <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                    <div>
                      <div className="muted" style={{ fontSize: 'var(--fs-sm)', marginBottom: 6 }}>Logo (header)</div>
                      <div style={{ ...row }}>
                        {s.logoUrl ? <img src={s.logoUrl} alt="" style={{ height: 34, background: '#f6eef1', borderRadius: 6 }} /> : <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Default</span>}
                        <label className="btn ghost" style={{ padding: '8px 12px', fontSize: 'var(--fs-base)', cursor: 'pointer' }}>Upload<input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files[0]; if (f) uploadImage(f, (url) => set({ logoUrl: url }), 'logo'); }} /></label>
                        {s.logoUrl && <button className="link" style={{ color: '#c0392b' }} onClick={() => set({ logoUrl: '' })}>Reset</button>}
                      </div>
                    </div>
                    <div>
                      <div className="muted" style={{ fontSize: 'var(--fs-sm)', marginBottom: 6 }}>Favicon (browser tab)</div>
                      <div style={{ ...row }}>
                        {s.faviconUrl ? <img src={s.faviconUrl} alt="" style={{ height: 28, width: 28, borderRadius: 6 }} /> : <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Default</span>}
                        <label className="btn ghost" style={{ padding: '8px 12px', fontSize: 'var(--fs-base)', cursor: 'pointer' }}>Upload<input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files[0]; if (f) uploadImage(f, (url) => set({ faviconUrl: url }), 'favicon'); }} /></label>
                        {s.faviconUrl && <button className="link" style={{ color: '#c0392b' }} onClick={() => set({ faviconUrl: '' })}>Reset</button>}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="card" style={card}>
                  <div className="group-title">Store page</div>
                  <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 0 }}>The About / contact page customers reach from the store button in the header. Opening hours and address/phone come from Square + Contact above.</p>
                  <div style={{ ...row, marginBottom: 10 }}>
                    <div className="muted" style={{ fontSize: 'var(--fs-sm)', minWidth: 92 }}>Store photo</div>
                    {s.storePhoto ? <img src={s.storePhoto} alt="" style={{ height: 44, borderRadius: 8 }} /> : <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>None</span>}
                    <label className="btn ghost" style={{ padding: '8px 12px', fontSize: 'var(--fs-base)', cursor: 'pointer' }}>Upload<input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files[0]; if (f) uploadImage(f, (url) => set({ storePhoto: url }), 'store'); }} /></label>
                    {s.storePhoto && <button className="link" style={{ color: '#c0392b' }} onClick={() => set({ storePhoto: '' })}>Remove</button>}
                  </div>
                  <label className="field"><span>Bio / about</span><textarea rows={3} value={s.bio || ''} onChange={(e) => set({ bio: e.target.value })} placeholder="A short story about your café…" /></label>
                  <label className="field" style={{ marginTop: 10 }}><span>Google review link</span><input value={s.googleReviewUrl || ''} onChange={(e) => set({ googleReviewUrl: e.target.value })} placeholder="https://g.page/r/…/review" /></label>
                  <label className="field" style={{ marginTop: 10 }}><span>“Support us” message (optional)</span><textarea rows={2} value={s.supportMessage || ''} onChange={(e) => set({ supportMessage: e.target.value })} placeholder="Leave blank for a friendly default." /></label>
                </div>

                <div className="card" style={card}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div className="group-title" style={{ margin: 0 }}>Customer messages</div>
                    <button type="button" className="btn ghost" style={{ padding: '6px 12px', fontSize: 'var(--fs-base)' }} onClick={loadMessages}>{msgs === null ? 'Load' : 'Refresh'}</button>
                  </div>
                  <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 4 }}>Enquiries, feedback and catering requests sent from the store page.</p>
                  {msgs === null && <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Tap Load to see messages.</p>}
                  {msgs && msgs.length === 0 && <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>No messages yet.</p>}
                  {msgs && msgs.map((m) => (
                    <div key={m.id} className="history-item" style={{ opacity: m.handled ? 0.55 : 1 }}>
                      <div className="history-top">
                        <span><span className="pill" style={{ textTransform: 'capitalize' }}>{m.type}</span> {m.name || 'Anonymous'}</span>
                        <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{new Date(m.createdAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}</span>
                      </div>
                      {m.contact && <div className="muted" style={{ fontSize: 'var(--fs-sm)', margin: '2px 0' }}>{m.contact}</div>}
                      <div style={{ fontSize: 'var(--fs-md)', whiteSpace: 'pre-line' }}>{m.body}</div>
                      <button className="link" style={{ padding: 0, fontSize: 'var(--fs-base)' }} onClick={() => toggleHandled(m)}>{m.handled ? 'Mark unread' : 'Mark done'}</button>
                    </div>
                  ))}
                </div>

                <div className="card" style={card}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div className="group-title" style={{ margin: 0 }}>Reservations</div>
                    <button type="button" className="btn ghost" style={{ padding: '6px 12px', fontSize: 'var(--fs-base)' }} onClick={loadReservations}>{resv === null ? 'Load' : 'Refresh'}</button>
                  </div>
                  <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 4 }}>
                    Table bookings from the app. Alerts: {resvChannels.sms ? 'SMS on' : 'SMS off'} · {resvChannels.email ? 'email on' : 'email off'}. Each booking also creates a $0 Square order so it prints + shows in Square.
                  </p>
                  {resv === null && <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Tap Load to see reservations.</p>}
                  {resv && resv.length === 0 && <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>No reservations yet.</p>}
                  {resv && resv.map((r) => (
                    <div key={r.id} className="history-item" style={{ opacity: r.status === 'cancelled' ? 0.5 : 1 }}>
                      <div className="history-top">
                        <span><strong>{r.party} {r.party === 1 ? 'guest' : 'guests'}</strong> · {r.name || '—'}</span>
                        <span className={`pill`} style={{ textTransform: 'capitalize', background: r.status === 'confirmed' ? '#e6f6ec' : r.status === 'seated' ? '#eef' : r.status === 'cancelled' ? '#fdecec' : '#f4eef1' }}>{r.status}</span>
                      </div>
                      <div className="muted" style={{ fontSize: 'var(--fs-base)', margin: '3px 0' }}>
                        {r.reserveAt ? new Date(r.reserveAt).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—'} · {r.phone || ''}{r.email ? ` · ${r.email}` : ''}
                      </div>
                      {r.notes && <div style={{ fontSize: 'var(--fs-base)' }}>{r.notes}</div>}
                      <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
                        {['confirmed', 'seated', 'cancelled'].filter((st) => st !== r.status).map((st) => (
                          <button key={st} className="link" style={{ padding: 0, fontSize: 'var(--fs-base)', textTransform: 'capitalize', color: st === 'cancelled' ? '#c0392b' : undefined }} onClick={() => setResvStatus(r, st)}>Mark {st}</button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="card" style={card}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                    <div className="group-title" style={{ margin: 0 }}>Opening hours</div>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-base)' }} className="muted">
                      <input type="checkbox" checked={!!s.useAppHours} onChange={(e) => set({ useAppHours: e.target.checked })} /> Set my own hours (override Square)
                    </label>
                  </div>
                  <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 4 }}>
                    {s.useAppHours ? 'These hours decide when the app is open and when customers can order “now”.' : 'Currently using your Square location hours. Tick above to set hours here instead.'}
                  </p>
                  {s.useAppHours && <HoursEditor value={s.storeHours} onChange={(v) => set({ storeHours: v })} />}
                </div>

                <div className="card" style={card}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                    <div className="group-title" style={{ margin: 0 }}>Kitchen hours</div>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-base)' }} className="muted">
                      <input type="checkbox" checked={!!s.kitchenHoursOn} onChange={(e) => set({ kitchenHoursOn: e.target.checked })} /> Kitchen has its own hours
                    </label>
                  </div>
                  <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 4 }}>
                    Made-to-order categories are only available while the kitchen is open. Everything else (pre-made / fridge items) stays available whenever the store is open. Leave off to keep the kitchen open whenever the store is.
                  </p>
                  {s.kitchenHoursOn && (
                    <>
                      <HoursEditor value={s.kitchenHours} onChange={(v) => set({ kitchenHours: v })} />
                      <div className="group-title" style={{ marginTop: 14, fontSize: 'var(--fs-base)' }}>Made-to-order categories</div>
                      <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 0 }}>Tick the categories the kitchen makes on demand. These go unavailable when the kitchen closes.</p>
                      {cats.length === 0 && <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>No categories loaded yet.</p>}
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
                  <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 0 }}>Annual leave, public holidays. Closed days can’t be booked for pre-orders. Use a range for multi-day closures (e.g. late Dec – mid Jan). Tick “every year” for recurring dates.</p>
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
              <Insights days={aDays} onDays={setADays} dashboard={dashboard} analytics={analytics} customers={insCustomers} refreshing={insRefreshing} onRefresh={reloadInsights} lastSync={insSync} />
            )}

            {/* ───────── MENU ───────── */}
            {tab === 'menubuilder' && (
              <>
                {false && (
                <div className="card" style={card}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div className="group-title" style={{ margin: 0 }}>Categories in Menu</div>
                    <button type="button" className={`chip ${catsLocked ? 'on' : ''}`} onClick={() => setCatsLocked((v) => !v)}
                      style={{ fontSize: 'var(--fs-sm)' }} title={catsLocked ? 'Locked — tap to make changes' : 'Unlocked — tap to lock'}>
                      {catsLocked ? '🔒 Locked' : '🔓 Unlocked'}
                    </button>
                  </div>
                  <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 6 }}>
                    Tap any category to show or hide it in the app — including your uppercase Square ones. Changes apply
                    to the customer menu when you press <strong>Save changes</strong>.{catsLocked ? ' Unlock to make changes.' : ''}
                  </p>
                  {allCats.length === 0 && <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>No Square categories loaded yet — create categories in Square, then Sync.</p>}
                  {(() => {
                    const showing = allCats.filter(isCatSelected);
                    const addable = allCats.filter((c) => !isCatSelected(c));
                    const chip = (c, active) => (
                      <button key={c.id} type="button" className={`chip appcat ${active ? 'on' : ''}`}
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
                            <p className="muted" style={{ fontSize: 'var(--fs-xs)', margin: '10px 0 6px', textTransform: 'uppercase', letterSpacing: 0.4 }}>Showing in the app · tap to hide</p>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{showing.map((c) => chip(c, true))}</div>
                          </>
                        )}
                        {addable.length > 0 && (
                          <>
                            <p className="muted" style={{ fontSize: 'var(--fs-xs)', margin: '14px 0 6px', textTransform: 'uppercase', letterSpacing: 0.4 }}>Hidden · tap to show</p>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{addable.map((c) => chip(c, false))}</div>
                          </>
                        )}
                      </>
                    );
                  })()}
                </div>
                )}

                {true && (<>
                <div className="card" style={card}>
                  <div className="group-title">Menu layout</div>
                  <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                    <div style={{ display: 'grid', gap: 4 }}>
                      <span className="muted" style={{ fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: 0.4 }}>Page style</span>
                      <label style={{ ...row, gap: 6 }}><input type="radio" checked={s.layoutMode !== 'single'} onChange={() => set({ layoutMode: 'onepage' })} /> One page (all scroll)</label>
                      <label style={{ ...row, gap: 6 }}><input type="radio" checked={s.layoutMode === 'single'} onChange={() => set({ layoutMode: 'single' })} /> Single category</label>
                    </div>
                    <div style={{ display: 'grid', gap: 4 }}>
                      <span className="muted" style={{ fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: 0.4 }}>Top category bar</span>
                      <label style={{ ...row, gap: 6 }}><input type="radio" name="topmenustyle" checked={(s.topMenuStyle || 'stacked') === 'stacked'} onChange={() => set({ topMenuStyle: 'stacked' })} /> Stacked (wraps to rows)</label>
                      <label style={{ ...row, gap: 6 }}><input type="radio" name="topmenustyle" checked={s.topMenuStyle === 'swipe'} onChange={() => set({ topMenuStyle: 'swipe' })} /> Swipe (one scrolling row)</label>
                    </div>
                  </div>
                </div>

                <div className="card" style={card}>
                  <div className="group-title">Footer menu builder</div>
                  <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 0 }}>Each button = an icon + one or more sections. Group sections under a single button (e.g. “Food” = Breakfast + Lunch). Any section placed in a button appears on the storefront; the <strong>Top menu</strong> tickbox in Product builder adds a section to the top bar.</p>
                  {footer.map((slot, i) => (
                    <div key={i} {...dropZone('footer', i, (f, t) => setFooter(reorderArray(footer, f, t)))}
                      className={isDragOver('footer', i) ? 'drag-over' : ''}
                      style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 10, marginBottom: 10 }}>
                      <div style={{ ...row, gap: 10 }}>
                        <span {...dragHandle('footer', i)}>⠿</span>
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
                          return <button key={c} onClick={() => toggleSlotCat(i, c)} className={`chip ${on ? 'on' : ''}`} style={{ fontSize: 'var(--fs-xs)', padding: '5px 9px' }}>{c}</button>;
                        })}
                      </div>
                    </div>
                  ))}
                  <button className="btn ghost full" onClick={addSlot}>+ Add footer button</button>
                </div>

                <div className="card" style={card}>
                  <div className="group-title">Top Menu — live sections &amp; order</div>
                  <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 0 }}>
                    The sections currently live on the storefront (turned on via the <strong>Top menu</strong> / <strong>Footer</strong>
                    toggles in Product builder). Drag or use ↑/↓ to set the order they appear.
                  </p>
                  {orderedUnits.length === 0 && <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>No live sections yet — turn on Top menu and/or Footer for a section in Product builder.</p>}
                  {orderedUnits.map((u, idx) => {
                    if (u.type === 'presetsec') {
                      const hidden = isSectionHidden(u.name);
                      return (
                        <div key={'ps:' + u.name} {...dropZone('units', idx, (f, t) => set({ menuOrder: reorderArray(orderedUnits.map((x) => x.name), f, t) }))}
                          className={`builder-row ${isDragOver('units', idx) ? 'drag-over' : ''}`}
                          style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 10, marginBottom: 10, opacity: hidden ? 0.55 : 1 }}>
                          <div style={{ ...row, justifyContent: 'space-between' }}>
                            <span {...dragHandle('units', idx)}>⠿</span>
                            <input type="checkbox" checked={!hidden} title="Show this product-builder section" onChange={() => toggleSectionHidden(u.name)} />
                            <span title="Product builder section" style={{ fontSize: 'var(--fs-lg)' }}>🛠️</span>
                            <span style={{ fontWeight: 700, flex: 1, minWidth: 0 }}>{u.name}</span>
                            <span className="muted" style={{ fontSize: 'var(--fs-sm)', whiteSpace: 'nowrap' }}>{u.count} {u.count === 1 ? 'tile' : 'tiles'} · builder</span>
                            <button className="link" title="Move up" disabled={idx === 0} style={{ opacity: idx === 0 ? 0.3 : 1 }} onClick={() => moveUnit(u.name, -1)}>↑</button>
                            <button className="link" title="Move down" disabled={idx === orderedUnits.length - 1} style={{ opacity: idx === orderedUnits.length - 1 ? 0.3 : 1 }} onClick={() => moveUnit(u.name, 1)}>↓</button>
                          </div>
                        </div>
                      );
                    }
                    if (u.type === 'section') {
                      const sec = u.section;
                      const isOpen = !!expanded[sec.id];
                      const q = (secSearch[sec.id] || '').toLowerCase();
                      const picked = Array.isArray(sec.items) ? sec.items.length : 0;
                      return (
                        <div key={sec.id} {...dropZone('units', idx, (f, t) => set({ menuOrder: reorderArray(orderedUnits.map((u) => u.name), f, t) }))}
                          className={isDragOver('units', idx) ? 'drag-over' : ''}
                          style={{ border: '1px solid var(--accent)', borderRadius: 12, padding: 10, marginBottom: 10, background: 'var(--brand-soft)', opacity: sec.enabled === false ? 0.55 : 1 }}>
                          <div style={{ ...row, justifyContent: 'space-between' }}>
                            <span {...dragHandle('units', idx)}>⠿</span>
                            <input type="checkbox" checked={sec.enabled !== false} title="Show this section in the app" onChange={(e) => updSection(sec.id, { enabled: e.target.checked })} />
                            <label style={{ ...row, flex: 1, minWidth: 0 }}>
                              <span title="Product section" style={{ fontSize: 'var(--fs-lg)' }}>🧩</span>
                              <input value={sec.name || ''} onChange={(e) => updSection(sec.id, { name: e.target.value })} placeholder="Section name"
                                style={{ fontWeight: 700, flex: 1, minWidth: 0, padding: '6px 8px', border: '1px solid var(--line)', borderRadius: 8 }} />
                              <span className="muted" style={{ fontSize: 'var(--fs-sm)', whiteSpace: 'nowrap' }}>{picked} picked</span>
                            </label>
                            <label style={{ ...row, cursor: 'pointer', fontSize: 'var(--fs-sm)' }} className="muted" title="Show product images for this section">
                              <input type="checkbox" checked={sec.showImages !== false} onChange={(e) => updSection(sec.id, { showImages: e.target.checked })} />
                              <span>Images</span>
                            </label>
                            <button className="link" title="Move up" disabled={idx === 0} style={{ opacity: idx === 0 ? 0.3 : 1 }} onClick={() => moveUnit(u.name, -1)}>↑</button>
                            <button className="link" title="Move down" disabled={idx === orderedUnits.length - 1} style={{ opacity: idx === orderedUnits.length - 1 ? 0.3 : 1 }} onClick={() => moveUnit(u.name, 1)}>↓</button>
                            <button className="link" onClick={() => setExpanded((x) => ({ ...x, [sec.id]: !isOpen }))}>{isOpen ? '▲' : '▼'}</button>
                            <button className="link" disabled={deleteLock} style={{ color: '#c0392b', opacity: deleteLock ? 0.3 : 1 }}
                              title={deleteLock ? 'Unlock delete (top-right) to remove' : 'Remove section'} onClick={() => rmSection(sec.id)}>✕</button>
                          </div>
                          {isOpen && (
                            <div style={{ marginTop: 8, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
                              {/* Products offered here now — untick to remove one (e.g. if unavailable). */}
                              {picked > 0 ? (
                                <div style={{ marginBottom: 8 }}>
                                  {allProducts.filter((p) => sectionHasItem(sec, p.id)).map((p) => (
                                    <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', cursor: 'pointer' }}>
                                      <input type="checkbox" checked onChange={() => toggleSectionItem(sec.id, p.id)} />
                                      {p.image
                                        ? <img src={p.image} alt="" style={{ width: 30, height: 30, borderRadius: 6, objectFit: 'cover', flex: 'none' }} />
                                        : <span style={{ width: 30, height: 30, borderRadius: 6, background: 'var(--surface)', flex: 'none', display: 'grid', placeItems: 'center', fontSize: 'var(--fs-md)' }}>🍽️</span>}
                                      <span style={{ fontSize: 'var(--fs-md)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                                      {p.category && <span className="muted" style={{ fontSize: 'var(--fs-xs)', whiteSpace: 'nowrap' }}>{p.category}</span>}
                                    </label>
                                  ))}
                                </div>
                              ) : <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 0 }}>No products chosen yet.</p>}

                              <button className="link" onClick={() => setSecPickerOpen((x) => ({ ...x, [sec.id]: !x[sec.id] }))}>
                                {secPickerOpen[sec.id] ? '▲ Hide product list' : '＋ Add / browse products'}
                              </button>
                              {secPickerOpen[sec.id] && (
                                <div style={{ marginTop: 8 }}>
                                  <input placeholder="Search products…" value={secSearch[sec.id] || ''}
                                    onChange={(e) => setSecSearch((x) => ({ ...x, [sec.id]: e.target.value }))}
                                    style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 10, marginBottom: 8 }} />
                                  {allProducts.length === 0 && <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Loading products…</p>}
                                  <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                                    {allProducts
                                      .filter((p) => !q || p.name.toLowerCase().includes(q) || (p.category || '').toLowerCase().includes(q))
                                      .map((p) => (
                                        <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', cursor: 'pointer' }}>
                                          <input type="checkbox" checked={sectionHasItem(sec, p.id)} onChange={() => toggleSectionItem(sec.id, p.id)} />
                                          {p.image
                                            ? <img src={p.image} alt="" style={{ width: 30, height: 30, borderRadius: 6, objectFit: 'cover', flex: 'none' }} />
                                            : <span style={{ width: 30, height: 30, borderRadius: 6, background: 'var(--surface)', flex: 'none', display: 'grid', placeItems: 'center', fontSize: 'var(--fs-md)' }}>🍽️</span>}
                                          <span style={{ fontSize: 'var(--fs-md)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                                          {p.category && <span className="muted" style={{ fontSize: 'var(--fs-xs)', whiteSpace: 'nowrap' }}>{p.category}</span>}
                                        </label>
                                      ))}
                                  </div>
                                </div>
                              )}
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
                      <div key={c.category} {...dropZone('units', idx, (f, t) => set({ menuOrder: reorderArray(orderedUnits.map((u) => u.name), f, t) }))}
                        className={`appcat-row ${isDragOver('units', idx) ? 'drag-over' : ''}`}
                        style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 10, marginBottom: 10, opacity: on ? 1 : 0.55 }}>
                        <div style={{ ...row, justifyContent: 'space-between' }}>
                          <span {...dragHandle('units', idx)}>⠿</span>
                          <label style={{ ...row, cursor: 'pointer', flex: 1 }}>
                            <input type="checkbox" checked={on} onChange={(e) => setCatEnabled(c.category, e.target.checked)} />
                            <span style={{ fontWeight: 700 }}>{c.category}</span>
                            <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
                              {partial ? `${nOffered}/${c.items.length} items` : `all ${c.items.length}`}
                            </span>
                          </label>
                          <label style={{ ...row, cursor: 'pointer', fontSize: 'var(--fs-sm)' }} className="muted" title="Show product images for this category">
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
                          <button className="link" disabled={deleteLock} style={{ color: '#c0392b', opacity: deleteLock ? 0.3 : 1 }}
                            title={deleteLock ? 'Unlock delete (top-right) to remove' : 'Remove this category from the app'} onClick={() => removeCategoryFromApp(c.category)}>✕</button>
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
                                        : <span style={{ width: 34, height: 34, borderRadius: 8, background: 'var(--brand-soft)', flex: 'none', display: 'grid', placeItems: 'center', fontSize: 'var(--fs-lg)' }}>🍽️</span>}
                                      <span style={{ fontSize: 'var(--fs-md)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</span>
                                    </label>
                                    <label className="btn ghost" title="Upload a real photo to this Square item"
                                      style={{ padding: '5px 10px', fontSize: 'var(--fs-sm)', cursor: imgBusy === it.id ? 'default' : 'pointer', flex: 'none', opacity: imgBusy === it.id ? 0.6 : 1 }}>
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
                </div>
                </>)}
              </>
            )}

            {tab === 'productbuilder' && (
              <>
                {/* ───────── PRODUCT BUILDER ───────── */}
                {true && (
                <div className="card" style={card}>
                  <div className="group-title">Product builder</div>
                  <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 0 }}>
                    Turn ONE variable Square item (e.g. “Breakfast”) into several named tiles — without creating new
                    Square products. Pick the item, lock a variation, then set each option to <strong>Hide</strong>,
                    <strong> Show</strong> (customer can pick), <strong>Default</strong> (pre-ticked) or <strong>Lock</strong>
                    (always applied, hidden). Orders still submit as the real Square variation + modifiers, so printers
                    and KDS work automatically. Presets appear as tiles in the section you name.
                  </p>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--fs-base)', marginBottom: 10, cursor: 'pointer' }}>
                    <input type="checkbox" checked={s.hidePresetSources !== false} onChange={(e) => set({ hidePresetSources: e.target.checked })} />
                    <span>Hide the original item from the menu once it has presets</span>
                  </label>
                  <p className="muted" style={{ fontSize: 'var(--fs-sm)', margin: '0 0 10px' }}>Tip: tick 2+ tiles from the same product (e.g. 6oz + 12oz) in a section, then press <strong>Combine</strong> on that section to merge them into one tile with a size toggle.</p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                    <button className="btn ghost" disabled={syncBusy} onClick={syncBuilder} style={{ padding: '6px 12px' }}>{syncBusy ? 'Syncing…' : '🔄 Sync new variations from Square'}</button>
                    {syncMsg && <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{syncMsg}</span>}
                  </div>
                  {/* Quick generate: one tile per variation */}
                  <div style={{ border: '1px dashed var(--accent)', borderRadius: 12, padding: 10, marginBottom: 12, background: 'var(--brand-soft)' }}>
                    <div style={{ fontWeight: 700, fontSize: 'var(--fs-base)', marginBottom: 6 }}>⚡ Quick generate — a tile per variation</div>
                    <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 0 }}>Choose a category or search, tick the items (or Select all), then generate a preset for every variation of each. Tweak options or duplicate after.</p>
                    {renderGenPicker()}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 8 }}>
                      <label style={{ display: 'grid', gap: 4, flex: '1 1 180px' }}>
                        <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Show in section (pick one below or type a new name)</span>
                        <input value={genSection} onChange={(e) => setGenSection(e.target.value)} placeholder="e.g. Breakfast"
                          style={{ padding: 8, borderRadius: 10, border: '1px solid var(--line)' }} />
                      </label>
                      <button className="btn" disabled={!genSelected.size || genBusy} onClick={generatePresets}
                        style={{ opacity: !genSelected.size || genBusy ? 0.5 : 1 }}>{genBusy ? 'Generating…' : `Generate tiles${genSelected.size ? ` (${genSelected.size})` : ''}`}</button>
                    </div>
                    {renderSectionChips(genSection, setGenSection)}
                  </div>
                  {presets.length === 0 && <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>No presets yet. Generate some above, or add one below.</p>}
                  {presetsSorted.map((p, i) => {
                    const secName = (p.section || '').trim() || '(no section)';
                    const showHeader = i === 0 || (((presetsSorted[i - 1].section || '').trim() || '(no section)') !== secName);
                    const secCollapsed = !collapsedSecs[secName]; // sections start collapsed; click to open
                    const secCount = presetsSorted.filter((x) => ((x.section || '').trim() || '(no section)') === secName).length;
                    const secSel = presetsSorted.filter((x) => (((x.section || '').trim() || '(no section)') === secName) && combineSel.has(x.id));
                    const secCanCombine = secSel.length >= 2 && secSel.every((x) => x.sourceItemId === secSel[0].sourceItemId);
                    const cfg = itemConfigs[p.sourceItemId];
                    const isOpen = !!expanded[p.id];
                    const v = cfg && (cfg.variations.find((x) => x.id === p.variationId) || cfg.variations[0]);
                    let price = v ? (v.price || 0) : null;
                    if (cfg && price != null) {
                      for (const g of cfg.modifierGroups || []) {
                        const gc = p.groups?.[g.id] || {};
                        for (const m of g.modifiers) { const st = gc[m.id]; if (st === 'locked' || st === 'default') price += m.price || 0; }
                      }
                    }
                    return (
                      <React.Fragment key={p.id}>
                      {showHeader && (<>
                        <div
                          onDragOver={(e) => { if (drag && drag.list === 'preset') { e.preventDefault(); if (dragOver !== `sec:${secName}`) setDragOver(`sec:${secName}`); } }}
                          onDragLeave={() => setDragOver((k) => (k === `sec:${secName}` ? null : k))}
                          onDrop={(e) => { e.preventDefault(); if (drag && drag.list === 'preset') { const dp = presetsSorted[drag.index]; if (dp && (dp.section || '').trim() !== secName) updPreset(dp.id, { section: secName === '(no section)' ? '' : secName }); } setDrag(null); setDragOver(null); }}
                          className={dragOver === `sec:${secName}` ? 'drag-over' : ''}
                          style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '4px 0 8px', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 10, background: 'var(--brand-soft)' }}>
                          <button type="button" onClick={() => setCollapsedSecs((x) => ({ ...x, [secName]: !x[secName] }))}
                            style={{ flex: 1, minWidth: 120, textAlign: 'left', background: 'none', border: 'none', fontWeight: 700, cursor: 'pointer' }}>
                            {secName} · {secCount} {secCount === 1 ? 'tile' : 'tiles'} {secCollapsed ? '▼' : '▲'}
                          </button>
                          {secSel.length >= 2 && (
                            <button className="btn" disabled={!secCanCombine} title={secCanCombine ? 'Combine the selected tiles' : 'Selected tiles must be from the same product'}
                              onClick={() => combinePresets(secSel.map((x) => x.id))} style={{ padding: '5px 10px', fontSize: 'var(--fs-sm)', opacity: secCanCombine ? 1 : 0.5 }}>⛓ Combine ({secSel.length})</button>
                          )}
                          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-sm)' }} title="Show this section in the top category bar">
                            <input type="checkbox" checked={presetSectionNav[secName]?.top === true} onChange={(e) => setSectionNav(secName, { top: e.target.checked })} /> Top menu
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-sm)' }} title="Show this section in the footer menu">
                            <input type="checkbox" checked={presetSectionNav[secName]?.footer === true} onChange={(e) => setSectionNav(secName, { footer: e.target.checked })} /> Footer
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-sm)' }} title="Show product images for this section (hide to avoid empty thumbnails)">
                            <input type="checkbox" checked={presetSectionNav[secName]?.showImages !== false} onChange={(e) => setSectionNav(secName, { showImages: e.target.checked })} /> Images
                          </label>
                          <button className="link" title="Feature banner for this section" onClick={() => setBannerOpen((x) => ({ ...x, [secName]: !x[secName] }))}
                            style={{ fontSize: 'var(--fs-sm)', color: presetSectionNav[secName]?.banner?.on ? 'var(--accent)' : 'var(--muted)', fontWeight: presetSectionNav[secName]?.banner?.on ? 700 : 400 }}>🎯 Banner</button>
                        </div>
                        {bannerOpen[secName] && (() => {
                          const bn = presetSectionNav[secName]?.banner || {};
                          const setBn = (patch) => setSectionNav(secName, { banner: { ...bn, ...patch } });
                          return (
                            <div style={{ margin: '0 0 10px', padding: 10, border: '1px solid var(--accent)', borderRadius: 10, background: 'var(--surface)', display: 'grid', gap: 8 }}>
                              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--fs-sm)' }}>
                                <input type="checkbox" checked={bn.on === true} onChange={(e) => setBn({ on: e.target.checked })} />
                                <strong>Feature banner</strong> — a tappable special at the top of this section
                              </label>
                              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--fs-sm)' }}>
                                <input type="checkbox" checked={bn.hideText === true} onChange={(e) => setBn({ hideText: e.target.checked })} />
                                Hide text (my image already has a title / call-to-action)
                              </label>
                              {!bn.hideText && (
                                <input placeholder="Banner title (e.g. Try our Steak Sandwich!)" value={bn.title || ''} onChange={(e) => setBn({ title: e.target.value })}
                                  style={{ padding: 8, borderRadius: 10, border: '1px solid var(--line)' }} />
                              )}
                              <p className="muted" style={{ fontSize: 'var(--fs-xs)', margin: 0 }}>Recommended image: <strong>1200 × 300px</strong> (4:1 wide banner). It’s stretched to fill the box — nothing is cropped, so design to this shape.</p>
                              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                                <label className="btn ghost" style={{ padding: '6px 12px', fontSize: 'var(--fs-sm)', cursor: 'pointer' }}>
                                  {bn.image ? 'Replace image' : 'Upload image'}
                                  <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files[0]; if (f) uploadImage(f, (url) => setBn({ image: url }), 'banners'); e.target.value = ''; }} />
                                </label>
                                {bn.image && <img src={bn.image} alt="" style={{ height: 40, borderRadius: 6 }} />}
                                {bn.image && <button className="link" style={{ color: '#c0392b' }} onClick={() => setBn({ image: '' })}>Remove image</button>}
                              </div>
                              <label style={{ display: 'grid', gap: 4 }}>
                                <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Links to product (opens it ready to order)</span>
                                <select value={bn.itemId || ''} onChange={(e) => setBn({ itemId: e.target.value })} style={{ padding: 8, borderRadius: 10, border: '1px solid var(--line)' }}>
                                  <option value="">— pick a product —</option>
                                  {presetsSorted.filter((p) => (((p.section || '').trim() || '(no section)') === secName)).map((p) => <option key={p.id} value={'preset:' + p.id}>{p.name}</option>)}
                                </select>
                              </label>
                            </div>
                          );
                        })()}
                      </>)}
                      {!secCollapsed && (
                      <div {...dropZone('preset', i, (f, t) => setPresets(reorderArray(presetsSorted, f, t)))}
                        className={isDragOver('preset', i) ? 'drag-over' : ''}
                        style={{ border: '1px solid var(--accent)', borderRadius: 12, padding: 10, marginBottom: 10, outline: combineSel.has(p.id) ? '2px solid var(--accent)' : 'none', outlineOffset: 2 }}>
                        <div style={{ ...row, justifyContent: 'space-between', opacity: p.enabled === false ? 0.5 : 1 }}>
                          <span {...dragHandle('preset', i)}>⠿</span>
                          <label style={{ ...row, flex: 1, minWidth: 0 }}>
                            <input type="checkbox" checked={p.enabled !== false} title="Available — untick to hide this tile when unavailable"
                              onChange={(e) => updPreset(p.id, { enabled: e.target.checked })} />
                            <span title="Preset" style={{ fontSize: 'var(--fs-lg)' }}>🛠️</span>
                            <input value={p.name || ''} onChange={(e) => updPreset(p.id, { name: e.target.value })} placeholder="Tile name (e.g. Egg & Bacon Roll – Rocket & Aioli)"
                              style={{ fontWeight: 700, flex: 1, minWidth: 0, padding: '6px 8px', border: '1px solid var(--line)', borderRadius: 8 }} />
                            {isCombined(p) && <span className="muted" style={{ fontSize: 'var(--fs-xs)', whiteSpace: 'nowrap' }}>· {presetVids(p).length} sizes</span>}
                            {price != null && <span className="muted" style={{ fontSize: 'var(--fs-sm)', whiteSpace: 'nowrap' }}>{isCombined(p) ? 'from ' : ''}{formatMoney(price, data?.currency)}</span>}
                          </label>
                          <button className="link" title="Select to combine (tick 2+ from the same product)" onClick={() => toggleCombineSel(p.id)} style={{ color: combineSel.has(p.id) ? 'var(--accent)' : 'var(--muted)', fontWeight: combineSel.has(p.id) ? 700 : 400 }}>⛓</button>
                          <button className="link" title="Duplicate preset" onClick={() => dupPreset(p.id)}>⧉</button>
                          <button className="link" onClick={() => setExpanded((x) => ({ ...x, [p.id]: !isOpen }))}>{isOpen ? '▲' : '▼'}</button>
                          <button className="link" style={{ color: '#c0392b' }} title="Remove preset" onClick={() => rmPreset(p.id)}>✕</button>
                        </div>
                        {isOpen && (
                          <div style={{ marginTop: 8, borderTop: '1px solid var(--line)', paddingTop: 8, display: 'grid', gap: 8 }}>
                            <div style={{ display: 'grid', gap: 4 }}>
                              <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Source product</span>
                              {(() => {
                                const cur = allProducts.find((x) => x.id === p.sourceItemId);
                                const open = !!srcOpen[p.id];
                                return (
                                  <div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                      <span style={{ fontSize: 'var(--fs-md)' }}>{cur ? cur.name : '— none selected —'}
                                        {cur && (cur.categories || []).length ? <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}> · {cur.categories.join(', ')}</span> : null}</span>
                                      <button className="link" onClick={() => setSrcOpen((x) => ({ ...x, [p.id]: !open }))}>{open ? 'Close' : (cur ? 'Change' : 'Choose product')}</button>
                                    </div>
                                    {open && renderSourcePicker(p.id, p.sourceItemId, (id) => { updPreset(p.id, { sourceItemId: id, variationId: '', groups: {} }); setSrcOpen((x) => ({ ...x, [p.id]: false })); })}
                                  </div>
                                );
                              })()}
                            </div>
                            {p.sourceItemId && !cfg && <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Loading item options…</p>}
                            {cfg && (
                              <>
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                  {isCombined(p) ? (
                                    <div style={{ display: 'grid', gap: 4, flex: '1 1 220px' }}>
                                      <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Sizes offered (customer toggles)</span>
                                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                                        {cfg.variations.map((vr) => (
                                          <label key={vr.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-sm)' }}>
                                            <input type="checkbox" checked={presetVids(p).includes(vr.id)} onChange={() => toggleVariationId(p.id, vr.id)} />
                                            {vr.name || cfg.name} · {formatMoney(vr.price, data?.currency)}
                                          </label>
                                        ))}
                                      </div>
                                      <button className="link" onClick={() => splitPreset(p.id)} style={{ fontSize: 'var(--fs-sm)', justifySelf: 'start' }}>Split into separate tiles</button>
                                    </div>
                                  ) : (
                                  <label style={{ display: 'grid', gap: 4, flex: '1 1 180px' }}>
                                    <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Variation (locked)</span>
                                    <select value={p.variationId || ''} onChange={(e) => updPreset(p.id, { variationId: e.target.value })}
                                      style={{ padding: 8, borderRadius: 10, border: '1px solid var(--line)' }}>
                                      <option value="">— pick a variation —</option>
                                      {cfg.variations.map((vr) => <option key={vr.id} value={vr.id}>{vr.name || cfg.name} · {formatMoney(vr.price, data?.currency)}</option>)}
                                    </select>
                                  </label>
                                  )}
                                  <label style={{ display: 'grid', gap: 4, flex: '1 1 180px' }}>
                                    <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Show in section (pick below or type new)</span>
                                    <input value={p.section || ''} onChange={(e) => updPreset(p.id, { section: e.target.value })} placeholder="e.g. Breakfast"
                                      style={{ padding: 8, borderRadius: 10, border: '1px solid var(--line)' }} />
                                  </label>
                                </div>
                                {renderSectionChips(p.section, (n) => updPreset(p.id, { section: n }))}
                                {(cfg.modifierGroups || []).map((g) => (
                                  <div key={g.id} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 8 }}>
                                    <div style={{ fontWeight: 600, fontSize: 'var(--fs-base)', marginBottom: 6 }}>{g.name}
                                      <span className="muted" style={{ fontWeight: 400 }}>{g.selectionType === 'SINGLE' ? ' · choose one' : g.max > 0 ? ` · up to ${g.max}` : ''}</span>
                                    </div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                      {g.modifiers.map((m) => {
                                        const st = p.groups?.[g.id]?.[m.id] || 'off';
                                        const label = { off: 'Hide', optional: 'Show', default: 'Default', locked: 'Locked' }[st];
                                        const sty = {
                                          off: { background: 'transparent', color: 'var(--muted)', border: '1px solid var(--line)' },
                                          optional: { background: 'var(--brand-soft)', color: 'var(--ink)', border: '1px solid var(--accent)' },
                                          default: { background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)' },
                                          locked: { background: 'var(--ink)', color: '#fff', border: '1px solid var(--ink)' },
                                        }[st];
                                        return (
                                          <button key={m.id} onClick={() => cyclePresetMod(p.id, g.id, m.id)} title="Tap to cycle Hide → Show → Default → Lock"
                                            style={{ ...sty, borderRadius: 999, padding: '5px 10px', fontSize: 'var(--fs-sm)', cursor: 'pointer' }}>
                                            {m.name}{m.price > 0 ? ` +${formatMoney(m.price, data?.currency)}` : ''} · {label}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                ))}
                                {(!cfg.modifierGroups || cfg.modifierGroups.length === 0) && <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>This item has no modifier options.</p>}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                      )}
                      </React.Fragment>
                    );
                  })}
                  <datalist id="menu-section-names">
                    {[...new Set([...adminCat.map((c) => c.category), ...productSections.map((x) => x.name), ...presets.map((x) => x.section)].filter(Boolean))].map((n) => <option key={n} value={n} />)}
                  </datalist>
                  <button className="btn ghost full" onClick={addPreset}>+ Add preset</button>
                </div>
                )}
              </>
            )}

            {/* ───────── BANNERS ───────── */}
            {tab === 'banners' && (
              <div className="card" style={card}>
                <div className="group-title">Banners (hero carousel)</div>
                <p className="muted" style={{ fontSize: 'var(--fs-xs)', margin: '0 0 10px' }}>Recommended image: <strong>1200 × 800px</strong> (3:2). Images are stretched to fill the banner — nothing is cropped, so design to this shape.</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', margin: '2px 0 12px', paddingBottom: 12, borderBottom: '1px solid var(--line)' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input type="checkbox" checked={s.heroAutoplay !== false} onChange={(e) => set({ heroAutoplay: e.target.checked })} />
                    <span>Auto-scroll banners</span>
                  </label>
                  {s.heroAutoplay !== false && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 180px', minWidth: 160 }}>
                      <span className="muted" style={{ fontSize: 'var(--fs-sm)', whiteSpace: 'nowrap' }}>Every {Number(s.heroInterval) || 5}s</span>
                      <input type="range" min="2" max="15" step="1" value={Number(s.heroInterval) || 5}
                        onChange={(e) => set({ heroInterval: Number(e.target.value) })} style={{ flex: 1 }} />
                    </label>
                  )}
                </div>
                {!data.cloudinary && <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 0 }}>Add Cloudinary keys in Railway to enable image upload; you can still paste a URL.</p>}
                <div className="admin-bannergrid">
                  {hero.map((sl, i) => (
                    <div key={i} {...dropZone('banner', i, (f, t) => setHero(reorderArray(hero, f, t)))}
                      className={isDragOver('banner', i) ? 'drag-over' : ''}
                      style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 10 }}>
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
                        <span {...dragHandle('banner', i)} style={{ marginRight: 'auto' }}>⠿</span>
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
                        <label className="btn ghost" style={{ padding: '8px 12px', fontSize: 'var(--fs-base)', cursor: 'pointer' }}>
                          Upload image
                          <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files[0]; if (f) uploadImage(f, (url) => updSlide(i, { image: url, bg: `url(${url}) center/contain no-repeat` })); }} />
                        </label>
                        <input style={{ flex: 1, padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 10, fontSize: 'var(--fs-xs)' }} value={sl.bg || ''} onChange={(e) => updSlide(i, { bg: e.target.value })} placeholder="background (gradient or url(...) center/cover)" />
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
                  <button type="button" className="btn ghost" style={{ padding: '6px 12px', fontSize: 'var(--fs-base)' }} disabled={usersBusy} onClick={loadUsers}>{usersBusy ? 'Loading…' : (users === null ? 'Load' : 'Refresh')}</button>
                </div>
                <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 6 }}>Everyone enrolled in your Square loyalty program — name, contact, points and when they joined. Pulled live from Square.</p>
                {users === null && !usersBusy && <p className="muted" style={{ fontSize: 'var(--fs-base)' }}>Tap Load to fetch your loyalty members.</p>}
                {users && users.length === 0 && <p className="muted" style={{ fontSize: 'var(--fs-base)' }}>No loyalty members yet.</p>}
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
                  const SEL = { padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 10, fontSize: 'var(--fs-base)' };
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
                        <span className="muted" style={{ fontSize: 'var(--fs-base)', fontWeight: 700, marginLeft: 'auto' }}>{rows.length} shown</span>
                      </div>
                      <div className="admin-users">
                        {rows.map((u) => (
                          <div key={u.id} className="user-row">
                            <div className="user-main">
                              <div className="user-name">{u.name || 'Guest'}</div>
                              <div className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{[u.phone, u.email].filter(Boolean).join(' · ') || '—'}</div>
                            </div>
                            <div className="user-meta">
                              <span className="user-pts">{u.points} pts</span>
                              <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
                                {u.lifetimePoints} earned{u.redemptions > 0 ? ` · ${u.redemptions} redeemed` : ''}
                              </span>
                              <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>Joined {fmtJoined(u.enrolledAt)}</span>
                            </div>
                          </div>
                        ))}
                        {rows.length === 0 && <p className="muted" style={{ fontSize: 'var(--fs-base)' }}>No members match.</p>}
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
                <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 0 }}>Create codes customers type at checkout. The discount is applied to the Square order, so they only pay the reduced total. Remember to press <strong>Save changes</strong>.</p>
                {couponList.length === 0 && <p className="muted" style={{ fontSize: 'var(--fs-base)' }}>No coupons yet — add one below.</p>}
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
                      <label style={{ ...row, fontSize: 'var(--fs-base)' }} className="muted">
                        <span>Expires</span>
                        <input type="date" value={c.expiry || ''} onChange={(e) => updCoupon(i, { expiry: e.target.value })}
                          style={{ padding: '6px 8px', border: '1px solid var(--line)', borderRadius: 10 }} />
                        {c.expiry && <button className="link" style={{ fontSize: 'var(--fs-sm)', padding: 2 }} onClick={() => updCoupon(i, { expiry: '' })}>clear</button>}
                      </label>
                      <label style={{ ...row, cursor: 'pointer', fontSize: 'var(--fs-base)' }}>
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
                <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 0 }}>
                  Send a message to everyone in your Square loyalty program. This web app can’t push to phone lock-screens (that needs a native app), so messages go out by SMS or email. Only message customers who’ve opted in.
                </p>

                {notifyStatus && !notifyStatus.sms && !notifyStatus.email && (
                  <p className="error-text" style={{ fontSize: 'var(--fs-base)' }}>No channels are set up yet. Add Twilio (SMS) and/or Resend (email) env vars in Railway to enable this.</p>
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
                  <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
                    {users === null ? 'Counting audience…' : `To ${users.length} loyalty member${users.length === 1 ? '' : 's'}${push.channel === 'sms' ? ` · ${users.filter((u) => u.phone).length} with a phone` : ` · ${users.filter((u) => u.email).length} with an email`}`}
                  </span>
                  <button className="btn" disabled={pushBusy || !push.message.trim() || (notifyStatus && !notifyStatus[push.channel])}
                    onClick={sendBroadcast}>{pushBusy ? 'Sending…' : `Send ${push.channel === 'sms' ? 'SMS' : 'email'}`}</button>
                </div>

                {pushResult && (
                  <p className="muted" style={{ fontSize: 'var(--fs-base)', marginTop: 12 }}>
                    ✓ Sent to <strong>{pushResult.sent}</strong>{pushResult.skipped ? ` · ${pushResult.skipped} skipped (no ${push.channel === 'sms' ? 'phone' : 'email'})` : ''}{pushResult.failed ? ` · ${pushResult.failed} failed` : ''}.
                  </p>
                )}
              </div>
            )}

            {/* ───────── TABLES (QR) ───────── */}
            {tab === 'tables' && (
              <div className="card" style={card}>
                <div className="group-title">Table QR codes</div>
                <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 0 }}>
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
                    <span className="muted" style={{ fontSize: 'var(--fs-base)' }}>Code colour</span>
                    <input type="color" value={qrFg} onChange={(e) => setQrFg(e.target.value)} style={{ width: 40, height: 30, border: 'none', background: 'none', cursor: 'pointer' }} />
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="muted" style={{ fontSize: 'var(--fs-base)' }}>Background</span>
                    <input type="color" value={qrBg} onChange={(e) => setQrBg(e.target.value)} style={{ width: 40, height: 30, border: 'none', background: 'none', cursor: 'pointer' }} />
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 200px', minWidth: 180 }}>
                    <span className="muted" style={{ fontSize: 'var(--fs-base)', whiteSpace: 'nowrap' }}>Size {qrSize}px</span>
                    <input type="range" min="120" max="320" step="10" value={qrSize} onChange={(e) => setQrSize(Number(e.target.value))} style={{ flex: 1 }} />
                  </label>
                </div>
                {qrCodes.length > 0 && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '14px 0 2px' }}>
                      <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{qrCodes.length} table{qrCodes.length === 1 ? '' : 's'} · links to {origin || 'this site'}</span>
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
                  <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 0 }}>The store’s base colours (guests can still pick their own theme).</p>
                  {['brand', 'accent', 'bg', 'ink'].map((k) => (
                    <div key={k} style={{ ...row, justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid var(--line)' }}>
                      <span style={{ textTransform: 'capitalize' }}>{k === 'bg' ? 'Background' : k === 'ink' ? 'Text' : k}</span>
                      <input type="color" value={(s.theme && s.theme[k]) || '#000000'} onChange={(e) => setTheme(k, e.target.value)} style={{ width: 44, height: 32, border: 'none', background: 'none' }} />
                    </div>
                  ))}
                </div>

                <div className="card" style={card}>
                  <div className="group-title">Festive &amp; seasonal themes</div>
                  <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 0 }}>
                    Auto-activate on their dates (a single day or a range). Guests can override. Each shows its banner
                    #1 in the hero while active. Adjust variable holidays (Easter, Lunar New Year, Mother’s/Father’s Day) each year.
                  </p>
                  <div className="admin-bannergrid">
                    {seasonalThemes.map((t, i) => {
                      const img = t.banner?.image || (typeof t.banner?.bg === 'string' && (t.banner.bg.match(/url\((['"]?)(.*?)\1\)/) || [])[2]) || '';
                      return (
                        <div key={i} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 10, opacity: t.enabled === false ? 0.6 : 1 }}>
                          <div style={{ ...row, justifyContent: 'space-between' }}>
                            <input value={t.name || ''} onChange={(e) => updSeasonal(i, { name: e.target.value })} style={{ flex: 1, minWidth: 0, fontWeight: 700, border: 'none', background: 'transparent', fontSize: 'var(--fs-lg)' }} />
                            <label style={{ ...row, fontSize: 'var(--fs-sm)' }} className="muted"><input type="checkbox" checked={t.enabled !== false} onChange={(e) => updSeasonal(i, { enabled: e.target.checked })} /> On</label>
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
                              <label key={k} style={{ ...row, fontSize: 'var(--fs-xs)' }} className="muted"><span style={{ textTransform: 'capitalize' }}>{k}</span>
                                <input type="color" value={(t.theme && t.theme[k]) || '#000000'} onChange={(e) => updSeasonalTheme(i, k, e.target.value)} style={{ width: 30, height: 24, border: 'none', background: 'none' }} /></label>
                            ))}
                          </div>
                          {(() => {
                            // Event-aware effect controls (schema v2). Back-compat:
                            // derive from old snow/hearts/petals/confetti flags when
                            // no effectsConfig exists yet, so saved data never breaks.
                            const legacyOn = !!(t.effects && Object.values(t.effects).some(Boolean));
                            const ec = t.effectsConfig || { effectsEnabled: legacyOn, effectPreset: t.id, intensity: 'standard' };
                            const setEc = (patch) => updSeasonal(i, { effectsConfig: { ...ec, ...patch } });
                            return (
                              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8, alignItems: 'center', fontSize: 'var(--fs-sm)' }} className="muted">
                                <label style={{ ...row }}><input type="checkbox" checked={ec.effectsEnabled !== false} onChange={(e) => setEc({ effectsEnabled: e.target.checked })} /> Animated effect</label>
                                <label style={{ ...row }}>Intensity
                                  <select value={ec.intensity || 'standard'} onChange={(e) => setEc({ intensity: e.target.value })} style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid var(--line)', marginLeft: 6 }}>
                                    <option value="subtle">Subtle</option>
                                    <option value="standard">Standard</option>
                                    <option value="celebratory">Celebratory</option>
                                  </select>
                                </label>
                                <span style={{ fontSize: 'var(--fs-xs)' }}>Effect: {ec.effectPreset || t.id} · shows only during the event dates</span>
                              </div>
                            );
                          })()}
                          <div style={{ marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
                            <div className="muted" style={{ fontSize: 'var(--fs-xs)', marginBottom: 4 }}>Banner (shown #1 while active)</div>
                            {img && <img src={img} alt="" style={{ width: '100%', borderRadius: 8, marginBottom: 6 }} />}
                            <input value={t.banner?.title || ''} onChange={(e) => updSeasonalBanner(i, { title: e.target.value })} placeholder="Banner title" style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 10, marginBottom: 6 }} />
                            <input value={t.banner?.subtitle || ''} onChange={(e) => updSeasonalBanner(i, { subtitle: e.target.value })} placeholder="Subtitle" style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 10, marginBottom: 6 }} />
                            <div style={{ ...row, gap: 8 }}>
                              <input value={t.banner?.cta || ''} onChange={(e) => updSeasonalBanner(i, { cta: e.target.value })} placeholder="Button text" style={{ flex: 1, minWidth: 0, padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 10 }} />
                              <label className="btn ghost" style={{ padding: '8px 12px', fontSize: 'var(--fs-base)', cursor: 'pointer', whiteSpace: 'nowrap' }}>Image
                                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files[0]; if (f) uploadImage(f, (url) => updSeasonalBanner(i, { image: url, bg: `url(${url}) center/contain no-repeat` }), 'themes'); }} /></label>
                            </div>
                            {/* Destination — same options as the hero banners */}
                            <div style={{ ...row, gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                              <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Tapping goes to</span>
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
          <span className="muted" style={{ fontSize: 'var(--fs-sm)', flex: 1 }}>{savedMsg}</span>
          <button className="btn" style={{ minWidth: 140 }} disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save changes'}</button>
        </div>
      </div>
    </div>
  );
}
