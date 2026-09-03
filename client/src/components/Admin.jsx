import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { SlotIcon } from './icons.jsx';
import IconPicker from './IconPicker.jsx';
import HoursEditor from './HoursEditor.jsx';
import Insights, { AppPerformanceSection } from './Insights.jsx';
import EffectBuilder from './EffectBuilder.jsx';
import { formatMoney, api, imgUrl } from '../api.js';

// Booth / table label builder for a venue's QR codes. Three modes:
//  • numbered — "<word> 1..N" (word defaults to "Table"; e.g. "Booth 1")
//  • label    — a hand-built / pasted list of names ("Microsoft Booth", …)
//  • both      — numbered AND named ("Booth 1 · Microsoft")
// Returns { label, param }: label is printed on the card and read on the phone;
// param is what goes into ?table= (a bare number for plain "Table" numbering, so
// tickets keep the familiar "T7"; the full label otherwise).
function boothEntries(booths) {
  const b = booths || {};
  const word = (String(b.word || 'Table').trim()) || 'Table';
  const labels = String(b.labels || '').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 300);
  const mode = b.mode || 'numbered';
  if (mode === 'label') return labels.map((s) => ({ label: s, param: s }));
  if (mode === 'both') return labels.map((s, i) => { const l = `${word} ${i + 1} · ${s}`; return { label: l, param: l }; });
  const from = Math.max(1, parseInt(b.from, 10) || 1);
  const to = Math.max(from, parseInt(b.to, 10) || from);
  const plainTable = word.toLowerCase() === 'table';
  const out = [];
  for (let n = from; n <= to && out.length < 300; n++) out.push({ label: `${word} ${n}`, param: plainTable ? String(n) : `${word} ${n}` });
  return out;
}

const LINK_TYPES = ['scroll', 'category', 'item', 'account', 'payitforward', 'url', 'none'];
// Friendly labels for the banner "destination" dropdowns.
const LINK_TYPE_LABELS = {
  scroll: 'Scroll to menu',
  category: 'Category',
  item: 'Product',
  account: 'Account',
  payitforward: 'Pay It Forward (gift a coffee)',
  url: 'Web link',
  none: 'Nothing',
};
// Pay It Forward presets are { label, valueCents }; accept a legacy bare number.
const pifPreset = (v) => (v && typeof v === 'object')
  ? { label: v.label || '', valueCents: Math.round(v.valueCents || v.value || 0) }
  : { label: '', valueCents: Math.round(Number(v) || 0) };
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
const CalendarIcon = svg(<>
  <rect x="3" y="5" width="18" height="16" rx="2" /><line x1="3" y1="10" x2="21" y2="10" />
  <line x1="8" y1="3" x2="8" y2="7" /><line x1="16" y1="3" x2="16" y2="7" /><circle cx="8.5" cy="14.5" r="1.1" />
</>);
const DashboardIcon = svg(<>
  <rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="5" rx="1.5" />
  <rect x="13" y="10" width="8" height="11" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" />
</>);
const ComboIcon = svg(<>
  <circle cx="8" cy="8" r="4.2" /><circle cx="16" cy="8" r="4.2" /><circle cx="12" cy="16" r="4.2" />
</>);
const PifIcon = svg(<>
  <path d="M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8Z" /><path d="M17 9.5h1.5a2.5 2.5 0 0 1 0 5H17" />
</>);
const SeoIcon = svg(<><circle cx="11" cy="11" r="7" /><path d="M20.5 20.5l-4-4" /><path d="M11 8v6M8 11h6" /></>);
// Sold-out / availability (no-entry circle with a slash)
const SoldOutIcon = svg(<><circle cx="12" cy="12" r="8.5" /><line x1="6" y1="6" x2="18" y2="18" /></>);
// Kitchen screen (monitor)
const KdsIcon = svg(<><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>);
// Smart Campaigns (sun — weather is the first campaign type)
const WeatherIcon = svg(<><circle cx="12" cy="12" r="4.2" /><path d="M12 2.5v2.5M12 19v2.5M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2.5 12H5M19 12h2.5M4.2 19.8 6 18M18 6l1.8-1.8" /></>);
const TABS = [
  { id: 'overview', label: 'Dashboard', Icon: DashboardIcon },
  { id: 'store', label: 'Store', Icon: StoreIcon },
  { id: 'seo', label: 'SEO', Icon: SeoIcon },
  { id: 'reservations', label: 'Reservations', Icon: CalendarIcon },
  { id: 'kds', label: 'Kitchen Screen', Icon: KdsIcon },
  { id: 'locations', label: 'Locations', Icon: StoreIcon },
  { id: 'insights', label: 'Insights', Icon: InsightsIcon },
  { id: 'menubuilder', label: 'Menu Builder', Icon: MenuIcon },
  { id: 'productbuilder', label: 'Product Builder', Icon: BuildIcon },
  { id: 'combobuilder', label: 'Combo Builder', Icon: ComboIcon },
  { id: 'availability', label: 'Sold Out & Menus', Icon: SoldOutIcon },
  { id: 'payitforward', label: 'Pay It Forward', Icon: PifIcon },
  { id: 'smartcampaigns', label: 'Smart Campaigns', Icon: WeatherIcon },
  { id: 'banners', label: 'Banners', Icon: BannerIcon },
  { id: 'users', label: 'Users', Icon: InsightsIcon },
  { id: 'coupons', label: 'Coupons', Icon: BannerIcon },
  { id: 'push', label: 'Push', Icon: BannerIcon },
  { id: 'tables', label: 'Tables', Icon: QrIcon },
  { id: 'customtables', label: 'Custom Tables', Icon: QrIcon },
  { id: 'theme', label: 'Theme', Icon: ThemeIcon2 },
];
// Sidebar navigation, grouped. Purely a presentation grouping over the same
// TABS/tab-id state — no change to what each tab renders or how it saves.
const TAB_GROUPS = [
  { label: 'Overview', tabs: ['overview', 'insights'] },
  { label: 'Orders & Service', tabs: ['reservations', 'kds', 'tables', 'customtables'] },
  { label: 'Menu', tabs: ['menubuilder', 'productbuilder', 'combobuilder', 'availability'] },
  { label: 'Marketing', tabs: ['banners', 'coupons', 'push', 'payitforward', 'smartcampaigns'] },
  { label: 'Customers', tabs: ['users'] },
  { label: 'Store', tabs: ['store', 'locations', 'seo', 'theme'] },
];
// Page-width class per tab: Standard for simple forms, Wide for Theme,
// Analytics for Insights' charts, Builder for the two builder pages (whose
// own internal layout is untouched — only the outer shell gets more room).
function shellWidthClass(tab) {
  if (tab === 'theme') return 'w-wide';
  if (tab === 'insights') return 'w-analytics';
  if (tab === 'menubuilder' || tab === 'productbuilder' || tab === 'combobuilder' || tab === 'availability') return 'w-builder';
  if (tab === 'payitforward') return 'w-analytics';
  return 'w-standard';
}

