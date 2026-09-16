import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, formatMoney, imgUrl } from '../api.js';
import ItemModal from './ItemModal.jsx';
import { itemIsQuickAdd, buildQuickCartItem } from '../hooks/useItemConfig.js';

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
  };
}

// Stroke icons (site-wide rule: no emoji / filled icons).
const Svg = (p) => <svg viewBox="0 0 24 24" width={p.s || 20} height={p.s || 20} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{p.children}</svg>;
const IconCard = (p) => <Svg s={p.s}><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><path d="M2.5 9.5h19" /></Svg>;
const IconCash = (p) => <Svg s={p.s}><rect x="2.5" y="6" width="19" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 9v6M18 9v6" /></Svg>;
const IconLock = (p) => <Svg s={p.s}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></Svg>;
const IconBack = (p) => <Svg s={p.s}><path d="M15 5l-7 7 7 7" /></Svg>;
const IconSplit = (p) => <Svg s={p.s}><path d="M6 3v6a3 3 0 0 0 3 3h6a3 3 0 0 1 3 3v6" /><path d="M14 6l4-3 4 3" transform="translate(-4 0)" /></Svg>;

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

  async function unlock(tryPin) {
    setErr('');
    try {
      const c = await waiterApi(isAdmin ? { pass: adminPass } : { pin: tryPin != null ? tryPin : pin }).config(location);
      let loc = location;
      const locs = c.locations || [];
      if (locs.length && !locs.some((l) => l.id === loc)) { loc = locs[0].id; setLocation(loc); try { localStorage.setItem(LOC_KEY, loc); } catch {} }
      const m = await api.getMenu(loc);
      setCfg(c); setMenu(m); setAuthed(true);
      if (!isAdmin && tryPin != null) try { localStorage.setItem(PIN_KEY, tryPin); } catch {}
    } catch (e) { setErr(e.message || 'Wrong PIN'); setAuthed(false); }
  }

  function saveName(n) { const v = String(n || '').trim().slice(0, 40); setWaiterName(v); try { localStorage.setItem(NAME_KEY, v); } catch {} }
  function lock() {
    if (isAdmin) { onExit && onExit(); return; }
    try { localStorage.removeItem(PIN_KEY); } catch {}
    setAuthed(false); setPin(''); setCfg(null); setScreen('home');
  }

  async function changeLocation(id) {
    setLocation(id); try { localStorage.setItem(LOC_KEY, id); } catch {}
    try { const m = await api.getMenu(id); setMenu(m); const c = await api2.config(id); setCfg((p) => ({ ...p, ...c })); } catch (e) { setErr(e.message); }
  }

  if (!authed) {
    if (isAdmin) return <div className="wtr-root wtr-center"><WaiterStyle />{err ? <div className="wtr-err">{err}</div> : <div className="wtr-spin" />}</div>;
    return <PinGate pin={pin} setPin={setPin} onSubmit={(p) => unlock(p)} err={err} onExit={onExit} />;
  }
  // A floor waiter identifies themselves once (per device) so their orders and
  // payments are attributed to them. The POS passes its own actor name.
  if (!waiterName) return <NameGate onSubmit={saveName} onExit={onExit} />;
  if (!cfg || !menu) return <div className="wtr-root wtr-center"><div className="wtr-spin" /></div>;

  const currency = cfg.currency || 'AUD';
  const common = { api2, cfg, menu, currency, location, setErr };

  return (
    <div className="wtr-root">
      <WaiterStyle />
      <header className="wtr-top">
        <button className="wtr-ghost" onClick={() => (screen === 'home' ? onExit && onExit() : goHome())}>‹ {screen === 'home' ? (isAdmin ? 'POS' : 'Exit') : 'Tables'}</button>
        <div className="wtr-title">{cfg.storeName || 'Waiter'}{waiterName ? <span className="wtr-who"> · {waiterName}</span> : ''}</div>
        <div className="wtr-top-right">
          {(cfg.locations || []).length > 1 && (
            <select className="wtr-loc" value={location} onChange={(e) => changeLocation(e.target.value)}>
              {(cfg.locations || []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          )}
          <button className="wtr-ghost wtr-iconbtn" onClick={lock} title={isAdmin ? 'Back to POS' : 'Lock'}>{isAdmin ? <IconBack /> : <IconLock />}</button>
        </div>
      </header>
      {err && <div className="wtr-err" onClick={() => setErr('')}>{err} · tap to dismiss</div>}

      {screen === 'home' && <Home {...common} waiterName={waiterName} onOpenTab={openExisting} onNewTab={startNewTab} />}
      {screen === 'setup' && <SetupChoice {...common} table={ctx.table} onTogether={() => setScreen('build')} onSplit={startSplit} onCancel={goHome} />}
      {screen === 'build' && <Build {...common} title={ctx.groupId ? 'Add to tab' : (ctx.tabId ? 'Add to' : 'New tab')} label={ctx.table}
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
  async function startSplit() {
    try { const d = await api2.sessionCreate({ table: ctx.table, locationId: location }); openSession(d.sessionId, ctx.table); }
    catch (e) { setErr(e.message); }
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
        <div className="wtr-pin-dots">{Array.from({ length: Math.max(4, v.length) }).map((_, i) => <span key={i} className={i < v.length ? 'on' : ''} />)}</div>
        {err && <div className="wtr-pin-err">{err}</div>}
        <div className="wtr-pad">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => <button key={n} onClick={() => press(String(n))}>{n}</button>)}
          <button className="wtr-pad-min" onClick={() => setV('')}>C</button>
          <button onClick={() => press('0')}>0</button>
          <button className="wtr-pad-ok" onClick={() => { setPin(v); onSubmit(v); }}>→</button>
        </div>
        <button className="wtr-ghost wtr-pin-exit" onClick={() => onExit && onExit()}>‹ Back to store</button>
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
        <button className="wtr-ghost" onClick={() => onExit && onExit()}>‹ Back to store</button>
      </div>
    </div>
  );
}

// ── Home: open tabs + new tab ────────────────────────────────────────────────
function Home({ api2, cfg, currency, location, waiterName, setErr, onOpenTab, onNewTab }) {
  const [tabs, setTabs] = useState(null);
  const [table, setTable] = useState('');
  const [picking, setPicking] = useState(false);
  const [mine, setMine] = useState(false);

  const load = async () => { try { const d = await api2.tabs(location); setTabs(d.tabs || []); } catch (e) { setErr(e.message); setTabs([]); } };
  useEffect(() => { load(); const iv = setInterval(load, 12000); return () => clearInterval(iv); /* eslint-disable-next-line */ }, [location]);

  const presets = cfg.tables || [];
  const startTable = (t) => { const v = String(t || '').trim(); if (!v) return; onNewTab(v); };
  const shown = (tabs || []).filter((t) => !mine || (t.by && waiterName && t.by.toLowerCase() === waiterName.toLowerCase()));

  return (
    <div className="wtr-body">
      <button className="wtr-primary wtr-new" onClick={() => setPicking((p) => !p)}>+ New tab</button>
      {picking && (
        <div className="wtr-card">
          <div className="wtr-card-h">Pick a table</div>
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
        {shown.map((t) => (
          <button key={t.tabId} className="wtr-tab" onClick={() => onOpenTab({ tabId: t.tabId, table: t.table, sessionId: t.sessionId })}>
            <div className="wtr-tab-l">
              <div className="wtr-tab-table">Table {t.table}{t.name ? ` · ${t.name}` : ''}{t.sessionId ? ' · split' : ''}</div>
              <div className="wtr-muted">{t.itemCount} item{t.itemCount === 1 ? '' : 's'}{t.by ? ` · ${t.by}` : ''}</div>
            </div>
            <div className="wtr-tab-total">{formatMoney(t.total, t.currency || currency)}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Build: add items (this round) then send to the kitchen ───────────────────
function Build({ menu, currency, title, label, setErr, submit, onDone, onCancel }) {
  const cats = menu.categories || [];
  const [activeCat, setActiveCat] = useState((cats[0] || {}).category || null);
  const [round, setRound] = useState([]);
  const [modalItem, setModalItem] = useState(null);
  const [sending, setSending] = useState(false);
  const items = ((cats.find((c) => c.category === activeCat) || cats[0] || {}).items) || [];

  const addLine = (line) => setRound((r) => {
    const i = r.findIndex((x) => x.key === line.key);
    if (i >= 0) { const c = [...r]; c[i] = { ...c[i], quantity: c[i].quantity + line.quantity }; return c; }
    return [...r, line];
  });
  const tap = (item) => { if (itemIsQuickAdd(item)) addLine(buildQuickCartItem(item)); else setModalItem(item); };
  const setQty = (key, d) => setRound((r) => r.map((x) => x.key === key ? { ...x, quantity: Math.max(1, x.quantity + d) } : x));
  const remove = (key) => setRound((r) => r.filter((x) => x.key !== key));
  const roundTotal = round.reduce((s, x) => s + x.unitPrice * x.quantity, 0);

  async function send() {
    if (!round.length) return;
    setSending(true); setErr('');
    try {
      const d = await submit(round);
      onDone(d || {});
    } catch (e) { setErr(e.message); } finally { setSending(false); }
  }

  return (
    <div className="wtr-body wtr-build">
      <div className="wtr-build-head">
        <div className="wtr-build-table">{title} · {label}</div>
        <button className="wtr-ghost" onClick={onCancel}>Cancel</button>
      </div>
      <div className="wtr-catnav">
        {cats.map((c) => <button key={c.category} className={`wtr-catbtn ${activeCat === c.category ? 'on' : ''}`} onClick={() => setActiveCat(c.category)}>{c.category}</button>)}
      </div>
      <div className="wtr-grid">
        {items.map((it) => (
          <button key={it.id} className="wtr-tile" onClick={() => tap(it)}>
            {it.image ? <img src={imgUrl(it.image, 160)} alt="" /> : <div className="wtr-tile-noimg" />}
            <div className="wtr-tile-name">{it.name}</div>
            <div className="wtr-tile-price">{formatMoney((it.variations || [])[0]?.price || 0, currency)}{(it.variations || []).length > 1 ? '+' : ''}</div>
          </button>
        ))}
      </div>

      {round.length > 0 && (
        <div className="wtr-round">
          <div className="wtr-round-list">
            {round.map((x) => (
              <div key={x.key} className="wtr-round-line">
                <div className="wtr-round-info">
                  <div className="wtr-round-name">{x.itemName}</div>
                  <div className="wtr-muted">{[x.variationName, ...(x.modifierNames || [])].filter(Boolean).join(' · ')}{x.note ? ` · ${x.note}` : ''}</div>
                </div>
                <div className="wtr-qty">
                  <button onClick={() => setQty(x.key, -1)}>−</button><span>{x.quantity}</span><button onClick={() => setQty(x.key, +1)}>+</button>
                </div>
                <div className="wtr-round-amt">{formatMoney(x.unitPrice * x.quantity, currency)}</div>
                <button className="wtr-x" onClick={() => remove(x.key)}>✕</button>
              </div>
            ))}
          </div>
          <button className="wtr-primary wtr-send" disabled={sending} onClick={send}>
            {sending ? 'Sending…' : `Send to kitchen · ${formatMoney(roundTotal, currency)}`}
          </button>
        </div>
      )}

      {modalItem && (
        <ItemModal item={modalItem} currency={currency} onClose={() => setModalItem(null)} onAdd={(line) => { addLine(line); setModalItem(null); }} />
      )}
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
            <div className="wtr-iteminfo"><div>{it.name}</div><div className="wtr-muted">{[it.variation, ...(it.modifiers || [])].filter(Boolean).join(' · ')}</div></div>
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
  const load = async () => { try { setTab(await api2.tab(ctx.tabId)); } catch (e) { setErr(e.message); } };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [ctx.tabId]);

  const cardPoll = useCardPoll(api2, ctx.tabId, location, setErr);

  if (!tab) return <div className="wtr-body"><div className="wtr-muted">Loading…</div></div>;
  const remaining = tab.remaining;

  const [cashOpen, setCashOpen] = useState(false);

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
            <button className="wtr-pay" disabled={busy || !cfg.hasTerminal} onClick={payCard}>
              <span className="wtr-pay-i"><IconCard s={26} /></span>Card{!cfg.hasTerminal ? ' (no reader)' : ''}
            </button>
            <button className="wtr-pay" disabled={busy} onClick={() => setCashOpen(true)}><span className="wtr-pay-i"><IconCash s={26} /></span>Cash</button>
          </div>
          <button className="wtr-primary wtr-split" onClick={onSplit}>Split the bill</button>
          <button className="wtr-secondary" onClick={onDone}>Leave open</button>
          <button className="wtr-ghost wtr-back" onClick={onBack}>‹ Back</button>
        </>
      )}
      {cashOpen && <PayDialog target={{ payerId: '', name: tab.table || ctx.table || 'Table', remaining }} cur={tab.currency || currency} busy={busy} hasTerminal={cfg.hasTerminal} cashOnly onCancel={() => setCashOpen(false)} onPay={({ cashGiven }) => { setCashOpen(false); payCash(cashGiven); }} />}
    </div>
  );
}

// ── Split workspace: by item / even / percentage ─────────────────────────────
function Split({ api2, cfg, currency, location, ctx, setErr, onDone, onBack }) {
  const [tab, setTab] = useState(null);
  const [method, setMethod] = useState('item');       // item | even | pct
  const [settledUids, setSettledUids] = useState(() => new Set());
  const [card, setCard] = useState(null);
  const [busy, setBusy] = useState(false);
  const cardPoll = useCardPoll(api2, ctx.tabId, location, setErr);

  const load = async () => { try { const d = await api2.tab(ctx.tabId); setTab(d); if (d.remaining <= 0) onDone(); } catch (e) { setErr(e.message); } };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [ctx.tabId]);
  if (!tab) return <div className="wtr-body"><div className="wtr-muted">Loading…</div></div>;
  const cur = tab.currency || currency;

  // Take one split payment of `amount`, named `who`, via `tender`. Marks the
  // ticked items settled on success (item mode). Always re-reads the tab after.
  async function takePayment({ amount, who, tender, markUids }) {
    const amt = Math.round(amount);
    if (!(amt > 0)) { setErr('Nothing to pay for that.'); return false; }
    setBusy(true); setErr('');
    try {
      const d = await api2.pay({ tabId: ctx.tabId, amount: amt, tender, payerName: who || '', locationId: location });
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
      {tab.payments && tab.payments.length > 0 && (
        <div className="wtr-paidlist">
          {tab.payments.map((p, i) => <div key={i} className="wtr-paidchip">{p.name || 'Paid'} · {formatMoney(p.amount, cur)} <span className="wtr-muted">{p.tender}</span></div>)}
        </div>
      )}

      <div className="wtr-methods">
        {[['item', 'By item'], ['even', 'Even split'], ['pct', 'Percentage']].map(([k, label]) => (
          <button key={k} className={`wtr-method ${method === k ? 'on' : ''}`} onClick={() => setMethod(k)}>{label}</button>
        ))}
      </div>

      {method === 'item' && <SplitByItem tab={tab} cur={cur} settledUids={settledUids} busy={busy} hasTerminal={cfg.hasTerminal} onPay={takePayment} />}
      {method === 'even' && <SplitEven tab={tab} cur={cur} busy={busy} hasTerminal={cfg.hasTerminal} onPay={takePayment} />}
      {method === 'pct' && <SplitPct tab={tab} cur={cur} busy={busy} hasTerminal={cfg.hasTerminal} onPay={takePayment} />}

      <button className="wtr-ghost wtr-back" onClick={onBack}>‹ Back</button>
    </div>
  );
}

// Pay for the exact items a person had.
function SplitByItem({ tab, cur, settledUids, busy, hasTerminal, onPay }) {
  const [ticked, setTicked] = useState(() => new Set());
  const [who, setWho] = useState('');
  const avail = tab.items.filter((it) => !settledUids.has(it.uid || it.name));
  const key = (it) => it.uid || it.name;
  const toggle = (it) => setTicked((s) => { const n = new Set(s); const k = key(it); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const selected = avail.filter((it) => ticked.has(key(it)));
  const amount = Math.min(selected.reduce((s, it) => s + it.amount, 0), tab.remaining);

  const pay = async (tender) => {
    const ok = await onPay({ amount, who, tender, markUids: [...ticked] });
    if (ok) { setTicked(new Set()); setWho(''); }
  };

  return (
    <div className="wtr-card">
      <div className="wtr-card-h">Tick what they're paying for</div>
      <div className="wtr-itemlist">
        {avail.length === 0 && <div className="wtr-muted">All items assigned. {tab.remaining > 0 ? 'Use another method for the rest.' : 'All paid!'}</div>}
        {avail.map((it) => (
          <label key={key(it)} className="wtr-tickrow">
            <input type="checkbox" checked={ticked.has(key(it))} onChange={() => toggle(it)} />
            <div className="wtr-iteminfo"><div>{it.quantity}× {it.name}</div><div className="wtr-muted">{[it.variation, ...(it.modifiers || [])].filter(Boolean).join(' · ')}</div></div>
            <div className="wtr-itemamt">{formatMoney(it.amount, cur)}</div>
          </label>
        ))}
      </div>
      <input className="wtr-input" placeholder="Name on this payment (optional)" value={who} onChange={(e) => setWho(e.target.value)} />
      <PayRow amount={amount} cur={cur} busy={busy} hasTerminal={hasTerminal} onPay={pay} disabled={amount <= 0} />
    </div>
  );
}

// Everyone pays an equal share (e.g. 12 people → each a twelfth). Shares are
// computed against what's LEFT and how many payers remain, so rounding always
// lands exactly on the total.
function SplitEven({ tab, cur, busy, hasTerminal, onPay }) {
  const [n, setN] = useState(2);
  const [paidCount, setPaidCount] = useState(0);
  const [who, setWho] = useState('');
  const left = Math.max(1, n - paidCount);
  const share = Math.round(tab.remaining / left);
  const pay = async (tender) => { const ok = await onPay({ amount: share, who, tender }); if (ok) { setPaidCount((c) => c + 1); setWho(''); } };
  return (
    <div className="wtr-card">
      <div className="wtr-card-h">Split evenly</div>
      <div className="wtr-row wtr-people">
        <span>How many people?</span>
        <div className="wtr-qty"><button onClick={() => setN((x) => Math.max(1, x - 1))}>−</button><span>{n}</span><button onClick={() => setN((x) => Math.min(50, x + 1))}>+</button></div>
      </div>
      <div className="wtr-evenline">Each pays <b>{formatMoney(share, cur)}</b> · {paidCount} of {n} paid</div>
      <input className="wtr-input" placeholder={`Name (optional) — person ${Math.min(n, paidCount + 1)}`} value={who} onChange={(e) => setWho(e.target.value)} />
      <PayRow amount={share} cur={cur} busy={busy} hasTerminal={hasTerminal} onPay={pay} />
    </div>
  );
}

// Custom percentages (starts even, edit any row). Each share is a % of the whole
// tab; paying reduces the balance. The last unpaid share always fills the exact
// remaining so cents never go missing.
function SplitPct({ tab, cur, busy, hasTerminal, onPay }) {
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

  const pay = async (i, tender) => { const ok = await onPay({ amount: amountFor(i), who: rows[i].name, tender }); if (ok) setRows((r) => r.map((x, j) => j === i ? { ...x, paid: true } : x)); };

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
              <button disabled={busy} onClick={() => pay(i, 'cash')}>Cash</button>
              <button disabled={busy || !hasTerminal} onClick={() => pay(i, 'card')}>Card</button>
            </div>
          )}
        </div>
      ))}
      <button className="wtr-mini wtr-addrow" onClick={addRow}>+ Add person</button>
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
function SessionView({ api2, currency, location, sessionId, table, onOrderInto, onBack, setErr }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [card, setCard] = useState(null);
  const [adding, setAdding] = useState(false);      // add-tab editor open
  const [editShared, setEditShared] = useState(null); // shared tab being configured
  const [showItems, setShowItems] = useState(false);
  const [viewing, setViewing] = useState(null);     // group id whose itemised tab is open
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

  const partySummary = (sh) => (sh.parties || []).map((p) => `${p.name} ${sh.mode === 'pct' ? p.weight + '%' : '×' + p.weight}`).join(', ') || 'no one yet';
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
          <div className="wtr-card-h">Their items — tap Move to dispute</div>
          {myLines.length === 0 && <div className="wtr-muted">No items on this tab yet.</div>}
          {myLines.map((li) => (
            <div key={li.uid} className="wtr-itemrow wtr-dispute">
              <div className="wtr-iteminfo">
                <div>{li.quantity}× {li.name}</div>
                <div className="wtr-muted">{[li.variation, ...(li.modifiers || [])].filter(Boolean).join(' · ')}{li.by ? ` · by ${li.by}` : ''}</div>
              </div>
              <div className="wtr-itemamt">{formatMoney(li.amount, cur)}</div>
              <select className="wtr-input wtr-assign" value="" onChange={(e) => reassign(li.uid, e.target.value)}>
                <option value="">Move…</option>
                {moveTargets.map((t) => <option key={t.id} value={t.id}>→ {t.name}</option>)}
              </select>
            </div>
          ))}
          {g.sharedShare > 0 && (
            <div className="wtr-itemrow"><div className="wtr-iteminfo"><b>Share of shared tabs</b><div className="wtr-muted">{myShares.map(({ sh, party }) => `${sh.name} (${sh.mode === 'pct' ? party.weight + '%' : party.weight + 'pt'})`).join(', ')}</div></div><div className="wtr-itemamt"><b>{formatMoney(g.sharedShare, cur)}</b></div></div>
          )}
        </div>
        {!g.paid ? (
          <div className="wtr-actions">
            <button className="wtr-secondary" onClick={() => onOrderInto(g.id)}>+ Add items</button>
            <button className="wtr-primary" disabled={g.remaining <= 0} onClick={() => openPay(g.id, g.name, g.remaining)}>Pay {formatMoney(g.remaining, cur)}</button>
          </div>
        ) : <div className="wtr-paidnote">✓ This tab is fully paid.</div>}
        <button className="wtr-ghost wtr-back" onClick={() => setViewing(null)}>‹ Back to table</button>
        {payTarget && <PayDialog target={payTarget} cur={cur} busy={busy} hasTerminal={data.hasTerminal} onCancel={() => setPayTarget(null)} onPay={(opts) => pay(payTarget.payerId, opts)} />}
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
      {st.unassignedTotal > 0 && <div className="wtr-warn">{formatMoney(st.unassignedTotal, cur)} of items aren’t on a tab yet — tap “Items” to assign them.</div>}

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
              <button className="wtr-secondary" onClick={() => setViewing(g.id)}>View</button>
              <button className="wtr-primary" disabled={busy || g.remaining <= 0} onClick={() => openPay(g.id, g.name, g.remaining)}>Pay {g.remaining > 0 ? formatMoney(g.remaining, cur) : ''}</button>
            </div>
          )}
        </div>
      ))}

      {/* Shared tabs */}
      {shared.map((sh) => (
        <div key={sh.id} className="wtr-card wtr-shared">
          <div className="wtr-grp-head">
            <div><b>{sh.name}</b> <span className="wtr-muted">· shared</span></div>
            <div className="wtr-grp-owed">{formatMoney(sh.total, cur)}</div>
          </div>
          <div className="wtr-muted wtr-grp-break">Split {sh.mode === 'pct' ? 'by %' : 'by parts'}: {partySummary(sh)}</div>
          <div className="wtr-grp-btns">
            <button className="wtr-secondary" onClick={() => onOrderInto(sh.id)}>+ Items</button>
            <button className="wtr-secondary" onClick={() => setEditShared(sh.id)}>Who shares?</button>
          </div>
          {/* Ad-hoc guests on this shared tab pay their own share */}
          {(sh.parties || []).filter((p) => !p.ref).map((p) => (
            <div key={p.id} className="wtr-adhoc">
              <span>{p.name} · {formatMoney(p.amount, cur)}{p.paidAmount > 0 && !p.paid ? ` (${formatMoney(p.remaining, cur)} left)` : ''}</span>
              {p.paid ? <span className="wtr-pctpaid">✓</span> : (
                <button className="wtr-mini" disabled={busy || p.remaining <= 0} onClick={() => openPay(p.id, p.name, p.remaining)}>Pay</button>
              )}
            </div>
          ))}
        </div>
      ))}

      <button className="wtr-secondary" onClick={() => setAdding(true)}>+ Add tab</button>
      {(st.lines || []).length > 0 && <button className="wtr-ghost" onClick={() => setShowItems((s) => !s)}>{showItems ? 'Hide items' : `Review items (${st.lines.length})`}</button>}

      {showItems && (
        <div className="wtr-card">
          <div className="wtr-card-h">Items · assign each to a tab</div>
          {st.lines.map((li) => (
            <div key={li.uid} className={`wtr-itemrow ${li.tabId ? '' : 'wtr-unassigned'}`}>
              <div className="wtr-iteminfo"><div>{li.quantity}× {li.name}</div><div className="wtr-muted">{[li.variation, ...(li.modifiers || [])].filter(Boolean).join(' · ')}{li.by ? ` · by ${li.by}` : ''}</div></div>
              <div className="wtr-itemamt">{formatMoney(li.amount, cur)}</div>
              <select className="wtr-input wtr-assign" value={li.tabId || ''} onChange={(e) => reassign(li.uid, e.target.value)}>
                <option value="" disabled>{li.tabId ? 'On: ' + (allTabs.find((t) => t.id === li.tabId) || {}).name : 'Assign to…'}</option>
                {allTabs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}

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

      {payTarget && <PayDialog target={payTarget} cur={cur} busy={busy} hasTerminal={data.hasTerminal} onCancel={() => setPayTarget(null)} onPay={(opts) => pay(payTarget.payerId, opts)} />}

      <button className="wtr-ghost wtr-back" onClick={onBack}>‹ Back to tables</button>
    </div>
  );
}

// Pay dialog for a group or guest: pay the whole balance or a part (so a bill can
// go part cash + part card), and for cash enter what was handed over so the
// change is calculated and recorded — no "what note did you give me?".
function PayDialog({ target, cur, busy, hasTerminal, cashOnly, onCancel, onPay }) {
  const [tender, setTender] = useState(cashOnly ? 'cash' : 'card');
  const [amtStr, setAmtStr] = useState(((target.remaining || 0) / 100).toFixed(2));
  const [givenStr, setGivenStr] = useState('');
  const amount = cashOnly ? target.remaining : Math.round((parseFloat(amtStr) || 0) * 100);
  const given = Math.round((parseFloat(givenStr) || 0) * 100);
  const overMax = amount > target.remaining;
  const change = tender === 'cash' && given > 0 ? Math.max(0, given - amount) : 0;
  const partial = !cashOnly && amount > 0 && amount < target.remaining;
  const go = () => onPay({ amount, tender, cashGiven: tender === 'cash' ? given || amount : undefined });
  return (
    <div className="wtr-scrim" onClick={onCancel}>
      <div className="wtr-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="wtr-card-h">{cashOnly ? 'Cash' : 'Pay'} · {target.name}</div>
        <div className="wtr-muted">{formatMoney(target.remaining, cur)} {cashOnly ? 'to pay' : 'left on this tab'}.</div>
        {!cashOnly && (
          <div className="wtr-methods">
            <button className={`wtr-method ${tender === 'card' ? 'on' : ''}`} disabled={!hasTerminal} onClick={() => setTender('card')}>Card{!hasTerminal ? ' (no reader)' : ''}</button>
            <button className={`wtr-method ${tender === 'cash' ? 'on' : ''}`} onClick={() => setTender('cash')}>Cash</button>
          </div>
        )}
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
            <label className="wtr-fieldlabel">Cash received (for change)</label>
            <input className="wtr-input" inputMode="decimal" placeholder="e.g. 50.00" value={givenStr} onChange={(e) => setGivenStr(e.target.value.replace(/[^\d.]/g, ''))} />
            {given > 0 && <div className="wtr-changeline">Change: <b>{formatMoney(change, cur)}</b> <span className="wtr-muted">(paid {formatMoney(given, cur)} for {formatMoney(amount, cur)})</span></div>}
          </>
        )}
        <div className="wtr-payrow">
          <button className="wtr-secondary" onClick={onCancel}>Cancel</button>
          <button className="wtr-primary" disabled={busy || amount <= 0 || overMax || (tender === 'card' && !hasTerminal)} onClick={go}>
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
        <button className={`wtr-method ${mode === 'parts' ? 'on' : ''}`} onClick={() => setMode('parts')}>By parts</button>
        <button className={`wtr-method ${mode === 'pct' ? 'on' : ''}`} onClick={() => setMode('pct')}>By %</button>
      </div>
      <div className="wtr-muted">Tap groups to include them; set parts (e.g. by head-count) or percentages. Add guests who aren’t in a group.</div>
      <div className="wtr-tables">
        {groups.map((g) => <button key={g.id} className={`wtr-tablechip ${has(g.id) ? 'on' : ''}`} onClick={() => toggleGroup(g)}>{g.name}</button>)}
      </div>
      {parties.map((p, i) => (
        <div key={i} className="wtr-pctrow">
          {p.ref ? <div className="wtr-pctname"><b>{p.name}</b></div>
            : <input className="wtr-input wtr-pctname" placeholder={`Guest ${i + 1}`} value={p.name} onChange={(e) => setGuestName(i, e.target.value)} />}
          <div className="wtr-pctpct"><input type="number" value={p.weight} onChange={(e) => setWeight(i, e.target.value)} />{mode === 'pct' ? '%' : 'pt'}</div>
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
function PayRow({ amount, cur, busy, hasTerminal, onPay, disabled }) {
  return (
    <div className="wtr-payrow">
      <button className="wtr-secondary" disabled={busy || disabled || amount <= 0} onClick={() => onPay('cash')}>Cash · {formatMoney(amount, cur)}</button>
      <button className="wtr-primary" disabled={busy || disabled || amount <= 0 || !hasTerminal} onClick={() => onPay('card')}>Card · {formatMoney(amount, cur)}</button>
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
    .wtr-root{position:fixed;inset:0;background:var(--bg,#faf7f8);color:var(--text,#1c1720);font-family:inherit;display:flex;flex-direction:column;z-index:60;overflow:hidden}
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
    .wtr-itemamt{font-weight:700}
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
    .wtr-paidchip{background:#eef7ef;color:#276b3a;border-radius:20px;padding:5px 10px;font-size:12px;font-weight:700}
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
    .wtr-adhoc{display:flex;justify-content:space-between;align-items:center;background:var(--bg,#faf7f8);border-radius:8px;padding:7px 10px;font-size:13px}
    .wtr-tablechip.on{background:var(--brand,#7a2e57);color:#fff}
    .wtr-assign{flex-basis:100%;margin-top:4px;padding:8px}
    .wtr-who{font-weight:500;opacity:.8;font-size:13px}
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
    .wtr-iconbtn{display:inline-flex;align-items:center;justify-content:center}
    .wtr-pay-i{display:inline-flex}
    .wtr-pin{display:flex;flex-direction:column;align-items:center;gap:12px;max-width:300px}
    .wtr-pin-title{font-weight:800;font-size:20px}
    .wtr-pin-sub{color:var(--muted,#8a8189);font-size:14px}
    .wtr-pin-dots{display:flex;gap:10px}
    .wtr-pin-dots span{width:12px;height:12px;border-radius:50%;border:2px solid var(--line,#c8bcc4)}
    .wtr-pin-dots span.on{background:var(--brand,#7a2e57);border-color:var(--brand,#7a2e57)}
    .wtr-pin-err{color:#a11;font-size:13px}
    .wtr-pad{display:grid;grid-template-columns:repeat(3,72px);gap:12px}
    .wtr-pad button{height:64px;border-radius:14px;border:1px solid var(--line,#e7dfe4);background:var(--surface,#fff);font-size:22px;font-weight:700;cursor:pointer;color:inherit}
    .wtr-pad-ok{background:var(--brand,#7a2e57)!important;color:#fff!important}
    .wtr-pin-exit{margin-top:6px}
    `}</style>
  );
}
