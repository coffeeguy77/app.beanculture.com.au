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

// A single take-away loyalty cup — filled (earned) or empty. Matches the app's
// take-away cup points system (10 cups = one free coffee).
function TakeawayCup({ filled }) {
  return (
    <svg className={`pif-cup ${filled ? 'on' : ''}`} width="24" height="28" viewBox="0 0 24 24"
      fill="none" stroke={filled ? '#8a1f3d' : '#e3c3cd'} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6.5 9h11l-1 10.2a2 2 0 0 1-2 1.8H9.5a2 2 0 0 1-2-1.8L6.5 9z" fill={filled ? '#8a1f3d' : 'none'} />
      <rect x="5.5" y="6" width="13" height="3" rx="1.2" fill={filled ? '#a83154' : 'none'} />
      <path d="M10 3.2c0 1-1 1.2-1 2M14 3.2c0 1-1 1.2-1 2" />
    </svg>
  );
}

// The take-away cup points gauge: `total` cups, `filled` earned. Shows progress
// toward the next free coffee (10 cups = 1 free).
function CupGauge({ filled, total = 10 }) {
  return (
    <div className="pif-cupgauge" aria-hidden="true">
      {Array.from({ length: total }).map((_, i) => <TakeawayCup key={i} filled={i < filled} />)}
    </div>
  );
}

const IcoUser = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="3.6" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /></svg>;
const IcoPhone = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M6.5 4h3l1.5 4-2 1.5a12 12 0 0 0 5 5l1.5-2 4 1.5v3a2 2 0 0 1-2 2A16 16 0 0 1 4.5 6a2 2 0 0 1 2-2Z" /></svg>;
const IcoMail = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3.5" y="5.5" width="17" height="13" rx="2" /><path d="M4 7l8 6 8-6" /></svg>;
const IcoMsg = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5.5h16v10H8l-4 3.5z" /></svg>;
const IcoCard = () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="6" width="18" height="12" rx="2.5" /><path d="M3 10h18" /></svg>;
const IcoChevron = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>;

