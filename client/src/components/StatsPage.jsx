import React, { useEffect, useState } from 'react';

// Standalone organiser stats page (served at /stats). No app chrome — it's a
// private, shareable read-out for whoever ran the event. Access is gated by the
// event's share code (?event=<id>&key=<code>); if the code is missing we prompt
// for it. Shows totals, a per-booth breakdown, the app-vs-counter split, and the
// full guest list (name + mobile + booth).
const params = new URLSearchParams(window.location.search);

function money(cents, cur) {
  try { return new Intl.NumberFormat('en-AU', { style: 'currency', currency: cur || 'AUD' }).format((cents || 0) / 100); }
  catch { return `$${((cents || 0) / 100).toFixed(2)}`; }
}
function when(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); }
  catch { return ''; }
}

export default function StatsPage() {
  const event = params.get('event') || '';
  const [key, setKey] = useState(params.get('key') || '');
  const [days, setDays] = useState(Number(params.get('days')) || 30);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [codeInput, setCodeInput] = useState('');

  async function load(k = key, d = days) {
    if (!event || !k) return;
    setBusy(true); setErr('');
    try {
      const r = await fetch(`/api/stats?event=${encodeURIComponent(event)}&key=${encodeURIComponent(k)}&days=${d}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not load stats');
      setData(j);
    } catch (e) { setErr(e.message); setData(null); }
    finally { setBusy(false); }
  }
  useEffect(() => { if (event && key) load(key, days); /* eslint-disable-next-line */ }, []);

  const card = { background: '#fff', border: '1px solid #eadfe4', borderRadius: 14, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,.04)' };
  const wrap = { maxWidth: 820, margin: '0 auto', padding: '24px 16px 60px', color: '#3b2b30', fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' };

  if (!event) return <div style={wrap}><div style={card}>This link is missing its event. Please use the full stats link you were sent.</div></div>;

  // No code yet — prompt for it.
  if (!key || (err && /access code/i.test(err))) {
    return (
      <div style={{ ...wrap, maxWidth: 420 }}>
        <h1 style={{ fontSize: 22, marginBottom: 4 }}>Event stats</h1>
        <p style={{ color: '#8a7680', marginTop: 0, fontSize: 14 }}>Enter the access code you were given to view this event’s numbers.</p>
        <div style={card}>
          <input value={codeInput} onChange={(e) => setCodeInput(e.target.value)} placeholder="Access code" autoCapitalize="none"
            style={{ width: '100%', padding: '10px 12px', border: '1px solid #eadfe4', borderRadius: 10, fontSize: 16, boxSizing: 'border-box' }} />
          {err && <p style={{ color: '#c0392b', fontSize: 13 }}>{err}</p>}
          <button onClick={() => { const k = codeInput.trim(); setKey(k); const u = new URL(window.location); u.searchParams.set('key', k); window.history.replaceState({}, '', u); load(k, days); }}
            disabled={busy || !codeInput.trim()}
            style={{ marginTop: 10, width: '100%', padding: '11px 12px', border: 'none', borderRadius: 10, background: '#b5566e', color: '#fff', fontSize: 16, fontWeight: 600, cursor: 'pointer' }}>
            {busy ? 'Checking…' : 'View stats'}
          </button>
        </div>
      </div>
    );
  }

  const Stat = ({ label, value, sub }) => (
    <div style={{ ...card, flex: '1 1 150px', minWidth: 140 }}>
      <div style={{ fontSize: 12, color: '#8a7680', textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      <div style={{ fontSize: 30, fontWeight: 800, lineHeight: 1.1, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: '#8a7680', marginTop: 2 }}>{sub}</div>}
    </div>
  );

  return (
    <div style={wrap}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <h1 style={{ fontSize: 24, margin: 0 }}>{data?.event?.name || 'Event'} — stats</h1>
        <select value={days} onChange={(e) => { const d = Number(e.target.value); setDays(d); load(key, d); }} style={{ marginLeft: 'auto', padding: '6px 8px', borderRadius: 8, border: '1px solid #eadfe4' }}>
          <option value={1}>Today</option><option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option>
        </select>
        <button onClick={() => load()} disabled={busy} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #eadfe4', background: '#fff', cursor: 'pointer' }}>{busy ? '…' : 'Refresh'}</button>
      </div>
      {err && <div style={{ ...card, color: '#c0392b' }}>{err}</div>}
      {data && (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <Stat label="Free coffees" value={data.freeCups} sub={`${data.freeOrders} orders`} />
            <Stat label="Guests" value={data.uniqueGuests} sub="unique people" />
            <Stat label="Paid sales" value={money(data.paidSales, data.currency)} sub={`${data.paidOrders} paid orders`} />
            <Stat label="Via app / counter" value={`${data.bySource.app} / ${data.bySource.pos}`} sub={data.bySource.other ? `${data.bySource.other} other` : 'self-order / POS'} />
          </div>

          {data.byBooth && data.byBooth.length > 0 && (
            <div style={{ ...card, marginBottom: 16 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Coffees by booth</div>
              {data.byBooth.map((b, i) => {
                const max = data.byBooth[0].cups || 1;
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '3px 0' }}>
                    <span style={{ minWidth: 130, fontSize: 14 }}>{b.booth}</span>
                    <span style={{ flex: 1, height: 10, background: '#f2e6ea', borderRadius: 6, overflow: 'hidden' }}>
                      <span style={{ display: 'block', height: '100%', width: `${Math.round((b.cups / max) * 100)}%`, background: '#b5566e' }} />
                    </span>
                    <strong style={{ minWidth: 30, textAlign: 'right' }}>{b.cups}</strong>
                  </div>
                );
              })}
            </div>
          )}

          <div style={card}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Guests ({data.guests.length})</div>
            {data.guests.length === 0 && <div style={{ color: '#8a7680', fontSize: 14 }}>No coffees yet in this window.</div>}
            {data.guests.map((g, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '6px 0', borderTop: i ? '1px solid #f2e6ea' : 'none', flexWrap: 'wrap' }}>
                <strong style={{ minWidth: 130 }}>{g.name}</strong>
                <a href={`tel:${g.phone}`} style={{ color: '#b5566e', textDecoration: 'none' }}>{g.phone || '—'}</a>
                {g.booth && <span style={{ fontSize: 12, background: '#f2e6ea', padding: '2px 8px', borderRadius: 20 }}>{g.booth}</span>}
                {g.paidExtra && <span style={{ fontSize: 12, background: '#e7f0e7', padding: '2px 8px', borderRadius: 20 }}>+ purchase</span>}
                <span style={{ marginLeft: 'auto', color: '#8a7680', fontSize: 13 }}>{when(g.at)}</span>
              </div>
            ))}
          </div>
          <p style={{ color: '#8a7680', fontSize: 12, marginTop: 14 }}>Private link — anyone with the code can see this. Live from Square.</p>
        </>
      )}
    </div>
  );
}
