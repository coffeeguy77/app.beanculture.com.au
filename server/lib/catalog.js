// Menu builder v2.
// - Shows only the child categories of a master "APPs" category (configurable).
// - Strips the "APP" prefix from category names for display.
// - Honors Square availability: ecom_visibility + per-location sold_out.
// - Syncs live (short cache) so menu/stock changes in Square reflect fast.

const { squareFetch, LOCATION_ID, CURRENCY, moneyToNumber, idem } = require('./squareClient');
const { getSettings, isClosedDate } = require('./settings');

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

// ── Availability overlay ───────────────────────────────────────────────────
// Manual sold-out overrides, per-weekday exclusion lists, and time+day menu
// schedules — all evaluated in the venue's local time. Kept catalog-side so it
// applies to every consumer (storefront, SEO, sitemap) consistently.
const AV_TZ = process.env.PREORDER_TZ || process.env.SEASON_TZ || 'Australia/Sydney';
const DOW_KEYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']; // index = JS getUTCDay()

// Current date/time in the venue's timezone: { date:'YYYY-MM-DD', minutes, dow }.
function venueNow(tz = AV_TZ) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const g = (t) => parts.find((p) => p.type === t)?.value || '00';
  const date = `${g('year')}-${g('month')}-${g('day')}`;
  let hh = parseInt(g('hour'), 10); if (hh === 24) hh = 0; // some engines emit '24' at midnight
  const minutes = hh * 60 + parseInt(g('minute'), 10);
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0=Sun … 6=Sat for that calendar date
  return { date, minutes, dow };
}

