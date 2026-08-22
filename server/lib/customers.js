// Passwordless identity: look up or create a Square customer by phone number.
// No passwords are stored — the client keeps the returned customerId on-device.

const { squareFetch, idem } = require('./squareClient');

// Normalize an Australian-style phone number to E.164 (+61...).
function normalizePhone(input) {
  if (!input) return '';
  let s = String(input).replace(/[^\d+]/g, '');
  if (s.startsWith('+')) return s;
  if (s.startsWith('0')) return '+61' + s.slice(1);
  if (s.startsWith('61')) return '+' + s;
  if (s.length === 9) return '+61' + s; // e.g. 4XXXXXXXX
  return '+61' + s;
}

async function search(phoneE164) {
  const data = await squareFetch('/v2/customers/search', {
    method: 'POST',
    body: { query: { filter: { phone_number: { exact: phoneE164 } } }, limit: 1 },
  });
  return (data.customers || [])[0] || null;
}

async function findOrCreate({ phone, name }) {
  const e164 = normalizePhone(phone);
  if (!e164 || e164.length < 8) throw new Error('A valid phone number is required');

  let customer = await search(e164);
  if (!customer) {
    const data = await squareFetch('/v2/customers', {
      method: 'POST',
      body: {
        idempotency_key: idem(),
        given_name: (name || '').trim() || undefined,
        phone_number: e164,
      },
    });
    customer = data.customer;
  }
  return {
    customerId: customer.id,
    name: customer.given_name || name || '',
    phone: customer.phone_number || e164,
  };
}

// Retrieve a Square customer by id (best-effort) — used to resolve a signed-in
// customer's phone for loyalty lookups.
async function get(id) {
  if (!id) return null;
  try { const data = await squareFetch(`/v2/customers/${id}`); return data.customer || null; }
  catch { return null; }
}

module.exports = { findOrCreate, normalizePhone, get };
