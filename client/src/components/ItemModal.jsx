import React, { useMemo, useState } from 'react';
import { formatMoney } from '../api.js';

function makeKey(item, variationId, modifierIds, note) {
  return [item.id, variationId, [...modifierIds].sort().join(','), note].join('|');
}

export default function ItemModal({ item, currency, onClose, onAdd }) {
  const firstAvail = item.variations.find((v) => !v.soldOut) || item.variations[0];
  const [variationId, setVariationId] = useState(firstAvail?.id);
  const [selected, setSelected] = useState({});
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');

  const variation = item.variations.find((v) => v.id === variationId) || firstAvail;

  function toggleModifier(group, mod) {
    setSelected((prev) => {
      const cur = new Set(prev[group.id] || []);
      if (group.selectionType === 'SINGLE') {
        cur.clear();
        cur.add(mod.id);
      } else if (cur.has(mod.id)) cur.delete(mod.id);
      else {
        if (group.max > 0 && cur.size >= group.max) return prev;
        cur.add(mod.id);
      }
      return { ...prev, [group.id]: cur };
    });
  }

  const { modifierIds, modifierNames, modifierPrice } = useMemo(() => {
    const ids = [], names = [];
    let price = 0;
    for (const group of item.modifierGroups || []) {
      const chosen = selected[group.id];
      if (!chosen) continue;
      for (const mod of group.modifiers) {
        if (chosen.has(mod.id)) { ids.push(mod.id); names.push(mod.name); price += mod.price || 0; }
      }
    }
    return { modifierIds: ids, modifierNames: names, modifierPrice: price };
  }, [selected, item]);

  const unitPrice = (variation?.price || 0) + modifierPrice;

  function handleAdd() {
    onAdd({
      key: makeKey(item, variationId, modifierIds, note),
      itemId: item.id, itemName: item.name,
      variationId, variationName: variation?.name || '',
      modifierIds, modifierNames, unitPrice, quantity: qty, note: note.trim(),
    });
  }

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <button className="sheet-close" onClick={onClose}>×</button>
        {item.image && <img className="sheet-img" src={item.image} alt="" />}
        <div className="sheet-body">
          <h2>{item.name}</h2>
          {item.description && <p className="muted itemdesc-full">{item.description}</p>}

          {item.variations.length > 1 && (
            <div className="group">
              <div className="group-title">Choose one</div>
              {item.variations.map((v) => (
                <label key={v.id} className={`opt ${v.soldOut ? 'disabled' : ''}`}>
                  <input type="radio" name="variation" disabled={v.soldOut}
                    checked={variationId === v.id} onChange={() => setVariationId(v.id)} />
                  <span className="opt-name">{v.name || item.name}{v.soldOut ? ' — sold out' : ''}</span>
                  <span className="opt-price">{formatMoney(v.price, currency)}</span>
                </label>
              ))}
            </div>
          )}

          {(item.modifierGroups || []).map((group) => (
            <div key={group.id} className="group">
              <div className="group-title">
                {group.name}
                {group.selectionType === 'SINGLE' ? ' · choose one' : group.max > 0 ? ` · up to ${group.max}` : ''}
              </div>
              {group.modifiers.map((mod) => {
                const chosen = (selected[group.id] || new Set()).has(mod.id);
                return (
                  <label key={mod.id} className="opt">
                    <input type={group.selectionType === 'SINGLE' ? 'radio' : 'checkbox'} name={group.id}
                      checked={chosen} onChange={() => toggleModifier(group, mod)} />
                    <span className="opt-name">{mod.name}</span>
                    {mod.price > 0 && <span className="opt-price">+{formatMoney(mod.price, currency)}</span>}
                  </label>
                );
              })}
            </div>
          ))}

          <label className="field">
            <span>Notes (optional)</span>
            <input placeholder="e.g. oat milk, extra hot" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>

          <div className="qty-row">
            <div className="stepper">
              <button onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
              <span>{qty}</span>
              <button onClick={() => setQty((q) => q + 1)}>+</button>
            </div>
            <button className="btn" onClick={handleAdd}>Add · {formatMoney(unitPrice * qty, currency)}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
