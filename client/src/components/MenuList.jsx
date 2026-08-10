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

export default function MenuList({ categories, currency, onPick, scrollTo, onScrolled, kitchenClosedCats }) {
  const kShut = new Set((kitchenClosedCats || []).map((c) => (c || '').toLowerCase()));
  useEffect(() => {
    if (scrollTo) {
      const el = document.getElementById(slug(scrollTo));
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      onScrolled && onScrolled();
    }
  }, [scrollTo]);

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
            return (
              <button type="button" className={`feature-banner ${cat.banner.hideText ? 'no-text' : ''}`} onClick={() => target && !target.soldOut && onPick(target)}
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
              return (
                <button
                  key={item.id}
                  className={`item ${unavailable ? 'sold' : ''}`}
                  onClick={() => !unavailable && onPick(item)}
                  type="button"
                  aria-label={`Add ${item.name}`}
                >
                  {item.soldOut ? <span className="sold-tag">Sold out</span> : kitchenShut && <span className="sold-tag">Kitchen closed</span>}
                  {showImages && (item.image ? (
                    <img className="item-img" src={imgUrl(item.image, 240)} alt="" loading="lazy" decoding="async" />
                  ) : (
                    <span className="item-noimg"><MugIcon size={30} /></span>
                  ))}
                  <div className="item-body">
                    <div className="item-name">{item.name}</div>
                    {item.description && <div className="item-desc">{item.description}</div>}
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
