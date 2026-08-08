// Store hours + open/closed status, sourced from the Square location's business
// hours (so it stays in sync). Supports a hard ordering kill-switch and pre-order
// mode (accept orders while closed, flagged as scheduled).

const { squareFetch, LOCATION_ID } = require('./squareClient');
const { getSettings, isClosedDate } = require('./settings');

const PREORDER_ENABLED = (process.env.PREORDER_ENABLED || 'false').toLowerCase() === 'true';
const ORDERING_DISABLED = (process.env.ORDERING_DISABLED || 'false').toLowerCase() === 'true';

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const DAY_INDEX = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
const FULL_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Turn an admin hours object ({ MON:[{open,close}], … }) into the internal weekly
// shape ({ MON:[{start,end,startMin,endMin}] }). Returns null if nothing usable.
function editableToWeekly(h) {
  if (!h || typeof h !== 'object' || !Object.keys(h).length) return null;
  const weekly = {};
  const hhmmss = (t) => (t && t.length === 5 ? `${t}:00` : t);
  for (const d of DAYS) {
    const arr = Array.isArray(h[d]) ? h[d] : [];
    weekly[d] = arr
      .filter((p) => p && p.open && p.close)
      .map((p) => ({ start: hhmmss(p.open), end: hhmmss(p.close), startMin: toMinutes(p.open), endMin: toMinutes(p.close) }));
  }
  return weekly;
}

// hh:mm[:ss] → "7am" / "1:30pm"
function fmt12(t) {
  if (!t) return '';
  const [h, m] = t.split(':');
  let hh = parseInt(h, 10);
  const ap = hh >= 12 ? 'pm' : 'am';
  hh = hh % 12; if (hh === 0) hh = 12;
  return (m && m !== '00') ? `${hh}:${m}${ap}` : `${hh}${ap}`;
}

function isOpenAt(weekly, dow, minutes) {
  const list = weekly[DAYS[dow]] || [];
  for (const w of list) {
    if (w.startMin == null || w.endMin == null) continue;
    let end = w.endMin; if (end <= w.startMin) end += 24 * 60; // past midnight
    if (minutes >= w.startMin && minutes < end) return w;
  }
  return null;
}

let cache = { data: null, at: 0 };

function toMinutes(hhmmss) {
  if (!hhmmss) return null;
  const [h, m] = hhmmss.split(':').map(Number);
  return h * 60 + m;
}

// Current day-of-week index (0=Sun) and minutes-since-midnight in a timezone.
function localNow(timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  const wdMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dow = wdMap[map.weekday] ?? 0;
  let hour = parseInt(map.hour, 10);
  if (hour === 24) hour = 0;
  const minutes = hour * 60 + parseInt(map.minute, 10);
  return { dow, minutes };
}

async function getStatus() {
  const now = Date.now();
  if (cache.data && now - cache.at < 60 * 1000) return withRuntime(cache.data);

  let location;
  try {
    const data = await squareFetch(`/v2/locations/${LOCATION_ID}`);
    location = data.location;
  } catch (e) {
    // If we can't read hours, assume open (don't block ordering on an API hiccup).
    const fallback = { timezone: 'Australia/Sydney', weekly: {}, hasHours: false };
    cache = { data: fallback, at: now };
    return withRuntime(fallback);
  }

  const timezone = location.timezone || 'Australia/Sydney';
  const periods = location.business_hours?.periods || [];
  const weekly = {};
  for (const d of DAYS) weekly[d] = [];
  for (const p of periods) {
    if (!weekly[p.day_of_week]) weekly[p.day_of_week] = [];
    weekly[p.day_of_week].push({
      start: p.start_local_time,
      end: p.end_local_time,
      startMin: toMinutes(p.start_local_time),
      endMin: toMinutes(p.end_local_time),
    });
  }
  const data = { timezone, weekly, hasHours: periods.length > 0 };
  cache = { data, at: now };
  return withRuntime(data);
}