function addDaysStr(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// The venue-local date on which we next open AFTER `fromDate` (a YYYY-MM-DD),
// honouring the admin's storeHours open days and any closures. Used to auto-clear
// a "sold out today" item the next time the venue trades.
function nextOpenDate(settings, fromDate) {
  const hours = (settings && settings.storeHours) || {};
  const closures = (settings && settings.closures) || [];
  for (let i = 1; i <= 14; i++) {
    const d = addDaysStr(fromDate, i);
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    const open = Array.isArray(hours[DOW_KEYS[dow]]) && hours[DOW_KEYS[dow]].length > 0;
    if (open && !isClosedDate(closures, d)) return d;
  }
  return addDaysStr(fromDate, 1); // fallback: tomorrow
}

function hhmmToMin(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  return m ? (+m[1]) * 60 + (+m[2]) : null;
}

// Is a menu schedule active right now? Ticked day-of-week AND now within its
// [start,end] window (supports windows that cross midnight).
function scheduleActiveNow(sch, now) {
  if (!sch || sch.enabled === false) return false;
  const days = Array.isArray(sch.days) ? sch.days.map(Number) : [];
  if (!days.includes(now.dow)) return false;
  const s = hhmmToMin(sch.start), e = hhmmToMin(sch.end);
  if (s === null || e === null) return false;
  return s <= e ? (now.minutes >= s && now.minutes < e) : (now.minutes >= s || now.minutes < e);
}

// Apply the availability overlay to the assembled sections (mutates item soldOut,
// drops categories that are outside their menu window). Returns the kept sections.
function applyAvailability(sections, settings, now = venueNow()) {
  const av = (settings && settings.availability) || {};
  const items = av.items || {};
  const excl = av.exclusions || {};
  const exclList = (excl.enabled !== false && excl.days)
    ? (excl.days[String(now.dow)] || excl.days[DOW_KEYS[now.dow]] || [])
    : [];
  const exclSet = new Set(Array.isArray(exclList) ? exclList : []);
  const schedules = Array.isArray(av.schedules) ? av.schedules.filter((s) => s && s.enabled !== false) : [];

  // Which category names are governed by a schedule, and which are active now.
  const scheduledCats = new Set();
  const activeCats = new Set();
  for (const sch of schedules) {
    const active = scheduleActiveNow(sch, now);
    for (const c of (Array.isArray(sch.categories) ? sch.categories : [])) {
      const key = String(c).toLowerCase();
      scheduledCats.add(key);
      if (active) activeCats.add(key);
    }
  }

  // Manual override effect for one item id: true=force sold out, false=force
  // available, null=no active override (expired overrides auto-clear).
  const overrideFor = (id) => {
    const o = items[id];
    if (!o || !o.mode) return null;
    if ((o.mode === 'today' || o.mode === 'on') && o.until && now.date >= o.until) return null;
    if (o.mode === 'off' || o.mode === 'today') return true;
    if (o.mode === 'on') return false;
    return null;
  };

  const kept = [];
  for (const sec of sections) {
    const catKey = String(sec.category).toLowerCase();
    // Menu schedule: a category that belongs to any schedule is shown ONLY while
    // one of its schedules is active. Categories in no schedule always show.
    if (scheduledCats.has(catKey) && !activeCats.has(catKey)) continue;

    for (const it of (sec.items || [])) {
      const forced = overrideFor(it.id);
      let sold = it.soldOut;
      if (forced === true) sold = true;
      else if (forced === false) sold = false;
      else if (exclSet.has(it.id)) sold = true;
      if (sold !== it.soldOut) {
        it.soldOut = sold;
        if (Array.isArray(it.variations)) it.variations = it.variations.map((v) => ({ ...v, soldOut: sold }));
      }
    }
    kept.push(sec);
  }
  return kept;
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
  // Whether to merge in custom product sections and product-builder presets.
  // This is a structural concern (does the section exist at all) separate from
  // applySelection (which items within a category are shown) — the admin's
  // "full menu" view (getFullMenu, applySelection:false) still needs these
  // sections to exist so category/item pickers have something to pick from.
  const includeSections = opts.includeSections !== false;
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
  // its whole category.
  if (includeSections) {
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
  // real Square variation + modifier ids.
  // Reusable "combo option" view per preset id, so a combo step built from a
  // Product Builder tile shows EXACTLY the same configured options / required
  // fields / price as that tile does on the menu (populated in the preset pass
  // below, consumed by the combo pass further down).
  const comboOptionByPresetId = new Map();
  // Same view keyed by the SOURCE item id, so a combo step that hand-picked a
  // raw Square item (legacy) still inherits that item's Product Builder tile
  // config automatically — the required fields / hidden options / defaults the
  // owner set on the tile flow through without re-picking. First tile wins.
  const comboOptionByItemId = new Map();
  if (includeSections) {
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
      // Groups the owner has explicitly marked "Required" in Product builder,
      // on top of whatever Square's own modifier-list minimum already says —
      // this is the one place that overrides Square's min for this preset only.
      const requiredGroupIds = new Set(Array.isArray(p.requiredGroups) ? p.requiredGroups : []);
      const groups = [];
      const lockedModifierIds = [];
      const lockedModifierNames = [];
      const lockedMods = []; // { id, name, price } — for the combo view
      const defaults = {};
      let lockedTotal = 0;
      for (const g of src.modifierGroups || []) {
        const cfg = groupCfg[g.id];
        if (!cfg) continue; // group not configured → hidden
        const offered = [];
        for (const m of g.modifiers) {
          const state = cfg[m.id]; // 'optional' | 'default' | 'locked' ; undefined → off
          if (!state) continue;
          if (state === 'locked') { lockedModifierIds.push(m.id); lockedModifierNames.push(m.name); lockedMods.push({ id: m.id, name: m.name, price: m.price || 0 }); lockedTotal += m.price || 0; continue; }
          offered.push(m);
          if (state === 'default') { (defaults[g.id] = defaults[g.id] || []).push(m.id); }
        }
        if (offered.length) {
          const min = requiredGroupIds.has(g.id) ? Math.max(g.min || 0, 1) : g.min;
          groups.push({ id: g.id, name: g.name, selectionType: g.selectionType, min, max: g.max, modifiers: offered });
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

      // Combo option view of this tile: same configured modifier groups + locked
      // add-ons + defaults, but with BASE variation prices (the combo bakes the
      // locked-mod price in itself via lockedMods, so it isn't double-counted).
      const comboView = {
        id: 'preset:' + p.id,
        name: tile.name,
        image: src.image || null,
        variations: chosenVars.map((v) => ({ id: v.id, name: v.name, price: v.price || 0, soldOut: !!v.soldOut })),
        modifierGroups: groups,
        lockedMods,
        defaults,
      };
      comboOptionByPresetId.set(p.id, comboView);
      if (!comboOptionByItemId.has(p.sourceItemId)) comboOptionByItemId.set(p.sourceItemId, comboView);
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
      const banner = nav.banner && nav.banner.on && (nav.banner.title || nav.banner.image)
        ? { title: nav.banner.title || '', image: nav.banner.image || null, itemId: nav.banner.itemId || null, hideText: nav.banner.hideText === true }
        : null;
      sections.push({ category: secName, items: tiles, showImages: nav.showImages !== false, custom: true, builder: true, topNav: nav.top === true, footerNav: nav.footer === true, banner });
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

  // Combo builder: bundles across DIFFERENT items (unlike a preset, which hot-
  // links ONE item) — e.g. "choose your burger" + "choose your side" + "choose
  // your drink". Renders as its own virtual tile; the discount itself is only
  // ever applied at order time (server/lib/combos.js, re-validated there from
  // scratch), never trusted from anything computed here. A combo with a group
  // that resolves to zero real items is skipped entirely rather than shown
  // broken (e.g. its category was renamed/deleted in Square).
  if (includeSections) {
    const combosBySection = new Map();
    for (const combo of getSettings().combos || []) {
      if (!combo || combo.active === false) continue;
      const name = String(combo.name || '').trim();
      if (!name) continue;

      const groups = [];
      let cheapestTotal = 0;
      let broken = false;
      for (const g of combo.groups || []) {
        if (!g || !g.id) { broken = true; break; }

        // Build the group's option pool. Preferred source is Product Builder
        // tiles (presetIds) — each shows exactly as it does on the menu. Legacy
        // combos that hand-picked raw Square items (itemIds) or a whole category
        // still resolve, as bare items.
        const baseOptions = [];
        for (const pid of Array.isArray(g.presetIds) ? g.presetIds : []) {
          const view = comboOptionByPresetId.get(pid);
          if (view && view.variations.some((v) => !v.soldOut)) baseOptions.push(view);
        }
        const rawIds = new Set();
        if (g.sourceType !== 'items' && g.categoryName) {
          const wanted = cleanName(String(g.categoryName)).toLowerCase();
          for (const [catId, c] of categories) {
            if (cleanName(c.name || '').toLowerCase() === wanted) {
              for (const { item } of byCatId.get(catId) || []) rawIds.add(item.id);
            }
          }
        }
        if (g.sourceType !== 'category') {
          for (const id of Array.isArray(g.itemIds) ? g.itemIds : []) rawIds.add(id);
        }
        for (const id of rawIds) {
          // Prefer the item's Product Builder tile view (inherits its options /
          // required fields / hidden add-ons); only fall back to the bare Square
          // item if the owner never built a tile for it.
          const tileView = comboOptionByItemId.get(id);
          if (tileView && tileView.variations.some((v) => !v.soldOut)) { baseOptions.push(tileView); continue; }
          const it = itemsById.get(id);
          if (it && it.variations.some((v) => !v.soldOut)) {
            baseOptions.push({ id: it.id, name: it.name, image: it.image, variations: it.variations, modifierGroups: it.modifierGroups, lockedMods: [], defaults: {} });
          }
        }
        if (!baseOptions.length) { broken = true; break; }

        // Per-combo override (scoped to THIS combo only): on top of whatever the
        // tile already shows, an add-on can be Locked in (always included +
        // hidden, priced in) or Hidden (never offered). Keyed by the option id
        // (a preset id, or a raw item id for legacy combos).
        const lockMap = g.itemLocks || {};
        const hideMap = g.itemHides || {};
        const showMap = g.itemShows || {};       // force "offered, NOT pre-selected"
        const defMap = g.itemDefaults || {};      // force "offered + pre-selected"
        const resolvedOptions = baseOptions.map((o) => {
          const lockSet = new Set(lockMap[o.id] || []);
          const hideSet = new Set(hideMap[o.id] || []);
          const showSet = new Set(showMap[o.id] || []);
          const defSet = new Set(defMap[o.id] || []);
          const lockedMods = [...(o.lockedMods || [])];
          // Clone the tile's defaults so a per-combo Show/Default override can flip
          // whether a customer-facing add-on starts pre-selected — without touching
          // the item's own menu listing.
          const defaults = {};
          for (const gid of Object.keys(o.defaults || {})) defaults[gid] = [...(o.defaults[gid] || [])];
          const dropDefault = (gid, mid) => { if (defaults[gid]) defaults[gid] = defaults[gid].filter((x) => x !== mid); };
          const addDefault = (gid, mid) => { defaults[gid] = defaults[gid] || []; if (!defaults[gid].includes(mid)) defaults[gid].push(mid); };
          let modifierGroups = o.modifierGroups || [];
          if (lockSet.size || hideSet.size || showSet.size || defSet.size) {
            modifierGroups = (o.modifierGroups || []).map((mg) => {
              const kept = [];
              for (const m of mg.modifiers || []) {
                if (lockSet.has(m.id)) { lockedMods.push({ id: m.id, name: m.name, price: m.price || 0 }); dropDefault(mg.id, m.id); continue; }
                if (hideSet.has(m.id)) { dropDefault(mg.id, m.id); continue; } // hidden — not offered
                kept.push(m);
                if (showSet.has(m.id)) dropDefault(mg.id, m.id);   // shown, not pre-selected
                if (defSet.has(m.id)) addDefault(mg.id, m.id);      // pre-selected
              }
              return { ...mg, modifiers: kept };
            }).filter((mg) => (mg.modifiers || []).length > 0);
          }
          const lockPrice = lockedMods.reduce((s, m) => s + (m.price || 0), 0);
          const cheapestVar = Math.min(...o.variations.filter((v) => !v.soldOut).map((v) => v.price));
          return { id: o.id, name: o.name, image: o.image, variations: o.variations, modifierGroups, lockedMods, defaults, _eff: cheapestVar + lockPrice };
        });

        // "From" price counts each group's cheapest option INCLUDING its locked-
        // in extras, so a combo that always adds $3 chips can't advertise a price
        // that's impossible to actually buy it at.
        const cheapest = Math.min(...resolvedOptions.map((o) => o._eff));
        cheapestTotal += cheapest;
        groups.push({
          id: g.id,
          label: String(g.label || '').trim() || 'Choose one',
          options: resolvedOptions.map(({ _eff, ...o }) => o),
        });
      }
      if (broken || !groups.length) continue;

      const discountCents = Math.max(0, Math.round((Number(combo.discountValue) || 0) * 100));
      const fromPrice = Math.max(0, cheapestTotal - discountCents);
      const tile = {
        // Two identical synthetic variations (not one) so the storefront's
        // generic "from $X" price-badge logic (which only shows "from" when an
        // item has >1 variation) kicks in without any change to MenuList.jsx —
        // a combo's real price always depends on which options are chosen.
        id: 'combo:' + combo.id,
        name,
        description: combo.description || '',
        image: combo.image || null,
        soldOut: false,
        variations: [
          { id: 'combo-price-a', name: '', price: fromPrice, soldOut: false },
          { id: 'combo-price-b', name: '', price: fromPrice, soldOut: false },
        ],
        modifierGroups: [],
        isCombo: true,
        comboId: combo.id,
        comboGroups: groups,
        comboDiscountValue: discountCents,
      };
      const secName = String(combo.section || '').trim() || 'Combos';
      if (!combosBySection.has(secName)) combosBySection.set(secName, []);
      combosBySection.get(secName).push(tile);
    }
    const comboNav = getSettings().presetSectionNav || {};
    for (const [secName, tiles] of combosBySection) {
      const existing = sections.find((s) => s.category.toLowerCase() === secName.toLowerCase());
      if (existing) { existing.items.push(...tiles); continue; }
      // Respect the Menu Builder Top-menu / Footer toggles for the combo section
      // (same as product sections). Only default to the top bar when the owner
      // hasn't configured it at all — so ticking Footer actually surfaces combos
      // in the footer menu instead of being ignored.
      const nav = comboNav[secName];
      const banner = nav && nav.banner && nav.banner.on && (nav.banner.title || nav.banner.image)
        ? { title: nav.banner.title || '', image: nav.banner.image || null, itemId: nav.banner.itemId || null, hideText: nav.banner.hideText === true }
        : null;
      sections.push({
        category: secName, items: tiles, showImages: nav ? nav.showImages !== false : true, custom: true,
        topNav: nav ? nav.top === true : true,
        footerNav: nav ? nav.footer === true : false,
        banner,
      });
    }
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

  // Availability overlay: kitchen sold-outs, day exclusions, and time+day menu
  // schedules — customer-facing only (the admin's full-menu view keeps every
  // category/item visible so the pickers work).
  if (applySelection) {
    sections = applyAvailability(sections, getSettings());
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

// ---- Reservation ticket printing: find or create a real catalog item ----
// Ad-hoc (non-catalog) line items have no print category, so Square's printer
// routing can silently skip them even though the order lands fine in the
// dashboard. These let the admin panel (Store → Reservations) link an
// existing item or create a new $0 one in a category that already prints
// reliably, instead of anyone having to do this by hand via the API.

// Square's printer/KDS "auto-print by category" routing keys off an item's
// reporting_category ONLY — an item can be tagged into several categories,
// but only ONE of those (reporting_category) is what any printer profile's
// "categories to print" list actually matches against. This one-click setup
// finds-or-creates a "Reservations" category, then finds-or-creates the
// Table Reservation item pointed at it — fixing reporting_category on an
// existing item if it's set to the wrong category (e.g. left over from an
// earlier test in a different category).
async function findOrCreateCategory(name) {
  const want = norm(name);
  const existing = (await getAllCategories()).find((c) => norm(c.name) === want);
  if (existing) return { id: existing.id, created: false };
  const body = {
    idempotency_key: idem(),
    object: { type: 'CATEGORY', id: '#reservationCategory', category_data: { name } },
  };
  const data = await squareFetch('/v2/catalog/object', { method: 'POST', body });
  return { id: data.catalog_object.id, created: true };
}

async function setupReservationPrinting({ categoryName = 'Reservations', itemName = 'Table Reservation' } = {}) {
  const cat = await findOrCreateCategory(categoryName);
  // Prefer an item we (or a previous setup) already created/linked with this
  // exact name, so re-running this doesn't spawn duplicate catalog items.
  const found = await searchItemsByName(itemName);
  const exact = found.find((it) => norm(it.name) === norm(itemName) && it.variations[0]?.id);
  let itemId, variationId, categoryFixed = false;
  if (exact) {
    itemId = exact.id;
    variationId = exact.variations[0].id;
    if (!exact.categoryIds.includes(cat.id)) {
      await setReportingCategory(itemId, cat.id);
      categoryFixed = true;
    } else {
      // Even if it's already tagged with the category, reporting_category
      // specifically might still be pointed elsewhere (the exact bug this
      // whole system exists to catch) — check and fix if needed.
      const info = await inspectItem(itemId);
      if (info.reportingCategory?.id !== cat.id) { await setReportingCategory(itemId, cat.id); categoryFixed = true; }
    }
  } else {
    const created = await createReservationCatalogItem({ name: itemName, categoryId: cat.id });
    itemId = created.itemId;
    variationId = created.variationId;
  }
  return { categoryId: cat.id, categoryCreated: cat.created, itemId, variationId, categoryFixed };
}

async function searchItemsByName(text) {
  const data = await squareFetch('/v2/catalog/search-catalog-items', {
    method: 'POST',
    body: { text_filter: String(text || ''), limit: 20 },
  });
  return (data.items || []).map((obj) => ({
    id: obj.id,
    name: obj.item_data?.name || 'Item',
    categoryIds: (obj.item_data?.categories || []).map((c) => c.id).filter(Boolean),
    variations: (obj.item_data?.variations || [])
      .filter((v) => !v.is_deleted)
      .map((v) => ({
        id: v.id,
        name: v.item_variation_data?.name || '',
        sellable: v.item_variation_data?.sellable !== false,
        price: v.item_variation_data?.price_money || null,
      })),
  }));
}

async function createReservationCatalogItem({ name, categoryId }) {
  const body = {
    idempotency_key: idem(),
    object: {
      type: 'ITEM',
      id: '#reservationItem',
      item_data: {
        name: (name || 'Table Reservation').trim().slice(0, 512),
        product_type: 'REGULAR',
        categories: categoryId ? [{ id: categoryId }] : [],
        reporting_category: categoryId ? { id: categoryId } : undefined,
        variations: [
          {
            type: 'ITEM_VARIATION',
            id: '#reservationVariation',
            item_variation_data: {
              item_id: '#reservationItem',
              name: 'Regular',
              pricing_type: 'FIXED_PRICING',
              price_money: { amount: 0, currency: CURRENCY },
              sellable: true,
              stockable: false,
            },
          },
        ],
      },
    },
  };
  const data = await squareFetch('/v2/catalog/object', { method: 'POST', body });
  const created = data.catalog_object;
  const variation = (created?.item_data?.variations || [])[0];
  if (!variation?.id) throw new Error('Square did not return a variation id');
  return { itemId: created.id, variationId: variation.id };
}

// Full diagnostic detail for one catalog item — used by the reservation
// print-troubleshooting panel to show exactly what Square has on file
// (reporting category vs. the full category list, and location presence),
// since printer/KDS auto-print routing in Square keys off reporting_category
// specifically, not just any category the item happens to also be tagged with.
async function inspectItem(itemId) {
  const data = await squareFetch(`/v2/catalog/object/${itemId}?include_related_objects=true`);
  const obj = data.object;
  if (!obj) throw new Error('Item not found');
  const d = obj.item_data || {};
  const related = new Map((data.related_objects || []).map((o) => [o.id, o]));
  const catName = (id) => related.get(id)?.category_data?.name || id;
  return {
    id: obj.id,
    name: d.name || '',
    reportingCategory: d.reporting_category ? { id: d.reporting_category.id, name: catName(d.reporting_category.id) } : null,
    categories: (d.categories || []).map((c) => ({ id: c.id, name: catName(c.id) })),
    presentAtAllLocations: obj.present_at_all_locations !== false,
    presentAtLocationIds: obj.present_at_location_ids || [],
    absentAtLocationIds: obj.absent_at_location_ids || [],
    ecomVisibility: (d.ecom_visibility || 'VISIBLE'),
    variations: (d.variations || []).filter((v) => !v.is_deleted).map((v) => ({
      id: v.id,
      name: v.item_variation_data?.name || '',
      sellable: v.item_variation_data?.sellable !== false,
      presentAtAllLocations: v.present_at_all_locations !== false,
      presentAtLocationIds: v.present_at_location_ids || [],
      absentAtLocationIds: v.absent_at_location_ids || [],
    })),
  };
}

// Set an item's reporting_category (the field Square's printer/KDS auto-print
// routing actually keys off) without disturbing anything else about it —
// used to fix items that got assigned a category via the dashboard's
// secondary "categories" list without ever becoming the reporting category.
async function setReportingCategory(itemId, categoryId) {
  const data = await squareFetch(`/v2/catalog/object/${itemId}`);
  const obj = data.object;
  if (!obj) throw new Error('Item not found');
  const d = obj.item_data || {};
  const categories = Array.isArray(d.categories) ? d.categories.slice() : [];
  if (!categories.some((c) => c.id === categoryId)) categories.push({ id: categoryId });
  const body = {
    idempotency_key: idem(),
    object: {
      ...obj,
      item_data: { ...d, categories, reporting_category: { id: categoryId } },
    },
  };
  const out = await squareFetch('/v2/catalog/object', { method: 'POST', body });
  return { id: out.catalog_object?.id };
}

module.exports = {
  getMenu, getFullMenu, getAllCategories, getAllProducts, getItemConfig, cleanName,
  searchItemsByName, createReservationCatalogItem, inspectItem, setReportingCategory,
  findOrCreateCategory, setupReservationPrinting, listAllCatalog,
  venueNow, nextOpenDate, applyAvailability, scheduleActiveNow,
};
