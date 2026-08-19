import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, formatMoney } from '../api.js';
import { track } from '../analytics.js';

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

function newIdempotencyKey() {
  try { return crypto.randomUUID(); } catch { return `pif-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
}

// ☕ Pay It Forward — buy a coffee for someone else. Reuses the exact card
// tokenization pattern already proven in GiftCards.jsx (Square Web Payments
// SDK), and the same sheet/segmented/field/chip CSS already in styles.css —
// this is a new flow, not a new visual language.
export default function PayItForward({ config, user, onClose, onSent }) {
  const [pifConfig, setPifConfig] = useState(null);
  const [step, setStep] = useState('amount'); // amount | recipient | pay | done
  const [amount, setAmount] = useState(0);
  const [customAmount, setCustomAmount] = useState(false);
  const [recipientName, setRecipientName] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [message, setMessage] = useState('');
  const [payMethod, setPayMethod] = useState('card'); // card | points
  const [loyalty, setLoyalty] = useState(null);
  const [rewardTierId, setRewardTierId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);
  const [ready, setReady] = useState(false);
  const paymentsRef = useRef(null);
  const cardRef = useRef(null);
  const cardElRef = useRef(null);
  const idemRef = useRef(newIdempotencyKey());
  const currency = config.currency || 'AUD';

  useEffect(() => {
    track('pay_it_forward_opened');
    api.pifConfig().then((c) => {
      setPifConfig(c);
      setAmount((c.suggestedValues && c.suggestedValues[0]) || 500);
    }).catch(() => setPifConfig({ enabled: false }));
  }, []);

  useEffect(() => {
    if (payMethod === 'points' && user?.phone && !loyalty) {
      api.getLoyalty(user.phone).then(setLoyalty).catch(() => setLoyalty({ active: false }));
    }
  }, [payMethod, user, loyalty]);

  const attachCard = useCallback(async () => {
    if (cardRef.current || !paymentsRef.current || !cardElRef.current) return;
    try {
      const card = await paymentsRef.current.card();
      if (!cardElRef.current) { try { card.destroy(); } catch {} return; }
      await card.attach(cardElRef.current);
      cardRef.current = card;
      setReady(true);
    } catch (e) { setError(e.message); }
  }, []);
  const setCardEl = useCallback((el) => {
    cardElRef.current = el;
    if (el) attachCard();
    else { try { cardRef.current?.destroy(); } catch {} cardRef.current = null; setReady(false); }
  }, [attachCard]);

  useEffect(() => {
    if (step !== 'pay' || payMethod !== 'card') return;
    let cancelled = false;
    (async () => {
      try {
        const Square = await loadSquareSdk(config.environment);
        if (cancelled) return;
        if (!config.applicationId || !config.locationId) throw new Error('Payments not configured.');
        paymentsRef.current = Square.payments(config.applicationId, config.locationId);
        if (!cancelled) attachCard();
      } catch (e) { if (!cancelled) setError(e.message); }
    })();
    return () => { cancelled = true; try { cardRef.current?.destroy(); } catch {} cardRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, payMethod]);

  async function tokenize() {
    const r = await cardRef.current.tokenize();
    if (r.status !== 'OK') throw new Error('Please check your card details.');
    let vToken;
    try {
      const v = await paymentsRef.current.verifyBuyer(r.token, { intent: 'CHARGE', amount: (amount / 100).toFixed(2), currencyCode: currency, billingContact: { givenName: user?.name || 'Guest' } });
      vToken = v?.token;
    } catch {}
    return { token: r.token, vToken };
  }

  function validAmount() {
    if (!pifConfig) return false;
    return amount >= (pifConfig.minValueCents || 100) && amount <= (pifConfig.maxValueCents || 100000);
  }
  function validRecipient() {
    return recipientName.trim().length > 0 && recipientPhone.replace(/\D/g, '').length >= 8;
  }

  async function doBuyCard() {
    setBusy(true); setError(''); track('gift_payment_started', { ref: 'card', amount });
    try {
      const { token, vToken } = await tokenize();
      const g = await api.pifBuyWithCard({
        sourceId: token, verificationToken: vToken, valueCents: amount,
        purchaserCustomerId: user?.customerId, purchaserName: user?.name, purchaserPhone: user?.phone, purchaserNotify: true,
        recipientName, recipientPhone, recipientEmail, message, idempotencyKey: idemRef.current,
      });
      setResult(g);
      setStep('done');
      track('gift_payment_completed', { ref: 'card', amount });
      track('gift_created', { amount });
      onSent && onSent(g);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function doBuyPoints() {
    if (!loyalty?.accountId || !rewardTierId) { setError('Choose a reward.'); return; }
    setBusy(true); setError(''); track('gift_payment_started', { ref: 'points', amount });
    try {
      const g = await api.pifBuyWithPoints({
        rewardTierId, loyaltyAccountId: loyalty.accountId,
        purchaserCustomerId: user?.customerId, purchaserName: user?.name, purchaserPhone: user?.phone, purchaserNotify: true,
        recipientName, recipientPhone, recipientEmail, message, idempotencyKey: idemRef.current,
      });
      setResult(g);
      setStep('done');
      track('gift_payment_completed', { ref: 'points', amount });
      track('gift_created', { amount });
      onSent && onSent(g);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  if (!pifConfig) {
    return (
      <div className="backdrop" onClick={onClose}>
        <div className="sheet pif-sheet" onClick={(e) => e.stopPropagation()}>
          <button className="sheet-close" onClick={onClose} aria-label="Close">✕</button>
          <div className="sheet-body"><p className="muted">Loading…</p></div>
        </div>
      </div>
    );
  }
  if (!pifConfig.enabled) {
    return (
      <div className="backdrop" onClick={onClose}>
        <div className="sheet pif-sheet" onClick={(e) => e.stopPropagation()}>
          <button className="sheet-close" onClick={onClose} aria-label="Close">✕</button>
          <div className="sheet-body"><p className="muted">Pay It Forward isn't available right now — check back soon!</p></div>
        </div>
      </div>
    );
  }

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="sheet pif-sheet" onClick={(e) => e.stopPropagation()}>
        <button className="sheet-close" onClick={onClose} aria-label="Close">✕</button>
        <div className="sheet-body">
          {step === 'done' && result ? (
            <div className="gc-result pif-result">
              <div className="tick" style={{ width: 54, height: 54, fontSize: 28 }}>☕</div>
              <h3 className="serif" style={{ margin: '10px 0 4px' }}>Coffee sent!</h3>
              <p className="muted" style={{ fontSize: 13 }}>You've just made {recipientName || 'their'} day a little better. We've texted them the link.</p>
              <div className="gc-code">{result.code}</div>
              <button className="btn full" onClick={() => { navigator.clipboard?.writeText(result.claimUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>{copied ? 'Copied!' : 'Copy claim link'}</button>
              <button className="btn ghost full" style={{ marginTop: 8 }} onClick={onClose}>Done</button>
            </div>
          ) : (
            <>
              <h2 className="pif-hero-title">Buy Someone a Coffee ☕</h2>
              <p className="muted" style={{ fontSize: 13, marginTop: -6 }}>A small coffee can make someone's day.</p>

              {step === 'amount' && (
                <>
                  <div className="gc-amounts">
                    {(pifConfig.suggestedValues || []).map((a) => (
                      <button key={a} type="button" className={`chip ${!customAmount && amount === a ? 'on' : ''}`} onClick={() => { setAmount(a); setCustomAmount(false); }}>{formatMoney(a, currency)}</button>
                    ))}
                    {pifConfig.allowCustomAmount && (
                      <button type="button" className={`chip ${customAmount ? 'on' : ''}`} onClick={() => setCustomAmount(true)}>Choose amount</button>
                    )}
                  </div>
                  {customAmount && (
                    <label className="field" style={{ marginTop: 8 }}><span>Amount</span>
                      <input inputMode="numeric" value={(amount / 100).toString()} onChange={(e) => setAmount(Math.round((parseFloat(e.target.value) || 0) * 100))} /></label>
                  )}
                  {!validAmount() && <p className="muted" style={{ fontSize: 12 }}>Between {formatMoney(pifConfig.minValueCents, currency)} and {formatMoney(pifConfig.maxValueCents, currency)}.</p>}
                  <button className="btn full" style={{ marginTop: 12 }} disabled={!validAmount()} onClick={() => { track('pay_it_forward_started', { amount }); setStep('recipient'); }}>Continue</button>
                </>
              )}

              {step === 'recipient' && (
                <>
                  <label className="field"><span>Recipient's first name</span><input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder="Sarah" /></label>
                  <label className="field"><span>Their mobile number</span><input inputMode="tel" value={recipientPhone} onChange={(e) => setRecipientPhone(e.target.value)} placeholder="04XX XXX XXX" /></label>
                  <label className="field"><span>Email (optional)</span><input inputMode="email" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} placeholder="" /></label>
                  <label className="field"><span>A little message (optional)</span>
                    <textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value.slice(0, 250))} placeholder="Thanks for helping me out today — coffee's on me! ☕" />
                  </label>
                  {(pifConfig.messageTemplates || []).length > 0 && (
                    <div className="gc-amounts" style={{ marginTop: 6 }}>
                      {pifConfig.messageTemplates.map((t) => (
                        <button key={t} type="button" className="chip" onClick={() => setMessage(t)}>{t.length > 24 ? t.slice(0, 24) + '…' : t}</button>
                      ))}
                    </div>
                  )}
                  {error && <p className="error-text">{error}</p>}
                  <div className="pif-nav-row">
                    <button className="btn ghost" onClick={() => setStep('amount')}>← Back</button>
                    <button className="btn" disabled={!validRecipient()} onClick={() => { setError(''); track('gift_recipient_entered'); setStep('pay'); }}>Continue</button>
                  </div>
                </>
              )}

              {step === 'pay' && (
                <>
                  <div className="pif-summary">{formatMoney(amount, currency)} coffee for {recipientName}</div>
                  {pifConfig.allowPointsPayment && (
                    <div className="segmented three" style={{ marginBottom: 10 }}>
                      <button type="button" className={payMethod === 'card' ? 'seg active' : 'seg'} onClick={() => setPayMethod('card')}>Pay by card</button>
                      <button type="button" className={payMethod === 'points' ? 'seg active' : 'seg'} onClick={() => setPayMethod('points')}>Use points</button>
                    </div>
                  )}
                  {payMethod === 'card' ? (
                    <>
                      <div id="pif-card" ref={setCardEl} className="card-box" />
                      {error && <p className="error-text">{error}</p>}
                      <button className="btn full" style={{ marginTop: 12 }} disabled={busy || !ready} onClick={doBuyCard}>
                        {busy ? 'Sending…' : `Pay ${formatMoney(amount, currency)} & send`}
                      </button>
                      <p className="secure-note">Payments processed securely by Square.</p>
                    </>
                  ) : (
                    <>
                      {!loyalty ? <p className="muted">Loading your points…</p> : !loyalty.active ? (
                        <p className="muted">Loyalty points aren't available right now.</p>
                      ) : (
                        <div className="gc-amounts">
                          {(loyalty.tiers || []).map((t) => (
                            <button key={t.id} type="button" className={`chip ${rewardTierId === t.id ? 'on' : ''} ${t.affordable ? '' : 'disabled'}`} disabled={!t.affordable} onClick={() => setRewardTierId(t.id)}>{t.name} · {t.points} pts</button>
                          ))}
                        </div>
                      )}
                      {error && <p className="error-text">{error}</p>}
                      <button className="btn full" style={{ marginTop: 12 }} disabled={busy || !rewardTierId} onClick={doBuyPoints}>
                        {busy ? 'Sending…' : 'Redeem points & send'}
                      </button>
                    </>
                  )}
                  <div className="pif-nav-row">
                    <button className="btn ghost" onClick={() => setStep('recipient')}>← Back</button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
