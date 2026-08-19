import React, { useEffect, useState } from 'react';
import { api, formatMoney } from '../api.js';
import { track } from '../analytics.js';

const STATUS_COPY = {
  EXPIRED: { title: 'This gift has expired', body: 'Ask the sender for a new one — coffees don\'t last forever!' },
  CANCELLED: { title: 'This gift was cancelled', body: 'Get in touch with Bean Culture if you think this is a mistake.' },
  REFUNDED: { title: 'This gift was refunded', body: 'Get in touch with Bean Culture if you think this is a mistake.' },
  REDEEMED: { title: 'Already enjoyed ☕', body: 'This coffee gift has already been fully used. Hope it was a good one!' },
};

// ☕ YOU'VE GOT COFFEE — the mobile-first deep-link claim page (app.beanculture.com.au/gift/:token).
// Opening this page marks the gift VIEWED (server-side, on the GET). Tapping
// "Claim my coffee" marks it CLAIMED and matches/creates the recipient as a
// real Square customer by phone. The voucher itself is only actually consumed
// later, at real checkout, through the normal ordering pipeline.
export default function GiftClaim({ token, config, user, onClaimed, onExit }) {
  const [gift, setGift] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [phone, setPhone] = useState(user?.phone || '');
  const [name, setName] = useState(user?.name || '');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [claimed, setClaimed] = useState(false);

  useEffect(() => {
    api.pifGetGift(token).then((r) => { setGift(r.gift); track('gift_viewed', { ref: token }); }).catch((e) => setLoadError(e.message || 'Gift not found'));
  }, [token]);

  async function claim() {
    if (!phone.trim()) { setError('Enter your mobile number.'); return; }
    setBusy(true); setError('');
    try {
      await api.pifClaimGift(token, { recipientPhone: phone, recipientName: name, marketingConsent: consent });
      track('gift_claimed', { ref: token });
      if (consent) track('gift_marketing_opt_in', { ref: token });
      setClaimed(true);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  const brand = config?.storeName || 'Bean Culture';

  return (
    <div className="app">
      <div className="pif-claim-page">
        <button className="link" style={{ alignSelf: 'flex-start' }} onClick={onExit}>← {brand}</button>

        {!gift && !loadError && (
          <div className="center-screen"><div className="spinner" /></div>
        )}

        {loadError && !gift && (
          <div className="pif-claim-card">
            <div className="pif-claim-icon">☕</div>
            <h1>Gift not found</h1>
            <p className="muted">This link doesn't match a Bean Culture coffee gift. Double check it, or ask the sender to resend.</p>
            <button className="btn full" onClick={onExit}>Go to {brand}</button>
          </div>
        )}

        {gift && STATUS_COPY[gift.status] && (
          <div className="pif-claim-card">
            <div className="pif-claim-icon">☕</div>
            <h1>{STATUS_COPY[gift.status].title}</h1>
            <p className="muted">{STATUS_COPY[gift.status].body}</p>
            <button className="btn full" onClick={onExit}>Go to {brand}</button>
          </div>
        )}

        {gift && !STATUS_COPY[gift.status] && !claimed && (
          <div className="pif-claim-card">
            <div className="pif-claim-icon">☕</div>
            <h1>YOU'VE GOT COFFEE!</h1>
            <p className="pif-claim-from"><strong>{gift.purchaserName}</strong> has bought you a coffee at {brand}.</p>
            {gift.message && <blockquote className="pif-claim-msg">"{gift.message}"</blockquote>}
            <div className="pif-claim-value">{formatMoney(gift.remainingCents, gift.currency)} COFFEE CREDIT</div>
            {gift.expiresAt && <p className="muted" style={{ fontSize: 12 }}>Valid until {new Date(gift.expiresAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}.</p>}

            {!user?.phone && (
              <>
                <label className="field"><span>Your name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" /></label>
                <label className="field"><span>Your mobile number</span><input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="04XX XXX XXX" /></label>
              </>
            )}
            <label className="pif-consent">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>Keep me in the loop ☕ — send me {brand} specials, coffee offers and rewards.</span>
            </label>
            {error && <p className="error-text">{error}</p>}
            <button className="btn full pif-claim-btn" disabled={busy} onClick={claim}>{busy ? 'Claiming…' : 'CLAIM MY COFFEE'}</button>
          </div>
        )}

        {gift && claimed && (
          <div className="pif-claim-card">
            <div className="pif-claim-icon">✓</div>
            <h1>Coffee claimed!</h1>
            <p className="muted">Head to the menu, add your coffee (and anything else), and your credit is applied automatically at checkout.</p>
            <button className="btn full" onClick={() => onClaimed && onClaimed(token, { code: gift.code, valueCents: gift.valueCents, remainingCents: gift.remainingCents })}>Order my coffee</button>
          </div>
        )}
      </div>
    </div>
  );
}
