// Thin fetch wrapper for the backend API.

async function req(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || data.error || `Request failed (${res.status})`);
  }
  return data;
}

export const api = {
  getConfig: () => req('/api/config'),
  getMenu: () => req('/api/menu'),
  createOrder: (payload) =>
    req('/api/orders', { method: 'POST', body: JSON.stringify(payload) }),
  pay: (payload) => req('/api/pay', { method: 'POST', body: JSON.stringify(payload) }),
};

// Format integer minor units (cents) as a currency string.
export function formatMoney(amount, currency = 'AUD') {
  if (amount == null) return '';
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(amount / 100);
}
