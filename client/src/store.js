// Local, on-device persistence: signed-in user + custom theme.
// (This is a real deployed web app, so localStorage is available and appropriate.)

const USER_KEY = 'bc_user';
const THEME_KEY = 'bc_theme';
const OPTOUT_KEY = 'bc_season_optout';

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
