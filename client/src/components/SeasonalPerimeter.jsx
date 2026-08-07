import React from 'react';
import { Bell, Holly, Pine } from './christmas/assets.jsx';

// Reusable decorative perimeter driven by decoration ZONES. A seasonal theme
// registers assets against zones; here we render the Christmas set. Purely
// decorative: pointer-events:none, aria-hidden, sits below sheets (z 60) and
// never blocks controls.
export default function SeasonalPerimeter({ id, decor }) {
  if (id !== 'christmas' || !decor?.perimeter) return null;

  const wrap = {
    position: 'fixed', inset: 0, maxWidth: 'var(--app-w)', left: '50%',
    transform: 'translateX(-50%)', pointerEvents: 'none', zIndex: 52, overflow: 'hidden',
  };
  const string = { width: 1, height: 12, background: 'rgba(216,169,59,0.6)', margin: '0 auto' };

  return (
    <div style={wrap} aria-hidden="true">
      {/* HEADER_TOP — garland across the top */}
      <div style={{ position: 'absolute', top: 'calc(-6px + env(safe-area-inset-top))', left: 0, right: 0 }}>
        <Pine w={640} h={30} />
      </div>

      {/* HEADER_LEFT / HEADER_RIGHT — corner holly */}
      <div style={{ position: 'absolute', top: 'calc(2px + env(safe-area-inset-top))', left: 2 }}><Holly size={34} /></div>
      <div style={{ position: 'absolute', top: 'calc(2px + env(safe-area-inset-top))', right: 2, transform: 'scaleX(-1)' }}><Holly size={34} /></div>

      {/* Hanging gold bells */}
      <div style={{ position: 'absolute', top: 'calc(0px + env(safe-area-inset-top))', left: '22%' }}>
        <div style={string} /><Bell size={26} />
      </div>
      <div style={{ position: 'absolute', top: 'calc(-2px + env(safe-area-inset-top))', right: '20%' }}>
        <div style={string} /><Bell size={30} />
      </div>
    </div>
  );
}
