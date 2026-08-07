import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

// Camera QR scanner. Opens the rear camera, scans frames for a QR code and
// returns its decoded text via onResult. Cleans up the stream on close.
export default function QRScanner({ onResult, onClose }) {
  const videoRef = useRef(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let stream = null;
    let raf = 0;
    let done = false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    async function start() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setErr('Camera not available on this device.');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (done) { stream.getTracks().forEach((t) => t.stop()); return; }
        const v = videoRef.current;
        if (!v) return;
        v.srcObject = stream;
        await v.play();
        const tick = () => {
          if (done) return;
          const vid = videoRef.current;
          if (vid && vid.readyState === vid.HAVE_ENOUGH_DATA && vid.videoWidth) {
            canvas.width = vid.videoWidth;
            canvas.height = vid.videoHeight;
            ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
            if (code && code.data) { done = true; onResult(code.data); return; }
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch (e) {
        setErr(
          e && e.name === 'NotAllowedError'
            ? 'Camera permission denied. You can type your table number instead.'
            : 'Could not open the camera. Type your table number instead.'
        );
      }
    }
    start();
    return () => {
      done = true;
      if (raf) cancelAnimationFrame(raf);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [onResult]);

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="scanner" onClick={(e) => e.stopPropagation()}>
        <button className="sheet-close" onClick={onClose} aria-label="Close">✕</button>
        <div className="scanner-head">Scan your table QR</div>
        {err ? (
          <p className="error-text" style={{ padding: '4px 18px 18px' }}>{err}</p>
        ) : (
          <>
            <div className="scanner-video-wrap">
              <video ref={videoRef} playsInline muted className="scanner-video" />
              <div className="scanner-frame" />
            </div>
            <p className="muted scanner-hint">Point your camera at the QR code on your table.</p>
          </>
        )}
      </div>
    </div>
  );
}
