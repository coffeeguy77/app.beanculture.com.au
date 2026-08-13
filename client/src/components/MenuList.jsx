import React, { useEffect } from 'react';
import { formatMoney, imgUrl } from '../api.js';
import { MugIcon } from './icons.jsx';

function slug(s) {
  return 'cat-' + s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}
function fromPrice(item) {
  const prices = item.variations.map((v) => v.price).filter((p) => p != null);
  return prices.length ? Math.min(...prices) : null;
}

export default function MenuList({ categories, currency, onPick, scrollTo, scrollKey, onScrolled, kitchenClosedCats }) {
  const kShut = new Set((kitchenClosedCats || []).map((c) => (c || '').toLowerCase()));
  // Keyed on scrollKey (a nonce bumped on every dock/footer pick) — NOT on the
  // category name — so pressing the same footer slot again still fires, and so
  // clearing the target after the scroll (onScrolled) can't re-run this effect
  // and cancel its own retries mid-flight (that was the intermittent "the
  // heading didn't jump, but a refresh fixes it" bug: onScrolled ran
  // synchronously, nulled the target, and the cleanup killed the retry loop
  // after a single early attempt — which only landed right once images were
  // cached). The retries now run the full ~900ms so a section whose feature
  // banner / product images are still loading (shifting the page height) still
  // settles on the correct heading.
  useEffect(() => {
    if (!scrollTo) return undefined;
    let tries = 0; let cancelled = false;
    const run = () => {
      const el = document.getElementById(slug(scrollTo));
      if (el) el.scrollIntoView({ block: 'start', behavior: 'auto' });
      window.scrollBy(0, -1); window.scrollBy(0, 1); // nudge sticky to repaint
    };
    requestAnimationFrame(() => requestAnimationFrame(() => { if (!cancelled) run(); }));
    const id = setInterval(() => {
      if (cancelled) return;
      run();
      if (++tries >= 6) { clearInterval(id); onScrolled && onScrolled(); }
    }, 150);
    return () => { cancelled = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollKey]);

  if (!categories || categories.length === 0) {
    return <div className="empty">No items match. Try another search.</div>;
  }

  return (
    <main className="menu">
      {categories.map((cat) => {
        const showImages = cat.showImages !== false;
        const kitchenShut = kShut.has((cat.category || '').toLowerCase());
        const count = (cat.items || []).length;
        return (
        <section key={cat.category} data-cat={cat.category}>
          <div className="cat-head">
            <h2 className="cat-title" id={slug(cat.category)}>{cat.category}{kitchenShut && <span className="cat-shut"> · kitchen closed</span>}</h2>
            {count > 0 && <span className="cat-count">{count} {count === 1 ? 'item' : 'items'}</span>}
          </div>
          {cat.banner && (() => {
            const target = (cat.items || []).find((i) => i.id === cat.banner.itemId) || null;
            // A banner can point at an item whose category is sold out or
            // currently kitchen-closed — don't let it bypass that check.
            const bannerShut = kitchenShut || (target && target.soldOut);
            return (
              <button type="button" className={`feature-banner ${cat.banner.hideText ? 'no-text' : ''}`} onClick={() => target && !bannerShut && onPick({ ...target, category: cat.category })}
                style={cat.banner.image ? { backgroundImage: `url(${imgUrl(cat.banner.image, 900)})` } : undefined}>
                {!cat.banner.hideText && (
                  <span className="feature-banner-body">
                    {cat.banner.title && <span className="feature-banner-title">{cat.banner.title}</span>}
                    {target && <span className="feature-banner-cta">{target.name} — order now →</span>}
                  </span>
                )}
              </button>
            );
          })()}
          <div className={`items ${showImages ? '' : 'noimg'}`}>
            {cat.items.map((item) => {
              const from = fromPrice(item);
              const multi = item.variations.length > 1;
              const unavailable = item.soldOut || kitchenShut;
              // Only show short, human descriptions on the card. Technical Square
              // composition copy (e.g. "Origin Composition: 50% Brazil | …") and
              // any long blurb never fit cleanly, so hide it here — the full text
              // still shows in the item modal.
              const cardDesc = item.description
                && !/origin composition/i.test(item.description)
                && item.description.length <= 70
                ? item.description : null;
              return (
                <button
                  key={item.id}
                  className={`item ${unavailable ? 'sold' : ''}`}
                  onClick={() => !unavailable && onPick({ ...item, category: cat.category })}
                  type="button"
                  aria-label={`Add ${item.name}`}
                >
                  {item.isCombo && !item.soldOut && !kitchenShut && <span className="combo-tag">Combo</span>}
                  {item.soldOut ? <span className="sold-tag">Sold out</span> : kitchenShut && <span className="sold-tag sold-tag-kitchen">Kitchen closed</span>}
                  {showImages && (item.image ? (
                    <img className="item-img" src={imgUrl(item.image, 300)} alt="" loading="lazy" decoding="async" />
                  ) : (
                    <span className="item-noimg"><MugIcon size={30} /></span>
                  ))}
                  <div className="item-body">
                    <div className="item-name">{item.name}</div>
                    {cardDesc && <div className="item-desc">{cardDesc}</div>}
                    <div className="item-price">{multi ? 'from ' : ''}{formatMoney(from, currency)}</div>
                  </div>
                  {!unavailable && <span className="plus">+</span>}
                </button>
              );
            })}
          </div>
        </section>
        );
      })}
    </main>
  );
}
