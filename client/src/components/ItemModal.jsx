import React, { useMemo, useState } from 'react';
import { formatMoney, imgUrl } from '../api.js';

function makeKey(item, variationId, modifierIds, note) {
  return [item.id, variationId, [...modifierIds].sort().join(','), note].join('|');
}

export default function ItemModal({ item, currency, onClose, onAdd }) {
  const firstAvail = item.variations.find((v) => !v.soldOut) || item.variations[0];
  const [variationId, setVariationId] = useState(firstAvail?.id);
  // Preset tiles arrive with default-on options; seed the selection from them.
  const [selected, setSelected] = useState(() => {
    const init = {};
    const d = item.defaults || {};
    for (const gid of Object.keys(d)) init[gid] = new Set(d[gid]);
    return init;
  });
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');

  const variation = item.variations.find((v) => v.id === variationId) || firstAvail;

  function toggleModifier(group, mod) {
    setSelected((prev) => {
      const cur = new Set(prev[group.id] || []);
      if (group.selectionType === 'SINGLE') {
        // Pill behaviour: tapping the already-chosen option deselects it back
        // to "none picked" instead of being stuck once chosen, like a radio
        // button would be. Required groups (group.min > 0) are enforced at
        // Add-to-cart time instead, so a customer can still freely clear their
        // pick and reconsider while the sheet is open.
        if (cur.has(mod.id)) cur.clear();
        else { cur.clear(); cur.add(mod.id); }
      } else if (cur.has(mod.id)) cur.delete(mod.id);
      else {
        if (group.max > 0 && cur.size >= group.max) return prev;
        cur.add(mod.id);
      }
      return { ...prev, [group.id]: cur };
    });
  }

  // Groups the customer hasn't satisfied yet (min selections not met) — used
  // to block Add-to-cart and to flag the offending group inline.
  const unmetGroups = (item.modifierGroups || []).filter((group) => {
    const need = group.min || 0;
    if (need <= 0) return false;
    const have = (selected[group.id]?.size) || 0;
    return have < need;
  });

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
    // Locked modifiers (from a preset) are always applied and hidden; their
    // price is already baked into the variation price, so only add their ids.
    const lockIds = item.lockedModifierIds || [];
    const lockNames = item.lockedModifierNames || [];
    const allIds = [...modifierIds, ...lockIds];
    const allNames = [...modifierNames, ...lockNames];
    onAdd({
      key: makeKey(item, variationId, allIds, note),
      itemId: item.presetSourceItemId || item.id, itemName: item.name,
      variationId, variationName: variation?.name || '',
      modifierIds: allIds, modifierNames: allNames, unitPrice, quantity: qty, note: note.trim(),
    });
  }

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <button className="sheet-close" onClick={onClose}>×</button>
        {item.image && <img className="sheet-img" src={imgUrl(item.image, 720)} alt="" decoding="async" />}
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

          {(item.modifierGroups || []).map((group) => {
            const required = (group.min || 0) > 0;
            const have = (selected[group.id]?.size) || 0;
            const unmet = required && have < group.min;
            return (
            <div key={group.id} className="group">
              <div className="group-title">
                {group.name}
                {group.selectionType === 'SINGLE' ? ' · choose one' : group.max > 0 ? ` · up to ${group.max}` : ''}
                {required && <span className="group-required"> · required</span>}
              </div>
              <div className="opt-pills">
                {group.modifiers.map((mod) => {
                  const chosen = (selected[group.id] || new Set()).has(mod.id);
                  return (
                    <button key={mod.id} type="button" className={`opt-pill ${chosen ? 'on' : ''}`}
                      onClick={() => toggleModifier(group, mod)}>
                      <span className="opt-name">{mod.name}</span>
                      {mod.price > 0 && <span className="opt-price">+{formatMoney(mod.price, currency)}</span>}
                    </button>
                  );
                })}
              </div>
              {unmet && <p className="group-warn">Select at least {group.min === 1 ? 'one' : group.min}</p>}
            </div>
            );
          })}

          <label className="field">
            <span>Notes (optional)</span>
            <textarea className="notes-input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>

          {unmetGroups.length > 0 && (
            <p className="group-warn" style={{ marginTop: -4 }}>
              Please choose {unmetGroups.map((g) => g.name).join(', ')} before adding to your order.
            </p>
          )}
          <div className="qty-row">
            <div className="stepper">
              <button onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
              <span>{qty}</span>
              <button onClick={() => setQty((q) => q + 1)}>+</button>
            </div>
            <button className="btn" onClick={handleAdd} disabled={unmetGroups.length > 0}>
              Add · {formatMoney(unitPrice * qty, currency)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
