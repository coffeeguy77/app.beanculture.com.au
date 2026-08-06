import React, { useMemo, useState } from 'react';
import { formatMoney } from '../api.js';

function makeKey(item, variationId, modifierIds, note) {
  return [item.id, variationId, [...modifierIds].sort().join(','), note].join('|');
}

export default function ItemModal({ item, currency, onClose, onAdd }) {
  const [variationId, setVariationId] = useState(item.variations[0]?.id);
  const [selected, setSelected] = useState({}); // groupId -> Set of modifier ids
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');

  const variation = item.variations.find((v) => v.id === variationId) || item.variations[0];

  function toggleModifier(group, mod) {
    setSelected((prev) => {
      const cur = new Set(prev[group.id] || []);
      if (group.selectionType === 'SINGLE') {
        cur.clear();
        cur.add(mod.id);
      } else {
        if (cur.has(mod.id)) cur.delete(mod.id);
        else {
          if (group.max > 0 && cur.size >= group.max) return prev; // respect max
          cur.add(mod.id);
        }
      }
      return { ...prev, [group.id]: cur };
    });
  }

  const { modifierIds, modifierNames, modifierPrice } = useMemo(() => {
    const ids = [];
    const names = [];
    let price = 0;
    for (const group of item.modifierGroups || []) {
      const chosen = selected[group.id];
      if (!chosen) continue;
      for (const mod of group.modifiers) {
        if (chosen.has(mod.id)) {
          ids.push(mod.id);
          names.push(mod.name);
          price += mod.price || 0;
        }
      }
    }
    return { modifierIds: ids, modifierNames: names, modifierPrice: price };
  }, [selected, item]);

  const unitPrice = (variation?.price || 0) + modifierPrice;

  function handleAdd() {
    onAdd({
      key: makeKey(item, variationId, modifierIds, note),
      itemId: item.id,
      itemName: item.name,
      variationId,
      variationName: variation?.name || '',
      modifierIds,
      modifierNames,
      unitPrice,
      quantity: qty,
      note: note.trim(),
    });
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        {item.image && <img className="modal-img" src={item.image} alt="" />}
        <div className="modal-body">
          <h2>{item.name}</h2>
          {item.description && <p className="muted">{item.description}</p>}

          {item.variations.length > 1 && (
            <div className="group">
              <div className="group-title">Choose one</div>
              {item.variations.map((v) => (
                <label key={v.id} className="opt">
                  <input
                    type="radio"
                    name="variation"
                    checked={variationId === v.id}
                    onChange={() => setVariationId(v.id)}
                  />
                  <span className="opt-name">{v.name || item.name}</span>
                  <span className="opt-price">{formatMoney(v.price, currency)}</span>
                </label>
              ))}
            </div>
          )}

          {(item.modifierGroups || []).map((group) => (
            <div key={group.id} className="group">
              <div className="group-title">
                {group.name}
                {group.selectionType === 'SINGLE'
                  ? ' · choose one'
                  : group.max > 0
                  ? ` · up to ${group.max}`
                  : ''}
              </div>
              {group.modifiers.map((mod) => {
                const chosen = (selected[group.id] || new Set()).has(mod.id);
                return (
                  <label key={mod.id} className="opt">
                    <input
                      type={group.selectionType === 'SINGLE' ? 'radio' : 'checkbox'}
                      name={group.id}
                      checked={chosen}
                      onChange={() => toggleModifier(group, mod)}
                    />
                    <span className="opt-name">{mod.name}</span>
                    {mod.price > 0 && (
                      <span className="opt-price">+{formatMoney(mod.price, currency)}</span>
                    )}
                  </label>
                );
              })}
            </div>
          ))}

          <label className="field">
            <span>Notes (optional)</span>
            <input
              placeholder="e.g. oat milk, no sugar"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>

          <div className="qty-row">
            <div className="stepper">
              <button onClick={() => setQty((q) => Math.max(1, q - 1))} type="button">
                −
              </button>
              <span>{qty}</span>
              <button onClick={() => setQty((q) => q + 1)} type="button">
                +
              </button>
            </div>
            <button className="btn" onClick={handleAdd} type="button">
              Add · {formatMoney(unitPrice * qty, currency)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
