import React from 'react';

// Stroke (outline) icons. Colour follows the theme via currentColor.
const base = (size) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
});

// Palette → Theme customiser
export function ThemeIcon({ size = 22 }) {
  return (
    <svg {...base(size)}>
      <path d="M12 3C6.8 3 3 6.7 3 11.2c0 3.7 3 6.3 6.3 6.3.9 0 1.5.6 1.5 1.4 0 .4-.2.8-.4 1.1-.2.3-.3.6-.3.9 0 .9.8 1.6 1.9 1.6C18.5 22.5 21 18.3 21 13 21 7.5 17 3 12 3z" />
      <circle cx="8" cy="11" r="1.1" />
      <circle cx="12" cy="8" r="1.1" />
      <circle cx="16" cy="11" r="1.1" />
    </svg>
  );
}

// Coffee mug (item image fallback)
export function MugIcon({ size = 30 }) {
  return (
    <svg {...base(size)}>
      <path d="M5 8.5h11v6.5a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V8.5z" />
      <path d="M16 10.5h2.4a2.4 2.4 0 0 1 0 4.8H16" />
      <path d="M8 3.5c0 1-1 1-1 2M11.5 3.5c0 1-1 1-1 2" />
    </svg>
  );
}

export function AccountIcon({ size = 26 }) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="8.5" r="3.8" />
      <path d="M4.5 20c.6-4 3.8-6 7.5-6s6.9 2 7.5 6" />
    </svg>
  );
}

// Takeaway coffee cup → Coffee
export function CupIcon({ size = 30 }) {
  return (
    <svg {...base(size)}>
      <path d="M6.5 9h11l-1 10.2a2 2 0 0 1-2 1.8H9.5a2 2 0 0 1-2-1.8L6.5 9z" />
      <rect x="5.5" y="6" width="13" height="3" rx="1.2" />
      <path d="M10 3.2c0 1-1 1.2-1 2M14 3.2c0 1-1 1.2-1 2" />
    </svg>
  );
}

// Hamburger → All Day Menu
export function BurgerIcon({ size = 30 }) {
  return (
    <svg {...base(size)}>
      <path d="M3.5 9.5C3.5 6.7 7.3 4.5 12 4.5s8.5 2.2 8.5 5" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <path d="M4 15h16a4.2 4.2 0 0 1-4.2 3.6H8.2A4.2 4.2 0 0 1 4 15z" />
    </svg>
  );
}

// Grab & Go bag → Grab & Go
export function BagIcon({ size = 30 }) {
  return (
    <svg {...base(size)}>
      <path d="M6 8.5h12l-1 11.2a1.4 1.4 0 0 1-1.4 1.3H8.4A1.4 1.4 0 0 1 7 19.7L6 8.5z" />
      <path d="M9 8.5V7a3 3 0 0 1 6 0v1.5" />
    </svg>
  );
}

// Smoothie cup with straw → Smoothies
export function SmoothieIcon({ size = 30 }) {
  return (
    <svg {...base(size)}>
      <path d="M7 9h10l-1.1 10.3a2 2 0 0 1-2 1.7h-3.8a2 2 0 0 1-2-1.7L7 9z" />
      <path d="M6 9h12" />
      <path d="M13.5 9l3-5.2" />
    </svg>
  );
}

// Soda can → Cold Drinks
export function CanIcon({ size = 30 }) {
  return (
    <svg {...base(size)}>
      <rect x="8" y="5" width="8" height="15" rx="2.4" />
      <path d="M8 8h8" />
      <path d="M9.5 3.4h5" />
    </svg>
  );
}

// Coffee bean → Coffee Bags
export function BeanIcon({ size = 30 }) {
  return (
    <svg {...base(size)}>
      <ellipse cx="12" cy="12" rx="6" ry="8" transform="rotate(32 12 12)" />
      <path d="M9.4 7.2c2.4 2.8 2.4 6.8 0 9.6" />
    </svg>
  );
}
