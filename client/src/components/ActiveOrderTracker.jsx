import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

// A persistent "your order" banner. Once an order is placed it follows the
// customer around the app (and survives a reload / locking the phone), polling
// the KDS-driven status so they see Received → Being prepared → Ready even if
// they navigated away from the confirmation screen. Clears itself on collection
// or after 60 minutes, or when the customer double-taps the ✕. No SMS / phone
// number needed. Only shown when the café enables it (Admin → Kitchen Screen).

const KEY = 'bc-active-order';
const MAX_AGE_MS = 60 * 60000; // auto-dismiss 60 minutes after ordering
export function saveActiveOrder(o) {
  try { if (o && o.orderId) localStorage.setItem(KEY, JSON.stringify({ ...o, at: Date.now() })); } catch {}
}
export function clearActiveOrder() { try { localStorage.removeItem(KEY); } catch {} }
function readActiveOrder() {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!o || !o.orderId) return null;
    // A pre-order stays until an hour AFTER its scheduled time; a normal order,
    // an hour after it was placed.
    const base = o.scheduledAt ? new Date(o.scheduledAt).getTime() : (o.at || 0);
    if (Date.now() - base > MAX_AGE_MS) return null;   // stale
    return o;
  } catch { return null; }
}

const LABELS = {
  new: { t: 'Order received', e: '📝' },
  preparing: { t: 'Being prepared', e: '👨‍🍳' },
  ready: { t: 'Ready for collection!', e: '☕' },
};

function readyChime() {
  try { if (navigator.vibrate) navigator.vibrate([140, 70, 140]); } catch {}
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ac = new AC();
    const o = ac.createOscillator(); const g = ac.createGain();
    o.connect(g); g.connect(ac.destination);
    o.type = 'sine'; o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.3, ac.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.5);
    o.start(); o.stop(ac.currentTime + 0.52);
    setTimeout(() => { try { ac.close(); } catch {} }, 700);
  } catch {}
}

export default function ActiveOrderTracker({ paused }) {
  const [order, setOrder] = useState(readActiveOrder);
  const [status, setStatus] = useState('new');
  const [msg, setMsg] = useState('');        // café's custom "ready" message, if any
  const [hintX, setHintX] = useState(false); // brief "tap again to close" nudge
  const [nowTs, setNowTs] = useState(Date.now()); // ticks the pre-order countdown
  const chimedRef = useRef(false);
  const notifiedRef = useRef(null); // last-seen "notified at" — a newer one = re-chime
  const lastTapRef = useRef(0);

  // Keep the "ready in X min" countdown fresh for a pre-order.
  useEffect(() => { const iv = setInterval(() => setNowTs(Date.now()), 30000); return () => clearInterval(iv); }, []);

  // Pick up a newly-saved order (set right after checkout) without a reload.
  useEffect(() => {
    const iv = setInterval(() => {
      const o = readActiveOrder();
      setOrder((prev) => {
        if (!o) return null;
        if (!prev || prev.orderId !== o.orderId) { chimedRef.current = false; notifiedRef.current = null; return o; }
        return prev;
      });
    }, 4000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (!order) return;
    let alive = true;
    const poll = async () => {
      try {
        const d = await api.orderStatus(order.orderId);
        if (!alive || !d || !d.status) return;
        setStatus(d.status);
        // A new bump can change the custom message (coffee → then food), so keep
        // it in sync each poll. Re-chime when the message changes to a new one.
        setMsg((prev) => {
          const next = d.message || '';
          if (d.status === 'ready' && next && next !== prev) chimedRef.current = false;
          return next;
        });
        // Staff pressed "Notify" again (a newer notifiedAt) → re-chime to remind a
        // customer who missed the first alert. Not on the very first read.
        if (d.status === 'ready' && d.notifiedAt && notifiedRef.current && d.notifiedAt !== notifiedRef.current) {
          chimedRef.current = false;
        }
        if (d.notifiedAt) notifiedRef.current = d.notifiedAt;
        if (d.status === 'ready' && !chimedRef.current) { chimedRef.current = true; readyChime(); }
        if (d.status === 'done') { clearActiveOrder(); setOrder(null); }
      } catch {}
    };
    poll();
    const iv = setInterval(poll, 8000);
    return () => { alive = false; clearInterval(iv); };
  }, [order && order.orderId]);

  if (!order || paused || status === 'done') return null;
  const l = LABELS[status] || LABELS.new;
  // A pre-order that hasn't been made yet shows a countdown to its pickup time
  // instead of "being made now" (until staff actually bump it ready).
  const schedMs = order.scheduledAt ? new Date(order.scheduledAt).getTime() : 0;
  const schedPending = schedMs && nowTs < schedMs && status !== 'ready';
  const fmtClock = (ms) => { try { return new Date(ms).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }); } catch { return ''; } };
  const untilStr = (ms) => { const s = Math.round((ms - nowTs) / 1000); if (s <= 0) return 'soon'; const m = Math.round(s / 60); if (m < 60) return `in ${m} min`; const h = Math.floor(m / 60); return `in ${h}h ${m % 60}m`; };
  const emoji = schedPending ? '⏰' : l.e;
  const heading = order.scheduledAt ? 'Your pre-order' : 'Your order';
  const label = schedPending
    ? `Ready ~${fmtClock(schedMs)} · ${untilStr(schedMs)}`
    : status === 'ready'
      ? (msg || (order.dineIn
          ? (order.table ? `Coming to table ${order.table} — sit tight!` : 'On its way to your table — sit tight!')
          : 'Order ready — come on in!'))
      : l.t;
  const dismiss = () => { clearActiveOrder(); setOrder(null); };
  // Require a DOUBLE tap/click to close (two within 500ms), so an accidental
  // single tap never dismisses the tracker. onClick fires for both mouse and
  // touch, so this works reliably on phones where dblclick often doesn't.
  const onXTap = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 500) { lastTapRef.current = 0; dismiss(); return; }
    lastTapRef.current = now;
    setHintX(true);
    setTimeout(() => setHintX(false), 1400);
  };

  return (
    <div className={`active-order-bar status-${status}${schedPending ? ' scheduled' : ''}`} role="status">
      <span className="active-order-emoji">{emoji}</span>
      <div className="active-order-txt"><b>{heading}</b><span>{hintX ? 'Tap ✕ again to close' : label}</span></div>
      <button className="active-order-x" onClick={onXTap} title="Double-tap to dismiss" aria-label="Double-tap to dismiss">✕</button>
    </div>
  );
}
