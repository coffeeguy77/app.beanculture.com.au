import React, { useEffect, useRef, useState } from 'react';
import { SlotIcon } from './icons.jsx';

// Icon-forward "Browse menu" category dock. Presentational only — App supplies
// the category data ({ name, count, iconName }), the active name and onPick.
// Replaces the low-contrast text-pill CategoryNav so the storefront reads as a
// proper menu. Sticky under the site shell; horizontal overflow gets ‹ › arrows.
export default function MenuDock({ categories, active, onPick }) {
  const stripRef = useRef(null);
  const sentRef = useRef(null);
  const [ov, setOv] = useState({ left: false, right: false });
  const [stuck, setStuck] = useState(false);

  // Show/hide the overflow arrows depending on scroll position.
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const measure = () => {
      const { scrollLeft, scrollWidth, clientWidth } = el;
      setOv({ left: scrollLeft > 2, right: scrollLeft + clientWidth < scrollWidth - 2 });
    };
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      el.removeEventListener('scroll', measure);
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [categories]);

  // "Stuck" shadow: a sentinel just above the sticky wrapper. When it scrolls up
  // past the shell offset the dock is pinned, so add the shadow/border.
  useEffect(() => {
    const sent = sentRef.current;
    if (!sent) return;
    const shellH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--shell-h'), 10) || 0;
    const io = new IntersectionObserver(
      ([e]) => setStuck(!e.isIntersecting),
      { rootMargin: `-${shellH + 1}px 0px 0px 0px`, threshold: 0 }
    );
    io.observe(sent);
    return () => io.disconnect();
  }, [categories]);

  // Keep the active tab in view as scroll-spy / clicks move it.
  useEffect(() => {
    const el = stripRef.current;
    if (!el || !active) return;
    const btn = el.querySelector('.dock-tab.on');
    if (btn) btn.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [active]);

  const nudge = (dir) => {
    const el = stripRef.current;
    if (el) el.scrollBy({ left: dir * Math.max(200, el.clientWidth * 0.7), behavior: 'smooth' });
  };

  if (!categories || categories.length === 0) return null;

  return (
    <>
      <div ref={sentRef} className="dock-sentinel" aria-hidden="true" />
      <div className={`menu-dock-wrap${stuck ? ' is-stuck' : ''}`}>
        <div className="menu-dock">
          <span className="menu-dock-eyebrow">Browse menu</span>
          <div className="menu-dock-strip-wrap">
            <button
              type="button"
              className={`dock-arrow left${ov.left ? '' : ' hide'}`}
              onClick={() => nudge(-1)}
              aria-label="Scroll categories left"
              tabIndex={ov.left ? 0 : -1}
            >
              ‹
            </button>
            <div className="menu-dock-strip" ref={stripRef} role="tablist" aria-label="Menu categories">
              {categories.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  role="tab"
                  aria-selected={active === c.name}
                  className={`dock-tab${active === c.name ? ' on' : ''}`}
                  onClick={() => onPick(c.name)}
                >
                  <span className="dock-tab-ic"><SlotIcon icon={c.iconName} size={28} /></span>
                  <span className="dock-tab-label">{c.name}</span>
                  {active === c.name && c.count > 0 && <span className="dock-tab-count">{c.count}</span>}
                </button>
              ))}
            </div>
            <button
              type="button"
              className={`dock-arrow right${ov.right ? '' : ' hide'}`}
              onClick={() => nudge(1)}
              aria-label="Scroll categories right"
              tabIndex={ov.right ? 0 : -1}
            >
              ›
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
