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
      json && json.errors
        ? json.errors.map((e) => `${e.category}/${e.code}: ${e.detail}`).join('; ')
        : text;
    const err = new Error(`Square API ${res.status}: ${detail}`);
    err.status = res.status;
    err.squareErrors = json.errors;
    throw err;
  }
  return json;
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
