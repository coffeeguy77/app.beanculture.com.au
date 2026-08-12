// Optional notifications for reservations: SMS via Twilio and email via Resend.
// Both are config-driven — if the env vars aren't set, the call is a no-op, so
// the app works with any combination (or none) configured.

const TW_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TW_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const TW_FROM = process.env.TWILIO_FROM || '';
const OWNER_PHONE = process.env.RESERVATION_OWNER_PHONE || '';

const RESEND_KEY = process.env.RESEND_API_KEY || '';
const EMAIL_FROM = process.env.RESERVATION_EMAIL_FROM || '';
const OWNER_EMAIL = process.env.RESERVATION_OWNER_EMAIL || '';

const smsConfigured = !!(TW_SID && TW_TOKEN && TW_FROM);
const emailConfigured = !!(RESEND_KEY && EMAIL_FROM);

async function sendSMS(to, body) {
  if (!smsConfigured || !to) return false;
  try {
    const auth = Buffer.from(`${TW_SID}:${TW_TOKEN}`).toString('base64');
    const params = new URLSearchParams({ To: to, From: TW_FROM, Body: String(body).slice(0, 640) });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    if (!res.ok) { console.error('[notify] SMS failed', res.status, (await res.text()).slice(0, 200)); return false; }
    return true;
  } catch (e) { console.error('[notify] SMS error', e.message); return false; }
}

async function sendEmail(to, subject, text) {
  if (!emailConfigured || !to) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, text }),
    });
    if (!res.ok) { console.error('[notify] email failed', res.status, (await res.text()).slice(0, 200)); return false; }
    return true;
  } catch (e) { console.error('[notify] email error', e.message); return false; }
}

// Fire off all configured notifications for a new reservation (best-effort).
// opts.ownerEmail (set from the admin's "Reservation notification email" field)
// takes precedence over the RESERVATION_OWNER_EMAIL env var, so the owner can
// point booking copies at any address without a redeploy.
async function reservationNotify(r, opts) {
  const ownerEmail = (opts && opts.ownerEmail && String(opts.ownerEmail).trim()) || OWNER_EMAIL;
  const when = r.reserveAt ? new Date(r.reserveAt).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: process.env.SEASON_TZ || 'Australia/Sydney' }) : 'soon';
  const line = `${r.party || '?'} guest(s) · ${when}${r.name ? ` · ${r.name}` : ''}${r.phone ? ` · ${r.phone}` : ''}`;
  const results = await Promise.allSettled([
    sendSMS(OWNER_PHONE, `New table reservation: ${line}${r.notes ? ` — ${r.notes}` : ''}`),
    r.phone ? sendSMS(r.phone, `Thanks${r.name ? ` ${r.name}` : ''}! Your table for ${r.party || ''} on ${when} at Bean Culture is received — we’ll confirm shortly.`) : Promise.resolve(false),
    sendEmail(ownerEmail, `New reservation — ${line}`, `New table reservation\n\nGuests: ${r.party}\nWhen: ${when}\nName: ${r.name || '—'}\nPhone: ${r.phone || '—'}\nEmail: ${r.email || '—'}\nNotes: ${r.notes || '—'}`),
  ]);
  return {
    ownerSms: results[0].value === true,
    customerSms: results[1].value === true,
    ownerEmail: results[2].value === true,
  };
}

module.exports = { sendSMS, sendEmail, reservationNotify, smsConfigured, emailConfigured };
