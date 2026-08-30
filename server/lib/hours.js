// Store hours + open/closed status, sourced from the Square location's business
// hours (so it stays in sync). Supports a hard ordering kill-switch and pre-order
// mode (accept orders while closed, flagged as scheduled).

const { squareFetch, LOCATION_ID } = require('./squareClient');
const { getSettings, isClosedDate } = require('./settings');
// Lazy require to avoid any load-order surprises; locations only needs settings.
let _locations = null;
function locationsLib() { if (!_locations) { try { _locations = require('./locations'); } catch { _locations = null; } } return _locations; }

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

// Base Square-hours cache, keyed by Square location id (so each store's hours
// are fetched and cached independently).
const baseCache = new Map(); // sqLocationId -> { data, at }

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

// Read a Square location's business hours (cached 60s per location id).
async function baseFor(sqLocationId) {
  const id = sqLocationId || LOCATION_ID;
  const now = Date.now();
  const hit = baseCache.get(id);
  if (hit && now - hit.at < 60 * 1000) return hit.data;

  let location;
  try {
    const data = await squareFetch(`/v2/locations/${id}`);
    location = data.location;
  } catch (e) {
    // If we can't read hours, assume open (don't block ordering on an API hiccup).
    const fallback = { timezone: 'Australia/Sydney', weekly: {}, hasHours: false };
    baseCache.set(id, { data: fallback, at: now });
    return fallback;
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
  baseCache.set(id, { data, at: now });
  return data;
}

// Open/closed status for a store. Pass a location id to get THAT store's hours
// (its own Square hours + any per-store override); omit it for the default store.
async function getStatus(locId) {
  const loc = (() => { const L = locationsLib(); try { return L ? L.resolve(locId) : null; } catch { return null; } })();
  const base = await baseFor(loc ? loc.squareLocationId : LOCATION_ID);
  return withRuntime(base, undefined, loc);
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

// Whole-day difference b - a for 'YYYY-MM-DD' strings (UTC-safe).
function dayDiffLocal(aISO, bISO) {
  return Math.round((new Date(`${bISO}T00:00:00Z`).getTime() - new Date(`${aISO}T00:00:00Z`).getTime()) / 86400000);
}

// 'YYYY-MM-DD' → "Fri 12 Sep" (no year), for pop-up opening labels.
function dateLabel(fullDate) {
  const d = new Date(`${fullDate}T00:00:00Z`);
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  return `${wd} ${d.getUTCDate()} ${mon}`;
}

function withRuntime(base, nowOverride, loc) {
  const s = (() => { try { return getSettings(); } catch { return {}; } })();

  // Store hours precedence: this store's own per-store hours (if set) > the
  // global app-hours override (if enabled) > the store's Square business hours.
  const locWeekly = (loc && loc.hours) ? editableToWeekly(loc.hours) : null;
  const appWeekly = locWeekly || (s.useAppHours ? editableToWeekly(s.storeHours) : null);
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
  try { closures = (loc && Array.isArray(loc.closures)) ? loc.closures : (s.closures || []); } catch {}
  const td = nowOverride ? { full: nowOverride.todayFull, md: nowOverride.todayFull.slice(5) } : todayDate(base.timezone);
  const closedToday = isClosedDate(closures, td.full);

  // Pop-up not open yet: before its start date the store is closed regardless of
  // its weekly hours, ordering is off (no pre-order before opening), and the
  // "next open" is the opening date itself.
  let popupUpcoming = false;
  let popupStart = '';
  if (loc && loc.type === 'popup' && loc.startDate) {
    const L = locationsLib();
    try { if (L && L.popupState(loc, td.full) === 'upcoming') { popupUpcoming = true; popupStart = loc.startDate; } } catch {}
  }

  const openPeriod = isOpenAt(weekly, dow, minutes);
  let open = !!openPeriod;
  let closesAt = openPeriod ? openPeriod.end : null;
  if (!hasHours) { open = true; closesAt = null; }
  if (closedToday) { open = false; closesAt = null; }
  if (popupUpcoming) { open = false; closesAt = null; }

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
  // A pop-up that hasn't opened yet can never be ordered from (not even pre-order).
  let canOrderNow = (orderingDisabled || popupUpcoming) ? false : (open || PREORDER_ENABLED);
  let preorder = !open && PREORDER_ENABLED && !orderingDisabled && !popupUpcoming;

  // Next opening time (skipping closure dates), with a friendly label. For an
  // upcoming pop-up this is anchored to its start date, not the next weekly slot.
  let nextOpen = null;
  if (popupUpcoming) {
    for (let i = 0; i < 21; i++) {
      const date = addDays(popupStart, i);
      if (isClosedDate(closures, date)) continue;
      const d = new Date(`${date}T00:00:00Z`).getUTCDay();
      const upcoming = (weekly[DAYS[d]] || []).filter((w) => w.startMin != null).sort((a, b) => a.startMin - b.startMin)[0];
      if (upcoming) {
        const daysFromToday = dayDiffLocal(td.full, date);
        nextOpen = { day: DAYS[d], time: upcoming.start, date, label: `${dateLabel(date)} at ${fmt12(upcoming.start)}`, minsUntil: daysFromToday * 1440 + upcoming.startMin - minutes };
        break;
      }
    }
    if (!nextOpen) {
      // Pop-up with no weekly hours set — anchor to the start date itself.
      const daysFromToday = dayDiffLocal(td.full, popupStart);
      nextOpen = { day: null, time: null, date: popupStart, label: dateLabel(popupStart), minsUntil: daysFromToday * 1440 - minutes };
    }
  } else {
    for (let i = 0; i < 9 && !open; i++) {
      const d = (dow + i) % 7;
      const date = addDays(td.full, i);
      if (isClosedDate(closures, date)) continue;
      const upcoming = (weekly[DAYS[d]] || [])
        .filter((w) => w.startMin != null && (i > 0 || w.startMin > minutes))
        .sort((a, b) => a.startMin - b.startMin)[0];
      if (upcoming) {
        const rel = i === 0 ? 'today' : i === 1 ? 'tomorrow' : FULL_DAYS[d];
        nextOpen = { day: DAYS[d], time: upcoming.start, date, label: `${rel} at ${fmt12(upcoming.start)}`, minsUntil: i * 1440 + upcoming.startMin - minutes };
        break;
      }
    }
  }

  // Minutes since the store last closed (the most recent period end at or before
  // now), used to anchor the closed/pre-order progress bar to a REAL interval so
  // it survives page refresh. Scans backward over the weekly schedule (skipping
  // closure dates); all arithmetic is store-local minutes so it is tz-safe and
  // handles overnight/weekend/holiday gaps via the day offset. null if unknown.
  let closedSinceMin = null;
  if (!open && !popupUpcoming) {
    for (let i = 0; i < 9; i++) {
      const dd = ((dow - i) % 7 + 7) % 7;
      const date = addDays(td.full, -i);
      if (isClosedDate(closures, date)) continue;
      let bestEnd = null;
      for (const p of (weekly[DAYS[dd]] || [])) {
        if (p.endMin == null) continue;
        const endAbs = -i * 1440 + p.endMin; // minutes relative to today-00:00
        if (endAbs <= minutes && (bestEnd == null || endAbs > bestEnd)) bestEnd = endAbs;
      }
      if (bestEnd != null) { closedSinceMin = minutes - bestEnd; break; }
    }
  }

  return {
    open,
    canOrderNow,
    preorder,
    orderingDisabled,
    closesAt,
    nextOpen,
    closedSinceMin,
    // Set only for a pop-up that hasn't opened yet: drives the "Opening soon"
    // banner + countdown and suppresses ordering until the start date.
    opening: popupUpcoming ? {
      date: popupStart,
      dateLabel: dateLabel(popupStart),
      daysUntil: Math.max(0, dayDiffLocal(td.full, popupStart)),
      label: nextOpen ? nextOpen.label : dateLabel(popupStart),
    } : null,
    kitchen: {
      open: kitchenOpen,
      closesInMin: kitchenClosesInMin,
      categories: Array.isArray(s.kitchenCategories) ? s.kitchenCategories : [],
      hasHours: !!s.kitchenHoursOn,
      // Kitchen's own weekly schedule (only meaningfully different from `weekly`
      // above when hasHours is true) — the client needs this to work out
      // whether made-to-order categories will be available at a scheduled
      // ("Later") pickup time, not just right now.
      weekly: kitchenWeekly,
    },
    timezone: base.timezone,
    weekly,
    hasHours,
    openDays,
    closedToday,
    closures,
    // Which store this status is for, and — for a pop-up — its lifecycle so the
    // app can show a "Store Opening" teaser + countdown before it opens.
    location: loc ? {
      id: loc.id,
      name: loc.name,
      type: loc.type || 'physical',
      startDate: loc.startDate || '',
      endDate: loc.endDate || '',
      popupState: (() => { const L = locationsLib(); try { return L ? L.popupState(loc) : 'live'; } catch { return 'live'; } })(),
    } : null,
  };
}

module.exports = { getStatus, withRuntime, editableToWeekly, _fmt12: fmt12 };
