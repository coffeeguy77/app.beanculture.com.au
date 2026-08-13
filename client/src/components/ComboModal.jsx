import React, { useMemo, useState } from 'react';
import { formatMoney, imgUrl } from '../api.js';

// A short random id, good enough to tag one "add to cart" click as a single
// combo instance (grouping its linked cart lines for display/removal, and for
// the server to re-validate the discount against — see server/lib/combos.js).
function comboInstanceId() {
  return 'ci' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Cheapest available variation's price, for the "from $X" label on an
// unpicked option card — the real price is only known once it's chosen (size
// and modifiers can change it).
function cheapestPrice(option) {
  const avail = (option.variations || []).filter((v) => !v.soldOut);
  const pool = avail.length ? avail : option.variations || [];
  return pool.reduce((min, v) => Math.min(min, v.price ?? Infinity), Infinity);
}

export default function ComboModal({ item: combo, currency, onClose, onAdd }) {
  const groups = combo.comboGroups || [];
  const [picked, setPicked] = useState({});        // groupId -> chosen option's itemId
  const [variationPick, setVariationPick] = useState({}); // groupId -> variationId
  const [modifierPick, setModifierPick] = useState({});   // groupId -> { modGroupId: Set(modId) }
  const [qty, setQty] = useState(1);

  function pickItem(group, option) {
    setPicked((p) => ({ ...p, [group.id]: option.id }));
    const firstAvail = (option.variations || []).find((v) => !v.soldOut) || option.variations?.[0];
    setVariationPick((p) => ({ ...p, [group.id]: firstAvail?.id }));
    setModifierPick((p) => ({ ...p, [group.id]: {} }));
  }

  function toggleModifier(group, modGroup, mod) {
    setModifierPick((prev) => {
      const groupState = { ...(prev[group.id] || {}) };
      const cur = new Set(groupState[modGroup.id] || []);
      if (modGroup.selectionType === 'SINGLE') {
        if (cur.has(mod.id)) cur.clear();
        else { cur.clear(); cur.add(mod.id); }
      } else if (cur.has(mod.id)) cur.delete(mod.id);
      else {
        if (modGroup.max > 0 && cur.size >= modGroup.max) return prev;
        cur.add(mod.id);
      }
      groupState[modGroup.id] = cur;
      return { ...prev, [group.id]: groupState };
    });
  }

  // Fully resolved pick per group: the chosen item + variation + modifiers,
  // and its real price (variation + modifier surcharges) — this is what
  // actually changes when a customer upsizes or adds extras, same as the
  // normal item sheet.
  const chosen = useMemo(() => {
    const out = {};
    for (const g of groups) {
      const optId = picked[g.id];
      const option = optId && (g.options || []).find((o) => o.id === optId);
      if (!option) continue;
      const variation = (option.variations || []).find((v) => v.id === variationPick[g.id]) || (option.variations || [])[0];
      if (!variation) continue;
      const modSel = modifierPick[g.id] || {};
      let modPrice = 0;
      const modIds = [];
      const modNames = [];
      for (const mg of option.modifierGroups || []) {
        const set = modSel[mg.id];
        if (!set) continue;
        for (const m of mg.modifiers) {
          if (set.has(m.id)) { modPrice += m.price || 0; modIds.push(m.id); modNames.push(m.name); }
        }
      }
      const unmetModGroups = (option.modifierGroups || []).filter((mg) => (mg.min || 0) > 0 && (modSel[mg.id]?.size || 0) < mg.min);
      out[g.id] = { option, variation, modIds, modNames, price: (variation.price || 0) + modPrice, unmet: unmetModGroups };
    }
    return out;
  }, [picked, variationPick, modifierPick, groups]);

  const subtotal = groups.reduce((sum, g) => sum + (chosen[g.id]?.price || 0), 0);
  // comboDiscountValue arrives from the server already in cents (same unit as
  // every price here) — see server/lib/catalog.js.
  const discount = Math.min(subtotal, combo.comboDiscountValue || 0);
  const unitPrice = Math.max(0, subtotal - discount);
  const missingGroups = groups.filter((g) => !chosen[g.id]);
  const unmetGroups = groups.filter((g) => chosen[g.id]?.unmet?.length > 0);
  const canAdd = !missingGroups.length && !unmetGroups.length;

  function handleAdd() {
    if (!canAdd) return;
    const instanceId = comboInstanceId();
    const entries = groups.map((g) => {
      const c = chosen[g.id];
      return {
        key: [instanceId, c.option.id, c.variation.id, [...c.modIds].sort().join(',')].join('|'),
        itemId: c.option.id, itemName: c.option.name,
        category: combo.name, image: c.option.image || null,
        variationId: c.variation.id, variationName: c.variation.name || '',
        modifierIds: c.modIds, modifierNames: c.modNames,
        unitPrice: c.price, quantity: qty,
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
                {discount > 0 && <span className="muted"> · always {formatMoney(discount, currency)} off this combo</span>}
              </div>
              {combo.description && <p className="sheet-desc">{combo.description}</p>}
            </div>
          </div>

          <div className="sheet-right">
            <div className="sheet-right-head">
              <h3>Build your combo</h3>
              <p>Pick one option per step and customise it just like ordering it on its own — your combo discount still applies.</p>
            </div>

            {groups.map((group, gi) => {
              const optId = picked[group.id];
              const option = optId && (group.options || []).find((o) => o.id === optId);
              const c = chosen[group.id];
              const hasCustomisation = option && ((option.variations || []).length > 1 || (option.modifierGroups || []).length > 0);
              return (
                <div key={group.id} className="cgroup">
                  <div className="cgroup-title">
                    <span className="cgroup-num">{gi + 1}</span>
                    <span className="cgroup-name">{group.label}</span>
                    <span className="cgroup-req">Required</span>
                  </div>
                  <div className="cgroup-grid">
                    {(group.options || []).map((opt) => {
                      const isOn = optId === opt.id;
                      return (
                        <button type="button" key={opt.id} className={`ccard ${isOn ? 'on' : ''}`}
                          onClick={() => pickItem(group, opt)}>
                          {isOn && <span className="ccard-check">✓</span>}
                          <span className="ccard-name">{opt.name}</span>
                          <span className="ccard-price">from {formatMoney(cheapestPrice(opt), currency)}</span>
                        </button>
                      );
                    })}
                  </div>

                  {hasCustomisation && (
                    <div className="combo-customize">
                      <div className="combo-customize-label">Customise your {option.name.toLowerCase()} · {formatMoney(c?.price || 0, currency)}</div>

                      {(option.variations || []).length > 1 && (
                        <div className="cgroup-grid">
                          {option.variations.map((v) => (
                            <button type="button" key={v.id} disabled={v.soldOut}
                              className={`ccard ${variationPick[group.id] === v.id ? 'on' : ''} ${v.soldOut ? 'disabled' : ''}`}
                              onClick={() => setVariationPick((p) => ({ ...p, [group.id]: v.id }))}>
                              {variationPick[group.id] === v.id && <span className="ccard-check">✓</span>}
                              <span className="ccard-name">{v.name || option.name}{v.soldOut ? ' — Sold out' : ''}</span>
                              <span className="ccard-price">{formatMoney(v.price, currency)}</span>
                            </button>
                          ))}
                        </div>
                      )}

                      {(option.modifierGroups || []).map((mg) => {
                        const modSel = (modifierPick[group.id] || {})[mg.id] || new Set();
                        const required = (mg.min || 0) > 0;
                        const unmet = required && modSel.size < mg.min;
                        const hint = mg.selectionType === 'SINGLE' ? 'Choose one' : mg.max > 0 ? `Choose up to ${mg.max}` : 'Choose one or more';
                        return (
                          <div key={mg.id} className="combo-modgroup">
                            <div className="cgroup-title">
                              <span className="cgroup-name">{mg.name}</span>
                              {required ? <span className="cgroup-req">Required</span> : <span className="cgroup-hint">{hint}</span>}
                            </div>
                            <div className="cgroup-grid">
                              {mg.modifiers.map((mod) => {
                                const isOn = modSel.has(mod.id);
                                return (
                                  <button type="button" key={mod.id} className={`ccard ${isOn ? 'on' : ''}`}
                                    onClick={() => toggleModifier(group, mg, mod)}>
                                    {isOn && <span className="ccard-check">✓</span>}
                                    <span className="ccard-name">{mod.name}</span>
                                    {mod.price > 0 && <span className="ccard-price">+{formatMoney(mod.price, currency)}</span>}
                                  </button>
                                );
                              })}
                            </div>
                            {unmet && <p className="cgroup-warn">Select at least {mg.min === 1 ? 'one' : mg.min}</p>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
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
            {!missingGroups.length && unmetGroups.length > 0 && (
              <span className="sheet-footer-warn">Finish customising {unmetGroups.map((g) => g.label).join(', ')}</span>
            )}
          </div>
          <button className="btn sheet-footer-add" onClick={handleAdd} disabled={!canAdd}>
            Add to order · {formatMoney(unitPrice * qty, currency)}
          </button>
        </div>
      </div>
    </div>
  );
}
