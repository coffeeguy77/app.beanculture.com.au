import React from 'react';
import { formatMoney } from '../api.js';
import { HeartIcon } from './icons.jsx';

// One-line summary of a favourite's items, e.g. "2× Long Black · Small, 1× Muffin".
function summarize(items) {
  return (items || [])
    .map((it) => {
      const q = Number(it.quantity) || 1;
      const name = it.itemName + (it.variationName ? ` · ${it.variationName}` : '');
      return `${q}× ${name}`;
    })
    .join(', ');
}

export default function Favorites({ favorites, onOrder, onRemove, onRename, onBack, currency, onExploreMenu }) {
  const list = favorites || [];
  return (
    <main className="page favorites-page">
      <button className="link" onClick={onBack}>← Menu</button>
      <h2 className="serif fav-title">Your favourites</h2>

      {list.length === 0 ? (
        <div className="fav-empty">
          <div className="fav-empty-ic" aria-hidden="true"><HeartIcon size={34} /></div>
          <p className="fav-empty-text">No favourites yet — heart an order in your account to save it here for one-tap reordering.</p>
          <button className="btn" onClick={onExploreMenu}>Go to my account</button>
        </div>
      ) : (
        <div className="fav-list">
          {list.map((fav) => {
            const total = (fav.items || []).reduce((n, it) => n + (it.unitPrice || 0) * (Number(it.quantity) || 1), 0);
            return (
              <div key={fav.id} className="order-card fav-card">
                <div className="fav-card-head">
                  <div className="fav-name">{fav.name}</div>
                  <div className="fav-total">{formatMoney(total, currency)}</div>
                </div>
                <div className="fav-items">{summarize(fav.items)}</div>
                <div className="fav-actions">
                  <button className="btn fav-order" onClick={() => onOrder(fav)}>Order now</button>
                  <button
                    className="btn ghost fav-rename"
                    onClick={() => { const n = window.prompt('Rename favourite', fav.name); if (n != null) onRename(fav.id, n); }}
                  >Rename</button>
                  <button
                    className="btn ghost fav-remove"
                    onClick={() => { if (window.confirm(`Remove "${fav.name}" from favourites?`)) onRemove(fav.id); }}
                  >Remove</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
