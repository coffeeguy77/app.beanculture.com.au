// Combo Builder: bundles across DIFFERENT Square items (a burger + a side + a
// drink) with an automatic dollar-amount discount — our own alternative to
// Square's native Catalog "Combo" item type, which needs a paid Square
// Restaurants subscription (and a higher processing rate) to use. Nothing is
// created in Square's Catalog for a combo; at checkout the discount is applied
// as a normal Square order-level discount, exactly like a coupon (see
// coupons.js), just triggered automatically by what's in the cart instead of a
// typed code.
//
// SECURITY: the client tells us which combo + which items it claims to have
// picked (comboId/comboInstanceId/comboGroupId stamped on each cart line by
// ComboModal), but it never sends a discount amount. This module re-derives
// the discount from the STORED combo definition in settings, and independently
// re-checks that the claimed line items truly satisfy every required group,
// using a fresh, unfiltered read of the real Square catalog — so a tampered
// client can never grant itself a discount it didn't earn, and admin-only
// visibility toggles (hidden categories etc.) never accidentally block a
// legitimate combo either.

const { squareFetch, CURRENCY } = require('./squareClient');
const { getSettings } = require('./settings');
const { cleanName } = require('./catalog');

// Minimal raw catalog read: just items + categories, no images/modifiers —
// this only needs to know which variation ids exist and which category(ies)
// each item belongs to. Deliberately separate from catalog.getMenu(), which
// applies the owner's storefront selection/visibility settings — a combo's
// legitimacy should depend only on the real Square catalog, never on whether
// an item happens to be shown on the menu right now.
async function loadRawCatalog() {
  const objects = [];
  let cursor;
  do {
    const qs = new URLSearchParams({ types: 'ITEM,CATEGORY' });
    if (cursor) qs.set('cursor', cursor);
    const data = await squareFetch(`/v2/catalog/list?${qs.toString()}`);
    if (data.objects) objects.push(...data.objects);
    cursor = data.cursor;
  } while (cursor);

  const categoryNames = new Map(); // id -> cleaned display name
  const itemsById = new Map();     // itemId -> { categoryIds: Set, variationIds: Set }
  for (const obj of objects) {
    if (obj.is_deleted) continue;
    if (obj.type === 'CATEGORY') {
      categoryNames.set(obj.id, cleanName(obj.category_data?.name || ''));
    } else if (obj.type === 'ITEM') {
      const d = obj.item_data || {};
      const categoryIds = new Set();
      for (const c of d.categories || []) if (c && c.id) categoryIds.add(c.id);
      if (d.reporting_category?.id) categoryIds.add(d.reporting_category.id);
      if (d.category_id) categoryIds.add(d.category_id);
      const variationIds = new Set((d.variations || []).filter((v) => !v.is_deleted).map((v) => v.id));
      itemsById.set(obj.id, { categoryIds, variationIds });
    }
  }
  return { categoryNames, itemsById };
}

// The set of item ids that satisfy one combo group, per the raw catalog.
function groupItemIds(group, idx) {
  const ids = new Set();
  if (group && group.sourceType !== 'items' && group.categoryName) {
    const wanted = cleanName(String(group.categoryName)).toLowerCase();
    for (const [itemId, item] of idx.itemsById) {
      for (const catId of item.categoryIds) {
        if ((idx.categoryNames.get(catId) || '').toLowerCase() === wanted) { ids.add(itemId); break; }
      }
    }
  }
  if (group && group.sourceType !== 'category') {
    for (const id of Array.isArray(group.itemIds) ? group.itemIds : []) ids.add(id);
  }
  return ids;
}

// variationId -> owning itemId (or null), from the raw catalog.
function variationOwner(idx, variationId) {
  if (!variationId) return null;
  for (const [itemId, item] of idx.itemsById) {
    if (item.variationIds.has(variationId)) return itemId;
  }
  return null;
}

function activeCombo(comboId) {
  return (getSettings().combos || []).find((c) => c && c.id === comboId && c.active !== false) || null;
}

