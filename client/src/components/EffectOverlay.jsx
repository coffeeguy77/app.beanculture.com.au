import React, { useEffect, useRef } from 'react';
import { runEffect } from '../effectEngine.js';

// Reusable decorative particle overlay — the ONE renderer behind every effect
// (built-in or admin-authored in the Effect Builder). Takes a preset object
// (see effectEngine.resolvePreset for the shape) rather than a hardcoded
// event name, so a preset can be attached to a seasonal event, a permanent
// theme, or a customer's own choice without any per-event code.
//
// Same guarantees as before: one <canvas>, position:fixed, aria-hidden,
// pointer-events:none, no layout shift, pauses on document.hidden, honours
// prefers-reduced-motion (static glow only, never disabled outright unless
// the preset's accessibility.reducedMotionMode is 'off').
export default function EffectOverlay({ preset, active = true, reducedMotion = false }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!active || !preset) return undefined;
    if (reducedMotion && (preset.accessibility?.reducedMotionMode || 'static-glow') === 'off') return undefined;
    if (reducedMotion) return undefined; // static glow is rendered by the JSX branch below, no canvas needed
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    return runEffect(canvas, preset, { reducedMotion: false });
  }, [preset, active, reducedMotion]);

  if (!active || !preset) return null;

  const mode = preset.accessibility?.reducedMotionMode || 'static-glow';
  if (reducedMotion) {
    if (mode === 'off') return null;
    const glowColor = preset.glowColorHex || preset.appearance?.colors?.[0] || preset.appearance?.glowColors?.[0] || '#ffffff';
    return (
      <div
        className="fx-glow"
        aria-hidden="true"
        style={{ background: `radial-gradient(circle at 50% 100%, ${glowColor}55, transparent 70%)` }}
      />
    );
  }

  return <canvas ref={canvasRef} className="fx-canvas effect-overlay" aria-hidden="true" />;
}