// Pay It Forward — buy a coffee for someone else. Reskinned premium flow; the
// payment + loyalty logic (Square Web Payments SDK card tokenisation, reward
// tiers) is unchanged from the proven original.
export default function PayItForward({ config, user, onClose, onSent }) {
  const [pifConfig, setPifConfig] = useState(null);
  const [step, setStep] = useState('amount'); // amount | recipient | method | card | points | done
  const [amount, setAmount] = useState(0);
  const [selectedLabel, setSelectedLabel] = useState('');
  const [customAmount, setCustomAmount] = useState(false);
  const [recipientName, setRecipientName] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [message, setMessage] = useState('');
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
      const first = (c.suggestedValues || [])[0];
      const firstVal = first && typeof first === 'object' ? (first.valueCents || first.value || 0) : Number(first) || 0;
      const firstLabel = first && typeof first === 'object' ? (first.label || '') : '';
      setAmount(firstVal || 500);
      setSelectedLabel(firstLabel);
    }).catch(() => setPifConfig({ enabled: false }));
  }, []);

  // Load the buyer's loyalty balance once we reach the payment choice.
  useEffect(() => {
    if ((step === 'method' || step === 'points') && user?.phone && !loyalty) {
      api.getLoyalty(user.phone).then(setLoyalty).catch(() => setLoyalty({ active: false }));
    }
  }, [step, user, loyalty]);

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
    if (step !== 'card') return;
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
  }, [step]);

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
  const giftLabel = `${selectedLabel || '1 Coffee'} (${formatMoney(amount, currency)} value)`;

  async function doBuyCard() {
    setBusy(true); setError(''); track('gift_payment_started', { ref: 'card', amount });
    try {
      const { token, vToken } = await tokenize();
      const g = await api.pifBuyWithCard({
        sourceId: token, verificationToken: vToken, valueCents: amount,
        purchaserCustomerId: user?.customerId, purchaserName: user?.name, purchaserPhone: user?.phone, purchaserNotify: true,
        recipientName, recipientPhone, recipientEmail, message, idempotencyKey: idemRef.current,
      });
      setResult(g); setStep('done');
      track('gift_payment_completed', { ref: 'card', amount }); track('gift_created', { amount });
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
      setResult(g); setStep('done');
      track('gift_payment_completed', { ref: 'points', amount }); track('gift_created', { amount });
      onSent && onSent(g);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  const wrap = (bodyClass, children) => (
    <div className="backdrop pif-backdrop" onClick={onClose}>
      <div className={`pif-card ${bodyClass}`} onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
  const closeBtn = <button className="pif-x" onClick={onClose} aria-label="Close">✕</button>;
  const backBtn = (to) => <button className="pif-back-round" onClick={() => { setError(''); setStep(to); }} aria-label="Back">←</button>;

  if (!pifConfig) return wrap('pif-light', <>{closeBtn}<div className="pif-pad"><p className="muted">Loading…</p></div></>);
  if (!pifConfig.enabled) return wrap('pif-light', <>{closeBtn}<div className="pif-pad"><p className="muted">Pay It Forward isn't available right now — check back soon!</p></div></>);

  const balance = loyalty?.active ? (loyalty.balance || 0) : 0;
  const cheapestTier = loyalty?.active ? (loyalty.tiers || []).slice().sort((a, b) => a.points - b.points)[0] : null;
  const goalPts = Math.max(1, cheapestTier?.points || 10);
  const filledCups = Math.max(0, Math.min(10, Math.round((balance / goalPts) * 10)));

  // ── Done ──────────────────────────────────────────────────────────────────
  if (step === 'done' && result) {
    return wrap('pif-dark pif-sent', <>
      {closeBtn}
      <div className="pif-pad pif-center">
        <img className="pif-hero-img pif-hero-sent" src="/pif/cup-gift.png" alt="" />
        <h2 className="pif-title-gold">Coffee sent!</h2>
        <p className="pif-sub-light">{recipientName || 'They'} will receive an SMS with your gift.</p>
        <div className="pif-voucher-card">
          <div className="pif-voucher-row">
            <span className="pif-voucher-ico"><img src="/pif/giftbox.png" alt="" width="26" /></span>
            <div><div className="pif-voucher-lead">You gifted {giftLabel}</div><div className="pif-voucher-to">to {recipientName || 'a friend'}</div></div>
          </div>
          <div className="pif-voucher-code-wrap">
            <div><div className="pif-voucher-label">Voucher code</div><div className="pif-voucher-code">{result.code}</div></div>
            <button className="pif-copy" onClick={() => { navigator.clipboard?.writeText(result.claimUrl || result.code); setCopied(true); setTimeout(() => setCopied(false), 1800); }}>{copied ? '✓' : '⧉'}</button>
          </div>
        </div>
        <button className="pif-btn pif-btn-gold" onClick={onClose}>Done →</button>
        <button className="pif-btn pif-btn-outline-light" onClick={onClose}>View my gifts</button>
        <p className="pif-thanks">Thanks for spreading kindness! ♥</p>
      </div>
    </>);
  }

  // ── Amount ────────────────────────────────────────────────────────────────
  if (step === 'amount') {
    return wrap('pif-light', <>
      {closeBtn}
      <div className="pif-pad pif-center">
        <img className="pif-badge" src="/pif/giftbox.png" alt="" />
        <h2 className="pif-title">Buy Someone a Coffee</h2>
        <p className="pif-sub">A small coffee can make someone's day.</p>
        <img className="pif-hero-img" src="/pif/cup-latte.png" alt="" />
        <div className="pif-qlabel">How many coffees?</div>
        <div className="pif-preset-grid">
          {(pifConfig.suggestedValues || []).map((p, i) => {
            const val = p && typeof p === 'object' ? Math.round(p.valueCents || p.value || 0) : Math.round(Number(p) || 0);
            const label = p && typeof p === 'object' ? String(p.label || '') : '';
            const on = !customAmount && amount === val;
            return (
              <button key={i} type="button" className={`pif-preset ${on ? 'on' : ''}`} onClick={() => { setAmount(val); setSelectedLabel(label); setCustomAmount(false); }}>
                <img className="pif-preset-cup" src="/pif/cup-takeaway.png" alt="" />
                <span className="pif-preset-name">{label || formatMoney(val, currency)}</span>
                {label && <span className="pif-preset-price">{formatMoney(val, currency)}</span>}
              </button>
            );
          })}
          {pifConfig.allowCustomAmount && (
            <button type="button" className={`pif-preset ${customAmount ? 'on' : ''}`} onClick={() => { setCustomAmount(true); setSelectedLabel(''); }}>
              <img className="pif-preset-cup" src="/pif/giftbox.png" alt="" />
              <span className="pif-preset-name">Custom amount</span>
            </button>
          )}
        </div>
        {customAmount && (
          <label className="pif-field"><span>Amount ($)</span>
            <input inputMode="decimal" value={(amount / 100).toString()} onChange={(e) => setAmount(Math.round((parseFloat(e.target.value) || 0) * 100))} /></label>
        )}
        {!validAmount() && <p className="pif-note">Between {formatMoney(pifConfig.minValueCents, currency)} and {formatMoney(pifConfig.maxValueCents, currency)}.</p>}
        <button className="pif-btn pif-btn-gold" disabled={!validAmount()} onClick={() => { track('pay_it_forward_started', { amount }); setStep('recipient'); }}>Continue →</button>
      </div>
    </>);
  }

  // ── Recipient ─────────────────────────────────────────────────────────────
  if (step === 'recipient') {
    return wrap('pif-light', <>
      {backBtn('amount')}{closeBtn}
      <div className="pif-pad">
        <img className="pif-hero-img pif-hero-sm" src="/pif/cup-gift.png" alt="" />
        <h2 className="pif-title pif-title-left">Who are you sending this coffee to?</h2>
        <label className="pif-field"><span>Recipient's first name</span>
          <div className="pif-input-ico"><IcoUser /><input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder="Sarah" /></div></label>
        <label className="pif-field"><span>Their mobile number</span>
          <div className="pif-input-ico"><IcoPhone /><input inputMode="tel" value={recipientPhone} onChange={(e) => setRecipientPhone(e.target.value)} placeholder="04XX XXX XXX" /></div></label>
        <label className="pif-field"><span>Email (optional)</span>
          <div className="pif-input-ico"><IcoMail /><input inputMode="email" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} placeholder="sarah@example.com" /></div></label>
        <label className="pif-field"><span>Personal message (optional)</span>
          <div className="pif-input-ico pif-input-area"><IcoMsg /><textarea rows={2} value={message} maxLength={160} onChange={(e) => setMessage(e.target.value.slice(0, 160))} placeholder="Thanks for helping me out today — coffee's on me!" /></div>
          <span className="pif-count">{message.length}/160</span>
        </label>
        {(pifConfig.messageTemplates || []).length > 0 && (
          <>
            <div className="pif-qlabel pif-qlabel-sm">Quick messages</div>
            <div className="pif-chip-row">
              {pifConfig.messageTemplates.map((t) => (
                <button key={t} type="button" className="pif-chip" onClick={() => setMessage(t)}>{t.length > 22 ? t.slice(0, 22) + '…' : t}</button>
              ))}
            </div>
          </>
        )}
        {error && <p className="pif-error">{error}</p>}
        <button className="pif-btn pif-btn-maroon" disabled={!validRecipient()} onClick={() => { setError(''); track('gift_recipient_entered'); setStep('method'); }}>Continue to payment →</button>
      </div>
    </>);
  }

  // ── Method choice ─────────────────────────────────────────────────────────
  if (step === 'method') {
    return wrap('pif-dark', <>
      {backBtn('recipient')}{closeBtn}
      <div className="pif-pad pif-center">
        <img className="pif-badge pif-badge-glow" src="/pif/giftbox.png" alt="" />
        <h2 className="pif-title-gold">Almost there!</h2>
        <p className="pif-sub-light">Choose how you'd like to pay.</p>
        <button className="pif-method" onClick={() => { setError(''); setStep('card'); }}>
          <span className="pif-method-ico"><IcoCard /></span>
          <span className="pif-method-body"><span className="pif-method-title">Pay with card</span><span className="pif-method-sub">Credit/debit card, Apple Pay or Google Pay</span></span>
          <span className="pif-method-chev"><IcoChevron /></span>
        </button>
        {pifConfig.allowPointsPayment && (
          <button className="pif-method" onClick={() => { setError(''); setStep('points'); }}>
            <span className="pif-method-ico"><img src="/pif/mark.png" alt="" width="24" /></span>
            <span className="pif-method-body"><span className="pif-method-title">Use points</span><span className="pif-method-sub">{loyalty ? (loyalty.active ? `You have ${balance} points` : 'Not available') : 'Checking…'}</span></span>
            {loyalty?.active && <span className="pif-pts-pill">{balance} pts</span>}
          </button>
        )}
        <div className="pif-summary-card">
          <span className="pif-summary-heart">♥</span>
          <div><div className="pif-summary-lead">You'll be gifting:</div><div className="pif-summary-val">{giftLabel}</div></div>
          <img className="pif-summary-cup" src="/pif/cup-takeaway.png" alt="" />
        </div>
      </div>
    </>);
  }

  // ── Card ──────────────────────────────────────────────────────────────────
  if (step === 'card') {
    return wrap('pif-light', <>
      {backBtn('method')}{closeBtn}
      <img className="pif-topband" src="/pif/cup-latte.png" alt="" />
      <div className="pif-pad">
        <div className="pif-lockrow"><span className="pif-lock">🔒</span><div><div className="pif-title pif-title-left pif-title-sm">Pay with card</div><div className="pif-sub pif-sub-left">Secure payment powered by Square</div></div></div>
        <div id="pif-card" ref={setCardEl} className="pif-cardbox" />
        {error && <p className="pif-error">{error}</p>}
        <button className="pif-btn pif-btn-maroon" disabled={busy || !ready} onClick={doBuyCard}>
          {busy ? 'Sending…' : `Pay ${formatMoney(amount, currency)} & send coffee 💕`}
        </button>
        <p className="pif-secure">Payments processed securely by Square.</p>
      </div>
    </>);
  }

  // ── Points ────────────────────────────────────────────────────────────────
  if (step === 'points') {
    return wrap('pif-light', <>
      {backBtn('method')}{closeBtn}
      <div className="pif-pad pif-center">
        <img className="pif-badge" src="/pif/mark.png" alt="" />
        <h2 className="pif-title">Use your points</h2>
        <p className="pif-sub">{cheapestTier ? `${cheapestTier.points} points = 1 coffee` : '10 cups = 1 free coffee'}</p>
        <div className="pif-balance-card">
          <div className="pif-balance-lead">Your points balance</div>
          <div className="pif-balance-num">{balance} points</div>
          <CupGauge filled={filledCups} total={10} />
        </div>
        <div className="pif-summary-card pif-summary-light">
          <div><div className="pif-summary-lead">You're gifting</div><div className="pif-summary-val">{giftLabel}<br /><span className="pif-summary-to">to {recipientName || 'a friend'}</span></div></div>
          <img className="pif-summary-cup" src="/pif/cup-gift.png" alt="" />
        </div>
        {!loyalty ? <p className="pif-note">Loading your points…</p> : !loyalty.active ? (
          <p className="pif-note">Loyalty points aren't available right now.</p>
        ) : (
          <div className="pif-tier-row">
            {(loyalty.tiers || []).map((t) => (
              <button key={t.id} type="button" className={`pif-chip ${rewardTierId === t.id ? 'on' : ''} ${t.affordable ? '' : 'off'}`} disabled={!t.affordable} onClick={() => setRewardTierId(t.id)}>{t.name} · {t.points} pts</button>
            ))}
          </div>
        )}
        {error && <p className="pif-error">{error}</p>}
        <button className="pif-btn pif-btn-maroon" disabled={busy || !rewardTierId} onClick={doBuyPoints}>{busy ? 'Sending…' : 'Redeem points & send coffee 💕'}</button>
        <p className="pif-secure">Your points will be deducted when the gift is sent.</p>
      </div>
    </>);
  }

  return null;
}
