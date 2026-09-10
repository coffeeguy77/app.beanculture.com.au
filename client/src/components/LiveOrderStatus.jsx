import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

// Live order tracker on the post-order screen. Polls the KDS-driven status so the
// customer sees Received → Being prepared → Ready, with a chime + buzz the moment
// staff hit Ready on the kitchen screen. No SMS or phone number needed — it just
// works while the app page is open.
const STEPS = [
  { key: 'new', label: 'Order received', sub: 'We’ll start it shortly.', emoji: '📝' },
  { key: 'preparing', label: 'Being prepared', sub: 'Your order is on the go.', emoji: '👨‍🍳' },
  { key: 'ready', label: 'Ready!', sub: '', emoji: '☕' },
];

export default function LiveOrderStatus({ orderId, dineIn, table }) {
  const [status, setStatus] = useState('new');
  const statusRef = useRef('new');
  const chimedRef = useRef(false);

  useEffect(() => {
    if (!orderId) return;
    let alive = true;
    const poll = async () => {
      try {
        const d = await api.orderStatus(orderId);
        if (!alive || !d || !d.status) return;
        statusRef.current = d.status;
        setStatus(d.status);
        if (d.status === 'ready' && !chimedRef.current) {
          chimedRef.current = true;
          try { if (navigator.vibrate) navigator.vibrate([140, 70, 140]); } catch {}
          try {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (AC) {
              const ac = new AC();
              const o = ac.createOscillator(); const g = ac.createGain();
              o.connect(g); g.connect(ac.destination);
              o.type = 'sine'; o.frequency.value = 880;
              g.gain.setValueAtTime(0.0001, ac.currentTime);
              g.gain.exponentialRampToValueAtTime(0.3, ac.currentTime + 0.02);
              g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.5);
              o.start(); o.stop(ac.currentTime + 0.52);
              setTimeout(() => { try { ac.close(); } catch {} }, 700);
            }
          } catch {}
        }
      } catch {}
    };
    poll();
    const iv = setInterval(() => { if (statusRef.current !== 'done') poll(); }, 8000);
    const stop = setTimeout(() => clearInterval(iv), 30 * 60000);
    return () => { alive = false; clearInterval(iv); clearTimeout(stop); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  const readyLabel = dineIn ? (table ? `Ready — on its way to table ${table}!` : 'Ready — on its way!') : 'Ready for collection!';

  if (status === 'done') {
    return (
      <div className="live-status done">
        <span className="live-status-emoji">✅</span>
        <div><b>{dineIn ? 'Delivered — enjoy!' : 'Collected — enjoy!'}</b></div>
      </div>
    );
  }

  const idx = Math.max(0, STEPS.findIndex((s) => s.key === status));
  const cur = STEPS[idx] || STEPS[0];
  const curLabel = cur.key === 'ready' ? readyLabel : cur.label;

  return (
    <div className={`live-status status-${status}`}>
      <div className="live-status-steps">
        {STEPS.map((s, i) => (
          <div key={s.key} className={`live-step${i <= idx ? ' on' : ''}${i === idx ? ' cur' : ''}`}>
            <span className="live-step-dot" />
            <span className="live-step-label">{s.key === 'ready' ? 'Ready' : s.label}</span>
          </div>
        ))}
      </div>
      <div className="live-status-now">
        <span className="live-status-emoji">{cur.emoji}</span>
        <div><b>{curLabel}</b>{cur.sub ? <span className="live-status-sub">{cur.sub}</span> : null}</div>
      </div>
    </div>
  );
}
