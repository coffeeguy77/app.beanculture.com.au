import React, { useMemo } from 'react';

// Festive overlays driven by the active theme's `effects` flags.
// Purely decorative and pointer-events:none so it never blocks the UI.
export default function SeasonalEffects({ effects }) {
  const flakes = useMemo(() => {
    const chars = ['❄', '❅', '•', '✦'];
    return Array.from({ length: 64 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      size: 6 + Math.random() * 12,
      dur: 6 + Math.random() * 9,
      delay: -Math.random() * 12,
      drift: (Math.random() * 2 - 1) * 40,
      char: chars[Math.floor(Math.random() * chars.length)],
      op: 0.4 + Math.random() * 0.6,
    }));
  }, []);

  const bulbs = useMemo(() => {
    const colors = ['#ff3b30', '#34c759', '#ffd60a', '#ff9f0a', '#ffffff'];
    return Array.from({ length: 22 }, (_, i) => ({
      id: i,
      color: colors[i % colors.length],
      delay: (i % 5) * 0.28,
    }));
  }, []);

  const ornaments = useMemo(() => {
    const set = ['🔴', '🟢', '🎄', '🔔', '⭐', '🎁'];
    return Array.from({ length: 12 }, (_, i) => ({
      id: i,
      emoji: set[i % set.length],
      len: 14 + (i % 3) * 8,
      delay: (i % 4) * 0.5,
    }));
  }, []);

  if (!effects || (!effects.snow && !effects.lights && !effects.ornaments)) return null;

  return (
    <div className="fx" aria-hidden="true">
      {effects.lights && (
        <div className="fx-lights">
          <div className="fx-wire" />
          {bulbs.map((b) => (
            <span
              key={b.id}
              className="fx-bulb"
              style={{ '--c': b.color, animationDelay: `${b.delay}s` }}
            />
          ))}
        </div>
      )}

      {effects.ornaments && (
        <div className="fx-ornaments">
          {ornaments.map((o) => (
            <span key={o.id} className="fx-orn" style={{ animationDelay: `${o.delay}s` }}>
              <i className="fx-orn-string" style={{ height: o.len }} />
              <b className="fx-orn-ball">{o.emoji}</b>
            </span>
          ))}
        </div>
      )}

      {effects.snow && (
        <div className="fx-snow">
          {flakes.map((f) => (
            <span
              key={f.id}
              className="fx-flake"
              style={{
                left: `${f.left}%`,
                fontSize: `${f.size}px`,
                opacity: f.op,
                animationDuration: `${f.dur}s`,
                animationDelay: `${f.delay}s`,
                '--drift': `${f.drift}px`,
              }}
            >
              {f.char}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
