import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, formatMoney } from '../api.js';
import { useItemConfig, itemIsQuickAdd, buildQuickCartItem, itemHasOptions } from '../hooks/useItemConfig.js';

// ─────────────────────────────────────────────────────────────────────────────
// Waiter mode — a portable table-service register. A waiter unlocks with a short
// PIN (never the admin password), opens a tab on a table, adds items that go
// straight to the kitchen, then settles the tab: pay in full (card on the
// dedicated waiter Terminal, or cash), leave it open, or SPLIT it — by item, an
// even share per person, or custom percentages — with an optional name on each
// payment so "who paid what" is legible afterwards.
// ─────────────────────────────────────────────────────────────────────────────

const PIN_KEY = 'bc-waiter-pin';
const LOC_KEY = 'bc-waiter-location';
const NAME_KEY = 'bc-waiter-name';
const NAV_KEY = 'bc-waiter-nav';

// Waiter API. `auth` is { pin } for a floor device or { pass } when the counter
// POS (admin) is managing tables. `by` (the waiter's name) is stamped onto every
// order and payment for attribution, so management can see who did what.
function waiterApi(auth, by) {
  const a = auth || {};
  const authQ = a.pass != null ? `pass=${encodeURIComponent(a.pass)}` : `pin=${encodeURIComponent(a.pin || '')}`;
  const q = (extra) => `${authQ}${extra || ''}`;
  const post = (url, body, withBy) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...a, ...(withBy ? { by } : {}), ...body }) }).then(json);
  const json = async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Something went wrong'); return d; };
  return {
    config: (location) => fetch(`/api/waiter/config?${q(location ? `&location=${encodeURIComponent(location)}` : '')}`).then(json),
    tabs: (location) => fetch(`/api/waiter/tabs?${q(location ? `&location=${encodeURIComponent(location)}` : '')}`).then(json),
    tab: (id) => fetch(`/api/waiter/tab/${encodeURIComponent(id)}?${q()}`).then(json),
    send: (body) => post('/api/waiter/tab', body, true),
    pay: (body) => post('/api/waiter/tab/pay', body, true),
    closeFull: (body) => post('/api/waiter/tab/close', body, true),
    checkout: (id, tabId) => fetch(`/api/waiter/checkout/${encodeURIComponent(id)}?${q(`&tabId=${encodeURIComponent(tabId || '')}`)}`).then(json),
    cancelCheckout: (id) => post(`/api/waiter/checkout/${encodeURIComponent(id)}/cancel`, {}),
    // Split-billing (group tabs + shared tabs)
    sessionCreate: (body) => post('/api/waiter/session', body, true),
    session: (id, location) => fetch(`/api/waiter/session/${encodeURIComponent(id)}?${q(location ? `&location=${encodeURIComponent(location)}` : '')}`).then(json),
    sessionTabs: (body) => post('/api/waiter/session/tabs', body),
    sessionOrder: (body) => post('/api/waiter/session/order', body, true),
    sessionAssign: (body) => post('/api/waiter/session/assign', body),
    sessionPay: (body) => post('/api/waiter/session/pay', body, true),
    sessionMarkPaid: (body) => post('/api/waiter/session/mark-paid', body),
    claimName: (body) => post('/api/waiter/claim-name', body),
    tableOpen: (body) => post('/api/waiter/table/open', body, true),
    tableClose: (body) => post('/api/waiter/table/close', body),
    printReceipt: (body) => post('/api/waiter/print-receipt', body),
  };
}

// A stable per-device id so the name-dedup registry can tell one waiter phone
// from another (and let the same phone re-claim its own name).
function deviceId() {
  try {
    let v = localStorage.getItem('bc-waiter-cid');
    if (!v) { v = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)); localStorage.setItem('bc-waiter-cid', v); }
    return v;
  } catch { return 'anon'; }
}

// Don't show a variation name that just repeats the item name (e.g. a single
// "Fritters" variation on a "Fritters" item) — only real options like "Small".
const cleanVar = (name, v) => { const vv = String(v || '').trim(); return vv && vv.toLowerCase() !== String(name || '').trim().toLowerCase() ? vv : ''; };
const subParts = (name, variation, mods) => [cleanVar(name, variation), ...(mods || [])].filter(Boolean);

// The in-progress order (draft cart) is kept in localStorage so a page reload —
// iOS pull-to-refresh, the PWA reloading itself, a stray swipe — never loses a
// half-built order (bad news at the end of a big table). Cleared once it's sent.
function loadCart(key) { try { return JSON.parse(localStorage.getItem('bc-waiter-cart-' + key) || '[]') || []; } catch { return []; } }
function saveCart(key, cart) { try { if (cart && cart.length) localStorage.setItem('bc-waiter-cart-' + key, JSON.stringify(cart)); else localStorage.removeItem('bc-waiter-cart-' + key); } catch {} }

// Stroke icons (site-wide rule: no emoji / filled icons).
const Svg = (p) => <svg viewBox="0 0 24 24" width={p.s || 20} height={p.s || 20} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{p.children}</svg>;
const IconCard = (p) => <Svg s={p.s}><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><path d="M2.5 9.5h19" /></Svg>;
const IconCash = (p) => <Svg s={p.s}><rect x="2.5" y="6" width="19" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 9v6M18 9v6" /></Svg>;
const IconLock = (p) => <Svg s={p.s}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></Svg>;
const IconBack = (p) => <Svg s={p.s}><path d="M15 5l-7 7 7 7" /></Svg>;
const IconSplit = (p) => <Svg s={p.s}><path d="M6 3v6a3 3 0 0 0 3 3h6a3 3 0 0 1 3 3v6" /><path d="M14 6l4-3 4 3" transform="translate(-4 0)" /></Svg>;
const IconSearch = (p) => <Svg s={p.s}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></Svg>;
const IconX = (p) => <Svg s={p.s}><path d="M6 6l12 12M18 6L6 18" /></Svg>;
const IconPrint = (p) => <Svg s={p.s}><path d="M6 9V3h12v6" /><rect x="4" y="9" width="16" height="8" rx="2" /><path d="M8 17h8v4H8z" /></Svg>;

export default function Waiter({ onExit, adminPass, actorName }) {
  const isAdmin = !!adminPass;
  const [pin, setPin] = useState(() => { try { return localStorage.getItem(PIN_KEY) || ''; } catch { return ''; } });
  const [waiterName, setWaiterName] = useState(() => { if (actorName) return actorName; try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; } });
  const [authed, setAuthed] = useState(false);
  const [cfg, setCfg] = useState(null);
  const [location, setLocation] = useState(() => { try { return localStorage.getItem(LOC_KEY) || ''; } catch { return ''; } });
  const [menu, setMenu] = useState(null);
  const [err, setErr] = useState('');
  const [screen, setScreen] = useState('home');           // home | setup | build | tab | settle | split | session
  const [ctx, setCtx] = useState({ tabId: '', table: '', sessionId: '', groupId: '' }); // active context
  const auth = useMemo(() => (isAdmin ? { pass: adminPass } : { pin }), [isAdmin, adminPass, pin]);
  const api2 = useMemo(() => waiterApi(auth, waiterName), [auth, waiterName]);

  // Unlock on mount: the POS (admin) opens straight in; a floor device unlocks
  // with its saved PIN if there is one, else shows the keypad.
  useEffect(() => { if (isAdmin) unlock(); else if (pin && !authed) unlock(); /* eslint-disable-next-line */ }, []);

  // Remember where the waiter was (screen + table/tab) so a reload — iOS pull to
  // refresh, the PWA reloading — drops them back onto the exact order they were
  // building, not the home screen. Restored once, after everything's ready.
  const restoredRef = useRef(false);
  useEffect(() => { try { if (authed && (waiterName || isAdmin)) localStorage.setItem(NAV_KEY, JSON.stringify({ screen, ctx })); } catch {} }, [screen, ctx, authed, waiterName, isAdmin]);
  useEffect(() => {
    if (restoredRef.current) return;
    if (authed && cfg && menu && (waiterName || isAdmin)) {
      restoredRef.current = true;
      try { const n = JSON.parse(localStorage.getItem(NAV_KEY) || 'null'); if (n && n.screen && n.screen !== 'home') { if (n.ctx) setCtx(n.ctx); setScreen(n.screen); } } catch {}
    }
  }, [authed, cfg, menu, waiterName, isAdmin]);

  async function unlock(tryPin) {
    setErr('');
    try {
      const c = await waiterApi(isAdmin ? { pass: adminPass } : { pin: tryPin != null ? tryPin : pin }).config(location);
      // A per-store PIN selects its store: the server tells us which one.
      let loc = c.location || location;
      const locs = c.locations || [];
      if (locs.length && !locs.some((l) => l.id === loc)) { loc = locs[0].id; }
      setLocation(loc); try { localStorage.setItem(LOC_KEY, loc); } catch {}
      const m = await api.getMenu(loc);
      setCfg(c); setMenu(m); setAuthed(true);
      if (!isAdmin && tryPin != null) try { localStorage.setItem(PIN_KEY, tryPin); } catch {}
      // In staff mode the PIN identifies the waiter — take the name the server
      // resolved and skip the name prompt entirely.
      if (!isAdmin && c.pinMode === 'staff') setWaiterName(c.waiterName || 'Waiter');
    } catch (e) { setErr(e.message || 'Wrong PIN'); setAuthed(false); }
  }

  function saveName(n) { const v = String(n || '').trim().slice(0, 40); setWaiterName(v); try { localStorage.setItem(NAME_KEY, v); } catch {} }
  // Single-PIN mode: claim the typed name so two "Tim"s on a shift become Tim/Tim2.
  async function submitName(n) {
    let v = String(n || '').trim().slice(0, 40); if (!v) return;
    try { const r = await api2.claimName({ name: v, location, cid: deviceId() }); if (r && r.name) v = r.name; } catch {}
    saveName(v);
  }
  function lock() {
    if (isAdmin) { onExit && onExit(); return; }
    // Locking = "code back in as someone else": clear the PIN and the name so the
    // next login re-establishes who's serving (single mode re-asks the name; staff
    // mode gets it from whoever's PIN is entered). Simply closing the app does NOT
    // lock, so a waiter who reopens it stays signed in as themselves.
    try { localStorage.removeItem(PIN_KEY); localStorage.removeItem(NAV_KEY); localStorage.removeItem(NAME_KEY); } catch {}
    setAuthed(false); setPin(''); setCfg(null); setScreen('home'); setWaiterName('');
  }

  async function changeLocation(id) {
    setLocation(id); try { localStorage.setItem(LOC_KEY, id); } catch {}
    try { const m = await api.getMenu(id); setMenu(m); const c = await api2.config(id); setCfg((p) => ({ ...p, ...c })); } catch (e) { setErr(e.message); }
  }

  if (!authed) {
    if (isAdmin) return <div className="wtr-root wtr-center"><WaiterStyle />{err ? <div className="wtr-err">{err}</div> : <div className="wtr-spin" />}</div>;
    return <PinGate pin={pin} setPin={setPin} onSubmit={(p) => unlock(p)} err={err} onExit={onExit} />;
  }
  if (!cfg || !menu) return <div className="wtr-root wtr-center"><WaiterStyle /><div className="wtr-spin" /></div>;
  // In single-PIN mode a floor waiter types their name once (per device) so their
  // orders and payments are attributed to them. In staff mode the PIN already
  // identifies them, so this is skipped.
  if (!waiterName && !isAdmin && cfg.pinMode !== 'staff') return <NameGate onSubmit={submitName} onExit={onExit} />;

  const currency = cfg.currency || 'AUD';
  const common = { api2, cfg, menu, currency, location, setErr };

  return (
    <div className="wtr-root">
      <WaiterStyle />
      <header className="wtr-top">
        {screen === 'home'
          ? (isAdmin ? <button className="wtr-ghost wtr-iconbtn" onClick={() => onExit && onExit()} title="Back to POS"><IconBack /></button> : <span className="wtr-topspacer" />)
          : <button className="wtr-ghost" onClick={goHome}>‹ Tables</button>}
        <div className="wtr-title">{cfg.storeName || 'Waiter'}</div>
        <button className="wtr-ghost wtr-iconbtn" onClick={lock} title={isAdmin ? 'Back to POS' : 'Lock / switch'}>{isAdmin ? <IconBack /> : <IconLock />}</button>
      </header>
      {err && <div className="wtr-err" onClick={() => setErr('')}>{err} · tap to dismiss</div>}

      {screen === 'home' && <Home {...common} waiterName={waiterName} onOpenTab={openExisting} onNewTab={startNewTab} onOpenEmpty={onOpenEmpty} />}
      {screen === 'setup' && <SetupChoice {...common} table={ctx.table} onTogether={startTogether} onSplit={startSplit} onCancel={goHome} />}
      {screen === 'build' && <Build {...common} title={ctx.groupId ? 'Add to tab' : (ctx.tabId ? 'Add to' : 'New tab')} label={ctx.table}
        cartKey={`${ctx.sessionId || ''}|${ctx.groupId || ''}|${ctx.tabId || ''}|${ctx.table || ''}`}
        submit={(cart) => ctx.sessionId
          ? api2.sessionOrder({ sessionId: ctx.sessionId, tabId: ctx.groupId, cart, locationId: location })
          : api2.send({ cart, tabId: ctx.tabId || undefined, table: ctx.table || undefined, locationId: location })}
        onDone={(d) => ctx.sessionId ? openSession(ctx.sessionId, ctx.table) : afterSend({ tabId: d.tabId, table: ctx.table })}
        onCancel={ctx.sessionId ? () => openSession(ctx.sessionId, ctx.table) : (ctx.tabId ? () => openExisting({ tabId: ctx.tabId, table: ctx.table }) : goHome)} />}
      {screen === 'tab' && <TabView {...common} ctx={ctx} onAdd={() => setScreen('build')} onSettle={() => setScreen('settle')} onBack={goHome} />}
      {screen === 'settle' && <Settle {...common} ctx={ctx} onSplit={() => setScreen('split')} onDone={goHome} onBack={() => setScreen('tab')} />}
      {screen === 'split' && <Split {...common} ctx={ctx} onDone={goHome} onBack={() => setScreen('settle')} />}
      {screen === 'session' && <SessionView {...common} sessionId={ctx.sessionId} table={ctx.table}
        onOrderInto={(groupId) => { setCtx((c) => ({ ...c, groupId })); setScreen('build'); }} onBack={goHome} />}
    </div>
  );

  function goHome() { setCtx({ tabId: '', table: '', sessionId: '', groupId: '' }); setScreen('home'); }
  function startNewTab(table) { setCtx({ tabId: '', table, sessionId: '', groupId: '' }); setScreen('setup'); }
  function openExisting({ tabId, table, sessionId }) { if (sessionId) return openSession(sessionId, table); setCtx({ tabId, table, sessionId: '', groupId: '' }); setScreen('tab'); }
  function openSession(sessionId, table) { setCtx({ tabId: '', table, sessionId, groupId: '' }); setScreen('session'); }
  function afterSend({ tabId, table }) { setCtx({ tabId, table, sessionId: '', groupId: '' }); setScreen('tab'); }
  // Reopen a table that's been marked taken but has no order yet: a split table
  // resumes its session; a one-tab table jumps straight to building the order.
  function onOpenEmpty(t) {
    if (t.sessionId) return openSession(t.sessionId, t.table);
    setCtx({ tabId: '', table: t.table, sessionId: '', groupId: '' }); setScreen('build');
  }
  // Choosing "All together" marks the table taken up front, so the floor knows
  // it's occupied even before the first item is sent to the kitchen.
  async function startTogether() {
    try { await api2.tableOpen({ table: ctx.table, mode: 'together', locationId: location }); } catch {}
    setScreen('build');
  }
  async function startSplit() {
    try {
      const d = await api2.sessionCreate({ table: ctx.table, locationId: location });
      try { await api2.tableOpen({ table: ctx.table, mode: 'groups', sessionId: d.sessionId, locationId: location }); } catch {}
      openSession(d.sessionId, ctx.table);
    } catch (e) { setErr(e.message); }
  }
}

