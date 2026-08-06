// Square REST API client for Bean Culture ordering app.
// Uses direct REST calls (Node 18+ global fetch) so we are not tied to a
// specific version of the Square SDK. All credentials come from env vars.

const ENV = (process.env.SQUARE_ENV || 'production').toLowerCase();
const BASE_URL =
  ENV === 'sandbox'
    ? 'https://connect.squareupsandbox.com'
    : 'https://connect.squareup.com';

// Square requires a version header. Bump this deliberately when you want new fields.
const SQUARE_VERSION = process.env.SQUARE_VERSION || '2025-04-16';

const ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN || '';
const LOCATION_ID = process.env.SQUARE_LOCATION_ID || '';
const APPLICATION_ID = process.env.SQUARE_APPLICATION_ID || '';
const CURRENCY = process.env.SQUARE_CURRENCY || 'AUD';

// How to fulfil a dine-in order. Default PICKUP (works on every account today).
// If you are accepted into Square's IN_STORE beta, set SQUARE_DINEIN_FULFILLMENT=IN_STORE.
const DINEIN_FULFILLMENT = (process.env.SQUARE_DINEIN_FULFILLMENT || 'PICKUP').toUpperCase();

// Curate which catalog categories appear in the app: a comma-separated list of
// category names, in the order you want them shown. Case-insensitive. Leave it
// unset to show every category. e.g. SQUARE_MENU_CATEGORIES="Coffee, Cold Drinks, Food"
const MENU_CATEGORIES = (process.env.SQUARE_MENU_CATEGORIES || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// If true, only show items marked "Visible" for online/e-commerce in Square
// (i.e. hide anything you've set to Hidden/Unavailable online). Default off.
const ONLY_ECOM_VISIBLE = (process.env.SQUARE_ONLY_VISIBLE || 'false').toLowerCase() === 'true';

function assertConfigured() {
  if (!ACCESS_TOKEN) throw new Error('SQUARE_ACCESS_TOKEN is not set');
  if (!LOCATION_ID) throw new Error('SQUARE_LOCATION_ID is not set');
}

async function squareFetch(path, { method = 'GET', body } = {}) {
  assertConfigured();
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Square-Version': SQUARE_VERSION,
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const detail =
      json && json.errors ? json.errors.map((e) => `${e.category}/${e.code}: ${e.detail}`).join('; ') : text;
    const err = new Error(`Square API ${res.status}: ${detail}`);
    err.status = res.status;
    err.squareErrors = json.errors;
    throw err;
  }
  return json;
}

// ---------------------------------------------------------------------------
// Public config for the browser (safe to expose): app id, location, environment.
// ---------------------------------------------------------------------------
function publicConfig() {
  return {
    applicationId: APPLICATION_ID,
    locationId: LOCATION_ID,
    environment: ENV, // 'production' | 'sandbox' — drives which Web Payments SDK to load
    currency: CURRENCY,
  };
}

// ---------------------------------------------------------------------------
// MENU — pull the live catalog and shape it for the storefront.
// ---------------------------------------------------------------------------
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

function moneyToNumber(m) {
  if (!m || typeof m.amount !== 'number') return null;
  return m.amount; // integer minor units (cents)
}

async function getMenu() {
  const objects = await listAllCatalog('ITEM,CATEGORY,MODIFIER_LIST,IMAGE');

  const categories = new Map();
  const images = new Map();
  const modifierLists = new Map();
  const items = [];

  for (const obj of objects) {
    if (obj.is_deleted) continue;
    switch (obj.type) {
      case 'CATEGORY':
        categories.set(obj.id, obj.category_data?.name || 'Menu');
        break;
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

  function resolveCategoryId(itemData) {
    // Prefer the assigned category (lowest ordinal), then reporting category,
    // then the legacy single category_id field.
    if (Array.isArray(itemData.categories) && itemData.categories.length) {
      const sorted = [...itemData.categories].sort((a, b) => (a.ordinal || 0) - (b.ordinal || 0));
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
        // selection_type: SINGLE or MULTIPLE
        selectionType: (ld.selection_type || 'MULTIPLE').toUpperCase(),
        min: typeof ref.min_selected_modifiers === 'number' ? ref.min_selected_modifiers : 0,
        max: typeof ref.max_selected_modifiers === 'number' ? ref.max_selected_modifiers : -1,
        modifiers: mods,
      });
    }
    return out;
  }

  const byCategory = new Map();

  for (const item of items) {
    const d = item.item_data || {};
    if (d.is_archived) continue;
    if (ONLY_ECOM_VISIBLE && d.ecom_visibility && d.ecom_visibility !== 'VISIBLE') continue;
    // Only show items available at this location (present_at_all_locations or explicit).
    const present =
      item.present_at_all_locations ||
      (item.present_at_location_ids || []).includes(LOCATION_ID);
    if (!present) continue;

    const catId = resolveCategoryId(d);
    const catName = (catId && categories.get(catId)) || 'Menu';
    const imageId = (d.image_ids || [])[0];
    const image = imageId ? images.get(imageId) : null;

    const variations = (d.variations || [])
      .filter((v) => !v.is_deleted)
      .map((v) => ({
        id: v.id,
        name: v.item_variation_data?.name || '',
        price: moneyToNumber(v.item_variation_data?.price_money),
      }))
      .filter((v) => v.price !== null); // skip variable-price variations we can't total client-side

    if (!variations.length) continue;

    const menuItem = {
      id: item.id,
      name: d.name || 'Item',
      description: d.description_plaintext || d.description || '',
      image,
      variations,
      modifierGroups: buildModifiers(d),
    };

    if (!byCategory.has(catName)) byCategory.set(catName, []);
    byCategory.get(catName).push(menuItem);
  }

  const allEntries = [...byCategory.entries()];

  // Diagnostic: prints to the Railway logs so you can see the real category
  // names Square is returning, which is what you put in SQUARE_MENU_CATEGORIES.
  console.log(
    `[menu] ${items.length} catalog items → ${allEntries.length} categor${
      allEntries.length === 1 ? 'y' : 'ies'
    }: ${allEntries.map(([n, i]) => `${n} (${i.length})`).join(' | ')}`
  );

  let entries = allEntries;
  if (MENU_CATEGORIES.length) {
    entries = MENU_CATEGORIES.map((wanted) =>
      allEntries.find(([name]) => name.toLowerCase() === wanted.toLowerCase())
    ).filter(Boolean);
    console.log(
      `[menu] SQUARE_MENU_CATEGORIES active → showing: ${
        entries.map(([n]) => n).join(', ') || '(no category names matched — check spelling)'
      }`
    );
  }

  const menu = entries.map(([name, catItems]) => ({ category: name, items: catItems }));

  return { currency: CURRENCY, categories: menu };
}

