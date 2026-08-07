import React, { useCallback, useEffect, useRef, useState } from 'react';

export default function HeroSlider({ hero, onLink }) {
  const trackRef = useRef(null);
  const [idx, setIdx] = useState(0);
  const [trackH, setTrackH] = useState(0);

  // Size the hero to the currently-visible slide so short (wide) banners don't
  // leave a gap and tall ones aren't cropped. Image slides use their natural
  // aspect ratio at the current width; text slides get a sensible default.
  const measure = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const w = el.clientWidth;
    const slide = el.children[idx];
    if (!slide) return;
    const img = slide.querySelector('img');
    let h;
    if (img && img.naturalWidth) {
      h = Math.round((w * img.naturalHeight) / img.naturalWidth);
    } else {
      h = 168; // text / gradient slide
    }
    setTrackH(h || 168);
  }, [idx]);

  useEffect(() => { measure(); }, [measure, hero]);
  useEffect(() => {
    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [measure]);

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

  if (!hero || !hero.length) return null;

  return (
    <div className="hero">
      <div
        className="hero-track"
        ref={trackRef}
        style={trackH ? { height: trackH + 'px' } : undefined}
      >
        {hero.map((s) => {
          // Use a real <img> for uploaded/linked banners so the whole graphic
          // shows (never cropped). Fall back to the gradient bg for text slides.
          const imgUrl =
            s.image ||
            (typeof s.bg === 'string' && (s.bg.match(/url\((['"]?)(.*?)\1\)/) || [])[2]) ||
            '';
          const hasCopy = s.title || s.subtitle || s.cta;
          return (
            <div
              key={s.id}
              className={`hero-slide ${imgUrl ? 'has-img' : ''}`}
              style={imgUrl ? { color: s.textColor || '#fff' } : { background: s.bg, color: s.textColor || '#fff' }}
              onClick={() => onLink(s.link)}
            >
              {imgUrl && <img className="hero-img" src={imgUrl} alt={s.title || ''} onLoad={measure} />}
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
            <span key={i} className={i === idx ? 'on' : ''} />
          ))}
        </div>
      )}
    </div>
  );
}
