import React, { useEffect, useState } from 'react';

// "Add to Home Screen". Android/desktop Chrome fire beforeinstallprompt; iOS
// Safari can't prompt programmatically, so we show the Share → Add steps.
export default function InstallButton() {
  const [deferred, setDeferred] = useState(null);
  const [installed, setInstalled] = useState(false);
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); setDeferred(e); };
    const onInstalled = () => setInstalled(true);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const standalone = typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone);
  const isIos = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);

  if (installed || standalone) return null;
  if (!deferred && !isIos) return null; // nothing to offer (already installable-only on supported browsers)

  async function onClick() {
    if (deferred) {
      deferred.prompt();
      try { await deferred.userChoice; } catch {}
      setDeferred(null);
    } else {
      setIosHint((v) => !v);
    }
  }

  return (
    <div className="install-cta">
      <button className="btn ghost full" onClick={onClick} type="button">＋ Add Bean Culture to your home screen</button>
      {iosHint && (
        <p className="muted" style={{ fontSize: 13, marginTop: 8, textAlign: 'center' }}>
          Tap the Share icon, then “Add to Home Screen”.
        </p>
      )}
    </div>
  );
}
