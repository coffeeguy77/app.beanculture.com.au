import React, { useEffect, useState } from 'react';

export default function Admin({ onExit }) {
  const [pass, setPass] = useState('');
  const [needPass, setNeedPass] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [json, setJson] = useState('');
  const [copied, setCopied] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [upBusy, setUpBusy] = useState(false);
  const [upUrl, setUpUrl] = useState('');
  const [upErr, setUpErr] = useState('');

  async function syncNow() {
    setSyncMsg('Syncing…');
    try {
      const r = await fetch(`/api/admin/sync?pass=${encodeURIComponent(pass)}`, { method: 'POST' });
      setSyncMsg(r.ok ? 'Menu re-synced from Square.' : 'Sync failed.');
    } catch {
      setSyncMsg('Sync failed.');
    }
    setTimeout(() => setSyncMsg(''), 3500);
  }

  function uploadImage(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setUpBusy(true); setUpErr(''); setUpUrl('');
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const r = await fetch(`/api/admin/upload?pass=${encodeURIComponent(pass)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataUri: reader.result, folder: 'banners' }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Upload failed');
        setUpUrl(d.url);
      } catch (err) {
        setUpErr(err.message);
      } finally {
        setUpBusy(false);
      }
    };
    reader.readAsDataURL(file);
  }

  async function load(p) {
    setError('');
    try {
      const res = await fetch(`/api/admin/overview?pass=${encodeURIComponent(p || '')}`);
      if (res.status === 401) { setNeedPass(true); return; }
      const d = await res.json();
      setData(d);
      setJson(JSON.stringify(d.settings, null, 2));
      setNeedPass(false);
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(''); }, []);

  function copyJson() {
    navigator.clipboard?.writeText(json).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }

  if (needPass) {
    return (
      <div className="app"><main className="page">
        <h2>Merchant portal</h2>
        <label className="field"><span>Passcode</span><input type="password" value={pass} onChange={(e) => setPass(e.target.value)} /></label>
        <button className="btn full" style={{ marginTop: 12 }} onClick={() => load(pass)}>Enter</button>
        {error && <p className="error-text">{error}</p>}
        <button className="link center-link" onClick={onExit}>← Back to store</button>
      </main></div>
    );
  }
  if (!data) return <div className="app"><div className="center-screen"><div className="spinner" /></div></div>;

  const h = data.hours || {};
  return (
    <div className="app"><main className="page">
      <button className="link" onClick={onExit}>← Store</button>
      <h2>Merchant portal</h2>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="group-title">Store status</div>
        <div style={{ fontSize: 18, fontWeight: 800, color: h.open ? '#2e7d51' : 'var(--brand)' }}>
          {h.open ? '● Open now' : '● Closed'}
        </div>
        <div className="muted" style={{ fontSize: 13 }}>
          {h.timezone} · {h.hasHours ? 'hours synced from Square' : 'no business hours set in Square'}
          {h.nextOpen ? ` · next open ${h.nextOpen.day} ${h.nextOpen.time?.slice(0,5)}` : ''}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="group-title">Tools</div>
        <button className="btn full" onClick={syncNow}>Sync menu from Square now</button>
        {syncMsg && <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>{syncMsg}</p>}
        <div style={{ marginTop: 16 }}>
          <div className="group-title">Upload banner / image</div>
          <input type="file" accept="image/*" onChange={uploadImage} disabled={upBusy} />
          {upBusy && <p className="muted">Uploading…</p>}
          {upErr && <p className="error-text">{upErr}</p>}
          {upUrl && (
            <div style={{ marginTop: 8 }}>
              <p className="muted" style={{ fontSize: 12, wordBreak: 'break-all' }}>{upUrl}</p>
              <button className="btn ghost full" onClick={() => navigator.clipboard && navigator.clipboard.writeText(upUrl)}>
                Copy image URL
              </button>
            </div>
          )}
          <p className="muted" style={{ fontSize: 12 }}>
            {!data.cloudinary
              ? 'Add CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET in Railway to enable uploads.'
              : 'Paste the URL into a hero slide’s "bg" as: url(THE_URL) center/cover'}
          </p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="group-title">Live menu categories ({data.categories.length})</div>
        {data.categories.map((c) => (
          <div key={c.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
            <span>{c.name}</span><span className="muted">{c.count} items</span>
          </div>
        ))}
        <p className="muted" style={{ fontSize: 12 }}>Menu, prices and sold-out status are controlled in Square and sync automatically.</p>
      </div>

      <div className="card">
        <div className="group-title">Theme · hero · announcement</div>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          Edit the settings below, copy it, and paste into the <b>SETTINGS_JSON</b> variable in Railway to publish. (A live in-app editor with a database is the next upgrade.)
        </p>
        <textarea value={json} onChange={(e) => setJson(e.target.value)} rows={14}
          style={{ width: '100%', fontFamily: 'monospace', fontSize: 12, border: '1px solid var(--line)', borderRadius: 12, padding: 12 }} />
        <button className="btn full" style={{ marginTop: 10 }} onClick={copyJson}>{copied ? 'Copied ✓' : 'Copy SETTINGS_JSON'}</button>
      </div>
    </main></div>
  );
}
