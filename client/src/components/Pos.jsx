import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, formatMoney, imgUrl, comboDiscountFor } from '../api.js';
import { useItemConfig, itemIsQuickAdd, buildQuickCartItem } from '../hooks/useItemConfig.js';
import Kds from './Kds.jsx';
import ComboModal from './ComboModal.jsx';
import Logo from './Logo.jsx';

// Kiosk POS + adaptive KDS (/pos). One authenticated staff screen that is a fast
// counter register while a sale is being built and the live KDS the rest of the
// time. It REUSES the customer catalogue, the shared item-configuration logic
// (useItemConfig — identical valid choices/pricing to the app) and the existing
// KDS, so there is no second catalogue and no drift. Orders flow into Square via
// the same order path and appear on the KDS automatically.

const CART_KEY = 'bc-pos-cart';
const THEME_KEY = 'bc-pos-theme';
const IDLE_KEY = 'bc-pos-kds-idle';
// Header colour per theme — also used to paint the mobile status bar (theme-color
// meta) so it matches the POS instead of inheriting the storefront's colour.
const POS_HEADER_HEX = { plum: '#3d0e20', rose: '#7a1f45', ocean: '#12395e', forest: '#14432b', mocha: '#3a2519', slate: '#23292f' };
// Selectable POS colour schemes. Each id maps to a .pos-root[data-theme] block in
// styles.css; the swatch preview shows the header → accent gradient for that theme.
const POS_THEMES = [
  { id: 'plum', name: 'Plum' },
  { id: 'rose', name: 'Pink' },
  { id: 'ocean', name: 'Blue' },
  { id: 'forest', name: 'Green' },
  { id: 'mocha', name: 'Mocha' },
  { id: 'slate', name: 'Slate' },
];
const cartTotal = (cart) => cart.reduce((s, c) => s + c.unitPrice * c.quantity, 0);
const cartCount = (cart) => cart.reduce((s, c) => s + c.quantity, 0);

