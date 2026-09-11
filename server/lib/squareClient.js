// Core Square REST client + shared config. Every other module imports from here.
// Direct REST (Node 18+ fetch) so we are not tied to a specific SDK version.

const ENV = (process.env.SQUARE_ENV || 'production').toLowerCase();
const BASE_URL =
  ENV === 'sandbox' ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com';

const SQUARE_VERSION = process.env.SQUARE_VERSION || '2025-04-16';
const ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN || '';
const LOCATION_ID = process.env.SQUARE_LOCATION_ID || '';
const APPLICATION_ID = process.env.SQUARE_APPLICATION_ID || '';
const CURRENCY = process.env.SQUARE_CURRENCY || 'AUD';

function assertConfigured() {
  if (!ACCESS_TOKEN) throw new Error('SQUARE_ACCESS_TOKEN is not set');
  if (!LOCATION_ID) throw new Error('SQUARE_LOCATION_ID is not set');
}

async function squareFetch(path, { method = 'GET', body } = {}) {
  assertConfigured();
  // Retry ONLY on 429 (rate limit): a rate-limited request was never processed,
  // so re-sending it is safe — and creates (orders/payments/refunds/checkouts)
  // carry their own idempotency_key, so even those never double up. Honour
  // Retry-After when Square sends it, else a short jittered backoff.
  const MAX_ATTEMPTS = 4;
  for (let attempt = 1; ; attempt++) {
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
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
    if (res.ok) return json;
    if (res.status === 429 && attempt < MAX_ATTEMPTS) {
      const ra = Number(res.headers.get('retry-after'));
      const wait = ra > 0 ? Math.min(ra * 1000, 8000) : Math.min(4000, 400 * Math.pow(2, attempt - 1)) + Math.floor(Math.random() * 250);
      console.warn(`[square] 429 rate-limited on ${method} ${path} — retry ${attempt}/${MAX_ATTEMPTS - 1} in ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    const detail =
      json && json.errors
        ? json.errors.map((e) => `${e.category}/${e.code}: ${e.detail}`).join('; ')
        : text;
    const err = new Error(`Square API ${res.status}: ${detail}`);
    err.status = res.status;
    err.squareErrors = json.errors;
    throw err;
  }
}

function moneyToNumber(m) {
  if (!m || typeof m.amount !== 'number') return null;
  return m.amount;
}

function idem() {
  return (
    Date.now().toString(36) +
    '-' +
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2)
  );
}

module.exports = {
  ENV,
  BASE_URL,
  ACCESS_TOKEN,
  LOCATION_ID,
  APPLICATION_ID,
  CURRENCY,
  squareFetch,
  moneyToNumber,
  idem,
};
