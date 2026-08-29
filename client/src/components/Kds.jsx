import React, { useEffect, useMemo, useRef, useState } from 'react';

// Kitchen Display / bump screen (/kds). A staff wall-tablet view: pick a station
// zone, see live tickets, colour by age, bump when done. Live updates arrive via
// Server-Sent Events (instant when Square webhooks are configured); a slow safety
// poll guarantees it never goes stale even with no webhook.

const ALL = '__all__';

// Short WebAudio chime for new tickets — no asset needed.
function chime() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ac = new AC();
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.connect(g); g.connect(ac.destination);
    o.type = 'sine'; o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.3, ac.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.45);
    o.start(); o.stop(ac.currentTime + 0.47);
    setTimeout(() => { try { ac.close(); } catch {} }, 800);
  } catch {}
}

const two = (n) => String(n).padStart(2, '0');
const fmtAge = (sec) => `${Math.floor(sec / 60)}:${two(sec % 60)}`;

export default function Kds({ onExit }) {
  const [pass, setPass] = useState(() => { try { return atob(localStorage.getItem('bc-admin-pass') || '') || ''; } catch { return ''; } });
  const [passInput, setPassInput] = useState('');
  const [needPass, setNeedPass] = useState(false);
  const [cfg, setCfg] = useState(null);
  const [zone, setZone] = useState(() => { try { return localStorage.getItem('bc-kds-zone') || ALL; } catch { return ALL; } });
  const [tickets, setTickets] = useState([]);
  const [err, setErr] = useState('');
  const [now, setNow] = useState(Date.now());
  const [live, setLive] = useState(false);
  const [muted, setMuted] = useState(() => { try { return localStorage.getItem('bc-kds-muted') === '1'; } catch { return false; } });
  const seenRef = useRef(new Set());
  const firstLoad = useRef(true);

  const zones = useMemo(() => [{ id: ALL, name: 'All orders' }, ...((cfg && cfg.zones) || [])], [cfg]);
  const soundOn = cfg ? cfg.sound !== false && !muted : false;

  async function loadConfig(p) {
    const r = await fetch(`/api/admin/kds/config?pass=${encodeURIComponent(p)}`);
    if (r.status === 401) { setNeedPass(true); return false; }
    const d = await r.json();
    setCfg(d); setNeedPass(false);
    try { localStorage.setItem('bc-admin-pass', btoa(p)); } catch {}
    return true;
  }
  async function loadTickets(p = pass) {
    try {
      const r = await fetch(`/api/admin/kds/tickets?pass=${encodeURIComponent(p)}`);
      if (r.status === 401) { setNeedPass(true); return; }
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed to load tickets');
      setErr('');
      const incoming = d.tickets || [];
      const fresh = incoming.filter((t) => !seenRef.current.has(t.orderId));
      if (!firstLoad.current && fresh.length && soundOn) chime();
      firstLoad.current = false;
      incoming.forEach((t) => seenRef.current.add(t.orderId));
      setTickets(incoming);
    } catch (e) { setErr(e.message); }
  }

  // Initial load
  useEffect(() => {
    if (!pass) { setNeedPass(true); return; }
    loadConfig(pass).then((okk) => { if (okk) loadTickets(pass); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live stream + safety poll + 1s age tick
  useEffect(() => {
    if (needPass || !cfg) return;
    let es;
    try {
      es = new EventSource(`/api/admin/kds/stream?pass=${encodeURIComponent(pass)}`);
      es.addEventListener('hello', () => setLive(true));
      es.addEventListener('changed', () => loadTickets());
      es.onerror = () => setLive(false);
    } catch {}
    const poll = setInterval(() => loadTickets(), 10000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const onVis = () => { if (!document.hidden) loadTickets(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { try { es && es.close(); } catch {} clearInterval(poll); clearInterval(tick); document.removeEventListener('visibilitychange', onVis); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needPass, cfg, pass]);

  useEffect(() => { try { localStorage.setItem('bc-kds-zone', zone); } catch {} }, [zone]);
  useEffect(() => { try { localStorage.setItem('bc-kds-muted', muted ? '1' : '0'); } catch {} }, [muted]);

  async function bump(orderId, status) {
    setTickets((ts) => ts.map((t) => (t.orderId === orderId ? { ...t, zoneStatus: { ...t.zoneStatus, [zone]: status } } : t)));
    try {
      await fetch(`/api/admin/kds/bump?pass=${encodeURIComponent(pass)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, zone, status }),
      });
    } catch { loadTickets(); }
  }

  // Age → urgency level
  const amberMin = cfg ? cfg.amberMin : 6;
  const redMin = cfg ? cfg.redMin : 12;
  const ageOf = (t) => Math.max(0, Math.round((now - new Date(t.createdAt).getTime()) / 1000));
  const levelOf = (sec) => { const m = sec / 60; return m >= redMin ? 'red' : m >= amberMin ? 'amber' : 'green'; };

  // Tickets in this zone: active (not done) and a small recall strip (done)
  const inZone = (t) => !!t.zoneItems[zone];
  const active = tickets.filter((t) => inZone(t) && t.zoneStatus[zone] !== 'done')
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)); // oldest first (FIFO)
  const doneRecent = tickets.filter((t) => inZone(t) && t.zoneStatus[zone] === 'done')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 8);

  // All-day counts for the current zone's active tickets
  const allDay = useMemo(() => {
    const map = new Map();
    for (const t of active) {
      for (const it of t.zoneItems[zone]) {
        const key = it.variation ? `${it.name} · ${it.variation}` : it.name;
        map.set(key, (map.get(key) || 0) + (Number(it.quantity) || 1));
      }
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [active, zone]);

  // ── Passcode gate ──
  if (needPass) {
    return (
      <div className="kds-root kds-login">
        <div className="kds-login-card">
          <div className="kds-login-title">Kitchen screen</div>
          <p>Enter the staff passcode to open the bump screen.</p>
          <input type="password" value={passInput} autoFocus
            onChange={(e) => setPassInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { setPass(passInput); loadConfig(passInput).then((okk) => { if (okk) loadTickets(passInput); }); } }}
            placeholder="Passcode" />
          <button className="kds-btn primary" onClick={() => { setPass(passInput); loadConfig(passInput).then((okk) => { if (okk) loadTickets(passInput); }); }}>Open</button>
          <button className="kds-link" onClick={onExit}>← Back to store</button>
        </div>
      </div>
    );
  }
  if (!cfg) return <div className="kds-root kds-center"><div className="kds-spinner" /></div>;

  const label = (t) => t.customerName || (t.dineIn ? (t.table ? `Table ${t.table}` : 'Dine-in') : `#${t.orderId.slice(-4)}`);

  return (
    <div className="kds-root">
      <header className="kds-top">
        <div className="kds-zones">
          {zones.map((z) => {
            const count = tickets.filter((t) => t.zoneItems[z.id] && t.zoneStatus[z.id] !== 'done').length;
            return (
              <button key={z.id} className={`kds-zone${zone === z.id ? ' on' : ''}`} onClick={() => setZone(z.id)}>
                {z.name}{count ? <span className="kds-zone-count">{count}</span> : null}
              </button>
            );
          })}
        </div>
        <div className="kds-top-right">
          <span className={`kds-live${live ? ' on' : ''}`} title={live ? 'Live' : 'Reconnecting…'}>{live ? '● Live' : '○ Polling'}</span>
          <button className="kds-icon" title={soundOn ? 'Mute new-order sound' : 'Unmute'} onClick={() => setMuted((m) => !m)}>{soundOn ? '🔔' : '🔕'}</button>
          <button className="kds-icon" title="Refresh" onClick={() => loadTickets()}>⟳</button>
          <button className="kds-icon" title="Exit" onClick={onExit}>✕</button>
        </div>
      </header>

      {allDay.length > 0 && (
        <div className="kds-allday">
          <span className="kds-allday-label">All day</span>
          {allDay.slice(0, 12).map(([name, n]) => (
            <span key={name} className="kds-allday-item"><b>{n}</b> {name}</span>
          ))}
        </div>
      )}

      {err && <div className="kds-err">{err}</div>}

      <div className="kds-grid">
        {active.length === 0 && !err && <div className="kds-empty">No open tickets in this zone. New orders appear here automatically.</div>}
        {active.map((t) => {
          const sec = ageOf(t);
          const lvl = levelOf(sec);
          const st = t.zoneStatus[zone];
          const items = t.zoneItems[zone] || [];
          return (
            <div key={t.orderId} className={`kds-card lvl-${lvl}${st === 'preparing' ? ' preparing' : ''}`}>
              <div className="kds-card-head">
                <div className="kds-card-title">
                  {label(t)}
                  {t.appOrigin && <span className="kds-badge origin">APP</span>}
                  <span className={`kds-badge ${t.dineIn ? 'dinein' : 'takeaway'}`}>{t.dineIn ? (t.table ? `T${t.table}` : 'Dine-in') : 'Takeaway'}</span>
                </div>
                <div className={`kds-age lvl-${lvl}`}>{fmtAge(sec)}</div>
              </div>
              <ul className="kds-items">
                {items.map((it, i) => (
                  <li key={i} className="kds-item">
                    <span className="kds-qty">{it.quantity}×</span>
                    <span className="kds-item-body">
                      <span className="kds-item-name">{it.name}{it.variation ? <em> · {it.variation}</em> : null}</span>
                      {it.modifiers.length > 0 && <span className="kds-mods">{it.modifiers.join(', ')}</span>}
                      {it.note && <span className="kds-note">“{it.note}”</span>}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="kds-card-foot">
                {cfg.showPrepStep && st === 'new' && (
                  <button className="kds-btn start" onClick={() => bump(t.orderId, 'preparing')}>Start</button>
                )}
                <button className="kds-btn bump" onClick={() => bump(t.orderId, 'done')}>Bump ✓</button>
              </div>
            </div>
          );
        })}
      </div>

      {doneRecent.length > 0 && (
        <div className="kds-recall">
          <span className="kds-recall-label">Just bumped:</span>
          {doneRecent.map((t) => (
            <button key={t.orderId} className="kds-recall-chip" title="Recall this ticket" onClick={() => bump(t.orderId, 'new')}>
              ↺ {label(t)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