// Today's date in a timezone as { full: 'YYYY-MM-DD', md: 'MM-DD' }.
function todayDate(timeZone) {
  const p = {};
  for (const part of new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())) p[part.type] = part.value;
  return { full: `${p.year}-${p.month}-${p.day}`, md: `${p.month}-${p.day}` };
}

// Add n days to a 'YYYY-MM-DD' string (UTC-safe for date-only math).
function addDays(fullDate, n) {
  const d = new Date(`${fullDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function withRuntime(base, nowOverride) {
  const s = (() => { try { return getSettings(); } catch { return {}; } })();

  // Store hours: admin-defined (override) when turned on, else Square's.
  const appWeekly = s.useAppHours ? editableToWeekly(s.storeHours) : null;
  const weekly = appWeekly || base.weekly;
  const hasHours = appWeekly ? true : base.hasHours;
  // Kitchen hours: its own schedule when enabled, else same as the store.
  const kitchenWeekly = s.kitchenHoursOn ? (editableToWeekly(s.kitchenHours) || weekly) : weekly;

  const { dow, minutes } = nowOverride || localNow(base.timezone);

  const openDays = [];
  for (let i = 0; i < 7; i++) {
    if (!hasHours || (weekly[DAYS[i]] || []).some((w) => w.startMin != null)) openDays.push(i);
  }

  let closures = [];
  try { closures = s.closures || []; } catch {}
  const td = nowOverride ? { full: nowOverride.todayFull, md: nowOverride.todayFull.slice(5) } : todayDate(base.timezone);
  const closedToday = isClosedDate(closures, td.full);

  const openPeriod = isOpenAt(weekly, dow, minutes);
  let open = !!openPeriod;
  let closesAt = openPeriod ? openPeriod.end : null;
  if (!hasHours) { open = true; closesAt = null; }
  if (closedToday) { open = false; closesAt = null; }

  // Kitchen status (only meaningful while the store is open).
  const kitchenPeriod = isOpenAt(kitchenWeekly, dow, minutes);
  let kitchenOpen = open && !!kitchenPeriod;
  if (open && !s.kitchenHoursOn) kitchenOpen = true; // kitchen follows the store
  let kitchenClosesInMin = null;
  if (kitchenOpen && kitchenPeriod && kitchenPeriod.endMin != null) {
    let end = kitchenPeriod.endMin; if (end <= kitchenPeriod.startMin) end += 24 * 60;
    kitchenClosesInMin = end - minutes;
  }

  const orderingDisabled = ORDERING_DISABLED;
  const canOrderNow = orderingDisabled ? false : open || PREORDER_ENABLED;
  const preorder = !open && PREORDER_ENABLED && !orderingDisabled;

  // Next opening time (skipping closure dates), with a friendly label.
  let nextOpen = null;
  for (let i = 0; i < 9 && !open; i++) {
    const d = (dow + i) % 7;
    const date = addDays(td.full, i);
    if (isClosedDate(closures, date)) continue;
    const upcoming = (weekly[DAYS[d]] || [])
      .filter((w) => w.startMin != null && (i > 0 || w.startMin > minutes))
      .sort((a, b) => a.startMin - b.startMin)[0];
    if (upcoming) {
      const rel = i === 0 ? 'today' : i === 1 ? 'tomorrow' : FULL_DAYS[d];
      nextOpen = { day: DAYS[d], time: upcoming.start, date, label: `${rel} at ${fmt12(upcoming.start)}` };
      break;
    }
  }

  return {
    open,
    canOrderNow,
    preorder,
    orderingDisabled,
    closesAt,
    nextOpen,
    kitchen: {
      open: kitchenOpen,
      closesInMin: kitchenClosesInMin,
      categories: Array.isArray(s.kitchenCategories) ? s.kitchenCategories : [],
      hasHours: !!s.kitchenHoursOn,
    },
    timezone: base.timezone,
    weekly,
    hasHours,
    openDays,
    closedToday,
    closures,
  };
}

module.exports = { getStatus, withRuntime, editableToWeekly, _fmt12: fmt12 };
