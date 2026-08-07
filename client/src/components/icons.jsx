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

// Coffee bean → Coffee Bags (Lucide-style: two nested curves)
export function BeanIcon({ size = 30 }) {
  return (
    <svg {...base(size)}>
      <path d="M10.2 6.6C10 7.5 9.6 8.4 9 9c-.6.6-1.5 1-2.4 1.2A6 6 0 1 0 10.2 6.6Z" />
      <path d="M5.3 10.6a4 4 0 1 0 5.3-5.3" />
    </svg>
  );
}

// Iced drink / ice cubes → Cold Drinks (or a combined cold group)
export function IceIcon({ size = 30 }) {
  return (
    <svg {...base(size)}>
      <path d="M6.5 7h11l-1.2 12.2a2 2 0 0 1-2 1.8H9.7a2 2 0 0 1-2-1.8L6.5 7z" />
      <path d="M5.5 7h13" />
      <rect x="9" y="10" width="3.6" height="3.6" rx="0.6" transform="rotate(10 10.8 11.8)" />
      <rect x="12" y="13" width="3.4" height="3.4" rx="0.6" transform="rotate(-12 13.7 14.7)" />
    </svg>
  );
}

// Milkshake → Shakes
export function ShakeIcon({ size = 30 }) {
  return (
    <svg {...base(size)}>
      <path d="M7 9h10l-1 10.2a2 2 0 0 1-2 1.8h-4a2 2 0 0 1-2-1.8L7 9z" />
      <path d="M6.4 9a5.6 3 0 0 1 11.2 0" />
      <path d="M12 6V3.6" />
      <circle cx="12" cy="2.8" r="1" />
    </svg>
  );
}

// Tea cup → Tea
export function TeaIcon({ size = 30 }) {
  return (
    <svg {...base(size)}>
      <path d="M5.5 8.5h9.5v3.5a4.8 4.8 0 0 1-9.5 0V8.5z" />
      <path d="M15 9.5h1.7a2.1 2.1 0 0 1 0 4.2H15" />
      <path d="M4.5 18.5h12.5" />
      <path d="M8.5 3.4c0 1-1 1-1 2M11.5 3.4c0 1-1 1-1 2" />
    </svg>
  );
}

// ── Food ──
export function CroissantIcon({ size = 30 }) {
  return (
    <svg {...base(size)}>
      <path d="M5 15.5 3 18c2.5 1.5 5 1 5-1.5" />
      <path d="M19 15.5 21 18c-2.5 1.5-5 1-5-1.5" />
      <path d="M6.5 14.5C5.5 11 7 8.5 9.5 8l1 3" />
      <path d="M17.5 14.5C18.5 11 17 8.5 14.5 8l-1 3" />
      <path d="M8.5 8.5C9.7 6.5 14.3 6.5 15.5 8.5c1 1.7-.5 6-3.5 8-3-2-4.5-6.3-3.5-8Z" />
    </svg>
  );
}
export function CakeIcon({ size = 30 }) {
  return (
    <svg {...base(size)}>
      <rect x="4.5" y="12" width="15" height="8" rx="1.4" />
      <path d="M4.5 15.5c1.3 0 1.3 1.3 2.6 1.3S8.4 15.5 9.7 15.5s1.3 1.3 2.6 1.3 1.3-1.3 2.6-1.3 1.3 1.3 2.6 1.3" />
      <path d="M12 12V9" /><circle cx="12" cy="7.6" r="1" />
    </svg>
  );
}
export function CookieIcon({ size = 30 }) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="8.2" />
      <circle cx="9" cy="10" r="0.7" /><circle cx="14.5" cy="9.5" r="0.7" />
      <circle cx="15" cy="14.5" r="0.7" /><circle cx="9.5" cy="15" r="0.7" /><circle cx="12" cy="12.5" r="0.7" />
    </svg>
  );
}
export function IceCreamIcon({ size = 30 }) {
  return (
    <svg {...base(size)}>
      <path d="M8 9.5a4 4 0 0 1 8 0" />
      <path d="M7.8 10h8.4L12 21Z" />
    </svg>
  );
}
export function FriesIcon({ size = 30 }) {
  return (
    <svg {...base(size)}>
      <path d="M6.5 10.5h11l-1 8.2a2 2 0 0 1-2 1.8H9.5a2 2 0 0 1-2-1.8Z" />
      <path d="M8.5 10.5V6M11 10.5V4.2M13 10.5V4.8M15.5 10.5V7" />
    </svg>
  );
}
export function PizzaIcon({ size = 30 }) {
  return (
    <svg {...base(size)}>
      <path d="M12 3.2 3.5 19.5c5.4 1.4 11.6 1.4 17 0Z" />
      <circle cx="10" cy="11" r="0.8" /><circle cx="13.4" cy="13.4" r="0.8" /><circle cx="11" cy="15.4" r="0.8" />
    </svg>
  );
}
export function DonutIcon({ size = 30 }) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="8.2" /><circle cx="12" cy="12" r="2.8" />
    </svg>
  );
}
export function BottleIcon({ size = 30 }) {
  return (
    <svg {...base(size)}>
      <path d="M10 3.5h4v2.2c0 .8.5 1.4 1 2 .8.9 1 1.8 1 3v9.1a1.2 1.2 0 0 1-1.2 1.2H9.2A1.2 1.2 0 0 1 8 20.8v-9.1c0-1.2.2-2.1 1-3 .5-.6 1-1.2 1-2Z" />
      <path d="M8.2 12h7.6" />
    </svg>
  );
}
export function WineIcon({ size = 30 }) {
  return (
    <svg {...base(size)}>
      <path d="M7 4h10l-.6 4a4.4 4.4 0 0 1-8.8 0Z" /><path d="M12 12.5V20" /><path d="M8.5 20h7" />
    </svg>
  );
}
export function BowlIcon({ size = 30 }) {
  return (
    <svg {...base(size)}>
      <path d="M3.5 11h17a8.5 8.5 0 0 1-17 0Z" /><path d="M12 11c0-2.5 2-4 2-4M9 11c0-1.8 1.2-3 1.2-3" />
    </svg>
  );
}

