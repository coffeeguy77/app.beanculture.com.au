async function req(path, options = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  getConfig: () => req('/api/config'),
  getMenu: () => req('/api/menu'),
  getHours: () => req('/api/hours'),
  auth: (phone, name) => req('/api/auth', { method: 'POST', body: JSON.stringify({ phone, name }) }),
  getLoyalty: (phone) => req(`/api/loyalty?phone=${encodeURIComponent(phone)}`),
  getHistory: (customerId) => req(`/api/history?customerId=${encodeURIComponent(customerId)}`),
  createOrder: (payload) => req('/api/orders', { method: 'POST', body: JSON.stringify(payload) }),
  pay: (payload) => req('/api/pay', { method: 'POST', body: JSON.stringify(payload) }),
  adminOverview: (pass) => req(`/api/admin/overview?pass=${encodeURIComponent(pass || '')}`),
  // Saved cards (card-on-file)
  getCards: (customerId) => req(`/api/cards?customerId=${encodeURIComponent(customerId)}`),
  saveCard: (payload) => req('/api/cards', { method: 'POST', body: JSON.stringify(payload) }),
  removeCard: (id) => req(`/api/cards/${encodeURIComponent(id)}/disable`, { method: 'POST' }),
  // Scheduled / recurring pre-orders
  getScheduled: (customerId) => req(`/api/scheduled?customerId=${encodeURIComponent(customerId)}`),
  schedule: (payload) => req('/api/scheduled', { method: 'POST', body: JSON.stringify(payload) }),
  cancelScheduled: (id, customerId) => req(`/api/scheduled/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: JSON.stringify({ customerId }) }),
};

export function formatMoney(amount, currency = 'AUD') {
  if (amount == null) return '';
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(amount / 100);
}
