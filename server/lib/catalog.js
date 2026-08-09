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
    // Square often has duplicate categories with the same name (e.g. two
    // "Specials", or "Cold drinks" vs "COLD DRINKS"). Picking one should surface
    // items from ALL categories that share its display name, so nothing hides in
    // an unselected twin.
    const selectedNames = new Set();
    for (const id of childIds) { const c = categories.get(id); if (c) selectedNames.add(cleanName(c.name || '').toLowerCase()); }
    for (const [id, c] of categories) {
      if (selectedNames.has(cleanName(c.name || '').toLowerCase())) childIds.add(id);
    }
  }
  // Categories appear ONLY when explicitly selected in the admin. Nothing
  // selected = no category sections (the menu is then built from product
  // sections and product-builder sections instead of any hardcoded fallback).
  const restrictToChildren = true;


  // Every category id an item belongs to, with the item's ordinal within each.
  // Square lets an item live in MANY categories (the modern `categories` array),
  // so we keep them all — the item then shows under each of its categories,
  // exactly like it does on the POS. (`reporting_category` / legacy `category_id`
  // are folded in as fallbacks for items that predate the multi-category model.)
  function itemCategoryMap(itemData) {
    const m = new Map();
    if (Array.isArray(itemData.categories)) {
      for (const c of itemData.categories) if (c && c.id && !m.has(c.id)) m.set(c.id, c.ordinal || 0);
    }
    if (itemData.reporting_category?.id && !m.has(itemData.reporting_category.id)) m.set(itemData.reporting_category.id, 0);
    if (itemData.category_id && !m.has(itemData.category_id)) m.set(itemData.category_id, 0);
    return m;
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

  // Collect items per category id. Each item is placed under EVERY category it
  // belongs to (that we're showing) — this is the fix for items like "Taro" that
  // sit in several Square categories but previously only surfaced in one.
  const byCatId = new Map(); // catId -> [{ item, ordinal }]
  const itemsById = new Map(); // id -> menuItem, for EVERY offerable product

  for (const item of items) {
    const d = item.item_data || {};
    if (d.is_archived) continue;

    // Visibility: `ecom_visibility` governs Square's *online store*, not this
    // ordering app — so items that are simply UNINDEXED (not published online,
    // the default for many POS items) should still appear here. Only skip ones
    // the owner has explicitly HIDDEN.
    const vis = (d.ecom_visibility || 'VISIBLE').toUpperCase();
    if (vis === 'HIDDEN') continue;
    const itemUnavailable = vis === 'UNAVAILABLE';

    const present =
      item.present_at_all_locations || (item.present_at_location_ids || []).includes(LOCATION_ID);
    if (!present) continue;

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

    // Keep EVERY offerable product (regardless of category membership) so a
    // hand-picked product section can surface it without loading its category.
    itemsById.set(item.id, menuItem);

    // Which of the item's categories are actually shown in the app?
    const memberIds = itemCategoryMap(d);
    let targetIds = [...memberIds.keys()];
    if (restrictToChildren) {
      targetIds = targetIds.filter((id) => childIds.has(id));
    } else if (MENU_CATEGORIES.length) {
      targetIds = targetIds.filter((id) => {
        const nm = categories.get(id)?.name;
        return nm && MENU_CATEGORIES.some((w) => w.toLowerCase() === nm.toLowerCase());
      });
    }

    for (const catId of targetIds) {
      if (!byCatId.has(catId)) byCatId.set(catId, []);
      byCatId.get(catId).push({ item: menuItem, ordinal: memberIds.get(catId) || 0 });
    }
  }

  // Output categories in Square's catalog order. When restricting we output every
  // shown category (so brand-new / empty ones are configurable); otherwise only
  // the categories that actually gathered items.
  const orderIndex = new Map();
  { let i = 0; for (const id of categories.keys()) orderIndex.set(id, i++); }
  let outIds = restrictToChildren ? [...childIds] : [...byCatId.keys()];
  outIds.sort((a, b) => (orderIndex.get(a) ?? 1e9) - (orderIndex.get(b) ?? 1e9));

  // Assemble, merging Square categories that share a display name CASE-
  // INSENSITIVELY (so "TEA" and "Tea", "COLD DRINKS" and "Cold drinks" become one
  // category, not two). The display name prefers the variant the owner actually
  // selected; items from all variants are combined and de-duplicated.
  const entries = [];
  const byKey = new Map(); // lowercased clean name -> entry
  for (const catId of outIds) {
    const rawName = categories.get(catId)?.name || 'Menu';
    const catName = cleanName(rawName);
    const key = catName.toLowerCase();
    const list = (byCatId.get(catId) || [])
      .slice()
      .sort((a, b) => (a.ordinal - b.ordinal) || a.item.name.localeCompare(b.item.name))
      .map((x) => x.item);
    const directlySelected = sel.has(String(catId).toLowerCase()) || sel.has((rawName || '').toLowerCase()) || sel.has(key);

    let e = byKey.get(key);
    if (!e) { e = { name: catName, items: [], picked: false }; byKey.set(key, e); entries.push(e); }
    if (directlySelected && !e.picked) { e.name = catName; e.picked = true; } // show the chosen variant's casing
    const seen = new Set(e.items.map((i) => i.id));
    for (const it of list) if (!seen.has(it.id)) { e.items.push(it); seen.add(it.id); }
  }

  // Admin per-category / per-item selection, applied once to the merged entry.
  // A category the owner explicitly put in "Categories in the app" (e.picked)
  // stays visible even if an old "Menu items offered" toggle left it disabled —
  // that selection is the newer, clearer intent. Per-item filtering still applies.
  if (applySelection) {
    for (const e of entries) {
      const s2 = selLower[e.name.toLowerCase()];
      if (!s2) continue;
      if (s2.enabled === false && !e.picked) { e.items = []; continue; }
      if (Array.isArray(s2.items)) e.items = e.items.filter((it) => s2.items.includes(it.id));
    }
  }

  const finalEntries = opts.includeEmpty ? entries : entries.filter((e) => e.items.length > 0);

  // Normalize category-derived sections to the storefront shape.
  let sections = finalEntries.map((e) => {
    const s2 = selLower[e.name.toLowerCase()];
    const showImages = !s2 || s2.showImages !== false;
    return { category: e.name, items: e.items, showImages, topNav: true, footerNav: false };
  });

  // Custom product sections: hand-picked products grouped under an owner-named
  // heading, built from itemsById so a product can be surfaced WITHOUT loading
  // its whole category. Applied to the live storefront only (applySelection).
  if (applySelection) {
    for (const ps of getSettings().productSections || []) {
      if (!ps || ps.enabled === false) continue;
      const name = String(ps.name || '').trim();
      if (!name) continue;
      const seen = new Set();
      const list = [];
      for (const id of Array.isArray(ps.items) ? ps.items : []) {
        const mi = itemsById.get(id);
        if (mi && !seen.has(id)) { list.push(mi); seen.add(id); }
      }
      if (!list.length && !opts.includeEmpty) continue;
      sections.push({ category: name, items: list, showImages: ps.showImages !== false, custom: true, topNav: true, footerNav: false });
    }
  }

  // Product-builder presets: named "hot links" into ONE variable Square item.
  // Each preset locks a variation and curates which modifier options show; it
  // renders as its own tile in its section and, when ordered, submits as the
  // real Square variation + modifier ids. Live storefront only (applySelection).
  if (applySelection) {
    const presetsBySection = new Map();
    const presetSourceIds = new Set();
    for (const p of getSettings().presets || []) {
      if (!p || p.enabled === false) continue;
      const src = itemsById.get(p.sourceItemId);
      if (!src) continue;
      presetSourceIds.add(p.sourceItemId);
      // A preset can offer ONE locked variation, or several (a "combined" tile,
      // e.g. a coffee with 6oz + 12oz that the customer toggles between).
      const vids = Array.isArray(p.variationIds) && p.variationIds.length ? p.variationIds : [p.variationId];
      const chosenVars = vids.map((id) => (src.variations || []).find((v) => v.id === id)).filter(Boolean);
      if (!chosenVars.length) continue;

      const groupCfg = p.groups || {};
      const groups = [];
      const lockedModifierIds = [];
      const lockedModifierNames = [];
      const defaults = {};
      let lockedTotal = 0;
      for (const g of src.modifierGroups || []) {
        const cfg = groupCfg[g.id];
        if (!cfg) continue; // group not configured → hidden
        const offered = [];
        for (const m of g.modifiers) {
          const state = cfg[m.id]; // 'optional' | 'default' | 'locked' ; undefined → off
          if (!state) continue;
          if (state === 'locked') { lockedModifierIds.push(m.id); lockedModifierNames.push(m.name); lockedTotal += m.price || 0; continue; }
          offered.push(m);
          if (state === 'default') { (defaults[g.id] = defaults[g.id] || []).push(m.id); }
        }
        if (offered.length) {
          groups.push({ id: g.id, name: g.name, selectionType: g.selectionType, min: g.min, max: g.max, modifiers: offered });
        }
      }

      const tile = {
        id: 'preset:' + p.id,
        name: (p.name || '').trim() || chosenVars[0].name || src.name,
        description: src.description || '',
        image: src.image || null,
        // Locked-modifier price is baked into the displayed price; Square still
        // recomputes the true total from the ids we submit. Multiple variations
        // become a size toggle in the item sheet.
        soldOut: chosenVars.every((v) => !!v.soldOut),
        variations: chosenVars.map((v) => ({ id: v.id, name: v.name, price: (v.price || 0) + lockedTotal, soldOut: !!v.soldOut })),
        modifierGroups: groups,
        lockedModifierIds,
        lockedModifierNames,
        defaults,
        isPreset: true,
        presetSourceItemId: p.sourceItemId,
      };
      const secName = String(p.section || '').trim() || 'Specials';
      if (!presetsBySection.has(secName)) presetsBySection.set(secName, []);
      presetsBySection.get(secName).push(tile);
    }
    const sectionNav = getSettings().presetSectionNav || {};
    // A builder section shows on the storefront when its Top-menu or Footer
    // toggle is on. Top → top category bar; Footer → footer menu (grouped by the
    // Footer menu builder, or its own button). showImages hides empty thumbnails.
    for (const [secName, tiles] of presetsBySection) {
      const existing = sections.find((s) => s.category.toLowerCase() === secName.toLowerCase());
      if (existing) { existing.items.push(...tiles); continue; }
      const nav = sectionNav[secName] || {};
      if (!(nav.top === true || nav.footer === true)) continue;
      sections.push({ category: secName, items: tiles, showImages: nav.showImages !== false, custom: true, builder: true, topNav: nav.top === true, footerNav: nav.footer === true });
    }
    // Hide the original master items now that presets represent them (keep the
    // preset tiles themselves). Drop any section left empty as a result.
    if (getSettings().hidePresetSources !== false && presetSourceIds.size) {
      for (const sec of sections) sec.items = sec.items.filter((it) => it.isPreset || !presetSourceIds.has(it.id));
      if (!opts.includeEmpty) sections = sections.filter((sec) => sec.items.length > 0);
    }
    // Sections the owner has hidden by name (from "Menu items offered").
    const hidden = new Set((getSettings().hiddenSections || []).map((n) => String(n).toLowerCase()));
    if (hidden.size) sections = sections.filter((sec) => !hidden.has(String(sec.category).toLowerCase()));
  }

  // Apply the owner's custom section order (settings.menuOrder = display names)
  // across BOTH category and product sections. Listed names come first in that
  // order; anything not listed keeps its current order after them (stable sort).
  const orderNames = (getSettings().menuOrder || []).map((n) => String(n).toLowerCase());
  if (orderNames.length) {
    const rank = (sec) => {
      const i = orderNames.indexOf(String(sec.category).toLowerCase());
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    sections.sort((a, b) => rank(a) - rank(b));
  }

  console.log(
    `[menu] ${restrictToChildren ? childIds.size + ' shown categories' : 'no restriction (all)'} | ${sections.length} sections: ${sections.map((e) => `${e.category}(${e.items.length})`).join(', ')}`
  );

  return { currency: CURRENCY, categories: sections };
}

// Flat list of EVERY offerable Square product (id, name, image, category name),
// regardless of which categories are loaded in the app — used by the admin
// "product sections" picker so any product can be hand-picked into a section.
async function getAllProducts() {
  const objects = await listAllCatalog('ITEM,CATEGORY,IMAGE');
  const catNames = new Map();
  const images = new Map();
  const items = [];
  for (const obj of objects) {
    if (obj.is_deleted) continue;
    if (obj.type === 'CATEGORY') catNames.set(obj.id, cleanName(obj.category_data?.name || 'Menu'));
    else if (obj.type === 'IMAGE') images.set(obj.id, obj.image_data?.url || null);
    else if (obj.type === 'ITEM') items.push(obj);
  }
  const out = [];
  for (const item of items) {
    const d = item.item_data || {};
    if (d.is_archived) continue;
    if ((d.ecom_visibility || 'VISIBLE').toUpperCase() === 'HIDDEN') continue;
    const present =
      item.present_at_all_locations || (item.present_at_location_ids || []).includes(LOCATION_ID);
    if (!present) continue;
    const hasPricedVariation = (d.variations || [])
      .some((v) => !v.is_deleted && moneyToNumber(v.item_variation_data?.price_money) !== null);
    if (!hasPricedVariation) continue;
    // Every category this item is nested in (Square lets an item belong to many),
    // so the builder can show/filter by category and you know you're editing the
    // right POS item.
    const catIds = [];
    if (Array.isArray(d.categories)) for (const c of d.categories) if (c && c.id) catIds.push(c.id);
    if (d.reporting_category?.id) catIds.push(d.reporting_category.id);
    if (d.category_id) catIds.push(d.category_id);
    const categoryNames = [...new Set(catIds.map((id) => catNames.get(id)).filter(Boolean))];
    const imageId = (d.image_ids || [])[0];
    out.push({
      id: item.id,
      name: d.name || 'Item',
      image: imageId ? images.get(imageId) || null : null,
      category: categoryNames[0] || '',
      categories: categoryNames,
    });
  }
  out.sort((a, b) => (a.category || '').localeCompare(b.category || '') || a.name.localeCompare(b.name));
  return out;
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

// Full configuration of ONE Square item (variations + modifier groups with
// prices) for the admin Product builder. Uses Square's retrieve-object with
// related objects so it works for any item, even one not loaded in the app.
async function getItemConfig(itemId) {
  if (!itemId) return null;
  const data = await squareFetch(`/v2/catalog/object/${encodeURIComponent(itemId)}?include_related_objects=true`);
  const obj = data.object;
  if (!obj || obj.type !== 'ITEM') return null;
  const d = obj.item_data || {};
  const modLists = new Map();
  const imgs = new Map();
  for (const r of data.related_objects || []) {
    if (r.type === 'MODIFIER_LIST') modLists.set(r.id, r);
    else if (r.type === 'IMAGE') imgs.set(r.id, r.image_data?.url || null);
  }
  const variations = (d.variations || [])
    .filter((v) => !v.is_deleted)
    .map((v) => ({
      id: v.id,
      name: v.item_variation_data?.name || '',
      price: moneyToNumber(v.item_variation_data?.price_money),
      soldOut: variationSoldOut(v),
    }))
    .filter((v) => v.price !== null);
  const modifierGroups = [];
  for (const ref of d.modifier_list_info || []) {
    if (ref.enabled === false) continue;
    const list = modLists.get(ref.modifier_list_id);
    if (!list) continue;
    const ld = list.modifier_list_data || {};
    const mods = (ld.modifiers || [])
      .filter((m) => !m.is_deleted)
      .map((m) => ({ id: m.id, name: m.modifier_data?.name || '', price: moneyToNumber(m.modifier_data?.price_money) || 0 }));
    if (!mods.length) continue;
    modifierGroups.push({
      id: list.id,
      name: ld.name || 'Options',
      selectionType: (ld.selection_type || 'MULTIPLE').toUpperCase(),
      min: typeof ref.min_selected_modifiers === 'number' ? ref.min_selected_modifiers : 0,
      max: typeof ref.max_selected_modifiers === 'number' ? ref.max_selected_modifiers : -1,
      modifiers: mods,
    });
  }
  const imageId = (d.image_ids || [])[0];
  return { id: obj.id, name: d.name || 'Item', image: imageId ? imgs.get(imageId) || null : null, variations, modifierGroups };
}

module.exports = { getMenu, getFullMenu, getAllCategories, getAllProducts, getItemConfig, cleanName };