// ---------------------------------------------------------------------------
// ORDERS — the important bit. Force dine-in/table + takeaway onto fields that
// actually surface on the Square POS ticket and KDS, because the Orders API has
// no native dine-in / table-number field.
// ---------------------------------------------------------------------------
function buildTicketName({ dineIn, table, name }) {
  // ticket_name shows large on KDS/POS. Max 30 chars — keep it punchy.
  let t;
  if (dineIn) {
    t = table ? `T${table} DINE-IN` : 'DINE-IN';
  } else {
    t = 'TAKEAWAY';
    if (name) t += ` ${name}`;
  }
  return t.slice(0, 30);
}

function buildFulfillmentNote({ dineIn, table }) {
  return dineIn ? `DINE-IN · Table ${table || '?'}` : 'TAKEAWAY';
}

async function createOrder({ cart, dineIn, table, name }) {
  if (!Array.isArray(cart) || cart.length === 0) throw new Error('Cart is empty');

  const lineItems = cart.map((ci) => {
    const li = {
      catalog_object_id: ci.variationId,
      quantity: String(ci.quantity || 1),
    };
    if (Array.isArray(ci.modifierIds) && ci.modifierIds.length) {
      li.modifiers = ci.modifierIds.map((id) => ({ catalog_object_id: id }));
    }
    if (ci.note) li.note = String(ci.note).slice(0, 500);
    return li;
  });

  const displayName = name || (dineIn ? `Table ${table || ''}`.trim() : 'Takeaway');

  // Fulfillment: PICKUP is universally supported. If you get the IN_STORE beta,
  // set SQUARE_DINEIN_FULFILLMENT=IN_STORE and dine-in orders use it.
  let fulfillment;
  if (dineIn && DINEIN_FULFILLMENT === 'IN_STORE') {
    fulfillment = {
      type: 'IN_STORE',
      state: 'PROPOSED',
      // IN_STORE has no public details schema; table + dine-in ride on ticket_name/note.
    };
  } else {
    fulfillment = {
      type: 'PICKUP',
      state: 'PROPOSED',
      pickup_details: {
        recipient: { display_name: displayName },
        schedule_type: 'ASAP',
        note: buildFulfillmentNote({ dineIn, table }),
      },
    };
  }

  const orderBody = {
    order: {
      location_id: LOCATION_ID,
      ticket_name: buildTicketName({ dineIn, table, name }),
      line_items: lineItems,
      fulfillments: [fulfillment],
      // Order-level note as a second surface for the dine-in/table info.
      note: buildFulfillmentNote({ dineIn, table }),
      source: { name: 'Bean Culture App' },
    },
    idempotency_key: cryptoRandom(),
  };

  const data = await squareFetch('/v2/orders', { method: 'POST', body: orderBody });
  return data.order;
}

// ---------------------------------------------------------------------------
// PAYMENT — charge the order total (server-authoritative) via the token the
// Web Payments SDK produced in the browser.
// ---------------------------------------------------------------------------
async function createPayment({ sourceId, orderId, amountMoney, verificationToken, buyerEmail }) {
  const body = {
    source_id: sourceId,
    idempotency_key: cryptoRandom(),
    amount_money: amountMoney, // { amount, currency } — taken from the created order
    order_id: orderId,
    location_id: LOCATION_ID,
    autocomplete: true,
  };
  if (verificationToken) body.verification_token = verificationToken;
  if (buyerEmail) body.buyer_email_address = buyerEmail;

  const data = await squareFetch('/v2/payments', { method: 'POST', body });
  return data.payment;
}

// Small idempotency-key generator without extra deps.
function cryptoRandom() {
  return (
    Date.now().toString(36) +
    '-' +
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2)
  );
}

module.exports = {
  publicConfig,
  getMenu,
  createOrder,
  createPayment,
  CURRENCY,
  ENV,
};
