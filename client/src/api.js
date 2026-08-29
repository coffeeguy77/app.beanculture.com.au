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
  // Gift cards / prepaid balance
  giftBalance: (customerId) => req(`/api/giftcard/balance?customerId=${encodeURIComponent(customerId)}`),
  giftTopUp: (payload) => req('/api/giftcard/topup', { method: 'POST', body: JSON.stringify(payload) }),
  giftBuy: (payload) => req('/api/giftcard/buy', { method: 'POST', body: JSON.stringify(payload) }),
  giftRedeem: (customerId, gan) => req('/api/giftcard/redeem', { method: 'POST', body: JSON.stringify({ customerId, gan }) }),
  // Table reservations
  reserve: (payload) => req('/api/reserve', { method: 'POST', body: JSON.stringify(payload) }),
  adminReservations: (pass) => req(`/api/admin/reservations?pass=${encodeURIComponent(pass || '')}`),
  setReservationStatus: (pass, id, status) => req(`/api/admin/reservations/status?pass=${encodeURIComponent(pass || '')}`, { method: 'POST', body: JSON.stringify({ id, status }) }),
  deleteReservation: (pass, id) => req(`/api/admin/reservations/delete?pass=${encodeURIComponent(pass || '')}`, { method: 'POST', body: JSON.stringify({ id }) }),
  // Reservation ticket-printing setup (inspect / fix reporting category / one-click setup)
  reservationItemInspect: (pass, id) => req(`/api/admin/reservation-item/inspect?pass=${encodeURIComponent(pass || '')}&id=${encodeURIComponent(id || '')}`),
  reservationItemFixCategory: (pass, itemId, categoryId) => req(`/api/admin/reservation-item/fix-category?pass=${encodeURIComponent(pass || '')}`, { method: 'POST', body: JSON.stringify({ itemId, categoryId }) }),
  reservationItemSetup: (pass, body) => req(`/api/admin/reservation-item/setup?pass=${encodeURIComponent(pass || '')}`, { method: 'POST', body: JSON.stringify(body || {}) }),
  // Coupons (validate a code at checkout)
  getCoupon: (code) => req(`/api/coupon?code=${encodeURIComponent(code || '')}`),
  // Admin: customers enrolled via Square loyalty
  adminCustomers: (pass) => req(`/api/admin/customers?pass=${encodeURIComponent(pass || '')}`),
  // Admin: real sales + loyalty signups dashboard
  adminDashboard: (pass, days = 30) => req(`/api/admin/dashboard?days=${days}&pass=${encodeURIComponent(pass || '')}`),
  // Admin: broadcast (SMS/email) to loyalty members
  adminNotifyStatus: (pass) => req(`/api/admin/notify-status?pass=${encodeURIComponent(pass || '')}`),
  adminBroadcast: (pass, payload) => req(`/api/admin/broadcast?pass=${encodeURIComponent(pass || '')}`, { method: 'POST', body: JSON.stringify(payload) }),
  adminBroadcastTest: (pass, payload) => req(`/api/admin/broadcast/test?pass=${encodeURIComponent(pass || '')}`, { method: 'POST', body: JSON.stringify(payload) }),
  // Customer messages (enquiry / feedback / catering) + spam capture
  getCaptcha: () => req('/api/captcha'),
  sendMessage: (payload) => req('/api/message', { method: 'POST', body: JSON.stringify(payload) }),
  adminMessages: (pass) => req(`/api/admin/messages?pass=${encodeURIComponent(pass || '')}`),
  markMessage: (pass, id, handled) => req(`/api/admin/messages/handled?pass=${encodeURIComponent(pass || '')}`, { method: 'POST', body: JSON.stringify({ id, handled }) }),
  // Analytics
  track: (events) => req('/api/track', { method: 'POST', body: JSON.stringify({ events }) }),
  adminAnalytics: (pass, days = 30) => req(`/api/admin/analytics?days=${days}&pass=${encodeURIComponent(pass || '')}`),
  adminUpload: (pass, dataUri, folder) => req(`/api/admin/upload?pass=${encodeURIComponent(pass || '')}`, { method: 'POST', body: JSON.stringify({ dataUri, folder }) }),
  // Pay It Forward: gift-a-coffee
  pifConfig: () => req('/api/pay-it-forward/config'),
  pifStats: () => req('/api/pay-it-forward/stats'),
  pifBuyWithCard: (payload) => req('/api/pay-it-forward/purchase/card', { method: 'POST', body: JSON.stringify(payload) }),
  pifBuyWithPoints: (payload) => req('/api/pay-it-forward/purchase/points', { method: 'POST', body: JSON.stringify(payload) }),
  pifGetGift: (token) => req(`/api/gift/${encodeURIComponent(token)}`),
  pifClaimGift: (token, payload) => req(`/api/gift/${encodeURIComponent(token)}/claim`, { method: 'POST', body: JSON.stringify(payload) }),
  pifLookup: (code) => req('/api/gift/lookup', { method: 'POST', body: JSON.stringify({ code }) }),
  myGifts: (customerId, phone) => req(`/api/gifts?customerId=${encodeURIComponent(customerId || '')}&phone=${encodeURIComponent(phone || '')}`),
  adminPifEligibility: (pass) => req(`/api/admin/pay-it-forward/eligibility?pass=${encodeURIComponent(pass || '')}`),
  adminPifKpis: (pass, days = 90) => req(`/api/admin/pay-it-forward/kpis?days=${days}&pass=${encodeURIComponent(pass || '')}`),
  adminPifGifts: (pass, params = {}) => req(`/api/admin/pay-it-forward/gifts?${new URLSearchParams({ ...params, pass: pass || '' }).toString()}`),
  adminPifGiftDetail: (pass, id) => req(`/api/admin/pay-it-forward/gifts/${encodeURIComponent(id)}?pass=${encodeURIComponent(pass || '')}`),
  adminPifResendSms: (pass, id) => req(`/api/admin/pay-it-forward/gifts/${encodeURIComponent(id)}/resend-sms?pass=${encodeURIComponent(pass || '')}`, { method: 'POST' }),
  adminPifCancel: (pass, id) => req(`/api/admin/pay-it-forward/gifts/${encodeURIComponent(id)}/cancel?pass=${encodeURIComponent(pass || '')}`, { method: 'POST' }),
  adminPifRefund: (pass, id, status) => req(`/api/admin/pay-it-forward/gifts/${encodeURIComponent(id)}/refund?pass=${encodeURIComponent(pass || '')}`, { method: 'POST', body: JSON.stringify({ status }) }),
  // Kiosk POS
  posConfig: (pass) => req(`/api/pos/config?pass=${encodeURIComponent(pass || '')}`),
  posOrder: (pass, payload) => req(`/api/pos/order?pass=${encodeURIComponent(pass || '')}`, { method: 'POST', body: JSON.stringify(payload) }),
  posCheckoutStatus: (pass, id, orderId) => req(`/api/pos/checkout/${encodeURIComponent(id)}?pass=${encodeURIComponent(pass || '')}&orderId=${encodeURIComponent(orderId || '')}`),
  posCheckoutCancel: (pass, id, orderId) => req(`/api/pos/checkout/${encodeURIComponent(id)}/cancel?pass=${encodeURIComponent(pass || '')}`, { method: 'POST', body: JSON.stringify({ orderId }) }),
  posTerminalPair: (pass, name) => req(`/api/pos/terminal/pair?pass=${encodeURIComponent(pass || '')}`, { method: 'POST', body: JSON.stringify({ name }) }),
  posTerminalPairStatus: (pass, id) => req(`/api/pos/terminal/pair/${encodeURIComponent(id)}?pass=${encodeURIComponent(pass || '')}`),
  posTerminalDevices: (pass) => req(`/api/pos/terminal/devices?pass=${encodeURIComponent(pass || '')}`),
  posTerminalSelect: (pass, deviceId, name) => req(`/api/pos/terminal/select?pass=${encodeURIComponent(pass || '')}`, { method: 'POST', body: JSON.stringify({ deviceId, name }) }),
};

