import React, { useEffect, useRef, useState } from 'react';
import { imgUrl as optimizeImg } from '../api.js';

export default function HeroSlider({ hero, onLink, ratio, autoplay = true, interval = 5 }) {
  const trackRef = useRef(null);
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const onScroll = () => {
      const i = Math.round(el.scrollLeft / el.clientWidth);
      setIdx(i);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Auto-advance the carousel (config: enable + speed in seconds). Pauses while
  // the guest is interacting and respects reduced-motion preferences.
  const count = hero ? hero.length : 0;
  useEffect(() => {
    if (!autoplay || paused || count <= 1) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ms = Math.max(1500, (Number(interval) || 5) * 1000);
    const id = setInterval(() => {
      const el = trackRef.current;
      if (!el) return;
      const cur = Math.round(el.scrollLeft / el.clientWidth);
      const next = (cur + 1) % count;
      el.scrollTo({ left: next * el.clientWidth, behavior: 'smooth' });
    }, ms);
    return () => clearInterval(id);
  }, [autoplay, paused, interval, count]);

  const goTo = (i) => {
    const el = trackRef.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
  };

  if (!hero || !hero.length) return null;

  return (
    <div className="hero">
      {/* All banners share one fixed-size box (default 3:2, like the Taro).
          Banners built at that shape fill it; wider/taller ones fit inside. */}
      <div
        className="hero-track"
        ref={trackRef}
        style={{ aspectRatio: ratio || '3 / 2' }}
        onPointerDown={() => setPaused(true)}
        onPointerUp={() => setPaused(false)}
        onPointerLeave={() => setPaused(false)}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        {hero.map((s, i) => {
          const raw =
            s.image ||
            (typeof s.bg === 'string' && (s.bg.match(/url\((['"]?)(.*?)\1\)/) || [])[2]) ||
            '';
          const src = optimizeImg(raw, 1400);
          const eager = i === 0; // the first banner is the LCP — load it eagerly
          const hasCopy = s.title || s.subtitle || s.cta;
          return (
            <div
              key={s.id}
              className={`hero-slide ${raw ? 'has-img' : ''}`}
              style={raw ? { color: s.textColor || '#fff' } : { background: s.bg, color: s.textColor || '#fff' }}
              onClick={() => onLink(s.link)}
            >
              {raw && <img className="hero-img" src={src} alt={s.title || ''} loading={eager ? 'eager' : 'lazy'} fetchpriority={eager ? 'high' : 'auto'} decoding="async" />}
              {hasCopy && (
                <div className="hero-copy">
                  {s.title && <h3>{s.title}</h3>}
                  {s.subtitle && <p>{s.subtitle}</p>}
                  {s.cta && (
                    <button className="hero-cta" onClick={(e) => { e.stopPropagation(); onLink(s.link); }}>
                      {s.cta}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {hero.length > 1 && (
        <div className="hero-dots">
          {hero.map((_, i) => (
            <button key={i} className={i === idx ? 'on' : ''} onClick={() => goTo(i)} aria-label={`Go to banner ${i + 1}`} />
          ))}
        </div>
      )}
    </div>
  );
}
