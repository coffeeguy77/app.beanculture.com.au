import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, formatMoney } from '../api.js';
import { useItemConfig, itemIsQuickAdd, buildQuickCartItem } from '../hooks/useItemConfig.js';
import Kds from './Kds.jsx';

// Kiosk POS + adaptive KDS (/pos). One authenticated staff screen that is a fast
// counter register while a sale is being built and the live KDS the rest of the
// time. It REUSES the customer catalogue, the shared item-configuration logic
// (useItemConfig — identical valid choices/pricing to the app) and the existing
// KDS, so there is no second catalogue and no drift. Orders flow into Square via
// the same order path and appear on the KDS automatically.

const CART_KEY = 'bc-pos-cart';
const cartTotal = (cart) => cart.reduce((s, c) => s + c.unitPrice * c.quantity, 0);
const cartCount = (cart) => cart.reduce((s, c) => s + c.quantity, 0);

// ── The configure workspace: the product grid is replaced by this while an item
// is being built. Uses the shared hook so it matches the customer app exactly. ──
function ConfigWorkspace({ item, currency, initial, onCancel, onCommit }) {
  const {
    variationId, setVariationId, variation,
    selected, toggleModifier, unmetGroups, canAdd, unitPrice,
    qty, setQty, note, setNote, buildCartItem,
  } = useItemConfig(item, initial);
  const [showNote, setShowNote] = useState(!!(initial && initial.note));

  // Compact sticky anchors: 1 Size · 2 Milk · … so staff can jump to any group.
  const groups = item.modifierGroups || [];
  const anchors = [];
  let n = 0;
  if ((item.variations || []).length > 1) { n += 1; anchors.push({ n, name: 'Size', id: 'sz' }); }
  for (const g of groups) { n += 1; anchors.push({ n, name: g.name, id: g.id }); }

  return (
    <div className="pos-cfg">
      <div className="pos-cfg-head">
        <div>
          <div className="pos-cfg-name">{item.name}</div>
          <div className="pos-cfg-base">{item.category || ''}{item.category ? ' · ' : ''}from {formatMoney(Math.min(...item.variations.map((v) => v.price ?? Infinity)), currency)}</div>
        </div>
        <div className="pos-cfg-anchors">
          {anchors.map((a) => (
            <a key={a.id} href={`#pcg-${a.id}`} className="pos-anchor"
              onClick={(e) => { e.preventDefault(); document.getElementById(`pcg-${a.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>
              <b>{a.n}</b> {a.name}
            </a>
          ))}
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
  const [query, setQuery] = useState('');

  const [cart, setCart] = useState(() => { try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]') || []; } catch { return []; } });
  const [dineIn, setDineIn] = useState(false);
  const [orderName, setOrderName] = useState('');
  const [table, setTable] = useState('');

  const [tender, setTender] = useState(null);      // null | 'choose' | 'cash'
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(null);    // { orderId, tender, change }
  const returnTimer = useRef(null);

  const deviceMode = cfg?.mode || 'pos_kds';        // pos_kds | pos | kds

  async function boot(p) {
    try {
      const [c, m] = await Promise.all([api.posConfig(p), api.getMenu()]);
      setCfg(c); setMenu(m); setCurrency(m.currency || 'AUD'); setNeedPass(false);
      try { localStorage.setItem('bc-admin-pass', btoa(p)); } catch {}
      const cats = (m.categories || []);
      setActiveCat((prev) => prev || (cats[0] && cats[0].category) || null);
      // Combined devices idle on the KDS; POS-only starts in register.
      setMode((c.mode === 'kds') ? 'kitchen' : (c.mode === 'pos') ? 'register' : (cart.length ? 'register' : 'kitchen'));
      return true;
    } catch (e) {
      if (/unauthor/i.test(e.message)) { setNeedPass(true); return false; }
      setErr(e.message); return false;
    }
  }

  useEffect(() => {
    if (!pass) { setNeedPass(true); return; }
    boot(pass);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch {} }, [cart]);
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

  async function submit(tenderType, cashGiven) {
    if (!cart.length || busy) return;
    setBusy(true); setErr('');
    try {
      const payload = {
        cart: cart.map((c) => ({ variationId: c.variationId, quantity: c.quantity, modifierIds: c.modifierIds, note: c.note })),
        dineIn, table: dineIn ? table : '', name: orderName.trim(),
        tender: tenderType,
        cashGiven: tenderType === 'cash' ? cashGiven : undefined,
      };
      const res = await api.posOrder(pass, payload);
      const change = tenderType === 'cash' ? Math.max(0, (cashGiven || 0) - cartTotal(cart)) : 0;
      setTender(null);
      setSuccess({ orderId: res.orderId, shortId: (res.orderId || '').slice(-4).toUpperCase(), tender: tenderType, change });
      clearCart();
      // Combined devices return to the KDS after a short success state.
      const delay = Math.max(1500, (cfg?.autoReturnSec || 3) * 1000);
      returnTimer.current = setTimeout(() => {
        setSuccess(null);
        if (deviceMode === 'pos_kds') setMode('kitchen');
      }, delay);
    } catch (e) {
      setErr(e.message);
    } finally { setBusy(false); }
  }

  // ── Passcode gate ──
  if (needPass) {
    return (
      <div className="pos-root pos-login">
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
  if (!cfg || !menu) return <div className="pos-root pos-center"><div className="pos-spinner" /></div>;

  const cats = menu.categories || [];
  const q = query.trim().toLowerCase();
  const activeItems = q
    ? cats.flatMap((c) => (c.items || []).map((it) => ({ ...it, category: c.category })))
        .filter((it) => it.name.toLowerCase().includes(q))
    : ((cats.find((c) => c.category === activeCat) || cats[0] || {}).items || [])
        .map((it) => ({ ...it, category: activeCat || (cats[0] && cats[0].category) }));

  const total = cartTotal(cart);
  const configureMode = mode === 'register' && configuring;

  const header = (
    <header className="pos-header">
      <div className="pos-brand">BEAN CULTURE</div>
      <div className="pos-service">{dineIn ? 'Dine-in' : 'Takeaway'} · Now</div>
      <div className="pos-modeswitch">
        <button className={`pos-seg${mode === 'register' ? ' on' : ''}`}
          disabled={deviceMode === 'kds'}
          onClick={() => setMode('register')}>Register</button>
        <button className={`pos-seg${mode === 'kitchen' ? ' on' : ''}`}
          onClick={() => { setConfiguring(null); setMode('kitchen'); }}>
          Kitchen{cart.length ? <span className="pos-seg-badge">cart {cartCount(cart)}</span> : null}
        </button>
      </div>
      <div className="pos-header-right">
        <span className="pos-term" title="Card terminal">● Terminal: next update</span>
        <span className="pos-staff">{cfg.staff || 'Staff'}</span>
        <button className="pos-icon" title="Exit POS" onClick={onExit}>✕</button>
      </div>
    </header>
  );

  // ── Kitchen mode: the live KDS, hosted under the persistent POS header ──
  if (mode === 'kitchen') {
    return (
      <div className="pos-root">
        {header}
        {deviceMode !== 'kds' && (
          <div className="pos-kds-bar">
            <button className="pos-btn primary big" onClick={() => setMode('register')}>+ New order</button>
            {cart.length ? <span className="pos-kds-note">A parked cart of {cartCount(cart)} is waiting in Register.</span> : null}
          </div>
        )}
        <div className="pos-kds-host"><Kds embedded onExit={() => setMode('register')} /></div>
      </div>
    );
  }

  // ── Register mode ──
  return (
    <div className="pos-root">
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

        {/* Right: cart panel (full in browse, slim while configuring) */}
        <aside className={`pos-cart${configureMode ? ' slim' : ''}`}>
          <div className="pos-cart-head">
            <span>Current order</span>
            {cart.length > 0 && <button className="pos-cart-clear" onClick={clearCart}>Clear</button>}
          </div>

          {!configureMode && (
            <div className="pos-fulfil">
              <div className="pos-fulfil-row">
                <button className={`pos-chip${!dineIn ? ' on' : ''}`} onClick={() => setDineIn(false)}>Takeaway</button>
                <button className={`pos-chip${dineIn ? ' on' : ''}`} onClick={() => setDineIn(true)}>Eat in</button>
              </div>
              <div className="pos-fulfil-row">
                <input className="pos-name" placeholder={dineIn ? 'Name (optional)' : 'Customer name'} value={orderName} onChange={(e) => setOrderName(e.target.value)} />
                {dineIn && <input className="pos-table" placeholder="Table" value={table} onChange={(e) => setTable(e.target.value)} />}
              </div>
            </div>
          )}

          <div className="pos-cart-items">
            {cart.length === 0 && <div className="pos-cart-empty">No items yet. Tap a product to start.</div>}
            {cart.map((c) => (
              <div key={c.key} className="pos-line">
                <div className="pos-line-main" onClick={() => !configureMode && editLine(c)}>
                  <div className="pos-line-top">
                    <span className="pos-line-name">{c.itemName}</span>
                    <span className="pos-line-price">{formatMoney(c.unitPrice * c.quantity, currency)}</span>
                  </div>
                  {(c.variationName || c.modifierNames.length > 0) && (
                    <div className="pos-line-mods">{[c.variationName, ...c.modifierNames].filter(Boolean).join(' · ')}</div>
                  )}
                  {c.note && <div className="pos-line-note">“{c.note}”</div>}
                </div>
                <div className="pos-line-qty">
                  <button onClick={() => bumpQty(c.key, -1)} aria-label="Decrease">−</button>
                  <span>{c.quantity}</span>
                  <button onClick={() => bumpQty(c.key, 1)} aria-label="Increase">+</button>
                </div>
              </div>
            ))}
          </div>

          <div className="pos-cart-foot">
            <div className="pos-total-row"><span>Total</span><span className="pos-total">{formatMoney(total, currency)}</span></div>
            <div className="pos-gst">GST included</div>
            {err && <div className="pos-err">{err}</div>}
            <button className="pos-btn primary big pay" disabled={!cart.length || busy} onClick={() => setTender('choose')}>
              Charge {formatMoney(total, currency)}
            </button>
          </div>
        </aside>
      </div>

      {/* Tender overlay */}
      {tender && (
        <TenderOverlay tender={tender} setTender={setTender} total={total} currency={currency}
          busy={busy} onCash={(given) => submit('cash', given)} onKitchen={() => submit('unpaid')} onClose={() => setTender(null)} />
      )}

      {/* Success overlay */}
      {success && (
        <div className="pos-scrim" onClick={() => { setSuccess(null); if (deviceMode === 'pos_kds') setMode('kitchen'); }}>
          <div className="pos-success" onClick={(e) => e.stopPropagation()}>
            <div className="pos-success-tick">✓</div>
            <div className="pos-success-title">{success.tender === 'unpaid' ? 'Sent to kitchen' : 'Payment complete'}</div>
            <div className="pos-success-id">Order #{success.shortId}</div>
            {success.tender === 'cash' && success.change > 0 && (
              <div className="pos-success-change">Change due <b>{formatMoney(success.change, currency)}</b></div>
            )}
            <button className="pos-btn primary big" onClick={() => { setSuccess(null); setMode(deviceMode === 'pos_kds' ? 'kitchen' : 'register'); }}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tender: choose method, then cash keypad with change ──
function TenderOverlay({ tender, setTender, total, currency, busy, onCash, onKitchen, onClose }) {
  const [given, setGiven] = useState(0);
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
              <button className="pos-tender-method disabled" disabled title="Coming in the next update">
                <span className="pos-tender-m-name">Card — Terminal</span>
                <span className="pos-tender-m-sub">Next update</span>
              </button>
              <button className="pos-tender-method" onClick={() => setTender('cash')}>
                <span className="pos-tender-m-name">Cash</span>
                <span className="pos-tender-m-sub">Tender &amp; change</span>
              </button>
              <button className="pos-tender-method" disabled={busy} onClick={onKitchen}>
                <span className="pos-tender-m-name">Send to kitchen</span>
                <span className="pos-tender-m-sub">Unpaid open order</span>
              </button>
            </div>
            <button className="pos-link" onClick={onClose}>Cancel</button>
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