// Given the cart payload sent to /api/orders, find every combo instance the
// client claims (grouped by comboInstanceId), verify each is genuinely
// satisfied — every group in the stored combo definition has a matching cart
// line for a real item in that group — and return the Square order-level
// discount objects to apply, one per legitimate instance. Anything that
// doesn't fully check out is silently dropped rather than partially honoured.
async function discountsForCart(cart) {
  const instances = new Map(); // instanceId -> { comboId, lines: [{variationId, comboGroupId}] }
  for (const line of Array.isArray(cart) ? cart : []) {
    if (!line || !line.comboInstanceId || !line.comboId) continue;
    if (!instances.has(line.comboInstanceId)) instances.set(line.comboInstanceId, { comboId: line.comboId, lines: [] });
    instances.get(line.comboInstanceId).lines.push({ variationId: line.variationId, comboGroupId: line.comboGroupId, quantity: Math.max(1, parseInt(line.quantity, 10) || 1) });
  }
  if (!instances.size) return [];

  const idx = await loadRawCatalog();
  const discounts = [];
  let n = 0;
  for (const inst of instances.values()) {
    const combo = activeCombo(inst.comboId);
    if (!combo || !Array.isArray(combo.groups) || !combo.groups.length) continue;

    let satisfied = true;
    // Number of COMPLETE combos = the smallest quantity across the groups'
    // matched lines (an atomic bundle keeps them equal; if they somehow differ,
    // only the fully-satisfied count is discounted). Every group must be
    // present, or the whole instance earns nothing (a removed component ⇒ no
    // discount, which is exactly the abuse case the client UI now also prevents).
    let comboQty = Infinity;
    for (const group of combo.groups) {
      if (!group || !group.id) { satisfied = false; break; }
      const allowed = groupItemIds(group, idx);
      const claimedLine = inst.lines.find((l) => l.comboGroupId === group.id);
      const itemId = claimedLine && variationOwner(idx, claimedLine.variationId);
      if (!itemId || !allowed.has(itemId)) { satisfied = false; break; }
      comboQty = Math.min(comboQty, claimedLine.quantity || 1);
    }
    if (!satisfied) continue;
    if (!Number.isFinite(comboQty) || comboQty < 1) comboQty = 1;

    const cents = Math.max(0, Math.round((Number(combo.discountValue) || 0) * 100)) * comboQty;
    if (!cents) continue;
    n += 1;
    discounts.push({
      uid: `combo-${n}`,
      name: `${(combo.name || 'Combo').trim()} deal`,
      amount_money: { amount: cents, currency: CURRENCY },
      scope: 'ORDER',
    });
  }
  return discounts;
}

// Enforce per-combo modifier locks server-side: for every combo cart line,
// append the modifier ids the owner locked into that combo group's item (from
// the STORED combo definition), so a tampered client can never strip a locked
// add-on (e.g. the combo's included chips) to pay less. Returns a new cart with
// those modifier ids merged in; non-combo carts pass straight through untouched.
async function applyLockedMods(cart) {
  const list = Array.isArray(cart) ? cart : [];
  if (!list.some((l) => l && l.comboInstanceId && l.comboId && l.comboGroupId)) return list;
  const settings = getSettings();
  const idx = await loadRawCatalog();
  return list.map((line) => {
    if (!line || !line.comboInstanceId || !line.comboId || !line.comboGroupId) return line;
    const combo = (settings.combos || []).find((c) => c && c.id === line.comboId && c.active !== false);
    if (!combo) return line;
    const group = (combo.groups || []).find((g) => g && g.id === line.comboGroupId);
    if (!group || !group.itemLocks) return line;
    const itemId = variationOwner(idx, line.variationId);
    const locks = itemId && Array.isArray(group.itemLocks[itemId]) ? group.itemLocks[itemId] : null;
    if (!locks || !locks.length) return line;
    const merged = new Set([...(Array.isArray(line.modifierIds) ? line.modifierIds : []), ...locks]);
    return { ...line, modifierIds: [...merged] };
  });
}

module.exports = { discountsForCart, applyLockedMods };
