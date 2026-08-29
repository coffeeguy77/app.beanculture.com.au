import React, { useEffect, useRef, useState } from 'react';
import { api, formatMoney, comboDiscountFor } from '../api.js';
import { track } from '../analytics.js';
import { TableLockPill, TableEntry } from './TableControls.jsx';
import WalletButtons from './WalletButtons.jsx';
import ScheduleWhen from './ScheduleWhen.jsx';

// Group flat cart lines so a combo (several lines sharing one comboInstanceId)
// is shown + controlled as ONE atomic bundle. Mirrors CartPanel/CartView.
function groupCart(cart) {
  const out = [];
  const seen = new Set();
  for (const c of cart) {
    if (c.comboInstanceId) {
      if (seen.has(c.comboInstanceId)) continue;
      seen.add(c.comboInstanceId);
      out.push({ type: 'combo', instanceId: c.comboInstanceId, name: c.comboName, lines: cart.filter((x) => x.comboInstanceId === c.comboInstanceId) });
    } else {
      out.push({ type: 'single', line: c });
    }
  }
  return out;
}

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

export default function Checkout({ config, location, cart, currency, onQty, onComboQty, onRemoveCombo, onEditCombo, dineIn, setDineIn, table, setTable, tableLock, onUnlockTable, onScanTable, name, setName, user, canOrder, preWhen, preAt, onPaid, onScheduled, onBack, pifVoucher, onClearPifVoucher }) {
  const [status, setStatus] = useState('init');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [coupon, setCoupon] = useState('');
  const [pifManualCode, setPifManualCode] = useState('');
  const [pifError, setPifError] = useState('');
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
  // When the shop itself is closed, immediate pickup ("ASAP") makes no sense —
  // there's no one to make it now — so force scheduling for a future time.
  const closedNow = config.hours?.open === false;
  const [when, setWhen] = useState((takeawayLater || closedNow) ? 'schedule' : 'asap'); // asap | schedule | repeat
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

  // Displayed total must match the authoritative server total, which already
  // subtracts the combo discount — otherwise the "Pay $X" button shows the
  // undiscounted sum while the real charge (order.totalMoney) is lower.
  const cartTotal = Math.max(0, cart.reduce((n, c) => n + c.unitPrice * c.quantity, 0) - comboDiscountFor(cart));
  const hasCombo = cart.some((c) => c.comboInstanceId);
  const cartPayload = cart.map((c) => ({
    variationId: c.variationId, quantity: c.quantity, modifierIds: c.modifierIds, note: c.note,
    // Combo Builder tags — the server independently re-validates these against
    // the stored combo definition before applying any discount (see
    // server/lib/combos.js); nothing here is trusted at face value.
    ...(c.comboInstanceId ? { comboId: c.comboId, comboInstanceId: c.comboInstanceId, comboGroupId: c.comboGroupId, comboItemId: c.itemId } : {}),
  }));
  // A combo's discount already applies itself automatically — a typed coupon
  // on top would stack two discounts, so the coupon field is disabled while
  // any combo is in the cart (the server enforces this too, independently).
  const hasCoupon = !hasCombo && coupon.trim().length > 0;
  const usingReward = !!tierId;
  // A Pay It Forward voucher (claimed via the /gift link, or typed in as a
  // backup code) takes priority over a combo/coupon, same precedent as
  // combo-beats-coupon above -- the server enforces this independently too.
  const effectivePifCode = (pifVoucher && pifVoucher.token) || pifManualCode.trim();
  const hasPif = !hasCombo && !hasCoupon && !!effectivePifCode;
  // Best-effort DISPLAY estimate only -- the server re-derives the real,
  // eligible-items-only discount from a fresh Square catalog read and never
  // trusts this. The actual charge always comes from order.totalMoney below.
  const pifEstimateCents = hasPif && pifVoucher ? Math.min(pifVoucher.remainingCents ?? pifVoucher.valueCents ?? 0, cartTotal) : 0;

  // Validate the entered coupon against the app's codes so we can show the real
  // discount and take payment for the reduced total (not assume it's a freebie).
  const [couponInfo, setCouponInfo] = useState(null); // {valid,type,value,comp,label} | null
  useEffect(() => {
    const code = coupon.trim();
    if (!code) { setCouponInfo(null); return; }
    let live = true;
    const t = setTimeout(() => {
      api.getCoupon(code)
        .then((d) => { if (live) setCouponInfo(d && d.valid ? d : { valid: false }); })
        .catch(() => { if (live) setCouponInfo(null); });
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [coupon]);
  const couponValid = !!couponInfo?.valid;
  const discountedTotal = couponValid
    ? (couponInfo.comp ? 0
      : couponInfo.type === 'amount' ? Math.max(0, cartTotal - Math.round((couponInfo.value || 0) * 100))
      : Math.max(0, Math.round(cartTotal * (1 - (couponInfo.value || 0) / 100))))
    : cartTotal;
  const couponFree = couponValid && discountedTotal === 0;
  const payTotal = couponValid ? discountedTotal : Math.max(0, cartTotal - pifEstimateCents);

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
        const sqLoc = (location && location.squareLocationId) || config.locationId;
        if (!config.applicationId || !sqLoc) throw new Error('Payment not configured.');
        const payments = Square.payments(config.applicationId, sqLoc);
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
    if ((!canOrder || closedNow) && when === 'asap') { setError('We’re closed right now — schedule a pickup time instead.'); return false; }
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
    if (hasPif) track('gift_redemption_started', { ref: effectivePifCode });
    return api.createOrder({
      cart: cartPayload, dineIn, table, name, coupon, pickupAt, note,
      customerId: user?.customerId, locationId: location?.id,
      loyalty: tierId && loyalty?.accountId ? { accountId: loyalty.accountId, tierId } : undefined,
      pifVoucher: hasPif ? effectivePifCode : undefined,
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
        const pay = await api.pay({ orderId: order.orderId, totalMoney: order.totalMoney, customerId: user.customerId, payWith: 'balance', locationId: location?.id });
        if (pay.status === 'COMPLETED' || pay.status === 'APPROVED') { if (hasPif && onClearPifVoucher) { track('gift_redeemed', { ref: effectivePifCode }); onClearPifVoucher(); } return onPaid(pay, order, { pickupAt }); }
        throw new Error(`Payment ${pay.status}`);
      }

      if (!order.totalMoney || order.totalMoney.amount === 0) {
        await api.pay({ orderId: order.orderId, totalMoney: order.totalMoney, locationId: location?.id });
        if (hasPif && onClearPifVoucher) { track('gift_redeemed', { ref: effectivePifCode }); onClearPifVoucher(); }
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
        verificationToken, customerId: user?.customerId, locationId: location?.id,
      });
      if (pay.status === 'COMPLETED' || pay.status === 'APPROVED') { if (hasPif && onClearPifVoucher) { track('gift_redeemed', { ref: effectivePifCode }); onClearPifVoucher(); } onPaid(pay, order, { pickupAt }); }
      else throw new Error(`Payment ${pay.status}`);
    } catch (e) {
      if (e.pifReason) {
        setPifError(e.message);
        track('gift_redemption_failed', { ref: e.pifReason });
        if (['not_found', 'not_redeemable', 'expired'].includes(e.pifReason) && onClearPifVoucher) onClearPifVoucher();
      } else {
        const declined = /insufficient|declin|cvv|card|402|fund/i.test(e.message || '');
        setError(declined ? 'Your card was declined — your order is still here. Try another card.' : e.message);
      }
    } finally { setBusy(false); }
  }

  // A wallet (Apple Pay / Google Pay / Afterpay) already produced a token — no
  // buyer verification needed; the wallet carries its own authentication.
  async function onWalletToken(token) {
    setBusy(true); setError('');
    try {
      const order = await createOrder(null);
      const pay = await api.pay({ sourceId: token, orderId: order.orderId, totalMoney: order.totalMoney, customerId: user?.customerId, locationId: location?.id });
      if (pay.status === 'COMPLETED' || pay.status === 'APPROVED') { if (hasPif && onClearPifVoucher) { track('gift_redeemed', { ref: effectivePifCode }); onClearPifVoucher(); } onPaid(pay, order, {}); }
      else throw new Error(`Payment ${pay.status}`);
    } catch (e) {
      if (e.pifReason) {
        setPifError(e.message);
        track('gift_redemption_failed', { ref: e.pifReason });
        if (['not_found', 'not_redeemable', 'expired'].includes(e.pifReason) && onClearPifVoucher) onClearPifVoucher();
      } else {
        const declined = /insufficient|declin|cvv|card|402|fund/i.test(e.message || '');
        setError(declined ? 'That payment was declined — your order is still here. Try another method.' : e.message);
      }
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
    : (couponFree ? 'Place order' : `Pay ${formatMoney(payTotal, currency)}`);

  return (
    <main className="page checkout-page">
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
          <button className={when === 'asap' ? 'seg active' : 'seg'} disabled={closedNow}
            onClick={() => !closedNow && setWhen('asap')} type="button"
            style={closedNow ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
            title={closedNow ? 'Closed right now — schedule a time' : undefined}>ASAP</button>
          <button className={when === 'schedule' ? 'seg active' : 'seg'} onClick={() => setWhen('schedule')} type="button">Schedule</button>
          <button className={when === 'repeat' ? 'seg active' : 'seg'} onClick={() => setWhen('repeat')} type="button">Repeat</button>
        </div>

        {isSchedule && (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <ScheduleWhen hours={config.hours} date={schedDate} time={schedTime}
              onDate={setSchedDate} onTime={setSchedTime} maxDays={maxAhead} />
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

      {pifVoucher && (
        <div className="pif-applied-row">
          <span>☕ Coffee gift applied {pifVoucher.remainingCents != null ? `· up to ${formatMoney(pifVoucher.remainingCents, currency)}` : ''}</span>
          <button type="button" className="link" onClick={() => { onClearPifVoucher && onClearPifVoucher(); setPifError(''); }}>Remove</button>
        </div>
      )}
      {pifError && <p className="error-text">{pifError}</p>}

      {when === 'asap' && (
        hasCombo ? (
          <p className="muted" style={{ marginTop: 16, fontSize: 14 }}>Your combo discount is already applied — promo codes can't be combined with a combo deal.</p>
        ) : hasPif ? (
          <p className="muted" style={{ marginTop: 16, fontSize: 14 }}>Your coffee gift is already applied — promo codes can't be combined with it.</p>
        ) : (
          <>
            <label className="field" style={{ marginTop: 16 }}>
              <span>Promo code (optional)</span>
              <input value={coupon} onChange={(e) => setCoupon(e.target.value)} placeholder="Enter code" autoCapitalize="characters" />
            </label>
            {!pifVoucher && (
              <label className="field" style={{ marginTop: 8 }}>
                <span>Got a Bean Culture coffee gift code? (optional)</span>
                <input value={pifManualCode} onChange={(e) => { setPifManualCode(e.target.value); setPifError(''); }} placeholder="BC-XXXXX" autoCapitalize="characters" />
              </label>
            )}
          </>
        )
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

      {/* Order summary — stays on screen so you always see what you're buying. */}
      {cart.length > 0 && (
        <div className="group" style={{ marginTop: 16 }}>
          <div className="group-title">Your order</div>
          <ul className="co-order">
            {groupCart(cart).map((g) => {
              if (g.type === 'combo') {
                // A combo is ONE atomic bundle: whole-combo quantity + remove +
                // edit only, never per-component controls (that's what let the
                // bundle be pulled apart while keeping the discount).
                const qty = g.lines[0]?.quantity || 1;
                const comboDisc = (g.lines[0]?.comboDiscount || 0) * qty;
                const comboTotal = Math.max(0, g.lines.reduce((n, l) => n + l.unitPrice * l.quantity, 0) - comboDisc);
                return (
                  <li key={g.instanceId} className="co-line co-line-combo">
                    <div className="co-line-main">
                      <div className="co-line-name">🍔 {g.name}</div>
                      <div className="co-line-sub">{g.lines.map((l) => l.itemName + (l.variationName && l.variationName !== l.itemName ? ` · ${l.variationName}` : '')).join(' + ')}</div>
                      {comboDisc > 0 && <div className="co-line-sub cl-combo-save">Combo saving −{formatMoney(comboDisc, currency)}</div>}
                      <div style={{ display: 'flex', gap: 14, marginTop: 4 }}>
                        {onEditCombo && <button type="button" className="link" style={{ padding: 0 }} onClick={() => onEditCombo(g.instanceId)}>Edit</button>}
                        {onRemoveCombo && <button type="button" className="link" style={{ padding: 0 }} onClick={() => onRemoveCombo(g.instanceId)}>Remove</button>}
                      </div>
                    </div>
                    <div className="co-line-right">
                      {onComboQty ? (
                        <div className="stepper sm">
                          <button type="button" onClick={() => onComboQty(g.instanceId, -1)} aria-label="Decrease">−</button>
                          <span>{qty}</span>
                          <button type="button" onClick={() => onComboQty(g.instanceId, 1)} aria-label="Increase">+</button>
                        </div>
                      ) : <span className="muted">{qty}×</span>}
                      <div style={{ fontWeight: 700, minWidth: 56, textAlign: 'right' }}>{formatMoney(comboTotal, currency)}</div>
                    </div>
                  </li>
                );
              }
              const c = g.line;
              return (
                <li key={c.key} className="co-line">
                  <div className="co-line-main">
                    <div className="co-line-name">{c.itemName}{c.variationName && c.variationName !== c.itemName ? ` · ${c.variationName}` : ''}</div>
                    {c.modifierNames?.length > 0 && <div className="co-line-sub">{c.modifierNames.join(', ')}</div>}
                    {c.note && <div className="co-line-sub">“{c.note}”</div>}
                  </div>
                  <div className="co-line-right">
                    {onQty ? (
                      <div className="stepper sm">
                        <button type="button" onClick={() => onQty(c.key, -1)} aria-label="Decrease">−</button>
                        <span>{c.quantity}</span>
                        <button type="button" onClick={() => onQty(c.key, 1)} aria-label="Increase">+</button>
                      </div>
                    ) : <span className="muted">{c.quantity}×</span>}
                    <div style={{ fontWeight: 700, minWidth: 56, textAlign: 'right' }}>{formatMoney(c.unitPrice * c.quantity, currency)}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="totals">
        {couponValid ? (
          <>
            <div className="row"><span>Subtotal</span><span>{formatMoney(cartTotal, currency)}</span></div>
            <div className="row discount"><span>Coupon {couponInfo.code || coupon.trim().toUpperCase()} · {couponInfo.label}</span><span>−{formatMoney(cartTotal - discountedTotal, currency)}</span></div>
            <div className="row grand"><span>Total</span><span>{formatMoney(payTotal, currency)}</span></div>
          </>
        ) : hasPif ? (
          <>
            <div className="row"><span>Subtotal</span><span>{formatMoney(cartTotal, currency)}</span></div>
            <div className="row discount"><span>Coffee gift (estimated)</span><span>−{formatMoney(pifEstimateCents, currency)}</span></div>
            <div className="row grand"><span>Total</span><span>{formatMoney(payTotal, currency)}</span></div>
            <p className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>Final amount confirmed at payment — the gift only discounts eligible coffee items.</p>
          </>
        ) : (
          <div className="row grand"><span>Total</span><span>{formatMoney(cartTotal, currency)}</span></div>
        )}
        {hasCoupon && !couponValid && couponInfo && <div className="row discount"><span>Coupon not recognised</span><span>—</span></div>}
        {usingReward && <div className="row discount"><span>Reward applied at payment</span><span>—</span></div>}
        {autocharge && <div className="row"><span>{isRepeat ? 'Charged each time' : 'Charged at pickup'}</span><span>{formatMoney(payTotal, currency)}</span></div>}
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
          <div id="card-container" className="card-box" style={{ display: usingNewCard && !couponFree ? 'block' : 'none', marginTop: 8 }} />
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
