import React from 'react';

// Centralised Christmas vector assets (no emojis in the perimeter/nav).
// Gradients use fixed ids; reused instances share the same gradient — fine.

export function Bell({ size = 34 }) {
  return (
    <svg width={size} height={size * 1.15} viewBox="0 0 40 46" aria-hidden="true">
      <defs>
        <linearGradient id="bcBell" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f7e3a1" />
          <stop offset="0.45" stopColor="#e6b84b" />
          <stop offset="1" stopColor="#a9781f" />
        </linearGradient>
      </defs>
      <path d="M20 3c1.2 0 2 .9 2 2.1v1.2c6 1.4 9.5 6.3 9.5 12.6 0 6 .8 9.6 3.3 12.2.9.9.3 2.4-1 2.4H6.2c-1.3 0-1.9-1.5-1-2.4 2.5-2.6 3.3-6.2 3.3-12.2 0-6.3 3.5-11.2 9.5-12.6V5.1C18 4 18.8 3 20 3z"
        fill="url(#bcBell)" stroke="#8a5f16" strokeWidth="1" />
      <ellipse cx="15" cy="15" rx="2.6" ry="5" fill="#fff" opacity="0.35" />
      <circle cx="20" cy="40.5" r="3.2" fill="url(#bcBell)" stroke="#8a5f16" strokeWidth="1" />
    </svg>
  );
}

export function Holly({ size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <defs>
        <linearGradient id="bcHolly" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2f8f4e" />
          <stop offset="1" stopColor="#0f5c2b" />
        </linearGradient>
      </defs>
      <path d="M20 8c4-6 12-5 14-2-3 1-3 4-1 6-5 1-9-1-13-4z" fill="url(#bcHolly)" />
      <path d="M20 12c-4-6-12-5-14-2 3 1 3 4 1 6 5 1 9-1 13-4z" fill="url(#bcHolly)" />
      <path d="M22 20c5-4 13-1 14 3-3 0-4 3-2 5-5 0-9-3-12-8z" fill="url(#bcHolly)" />
      <circle cx="19" cy="19" r="3.2" fill="#d1202f" />
      <circle cx="24" cy="21" r="2.8" fill="#b71320" />
      <circle cx="20.5" cy="24" r="2.6" fill="#e23b47" />
    </svg>
  );
}

export function Pine({ w = 120, h = 40, flip }) {
  return (
    <svg width={w} height={h} viewBox="0 0 120 40" preserveAspectRatio="none" aria-hidden="true"
      style={flip ? { transform: 'scaleX(-1)' } : undefined}>
      <defs>
        <linearGradient id="bcPine" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1f7a44" />
          <stop offset="1" stopColor="#0c4a2a" />
        </linearGradient>
      </defs>
      <path d="M0 10 Q30 34 60 12 Q90 34 120 10 L120 40 L0 40 Z" fill="url(#bcPine)" />
      <g stroke="#2f9a57" strokeWidth="1.4" opacity="0.7">
        <path d="M12 14 l-5 8 M22 20 l4 8 M40 16 l-4 9 M58 14 l4 9 M78 18 l-5 8 M96 15 l4 9 M110 13 l-4 9" />
      </g>
    </svg>
  );
}

export function GingerbreadHouse({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 11 L12 4 L20 11 L20 21 L4 21 Z" fill="#b5762f" stroke="#8a5a22" strokeWidth="1" />
      <path d="M3 11 L12 4 L21 11" fill="none" stroke="#fff6e6" strokeWidth="1.6" strokeLinecap="round"
        strokeDasharray="1.5 2" />
      <rect x="10" y="14" width="4" height="7" rx="1" fill="#7a4a1c" />
      <circle cx="7.5" cy="14" r="1.1" fill="#f7e3a1" />
      <circle cx="16.5" cy="14" r="1.1" fill="#f7e3a1" />
      <circle cx="13.4" cy="16.5" r="0.7" fill="#d1202f" />
      <path d="M4 21 h16" stroke="#fff6e6" strokeWidth="1.4" strokeLinecap="round" strokeDasharray="1 2" />
    </svg>
  );
}

// User silhouette wearing a santa hat. aria-hidden — label stays on the button.
export function SantaUser({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="10.5" r="3.6" fill="currentColor" />
      <path d="M5 21c0-3.6 3.1-6 7-6s7 2.4 7 6z" fill="currentColor" />
      <path d="M6.5 7.2c1.2-3 8-4.6 11.2-1.6-2 .2-3.4 1.2-4.4 2.6-2-.8-4.6-1-6.8-1z" fill="#c1121f" />
      <path d="M6 7c2.6-.2 5.4 0 7.5 1-.6.7-1 1.5-1.2 2.4-2.3-.6-4.6-.4-6.6.2-.4-1.3-.1-2.7.3-3.6z" fill="#c1121f" />
      <circle cx="18" cy="5" r="1.7" fill="#fff" />
      <path d="M5 10.4c2.4-.8 5.2-1 7.6-.3l-.2 1.9c-2.2-.6-4.8-.5-7 .1z" fill="#fff" />
    </svg>
  );
}