export default function Admin({ onExit }) {
  // Restore the admin passcode from this device so a reload/return visit stays
  // signed in (lightly base64-obscured, not security — the passcode still
  // authorises every request server-side). Cleared automatically on a 401.
  const [pass, setPass] = useState(() => {
    try { return atob(localStorage.getItem('bc-admin-pass') || '') || ''; } catch { return ''; }
  });
  const [needPass, setNeedPass] = useState(false);
  const [sitemapInfo, setSitemapInfo] = useState('');
  const [weatherStatus, setWeatherStatus] = useState(null); // Smart Campaigns weather status
  const [weatherBusy, setWeatherBusy] = useState(false);
  const [geoBusy, setGeoBusy] = useState('');
  const [campEditId, setCampEditId] = useState(null);       // weather campaign being edited (or null)
  const [data, setData] = useState(null);
  const [s, setS] = useState(null); // editable settings
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [syncMsg, setSyncMsg] = useState('');
  const [adminCat, setAdminCat] = useState([]);
  const [allProducts, setAllProducts] = useState([]);
  // ---- Pay It Forward (gift-a-coffee) admin state ----
  const [pifKpisData, setPifKpisData] = useState(null);
  const [pifEligibility, setPifEligibility] = useState(null);
  const [pifGifts, setPifGifts] = useState(null);
  const [pifFilter, setPifFilter] = useState('');
  const [pifSearch, setPifSearch] = useState('');
  const [pifDetail, setPifDetail] = useState(null);
  const [pifBusy, setPifBusy] = useState(false);
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
  // ---- Sold Out & Menus tab ----
  const [availSub, setAvailSub] = useState('items');   // items | exclusions | schedules
  const [availSearch, setAvailSearch] = useState('');  // product search in the sold-out list
  const [availCat, setAvailCat] = useState('');        // category filter in the sold-out list ('' = all)
  const [availBusy, setAvailBusy] = useState('');      // item id currently toggling
  const [exclDay, setExclDay] = useState(6);           // weekday being edited (default Saturday)
  const [exclSearch, setExclSearch] = useState('');    // product search in the exclusions picker
  const [exclCat, setExclCat] = useState('');          // category filter in the exclusions list ('' = all)
  const [offeredIds, setOfferedIds] = useState(null);  // Set of item ids actually offered in the app menu
  const [offeredList, setOfferedList] = useState([]);  // offered menu items with names + menu ids (for per-location availability)
  const [sqLocations, setSqLocations] = useState([]);  // this Square account's locations (id + name)
  const [sqConfiguredId, setSqConfiguredId] = useState(''); // env/main Square location id (the current single store)
  const [locQr, setLocQr] = useState({});              // locId -> { url, img } walk-around order QR
  const [salesData, setSalesData] = useState(null);    // per-store sales (app vs counter)
  const [salesDays, setSalesDays] = useState(7);
  const [salesBusy, setSalesBusy] = useState(false);
  const [guests, setGuests] = useState(null);          // event free-coffee guest log
  const [guestsDays, setGuestsDays] = useState(30);
  const [guestVenue, setGuestVenue] = useState('');
  const [guestsBusy, setGuestsBusy] = useState(false);
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
  const [pushTest, setPushTest] = useState('');
  const [pushTestBusy, setPushTestBusy] = useState(false);
  const [tab, setTab] = useState('overview');
  const [qrFrom, setQrFrom] = useState(1);
  const [qrTo, setQrTo] = useState(12);
  const [qrVenue, setQrVenue] = useState('');   // which store the QR codes are for
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
  // "New reservation" badge: anything booked after the last time the admin
  // actually opened the Reservations tab counts as unseen. Persisted so a
  // page refresh doesn't re-flag bookings already looked at.
  const [resvLastSeen, setResvLastSeen] = useState(() => {
    try { return localStorage.getItem('bc-admin-resv-seen') || ''; } catch { return ''; }
  });
  const newResvCount = (resv || []).filter((r) => r.status !== 'cancelled' && r.createdAt && (!resvLastSeen || new Date(r.createdAt) > new Date(resvLastSeen))).length;
  // Reservation-printing setup status: null = not checked yet, otherwise the
  // inspect() result for the currently-linked Square item (see effect below).
  const [resvPrintStatus, setResvPrintStatus] = useState(null);
  const [resvDeleteLock, setResvDeleteLock] = useState(true); // guard against accidental reservation deletes
  const [locDeleteLock, setLocDeleteLock] = useState(true); // guard against accidentally deleting a whole location
  const [resvSetupBusy, setResvSetupBusy] = useState(false);
  const [resvSetupMsg, setResvSetupMsg] = useState('');
  const [newClosure, setNewClosure] = useState({ date: '', annual: false, label: '' });
  // Combo Builder — our own alternative to Square's native Combo item type
  // (which needs a paid Restaurants plan). See server/lib/settings.js `combos`.
  const [comboDeleteLock, setComboDeleteLock] = useState(true); // guard against accidental combo deletes
  const [comboItemPicker, setComboItemPicker] = useState(null); // `${comboId}:${groupId}` currently open
  const [comboItemSearch, setComboItemSearch] = useState({}); // picker key -> search text
  const [comboLockOpen, setComboLockOpen] = useState(null); // `${comboId}:${groupId}:${itemId}` lock panel open
  const [comboPickerSec, setComboPickerSec] = useState({}); // picker key -> section filter
  const [comboShowHidden, setComboShowHidden] = useState({}); // lock key -> reveal tile-hidden add-ons
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  // Backend appearance (admin-only palette) — persisted locally, independent
  // of the storefront's customer-facing theme/season settings.
  const [adminTheme, setAdminTheme] = useState(() => {
    try { return localStorage.getItem('bc-admin-theme') || 'light'; } catch { return 'light'; }
  });
  useEffect(() => {
    try { localStorage.setItem('bc-admin-theme', adminTheme); } catch {}
  }, [adminTheme]);

  // Switching backend sections should start you at the top of the new section,
  // not wherever you'd scrolled in the previous one. Reset both the page scroll
  // and the (independently-scrolling) content panel on every tab change.
  useEffect(() => {
    try { window.scrollTo({ top: 0, behavior: 'auto' }); } catch {}
    try { document.querySelector('.admin-panel')?.scrollTo?.({ top: 0, behavior: 'auto' }); } catch {}
    try { const p = document.querySelector('.admin-panel'); if (p) p.scrollTop = 0; } catch {}
  }, [tab]);

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

  // Load analytics when the Insights OR Dashboard tab is opened / period
  // changes — the Dashboard now embeds the same app-performance data.
  useEffect(() => {
    if (tab !== 'insights' && tab !== 'overview') return;
    reloadInsights();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, aDays]);

  async function generateQR() {
    setQrBusy(true);
    try {
      const allLocs = Array.isArray(s?.locations) ? s.locations : [];
      const venue = allLocs.find((l) => l.id === qrVenue) || null;
      // A venue with booth config drives the labels; otherwise fall back to the
      // plain numeric table range (single-site / a venue with no booth setup).
      let entries;
      if (venue && venue.booths && venue.booths.enabled) {
        entries = boothEntries(venue.booths);
      } else {
        const from = Math.max(1, parseInt(qrFrom, 10) || 1);
        const to = Math.max(from, parseInt(qrTo, 10) || from);
        entries = [];
        for (let n = from; n <= to && entries.length < 200; n++) entries.push({ label: `Table ${n}`, param: String(n) });
      }
      if (!entries.length) { setQrCodes([]); alert('Nothing to generate — add some booth labels or a table range first.'); return; }
      // Scanning sets the store (?loc=) AND the booth (?table=). Events are hidden
      // from the picker, so this QR is the only way in — exactly what we want.
      const locPart = venue && !venue._default ? `loc=${encodeURIComponent(venue.id)}&` : '';
      const codes = await Promise.all(
        entries.map(async (e, i) => {
          const url = `${origin}/?${locPart}table=${encodeURIComponent(e.param)}&src=qr`;
          const img = await QRCode.toDataURL(url, {
            margin: 1, width: 512, errorCorrectionLevel: 'M',
            color: { dark: qrFg, light: qrBg },
          });
          return { n: i + 1, label: e.label, url, img };
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
      if (res.status === 401) {
        try { localStorage.removeItem('bc-admin-pass'); } catch {}
        setNeedPass(true);
        return;
      }
      const d = await res.json();
      setData(d);
      setS(JSON.parse(JSON.stringify(d.settings)));
      setNeedPass(false);
      // Remember this working passcode so we don't prompt again next visit.
      try { localStorage.setItem('bc-admin-pass', btoa(p || '')); } catch {}
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
  // On mount, try the remembered passcode first (empty string if none) so a
  // returning admin lands straight in the panel instead of the login screen.
  useEffect(() => { load(pass); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Fetch the full config (variations + modifiers) for any item used by a preset.
  useEffect(() => {
    const presetSrc = (s?.presets || []).map((p) => p.sourceItemId).filter(Boolean);
    const comboItemIds = (s?.combos || []).flatMap((c) => (c.groups || []).flatMap((g) => g.itemIds || []));
    const ids = [...new Set([...presetSrc, ...comboItemIds].filter(Boolean))];
    ids.forEach((id) => {
      if (itemConfigs[id]) return;
      fetch(`/api/admin/item-config?id=${encodeURIComponent(id)}&pass=${encodeURIComponent(pass)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d && d.item) setItemConfigs((x) => ({ ...x, [id]: d.item })); })
        .catch(() => {});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s?.presets]);
  function loadPifGifts() {
    api.adminPifGifts(pass, { status: pifFilter || undefined, search: pifSearch || undefined }).then(setPifGifts).catch(() => setPifGifts({ rows: [], total: 0 }));
  }
  function loadPifOverview() {
    api.adminPifKpis(pass).then(setPifKpisData).catch(() => setPifKpisData(null));
    api.adminPifEligibility(pass).then(setPifEligibility).catch(() => setPifEligibility(null));
  }
  async function openPifDetail(id) {
    try { setPifDetail(await api.adminPifGiftDetail(pass, id)); } catch (e) { alert(e.message); }
  }
  async function pifAction(fn, id, ...args) {
    setPifBusy(true);
    try {
      const r = await fn(pass, id, ...args);
      if (r.gift) setPifDetail((d) => (d ? { ...d, gift: r.gift } : d));
      loadPifGifts();
    } catch (e) { alert(e.message); } finally { setPifBusy(false); }
  }
  useEffect(() => {
    if (tab === 'payitforward') {
      loadPifOverview();
      loadPifGifts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, pifFilter, pifSearch]);
  useEffect(() => {
    if (tab === 'smartcampaigns' && weatherStatus === null && !weatherBusy) loadWeather();
    if (tab === 'availability' && offeredIds === null) loadOfferedIds();
    if (tab === 'locations') { if (offeredIds === null) loadOfferedIds(); if (!sqLocations.length) loadSquareLocations(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);
  useEffect(() => {
    if (tab === 'push') {
      if (notifyStatus === null) api.adminNotifyStatus(pass).then(setNotifyStatus).catch(() => setNotifyStatus({ sms: false, email: false }));
      if (users === null && !usersBusy) loadUsers();
    }
    // Dashboard cards reuse the same already-existing loaders (messages,
    // loyalty users) rather than any new endpoint.
    if (tab === 'overview') {
      if (msgs === null) loadMessages();
      if (users === null && !usersBusy) loadUsers();
    }
    // Opening the Reservations tab clears the "new" badge — everything
    // currently loaded counts as seen from this point on.
    if (tab === 'reservations') {
      const now = new Date().toISOString();
      setResvLastSeen(now);
      try { localStorage.setItem('bc-admin-resv-seen', now); } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);
  // Reservations load as soon as the admin logs in (not just when the tab is
  // opened) so the "new booking" badge can show up anywhere in the panel,
  // then refresh every 45s in the background so it stays current. Keyed off
  // `data` (only set after a successful auth) rather than `pass`, which
  // changes on every keystroke while the passcode is still being typed.
  useEffect(() => {
    if (!data) return;
    loadReservations(true);
    const id = setInterval(() => loadReservations(true), 45000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  async function loadMessages() {
    try { const d = await api.adminMessages(pass); setMsgs(d.messages || []); }
    catch (e) { alert('Could not load messages: ' + e.message); }
  }
  async function toggleHandled(m) {
    const next = !m.handled;
    setMsgs((xs) => (xs || []).map((x) => (x.id === m.id ? { ...x, handled: next } : x)));
    try { await api.markMessage(pass, m.id, next); } catch {}
  }
  async function deleteMsg(m) {
    if (!window.confirm('Delete this message permanently?')) return;
    setMsgs((xs) => (xs || []).filter((x) => x.id !== m.id));
    try { await api.deleteMessage(pass, m.id); } catch (e) { alert('Could not delete: ' + e.message); loadMessages && loadMessages(); }
  }
  async function loadReservations(silent = false) {
    try { const d = await api.adminReservations(pass); setResv(d.reservations || []); setResvChannels({ sms: d.sms, email: d.email }); }
    catch (e) { if (!silent) alert('Could not load reservations: ' + e.message); }
  }
  async function loadUsers() {
    setUsersBusy(true);
    try { const d = await api.adminCustomers(pass); setUsers(d.users || []); }
    catch (e) { alert('Could not load users: ' + e.message); }
    finally { setUsersBusy(false); }
  }
  // Ids of products actually offered in the app menu (to refine the Sold Out /
  // Day Exclusion lists so they don't wade through every Square product).
  async function loadOfferedIds() {
    try {
      const r = await fetch(`/api/admin/offered-products?pass=${encodeURIComponent(pass)}`);
      const d = await r.json();
      // Capture the offered items WITH names + the menu's own ids (e.g.
      // `preset:<id>` for product-builder menus), used by per-location
      // availability so tick state maps to the id the menu actually hides on.
      if (r.ok && Array.isArray(d.products)) setOfferedList(d.products);
      if (r.ok && Array.isArray(d.ids)) { setOfferedIds(new Set(d.ids)); return; }
      setOfferedIds(false); // couldn't refine — fall back to the full list
    } catch { setOfferedIds(false); }
  }
  // ---- Multi-location ----
  async function loadSales(days = salesDays) {
    setSalesBusy(true);
    try {
      const r = await fetch(`/api/admin/analytics/sales?days=${days}&pass=${encodeURIComponent(pass)}`);
      const d = await r.json();
      if (r.ok) setSalesData(d); else setSalesData({ error: d.error || 'Failed' });
    } catch (e) { setSalesData({ error: e.message }); }
    finally { setSalesBusy(false); }
  }
  // Event guest log ("who got a free coffee") — name, phone, booth, time.
  async function loadGuests(days = guestsDays, venue = guestVenue) {
    setGuestsBusy(true);
    try {
      const q = `days=${days}${venue ? `&location=${encodeURIComponent(venue)}` : ''}&pass=${encodeURIComponent(pass)}`;
      const r = await fetch(`/api/admin/analytics/event-guests?${q}`);
      const d = await r.json();
      if (r.ok) setGuests(d); else setGuests({ error: d.error || 'Failed' });
    } catch (e) { setGuests({ error: e.message }); }
    finally { setGuestsBusy(false); }
  }
  async function loadSquareLocations() {
    try {
      const r = await fetch(`/api/admin/square-locations?pass=${encodeURIComponent(pass)}`);
      const d = await r.json();
      if (r.ok && Array.isArray(d.locations)) setSqLocations(d.locations);
      if (r.ok && d.configuredLocationId) setSqConfiguredId(d.configuredLocationId);
    } catch {}
  }

  // ---- Smart Campaigns / weather ----
  async function loadWeather() {
    setWeatherBusy(true);
    try {
      const r = await fetch(`/api/admin/weather?pass=${encodeURIComponent(pass)}`);
      const d = await r.json(); setWeatherStatus(d.weather || { ok: false });
    } catch (e) { setWeatherStatus({ ok: false, reason: e.message }); }
    finally { setWeatherBusy(false); }
  }
  async function refreshWeather() {
    setWeatherBusy(true);
    try {
      const r = await fetch(`/api/admin/weather/refresh?pass=${encodeURIComponent(pass)}`, { method: 'POST' });
      const d = await r.json(); setWeatherStatus(d.weather || { ok: false });
    } catch (e) { setWeatherStatus({ ok: false, reason: e.message }); }
    finally { setWeatherBusy(false); }
  }
  async function useSquareLocation() {
    setGeoBusy('loading');
    try {
      const r = await fetch(`/api/admin/square-location-geo?pass=${encodeURIComponent(pass)}`);
      const d = await r.json();
      if (d.lat != null && d.lng != null) {
        set({ contact: { ...(s.contact || {}), lat: d.lat, lng: d.lng } });
        setGeoBusy('Filled from Square — press Save changes, then Refresh weather.');
      } else { setGeoBusy(d.error || 'Square has no coordinates for this location.'); }
    } catch (e) { setGeoBusy('Failed: ' + e.message); }
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
  async function sendTestBroadcast() {
    if (!push.message.trim()) { alert('Write a message first.'); return; }
    if (!pushTest.trim()) { alert(`Add a test ${push.channel === 'sms' ? 'phone number' : 'email address'}.`); return; }
    setPushTestBusy(true);
    try {
      await api.adminBroadcastTest(pass, { ...push, to: pushTest.trim() });
      alert(`Test ${push.channel === 'sms' ? 'SMS' : 'email'} sent to ${pushTest.trim()}.`);
    } catch (e) { alert('Test failed: ' + e.message); }
    finally { setPushTestBusy(false); }
  }
  // Reservation ticket printing: check what Square actually has on file for
  // the linked item (reporting_category vs. the "Reservations" category
  // we're aiming for) and offer a one-click fix if they don't match.
  async function checkResvPrintStatus(itemId) {
    const id = itemId || s?.reservationItemId;
    if (!id) { setResvPrintStatus(null); return; }
    try {
      const info = await api.reservationItemInspect(pass, id);
      setResvPrintStatus(info);
    } catch (e) { setResvPrintStatus({ error: e.message }); }
  }
  useEffect(() => {
    if (tab === 'reservations' && s?.reservationItemId) checkResvPrintStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, s?.reservationItemId]);
  async function runResvSetup() {
    setResvSetupBusy(true); setResvSetupMsg('');
    try {
      const result = await api.reservationItemSetup(pass, {});
      // The server already persisted these two fields straight to the DB;
      // patch the local draft too so the panel reflects it immediately
      // without re-pulling (and potentially clobbering) other unsaved edits.
      set({ reservationVariationId: result.variationId, reservationItemId: result.itemId });
      await checkResvPrintStatus(result.itemId);
      setResvSetupMsg(result.categoryCreated ? 'Created the Reservations category and item — all set.' : 'Linked and checked — all set.');
    } catch (e) { setResvSetupMsg('Setup failed: ' + e.message); }
    finally { setResvSetupBusy(false); setTimeout(() => setResvSetupMsg(''), 6000); }
  }
  async function fixResvCategory() {
    if (!resvPrintStatus?.id) return;
    setResvSetupBusy(true); setResvSetupMsg('');
    try {
      // The category we're aiming for is whatever's already in the item's
      // tag list under the name "Reservations" (added when Setup ran, or by
      // hand in Square) — reuse that id rather than creating another one.
      const target = (resvPrintStatus.categories || []).find((c) => c.name.toLowerCase() === 'reservations');
      if (!target) { setResvSetupMsg('No "Reservations" category found on this item — run Set up instead.'); return; }
      await api.reservationItemFixCategory(pass, resvPrintStatus.id, target.id);
      await checkResvPrintStatus(resvPrintStatus.id);
      setResvSetupMsg('Fixed — this item will now route to Reservations for printing.');
    } catch (e) { setResvSetupMsg('Fix failed: ' + e.message); }
    finally { setResvSetupBusy(false); setTimeout(() => setResvSetupMsg(''), 6000); }
  }
  async function setResvStatus(r, status) {
    setResv((xs) => (xs || []).map((x) => (x.id === r.id ? { ...x, status } : x)));
    try { await api.setReservationStatus(pass, r.id, status); } catch {}
  }
  async function removeReservation(r) {
    if (!window.confirm(`Permanently delete this reservation${r.name ? ` for ${r.name}` : ''}? This can't be undone.`)) return;
    const prev = resv;
    setResv((xs) => (xs || []).filter((x) => x.id !== r.id));
    try { await api.deleteReservation(pass, r.id); }
    catch (e) { alert('Delete failed: ' + e.message); setResv(prev); }
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

  // ---- top-menu (dock) builder: combine a few sections under one dock button ----
  const topMenu = s?.topMenu || [];
  const setTopMenu = (arr) => set({ topMenu: arr });
  const addTopSlot = () => setTopMenu([...topMenu, { label: 'Deals', icon: 'tag', categories: [] }]);
  const updTopSlot = (i, patch) => setTopMenu(topMenu.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const rmTopSlot = (i) => setTopMenu(topMenu.filter((_, j) => j !== i));
  const moveTopSlot = (i, d) => {
    const j = i + d; if (j < 0 || j >= topMenu.length) return;
    const a = [...topMenu]; [a[i], a[j]] = [a[j], a[i]]; setTopMenu(a);
  };
  const toggleTopSlotCat = (i, cat) => {
    const slot = topMenu[i];
    const has = slot.categories.some((c) => c.toLowerCase() === cat.toLowerCase());
    updTopSlot(i, { categories: has ? slot.categories.filter((c) => c.toLowerCase() !== cat.toLowerCase()) : [...slot.categories, cat] });
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
  // ---- combo builder (bundles across DIFFERENT items + an auto discount) ----
  const combos = s?.combos || [];
  const setCombos = (arr) => set({ combos: arr });
  const addCombo = () =>
    setCombos([...combos, {
      id: 'combo' + Date.now().toString(36), name: 'New combo', description: '', image: '',
      active: true, section: 'Combos', discountValue: 3,
      groups: [{ id: 'g' + Date.now().toString(36), label: 'Choose your item', sourceType: 'both', categoryName: '', itemIds: [] }],
    }]);
  const updCombo = (id, patch) => setCombos(combos.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const rmCombo = (id) => setCombos(combos.filter((x) => x.id !== id));
  const addComboGroup = (comboId) =>
    updCombo(comboId, {
      groups: [...(combos.find((c) => c.id === comboId)?.groups || []),
        { id: 'g' + Date.now().toString(36), label: 'Choose your item', sourceType: 'both', categoryName: '', itemIds: [] }],
    });
  const updComboGroup = (comboId, groupId, patch) => {
    const combo = combos.find((c) => c.id === comboId);
    if (!combo) return;
    updCombo(comboId, { groups: (combo.groups || []).map((g) => (g.id === groupId ? { ...g, ...patch } : g)) });
  };
  const rmComboGroup = (comboId, groupId) => {
    const combo = combos.find((c) => c.id === comboId);
    if (!combo) return;
    updCombo(comboId, { groups: (combo.groups || []).filter((g) => g.id !== groupId) });
  };
  const toggleComboGroupItem = (comboId, groupId, itemId) => {
    const combo = combos.find((c) => c.id === comboId);
    const group = combo && (combo.groups || []).find((g) => g.id === groupId);
    if (!group) return;
    const cur = Array.isArray(group.itemIds) ? group.itemIds : [];
    updComboGroup(comboId, groupId, { itemIds: cur.includes(itemId) ? cur.filter((i) => i !== itemId) : [...cur, itemId] });
  };
  // Add/remove a Product Builder tile (preset) as an option in a combo group.
  const toggleComboGroupPreset = (comboId, groupId, presetId) => {
    const combo = combos.find((c) => c.id === comboId);
    const group = combo && (combo.groups || []).find((g) => g.id === groupId);
    if (!group) return;
    const cur = Array.isArray(group.presetIds) ? group.presetIds : [];
    updComboGroup(comboId, groupId, { presetIds: cur.includes(presetId) ? cur.filter((i) => i !== presetId) : [...cur, presetId] });
  };
  // Retail (full separate price) + deal price of a combo, from each group's
  // cheapest option incl. its locked-in extras. Needs item configs loaded.
  const comboRetail = (combo) => {
    let retail = 0; let known = true;
    for (const g of combo.groups || []) {
      let best = Infinity;
      for (const pid of g.presetIds || []) {
        const p = (presets || []).find((x) => x.id === pid);
        const cfg = p && itemConfigs[p.sourceItemId];
        if (!p || !cfg) { known = false; continue; }
        const vids = (p.variationIds && p.variationIds.length) ? p.variationIds : [p.variationId];
        const vPrices = (cfg.variations || []).filter((v) => vids.includes(v.id)).map((v) => v.price);
        if (!vPrices.length) { known = false; continue; }
        let lock = 0;
        for (const mg of cfg.modifierGroups || []) { const gc = (p.groups || {})[mg.id] || {}; for (const m of mg.modifiers) if (gc[m.id] === 'locked') lock += m.price || 0; }
        const ov = (g.itemLocks && g.itemLocks['preset:' + pid]) || [];
        for (const mg of cfg.modifierGroups || []) for (const m of mg.modifiers) if (ov.includes(m.id)) lock += m.price || 0;
        best = Math.min(best, Math.min(...vPrices) + lock);
      }
      for (const id of g.itemIds || []) {
        const cfg = itemConfigs[id];
        if (!cfg || !(cfg.variations || []).length) { known = false; continue; }
        const ov = (g.itemLocks && g.itemLocks[id]) || [];
        let lock = 0;
        for (const mg of cfg.modifierGroups || []) for (const m of mg.modifiers) if (ov.includes(m.id)) lock += m.price || 0;
        best = Math.min(best, Math.min(...cfg.variations.map((v) => v.price)) + lock);
      }
      if (g.categoryName && !(g.presetIds || []).length && !(g.itemIds || []).length) { known = false; continue; }
      if (best === Infinity) { known = false; continue; }
      retail += best;
    }
    return { retail, known };
  };
  // Cycle a combo item's modifier through Show → Hide → Locked-in → Show
  // (scoped to this combo only). Locked = always included + hidden + priced in;
  // Hidden = never offered; Show = normal customer choice.
  // Cycle a combo add-on through the four Product Builder states, scoped to THIS
  // combo only: Show (offered, not pre-ticked) → Default (offered + pre-ticked) →
  // Locked (always included, hidden, priced in) → Hidden (never offered) → Show.
  // Stored explicitly across four maps so it overrides whatever the tile does.
  const COMBO_MOD_ORDER = ['show', 'default', 'lock', 'hide'];
  const cycleItemMod = (comboId, groupId, itemId, modId, startState) => {
    const combo = combos.find((c) => c.id === comboId);
    const group = combo && (combo.groups || []).find((g) => g.id === groupId);
    if (!group) return;
    const maps = { show: { ...(group.itemShows || {}) }, default: { ...(group.itemDefaults || {}) }, lock: { ...(group.itemLocks || {}) }, hide: { ...(group.itemHides || {}) } };
    const arrOf = (k) => (Array.isArray(maps[k][itemId]) ? maps[k][itemId] : []);
    let cur = null;
    for (const k of COMBO_MOD_ORDER) if (arrOf(k).includes(modId)) { cur = k; break; }
    if (!cur) cur = startState || 'show';
    const next = COMBO_MOD_ORDER[(COMBO_MOD_ORDER.indexOf(cur) + 1) % 4];
    for (const k of COMBO_MOD_ORDER) { const a = arrOf(k).filter((m) => m !== modId); if (a.length) maps[k][itemId] = a; else delete maps[k][itemId]; }
    maps[next][itemId] = [...arrOf(next), modId];
    updComboGroup(comboId, groupId, { itemShows: maps.show, itemDefaults: maps.default, itemLocks: maps.lock, itemHides: maps.hide });
  };

  // ---- product builder presets (named hot-links into one variable item) ----
  const presets = s?.presets || [];
  const setPresets = (arr) => set({ presets: arr });
  const addPreset = () =>
    setPresets([...presets, { id: 'pre' + Date.now().toString(36), name: 'New preset', section: 'Breakfast', sourceItemId: '', variationId: '', groups: {}, showImages: true }]);
  const updPreset = (id, patch) => setPresets(presets.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const rmPreset = (id) => {
    // Remember the variations this tile covered so "Sync new variations from
    // Square" doesn't silently re-create the tile you just deleted (the cause of
    // "deleted teas keep coming back"). Cleared automatically if you rebuild a
    // tile for that variation.
    const p = presets.find((x) => x.id === id);
    const vids = p ? (Array.isArray(p.variationIds) && p.variationIds.length ? p.variationIds : [p.variationId].filter(Boolean)) : [];
    const ex = new Set(Array.isArray(s?.builderExcludedVariationIds) ? s.builderExcludedVariationIds : []);
    vids.forEach((v) => ex.add(v));
    set({ presets: presets.filter((x) => x.id !== id), builderExcludedVariationIds: [...ex] });
  };
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
  // ---- bulk show/hide + per-heading "Required" helpers for the preset modifier editor ----
  // A group counts as "all shown" once every one of its modifiers has some
  // state other than hidden (optional/default/locked all count as visible).
  const groupAllShown = (p, g) => (g.modifiers || []).length > 0 && g.modifiers.every((m) => !!(p.groups?.[g.id]?.[m.id]));
  const presetAllShown = (p, cfg) => (cfg.modifierGroups || []).length > 0 && (cfg.modifierGroups || []).every((g) => groupAllShown(p, g));
  // Show-all only turns on modifiers that are currently hidden (anything
  // already Default/Locked keeps its state); hide-all clears the group/preset
  // entirely so every modifier goes back to Hide.
  const setGroupShowAll = (presetId, g, show) =>
    setPresets(presets.map((p) => {
      if (p.id !== presetId) return p;
      const groups = { ...(p.groups || {}) };
      if (!show) { delete groups[g.id]; return { ...p, groups }; }
      const gc = { ...(groups[g.id] || {}) };
      for (const m of g.modifiers || []) if (!gc[m.id]) gc[m.id] = 'optional';
      groups[g.id] = gc;
      return { ...p, groups };
    }));
  const setPresetShowAll = (presetId, cfg, show) =>
    setPresets(presets.map((p) => {
      if (p.id !== presetId) return p;
      if (!show) return { ...p, groups: {} };
      const groups = { ...(p.groups || {}) };
      for (const g of cfg.modifierGroups || []) {
        const gc = { ...(groups[g.id] || {}) };
        for (const m of g.modifiers || []) if (!gc[m.id]) gc[m.id] = 'optional';
        groups[g.id] = gc;
      }
      return { ...p, groups };
    }));
  // Which headings force the customer to pick at least one option — overrides
  // Square's own modifier-list minimum for this preset only (server: catalog.js).
  const toggleGroupRequired = (presetId, groupId) =>
    setPresets(presets.map((p) => {
      if (p.id !== presetId) return p;
      const cur = Array.isArray(p.requiredGroups) ? p.requiredGroups : [];
      const next = cur.includes(groupId) ? cur.filter((id) => id !== groupId) : [...cur, groupId];
      return { ...p, requiredGroups: next };
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
  // Rename a Product Builder section everywhere it's referenced: every tile's
  // `section`, the section's own nav/banner config, footer buttons, and any
  // event-menu / free-category lists that name it — so the rename doesn't orphan
  // the section on the storefront or in event setup.
  const renameSection = (oldName) => {
    const cur = oldName === '(no section)' ? '' : oldName;
    const raw = window.prompt('Rename this product section:', cur);
    if (raw == null) return; // cancelled
    const next = raw.trim();
    if (!next || next === cur) return;
    const eqCur = (n) => String(n || '').trim().toLowerCase() === cur.toLowerCase();
    const mapNames = (arr) => (Array.isArray(arr) ? arr.map((n) => (eqCur(n) ? next : n)) : arr);
    const nextPresets = (s?.presets || []).map((p) => (eqCur(p.section) ? { ...p, section: next } : p));
    const nav = { ...(s?.presetSectionNav || {}) };
    if (nav[oldName]) { nav[next] = { ...(nav[next] || {}), ...nav[oldName] }; if (oldName !== next) delete nav[oldName]; }
    const patch = { presets: nextPresets, presetSectionNav: nav };
    if (Array.isArray(s?.footer)) patch.footer = s.footer.map((f) => ({ ...f, categories: mapNames(f.categories) }));
    if (Array.isArray(s?.locations)) patch.locations = s.locations.map((l) => {
      const o = { ...l };
      if (Array.isArray(l.menuSections)) o.menuSections = mapNames(l.menuSections);
      if (Array.isArray(l.freeCategories)) o.freeCategories = mapNames(l.freeCategories);
      return o;
    });
    set(patch);
  };

  // ---- Availability: sold-out overrides, day exclusions, menu schedules ----
  const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const availability = s?.availability || {};
  // ---- Locations ----
  const locs = Array.isArray(s?.locations) ? s.locations : [];
  const setLocs = (arr) => set({ locations: arr });
  const addLoc = () => setLocs([...locs, { id: 'loc' + Date.now().toString(36), name: 'New store', squareLocationId: '', address: '', active: true, hiddenItemIds: [] }]);
  // Seed the current single store (the env/main Square location) as the FIRST
  // store, so adding a second store never silently drops it. Prefills the name
  // + Square id from the account's configured main location.
  const mainSq = sqLocations.find((sl) => sl.id === sqConfiguredId) || null;
  const addMainLoc = () => setLocs([
    { id: 'loc' + Date.now().toString(36), name: (mainSq && mainSq.name) || 'Bean Culture', squareLocationId: sqConfiguredId || '', address: (mainSq && mainSq.address) || '', active: true, hiddenItemIds: [] },
    ...locs,
  ]);
  const updLoc = (id, patch) => setLocs(locs.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const rmLoc = (id) => setLocs(locs.filter((l) => l.id !== id));
  const toggleLocItem = (locId, itemId) => {
    const l = locs.find((x) => x.id === locId); if (!l) return;
    const hidden = new Set(l.hiddenItemIds || []);
    hidden.has(itemId) ? hidden.delete(itemId) : hidden.add(itemId);
    updLoc(locId, { hiddenItemIds: [...hidden] });
  };
  // Walk-around / general-order QR: opens the app already set to this store (no
  // table). See App.jsx's ?loc= handling. Save the store first so the link works.
  async function makeLocQr(locId) {
    try {
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const url = `${origin}/?loc=${encodeURIComponent(locId)}&src=qr`;
      const img = await QRCode.toDataURL(url, { margin: 1, width: 512, errorCorrectionLevel: 'M' });
      setLocQr((m) => ({ ...m, [locId]: { url, img } }));
    } catch (e) { alert('QR generation failed: ' + e.message); }
  }
  // Turn a whole category on/off at once for a store. If every item in the
  // category is currently on, hide them all; otherwise show them all — so the
  // header checkbox flips the whole group either way.
  const toggleLocCategory = (locId, itemIds) => {
    const l = locs.find((x) => x.id === locId); if (!l) return;
    const hidden = new Set(l.hiddenItemIds || []);
    const allOn = itemIds.every((id) => !hidden.has(id));
    if (allOn) { itemIds.forEach((id) => hidden.add(id)); }
    else { itemIds.forEach((id) => hidden.delete(id)); }
    updLoc(locId, { hiddenItemIds: [...hidden] });
  };
  // Group the offered products by category (preserving first-seen order) so the
  // per-location availability list can offer a whole-category toggle.
  const offeredByCategory = () => {
    const groups = [];
    const byName = new Map();
    for (const p of offeredProducts) {
      const cat = (p.category || 'Other').trim() || 'Other';
      let g = byName.get(cat);
      if (!g) { g = { category: cat, items: [] }; byName.set(cat, g); groups.push(g); }
      g.items.push(p);
    }
    return groups;
  };
  // Offered products (with names) for the per-location availability toggles.
  // Use the app's OFFERED MENU items directly — these carry the menu's own ids
  // (e.g. `preset:<id>` for product-builder menus), so a tick stores the id the
  // menu's per-location hide-filter actually matches. The raw Square product
  // list (allProducts) uses a different id space for preset-built menus and
  // won't intersect at all, which is why filtering it by the offered ids yielded
  // an empty "0/0" list. Fall back to the raw product list only when the offered
  // menu isn't available (old server, or a genuinely empty menu).
  const offeredProducts = (Array.isArray(offeredList) && offeredList.length)
    ? offeredList
    : allProducts;

  // ---- Surcharges (weekend / card) ----
  const scfg = s?.surcharges || {};
  const setSurcharge = (patch) => set({ surcharges: { ...scfg, ...patch } });
  const setWeekendSc = (patch) => setSurcharge({ weekend: { ...(scfg.weekend || {}), ...patch } });
  const setCardSc = (patch) => setSurcharge({ card: { ...(scfg.card || {}), ...patch } });
  const weekendDays = Array.isArray(scfg.weekend?.days) ? scfg.weekend.days : [0, 6];
  const toggleWeekendDay = (d) => setWeekendSc({ days: weekendDays.includes(d) ? weekendDays.filter((x) => x !== d) : [...weekendDays, d].sort() });
  const DOWS = [['Sun', 0], ['Mon', 1], ['Tue', 2], ['Wed', 3], ['Thu', 4], ['Fri', 5], ['Sat', 6]];

  const availItems = availability.items || {};
  const availExcl = availability.exclusions || { enabled: true, days: {} };
  const availSchedules = Array.isArray(availability.schedules) ? availability.schedules : [];
  const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const todayDow = new Date().getDay();
  const exclListFor = (dow) => (availExcl.days && availExcl.days[String(dow)]) || [];
  const isExcludedToday = (id) => availExcl.enabled !== false && exclListFor(todayDow).includes(id);
  // Effective status shown in the sold-out list: off | today | on | excluded | available.
  // Checks the menu id first, then the preset's underlying Square source id, so a
  // flag saved under either id space is reflected (and can be cleared).
  const activeOverride = (id) => {
    const o = availItems[id];
    if (!o || !o.mode) return null;
    if ((o.mode === 'today' || o.mode === 'on') && o.until && todayISO() >= o.until) return null;
    return o.mode;
  };
  const itemStatus = (id, sourceId) => {
    const mode = activeOverride(id) || (sourceId ? activeOverride(sourceId) : null);
    if (mode === 'off') return 'off';
    if (mode === 'today') return 'today';
    if (mode === 'on') return 'on';
    if (isExcludedToday(id) || (sourceId && isExcludedToday(sourceId))) return 'excluded';
    return 'available';
  };
  // Fast per-item toggle — hits the dedicated endpoint (persists immediately, no
  // full Save needed) and mirrors the server's truth back into local state.
  async function toggleItemAvail(id, mode, sourceId) {
    setAvailBusy(id);
    try {
      const post = (body) => fetch(`/api/admin/availability/item?pass=${encodeURIComponent(pass)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }).then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Failed'); return d; });
      let d = await post({ id, mode });
      // Also clear any legacy flag saved under the underlying Square source id, so
      // a stale raw-id override can't keep the item sold out after this change.
      if (sourceId && sourceId !== id && d.items && d.items[sourceId]) d = await post({ id: sourceId, mode: 'clear' });
      setS((cur) => ({ ...cur, availability: { ...(cur.availability || {}), items: d.items || {} } }));
    } catch (e) { setSavedMsg('Failed: ' + e.message); setTimeout(() => setSavedMsg(''), 4000); }
    finally { setAvailBusy(''); }
  }
  // Exclusions + schedules persist through the normal Save-changes bar.
  const setExclList = (dow, list) => set({
    availability: {
      ...availability,
      exclusions: { ...availExcl, enabled: availExcl.enabled !== false, days: { ...(availExcl.days || {}), [String(dow)]: list } },
    },
  });
  const toggleExcl = (dow, id) => {
    const list = exclListFor(dow);
    setExclList(dow, list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  };
  const setExclEnabled = (on) => set({ availability: { ...availability, exclusions: { ...availExcl, enabled: on, days: availExcl.days || {} } } });
  const setSchedules = (list) => set({ availability: { ...availability, schedules: list } });
  const addSchedule = () => setSchedules([...availSchedules, {
    id: 'sch_' + Math.random().toString(36).slice(2, 8),
    name: 'New menu', categories: [], days: [1, 2, 3, 4, 5], start: '07:00', end: '11:00', enabled: true,
  }]);
  // Start a schedule from one of the app's existing menus/categories — pre-fills
  // the name and selects that menu, ready to set the days + hours.
  const addScheduleFromMenu = (name) => setSchedules([...availSchedules, {
    id: 'sch_' + Math.random().toString(36).slice(2, 8),
    name, categories: [name], days: [1, 2, 3, 4, 5], start: '07:00', end: '11:00', enabled: true,
  }]);
  const updateSchedule = (id, patch) => setSchedules(availSchedules.map((sc) => (sc.id === id ? { ...sc, ...patch } : sc)));
  const removeSchedule = (id) => setSchedules(availSchedules.filter((sc) => sc.id !== id));
  const toggleSchedDay = (id, dow) => {
    const sc = availSchedules.find((x) => x.id === id); if (!sc) return;
    const days = Array.isArray(sc.days) ? sc.days : [];
    updateSchedule(id, { days: days.includes(dow) ? days.filter((d) => d !== dow) : [...days, dow].sort() });
  };
  const toggleSchedCat = (id, name) => {
    const sc = availSchedules.find((x) => x.id === id); if (!sc) return;
    const cats = Array.isArray(sc.categories) ? sc.categories : [];
    updateSchedule(id, { categories: cats.includes(name) ? cats.filter((c) => c !== name) : [...cats, name] });
  };
  // Category names a schedule / event menu can target: app categories, custom
  // product sections, AND Product-Builder section names (so an "Event locations"
  // section like "Events" can be picked for an event store's menu even when it's
  // not on the normal menus).
  const scheduleCatOptions = [...new Set([
    ...adminCat.map((c) => c.category),
    ...productSections.map((ps) => ps.name),
    ...(Array.isArray(s?.presets) ? s.presets.map((p) => (p.section || '').trim()) : []),
  ].filter(Boolean))];

  // ---- Kitchen Screen (KDS) config ----
  const kdsCfg = s?.kds || {};
  const kdsZones = Array.isArray(kdsCfg.zones) ? kdsCfg.zones : [];
  const setKds = (patch) => set({ kds: { ...kdsCfg, ...patch } });
  const setKdsZones = (list) => setKds({ zones: list });
  const addKdsZone = () => setKdsZones([...kdsZones, { id: 'z_' + Math.random().toString(36).slice(2, 8), name: 'New station', categories: [] }]);
  const updateKdsZone = (id, patch) => setKdsZones(kdsZones.map((z) => (z.id === id ? { ...z, ...patch } : z)));
  const removeKdsZone = (id) => setKdsZones(kdsZones.filter((z) => z.id !== id));
  const toggleKdsZoneCat = (id, name) => {
    const z = kdsZones.find((x) => x.id === id); if (!z) return;
    const cats = Array.isArray(z.categories) ? z.categories : [];
    updateKdsZone(id, { categories: cats.includes(name) ? cats.filter((c) => c !== name) : [...cats, name] });
  };
  // A station routes an order by the item's SQUARE category (that's what a live
  // order line actually carries), so the picker must offer the real Square
  // category names — not only the app's menu/section names. An item that Square
  // files under a category the station never listed simply won't bump through
  // (e.g. a Hot Chocolate whose Square category is "Hot Drinks"): list that
  // Square category on the station and it routes. We offer the app names first
  // (familiar) then any Square categories not already covered by that name.
  const kdsAppCatOptions = scheduleCatOptions;
  const kdsSquareCatOptions = (() => {
    const have = new Set(kdsAppCatOptions.map((n) => n.toLowerCase()));
    return [...new Set(sqCats.filter((c) => !c.isParent).map((c) => c.name).filter(Boolean))]
      .filter((n) => !have.has(n.toLowerCase()))
      .sort();
  })();
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
      // Variations the owner has deliberately deleted — never auto-re-add these.
      const excluded = new Set(Array.isArray(s?.builderExcludedVariationIds) ? s.builderExcludedVariationIds : []);
      const added = []; let extended = 0; let skippedExcluded = 0;
      for (const id of sourceIds) {
        const cfg = configs[id]; if (!cfg) continue;
        const covered = coveredBySource[id] || new Set();
        for (const v of cfg.variations) {
          if (covered.has(v.id)) continue;
          if (excluded.has(v.id)) { skippedExcluded++; continue; } // owner deleted this — leave it out
          covered.add(v.id);
          const combo = combinedForSource[id];
          if (combo) { combo.variationIds = [...presetVids(combo), v.id]; combo.variationId = combo.variationIds[0]; extended++; }
          else { reconciled.push({ id: newPresetId(), name: v.name || cfg.name, section: sectionBySource[id] || 'Specials', sourceItemId: id, variationId: v.id, groups: {}, showImages: true }); added.push(v.name || cfg.name); }
        }
      }
      // Self-heal: a variation that's now covered by a tile again is no longer
      // "excluded" (so a rebuilt tile sticks and stays syncable).
      const coveredNow = new Set();
      for (const p of reconciled) presetVids(p).forEach((v) => coveredNow.add(v));
      const nextExcluded = [...excluded].filter((v) => !coveredNow.has(v));
      set({ presets: reconciled, builderExcludedVariationIds: nextExcluded });
      const parts = [added.length ? `added ${added.length} new tile(s) (${added.slice(0, 4).join(', ')}${added.length > 4 ? '…' : ''})` : 'no new tiles'];
      if (extended) parts.push(`added ${extended} new size(s) to combined tile(s)`);
      if (removedDead) parts.push(`removed ${removedDead} tile(s) whose variation was deleted`);
      if (trimmed) parts.push(`trimmed ${trimmed} combined tile(s)`);
      if (skippedExcluded) parts.push(`left out ${skippedExcluded} tile(s) you'd deleted`);
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
                const off = itemStatus(p.id) === 'off'; // kitchen marked Unavailable
                return (
                  <button key={p.id} onClick={() => onPick(p.id)} type="button"
                    style={{ display: 'flex', width: '100%', textAlign: 'left', gap: 8, alignItems: 'center', padding: '6px 8px', border: 'none', borderBottom: '1px solid var(--line)', borderLeft: off ? '3px solid var(--admin-danger, #c0392b)' : '3px solid transparent', background: off ? 'rgba(192,57,43,0.08)' : (currentId === p.id ? 'var(--brand-soft)' : 'transparent'), cursor: 'pointer' }}>
                    {p.image
                      ? <img src={p.image} alt="" style={{ width: 30, height: 30, borderRadius: 6, objectFit: 'cover', flex: 'none' }} />
                      : <span style={{ width: 30, height: 30, borderRadius: 6, background: 'var(--brand-soft)', flex: 'none', display: 'grid', placeItems: 'center', fontSize: 'var(--fs-md)' }}>🍽️</span>}
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 'var(--fs-md)', display: 'block' }}>{p.name}</span>
                      {cats.length ? <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>{cats.join(' · ')}</span> : null}
                    </span>
                    {off && <span style={{ flex: 'none', fontSize: 'var(--fs-xs)', fontWeight: 800, color: 'var(--admin-danger, #c0392b)', border: '1px solid var(--admin-danger, #c0392b)', borderRadius: 6, padding: '2px 6px' }}>UNAVAILABLE</span>}
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

  // ---- custom tables (private phone-gated quick-pick tables for regulars) ----
  const customTableList = s?.customTables || [];
  const setCustomTables = (arr) => set({ customTables: arr });
  const addCustomTable = () => setCustomTables([...customTableList, { phone: '', label: '', coupon: '' }]);
  const updCustomTable = (i, patch) => setCustomTables(customTableList.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  const rmCustomTable = (i) => setCustomTables(customTableList.filter((_, j) => j !== i));

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
      <div className="admin-root admin-login" data-admin-theme={adminTheme}>
        <div className="admin-panel admin-login-card">
          <div style={{ fontFamily: 'Georgia, serif', fontSize: 24, fontWeight: 700, color: 'var(--admin-heading)' }}>Bean Culture</div>
          <p className="admin-page-desc" style={{ marginBottom: 16 }}>Control panel — enter your passcode.</p>
          <label className="field"><span>Passcode</span>
            <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') load(pass); }} autoFocus /></label>
          <button className="btn full" style={{ marginTop: 12 }} onClick={() => load(pass)}>Enter</button>
          {error && <p className="error-text" style={{ color: 'var(--admin-danger)' }}>{error}</p>}
          <button className="link center-link" onClick={onExit}>← Back to store</button>
        </div>
      </div>
    );
  }
  if (!s) return <div className="app"><div className="center-screen"><div className="spinner" /></div></div>;

  const h = data.hours || {};
  const card = { marginBottom: 14 };
  const row = { display: 'flex', gap: 8, alignItems: 'center' };

  // ── Dashboard command-centre data, derived entirely from already-loaded
  // state (reservations, messages, closures) — no new endpoints. ──
  const _now = new Date();
  const _greeting = _now.getHours() < 12 ? 'Good morning' : _now.getHours() < 17 ? 'Good afternoon' : 'Good evening';
  const _startToday = new Date(_now.getFullYear(), _now.getMonth(), _now.getDate());
  const _in30 = new Date(_startToday); _in30.setDate(_in30.getDate() + 30);
  // Upcoming reservations: today or later, not cancelled, soonest first.
  const upcomingResv = (resv || [])
    .filter((r) => r.status !== 'cancelled' && r.reserveAt && new Date(r.reserveAt) >= _startToday)
    .sort((a, b) => new Date(a.reserveAt) - new Date(b.reserveAt))
    .slice(0, 6);
  const unreadMsgs = (msgs || []).filter((m) => !m.handled).slice(0, 6);
  // Closures/public holidays whose (possibly annual) date falls in the next 30
  // days — so the owner sees when the shop is shut without opening Store.
  const _fmtDay = (d) => d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
  const closureHits = [];
  for (const c of (closures || [])) {
    const yrs = [_startToday.getFullYear(), _startToday.getFullYear() + 1];
    const consider = (isoDate, isRange, toIso) => {
      const d = new Date(`${isoDate}T00:00:00`);
      if (Number.isNaN(d.getTime())) return;
      if (d >= _startToday && d <= _in30) closureHits.push({ label: c.label || 'Closed', d, range: isRange, to: toIso });
    };
    if (c.date) {
      if (c.annual) yrs.forEach((y) => consider(`${y}-${c.date.slice(5)}`, false));
      else consider(c.date, false);
    } else if (c.from) {
      if (c.annual) yrs.forEach((y) => consider(`${y}-${c.from.slice(5)}`, true, c.to));
      else consider(c.from, true, c.to);
    }
  }
  const upcomingClosures = closureHits.sort((a, b) => a.d - b.d).slice(0, 6);
  // Reply-to-customer without a new backend: mailto for an email, tel for a phone.
  const replyHref = (contact) => {
    if (!contact) return null;
    if (contact.includes('@')) return `mailto:${contact}?subject=${encodeURIComponent('Re: your message to Bean Culture')}`;
    const digits = contact.replace(/[^\d+]/g, '');
    return digits ? `tel:${digits}` : null;
  };

  return (
    <div className="admin-root" data-admin-theme={adminTheme}>
      <div className={`admin-shell ${shellWidthClass(tab)}`}>
        <div className="admin-head">
          <button className="link" onClick={onExit}>← Store</button>
          <h2 style={{ margin: 0, fontFamily: 'Georgia, serif' }}>Bean Culture · Control panel</h2>
          {!data.dbEnabled
            ? <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>⚠ DB off — changes won’t persist</span>
            : <span style={{ width: 60 }} />}
        </div>

        <div className="admin-layout">
          <nav className="admin-tabs">
            {TAB_GROUPS.map((g) => (
              <div className="admin-tab-group" key={g.label}>
                <div className="admin-tab-group-label">{g.label}</div>
                {g.tabs.map((id) => {
                  const t = TABS.find((x) => x.id === id);
                  if (!t) return null;
                  return (
                    <button key={t.id} className={`admin-tab ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)} type="button">
                      <t.Icon size={20} /><span>{t.label}</span>
                      {t.id === 'reservations' && newResvCount > 0 && (
                        <span className="pill" style={{ background: '#c0392b', color: '#fff', fontSize: 10, fontWeight: 800, padding: '1px 6px', marginLeft: 4 }}>{newResvCount}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
            <div className="admin-theme-switch">
              <div className="admin-theme-switch-label">Backend appearance</div>
              <div className="admin-theme-swatches">
                {['light', 'dark-pink', 'dark-blue', 'dark-green', 'plum'].map((th) => (
                  <button key={th} type="button" className={`admin-theme-swatch ${adminTheme === th ? 'on' : ''}`}
                    data-swatch={th} onClick={() => setAdminTheme(th)} aria-label={`${th} theme`} title={th} />
                ))}
              </div>
            </div>
          </nav>

          <div className="admin-panel">
            {/* ───────── DASHBOARD ───────── */}
            {tab === 'overview' && (
              <>
                <div className="admin-page-head">
                  <div className="admin-greet">{_greeting}</div>
                  <p className="admin-page-desc">Here’s what’s happening at Bean Culture today.</p>
                </div>
                {/* One status tile PER store, so multiple locations each show their
                    own Open / Closed / event countdown — not a single ambiguous one. */}
                <div className="stat-tiles" style={{ marginBottom: 18 }}>
                  {((data.locationStatuses && data.locationStatuses.length)
                    ? data.locationStatuses
                    : [{ id: 'main', name: (s && s.storeName) || 'Store', type: 'physical', open: h.open }]
                  ).map((l) => {
                    const opening = l.opening;
                    const word = l.ended ? 'Ended' : opening ? 'Opens' : (l.open ? 'Open' : 'Closed');
                    const color = l.ended ? 'var(--admin-muted, #8a7680)'
                      : opening ? 'var(--admin-warning, #b26b00)'
                      : (l.open ? 'var(--admin-success)' : 'var(--admin-danger)');
                    const detail = opening ? opening.label : '';
                    const typeTag = l.type === 'event' ? ' · event' : l.type === 'popup' ? ' · pop-up' : '';
                    return (
                      <div key={l.id} className="stat-tile" style={{ cursor: 'pointer' }} onClick={() => setTab('locations')}>
                        <div className="stat-v" style={{ color, fontSize: 20 }}>{l.open && !opening ? '● ' : ''}{word}</div>
                        <div className="stat-l">{l.name}{typeTag}{detail ? ` · ${detail}` : ''}</div>
                      </div>
                    );
                  })}
                  <div className="stat-tile" style={{ cursor: 'pointer' }} onClick={() => setTab('users')}>
                    <div className="stat-v">{users ? users.length : '—'}</div>
                    <div className="stat-l">Loyalty members</div>
                  </div>
                </div>

                <div className="admin-cmd-grid">
                  {/* Upcoming reservations — future only, nothing past. */}
                  <div className="card" style={{ marginBottom: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div className="group-title" style={{ margin: 0 }}>Upcoming reservations{upcomingResv.length ? ` (${upcomingResv.length}${newResvCount > 0 ? `, ${newResvCount} new` : ''})` : ''}</div>
                      <button type="button" className="link" style={{ padding: 0, fontSize: 'var(--fs-base)' }} onClick={() => setTab('reservations')}>View all</button>
                    </div>
                    {resv === null && <div className="cmd-empty">Loading…</div>}
                    {resv && upcomingResv.length === 0 && <div className="cmd-empty">No upcoming bookings.</div>}
                    <div className="cmd-list">
                      {upcomingResv.map((r) => (
                        <div key={r.id} className="cmd-row">
                          <div className="cmd-row-top">
                            <span className="cmd-row-title">{r.party} {r.party === 1 ? 'guest' : 'guests'} · {r.name || '—'}</span>
                            <span className={`cmd-chip ${r.status === 'confirmed' ? 'confirmed' : r.status === 'seated' ? 'seated' : 'pending'}`}>{r.status || 'pending'}</span>
                          </div>
                          <div className="cmd-row-sub">
                            {new Date(r.reserveAt).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                            {r.phone ? ` · ${r.phone}` : ''}{r.notes ? ` · ${r.notes}` : ''}
                          </div>
                          {r.status !== 'confirmed' && (
                            <div className="cmd-row-actions">
                              <button className="link" style={{ padding: 0, fontSize: 'var(--fs-base)', color: 'var(--admin-success)' }} onClick={() => setResvStatus(r, 'confirmed')}>Confirm</button>
                              <button className="link" style={{ padding: 0, fontSize: 'var(--fs-base)', color: 'var(--admin-danger)' }} onClick={() => setResvStatus(r, 'cancelled')}>Cancel</button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* New customer messages — reply straight from here. */}
                  <div className="card" style={{ marginBottom: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div className="group-title" style={{ margin: 0 }}>New messages{unreadMsgs.length ? ` (${unreadMsgs.length})` : ''}</div>
                      <button type="button" className="link" style={{ padding: 0, fontSize: 'var(--fs-base)' }} onClick={() => setTab('store')}>All messages</button>
                    </div>
                    {msgs === null && <div className="cmd-empty">Loading…</div>}
                    {msgs && unreadMsgs.length === 0 && <div className="cmd-empty">No new enquiries. 🎉</div>}
                    <div className="cmd-list">
                      {unreadMsgs.map((m) => {
                        const href = replyHref(m.contact);
                        return (
                          <div key={m.id} className="cmd-row">
                            <div className="cmd-row-top">
                              <span className="cmd-row-title" style={{ textTransform: 'capitalize' }}>{m.type} · {m.name || 'Anonymous'}</span>
                              <span className="cmd-row-sub" style={{ marginTop: 0 }}>{new Date(m.createdAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}</span>
                            </div>
                            {m.contact && <div className="cmd-row-sub">{m.contact}</div>}
                            <div style={{ fontSize: 'var(--fs-md)', whiteSpace: 'pre-line', margin: '4px 0 0', color: 'var(--admin-text)' }}>{m.body}</div>
                            <div className="cmd-row-actions">
                              {href && <a className="link" style={{ padding: 0, fontSize: 'var(--fs-base)', color: 'var(--admin-accent)' }} href={href}>Reply</a>}
                              <button className="link" style={{ padding: 0, fontSize: 'var(--fs-base)' }} onClick={() => toggleHandled(m)}>Mark done</button>
                              <button className="link" style={{ padding: 0, fontSize: 'var(--fs-base)', color: 'var(--admin-danger)' }} onClick={() => deleteMsg(m)}>Delete</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Upcoming closures / public holidays — next 30 days. Spans the
                      full width so it doesn't leave an empty cell beside it. */}
                  <div className="card" style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
                    <div className="group-title" style={{ margin: 0 }}>Upcoming closures (next 30 days){upcomingClosures.length ? ` (${upcomingClosures.length})` : ''}</div>
                    {upcomingClosures.length === 0 && <div className="cmd-empty">Open every day for the next 30 days.</div>}
                    <div className="cmd-list">
                      {upcomingClosures.map((c, i) => (
                        <div key={i} className="cmd-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                          <span className="cmd-row-title">{c.label}</span>
                          <span className="cmd-chip closed">{_fmtDay(c.d)}{c.range && c.to ? ` → ${_fmtDay(new Date(`${c.to}T00:00:00`))}` : ''}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                </div>

                {/* App performance — the same app data as Insights (minus the
                    product heat map), surfaced here for an at-a-glance view. */}
                <AppPerformanceSection days={aDays} onDays={setADays} dashboard={dashboard}
                  analytics={analytics} refreshing={insRefreshing} onRefresh={reloadInsights} />

                {!data.dbEnabled && (
                  <div className="card" style={card}>
                    <div className="group-title" style={{ color: 'var(--admin-danger)' }}>⚠ Database off</div>
                    <p className="muted" style={{ fontSize: 'var(--fs-sm)', margin: '4px 0 0' }}>Settings changes won't persist between deploys until a database is connected.</p>
                  </div>
                )}
              </>
            )}

            {/* ───────── STORE ───────── */}
            {tab === 'store' && (
              <>
                <div className="admin-page-head">
                  <h1 className="admin-page-title">Store settings</h1>
                  <p className="admin-page-desc">Business details, contact info, branding, opening/kitchen hours and closures.</p>
                </div>
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
                  <label className="field" style={{ marginTop: 10 }}><span>Maximum site width (desktop)</span>
                    <select value={s.siteMaxWidth === 'full' ? 'full' : String(s.siteMaxWidth || 1920)}
                      onChange={(e) => set({ siteMaxWidth: e.target.value === 'full' ? 'full' : Number(e.target.value) })}>
                      <option value="1440">1440px — narrow</option>
                      <option value="1920">1920px — recommended</option>
                      <option value="2560">2560px — wide</option>
                      <option value="full">Full width (no cap)</option>
                    </select></label>
                  <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 4 }}>Caps the whole storefront on large screens so the hero banner and content don’t over-stretch. “Full width” removes the cap for edge-to-edge designs.</p>
                </div>

                <div className="card" style={card}>
                  <div className="group-title">Loyalty automation</div>
                  <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 0 }}>Grow your Square loyalty membership automatically. Needs an active Square loyalty program.</p>
                  <label className="field-row" style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
                    <input type="checkbox" checked={(s.loyalty?.autoEnrollOnSignIn) !== false} onChange={(e) => set({ loyalty: { ...(s.loyalty || {}), autoEnrollOnSignIn: e.target.checked } })} />
                    <span>Auto-enrol members when they sign in</span>
                  </label>
                  <label className="field-row" style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
                    <input type="checkbox" checked={(s.loyalty?.autoEnrollGiftRecipients) !== false} onChange={(e) => set({ loyalty: { ...(s.loyalty || {}), autoEnrollGiftRecipients: e.target.checked } })} />
                    <span>Auto-enrol Pay It Forward recipients (gifted coffee earns points)</span>
                  </label>
                  <label className="field" style={{ marginTop: 10 }}><span>Welcome points on first order (0 = off)</span>
                    <input type="number" min="0" step="1" value={s.loyalty?.firstTransactionBonusPoints ?? 1} onChange={(e) => set({ loyalty: { ...(s.loyalty || {}), firstTransactionBonusPoints: Math.max(0, Math.round(Number(e.target.value) || 0)) } })} /></label>
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
                      <div style={{ display: 'flex', gap: 16, marginTop: 4 }}>
                        <button className="link" style={{ padding: 0, fontSize: 'var(--fs-base)' }} onClick={() => toggleHandled(m)}>{m.handled ? 'Mark unread' : 'Mark done'}</button>
                        <button className="link" style={{ padding: 0, fontSize: 'var(--fs-base)', color: 'var(--admin-danger)' }} onClick={() => deleteMsg(m)}>Delete</button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="admin-two-col">
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
                  <label style={{ display: 'grid', gap: 4, marginTop: 12, maxWidth: 280 }}>
                    <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>“Pre-order now” button opens on</span>
                    <select value={s.preorderCategory || ''} onChange={(e) => set({ preorderCategory: e.target.value })}
                      style={{ padding: 8, borderRadius: 10, border: '1px solid var(--line)' }}>
                      <option value="">— top of the order form —</option>
                      {cats.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>Shown to customers when the store is closed, jumps straight to this heading when tapped.</span>
                  </label>
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
                  <label style={{ display: 'grid', gap: 4, marginTop: 10, maxWidth: 280 }}>
                    <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>“Order now” button (kitchen closing soon) opens on</span>
                    <select value={s.kitchenClosingOrderCategory || ''} onChange={(e) => set({ kitchenClosingOrderCategory: e.target.value })}
                      style={{ padding: 8, borderRadius: 10, border: '1px solid var(--line)' }}>
                      <option value="">— top of the menu —</option>
                      {cats.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>Shown when the kitchen is closing within the hour, jumps straight to this heading when tapped.</span>
                  </label>
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
                  {closures.length > 0 && (() => {
                    // Sort by date and group under a year pill (keeps each entry's
                    // original index so Remove still targets the right one). Ranges
                    // stay clustered on one line. Compact multi-column grid so a long
                    // holiday list doesn't run the page down forever.
                    const items = closures.map((c, i) => ({ c, i, key: c.from || c.date || '' }))
                      .sort((a, b) => String(a.key).localeCompare(String(b.key)));
                    const groups = {};
                    for (const it of items) { const y = String(it.key).slice(0, 4) || 'Recurring'; (groups[y] = groups[y] || []).push(it); }
                    const fmt = (iso) => { const d = new Date(`${iso}T00:00:00`); return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }); };
                    return (
                      <div style={{ marginTop: 4 }}>
                        {Object.keys(groups).sort().map((y) => (
                          <div key={y} className="admin-closure-year">
                            <span className="admin-closure-pill">{y}</span>
                            <div className="admin-closure-grid">
                              {groups[y].map(({ c, i }) => (
                                <div key={i} className="admin-closure-item">
                                  <span><strong>{c.from ? `${fmt(c.from)} → ${fmt(c.to)}` : fmt(c.date)}</strong>{c.label ? ` · ${c.label}` : ''}{c.annual ? ' · yearly' : ''}</span>
                                  <button className="link" style={{ color: 'var(--admin-danger)', padding: '0 2px' }} title="Remove" onClick={() => rmClosure(i)}>✕</button>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              </>
            )}

            {/* ───────── RESERVATIONS ───────── */}
            {tab === 'reservations' && (
              <>
                <div className="admin-page-head">
                  <h1 className="admin-page-title">Reservations</h1>
                  <p className="admin-page-desc">Table bookings and ticket-printing setup.</p>
                </div>
                <div className="card" style={card}>
                  <div className="group-title">Notification email</div>
                  <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 0 }}>A copy of every new reservation is emailed here (in addition to the ticket printing). Leave blank to use the default address.</p>
                  <label className="field"><span>Reservation copies go to</span>
                    <input type="email" inputMode="email" value={s.reservationNotifyEmail || ''} onChange={(e) => set({ reservationNotifyEmail: e.target.value })} placeholder="bookings@yourcafe.com.au" /></label>
                </div>
                <div className="card" style={card}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                    <div className="group-title" style={{ margin: 0 }}>Reservations</div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <button type="button" className={`chip ${resvDeleteLock ? 'on' : ''}`} onClick={() => setResvDeleteLock((v) => !v)}
                        style={{ fontSize: 'var(--fs-sm)' }} title={resvDeleteLock ? 'Locked — tap to allow deleting reservations' : 'Unlocked — tap to lock again'}>
                        {resvDeleteLock ? '🔒 Delete locked' : '🔓 Delete unlocked'}</button>
                      <button type="button" className="btn ghost" style={{ padding: '6px 12px', fontSize: 'var(--fs-base)' }} onClick={() => loadReservations()}>{resv === null ? 'Load' : 'Refresh'}</button>
                    </div>
                  </div>
                  <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 4 }}>
                    Table bookings from the app. Alerts: {resvChannels.sms ? 'SMS on' : 'SMS off'} · {resvChannels.email ? 'email on' : 'email off'}. Each booking also creates a $0 Square order so it prints + shows in Square.
                  </p>
                  {resv === null && <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Loading…</p>}
                  {resv && resv.length === 0 && <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>No reservations yet.</p>}
                  {resv && resv.length > 0 && (
                    <div className="admin-two-col">
                    {resv.map((r) => (
                    <div key={r.id} className="history-item" style={{ opacity: r.status === 'cancelled' ? 0.5 : 1 }}>
                      <div className="history-top">
                        <span><strong>{r.party} {r.party === 1 ? 'guest' : 'guests'}</strong> · {r.name || '—'}</span>
                        <span className={`cmd-chip ${r.status === 'confirmed' ? 'confirmed' : r.status === 'seated' ? 'seated' : r.status === 'cancelled' ? 'closed' : 'pending'}`}>{r.status}</span>
                      </div>
                      <div className="muted" style={{ fontSize: 'var(--fs-base)', margin: '3px 0' }}>
                        {r.reserveAt ? new Date(r.reserveAt).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—'} · {r.phone || ''}{r.email ? ` · ${r.email}` : ''}
                      </div>
                      {r.notes && <div style={{ fontSize: 'var(--fs-base)' }}>{r.notes}</div>}
                      <div style={{ display: 'flex', gap: 12, marginTop: 4, alignItems: 'center' }}>
                        {['confirmed', 'seated', 'cancelled'].filter((st) => st !== r.status).map((st) => (
                          <button key={st} className="link" style={{ padding: 0, fontSize: 'var(--fs-base)', textTransform: 'capitalize', color: st === 'cancelled' ? '#c0392b' : undefined }} onClick={() => setResvStatus(r, st)}>Mark {st}</button>
                        ))}
                        <button className="link" disabled={resvDeleteLock} style={{ padding: 0, fontSize: 'var(--fs-base)', marginLeft: 'auto', color: 'var(--admin-danger)', opacity: resvDeleteLock ? 0.3 : 1 }}
                          title={resvDeleteLock ? 'Unlock delete (top of card) to remove' : 'Delete this reservation'} onClick={() => removeReservation(r)}>Delete</button>
                      </div>
                    </div>
                    ))}
                    </div>
                  )}
                </div>

                <div className="card" style={card}>
                  <div className="group-title">Ticket printing setup</div>
                  <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 0 }}>
                    Each booking submits a real $0 Square order against a "Table Reservation" item so it prints on your
                    receipt/kitchen printer the same way a normal order does. This finds or creates that item and its
                    "Reservations" category in Square, and makes sure the item is actually filed under that category
                    for printing — adding a category to an item in the Square Dashboard doesn't always make it the one
                    printers route by, which is the most common reason this silently doesn't print.
                  </p>
                  {!s?.reservationItemId && (
                    <button className="btn" disabled={resvSetupBusy} onClick={runResvSetup}>{resvSetupBusy ? 'Setting up…' : 'Set up reservation printing'}</button>
                  )}
                  {s?.reservationItemId && !resvPrintStatus && <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Checking…</p>}
                  {s?.reservationItemId && resvPrintStatus && resvPrintStatus.error && (
                    <p className="error-text" style={{ fontSize: 'var(--fs-sm)' }}>Couldn't check: {resvPrintStatus.error}</p>
                  )}
                  {s?.reservationItemId && resvPrintStatus && !resvPrintStatus.error && (() => {
                    const ok = (resvPrintStatus.reportingCategory?.name || '').toLowerCase() === 'reservations';
                    return (
                      <div style={{ padding: 10, borderRadius: 10, background: `color-mix(in srgb, ${ok ? 'var(--admin-success)' : 'var(--admin-danger)'} 14%, transparent)`, border: `1px solid color-mix(in srgb, ${ok ? 'var(--admin-success)' : 'var(--admin-danger)'} 45%, transparent)`, marginTop: 4 }}>
                        <div style={{ fontWeight: 700, color: ok ? 'var(--admin-success)' : 'var(--admin-danger)' }}>
                          {ok ? '✓ Looks correct' : '⚠ Not printing under Reservations'}
                        </div>
                        <div style={{ fontSize: 'var(--fs-sm)', marginTop: 4 }}>
                          "{resvPrintStatus.name}" currently prints under <strong>{resvPrintStatus.reportingCategory?.name || '— none —'}</strong>.
                          {!ok && ' Add "Reservations" as the printing category in Square, then use Fix now below, or just Fix now if it is already tagged with it.'}
                        </div>
                        {!ok && (
                          <button className="btn ghost" style={{ marginTop: 8, padding: '6px 12px', fontSize: 'var(--fs-base)' }} disabled={resvSetupBusy} onClick={fixResvCategory}>
                            {resvSetupBusy ? 'Fixing…' : 'Fix now'}
                          </button>
                        )}
                      </div>
                    );
                  })()}
                  {s?.reservationItemId && (
                    <button className="link" style={{ marginTop: 8, fontSize: 'var(--fs-sm)' }} disabled={resvSetupBusy} onClick={runResvSetup}>Re-run setup</button>
                  )}
                  {resvSetupMsg && <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{resvSetupMsg}</p>}
                  <p className="muted" style={{ fontSize: 'var(--fs-xs)', marginTop: 10 }}>
                    Last step is on the Square side: in Square, open your printer's profile → <strong>Online Order Tickets</strong> (or
                    Order tickets) → Categories to print, and tick <strong>Reservations</strong>. Once that's ticked and the status above
                    shows ✓, new bookings will print automatically.
                  </p>
                </div>
              </>
            )}

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
                  <div className="group-title">Top menu — combine buttons</div>
                  <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 0 }}>Too many buttons in the top “Browse the menu” bar? Group a few sections under one button (e.g. <strong>“Deals” = Combos + Specials</strong>). Grouped sections still show as their own headings in the menu; the button jumps to the first. Any section you don’t group keeps its own button.</p>
                  {topMenu.map((slot, i) => (
                    <div key={i} {...dropZone('topmenu', i, (f, t) => setTopMenu(reorderArray(topMenu, f, t)))}
                      className={isDragOver('topmenu', i) ? 'drag-over' : ''}
                      style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 10, marginBottom: 10 }}>
                      <div style={{ ...row, gap: 10 }}>
                        <span {...dragHandle('topmenu', i)}>⠿</span>
                        <IconPicker value={{ icon: slot.icon, iconSvg: slot.iconSvg }} brand={s.theme?.brand} onChange={(v) => updTopSlot(i, v)} />
                        <input value={slot.label || ''} onChange={(e) => updTopSlot(i, { label: e.target.value })} placeholder="Button label"
                          style={{ flex: 1, minWidth: 0, padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 10 }} />
                        <div style={row}>
                          <button className="link" onClick={() => moveTopSlot(i, -1)}>↑</button>
                          <button className="link" onClick={() => moveTopSlot(i, 1)}>↓</button>
                          <button className="link" style={{ color: '#c0392b' }} onClick={() => rmTopSlot(i)}>✕</button>
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                        {cats.map((c) => {
                          const on = slot.categories.some((x) => x.toLowerCase() === c.toLowerCase());
                          return <button key={c} onClick={() => toggleTopSlotCat(i, c)} className={`chip ${on ? 'on' : ''}`} style={{ fontSize: 'var(--fs-xs)', padding: '5px 9px' }}>{c}</button>;
                        })}
                      </div>
                    </div>
                  ))}
                  <button className="btn ghost full" onClick={addTopSlot}>+ Add combined button</button>
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
                    toggles in Product builder). Drag or use ↑/↓ to set the order they appear. Tap a row's icon to choose its picture.
                  </p>
                  <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', padding: '8px 0 12px', marginBottom: 8, borderBottom: '1px solid var(--admin-border)' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '1 1 240px' }}>
                      <span className="muted" style={{ fontSize: 'var(--fs-sm)', whiteSpace: 'nowrap' }}>Top menu icon size {Math.round((s.dockIconScale || 1) * 100)}%</span>
                      <input type="range" min="0.7" max="1.8" step="0.05" value={s.dockIconScale || 1} onChange={(e) => set({ dockIconScale: Number(e.target.value) })} style={{ flex: 1 }} />
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '1 1 240px' }}>
                      <span className="muted" style={{ fontSize: 'var(--fs-sm)', whiteSpace: 'nowrap' }}>Footer icon size {Math.round((s.footerIconScale || 1) * 100)}%</span>
                      <input type="range" min="0.7" max="1.8" step="0.05" value={s.footerIconScale || 1} onChange={(e) => set({ footerIconScale: Number(e.target.value) })} style={{ flex: 1 }} />
                    </label>
                  </div>
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
                            <IconPicker value={(s.categoryIcons || {})[u.name]} brand={s.theme?.brand} onChange={(v) => set({ categoryIcons: { ...(s.categoryIcons || {}), [u.name]: v } })} />
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
                            <IconPicker value={(s.categoryIcons || {})[sec.name]} brand={s.theme?.brand} onChange={(v) => set({ categoryIcons: { ...(s.categoryIcons || {}), [sec.name]: v } })} />
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
                          <IconPicker value={(s.categoryIcons || {})[c.category]} brand={s.theme?.brand} onChange={(v) => set({ categoryIcons: { ...(s.categoryIcons || {}), [c.category]: v } })} />
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
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                    <div className="group-title" style={{ margin: 0 }}>Product builder</div>
                    <button type="button" className={`chip ${deleteLock ? 'on' : ''}`} onClick={() => setDeleteLock((v) => !v)}
                      style={{ fontSize: 'var(--fs-sm)' }} title={deleteLock ? 'Locked — tap to allow deleting tiles' : 'Unlocked — tap to lock again'}>
                      {deleteLock ? '🔒 Delete locked' : '🔓 Delete unlocked'}
                    </button>
                  </div>
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
                          <button type="button" className="link" title="Rename this section" onClick={() => renameSection(secName)} style={{ fontSize: 'var(--fs-sm)' }}>✏️ Rename</button>
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
                          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-sm)' }} title="Make this section available to event locations WITHOUT putting it in your normal menus. Then pick it under an event store's 'Event menu' list.">
                            <input type="checkbox" checked={presetSectionNav[secName]?.event === true} onChange={(e) => setSectionNav(secName, { event: e.target.checked })} /> Event locations
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
                          <button className="link" disabled={deleteLock} style={{ color: '#c0392b', opacity: deleteLock ? 0.3 : 1 }}
                            title={deleteLock ? 'Unlock delete (top-right) to remove' : 'Remove preset'} onClick={() => rmPreset(p.id)}>✕</button>
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
                            {cfg && p.sourceItemId && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                {(() => {
                                  const img = imgOverride[p.sourceItemId] || cfg.image;
                                  return img
                                    ? <img src={img} alt="" style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover', flex: 'none' }} />
                                    : <span style={{ width: 44, height: 44, borderRadius: 8, background: 'var(--brand-soft)', flex: 'none', display: 'grid', placeItems: 'center', fontSize: 'var(--fs-lg)' }}>🍽️</span>;
                                })()}
                                <label className="btn ghost" title="Upload a real photo to this Square item — updates it everywhere the product is used"
                                  style={{ padding: '5px 10px', fontSize: 'var(--fs-sm)', cursor: imgBusy === p.sourceItemId ? 'default' : 'pointer' }}>
                                  {imgBusy === p.sourceItemId ? 'Uploading…' : ((imgOverride[p.sourceItemId] || cfg.image) ? 'Replace photo' : 'Add photo')}
                                  <input type="file" accept="image/*" style={{ display: 'none' }} disabled={imgBusy === p.sourceItemId}
                                    onChange={(e) => { const f = e.target.files[0]; if (f) uploadSquareImage(f, p.sourceItemId); e.target.value = ''; }} />
                                </label>
                                <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>Sends the photo to Square — updates it everywhere this product is used, not just this tile.</span>
                              </div>
                            )}
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
                                {(cfg.modifierGroups || []).length > 0 && (
                                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-sm)', cursor: 'pointer' }}
                                    title="Show every option in every heading below (untick to hide all)">
                                    <input type="checkbox" checked={presetAllShown(p, cfg)} onChange={(e) => setPresetShowAll(p.id, cfg, e.target.checked)} />
                                    <strong>Select all options</strong>
                                  </label>
                                )}
                                {(cfg.modifierGroups || []).map((g) => (
                                  <div key={g.id} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 8 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
                                      <div style={{ fontWeight: 600, fontSize: 'var(--fs-base)' }}>{g.name}
                                        <span className="muted" style={{ fontWeight: 400 }}>{g.selectionType === 'SINGLE' ? ' · choose one' : g.max > 0 ? ` · up to ${g.max}` : ''}</span>
                                      </div>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 'var(--fs-sm)' }}>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }} title="Show every option in this heading">
                                          <input type="checkbox" checked={groupAllShown(p, g)} onChange={(e) => setGroupShowAll(p.id, g, e.target.checked)} />
                                          Show all
                                        </label>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }} title="Customer must pick at least one option in this heading">
                                          <input type="checkbox" checked={(p.requiredGroups || []).includes(g.id)} onChange={() => toggleGroupRequired(p.id, g.id)} />
                                          Required
                                        </label>
                                      </div>
                                    </div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                      {g.modifiers.map((m) => {
                                        const st = p.groups?.[g.id]?.[m.id] || 'off';
                                        const label = { off: 'Hide', optional: 'Show', default: 'Default', locked: 'Locked' }[st];
                                        const sty = {
                                          off: { background: 'transparent', color: 'var(--muted)', border: '1px solid var(--line)' },
                                          optional: { background: 'var(--brand-soft)', color: 'var(--ink)', border: '1px solid var(--accent)' },
                                          default: { background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)' },
                                          locked: { background: 'var(--ink)', color: 'var(--bg)', border: '1px solid var(--ink)' },
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

            {/* ───────── COMBO BUILDER ───────── */}
            {tab === 'combobuilder' && (
              <>
                <div className="admin-page-head">
                  <h1 className="admin-page-title">Combo Builder</h1>
                  <p className="admin-page-desc">Bundle items from different parts of your menu (a burger + a side + a drink) with an automatic dollar discount — without needing Square's paid Combo item type or its higher processing rate. Nothing is created in Square's catalog; the discount applies itself at checkout.</p>
                </div>

                <div className="card" style={card}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                    <div className="group-title" style={{ margin: 0 }}>Combos</div>
                    <button type="button" className={`chip ${comboDeleteLock ? 'on' : ''}`} onClick={() => setComboDeleteLock((v) => !v)}
                      style={{ fontSize: 'var(--fs-sm)' }} title={comboDeleteLock ? 'Locked — tap to allow deleting combos' : 'Unlocked — tap to lock again'}>
                      {comboDeleteLock ? '🔒 Delete locked' : '🔓 Delete unlocked'}
                    </button>
                  </div>
                  <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 6 }}>
                    Each combo needs at least one group (e.g. "Choose your burger"). A group is satisfied by any item in a Square category and/or items you hand-pick. The customer picks one option per group; the combo's price is the sum of what they picked, minus your discount. Remember to press <strong>Save changes</strong>.
                  </p>
                  {combos.length === 0 && <p className="muted" style={{ fontSize: 'var(--fs-base)' }}>No combos yet — add one below.</p>}
                </div>

                {combos.map((combo) => (
                  <div key={combo.id} className="card" style={card}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                      {combo.image ? (
                        <img src={combo.image} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--line)' }} />
                      ) : (
                        <div style={{ width: 64, height: 64, borderRadius: 10, border: '1px dashed var(--line)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                          <ComboIcon size={22} />
                        </div>
                      )}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <label className="btn ghost" style={{ padding: '6px 10px', fontSize: 'var(--fs-sm)', cursor: 'pointer', width: 'fit-content' }}>
                          {combo.image ? 'Change photo' : 'Add photo'}
                          <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files[0]; if (f) uploadImage(f, (url) => updCombo(combo.id, { image: url }), 'combos'); }} />
                        </label>
                        {combo.image && <button type="button" className="link" style={{ fontSize: 'var(--fs-xs)' }} onClick={() => updCombo(combo.id, { image: '' })}>Remove photo</button>}
                      </div>
                      <div style={{ flex: '1 1 260px', minWidth: 200, display: 'grid', gap: 10 }}>
                        <label className="field" style={{ margin: 0 }}><span>Combo name</span>
                          <input value={combo.name || ''} onChange={(e) => updCombo(combo.id, { name: e.target.value })} placeholder="e.g. Tradies Special" style={{ fontWeight: 700 }} /></label>
                        <label className="field" style={{ margin: 0 }}><span>Description (optional)</span>
                          <textarea value={combo.description || ''} onChange={(e) => updCombo(combo.id, { description: e.target.value })} placeholder="An egg &amp; bacon roll + small coffee." rows={2} /></label>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                        <button type="button" className={`chip ${combo.active !== false ? 'on' : ''}`} onClick={() => updCombo(combo.id, { active: combo.active === false })}>
                          {combo.active !== false ? 'Active' : 'Off'}
                        </button>
                        <button type="button" className="link" disabled={comboDeleteLock} style={{ color: 'var(--admin-danger)', opacity: comboDeleteLock ? 0.3 : 1 }}
                          title={comboDeleteLock ? 'Unlock delete (top of card) to remove' : 'Delete this combo'}
                          onClick={() => { if (window.confirm(`Delete "${combo.name || 'this combo'}"?`)) rmCombo(combo.id); }}>Delete</button>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 14 }}>
                      <label className="field" style={{ flex: '1 1 200px', minWidth: 160 }}>
                        <span>Storefront section</span>
                        <input list="combo-section-names" value={combo.section || ''} onChange={(e) => updCombo(combo.id, { section: e.target.value })} placeholder="Combos" />
                      </label>
                      <label className="field" style={{ flex: '0 0 160px' }}>
                        <span>Discount ($ off)</span>
                        <input type="number" min="0" step="0.5" value={combo.discountValue ?? 0} onChange={(e) => updCombo(combo.id, { discountValue: Number(e.target.value) })} />
                      </label>
                      {(() => {
                        const { retail, known } = comboRetail(combo);
                        const disc = Math.round((Number(combo.discountValue) || 0) * 100);
                        const final = Math.max(0, retail - disc);
                        return (
                          <div style={{ flex: '1 1 240px', minWidth: 210, alignSelf: 'flex-end', padding: '10px 12px', border: '1px solid var(--admin-border)', borderRadius: 10, background: 'var(--admin-surface-soft)' }}>
                            <div className="muted" style={{ fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 4 }}>Deal maths · cheapest options</div>
                            {known && retail > 0 ? (
                              <div style={{ fontSize: 'var(--fs-sm)' }}>Retail <strong>{formatMoney(retail, data?.currency)}</strong> − {formatMoney(disc, data?.currency)} = <strong style={{ color: 'var(--admin-accent)' }}>{formatMoney(final, data?.currency)}</strong></div>
                            ) : <div className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Add a tile to each step to see the retail total &amp; deal price.</div>}
                          </div>
                        );
                      })()}
                    </div>

                    <div style={{ marginTop: 16 }}>
                      <div className="group-title" style={{ marginBottom: 8 }}>Groups — one "choose one" step per component</div>
                      {(combo.groups || []).map((group, gi) => {
                        const pickerKey = `${combo.id}:${group.id}`;
                        const pickerOpen = comboItemPicker === pickerKey;
                        const searchText = comboItemSearch[pickerKey] || '';
                        const filteredProducts = allProducts.filter((p) => !searchText || p.name.toLowerCase().includes(searchText.toLowerCase()));
                        return (
                          <div key={group.id} className="combo-group">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                              <span style={{ fontWeight: 700, color: 'var(--admin-heading)' }}>Step {gi + 1}</span>
                              <button type="button" className="link" style={{ color: 'var(--admin-danger)', padding: 0 }} onClick={() => rmComboGroup(combo.id, group.id)}>Remove step</button>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                              <label className="field" style={{ margin: 0 }}><span>Step name (shown to customers)</span>
                                <input value={group.label || ''} onChange={(e) => updComboGroup(combo.id, group.id, { label: e.target.value })} placeholder="e.g. Choose your burger" /></label>
                              <label className="field" style={{ margin: 0 }}><span>Options come from</span>
                                <select value={group.sourceType || 'both'} onChange={(e) => updComboGroup(combo.id, group.id, { sourceType: e.target.value })}>
                                  <option value="both">A category + hand-picked items</option>
                                  <option value="category">A whole category</option>
                                  <option value="items">Hand-picked items only</option>
                                </select></label>
                            </div>

                            {group.sourceType !== 'items' && (
                              <label className="field" style={{ marginTop: 12, marginBottom: 0 }}>
                                <span>Category (any item in it qualifies)</span>
                                <input list="combo-category-names" value={group.categoryName || ''} onChange={(e) => updComboGroup(combo.id, group.id, { categoryName: e.target.value })} placeholder="e.g. Burgers" />
                              </label>
                            )}

                            {group.sourceType !== 'category' && (() => {
                              // Unified option rows: Product Builder tiles (presetIds) are the
                              // preferred source; any legacy hand-picked raw items still show.
                              const optionRows = [
                                ...(group.presetIds || []).map((pid) => {
                                  const pr = (presets || []).find((x) => x.id === pid);
                                  return { key: 'preset:' + pid, label: pr ? pr.name : pid, sub: pr?.section || '', srcItemId: pr?.sourceItemId, tileGroups: pr?.groups || null, remove: () => toggleComboGroupPreset(combo.id, group.id, pid) };
                                }),
                                ...(group.itemIds || []).map((id) => {
                                  const it = allProducts.find((x) => x.id === id);
                                  return { key: id, label: (it?.name || id), sub: 'raw item', srcItemId: id, remove: () => toggleComboGroupItem(combo.id, group.id, id) };
                                }),
                              ];
                              const secFilter = comboPickerSec[pickerKey] != null ? comboPickerSec[pickerKey] : (group.categoryName || '');
                              const presetSections = [...new Set((presets || []).map((p) => p.section).filter(Boolean))];
                              const filteredPresets = (presets || []).filter((p) =>
                                (!searchText || (p.name || '').toLowerCase().includes(searchText.toLowerCase())) &&
                                (!secFilter || (p.section || '').toLowerCase() === secFilter.toLowerCase())
                              );
                              return (
                              <div style={{ marginTop: 14 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                                  <span style={{ fontWeight: 650, fontSize: 'var(--fs-sm)', color: 'var(--admin-text)' }}>Products in this step <span className="muted">({optionRows.length})</span></span>
                                  <button type="button" className="btn ghost" style={{ padding: '7px 14px', fontSize: 'var(--fs-sm)' }} onClick={() => setComboItemPicker(pickerOpen ? null : pickerKey)}>{pickerOpen ? 'Done' : (optionRows.length ? 'Edit products' : '+ Choose products')}</button>
                                </div>
                                {optionRows.length > 0 && (
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                                    {optionRows.map((r) => (
                                      <span key={r.key} className="chip on" style={{ fontSize: 'var(--fs-xs)' }}>
                                        {r.label}
                                        <button type="button" onClick={r.remove} style={{ marginLeft: 4, border: 'none', background: 'none', cursor: 'pointer', color: 'inherit' }}>✕</button>
                                      </span>
                                    ))}
                                  </div>
                                )}
                                {/* Per-combo option override — lock/hide an add-on for THIS combo only. */}
                                {optionRows.length > 0 && (
                                  <div style={{ marginTop: 8 }}>
                                    {optionRows.map((r) => {
                                      const lockKey = `${combo.id}:${group.id}:${r.key}`;
                                      const open = comboLockOpen === lockKey;
                                      const cfg = r.srcItemId ? itemConfigs[r.srcItemId] : null;
                                      const locks = (group.itemLocks && group.itemLocks[r.key]) || [];
                                      const hides = (group.itemHides && group.itemHides[r.key]) || [];
                                      const shows = (group.itemShows && group.itemShows[r.key]) || [];
                                      const defs = (group.itemDefaults && group.itemDefaults[r.key]) || [];
                                      const parts = [locks.length ? `${locks.length} locked` : '', hides.length ? `${hides.length} hidden` : ''].filter(Boolean).join(' · ');
                                      // Effective state of an add-on = per-combo override if set, else the
                                      // item's Product Builder tile state. Four states mirror the tile:
                                      // show (offered, not pre-ticked) / default (pre-ticked) / lock / hide.
                                      const tg = r.tileGroups; // preset tile config, or null for a raw legacy item
                                      const tileState = (mgId, modId) => { if (!tg) return 'show'; const gc = tg[mgId]; const s = gc && gc[modId]; return s === 'locked' ? 'lock' : s === 'default' ? 'default' : s ? 'show' : 'hide'; };
                                      const effState = (mgId, modId) => (locks.includes(modId) ? 'lock' : hides.includes(modId) ? 'hide' : shows.includes(modId) ? 'show' : defs.includes(modId) ? 'default' : tileState(mgId, modId));
                                      return (
                                        <div key={r.key} style={{ borderTop: '1px solid var(--admin-border)', paddingTop: 8, marginTop: 8 }}>
                                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                                            <span style={{ fontWeight: 650, fontSize: 'var(--fs-sm)' }}>{r.label}{parts ? <span className="muted"> · {parts}</span> : null}</span>
                                            <button type="button" className="link" onClick={async () => { if (!open && r.srcItemId) await ensureItemConfig(r.srcItemId); setComboLockOpen(open ? null : lockKey); }}>{open ? 'Done' : 'Override options'}</button>
                                          </div>
                                          {open && (() => {
                                            const revealHidden = !!comboShowHidden[lockKey];
                                            let hiddenCount = 0;
                                            if (cfg) for (const mg of cfg.modifierGroups || []) for (const m of mg.modifiers || []) if (effState(mg.id, m.id) === 'hide') hiddenCount++;
                                            return (
                                            <div style={{ marginTop: 8 }}>
                                              {!cfg && <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Loading options…</p>}
                                              {cfg && (cfg.modifierGroups || []).length === 0 && <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>This product has no add-ons to override.</p>}
                                              {cfg && (cfg.modifierGroups || []).map((mg) => {
                                                const mods = (mg.modifiers || []).filter((m) => revealHidden || effState(mg.id, m.id) !== 'hide');
                                                if (!mods.length) return null;
                                                return (
                                                <div key={mg.id} style={{ marginBottom: 8 }}>
                                                  <div className="muted" style={{ fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 4 }}>{mg.name}</div>
                                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                                    {mods.map((m) => {
                                                      const st = effState(mg.id, m.id);
                                                      const tag = st === 'lock' ? '🔒 Locked' : st === 'hide' ? '🚫 Hidden' : st === 'default' ? 'Default (pre-ticked)' : 'Show';
                                                      return (
                                                        <button key={m.id} type="button" className={`chip ${(st === 'lock' || st === 'default') ? 'on' : ''}`} style={{ fontSize: 'var(--fs-xs)', opacity: st === 'hide' ? 0.5 : 1, textDecoration: st === 'hide' ? 'line-through' : 'none' }}
                                                          title="Tap to cycle: Show → Default → Locked → Hidden"
                                                          onClick={() => cycleItemMod(combo.id, group.id, r.key, m.id, st)}>
                                                          {m.name}{m.price > 0 ? ` +${formatMoney(m.price, data?.currency)}` : ''} · {tag}
                                                        </button>
                                                      );
                                                    })}
                                                  </div>
                                                </div>
                                                );
                                              })}
                                              {hiddenCount > 0 && (
                                                <button type="button" className="link" style={{ fontSize: 'var(--fs-xs)' }}
                                                  onClick={() => setComboShowHidden((m) => ({ ...m, [lockKey]: !revealHidden }))}>
                                                  {revealHidden ? 'Hide the hidden add-ons' : `Show hidden add-ons (${hiddenCount})`}
                                                </button>
                                              )}
                                              <p className="muted" style={{ fontSize: 'var(--fs-xs)', marginTop: 4 }}>Tap an add-on to cycle <strong>Show → Default → Locked → Hidden</strong> — <strong>Show</strong> = offered but not pre-ticked, <strong>Default</strong> = pre-ticked, <strong>Locked</strong> = always included, <strong>Hidden</strong> = removed. Applies to this combo only; the item's own menu listing is unchanged.</p>
                                            </div>
                                            );
                                          })()}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                                {pickerOpen && (
                                  <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 8, marginTop: 8, maxHeight: 300, overflowY: 'auto' }}>
                                    <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                                      <input value={searchText} onChange={(e) => setComboItemSearch((m) => ({ ...m, [pickerKey]: e.target.value }))} placeholder="Search your products…"
                                        style={{ flex: '1 1 160px', minWidth: 140, padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 8 }} />
                                      <select value={secFilter} onChange={(e) => setComboPickerSec((m) => ({ ...m, [pickerKey]: e.target.value }))} style={{ padding: 8, borderRadius: 8, border: '1px solid var(--line)' }}>
                                        <option value="">All sections</option>
                                        {presetSections.map((sname) => <option key={sname} value={sname}>{sname}</option>)}
                                      </select>
                                    </div>
                                    {(presets || []).length === 0 && <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>No Product Builder products yet — build some in Product Builder first.</p>}
                                    {filteredPresets.slice(0, 200).map((p) => (
                                      <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 2px', fontSize: 'var(--fs-sm)' }}>
                                        <input type="checkbox" checked={(group.presetIds || []).includes(p.id)} onChange={() => { const adding = !(group.presetIds || []).includes(p.id); toggleComboGroupPreset(combo.id, group.id, p.id); if (adding) setComboItemPicker(null); }} />
                                        {p.name} <span className="muted">· {p.section || 'Specials'}</span>
                                      </label>
                                    ))}
                                    {(presets || []).length > 0 && filteredPresets.length === 0 && <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>No products match.</p>}
                                  </div>
                                )}
                              </div>
                              );
                            })()}
                          </div>
                        );
                      })}
                      <button type="button" className="btn ghost full" onClick={() => addComboGroup(combo.id)}>+ Add group</button>
                    </div>
                  </div>
                ))}

                <datalist id="combo-section-names">
                  {[...new Set([...adminCat.map((c) => c.category), ...productSections.map((x) => x.name), ...presets.map((x) => x.section), ...combos.map((x) => x.section)].filter(Boolean))].map((n) => <option key={n} value={n} />)}
                </datalist>
                <datalist id="combo-category-names">
                  {[...new Set(sqCats.map((c) => c.name))].filter(Boolean).map((n) => <option key={n} value={n} />)}
                </datalist>

                <button type="button" className="btn full" onClick={addCombo}>+ Add combo</button>
              </>
            )}

            {/* ───────── SMART CAMPAIGNS (Weather) ───────── */}
            {tab === 'smartcampaigns' && (() => {
              const sc = s?.smartCampaigns || {};
              const setSc = (patch) => set({ smartCampaigns: { ...sc, ...patch } });
              const wx = weatherStatus;
              const emoji = { sunny: '☀️', partly: '⛅', cloudy: '☁️', fog: '🌫️', rain: '🌧️', snow: '❄️', storm: '⛈️' }[wx && wx.condition] || '🌡️';
              const ageTxt = wx && wx.age_seconds != null ? (wx.age_seconds < 90 ? 'just now' : `${Math.round(wx.age_seconds / 60)} min ago`) : '';
              // ── Weather Campaign CRUD ──
              const campaigns = Array.isArray(sc.weather) ? sc.weather : [];
              const opts = sc.options || {};
              const setOpts = (patch) => setSc({ options: { ...opts, ...patch } });
              const setCampaigns = (list) => setSc({ weather: list });
              const nowIso = () => new Date().toISOString();
              const newId = () => 'wc_' + Math.random().toString(36).slice(2, 8);
              const blankCampaign = () => ({
                id: newId(), name: 'New weather campaign', internal_description: '', active: true, priority: 20,
                trigger_type: 'weather', weather_source: 'current', comparison_operator: 'gte', threshold_min: 28, threshold_max: 33,
                active_days: [], active_start_time: '', active_end_time: '', start_date: '', end_date: '',
                homepage_enabled: true, homepage_artwork: '', homepage_mobile_artwork: '', homepage_title: '', homepage_subtitle: '', homepage_alt_text: '', homepage_position: 'first', homepage_fit: 'cover',
                category_enabled: false, category_id: '', category_artwork: '', category_mobile_artwork: '', category_title: '', category_position: 'before', category_fit: 'cover',
                destination_type: 'category', destination_id: '', destination_label: '', destination_url: '', cta_text: '', locations: [], created_at: nowIso(), updated_at: nowIso(),
              });
              const addCampaign = () => { const c = blankCampaign(); setCampaigns([...campaigns, c]); setCampEditId(c.id); };
              const updateCampaign = (id, patch) => setCampaigns(campaigns.map((c) => (c.id === id ? { ...c, ...patch, updated_at: nowIso() } : c)));
              const removeCampaign = (id) => { setCampaigns(campaigns.filter((c) => c.id !== id)); if (campEditId === id) setCampEditId(null); };
              const duplicateCampaign = (id) => { const c = campaigns.find((x) => x.id === id); if (!c) return; const copy = { ...c, id: newId(), name: `${c.name} (copy)`, created_at: nowIso(), updated_at: nowIso() }; setCampaigns([...campaigns, copy]); setCampEditId(copy.id); };
              const editing = campaigns.find((c) => c.id === campEditId) || null;
              const OPERATORS = { gte: '≥', gt: '>', lte: '≤', lt: '<', between: 'between' };
              const SOURCES = { current: 'Current temperature', today_max: "Today's max", tomorrow_max: "Tomorrow's max" };
              const DESTS = { category: 'Product category', item: 'Specific product', scroll: 'Scroll to menu', account: 'Account', payitforward: 'Pay It Forward', url: 'Web link', none: 'No action' };
              const ruleText = (c) => `${SOURCES[c.weather_source] || 'Temp'} ${OPERATORS[c.comparison_operator] || '≥'} ${c.comparison_operator === 'between' ? `${c.threshold_min}–${c.threshold_max}` : c.threshold_min}°C`;
              // Would this campaign trigger with the CURRENT reading right now?
              const wouldMatchNow = (c) => {
                if (!wx || !wx.ok) return null;
                const v = c.weather_source === 'today_max' ? wx.today_max : c.weather_source === 'tomorrow_max' ? wx.tomorrow_max : wx.current_temperature;
                if (v == null) return null;
                const a = Number(c.threshold_min), b = Number(c.threshold_max);
                if (c.comparison_operator === 'between') return v >= Math.min(a, b) && v <= Math.max(a, b);
                if (c.comparison_operator === 'gte') return v >= a; if (c.comparison_operator === 'gt') return v > a;
                if (c.comparison_operator === 'lte') return v <= a; if (c.comparison_operator === 'lt') return v < a;
                return null;
              };
              return (
                <>
                  <div className="admin-page-head">
                    <h1 className="admin-page-title">Smart Campaigns</h1>
                    <p className="admin-page-desc">Contextual merchandising that reacts to the world &mdash; starting with the weather at your store. Create rules so a hot day automatically pushes (say) an iced-coffee banner to the top of the homepage and a slim banner into a category, without ever touching your seasonal or normal banners.</p>
                  </div>

                  <div className="card" style={card}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <div className="group-title" style={{ margin: 0 }}>Weather at store</div>
                      <button type="button" className="btn ghost" style={{ padding: '7px 12px' }} disabled={weatherBusy} onClick={refreshWeather}>{weatherBusy ? 'Checking…' : 'Refresh weather'}</button>
                    </div>
                    {wx && wx.ok ? (
                      <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
                        <div style={{ fontSize: 34, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}><span>{emoji}</span><span>{wx.current_temperature}&deg;C</span></div>
                        <div className="muted" style={{ fontSize: 'var(--fs-sm)', lineHeight: 1.7 }}>
                          {wx.condition_label && <div>{wx.condition_label}</div>}
                          {wx.feels_like != null && <div>Feels like {wx.feels_like}&deg;C</div>}
                          {wx.today_max != null && <div>Today&rsquo;s high {wx.today_max}&deg;C{wx.today_min != null ? ` · low ${wx.today_min}°C` : ''}</div>}
                          {wx.tomorrow_max != null && <div>Tomorrow {wx.tomorrow_max}&deg;C{wx.tomorrow_min != null ? ` · low ${wx.tomorrow_min}°C` : ''}</div>}
                        </div>
                        <div className="muted" style={{ fontSize: 'var(--fs-xs)', marginLeft: 'auto', textAlign: 'right' }}>
                          {ageTxt && <div>Updated {ageTxt}</div>}
                          <div>Source: {wx.provider}</div>
                          {wx.stale && <div style={{ color: 'var(--admin-warning)' }}>⚠ using cached reading</div>}
                          {wx.dev && <div style={{ color: 'var(--admin-warning)' }}>dev override</div>}
                        </div>
                      </div>
                    ) : (
                      <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 8 }}>
                        {wx && wx.reason === 'no-coordinates'
                          ? 'Set your store location below so we can read the local weather.'
                          : weatherBusy ? 'Checking the weather…' : 'Weather isn’t available right now. Check your store coordinates below, then Refresh. Ordering is never affected by this.'}
                      </p>
                    )}
                  </div>

                  <div className="card" style={card}>
                    <div className="group-title">Store location</div>
                    <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 0 }}>Weather is read for your store&rsquo;s physical location (never the customer&rsquo;s). Enter its coordinates, or pull them from your Square location. Remember to press <strong>Save changes</strong>.</p>
                    <div className="admin-two-col">
                      <label className="field"><span>Latitude</span>
                        <input type="number" step="0.0001" value={s.contact?.lat ?? ''} onChange={(e) => set({ contact: { ...(s.contact || {}), lat: e.target.value === '' ? null : Number(e.target.value) } })} placeholder="-35.2820" /></label>
                      <label className="field"><span>Longitude</span>
                        <input type="number" step="0.0001" value={s.contact?.lng ?? ''} onChange={(e) => set({ contact: { ...(s.contact || {}), lng: e.target.value === '' ? null : Number(e.target.value) } })} placeholder="149.1287" /></label>
                    </div>
                    <button type="button" className="btn ghost" style={{ marginTop: 10, padding: '8px 12px' }} disabled={geoBusy === 'loading'} onClick={useSquareLocation}>{geoBusy === 'loading' ? 'Reading Square…' : 'Use my Square location'}</button>
                    {geoBusy && geoBusy !== 'loading' && <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 8 }}>{geoBusy}</p>}
                  </div>

                  <div className="card" style={card}>
                    <div className="group-title">Customer temperature display</div>
                    <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 0 }}>Optionally show a subtle current temperature in the app (e.g. &ldquo;&#9728;&#65039; 29&deg;C&rdquo;). Kept understated &mdash; it never turns the app into a weather widget.</p>
                    <label className="avail-switch"><input type="checkbox" checked={sc.showTemperature === true} onChange={(e) => setSc({ showTemperature: e.target.checked })} /><span>Show current temperature to customers</span></label>
                    <label className="avail-switch" style={{ marginTop: 10 }}><input type="checkbox" checked={sc.showCondition !== false} onChange={(e) => setSc({ showCondition: e.target.checked })} /><span>Include the weather icon</span></label>
                    <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 10 }}>Remember to press <strong>Save changes</strong>.</p>
                  </div>

                  {/* ── Global behaviour (only on the list view) ── */}
                  {!editing && (
                    <div className="card" style={card}>
                      <div className="group-title">Behaviour</div>
                      <label className="field" style={{ marginTop: 8 }}><span>When several campaigns match at once</span>
                        <select value={opts.mode || 'highest'} onChange={(e) => setOpts({ mode: e.target.value })}>
                          <option value="highest">Show only the highest-priority campaign</option>
                          <option value="all">Show all matching campaigns (highest first)</option>
                        </select></label>
                      <label className="avail-switch" style={{ marginTop: 12 }}><input type="checkbox" checked={opts.hysteresis !== false} onChange={(e) => setOpts({ hysteresis: e.target.checked })} /><span>Prevent flapping around the threshold</span></label>
                      <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 8 }}>Keeps a campaign steady instead of flicking on/off when the temperature hovers on the line.</p>
                    </div>
                  )}

                  {/* ── Campaign list ── */}
                  {!editing && (
                    <div className="card" style={card}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                        <div className="group-title" style={{ margin: 0 }}>Weather Campaigns</div>
                        <button type="button" className="btn" style={{ padding: '8px 14px' }} onClick={addCampaign}>+ Create campaign</button>
                      </div>
                      {campaigns.length === 0 && <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>No campaigns yet. Create one to react to the weather &mdash; e.g. a hot-day iced-coffee banner.</p>}
                      {campaigns.map((c) => {
                        const m = wouldMatchNow(c);
                        const places = [c.homepage_enabled && 'Homepage', c.category_enabled && c.category_id ? c.category_id : null].filter(Boolean).join(' + ') || 'No placement';
                        return (
                          <div key={c.id} className="camp-row">
                            <div className="camp-main">
                              <div className="camp-name">{c.name || 'Untitled'}
                                {!c.active && <span className="camp-pill off">Paused</span>}
                                {c.active && m === true && <span className="camp-pill live">Matching now</span>}
                              </div>
                              <div className="camp-meta">{ruleText(c)} · Priority {c.priority} · {places}</div>
                            </div>
                            <div className="camp-actions">
                              <button type="button" className="camp-btn" onClick={() => updateCampaign(c.id, { active: !c.active })}>{c.active ? 'Pause' : 'Enable'}</button>
                              <button type="button" className="camp-btn" onClick={() => setCampEditId(c.id)}>Edit</button>
                              <button type="button" className="camp-btn" onClick={() => duplicateCampaign(c.id)}>Duplicate</button>
                              <button type="button" className="camp-btn danger" onClick={() => removeCampaign(c.id)}>Delete</button>
                            </div>
                          </div>
                        );
                      })}
                      {campaigns.length > 0 && <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 10 }}>Changes go live when you press <strong>Save changes</strong>.</p>}
                    </div>
                  )}

                  {/* ── Editor ── */}
                  {editing && (() => {
                    const c = editing;
                    const up = (patch) => updateCampaign(c.id, patch);
                    const matchNow = wouldMatchNow(c);
                    const toggleDay = (i) => up({ active_days: (c.active_days || []).includes(i) ? c.active_days.filter((d) => d !== i) : [...(c.active_days || []), i].sort() });
                    const uploadTo = (key) => (e) => { const f = e.target.files && e.target.files[0]; if (f) uploadImage(f, (url) => up({ [key]: url }), 'campaigns'); e.target.value = ''; };
                    return (
                      <>
                        <div className="card" style={card}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                            <button type="button" className="link" onClick={() => setCampEditId(null)} style={{ fontSize: 'var(--fs-base)' }}>← Back to campaigns</button>
                            <button type="button" className="btn ghost" style={{ marginLeft: 'auto', padding: '7px 12px', fontSize: 'var(--fs-base)' }}
                              title="Force this campaign onto your live homepage for 5 minutes so you can see it — doesn't change your saved campaigns or the weather rules."
                              onClick={async () => {
                                if (!c.homepage_artwork) { alert('Add homepage artwork first, then preview.'); return; }
                                try {
                                  const r = await fetch(`/api/admin/smartcampaigns/preview?pass=${encodeURIComponent(pass)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ campaign: c, minutes: 5 }) });
                                  const d = await r.json();
                                  if (!r.ok) throw new Error(d.error || 'Preview failed');
                                  window.open('/', '_blank', 'noopener');
                                  alert('Live on your homepage for 5 minutes — check the new tab. This is only a preview: it doesn’t change your saved campaigns or weather rules, and it clears itself.');
                                } catch (e) { alert('Preview failed: ' + e.message); }
                              }}>Preview on homepage (5 min)</button>
                            {matchNow != null && (
                              <span className={`camp-pill ${matchNow ? 'live' : 'off'}`}>{matchNow ? 'Would show now' : 'Would not show now'}</span>
                            )}
                          </div>
                          {/* 1 · Campaign */}
                          <div className="group-title" style={{ marginTop: 8 }}>1 · Campaign</div>
                          <label className="field"><span>Name</span><input value={c.name || ''} onChange={(e) => up({ name: e.target.value })} placeholder="Hot Day Smoothies" /></label>
                          <label className="field" style={{ marginTop: 10 }}><span>Internal note (optional)</span><input value={c.internal_description || ''} onChange={(e) => up({ internal_description: e.target.value })} placeholder="For your reference only" /></label>
                          <div className="admin-two-col" style={{ marginTop: 10 }}>
                            <label className="field"><span>Priority (higher wins)</span><input type="number" value={c.priority} onChange={(e) => up({ priority: parseInt(e.target.value, 10) || 0 })} /></label>
                            <label className="avail-switch" style={{ alignSelf: 'end', paddingBottom: 10 }}><input type="checkbox" checked={c.active !== false} onChange={(e) => up({ active: e.target.checked })} /><span>Enabled</span></label>
                          </div>
                        </div>

                        <div className="card" style={card}>
                          <div className="group-title">2 · Weather rule</div>
                          <div className="admin-two-col">
                            <label className="field"><span>Weather source</span>
                              <select value={c.weather_source} onChange={(e) => up({ weather_source: e.target.value })}>{Object.entries(SOURCES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                            <label className="field"><span>Condition</span>
                              <select value={c.comparison_operator} onChange={(e) => up({ comparison_operator: e.target.value })}>
                                <option value="gte">Greater than or equal (≥)</option><option value="gt">Greater than (&gt;)</option>
                                <option value="lte">Less than or equal (≤)</option><option value="lt">Less than (&lt;)</option><option value="between">Between</option>
                              </select></label>
                          </div>
                          <div className="admin-two-col" style={{ marginTop: 10 }}>
                            <label className="field"><span>{c.comparison_operator === 'between' ? 'Minimum °C' : 'Temperature °C'}</span><input type="number" value={c.threshold_min} onChange={(e) => up({ threshold_min: Number(e.target.value) })} /></label>
                            {c.comparison_operator === 'between' && <label className="field"><span>Maximum °C</span><input type="number" value={c.threshold_max} onChange={(e) => up({ threshold_max: Number(e.target.value) })} /></label>}
                          </div>
                          <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 8 }}>Rule: <strong>{ruleText(c)}</strong>{wx && wx.ok ? ` · right now it's ${wx.current_temperature}°C` : ''}</p>
                        </div>

                        <div className="card" style={card}>
                          <div className="group-title">3 · Schedule (optional)</div>
                          <div className="muted" style={{ fontSize: 'var(--fs-xs)', margin: '4px 0' }}>Days (none ticked = every day)</div>
                          <div className="avail-daychips">
                            {DOW_LABELS.map((d, i) => <button key={i} type="button" className={`avail-daychip sm${(c.active_days || []).includes(i) ? ' on' : ''}`} onClick={() => toggleDay(i)}>{d[0]}</button>)}
                          </div>
                          <div className="admin-two-col" style={{ marginTop: 10 }}>
                            <label className="field"><span>From (optional)</span><input type="time" value={c.active_start_time || ''} onChange={(e) => up({ active_start_time: e.target.value })} /></label>
                            <label className="field"><span>To (optional)</span><input type="time" value={c.active_end_time || ''} onChange={(e) => up({ active_end_time: e.target.value })} /></label>
                          </div>
                          <div className="admin-two-col" style={{ marginTop: 10 }}>
                            <label className="field"><span>Start date (optional)</span><input type="date" value={c.start_date || ''} onChange={(e) => up({ start_date: e.target.value })} /></label>
                            <label className="field"><span>End date (optional)</span><input type="date" value={c.end_date || ''} onChange={(e) => up({ end_date: e.target.value })} /></label>
                          </div>
                        </div>

                        <div className="card" style={card}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div className="group-title" style={{ margin: 0 }}>4 · Homepage banner</div>
                            <label className="avail-switch"><input type="checkbox" checked={c.homepage_enabled !== false} onChange={(e) => up({ homepage_enabled: e.target.checked })} /><span>{c.homepage_enabled !== false ? 'On' : 'Off'}</span></label>
                          </div>
                          {c.homepage_enabled !== false && (
                            <>
                              <div className="muted" style={{ fontSize: 'var(--fs-sm)', margin: '6px 0' }}>Shows first on the homepage (before the seasonal banner). Big 3:2 artwork.</div>
                              <div className="camp-art">
                                {c.homepage_artwork ? <img src={imgUrl(c.homepage_artwork, 400)} alt="" style={{ objectFit: c.homepage_fit || 'cover' }} /> : <span className="camp-art-ph">No artwork</span>}
                                <div className="camp-art-btns">
                                  <label className="btn ghost" style={{ padding: '7px 12px' }}><input type="file" accept="image/*" hidden onChange={uploadTo('homepage_artwork')} />{c.homepage_artwork ? 'Replace' : 'Upload'}</label>
                                  {c.homepage_artwork && <button type="button" className="btn ghost" style={{ padding: '7px 12px' }} onClick={() => up({ homepage_artwork: '' })}>Remove</button>}
                                </div>
                              </div>
                              <label className="field" style={{ marginTop: 10 }}><span>Image fit</span>
                                <select value={c.homepage_fit || 'cover'} onChange={(e) => up({ homepage_fit: e.target.value })}>
                                  <option value="cover">Cover — fill the banner, crop overflow</option>
                                  <option value="contain">Contain — show the whole image (letterboxed)</option>
                                  <option value="fill">Fill — stretch to the banner shape</option>
                                </select></label>
                              <label className="field" style={{ marginTop: 10 }}><span>Title (optional overlay)</span><input value={c.homepage_title || ''} onChange={(e) => up({ homepage_title: e.target.value })} /></label>
                              <label className="field" style={{ marginTop: 10 }}><span>Subtitle (optional)</span><input value={c.homepage_subtitle || ''} onChange={(e) => up({ homepage_subtitle: e.target.value })} /></label>
                              <label className="field" style={{ marginTop: 10 }}><span>Alt text (accessibility)</span><input value={c.homepage_alt_text || ''} onChange={(e) => up({ homepage_alt_text: e.target.value })} placeholder={c.name} /></label>
                              <label className="field" style={{ marginTop: 10 }}><span>Button text (optional)</span><input value={c.cta_text || ''} onChange={(e) => up({ cta_text: e.target.value })} placeholder="Shop Smoothies" /></label>
                              <label className="field" style={{ marginTop: 10 }}><span>When tapped</span>
                                <select value={c.destination_type} onChange={(e) => up({ destination_type: e.target.value })}>{Object.entries(DESTS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                              {c.destination_type === 'category' && <label className="field" style={{ marginTop: 8 }}><span>Category</span><select value={c.destination_id || ''} onChange={(e) => up({ destination_id: e.target.value })}><option value="">— pick a category —</option>{scheduleCatOptions.map((n) => <option key={n} value={n}>{n}</option>)}</select></label>}
                              {c.destination_type === 'item' && <label className="field" style={{ marginTop: 8 }}><span>Product (loads ready to add to cart)</span>
                                <select value={c.destination_id || ''} onChange={(e) => { const opt = e.target.selectedOptions[0]; up({ destination_id: e.target.value, destination_label: opt ? opt.text : '' }); }}>
                                  <option value="">{adminCat.length ? '— pick a product —' : 'Loading products…'}</option>
                                  {adminCat.map((cc) => (
                                    <optgroup key={cc.category} label={cc.category}>
                                      {cc.items.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
                                    </optgroup>
                                  ))}
                                </select></label>}
                              {c.destination_type === 'url' && <label className="field" style={{ marginTop: 8 }}><span>Web link</span><input value={c.destination_url || ''} onChange={(e) => up({ destination_url: e.target.value })} placeholder="https://…" /></label>}
                            </>
                          )}
                        </div>

                        <div className="card" style={card}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div className="group-title" style={{ margin: 0 }}>5 · Category placement (optional)</div>
                            <label className="avail-switch"><input type="checkbox" checked={c.category_enabled === true} onChange={(e) => up({ category_enabled: e.target.checked })} /><span>{c.category_enabled ? 'On' : 'Off'}</span></label>
                          </div>
                          {c.category_enabled && (
                            <>
                              <div className="muted" style={{ fontSize: 'var(--fs-sm)', margin: '6px 0' }}>A slim banner inside a category. Uses <strong>separate</strong> artwork (4:1) &mdash; it never overwrites the category&rsquo;s own banner.</div>
                              <label className="field"><span>Category</span><select value={c.category_id || ''} onChange={(e) => up({ category_id: e.target.value })}><option value="">— pick a category —</option>{scheduleCatOptions.map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
                              <div className="camp-art" style={{ marginTop: 10 }}>
                                {c.category_artwork ? <img src={imgUrl(c.category_artwork, 400)} alt="" style={{ objectFit: c.category_fit || 'cover' }} /> : <span className="camp-art-ph">No slim artwork</span>}
                                <div className="camp-art-btns">
                                  <label className="btn ghost" style={{ padding: '7px 12px' }}><input type="file" accept="image/*" hidden onChange={uploadTo('category_artwork')} />{c.category_artwork ? 'Replace' : 'Upload'}</label>
                                  {c.category_artwork && <button type="button" className="btn ghost" style={{ padding: '7px 12px' }} onClick={() => up({ category_artwork: '' })}>Remove</button>}
                                </div>
                              </div>
                              <label className="field" style={{ marginTop: 10 }}><span>Image fit</span>
                                <select value={c.category_fit || 'cover'} onChange={(e) => up({ category_fit: e.target.value })}>
                                  <option value="cover">Cover — fill the banner, crop overflow</option>
                                  <option value="contain">Contain — show the whole image (letterboxed)</option>
                                  <option value="fill">Fill — stretch to the banner shape</option>
                                </select></label>
                              <label className="field" style={{ marginTop: 10 }}><span>Title (optional overlay)</span><input value={c.category_title || ''} onChange={(e) => up({ category_title: e.target.value })} /></label>
                              <label className="field" style={{ marginTop: 10 }}><span>Placement</span>
                                <select value={c.category_position || 'before'} onChange={(e) => up({ category_position: e.target.value })}>
                                  <option value="before">Before the category&rsquo;s own banner</option>
                                  <option value="after">After the category&rsquo;s own banner</option>
                                  <option value="replace">Replace it while active</option>
                                </select></label>
                            </>
                          )}
                        </div>

                        {locs.length > 1 && (
                          <div className="card" style={card}>
                            <div className="group-title">6 · Show at</div>
                            <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 0 }}>Which stores this campaign runs at. Leave <strong>All stores</strong> on to run everywhere, or tick specific stores to limit it — the unticked stores are excluded.</p>
                            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 8 }}>
                              <label className="avail-switch"><input type="checkbox" checked={!(Array.isArray(c.locations) && c.locations.length)} onChange={() => up({ locations: [] })} /><span>All stores</span></label>
                              {locs.map((l) => {
                                const sel = (c.locations || []).includes(l.id);
                                return (
                                  <label key={l.id} className="avail-switch"><input type="checkbox" checked={sel} onChange={(e) => {
                                    const cur = new Set(c.locations || []);
                                    e.target.checked ? cur.add(l.id) : cur.delete(l.id);
                                    up({ locations: [...cur] });
                                  }} /><span>{l.name || l.id}</span></label>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                          <button type="button" className="btn ghost" onClick={() => setCampEditId(null)}>← Back</button>
                          <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Press <strong>Save changes</strong> to make it live.</span>
                        </div>
                      </>
                    );
                  })()}
                </>
              );
            })()}

            {/* ───────── KITCHEN SCREEN (KDS) ───────── */}
            {tab === 'kds' && (
              <>
                <div className="admin-page-head">
                  <h1 className="admin-page-title">Kitchen Screen</h1>
                  <p className="admin-page-desc">A live bump screen for the kitchen and baristas. Open it on any wall tablet, sign in with your staff passcode, and pick a station. Tickets colour by age and can be split per station so each screen shows only its own items.</p>
                </div>

                <div className="card" style={card}>
                  <div className="group-title">Open the screen</div>
                  <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 0 }}>Open this address on any device (a kitchen tablet, a spare laptop). It asks for the same staff passcode you use here, then remembers the station you pick.</p>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <code style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', flex: 1, minWidth: 200 }}>{`${typeof window !== 'undefined' ? window.location.origin : ''}/kds`}</code>
                    <a className="btn" style={{ padding: '8px 14px' }} href="/kds" target="_blank" rel="noreferrer">Open kitchen screen ↗</a>
                  </div>
                </div>

                <div className="card" style={card}>
                  <div className="group-title">Stations</div>
                  <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 0 }}>Each station shows only its categories&rsquo; items &mdash; so the barista screen shows drinks and the kitchen screen shows food, even on one shared order. An <strong>All orders</strong> view (everything) always exists, so you don&rsquo;t have to set stations up to get started. Remember to press <strong>Save changes</strong>.</p>
                  {kdsZones.length === 0 && <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>No stations yet &mdash; the screen will show a single &ldquo;All orders&rdquo; view until you add some.</p>}
                  {kdsZones.map((z) => (
                    <div key={z.id} className="avail-sched">
                      <div className="avail-sched-head">
                        <input className="avail-sched-name" value={z.name || ''} placeholder="Station name (e.g. Kitchen)" onChange={(e) => updateKdsZone(z.id, { name: e.target.value })} />
                        <button type="button" className="avail-del" title="Delete station" onClick={() => removeKdsZone(z.id)}>✕</button>
                      </div>
                      <div className="avail-sched-cats" style={{ borderTop: 'none', paddingTop: 4 }}>
                        <div className="muted" style={{ fontSize: 'var(--fs-xs)', marginBottom: 4 }}>Menu categories on this station</div>
                        {kdsAppCatOptions.length === 0 && <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>No categories loaded yet.</span>}
                        <div className="avail-chipwrap">
                          {kdsAppCatOptions.map((name) => (
                            <button key={name} type="button" className={`chip${(z.categories || []).includes(name) ? ' on' : ''}`} onClick={() => toggleKdsZoneCat(z.id, name)}>
                              {(z.categories || []).includes(name) ? '✓ ' : '+ '}{name}
                            </button>
                          ))}
                        </div>
                        {kdsSquareCatOptions.length > 0 && (
                          <>
                            <div className="muted" style={{ fontSize: 'var(--fs-xs)', margin: '10px 0 4px' }}>Square categories &mdash; pick these if an item files under a Square category that isn&rsquo;t one of your menu names (so it still bumps through)</div>
                            <div className="avail-chipwrap">
                              {kdsSquareCatOptions.map((name) => (
                                <button key={'sq:' + name} type="button" className={`chip${(z.categories || []).includes(name) ? ' on' : ''}`} onClick={() => toggleKdsZoneCat(z.id, name)}>
                                  {(z.categories || []).includes(name) ? '✓ ' : '+ '}{name}
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                  <button type="button" className="btn full" style={{ marginTop: 12 }} onClick={addKdsZone}>+ Add station</button>
                </div>

                <div className="card" style={card}>
                  <div className="group-title">Display</div>
                  <div className="admin-two-col">
                    <label className="field"><span>Turn amber after (minutes)</span>
                      <input type="number" min="0" value={kdsCfg.amberMin ?? 6} onChange={(e) => setKds({ amberMin: Math.max(0, parseInt(e.target.value, 10) || 0) })} /></label>
                    <label className="field"><span>Turn red after (minutes)</span>
                      <input type="number" min="0" value={kdsCfg.redMin ?? 12} onChange={(e) => setKds({ redMin: Math.max(0, parseInt(e.target.value, 10) || 0) })} /></label>
                  </div>
                  <label className="field" style={{ marginTop: 10 }}><span>Show tickets from the last (hours)</span>
                    <input type="number" min="1" max="48" value={kdsCfg.lookbackHours ?? 8} onChange={(e) => setKds({ lookbackHours: Math.max(1, Math.min(48, parseInt(e.target.value, 10) || 8)) })} /></label>
                  <label className="avail-switch" style={{ marginTop: 12 }}>
                    <input type="checkbox" checked={kdsCfg.sound !== false} onChange={(e) => setKds({ sound: e.target.checked })} />
                    <span>Chime when a new ticket arrives</span>
                  </label>
                  <label className="avail-switch" style={{ marginTop: 10 }}>
                    <input type="checkbox" checked={kdsCfg.showPrepStep !== false} onChange={(e) => setKds({ showPrepStep: e.target.checked })} />
                    <span>Show a &ldquo;Start&rdquo; step before bumping</span>
                  </label>
                  <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 10 }}>Remember to press <strong>Save changes</strong>.</p>
                </div>

                <div className="card" style={card}>
                  <div className="group-title">Instant updates (optional)</div>
                  <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 0 }}>The screen already updates on its own every few seconds. To make new orders appear <em>the instant</em> they&rsquo;re placed, add a Square webhook &mdash; then order changes push straight to every screen.</p>
                  <ol className="muted" style={{ fontSize: 'var(--fs-sm)', paddingLeft: 18, lineHeight: 1.7 }}>
                    <li>In your Square Developer dashboard, open your app &rarr; <strong>Webhooks &rarr; Subscriptions &rarr; Add endpoint</strong>.</li>
                    <li>Set the URL to: <code style={{ border: '1px solid var(--line)', borderRadius: 6, padding: '2px 6px' }}>{`${typeof window !== 'undefined' ? window.location.origin : ''}/api/square/webhook`}</code></li>
                    <li>Subscribe to the events <code>order.created</code>, <code>order.updated</code>, and <code>payment.updated</code>.</li>
                    <li>Copy the endpoint&rsquo;s <strong>Signature Key</strong> and set it in Railway as the variable <code>SQUARE_WEBHOOK_SIGNATURE_KEY</code>, then redeploy.</li>
                  </ol>
                  <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 0 }}>That&rsquo;s it &mdash; no code changes needed. Until then, the screen stays current with its own refresh, so it works right away either way.</p>
                </div>
              </>
            )}

            {/* ───────── LOCATIONS ───────── */}
            {tab === 'locations' && (
              <>
                <div className="admin-page-head">
                  <h1 className="admin-page-title">Locations</h1>
                  <p className="admin-page-desc">Run more than one store from one app and one menu. Customers pick their store; their order and its payment are created against that store's Square location, so takings land in that location's Square books (and its own bank account, if you've set one up in Square). You can also hide items a store doesn't offer — handy for a takeaway pop-up with no kitchen.</p>
                </div>

                <div className="card" style={card}>
                  <div className="group-title" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    Sales by store — self-order vs counter
                    <select value={salesDays} onChange={(e) => { const d = Number(e.target.value); setSalesDays(d); loadSales(d); }} style={{ marginLeft: 'auto' }}>
                      <option value={1}>Today</option><option value={7}>Last 7 days</option><option value={14}>Last 14 days</option><option value={30}>Last 30 days</option>
                    </select>
                    <button type="button" className="btn ghost" style={{ padding: '6px 12px' }} disabled={salesBusy} onClick={() => loadSales()}>{salesBusy ? 'Loading…' : (salesData ? 'Refresh' : 'Load sales')}</button>
                  </div>
                  <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 0 }}>Completed Square orders. <strong>App</strong> = customers ordering themselves in the app; <strong>Counter</strong> = staff ringing it up on the POS; <strong>Other</strong> = Square POS / other.</p>
                  {salesData && salesData.error && <p className="muted" style={{ color: 'var(--admin-danger,#c0392b)' }}>{salesData.error}</p>}
                  {salesData && salesData.stores && (() => {
                    const money2 = (c) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: salesData.currency || 'AUD' }).format((c || 0) / 100);
                    return salesData.stores.map((st) => (
                      <div key={st.id} className="avail-sched" style={{ marginBottom: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                          <strong style={{ fontSize: 'var(--fs-md)' }}>{st.name}</strong>
                          <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{st.totals.count} orders</span>
                          <span style={{ marginLeft: 'auto', fontWeight: 800 }}>{money2(st.totals.total)}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 6, fontSize: 'var(--fs-sm)' }}>
                          <span>App (self-order): <strong>{money2(st.totals.app)}</strong></span>
                          <span>Counter (POS): <strong>{money2(st.totals.pos)}</strong></span>
                          {st.totals.other > 0 && <span>Other: <strong>{money2(st.totals.other)}</strong></span>}
                        </div>
                        {st.daily.length > 0 && (
                          <details style={{ marginTop: 6 }}>
                            <summary style={{ cursor: 'pointer', fontSize: 'var(--fs-sm)' }}>Daily breakdown</summary>
                            <div className="loc-avail-list" style={{ maxHeight: 220 }}>
                              {[...st.daily].reverse().map((d) => (
                                <div key={d.date} style={{ display: 'flex', gap: 10, fontSize: 'var(--fs-sm)', padding: '2px 0' }}>
                                  <span style={{ minWidth: 92 }}>{d.date}</span>
                                  <span>app {money2(d.app)}</span><span>counter {money2(d.pos)}</span>
                                  <span style={{ marginLeft: 'auto', fontWeight: 700 }}>{money2(d.total)}</span>
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                      </div>
                    ));
                  })()}
                </div>

                {locs.some((l) => l.type === 'event') && (
                  <div className="card" style={card}>
                    <div className="group-title" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      Free coffees — who we gave them to
                      <select value={guestVenue} onChange={(e) => { setGuestVenue(e.target.value); loadGuests(guestsDays, e.target.value); }} style={{ marginLeft: 'auto' }}>
                        <option value="">All venues</option>
                        {locs.filter((l) => l.type === 'event').map((l) => <option key={l.id} value={l.id}>{l.name || l.id}</option>)}
                      </select>
                      <select value={guestsDays} onChange={(e) => { const d = Number(e.target.value); setGuestsDays(d); loadGuests(d, guestVenue); }}>
                        <option value={1}>Today</option><option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option>
                      </select>
                      <button type="button" className="btn ghost" style={{ padding: '6px 12px' }} disabled={guestsBusy} onClick={() => loadGuests()}>{guestsBusy ? 'Loading…' : (guests ? 'Refresh' : 'Load')}</button>
                    </div>
                    <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 0 }}>Every guest who ordered a complimentary coffee at an event, with the booth they came from — a ready-made lead list from the event. Pulled live from Square.</p>
                    {guests && guests.error && <p className="muted" style={{ color: 'var(--admin-danger,#c0392b)' }}>{guests.error}</p>}
                    {guests && Array.isArray(guests.guests) && guests.guests.length === 0 && <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>No free coffees in this window yet.</p>}
                    {guests && Array.isArray(guests.guests) && guests.guests.length > 0 && (
                      <div className="loc-avail-list" style={{ maxHeight: 340 }}>
                        {guests.guests.map((g, i) => (
                          <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '4px 0', borderTop: i ? '1px solid var(--line)' : 'none', fontSize: 'var(--fs-sm)', flexWrap: 'wrap' }}>
                            <strong style={{ minWidth: 120 }}>{g.name || 'Guest'}</strong>
                            <span className="muted">{g.phone || '—'}</span>
                            {g.booth && <span className="camp-pill" style={{ background: 'var(--brand-soft, #f2dfe6)' }}>{g.booth}</span>}
                            {g.paidExtra && <span className="camp-pill">+ purchase</span>}
                            <span className="muted" style={{ marginLeft: 'auto' }}>{g.at ? new Date(g.at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : ''}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {guests && guests.count > 0 && <p className="muted" style={{ fontSize: 'var(--fs-xs)', marginTop: 8 }}>{guests.count} free coffee{guests.count === 1 ? '' : 's'} given in the last {guests.days} days.</p>}
                  </div>
                )}

                {locs.some((l) => l.type === 'event') && (
                  <div className="card" style={card}>
                    <div className="group-title">Event settings</div>
                    <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 0 }}>Shared settings for all your Event stores. Remember to press <strong>Save changes</strong>.</p>
                    <label className="field" style={{ margin: 0 }}><span>Default “Visit us” page for events</span>
                      <select value={s.eventDefaultStorePageLocId || ''} onChange={(e) => set({ eventDefaultStorePageLocId: e.target.value })}>
                        <option value="">— none (use main store info) —</option>
                        {locs.filter((l) => l.type !== 'event').map((l) => <option key={l.id} value={l.id}>{l.name || l.id}</option>)}
                      </select>
                    </label>
                    <p className="muted" style={{ fontSize: 'var(--fs-xs)', margin: '4px 0 12px' }}>
                      Every event borrows this store’s page (photo, blurb, address, map) so guests know where to find you afterwards — e.g. the Mitchell Roastery. An event with its own store page set below overrides this.
                    </p>
                    <label className="field" style={{ margin: 0, maxWidth: 220 }}><span>Beans shipping fee ($)</span>
                      <input type="number" min="0" step="0.50" value={((s.eventShippingFee != null ? s.eventShippingFee : 1000) / 100).toFixed(2)} onChange={(e) => set({ eventShippingFee: Math.max(0, Math.round(Number(e.target.value || 0) * 100)) })} />
                    </label>
                    <p className="muted" style={{ fontSize: 'var(--fs-xs)', margin: '4px 0 0' }}>Flat postage added when a customer buys a paid category (e.g. retail beans) at an event and enters a delivery address.</p>
                  </div>
                )}

                <div className="card" style={card}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                    <div className="group-title" style={{ margin: 0 }}>Your stores</div>
                    {locs.length > 0 && (
                      <button type="button" className={`chip ${locDeleteLock ? 'on' : ''}`} onClick={() => setLocDeleteLock((v) => !v)}
                        style={{ fontSize: 'var(--fs-sm)' }} title={locDeleteLock ? 'Locked — tap to allow deleting a store' : 'Unlocked — tap to lock again'}>
                        {locDeleteLock ? '🔒 Delete locked' : '🔓 Delete unlocked'}</button>
                    )}
                  </div>
                  <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 6 }}>
                    {locs.length === 0
                      ? 'You’re running as a single store right now. Add your existing store first (the button below prefills it), then add the new one. The customer store picker only appears once TWO or more active stores are listed — with a single store the app just uses it. Once any store is listed here, the app uses this list.'
                      : 'Each store maps to one of your Square locations. Set up each location’s bank account in the Square dashboard so its takings deposit separately. The customer store picker appears once two or more stores are active. Remember to press '}
                    {locs.length > 0 && <strong>Save changes</strong>}{locs.length > 0 ? '.' : ''}
                  </p>
                  {locs.length === 0 && (
                    <button type="button" className="btn" style={{ marginBottom: 12 }} onClick={addMainLoc}>
                      ➕ Add my current store{mainSq ? ` (${mainSq.name})` : ''} first
                    </button>
                  )}
                  {locs.length === 1 && (
                    <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 0, color: 'var(--warn, #b26b00)' }}>
                      Only one store is listed, so customers won’t see a store picker yet. Add your second store below to switch on the picker.
                    </p>
                  )}

                  {locs.map((l) => (
                    <div key={l.id} className="avail-sched" style={{ marginBottom: 12 }}>
                      <div className="avail-sched-head" style={{ gap: 8, flexWrap: 'wrap' }}>
                        <input className="avail-sched-name" value={l.name || ''} placeholder="Store name (e.g. TulipTops)" onChange={(e) => updLoc(l.id, { name: e.target.value })} />
                        <label className="switch" style={{ marginLeft: 'auto' }} title="Customers can order from this store">
                          <input type="checkbox" checked={l.active !== false} onChange={(e) => updLoc(l.id, { active: e.target.checked })} /> <span>Active</span>
                        </label>
                        <button type="button" className="avail-del" disabled={locDeleteLock} style={{ opacity: locDeleteLock ? 0.3 : 1 }} title={locDeleteLock ? 'Unlock delete (top of card) to remove this store' : 'Delete store'} onClick={() => { if (window.confirm(`Delete "${l.name || l.id}"? This removes the store from the app. It does not touch Square.`)) rmLoc(l.id); }}>✕</button>
                      </div>
                      <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                        <label className="field" style={{ margin: 0 }}>
                          <span>Square location</span>
                          {sqLocations.length ? (
                            <select value={l.squareLocationId || ''} onChange={(e) => updLoc(l.id, { squareLocationId: e.target.value })}>
                              <option value="">— pick this store's Square location —</option>
                              {sqLocations.map((sl) => <option key={sl.id} value={sl.id}>{sl.name}{sl.address ? ` (${sl.address})` : ''}</option>)}
                            </select>
                          ) : (
                            <input value={l.squareLocationId || ''} placeholder="Square location id" onChange={(e) => updLoc(l.id, { squareLocationId: e.target.value })} />
                          )}
                        </label>
                        <label className="field" style={{ margin: 0 }}><span>Address (shown in the store picker)</span>
                          <input value={l.address || ''} placeholder="e.g. Tulip Tops, Sutton NSW" onChange={(e) => updLoc(l.id, { address: e.target.value })} />
                        </label>

                        <label className="field" style={{ margin: 0 }}><span>Store type</span>
                          <select value={(l.type === 'popup' || l.type === 'event') ? l.type : 'physical'} onChange={(e) => updLoc(l.id, { type: e.target.value })}>
                            <option value="physical">Permanent store</option>
                            <option value="popup">Pop-up (time-limited)</option>
                            <option value="event">Event (corporate hire)</option>
                          </select>
                        </label>
                        {l.type === 'event' && (() => {
                          const effHidden = l.hidden != null ? !!l.hidden : true;
                          return (
                            <div className="field" style={{ margin: 0 }}>
                              <label className="switch"><input type="checkbox" checked={effHidden} onChange={(e) => updLoc(l.id, { hidden: e.target.checked })} /> <span>Hide from the store picker (reach by booth QR only)</span></label>
                              <p className="muted" style={{ fontSize: 'var(--fs-xs)', margin: '4px 0 0' }}>
                                On (recommended for events): this store never appears in “Choose your store”. Customers only reach it by scanning its custom / booth QR code. It still works normally when opened that way.
                              </p>
                            </div>
                          );
                        })()}
                        {(() => {
                          const effFree = l.free != null ? !!l.free : (l.type === 'event');
                          const freeCats = Array.isArray(l.freeCategories) ? l.freeCategories : [];
                          const perCategory = freeCats.length > 0;
                          const toggleCat = (name) => {
                            const set = new Set(freeCats.map((n) => n.toLowerCase()));
                            set.has(name.toLowerCase()) ? set.delete(name.toLowerCase()) : set.add(name.toLowerCase());
                            // Store the display-cased names the customer sees.
                            const chosen = scheduleCatOptions.filter((n) => set.has(n.toLowerCase()));
                            updLoc(l.id, { freeCategories: chosen });
                          };
                          return (
                            <div className="field" style={{ margin: 0 }}>
                              <label className="switch"><input type="checkbox" checked={effFree && !perCategory} disabled={perCategory} onChange={(e) => updLoc(l.id, { free: e.target.checked })} /> <span>Make the WHOLE store complimentary (no payment)</span></label>
                              <p className="muted" style={{ fontSize: 'var(--fs-xs)', margin: '4px 0 8px' }}>
                                Every order is $0 and goes straight to the kitchen — no card step. For a fully-sponsored event where nothing is charged.{perCategory ? ' (Off while you’ve chosen specific free categories below.)' : ''}
                              </p>
                              {l.type === 'event' && (
                                <>
                                  <span style={{ fontWeight: 600, fontSize: 'var(--fs-sm)' }}>…or make only certain categories free</span>
                                  <p className="muted" style={{ fontSize: 'var(--fs-xs)', margin: '2px 0 6px' }}>
                                    Tick the complimentary categories (coffee, tea…). They show no price and go to the kitchen for nothing. Everything left unticked (e.g. retail coffee beans) is a normal PAID item — the customer enters a delivery address and pays with a card, and postage is added.
                                  </p>
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                    {scheduleCatOptions.length === 0 && <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>No app categories yet.</span>}
                                    {scheduleCatOptions.map((n) => {
                                      const on = freeCats.some((x) => x.toLowerCase() === n.toLowerCase());
                                      return (
                                        <label key={n} className="switch" style={{ gap: 6 }}>
                                          <input type="checkbox" checked={on} onChange={() => toggleCat(n)} /> <span>{n}</span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                </>
                              )}
                            </div>
                          );
                        })()}
                        {l.type === 'event' && (() => {
                          const sel = Array.isArray(l.menuSections) ? l.menuSections : [];
                          const toggleSec = (name) => {
                            const set = new Set(sel.map((n) => n.toLowerCase()));
                            set.has(name.toLowerCase()) ? set.delete(name.toLowerCase()) : set.add(name.toLowerCase());
                            updLoc(l.id, { menuSections: scheduleCatOptions.filter((n) => set.has(n.toLowerCase())) });
                          };
                          return (
                            <div className="field" style={{ margin: 0 }}>
                              <span style={{ fontWeight: 600, fontSize: 'var(--fs-sm)' }}>Event menu — show only these sections</span>
                              <p className="muted" style={{ fontSize: 'var(--fs-xs)', margin: '2px 0 6px' }}>
                                Keep events short and fast: tick only the sections guests should see (e.g. a curated “Event Coffees” section you built in <strong>Product builder</strong>, and maybe your beans). Everything else is hidden here. Leave all unticked to show the full menu.
                              </p>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                {scheduleCatOptions.length === 0 && <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>No sections yet — build one in Product builder first.</span>}
                                {scheduleCatOptions.map((n) => {
                                  const on = sel.some((x) => x.toLowerCase() === n.toLowerCase());
                                  return (
                                    <label key={n} className="switch" style={{ gap: 6 }}>
                                      <input type="checkbox" checked={on} onChange={() => toggleSec(n)} /> <span>{n}</span>
                                    </label>
                                  );
                                })}
                              </div>
                              {sel.length > 0 && <p className="muted" style={{ fontSize: 'var(--fs-xs)', margin: '6px 0 0' }}>Guests here see only: <strong>{sel.join(', ')}</strong>.</p>}
                            </div>
                          );
                        })()}
                        {l.type === 'popup' && (
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                            <label className="field" style={{ margin: 0 }}><span>Opens (first day)</span>
                              <input type="date" value={l.startDate || ''} onChange={(e) => updLoc(l.id, { startDate: e.target.value })} />
                            </label>
                            <label className="field" style={{ margin: 0 }}><span>Closes (last day)</span>
                              <input type="date" value={l.endDate || ''} onChange={(e) => updLoc(l.id, { endDate: e.target.value })} />
                            </label>
                            <p className="muted" style={{ fontSize: 'var(--fs-xs)', margin: 0, gridColumn: '1 / -1' }}>
                              Before the opening day the app shows a “Store opening soon” notice with a countdown that opens this store’s page. After the last day the store disappears from the picker automatically.
                            </p>
                          </div>
                        )}
                        {l.type === 'event' && (() => {
                          const sessions = Array.isArray(l.sessions) ? l.sessions : [];
                          const setSessions = (arr) => updLoc(l.id, { sessions: arr });
                          const upd = (i, patch) => setSessions(sessions.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                          return (
                            <div className="field" style={{ margin: 0 }}>
                              <span style={{ fontWeight: 600, fontSize: 'var(--fs-sm)' }}>Event days &amp; hours</span>
                              <p className="muted" style={{ fontSize: 'var(--fs-xs)', margin: '2px 0 8px' }}>
                                Add each day of the event with its own start &amp; finish time (they can differ day to day). Before the first session the app shows a countdown; ordering only works during a session, and closes when the last one ends.
                              </p>
                              {sessions.length === 0 && <p className="muted" style={{ fontSize: 'var(--fs-xs)', margin: '0 0 6px' }}>No sessions yet — add the first day.</p>}
                              {sessions.map((sess, i) => (
                                <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
                                  <input type="date" value={sess.date || ''} onChange={(e) => upd(i, { date: e.target.value })} style={{ padding: '6px 8px', border: '1px solid var(--line)', borderRadius: 8 }} />
                                  <input type="time" value={sess.open || '08:00'} onChange={(e) => upd(i, { open: e.target.value })} style={{ padding: '6px 8px', border: '1px solid var(--line)', borderRadius: 8 }} />
                                  <span className="muted">to</span>
                                  <input type="time" value={sess.close || '15:00'} onChange={(e) => upd(i, { close: e.target.value })} style={{ padding: '6px 8px', border: '1px solid var(--line)', borderRadius: 8 }} />
                                  <button type="button" className="link" style={{ color: '#c0392b' }} onClick={() => setSessions(sessions.filter((_, j) => j !== i))}>Remove</button>
                                </div>
                              ))}
                              <button type="button" className="btn ghost" style={{ padding: '6px 12px', marginTop: 2 }} onClick={() => setSessions([...sessions, { date: '', open: '08:00', close: '15:00' }])}>+ Add day</button>
                            </div>
                          );
                        })()}
                        {l.type === 'event' && (() => {
                          const code = l.statsCode || '';
                          const link = code ? `${origin}/stats?event=${encodeURIComponent(l.id)}&key=${encodeURIComponent(code)}` : '';
                          const gen = () => updLoc(l.id, { statsCode: Math.random().toString(36).slice(2, 10) });
                          return (
                            <div className="field" style={{ margin: 0 }}>
                              <span style={{ fontWeight: 600, fontSize: 'var(--fs-sm)' }}>Organiser stats link</span>
                              <p className="muted" style={{ fontSize: 'var(--fs-xs)', margin: '2px 0 8px' }}>
                                A private link the event organiser can open to see live numbers — coffees given, booth breakdown and the guest list (names + mobiles). Share it only with people allowed to see guest details.
                              </p>
                              {!code ? (
                                <button type="button" className="btn ghost" style={{ padding: '6px 12px' }} onClick={gen}>Create share link</button>
                              ) : (
                                <>
                                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                                    <input readOnly value={link} onFocus={(e) => e.target.select()} style={{ flex: '1 1 260px', minWidth: 200, padding: '7px 9px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 'var(--fs-xs)' }} />
                                    <button type="button" className="btn ghost" style={{ padding: '6px 12px' }} onClick={() => { try { navigator.clipboard.writeText(link); } catch {} }}>Copy</button>
                                    <button type="button" className="link" onClick={gen} title="Make a new code (the old link stops working)">Reset code</button>
                                  </div>
                                  <p className="muted" style={{ fontSize: 'var(--fs-xs)', margin: '4px 0 0' }}>Remember to press <strong>Save changes</strong> after creating or resetting the code.</p>
                                </>
                              )}
                            </div>
                          );
                        })()}

                        {(() => {
                          const defs = l.type === 'popup' ? { dineIn: false, takeaway: true, reservations: false }
                            : l.type === 'event' ? { dineIn: true, takeaway: false, reservations: false }
                            : { dineIn: true, takeaway: true, reservations: true };
                          const f = l.fulfilment || {};
                          const eff = (k) => (f[k] != null ? !!f[k] : defs[k]);
                          const setF = (k, v) => updLoc(l.id, { fulfilment: { ...(l.fulfilment || {}), [k]: v } });
                          return (
                            <div className="field" style={{ margin: 0 }}>
                              <span>Order types offered at this store</span>
                              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 4 }}>
                                <label className="switch"><input type="checkbox" checked={eff('dineIn')} onChange={(e) => setF('dineIn', e.target.checked)} /> <span>Dine in / tables</span></label>
                                <label className="switch"><input type="checkbox" checked={eff('takeaway')} onChange={(e) => setF('takeaway', e.target.checked)} /> <span>Takeaway</span></label>
                                <label className="switch"><input type="checkbox" checked={eff('reservations')} onChange={(e) => setF('reservations', e.target.checked)} /> <span>Reservations</span></label>
                              </div>
                              <p className="muted" style={{ fontSize: 'var(--fs-xs)', margin: '4px 0 0' }}>
                                Defaults follow the store type; tick to override. A pop-up is takeaway-only unless you switch dine-in/tables on.
                              </p>
                            </div>
                          );
                        })()}

                        <details className="loc-avail">
                          <summary>Opening hours for {l.name || 'this store'}{(l.hours && Object.keys(l.hours).length) ? ' (custom)' : ' (using Square hours)'}</summary>
                          <label className="switch" style={{ margin: '6px 0' }}>
                            <input type="checkbox" checked={!!(l.hours && Object.keys(l.hours).length)} onChange={(e) => updLoc(l.id, { hours: e.target.checked ? (l.hours && Object.keys(l.hours).length ? l.hours : { MON: [{ open: '07:00', close: '15:00' }] }) : null })} />
                            <span>Set custom hours for this store</span>
                          </label>
                          <p className="muted" style={{ fontSize: 'var(--fs-xs)', margin: '2px 0 8px' }}>
                            {(l.hours && Object.keys(l.hours).length)
                              ? 'These hours decide when this store is open, when customers can order “now”, and the reopen countdown they see.'
                              : 'This store follows its Square location hours. Tick above to set different hours (handy for a pop-up).'}
                          </p>
                          {(l.hours && Object.keys(l.hours).length) ? <HoursEditor value={l.hours} onChange={(v) => updLoc(l.id, { hours: v })} /> : null}
                        </details>

                        <details className="loc-avail">
                          <summary>Weather for {l.name || 'this store'}{(l.weather && (l.weather.lat != null && l.weather.lat !== '')) ? ` (${l.weather.label || 'custom'})` : ' (using main store)'}</summary>
                          <p className="muted" style={{ fontSize: 'var(--fs-xs)', margin: '6px 0' }}>The temperature chip shows this store’s local weather. Leave blank to use your main store’s location.</p>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                            <label className="field" style={{ margin: 0 }}><span>Latitude</span>
                              <input type="number" step="0.0001" value={l.weather?.lat ?? ''} placeholder="-35.15" onChange={(e) => updLoc(l.id, { weather: { ...(l.weather || {}), lat: e.target.value === '' ? null : Number(e.target.value) } })} /></label>
                            <label className="field" style={{ margin: 0 }}><span>Longitude</span>
                              <input type="number" step="0.0001" value={l.weather?.lng ?? ''} placeholder="149.28" onChange={(e) => updLoc(l.id, { weather: { ...(l.weather || {}), lng: e.target.value === '' ? null : Number(e.target.value) } })} /></label>
                            <label className="field" style={{ margin: 0 }}><span>Label (optional)</span>
                              <input value={l.weather?.label || ''} placeholder="Sutton" onChange={(e) => updLoc(l.id, { weather: { ...(l.weather || {}), label: e.target.value } })} /></label>
                          </div>
                        </details>

                        <details className="loc-avail">
                          <summary>Visit / store page for {l.name || 'this store'}{(l.storePage && (l.storePage.photo || l.storePage.bio)) ? ' (custom)' : ' (using main store)'}</summary>
                          <p className="muted" style={{ fontSize: 'var(--fs-xs)', margin: '6px 0' }}>The “Visit” page customers see for this store — its own photo, blurb and phone. Its address and opening hours come from the fields above. Leave blank to use your main store’s details.</p>
                          <div style={{ display: 'grid', gap: 8 }}>
                            <div style={row}>
                              <label className="btn ghost" style={{ padding: '8px 12px', fontSize: 'var(--fs-base)', cursor: 'pointer' }}>
                                {l.storePage?.photo ? 'Change photo' : 'Upload photo'}
                                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files[0]; if (f) uploadImage(f, (url) => updLoc(l.id, { storePage: { ...(l.storePage || {}), photo: url } }), 'stores'); e.target.value = ''; }} />
                              </label>
                              {l.storePage?.photo && (
                                <>
                                  <img src={l.storePage.photo} alt="" style={{ height: 40, borderRadius: 6 }} />
                                  <button type="button" className="link" style={{ color: '#c0392b' }} onClick={() => updLoc(l.id, { storePage: { ...(l.storePage || {}), photo: '' } })}>Remove</button>
                                </>
                              )}
                            </div>
                            <label className="field" style={{ margin: 0 }}><span>Blurb (a line or two about this store)</span>
                              <textarea rows={2} value={l.storePage?.bio || ''} placeholder="e.g. Find us in the marquee by the tulip beds — great coffee while you wander the gardens." onChange={(e) => updLoc(l.id, { storePage: { ...(l.storePage || {}), bio: e.target.value } })} style={{ padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 10, font: 'inherit', resize: 'vertical' }} /></label>
                            <label className="field" style={{ margin: 0 }}><span>Phone (optional)</span>
                              <input value={l.storePage?.phone || ''} placeholder="Leave blank to use your main number" onChange={(e) => updLoc(l.id, { storePage: { ...(l.storePage || {}), phone: e.target.value } })} /></label>
                          </div>
                        </details>

                        <details className="loc-avail">
                          <summary>Items available at {l.name || 'this store'} ({offeredProducts.length - (l.hiddenItemIds || []).length}/{offeredProducts.length})</summary>
                          <p className="muted" style={{ fontSize: 'var(--fs-xs)', margin: '6px 0' }}>Untick anything this store doesn't make (e.g. hot food at a takeaway site). Unticked items are hidden from this store's menu.</p>
                          {offeredProducts.length === 0 && offeredIds === null && <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Loading products…</p>}
                          {offeredProducts.length === 0 && offeredIds !== null && <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>No menu items found. Add items to your app menu first, then they’ll appear here to switch on or off per store.</p>}
                          {offeredByCategory().map((g) => {
                            const catIds = g.items.map((it) => it.id);
                            const hiddenList = l.hiddenItemIds || [];
                            const onCount = catIds.filter((id) => !hiddenList.includes(id)).length;
                            const allOn = onCount === catIds.length;
                            const noneOn = onCount === 0;
                            return (
                              <div key={g.category} className="loc-avail-cat">
                                <label className="loc-avail-cathead">
                                  <input type="checkbox" checked={allOn} ref={(el) => { if (el) el.indeterminate = !allOn && !noneOn; }} onChange={() => toggleLocCategory(l.id, catIds)} />
                                  <span className="loc-avail-catname">{g.category}</span>
                                  <span className="loc-avail-catcount muted">{onCount}/{catIds.length}</span>
                                </label>
                                <div className="loc-avail-list">
                                  {g.items.map((p) => {
                                    const hidden = hiddenList.includes(p.id);
                                    return (
                                      <label key={p.id} className={`loc-avail-item${hidden ? ' off' : ''}`}>
                                        <input type="checkbox" checked={!hidden} onChange={() => toggleLocItem(l.id, p.id)} />
                                        <span>{p.name}</span>
                                      </label>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </details>

                        <div className="loc-qr-wrap">
                          <button type="button" className="btn ghost" onClick={() => makeLocQr(l.id)}>Walk-around order QR</button>
                          {locQr[l.id] && (
                            <div className="loc-qr">
                              <img src={locQr[l.id].img} alt="" width={128} height={128} />
                              <div className="loc-qr-meta">
                                <code>{locQr[l.id].url}</code>
                                <a className="btn" style={{ padding: '6px 12px' }} download={`order-qr-${l.id}.png`} href={locQr[l.id].img}>Download PNG</a>
                                <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>Scanning opens the app already set to {l.name || 'this store'} — no table. Save the store first so the link resolves.</span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}

                  <button type="button" className="btn ghost" onClick={addLoc}>+ Add a store</button>
                  {locs.length > 0 && (
                    <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 10 }}>
                      A walk-around / general-order QR for each store is on the <strong>Tables</strong> tab. Card payments need a Square Terminal paired at each store. Press <strong>Save changes</strong> to make store changes live.
                    </p>
                  )}
                </div>

                <div className="card" style={card}>
                  <div className="group-title">Surcharges</div>
                  <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 0 }}>Added to the Square order as surcharge lines (shown on the receipt). A card surcharge in Australia must not exceed your cost of acceptance — set your own %. Remember to press <strong>Save changes</strong>.</p>

                  <div className="avail-sched" style={{ marginBottom: 12 }}>
                    <label className="switch"><input type="checkbox" checked={!!scfg.weekend?.enabled} onChange={(e) => setWeekendSc({ enabled: e.target.checked })} /> <span>Weekend surcharge</span></label>
                    {scfg.weekend?.enabled && (
                      <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                        <label className="field" style={{ margin: 0, maxWidth: 160 }}><span>Percent (%)</span>
                          <input type="number" step="0.1" min="0" value={scfg.weekend?.percent ?? 10} onChange={(e) => setWeekendSc({ percent: Number(e.target.value) })} />
                        </label>
                        <div>
                          <div className="muted" style={{ fontSize: 'var(--fs-xs)', marginBottom: 4 }}>Days it applies</div>
                          <div className="avail-chipwrap">
                            {DOWS.map(([lbl, d]) => (
                              <button type="button" key={d} className={`avail-chip${weekendDays.includes(d) ? ' on' : ''}`} onClick={() => toggleWeekendDay(d)}>{lbl}</button>
                            ))}
                          </div>
                        </div>
                        <label className="field" style={{ margin: 0 }}><span>Public holiday dates (one per line, YYYY-MM-DD) — surcharge applies on these too</span>
                          <textarea rows={2} value={(scfg.weekend?.publicHolidays || []).join('\n')} onChange={(e) => setWeekendSc({ publicHolidays: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) })} placeholder="2026-12-25&#10;2026-12-26" />
                        </label>
                        <label className="field" style={{ margin: 0 }}><span>Label on receipt</span>
                          <input value={scfg.weekend?.label || 'Weekend surcharge'} onChange={(e) => setWeekendSc({ label: e.target.value })} />
                        </label>
                        {locs.length > 1 && (
                          <div>
                            <div className="muted" style={{ fontSize: 'var(--fs-xs)', marginBottom: 4 }}>Applies at</div>
                            <div className="avail-chipwrap">
                              <button type="button" className={`avail-chip${!(scfg.weekend?.locations || []).length ? ' on' : ''}`} onClick={() => setWeekendSc({ locations: [] })}>All stores</button>
                              {locs.map((l) => {
                                const on = (scfg.weekend?.locations || []).includes(l.id);
                                return <button type="button" key={l.id} className={`avail-chip${on ? ' on' : ''}`} onClick={() => { const set = new Set(scfg.weekend?.locations || []); on ? set.delete(l.id) : set.add(l.id); setWeekendSc({ locations: [...set] }); }}>{l.name || l.id}</button>;
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="avail-sched">
                    <label className="switch"><input type="checkbox" checked={!!scfg.card?.enabled} onChange={(e) => setCardSc({ enabled: e.target.checked })} /> <span>Card surcharge</span></label>
                    {scfg.card?.enabled && (
                      <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                        <label className="field" style={{ margin: 0, maxWidth: 160 }}><span>Percent (%)</span>
                          <input type="number" step="0.1" min="0" value={scfg.card?.percent ?? 1.5} onChange={(e) => setCardSc({ percent: Number(e.target.value) })} />
                        </label>
                        <label className="field" style={{ margin: 0 }}><span>Label on receipt</span>
                          <input value={scfg.card?.label || 'Card surcharge'} onChange={(e) => setCardSc({ label: e.target.value })} />
                        </label>
                        <p className="muted" style={{ fontSize: 'var(--fs-xs)', margin: 0 }}>Applied to card payments only (app card + POS card tender), never to cash or gift balance.</p>
                        {locs.length > 1 && (
                          <div>
                            <div className="muted" style={{ fontSize: 'var(--fs-xs)', marginBottom: 4 }}>Applies at</div>
                            <div className="avail-chipwrap">
                              <button type="button" className={`avail-chip${!(scfg.card?.locations || []).length ? ' on' : ''}`} onClick={() => setCardSc({ locations: [] })}>All stores</button>
                              {locs.map((l) => {
                                const on = (scfg.card?.locations || []).includes(l.id);
                                return <button type="button" key={l.id} className={`avail-chip${on ? ' on' : ''}`} onClick={() => { const set = new Set(scfg.card?.locations || []); on ? set.delete(l.id) : set.add(l.id); setCardSc({ locations: [...set] }); }}>{l.name || l.id}</button>;
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* ───────── SOLD OUT & MENUS ───────── */}
            {tab === 'availability' && (
              <>
                <div className="admin-page-head">
                  <h1 className="admin-page-title">Sold Out &amp; Menus</h1>
                  <p className="admin-page-desc">Flag an item sold out in seconds, set a busy-day exclusion list, and run time-based menus (breakfast, lunch, weekend). Every change shows on the customer menu straight away.</p>
                </div>

                <div className="avail-subtabs">
                  {[['items', 'Sold-out items'], ['exclusions', 'Day exclusions'], ['schedules', 'Menu schedules']].map(([k, l]) => (
                    <button key={k} type="button" className={`avail-subtab${availSub === k ? ' on' : ''}`} onClick={() => setAvailSub(k)}>{l}</button>
                  ))}
                </div>

                {/* ── 1. SOLD-OUT ITEMS ── */}
                {availSub === 'items' && (
                  <div className="card" style={card}>
                    <div className="group-title">Sold-out items</div>
                    <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 0 }}>
                      Tap <strong>Sold out</strong> when you run out for the day &mdash; it comes back automatically the next time you open. Tap <strong>Unavailable</strong> to take it off indefinitely (shows red here and in the Product Builder, so you know to check before turning it back on). These save instantly &mdash; no need to press Save changes.
                    </p>
                    <input className="avail-search" placeholder="Search items — filters as you type…" value={availSearch} onChange={(e) => setAvailSearch(e.target.value)} autoComplete="off" />
                    {(() => {
                      // Category chips, built from the offered (Product Builder) menu items
                      // only. Pick one to see just that category; "All" clears it.
                      const cats = [...new Set(offeredProducts.map((p) => (p.category || '').trim()).filter(Boolean))].sort();
                      if (cats.length < 2) return null;
                      return (
                        <div className="avail-catchips">
                          <button type="button" className={`avail-catchip${availCat === '' ? ' on' : ''}`} onClick={() => setAvailCat('')}>All</button>
                          {cats.map((c) => (
                            <button key={c} type="button" className={`avail-catchip${availCat === c ? ' on' : ''}`} onClick={() => setAvailCat(availCat === c ? '' : c)}>{c}</button>
                          ))}
                        </div>
                      );
                    })()}
                    <div className="avail-list">
                      {offeredProducts.length === 0 && offeredIds === null && <p className="muted" style={{ fontSize: 'var(--fs-sm)', padding: 8 }}>Loading items…</p>}
                      {offeredProducts.length === 0 && offeredIds !== null && <p className="muted" style={{ fontSize: 'var(--fs-sm)', padding: 8 }}>No menu items found. Add items to your app menu first, then they’ll appear here.</p>}
                      {(() => {
                        const q = availSearch.trim().toLowerCase();
                        // Use the app's OFFERED menu items — these carry the menu's own ids
                        // (e.g. `preset:<id>`), so a sold-out flag is stored under the id the
                        // customer menu is actually built from and takes effect immediately.
                        // (The raw Square product list uses a different id space for
                        // preset-built menus, which is why flags saved against it never showed.)
                        const list = offeredProducts.filter((p) =>
                          (!availCat || (p.category || '').trim() === availCat) &&
                          (!q || p.name.toLowerCase().includes(q) || (p.category || '').toLowerCase().includes(q)));
                        if (offeredProducts.length && !list.length) return <p className="muted" style={{ fontSize: 'var(--fs-sm)', padding: 8 }}>No items{availCat ? ` in ${availCat}` : ''}{q ? ` match “${availSearch.trim()}”` : ''}.</p>;
                        const STATUS = {
                          available: { label: 'Available', cls: 'ok' },
                          today: { label: 'Sold out today', cls: 'warn' },
                          off: { label: 'Unavailable', cls: 'bad' },
                          on: { label: 'Available (made today)', cls: 'ok' },
                          excluded: { label: `Sold out (${DOW_LABELS[todayDow]} list)`, cls: 'warn' },
                        };
                        return list.map((p) => {
                          const st = itemStatus(p.id, p.sourceId);
                          const badge = STATUS[st] || STATUS.available;
                          const busy = availBusy === p.id;
                          const availActive = st === 'available' || st === 'on';
                          return (
                            <div key={p.id} className={`avail-row${st === 'off' ? ' is-off' : ''}`}>
                              {p.image
                                ? <img src={p.image} alt="" className="avail-thumb" />
                                : <span className="avail-thumb avail-thumb-ph">🍽️</span>}
                              <span className="avail-meta">
                                <span className="avail-name">{p.name}</span>
                                <span className={`avail-pill ${badge.cls}`}>{badge.label}</span>
                              </span>
                              <span className="avail-actions">
                                <button type="button" disabled={busy} className={`avail-btn ok${availActive ? ' on' : ''}`}
                                  onClick={() => toggleItemAvail(p.id, st === 'excluded' ? 'on' : 'clear', p.sourceId)}>Available</button>
                                <button type="button" disabled={busy} className={`avail-btn warn${st === 'today' ? ' on' : ''}`}
                                  onClick={() => toggleItemAvail(p.id, 'today', p.sourceId)}>Sold out</button>
                                <button type="button" disabled={busy} className={`avail-btn bad${st === 'off' ? ' on' : ''}`}
                                  onClick={() => toggleItemAvail(p.id, 'off', p.sourceId)}>Unavailable</button>
                              </span>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>
                )}

                {/* ── 2. DAY EXCLUSIONS ── */}
                {availSub === 'exclusions' && (
                  <div className="card" style={card}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <div className="group-title" style={{ margin: 0 }}>Day exclusion lists</div>
                      <label className="avail-switch">
                        <input type="checkbox" checked={availExcl.enabled !== false} onChange={(e) => setExclEnabled(e.target.checked)} />
                        <span>{availExcl.enabled !== false ? 'On' : 'Off'}</span>
                      </label>
                    </div>
                    <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 6 }}>
                      Pick a day, then add the products that should start <strong>sold out</strong> on that day every week (for busy days like Saturday). If you have capacity, staff can flip one back on for the day from the <strong>Sold-out items</strong> tab. Remember to press <strong>Save changes</strong>.
                    </p>
                    <div className="avail-daychips">
                      {DOW_LABELS.map((d, i) => (
                        <button key={i} type="button" className={`avail-daychip${exclDay === i ? ' on' : ''}`} onClick={() => setExclDay(i)}>
                          {d}{exclListFor(i).length ? <span className="avail-daycount">{exclListFor(i).length}</span> : null}
                        </button>
                      ))}
                    </div>
                    <div style={{ fontWeight: 700, margin: '10px 0 4px' }}>
                      {DOW_LABELS[exclDay]} &mdash; sold out by default{exclListFor(exclDay).length ? ` (${exclListFor(exclDay).length})` : ''}
                    </div>
                    {(() => {
                      // Category chips, from the offered (Product Builder) menu items only.
                      const cats = [...new Set(offeredProducts.map((p) => (p.category || '').trim()).filter(Boolean))].sort();
                      if (cats.length < 2) return null;
                      return (
                        <div className="avail-catchips">
                          <button type="button" className={`avail-catchip${exclCat === '' ? ' on' : ''}`} onClick={() => setExclCat('')}>All</button>
                          {cats.map((c) => (
                            <button key={c} type="button" className={`avail-catchip${exclCat === c ? ' on' : ''}`} onClick={() => setExclCat(exclCat === c ? '' : c)}>{c}</button>
                          ))}
                        </div>
                      );
                    })()}
                    <input className="avail-search" placeholder="Search items — filters as you type…" value={exclSearch} onChange={(e) => setExclSearch(e.target.value)} autoComplete="off" />
                    <div className="avail-list">
                      {offeredProducts.length === 0 && offeredIds === null && <p className="muted" style={{ fontSize: 'var(--fs-sm)', padding: 8 }}>Loading items…</p>}
                      {offeredProducts.length === 0 && offeredIds !== null && <p className="muted" style={{ fontSize: 'var(--fs-sm)', padding: 8 }}>No menu items found. Add items to your app menu first, then they’ll appear here.</p>}
                      {(() => {
                        const excludedSet = new Set(exclListFor(exclDay));
                        const q = exclSearch.trim().toLowerCase();
                        // Same offered menu items as the Sold-out list — keyed by the menu id
                        // so an exclusion takes effect on the customer menu.
                        const items = offeredProducts.filter((p) =>
                          (!exclCat || (p.category || '').trim() === exclCat) &&
                          (!q || p.name.toLowerCase().includes(q) || (p.category || '').toLowerCase().includes(q)));
                        if (offeredProducts.length && !items.length) return <p className="muted" style={{ fontSize: 'var(--fs-sm)', padding: 8 }}>No items{exclCat ? ` in ${exclCat}` : ''}{q ? ` match “${exclSearch.trim()}”` : ''}.</p>;
                        return items.map((p) => {
                          const on = excludedSet.has(p.id);
                          return (
                            <div key={p.id} className="avail-row">
                              {p.image
                                ? <img src={p.image} alt="" className="avail-thumb" />
                                : <span className="avail-thumb avail-thumb-ph">🍽️</span>}
                              <span className="avail-meta">
                                <span className="avail-name">{p.name}</span>
                                <span className={`avail-pill ${on ? 'warn' : 'ok'}`}>{on ? `Sold out ${DOW_LABELS[exclDay]}` : 'Available'}</span>
                              </span>
                              <span className="avail-actions">
                                <button type="button" className={`avail-btn ok${on ? '' : ' on'}`} onClick={() => { if (on) toggleExcl(exclDay, p.id); }}>Available</button>
                                <button type="button" className={`avail-btn warn${on ? ' on' : ''}`} onClick={() => { if (!on) toggleExcl(exclDay, p.id); }}>Sold out</button>
                              </span>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>
                )}

                {/* ── 3. MENU SCHEDULES ── */}
                {availSub === 'schedules' && (
                  <div className="card" style={card}>
                    <div className="group-title">Menu schedules</div>
                    <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 0 }}>
                      Run a menu only at certain times on certain days. Pick one of your existing menus to schedule it, or build a custom one. A category listed in a schedule shows <strong>only</strong> inside its window (e.g. Breakfast 7:00&ndash;11:00, Mon&ndash;Fri); outside it, it disappears from the customer menu. Categories not used in any schedule always show. Remember to press <strong>Save changes</strong>.
                    </p>
                    {availSchedules.length === 0 && <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>No schedules yet. Load an existing menu below to schedule it, or add a custom one.</p>}
                    {availSchedules.map((sc) => (
                      <div key={sc.id} className="avail-sched">
                        <div className="avail-sched-head">
                          <input className="avail-sched-name" value={sc.name || ''} placeholder="Menu name (e.g. Breakfast)" onChange={(e) => updateSchedule(sc.id, { name: e.target.value })} />
                          <label className="avail-switch">
                            <input type="checkbox" checked={sc.enabled !== false} onChange={(e) => updateSchedule(sc.id, { enabled: e.target.checked })} />
                            <span>{sc.enabled !== false ? 'On' : 'Off'}</span>
                          </label>
                          <button type="button" className="avail-del" title="Delete schedule" onClick={() => removeSchedule(sc.id)}>✕</button>
                        </div>
                        <div className="avail-sched-times">
                          <label>From <input type="time" value={sc.start || '07:00'} onChange={(e) => updateSchedule(sc.id, { start: e.target.value })} /></label>
                          <label>To <input type="time" value={sc.end || '11:00'} onChange={(e) => updateSchedule(sc.id, { end: e.target.value })} /></label>
                        </div>
                        <div className="avail-sched-days">
                          {DOW_LABELS.map((d, i) => (
                            <button key={i} type="button" className={`avail-daychip sm${(sc.days || []).includes(i) ? ' on' : ''}`} onClick={() => toggleSchedDay(sc.id, i)}>{d[0]}</button>
                          ))}
                        </div>
                        <div className="avail-sched-cats">
                          <div className="muted" style={{ fontSize: 'var(--fs-xs)', marginBottom: 4 }}>Categories in this menu</div>
                          {scheduleCatOptions.length === 0 && <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>No categories loaded yet.</span>}
                          <div className="avail-chipwrap">
                            {scheduleCatOptions.map((name) => (
                              <button key={name} type="button" className={`chip${(sc.categories || []).includes(name) ? ' on' : ''}`} onClick={() => toggleSchedCat(sc.id, name)}>
                                {(sc.categories || []).includes(name) ? '✓ ' : '+ '}{name}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                    <div className="avail-sched-add">
                      <div className="muted" style={{ fontSize: 'var(--fs-xs)', marginBottom: 6 }}>Schedule an existing menu</div>
                      <div className="avail-menuchips">
                        {scheduleCatOptions.length === 0 && <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>No menus loaded yet.</span>}
                        {scheduleCatOptions.map((name) => (
                          <button key={name} type="button" className="avail-menuchip" onClick={() => addScheduleFromMenu(name)}>
                            <span className="avail-menuchip-plus">＋</span>{name}
                          </button>
                        ))}
                      </div>
                      <button type="button" className="btn full" style={{ marginTop: 12 }} onClick={addSchedule}>+ New custom menu schedule</button>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ───────── PAY IT FORWARD ───────── */}
            {tab === 'payitforward' && (() => {
              const pif = s?.payItForward || {};
              const setPif = (patch) => set({ payItForward: { ...pif, ...patch } });
              const toggleCat = (c) => {
                const ids = new Set(pif.eligibleCategoryIds || []);
                const names = new Set(pif.eligibleCategoryNames || []);
                if (ids.has(c.id)) { ids.delete(c.id); names.delete(c.name); }
                else { ids.add(c.id); names.add(c.name); }
                setPif({ eligibleCategoryIds: [...ids], eligibleCategoryNames: [...names] });
              };
              const cents = (v) => formatMoney(v || 0, data?.currency);
              const k = pifKpisData;
              const STATUS_OPTS = ['', 'ACTIVE', 'PARTIALLY_REDEEMED', 'REDEEMED', 'EXPIRED', 'CANCELLED', 'REFUNDED', 'PAYMENT_FAILED'];
              return (
                <>
                  <div className="admin-page-head">
                    <h1 className="admin-page-title">Pay It Forward</h1>
                    <p className="admin-page-desc">Buy-a-coffee-for-someone gifting. Purchasing a gift never creates a live café order — only the recipient's actual redemption at checkout does, through your normal ordering &amp; kitchen workflow.</p>
                  </div>

                  {pifEligibility && pifEligibility.warning && (
                    <div className="card" style={{ ...card, borderColor: 'var(--admin-danger)', background: 'var(--admin-danger-soft, #fdecec)' }}>
                      <strong style={{ color: 'var(--admin-danger)' }}>⚠ Pay It Forward category configuration requires attention</strong>
                      <p className="muted" style={{ marginTop: 4, fontSize: 'var(--fs-sm)' }}>{pifEligibility.warning}</p>
                    </div>
                  )}

                  {/* ---- KPI cards ---- */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 16 }}>
                    {[
                      ['Total value gifted', k ? cents(k.valueGiftedCents) : '—'],
                      ['Coffees purchased', k ? k.giftsPurchased : '—'],
                      ['Value redeemed', k ? cents(k.valueRedeemedCents) : '—'],
                      ['Fully redeemed', k ? k.fullyRedeemed : '—'],
                      ['Outstanding value', k ? cents(k.outstandingValueCents) : '—'],
                      ['Outstanding gifts', k ? k.outstandingCount : '—'],
                      ['Redemption rate', k ? `${Math.round((k.redemptionRate || 0) * 100)}%` : '—'],
                      ['New customers introduced', k ? k.uniqueRecipients : '—'],
                    ].map(([label, val]) => (
                      <div key={label} className="card" style={{ padding: '14px 16px' }}>
                        <div className="muted" style={{ fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: '.4px' }}>{label}</div>
                        <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4, color: 'var(--admin-heading)' }}>{val}</div>
                      </div>
                    ))}
                  </div>

                  {/* ---- Settings ---- */}
                  <div className="card" style={card}>
                    <div className="group-title" style={{ margin: 0 }}>Settings</div>
                    <label className="field-row" style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
                      <input type="checkbox" checked={pif.enabled !== false && !!pif.enabled} onChange={(e) => setPif({ enabled: e.target.checked })} />
                      <span>Enable Pay It Forward on the storefront</span>
                    </label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginTop: 12 }}>
                      <label className="field" style={{ margin: 0 }}><span>Minimum gift ($)</span>
                        <input type="number" min="1" step="0.5" value={(pif.minValueCents || 0) / 100} onChange={(e) => setPif({ minValueCents: Math.round((Number(e.target.value) || 0) * 100) })} /></label>
                      <label className="field" style={{ margin: 0 }}><span>Maximum gift ($)</span>
                        <input type="number" min="1" step="0.5" value={(pif.maxValueCents || 0) / 100} onChange={(e) => setPif({ maxValueCents: Math.round((Number(e.target.value) || 0) * 100) })} /></label>
                      <label className="field" style={{ margin: 0 }}><span>Expiry (days)</span>
                        <input type="number" min="0" value={pif.expiryDays || 0} onChange={(e) => setPif({ expiryDays: Number(e.target.value) || 0 })} /></label>
                    </div>
                    <div className="group-title" style={{ marginTop: 16 }}>Coffee presets</div>
                    <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 4 }}>Named buttons shoppers pick from — e.g. “Small Coffee” for $5.50. Set the price to match your real coffee prices.</p>
                    {(pif.suggestedValues || []).map(pifPreset).map((r, i) => (
                      <div key={i} style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
                        <input style={{ flex: 2, padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 10 }} placeholder="Label (e.g. Small Coffee)" value={r.label}
                          onChange={(e) => setPif({ suggestedValues: (pif.suggestedValues || []).map(pifPreset).map((x, idx) => idx === i ? { ...x, label: e.target.value } : x) })} />
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}>
                          <span className="muted">$</span>
                          <input style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 10 }} type="number" min="0" step="0.5" placeholder="5.50"
                            value={r.valueCents ? r.valueCents / 100 : ''}
                            onChange={(e) => setPif({ suggestedValues: (pif.suggestedValues || []).map(pifPreset).map((x, idx) => idx === i ? { ...x, valueCents: Math.round((parseFloat(e.target.value) || 0) * 100) } : x) })} />
                        </div>
                        <button type="button" className="chip" title="Remove preset" onClick={() => setPif({ suggestedValues: (pif.suggestedValues || []).map(pifPreset).filter((_, idx) => idx !== i) })}>✕</button>
                      </div>
                    ))}
                    <button type="button" className="chip" style={{ marginTop: 10 }} onClick={() => setPif({ suggestedValues: [...(pif.suggestedValues || []).map(pifPreset), { label: '', valueCents: 0 }] })}>+ Add preset</button>
                    <label className="field-row" style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
                      <input type="checkbox" checked={pif.allowCustomAmount !== false} onChange={(e) => setPif({ allowCustomAmount: e.target.checked })} />
                      <span>Allow a custom amount</span>
                    </label>
                    <label className="field-row" style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
                      <input type="checkbox" checked={!!pif.allowPointsPayment} onChange={(e) => setPif({ allowPointsPayment: e.target.checked })} />
                      <span>Allow paying with loyalty points</span>
                    </label>
                    <label className="field-row" style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
                      <input type="checkbox" checked={!!pif.showSocialProofStats} onChange={(e) => setPif({ showSocialProofStats: e.target.checked })} />
                      <span>Show "coffees gifted" stats on the storefront</span>
                    </label>

                    <div className="group-title" style={{ marginTop: 18 }}>Eligible categories</div>
                    <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 4 }}>Only items in these categories can be discounted by a gift — never food, drinks, or merch outside them. Choosing none disables redemption entirely (fails closed, never open).</p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                      {(() => {
                        // Only show categories that actually appear in the app menu (hide the
                        // extra Square categories). Keep any already-selected category on the
                        // list even if it's since left the menu, so it can still be turned off.
                        const inApp = new Set(visibleCats.map((c) => (c.category || '').toLowerCase()));
                        const selected = new Set(pif.eligibleCategoryIds || []);
                        const shown = sqCats.filter((c) => !c.isParent && (inApp.has((c.name || '').toLowerCase()) || selected.has(c.id)));
                        if (!shown.length) return <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>No app menu categories found yet.</p>;
                        return shown.map((c) => (
                          <button key={c.id} type="button" className={`chip ${selected.has(c.id) ? 'on' : ''}`} onClick={() => toggleCat(c)}>{c.name}</button>
                        ));
                      })()}
                    </div>

                    <div className="group-title" style={{ marginTop: 18 }}>SMS message</div>
                    <label className="field"><span>Template — {'{{purchaserName}}'}, {'{{claimUrl}}'}, {'{{code}}'}</span>
                      <textarea rows={2} value={pif.smsTemplate || ''} onChange={(e) => setPif({ smsTemplate: e.target.value })} /></label>

                    <div className="group-title" style={{ marginTop: 18 }}>Message suggestions</div>
                    {(pif.messageTemplates || []).map((t, i) => (
                      <div key={i} style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                        <input style={{ flex: 1 }} value={t} onChange={(e) => setPif({ messageTemplates: (pif.messageTemplates || []).map((x, xi) => (xi === i ? e.target.value : x)) })} />
                        <button type="button" className="link" style={{ color: 'var(--admin-danger)' }} onClick={() => setPif({ messageTemplates: (pif.messageTemplates || []).filter((_, xi) => xi !== i) })}>Remove</button>
                      </div>
                    ))}
                    <button type="button" className="btn ghost" style={{ marginTop: 8 }} onClick={() => setPif({ messageTemplates: [...(pif.messageTemplates || []), 'New message'] })}>+ Add suggestion</button>
                  </div>

                  {/* ---- Gift management table ---- */}
                  <div className="card" style={card}>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div className="group-title" style={{ margin: 0 }}>Gifts</div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <input placeholder="Search code, purchaser, recipient…" value={pifSearch} onChange={(e) => setPifSearch(e.target.value)} style={{ minWidth: 220 }} />
                        <select value={pifFilter} onChange={(e) => setPifFilter(e.target.value)}>
                          {STATUS_OPTS.map((st) => <option key={st} value={st}>{st ? st.replace(/_/g, ' ') : 'All statuses'}</option>)}
                        </select>
                      </div>
                    </div>
                    {!pifGifts && <p className="muted" style={{ marginTop: 10 }}>Loading…</p>}
                    {pifGifts && pifGifts.rows.length === 0 && <p className="muted" style={{ marginTop: 10 }}>No gifts yet.</p>}
                    {pifGifts && pifGifts.rows.length > 0 && (
                      <div style={{ overflowX: 'auto', marginTop: 10 }}>
                        <table className="admin-table">
                          <thead><tr><th>From</th><th>Recipient</th><th>Value</th><th>Method</th><th>Status</th><th>Purchased</th></tr></thead>
                          <tbody>
                            {pifGifts.rows.map((g) => (
                              <tr key={g.id} style={{ cursor: 'pointer' }} onClick={() => openPifDetail(g.id)}>
                                <td>{g.purchaserName || '—'}</td>
                                <td>{g.recipientName || '—'}</td>
                                <td>{cents(g.valueCents)}</td>
                                <td style={{ textTransform: 'capitalize' }}>{g.paymentMethod}</td>
                                <td><span className="pill">{(g.status || '').replace(/_/g, ' ')}</span></td>
                                <td>{g.createdAt ? new Date(g.createdAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* ---- Detail drawer ---- */}
                  {pifDetail && (
                    <div className="backdrop" onClick={() => setPifDetail(null)}>
                      <div className="sheet" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
                        <button className="sheet-close" onClick={() => setPifDetail(null)} aria-label="Close">✕</button>
                        <div className="sheet-body">
                          <h2>{pifDetail.gift.purchaserName || 'Someone'} → {pifDetail.gift.recipientName || 'Someone'}</h2>
                          <p className="muted">{pifDetail.gift.code} · {cents(pifDetail.gift.remainingCents)} of {cents(pifDetail.gift.valueCents)} remaining · <span style={{ textTransform: 'capitalize' }}>{pifDetail.gift.paymentMethod}</span></p>
                          {pifDetail.gift.message && <blockquote style={{ background: 'var(--admin-surface-soft)', padding: 10, borderRadius: 10, fontStyle: 'italic' }}>"{pifDetail.gift.message}"</blockquote>}

                          <div className="group-title" style={{ marginTop: 14 }}>Timeline</div>
                          <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0', display: 'grid', gap: 6 }}>
                            {(pifDetail.events || []).map((ev) => (
                              <li key={ev.id} style={{ fontSize: 'var(--fs-sm)' }}>
                                <span className="muted">{new Date(ev.createdAt).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span> — {ev.type.replace(/_/g, ' ')}
                              </li>
                            ))}
                          </ul>

                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
                            <button type="button" className="btn ghost" disabled={pifBusy} onClick={() => { navigator.clipboard?.writeText(`${window.location.origin}/gift/${pifDetail.gift.token}`); }}>Copy link</button>
                            <button type="button" className="btn ghost" disabled={pifBusy} onClick={() => pifAction(api.adminPifResendSms, pifDetail.gift.id)}>Resend SMS</button>
                            {pifDetail.gift.status === 'ACTIVE' && pifDetail.gift.remainingCents === pifDetail.gift.valueCents && (
                              <button type="button" className="btn ghost" disabled={pifBusy} onClick={() => { if (window.confirm('Cancel this unused gift?')) pifAction(api.adminPifCancel, pifDetail.gift.id); }}>Cancel</button>
                            )}
                            {['ACTIVE', 'PARTIALLY_REDEEMED'].includes(pifDetail.gift.status) && (
                              <button type="button" className="btn ghost" style={{ color: 'var(--admin-danger)' }} disabled={pifBusy} onClick={() => { if (window.confirm('Refund this gift?')) pifAction(api.adminPifRefund, pifDetail.gift.id, 'REFUNDED'); }}>Refund</button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              );
            })()}

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
                          {LINK_TYPES.map((t) => <option key={t} value={t}>{LINK_TYPE_LABELS[t] || t}</option>)}
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
                      {locs.length > 1 && (
                        <div style={{ marginTop: 8, padding: '8px 10px', border: '1px dashed var(--line)', borderRadius: 10 }}>
                          <div style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, marginBottom: 4 }}>Show at</div>
                          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                            <label className="switch"><input type="checkbox" checked={!(Array.isArray(sl.locations) && sl.locations.length)} onChange={() => updSlide(i, { locations: [] })} /> <span>All stores</span></label>
                            {locs.map((l) => {
                              const sel = (sl.locations || []).includes(l.id);
                              return (
                                <label key={l.id} className="switch"><input type="checkbox" checked={sel} onChange={(e) => {
                                  const cur = new Set(sl.locations || []);
                                  e.target.checked ? cur.add(l.id) : cur.delete(l.id);
                                  updSlide(i, { locations: [...cur] });
                                }} /> <span>{l.name || l.id}</span></label>
                              );
                            })}
                          </div>
                          <p className="muted" style={{ fontSize: 'var(--fs-xs)', margin: '4px 0 0' }}>Leave “All stores” on to show everywhere, or tick specific stores to limit this banner — e.g. hide a kitchen special at a no-kitchen pop-up, or show a barista-lessons / roastery banner only at the pop-up.</p>
                        </div>
                      )}
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
                        <option value="upgrade">Size upgrade (large for small price)</option>
                      </select>
                      {c.type !== 'comp' && c.type !== 'upgrade' && (
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
                      <label style={{ ...row, fontSize: 'var(--fs-base)' }} className="muted">
                        <span>Starts</span>
                        <input type="date" value={c.startDate || ''} onChange={(e) => updCoupon(i, { startDate: e.target.value })}
                          style={{ padding: '6px 8px', border: '1px solid var(--line)', borderRadius: 10 }} />
                        {c.startDate && <button className="link" style={{ fontSize: 'var(--fs-sm)', padding: 2 }} onClick={() => updCoupon(i, { startDate: '' })}>clear</button>}
                      </label>
                      <label style={{ ...row, cursor: 'pointer', fontSize: 'var(--fs-base)' }}>
                        <input type="checkbox" checked={c.active !== false} onChange={(e) => updCoupon(i, { active: e.target.checked })} />
                        <span>{c.active !== false ? 'Active' : 'Off'}</span>
                      </label>
                    </div>
                    {/* Conditions: which days, first-visit, birthday */}
                    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--line)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Valid on</span>
                        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, di) => {
                          const days = Array.isArray(c.days) ? c.days.map(Number) : [];
                          const on = days.includes(di);
                          return (
                            <button key={di} type="button"
                              onClick={() => updCoupon(i, { days: on ? days.filter((x) => x !== di) : [...days, di] })}
                              style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid var(--line)', cursor: 'pointer', fontSize: 'var(--fs-sm)', fontWeight: on ? 700 : 400, background: on ? 'var(--admin-accent-soft, #fbe7ee)' : 'transparent', color: on ? 'var(--admin-accent, #b5566e)' : 'inherit' }}>
                              {d}
                            </button>
                          );
                        })}
                        {Array.isArray(c.days) && c.days.length > 0 && <button className="link" style={{ fontSize: 'var(--fs-sm)', padding: 2 }} onClick={() => updCoupon(i, { days: [] })}>any day</button>}
                      </div>
                      <label style={{ ...row, cursor: 'pointer', fontSize: 'var(--fs-base)' }}>
                        <input type="checkbox" checked={!!c.firstVisitOnly} onChange={(e) => updCoupon(i, { firstVisitOnly: e.target.checked })} />
                        <span>First visit only</span>
                      </label>
                      <label style={{ ...row, cursor: 'pointer', fontSize: 'var(--fs-base)' }}>
                        <input type="checkbox" checked={!!c.birthdayOnly} onChange={(e) => updCoupon(i, { birthdayOnly: e.target.checked })} />
                        <span>Birthday treat</span>
                      </label>
                      {c.birthdayOnly && (
                        <label style={{ ...row, fontSize: 'var(--fs-base)' }} className="muted">
                          <span>± days</span>
                          <input inputMode="numeric" value={c.birthdayWindowDays ?? 0} onChange={(e) => updCoupon(i, { birthdayWindowDays: Math.max(0, Math.min(31, parseInt(e.target.value, 10) || 0)) })}
                            style={{ width: 48, padding: '6px 8px', border: '1px solid var(--line)', borderRadius: 10 }} />
                        </label>
                      )}
                    </div>
                    {(c.firstVisitOnly || c.birthdayOnly) && <p className="muted" style={{ fontSize: 'var(--fs-sm)', margin: '6px 0 0' }}>Needs the customer signed in{c.birthdayOnly ? ' with a birthday saved (they add it in their account)' : ''}.</p>}
                  </div>
                ))}
                <button className="btn ghost full" style={{ marginTop: 4 }} onClick={addCoupon}>+ Add coupon</button>
              </div>
            )}

            {/* ───────── CUSTOM TABLES (private phone-gated quick-pick tables) ───────── */}
            {tab === 'customtables' && (
              <>
                <div className="admin-page-head">
                  <h1 className="admin-page-title">Custom Tables</h1>
                  <p className="admin-page-desc">Private quick-pick tables for regulars. Each one shows in the app <strong>only</strong> for the customer whose mobile number you enter here — no one else sees it. Give a regular something custom (a named desk, a kerbside spot like “AUDI” so staff know to bring it to her car), and optionally auto-apply a coupon when they choose it.</p>
                </div>
                <div className="card" style={card}>
                  <div className="group-title">Custom tables</div>
                  <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 0 }}>Mobile number identifies the customer (they must be signed in with it). Label is what appears on the app button and on the kitchen ticket. Coupon is optional — type a code (e.g. <strong>COFFEEGUY77</strong> for a free order) to apply it automatically when they pick the table. Remember to press <strong>Save changes</strong>.</p>
                  {customTableList.length === 0 && <p className="muted" style={{ fontSize: 'var(--fs-base)' }}>No custom tables yet — add one below.</p>}
                  {customTableList.map((t, i) => (
                    <div key={i} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 12, marginBottom: 10 }}>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: '1 1 150px', minWidth: 0 }}>
                          <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Mobile number</span>
                          <input inputMode="tel" value={t.phone || ''} onChange={(e) => updCustomTable(i, { phone: e.target.value })} placeholder="0412 345 678"
                            style={{ padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 10 }} />
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: '1 1 150px', minWidth: 0 }}>
                          <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Table label</span>
                          <input value={t.label || ''} onChange={(e) => updCustomTable(i, { label: e.target.value.slice(0, 40) })} placeholder="e.g. AUDI"
                            style={{ padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 10, fontWeight: 700 }} />
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: '1 1 130px', minWidth: 0 }}>
                          <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Coupon (optional)</span>
                          <input value={t.coupon || ''} onChange={(e) => updCustomTable(i, { coupon: e.target.value.toUpperCase().replace(/\s+/g, '') })} placeholder="e.g. COFFEEGUY77"
                            style={{ padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 10, letterSpacing: 0.5 }} />
                        </label>
                        <button className="link" style={{ color: '#c0392b', alignSelf: 'flex-end', paddingBottom: 8 }} onClick={() => rmCustomTable(i)}>Remove</button>
                      </div>
                    </div>
                  ))}
                  <button className="btn ghost full" style={{ marginTop: 4 }} onClick={addCustomTable}>+ Add custom table</button>
                </div>
              </>
            )}

            {/* ───────── PUSH (broadcast SMS / email) ───────── */}
            {tab === 'seo' && (
              <>
                <div className="admin-page-head">
                  <h1 className="admin-page-title">SEO &amp; verification</h1>
                  <p className="admin-page-desc">Search-engine listing, site verification and analytics &mdash; injected into every page&rsquo;s &lt;head&gt; automatically, no redeploy needed.</p>
                </div>
                <div className="card" style={card}>
                  <div className="group-title">Sitemap</div>
                  <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 0 }}>Your live sitemap lists the homepage plus every menu category and product, so search engines can find each one. Submit this URL in Google Search Console (Sitemaps), and Regenerate after big menu changes.</p>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
                    <code style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', flex: 1, minWidth: 220, overflowX: 'auto' }}>{`${typeof window !== 'undefined' ? window.location.origin : ''}/sitemap.xml`}</code>
                    <button type="button" className="btn ghost" style={{ padding: '8px 12px' }} onClick={() => { try { navigator.clipboard.writeText(`${window.location.origin}/sitemap.xml`); setSitemapInfo('Copied to clipboard.'); } catch (e) { setSitemapInfo('Copy failed \u2014 select it manually.'); } }}>Copy</button>
                    <a className="btn ghost" style={{ padding: '8px 12px' }} href="/sitemap.xml" target="_blank" rel="noreferrer">Open</a>
                    <button type="button" className="btn" style={{ padding: '8px 12px' }} onClick={async () => { setSitemapInfo('Regenerating\u2026'); try { const r = await fetch(`/api/admin/seo/rebuild-sitemap?pass=${encodeURIComponent(pass)}`, { method: 'POST' }); const j = await r.json(); setSitemapInfo(j.ok ? `Regenerated \u2014 ${j.urls} URLs (${j.categories} categories, ${j.products} products).` : (j.error || 'Failed.')); } catch (e) { setSitemapInfo('Failed: ' + e.message); } }}>Regenerate</button>
                  </div>
                  {sitemapInfo && <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 8 }}>{sitemapInfo}</p>}
                </div>
                <div className="card" style={card}>
                  <div className="group-title">Google Search Console verification</div>
                  <label className="field" style={{ marginTop: 8 }}><span>Verification tag or code</span>
                    <input value={s.seo?.googleVerification || ''} onChange={(e) => set({ seo: { ...(s.seo || {}), googleVerification: e.target.value } })} placeholder={'<meta name="google-site-verification" content="…" />'} /></label>
                  <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 4 }}>In Search Console choose the &ldquo;HTML tag&rdquo; method and paste the whole tag here (or just the code). Save, then click Verify in Search Console.</p>
                </div>
                <div className="card" style={card}>
                  <div className="group-title">Google Analytics (GA4)</div>
                  <label className="field" style={{ marginTop: 8 }}><span>Measurement ID</span>
                    <input value={s.seo?.gaMeasurementId || ''} onChange={(e) => set({ seo: { ...(s.seo || {}), gaMeasurementId: e.target.value.trim() } })} placeholder="G-XXXXXXXXXX" /></label>
                </div>
                <div className="card" style={card}>
                  <div className="group-title">Listing &amp; social preview</div>
                  <label className="field" style={{ marginTop: 8 }}><span>Meta description (blank = uses your store bio)</span>
                    <textarea rows={2} value={s.seo?.metaDescription || ''} onChange={(e) => set({ seo: { ...(s.seo || {}), metaDescription: e.target.value.slice(0, 300) } })} placeholder="Freshly roasted coffee, order ahead & skip the queue." /></label>
                  <label className="field" style={{ marginTop: 10 }}><span>Social share image URL (blank = uses your store photo)</span>
                    <input value={s.seo?.ogImage || ''} onChange={(e) => set({ seo: { ...(s.seo || {}), ogImage: e.target.value.trim() } })} placeholder="https://…/share.jpg" /></label>
                </div>
                <div className="card" style={card}>
                  <div className="group-title">Custom head code (advanced)</div>
                  <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 0 }}>Pasted verbatim into every page&rsquo;s &lt;head&gt; &mdash; use for other verifications (Bing, Facebook, Pinterest) or tracking snippets. Only paste code you trust.</p>
                  <label className="field"><textarea rows={5} value={s.seo?.headHtml || ''} onChange={(e) => set({ seo: { ...(s.seo || {}), headHtml: e.target.value } })} placeholder={'<meta name="facebook-domain-verification" content="…" />'} style={{ fontFamily: 'monospace', fontSize: 12 }} /></label>
                </div>
              </>
            )}
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

                {/* Send yourself a test first so you can see exactly how it lands. */}
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, flexWrap: 'wrap', padding: '10px 0', margin: '2px 0 10px', borderTop: '1px solid var(--admin-border)', borderBottom: '1px solid var(--admin-border)' }}>
                  <label className="field" style={{ flex: '1 1 220px', margin: 0 }}><span>Send a test to yourself first</span>
                    <input value={pushTest} onChange={(e) => setPushTest(e.target.value)}
                      inputMode={push.channel === 'sms' ? 'tel' : 'email'}
                      placeholder={push.channel === 'sms' ? '+61 4XX XXX XXX' : 'you@example.com'} /></label>
                  <button className="btn ghost" disabled={pushTestBusy || !push.message.trim() || !pushTest.trim() || (notifyStatus && !notifyStatus[push.channel])}
                    onClick={sendTestBroadcast}>{pushTestBusy ? 'Sending test…' : `Send test ${push.channel === 'sms' ? 'SMS' : 'email'}`}</button>
                </div>
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
            {tab === 'tables' && (() => {
              const qLocs = Array.isArray(s?.locations) ? s.locations : [];
              const venue = qLocs.find((l) => l.id === qrVenue) || null;
              const booths = (venue && venue.booths) || {};
              const boothMode = booths.mode || 'numbered';
              const boothWord = booths.word != null ? booths.word : 'Table';
              const setBooths = (patch) => { if (venue) updLoc(venue.id, { booths: { ...(venue.booths || {}), ...patch } }); };
              const boothOn = !!(venue && booths.enabled);
              const preview = boothOn ? boothEntries(booths) : [];
              return (
              <div className="card" style={card}>
                <div className="group-title">Table &amp; booth QR codes</div>
                <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 0 }}>
                  Generate a QR for each table or event booth. Scanning it opens the app <strong>at that venue</strong> with
                  the table / booth locked in. For an event, this is the only way in (the store is hidden from the picker),
                  so the booth QR decides the venue, the menu, and what the guest sees.
                </p>

                {qLocs.length > 0 && (
                  <label className="field" style={{ maxWidth: 320 }}><span>Which venue are these codes for?</span>
                    <select value={qrVenue} onChange={(e) => setQrVenue(e.target.value)}>
                      <option value="">Main site (no specific venue)</option>
                      {qLocs.map((l) => <option key={l.id} value={l.id}>{l.name || l.id}{l.type === 'event' ? ' · event' : ''}</option>)}
                    </select>
                  </label>
                )}

                {venue ? (
                  <div className="avail-sched" style={{ margin: '10px 0' }}>
                    <label className="switch"><input type="checkbox" checked={boothOn} onChange={(e) => setBooths({ enabled: e.target.checked, mode: booths.mode || 'numbered' })} /> <span>Custom booths / labels for {venue.name || 'this venue'}</span></label>
                    {boothOn && (
                      <>
                        <label className="field" style={{ marginTop: 10, maxWidth: 320 }}><span>Style</span>
                          <select value={boothMode} onChange={(e) => setBooths({ mode: e.target.value })}>
                            <option value="numbered">Numbered (Booth 1, Booth 2 …)</option>
                            <option value="label">Named list (Microsoft Booth, Reception …)</option>
                            <option value="both">Numbered + named (Booth 1 · Microsoft)</option>
                          </select>
                        </label>
                        {(boothMode === 'numbered' || boothMode === 'both') && (
                          <label className="field" style={{ marginTop: 10, maxWidth: 220 }}><span>Word (instead of “Table”)</span>
                            <input value={boothWord} placeholder="Booth" onChange={(e) => setBooths({ word: e.target.value })} /></label>
                        )}
                        {boothMode === 'numbered' && (
                          <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                            <label className="field" style={{ flex: '1 1 90px', minWidth: 80 }}><span>From</span>
                              <input type="number" min="1" value={booths.from != null ? booths.from : 1} onChange={(e) => setBooths({ from: e.target.value })} /></label>
                            <label className="field" style={{ flex: '1 1 90px', minWidth: 80 }}><span>To</span>
                              <input type="number" min="1" value={booths.to != null ? booths.to : 12} onChange={(e) => setBooths({ to: e.target.value })} /></label>
                          </div>
                        )}
                        {(boothMode === 'label' || boothMode === 'both') && (
                          <label className="field" style={{ marginTop: 10 }}><span>Booth names — one per line (paste your list)</span>
                            <textarea rows={5} value={booths.labels || ''} placeholder={'Microsoft Booth\nGoogle Booth\nReception\nMain Stage'} onChange={(e) => setBooths({ labels: e.target.value })} style={{ padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 10, font: 'inherit', resize: 'vertical' }} /></label>
                        )}
                        <p className="muted" style={{ fontSize: 'var(--fs-xs)', margin: '8px 0 0' }}>
                          {preview.length
                            ? <>Will make <strong>{preview.length}</strong> code{preview.length === 1 ? '' : 's'}: {preview.slice(0, 4).map((e) => e.label).join(', ')}{preview.length > 4 ? '…' : ''}. Booth config saves with <strong>Save changes</strong>.</>
                            : 'Add a range or some names above.'}
                        </p>
                      </>
                    )}
                    <div style={{ marginTop: 12 }}>
                      <button className="btn" style={{ minWidth: 120 }} disabled={qrBusy} onClick={generateQR}>{qrBusy ? 'Generating…' : 'Generate QR codes'}</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 10 }}>
                    <label className="field" style={{ flex: '1 1 90px', minWidth: 80 }}><span>From table</span>
                      <input type="number" min="1" value={qrFrom} onChange={(e) => setQrFrom(e.target.value)} /></label>
                    <label className="field" style={{ flex: '1 1 90px', minWidth: 80 }}><span>To table</span>
                      <input type="number" min="1" value={qrTo} onChange={(e) => setQrTo(e.target.value)} /></label>
                    <button className="btn" style={{ minWidth: 120 }} disabled={qrBusy} onClick={generateQR}>
                      {qrBusy ? 'Generating…' : 'Generate'}
                    </button>
                  </div>
                )}
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
                      <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{qrCodes.length} code{qrCodes.length === 1 ? '' : 's'} · links to {origin || 'this site'}</span>
                      <button className="link" onClick={() => window.print()}>🖨 Print cards</button>
                    </div>
                    <div className="qr-print" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${Math.min(qrSize + 48, 300)}px, 1fr))` }}>
                      {qrCodes.map((q) => (
                        <div key={q.n} className="qr-card">
                          <div className="qr-card-brand">{(s && s.storeName) || 'Bean Culture'}</div>
                          <div className="qr-card-scan">Scan to order</div>
                          <img src={q.img} alt={`${q.label} QR code`} style={{ width: qrSize, maxWidth: '100%' }} />
                          <div className="qr-card-table">{q.label || `Table ${q.n}`}</div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
              );
            })()}

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
                            const ec = t.effectsConfig || { effectsEnabled: legacyOn, effectPreset: t.id, intensity: 'standard', effectId: null };
                            const setEc = (patch) => updSeasonal(i, { effectsConfig: { ...ec, ...patch } });
                            const effectsList = (s.effects && s.effects.presets) || [];
                            return (
                              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8, alignItems: 'center', fontSize: 'var(--fs-sm)' }} className="muted">
                                <label style={{ ...row }}><input type="checkbox" checked={ec.effectsEnabled !== false} onChange={(e) => setEc({ effectsEnabled: e.target.checked })} /> Animated effect</label>
                                <label style={{ ...row }}>Effect
                                  <select value={ec.effectId || ''} onChange={(e) => setEc({ effectId: e.target.value || null })} style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid var(--line)', marginLeft: 6 }}>
                                    <option value="">— none —</option>
                                    {effectsList.map((eff) => <option key={eff.id} value={eff.id}>{eff.name}</option>)}
                                  </select>
                                </label>
                                <label style={{ ...row }}>Intensity
                                  <select value={ec.intensity || 'standard'} onChange={(e) => setEc({ intensity: e.target.value })} style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid var(--line)', marginLeft: 6 }}>
                                    <option value="subtle">Subtle</option>
                                    <option value="standard">Standard</option>
                                    <option value="celebratory">Celebratory</option>
                                  </select>
                                </label>
                                <span style={{ fontSize: 'var(--fs-xs)' }}>Shows only during the event dates</span>
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
                                {LINK_TYPES.map((lt) => <option key={lt} value={lt}>{LINK_TYPE_LABELS[lt] || lt}</option>)}
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

                <EffectBuilder
                  effects={(s.effects && s.effects.presets) || []}
                  seasonalThemes={seasonalThemes}
                  onChange={(presets) => set({ effects: { version: (s.effects && s.effects.version) || 1, presets } })}
                />
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
