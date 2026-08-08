import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, formatMoney } from '../api.js';
import WalletButtons from './WalletButtons.jsx';

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

const AMOUNTS = [1000, 2000, 5000, 10000];

export default function GiftCards({ config, user, initialBalance, initialMode, onClose, onBalance }) {
  const [mode, setMode] = useState(initialMode || 'topup'); // topup | buy | redeem
  const [amount, setAmount] = useState(2000);
  const [balance, setBalance] = useState(initialBalance ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [gan, setGan] = useState('');
  const [copied, setCopied] = useState(false);
  const [ready, setReady] = useState(false);
  const [paymentsObj, setPaymentsObj] = useState(null);
  const paymentsRef = useRef(null);
  const cardRef = useRef(null);
  const cardElRef = useRef(null);
  const currency = config.currency || 'AUD';

  useEffect(() => {
    if (user?.customerId && balance == null) api.giftBalance(user.customerId).then((b) => setBalance(b.balance || 0)).catch(() => setBalance(0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Attach Square's card field once BOTH the SDK is ready AND the card container
  // is mounted — in either order. Attaching to the live element (not a
  // '#gc-card' selector) avoids the "element not found" race when the SDK
  // resolves before React has painted the field.
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

  // Stable callback ref: fires when the card box mounts (→ attach) or unmounts
  // (→ tear down, so it re-attaches cleanly if the user returns to a card mode).
  const setCardEl = useCallback((el) => {
    cardElRef.current = el;
    if (el) { attachCard(); }
    else { try { cardRef.current?.destroy(); } catch {} cardRef.current = null; setReady(false); }
  }, [attachCard]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const Square = await loadSquareSdk(config.environment);
        if (cancelled) return;
        if (!config.applicationId || !config.locationId) throw new Error('Payments not configured.');
        paymentsRef.current = Square.payments(config.applicationId, config.locationId);
        if (!cancelled) { setPaymentsObj(paymentsRef.current); attachCard(); }
      } catch (e) { if (!cancelled) setError(e.message); }
    })();
    return () => { cancelled = true; try { cardRef.current?.destroy(); } catch {} cardRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function tokenize(amt) {
    const r = await cardRef.current.tokenize();
    if (r.status !== 'OK') throw new Error('Please check your card details.');
    let vToken;
    try {
      const v = await paymentsRef.current.verifyBuyer(r.token, { intent: 'CHARGE', amount: (amt / 100).toFixed(2), currencyCode: currency, billingContact: { givenName: user?.name || 'Guest' } });
      vToken = v?.token;
    } catch {}
    return { token: r.token, vToken };
  }

  async function doTopUp() {
    if (!user?.customerId) { setError('Please sign in first.'); return; }
    setBusy(true); setError('');
    try {
      const { token, vToken } = await tokenize(amount);
      const b = await api.giftTopUp({ customerId: user.customerId, sourceId: token, amount, verificationToken: vToken });
      setBalance(b.balance); onBalance && onBalance(b.balance);
      setResult({ kind: 'topup', balance: b.balance });
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function doBuy() {
    setBusy(true); setError('');
    try {
      const { token, vToken } = await tokenize(amount);
      const g = await api.giftBuy({ sourceId: token, amount, verificationToken: vToken, customerId: user?.customerId });
      setResult({ kind: 'gift', gan: g.gan, balance: g.balance });
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function doRedeem() {
    if (!user?.customerId) { setError('Please sign in first.'); return; }
    setBusy(true); setError('');
    try {
      await api.giftRedeem(user.customerId, gan);
      const nb = await api.giftBalance(user.customerId);
      setBalance(nb.balance); onBalance && onBalance(nb.balance);
      setResult({ kind: 'added', balance: nb.balance });
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  // A wallet (Apple Pay / Google Pay) produced a token — fund the top-up or the
  // gift purchase with it directly (no card entry, no buyer verification).
  async function onWalletToken(token) {
    if (mode === 'topup') {
      if (!user?.customerId) throw new Error('Please sign in first.');
      const b = await api.giftTopUp({ customerId: user.customerId, sourceId: token, amount });
      setBalance(b.balance); onBalance && onBalance(b.balance);
      setResult({ kind: 'topup', balance: b.balance });
    } else if (mode === 'buy') {
      const g = await api.giftBuy({ sourceId: token, amount, customerId: user?.customerId });
      setResult({ kind: 'gift', gan: g.gan, balance: g.balance });
    }
  }
  function walletCanStart() {
    if (amount < 100) { setError('Choose an amount of at least ' + formatMoney(100, currency) + '.'); return false; }
    if (mode === 'topup' && !user?.customerId) { setError('Please sign in first.'); return false; }
    setError('');
    return true;
  }

  const needsCard = mode !== 'redeem';

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="sheet gc-sheet" onClick={(e) => e.stopPropagation()}>
        <button className="sheet-close" onClick={onClose} aria-label="Close">✕</button>
        <div className="sheet-body">
          <h2>Gift cards &amp; balance</h2>
          {balance != null && <div className="gc-balance">Your balance <strong>{formatMoney(balance, currency)}</strong></div>}

          <div className="segmented three">
            <button className={mode === 'topup' ? 'seg active' : 'seg'} onClick={() => { setMode('topup'); setResult(null); }} type="button">Top up</button>
            <button className={mode === 'buy' ? 'seg active' : 'seg'} onClick={() => { setMode('buy'); setResult(null); }} type="button">Buy a gift</button>
            <button className={mode === 'redeem' ? 'seg active' : 'seg'} onClick={() => { setMode('redeem'); setResult(null); }} type="button">Add a code</button>
          </div>

          {result ? (
            <div className="gc-result">
              {result.kind === 'gift' ? (
                <>
                  <div className="tick" style={{ width: 54, height: 54, fontSize: 28 }}>✓</div>
                  <h3 className="serif" style={{ margin: '10px 0 4px' }}>Gift card ready</h3>
                  <p className="muted" style={{ fontSize: 13 }}>Share this code with the lucky person — they add it under “Add a code”, or enter it at checkout.</p>
                  <div className="gc-code">{result.gan}</div>
                  <button className="btn full" onClick={() => { navigator.clipboard?.writeText(result.gan); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>{copied ? 'Copied!' : 'Copy code'}</button>
                </>
              ) : (
                <>
                  <div className="tick" style={{ width: 54, height: 54, fontSize: 28 }}>✓</div>
                  <h3 className="serif" style={{ margin: '10px 0 4px' }}>{result.kind === 'added' ? 'Added to your account' : 'Topped up'}</h3>
                  <p>New balance {formatMoney(result.balance, currency)}.</p>
                  <button className="btn full" onClick={onClose}>Done</button>
                </>
              )}
            </div>
          ) : (
            <>
              {mode === 'redeem' ? (
                <>
                  <p className="muted" style={{ fontSize: 13 }}>Got a gift card? Add its code to your account balance.</p>
                  <label className="field"><span>Gift card code</span><input value={gan} onChange={(e) => setGan(e.target.value)} placeholder="7783 32XX XXXX XXXX" /></label>
                  {error && <p className="error-text">{error}</p>}
                  <button className="btn full" style={{ marginTop: 12 }} disabled={busy || !gan.trim()} onClick={doRedeem}>{busy ? 'Adding…' : 'Add to my account'}</button>
                </>
              ) : (
                <>
                  {mode === 'buy' && <p className="muted" style={{ fontSize: 13 }}>Buy a digital gift card and share the code with someone.</p>}
                  <div className="gc-amounts">
                    {AMOUNTS.map((a) => (
                      <button key={a} type="button" className={`chip ${amount === a ? 'on' : ''}`} onClick={() => setAmount(a)}>{formatMoney(a, currency)}</button>
                    ))}
                  </div>
                  <label className="field" style={{ marginTop: 8 }}><span>Amount</span>
                    <input inputMode="numeric" value={(amount / 100).toString()} onChange={(e) => setAmount(Math.round((parseFloat(e.target.value) || 0) * 100))} /></label>
                  <WalletButtons
                    payments={paymentsObj}
                    amount={amount}
                    currency={currency}
                    country="AU"
                    label={mode === 'buy' ? 'Bean Culture gift card' : 'Bean Culture top-up'}
                    canStart={walletCanStart}
                    onToken={onWalletToken}
                    onError={setError}
                  />
                  <div className="group-title" style={{ marginTop: 14 }}>Pay with card</div>
                  <div id="gc-card" ref={setCardEl} className="card-box" />
                  {error && <p className="error-text">{error}</p>}
                  <button className="btn full" style={{ marginTop: 12 }} disabled={busy || !ready || amount < 100} onClick={mode === 'buy' ? doBuy : doTopUp}>
                    {busy ? 'Processing…' : mode === 'buy' ? `Buy gift · ${formatMoney(amount, currency)}` : `Top up · ${formatMoney(amount, currency)}`}
                  </button>
                  <p className="secure-note">Payments processed securely by Square.</p>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
