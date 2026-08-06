import React, { useEffect, useRef, useState } from 'react';
import { api, formatMoney } from '../api.js';

// Load the Web Payments SDK from the correct CDN for the environment.
function loadSquareSdk(environment) {
  const src =
    environment === 'sandbox'
      ? 'https://sandbox.web.squarecdn.com/v1/square.js'
      : 'https://web.squarecdn.com/v1/square.js';
  return new Promise((resolve, reject) => {
    if (window.Square) return resolve(window.Square);
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(window.Square));
      existing.addEventListener('error', reject);
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve(window.Square);
    s.onerror = () => reject(new Error('Could not load the payment SDK'));
    document.head.appendChild(s);
  });
}

export default function Checkout({ config, cart, currency, dineIn, table, name, onPaid, onBack }) {
  const [status, setStatus] = useState('init'); // init | ready | error
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [wallets, setWallets] = useState({ googlePay: false, applePay: false });

  const paymentsRef = useRef(null);
  const cardRef = useRef(null);
  const googlePayRef = useRef(null);
  const applePayRef = useRef(null);

  const cartTotal = cart.reduce((n, c) => n + c.unitPrice * c.quantity, 0);

  const cartPayload = cart.map((c) => ({
    variationId: c.variationId,
    quantity: c.quantity,
    modifierIds: c.modifierIds,
    note: c.note,
  }));

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const Square = await loadSquareSdk(config.environment);
        if (cancelled) return;
        if (!config.applicationId || !config.locationId) {
          throw new Error('Payment is not configured (missing Square application/location id).');
        }
        const payments = Square.payments(config.applicationId, config.locationId);
        paymentsRef.current = payments;

        // Card — always available.
        const card = await payments.card();
        await card.attach('#card-container');
        cardRef.current = card;

        // Digital wallets — best-effort. Apple Pay needs domain verification;
        // if anything fails we just don't show that button.
        try {
          const req = payments.paymentRequest({
            countryCode: 'AU',
            currencyCode: currency,
            total: { amount: (cartTotal / 100).toFixed(2), label: 'Total' },
          });
          try {
            const gp = await payments.googlePay(req);
            await gp.attach('#google-pay-button');
            googlePayRef.current = gp;
            if (!cancelled) setWallets((w) => ({ ...w, googlePay: true }));
          } catch (_) {
            /* Google Pay unavailable */
          }
          try {
            const ap = await payments.applePay(req);
            applePayRef.current = ap;
            if (!cancelled) setWallets((w) => ({ ...w, applePay: true }));
          } catch (_) {
            /* Apple Pay unavailable / domain not verified */
          }
        } catch (_) {
          /* payment request unsupported */
        }

        if (!cancelled) setStatus('ready');
      } catch (e) {
        if (!cancelled) {
          setError(e.message);
          setStatus('error');
        }
      }
    }

    init();
    return () => {
      cancelled = true;
      try {
        cardRef.current?.destroy();
      } catch (_) {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Create the order server-side (authoritative total), then charge the token.
  async function finishWithToken(token, verificationToken) {
    const order = await api.createOrder({ cart: cartPayload, dineIn, table, name });
    const pay = await api.pay({
      sourceId: token,
      orderId: order.orderId,
      totalMoney: order.totalMoney,
      verificationToken,
    });
    if (pay.status === 'COMPLETED' || pay.status === 'APPROVED') {
      onPaid(pay, order);
    } else {
      throw new Error(`Payment ${pay.status}`);
    }
  }

  async function payWithCard() {
    setBusy(true);
    setError('');
    try {
      const result = await cardRef.current.tokenize();
      if (result.status !== 'OK') {
        throw new Error('Please check your card details.');
      }
      // Create order first so we verify + charge the real total.
      const order = await api.createOrder({ cart: cartPayload, dineIn, table, name });
      let verificationToken;
      try {
        const v = await paymentsRef.current.verifyBuyer(result.token, {
          amount: (order.totalMoney.amount / 100).toFixed(2),
          currencyCode: order.totalMoney.currency,
          intent: 'CHARGE',
          billingContact: { givenName: name || (dineIn ? `Table ${table}` : 'Guest') },
        });
        verificationToken = v?.token;
      } catch (_) {
        /* 3DS/SCA not required or unsupported — proceed */
      }
      const pay = await api.pay({
        sourceId: result.token,
        orderId: order.orderId,
        totalMoney: order.totalMoney,
        verificationToken,
      });
      if (pay.status === 'COMPLETED' || pay.status === 'APPROVED') onPaid(pay, order);
      else throw new Error(`Payment ${pay.status}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function payWithWallet(ref) {
    setBusy(true);
    setError('');
    try {
      const result = await ref.current.tokenize();
      if (result.status !== 'OK') throw new Error('Payment was not completed.');
      await finishWithToken(result.token);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="checkout">
      <h2>Payment</h2>
      <div className="order-context">
        {dineIn ? `Dine in · Table ${table || '—'}` : 'Takeaway'} ·{' '}
        <strong>{formatMoney(cartTotal, currency)}</strong>
      </div>

      {status === 'error' && (
        <div className="card">
          <p className="error-text">{error}</p>
          <button className="btn ghost" onClick={onBack}>
            Back
          </button>
        </div>
      )}

      {status !== 'error' && (
        <>
          {wallets.applePay && (
            <button
              className="wallet-btn apple"
              disabled={busy}
              onClick={() => payWithWallet(applePayRef)}
              type="button"
            >
               Pay
            </button>
          )}
          <div id="google-pay-button" className="wallet-btn-slot" style={{ display: wallets.googlePay ? 'block' : 'none' }} onClick={() => !busy && payWithWallet(googlePayRef)} />

          {(wallets.applePay || wallets.googlePay) && <div className="or">or pay by card</div>}

          <div id="card-container" className="card-container" />

          {error && <p className="error-text">{error}</p>}

          <button className="btn full" disabled={busy || status !== 'ready'} onClick={payWithCard} type="button">
            {busy ? 'Processing…' : `Pay ${formatMoney(cartTotal, currency)}`}
          </button>
          <button className="link center-link" onClick={onBack} type="button" disabled={busy}>
            Back to order
          </button>

          <p className="secure-note">🔒 Payments processed securely by Square.</p>
        </>
      )}
    </main>
  );
}
