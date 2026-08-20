import React, { useEffect, useMemo, useState } from 'react';
import { api, formatMoney } from '../api.js';
import GiftCards from './GiftCards.jsx';
import InstallButton from './InstallButton.jsx';
import { HeartIcon, ThemeIcon } from './icons.jsx';

/* ── little stroke icons (match the store page line style) ───────────────── */
const Ico = ({ children, size = 19 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
const UserIco = (p) => <Ico {...p}><circle cx="12" cy="8" r="3.6" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /></Ico>;
const BagIco = (p) => <Ico {...p}><path d="M6 8h12l-1 11.5a1.6 1.6 0 0 1-1.6 1.5H8.6A1.6 1.6 0 0 1 7 19.5L6 8Z" /><path d="M9 8V6.5a3 3 0 0 1 6 0V8" /></Ico>;
const GiftIco = (p) => <Ico {...p}><rect x="4" y="9.5" width="16" height="11" rx="1.6" /><path d="M4 13h16M12 9.5v11M12 9.5S10.5 5 8.4 5.6C6.7 6 7.4 9 9 9.5m3 0S13.5 5 15.6 5.6C17.3 6 16.6 9 15 9.5" /></Ico>;
const OutIco = (p) => <Ico {...p}><path d="M15 5H6.5A1.5 1.5 0 0 0 5 6.5v11A1.5 1.5 0 0 0 6.5 19H15" /><path d="M14 12h7m0 0-3-3m3 3-3 3" /></Ico>;
const CoffeeIco = (p) => <Ico {...p}><path d="M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8Z" /><path d="M17 9.5h1.5a2.5 2.5 0 0 1 0 5H17" /><path d="M7 4.5c-.6.7-.6 1.3 0 2M10.5 4.5c-.6.7-.6 1.3 0 2" /></Ico>;

/* A single loyalty cup — filled once earned, the last one is the FREE reward. */
function Cup({ on, free }) {
  return (
    <span className={`lc-cup ${on ? 'on' : ''} ${free ? 'free' : ''}`}>
      <svg viewBox="0 0 24 26" width="100%" height="100%" aria-hidden="true">
        <path d="M4.5 7.5h15l-1.3 14.2a2.2 2.2 0 0 1-2.2 2H8a2.2 2.2 0 0 1-2.2-2L4.5 7.5Z" fill="var(--cup-fill)" stroke="var(--cup-stroke)" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M4.5 7.5 3.9 5a1 1 0 0 1 1-1.3h14.2a1 1 0 0 1 1 1.3l-.6 2.5" fill="none" stroke="var(--cup-stroke)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {free && <em>FREE</em>}
    </span>
  );
}

const NAV = [
  { key: 'account', label: 'My account', Icon: UserIco },
  { key: 'orders', label: 'My orders', Icon: BagIco },
  { key: 'coffee', label: 'Coffee gifts', Icon: CoffeeIco },
  { key: 'gifts', label: 'Gift cards', Icon: GiftIco },
];

/* Derive a friendly title + fulfilment tag from the Square ticket name, which is
   the only place dine-in / table survives into order history. */
function orderMeta(o) {
  const tn = (o.ticketName || '').trim();
  const dineIn = /dine-?in/i.test(tn);
  const hasTable = /^t\s*\d+/i.test(tn);
  return {
    title: hasTable ? tn.replace(/\s*dine-?in$/i, '').trim() + ' · Dine-in' : 'Order',
    type: dineIn ? 'DINE-IN' : 'TAKEAWAY',
  };
}
function statePill(state) {
  const s = (state || '').toUpperCase();
  if (s === 'OPEN') return { label: 'Open', cls: 'open' };
  if (s === 'COMPLETED') return { label: 'Completed', cls: 'done' };
  if (s === 'CANCELED' || s === 'CANCELLED') return { label: 'Cancelled', cls: 'cancel' };
  return { label: s || '—', cls: '' };
}
const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

export default function Account({ user, currency, config, onSignIn, onSignOut, onReorder, onFavorite, onTheme, onBack, onSendCoffee, onUseCoffee }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loyalty, setLoyalty] = useState(null);
  const [history, setHistory] = useState(null);
  const [cards, setCards] = useState(null);
  const [scheduled, setScheduled] = useState(null);
  const [balance, setBalance] = useState(null);
  const [gift, setGift] = useState(null);           // null | 'topup' | 'buy' | 'redeem'
  const [section, setSection] = useState('account'); // account | orders | gifts
  const [filter, setFilter] = useState('all');       // all | open | completed
  const [visible, setVisible] = useState(6);
  const [detail, setDetail] = useState(null);        // order shown in the detail modal
  const [savedFavs, setSavedFavs] = useState(() => new Set()); // order ids just saved to favourites
  const [coffeeGifts, setCoffeeGifts] = useState(null); // { sent, received }
  const [coffeeTab, setCoffeeTab] = useState('received'); // received | sent

  useEffect(() => {
    if (user?.phone) api.getLoyalty(user.phone).then(setLoyalty).catch(() => {});
    if (user?.customerId) {
      api.getHistory(user.customerId).then((r) => setHistory(r.orders || [])).catch(() => setHistory([]));
      api.getCards(user.customerId).then((r) => setCards(r.cards || [])).catch(() => setCards([]));
      api.getScheduled(user.customerId).then((r) => setScheduled(r.orders || [])).catch(() => setScheduled([]));
      api.giftBalance(user.customerId).then((b) => setBalance(b.balance || 0)).catch(() => setBalance(0));
    }
    if (user?.customerId || user?.phone) {
      api.myGifts(user.customerId, user.phone).then(setCoffeeGifts).catch(() => setCoffeeGifts({ sent: [], received: [] }));
    }
  }, [user]);

  async function removeCard(id) {
    try { await api.removeCard(id); setCards((cs) => (cs || []).filter((c) => c.id !== id)); } catch (e) { alert(e.message); }
  }
  async function cancelScheduled(id) {
    try { await api.cancelScheduled(id, user.customerId); setScheduled((xs) => (xs || []).filter((x) => x.id !== id)); } catch (e) { alert(e.message); }
  }
  const fmtNext = (iso) => iso ? new Date(iso).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';

  async function signIn() {
    if (!name.trim() || !phone.trim()) { setError('Enter your name and phone.'); return; }
    setBusy(true); setError('');
    try { onSignIn(await api.auth(phone, name)); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  /* ── loyalty gauge maths: cups toward the cheapest reward tier ─────────── */
  const gauge = useMemo(() => {
    const active = !!loyalty?.active;
    const tier = active ? (loyalty.tiers || []).slice().sort((a, b) => a.points - b.points)[0] : null;
    const goal = Math.max(1, tier?.points || 10);
    const earned = active ? (loyalty.balance || 0) : 0;
    const filled = Math.min(earned, goal);
    return { active, goal, earned, filled, remaining: Math.max(0, goal - earned), complete: earned >= goal };
  }, [loyalty]);

  const filtered = useMemo(() => {
    const list = history || [];
    if (filter === 'open') return list.filter((o) => (o.state || '').toUpperCase() === 'OPEN');
    if (filter === 'completed') return list.filter((o) => (o.state || '').toUpperCase() === 'COMPLETED');
    return list;
  }, [history, filter]);

  useEffect(() => { setVisible(6); }, [filter, section]);

  /* ── signed-out: sign-in card ─────────────────────────────────────────── */
  if (!user) {
    return (
      <main className="page">
        <button className="link" onClick={onBack}>← Menu</button>
        <h2>Sign in</h2>
        <p className="muted" style={{ marginTop: -4 }}>Stay signed in to see your order history and use rewards. No password needed.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
          <label className="field"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" /></label>
          <label className="field"><span>Mobile number</span><input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="04XX XXX XXX" /></label>
          {error && <p className="error-text">{error}</p>}
          <button className="btn full" disabled={busy} onClick={signIn}>{busy ? 'Signing in…' : 'Continue'}</button>
        </div>
      </main>
    );
  }

  /* ── reusable blocks ──────────────────────────────────────────────────── */
  const RewardsCard = (
    <section className="acct-card rewards-card">
      <div className="rc-head">
        <h3>Your Coffee Rewards</h3>
        <span className="rc-count">{gauge.filled} of {gauge.goal} coffees</span>
      </div>
      <div className="lc-track" role="img" aria-label={`${gauge.filled} of ${gauge.goal} coffees earned`}>
        {Array.from({ length: gauge.goal }).map((_, i) => (
          <Cup key={i} on={i < gauge.filled} free={i === gauge.goal - 1} />
        ))}
      </div>
      <p className="rc-msg">
        {gauge.complete ? 'Your free coffee is ready — redeem it at checkout!'
          : `Only ${gauge.remaining} more until your free coffee!`}
      </p>
      <p className="rc-sub muted">Every eligible coffee purchase fills one cup.</p>
    </section>
  );

  const GiftCard = (
    <section className="acct-card gift-card">
      <h3>Gift Cards &amp; Balance</h3>
      <div className="gift-bal">{balance == null ? '—' : formatMoney(balance, currency)}</div>
      <button className="btn full gift-topup" onClick={() => setGift('topup')}>Top up</button>
      <div className="gift-row">
        <button className="btn ghost" onClick={() => setGift('buy')}>Buy a gift</button>
        <button className="btn ghost" onClick={() => setGift('redeem')}>Add a code</button>
      </div>
    </section>
  );

  function OrderCard({ o }) {
    const m = orderMeta(o);
    const pill = statePill(o.state);
    const canReorder = onReorder && (o.items || []).some((li) => li.variationId);
    const canFav = onFavorite && (o.items || []).some((li) => li.variationId);
    const saved = savedFavs.has(o.id);
    const saveFav = () => {
      const ok = onFavorite(o);
      if (ok) setSavedFavs((s) => new Set(s).add(o.id));
    };
    return (
      <div className="order-card">
        <div className="oc-top">
          <div className="oc-title">{m.title} <span className={`oc-state ${pill.cls}`}>{pill.label}</span></div>
          <div className="oc-total">{formatMoney(o.total?.amount, o.total?.currency || currency)}</div>
        </div>
        <div className="oc-meta">{fmtDate(o.createdAt)} · {m.type}</div>
        <div className="oc-items">
          {(o.items || []).map((li, i) => `${li.quantity}× ${li.name}${li.variation ? ` (${li.variation})` : ''}`).join(', ')}
        </div>
        <div className="oc-actions">
          <button className="btn ghost oc-again" disabled={!canReorder} onClick={() => canReorder && onReorder(o)}>↻ Order again</button>
          {canFav && (
            <button className={`btn ghost oc-fav${saved ? ' is-saved' : ''}`} onClick={saveFav} disabled={saved}>
              <HeartIcon size={16} filled={saved} /> {saved ? 'Saved to favourites' : 'Save as favourite'}
            </button>
          )}
          <button className="btn ghost oc-details" onClick={() => setDetail(o)}>View details ›</button>
        </div>
      </div>
    );
  }

  const OrderHistory = (
    <section className="acct-card orders-card">
      <div className="oh-head">
        <h2>Order history</h2>
        <div className="oh-tabs">
          {[['all', 'All orders'], ['open', 'In progress'], ['completed', 'Completed']].map(([k, l]) => (
            <button key={k} className={filter === k ? 'oh-tab on' : 'oh-tab'} onClick={() => setFilter(k)}>{l}</button>
          ))}
        </div>
      </div>
      {history === null && <p className="muted">Loading…</p>}
      {history && filtered.length === 0 && <p className="muted">No orders here yet.</p>}
      {filtered.length > 0 && (
        <div className="orders-grid">
          {filtered.slice(0, visible).map((o) => <OrderCard key={o.id} o={o} />)}
        </div>
      )}
      {filtered.length > visible && (
        <button className="btn ghost view-more" onClick={() => setVisible((v) => v + 6)}>View more orders ⌄</button>
      )}
    </section>
  );

  const GiftSection = (
    <section className="acct-card">
      <h2>Gift cards &amp; balance</h2>
      <div className="gs-balance">
        <div>
          <div className="muted" style={{ fontSize: 13 }}>Current balance</div>
          <div className="gift-bal" style={{ margin: '2px 0 0' }}>{balance == null ? '—' : formatMoney(balance, currency)}</div>
        </div>
        <button className="btn" onClick={() => setGift('topup')}>Top up</button>
      </div>
      <div className="gift-row" style={{ marginTop: 14 }}>
        <button className="btn ghost" onClick={() => setGift('buy')}>Buy a gift</button>
        <button className="btn ghost" onClick={() => setGift('redeem')}>Add a code</button>
      </div>
      {cards && cards.length > 0 && (
        <>
          <h3 style={{ margin: '20px 0 8px' }}>Saved cards</h3>
          {cards.map((c) => (
            <div key={c.id} className="saved-card">
              <span>{c.brand} ···· {c.last4} <span className="muted" style={{ fontSize: 12 }}>exp {c.expMonth}/{String(c.expYear).slice(-2)}</span></span>
              <button className="link" style={{ color: '#c0392b' }} onClick={() => removeCard(c.id)}>Remove</button>
            </div>
          ))}
        </>
      )}
    </section>
  );

function pifStatusPill(status) {
  const s = (status || '').toUpperCase();
  if (s === 'REDEEMED') return { label: 'Redeemed', cls: 'done' };
  if (s === 'PARTIALLY_REDEEMED') return { label: 'Partly used', cls: 'open' };
  if (s === 'ACTIVE') return { label: 'Ready to use', cls: 'open' };
  if (s === 'EXPIRED') return { label: 'Expired', cls: 'cancel' };
  if (s === 'CANCELLED') return { label: 'Cancelled', cls: 'cancel' };
  if (s === 'REFUNDED') return { label: 'Refunded', cls: 'cancel' };
  return { label: s.replace(/_/g, ' ').toLowerCase() || '—', cls: '' };
}

  const CoffeeGiftSection = (
    <section className="acct-card">
      <div className="oh-head">
        <h2>My Coffee Gifts</h2>
        <div className="oh-tabs">
          <button className={coffeeTab === 'received' ? 'oh-tab on' : 'oh-tab'} onClick={() => setCoffeeTab('received')}>Received</button>
          <button className={coffeeTab === 'sent' ? 'oh-tab on' : 'oh-tab'} onClick={() => setCoffeeTab('sent')}>Sent</button>
        </div>
      </div>
      {onSendCoffee && (
        <button className="btn full" style={{ marginBottom: 14 }} onClick={onSendCoffee}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}><CoffeeIco size={17} /> Send someone a coffee</span></button>
      )}
      {coffeeGifts === null && <p className="muted">Loading…</p>}
      {coffeeGifts && coffeeTab === 'received' && (coffeeGifts.received || []).length === 0 && <p className="muted">No coffees received yet.</p>}
      {coffeeGifts && coffeeTab === 'sent' && (coffeeGifts.sent || []).length === 0 && <p className="muted">You haven't sent a coffee gift yet.</p>}
      <div className="orders-grid">
        {coffeeGifts && coffeeTab === 'received' && (coffeeGifts.received || []).map((g) => {
          const pill = pifStatusPill(g.status);
          const usable = g.status === 'ACTIVE' || g.status === 'PARTIALLY_REDEEMED';
          return (
            <div className="order-card" key={g.id}>
              <div className="oc-top">
                <div className="oc-title">Coffee from {g.purchaserName || 'someone'} <span className={`oc-state ${pill.cls}`}>{pill.label}</span></div>
                <div className="oc-total">{formatMoney(g.remainingCents, g.currency || currency)}</div>
              </div>
              {g.message && <div className="oc-items">"{g.message}"</div>}
              {usable && onUseCoffee && (
                <div className="oc-actions">
                  <button className="btn ghost" onClick={() => onUseCoffee(g.token, { code: g.code, valueCents: g.valueCents, remainingCents: g.remainingCents })}>Use my coffee</button>
                </div>
              )}
            </div>
          );
        })}
        {coffeeGifts && coffeeTab === 'sent' && (coffeeGifts.sent || []).map((g) => {
          const pill = pifStatusPill(g.status);
          return (
            <div className="order-card" key={g.id}>
              <div className="oc-top">
                <div className="oc-title">{g.recipientName || 'A friend'} <span className={`oc-state ${pill.cls}`}>{pill.label}</span></div>
                <div className="oc-total">{formatMoney(g.valueCents, g.currency || currency)}</div>
              </div>
              <div className="oc-meta">{fmtDate(g.createdAt)}{g.status === 'REDEEMED' ? ' · Enjoyed already ☕' : ''}</div>
            </div>
          );
        })}
      </div>
    </section>
  );

  const ScheduledBlock = scheduled && scheduled.length > 0 && (
    <section className="acct-card">
      <h3 style={{ marginTop: 0 }}>Scheduled &amp; repeating</h3>
      {scheduled.map((o) => (
        <div key={o.id} className="saved-card" style={{ display: 'block' }}>
          <div className="history-top">
            <span>{o.recurrence && o.recurrence.type !== 'none' ? (o.recurrence.type === 'daily' ? 'Every day' : 'Weekly') : 'Pre-order'}</span>
            {o.status === 'failed' ? <span className="pill" style={{ background: '#fde8e8', color: '#c0392b' }}>Card failed</span> : null}
          </div>
          <div className="muted" style={{ fontSize: 13, margin: '4px 0' }}>
            Next: {fmtNext(o.pickupAt)} · {(o.cart || []).reduce((n, c) => n + (c.quantity || 1), 0)} item(s){o.dineIn ? ` · table ${o.table}` : ''}
          </div>
          <button className="link" style={{ color: '#c0392b', padding: 0 }} onClick={() => cancelScheduled(o.id)}>Cancel</button>
        </div>
      ))}
    </section>
  );

  /* ── dashboard ────────────────────────────────────────────────────────── */
  return (
    <main className="account-page">
      <button className="link acct-back" onClick={onBack}>← Menu</button>

      <div className="acct-grid">
        {/* Sidebar */}
        <aside className="acct-side">
          <div className="acct-card acct-profile">
            <div className="avatar">{(user.name || '·')[0].toUpperCase()}</div>
            <div className="ap-id">
              <div className="ap-name">{user.name || 'Guest'}</div>
              <div className="muted">{user.phone}</div>
            </div>
          </div>

          <nav className="acct-nav">
            {NAV.map(({ key, label, Icon }) => (
              <button key={key} className={section === key ? 'acct-navitem on' : 'acct-navitem'} onClick={() => setSection(key)}>
                <Icon /> <span>{label}</span>
              </button>
            ))}
            <button className="acct-navitem signout" onClick={onSignOut}><OutIco /> <span>Sign out</span></button>
          </nav>

          {RewardsCard}
          {GiftCard}
        </aside>

        {/* Main */}
        <div className="acct-main">
          {/* Mobile-only: Themes lives in the account menu (the header theme
              icon is hidden on mobile), sitting just above Order history. */}
          {onTheme && (
            <button type="button" className="acct-themes-mobile" onClick={onTheme}>
              <ThemeIcon size={20} /> <span>Themes</span>
            </button>
          )}
          {section === 'account' && (
            <>
              <header className="acct-welcome">
                <h1>Hi {user.name || 'there'}, welcome back</h1>
                <p className="muted">Ready for your next {config?.storeName || 'Bean Culture'} coffee?</p>
              </header>
              {ScheduledBlock}
              {OrderHistory}
            </>
          )}
          {section === 'orders' && (
            <>
              {ScheduledBlock}
              {OrderHistory}
            </>
          )}
          {section === 'coffee' && CoffeeGiftSection}
          {section === 'gifts' && GiftSection}
        </div>

        {/* Mobile-only: Add-to-Home-Screen at the very bottom of the page.
            Hidden on desktop/tablet via CSS; InstallButton self-hides when
            already installed or unavailable. */}
        <div className="acct-install">
          <InstallButton />
        </div>
      </div>

      {/* Gift-card flow */}
      {gift && config && (
        <GiftCards config={config} user={user} initialBalance={balance} initialMode={gift}
          onClose={() => setGift(null)} onBalance={(b) => setBalance(b)} />
      )}

      {/* Order detail */}
      {detail && (
        <div className="backdrop" onClick={() => setDetail(null)}>
          <div className="sheet od-sheet" onClick={(e) => e.stopPropagation()}>
            <button className="sheet-close" onClick={() => setDetail(null)} aria-label="Close">✕</button>
            <div className="sheet-body">
              {(() => {
                const m = orderMeta(detail); const pill = statePill(detail.state);
                const canReorder = onReorder && (detail.items || []).some((li) => li.variationId);
                return (
                  <>
                    <h2 style={{ marginBottom: 2 }}>{m.title}</h2>
                    <div className="oc-meta" style={{ marginBottom: 12 }}>{fmtDate(detail.createdAt)} · {m.type} · <span className={`oc-state ${pill.cls}`}>{pill.label}</span></div>
                    <ul className="od-lines">
                      {(detail.items || []).map((li, i) => (
                        <li key={i}>
                          <span>{li.quantity}× {li.name}{li.variation ? ` (${li.variation})` : ''}{li.modifierNames?.length ? ` · ${li.modifierNames.join(', ')}` : ''}</span>
                          <span>{li.total ? formatMoney(li.total.amount, li.total.currency || currency) : ''}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="od-total"><span>Total</span><span>{formatMoney(detail.total?.amount, detail.total?.currency || currency)}</span></div>
                    <button className="btn full" style={{ marginTop: 14 }} disabled={!canReorder}
                      onClick={() => { if (canReorder) { onReorder(detail); setDetail(null); } }}>↻ Order this again</button>
                    {!canReorder && <p className="muted" style={{ fontSize: 12.5, textAlign: 'center', marginTop: 8 }}>These items can’t be re-added automatically.</p>}
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