// ── PIN keypad ───────────────────────────────────────────────────────────────
function PinGate({ pin, setPin, onSubmit, err, onExit }) {
  const [v, setV] = useState('');
  const press = (d) => setV((s) => (s.length < 8 ? s + d : s));
  return (
    <div className="wtr-root wtr-center">
      <WaiterStyle />
      <div className="wtr-pin">
        <div className="wtr-pin-title">Waiter mode</div>
        <div className="wtr-pin-sub">Enter your staff PIN</div>
        <div className="wtr-pin-shown">{v || <span className="wtr-muted">enter PIN</span>}</div>
        {err && <div className="wtr-pin-err">{err}</div>}
        <div className="wtr-pad">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => <button key={n} onClick={() => press(String(n))}>{n}</button>)}
          <button className="wtr-pad-min" onClick={() => setV('')}>C</button>
          <button onClick={() => press('0')}>0</button>
          <button className="wtr-pad-ok" onClick={() => { setPin(v); onSubmit(v); }}>→</button>
        </div>
      </div>
    </div>
  );
}

// ── Name gate: who's serving (per device) ────────────────────────────────────
function NameGate({ onSubmit, onExit }) {
  const [v, setV] = useState('');
  return (
    <div className="wtr-root wtr-center">
      <WaiterStyle />
      <div className="wtr-pin">
        <div className="wtr-pin-title">Who’s serving?</div>
        <div className="wtr-pin-sub">Your name goes on the orders and payments you take, so the team can see who did what.</div>
        <input className="wtr-input" style={{ textAlign: 'center', fontSize: 18 }} placeholder="Your name" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && v.trim() && onSubmit(v)} autoFocus />
        <button className="wtr-primary" style={{ width: '100%' }} disabled={!v.trim()} onClick={() => onSubmit(v)}>Start serving</button>
      </div>
    </div>
  );
}

