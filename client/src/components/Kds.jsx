import React, { useEffect, useMemo, useRef, useState } from 'react';

// Kitchen Display / bump screen (/kds). A staff wall-tablet view: pick a station
// zone, see live tickets, colour by age, bump when done. Live updates arrive via
// Server-Sent Events (instant when Square webhooks are configured); a slow safety
// poll guarantees it never goes stale even with no webhook.
//
// Layout is chosen per device (localStorage), because the same /kds URL is opened
// on very different screens — a wall tablet, a phone in portrait, a phone in
// landscape. "Auto" adapts to width + orientation; Columns/Density/Text let a
// station override it. See the layout popover (▦) in the top bar.

const ALL = '__all__';
const LAYOUT_KEY = 'bc-kds-layout';

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

const DEFAULT_LAYOUT = { cols: 'auto', density: 'comfortable', text: 'normal', allDay: 'hide' };
function loadLayout() {
  try { return { ...DEFAULT_LAYOUT, ...(JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}') || {}) }; }
  catch { return { ...DEFAULT_LAYOUT }; }
}

export default function Kds({ onExit, embedded }) {
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
  const [layout, setLayout] = useState(loadLayout);
  const [showLayout, setShowLayout] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const seenRef = useRef(new Set());
  const firstLoad = useRef(true);

  const zones = useMemo(() => [{ id: ALL, name: 'All orders' }, ...((cfg && cfg.zones) || [])], [cfg]);
  const soundOn = cfg ? cfg.sound !== false && !muted : false;

  const cols = layout.cols || 'auto';
  const density = layout.density || 'comfortable';
  const textSize = layout.text || 'normal';
  const allDayMode = layout.allDay || 'hide';
  const setLayoutKey = (k, v) => setLayout((L) => ({ ...L, [k]: v }));

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
  useEffect(() => { try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch {} }, [layout]);

  // Capture the install prompt so "Add KDS app" can offer it (Android/desktop).
  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); setDeferredPrompt(e); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  async function bump(orderId, status) {
    setTickets((ts) => ts.map((t) => (t.orderId === orderId ? { ...t, zoneStatus: { ...t.zoneStatus, [zone]: status } } : t)));
    try {
      await fetch(`/api/admin/kds/bump?pass=${encodeURIComponent(pass)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, zone, status }),
      });
    } catch { loadTickets(); }
  }

  async function installKds() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    try { await deferredPrompt.userChoice; } catch {}
    setDeferredPrompt(null);
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

  const isIos = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = typeof window !== 'undefined' &&
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone);

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

  const rootClass = `kds-root${embedded ? ' kds-embedded' : ''}${density === 'compact' ? ' kds-compact' : ''}${textSize === 'large' ? ' kds-lg' : ''}`;
  const gridStyle = cols === 'auto' ? undefined : { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` };

  const Seg = ({ label: lbl, value, options, onPick }) => (
    <div className="kds-seg-row">
      <span className="kds-seg-label">{lbl}</span>
      <div className="kds-seg">
        {options.map((o) => (
          <button key={o.v} className={`kds-seg-btn${value === o.v ? ' on' : ''}`} onClick={() => onPick(o.v)}>{o.t}</button>
        ))}
      </div>
    </div>
  );

  return (
    <div className={rootClass}>
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
          <button className={`kds-icon${showLayout ? ' on' : ''}`} title="Layout" onClick={() => setShowLayout((v) => !v)}>▦</button>
          <button className="kds-icon" title={soundOn ? 'Mute new-order sound' : 'Unmute'} onClick={() => setMuted((m) => !m)}>{soundOn ? '🔔' : '🔕'}</button>
          <button className="kds-icon" title="Refresh" onClick={() => loadTickets()}>⟳</button>
        </div>
      </header>

      {showLayout && (
        <>
          <div className="kds-pop-scrim" onClick={() => setShowLayout(false)} />
          <div className="kds-pop" role="dialog" aria-label="Layout">
            <div className="kds-pop-title">Screen layout</div>
            <Seg lbl="Columns" value={cols}
              options={[{ v: 'auto', t: 'Auto' }, { v: '1', t: '1' }, { v: '2', t: '2' }, { v: '3', t: '3' }, { v: '4', t: '4' }]}
              onPick={(v) => setLayoutKey('cols', v)} />
            <Seg lbl="Density" value={density}
              options={[{ v: 'comfortable', t: 'Comfortable' }, { v: 'compact', t: 'Compact' }]}
              onPick={(v) => setLayoutKey('density', v)} />
            <Seg lbl="Text size" value={textSize}
              options={[{ v: 'normal', t: 'Normal' }, { v: 'large', t: 'Large' }]}
              onPick={(v) => setLayoutKey('text', v)} />
            <Seg lbl="All-day summary" value={allDayMode}
              options={[{ v: 'hide', t: 'Hide' }, { v: 'show', t: 'Show' }]}
              onPick={(v) => setLayoutKey('allDay', v)} />
            <p className="kds-pop-hint">Auto adapts to this screen’s size and orientation. Saved on this device.</p>

            {!standalone && (
              <div className="kds-pop-install">
                <div className="kds-pop-subtitle">Add KDS app to this device</div>
                {deferredPrompt ? (
                  <button className="kds-btn primary" onClick={installKds}>＋ Install Bean Culture KDS</button>
                ) : isIos ? (
                  <p className="kds-pop-hint">In Safari, tap the <b>Share</b> icon → <b>Add to Home Screen</b>. It installs as “Bean Culture KDS” and opens straight to this screen.</p>
                ) : (
                  <p className="kds-pop-hint">Open your browser menu and choose <b>Install app</b> / <b>Add to Home screen</b> — it saves as “Bean Culture KDS”, opening straight to this screen.</p>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {allDayMode === 'show' && allDay.length > 0 && (
        <div className="kds-allday">
          <span className="kds-allday-label">All day</span>
          {allDay.slice(0, 12).map(([name, n]) => (
            <span key={name} className="kds-allday-item"><b>{n}</b> {name}</span>
          ))}
        </div>
      )}

      {err && <div className="kds-err">{err}</div>}

      <div className={`kds-grid${cols === 'auto' ? ' kds-auto' : ''}`} style={gridStyle}>
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
