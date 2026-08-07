import React, { useEffect, useRef, useState } from 'react';

// One-tap wallet buttons (Apple Pay, Google Pay) and optionally Afterpay, built
// on an already-initialised Square `payments` instance. The wallet objects are
// (re)created whenever the amount changes so the payment sheet always shows the
// right total. Each method is probed and simply hidden if it isn't available
// (Apple Pay only appears in Safari on a verified domain; Google Pay in
// supported browsers; Afterpay within its min/max).
//
// Props:
//   payments   – Square.payments(...) instance (or null until ready)
//   amount     – total in minor units (cents)
//   currency   – e.g. 'AUD'
//   country    – e.g. 'AU'
//   label      – line-item label shown in the wallet sheet
//   afterpay   – include Afterpay/Clearpay (checkout only; not for stored value)
//   canStart   – optional sync guard run before tokenizing; return false to abort
//   onToken    – async (token, method) => {} called with the payment token
//   onError    – (message) => {} for surfaced errors
export default function WalletButtons({ payments, amount, currency = 'AUD', country = 'AU', label = 'Total', afterpay = false, canStart, onToken, onError }) {
  const gpayRef = useRef(null);
  const applePayObj = useRef(null);
  const afterpayObj = useRef(null);
  const busyRef = useRef(false);
  const [avail, setAvail] = useState({ apple: false, google: false, afterpay: false });

  const emitError = (m) => { if (onError) onError(m); };

  async function handleToken(tokenResult, method) {
    if (!tokenResult) return;
    if (tokenResult.status !== 'OK') {
      if (tokenResult.status !== 'Cancel') emitError('Payment was not completed.');
      return;
    }
    if (busyRef.current) return;
    busyRef.current = true;
    try { await onToken(tokenResult.token, method); }
    catch (e) { emitError(e.message || 'Payment failed.'); }
    finally { busyRef.current = false; }
  }

  useEffect(() => {
    let cancelled = false;
    let gp, ap, afp;
    // Small debounce so typing a custom amount doesn't thrash the wallet objects.
    const timer = setTimeout(build, 350);

    async function build() {
      if (!payments || !amount || amount < 1) { if (!cancelled) setAvail({ apple: false, google: false, afterpay: false }); return; }
      const makeReq = () => payments.paymentRequest({
        countryCode: country,
        currencyCode: currency,
        total: { amount: (amount / 100).toFixed(2), label },
      });
      const next = { apple: false, google: false, afterpay: false };

      // Google Pay — Square renders its own button into our slot.
      try {
        gp = await payments.googlePay(makeReq());
        if (!cancelled && gpayRef.current) {
          gpayRef.current.innerHTML = '';
          await gp.attach(gpayRef.current, { buttonType: 'long', buttonSizeMode: 'fill' });
          gpayRef.current.onclick = async () => {
            if (busyRef.current) return;
            if (canStart && !canStart()) return;
            try { await handleToken(await gp.tokenize(), 'google_pay'); }
            catch (e) { emitError(e.message); }
          };
          next.google = true;
        }
      } catch { /* unavailable */ }

      // Apple Pay — we render our own button; tokenize must run synchronously in
      // the click handler, so it's called directly in onAppleClick (below).
      try {
        ap = await payments.applePay(makeReq());
        applePayObj.current = ap;
        next.apple = true;
      } catch { applePayObj.current = null; }

      // Afterpay / Clearpay — buy-now-pay-later (checkout only).
      if (afterpay) {
        try {
          afp = await payments.afterpayClearpay(makeReq());
          afterpayObj.current = afp;
          next.afterpay = true;
        } catch { afterpayObj.current = null; }
      }

      if (!cancelled) setAvail(next);
    }

    return () => {
      cancelled = true;
      clearTimeout(timer);
      try { gp?.destroy?.(); } catch {}
      try { ap?.destroy?.(); } catch {}
      try { afp?.destroy?.(); } catch {}
    };
  }, [payments, amount, currency, country, label, afterpay]);

  // Apple Pay: NO async work may run before tokenize() in the click handler.
  function onAppleClick() {
    if (busyRef.current) return;
    if (canStart && !canStart()) return;
    const ap = applePayObj.current;
    if (!ap) return;
    ap.tokenize().then((r) => handleToken(r, 'apple_pay')).catch((e) => emitError(e.message));
  }
  function onAfterpayClick() {
    if (busyRef.current) return;
    if (canStart && !canStart()) return;
    const afp = afterpayObj.current;
    if (!afp) return;
    afp.tokenize().then((r) => handleToken(r, 'afterpay')).catch((e) => emitError(e.message));
  }

  const any = avail.apple || avail.google || avail.afterpay;
  return (
    <div className="wallets" style={{ display: any ? 'flex' : 'none', flexDirection: 'column', gap: 8, marginTop: 8 }}>
      {avail.apple && (
        <button type="button" className="wallet-btn apple" onClick={onAppleClick} aria-label="Pay with Apple Pay"> Pay</button>
      )}
      <div ref={gpayRef} className="wallet-slot gpay-slot" style={{ display: avail.google ? 'block' : 'none' }} />
      {avail.afterpay && (
        <button type="button" className="wallet-btn afterpay" onClick={onAfterpayClick} aria-label="Pay with Afterpay">Pay with Afterpay</button>
      )}
      <div className="or">or pay by card</div>
    </div>
  );
}
