import React, { useMemo } from 'react';
import { formatMoney } from '../api.js';

// A cheerful set of balloon colours that rise up the page on the customer's
// birthday. Purely decorative (pointer-events: none via CSS).
const BALLOON_COLORS = ['#ff5d8f', '#ffd23f', '#6c8cff', '#3ec6a0', '#ff8a3d', '#b06cff', '#ff4d4d', '#28c0e0'];

// Rising multi-colour balloons + a personal birthday banner, shown only on the
// signed-in customer's birthday. The gift itself is applied at checkout; this is
// the celebration.
export function BirthdayOverlay({ offer, name, currency, onDismiss, onTerms }) {
  // Personalise: {name} in the title/message becomes the customer's first name.
  const first = String(name || '').trim().split(/\s+/)[0] || '';
  const fill = (t) => {
    let s = String(t || '');
    s = first ? s.replace(/\{name\}/g, first) : s.replace(/,?\s*\{name\}/g, '');
    return s;
  };
  const balloons = useMemo(() => Array.from({ length: 16 }).map((_, i) => ({
    c: BALLOON_COLORS[i % BALLOON_COLORS.length],
    left: Math.min(97, Math.max(1, Math.round((i / 16) * 100 + (Math.random() * 6 - 3)))),
    dur: 7 + Math.random() * 6,
    delay: Math.random() * 6,
    size: 26 + Math.round(Math.random() * 20),
    sway: Math.round((Math.random() * 2 - 1) * 16),
  })), []);
  if (!offer) return null;
  return (
    <>
      <div className="bday-balloons" aria-hidden="true">
        {balloons.map((b, i) => (
          <span key={i} className="bday-balloon" style={{ left: `${b.left}%`, animationDuration: `${b.dur}s`, animationDelay: `${b.delay}s`, '--sway': `${b.sway}px` }}>
            <svg width={b.size} height={Math.round(b.size * 1.5)} viewBox="0 0 40 60" aria-hidden="true">
              <ellipse cx="20" cy="21" rx="16" ry="20" fill={b.c} />
              <ellipse cx="14" cy="14" rx="4" ry="6" fill="rgba(255,255,255,.35)" />
              <path d="M20 41 l-3.2 5 h6.4 z" fill={b.c} />
              <path d="M20 46 q5 7 0 13" stroke={b.c} strokeWidth="1.4" fill="none" />
            </svg>
          </span>
        ))}
      </div>
      <div className="bday-banner" role="status">
        <button className="bday-x" onClick={onDismiss} aria-label="Close">✕</button>
        {offer.bannerImage
          ? <img className="bday-img" src={offer.bannerImage} alt="" />
          : <div className="bday-emoji">🎉🎂</div>}
        <div className="bday-title">{fill(offer.title) || (first ? `Happy Birthday, ${first}! 🎂` : 'Happy Birthday! 🎂')}</div>
        <div className="bday-msg">{fill(offer.message)}</div>
        {offer.valueCents > 0 && (
          <div className="bday-gift">🎁 Your gift: a drink up to {formatMoney(offer.valueCents, currency)} — free at checkout today</div>
        )}
        {onTerms && <button className="bday-terms-link" onClick={onTerms}>Read the terms</button>}
      </div>
    </>
  );
}

// The birthday-gift terms modal (rules the customer can read).
export function BirthdayTerms({ terms, onClose }) {
  const paras = String(terms || '').split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <button className="sheet-close" onClick={onClose} aria-label="Close">✕</button>
        <div className="sheet-body">
          <h2 style={{ marginBottom: 8 }}>🎂 Birthday gift — terms</h2>
          {paras.length === 0
            ? <p className="muted">Terms are being finalised — please ask our team.</p>
            : paras.map((p, i) => <p key={i} className="muted" style={{ fontSize: 13.5, lineHeight: 1.5 }}>{p}</p>)}
        </div>
      </div>
    </div>
  );
}
