// Menu builder v2.
// - Shows only the child categories of a master "APPs" category (configurable).
// - Strips the "APP" prefix from category names for display.
// - Honors Square availability: ecom_visibility + per-location sold_out.
// - Syncs live (short cache) so menu/stock changes in Square reflect fast.

const { squareFetch, LOCATION_ID, CURRENCY, moneyToNumber } = require('./squareClient');

const PARENT_CATEGORY = (process.env.SQUARE_PARENT_CATEGORY || 'APPs').trim();
// Fallback allowlist if no parent category is found (comma-separated names).
const MENU_CATEGORIES = (process.env.SQUARE_MENU_CATEGORIES || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Remove a leading "APP"/"APPS" token from a category name for display.
function cleanName(name) {
  if (!name) return name;
  const cleaned = name.replace(/^app[s]?\b[\s:_\-–—]*/i, '').trim();
  return cleaned || name;
}

async function listAllCatalog(types) {
  const objects = [];
  let cursor;
  do {
    const qs = new URLSearchParams({ types });
    if (cursor) qs.set('cursor', cursor);
    const data = await squareFetch(`/v2/catalog/list?${qs.toString()}`);
    if (data.objects) objects.push(...data.objects);
    cursor = data.cursor;
  } while (cursor);
  return objects;
}

function variationSoldOut(variation) {
  const overrides = variation.item_variation_data?.location_overrides || [];
  const o = overrides.find((x) => x.location_id === LOCATION_ID);
  if (!o) return false;
  if (o.sold_out) {
    // Respect an expiry on a manual sell-out.
    if (o.sold_out_valid_until) {
      return new Date(o.sold_out_valid_until).getTime() > Date.now();
    }
    return true;
  }
  return false;
}

async function getMenu() {
  const objects = await listAllCatalog('ITEM,CATEGORY,MODIFIER_LIST,IMAGE');

  const categories = new Map(); // id -> { name, parentId }
  const images = new Map();
  const modifierLists = new Map();
  const items = [];

  for (const obj of objects) {
    if (obj.is_deleted) continue;
    switch (obj.type) {
      case 'CATEGORY': {
        const cd = obj.category_data || {};
        categories.set(obj.id, {
          name: cd.name || 'Menu',
          parentId: cd.parent_category?.id || null,
        });
        break;
      }
      case 'IMAGE':
        images.set(obj.id, obj.image_data?.url || null);
        break;
      case 'MODIFIER_LIST':
        modifierLists.set(obj.id, obj);
        break;
      case 'ITEM':
        items.push(obj);
        break;
      default:
        break;
    }
  }

  // Find the master parent category (e.g. "APPs"/"APP") and its children.
  // Normalize a trailing "s" so "APP" and "APPs" both match.
  const norm = (x) => (x || '').trim().toLowerCase().replace(/s$/, '');
  let parentId = null;
  for (const [id, c] of categories) {
    if (norm(c.name) === norm(PARENT_CATEGORY)) {
      parentId = id;
      break;
    }
  }
  const childIds = new Set();
  if (parentId) {
    for (const [id, c] of categories) {
      if (c.parentId === parentId) childIds.add(id);
    }
  }


  function resolveCategoryId(itemData) {
    if (Array.isArray(itemData.categories) && itemData.categories.length) {
      const sorted = [...itemData.categories].sort((a, b) => (a.ordinal || 0) - (b.ordinal || 0));
      // Prefer a category that is a child of our parent, if the item has several.
      const child = sorted.find((c) => childIds.has(c.id));
      if (child) return child.id;
      if (sorted[0]?.id) return sorted[0].id;
    }
    if (itemData.reporting_category?.id) return itemData.reporting_category.id;
    if (itemData.category_id) return itemData.category_id;
    return null;
  }

  function buildModifiers(itemData) {
    const info = itemData.modifier_list_info || [];
    const out = [];
    for (const ref of info) {
      if (ref.enabled === false) continue;
      const list = modifierLists.get(ref.modifier_list_id);
      if (!list) continue;
      const ld = list.modifier_list_data || {};
      const mods = (ld.modifiers || [])
        .filter((m) => !m.is_deleted)
        .map((m) => ({
          id: m.id,
          name: m.modifier_data?.name || '',
          price: moneyToNumber(m.modifier_data?.price_money) || 0,
        }));
      if (!mods.length) continue;
      out.push({
        id: list.id,
        name: ld.name || 'Options',
        selectionType: (ld.selection_type || 'MULTIPLE').toUpperCase(),
        min: typeof ref.min_selected_modifiers === 'number' ? ref.min_selected_modifiers : 0,
        max: typeof ref.max_selected_modifiers === 'number' ? ref.max_selected_modifiers : -1,
        modifiers: mods,
      });
    }
    return out;
  }

  const byCategory = new Map(); // display name -> { name, order, items[] }

  for (const item of items) {
    const d = item.item_data || {};
    if (d.is_archived) continue;

    // Online visibility: hide the truly-hidden ones.
    const vis = (d.ecom_visibility || 'VISIBLE').toUpperCase();
    if (vis === 'HIDDEN' || vis === 'UNINDEXED') continue;
    const itemUnavailable = vis === 'UNAVAILABLE';

    const present =
      item.present_at_all_locations || (item.present_at_location_ids || []).includes(LOCATION_ID);
    if (!present) continue;

    const catId = resolveCategoryId(d);

    // If we found a master parent, only show items in its children.
    if (parentId) {
      if (!catId || !childIds.has(catId)) continue;
    } else if (MENU_CATEGORIES.length && catId) {
      const cname = categories.get(catId)?.name;
      if (!cname || !MENU_CATEGORIES.some((w) => w.toLowerCase() === cname.toLowerCase())) continue;
    }

    const rawCatName = (catId && categories.get(catId)?.name) || 'Menu';
    const catName = cleanName(rawCatName);
    const catOrdinal = catId
      ? (item.item_data.categories || []).find((c) => c.id === catId)?.ordinal ?? 0
      : 0;

    const imageId = (d.image_ids || [])[0];
    const image = imageId ? images.get(imageId) : null;

    const variations = (d.variations || [])
      .filter((v) => !v.is_deleted)
      .map((v) => ({
        id: v.id,
        name: v.item_variation_data?.name || '',
        price: moneyToNumber(v.item_variation_data?.price_money),
        soldOut: itemUnavailable || variationSoldOut(v),
      }))
      .filter((v) => v.price !== null);

    if (!variations.length) continue;

    const soldOut = itemUnavailable || variations.every((v) => v.soldOut);

    const menuItem = {
      id: item.id,
      name: d.name || 'Item',
      description: d.description_plaintext || d.description || '',
      image,
      soldOut,
      variations,
      modifierGroups: buildModifiers(d),
    };

    if (!byCategory.has(catName)) {
      byCategory.set(catName, { name: catName, order: catOrdinal, items: [] });
    }
    byCategory.get(catName).items.push(menuItem);
  }

  // Order categories: by the parent's child ordinal where possible, else name.
  let entries = [...byCategory.values()];
  if (parentId) {
    // Order children by their ordinal under the parent.
    const childOrder = new Map();
    let i = 0;
    for (const [id, c] of categories) {
      if (childIds.has(id)) childOrder.set(cleanName(c.name), i++);
    }
    entries.sort(
      (a, b) => (childOrder.get(a.name) ?? 999) - (childOrder.get(b.name) ?? 999)
    );
  }

  console.log(
    `[menu] parent="${PARENT_CATEGORY}"${parentId ? ' found' : ' NOT found'} | ${childIds.size} child categories | showing ${entries.length}: ${entries.map((e) => `${e.name}(${e.items.length})`).join(', ')}`
  );

  const menu = entries.map((e) => ({ category: e.name, items: e.items }));
  return { currency: CURRENCY, categories: menu };
}

module.exports = { getMenu, cleanName };
