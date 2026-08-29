import { useMemo, useState } from 'react';

// Shared item-configuration logic for BOTH the customer sheet (ItemModal) and
// the staff POS configure workspace. Keeping selection/validation/pricing/cart-
// item construction in one place is a hard requirement: the exact same valid
// choices, prices and production names must be produced no matter where an item
// is configured, so the kitchen ticket is identical whether the order came from
// the app or the counter. Presentation lives in the two callers; the rules live
// here.

export function makeKey(item, variationId, modifierIds, note) {
  return [item.id, variationId, [...modifierIds].sort().join(','), note].join('|');
}

// Is there actually anything to choose? (size options or a real add-on group)
export function itemHasOptions(item) {
  return (
    (item.variations || []).length > 1 ||
    (item.modifierGroups || []).some((g) => (g.modifiers || []).length > 0)
  );
}

// A simple item = no size choice AND no required group. Safe to add in one tap.
export function itemIsQuickAdd(item) {
  if ((item.variations || []).length > 1) return false;
  return !(item.modifierGroups || []).some((g) => (g.min || 0) > 0);
}

// Pure cart-item builder for a one-tap "quick add" (a simple item with no size
// choice and no required groups). Applies the preset's default-on options and
// any locked modifiers so the line is identical to configuring it by hand.
// Produces the SAME shape as buildCartItem().
export function buildQuickCartItem(item) {
  const variation = (item.variations || []).find((v) => !v.soldOut) || (item.variations || [])[0] || {};
  const ids = [], names = [];
  let price = variation.price || 0;
  const d = item.defaults || {};
  for (const group of item.modifierGroups || []) {
    const on = new Set(d[group.id] || []);
    if (!on.size) continue;
    for (const mod of group.modifiers || []) {
      if (on.has(mod.id)) { ids.push(mod.id); names.push(mod.name); price += mod.price || 0; }
    }
  }
  const allIds = [...ids, ...(item.lockedModifierIds || [])];
  const allNames = [...names, ...(item.lockedModifierNames || [])];
  return {
    key: makeKey(item, variation.id, allIds, ''),
    itemId: item.presetSourceItemId || item.id,
    itemName: item.name,
    category: item.category || null,
    image: item.image || null,
    variationId: variation.id,
    variationName: variation.name || '',
    modifierIds: allIds,
    modifierNames: allNames,
    unitPrice: price,
    quantity: 1,
    note: '',
  };
}

// initial (optional): seed from an existing cart line when EDITING it, so the
// same component can edit an item already in the cart. Shape:
//   { variationId, modifierIds: string[], note, quantity }
export function useItemConfig(item, initial) {
  const firstAvail = (item.variations || []).find((v) => !v.soldOut) || (item.variations || [])[0];

  const [variationId, setVariationId] = useState(initial?.variationId || firstAvail?.id);
  const [selected, setSelected] = useState(() => {
    const init = {};
    // When editing, seed from the line's chosen modifier ids, mapped back onto
    // their groups. Otherwise seed from the preset's default-on options.
    if (initial && Array.isArray(initial.modifierIds)) {
      const chosen = new Set(initial.modifierIds);
      for (const group of item.modifierGroups || []) {
        const inGroup = (group.modifiers || []).filter((m) => chosen.has(m.id)).map((m) => m.id);
        if (inGroup.length) init[group.id] = new Set(inGroup);
      }
      return init;
    }
    const d = item.defaults || {};
    for (const gid of Object.keys(d)) init[gid] = new Set(d[gid]);
    return init;
  });
  const [qty, setQty] = useState(initial?.quantity || 1);
  const [note, setNote] = useState(initial?.note || '');

  const variation = (item.variations || []).find((v) => v.id === variationId) || firstAvail;

  function toggleModifier(group, mod) {
    setSelected((prev) => {
      const cur = new Set(prev[group.id] || []);
      // "Pick exactly one" groups (max 1) act as single-select even if Square
      // tags them MULTIPLE — the tick moves rather than needing a manual un-tick.
      if (group.selectionType === 'SINGLE' || group.max === 1) {
        // Tapping the chosen option clears it back to "none picked"; required
        // groups (min > 0) are enforced at add time, not by locking the pick.
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

  // Required groups whose minimum isn't met yet — blocks Add and flags the group.
  const unmetGroups = (item.modifierGroups || []).filter((group) => {
    const need = group.min || 0;
    if (need <= 0) return false;
    return ((selected[group.id]?.size) || 0) < need;
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
  const canAdd = unmetGroups.length === 0;

  // Build the cart line item. Identical shape whether app or POS, so downstream
  // (cart, order submission, KDS ticket) never has to care about the origin.
  function buildCartItem() {
    const lockIds = item.lockedModifierIds || [];
    const lockNames = item.lockedModifierNames || [];
    const allIds = [...modifierIds, ...lockIds];
    const allNames = [...modifierNames, ...lockNames];
    return {
      key: makeKey(item, variationId, allIds, note),
      itemId: item.presetSourceItemId || item.id,
      itemName: item.name,
      category: item.category || null,
      image: item.image || null,
      variationId,
      variationName: variation?.name || '',
      modifierIds: allIds,
      modifierNames: allNames,
      unitPrice,
      quantity: qty,
      note: note.trim(),
    };
  }

  return {
    variationId, setVariationId, variation,
    selected, toggleModifier,
    unmetGroups, canAdd,
    modifierIds, modifierNames, modifierPrice, unitPrice,
    qty, setQty, note, setNote,
    buildCartItem,
  };
}
