// Menu builder v2.
// - Shows only the child categories of a master "APPs" category (configurable).
// - Strips the "APP" prefix from category names for display.
// - Honors Square availability: ecom_visibility + per-location sold_out.
// - Syncs live (short cache) so menu/stock changes in Square reflect fast.

const { squareFetch, LOCATION_ID, CURRENCY, moneyToNumber } = require('./squareClient');
const { getSettings } = require('./settings');

const PARENT_CATEGORY = (process.env.SQUARE_PARENT_CATEGORY || 'APPs').trim();
// Fallback allowlist if no parent category is found (comma-separated names).
const MENU_CATEGORIES = (process.env.SQUARE_MENU_CATEGORIES || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Structure a run-on product description into labelled lines. Content is NOT
// changed — we only insert line breaks before known coffee labels when Square
// didn't already provide structure (so we never fight a well-formatted one).
const DESC_LABELS = [
  'Origin Composition', 'Origin', 'Process', 'Harvest', 'Cup Profile', 'Tasting Notes',
  'Roast Profile', 'Suggested Brewing', 'Milk-based drinks', 'Milk-based', 'Body',
  'Sweetness', 'Acidity', 'Finish', 'Development', 'Style', 'Target', 'Espresso', 'Filter',
];
function formatDescription(text) {
  if (!text) return text;
  let t = String(text).replace(/\r/g, '');
  const newlines = (t.match(/\n/g) || []).length;
  if (newlines >= 2) return t.trim(); // already structured by Square
  for (const l of DESC_LABELS) {
    const esc = l.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    t = t.replace(new RegExp('\\s+(' + esc + '):', 'g'), '\n$1:');
  }
  return t.replace(/\n{2,}/g, '\n').replace(/^\n+/, '').trim();
}

// Normalize a name for comparison (lowercase, trim, drop trailing "s").
const norm = (x) => (x || '').trim().toLowerCase().replace(/s$/, '');

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

async function getMenu(opts = {}) {
  const applySelection = opts.applySelection !== false;
  // Admin item/category selection (which items are offered in the app).
  const selection = applySelection ? getSettings().menuSelection || {} : {};
  const selLower = {};
  for (const k of Object.keys(selection)) selLower[k.toLowerCase()] = selection[k];

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

  // Which categories to show. If the admin picked specific Square categories
  // (settings.menuCategories), use those directly. Otherwise fall back to the
  // children of a master "APP" parent category.
  const included = (getSettings().menuCategories || []).map(String);
  const sel = new Set(included.map((x) => x.toLowerCase()));
  let parentId = null;
  const childIds = new Set();
  if (sel.size) {
    // The chosen categories ARE the menu (authoritative). Match by id, raw name
    // or cleaned display name — case-insensitive — so both new (name-based) and
    // old (id-based) saved values keep working.
    for (const [id, c] of categories) {
      if (sel.has(String(id).toLowerCase()) || sel.has((c.name || '').toLowerCase()) || sel.has(cleanName(c.name || '').toLowerCase())) childIds.add(id);
    }
  } else {
    // Nothing chosen yet → fall back to the "APP" parent's children.
    for (const [id, c] of categories) {
      if (norm(c.name) === norm(PARENT_CATEGORY)) { parentId = id; break; }
    }
    if (parentId) {
      for (const [id, c] of categories) {
        if (c.parentId === parentId) childIds.add(id);
      }
    }
  }
  const restrictToChildren = childIds.size > 0 || !!parentId;


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

    // Only show items in the selected / child categories.
    if (restrictToChildren) {
      if (!catId || !childIds.has(catId)) continue;
    } else if (MENU_CATEGORIES.length && catId) {
      const cname = categories.get(catId)?.name;
      if (!cname || !MENU_CATEGORIES.some((w) => w.toLowerCase() === cname.toLowerCase())) continue;
    }

    const rawCatName = (catId && categories.get(catId)?.name) || 'Menu';
    const catName = cleanName(rawCatName);

    // Honor the admin's item/category selection.
    if (applySelection) {
      const sel = selLower[catName.toLowerCase()];
      if (sel) {
        if (sel.enabled === false) continue;
        if (Array.isArray(sel.items) && !sel.items.includes(item.id)) continue;
      }
    }
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
      description: formatDescription(d.description_plaintext || d.description || ''),
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

  // Admin views include brand-new / empty child categories so they can be
  // configured (offered, given a footer button) as soon as they exist in Square.
  if (opts.includeEmpty && childIds.size) {
    const present = new Set(entries.map((e) => e.name.toLowerCase()));
    for (const [id, c] of categories) {
      if (!childIds.has(id)) continue;
      const nm = cleanName(c.name);
      if (!present.has(nm.toLowerCase())) entries.push({ name: nm, order: 999, items: [] });
    }
  }

  if (childIds.size) {
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

  const menu = entries.map((e) => {
    // Per-category image visibility (admin toggle). Default: show images.
    const sel = selLower[e.name.toLowerCase()];
    const showImages = !sel || sel.showImages !== false;
    return { category: e.name, items: e.items, showImages };
  });
  return { currency: CURRENCY, categories: menu };
}

// Full menu ignoring the admin selection, including empty categories — used by
// the admin item chooser and category lists so new categories show immediately.
async function getFullMenu() {
  return getMenu({ applySelection: false, includeEmpty: true });
}

// Every Square category (for the admin "categories in the app" picker), so new
// categories can be added to the app without needing an "APP" parent in Square.
async function getAllCategories() {
  const objects = await listAllCatalog('CATEGORY');
  const parentNorm = norm(PARENT_CATEGORY);
  const out = [];
  for (const obj of objects) {
    if (obj.is_deleted) continue;
    const name = obj.category_data?.name || '';
    if (!name) continue;
    out.push({ id: obj.id, name: cleanName(name), rawName: name, isParent: norm(name) === parentNorm });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

module.exports = { getMenu, getFullMenu, getAllCategories, cleanName };