// ── Merch ──
export function BookIcon({ size = 30 }) {
  return (
    <svg {...base(size)}>
      <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v14H6.5A1.5 1.5 0 0 0 5 18.5Z" />
      <path d="M5 18.5A1.5 1.5 0 0 1 6.5 17H19v4H6.5A1.5 1.5 0 0 1 5 19.5Z" />
    </svg>
  );
}
export function ShopBagIcon({ size = 30 }) {
  return (
    <svg {...base(size)}>
      <path d="M5.5 7.5h13l-1 12.2a1.4 1.4 0 0 1-1.4 1.3H7.9a1.4 1.4 0 0 1-1.4-1.3Z" />
      <path d="M8.5 7.5a3.5 3.5 0 0 1 7 0" />
    </svg>
  );
}
export function ShirtIcon({ size = 30 }) {
  return (
    <svg {...base(size)}>
      <path d="M8.5 3.5 4 6l1.8 3.2L8 8.2V20.5h8V8.2l2.2 1L20 6l-4.5-2.5a3.5 3.5 0 0 1-7 0Z" />
    </svg>
  );
}
export function GiftIcon({ size = 30 }) {
  return (
    <svg {...base(size)}>
      <rect x="4.5" y="9.5" width="15" height="10.5" rx="1" /><path d="M3.5 9.5h17V13h-17Z" />
      <path d="M12 9.5V20" />
      <path d="M12 9.5C9.5 9.5 8 5 12 5M12 9.5C14.5 9.5 16 5 12 5" />
    </svg>
  );
}
export function TagIcon({ size = 30 }) {
  return (
    <svg {...base(size)}>
      <path d="M4 4h7l9 9-7 7-9-9Z" /><circle cx="8" cy="8" r="1.2" />
    </svg>
  );
}

// Name → component registry, so config can pick icons by name.
export const ICONS = {
  cup: CupIcon,
  mug: MugIcon,
  burger: BurgerIcon,
  bag: BagIcon,
  smoothie: SmoothieIcon,
  can: CanIcon,
  bean: BeanIcon,
  ice: IceIcon,
  shake: ShakeIcon,
  tea: TeaIcon,
  drink: SmoothieIcon,
  croissant: CroissantIcon,
  cake: CakeIcon,
  cookie: CookieIcon,
  icecream: IceCreamIcon,
  fries: FriesIcon,
  pizza: PizzaIcon,
  donut: DonutIcon,
  bottle: BottleIcon,
  wine: WineIcon,
  bowl: BowlIcon,
  book: BookIcon,
  shopbag: ShopBagIcon,
  shirt: ShirtIcon,
  gift: GiftIcon,
  tag: TagIcon,
  account: AccountIcon,
  theme: ThemeIcon,
};

// Render a footer/menu icon: a stored custom SVG (from the icon-library search)
// wins, otherwise a built-in icon by name.
function sanitizeSvg(svg) {
  if (typeof svg !== 'string' || !/^\s*<svg[\s>]/i.test(svg)) return '';
  return svg
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '');
}
export function SlotIcon({ icon, iconSvg, size = 30 }) {
  if (iconSvg) {
    return <span className="slot-svg" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: sanitizeSvg(iconSvg) }} />;
  }
  const Icon = ICONS[icon] || ICONS.cup;
  return <Icon size={size} />;
}

// Names offered in the built-in icon grid (excludes account/theme UI icons).
export const ICON_LIBRARY = [
  'cup', 'mug', 'tea', 'smoothie', 'shake', 'can', 'bottle', 'wine', 'ice', 'drink',
  'bean', 'burger', 'pizza', 'fries', 'bowl', 'croissant', 'cake', 'cookie', 'donut', 'icecream',
  'bag', 'shopbag', 'book', 'shirt', 'gift', 'tag',
];
