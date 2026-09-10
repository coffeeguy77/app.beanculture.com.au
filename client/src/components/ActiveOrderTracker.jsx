import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

// A persistent "your order" banner. Once an order is placed it follows the
// customer around the app (and survives a reload / locking the phone), polling
// the KDS-driven status so they see Received → Being prepared → Ready even if
// they navigated away from the confirmation screen. Clears itself on collection
// or after 30 minutes. No SMS / phone number needed.

const KEY = 'bc-active-order';
export function saveActiveOrder(o) {
  try { if (o && o.orderId) localStorage.setItem(KEY, JSON.stringify({ ...o, at: Date.now() })); } catch {}
}
export function clearActiveOrder() { try { localStorage.removeItem(KEY); } catch {} }
function readActiveOrder() {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!o || !o.orderId) return null;
    if (Date.now() - (o.at || 0) > 30 * 60000) return null;   // stale
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
  const chimedRef = useRef(false);

  // Pick up a newly-saved order (set right after checkout) without a reload.
  useEffect(() => {
    const iv = setInterval(() => {
      const o = readActiveOrder();
      setOrder((prev) => {
        if (!o) return null;
        if (!prev || prev.orderId !== o.orderId) { chimedRef.current = false; return o; }
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
  const label = status === 'ready'
    ? (order.dineIn ? (order.table ? `Ready — coming to table ${order.table}!` : 'Ready — on its way!') : 'Ready for collection!')
    : l.t;

  return (
    <div className={`active-order-bar status-${status}`} role="status">
      <span className="active-order-emoji">{l.e}</span>
      <div className="active-order-txt"><b>Your order</b><span>{label}</span></div>
      <button className="active-order-x" onClick={() => { clearActiveOrder(); setOrder(null); }} aria-label="Dismiss">✕</button>
    </div>
  );
}
