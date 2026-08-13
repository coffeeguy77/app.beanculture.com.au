import React, { useMemo, useState } from 'react';
import { formatMoney, imgUrl } from '../api.js';

// A short random id, good enough to tag one "add to cart" click as a single
// combo instance (grouping its linked cart lines for display/removal, and for
// the server to re-validate the discount against — see server/lib/combos.js).
function comboInstanceId() {
  return 'ci' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// The cheapest available variation of an option item — a combo option is
// "choose your burger", not "choose your burger AND its size/modifiers", so
// v1 keeps each pick to one real Square variation (no further customisation
// inside the combo flow) to keep the picker to a single, fast step.
function cheapestVariation(option) {
  const avail = (option.variations || []).filter((v) => !v.soldOut);
  const pool = avail.length ? avail : option.variations || [];
  return pool.reduce((best, v) => (best == null || (v.price ?? Infinity) < (best.price ?? Infinity) ? v : best), null);
}

export default function ComboModal({ item: combo, currency, onClose, onAdd }) {
  const groups = combo.comboGroups || [];
  const [picked, setPicked] = useState({}); // groupId -> optionId
  const [qty, setQty] = useState(1);

  const chosen = useMemo(() => {
    const out = {};
    for (const g of groups) {
      const optId = picked[g.id];
      const option = optId && (g.options || []).find((o) => o.id === optId);
      if (!option) continue;
      const variation = cheapestVariation(option);
      if (variation) out[g.id] = { option, variation };
    }
    return out;
  }, [picked, groups]);

  const subtotal = groups.reduce((sum, g) => sum + (chosen[g.id]?.variation.price || 0), 0);
  const discount = Math.min(subtotal, combo.comboDiscountValue || 0);
  const unitPrice = Math.max(0, subtotal - discount);
  const missingGroups = groups.filter((g) => !chosen[g.id]);

  function handleAdd() {
    if (missingGroups.length) return;
    const instanceId = comboInstanceId();
    // Spread the discount evenly across the combo's own lines (Square needs a
    // per-order discount, not per-line, so this split is purely cosmetic for
    // any per-line display — the real discount is applied once, order-wide,
    // by the server after it re-validates this exact instance).
    const entries = groups.map((g) => {
      const { option, variation } = chosen[g.id];
      return {
        key: [instanceId, option.id, variation.id].join('|'),
        itemId: option.id,
        itemName: option.name,
        category: combo.name,
        image: option.image || null,
        variationId: variation.id,
        variationName: variation.name || '',
        modifierIds: [],
        modifierNames: [],
        unitPrice: variation.price || 0,
        quantity: qty,
        note: `Part of: ${combo.name}`,
        comboId: combo.comboId,
        comboInstanceId: instanceId,
        comboGroupId: g.id,
        comboName: combo.name,
        comboGroupLabel: g.label,
      };
    });
    onAdd(entries, { comboName: combo.name, quantity: qty });
  }

  return (
    <div className="backdrop item-backdrop" onClick={onClose}>
      <div className="sheet item-sheet" onClick={(e) => e.stopPropagation()}>
        <button className="sheet-close" onClick={onClose} aria-label="Close">×</button>

        <div className="sheet-main">
          <div className="sheet-left">
            {combo.image && <img className="sheet-img" src={imgUrl(combo.image, 720)} alt="" decoding="async" />}
            <div className="sheet-left-body">
              <div className="sheet-eyebrow">Combo deal</div>
              <h2>{combo.name}</h2>
              <div className="sheet-from-price">
                From {formatMoney(Math.max(0, (combo.variations?.[0]?.price ?? 0)), currency)}
                {discount > 0 && <span className="muted"> · save {formatMoney(discount, currency)} on this pick</span>}
              </div>
              {combo.description && <p className="sheet-desc">{combo.description}</p>}
            </div>
          </div>

          <div className="sheet-right">
            <div className="sheet-right-head">
              <h3>Build your combo</h3>
              <p>Pick one option per step — the discount applies automatically.</p>
            </div>

            {groups.map((group, gi) => (
              <div key={group.id} className="cgroup">
                <div className="cgroup-title">
                  <span className="cgroup-num">{gi + 1}</span>
                  <span className="cgroup-name">{group.label}</span>
                  <span className="cgroup-req">Required</span>
                </div>
                <div className="cgroup-grid">
                  {(group.options || []).map((option) => {
                    const variation = cheapestVariation(option);
                    const isOn = picked[group.id] === option.id;
                    return (
                      <button type="button" key={option.id} className={`ccard ${isOn ? 'on' : ''}`}
                        onClick={() => setPicked((p) => ({ ...p, [group.id]: option.id }))}>
                        {isOn && <span className="ccard-check">✓</span>}
                        <span className="ccard-name">{option.name}</span>
                        {variation && <span className="ccard-price">{formatMoney(variation.price, currency)}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="sheet-footer">
          <div className="stepper">
            <button onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Decrease quantity">−</button>
            <span>{qty}</span>
            <button onClick={() => setQty((q) => q + 1)} aria-label="Increase quantity">+</button>
          </div>
          <div className="sheet-footer-mid">
            {discount > 0 && subtotal > 0 && (
              <span className="sheet-footer-summary">{formatMoney(subtotal, currency)} − {formatMoney(discount, currency)} combo discount</span>
            )}
            {missingGroups.length > 0 && (
              <span className="sheet-footer-warn">Choose {missingGroups.map((g) => g.label).join(', ')}</span>
            )}
          </div>
          <button className="btn sheet-footer-add" onClick={handleAdd} disabled={missingGroups.length > 0}>
            Add to order · {formatMoney(unitPrice * qty, currency)}
          </button>
        </div>
      </div>
    </div>
  );
}
