import React from 'react';
import { formatMoney } from '../api.js';

function fromPrice(item) {
  const prices = item.variations.map((v) => v.price).filter((p) => p != null);
  return prices.length ? Math.min(...prices) : null;
}

export default function MenuList({ menu, currency, onPick }) {
  if (!menu.categories || menu.categories.length === 0) {
    return (
      <div className="empty">
        <p className="muted">No items are available right now.</p>
      </div>
    );
  }

  return (
    <main className="menu">
      {menu.categories.map((cat) => (
        <section key={cat.category} className="menu-cat">
          <h2 className="cat-title">{cat.category}</h2>
          <div className="items">
            {cat.items.map((item) => {
              const from = fromPrice(item);
              const multi = item.variations.length > 1;
              return (
                <button key={item.id} className="item" onClick={() => onPick(item)} type="button">
                  {item.image && (
                    <img className="item-img" src={item.image} alt="" loading="lazy" />
                  )}
                  <div className="item-body">
                    <div className="item-name">{item.name}</div>
                    {item.description && <div className="item-desc">{item.description}</div>}
                    <div className="item-price">
                      {multi ? 'from ' : ''}
                      {formatMoney(from, currency)}
                    </div>
                  </div>
                  <span className="plus">+</span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </main>
  );
}
