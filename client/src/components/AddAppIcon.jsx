import React, { useEffect, useState } from 'react';

// Visual "Add app icon" guide — shows the tap-by-tap steps to add the web app
// to a phone/desktop home screen, per platform. Where the browser supports it
// (Android / desktop Chromium), it also offers the one-tap native install.

const G = ({ children, size = 26 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);

// iOS Share (box open at top with an up arrow)
const ShareGlyph = () => (
  <G><path d="M12 14.5V3.8" /><path d="M8.5 7.2 12 3.6l3.5 3.6" />
    <path d="M7 10.2H5.6A1.6 1.6 0 0 0 4 11.8v6.6A1.6 1.6 0 0 0 5.6 20h12.8a1.6 1.6 0 0 0 1.6-1.6v-6.6a1.6 1.6 0 0 0-1.6-1.6H17" /></G>
);
// Add-to-home / plus-in-square
const PlusSquareGlyph = () => (
  <G><rect x="4" y="4" width="16" height="16" rx="4.2" /><path d="M12 8.4v7.2M8.4 12h7.2" /></G>
);
// Android/desktop kebab menu (three dots)
const KebabGlyph = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" />
  </svg>
);
// Desktop install (monitor + down arrow into tray)
const InstallGlyph = () => (
  <G><rect x="3" y="4.5" width="18" height="12" rx="2.2" /><path d="M8.5 20h7" />
    <path d="M12 8.3v4.4M9.6 10.6 12 13l2.4-2.4" /></G>
);
// Home-screen grid (icon now lives here)
const GridGlyph = () => (
  <G><rect x="4" y="4" width="6.6" height="6.6" rx="1.8" /><rect x="13.4" y="4" width="6.6" height="6.6" rx="1.8" />
    <rect x="4" y="13.4" width="6.6" height="6.6" rx="1.8" /><rect x="13.4" y="13.4" width="6.6" height="6.6" rx="1.8" /></G>
);
// Tap target (finger/plus)
const TapGlyph = () => (
  <G><path d="M9 11V6a1.6 1.6 0 0 1 3.2 0v5" /><path d="M12.2 11V8.6a1.5 1.5 0 0 1 3 0V11" />
    <path d="M15.2 11v-.6a1.5 1.5 0 0 1 3 0V15a5 5 0 0 1-5 5h-1.4a4.5 4.5 0 0 1-3.3-1.5L6 15.6a1.6 1.6 0 0 1 2.5-2l1 1" /></G>
);

const PLATFORMS = {
  iphone: {
    label: 'iPhone',
    sub: 'Safari',
    steps: [
      { glyph: <ShareGlyph />, title: 'Tap the Share button', body: 'The square-with-an-up-arrow icon in Safari’s bottom (or top) toolbar.' },
      { glyph: <PlusSquareGlyph />, title: 'Choose “Add to Home Screen”', body: 'Scroll the share sheet down a little — it’s in the list of actions.' },
      { glyph: <GridGlyph />, title: 'Tap “Add”', body: 'The Bean Culture icon lands on your home screen — open it any time like a normal app.' },
    ],
  },
  android: {
    label: 'Android',
    sub: 'Chrome',
    steps: [
      { glyph: <KebabGlyph />, title: 'Open the ⋮ menu', body: 'Top-right of Chrome. (Or just tap “Install app” below if it appears.)' },
      { glyph: <PlusSquareGlyph />, title: 'Tap “Add to Home screen” / “Install app”', body: 'Chrome shows one of these depending on your version.' },
      { glyph: <GridGlyph />, title: 'Confirm', body: 'Tap “Add” / “Install” — the icon appears on your home screen and app drawer.' },
    ],
  },
  desktop: {
    label: 'Desktop',
    sub: 'Chrome / Edge',
    steps: [
      { glyph: <InstallGlyph />, title: 'Click the Install icon', body: 'In the address bar (a monitor with a down arrow), or the ⋮ menu → “Install…”.' },
      { glyph: <TapGlyph />, title: 'Choose “Install Bean Culture”', body: 'Confirm in the little pop-up that appears.' },
      { glyph: <GridGlyph />, title: 'Done', body: 'It opens in its own window and pins to your taskbar or dock.' },
    ],
  },
};

function detectPlatform() {
  if (typeof navigator === 'undefined') return 'iphone';
  const ua = navigator.userAgent || '';
  if (/iphone|ipad|ipod/i.test(ua)) return 'iphone';
  if (/android/i.test(ua)) return 'android';
  return 'desktop';
}

export default function AddAppIcon({ config, storeName = 'Bean Culture', onClose }) {
  const [tab, setTab] = useState(detectPlatform);
  const [deferred, setDeferred] = useState(null);
  const [installedNote, setInstalledNote] = useState('');
  const [iconOk, setIconOk] = useState(true);

  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); setDeferred(e); };
    const onInstalled = () => { setDeferred(null); setInstalledNote('Added — check your home screen.'); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const p = PLATFORMS[tab] || PLATFORMS.iphone;
  const name = config?.storeName || storeName;

  async function installNow() {
    if (!deferred) return;
    deferred.prompt();
    try { await deferred.userChoice; } catch {}
    setDeferred(null);
  }

  return (
    <div className="backdrop aai-backdrop" onClick={onClose}>
      <div className="aai-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Add app icon">
        <button className="aai-close" onClick={onClose} aria-label="Close">✕</button>

        <div className="aai-head">
          {iconOk
            ? <img className="aai-logo aai-appicon" src="/icons/icon-192.png" alt={`${name} app icon`} onError={() => setIconOk(false)} />
            : <span className="aai-logo aai-logo-fallback">{(name[0] || 'B').toUpperCase()}</span>}
          <h2 className="aai-title">Add {name} to your home screen</h2>
          <p className="aai-sub">One tap to open it any time — no app store, no download.</p>
        </div>

        <div className="aai-tabs" role="tablist" aria-label="Choose your device">
          {Object.entries(PLATFORMS).map(([key, val]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              className={`aai-tab${tab === key ? ' on' : ''}`}
              onClick={() => setTab(key)}
            >
              {val.label}
            </button>
          ))}
        </div>
        <p className="aai-hint">{p.label} · {p.sub}</p>

        <ol className="aai-steps">
          {p.steps.map((s, i) => (
            <li className="aai-step" key={i}>
              <span className="aai-step-num">{i + 1}</span>
              <span className="aai-step-glyph">{s.glyph}</span>
              <span className="aai-step-text">
                <span className="aai-step-title">{s.title}</span>
                <span className="aai-step-body">{s.body}</span>
              </span>
            </li>
          ))}
        </ol>

        {deferred && (tab === 'android' || tab === 'desktop') && (
          <button className="aai-install" onClick={installNow} type="button">
            <InstallGlyph /> Install {name} now
          </button>
        )}
        {installedNote && <p className="aai-done">{installedNote}</p>}
      </div>
    </div>
  );
}