// ── Home: open tabs + new tab ────────────────────────────────────────────────
function Home({ api2, cfg, currency, location, waiterName, setErr, onOpenTab, onNewTab, onOpenEmpty }) {
  const [tabs, setTabs] = useState(null);
  const [table, setTable] = useState('');
  const [picking, setPicking] = useState(false);
  const [mine, setMine] = useState(false);
  const [closing, setClosing] = useState('');

  const load = async () => { try { const d = await api2.tabs(location); setTabs(d.tabs || []); } catch (e) { setErr(e.message); setTabs([]); } };
  // Clear a table that has no order (an empty marker) so it stops showing taken.
  const closeEmpty = async (t) => {
    setClosing(t.openId);
    try { await api2.tableClose({ openId: t.openId }); await load(); }
    catch (e) { setErr(e.message); } finally { setClosing(''); }
  };
  useEffect(() => { load(); const iv = setInterval(load, 12000); return () => clearInterval(iv); /* eslint-disable-next-line */ }, [location]);

  const presets = cfg.tables || [];
  const startTable = (t) => { const v = String(t || '').trim(); if (!v) return; onNewTab(v); };
  const shown = (tabs || []).filter((t) => !mine || (t.by && waiterName && t.by.toLowerCase() === waiterName.toLowerCase()));

  return (
    <div className="wtr-body">
      <button className={`wtr-primary wtr-new ${picking ? 'wtr-new-open' : ''}`} onClick={() => setPicking((p) => !p)}>{picking ? 'Close' : '+ New Table'}</button>
      {picking && (
        <div className="wtr-card">
          <div className="wtr-card-h">Pick a table<button className="wtr-ghost" onClick={() => setPicking(false)}>Close</button></div>
          {presets.length > 0 && (
            <div className="wtr-tables">
              {presets.map((t) => <button key={t} className="wtr-tablechip" onClick={() => startTable(t)}>{t}</button>)}
            </div>
          )}
          <div className="wtr-row">
            <input className="wtr-input" placeholder="Or type a table / name" value={table} onChange={(e) => setTable(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && startTable(table)} />
            <button className="wtr-primary" onClick={() => startTable(table)}>Open</button>
          </div>
        </div>
      )}

      <div className="wtr-sec-row">
        <div className="wtr-sec">Open tables {shown.length ? `(${shown.length})` : ''}</div>
        <div className="wtr-seg">
          <button className={mine ? '' : 'on'} onClick={() => setMine(false)}>All</button>
          <button className={mine ? 'on' : ''} onClick={() => setMine(true)}>Mine</button>
        </div>
      </div>
      {tabs === null && <div className="wtr-muted">Loading…</div>}
      {tabs && shown.length === 0 && <div className="wtr-muted">{mine ? 'None of your tables are open.' : 'No open tables. Start one above.'}</div>}
      <div className="wtr-tablist">
        {shown.map((t) => t.empty ? (
          // A table marked taken but with no order yet. Tap to start ordering;
          // the ✕ clears it (party left, or opened by mistake).
          <div key={t.openId} className="wtr-tab wtr-tab-empty">
            <button className="wtr-tab-main" onClick={() => onOpenEmpty(t)}>
              <div className="wtr-tab-l">
                <div className="wtr-tab-table">Table {t.table}{t.mode === 'groups' ? ' · split' : ''}</div>
                <div className="wtr-muted">Open · no order yet{t.by ? ` · ${t.by}` : ''}</div>
              </div>
              <span className="wtr-tab-badge">Taken</span>
            </button>
            <button className="wtr-tab-close" title="Close table" disabled={closing === t.openId} onClick={() => closeEmpty(t)}><IconX s={18} /></button>
          </div>
        ) : (
          <button key={t.tabId} className="wtr-tab" onClick={() => onOpenTab({ tabId: t.tabId, table: t.table, sessionId: t.sessionId })}>
            <div className="wtr-tab-l">
              <div className="wtr-tab-table">Table {t.table}{t.name ? ` · ${t.name}` : ''}{t.sessionId ? ' · split' : ''}</div>
              <div className="wtr-muted">{t.itemCount} item{t.itemCount === 1 ? '' : 's'}{t.by ? ` · ${t.by}` : ''}{t.remaining != null && t.paid > 0 && t.remaining > 0 ? ` · ${formatMoney(t.paid, t.currency || currency)} paid` : ''}</div>
            </div>
            <div className="wtr-tab-total">{formatMoney(t.remaining != null ? t.remaining : t.total, t.currency || currency)}{t.remaining != null && t.remaining <= 0 ? <span className="wtr-tab-badge" style={{ marginLeft: 6 }}>PAID</span> : (t.paid > 0 ? <span className="wtr-muted" style={{ display: 'block', fontSize: 11, fontWeight: 600 }}>left</span> : null)}</div>
          </button>
        ))}
      </div>
      {/* Build stamp — so staff (and support) can confirm this device is running
          the current version. If this is missing or old, reinstall the app. */}
      <div className="wtr-buildstamp">v47b · {(typeof window !== 'undefined' && window.__BUILD__ ? String(window.__BUILD__).slice(0, 7) : 'dev')}</div>
    </div>
  );
}

// ── Build: add items (this round) then send to the kitchen ───────────────────
function Build({ menu, currency, title, label, cartKey, setErr, submit, onDone, onCancel }) {
  const cats = menu.categories || [];
  const [activeCat, setActiveCat] = useState((cats[0] || {}).category || null);
  const [q, setQ] = useState('');
  const [cart, setCart] = useState(() => loadCart(cartKey || 'x'));
  useEffect(() => { saveCart(cartKey || 'x', cart); }, [cart, cartKey]);
  const [sheetItem, setSheetItem] = useState(null); // menu item being configured
  const [editKey, setEditKey] = useState(null);     // cart line being edited
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [searching, setSearching] = useState(false);

  const query = searching ? q.trim().toLowerCase() : '';
  const items = query
    ? cats.flatMap((c) => c.items || []).filter((it) => (it.name || '').toLowerCase().includes(query))
    : (((cats.find((c) => c.category === activeCat) || cats[0] || {}).items) || []);

  // Newest item on top: a new line goes to the front; adding one already there
  // bumps its quantity and floats it back to the top.
  const addLine = (line) => setCart((r) => {
    const i = r.findIndex((x) => x.key === line.key);
    if (i >= 0) { const merged = { ...r[i], quantity: r[i].quantity + line.quantity }; return [merged, ...r.slice(0, i), ...r.slice(i + 1)]; }
    return [line, ...r];
  });
  const tap = (item) => { if (itemIsQuickAdd(item)) addLine(buildQuickCartItem(item)); else setSheetItem(item); };
  const setLineQty = (key, qv) => setCart((r) => r.map((x) => x.key === key ? { ...x, quantity: Math.max(1, qv) } : x));
  const setLineNote = (key, note) => setCart((r) => r.map((x) => x.key === key ? { ...x, note } : x));
  const remove = (key) => setCart((r) => r.filter((x) => x.key !== key));
  const total = cart.reduce((s, x) => s + x.unitPrice * x.quantity, 0);
  const count = cart.reduce((s, x) => s + x.quantity, 0);
  const editing = cart.find((x) => x.key === editKey);

  async function send() {
    if (!cart.length) return;
    setSending(true); setErr('');
    try { const d = await submit(cart); saveCart(cartKey || 'x', []); onDone(d || {}); }
    catch (e) { setErr(e.message); setConfirming(false); } finally { setSending(false); }
  }

  const closeSearch = () => { setSearching(false); setQ(''); };
  // Cancelling discards this draft (so re-opening the table starts fresh); a
  // reload — which is what the saved cart protects against — restores it instead.
  const cancel = () => { saveCart(cartKey || 'x', []); onCancel(); };
  return (
    <div className={`wtr-body wtr-build ${expanded ? 'cart-expanded' : ''}`}>
      <div className="wtr-build-head">
        <div className="wtr-build-table">{title} · {label}</div>
        <div className="wtr-head-actions">
          <button className="wtr-ghost wtr-iconbtn" title="Search" onClick={() => setSearching(true)}><IconSearch /></button>
          <button className="wtr-ghost" onClick={cancel}>Cancel</button>
        </div>
      </div>

      {searching ? (
        <div className="wtr-searchrow">
          <IconSearch s={18} />
          <input className="wtr-input wtr-search" autoFocus placeholder="Start typing an item…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="wtr-ghost" onClick={closeSearch}>Done</button>
        </div>
      ) : (
        <div className="wtr-catnav">
          {cats.map((c) => <button key={c.category} className={`wtr-catbtn ${activeCat === c.category ? 'on' : ''}`} onClick={() => setActiveCat(c.category)}>{c.category}</button>)}
        </div>
      )}

      {/* Menu as a readable LIST (no image tiles), in its own scroll area so it
          never hides behind the cart. When searching, it's the predictive result. */}
      <div className="wtr-menuscroll">
        {items.length === 0 && <div className="wtr-muted">No items.</div>}
        {items.map((it) => {
          const base = (it.variations || [])[0]?.price || 0;
          // How many of THIS item are already in the cart — matched by name so it
          // never falls back to a shared/blank id and shows the same total on all.
          const inCart = cart.filter((x) => x.itemName === it.name).reduce((s, x) => s + x.quantity, 0);
          return (
            <button key={it.id} className="wtr-menurow" onClick={() => tap(it)}>
              <div className="wtr-menurow-name">{it.name}{inCart > 0 && <span className="wtr-incart">{inCart}</span>}</div>
              <div className="wtr-menurow-right">
                <span className="wtr-menurow-price">{formatMoney(base, currency)}{itemHasOptions(it) ? '+' : ''}</span>
                <span className="wtr-menurow-add">＋</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Editable cart pinned to the bottom (max 30%), newest first. Expandable. */}
      {cart.length > 0 && (
        <div className={`wtr-cart ${expanded ? 'expanded' : ''}`}>
          <div className="wtr-cart-head">
            <span>Order · {count} item{count === 1 ? '' : 's'}</span>
            <button className="wtr-cart-expand" onClick={() => setExpanded((v) => !v)}>{expanded ? '⤡ 30%' : '⤢ Full screen'}</button>
          </div>
          <div className="wtr-cart-list">
            {cart.map((x) => (
              <button key={x.key} className="wtr-cart-line" onClick={() => setEditKey(x.key)}>
                <span className="wtr-cart-qty">{x.quantity}</span>
                <span className="wtr-cart-info">
                  <span className="wtr-cart-name">{x.itemName}</span>
                  {subParts(x.itemName, x.variationName, x.modifierNames).length > 0 && <span className="wtr-cart-sub">{subParts(x.itemName, x.variationName, x.modifierNames).join(' · ')}</span>}
                  {x.note && <span className="wtr-cart-sub note">“{x.note}”</span>}
                </span>
                <span className="wtr-cart-amt">{formatMoney(x.unitPrice * x.quantity, currency)}</span>
              </button>
            ))}
          </div>
          <button className="wtr-primary wtr-send" disabled={sending} onClick={() => setConfirming(true)}>
            Review &amp; send · {formatMoney(total, currency)}
          </button>
        </div>
      )}

      {sheetItem && <WaiterItemSheet item={sheetItem} currency={currency} onCancel={() => setSheetItem(null)} onAdd={(line) => { addLine(line); setSheetItem(null); }} />}

      {editing && <WaiterLineEdit line={editing} currency={currency}
        onQty={(qv) => setLineQty(editing.key, qv)} onNote={(n) => setLineNote(editing.key, n)}
        onRemove={() => { remove(editing.key); setEditKey(null); }} onClose={() => setEditKey(null)} />}

      {confirming && (
        <div className="wtr-scrim" onClick={() => setConfirming(false)}>
          <div className="wtr-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="wtr-card-h">Read back the order</div>
            <div className="wtr-muted">Confirm with the table, then send it all to the kitchen as one order.</div>
            <div className="wtr-round-list">
              {cart.map((x) => (
                <div key={x.key} className="wtr-itemrow">
                  <div className="wtr-round-qtybadge">{x.quantity}</div>
                  <div className="wtr-iteminfo"><div>{x.itemName}</div><div className="wtr-muted">{subParts(x.itemName, x.variationName, x.modifierNames).join(' · ')}{x.note ? ` · “${x.note}”` : ''}</div></div>
                  <div className="wtr-itemamt">{formatMoney(x.unitPrice * x.quantity, currency)}</div>
                </div>
              ))}
            </div>
            <div className="wtr-payrow">
              <button className="wtr-secondary" onClick={() => setConfirming(false)}>Keep editing</button>
              <button className="wtr-primary" disabled={sending} onClick={send}>{sending ? 'Sending…' : `Send · ${formatMoney(total, currency)}`}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Readable item-options sheet (variations, add-ons, a note) — waiter-native, so
// it always renders in the high-contrast waiter theme (not the customer app's).
function WaiterItemSheet({ item, currency, onAdd, onCancel }) {
  const c = useItemConfig(item);
  const variations = (item.variations || []).filter(Boolean);
  return (
    <div className="wtr-scrim" onClick={onCancel}>
      <div className="wtr-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="wtr-card-h">{item.name}</div>
        {variations.length > 1 && (
          <>
            <div className="wtr-fieldlabel">Size / option</div>
            <div className="wtr-chips">
              {variations.map((v) => (
                <button key={v.id} className={`wtr-chip ${c.variationId === v.id ? 'on' : ''}`} disabled={v.soldOut} onClick={() => c.setVariationId(v.id)}>
                  {v.name || 'Standard'}{v.price ? ` · ${formatMoney(v.price, currency)}` : ''}
                </button>
              ))}
            </div>
          </>
        )}
        {(item.modifierGroups || []).map((g) => (
          (g.modifiers || []).length > 0 && (
            <div key={g.id}>
              <div className="wtr-fieldlabel">{g.name}{(g.min || 0) > 0 ? ' · required' : ''}{c.unmetGroups.includes(g) ? ' — pick one' : ''}</div>
              <div className="wtr-chips">
                {(g.modifiers || []).map((m) => {
                  const on = (c.selected[g.id] && c.selected[g.id].has(m.id));
                  return (
                    <button key={m.id} className={`wtr-chip ${on ? 'on' : ''} ${c.unmetGroups.includes(g) ? 'need' : ''}`} onClick={() => c.toggleModifier(g, m)}>
                      {m.name}{m.price ? ` +${formatMoney(m.price, currency)}` : ''}
                    </button>
                  );
                })}
              </div>
            </div>
          )
        ))}
        <div className="wtr-fieldlabel">Note for the kitchen</div>
        <input className="wtr-input" placeholder="e.g. no onion, extra hot" value={c.note} onChange={(e) => c.setNote(e.target.value)} />
        <div className="wtr-row wtr-people">
          <span>Quantity</span>
          <div className="wtr-qty"><button onClick={() => c.setQty(Math.max(1, c.qty - 1))}>−</button><span>{c.qty}</span><button onClick={() => c.setQty(c.qty + 1)}>+</button></div>
        </div>
        <div className="wtr-payrow">
          <button className="wtr-secondary" onClick={onCancel}>Cancel</button>
          <button className="wtr-primary" disabled={!c.canAdd} onClick={() => onAdd(c.buildCartItem())}>
            {c.canAdd ? `Add · ${formatMoney(c.unitPrice * c.qty, currency)}` : 'Choose options'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Edit a line already in the cart: change quantity, add/adjust a kitchen note, or
// remove it. (To change size/add-ons, remove and re-add.)
function WaiterLineEdit({ line, currency, onQty, onNote, onRemove, onClose }) {
  return (
    <div className="wtr-scrim" onClick={onClose}>
      <div className="wtr-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="wtr-card-h">{line.itemName}</div>
        {subParts(line.itemName, line.variationName, line.modifierNames).length > 0 && <div className="wtr-muted">{subParts(line.itemName, line.variationName, line.modifierNames).join(' · ')}</div>}
        <div className="wtr-row wtr-people">
          <span>Quantity</span>
          <div className="wtr-qty"><button onClick={() => onQty(Math.max(1, line.quantity - 1))}>−</button><span>{line.quantity}</span><button onClick={() => onQty(line.quantity + 1)}>+</button></div>
        </div>
        <div className="wtr-fieldlabel">Note for the kitchen</div>
        <input className="wtr-input" placeholder="e.g. well done, allergy: nuts" value={line.note || ''} onChange={(e) => onNote(e.target.value)} />
        <div className="wtr-payrow">
          <button className="wtr-secondary wtr-danger" onClick={onRemove}>Remove</button>
          <button className="wtr-primary" onClick={onClose}>Done · {formatMoney(line.unitPrice * line.quantity, currency)}</button>
        </div>
      </div>
    </div>
  );
}

// ── Tab view: current items + total ──────────────────────────────────────────
function TabView({ api2, currency, ctx, setErr, onAdd, onSettle, onBack }) {
  const [tab, setTab] = useState(null);
  const load = async () => { try { setTab(await api2.tab(ctx.tabId)); } catch (e) { setErr(e.message); } };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [ctx.tabId]);
  if (!tab) return <div className="wtr-body"><div className="wtr-muted">Loading tab…</div></div>;
  const paid = tab.paid || 0;
  return (
    <div className="wtr-body">
      <div className="wtr-tabhead">
        <div className="wtr-tabhead-t">Table {tab.table || ctx.table}</div>
        <div className="wtr-tabhead-total">{formatMoney(tab.total, tab.currency || currency)}</div>
      </div>
      <div className="wtr-itemlist">
        {tab.items.map((it, i) => (
          <div key={i} className="wtr-itemrow">
            <div className="wtr-itemqty">{it.quantity}×</div>
            <div className="wtr-iteminfo"><div>{it.name}</div><div className="wtr-muted">{subParts(it.name, it.variation, it.modifiers).join(' · ')}</div></div>
            <div className="wtr-itemamt">{formatMoney(it.amount, tab.currency || currency)}</div>
          </div>
        ))}
      </div>
      {paid > 0 && <div className="wtr-paidnote">{formatMoney(paid, tab.currency || currency)} already paid · {formatMoney(tab.remaining, tab.currency || currency)} left</div>}
      <div className="wtr-actions">
        <button className="wtr-secondary" onClick={onAdd}>+ Add items</button>
        <button className="wtr-primary" onClick={onSettle}>Settle</button>
      </div>
      <button className="wtr-ghost wtr-back" onClick={onBack}>‹ Back to tables</button>
    </div>
  );
}

// ── Settle: pay full / leave open / split ────────────────────────────────────
function Settle({ api2, cfg, currency, location, ctx, setErr, onSplit, onDone, onBack }) {
  const [tab, setTab] = useState(null);
  const [card, setCard] = useState(null);   // active card checkout {checkoutId,...}
  const [busy, setBusy] = useState(false);
  const [cashOpen, setCashOpen] = useState(false);
  const load = async () => { try { setTab(await api2.tab(ctx.tabId)); } catch (e) { setErr(e.message); } };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [ctx.tabId]);

  const cardPoll = useCardPoll(api2, ctx.tabId, location, setErr);

  if (!tab) return <div className="wtr-body"><div className="wtr-muted">Loading…</div></div>;
  const remaining = tab.remaining;

  async function payCard() {
    setBusy(true); setErr('');
    try {
      const d = await api2.closeFull({ tabId: ctx.tabId, tender: 'card', locationId: location });
      if (d.checkoutId) { setCard(d); await cardPoll.wait(d.checkoutId); setCard(null); }
      onDone();
    } catch (e) { setErr(e.message); setCard(null); } finally { setBusy(false); }
  }
  async function payCash(cashGiven) {
    setBusy(true); setErr('');
    try { await api2.closeFull({ tabId: ctx.tabId, tender: 'cash', cashGiven, locationId: location }); onDone(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="wtr-body">
      <div className="wtr-tabhead"><div className="wtr-tabhead-t">Settle · Table {tab.table || ctx.table}</div><div className="wtr-tabhead-total">{formatMoney(remaining, tab.currency || currency)}</div></div>
      {tab.paid > 0 && <div className="wtr-paidnote">{formatMoney(tab.paid, tab.currency || currency)} already paid</div>}

      {card ? (
        <div className="wtr-card wtr-waiting">
          <div className="wtr-spin" />
          <div>Waiting for card on <b>{card.terminalName || 'Terminal'}</b>…</div>
          <button className="wtr-secondary" onClick={async () => { try { await api2.cancelCheckout(card.checkoutId); } catch {} setCard(null); setBusy(false); }}>Cancel</button>
        </div>
      ) : (
        <>
          <div className="wtr-paygrid">
            {(cfg.payments ? cfg.payments.card !== false : true) && (
              <button className="wtr-pay" disabled={busy || !cfg.hasTerminal} onClick={payCard}>
                <span className="wtr-pay-i"><IconCard s={26} /></span>Card{!cfg.hasTerminal ? ' (no reader)' : ''}
              </button>
            )}
            {(cfg.payments ? cfg.payments.cash !== false : true) && (
              <button className="wtr-pay" disabled={busy} onClick={() => setCashOpen(true)}><span className="wtr-pay-i"><IconCash s={26} /></span>Cash</button>
            )}
          </div>
          <button className="wtr-primary wtr-split" onClick={onSplit}>Split the bill</button>
          <button className="wtr-secondary" onClick={onDone}>Leave open</button>
          <button className="wtr-ghost wtr-back" onClick={onBack}>‹ Back</button>
        </>
      )}
      {cashOpen && <PayDialog target={{ payerId: '', name: tab.table || ctx.table || 'Table', remaining }} cur={tab.currency || currency} busy={busy} hasTerminal={cfg.hasTerminal} payments={cfg.payments} cashOnly onCancel={() => setCashOpen(false)} onPay={({ cashGiven }) => { setCashOpen(false); payCash(cashGiven); }} />}
    </div>
  );
}

// ── Split workspace: by item / even / percentage ─────────────────────────────
function Split({ api2, cfg, currency, location, ctx, setErr, onDone, onBack }) {
  const [tab, setTab] = useState(null);
  const [method, setMethod] = useState('item');       // item | even | pct | custom
  const [settledUids, setSettledUids] = useState(() => new Set());
  const [payOpen, setPayOpen] = useState(false);      // custom-amount pay dialog
  const [printing, setPrinting] = useState('');       // paymentId currently printing
  const printRcpt = async (paymentId) => {
    if (!paymentId) return;
    setPrinting(paymentId); setErr('');
    try { await api2.printReceipt({ paymentId, locationId: location }); }
    catch (e) { setErr(e.message); }
    finally { setTimeout(() => setPrinting(''), 1500); }
  };
  const [card, setCard] = useState(null);
  const [busy, setBusy] = useState(false);
  const cardPoll = useCardPoll(api2, ctx.tabId, location, setErr);

  const load = async () => { try { const d = await api2.tab(ctx.tabId); setTab(d); if (d.remaining <= 0) onDone(); } catch (e) { setErr(e.message); } };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [ctx.tabId]);
  if (!tab) return <div className="wtr-body"><div className="wtr-muted">Loading…</div></div>;
  const cur = tab.currency || currency;

  // Take one split payment of `amount`, named `who`, via `tender`. Marks the
  // ticked items settled on success (item mode). Always re-reads the tab after.
  async function takePayment({ amount, who, tender, cashGiven, markUids }) {
    const amt = Math.round(amount);
    if (!(amt > 0)) { setErr('Nothing to pay for that.'); return false; }
    setBusy(true); setErr('');
    try {
      const d = await api2.pay({ tabId: ctx.tabId, amount: amt, tender, payerName: who || '', cashGiven, lineUids: markUids || [], locationId: location });
      if (tender === 'card' && d.checkoutId) { setCard({ ...d }); const ok = await cardPoll.wait(d.checkoutId); setCard(null); if (!ok) { await load(); return false; } }
      if (markUids && markUids.length) setSettledUids((s) => { const n = new Set(s); markUids.forEach((u) => n.add(u)); return n; });
      const fresh = await api2.tab(ctx.tabId);
      setTab(fresh);
      if (fresh.remaining <= 0) { setTimeout(onDone, 600); }
      return true;
    } catch (e) { setErr(e.message); setCard(null); return false; } finally { setBusy(false); }
  }

  if (card) {
    return (
      <div className="wtr-body">
        <div className="wtr-card wtr-waiting">
          <div className="wtr-spin" />
          <div>Waiting for card on <b>{card.terminalName || 'Terminal'}</b> · {formatMoney(card.amount, cur)}{card.payerName ? ` · ${card.payerName}` : ''}…</div>
          <button className="wtr-secondary" onClick={async () => { try { await api2.cancelCheckout(card.checkoutId); } catch {} setCard(null); setBusy(false); await load(); }}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="wtr-body wtr-split-body">
      <div className="wtr-tabhead">
        <div className="wtr-tabhead-t">Split · Table {tab.table || ctx.table}</div>
        <div className="wtr-tabhead-total">{formatMoney(tab.remaining, cur)} <span className="wtr-muted">left</span></div>
      </div>
      {tab.paid > 0 && <div className="wtr-paidnote">{formatMoney(tab.paid, cur)} already paid · {formatMoney(tab.remaining, cur)} left</div>}
      {tab.payments && tab.payments.length > 0 && (
        <div className="wtr-paidlist">
          {tab.payments.map((p, i) => (
            <div key={i} className="wtr-paidchip">
              {p.name || 'Paid'} · {formatMoney(p.amount, cur)}{p.tender ? ` · ${p.tender}` : ''}
              {cfg.hasTerminal && p.paymentId && <button className="wtr-chip-print" disabled={printing === p.paymentId} onClick={() => printRcpt(p.paymentId)} title="Print receipt on the terminal">{printing === p.paymentId ? '…' : <IconPrint s={14} />}</button>}
            </div>
          ))}
        </div>
      )}

      <div className="wtr-methods">
        {[['item', 'By item'], ['even', 'Even split'], ['pct', 'Percentage'], ['custom', 'Custom']].map(([k, label]) => (
          <button key={k} className={`wtr-method ${method === k ? 'on' : ''}`} onClick={() => setMethod(k)}>{label}</button>
        ))}
      </div>

      {method === 'item' && <SplitByItem tab={tab} cur={cur} settledUids={settledUids} busy={busy} hasTerminal={cfg.hasTerminal} payments={cfg.payments} onPay={takePayment} />}
      {method === 'even' && <SplitEven tab={tab} cur={cur} busy={busy} hasTerminal={cfg.hasTerminal} payments={cfg.payments} onPay={takePayment} />}
      {method === 'pct' && <SplitPct tab={tab} cur={cur} busy={busy} hasTerminal={cfg.hasTerminal} payments={cfg.payments} onPay={takePayment} />}
      {method === 'custom' && (
        <div className="wtr-card">
          <div className="wtr-card-h">Custom amount</div>
          <p className="wtr-muted">Take any amount toward this table — type the amount, choose cash or card, and (for cash) tap the note handed over to get the change.</p>
          <button className="wtr-primary" disabled={tab.remaining <= 0} onClick={() => setPayOpen(true)}>Choose amount &amp; pay · {formatMoney(tab.remaining, cur)} left</button>
        </div>
      )}

      {payOpen && <PayDialog target={{ payerId: '', name: `Table ${tab.table || ctx.table}`, remaining: tab.remaining }} cur={cur} busy={busy} hasTerminal={cfg.hasTerminal} payments={cfg.payments} onCancel={() => setPayOpen(false)} onPay={async ({ amount, tender }) => { setPayOpen(false); await takePayment({ amount, who: '', tender }); }} />}

      <button className="wtr-ghost wtr-back" onClick={onBack}>‹ Back</button>
    </div>
  );
}

// Pay for the exact items a person had.
function SplitByItem({ tab, cur, settledUids, busy, hasTerminal, payments, onPay }) {
  const [ticked, setTicked] = useState(() => new Set());
  const [who, setWho] = useState('');
  const key = (it) => it.uid || it.name;
  // An item is paid if the server says so (persisted, survives reload) OR it was
  // just settled on this device (instant feedback before the refetch lands).
  const isPaid = (it) => it.paid || settledUids.has(key(it));
  const toggle = (it) => setTicked((s) => { const n = new Set(s); const k = key(it); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const selected = tab.items.filter((it) => !isPaid(it) && ticked.has(key(it)));
  const amount = Math.min(selected.reduce((s, it) => s + it.amount, 0), tab.remaining);
  const allPaid = tab.items.length > 0 && tab.items.every(isPaid);
  // Money taken as an amount (Even / % / Custom / Settle) isn't tied to any item,
  // so it can't tick one — surface it here so a partly-paid tab isn't confusing.
  const itemisedPaid = tab.items.filter(isPaid).reduce((s, it) => s + it.amount, 0);
  const byAmountPaid = Math.max(0, (tab.paid || 0) - itemisedPaid);

  const pay = async (tender, cashGiven) => {
    const ok = await onPay({ amount, who, tender, cashGiven, markUids: [...ticked] });
    if (ok) { setTicked(new Set()); setWho(''); }
  };

  return (
    <div className="wtr-card">
      <div className="wtr-card-h">Tick what they’re paying for</div>
      {byAmountPaid > 0 && !allPaid && <div className="wtr-muted" style={{ fontSize: 12, marginBottom: 6 }}>{formatMoney(byAmountPaid, cur)} was paid by amount (Even / Custom), so it isn’t marked against a specific item.</div>}
      <div className="wtr-itemlist">
        {tab.items.length === 0 && <div className="wtr-muted">No items on this tab.</div>}
        {allPaid && <div className="wtr-paidnote">All items paid.</div>}
        {tab.items.map((it) => isPaid(it) ? (
          <div key={key(it)} className="wtr-tickrow wtr-itempaid">
            <span className="wtr-paidbadge">PAID</span>
            <div className="wtr-iteminfo"><div className="wtr-strike">{it.quantity}× {it.name}</div><div className="wtr-muted">{it.paidBy ? `by ${it.paidBy}` : ''}{it.paidBy && it.paidTender ? ' · ' : ''}{it.paidTender || ''}</div></div>
            <div className="wtr-itemamt wtr-strike">{formatMoney(it.amount, cur)}</div>
          </div>
        ) : (
          <label key={key(it)} className="wtr-tickrow">
            <input type="checkbox" checked={ticked.has(key(it))} onChange={() => toggle(it)} />
            <div className="wtr-iteminfo"><div>{it.quantity}× {it.name}</div><div className="wtr-muted">{subParts(it.name, it.variation, it.modifiers).join(' · ')}</div></div>
            <div className="wtr-itemamt">{formatMoney(it.amount, cur)}</div>
          </label>
        ))}
      </div>
      {!allPaid && <>
        <input className="wtr-input" placeholder="Name on this payment (optional)" value={who} onChange={(e) => setWho(e.target.value)} />
        <PayRow amount={amount} cur={cur} busy={busy} hasTerminal={hasTerminal} payments={payments} onPay={pay} disabled={amount <= 0} />
      </>}
    </div>
  );
}

// Everyone pays an equal share (e.g. 12 people → each a twelfth). Shares are
// computed against what's LEFT and how many payers remain, so rounding always
// lands exactly on the total.
function SplitEven({ tab, cur, busy, hasTerminal, payments, onPay }) {
  const [n, setN] = useState(2);
  const [paidCount, setPaidCount] = useState(0);
  const [who, setWho] = useState('');
  const left = Math.max(1, n - paidCount);
  const share = Math.round(tab.remaining / left);
  const pay = async (tender, cashGiven) => { const ok = await onPay({ amount: share, who, tender, cashGiven }); if (ok) { setPaidCount((c) => c + 1); setWho(''); } };
  return (
    <div className="wtr-card">
      <div className="wtr-card-h">Split evenly</div>
      <div className="wtr-row wtr-people">
        <span>How many people?</span>
        <div className="wtr-qty"><button onClick={() => setN((x) => Math.max(1, x - 1))}>−</button><span>{n}</span><button onClick={() => setN((x) => Math.min(50, x + 1))}>+</button></div>
      </div>
      <div className="wtr-evenline">Each pays <b>{formatMoney(share, cur)}</b> · {paidCount} of {n} paid</div>
      <input className="wtr-input" placeholder={`Name (optional) — person ${Math.min(n, paidCount + 1)}`} value={who} onChange={(e) => setWho(e.target.value)} />
      <PayRow amount={share} cur={cur} busy={busy} hasTerminal={hasTerminal} payments={payments} onPay={pay} />
    </div>
  );
}

// Custom percentages (starts even, edit any row). Each share is a % of the whole
// tab; paying reduces the balance. The last unpaid share always fills the exact
// remaining so cents never go missing.
function SplitPct({ tab, cur, busy, hasTerminal, payments, onPay }) {
  const [rows, setRows] = useState(() => [{ name: '', pct: 50, paid: false }, { name: '', pct: 50, paid: false }]);
  const setPct = (i, val) => setRows((r) => r.map((x, j) => j === i ? { ...x, pct: Math.max(0, Math.min(100, Number(val) || 0)) } : x));
  const setName = (i, val) => setRows((r) => r.map((x, j) => j === i ? { ...x, name: val } : x));
  const addRow = () => setRows((r) => [...r, { name: '', pct: 0, paid: false }]);
  const evenOut = () => setRows((r) => { const per = Math.round(100 / r.length); return r.map((x, i) => ({ ...x, pct: i === r.length - 1 ? 100 - per * (r.length - 1) : per })); });
  const unpaid = rows.filter((x) => !x.paid);
  const total = tab.total;

  const amountFor = (i) => {
    const onlyUnpaidLeft = unpaid.length === 1 && !rows[i].paid;
    if (onlyUnpaidLeft) return tab.remaining;                 // last payer fills the balance
    return Math.min(Math.round(total * (rows[i].pct || 0) / 100), tab.remaining);
  };
  const pctSum = rows.reduce((s, x) => s + (Number(x.pct) || 0), 0);

  const [cashRow, setCashRow] = useState(null);   // which row is paying cash (opens keypad)
  const pay = async (i, tender, cashGiven) => { const ok = await onPay({ amount: amountFor(i), who: rows[i].name, tender, cashGiven }); if (ok) setRows((r) => r.map((x, j) => j === i ? { ...x, paid: true } : x)); };

  return (
    <div className="wtr-card">
      <div className="wtr-card-h">By percentage <button className="wtr-mini" onClick={evenOut}>Even out</button></div>
      {Math.abs(pctSum - 100) > 0.5 && <div className="wtr-warn">Percentages add up to {pctSum}% (should be 100%).</div>}
      {rows.map((row, i) => (
        <div key={i} className={`wtr-pctrow ${row.paid ? 'paid' : ''}`}>
          <input className="wtr-input wtr-pctname" placeholder={`Name ${i + 1}`} value={row.name} onChange={(e) => setName(i, e.target.value)} disabled={row.paid} />
          <div className="wtr-pctpct"><input type="number" value={row.pct} onChange={(e) => setPct(i, e.target.value)} disabled={row.paid} />%</div>
          <div className="wtr-pctamt">{formatMoney(amountFor(i), cur)}</div>
          {row.paid ? <span className="wtr-pctpaid">✓ paid</span> : (
            <div className="wtr-pctbtns">
              {(!payments || payments.cash !== false) && <button disabled={busy} onClick={() => setCashRow(i)}>Cash</button>}
              {(!payments || payments.card !== false) && <button disabled={busy || !hasTerminal} onClick={() => pay(i, 'card')}>Card</button>}
            </div>
          )}
        </div>
      ))}
      <button className="wtr-mini wtr-addrow" onClick={addRow}>+ Add person</button>
      {cashRow != null && <PayDialog target={{ payerId: '', name: rows[cashRow].name || 'Cash', remaining: amountFor(cashRow) }} cur={cur} busy={busy} hasTerminal={hasTerminal} payments={payments} cashOnly onCancel={() => setCashRow(null)} onPay={({ cashGiven }) => { const i = cashRow; setCashRow(null); pay(i, 'cash', cashGiven); }} />}
    </div>
  );
}

// ── Setup: together or split into group tabs? ────────────────────────────────
function SetupChoice({ table, onTogether, onSplit, onCancel }) {
  return (
    <div className="wtr-body">
      <div className="wtr-tabhead"><div className="wtr-tabhead-t">Table {table}</div></div>
      <div className="wtr-card">
        <div className="wtr-card-h">How is this table paying?</div>
        <p className="wtr-muted">Pick now, or change your mind at checkout. Splitting sets up named tabs per group, with shared tabs for things like wine.</p>
        <button className="wtr-primary" onClick={onTogether}>All together · one tab</button>
        <button className="wtr-secondary" onClick={onSplit}>Split · group tabs</button>
      </div>
      <button className="wtr-ghost wtr-back" onClick={onCancel}>‹ Cancel</button>
    </div>
  );
}

// ── Split workspace: group tabs + shared tabs on one table ───────────────────
function SessionView({ api2, cfg, currency, location, sessionId, table, onOrderInto, onBack, setErr }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [card, setCard] = useState(null);
  const [adding, setAdding] = useState(false);      // add-tab editor open
  const [editShared, setEditShared] = useState(null); // shared tab being configured
  const [viewing, setViewing] = useState(null);     // group id whose itemised tab is open
  const [moveMode, setMoveMode] = useState(false);  // show the per-line "move" dropdowns
  const [payTarget, setPayTarget] = useState(null); // { payerId, name, remaining } being paid
  const cardPoll = useCardPoll(api2, data && data.tabId, location, setErr);

  const load = async () => { try { setData(await api2.session(sessionId, location)); } catch (e) { setErr(e.message); } };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [sessionId]);
  if (!data) return <div className="wtr-body"><div className="wtr-muted">Loading table…</div></div>;
  const st = data.state; const cur = st.currency || currency;
  const groups = st.groups || []; const shared = st.shared || []; const adhoc = st.adhoc || [];

  const saveTabs = async (groupsArr, sharedArr) => {
    setBusy(true); setErr('');
    try { const d = await api2.sessionTabs({ sessionId, groups: groupsArr || data.overlay.groups, shared: sharedArr || data.overlay.shared, locationId: location }); setData(d); return d; }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  // One payment toward a payer. `amount` (optional) enables part-cash/part-card;
  // `cashGiven` records the note handed over so change is on the record.
  async function pay(payerId, { amount, tender, cashGiven }) {
    setBusy(true); setErr('');
    try {
      const d = await api2.sessionPay({ sessionId, payerId, amount, tender, cashGiven, locationId: location });
      if (tender === 'card' && d.checkoutId) {
        setCard({ ...d });
        const ok = await cardPoll.wait(d.checkoutId);
        setCard(null);
        if (ok) await api2.sessionMarkPaid({ sessionId, payerId, amount: d.amount, locationId: location });
        else { await load(); return false; }
      }
      setPayTarget(null);
      await load();
      return d;
    } catch (e) { setErr(e.message); setCard(null); return false; } finally { setBusy(false); }
  }

  async function reassign(lineUid, tabId) { if (!tabId) return; setBusy(true); try { setData(await api2.sessionAssign({ sessionId, lineUid, tabId, locationId: location })); } catch (e) { setErr(e.message); } finally { setBusy(false); } }

  const partySummary = (sh) => (sh.parties || []).map((p) => `${p.name} ${sh.mode === 'pct' ? p.weight + '%' : p.weight + (p.weight === 1 ? ' person' : ' people')}`).join(', ') || 'no one yet';
  const allTabs = [...groups.map((g) => ({ id: g.id, name: g.name })), ...shared.map((s) => ({ id: s.id, name: s.name }))];
  const openPay = (payerId, name, remaining) => setPayTarget({ payerId, name, remaining });

  if (card) {
    return (
      <div className="wtr-body">
        <div className="wtr-card wtr-waiting">
          <div className="wtr-spin" />
          <div>Waiting for card on <b>{card.terminalName || 'Terminal'}</b> · {formatMoney(card.amount, cur)}{card.payerName ? ` · ${card.payerName}` : ''}…</div>
          <button className="wtr-secondary" onClick={async () => { try { await api2.cancelCheckout(card.checkoutId); } catch {} setCard(null); setBusy(false); await load(); }}>Cancel</button>
        </div>
      </div>
    );
  }

  // Itemised view of one group's tab — check before paying, dispute a line, and
  // (if wrong) move it. A move must pick a real destination — never limbo.
  // Itemised view of a SHARED tab — what's on it, and how it splits among the
  // people/parties sharing it (each party's amount). Items can be moved too.
  if (viewing && shared.find((x) => x.id === viewing)) {
    const sh = shared.find((x) => x.id === viewing);
    const myLines = (st.lines || []).filter((li) => li.tabId === sh.id);
    const moveTargets = allTabs.filter((t) => t.id !== sh.id);
    const parties = sh.parties || [];
    return (
      <div className="wtr-body">
        <div className="wtr-tabhead"><div className="wtr-tabhead-t">{sh.name} · shared</div><div className="wtr-tabhead-total">{formatMoney(sh.remaining != null ? sh.remaining : sh.total, cur)}{!sh.paid && ' left'}</div></div>
        {sh.paidTotal > 0 && (sh.paid
          ? <div className="wtr-paidnote">✓ Fully paid — {formatMoney(sh.total, cur)}</div>
          : <div className="wtr-paidnote">{formatMoney(sh.paidTotal, cur)} paid · {formatMoney(sh.remaining, cur)} left of {formatMoney(sh.total, cur)}</div>)}
        <div className="wtr-card">
          <div className="wtr-card-h">On this shared tab<button className={`wtr-mini ${moveMode ? 'on' : ''}`} onClick={() => setMoveMode((v) => !v)}>{moveMode ? 'Done moving' : '⇄ Move'}</button></div>
          {myLines.length === 0 && <div className="wtr-muted">No items on this shared tab yet.</div>}
          {myLines.map((li) => (
            <div key={li.uid} className="wtr-liserow">
              <div className="wtr-lise-qty">{li.quantity}</div>
              <div className="wtr-lise-info"><div className="wtr-lise-name">{li.name}</div>{subParts(li.name, li.variation, li.modifiers).length > 0 && <div className="wtr-muted">{subParts(li.name, li.variation, li.modifiers).join(' · ')}</div>}</div>
              <div className="wtr-lise-amt">{formatMoney(li.amount, cur)}</div>
              {moveMode && (
                <select className="wtr-lise-move" value="" onChange={(e) => reassign(li.uid, e.target.value)}>
                  <option value="">Move…</option>
                  {moveTargets.map((t) => <option key={t.id} value={t.id}>→ {t.name}</option>)}
                </select>
              )}
            </div>
          ))}
        </div>
        <div className="wtr-card">
          <div className="wtr-card-h">Who’s paying for it · split {sh.mode === 'pct' ? 'by %' : 'by people'}</div>
          {parties.length === 0 && <div className="wtr-muted">No one added yet — tap “Who shares?” to set it up.</div>}
          {parties.map((p) => (
            <div key={p.id} className={`wtr-liserow ${p.paid ? 'paid' : ''}`}>
              <div className="wtr-lise-info"><div className={`wtr-lise-name ${p.paid ? 'wtr-strike' : ''}`}>{p.name}</div><div className="wtr-muted">{sh.mode === 'pct' ? `${p.weight}%` : `${p.weight} ${p.weight === 1 ? 'person' : 'people'}`}{p.ref ? '' : ' · guest'}</div></div>
              <div className="wtr-lise-amt">{p.paid && <span className="wtr-paidbadge">PAID</span>}<span className={p.paid ? 'wtr-strike' : ''}>{formatMoney(p.amount, cur)}</span></div>
            </div>
          ))}
        </div>
        <div className="wtr-actions">
          <button className="wtr-secondary" onClick={() => onOrderInto(sh.id)}>+ Add items</button>
          <button className="wtr-secondary" onClick={() => setEditShared(sh.id)}>Who shares?</button>
        </div>
        <button className="wtr-ghost wtr-back" onClick={() => setViewing(null)}>‹ Back to table</button>
      </div>
    );
  }

  if (viewing) {
    const g = groups.find((x) => x.id === viewing);
    if (!g) { setViewing(null); return null; }
    const myLines = (st.lines || []).filter((li) => li.tabId === g.id);
    const myShares = shared.map((sh) => ({ sh, party: (sh.parties || []).find((p) => p.ref === g.id) })).filter((x) => x.party);
    const moveTargets = allTabs.filter((t) => t.id !== g.id);
    return (
      <div className="wtr-body">
        <div className="wtr-tabhead"><div className="wtr-tabhead-t">{g.name}’s tab</div><div className="wtr-tabhead-total">{formatMoney(g.owed, cur)}</div></div>
        {g.paidAmount > 0 && <div className="wtr-paidnote">{formatMoney(g.paidAmount, cur)} paid · {formatMoney(g.remaining, cur)} left</div>}
        <div className="wtr-card">
          <div className="wtr-card-h">Their order<button className={`wtr-mini ${moveMode ? 'on' : ''}`} onClick={() => setMoveMode((v) => !v)} title="Move items to dispute">{moveMode ? 'Done moving' : '⇄ Move'}</button></div>
          {moveMode && <div className="wtr-muted" style={{ fontSize: 12 }}>Pick a destination to move a disputed item to another tab.</div>}
          {myLines.length === 0 && <div className="wtr-muted">No items on this tab yet.</div>}
          {myLines.map((li) => (
            <div key={li.uid} className="wtr-liserow">
              <div className="wtr-lise-qty">{li.quantity}</div>
              <div className="wtr-lise-info">
                <div className="wtr-lise-name">{li.name}</div>
                {subParts(li.name, li.variation, li.modifiers).length > 0 && <div className="wtr-muted">{subParts(li.name, li.variation, li.modifiers).join(' · ')}</div>}
              </div>
              <div className="wtr-lise-amt">{formatMoney(li.amount, cur)}</div>
              {moveMode && (
                <select className="wtr-lise-move" value="" onChange={(e) => reassign(li.uid, e.target.value)}>
                  <option value="">Move…</option>
                  {moveTargets.map((t) => <option key={t.id} value={t.id}>→ {t.name}</option>)}
                </select>
              )}
            </div>
          ))}
        </div>

        {/* Full breakdown of every shared tab this group is on: what's on it, the
            cost, and how this group's share compares to the others sharing it. */}
        {myShares.map(({ sh, party }) => {
          const shItems = (st.lines || []).filter((li) => li.tabId === sh.id);
          return (
            <div className="wtr-card" key={sh.id}>
              <div className="wtr-card-h">{sh.name} · shared<span className="wtr-grp-owed">{formatMoney(party.amount, cur)}</span></div>
              <div className="wtr-muted" style={{ fontSize: 12, marginBottom: 4 }}>{g.name}’s share of a {formatMoney(sh.total, cur)} tab, split {sh.mode === 'pct' ? 'by %' : 'by people'}.</div>
              {shItems.map((li) => (
                <div key={li.uid} className="wtr-liserow">
                  <div className="wtr-lise-qty">{li.quantity}</div>
                  <div className="wtr-lise-info"><div className="wtr-lise-name">{li.name}</div>{subParts(li.name, li.variation, li.modifiers).length > 0 && <div className="wtr-muted">{subParts(li.name, li.variation, li.modifiers).join(' · ')}</div>}</div>
                  <div className="wtr-lise-amt">{formatMoney(li.amount, cur)}</div>
                </div>
              ))}
              <div className="wtr-card-h" style={{ marginTop: 8, fontSize: 12 }}>Split between</div>
              {(sh.parties || []).map((pp) => (
                <div key={pp.id} className={`wtr-liserow ${pp.id === party.id ? 'wtr-mine' : ''} ${pp.paid ? 'paid' : ''}`}>
                  <div className="wtr-lise-info"><div className={`wtr-lise-name ${pp.paid ? 'wtr-strike' : ''}`}>{pp.name}{pp.id === party.id ? ' (this group)' : ''}</div><div className="wtr-muted">{sh.mode === 'pct' ? `${pp.weight}%` : `${pp.weight} ${pp.weight === 1 ? 'person' : 'people'}`}{pp.ref ? '' : ' · guest'}</div></div>
                  <div className="wtr-lise-amt">{pp.paid && <span className="wtr-paidbadge">PAID</span>}<span className={pp.paid ? 'wtr-strike' : ''}>{formatMoney(pp.amount, cur)}</span></div>
                </div>
              ))}
            </div>
          );
        })}

        {!g.paid ? (
          <div className="wtr-actions">
            <button className="wtr-secondary" onClick={() => onOrderInto(g.id)}>+ Add items</button>
            <button className="wtr-primary" disabled={g.remaining <= 0} onClick={() => openPay(g.id, g.name, g.remaining)}>Pay {formatMoney(g.remaining, cur)}</button>
          </div>
        ) : <div className="wtr-paidnote">✓ This tab is fully paid.</div>}
        <button className="wtr-ghost wtr-back" onClick={() => setViewing(null)}>‹ Back to table</button>
        {payTarget && <PayDialog target={payTarget} cur={cur} busy={busy} hasTerminal={data.hasTerminal} payments={cfg.payments} onCancel={() => setPayTarget(null)} onPay={(opts) => pay(payTarget.payerId, opts)} />}
      </div>
    );
  }

  return (
    <div className="wtr-body">
      <div className="wtr-tabhead">
        <div className="wtr-tabhead-t">Table {table} · split</div>
        <div className="wtr-tabhead-total">{formatMoney(st.remaining, cur)} <span className="wtr-muted">left</span></div>
      </div>
      {st.total > 0 && st.remaining <= 0 && <div className="wtr-paidnote">All settled — {formatMoney(st.total, cur)} paid. <button className="wtr-ghost" onClick={onBack}>Close table ›</button></div>}
      {st.unassignedTotal > 0 && <div className="wtr-warn">{formatMoney(st.unassignedTotal, cur)} of items aren’t on a tab yet — open a group’s “View order”, tap Move, and assign them.</div>}

      {/* Group tabs */}
      {groups.map((g) => (
        <div key={g.id} className={`wtr-card wtr-grp ${g.paid ? 'paid' : ''}`}>
          <div className="wtr-grp-head">
            <div><b>{g.name}</b> <span className="wtr-muted">· {g.people} {g.people === 1 ? 'person' : 'people'}</span></div>
            <div className="wtr-grp-owed">{formatMoney(g.owed, cur)}</div>
          </div>
          <div className="wtr-muted wtr-grp-break">Items {formatMoney(g.itemsTotal, cur)}{g.sharedShare > 0 ? ` · share of shared ${formatMoney(g.sharedShare, cur)}` : ''}{g.paidAmount > 0 && !g.paid ? ` · ${formatMoney(g.paidAmount, cur)} paid` : ''}</div>
          {g.paid ? <div className="wtr-pctpaid">✓ Paid</div> : (
            <div className="wtr-grp-btns">
              <button className="wtr-secondary" onClick={() => onOrderInto(g.id)}>+ Items</button>
              <button className="wtr-secondary" onClick={() => { setMoveMode(false); setViewing(g.id); }}>View order{(() => { const n = (st.lines || []).filter((li) => li.tabId === g.id).reduce((s, li) => s + (Number(li.quantity) || 1), 0); return n ? ` (${n})` : ''; })()}</button>
              <button className="wtr-primary" disabled={busy || g.remaining <= 0} onClick={() => openPay(g.id, g.name, g.remaining)}>Pay {g.remaining > 0 ? formatMoney(g.remaining, cur) : ''}</button>
            </div>
          )}
        </div>
      ))}

      {/* Shared tabs */}
      {shared.map((sh) => (
        <div key={sh.id} className={`wtr-card wtr-shared ${sh.paid ? 'paid' : ''}`}>
          <div className="wtr-grp-head">
            <div><b>{sh.name}</b> <span className="wtr-muted">· shared</span></div>
            <div className="wtr-grp-owed">{sh.paid && <span className="wtr-paidbadge">PAID</span>}{formatMoney(sh.remaining != null ? sh.remaining : sh.total, cur)}</div>
          </div>
          <div className="wtr-muted wtr-grp-break">Split {sh.mode === 'pct' ? 'by %' : 'by people'}: {partySummary(sh)}</div>
          {sh.paidTotal > 0 && !sh.paid && <div className="wtr-muted wtr-grp-break">{formatMoney(sh.paidTotal, cur)} paid · {formatMoney(sh.remaining, cur)} left of {formatMoney(sh.total, cur)}</div>}
          <div className="wtr-grp-btns">
            <button className="wtr-secondary" onClick={() => onOrderInto(sh.id)}>+ Items</button>
            <button className="wtr-secondary" onClick={() => { setMoveMode(false); setViewing(sh.id); }}>View order{(() => { const n = (st.lines || []).filter((li) => li.tabId === sh.id).reduce((s, li) => s + (Number(li.quantity) || 1), 0); return n ? ` (${n})` : ''; })()}</button>
            <button className="wtr-secondary" onClick={() => setEditShared(sh.id)}>Who shares?</button>
          </div>
          {/* Ad-hoc guests on this shared tab pay their own share */}
          {(sh.parties || []).filter((p) => !p.ref).map((p) => (
            <div key={p.id} className={`wtr-adhoc ${p.paid ? 'paid' : ''}`}>
              <span className={p.paid ? 'wtr-strike' : ''}>{p.name} · {formatMoney(p.amount, cur)}{p.paidAmount > 0 && !p.paid ? ` (${formatMoney(p.remaining, cur)} left)` : ''}</span>
              {p.paid ? <span className="wtr-paidbadge">PAID</span> : (
                <button className="wtr-mini" disabled={busy || p.remaining <= 0} onClick={() => openPay(p.id, p.name, p.remaining)}>Pay</button>
              )}
            </div>
          ))}
        </div>
      ))}

      <button className="wtr-secondary" onClick={() => setAdding(true)}>+ Add tab</button>

      {adding && <AddTabEditor onCancel={() => setAdding(false)} onAdd={async (tab) => {
        if (tab.kind === 'group') await saveTabs([...data.overlay.groups, { name: tab.name, people: tab.people }], null);
        else await saveTabs(null, [...data.overlay.shared, { name: tab.name, mode: 'parts', parties: [] }]);
        setAdding(false);
      }} />}

      {editShared && <SharedEditor
        shared={data.overlay.shared.find((s) => s.id === editShared)}
        groups={data.overlay.groups}
        onClose={() => setEditShared(null)}
        onSave={async (updated) => { await saveTabs(null, data.overlay.shared.map((s) => s.id === updated.id ? updated : s)); setEditShared(null); }} />}

      {payTarget && <PayDialog target={payTarget} cur={cur} busy={busy} hasTerminal={data.hasTerminal} payments={cfg.payments} onCancel={() => setPayTarget(null)} onPay={(opts) => pay(payTarget.payerId, opts)} />}

      <button className="wtr-ghost wtr-back" onClick={onBack}>‹ Back to tables</button>
    </div>
  );
}

// Pay dialog for a group or guest: pay the whole balance or a part (so a bill can
// go part cash + part card), and for cash enter what was handed over so the
// change is calculated and recorded — no "what note did you give me?".
function PayDialog({ target, cur, busy, hasTerminal, cashOnly, payments, onCancel, onPay }) {
  const pay = payments || { card: true, cash: true };
  const cardOk = !cashOnly && pay.card && hasTerminal;
  const cashOk = pay.cash;
  const [tender, setTender] = useState(cashOnly ? 'cash' : (cardOk ? 'card' : 'cash'));
  const [amtStr, setAmtStr] = useState(((target.remaining || 0) / 100).toFixed(2));
  const [givenC, setGivenC] = useState(0);           // cash received, in cents (keypad builds it)
  const amount = cashOnly ? target.remaining : Math.round((parseFloat(amtStr) || 0) * 100);
  const overMax = !cashOnly && amount > target.remaining;
  const change = Math.max(0, givenC - amount);
  const short = tender === 'cash' && givenC > 0 && givenC < amount;
  const partial = !cashOnly && amount > 0 && amount < target.remaining;
  const go = () => onPay({ amount, tender, cashGiven: tender === 'cash' ? (givenC || amount) : undefined });
  // Cash quick-tender: Exact, then the AUD notes AT OR ABOVE the amount — the next
  // notes a customer would hand over. Capped at $100 (never suggest $200), and no
  // note smaller than the bill (they can't cover it). $9 → Exact,$10,$20,$50,$100.
  const notes = [5, 10, 20, 50, 100].map((n) => n * 100).filter((c) => c >= amount);
  const quick = [{ label: 'Exact', v: amount }, ...notes.map((c) => ({ label: `$${c / 100}`, v: c }))];
  const keyIn = (d) => setGivenC((c) => Math.min(c * 10 + d, 99999999));
  const key00 = () => setGivenC((c) => Math.min(c * 100, 99999999));
  const back = () => setGivenC((c) => Math.floor(c / 10));
  const showToggle = !cashOnly && cardOk && cashOk;
  return (
    <div className="wtr-scrim" onClick={onCancel}>
      <div className="wtr-dialog" onClick={(e) => e.stopPropagation()}>
        <button className="wtr-dialog-x" onClick={onCancel} aria-label="Close"><IconX s={18} /></button>
        <div className="wtr-card-h">{cashOnly ? 'Cash' : 'Pay'} · {target.name}</div>
        <div className="wtr-muted">{formatMoney(target.remaining, cur)} {cashOnly ? 'to pay' : 'left on this tab'}.</div>
        {showToggle && (
          <div className="wtr-methods">
            <button className={`wtr-method ${tender === 'card' ? 'on' : ''}`} onClick={() => setTender('card')}>Card</button>
            <button className={`wtr-method ${tender === 'cash' ? 'on' : ''}`} onClick={() => setTender('cash')}>Cash</button>
          </div>
        )}
        {!cashOnly && !cardOk && cashOk && <div className="wtr-muted">{pay.card ? 'No card reader here' : 'Card is off for this store'} — taking cash.</div>}
        {!cashOnly && <>
          <label className="wtr-fieldlabel">Amount to pay now</label>
          <div className="wtr-row">
            <input className="wtr-input" inputMode="decimal" value={amtStr} onChange={(e) => setAmtStr(e.target.value.replace(/[^\d.]/g, ''))} />
            <button className="wtr-mini" onClick={() => setAmtStr(((target.remaining || 0) / 100).toFixed(2))}>All</button>
          </div>
        </>}
        {partial && <div className="wtr-muted">Part payment — {formatMoney(target.remaining - amount, cur)} will stay on the tab (pay the rest another way).</div>}
        {overMax && <div className="wtr-warn">That’s more than the {formatMoney(target.remaining, cur)} left.</div>}
        {tender === 'cash' && (
          <>
            <label className="wtr-fieldlabel">Cash received</label>
            <div className="wtr-chips">
              {quick.map((p, i) => <button key={i} className={`wtr-chip ${givenC === p.v ? 'on' : ''}`} onClick={() => setGivenC(p.v)}>{p.label}</button>)}
            </div>
            <div className="wtr-cashshow">
              <span className="wtr-muted">Received</span>
              <b>{formatMoney(givenC, cur)}</b>
              {givenC > 0 && <button className="wtr-cashclear" onClick={() => setGivenC(0)} aria-label="Clear cash"><IconX s={15} /></button>}
            </div>
            <div className="wtr-pad wtr-cashpad">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => <button key={n} onClick={() => keyIn(n)}>{n}</button>)}
              <button onClick={key00}>00</button>
              <button onClick={() => keyIn(0)}>0</button>
              <button className="wtr-pad-min" onClick={back} aria-label="Backspace">⌫</button>
            </div>
            {givenC > 0 && (short
              ? <div className="wtr-warn">Short by {formatMoney(amount - givenC, cur)} — add more or Clear.</div>
              : <div className="wtr-changeline">Change: <b>{formatMoney(change, cur)}</b> <span className="wtr-muted">(received {formatMoney(givenC, cur)} for {formatMoney(amount, cur)})</span></div>)}
          </>
        )}
        <div className="wtr-payrow">
          <button className="wtr-secondary" onClick={onCancel}>Cancel</button>
          <button className="wtr-primary" disabled={busy || amount <= 0 || overMax || short || (tender === 'card' && !cardOk)} onClick={go}>
            {tender === 'card' ? 'Charge card' : 'Take cash'} · {formatMoney(amount, cur)}
          </button>
        </div>
      </div>
    </div>
  );
}

// Add a group or a shared tab.
function AddTabEditor({ onAdd, onCancel }) {
  const [kind, setKind] = useState('group');
  const [name, setName] = useState('');
  const [people, setPeople] = useState(1);
  return (
    <div className="wtr-card">
      <div className="wtr-card-h">Add a tab</div>
      <div className="wtr-methods">
        <button className={`wtr-method ${kind === 'group' ? 'on' : ''}`} onClick={() => setKind('group')}>Group</button>
        <button className={`wtr-method ${kind === 'shared' ? 'on' : ''}`} onClick={() => setKind('shared')}>Shared</button>
      </div>
      <input className="wtr-input" placeholder={kind === 'group' ? 'Name (e.g. Shaun)' : 'Shared name (e.g. Wine)'} value={name} onChange={(e) => setName(e.target.value)} />
      {kind === 'group' && (
        <div className="wtr-row wtr-people"><span>People in this group</span>
          <div className="wtr-qty"><button onClick={() => setPeople((x) => Math.max(1, x - 1))}>−</button><span>{people}</span><button onClick={() => setPeople((x) => Math.min(99, x + 1))}>+</button></div>
        </div>
      )}
      <div className="wtr-payrow">
        <button className="wtr-secondary" onClick={onCancel}>Cancel</button>
        <button className="wtr-primary" disabled={!name.trim()} onClick={() => onAdd({ kind, name: name.trim(), people })}>Add {kind}</button>
      </div>
    </div>
  );
}

// Configure who shares a shared tab and by how much (parts or %). Groups can be
// included (weight defaults to their head-count) and ad-hoc guests added.
function SharedEditor({ shared, groups, onSave, onClose }) {
  const [mode, setMode] = useState(shared.mode || 'parts');
  const [parties, setParties] = useState(() => shared.parties || []);
  const has = (ref) => parties.some((p) => p.ref === ref);
  const toggleGroup = (g) => setParties((ps) => has(g.id) ? ps.filter((p) => p.ref !== g.id) : [...ps, { ref: g.id, name: g.name, weight: mode === 'pct' ? 0 : (g.people || 1) }]);
  const setWeight = (idx, v) => setParties((ps) => ps.map((p, i) => i === idx ? { ...p, weight: Math.max(0, Number(v) || 0) } : p));
  const setGuestName = (idx, v) => setParties((ps) => ps.map((p, i) => i === idx ? { ...p, name: v } : p));
  const addGuest = () => setParties((ps) => [...ps, { ref: null, name: '', weight: mode === 'pct' ? 0 : 1 }]);
  const removeParty = (idx) => setParties((ps) => ps.filter((_, i) => i !== idx));
  const pctSum = mode === 'pct' ? parties.reduce((s, p) => s + (Number(p.weight) || 0), 0) : null;
  return (
    <div className="wtr-card">
      <div className="wtr-card-h">Who shares “{shared.name}”?</div>
      <div className="wtr-methods">
        <button className={`wtr-method ${mode === 'parts' ? 'on' : ''}`} onClick={() => setMode('parts')}>By people</button>
        <button className={`wtr-method ${mode === 'pct' ? 'on' : ''}`} onClick={() => setMode('pct')}>By %</button>
      </div>
      <div className="wtr-muted">Tap groups to include them; set how many people from each (or percentages). Add guests who aren’t in a group.</div>
      <div className="wtr-tables">
        {groups.map((g) => <button key={g.id} className={`wtr-tablechip ${has(g.id) ? 'on' : ''}`} onClick={() => toggleGroup(g)}>{g.name}</button>)}
      </div>
      {parties.map((p, i) => (
        <div key={i} className="wtr-pctrow">
          {p.ref ? <div className="wtr-pctname"><b>{p.name}</b></div>
            : <input className="wtr-input wtr-pctname" placeholder={`Guest ${i + 1}`} value={p.name} onChange={(e) => setGuestName(i, e.target.value)} />}
          <div className="wtr-pctpct"><input type="number" value={p.weight} onChange={(e) => setWeight(i, e.target.value)} />{mode === 'pct' ? '%' : 'ppl'}</div>
          <button className="wtr-x" onClick={() => removeParty(i)}>✕</button>
        </div>
      ))}
      {pctSum != null && Math.abs(pctSum - 100) > 0.5 && parties.length > 0 && <div className="wtr-warn">Percentages add to {pctSum}% (aim for 100%). Any shortfall/overage is spread proportionally.</div>}
      <button className="wtr-mini wtr-addrow" onClick={addGuest}>+ Add guest</button>
      <div className="wtr-payrow">
        <button className="wtr-secondary" onClick={onClose}>Cancel</button>
        <button className="wtr-primary" onClick={() => onSave({ ...shared, mode, parties })}>Save</button>
      </div>
    </div>
  );
}

// A cash/card pay button pair with the amount baked in.
function PayRow({ amount, cur, busy, hasTerminal, payments, onPay, disabled }) {
  const pm = payments || { card: true, cash: true };
  const [cashOpen, setCashOpen] = useState(false);
  return (
    <div className="wtr-payrow">
      {pm.cash !== false && <button className="wtr-secondary" disabled={busy || disabled || amount <= 0} onClick={() => setCashOpen(true)}>Cash · {formatMoney(amount, cur)}</button>}
      {pm.card !== false && <button className="wtr-primary" disabled={busy || disabled || amount <= 0 || !hasTerminal} onClick={() => onPay('card')}>Card · {formatMoney(amount, cur)}</button>}
      {cashOpen && <PayDialog target={{ payerId: '', name: 'Cash', remaining: amount }} cur={cur} busy={busy} hasTerminal={hasTerminal} payments={payments} cashOnly onCancel={() => setCashOpen(false)} onPay={({ cashGiven }) => { setCashOpen(false); onPay('cash', cashGiven); }} />}
    </div>
  );
}

// Poll a Terminal checkout to completion. Resolves true on paid, false otherwise.
function useCardPoll(api2, tabId, location, setErr) {
  const ref = useRef();
  return {
    wait: (checkoutId) => new Promise((resolve) => {
      let tries = 0;
      const tick = async () => {
        tries += 1;
        try {
          const s = await api2.checkout(checkoutId, tabId);
          if (s.status === 'paid') return resolve(true);
          if (s.status === 'canceled') { setErr('Card payment was cancelled.'); return resolve(false); }
        } catch (e) { /* keep trying */ }
        if (tries > 80) { setErr('Card payment timed out.'); return resolve(false); }
        ref.current = setTimeout(tick, 2500);
      };
      tick();
    }),
    stop: () => { try { clearTimeout(ref.current); } catch {} },
  };
}

function WaiterStyle() {
  return (
    <style>{`
    /* Waiter mode uses its OWN fixed, high-contrast palette so a store's theme
       (e.g. a blue storefront) can never wash the screen out or hide buttons. */
    .wtr-root{--bg:#f3f1f4;--surface:#ffffff;--text:#1a151d;--muted:#6b646f;--line:#e5dee6;--brand:#0f6f59;
      position:fixed;inset:0;background:#f3f1f4;color:#1a151d;font-family:inherit;display:flex;flex-direction:column;z-index:60;overflow:hidden;overscroll-behavior:none}
    .wtr-root *{-webkit-tap-highlight-color:transparent}
    .wtr-body{overscroll-behavior:contain}
    .wtr-cart-list{overscroll-behavior:contain}
    .wtr-center{align-items:center;justify-content:center}
    .wtr-spin{width:34px;height:34px;border:3px solid var(--line,#e7dfe4);border-top-color:var(--brand,#7a2e57);border-radius:50%;animation:wtrspin .8s linear infinite}
    @keyframes wtrspin{to{transform:rotate(360deg)}}
    .wtr-top{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--line,#e7dfe4);background:var(--surface,#fff)}
    .wtr-title{flex:1;text-align:center;font-weight:800;font-size:16px}
    .wtr-top-right{display:flex;align-items:center;gap:8px}
    .wtr-loc{border:1px solid var(--line,#e7dfe4);border-radius:8px;padding:6px 8px;background:var(--bg,#fff);color:inherit;font-size:13px}
    .wtr-ghost{background:none;border:none;color:var(--brand,#7a2e57);font-weight:700;font-size:14px;cursor:pointer;padding:6px}
    .wtr-err{background:#fdecef;color:#a11;padding:10px 14px;font-size:13px;cursor:pointer}
    .wtr-body{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:12px}
    .wtr-muted{color:var(--muted,#8a8189);font-size:13px}
    .wtr-primary{background:var(--brand,#7a2e57);color:#fff;border:none;border-radius:12px;padding:14px 16px;font-weight:800;font-size:15px;cursor:pointer}
    .wtr-primary:disabled{opacity:.55}
    .wtr-secondary{background:var(--surface,#fff);color:var(--brand,#7a2e57);border:1.5px solid var(--brand,#7a2e57);border-radius:12px;padding:13px 16px;font-weight:800;font-size:15px;cursor:pointer}
    .wtr-secondary:disabled{opacity:.5}
    .wtr-new{position:sticky;top:0}
    .wtr-card{background:var(--surface,#fff);border:1px solid var(--line,#e7dfe4);border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:10px}
    .wtr-card-h{font-weight:800;font-size:14px;display:flex;justify-content:space-between;align-items:center}
    .wtr-row{display:flex;gap:8px;align-items:center}
    .wtr-input{flex:1;border:1px solid var(--line,#e7dfe4);border-radius:10px;padding:11px 12px;font-size:15px;background:var(--bg,#fff);color:inherit;width:100%}
    .wtr-tables{display:flex;flex-wrap:wrap;gap:8px}
    .wtr-tablechip{border:1.5px solid var(--brand,#7a2e57);color:var(--brand,#7a2e57);background:var(--surface,#fff);border-radius:10px;padding:10px 14px;font-weight:800;cursor:pointer;min-width:52px}
    .wtr-sec{font-weight:800;font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted,#8a8189);margin-top:4px}
    .wtr-tablist{display:flex;flex-direction:column;gap:8px}
    .wtr-tab{display:flex;align-items:center;justify-content:space-between;background:var(--surface,#fff);border:1px solid var(--line,#e7dfe4);border-radius:12px;padding:14px;cursor:pointer;text-align:left}
    .wtr-tab-table{font-weight:800;font-size:15px}
    .wtr-tab-total{font-weight:800;font-size:16px;color:var(--brand,#7a2e57)}
    .wtr-tab-empty{padding:0;overflow:hidden;border-style:dashed;background:var(--surface,#fff)}
    .wtr-tab-main{flex:1;display:flex;align-items:center;justify-content:space-between;gap:10px;background:none;border:0;padding:14px;cursor:pointer;text-align:left;color:inherit;font:inherit}
    .wtr-tab-badge{font-weight:800;font-size:12px;letter-spacing:.03em;text-transform:uppercase;color:var(--brand,#7a2e57);border:1.5px solid var(--brand,#7a2e57);border-radius:999px;padding:3px 10px;white-space:nowrap}
    .wtr-tab-close{flex:none;align-self:stretch;display:flex;align-items:center;justify-content:center;width:52px;background:none;border:0;border-left:1px solid var(--line,#e7dfe4);color:var(--muted,#8a7f86);cursor:pointer}
    .wtr-tab-close:disabled{opacity:.5;cursor:default}
    .wtr-tab-close:active{background:rgba(0,0,0,.05)}
    .wtr-build-head{display:flex;justify-content:space-between;align-items:center}
    .wtr-build-table{font-weight:800}
    .wtr-catnav{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px}
    .wtr-catbtn{white-space:nowrap;border:1px solid var(--line,#e7dfe4);background:var(--surface,#fff);color:inherit;border-radius:20px;padding:8px 14px;font-weight:700;font-size:13px;cursor:pointer}
    .wtr-catbtn.on{background:var(--brand,#7a2e57);color:#fff;border-color:var(--brand,#7a2e57)}
    .wtr-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:10px}
    .wtr-tile{background:var(--surface,#fff);border:1px solid var(--line,#e7dfe4);border-radius:12px;padding:8px;cursor:pointer;display:flex;flex-direction:column;gap:4px;align-items:center;text-align:center}
    .wtr-tile img,.wtr-tile-noimg{width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;background:var(--bg,#f2ecef)}
    .wtr-tile-name{font-size:12px;font-weight:700;line-height:1.15}
    .wtr-tile-price{font-size:12px;color:var(--muted,#8a8189)}
    .wtr-round{position:sticky;bottom:0;background:var(--surface,#fff);border:1px solid var(--line,#e7dfe4);border-radius:14px;padding:10px;display:flex;flex-direction:column;gap:8px;box-shadow:0 -6px 18px rgba(0,0,0,.08)}
    .wtr-round-list{display:flex;flex-direction:column;gap:6px;max-height:34vh;overflow-y:auto}
    .wtr-round-line{display:flex;align-items:center;gap:8px}
    .wtr-round-info{flex:1;min-width:0}
    .wtr-round-name{font-weight:700;font-size:14px}
    .wtr-round-amt{font-weight:700;font-size:14px}
    .wtr-qty{display:flex;align-items:center;gap:6px}
    .wtr-qty button{width:28px;height:28px;border-radius:8px;border:1px solid var(--line,#e7dfe4);background:var(--bg,#fff);font-size:16px;font-weight:800;cursor:pointer;color:inherit}
    .wtr-x{background:none;border:none;color:var(--muted,#8a8189);font-size:15px;cursor:pointer}
    .wtr-send{width:100%}
    .wtr-tabhead{display:flex;justify-content:space-between;align-items:center}
    .wtr-tabhead-t{font-weight:800;font-size:17px}
    .wtr-tabhead-total{font-weight:800;font-size:18px;color:var(--brand,#7a2e57)}
    .wtr-itemlist{display:flex;flex-direction:column;gap:8px}
    .wtr-itemrow,.wtr-tickrow{display:flex;align-items:center;gap:10px}
    .wtr-itemqty{font-weight:800;color:var(--muted,#8a8189);min-width:26px}
    .wtr-iteminfo{flex:1;min-width:0;font-size:14px}
    .wtr-iteminfo>div:first-child{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .wtr-itemamt{font-weight:700;flex:none;white-space:nowrap}
    .wtr-tickrow{background:var(--bg,#faf7f8);border:1px solid var(--line,#e7dfe4);border-radius:10px;padding:8px 10px;cursor:pointer}
    .wtr-tickrow input{width:20px;height:20px}
    .wtr-paidnote{background:#eef7ef;color:#276b3a;border-radius:10px;padding:8px 12px;font-size:13px;font-weight:700}
    .wtr-actions{display:flex;gap:10px}
    .wtr-actions>*{flex:1}
    .wtr-back{align-self:flex-start}
    .wtr-paygrid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .wtr-pay{display:flex;flex-direction:column;align-items:center;gap:6px;padding:18px;border-radius:14px;border:1.5px solid var(--line,#e7dfe4);background:var(--surface,#fff);color:inherit;font-weight:800;font-size:15px;cursor:pointer}
    .wtr-pay:disabled{opacity:.5}
    .wtr-pay-i{font-size:26px}
    .wtr-split{width:100%}
    .wtr-waiting{align-items:center;text-align:center;gap:14px;padding:26px}
    .wtr-methods{display:flex;gap:6px}
    .wtr-method{flex:1;border:1px solid var(--line,#e7dfe4);background:var(--surface,#fff);color:inherit;border-radius:10px;padding:10px;font-weight:800;font-size:13px;cursor:pointer}
    .wtr-method.on{background:var(--brand,#7a2e57);color:#fff;border-color:var(--brand,#7a2e57)}
    .wtr-paidlist{display:flex;flex-wrap:wrap;gap:6px}
    .wtr-paidchip{display:inline-flex;align-items:center;gap:6px;background:#eef7ef;color:#276b3a;border-radius:20px;padding:5px 10px;font-size:12px;font-weight:700}
    .wtr-chip-print{display:inline-flex;align-items:center;justify-content:center;border:0;background:rgba(39,107,58,.14);color:#276b3a;border-radius:999px;width:24px;height:24px;cursor:pointer;padding:0}
    .wtr-chip-print:disabled{opacity:.5;cursor:default}
    .wtr-payrow{display:flex;gap:8px}
    .wtr-payrow>*{flex:1}
    .wtr-people{justify-content:space-between}
    .wtr-evenline{font-size:14px}
    .wtr-pctrow{display:flex;align-items:center;gap:8px}
    .wtr-pctrow.paid{opacity:.6}
    .wtr-pctname{flex:1;min-width:0}
    .wtr-pctpct{display:flex;align-items:center;gap:2px;font-weight:700}
    .wtr-pctpct input{width:52px;border:1px solid var(--line,#e7dfe4);border-radius:8px;padding:8px;font-size:14px;text-align:right;background:var(--bg,#fff);color:inherit}
    .wtr-pctamt{font-weight:700;min-width:64px;text-align:right}
    .wtr-pctbtns{display:flex;gap:4px}
    .wtr-pctbtns button{border:1px solid var(--brand,#7a2e57);color:var(--brand,#7a2e57);background:var(--surface,#fff);border-radius:8px;padding:8px 10px;font-weight:800;font-size:12px;cursor:pointer}
    .wtr-pctpaid{color:#276b3a;font-weight:800;font-size:13px}
    .wtr-paidbadge{display:inline-block;background:#276b3a;color:#fff;border-radius:999px;padding:2px 8px;font-size:11px;font-weight:800;letter-spacing:.03em;margin-right:6px;vertical-align:middle}
    .wtr-strike{text-decoration:line-through;opacity:.55}
    .wtr-itempaid{opacity:.9;align-items:center;gap:8px}
    .wtr-itempaid .wtr-paidbadge{flex:none}
    .wtr-adhoc.paid{opacity:.75}
    .wtr-liserow.paid .wtr-lise-amt{white-space:nowrap}
    .wtr-mini{border:1px solid var(--line,#e7dfe4);background:var(--bg,#fff);border-radius:8px;padding:5px 10px;font-size:12px;font-weight:700;cursor:pointer;color:inherit}
    .wtr-addrow{align-self:flex-start}
    .wtr-warn{background:#fff6e6;color:#8a5a00;border-radius:8px;padding:6px 10px;font-size:12px}
    .wtr-grp.paid{opacity:.6}
    .wtr-grp-head{display:flex;justify-content:space-between;align-items:center}
    .wtr-grp-owed{font-weight:800;font-size:16px;color:var(--brand,#7a2e57)}
    .wtr-grp-break{font-size:12px}
    .wtr-grp-btns{display:flex;gap:6px}
    .wtr-grp-btns>*{flex:1;padding:11px 8px;font-size:13px}
    .wtr-shared{border-style:dashed}
    .wtr-shared.paid{opacity:.6}
    .wtr-adhoc{display:flex;justify-content:space-between;align-items:center;background:var(--bg,#faf7f8);border-radius:8px;padding:7px 10px;font-size:13px}
    .wtr-tablechip.on{background:var(--brand,#7a2e57);color:#fff}
    .wtr-assign{flex-basis:100%;margin-top:4px;padding:8px}
    .wtr-who{font-weight:500;opacity:.85;font-size:13px;background:none;border:none;color:inherit;cursor:pointer;padding:0}
    .wtr-sec-row{display:flex;justify-content:space-between;align-items:center;margin-top:4px}
    .wtr-seg{display:flex;border:1px solid var(--line,#e7dfe4);border-radius:8px;overflow:hidden}
    .wtr-seg button{border:none;background:var(--surface,#fff);color:inherit;padding:6px 14px;font-weight:700;font-size:13px;cursor:pointer}
    .wtr-seg button.on{background:var(--brand,#7a2e57);color:#fff}
    .wtr-dispute .wtr-assign{flex-basis:auto;width:auto;margin-top:0;max-width:120px}
    .wtr-unassigned{background:#fff6e6;border-radius:8px;padding:6px 8px}
    .wtr-scrim{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:flex-end;justify-content:center;z-index:70}
    .wtr-dialog{background:var(--surface,#fff);border-radius:16px 16px 0 0;padding:16px;width:100%;max-width:480px;display:flex;flex-direction:column;gap:10px;max-height:88vh;overflow-y:auto}
    @media(min-width:520px){.wtr-scrim{align-items:center}.wtr-dialog{border-radius:16px}}
    .wtr-fieldlabel{font-size:12px;font-weight:700;color:var(--muted,#8a8189);margin-top:2px}
    .wtr-changeline{background:#eef7ef;color:#276b3a;border-radius:8px;padding:8px 10px;font-size:14px}
    .wtr-dialog-x{position:absolute;top:10px;right:12px;width:34px;height:34px;border:0;background:none;color:var(--muted,#8a8189);display:flex;align-items:center;justify-content:center;cursor:pointer;border-radius:8px}
    .wtr-dialog{position:relative}
    .wtr-cashshow{display:flex;align-items:center;gap:10px;background:var(--bg,#faf7f8);border-radius:10px;padding:10px 12px;font-size:18px}
    .wtr-cashshow b{margin-left:auto;font-size:22px}
    .wtr-cashclear{margin-left:0;width:30px;height:30px;border:1px solid var(--line,#e7dfe4);background:var(--surface,#fff);border-radius:8px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:inherit}
    .wtr-cashpad{grid-template-columns:repeat(3,1fr);gap:8px;margin-top:2px}
    .wtr-cashpad button{height:52px;border-radius:12px;font-size:20px}
    .wtr-iconbtn{display:inline-flex;align-items:center;justify-content:center}
    .wtr-pay-i{display:inline-flex}
    /* Menu list view (no image tiles) */
    .wtr-menulist{display:flex;flex-direction:column;gap:2px;flex:1;min-height:0}
    /* Build screen: fixed header/search, scrolling menu, cart pinned at bottom */
    .wtr-build{overflow:hidden !important;padding-bottom:0 !important}
    .wtr-head-actions{display:flex;align-items:center;gap:6px}
    .wtr-searchrow{display:flex;align-items:center;gap:8px;background:var(--surface,#fff);border:1px solid var(--line,#e5dee6);border-radius:10px;padding:0 10px;flex:none}
    .wtr-searchrow .wtr-search{border:none;padding:10px 4px;background:none;flex:1}
    .wtr-menuscroll{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:3px;padding-bottom:8px}
    .wtr-cart{margin:0 -14px -14px;background:var(--surface,#fff);border-top:1px solid var(--line,#e5dee6);box-shadow:0 -8px 22px rgba(0,0,0,.10);display:flex;flex-direction:column;max-height:30vh;padding:8px 14px 12px}
    /* Expanded cart = full screen: the menu/search collapse so the whole order shows */
    .wtr-build.cart-expanded .wtr-menuscroll,.wtr-build.cart-expanded .wtr-searchrow,.wtr-build.cart-expanded .wtr-catnav{display:none}
    .wtr-cart.expanded{max-height:none;flex:1;border-radius:0}
    .wtr-cart-head{display:flex;justify-content:space-between;align-items:center;font-weight:800;font-size:13px;padding:2px 0 6px}
    .wtr-cart-expand{background:none;border:none;color:var(--brand,#0f6f59);font-weight:800;font-size:13px;cursor:pointer;padding:4px}
    .wtr-cart-list{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:5px;margin-bottom:8px}
    .wtr-cart-line{display:flex;align-items:center;gap:9px;width:100%;text-align:left;background:var(--bg,#f3f1f4);border:1px solid var(--line,#e5dee6);border-radius:9px;padding:7px 9px;cursor:pointer;color:inherit}
    .wtr-cart-qty{min-width:24px;height:24px;flex:none;border-radius:7px;background:var(--brand,#0f6f59);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:13px}
    .wtr-cart-info{flex:1;min-width:0;display:flex;flex-direction:column}
    .wtr-cart-name{font-weight:700;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .wtr-cart-sub{font-size:12px;color:var(--muted,#6b646f);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .wtr-cart-sub.note{color:var(--brand,#0f6f59)}
    .wtr-cart-amt{font-weight:800;font-size:14px;flex:none;white-space:nowrap}
    /* Compact item rows with a Move/assign control (group detail, review items) */
    .wtr-liserow{display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--line,#e5dee6)}
    .wtr-liserow:last-child{border-bottom:none}
    .wtr-lise-qty{min-width:22px;height:22px;flex:none;border-radius:6px;background:var(--bg,#eee);color:var(--muted,#6b646f);font-weight:800;font-size:12px;display:inline-flex;align-items:center;justify-content:center}
    .wtr-lise-info{flex:1;min-width:0}
    .wtr-lise-name{font-weight:700;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .wtr-lise-amt{font-weight:800;font-size:14px;flex:none;white-space:nowrap}
    .wtr-lise-move{flex:none;width:92px;max-width:92px;border:1px solid var(--line,#e5dee6);border-radius:8px;padding:6px;font-size:12px;background:var(--surface,#fff);color:inherit}
    .wtr-liserow.wtr-mine{background:#eef7f3;border-radius:8px;padding:6px 8px;border-bottom:none}
    .wtr-liserow.wtr-mine .wtr-lise-name{color:var(--brand,#0f6f59)}
    .wtr-menurow{display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--surface,#fff);border:1px solid var(--line,#e5dee6);border-radius:10px;padding:13px 14px;cursor:pointer;text-align:left;width:100%;color:inherit}
    .wtr-menurow:active{background:#f0edf1}
    .wtr-menurow-name{font-weight:700;font-size:15px;display:flex;align-items:center;gap:8px}
    .wtr-incart{background:var(--brand,#0f6f59);color:#fff;font-size:12px;font-weight:800;min-width:20px;height:20px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;padding:0 6px}
    .wtr-menurow-right{display:flex;align-items:center;gap:12px}
    .wtr-menurow-price{color:var(--muted,#6b646f);font-weight:700;font-size:14px}
    .wtr-menurow-add{width:30px;height:30px;border-radius:8px;background:var(--brand,#0f6f59);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:20px;font-weight:700}
    .wtr-round-head{font-weight:800;font-size:13px;display:flex;justify-content:space-between;align-items:baseline;gap:8px}
    .wtr-round-line{display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:var(--bg,#f3f1f4);border:1px solid var(--line,#e5dee6);border-radius:10px;padding:8px 10px;cursor:pointer;color:inherit}
    .wtr-round-qtybadge{min-width:26px;height:26px;border-radius:8px;background:var(--brand,#0f6f59);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;flex:none}
    .wtr-notechip{font-size:12.5px;color:var(--brand,#0f6f59);font-weight:600;margin-top:2px}
    .wtr-chips{display:flex;flex-wrap:wrap;gap:8px}
    .wtr-chip{border:1.5px solid var(--line,#e5dee6);background:var(--surface,#fff);color:inherit;border-radius:10px;padding:10px 12px;font-weight:700;font-size:14px;cursor:pointer}
    .wtr-chip.on{background:var(--brand,#0f6f59);color:#fff;border-color:var(--brand,#0f6f59)}
    .wtr-chip.need{border-color:#c9902b}
    .wtr-danger{color:#b1483f;border-color:#e6c0bc}
    .wtr-pin{display:flex;flex-direction:column;align-items:center;gap:12px;max-width:300px}
    .wtr-pin-title{font-weight:800;font-size:20px}
    .wtr-pin-sub{color:var(--muted,#8a8189);font-size:14px}
    .wtr-pin-shown{font-size:30px;font-weight:800;letter-spacing:6px;min-height:38px;color:var(--brand,#0f6f59)}
    .wtr-pin-err{color:#a11;font-size:13px}
    .wtr-pad{display:grid;grid-template-columns:repeat(3,72px);gap:12px}
    .wtr-pad button{height:64px;border-radius:14px;border:1px solid var(--line,#e7dfe4);background:var(--surface,#fff);font-size:22px;font-weight:700;cursor:pointer;color:inherit}
    .wtr-pad-ok{background:var(--brand,#7a2e57)!important;color:#fff!important}
    .wtr-topspacer{width:36px;flex:none}
    .wtr-buildstamp{text-align:center;font-size:11px;color:var(--muted,#8a8189);opacity:.7;margin-top:14px;letter-spacing:.03em}
    `}</style>
  );
}
