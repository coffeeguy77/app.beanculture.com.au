// Local, on-device persistence: signed-in user + custom theme.
// (This is a real deployed web app, so localStorage is available and appropriate.)

const USER_KEY = 'bc_user';
const THEME_KEY = 'bc_theme';
const OPTOUT_KEY = 'bc_season_optout';
// Storefront theme engine: one stable key holds the whole versioned blob
// ({ id, v, ts, explicit, tokens }) so the pre-paint inline script in index.html
// can read the saved tokens and re-skin :root before React boots (no flash).
const STORE_THEME_KEY = 'bean-culture-theme';
const EFFECT_KEY = 'bean-culture-effect';
const CART_KEY = 'bc_cart';
const CART_TTL = 12 * 60 * 60 * 1000; // keep a saved order for 12 hours

// Persist the in-progress order (cart + who/where) so a refresh never loses it.
export function getStoredOrder() {
  try {
    const raw = JSON.parse(localStorage.getItem(CART_KEY) || 'null');
    if (!raw || !Array.isArray(raw.cart) || raw.cart.length === 0) return null;
    if (raw.ts && Date.now() - raw.ts > CART_TTL) { localStorage.removeItem(CART_KEY); return null; }
    return raw;
  } catch {
    return null;
  }
}
export function setStoredOrder(data) {
  try {
    if (data && Array.isArray(data.cart) && data.cart.length) {
      localStorage.setItem(CART_KEY, JSON.stringify({ ...data, ts: Date.now() }));
    } else {
      localStorage.removeItem(CART_KEY);
    }
  } catch {}
}

export function getUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
  } catch {
    return null;
  }
}
export function setUser(u) {
  try {
    if (u) localStorage.setItem(USER_KEY, JSON.stringify(u));
    else localStorage.removeItem(USER_KEY);
  } catch {}
}

export function getSavedTheme() {
  try {
    return JSON.parse(localStorage.getItem(THEME_KEY) || 'null');
  } catch {
    return null;
  }
}
export function setSavedTheme(t) {
  try {
    if (t) localStorage.setItem(THEME_KEY, JSON.stringify(t));
    else localStorage.removeItem(THEME_KEY);
  } catch {}
}

// Storefront theme engine persistence (see STORE_THEME_KEY above). One versioned
// blob under one stable key — the source of truth for a permanent preset pick on
// reload, and what the index.html pre-paint script reads to avoid a theme flash.
export function getStoredThemeBlob() {
  try { return JSON.parse(localStorage.getItem(STORE_THEME_KEY) || 'null'); } catch { return null; }
}
export function saveStoredTheme(blob) {
  try { if (blob) localStorage.setItem(STORE_THEME_KEY, JSON.stringify(blob)); else localStorage.removeItem(STORE_THEME_KEY); } catch {}
}

// Favourite orders, namespaced by signed-in user id so different accounts on one
// device stay separate (fallback 'guest'). We only ever store line items — never
// a table number or fulfilment choice (those must be chosen fresh each order).
const FAV_KEY = (uid) => `bc_favs_${uid || 'guest'}`;
export function getFavorites(uid) {
  try { return JSON.parse(localStorage.getItem(FAV_KEY(uid)) || '[]'); } catch { return []; }
}
export function saveFavorites(uid, arr) {
  try { localStorage.setItem(FAV_KEY(uid), JSON.stringify(arr || [])); } catch {}
}

// Independent customer effect-overlay preference (Effects Engine). Kept in a
// key separate from the theme blob above since a palette and an overlay effect
// are chosen independently: { mode: 'theme-default' | 'none' | 'custom', effectId? }
export function getEffectPreference() {
  try {
    const v = JSON.parse(localStorage.getItem(EFFECT_KEY) || 'null');
    if (v && typeof v === 'object' && v.mode) return v;
    return { mode: 'theme-default' };
  } catch {
    return { mode: 'theme-default' };
  }
}
export function setEffectPreference(pref) {
  try {
    if (pref && pref.mode) localStorage.setItem(EFFECT_KEY, JSON.stringify(pref));
    else localStorage.removeItem(EFFECT_KEY);
  } catch {}
}

// Whether the customer has opted out of the auto seasonal theme.
export function getSeasonOptOut() {
  try {
    return localStorage.getItem(OPTOUT_KEY) === '1';
  } catch {
    return false;
  }
}
export function setSeasonOptOut(v) {
  try {
    if (v) localStorage.setItem(OPTOUT_KEY, '1');
    else localStorage.removeItem(OPTOUT_KEY);
  } catch {}
}

// A Pay It Forward gift the customer has claimed and is carrying into
// checkout. Only display info is cached here (token, code, cached value) --
// the server always re-validates the real balance at checkout time, this is
// never trusted as the source of truth.
const PIF_KEY = 'bc_pif_voucher';
export function getPifVoucher() {
  try {
    return JSON.parse(localStorage.getItem(PIF_KEY) || 'null');
  } catch {
    return null;
  }
}
export function setPifVoucher(v) {
  try {
    if (v) localStorage.setItem(PIF_KEY, JSON.stringify(v));
    else localStorage.removeItem(PIF_KEY);
  } catch {}
}
