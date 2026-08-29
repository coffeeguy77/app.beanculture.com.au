// WeatherService — the single source of normalized weather for the store.
//
// Provider: Open-Meteo (https://open-meteo.com) — free, no API key, reliable,
// returns current temperature + apparent temperature + a 2-day daily forecast +
// WMO weather codes. Being keyless it works the moment it deploys and never
// exposes a secret to the browser. It is deliberately isolated behind this
// module so the provider can be swapped later without touching campaign logic.
//
// Guarantees: server-side cached (never hammers the provider), stale-tolerant
// (serves a recent cached reading if a refresh fails), timeout-bounded, and it
// NEVER throws — a weather outage must never break ordering. In non-production a
// DEV_WEATHER_* override makes testing trivial (never via a query parameter).

const { getSettings } = require('./settings');

const PROVIDER = 'open-meteo';
const CACHE_MS = 15 * 60 * 1000;        // refresh at most every ~15 minutes
const STALE_MS = 2 * 60 * 60 * 1000;    // serve cached up to 2h old if a refresh fails
const TIMEOUT_MS = 6000;

let cache = null; // { data, at, lat, lng }
let inflight = null;

// WMO weather code → normalized condition (icon key) + human label.
function mapCondition(code) {
  const c = Number(code);
  if (c === 0) return { condition: 'sunny', label: 'Clear' };
  if (c === 1 || c === 2) return { condition: 'partly', label: 'Partly cloudy' };
  if (c === 3) return { condition: 'cloudy', label: 'Cloudy' };
  if (c === 45 || c === 48) return { condition: 'fog', label: 'Fog' };
  if (c >= 51 && c <= 57) return { condition: 'rain', label: 'Drizzle' };
  if (c >= 61 && c <= 67) return { condition: 'rain', label: 'Rain' };
  if (c >= 71 && c <= 77) return { condition: 'snow', label: 'Snow' };
  if (c >= 80 && c <= 82) return { condition: 'rain', label: 'Showers' };
  if (c >= 85 && c <= 86) return { condition: 'snow', label: 'Snow showers' };
  if (c >= 95) return { condition: 'storm', label: 'Thunderstorm' };
  return { condition: 'cloudy', label: '' };
}

function storeCoords() {
  const c = getSettings().contact || {};
  const lat = Number(c.lat), lng = Number(c.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) return { lat, lng };
  return null;
}

// Non-production temperature override (never honoured in production, never from a
// query param — env only). Lets us test campaigns without waiting on real weather.
function devOverride(data) {
  if (process.env.NODE_ENV === 'production') return data;
  const t = process.env.DEV_WEATHER_TEMP;
  const tm = process.env.DEV_WEATHER_TODAY_MAX;
  const tom = process.env.DEV_WEATHER_TOMORROW_MAX;
  if ((t == null || t === '') && (tm == null || tm === '') && (tom == null || tom === '')) return data;
  const base = (data && typeof data === 'object') ? { ...data } : { provider: PROVIDER };
  delete base.reason; // forcing ok:true — drop any stale unavailable reason
  const num = (v, fb) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : fb);
  const temp = num(t, base.current_temperature != null ? base.current_temperature : null);
  return {
    ...base,
    ok: true, stale: false, dev: true, provider: PROVIDER,
    current_temperature: temp,
    feels_like: base.feels_like != null ? base.feels_like : temp,
    today_max: num(tm, base.today_max != null ? base.today_max : null),
    tomorrow_max: num(tom, base.tomorrow_max != null ? base.tomorrow_max : null),
    condition: base.condition || 'sunny',
    condition_label: base.condition_label || 'Clear',
  };
}

const round = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);

async function fetchFromProvider(lat, lng) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}`
    + '&current=temperature_2m,apparent_temperature,weather_code,precipitation'
    + '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code'
    + '&timezone=auto&forecast_days=2';
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let json;
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    json = await res.json();
  } finally { clearTimeout(to); }

  const cur = json.current || {};
  const daily = json.daily || {};
  const tmax = daily.temperature_2m_max || [];
  const tmin = daily.temperature_2m_min || [];
  const prcp = daily.precipitation_probability_max || [];
  const cond = mapCondition(cur.weather_code);
  return {
    ok: true,
    stale: false,
    provider: PROVIDER,
    location_lat: lat,
    location_lng: lng,
    current_temperature: round(cur.temperature_2m),
    feels_like: round(cur.apparent_temperature),
    condition: cond.condition,
    condition_label: cond.label,
    weather_code: Number.isFinite(Number(cur.weather_code)) ? Number(cur.weather_code) : null,
    today_max: round(tmax[0]),
    today_min: round(tmin[0]),
    tomorrow_max: round(tmax[1]),
    tomorrow_min: round(tmin[1]),
    rain_probability_today: round(prcp[0]),
    rain_probability_tomorrow: round(prcp[1]),
    observed_at: new Date().toISOString(),
    forecast_updated_at: new Date().toISOString(),
  };
}

function withAge(c) {
  if (!c || !c.data) return null;
  return { ...c.data, age_seconds: Math.round((Date.now() - c.at) / 1000) };
}

// Normalized weather for the store — cached, stale-tolerant, never throws.
async function getWeather({ force = false } = {}) {
  const coords = storeCoords();
  if (!coords) return devOverride({ ok: false, reason: 'no-coordinates', provider: PROVIDER });

  const now = Date.now();
  const cacheValid = cache && cache.data && cache.data.ok && cache.lat === coords.lat && cache.lng === coords.lng;
  if (cacheValid && !force && (now - cache.at) < CACHE_MS) return devOverride(withAge(cache));

  // Single-flight: collapse concurrent refreshes into one provider call.
  if (!inflight) {
    inflight = (async () => {
      try {
        const data = await fetchFromProvider(coords.lat, coords.lng);
        cache = { data, at: Date.now(), lat: coords.lat, lng: coords.lng };
        return true;
      } catch (e) {
        console.warn('[weather] refresh failed:', e.message);
        return false;
      } finally { inflight = null; }
    })();
  }
  const okRefresh = await inflight;

  if (okRefresh) return devOverride(withAge(cache));
  // Refresh failed — serve a recent cached reading if we have one.
  if (cacheValid && (Date.now() - cache.at) < STALE_MS) return devOverride({ ...withAge(cache), stale: true });
  return devOverride({ ok: false, reason: 'unavailable', provider: PROVIDER });
}

// Instant, non-blocking read for hot paths like /api/config: returns whatever is
// cached (never fetches inline), and fires a background refresh if it's stale so
// the value is fresh on the next request. Keeps app load fast — weather never
// blocks it.
function peek() {
  const c = cache && cache.data ? withAge(cache) : { ok: false, provider: PROVIDER };
  return devOverride(c);
}
function kickoff() { getWeather().catch(() => {}); }

// A trimmed object safe to expose to the customer app (no internals).
function publicWeather(w) {
  if (!w || !w.ok) return null;
  return {
    temp: w.current_temperature,
    feelsLike: w.feels_like,
    condition: w.condition,
    conditionLabel: w.condition_label,
    stale: !!w.stale,
  };
}

function _resetCacheForTest() { cache = null; inflight = null; }

module.exports = { getWeather, peek, kickoff, publicWeather, mapCondition, storeCoords, PROVIDER, _resetCacheForTest };
