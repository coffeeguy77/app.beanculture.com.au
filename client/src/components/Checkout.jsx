import React, { useEffect, useRef, useState } from 'react';
import { api, formatMoney } from '../api.js';
import { TableLockPill, TableEntry } from './TableControls.jsx';
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

// yyyy-mm-dd for a date offset by n days (local).
function dateStr(d) {
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const WEEKDAYS = [['Mon', 1], ['Tue', 2], ['Wed', 3], ['Thu', 4], ['Fri', 5], ['Sat', 6], ['Sun', 0]];

export default function Checkout({ config, cart, currency, dineIn, setDineIn, table, setTable, tableLock, onUnlockTable, onScanTable, name, setName, user, canOrder, preWhen, preAt, onPaid, onScheduled, onBack }) {
  const [status, setStatus] = useState('init');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [coupon, setCoupon] = useState('');
  const [note, setNote] = useState('');
  const [paymentsObj, setPaymentsObj] = useState(null);
  const [loyalty, setLoyalty] = useState(null);
  const [tierId, setTierId] = useState(null);

  const bigPill = tableLock >= 2 && dineIn && table;
  const sched = config.scheduling || {};
  const openDays = config.hours?.openDays || null; // null = open every day
  const closures = config.hours?.closures || [];
  function closureHit(c, ds) {
    if (!c) return false;
    const md = ds.slice(5);
    if (c.from && c.to) {
      if (c.annual) { const f = c.from.slice(5), t = c.to.slice(5); return f <= t ? (md >= f && md <= t) : (md >= f || md <= t); }
      return ds >= c.from && ds <= c.to;
    }
    if (c.date) return c.date === ds || (c.annual && String(c.date).slice(5) === md);
    return false;
  }
  function closedReason(ds) {
    if (!ds) return null;
    if (openDays) { const wd = new Date(`${ds}T12:00:00`).getDay(); if (!openDays.includes(wd)) return 'closed that day'; }
    if (closures.some((c) => closureHit(c, ds))) return 'closed (holiday)';
    return null;
  }

  // ---- scheduling + saved cards ----
  // Seed from the takeaway Now/Later choice made on the menu.
  const takeawayLater = dineIn === false && preWhen === 'later';
  const [when, setWhen] = useState(takeawayLater ? 'schedule' : 'asap'); // asap | schedule | repeat
  const [schedDate, setSchedDate] = useState((takeawayLater && preAt?.date) || dateStr(new Date(Date.now() + 86400000)));
  const [schedTime, setSchedTime] = useState((takeawayLater && preAt?.time) || '08:00');
  const [repeatType, setRepeatType] = useState('weekly'); // daily | weekly
  const [repeatDays, setRepeatDays] = useState([1, 2, 3, 4, 5]);
  const [repeatTime, setRepeatTime] = useState('08:00');
  const [payTiming, setPayTiming] = useState('now'); // now | later (schedule only)
  const [savedCards, setSavedCards] = useState([]);
  const [cardChoice, setCardChoice] = useState('new'); // saved card id | 'new' | 'balance'
  const [saveNew, setSaveNew] = useState(false);
  const [giftBalance, setGiftBalance] = useState(0);

  const paymentsRef = useRef(null);
  const cardRef = useRef(null);

  const cartTotal = cart.reduce((n, c) => n + c.unitPrice * c.quantity, 0);
  const cartPayload = cart.map((c) => ({ variationId: c.variationId, quantity: c.quantity, modifierIds: c.modifierIds, note: c.note }));
  const hasCoupon = coupon.trim().length > 0;
  const usingReward = !!tierId;

  const isSchedule = when === 'schedule';
  const isRepeat = when === 'repeat';
  const autocharge = isRepeat || (isSchedule && payTiming === 'later');
  const usingNewCard = cardChoice === 'new';
  const hideWallets = hasCoupon || usingReward || isSchedule || isRepeat || !usingNewCard;

  // Loyalty + saved cards for a signed-in user.
  useEffect(() => {
    if (user?.phone) api.getLoyalty(user.phone).then((l) => { if (l && l.active) setLoyalty(l); }).catch(() => {});
    if (user?.customerId) {
      api.getCards(user.customerId).then((d) => {
        const list = d.cards || [];
        setSavedCards(list);
        if (list.length) setCardChoice(list[0].id);
      }).catch(() => {});
      api.giftBalance(user.customerId).then((b) => setGiftBalance(b.balance || 0)).catch(() => {});
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
        if (!cancelled) setPaymentsObj(payments);
        const card = await payments.card();
        await card.attach('#card-container');
        cardRef.current = card;
        if (!cancelled) setStatus('ready');
      } catch (e) { if (!cancelled) { setError(e.message); setStatus('error'); } }
    }
    init();
    return () => { cancelled = true; try { cardRef.current?.destroy(); } catch {} };
  }, []);

  function pickupIso() {
    if (!isSchedule) return null;
    const reason = closedReason(schedDate);
    if (reason) throw new Error(`Sorry, we’re ${reason}. Please pick another date.`);
    const d = new Date(`${schedDate}T${schedTime}`);
    if (isNaN(d.getTime())) throw new Error('Please choose a valid pickup date and time.');
    if (d.getTime() < Date.now() + 5 * 60000) throw new Error('Choose a pickup time at least a few minutes from now.');
    return d.toISOString();
  }

  function validate() {
    if (!name.trim()) { setError('Please enter your name.'); return false; }
    if (dineIn === null) { setError('Please choose Dine in or Takeaway.'); return false; }
    if (dineIn && !table.trim()) { setError('Please enter your table number.'); return false; }
    if (!canOrder && when === 'asap') { setError('Ordering is currently closed — schedule a time instead.'); return false; }
    if ((isSchedule || isRepeat) && !user?.customerId) { setError('Please sign in (via Account) to schedule an order.'); return false; }
    if ((isSchedule || isRepeat) && !sched.enabled && autocharge) { setError('Scheduled auto-charge is not available right now.'); return false; }
    if (isRepeat && repeatType === 'weekly' && !repeatDays.length) { setError('Pick at least one day to repeat on.'); return false; }
    return true;
  }

  // Tokenize the entered card (with buyer verification). intent: STORE | CHARGE.
  async function tokenizeNew(intent, amountMinor) {
    const result = await cardRef.current.tokenize();
    if (result.status !== 'OK') throw new Error('Please check your card details.');
    let verificationToken;
    try {
      const details = intent === 'STORE'
        ? { intent: 'STORE', billingContact: { givenName: name }, customerInitiated: true }
        : { intent: 'CHARGE', amount: ((amountMinor || 0) / 100).toFixed(2), currencyCode: currency, billingContact: { givenName: name } };
      const v = await paymentsRef.current.verifyBuyer(result.token, details);
      verificationToken = v?.token;
    } catch {}
    return { token: result.token, verificationToken };
  }

  // Resolve a saved card id to charge later (using existing or saving a new one).
  async function resolveCardId() {
    if (!usingNewCard) return cardChoice;
    const { token, verificationToken } = await tokenizeNew('STORE');
    const saved = await api.saveCard({ sourceId: token, verificationToken, customerId: user.customerId, cardholderName: name });
    if (!saved.card?.id) throw new Error('Could not save the card.');
    // refresh list
    api.getCards(user.customerId).then((d) => setSavedCards(d.cards || [])).catch(() => {});
    return saved.card.id;
  }

  async function createOrder(pickupAt) {
    return api.createOrder({
      cart: cartPayload, dineIn, table, name, coupon, pickupAt, note,
      customerId: user?.customerId,
      loyalty: tierId && loyalty?.accountId ? { accountId: loyalty.accountId, tierId } : undefined,
    });
  }

  // Main submit — routes to schedule (auto-charge) or immediate payment.
  async function place() {
    if (!validate()) return;
    setBusy(true); setError('');
    try {
      // ---- Scheduled / recurring with auto-charge from a saved card ----
      if (autocharge) {
        const pickupAt = isSchedule ? pickupIso() : null;
        const cardId = await resolveCardId();
        let recurrence;
        if (!isRepeat) recurrence = { type: 'none' };
        else if (repeatType === 'daily') recurrence = openDays ? { type: 'weekly', time: repeatTime, days: openDays } : { type: 'daily', time: repeatTime };
        else recurrence = { type: 'weekly', time: repeatTime, days: repeatDays.filter((n) => !openDays || openDays.includes(n)) };
        const label = isRepeat
          ? `${repeatType === 'daily' ? 'Daily' : 'Weekly'} · ${repeatTime}`
          : `Pickup ${schedDate} ${schedTime}`;
        const r = await api.schedule({
          cart: cartPayload, dineIn, table, name, phone: user?.phone,
          customerId: user.customerId, cardId, recurrence, pickupAt, label, amount: cartTotal,
        });
        onScheduled(r.scheduled, { recurring: isRepeat, when: label });
        return;
      }

      // ---- Pay now (ASAP or scheduled prepaid) ----
      const pickupAt = isSchedule ? pickupIso() : null;
      const order = await createOrder(pickupAt);

      // Pay from prepaid balance (gift card).
      if (cardChoice === 'balance') {
        const pay = await api.pay({ orderId: order.orderId, totalMoney: order.totalMoney, customerId: user.customerId, payWith: 'balance' });
        if (pay.status === 'COMPLETED' || pay.status === 'APPROVED') return onPaid(pay, order, { pickupAt });
        throw new Error(`Payment ${pay.status}`);
      }

      if (!order.totalMoney || order.totalMoney.amount === 0) {
        await api.pay({ orderId: order.orderId, totalMoney: order.totalMoney });
        onPaid({ status: 'COMPLETED', comped: !usingReward, receiptUrl: null }, order, { pickupAt });
        return;
      }

      let sourceId, verificationToken;
      if (!usingNewCard) {
        sourceId = cardChoice; // saved card id
      } else if (saveNew && user?.customerId) {
        sourceId = await resolveCardId(); // save then charge the stored card
      } else {
        const tok = await tokenizeNew('CHARGE', order.totalMoney.amount);
        sourceId = tok.token; verificationToken = tok.verificationToken;
      }

      const pay = await api.pay({
        sourceId, orderId: order.orderId, totalMoney: order.totalMoney,
        verificationToken, customerId: user?.customerId,
      });
      if (pay.status === 'COMPLETED' || pay.status === 'APPROVED') onPaid(pay, order, { pickupAt });
      else throw new Error(`Payment ${pay.status}`);
    } catch (e) {
      const declined = /insufficient|declin|cvv|card|402|fund/i.test(e.message || '');
      setError(declined ? 'Your card was declined — your order is still here. Try another card.' : e.message);
    } finally { setBusy(false); }
  }

  // A wallet (Apple Pay / Google Pay / Afterpay) already produced a token — no
  // buyer verification needed; the wallet carries its own authentication.
  async function onWalletToken(token) {
    setBusy(true); setError('');
    try {
      const order = await createOrder(null);
      const pay = await api.pay({ sourceId: token, orderId: order.orderId, totalMoney: order.totalMoney, customerId: user?.customerId });
      if (pay.status === 'COMPLETED' || pay.status === 'APPROVED') onPaid(pay, order, {});
      else throw new Error(`Payment ${pay.status}`);
    } catch (e) {
      const declined = /insufficient|declin|cvv|card|402|fund/i.test(e.message || '');
      setError(declined ? 'That payment was declined — your order is still here. Try another method.' : e.message);
    } finally { setBusy(false); }
  }

  const minDate = dateStr(new Date());
  // Auto-charge holds funds via a card authorization (valid ~7 days), so cap the
  // "later + auto-charge" window to a week; pay-now scheduling can be further out.
  const maxAhead = (isSchedule && payTiming === 'later') ? 7 : (sched.maxDaysAhead || 14);
  const maxDate = dateStr(new Date(Date.now() + maxAhead * 86400000));
  const scheduleAllowed = true; // pay-now scheduling always ok; auto-charge needs sched.enabled (checked on submit)
  const ctaLabel = autocharge
    ? (isRepeat ? 'Set up repeating order' : 'Schedule order')
    : (hasCoupon ? 'Place order' : `Pay ${formatMoney(cartTotal, currency)}`);

  return (
    <main className="page">
      <button className="link" onClick={onBack}>← Order</button>
      <h2>Checkout</h2>

      {bigPill ? (
        <div style={{ marginBottom: 12 }}><TableLockPill table={table} onUnlock={onUnlockTable} /></div>
      ) : (
        <div className="segmented" style={{ marginBottom: 12 }}>
          <button className={dineIn === true ? 'seg active' : 'seg'} onClick={() => setDineIn(true)} type="button">Dine in</button>
          <button className={dineIn === false ? 'seg active' : 'seg'} onClick={() => setDineIn(false)} type="button">Takeaway</button>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label className="field">
          <span className="req">Your name</span>
          <input placeholder="e.g. Shaun" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {dineIn === true && !bigPill && (
          <TableEntry lock={tableLock} table={table} setTable={setTable} onUnlock={onUnlockTable} onScanned={onScanTable} />
        )}
      </div>

      {/* When to order */}
      <div className="group" style={{ marginTop: 16 }}>
        <div className="group-title">When</div>
        <div className="segmented three">
          <button className={when === 'asap' ? 'seg active' : 'seg'} onClick={() => setWhen('asap')} type="button">ASAP</button>
          <button className={when === 'schedule' ? 'seg active' : 'seg'} onClick={() => setWhen('schedule')} type="button">Schedule</button>
          <button className={when === 'repeat' ? 'seg active' : 'seg'} onClick={() => setWhen('repeat')} type="button">Repeat</button>
        </div>

        {isSchedule && (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 10 }}>
              <label className="field" style={{ flex: 1 }}><span>Date</span>
                <input type="date" min={minDate} max={maxDate} value={schedDate} onChange={(e) => setSchedDate(e.target.value)} /></label>
              <label className="field" style={{ flex: 1 }}><span>Time</span>
                <input type="time" value={schedTime} onChange={(e) => setSchedTime(e.target.value)} /></label>
            </div>
            <div className="segmented">
              <button className={payTiming === 'now' ? 'seg active' : 'seg'} onClick={() => setPayTiming('now')} type="button">Pay now</button>
              <button className={payTiming === 'later' ? 'seg active' : 'seg'} onClick={() => setPayTiming('later')} type="button">Auto-charge at pickup</button>
            </div>
            {payTiming === 'later' && <p className="muted" style={{ fontSize: 11, margin: 0 }}>We hold the amount on your card now to confirm funds, then charge it at pickup (within 7 days).</p>}
          </div>
        )}

        {isRepeat && (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="segmented">
              <button className={repeatType === 'daily' ? 'seg active' : 'seg'} onClick={() => setRepeatType('daily')} type="button">Every day</button>
              <button className={repeatType === 'weekly' ? 'seg active' : 'seg'} onClick={() => setRepeatType('weekly')} type="button">Certain days</button>
            </div>
            {repeatType === 'weekly' && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {WEEKDAYS.map(([lbl, n]) => {
                  const closed = openDays && !openDays.includes(n);
                  const on = repeatDays.includes(n) && !closed;
                  return <button key={n} type="button" disabled={closed} title={closed ? 'Closed this day' : ''}
                    className={`chip ${on ? 'on' : ''}`} style={{ fontSize: 12, opacity: closed ? 0.4 : 1 }}
                    onClick={() => !closed && setRepeatDays((d) => d.includes(n) ? d.filter((x) => x !== n) : [...d, n])}>{lbl}</button>;
                })}
              </div>
            )}
            {openDays && <p className="muted" style={{ fontSize: 11, margin: 0 }}>Only days you’re open can be selected.</p>}
            <label className="field"><span>Time each day</span>
              <input type="time" value={repeatTime} onChange={(e) => setRepeatTime(e.target.value)} /></label>
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>We’ll auto-charge your saved card and send the order to the kitchen each time.</p>
          </div>
        )}
      </div>

      {(isSchedule || isRepeat) && !user?.customerId && (
        <p className="error-text" style={{ fontSize: 13 }}>Sign in from the Account tab to schedule or repeat an order.</p>
      )}

      {loyalty?.active && loyalty.tiers?.length > 0 && when === 'asap' && (
        <div style={{ marginTop: 16 }}>
          <div className="group-title">Rewards · {loyalty.balance} {loyalty.terminology?.other || 'points'}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {loyalty.tiers.map((t) => (
              <button key={t.id} type="button" className={`reward ${tierId === t.id ? 'picked' : ''} ${!t.affordable ? 'locked' : ''}`}
                onClick={() => t.affordable && setTierId(tierId === t.id ? null : t.id)}>
                <span>{t.name}</span><span className="pill">{t.points} pts</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {when === 'asap' && (
        <label className="field" style={{ marginTop: 16 }}>
          <span>Promo code (optional)</span>
          <input value={coupon} onChange={(e) => setCoupon(e.target.value)} placeholder="Enter code" autoCapitalize="characters" />
        </label>
      )}

      <label className="field" style={{ marginTop: 14 }}>
        <span>Notes for the kitchen (optional)</span>
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. extra hot, no sugar, allergy info" />
      </label>

      {/* Payment method */}
      <div className="group" style={{ marginTop: 16 }}>
        <div className="group-title">Payment</div>
        {(savedCards.length > 0 || (!autocharge && giftBalance >= cartTotal && cartTotal > 0)) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
            {!autocharge && giftBalance >= cartTotal && cartTotal > 0 && (
              <label className={`reward ${cardChoice === 'balance' ? 'picked' : ''}`} style={{ cursor: 'pointer' }}>
                <span>Pay with balance · {formatMoney(giftBalance, currency)}</span>
                <input type="radio" name="card" checked={cardChoice === 'balance'} onChange={() => setCardChoice('balance')} />
              </label>
            )}
            {savedCards.map((c) => (
              <label key={c.id} className={`reward ${cardChoice === c.id ? 'picked' : ''}`} style={{ cursor: 'pointer' }}>
                <span>{c.brand} ···· {c.last4}</span>
                <input type="radio" name="card" checked={cardChoice === c.id} onChange={() => setCardChoice(c.id)} />
              </label>
            ))}
            <label className={`reward ${usingNewCard ? 'picked' : ''}`} style={{ cursor: 'pointer' }}>
              <span>Use a new card</span>
              <input type="radio" name="card" checked={usingNewCard} onChange={() => setCardChoice('new')} />
            </label>
          </div>
        )}
      </div>

      <div className="totals">
        <div className="row grand"><span>Total</span><span>{formatMoney(cartTotal, currency)}</span></div>
        {(usingReward || hasCoupon) && <div className="row discount"><span>Discount applied at payment</span><span>—</span></div>}
        {autocharge && <div className="row"><span>{isRepeat ? 'Charged each time' : 'Charged at pickup'}</span><span>{formatMoney(cartTotal, currency)}</span></div>}
      </div>

      {status === 'error' && (
        <div className="card"><p className="error-text">{error}</p>
          <button className="btn ghost full" onClick={onBack}>Back to order</button></div>
      )}

      {status !== 'error' && (
        <>
          {!hideWallets && (
            <WalletButtons
              payments={paymentsObj}
              amount={cartTotal}
              currency={currency}
              country="AU"
              label="Bean Culture"
              afterpay
              canStart={validate}
              onToken={onWalletToken}
              onError={setError}
            />
          )}

          {/* Card entry — hidden when paying with a saved card */}
          <div id="card-container" className="card-box" style={{ display: usingNewCard && !hasCoupon ? 'block' : 'none', marginTop: 8 }} />
          {usingNewCard && user?.customerId && !autocharge && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 14, cursor: 'pointer' }}>
              <input type="checkbox" checked={saveNew} onChange={(e) => setSaveNew(e.target.checked)} />
              <span>Save this card for next time</span>
            </label>
          )}
          {autocharge && usingNewCard && (
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>Your card is saved securely with Square and charged automatically {isRepeat ? 'each time' : 'at pickup'}.</p>
          )}

          {error && <p className="error-text">{error}</p>}
          <button className="btn full" style={{ marginTop: 12 }} disabled={busy || status !== 'ready'} onClick={place}>
            {busy ? 'Working…' : ctaLabel}
          </button>
          <p className="secure-note">Payments processed securely by Square.</p>
        </>
      )}
    </main>
  );
}
