import React, { useMemo, useState } from 'react';
import { api, imgUrl } from '../api.js';

const DAY_LABELS = [['Mon', 'MON'], ['Tue', 'TUE'], ['Wed', 'WED'], ['Thu', 'THU'], ['Fri', 'FRI'], ['Sat', 'SAT'], ['Sun', 'SUN']];
const FORM_TABS = [
  { key: 'enquiry', label: 'Enquiry' },
  { key: 'feedback', label: 'Feedback' },
  { key: 'catering', label: 'Catering' },
];

// Stroke icons (consistent line style, no filled/illustrated glyphs).
const Ico = ({ children, size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
const PinIcon = (p) => <Ico {...p}><path d="M12 21s-6.5-5.6-6.5-10A6.5 6.5 0 0 1 18.5 11c0 4.4-6.5 10-6.5 10Z" /><circle cx="12" cy="11" r="2.3" /></Ico>;
const PhoneIcon = (p) => <Ico {...p}><path d="M6.5 4h3l1.5 4-2 1.5a12 12 0 0 0 5 5l1.5-2 4 1.5v3a2 2 0 0 1-2 2A16 16 0 0 1 4.5 6a2 2 0 0 1 2-2Z" /></Ico>;
const NavIcon = (p) => <Ico {...p}><path d="M3 11l18-8-8 18-2-8-8-2Z" /></Ico>;
const ClockIcon = (p) => <Ico {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></Ico>;
const StarIcon = (p) => <Ico {...p}><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 17l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9L12 3.5Z" /></Ico>;
const SendIcon = (p) => <Ico {...p}><path d="M21 3 10.5 13.5M21 3l-6.5 18-4-8-8-4L21 3Z" /></Ico>;

function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':');
  let hh = parseInt(h, 10);
  const ap = hh >= 12 ? 'pm' : 'am';
  hh = hh % 12; if (hh === 0) hh = 12;
  return m === '00' ? `${hh}${ap}` : `${hh}:${m}${ap}`;
}

export default function StorePage({ config, onTrack, onBack }) {
  const contact = config.contact || {};
  const address = contact.address || '';
  const mapsUrl = contact.mapsUrl || (address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : '');
  const dirUrl = address ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}` : mapsUrl;
  const tel = (contact.phone || '').replace(/[^\d+]/g, '');
  const weekly = config.hours?.weekly || null;
  const todayIdx = (new Date().getDay() + 6) % 7; // Mon=0 … Sun=6

  const hoursRows = useMemo(() => {
    if (!weekly) return [];
    return DAY_LABELS.map(([label, key], i) => {
      const periods = (weekly[key] || []).filter((p) => p.start);
      const text = periods.length ? periods.map((p) => `${fmtTime(p.start)} – ${fmtTime(p.end)}`).join(', ') : 'Closed';
      return { label, text, today: i === todayIdx, closed: !periods.length };
    });
  }, [weekly, todayIdx]);

  const reviewUrl = config.googleReviewUrl || '';
  const supportMsg = config.supportMessage
    || 'Love your coffee? A quick Google review helps our little café more than you know — thank you for supporting local.';

  const [tab, setTab] = useState('enquiry');
  const [name, setName] = useState('');
  const [cField, setCField] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (!body.trim()) { setError('Please add a message.'); return; }
    setBusy(true); setError('');
    try {
      await api.sendMessage({ type: tab, name, contact: cField, body });
      setSent(true); setBody(''); setName(''); setCField('');
      onTrack && onTrack('message_' + tab);
    } catch (e) { setError(e.message || 'Could not send — please try again.'); }
    finally { setBusy(false); }
  }

  const placeholder = tab === 'catering'
    ? 'Tell us about your event — date, number of people, what you’d like…'
    : tab === 'feedback'
      ? 'How did we do? Anything we could improve? We read every message.'
      : 'How can we help?';

  return (
    <main className="store-page">
      <button className="link store-back" onClick={onBack}>← Menu</button>

      {config.storePhoto && (
        <div className="store-hero">
          <img src={imgUrl(config.storePhoto, 1200)} alt={config.storeName || 'Our café'} loading="eager" decoding="async" />
        </div>
      )}
      {config.bio && <p className="store-bio">{config.bio}</p>}

      <div className="store-grid">
        <div className="store-col">
          {(address || tel) && (
            <section className="store-card">
              <div className="store-card-head"><PinIcon /> Find us</div>
              {address && <p className="store-address">{address}</p>}
              <div className="store-actions">
                {tel && (
                  <a className="pill-btn" href={`tel:${tel}`} onClick={() => onTrack && onTrack('contact_phone')} aria-label="Call us">
                    <PhoneIcon size={18} /><span>Call</span>
                  </a>
                )}
                {dirUrl && (
                  <a className="pill-btn" href={dirUrl} target="_blank" rel="noreferrer" onClick={() => onTrack && onTrack('contact_dir')} aria-label="Get directions">
                    <NavIcon size={18} /><span>Directions</span>
                  </a>
                )}
              </div>
            </section>
          )}

          {hoursRows.length > 0 && (
            <section className="store-card">
              <div className="store-card-head"><ClockIcon /> Opening hours</div>
              <div className="hours-table">
                {hoursRows.map((r) => (
                  <div key={r.label} className={`hours-row ${r.today ? 'today' : ''}`}>
                    <span className="hours-day">{r.label}{r.today && <em>Today</em>}</span>
                    <span className={r.closed ? 'hours-closed' : ''}>{r.text}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="store-col">
          {reviewUrl && (
            <section className="store-card review-card">
              <span className="review-star"><StarIcon size={26} /></span>
              <p>{supportMsg}</p>
              <a className="btn store-btn" href={reviewUrl} target="_blank" rel="noreferrer" onClick={() => onTrack && onTrack('review_click')}>Leave a Google review</a>
            </section>
          )}

          <section className="store-card">
            <div className="store-card-head">Get in touch</div>
            <p className="muted store-sub">Questions, catering, or something we missed — straight to management. We’ll reply.</p>
            {sent ? (
              <div className="store-sent">
                <span className="tick">✓</span>
                <h3 className="serif">Message sent</h3>
                <p className="muted">Thanks — we’ve passed it to the team.</p>
                <button className="pill-btn" onClick={() => setSent(false)}>Send another</button>
              </div>
            ) : (
              <>
                <div className="segmented three store-tabs">
                  {FORM_TABS.map((t) => (
                    <button key={t.key} type="button" className={tab === t.key ? 'seg active' : 'seg'} onClick={() => setTab(t.key)}>{t.label}</button>
                  ))}
                </div>
                <div className="store-form">
                  <label className="field"><span>Your name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" /></label>
                  <label className="field"><span>Email or phone</span><input value={cField} onChange={(e) => setCField(e.target.value)} placeholder="So we can reply" /></label>
                  <label className="field"><span>Message</span><textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder={placeholder} /></label>
                  {error && <p className="error-text">{error}</p>}
                  <button className="btn store-btn" disabled={busy} onClick={submit}><SendIcon size={18} /> {busy ? 'Sending…' : 'Send message'}</button>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
