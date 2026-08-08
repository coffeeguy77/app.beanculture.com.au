import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import ScheduleWhen from './ScheduleWhen.jsx';

const pad = (n) => String(n).padStart(2, '0');
const DAY_LABELS = [['Mon', 'MON'], ['Tue', 'TUE'], ['Wed', 'WED'], ['Thu', 'THU'], ['Fri', 'FRI'], ['Sat', 'SAT'], ['Sun', 'SUN']];
function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':');
  let hh = parseInt(h, 10);
  const ap = hh >= 12 ? 'pm' : 'am';
  hh = hh % 12; if (hh === 0) hh = 12;
  return m === '00' ? `${hh}${ap}` : `${hh}:${m}${ap}`;
}
function firstOpen(hours) {
  const openDays = hours?.openDays || null;
  const now = new Date();
  for (let i = 0; i < 90; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    if (!openDays || openDays.includes(d.getDay())) return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export default function ReservationForm({ config, user, onBack, onTrack }) {
  const [name, setName] = useState(user?.name || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [email, setEmail] = useState('');
  const [party, setParty] = useState(2);
  const [date, setDate] = useState(() => firstOpen(config.hours));
  const [time, setTime] = useState('18:00');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [captcha, setCaptcha] = useState(null);
  const [answer, setAnswer] = useState('');
  const [company, setCompany] = useState('');

  function loadCaptcha() { api.getCaptcha().then(setCaptcha).catch(() => setCaptcha(null)); }
  useEffect(() => { loadCaptcha(); }, []);

  const weekly = config.hours?.weekly || null;
  const storeOpen = config.hours ? config.hours.open : null; // server-computed, honours closures
  const nextLabel = config.hours?.nextOpen?.label;
  const todayIdx = (new Date().getDay() + 6) % 7;
  const hoursRows = useMemo(() => {
    if (!weekly) return [];
    return DAY_LABELS.map(([label, key], i) => {
      const periods = (weekly[key] || []).filter((p) => p.start);
      const text = periods.length ? periods.map((p) => `${fmtTime(p.start)} – ${fmtTime(p.end)}`).join(', ') : 'Closed';
      return { label, text, today: i === todayIdx, closed: !periods.length };
    });
  }, [weekly, todayIdx]);

  async function submit() {
    if (!name.trim()) { setError('Please add your name.'); return; }
    if (!phone.trim()) { setError('Please add a contact number.'); return; }
    if (!answer.trim()) { setError('Please answer the quick maths question.'); return; }
    setBusy(true); setError('');
    try {
      const at = new Date(`${date}T${time}`).toISOString();
      await api.reserve({ name, phone, email, party, at, notes, captchaToken: captcha?.token, captchaAnswer: answer, company });
      setDone(true);
      onTrack && onTrack('reservation');
    } catch (e) {
      setError(e.message || 'Could not book — please try again.');
      loadCaptcha(); setAnswer('');
    } finally { setBusy(false); }
  }

  if (done) {
    const when = new Date(`${date}T${time}`).toLocaleString('en-AU', { weekday: 'long', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    return (
      <main className="reserve-page">
        <button className="link reserve-back" onClick={onBack}>← Menu</button>
        <div className="reserve-card reserve-done">
          <span className="tick">✓</span>
          <h2 className="serif">Reservation received</h2>
          <p className="muted">Table for {party} · {when}. We’ll confirm shortly{phone ? ` on ${phone}` : ''}.</p>
          <button className="btn full" onClick={onBack}>Back to menu</button>
        </div>
      </main>
    );
  }

  return (
    <main className="reserve-page">
      <button className="link reserve-back" onClick={onBack}>← Menu</button>

      <div className="reserve-grid">
        {/* Intro / reassurance panel — fills desktop width, stacks on mobile */}
        <aside className="reserve-intro">
          <h1 className="reserve-title serif">Reserve a table</h1>
          <p className="reserve-lede">Book ahead and we’ll have your table ready. We’ll confirm by text or a quick call.</p>
          <ul className="reserve-points">
            <li><span className="rp-ic" aria-hidden="true">✓</span> Pick your day, time &amp; party size</li>
            <li><span className="rp-ic" aria-hidden="true">✓</span> Special requests welcome — high chairs, birthdays, access</li>
            <li><span className="rp-ic" aria-hidden="true">✓</span> A friendly confirmation before you arrive</li>
          </ul>
          {hoursRows.length > 0 && (
            <div className="reserve-hours">
              <div className="reserve-hours-head">
                <span>Opening hours</span>
                {typeof storeOpen === 'boolean' && (
                  <span className={`hours-status ${storeOpen ? 'open' : 'closed'}`}>{storeOpen ? 'Open now' : 'Closed'}</span>
                )}
              </div>
              {storeOpen === false && nextLabel && (
                <p className="reserve-hours-note muted">Reopens {nextLabel}.</p>
              )}
              {hoursRows.map((r) => (
                <div key={r.label} className={`reserve-hours-row ${r.today ? 'today' : ''}`}>
                  <span>{r.label}{r.today && <em>Today</em>}</span>
                  <span className={r.closed ? 'muted' : ''}>{r.text}</span>
                </div>
              ))}
            </div>
          )}
        </aside>

        {/* Form card */}
        <section className="reserve-card">
          <div className="reserve-form">
            <div className="reserve-two">
              <label className="field"><span className="req">Your name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" /></label>
              <label className="field"><span className="req">Contact number</span><input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="04XX XXX XXX" /></label>
            </div>
            <label className="field"><span>Email (optional)</span><input inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="For a confirmation email" /></label>

            <div className="field"><span>Party size</span>
              <div className="stepper" style={{ width: 'fit-content', marginTop: 4 }}>
                <button type="button" onClick={() => setParty((p) => Math.max(1, p - 1))} aria-label="Fewer">−</button>
                <span style={{ minWidth: 64, textAlign: 'center' }}>{party} {party === 1 ? 'guest' : 'guests'}</span>
                <button type="button" onClick={() => setParty((p) => Math.min(50, p + 1))} aria-label="More">+</button>
              </div>
            </div>

            <div className="field" style={{ gap: 6 }}><span>When</span>
              <ScheduleWhen hours={config.hours} date={date} time={time} onDate={setDate} onTime={setTime} maxDays={30} />
            </div>

            <label className="field"><span>Anything we should know? (optional)</span>
              <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="High chair, birthday, accessibility…" /></label>

            <input className="hp-field" tabIndex={-1} autoComplete="off" aria-hidden="true" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company" />
            <label className="field"><span>Quick check: what is {captcha ? captcha.question : '…'}?</span>
              <input inputMode="numeric" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Answer" /></label>

            {error && <p className="error-text">{error}</p>}
            <button className="btn full reserve-submit" disabled={busy} onClick={submit}>{busy ? 'Booking…' : 'Request reservation'}</button>
          </div>
        </section>
      </div>
    </main>
  );
}
