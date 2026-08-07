// Lightweight, privacy-light analytics. A random per-device session id (not tied
// to identity) lets the owner see visitors, product interest and conversion.
// Events are queued and flushed in small batches; failures are ignored.
import { api } from './api.js';

function sid() {
  try {
    let s = localStorage.getItem('bc_sid');
    if (!s) { s = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('bc_sid', s); }
    return s;
  } catch { return 'anon'; }
}

let queue = [];
let timer = null;
function schedule() { if (!timer) timer = setTimeout(flush, 1500); }
async function flush() {
  timer = null;
  const events = queue.splice(0, 50);
  if (!events.length) return;
  try { await api.track(events); } catch { /* ignore */ }
}

export function track(type, opts = {}) {
  queue.push({ type, ref: opts.ref, session: sid(), qty: opts.qty || 1, amount: opts.amount || 0 });
  schedule();
}
export function trackItems(type, items) {
  for (const it of items || []) queue.push({ type, ref: it.name, session: sid(), qty: it.qty || 1, amount: it.amount || 0 });
  schedule();
}
// Flush promptly when the page is hidden (e.g. purchase then close).
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
}