// Serve Cloudinary images auto-format (WebP/AVIF), auto-quality and sized to the
// display width instead of full resolution — big speedup for banners/photos.
// Non-Cloudinary URLs (e.g. Square catalog images) are returned unchanged.
export function imgUrl(url, width) {
  if (!url || typeof url !== 'string') return url;
  if (!url.includes('res.cloudinary.com') || !url.includes('/upload/')) return url;
  if (/\/upload\/[^/]*(f_auto|q_auto)/.test(url)) return url; // already transformed
  const t = `f_auto,q_auto${width ? `,w_${width},c_limit` : ''},dpr_auto`;
  return url.replace('/upload/', `/upload/${t}/`);
}

export function formatMoney(amount, currency = 'AUD') {
  if (amount == null) return '';
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(amount / 100);
}

// Total combo discount (cents) across the cart. Each combo instance's lines all
// carry the same per-unit comboDiscount, so we count it once per instance ×
// that instance's quantity. Used to make every displayed total match the
// authoritative server total (which already applies the discount).
export function comboDiscountFor(cart) {
  const seen = new Set();
  let d = 0;
  for (const c of cart || []) {
    if (c.comboInstanceId && c.comboDiscount && !seen.has(c.comboInstanceId)) {
      seen.add(c.comboInstanceId);
      d += c.comboDiscount * (c.quantity || 1);
    }
  }
  return d;
}
