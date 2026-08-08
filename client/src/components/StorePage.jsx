import React, { useMemo, useState } from 'react';
import { api } from '../api.js';

const DAY_LABELS = [['Mon', 'MON'], ['Tue', 'TUE'], ['Wed', 'WED'], ['Thu', 'THU'], ['Fri', 'FRI'], ['Sat', 'SAT'], ['Sun', 'SUN']];
const FORM_TABS = [
  { key: 'enquiry', label: 'Enquiry' },
  { key: 'feedback', label: 'Feedback' },
  { key: 'catering', label: 'Catering' },
];

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
      const text = periods.length
        ? periods.map((p) => `${fmtTime(p.start)} – ${fmtTime(p.end)}`).join(', ')
        : 'Closed';
      return { label, text, today: i === todayIdx };
    });
  }, [weekly, todayIdx]);

  const reviewUrl = config.googleReviewUrl || '';
  const supportMsg = config.supportMessage
    || 'Love your coffee? A quick Google review helps our little café more than you know — thank you for supporting local. ☕';

  // ---- Contact form ----
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
    <main className="page store-page">
      <button className="link" onClick={onBack}>← Menu</button>

      {config.storePhoto && (
        <div className="store-hero">
          <img src={config.storePhoto} alt={config.storeName || 'Our café'} />
        </div>
      )}

      <h2 style={{ marginBottom: 4 }}>{config.storeName || 'Bean Culture'}</h2>
      {config.bio && <p className="muted" style={{ marginTop: 0, whiteSpace: 'pre-line' }}>{config.bio}</p>}

      {/* Quick actions */}
      <div className="store-actions">
        {tel && <a className="btn ghost" href={`tel:${tel}`} onClick={() => onTrack && onTrack('contact_phone')}>Call</a>}
        {dirUrl && <a className="btn ghost" href={dirUrl} target="_blank" rel="noreferrer" onClick={() => onTrack && onTrack('contact_dir')}>Directions</a>}
        {mapsUrl && <a className="btn ghost" href={mapsUrl} target="_blank" rel="noreferrer" onClick={() => onTrack && onTrack('contact_map')}>Map</a>}
      </div>

      {address && (
        <div className="store-card">
          <div className="group-title">Find us</div>
          <p style={{ margin: 0 }}>{address}</p>
        </div>
      )}

      {hoursRows.length > 0 && (
        <div className="store-card">
          <div className="group-title">Opening hours</div>
          <div className="hours-table">
            {hoursRows.map((r) => (
              <div key={r.label} className={`hours-row ${r.today ? 'today' : ''}`}>
                <span>{r.label}{r.today ? ' · today' : ''}</span>
                <span>{r.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Support / Google review */}
      {reviewUrl && (
        <div className="store-card support-card">
          <div style={{ fontSize: 22 }}>🌟</div>
          <p style={{ margin: '6px 0 12px' }}>{supportMsg}</p>
          <a className="btn full" href={reviewUrl} target="_blank" rel="noreferrer" onClick={() => onTrack && onTrack('review_click')}>Leave a Google review</a>
        </div>
      )}

      {/* Contact / feedback / catering */}
      <div className="store-card">
        <div className="group-title">Get in touch</div>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          Questions, catering, or something we missed — send it straight to management. We’ll get back to you.
        </p>
        {sent ? (
          <div className="gc-result" style={{ padding: '8px 0' }}>
            <div className="tick" style={{ width: 48, height: 48, fontSize: 24 }}>✓</div>
            <h3 className="serif" style={{ margin: '8px 0 4px' }}>Thanks — message sent</h3>
            <p className="muted" style={{ fontSize: 13 }}>We’ve passed it to the team.</p>
            <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => setSent(false)}>Send another</button>
          </div>
        ) : (
          <>
            <div className="segmented three" style={{ marginBottom: 10 }}>
              {FORM_TABS.map((t) => (
                <button key={t.key} type="button" className={tab === t.key ? 'seg active' : 'seg'} onClick={() => setTab(t.key)}>{t.label}</button>
              ))}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label className="field"><span>Your name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" /></label>
              <label className="field"><span>Email or phone</span><input value={cField} onChange={(e) => setCField(e.target.value)} placeholder="So we can reply" /></label>
              <label className="field"><span>Message</span><textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder={placeholder} /></label>
              {error && <p className="error-text">{error}</p>}
              <button className="btn full" disabled={busy} onClick={submit}>{busy ? 'Sending…' : 'Send message'}</button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
