import React, { useEffect, useRef, useState } from 'react';
import { SlotIcon } from './icons.jsx';

// Icon-forward "Browse menu" category dock. Presentational only — App supplies
// the category data ({ name, count, iconName }), the active name and onPick.
// Structure: [eyebrow] [prevArrow] [viewport(strip)] [nextArrow]. Arrows are
// dedicated fixed-width flex columns OUTSIDE the scroll viewport, so no tile can
// ever slide under an arrow. Sticky under the site shell.
const EPSILON = 2;

export default function MenuDock({ categories, active, onPick }) {
  const stripRef = useRef(null);
  const sentRef = useRef(null);
  const userNav = useRef(false);
  const [arrows, setArrows] = useState({ left: false, right: false });
  const [stuck, setStuck] = useState(false);

  // Recompute which arrows are enabled from the strip's scroll position.
  const recalc = () => {
    const el = stripRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setArrows({ left: el.scrollLeft > EPSILON, right: el.scrollLeft < max - EPSILON });
  };

  // Scroll ONLY the strip so the active tile is visible. Never touches the page.
  // If the active tile is already fully visible, do nothing (don't fight the user).
  const scrollActiveIntoView = (smooth) => {
    const el = stripRef.current;
    if (!el || !active) return;
    const tile = [...el.children].find(
      (t) => t.getAttribute && t.getAttribute('data-cat-tile') === active
    );
    if (!tile) return;
    const viewStart = el.scrollLeft;
    const viewEnd = el.scrollLeft + el.clientWidth;
    const tileStart = tile.offsetLeft;
    const tileEnd = tile.offsetLeft + tile.offsetWidth;
    // Already fully visible → leave it alone.
    if (tileStart >= viewStart && tileEnd <= viewEnd) return;
    const target = Math.max(
      0,
      Math.min(tile.offsetLeft - (el.clientWidth - tile.offsetWidth) / 2, el.scrollWidth - el.clientWidth)
    );
    el.scrollTo({ left: target, behavior: smooth ? 'smooth' : 'auto' });
  };

  // Arrow state: recompute on strip scroll, strip resize, window resize, fonts
  // load, and whenever the category set changes.
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    recalc();
    el.addEventListener('scroll', recalc, { passive: true });
    const ro = new ResizeObserver(recalc);
    ro.observe(el);
    window.addEventListener('resize', recalc);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => { recalc(); scrollActiveIntoView(false); });
    }
    return () => {
      el.removeEventListener('scroll', recalc);
      ro.disconnect();
      window.removeEventListener('resize', recalc);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories]);

  // Bring an initially-non-first active category (restored/default) into view
  // instantly once the strip is populated.
  useEffect(() => {
    recalc();
    scrollActiveIntoView(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Vertical-wheel-over-strip → horizontal scroll. Only intercept when the strip
  // can actually scroll horizontally, and only preventDefault when we truly moved
  // so at the ends the page keeps scrolling (non-janky).
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const onWheel = (e) => {
      if (!e.deltaY || el.scrollWidth <= el.clientWidth) return;
      const before = el.scrollLeft;
      el.scrollLeft += e.deltaY;
      if (el.scrollLeft !== before) e.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [categories]);

  // Keep the active tile visible as scroll-spy / clicks / restore move it.
  // Smooth only when the change came from a user dock-click (and motion is ok);
  // instant otherwise. Only repositions if the active tile is off-screen.
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    scrollActiveIntoView(userNav.current && !reduce);
    userNav.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const nudge = (dir) => {
    const el = stripRef.current;
    if (el) el.scrollBy({ left: dir * Math.max(200, el.clientWidth * 0.8), behavior: 'smooth' });
  };

  if (!categories || categories.length === 0) return null;

  return (
    <>
      <div ref={sentRef} className="dock-sentinel" aria-hidden="true" />
      <div className={`menu-dock-wrap${stuck ? ' is-stuck' : ''}`}>
        <div className="menu-dock">
          <span className="menu-dock-eyebrow">
            <span className="dock-eyebrow-arrow" aria-hidden="true">←</span>
            <span className="dock-eyebrow-text">Browse the menu</span>
            <span className="dock-eyebrow-arrow" aria-hidden="true">→</span>
          </span>
          <button
            type="button"
            className="dock-arrow"
            onClick={() => nudge(-1)}
            disabled={!arrows.left}
            aria-label="Show previous menu categories"
          >
            ‹
          </button>
          <div className="menu-dock-viewport">
            <div className="menu-dock-strip" ref={stripRef} role="tablist" aria-label="Menu categories">
              {categories.map((c) => (
                <button
                  key={c.name}
                  data-cat-tile={c.name}
                  type="button"
                  role="tab"
                  aria-selected={active === c.name}
                  className={`dock-tab${active === c.name ? ' on' : ''}`}
                  onClick={() => { userNav.current = true; onPick(c.name); }}
                >
                  <span className="dock-tab-ic"><SlotIcon icon={c.iconName} iconSvg={c.iconSvg} size={29} /></span>
                  <span className="dock-tab-label">{c.name}</span>
                  {active === c.name && c.count > 0 && <span className="dock-tab-count">{c.count}</span>}
                </button>
              ))}
            </div>
            <span className={`dock-fade left${arrows.left ? ' show' : ''}`} aria-hidden="true" />
            <span className={`dock-fade right${arrows.right ? ' show' : ''}`} aria-hidden="true" />
          </div>
          <button
            type="button"
            className="dock-arrow"
            onClick={() => nudge(1)}
            disabled={!arrows.right}
            aria-label="Show more menu categories"
          >
            ›
          </button>
        </div>
      </div>
    </>
  );
}
