import React, { useState } from 'react';

const fmtShortDay = (iso) => {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
};

// A small themed SVG bar chart — gridlines, axis labels, always-on value
// labels for short ranges, and a floating tooltip for longer ones. Built by
// hand (no chart library) so it stays tiny and matches the store's own theme
// colours (including seasonal theme swaps) automatically via CSS vars.
export function BarChart({
  data, // [{ day, value, value2 }]
  color = 'var(--brand)',
  color2,
  legend,
  formatValue = (v) => String(v),
  formatAxis = formatValue,
  formatDay = fmtShortDay,
  height = 168,
  emptyText = 'No data in this period.',
}) {
  const [hover, setHover] = useState(null);
  if (!data || data.length === 0) return <div className="ins-chart-empty">{emptyText}</div>;

  const n = data.length;
  const max = Math.max(1, ...data.map((d) => Math.max(d.value || 0, d.value2 || 0)));
  const w = Math.max(n * 24, 240);
  const padL = 40, padB = 22, padT = 14;
  const plotH = height - padT - padB;
  const gridLines = 4;
  const gap = (w - padL) / n;
  const barW = Math.max(3, gap * 0.55);
  const showLabels = n <= 9;
  const labelEvery = n <= 8 ? 1 : n <= 16 ? 2 : n <= 40 ? Math.ceil(n / 8) : Math.ceil(n / 6);

  return (
    <div className="ins-chart-wrap">
      <svg viewBox={`0 0 ${w} ${height}`} className="ins-chart-svg" preserveAspectRatio="none">
        {[...Array(gridLines + 1)].map((_, i) => {
          const y = padT + (plotH / gridLines) * i;
          const v = Math.round(max - (max / gridLines) * i);
          return (
            <g key={i}>
              <line x1={padL} x2={w} y1={y} y2={y} className="ins-grid-line" />
              <text x={padL - 6} y={y + 3} className="ins-grid-label" textAnchor="end">{formatAxis(v)}</text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const x = padL + gap * i + (gap - barW) / 2;
          const bh = Math.max(1.5, ((d.value || 0) / max) * plotH);
          const y = padT + plotH - bh;
          const bh2 = d.value2 != null ? Math.max(1.5, ((d.value2 || 0) / max) * plotH) : null;
          const active = hover === i;
          return (
            <g key={i}
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover((h) => (h === i ? null : h))}
              onTouchStart={() => setHover(i)}>
              <rect x={x - gap * 0.22} y={padT} width={barW + gap * 0.44} height={plotH} fill="transparent" />
              {bh2 != null && (
                <rect x={x} y={padT + plotH - bh2} width={barW} height={bh2} rx={2.5} fill={color2} />
              )}
              <rect x={x} y={y} width={barW} height={bh} rx={2.5} fill={color} opacity={active ? 1 : 0.9} className="ins-bar" />
              {active && <rect x={x} y={y} width={barW} height={bh} rx={2.5} fill={color} className="ins-bar-active" />}
              {showLabels && (
                <text x={x + barW / 2} y={y - 5} textAnchor="middle" className="ins-bar-label">{formatValue(d.value)}</text>
              )}
              {i % labelEvery === 0 && (
                <text x={x + barW / 2} y={height - 4} textAnchor="middle" className="ins-x-label">{formatDay(d.day)}</text>
              )}
            </g>
          );
        })}
      </svg>
      {hover != null && data[hover] && !showLabels && (
        <div className="ins-tooltip" style={{ left: `${((hover + 0.5) / n) * 100}%` }}>
          <strong>{formatDay(data[hover].day)}</strong>
          <span>{formatValue(data[hover].value)}{data[hover].value2 != null ? ` · ${formatValue(data[hover].value2)}` : ''}</span>
        </div>
      )}
      {legend && (
        <div className="chart-legend">
          {legend.map((l) => <span key={l.label}><i className="sw" style={{ background: l.swatch }} /> {l.label}</span>)}
        </div>
      )}
    </div>
  );
}

// Donut chart — each stage sized to its raw count, so the biggest drop-off in
// the funnel is obvious at a glance. Center shows the headline conversion.
export function DonutChart({ segments, size = 168, thickness = 24, centerLabel, centerValue }) {
  const total = Math.max(1, segments.reduce((s, x) => s + (x.value || 0), 0));
  const r = (size - thickness) / 2;
  const cx = size / 2, cy = size / 2;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  const arcs = segments.map((s) => {
    const frac = (s.value || 0) / total;
    const len = Math.max(0, frac * circumference - 1.5); // small gap between slices
    const dashoffset = -offset;
    offset += frac * circumference;
    return { ...s, len, dashoffset };
  });
  return (
    <div className="donut-wrap">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="donut-svg">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--line)" strokeWidth={thickness} />
        {arcs.map((s, i) => (
          <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={s.color} strokeWidth={thickness}
            strokeDasharray={`${s.len} ${circumference - s.len}`} strokeDashoffset={s.dashoffset}
            strokeLinecap="round" transform={`rotate(-90 ${cx} ${cy})`} className="donut-arc" />
        ))}
        <text x={cx} y={cy - 3} textAnchor="middle" className="donut-center-v">{centerValue}</text>
        <text x={cx} y={cy + 15} textAnchor="middle" className="donut-center-l">{centerLabel}</text>
      </svg>
      <div className="donut-legend">
        {segments.map((s) => (
          <div key={s.label} className="donut-legend-row">
            <i className="donut-sw" style={{ background: s.color }} />
            <span className="donut-legend-label">{s.label}</span>
            <span className="donut-legend-v">{s.value}{s.pct != null ? ` · ${s.pct}%` : ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
