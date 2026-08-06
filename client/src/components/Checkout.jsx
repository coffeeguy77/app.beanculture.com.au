import React, { useEffect, useRef, useState } from 'react';
import { api, formatMoney } from '../api.js';

function loadSquareSdk(environment) {
  const src = environment === 'sandbox'
    ? 'https://sandbox.web.squarecdn.com/v1/square.js'
    : 'https://web.squarecdn.com/v1/square.js';
  return new Promise((resolve, reject) => {
    if (window.Square) return resolve(window.Square);
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) { existing.addEventListener('load', () => resolve(window.Square)); existing.addEventListener('error', reject); return; }
    const s = document.createElement('script');
    s.src = src; s.onload = () => resolve(window.Square); s.onerror = () => reject(new Error('Could not load payment SDK'));
    document.head.appendChild(s);
  });
}

export default function Checkout({ config, cart, currency, dineIn, setDineIn, table, setTable, name, setName, user, canOrder, onPaid, onBack }) {
  const [status, setStatus] = useState('init');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [coupon, setCoupon] = useState('');
  const [wallets, setWallets] = useState({ googlePay: false, applePay: false });
  const [loyalty, setLoyalty] = useState(null);
  const [tierId, setTierId] = useState(null);

  const paymentsRef = useRef(null);
  const cardRef = useRef(null);
  const gpRef = useRef(null);
  const apRef = useRef(null);

  const cartTotal = cart.reduce((n, c) => n + c.unitPrice * c.quantity, 0);
  const cartPayload = cart.map((c) => ({ variationId: c.variationId, quantity: c.quantity, modifierIds: c.modifierIds, note: c.note }));
  const hasCoupon = coupon.trim().length > 0;
  const usingReward = !!tierId;
  const hideWallets = hasCoupon || usingReward;

  // Loyalty for signed-in user
  useEffect(() => {
    if (user?.phone) {
      api.getLoyalty(user.phone).then((l) => { if (l && l.active) setLoyalty(l); }).catch(() => {});
    }
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const Square = await loadSquareSdk(config.environment);
        if (cancelled) return;
        if (!config.applicationId || !config.locationId) throw new Error('Payment not configured.');
        const payments = Square.payments(config.applicationId, config.locationId);
        paymentsRef.current = payments;
        const card = await payments.card();
        await card.attach('#card-container');
        cardRef.current = card;
        try {
          const req = payments.paymentRequest({ countryCode: 'AU', currencyCode: currency, total: { amount: (cartTotal / 100).toFixed(2), label: 'Total' } });
          try { const gp = await payments.googlePay(req); await gp.attach('#gp-btn'); gpRef.current = gp; if (!cancelled) setWallets((w) => ({ ...w, googlePay: true })); } catch {}
          try { const ap = await payments.applePay(req); apRef.current = ap; if (!cancelled) setWallets((w) => ({ ...w, applePay: true })); } catch {}
        } catch {}
        if (!cancelled) setStatus('ready');
      } catch (e) { if (!cancelled) { setError(e.message); setStatus('error'); } }
    }
    init();
    return () => { cancelled = true; try { cardRef.current?.destroy(); } catch {} };
  }, []);

  function validate() {
    if (!name.trim()) { setError('Please enter your name.'); return false; }
    if (dineIn && !table.trim()) { setError('Please enter your table number.'); return false; }
    if (!canOrder) { setError('Ordering is currently closed.'); return false; }
    return true;
  }

  async function createOrder() {
    return api.createOrder({
      cart: cartPayload, dineIn, table, name, coupon,
      customerId: user?.customerId,
      loyalty: tierId && loyalty?.accountId ? { accountId: loyalty.accountId, tierId } : undefined,
    });
  }

  async function payWithCard() {
    if (!validate()) return;
    setBusy(true); setError('');
    try {
      const order = await createOrder();
      if (!order.totalMoney || order.totalMoney.amount === 0) {
        await api.pay({ orderId: order.orderId, totalMoney: order.totalMoney });
        onPaid({ status: 'COMPLETED', comped: !usingReward, receiptUrl: null }, order);
        return;
      }
      const result = await cardRef.current.tokenize();
      if (result.status !== 'OK') throw new Error('Please check your card details.');
      let verificationToken;
      try {
        const v = await paymentsRef.current.verifyBuyer(result.token, {
          amount: (order.totalMoney.amount / 100).toFixed(2), currencyCode: order.totalMoney.currency,
          intent: 'CHARGE', billingContact: { givenName: name },
        });
        verificationToken = v?.token;
      } catch {}
      const pay = await api.pay({ sourceId: result.token, orderId: order.orderId, totalMoney: order.totalMoney, verificationToken, customerId: user?.customerId });
      if (pay.status === 'COMPLETED' || pay.status === 'APPROVED') onPaid(pay, order);
      else throw new Error(`Payment ${pay.status}`);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function payWithWallet(ref) {
    if (!validate()) return;
    setBusy(true); setError('');
    try {
      const result = await ref.current.tokenize();
      if (result.status !== 'OK') throw new Error('Payment not completed.');
      const order = await createOrder();
      const pay = await api.pay({ sourceId: result.token, orderId: order.orderId, totalMoney: order.totalMoney, customerId: user?.customerId });
      if (pay.status === 'COMPLETED' || pay.status === 'APPROVED') onPaid(pay, order);
      else throw new Error(`Payment ${pay.status}`);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <main className="page">
      <button className="link" onClick={onBack}>← Order</button>
      <h2>Checkout</h2>

      <div className="segmented" style={{ marginBottom: 12 }}>
        <button className={dineIn ? 'seg active' : 'seg'} onClick={() => setDineIn(true)} type="button">🍽️ Dine in</button>
        <button className={!dineIn ? 'seg active' : 'seg'} onClick={() => setDineIn(false)} type="button">🥡 Takeaway</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label className="field">
          <span className="req">Your name</span>
          <input placeholder="e.g. Shaun" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {dineIn && (
          <label className="field">
            <span className="req">Table number</span>
            <input inputMode="numeric" placeholder="e.g. 12" value={table} onChange={(e) => setTable(e.target.value)} />
          </label>
        )}
      </div>

      {loyalty?.active && loyalty.tiers?.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="group-title">Rewards · {loyalty.balance} {loyalty.terminology?.other || 'points'}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {loyalty.tiers.map((t) => (
              <button
                key={t.id} type="button"
                className={`reward ${tierId === t.id ? 'picked' : ''} ${!t.affordable ? 'locked' : ''}`}
                onClick={() => t.affordable && setTierId(tierId === t.id ? null : t.id)}
              >
                <span>{t.name}</span>
                <span className="pill">{t.points} pts</span>
              </button>
            ))}
          </div>
          {usingReward && <p className="muted" style={{ fontSize: 13 }}>Reward applied — your total updates at payment.</p>}
        </div>
      )}

      <label className="field" style={{ marginTop: 16 }}>
        <span>Promo code (optional)</span>
        <input value={coupon} onChange={(e) => setCoupon(e.target.value)} placeholder="Enter code" autoCapitalize="characters" />
      </label>

      <div className="totals">
        <div className="row grand"><span>Total</span><span>{formatMoney(cartTotal, currency)}</span></div>
        {(usingReward || hasCoupon) && <div className="row discount"><span>Discount applied at payment</span><span>—</span></div>}
      </div>

      {status === 'error' && <p className="error-text">{error}</p>}

      {status !== 'error' && (
        <>
          {!hideWallets && wallets.applePay && (
            <button className="wallet-btn apple" disabled={busy} onClick={() => payWithWallet(apRef)} type="button"> Pay</button>
          )}
          <div id="gp-btn" className="wallet-slot" style={{ display: !hideWallets && wallets.googlePay ? 'block' : 'none' }} onClick={() => !busy && payWithWallet(gpRef)} />
          {!hideWallets && (wallets.applePay || wallets.googlePay) && <div className="or">or pay by card</div>}

          <div id="card-container" className="card-box" style={{ display: hasCoupon ? 'none' : 'block' }} />
          {error && <p className="error-text">{error}</p>}
          <button className="btn full" style={{ marginTop: 10 }} disabled={busy || status !== 'ready'} onClick={payWithCard}>
            {busy ? 'Processing…' : hasCoupon ? 'Place order' : `Pay ${formatMoney(cartTotal, currency)}`}
          </button>
          <p className="secure-note">🔒 Payments processed securely by Square.</p>
        </>
      )}
    </main>
  );
}
