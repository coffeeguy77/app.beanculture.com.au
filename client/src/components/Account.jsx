import React, { useEffect, useState } from 'react';
import { api, formatMoney } from '../api.js';

export default function Account({ user, currency, onSignIn, onSignOut, onReorder, onBack }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loyalty, setLoyalty] = useState(null);
  const [history, setHistory] = useState(null);
  const [cards, setCards] = useState(null);
  const [scheduled, setScheduled] = useState(null);

  useEffect(() => {
    if (user?.phone) api.getLoyalty(user.phone).then(setLoyalty).catch(() => {});
    if (user?.customerId) {
      api.getHistory(user.customerId).then((r) => setHistory(r.orders || [])).catch(() => setHistory([]));
      api.getCards(user.customerId).then((r) => setCards(r.cards || [])).catch(() => setCards([]));
      api.getScheduled(user.customerId).then((r) => setScheduled(r.orders || [])).catch(() => setScheduled([]));
    }
  }, [user]);

  async function removeCard(id) {
    try { await api.removeCard(id); setCards((cs) => (cs || []).filter((c) => c.id !== id)); } catch (e) { alert(e.message); }
  }
  async function cancelScheduled(id) {
    try { await api.cancelScheduled(id, user.customerId); setScheduled((xs) => (xs || []).filter((x) => x.id !== id)); } catch (e) { alert(e.message); }
  }
  function fmtNext(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  }

  async function signIn() {
    if (!name.trim() || !phone.trim()) { setError('Enter your name and phone.'); return; }
    setBusy(true); setError('');
    try {
      const who = await api.auth(phone, name);
      onSignIn(who);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

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

  return (
    <main className="page">
      <button className="link" onClick={onBack}>← Menu</button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '10px 0 18px' }}>
        <div className="avatar">{(user.name || '·')[0].toUpperCase()}</div>
        <div>
          <div style={{ fontWeight: 800, fontSize: 18 }}>{user.name || 'Guest'}</div>
          <div className="muted">{user.phone}</div>
        </div>
      </div>

      {loyalty?.active && (
        <div className="loyalty-card">
          <div style={{ opacity: 0.9, fontSize: 13 }}>Your rewards</div>
          <div className="pts">{loyalty.balance}</div>
          <div style={{ opacity: 0.9, fontSize: 13 }}>{loyalty.terminology?.other || 'points'} available</div>
          {loyalty.tiers?.some((t) => t.affordable) && (
            <div style={{ marginTop: 10, fontSize: 13 }}>
              You can redeem: {loyalty.tiers.filter((t) => t.affordable).map((t) => t.name).join(', ')}
            </div>
          )}
        </div>
      )}

      {scheduled && scheduled.length > 0 && (
        <>
          <h2 style={{ marginTop: 22 }}>Scheduled &amp; repeating</h2>
          {scheduled.map((o) => (
            <div key={o.id} className="history-item">
              <div className="history-top">
                <span>{o.recurrence && o.recurrence.type !== 'none'
                  ? (o.recurrence.type === 'daily' ? 'Every day' : 'Weekly')
                  : 'Pre-order'}</span>
                {o.status === 'failed' ? <span className="pill" style={{ background: '#fde8e8', color: '#c0392b' }}>Card failed</span> : null}
              </div>
              <div className="muted" style={{ fontSize: 13, margin: '4px 0' }}>
                Next: {fmtNext(o.pickupAt)} · {(o.cart || []).reduce((n, c) => n + (c.quantity || 1), 0)} item(s){o.dineIn ? ` · table ${o.table}` : ''}
              </div>
              <button className="link" style={{ color: '#c0392b', padding: 0 }} onClick={() => cancelScheduled(o.id)}>Cancel</button>
            </div>
          ))}
        </>
      )}

      {cards && cards.length > 0 && (
        <>
          <h2 style={{ marginTop: 22 }}>Saved cards</h2>
          {cards.map((c) => (
            <div key={c.id} className="history-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{c.brand} ···· {c.last4} <span className="muted" style={{ fontSize: 12 }}>exp {c.expMonth}/{String(c.expYear).slice(-2)}</span></span>
              <button className="link" style={{ color: '#c0392b' }} onClick={() => removeCard(c.id)}>Remove</button>
            </div>
          ))}
        </>
      )}

      <h2 style={{ marginTop: 22 }}>Order history</h2>
      {history === null && <p className="muted">Loading…</p>}
      {history && history.length === 0 && <p className="muted">No orders yet.</p>}
      {history && history.map((o) => (
        <div key={o.id} className="history-item">
          <div className="history-top">
            <span>{o.ticketName || 'Order'}</span>
            <span>{formatMoney(o.total?.amount, o.total?.currency || currency)}</span>
          </div>
          <div className="muted" style={{ fontSize: 13, margin: '4px 0' }}>
            {o.createdAt ? new Date(o.createdAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : ''} · {o.state}
          </div>
          <div className="muted" style={{ fontSize: 13 }}>
            {o.items.map((li) => `${li.quantity}× ${li.name}${li.variation ? ` (${li.variation})` : ''}`).join(', ')}
          </div>
          {onReorder && o.items.some((li) => li.variationId) && (
            <button className="btn ghost" style={{ marginTop: 10, padding: '8px 14px', fontSize: 14 }} onClick={() => onReorder(o)}>Order this again</button>
          )}
        </div>
      ))}

      <button className="link center-link" onClick={onSignOut} style={{ marginTop: 20 }}>Sign out</button>
    </main>
  );
}