// Stroke-only icons (inherit colour via currentColor, fill/centre their button).
const Ico = ({ children, size = 22 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{children}</svg>
);
const IcoGear = () => <Ico><circle cx="12" cy="12" r="3.2" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></Ico>;
const IcoX = () => <Ico><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></Ico>;
const IcoGrid = () => <Ico><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></Ico>;
const IcoBell = () => <Ico><path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></Ico>;
const IcoBellOff = () => <Ico><path d="M18.6 14A18 18 0 0 1 18 8" /><path d="M6 8a6 6 0 0 1 9.3-5" /><path d="M6 8c0 7-3 8-3 8h13" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /><line x1="3" y1="3" x2="21" y2="21" /></Ico>;
const IcoRefresh = () => <Ico><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></Ico>;

// Cafe timezone — Canberra (same offset as Australia/Sydney). All POS order
// timestamps are shown in this zone so the till reads local time regardless of
// the tablet's own clock/region.
// One shared AudioContext, resumed on demand. Browsers start it "suspended"
// until a user gesture, which is why new-order chimes often stayed silent —
// resuming it (and unlocking on first interaction) makes the bell reliable.
let _audioCtx = null;
function audioCtx() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!_audioCtx) _audioCtx = new AC();
    if (_audioCtx.state === 'suspended') _audioCtx.resume().catch(() => {});
    return _audioCtx;
  } catch { return null; }
}
const CAFE_TZ = 'Australia/Sydney';
const fmtDateTime = (iso) => { try { return new Date(iso).toLocaleString('en-AU', { timeZone: CAFE_TZ, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); } catch { return ''; } };
const fmtTime = (iso) => { try { return new Date(iso).toLocaleTimeString('en-AU', { timeZone: CAFE_TZ, hour: 'numeric', minute: '2-digit' }); } catch { return ''; } };

// ── The configure workspace: the product grid is replaced by this while an item
// is being built. Uses the shared hook so it matches the customer app exactly. ──
function ConfigWorkspace({ item, currency, initial, onCancel, onCommit }) {
  const {
    variationId, setVariationId, variation,
    selected, toggleModifier, unmetGroups, canAdd, unitPrice,
    qty, setQty, note, setNote, buildCartItem,
  } = useItemConfig(item, initial);
  const [showNote, setShowNote] = useState(!!(initial && initial.note));

  const groups = item.modifierGroups || [];

  return (
    <div className="pos-cfg">
      <div className="pos-cfg-head">
        <div>
          <div className="pos-cfg-name">{item.name}</div>
          <div className="pos-cfg-base">{item.category || ''}{item.category ? ' · ' : ''}from {formatMoney(Math.min(...item.variations.map((v) => v.price ?? Infinity)), currency)}</div>
        </div>
      </div>

      <div className="pos-cfg-body">
        {item.variations.length > 1 && (
          <section id="pcg-sz" className="pos-grp">
            <div className="pos-grp-head"><span className="pos-grp-name">Size</span><span className="pos-grp-req">Required</span></div>
            <div className="pos-opt-grid">
              {item.variations.map((v) => (
                <button type="button" key={v.id} disabled={v.soldOut}
                  className={`pos-opt${variationId === v.id ? ' on' : ''}${v.soldOut ? ' sold' : ''}`}
                  onClick={() => setVariationId(v.id)}>
                  <span className="pos-opt-name">{v.name || item.name}{v.soldOut ? ' — Sold out' : ''}</span>
                  <span className="pos-opt-price">{formatMoney(v.price, currency)}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {groups.map((group) => {
          const req = (group.min || 0) > 0;
          const have = (selected[group.id]?.size) || 0;
          const unmet = req && have < group.min;
          const hint = (group.selectionType === 'SINGLE' || group.max === 1) ? 'Choose one'
            : group.max > 0 ? `Up to ${group.max}` : '';
          return (
            <section id={`pcg-${group.id}`} key={group.id} className={`pos-grp${unmet ? ' unmet' : ''}`}>
              <div className="pos-grp-head">
                <span className="pos-grp-name">{group.name}</span>
                {req ? <span className="pos-grp-req">Required</span> : hint && <span className="pos-grp-hint">{hint}</span>}
              </div>
              <div className="pos-opt-grid">
                {group.modifiers.map((mod) => {
                  const on = (selected[group.id] || new Set()).has(mod.id);
                  return (
                    <button type="button" key={mod.id} className={`pos-opt${on ? ' on' : ''}`}
                      onClick={() => toggleModifier(group, mod)}>
                      <span className="pos-opt-name">{mod.name}</span>
                      {mod.price > 0 && <span className="pos-opt-price">+{formatMoney(mod.price, currency)}</span>}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}

        <section className="pos-grp">
          {showNote ? (
            <>
              <div className="pos-grp-head"><span className="pos-grp-name">Kitchen note</span></div>
              <textarea className="pos-note" rows={2} autoFocus value={note}
                onChange={(e) => setNote(e.target.value)} placeholder="e.g. allergy, extra hot…" />
            </>
          ) : (
            <button type="button" className="pos-note-add" onClick={() => setShowNote(true)}>+ Add kitchen note</button>
          )}
        </section>
      </div>

      <div className="pos-cfg-foot">
        <div className="pos-qty">
          <button onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Decrease">−</button>
          <span>{qty}</span>
          <button onClick={() => setQty((q) => q + 1)} aria-label="Increase">+</button>
        </div>
        <button className="pos-btn ghost" onClick={onCancel}>Cancel</button>
        <button className="pos-btn primary big" disabled={!canAdd} onClick={() => onCommit(buildCartItem())}>
          {canAdd ? `${initial ? 'Update' : 'Add to order'} · ${formatMoney(unitPrice * qty, currency)}`
            : `Choose ${unmetGroups.map((g) => g.name).join(', ')}`}
        </button>
      </div>
    </div>
  );
}

export default function Pos({ onExit }) {
  const [pass, setPass] = useState(() => { try { return atob(localStorage.getItem('bc-admin-pass') || '') || ''; } catch { return ''; } });
  const [passInput, setPassInput] = useState('');
  const [needPass, setNeedPass] = useState(false);
  const [cfg, setCfg] = useState(null);            // { deviceName, mode, autoReturnSec, staff }
  const [menu, setMenu] = useState(null);
  const [currency, setCurrency] = useState('AUD');
  const [err, setErr] = useState('');

  const [mode, setMode] = useState('register');    // register | kitchen
  const [activeCat, setActiveCat] = useState(null);
  const [configuring, setConfiguring] = useState(null); // { item, initial? }
  const [combo, setCombo] = useState(null);             // a combo item being built (uses ComboModal)
  const [query, setQuery] = useState('');

  const [cart, setCart] = useState(() => { try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]') || []; } catch { return []; } });
  const [dineIn, setDineIn] = useState(false);
  const [orderName, setOrderName] = useState('');
  const [table, setTable] = useState('');

  const [tender, setTender] = useState(null);      // null | 'choose' | 'cash'
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(null);    // { orderId, tender, change }
  const [cardPay, setCardPay] = useState(() => { try { return JSON.parse(localStorage.getItem('bc-pos-active-checkout') || 'null'); } catch { return null; } });
  const [showSetup, setShowSetup] = useState(false);    // card-terminal pairing modal
  const [showSettings, setShowSettings] = useState(false); // the ⚙ settings sheet
  const [kdsControls, setKdsControls] = useState(null);    // controls surfaced by the embedded KDS
  const [posLoc, setPosLoc] = useState(() => { try { return localStorage.getItem('bc-pos-location') || ''; } catch { return ''; } });
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem(THEME_KEY) || 'plum'; } catch { return 'plum'; } });
  // Idle-return timer (per device): seconds of no interaction on the register
  // before a combined POS+KDS screen flips back to the kitchen — but only when
  // there are orders waiting, and never mid-order. 0 = never. Seeded from the
  // server default the first time, then remembered on this device.
  const [kdsIdleSec, setKdsIdleSec] = useState(() => { try { const v = localStorage.getItem(IDLE_KEY); return v == null ? null : Number(v); } catch { return null; } });
  const lastActivityRef = useRef(Date.now());
  const seenAppRef = useRef(new Set());   // app-order ids already seen (no re-chime)
  const firstPollRef = useRef(true);      // don't chime for orders already on screen at open
  const modeRef = useRef('register');
  const busyRef = useRef(false);
  const [cartOpen, setCartOpen] = useState(false); // mobile slide-over cart
  const returnTimer = useRef(null);

  const deviceMode = cfg?.mode || 'pos_kds';        // pos_kds | pos | kds

  async function boot(p) {
    try {
      const c = await api.posConfig(p);
      // Bind this device to a store (first one by default) when multi-location.
      const locs = c.locations || [];
      let loc = posLoc;
      if (locs.length && !locs.some((l) => l.id === loc)) { loc = locs[0].id; setPosLoc(loc); try { localStorage.setItem('bc-pos-location', loc); } catch {} }
      const m = await api.getMenu(loc, true);
      setCfg(c); setMenu(m); setCurrency(m.currency || 'AUD'); setNeedPass(false);
      try { localStorage.setItem('bc-admin-pass', btoa(p)); } catch {}
      const cats = (m.categories || []);
      setActiveCat((prev) => prev || (cats[0] && cats[0].category) || null);
      // Start on the register (KDS-only devices excepted). The screen only moves
      // to the KDS on its own when the register goes idle with orders waiting, or
      // the moment a new app order arrives — never just because it's quiet.
      setMode((c.mode === 'kds') ? 'kitchen' : 'register');
      return true;
    } catch (e) {
      if (/unauthor/i.test(e.message)) { setNeedPass(true); return false; }
      setErr(e.message); return false;
    }
  }

  async function switchStore(id) {
    setPosLoc(id);
    try { localStorage.setItem('bc-pos-location', id); } catch {}
    try {
      const m = await api.getMenu(id, true);
      setMenu(m); setActiveCat((m.categories || [])[0]?.category || null); setConfiguring(null); setQuery('');
    } catch (e) { setErr(e.message); }
    clearCart(); // a different store may not offer the current items
  }

  useEffect(() => {
    if (!pass) { setNeedPass(true); return; }
    boot(pass);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch {} }, [cart]);
  useEffect(() => { try { localStorage.setItem(THEME_KEY, theme); } catch {} }, [theme]);
  useEffect(() => { try { if (kdsIdleSec != null) localStorage.setItem(IDLE_KEY, String(kdsIdleSec)); } catch {} }, [kdsIdleSec]);

  // Paint the mobile status bar (theme-color meta) to match the POS theme, and
  // restore whatever it was (the storefront colour) when the POS closes — this
  // is what stops the leftover green bar behind the phone clock.
  const origThemeColorRef = useRef(null);
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) return;
    if (origThemeColorRef.current === null) origThemeColorRef.current = meta.getAttribute('content') || '';
    meta.setAttribute('content', POS_HEADER_HEX[theme] || POS_HEADER_HEX.plum);
  }, [theme]);
  useEffect(() => () => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && origThemeColorRef.current !== null) meta.setAttribute('content', origThemeColorRef.current);
  }, []);

  // Any interaction anywhere on the POS resets the idle clock.
  useEffect(() => {
    const bump = () => { lastActivityRef.current = Date.now(); audioCtx(); /* unlock audio on first gesture */ };
    const evs = ['pointerdown', 'keydown', 'touchstart', 'wheel'];
    evs.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    return () => evs.forEach((e) => window.removeEventListener(e, bump));
  }, []);

  // Keep refs current so the single poll below always sees live values without
  // being torn down and recreated (which would re-seed the "seen orders" set).
  modeRef.current = mode;
  busyRef.current = !!(cart.length || configuring || combo || tender || cardPay || success || showSettings || showSetup);

  // Short double chime so staff hear a new app order across the counter.
  function posChime() {
    try {
      const ac = audioCtx(); if (!ac) return;
      [0, 0.18].forEach((t0, i) => {
        const o = ac.createOscillator(); const g = ac.createGain();
        o.connect(g); g.connect(ac.destination);
        o.type = 'sine'; o.frequency.value = i ? 1174 : 880;
        const t = ac.currentTime + t0;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
        o.start(t); o.stop(t + 0.18);
      });
    } catch {}
  }

  // The one combined watcher for a POS+KDS device. Polls the board and does two
  // things: (1) the moment a NEW app order lands it chimes and — unless the till
  // is mid-order — opens the KDS so staff see it; (2) when the register has sat
  // idle past the timer AND orders are waiting, it flips to the KDS. Never when
  // an order is being built or paid. seenAppRef persists across renders so a
  // given order only ever chimes once.
  useEffect(() => {
    if ((cfg?.mode || 'pos_kds') !== 'pos_kds') return;
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch(`/api/admin/kds/tickets?pass=${encodeURIComponent(pass)}${posLoc ? `&location=${encodeURIComponent(posLoc)}` : ''}`);
        if (!alive || !r.ok) return;
        const d = await r.json();
        const tickets = d.tickets || [];
        const waiting = tickets.filter((t) => Object.values(t.zoneStatus || {}).some((s) => s && s !== 'done'));
        const appWaiting = waiting.filter((t) => t.appOrigin);
        const fresh = appWaiting.filter((t) => !seenAppRef.current.has(t.orderId));
        appWaiting.forEach((t) => seenAppRef.current.add(t.orderId));
        if (!firstPollRef.current && fresh.length && modeRef.current !== 'kitchen') {
          posChime();
          if (!busyRef.current) { setConfiguring(null); setMode('kitchen'); }
        }
        firstPollRef.current = false;
        const secs = kdsIdleSec != null ? kdsIdleSec : (cfg && Number(cfg.kdsIdleSec));
        if (secs > 0 && modeRef.current === 'register' && !busyRef.current
          && Date.now() - lastActivityRef.current >= secs * 1000 && waiting.length) {
          setConfiguring(null); setMode('kitchen');
        }
      } catch {}
    };
    poll();
    const iv = setInterval(poll, 6000);
    return () => { alive = false; clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, kdsIdleSec, pass, posLoc]);

  // Keep the order type valid for the selected store's Order-types setting
  // (admin/stores). A takeaway-only store (e.g. Tulip Farm) can never sit on a
  // stale "Eat in"; a dine-in-only store forces Eat in. Mirrors the customer app.
  useEffect(() => {
    const f = (((cfg && cfg.locations) || []).find((l) => l.id === posLoc) || {}).fulfilment;
    if (!f) return;
    if (dineIn && !f.dineIn) setDineIn(false);
    else if (!dineIn && !f.takeaway && f.dineIn) setDineIn(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, posLoc]);
  useEffect(() => () => { if (returnTimer.current) clearTimeout(returnTimer.current); }, []);

  // ── Cart operations (dedupe by key; decrement-to-zero removes) ──
  function addLine(entry) {
    setCart((prev) => {
      const i = prev.findIndex((c) => c.key === entry.key);
      if (i >= 0) { const next = [...prev]; next[i] = { ...next[i], quantity: next[i].quantity + entry.quantity }; return next; }
      return [...prev, entry];
    });
  }
  function replaceLine(oldKey, entry) {
    setCart((prev) => {
      const rest = prev.filter((c) => c.key !== oldKey && c.key !== entry.key);
      const dup = prev.find((c) => c.key === entry.key && c.key !== oldKey);
      return [...rest, dup ? { ...entry, quantity: entry.quantity + dup.quantity } : entry];
    });
  }
  function bumpQty(key, delta) {
    setCart((prev) => prev.map((c) => (c.key === key ? { ...c, quantity: c.quantity + delta } : c)).filter((c) => c.quantity > 0));
  }
  function removeLine(key) { setCart((prev) => prev.filter((c) => c.key !== key)); }
  function clearCart() { setCart([]); setOrderName(''); setTable(''); setDineIn(false); }

  function pickProduct(item, catName) {
    const withCat = { ...item, category: item.category || catName };
    if (withCat.isCombo) { setCombo(withCat); return; }         // combos use ComboModal
    if (itemIsQuickAdd(withCat)) { addLine(buildQuickCartItem(withCat)); return; }
    setConfiguring({ item: withCat });
  }
  function editLine(line) {
    // Find the source menu item to re-open the same configure component.
    let found = null;
    for (const c of (menu.categories || [])) {
      const it = (c.items || []).find((x) => (x.presetSourceItemId || x.id) === line.itemId || x.id === line.itemId);
      if (it) { found = { ...it, category: it.category || c.category }; break; }
    }
    if (!found) return;
    setConfiguring({ item: found, initial: { variationId: line.variationId, modifierIds: line.modifierIds, note: line.note, quantity: line.quantity }, editKey: line.key });
  }

  // ── Combos: several linked lines sharing a comboInstanceId, adjusted/removed
  //    as one unit; the discount is re-derived + applied server-side from the
  //    comboId/comboInstanceId/comboGroupId tags we send. ──
  function addCombo(entries) { setCart((prev) => [...prev, ...entries]); setCombo(null); }
  function bumpCombo(instanceId, delta) {
    setCart((prev) => {
      const next = prev.map((c) => (c.comboInstanceId === instanceId ? { ...c, quantity: Math.max(0, c.quantity + delta) } : c));
      return next.some((c) => c.comboInstanceId === instanceId && c.quantity > 0) ? next.filter((c) => c.quantity > 0) : next.filter((c) => c.comboInstanceId !== instanceId);
    });
  }
  function removeCombo(instanceId) { setCart((prev) => prev.filter((c) => c.comboInstanceId !== instanceId)); }
  function editCombo(instanceId) {
    const line = cart.find((c) => c.comboInstanceId === instanceId);
    if (!line) return;
    const comboItem = (menu.categories || []).flatMap((c) => (c.items || [])).find((i) => i.isCombo && i.comboId === line.comboId);
    removeCombo(instanceId);
    if (comboItem) setCombo(comboItem);
  }

  // Group the flat cart into display rows: single items + one card per combo.
  function groupCart(list) {
    const out = []; const seen = new Map();
    for (const c of list) {
      if (c.comboInstanceId) {
        let g = seen.get(c.comboInstanceId);
        if (!g) { g = { type: 'combo', instanceId: c.comboInstanceId, name: c.comboName || 'Combo', quantity: c.quantity, discount: c.comboDiscount || 0, lines: [] }; seen.set(c.comboInstanceId, g); out.push(g); }
        g.lines.push(c);
      } else out.push({ type: 'item', line: c });
    }
    return out;
  }

  function finishSuccess(shortId, orderId, tenderType, change) {
    setSuccess({ orderId, shortId, tender: tenderType, change });
    setCartOpen(false);
    clearCart();
    // After a sale, clear the receipt and stay on the register — ready for the
    // next customer. Moving to the KDS is left to the idle timer / app-order
    // watcher, so a busy counter isn't bounced to the kitchen between sales.
    const delay = Math.max(1500, (cfg?.autoReturnSec || 3) * 1000);
    returnTimer.current = setTimeout(() => { setSuccess(null); lastActivityRef.current = Date.now(); }, delay);
  }

  async function submit(tenderType, cashGiven, reason) {
    if (!cart.length || busy) return;
    setBusy(true); setErr('');
    try {
      const amount = cartTotal(cart) - comboDiscountFor(cart);
      const payload = {
        cart: cart.map((c) => ({
          variationId: c.variationId, quantity: c.quantity, modifierIds: c.modifierIds, note: c.note, presetId: c.presetId,
          // Combo tags — the server re-derives + applies the combo discount from these.
          ...(c.comboInstanceId ? { comboId: c.comboId, comboInstanceId: c.comboInstanceId, comboGroupId: c.comboGroupId, comboItemId: c.comboItemId || c.itemId } : {}),
        })),
        dineIn, table: dineIn ? table : '', name: orderName.trim(),
        locationId: posLoc || undefined,
        tender: tenderType,
        cashGiven: tenderType === 'cash' ? cashGiven : undefined,
        reason: tenderType === 'unpaid' ? (reason || '').trim() : undefined,
      };
      const res = await api.posOrder(pass, payload);
      setTender(null);
      if (tenderType === 'card') {
        // Card runs on the Terminal: hand off to the waiting overlay, which
        // watches the checkout to completion. Persist so a reload can resume.
        const cp = { checkoutId: res.checkoutId, orderId: res.orderId, terminalName: res.terminalName || 'Terminal', amount, status: 'waiting' };
        setCardPay(cp);
        try { localStorage.setItem('bc-pos-active-checkout', JSON.stringify(cp)); } catch {}
      } else {
        const change = tenderType === 'cash' ? Math.max(0, (cashGiven || 0) - amount) : 0;
        finishSuccess((res.orderId || '').slice(-4).toUpperCase(), res.orderId, tenderType, change);
      }
    } catch (e) {
      setErr(e.message);
    } finally { setBusy(false); }
  }

  function clearActiveCheckout() { try { localStorage.removeItem('bc-pos-active-checkout'); } catch {} }

  async function cancelCard() {
    if (!cardPay) return;
    setCardPay((c) => c && { ...c, status: 'canceling' });
    try { await api.posCheckoutCancel(pass, cardPay.checkoutId, cardPay.orderId); } catch {}
    clearActiveCheckout();
    setCardPay((c) => c && { ...c, status: 'canceled' });
  }

  // Watch an in-progress card checkout to a terminal state (webhook + poll on
  // the server; the browser only reads authoritative status, never decides it).
  useEffect(() => {
    if (!cardPay || cardPay.status !== 'waiting') return;
    let alive = true;
    const check = async () => {
      try {
        const s = await api.posCheckoutStatus(pass, cardPay.checkoutId, cardPay.orderId);
        if (!alive) return;
        if (s.status === 'paid') {
          clearActiveCheckout(); setCardPay(null);
          finishSuccess((cardPay.orderId || '').slice(-4).toUpperCase(), cardPay.orderId, 'card', 0);
        } else if (s.status === 'canceled') {
          clearActiveCheckout(); setCardPay((c) => c && { ...c, status: 'canceled' });
        }
      } catch {}
    };
    const iv = setInterval(check, 2500);
    check();
    return () => { alive = false; clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardPay && cardPay.checkoutId, cardPay && cardPay.status]);

  // ── Passcode gate ──
  if (needPass) {
    return (
      <div className="pos-root pos-login" data-theme={theme}>
        <div className="pos-login-card">
          <div className="pos-login-title">Bean Culture POS</div>
          <p>Enter the staff passcode.</p>
          <input type="password" value={passInput} autoFocus
            onChange={(e) => setPassInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { setPass(passInput); boot(passInput); } }}
            placeholder="Passcode" />
          <button className="pos-btn primary big" onClick={() => { setPass(passInput); boot(passInput); }}>Open</button>
          <button className="pos-link" onClick={onExit}>← Back to store</button>
        </div>
      </div>
    );
  }
  if (!cfg || !menu) return <div className="pos-root pos-center" data-theme={theme}><div className="pos-spinner" /></div>;

  const cats = menu.categories || [];
  // The selected store's offered order types (admin/stores). Drives whether the
  // POS shows the Takeaway/Eat-in choice or locks to one.
  const storeFulfil = (((cfg.locations || []).find((l) => l.id === posLoc) || {}).fulfilment) || { dineIn: true, takeaway: true, reservations: true };
  const bothServices = storeFulfil.dineIn && storeFulfil.takeaway;
  // Which payment methods this store offers (Settings → Payment methods).
  const payMethods = (() => {
    const m = (cfg.paymentsByLocation || {})[posLoc];
    return { card: !m || m.card !== false, cash: !m || m.cash !== false, unpaid: !m || m.unpaid !== false };
  })();
  const q = query.trim().toLowerCase();
  const activeItems = q
    ? cats.flatMap((c) => (c.items || []).map((it) => ({ ...it, category: c.category })))
        .filter((it) => it.name.toLowerCase().includes(q))
    : ((cats.find((c) => c.category === activeCat) || cats[0] || {}).items || [])
        .map((it) => ({ ...it, category: activeCat || (cats[0] && cats[0].category) }));

  const comboSaving = comboDiscountFor(cart);
  const total = cartTotal(cart) - comboSaving;
  const configureMode = mode === 'register' && configuring;
  // The card reader for THIS store (per-location, else the default reader).
  const curTerm = (cfg.terminalByLocation && cfg.terminalByLocation[posLoc]) || { deviceId: cfg.terminalDeviceId, name: cfg.terminalName };

  const activeStore = (cfg.locations || []).find((l) => l.id === posLoc);
  const multiStore = (cfg.locations || []).length > 1;

  // One task bar for the whole screen: brand · Register/KDS · Settings. The store
  // picker, card terminal and exit all live behind the ⚙ settings sheet so there
  // is a single location selector that drives both the register and the KDS.
  const header = (
    <header className="pos-header">
      {cfg.logoUrl
        ? <img className="pos-logo" src={imgUrl(cfg.logoUrl, 240)} alt={cfg.storeName || 'Bean Culture'} />
        : <span className="pos-logo-mark"><Logo height={30} /></span>}
      <div className="pos-modeswitch">
        <button className={`pos-seg${mode === 'register' ? ' on' : ''}`}
          disabled={deviceMode === 'kds'}
          onClick={() => { setConfiguring(null); setMode('register'); }}>
          Register{cart.length ? <span className="pos-seg-badge">{cartCount(cart)}</span> : null}
        </button>
        <button className={`pos-seg${mode === 'kitchen' ? ' on' : ''}`}
          disabled={deviceMode === 'pos'}
          onClick={() => { setConfiguring(null); setMode('kitchen'); }}>KDS</button>
      </div>
      <div className="pos-header-right">
        {mode === 'kitchen' && kdsControls && (
          <div className="pos-kdsctl">
            <span className={`kds-live${kdsControls.live ? ' on' : ''}`}>{kdsControls.live ? '● Live' : '○ Polling'}</span>
            <button className="pos-kds-bumpall" disabled={!kdsControls.activeCount} onClick={kdsControls.bumpAll}>
              Bump all{kdsControls.activeCount ? ` (${kdsControls.activeCount})` : ''}
            </button>
            <button className={`pos-icon${kdsControls.showLayout ? ' on' : ''}`} title="Layout" onClick={kdsControls.toggleLayout}><IcoGrid /></button>
            <button className="pos-icon" title={kdsControls.soundOn ? 'Mute new-order sound' : 'Unmute'} onClick={kdsControls.toggleMute}>{kdsControls.soundOn ? <IcoBell /> : <IcoBellOff />}</button>
            <button className="pos-icon" title="Refresh" onClick={kdsControls.refresh}><IcoRefresh /></button>
          </div>
        )}
        <button className="pos-icon" title="Settings" onClick={() => setShowSettings(true)}><IcoGear /></button>
      </div>
    </header>
  );

  // ── KDS mode: the live kitchen screen, hosted under the persistent POS header.
  //    No second bar and no second store selector — the KDS follows the store
  //    chosen in Settings, and "New order" is just the Register tab above. ──
  if (mode === 'kitchen') {
    return (
      <div className="pos-root" data-theme={theme}>
        {header}
        <div className="pos-kds-host"><Kds embedded location={posLoc} onControls={setKdsControls} onExit={() => setMode('register')} /></div>
        {showSettings && (
          <SettingsSheet
            cfg={cfg} posLoc={posLoc} multiStore={multiStore} curTerm={curTerm}
            theme={theme} onTheme={setTheme}
            idleSec={kdsIdleSec != null ? kdsIdleSec : (cfg && cfg.kdsIdleSec != null ? cfg.kdsIdleSec : 60)} onIdle={setKdsIdleSec}
            pass={pass}
            onPayments={(loc, next) => setCfg((c) => ({ ...c, paymentsByLocation: { ...(c.paymentsByLocation || {}), [loc]: next } }))}
            onSwitchStore={switchStore} onOpenTerminal={() => { setShowSettings(false); setShowSetup(true); }}
            onExit={onExit} onClose={() => setShowSettings(false)} />
        )}
        {showSetup && <TerminalSetup pass={pass} cfg={cfg} locationId={posLoc} curTerm={curTerm} onClose={() => setShowSetup(false)}
          onSelected={(deviceId, name) => setCfg((c) => posLoc
            ? ({ ...c, terminalByLocation: { ...(c.terminalByLocation || {}), [posLoc]: { deviceId, name } } })
            : ({ ...c, terminalDeviceId: deviceId, terminalName: name }))} />}
      </div>
    );
  }

  // ── Register mode ──
  return (
    <div className="pos-root" data-theme={theme}>
      {header}
      <div className={`pos-body${configureMode ? ' configuring' : ''}`}>
        {/* Left: category rail (browse) OR return rail (configure) */}
        {configureMode ? (
          <nav className="pos-rail return">
            <button className="pos-rail-back" onClick={() => setConfiguring(null)}>← {configuring.item.category || 'Back'}</button>
          </nav>
        ) : (
          <nav className="pos-rail">
            {cats.map((c) => (
              <button key={c.category} className={`pos-cat${activeCat === c.category ? ' on' : ''}`}
                onClick={() => { setActiveCat(c.category); setQuery(''); }}>{c.category}</button>
            ))}
          </nav>
        )}

        {/* Centre: product grid (browse) OR configure workspace */}
        {configureMode ? (
          <ConfigWorkspace
            item={configuring.item} currency={currency} initial={configuring.initial}
            onCancel={() => setConfiguring(null)}
            onCommit={(entry) => {
              if (configuring.editKey) replaceLine(configuring.editKey, entry); else addLine(entry);
              setConfiguring(null);
            }} />
        ) : (
          <main className="pos-main">
            <div className="pos-main-head">
              <div className="pos-cat-title">{q ? 'Search' : activeCat} <span>{activeItems.length} items</span></div>
              <input className="pos-search" placeholder="Search products" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div className="pos-grid">
              {activeItems.map((it) => {
                const min = Math.min(...(it.variations || []).map((v) => v.price ?? Infinity));
                const multi = (it.variations || []).length > 1;
                return (
                  <button key={it.id} className={`pos-tile${it.soldOut ? ' sold' : ''}`} disabled={it.soldOut}
                    onClick={() => pickProduct(it, it.category)}>
                    <span className="pos-tile-name">{it.name}</span>
                    <span className="pos-tile-price">
                      {it.soldOut ? 'Sold out' : Number.isFinite(min) ? `${multi ? 'From ' : ''}${formatMoney(min, currency)}` : ''}
                    </span>
                  </button>
                );
              })}
              {activeItems.length === 0 && <div className="pos-empty">No products{q ? ' match your search' : ''}.</div>}
            </div>
          </main>
        )}

        {/* Right: cart panel (full in browse, slim while configuring; a
            slide-over on phones, toggled by the bottom bar) */}
        <aside className={`pos-cart${configureMode ? ' slim' : ''}${cartOpen ? ' open' : ''}`}>
          <div className="pos-cart-head">
            <button className="pos-cart-back" onClick={() => setCartOpen(false)} aria-label="Back to menu">‹</button>
            <span>Current order</span>
            {cart.length > 0 && <button className="pos-cart-clear" onClick={clearCart}>Clear</button>}
          </div>

          {!configureMode && (
            <div className="pos-fulfil">
              {bothServices ? (
                <div className="pos-fulfil-row">
                  <button className={`pos-chip${!dineIn ? ' on' : ''}`} onClick={() => setDineIn(false)}>Takeaway</button>
                  <button className={`pos-chip${dineIn ? ' on' : ''}`} onClick={() => setDineIn(true)}>Eat in</button>
                </div>
              ) : (
                // This store only offers one service type — show it, don't ask.
                <div className="pos-fulfil-solo">{dineIn ? 'Eat in' : 'Takeaway'}<span>{storeFulfil.dineIn ? 'dine-in only at this store' : 'takeaway only at this store'}</span></div>
              )}
              <div className="pos-fulfil-row">
                <input className="pos-name" placeholder={dineIn ? 'Name (optional)' : 'Customer name'} value={orderName} onChange={(e) => setOrderName(e.target.value)} />
                {dineIn && <input className="pos-table" placeholder="Table" value={table} onChange={(e) => setTable(e.target.value)} />}
              </div>
            </div>
          )}

          <div className="pos-cart-items">
            {cart.length === 0 && <div className="pos-cart-empty">No items yet. Tap a product to start.</div>}
            {groupCart(cart).map((row) => row.type === 'combo' ? (
              <div key={row.instanceId} className="pos-line combo">
                <div className="pos-line-main" onClick={() => !configureMode && editCombo(row.instanceId)}>
                  <div className="pos-line-top">
                    <span className="pos-line-name">🍽 {row.name}</span>
                    <span className="pos-line-price">{formatMoney((row.lines.reduce((s, l) => s + l.unitPrice, 0) - row.discount) * row.quantity, currency)}</span>
                  </div>
                  {row.lines.map((l, i) => (
                    <div key={i} className="pos-line-mods">
                      {l.itemName}{l.variationName ? ` · ${l.variationName}` : ''}{l.modifierNames && l.modifierNames.length ? ` · ${l.modifierNames.join(', ')}` : ''}
                    </div>
                  ))}
                  {row.discount > 0 && <div className="pos-line-note">Combo saving −{formatMoney(row.discount * row.quantity, currency)}</div>}
                </div>
                <div className="pos-line-qty">
                  <button onClick={() => bumpCombo(row.instanceId, -1)} aria-label="Decrease">−</button>
                  <span>{row.quantity}</span>
                  <button onClick={() => bumpCombo(row.instanceId, 1)} aria-label="Increase">+</button>
                </div>
              </div>
            ) : (
              <div key={row.line.key} className="pos-line">
                <div className="pos-line-main" onClick={() => !configureMode && editLine(row.line)}>
                  <div className="pos-line-top">
                    <span className="pos-line-name">{row.line.itemName}</span>
                    <span className="pos-line-price">{formatMoney(row.line.unitPrice * row.line.quantity, currency)}</span>
                  </div>
                  {(row.line.variationName || row.line.modifierNames.length > 0) && (
                    <div className="pos-line-mods">{[row.line.variationName, ...row.line.modifierNames].filter(Boolean).join(' · ')}</div>
                  )}
                  {row.line.note && <div className="pos-line-note">“{row.line.note}”</div>}
                </div>
                <div className="pos-line-qty">
                  <button onClick={() => bumpQty(row.line.key, -1)} aria-label="Decrease">−</button>
                  <span>{row.line.quantity}</span>
                  <button onClick={() => bumpQty(row.line.key, 1)} aria-label="Increase">+</button>
                </div>
              </div>
            ))}
          </div>

          <div className="pos-cart-foot">
            {comboSaving > 0 && <div className="pos-total-row saving"><span>Combo savings</span><span>−{formatMoney(comboSaving, currency)}</span></div>}
            <div className="pos-total-row"><span>Total</span><span className="pos-total">{formatMoney(total, currency)}</span></div>
            <div className="pos-gst">GST included</div>
            {err && <div className="pos-err">{err}</div>}
            <button className="pos-btn primary big pay" disabled={!cart.length || busy} onClick={() => setTender('choose')}>
              Charge {formatMoney(total, currency)}
            </button>
          </div>
        </aside>

        {/* Phone: dim the menu behind the slide-over cart */}
        {cartOpen && <div className="pos-cart-scrim" onClick={() => setCartOpen(false)} />}
      </div>

      {/* Combo builder (reuses the customer combo modal) */}
      {combo && <ComboModal item={combo} currency={currency} onClose={() => setCombo(null)} onAdd={(entries) => addCombo(entries)} />}

      {/* Phone-only bottom bar: opens the order (hidden on wide screens / while configuring) */}
      {!configureMode && (
        <div className="pos-mobilebar">
          <div className="pos-mobilebar-info">
            <span className="pos-mobilebar-count">{cartCount(cart)} item{cartCount(cart) === 1 ? '' : 's'}</span>
            <span className="pos-mobilebar-total">{formatMoney(total, currency)}</span>
          </div>
          <button className="pos-btn primary big" disabled={!cart.length} onClick={() => setCartOpen(true)}>
            View order
          </button>
        </div>
      )}

      {/* Tender overlay */}
      {tender && (
        <TenderOverlay tender={tender} setTender={setTender} total={total} currency={currency}
          busy={busy} methods={payMethods} cardEnabled={!!curTerm.deviceId} cardSurchargePct={(cfg.surcharges && cfg.surcharges.card && cfg.surcharges.card.enabled) ? cfg.surcharges.card.percent : 0}
          onCard={() => submit('card')} onCash={(given) => submit('cash', given)} onKitchen={(reason) => submit('unpaid', undefined, reason)} onClose={() => setTender(null)} />
      )}

      {/* Card — Terminal waiting / result */}
      {cardPay && (
        <div className="pos-scrim">
          <div className="pos-card-wait" onClick={(e) => e.stopPropagation()}>
            {cardPay.status === 'canceled' ? (
              <>
                <div className="pos-card-x">✕</div>
                <div className="pos-success-title">Payment canceled</div>
                <div className="pos-success-id">The order was not charged. Your items are still in the cart.</div>
                <button className="pos-btn primary big" onClick={() => { setCardPay(null); }}>Back to order</button>
              </>
            ) : (
              <>
                <div className="pos-card-spinner" />
                <div className="pos-success-title">Waiting for customer</div>
                <div className="pos-card-amount">{formatMoney(cardPay.amount, currency)}</div>
                <div className="pos-success-id">Follow the prompts on <b>{cardPay.terminalName}</b>.</div>
                <button className="pos-btn ghost big" disabled={cardPay.status === 'canceling'} onClick={cancelCard}>
                  {cardPay.status === 'canceling' ? 'Canceling…' : 'Cancel payment'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Settings sheet — the single home for store, terminal and exit */}
      {showSettings && (
        <SettingsSheet
          cfg={cfg} posLoc={posLoc} multiStore={multiStore} curTerm={curTerm}
          theme={theme} onTheme={setTheme}
          idleSec={kdsIdleSec != null ? kdsIdleSec : (cfg && cfg.kdsIdleSec != null ? cfg.kdsIdleSec : 60)} onIdle={setKdsIdleSec}
          pass={pass}
          onPayments={(loc, next) => setCfg((c) => ({ ...c, paymentsByLocation: { ...(c.paymentsByLocation || {}), [loc]: next } }))}
          onSwitchStore={switchStore} onOpenTerminal={() => { setShowSettings(false); setShowSetup(true); }}
          onExit={onExit} onClose={() => setShowSettings(false)} />
      )}

      {/* Terminal setup / pairing */}
      {showSetup && <TerminalSetup pass={pass} cfg={cfg} locationId={posLoc} curTerm={curTerm} onClose={() => setShowSetup(false)}
        onSelected={(deviceId, name) => setCfg((c) => posLoc
          ? ({ ...c, terminalByLocation: { ...(c.terminalByLocation || {}), [posLoc]: { deviceId, name } } })
          : ({ ...c, terminalDeviceId: deviceId, terminalName: name }))} />}

      {/* Success overlay */}
      {success && (
        <div className="pos-scrim" onClick={() => { setSuccess(null); lastActivityRef.current = Date.now(); }}>
          <div className="pos-success" onClick={(e) => e.stopPropagation()}>
            <div className="pos-success-tick">✓</div>
            <div className="pos-success-title">{success.tender === 'unpaid' ? 'Sent to kitchen' : 'Payment complete'}</div>
            <div className="pos-success-id">Order #{success.shortId}</div>
            {success.tender === 'cash' && success.change > 0 && (
              <div className="pos-success-change">Change due <b>{formatMoney(success.change, currency)}</b></div>
            )}
            <button className="pos-btn primary big" onClick={() => { setSuccess(null); setMode('register'); lastActivityRef.current = Date.now(); }}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Settings sheet: the single home for the "major choices" — which store this
//    screen is serving (one selector that drives both the register and the KDS),
//    the card terminal, the signed-in staff, and exit. Opened from the ⚙ in the
//    one top bar. ──
// A compact "how we're traveling" panel for the current store, inside POS
// Settings — reuses the same figures as the admin compare dashboard so a manager
// can glance at trade without leaving the till.
function PosStorePulse({ posLoc, storeName }) {
  const RANGES = [
    { k: 'today', t: 'Today', q: 'range=today' },
    { k: 'week', t: 'This week', q: 'range=week' },
    { k: '7', t: '7 days', q: 'days=7' },
    { k: '30', t: '30 days', q: 'days=30' },
  ];
  const [rk, setRk] = useState('today');
  const [row, setRow] = useState(null);
  const [err, setErr] = useState('');
  const pass = (() => { try { return atob(localStorage.getItem('bc-admin-pass') || '') || ''; } catch { return ''; } })();
  useEffect(() => {
    let alive = true; setRow(null); setErr('');
    const q = (RANGES.find((r) => r.k === rk) || RANGES[0]).q;
    fetch(`/api/admin/analytics/compare?${q}&pass=${encodeURIComponent(pass)}`)
      .then((r) => r.json())
      .then((d) => { if (!alive) return; if (d.error) { setErr(d.error); return; }
        const stores = d.stores || [];
        const mine = stores.find((s) => s.id === posLoc) || stores[0] || null;
        setRow(mine ? { ...mine, cur: d.currency || 'AUD' } : null);
      })
      .catch(() => { if (alive) setErr('Could not load figures.'); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rk, posLoc]);
  const tiles = row ? [
    { v: row.orders, l: 'Orders' },
    { v: formatMoney(row.revenue, row.cur), l: 'Revenue' },
    { v: row.app, l: 'App' },
    { v: row.pos, l: 'POS' },
    { v: row.qr, l: 'QR' },
  ] : [];
  return (
    <div className="pos-set-block">
      <div className="pos-set-label">How we&rsquo;re traveling{storeName ? ` · ${storeName}` : ''}</div>
      <div className="pos-idle-opts" style={{ marginTop: 8 }}>
        {RANGES.map((r) => <button key={r.k} type="button" className={`pos-idle-opt${rk === r.k ? ' on' : ''}`} onClick={() => setRk(r.k)}>{r.t}</button>)}
      </div>
      {err && <p className="pos-set-hint">{err}</p>}
      {!row && !err && <p className="pos-set-hint">Loading…</p>}
      {row && (
        <div className="pos-pulse-grid">
          {tiles.map((t) => (
            <div key={t.l} className="pos-pulse-tile"><span className="pos-pulse-v">{t.v}</span><span className="pos-pulse-l">{t.l}</span></div>
          ))}
        </div>
      )}
    </div>
  );
}

// Refunds — manager-PIN gated. Pick a recent paid order, tick the item(s) to
// refund (partial) or type a custom amount, enter the PIN, confirm. Square
// refunds by amount against the order's payment. First-time use sets the PIN.
function RefundModal({ pass, posLoc, hasPin, currency, onPinSet, onClose }) {
  const [orders, setOrders] = useState(null);
  const [err, setErr] = useState('');
  const [sel, setSel] = useState(null);          // the chosen order
  const [ticked, setTicked] = useState(new Set());
  const [custom, setCustom] = useState('');       // dollars, optional override
  const [pin, setPin] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  // First-time PIN setup
  const [havePin, setHavePin] = useState(hasPin);
  const [newPin, setNewPin] = useState('');
  const [curPin, setCurPin] = useState('');

  useEffect(() => {
    if (!havePin) return;
    let alive = true;
    api.posRecentOrders(pass, posLoc).then((d) => { if (alive) setOrders(d.orders || []); }).catch((e) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [havePin, pass, posLoc]);

  const refundable = sel ? Math.max(0, sel.total - sel.refunded) : 0;
  const tickedTotal = sel ? sel.items.reduce((s, it, i) => s + (ticked.has(i) ? it.amount : 0), 0) : 0;
  const customCents = Math.round((parseFloat(custom) || 0) * 100);
  const amount = Math.min(refundable, customCents > 0 ? customCents : tickedTotal);

  async function savePin() {
    setErr('');
    try { await api.posSetManagerPin(pass, newPin.trim(), curPin.trim()); setHavePin(true); onPinSet && onPinSet(); }
    catch (e) { setErr(e.message); }
  }
  async function doRefund() {
    if (!sel || !(amount > 0) || busy) return;
    setBusy(true); setErr('');
    try {
      const r = await api.posRefund(pass, { orderId: sel.orderId, paymentId: sel.paymentId, amount, reason: reason.trim(), managerPin: pin.trim() });
      const rf = r.refund || {};
      setDone({ amount, status: (rf.status || 'PENDING').toUpperCase(), id: rf.id || '' });
      // Refresh the list so the refunded amount shows next time.
      api.posRecentOrders(pass, posLoc).then((d) => setOrders(d.orders || [])).catch(() => {});
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  const title = <div className="pos-tender-title">Refund</div>;

  return (
    <div className="pos-scrim" onClick={(e) => { e.stopPropagation(); onClose(); }} style={{ zIndex: 80 }}>
      <div className="pos-settings" onClick={(e) => e.stopPropagation()}>
        <div className="pos-settings-head">{title}<button className="pos-icon" title="Close" onClick={onClose}><IcoX /></button></div>

        {!havePin ? (
          <div className="pos-set-block">
            <div className="pos-set-label">Set a manager PIN</div>
            <p className="pos-set-hint">A 4–8 digit PIN is required to approve refunds. Set it once here.</p>
            <input className="pos-set-select" inputMode="numeric" placeholder="New PIN" value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))} />
            {hasPin && <input className="pos-set-select" style={{ marginTop: 8 }} inputMode="numeric" placeholder="Current PIN" value={curPin} onChange={(e) => setCurPin(e.target.value.replace(/\D/g, ''))} />}
            {err && <div className="pos-err">{err}</div>}
            <button className="pos-btn primary big" style={{ width: '100%', marginTop: 12 }} disabled={newPin.length < 4} onClick={savePin}>Save PIN</button>
          </div>
        ) : done ? (
          <div className="pos-set-block" style={{ textAlign: 'center' }}>
            <div className="pos-success-tick" style={{ margin: '6px auto' }}>✓</div>
            <div className="pos-success-title">Refund {done.status === 'COMPLETED' ? 'complete' : 'submitted'} · {formatMoney(done.amount, currency)}</div>
            <p className="pos-set-hint">
              {done.status === 'COMPLETED'
                ? 'Square has refunded this to the customer’s original payment.'
                : 'Square accepted the refund and is processing it (status: PENDING). Card refunds usually settle within minutes; the customer’s Square refund receipt is sent once it completes.'}
              {done.id ? ` Refund id ${done.id.slice(-8)}.` : ''}
            </p>
            <button className="pos-btn primary big" style={{ width: '100%' }} onClick={onClose}>Done</button>
          </div>
        ) : !sel ? (
          <div className="pos-set-block">
            <div className="pos-set-label">Pick the order to refund</div>
            {err && <div className="pos-err">{err}</div>}
            {!orders && !err && <p className="pos-set-hint">Loading recent orders…</p>}
            {orders && orders.length === 0 && <p className="pos-set-hint">No refundable orders in the last 3 days.</p>}
            <div className="pos-refund-list">
              {(orders || []).map((o) => (
                <button key={o.orderId} type="button" className="pos-refund-order" onClick={() => { setSel(o); setTicked(new Set()); setCustom(''); }}>
                  <span className="pos-refund-order-main">
                    <b>{o.name || `#${o.orderId.slice(-4).toUpperCase()}`}</b>
                    <span className="muted">{fmtDateTime(o.createdAt)} · {o.items.length} item{o.items.length === 1 ? '' : 's'}{o.refunded ? ` · ${formatMoney(o.refunded, o.currency)} refunded` : ''}</span>
                  </span>
                  <span className="pos-refund-order-amt">{formatMoney(o.total, o.currency)}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="pos-set-block">
            <button className="pos-link" onClick={() => setSel(null)}>← Back to orders</button>
            <div className="pos-set-label" style={{ marginTop: 8 }}>Tick items to refund{refundable !== sel.total ? ` · ${formatMoney(refundable, currency)} left` : ''}</div>
            <div className="pos-refund-items">
              {sel.items.map((it, i) => (
                <label key={i} className="pos-refund-item">
                  <input type="checkbox" checked={ticked.has(i)} disabled={!!custom} onChange={() => setTicked((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; })} />
                  <span className="pos-refund-item-name">{it.quantity}× {it.name}{it.variation ? ` · ${it.variation}` : ''}</span>
                  <span className="pos-refund-item-amt">{formatMoney(it.amount, currency)}</span>
                </label>
              ))}
            </div>
            <div className="pos-set-label" style={{ marginTop: 10 }}>Or a custom amount</div>
            <input className="pos-set-select" inputMode="decimal" placeholder="0.00" value={custom} onChange={(e) => setCustom(e.target.value.replace(/[^\d.]/g, ''))} />
            <input className="pos-set-select" style={{ marginTop: 8 }} placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="pos-set-label" style={{ marginTop: 10 }}>Manager PIN</div>
            <input className="pos-set-select" inputMode="numeric" type="password" placeholder="PIN" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
            {err && <div className="pos-err">{err}</div>}
            <button className="pos-btn primary big" style={{ width: '100%', marginTop: 12 }} disabled={busy || !(amount > 0) || pin.length < 4} onClick={doRefund}>
              {busy ? 'Refunding…' : `Refund ${formatMoney(amount, currency)}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Cash-up / Today: tender totals (Card / Cash / Unpaid), a float you set to
// balance the till, and a filterable order list you can drill into — including
// the reason on any free/unpaid order.
function CashUpModal({ pass, posLoc, currency, onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState('all');
  const [sel, setSel] = useState(null);
  const floatKey = `bc-pos-float-${posLoc || 'main'}-${new Date().toISOString().slice(0, 10)}`;
  const [floatStr, setFloatStr] = useState(() => { try { return localStorage.getItem(floatKey) || ''; } catch { return ''; } });
  useEffect(() => { try { localStorage.setItem(floatKey, floatStr); } catch {} }, [floatKey, floatStr]);
  useEffect(() => {
    let alive = true;
    api.posDay(pass, posLoc).then((d) => { if (alive) setData(d); }).catch((e) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [pass, posLoc]);

  const cur = (data && data.currency) || currency || 'AUD';
  const t = data ? data.totals : null;
  const floatCents = Math.round((parseFloat(floatStr) || 0) * 100);
  const cashTake = t ? t.cash.v : 0;
  const orders = data ? data.orders : [];
  const shown = filter === 'all' ? orders : orders.filter((o) => o.tender === filter);
  const chips = [['all', 'All'], ['card', 'Card'], ['cash', 'Cash'], ['unpaid', 'Unpaid']];

  return (
    <div className="pos-scrim" onClick={(e) => { e.stopPropagation(); onClose(); }} style={{ zIndex: 80 }}>
      <div className="pos-settings" onClick={(e) => e.stopPropagation()}>
        <div className="pos-settings-head"><div className="pos-tender-title">Cash-up · today</div><button className="pos-icon" onClick={onClose}><IcoX /></button></div>

        {err && <div className="pos-err">{err}</div>}
        {!data && !err && <p className="pos-set-hint">Loading today’s orders…</p>}

        {sel ? (
          <div className="pos-set-block">
            <button className="pos-link" onClick={() => setSel(null)}>← Back</button>
            <div className="pos-set-label" style={{ marginTop: 8 }}>{sel.name || `#${sel.orderId.slice(-4).toUpperCase()}`} · {sel.tender}</div>
            <div className="pos-refund-items">
              {sel.items.map((it, i) => (
                <div key={i} className="pos-refund-item"><span className="pos-refund-item-name">{it.quantity}× {it.name}{it.variation ? ` · ${it.variation}` : ''}</span><span className="pos-refund-item-amt">{formatMoney(it.amount, cur)}</span></div>
              ))}
            </div>
            <div className="pos-set-row"><span className="pos-set-status">Total</span><span className="pos-pulse-v">{formatMoney(sel.total, cur)}</span></div>
            {sel.reason && <p className="pos-set-hint">Reason: <b>{sel.reason}</b></p>}
            {sel.refunded > 0 && <p className="pos-set-hint">Refunded: {formatMoney(sel.refunded, cur)}</p>}
          </div>
        ) : data && (
          <>
            <div className="pos-pulse-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
              <div className="pos-pulse-tile"><span className="pos-pulse-v">{formatMoney(t.card.v, cur)}</span><span className="pos-pulse-l">Card · {t.card.n}</span></div>
              <div className="pos-pulse-tile"><span className="pos-pulse-v">{formatMoney(t.cash.v, cur)}</span><span className="pos-pulse-l">Cash · {t.cash.n}</span></div>
              <div className="pos-pulse-tile"><span className="pos-pulse-v">{formatMoney(t.unpaid.v, cur)}</span><span className="pos-pulse-l">Unpaid · {t.unpaid.n}</span></div>
            </div>

            <div className="pos-set-block">
              <div className="pos-set-label">Till float</div>
              <p className="pos-set-hint">Set the cash you started the till with. At close, the till should hold the float plus cash takings.</p>
              <input className="pos-set-select" inputMode="decimal" placeholder="Float, e.g. 200.00" value={floatStr} onChange={(e) => setFloatStr(e.target.value.replace(/[^\d.]/g, ''))} />
              <div className="pos-set-row"><span className="pos-set-status">Cash takings</span><b>{formatMoney(cashTake, cur)}</b></div>
              <div className="pos-set-row"><span className="pos-set-status">Till should hold</span><b className="pos-pulse-v">{formatMoney(floatCents + cashTake, cur)}</b></div>
              <p className="pos-set-hint">Remove <b>{formatMoney(cashTake, cur)}</b> as takings; leave <b>{formatMoney(floatCents, cur)}</b> as the float.{t.refunds ? ` (${formatMoney(t.refunds, cur)} refunded today — deduct any cash refunds you paid out.)` : ''}</p>
            </div>

            <div className="pos-idle-opts">
              {chips.map(([k, l]) => <button key={k} className={`pos-idle-opt${filter === k ? ' on' : ''}`} onClick={() => setFilter(k)}>{l}</button>)}
            </div>
            <div className="pos-refund-list" style={{ marginTop: 10 }}>
              {shown.length === 0 && <p className="pos-set-hint">No orders.</p>}
              {shown.map((o) => (
                <button key={o.orderId} type="button" className="pos-refund-order" onClick={() => setSel(o)}>
                  <span className="pos-refund-order-main">
                    <b>{o.name || `#${o.orderId.slice(-4).toUpperCase()}`}{o.free ? ' · FREE' : ''}</b>
                    <span className="muted">{fmtTime(o.createdAt)} · {o.tender}{o.reason ? ` · ${o.reason}` : ''}</span>
                  </span>
                  <span className="pos-refund-order-amt">{formatMoney(o.total, cur)}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SettingsSheet({ cfg, posLoc, multiStore, curTerm, theme, onTheme, idleSec, onIdle, pass, onPayments, onSwitchStore, onOpenTerminal, onExit, onClose }) {
  const idleOpts = [{ v: 0, t: 'Never' }, { v: 30, t: '30s' }, { v: 60, t: '60s' }, { v: 120, t: '2 min' }, { v: 300, t: '5 min' }];
  const [showRefund, setShowRefund] = useState(false);
  const [showCashUp, setShowCashUp] = useState(false);
  const [hasPin, setHasPin] = useState(!!cfg.hasManagerPin);
  const [pm, setPm] = useState(() => { const x = (cfg.paymentsByLocation || {})[posLoc]; return { card: !x || x.card !== false, cash: !x || x.cash !== false, unpaid: !x || x.unpaid !== false }; });
  const [pmErr, setPmErr] = useState('');
  const togglePm = (k) => {
    const next = { ...pm, [k]: !pm[k] };
    if (!next.card && !next.cash && !next.unpaid) { setPmErr('Keep at least one method on.'); return; }
    setPmErr(''); const prev = pm; setPm(next);
    onPayments && onPayments(posLoc, next);   // live-update the tender screen (no reload)
    api.posSetPayments(pass, posLoc, next).catch((e) => { setPm(prev); setPmErr(e.message); onPayments && onPayments(posLoc, prev); });
  };
  const storeName = (cfg.locations || []).find((l) => l.id === posLoc)?.name || '';
  const termOn = !!(curTerm && curTerm.deviceId);
  return (
    <div className="pos-scrim" onClick={onClose}>
      <div className="pos-settings" onClick={(e) => e.stopPropagation()}>
        <div className="pos-settings-head">
          <div className="pos-tender-title">Settings</div>
          <button className="pos-icon" title="Close" onClick={onClose}><IcoX /></button>
        </div>

        <div className="pos-set-block">
          <div className="pos-set-label">Colour scheme</div>
          <p className="pos-set-hint">Sets the look of this screen. Saved on this device.</p>
          <div className="pos-swatches">
            {POS_THEMES.map((t) => (
              <button key={t.id} type="button"
                className={`pos-swatch sw-${t.id}${(theme || 'plum') === t.id ? ' on' : ''}`}
                onClick={() => onTheme && onTheme(t.id)} title={t.name}>
                <span className="pos-swatch-dot" />
                <span className="pos-swatch-name">{t.name}</span>
                {(theme || 'plum') === t.id && <span className="pos-swatch-tick">✓</span>}
              </button>
            ))}
          </div>
        </div>

        {(cfg.mode || 'pos_kds') === 'pos_kds' && (
          <div className="pos-set-block">
            <div className="pos-set-label">Auto-return to kitchen</div>
            <p className="pos-set-hint">After this long with no taps — and only if orders are waiting — the screen flips from the register to the kitchen. Never interrupts a sale in progress.</p>
            <div className="pos-idle-opts">
              {idleOpts.map((o) => (
                <button key={o.v} type="button" className={`pos-idle-opt${Number(idleSec) === o.v ? ' on' : ''}`} onClick={() => onIdle && onIdle(o.v)}>{o.t}</button>
              ))}
            </div>
          </div>
        )}

        {multiStore && (
          <div className="pos-set-block">
            <div className="pos-set-label">Store</div>
            <p className="pos-set-hint">The register and the kitchen screen both serve this store.</p>
            <select className="pos-set-select" value={posLoc} onChange={(e) => onSwitchStore(e.target.value)}>
              {(cfg.locations || []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
        )}

        <PosStorePulse posLoc={posLoc} storeName={storeName} />

        <div className="pos-set-block">
          <div className="pos-set-label">Cash-up</div>
          <div className="pos-set-row">
            <span className="pos-set-status">Today’s takings, filter &amp; till balance</span>
            <button className="pos-btn primary" onClick={() => setShowCashUp(true)}>Open cash-up</button>
          </div>
        </div>

        <div className="pos-set-block">
          <div className="pos-set-label">Payment methods{storeName ? ` · ${storeName}` : ''}</div>
          <p className="pos-set-hint">Which ways this store takes payment at the counter.</p>
          <div className="pos-idle-opts">
            {[['card', 'Card — Terminal'], ['cash', 'Cash'], ['unpaid', 'Send to kitchen']].map(([k, label]) => (
              <button key={k} type="button" className={`pos-idle-opt${pm[k] ? ' on' : ''}`} onClick={() => togglePm(k)}>{label}</button>
            ))}
          </div>
          {pmErr && <div className="pos-err">{pmErr}</div>}
        </div>

        <div className="pos-set-block">
          <div className="pos-set-label">Card terminal{storeName ? ` · ${storeName}` : ''}</div>
          <div className="pos-set-row">
            <span className={`pos-set-status${termOn ? ' on' : ''}`}>
              ● {termOn ? (curTerm.name || 'Terminal ready') : 'No terminal paired'}
            </span>
            <button className="pos-btn primary" onClick={onOpenTerminal}>{termOn ? 'Manage' : 'Set up'}</button>
          </div>
        </div>

        <div className="pos-set-block">
          <div className="pos-set-label">Refunds</div>
          <p className="pos-set-hint">{hasPin ? 'Refund an item or a custom amount from a recent order. A manager PIN is required.' : 'Set a manager PIN, then refund items or custom amounts from recent orders.'}</p>
          <div className="pos-set-row">
            <span className="pos-set-status">{hasPin ? 'Manager PIN set' : 'No manager PIN yet'}</span>
            <button className="pos-btn primary" onClick={() => setShowRefund(true)}>{hasPin ? 'Issue a refund' : 'Set up refunds'}</button>
          </div>
        </div>

        <button className="pos-btn ghost big pos-set-exit" onClick={onExit}>Exit POS</button>
      </div>

      {showRefund && (
        <RefundModal pass={pass} posLoc={posLoc} hasPin={hasPin} currency={cfg.currency || 'AUD'}
          onPinSet={() => setHasPin(true)} onClose={() => setShowRefund(false)} />
      )}
      {showCashUp && (
        <CashUpModal pass={pass} posLoc={posLoc} currency={cfg.currency || 'AUD'} onClose={() => setShowCashUp(false)} />
      )}
    </div>
  );
}

// ── Tender: choose method, then cash keypad with change ──
function TenderOverlay({ tender, setTender, total, currency, busy, methods, cardEnabled, cardSurchargePct, onCard, onCash, onKitchen, onClose }) {
  const [given, setGiven] = useState(0);
  const [reason, setReason] = useState('');
  const m = methods || { card: true, cash: true, unpaid: true };
  const change = Math.max(0, given - total);
  // Suggested notes: exact, next round $ up, and common AUD notes above total.
  const roundUp = (n) => Math.ceil(total / (n * 100)) * n * 100;
  const suggestions = Array.from(new Set([total, roundUp(5), roundUp(10), roundUp(20), roundUp(50)]))
    .filter((v) => v >= total).sort((a, b) => a - b).slice(0, 5);

  return (
    <div className="pos-scrim" onClick={onClose}>
      <div className="pos-tender" onClick={(e) => e.stopPropagation()}>
        {tender === 'choose' && (
          <>
            <div className="pos-tender-title">Take payment · {formatMoney(total, currency)}</div>
            <div className="pos-tender-methods">
              {m.card && (
                <button className={`pos-tender-method${cardEnabled ? '' : ' disabled'}`} disabled={!cardEnabled || busy}
                  title={cardEnabled ? '' : 'Pair a Square Terminal in POS setup (⚙)'} onClick={onCard}>
                  <span className="pos-tender-m-name">Card — Terminal</span>
                  <span className="pos-tender-m-sub">{cardEnabled ? (cardSurchargePct > 0 ? `Tap, insert or swipe · +${cardSurchargePct}% surcharge` : 'Tap, insert or swipe') : 'No terminal paired'}</span>
                </button>
              )}
              {m.cash && (
                <button className="pos-tender-method" onClick={() => setTender('cash')}>
                  <span className="pos-tender-m-name">Cash</span>
                  <span className="pos-tender-m-sub">Tender &amp; change</span>
                </button>
              )}
              {m.unpaid && (
                <button className="pos-tender-method" disabled={busy} onClick={() => setTender('unpaid')}>
                  <span className="pos-tender-m-name">Send to kitchen</span>
                  <span className="pos-tender-m-sub">Unpaid / free — needs a reason</span>
                </button>
              )}
            </div>
            <button className="pos-link" onClick={onClose}>Cancel</button>
          </>
        )}
        {tender === 'unpaid' && (
          <>
            <div className="pos-tender-title">Send to kitchen · unpaid</div>
            <p className="pos-set-hint" style={{ margin: '0 0 10px' }}>This order won’t be charged. Note why so free coffees stay accountable (they still cost cup + materials).</p>
            <input className="pos-set-select" autoFocus placeholder="Reason (e.g. staff coffee, remake, comp)" value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="pos-tender-actions" style={{ marginTop: 12 }}>
              <button className="pos-btn ghost" onClick={() => setTender('choose')}>Back</button>
              <button className="pos-btn primary big" disabled={busy || !reason.trim()} onClick={() => onKitchen(reason.trim())}>
                {busy ? 'Sending…' : 'Send to kitchen'}
              </button>
            </div>
          </>
        )}
        {tender === 'cash' && (
          <>
            <div className="pos-tender-title">Cash · due {formatMoney(total, currency)}</div>
            <div className="pos-cash-suggest">
              {suggestions.map((v) => (
                <button key={v} className={`pos-btn ghost${given === v ? ' on' : ''}`} onClick={() => setGiven(v)}>
                  {v === total ? 'Exact' : formatMoney(v, currency)}
                </button>
              ))}
            </div>
            <div className="pos-cash-row">
              <span>Tendered</span><span className="pos-cash-given">{formatMoney(given, currency)}</span>
            </div>
            <div className="pos-cash-row big">
              <span>Change</span><span className="pos-cash-change">{formatMoney(change, currency)}</span>
            </div>
            <div className="pos-tender-actions">
              <button className="pos-btn ghost" onClick={() => setTender('choose')}>Back</button>
              <button className="pos-btn primary big" disabled={busy || given < total} onClick={() => onCash(given)}>
                {busy ? 'Sending…' : 'Complete cash sale'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Terminal pairing / selection (from the POS ⚙ setup) ──
function TerminalSetup({ pass, cfg, locationId, curTerm, onClose, onSelected }) {
  const [devices, setDevices] = useState([]);
  const [current, setCurrent] = useState((curTerm && curTerm.deviceId) || '');
  const [name, setName] = useState((cfg.locations || []).find((l) => l.id === locationId)?.name || cfg.deviceName || 'Front counter');
  const [pairing, setPairing] = useState(null); // { id, code, status }
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const storeName = (cfg.locations || []).find((l) => l.id === locationId)?.name || '';

  async function loadDevices() {
    try { const d = await api.posTerminalDevices(pass); setDevices(d.devices || []); }
    catch (e) { setErr(e.message); }
  }
  useEffect(() => { loadDevices(); /* eslint-disable-next-line */ }, []);

  async function startPair() {
    setErr(''); setMsg('');
    // Pair to THIS store's location so the reader's checkouts match the order
    // location (avoids the INVALID_LOCATION payment error).
    try { const p = await api.posTerminalPair(pass, name, locationId); setPairing({ id: p.id, code: p.code, status: p.status }); }
    catch (e) { setErr(e.message); }
  }

  async function removeDevice(deviceId, dName) {
    if (!window.confirm(`Remove "${dName || 'this reader'}" from the list? It will stop showing here. (Re-pair it any time to bring it back.)`)) return;
    setErr(''); setMsg('');
    try {
      await api.posTerminalRemove(pass, deviceId);
      if (current === deviceId) { setCurrent(''); onSelected && onSelected('', ''); }
      setMsg('Reader removed.');
      loadDevices();
    } catch (e) { setErr(e.message); }
  }

  // Poll the device code until the Terminal is paired, then auto-select it.
  useEffect(() => {
    if (!pairing || pairing.status === 'PAIRED') return;
    let alive = true;
    const iv = setInterval(async () => {
      try {
        const s = await api.posTerminalPairStatus(pass, pairing.id);
        if (!alive) return;
        if (s.status === 'PAIRED' && s.deviceId) {
          setPairing({ ...pairing, status: 'PAIRED', deviceId: s.deviceId });
          await select(s.deviceId, name);
        } else if (s.status === 'EXPIRED') {
          setPairing(null); setErr('That pairing code expired — generate a new one.');
        }
      } catch {}
    }, 3000);
    return () => { alive = false; clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairing && pairing.id, pairing && pairing.status]);

  async function select(deviceId, label) {
    setErr(''); setMsg('');
    try {
      const r = await api.posTerminalSelect(pass, deviceId, label || 'Terminal', locationId);
      setCurrent(deviceId);
      onSelected && onSelected(deviceId, r.terminalName || label || 'Terminal');
      setMsg(`Terminal ready for card payments${storeName ? ` at ${storeName}` : ''}.`);
      setPairing(null);
      loadDevices();
    } catch (e) { setErr(e.message); }
  }

  async function disconnect() {
    setErr(''); setMsg('');
    try {
      await api.posTerminalDisconnect(pass, locationId);
      setCurrent('');
      onSelected && onSelected('', '');
      setMsg('Terminal disconnected.');
      loadDevices();
    } catch (e) { setErr(e.message); }
  }

  return (
    <div className="pos-scrim" onClick={onClose}>
      <div className="pos-setup" onClick={(e) => e.stopPropagation()}>
        <div className="pos-tender-title">Card terminal setup{storeName ? ` · ${storeName}` : ''}</div>

        {current
          ? <div className="pos-setup-current">In use: <b>{(curTerm && curTerm.name) || current}</b><button className="pos-setup-disconnect" onClick={disconnect}>Disconnect</button></div>
          : <div className="pos-setup-current muted">No terminal paired for this store yet.</div>}

        {devices.length > 0 && (
          <div className="pos-setup-list">
            <div className="pos-setup-label">Paired readers</div>
            {devices.map((d) => (
              <div key={d.id} className={`pos-setup-device${current === d.id ? ' on' : ''}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button style={{ flex: 1, background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: 0, color: 'inherit', font: 'inherit' }} onClick={() => select(d.id, d.name)}>
                  <span><b>{d.name}</b>{d.model ? ` · ${d.model}` : ''}</span>
                  <span className="pos-setup-dstatus">{current === d.id ? 'In use' : ((d.status || '').toUpperCase() === 'OFFLINE' ? 'Offline' : (d.status || 'Paired'))}</span>
                </button>
                <button title="Remove this reader from the list" aria-label="Remove reader" onClick={() => removeDevice(d.id, d.name)}
                  style={{ flex: '0 0 auto', border: '1px solid var(--pos-line, #d9c9cf)', background: 'transparent', color: '#c0392b', borderRadius: 8, width: 30, height: 30, cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>✕</button>
              </div>
            ))}
          </div>
        )}

        <div className="pos-setup-warn" style={{ margin: '10px 0', padding: '10px 12px', border: '1px solid #e6b800', background: '#fff8e1', borderRadius: 10, fontSize: 13, color: '#6b5300' }}>
          ⚠ <b>Reader compatibility:</b> The 1st-generation Square Terminal (V1) is <b>not</b> compatible with the Square Terminal API and cannot take card payments here — you need a <b>V1.2 Square Terminal</b>. If a reader stays “Offline” or a card payment fails, it’s likely a 1st-gen device — remove it with the ✕ and pair your V1.2.
        </div>

        <div className="pos-setup-pair">
          <div className="pos-setup-label">Pair a new Square Terminal</div>
          {pairing ? (
            <div className="pos-setup-code-box">
              <div className="pos-setup-code">{pairing.code}</div>
              <p className="pos-pop-hint">On your Square Terminal: <b>Settings → Sign in → Use a device code</b>, then enter this code. Waiting for it to pair…</p>
              <button className="pos-link" onClick={() => setPairing(null)}>Cancel</button>
            </div>
          ) : (
            <div className="pos-setup-pair-row">
              <input className="pos-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Reader name" />
              <button className="pos-btn primary" onClick={startPair}>Get pairing code</button>
            </div>
          )}
        </div>

        {msg && <div className="pos-setup-ok">{msg}</div>}
        {err && <div className="pos-err">{err}</div>}
        <button className="pos-btn ghost big" style={{ width: '100%', marginTop: 12 }} onClick={onClose}>Done</button>
      </div>
    </div>
  );
}
