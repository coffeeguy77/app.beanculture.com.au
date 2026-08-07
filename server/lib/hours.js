// Store hours + open/closed status, sourced from the Square location's business
// hours (so it stays in sync). Supports a hard ordering kill-switch and pre-order
// mode (accept orders while closed, flagged as scheduled).

const { squareFetch, LOCATION_ID } = require('./squareClient');
const { getSettings, isClosedDate } = require('./settings');

const PREORDER_ENABLED = (process.env.PREORDER_ENABLED || 'false').toLowerCase() === 'true';
const ORDERING_DISABLED = (process.env.ORDERING_DISABLED || 'false').toLowerCase() === 'true';

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const DAY_INDEX = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };

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

function withRuntime(base) {
  const { dow, minutes } = localNow(base.timezone);
  const todayKey = DAYS[dow];
  const todays = base.weekly[todayKey] || [];

  // Weekdays (0=Sun) that have any business hours.
  const openDays = [];
  for (let i = 0; i < 7; i++) {
    if (!base.hasHours || (base.weekly[DAYS[i]] || []).some((w) => w.startMin != null)) openDays.push(i);
  }

  // Closure dates (annual leave, public holidays) from settings.
  let closures = [];
  try { closures = getSettings().closures || []; } catch {}
  const td = todayDate(base.timezone);
  const closedToday = isClosedDate(closures, td.full);

  let open = false;
  let closesAt = null;
  for (const w of todays) {
    if (w.startMin == null || w.endMin == null) continue;
    let end = w.endMin;
    if (end <= w.startMin) end += 24 * 60; // past midnight
    if (minutes >= w.startMin && minutes < end) {
      open = true;
      closesAt = w.end;
    }
  }
  // If no hours are configured in Square, treat as open.
  if (!base.hasHours) open = true;
  if (closedToday) open = false;

  const orderingDisabled = ORDERING_DISABLED;
  const canOrderNow = orderingDisabled ? false : open || PREORDER_ENABLED;
  const preorder = !open && PREORDER_ENABLED && !orderingDisabled;

  // Find the next opening time for a friendly message.
  let nextOpen = null;
  for (let i = 0; i < 8 && !open; i++) {
    const d = (dow + i) % 7;
    const list = base.weekly[DAYS[d]] || [];
    const upcoming = list
      .filter((w) => w.startMin != null && (i > 0 || w.startMin > minutes))
      .sort((a, b) => a.startMin - b.startMin)[0];
    if (upcoming) {
      nextOpen = { day: DAYS[d], time: upcoming.start };
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
    timezone: base.timezone,
    weekly: base.weekly,
    hasHours: base.hasHours,
    openDays,
    closedToday,
    closures,
  };
}

module.exports = { getStatus };
