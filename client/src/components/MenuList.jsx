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

export default function MenuList({ categories, currency, onPick, scrollTo, onScrolled }) {
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
        return (
        <section key={cat.category}>
          <h2 className="cat-title" id={slug(cat.category)}>{cat.category}</h2>
          <div className={`items ${showImages ? '' : 'noimg'}`}>
            {cat.items.map((item) => {
              const from = fromPrice(item);
              const multi = item.variations.length > 1;
              return (
                <button
                  key={item.id}
                  className={`item ${item.soldOut ? 'sold' : ''}`}
                  onClick={() => !item.soldOut && onPick(item)}
                  type="button"
                >
                  {item.soldOut && <span className="sold-tag">Sold out</span>}
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
                  {!item.soldOut && <span className="plus">+</span>}
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
