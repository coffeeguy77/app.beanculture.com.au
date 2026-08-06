const path = require('path');
const express = require('express');
const square = require('./lib/square');

const app = express();
app.use(express.json({ limit: '256kb' }));

// Simple request logging (kept quiet in production if you prefer).
app.use((req, _res, next) => {
  if (req.path.startsWith('/api')) console.log(`${req.method} ${req.path}`);
  next();
});

// --- Public config for the browser (Web Payments SDK needs app id + location) ---
app.get('/api/config', (_req, res) => {
  res.json(square.publicConfig());
});

// --- Menu: live from Square Catalog, cached briefly to avoid hammering the API ---
let menuCache = { data: null, at: 0 };
const MENU_TTL_MS = Number(process.env.MENU_TTL_MS || 60_000);

app.get('/api/menu', async (_req, res) => {
  try {
    const now = Date.now();
    if (menuCache.data && now - menuCache.at < MENU_TTL_MS) {
      return res.json(menuCache.data);
    }
    const menu = await square.getMenu();
    menuCache = { data: menu, at: now };
    res.json(menu);
  } catch (err) {
    console.error('menu error', err.message);
    res.status(502).json({ error: 'Could not load menu', detail: err.message });
  }
});

// --- Create an order (dine-in/table or takeaway forced onto ticket_name + note) ---
app.post('/api/orders', async (req, res) => {
  try {
    const { cart, dineIn, table, name } = req.body || {};
    if (dineIn && !table) {
      return res.status(400).json({ error: 'Table number is required for dine-in orders' });
    }
    const order = await square.createOrder({ cart, dineIn: !!dineIn, table, name });
    res.json({
      orderId: order.id,
      totalMoney: order.total_money, // { amount, currency }
      ticketName: order.ticket_name,
    });
  } catch (err) {
    console.error('order error', err.message);
    res.status(400).json({ error: 'Could not create order', detail: err.message });
  }
});

// --- Take payment for an existing order ---
app.post('/api/pay', async (req, res) => {
  try {
    const { sourceId, orderId, totalMoney, verificationToken, buyerEmail } = req.body || {};
    if (!sourceId) return res.status(400).json({ error: 'Missing payment token' });
    if (!orderId) return res.status(400).json({ error: 'Missing order id' });
    if (!totalMoney || typeof totalMoney.amount !== 'number') {
      return res.status(400).json({ error: 'Missing order total' });
    }
    const payment = await square.createPayment({
      sourceId,
      orderId,
      amountMoney: totalMoney,
      verificationToken,
      buyerEmail,
    });
    res.json({
      status: payment.status,
      paymentId: payment.id,
      receiptUrl: payment.receipt_url,
    });
  } catch (err) {
    console.error('payment error', err.message);
    res.status(402).json({ error: 'Payment failed', detail: err.message });
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true, env: square.ENV }));

// --- Serve the built React client (single service, single domain) ---
const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Bean Culture ordering app listening on :${PORT} (Square env: ${square.ENV})`);
});
