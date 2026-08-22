import React, { useMemo, useState } from 'react';
import { formatMoney } from '../api.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Insights — premium admin analytics dashboard.
   Pure UI refactor of the old inline insights tab. All data comes from props;
   nothing here is fabricated. Money values arrive as integer CENTS and are
   formatted via formatMoney().
   ═══════════════════════════════════════════════════════════════════════════ */

// ── Small utilities ─────────────────────────────────────────────────────────
function shortTime(date) {
  if (!date) return '';
  try {
    return new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit' }).format(date);
  } catch { return ''; }
}
function shortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return iso;
  try { return new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short' }).format(d); }
  catch { return iso; }
}
function longDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return iso;
  try { return new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }).format(d); }
  catch { return iso; }
}
function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '••';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function anonLabel(id) {
  const s = String(id || '');
  return `Member ••${s.slice(-4) || '????'}`;
}
const nf = new Intl.NumberFormat('en-AU');
const num = (n) => nf.format(Number(n || 0));

// ── Inline stroke icons ──────────────────────────────────────────────────────
const Ico = (paths) => (p) => (
  <svg width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths}</svg>
);
const IcoBag = Ico(<><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><path d="M3 6h18" /><path d="M16 10a4 4 0 0 1-8 0" /></>);
const IcoAvg = Ico(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>);
const IcoUserPlus = Ico(<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6M22 11h-6" /></>);
const IcoUsers = Ico(<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13A4 4 0 0 1 16 11" /></>);
const IcoEye = Ico(<><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" /><circle cx="12" cy="12" r="3" /></>);
const IcoDollar = Ico(<><path d="M12 1v22" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></>);
const IcoTarget = Ico(<><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>);
const IcoPhone = Ico(<><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.6A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.4-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" /></>);
const IcoRefresh = Ico(<><path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M3 22v-6h6" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" /></>);

// ── Generic card shell ───────────────────────────────────────────────────────
function DashboardCard({ title, subtitle, right, className = '', span, children }) {
  const cls = ['ins-card', span ? `ins-span-${span}` : '', className].filter(Boolean).join(' ');
  return (
    <section className={cls}>
      {(title || right) && (
        <header className="ins-card-head">
          <div>
            {title && <h3 className="ins-card-title">{title}</h3>}
            {subtitle && <p className="ins-card-sub">{subtitle}</p>}
          </div>
          {right && <div className="ins-card-right">{right}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

// ── State helpers ────────────────────────────────────────────────────────────
function Skeleton({ h = 16, w = '100%', r = 8, style }) {
  return <span className="ins-skel" style={{ height: h, width: w, borderRadius: r, ...style }} aria-hidden="true" />;
}
function EmptyState({ children }) {
  return <div className="ins-empty">{children}</div>;
}
function ErrorState({ message, onRetry }) {
  return (
    <div className="ins-error" role="alert">
      <span className="ins-error-msg">{message || 'Something went wrong.'}</span>
      {onRetry && <button type="button" className="ins-retry" onClick={onRetry}>Retry</button>}
    </div>
  );
}

// ── Header pieces ────────────────────────────────────────────────────────────
function SquareConnectionStatus({ dashboard, lastSync }) {
  const errored = dashboard && dashboard.error;
  return (
    <div className="ins-conn" title={errored ? 'Square could not be reached' : 'Live from Square'}>
      <span className={`ins-dot ${errored ? 'warn' : 'ok'}`} />
      <span className="ins-conn-label">{errored ? 'Square error' : 'Square connected'}</span>
      {!errored && lastSync && <span className="ins-conn-time">Updated {shortTime(lastSync)}</span>}
    </div>
  );
}

const RANGES = [
  { v: 1, label: '1 Day' },
  { v: 7, label: '7 Days' },
  { v: 30, label: '30 Days' },
  { v: 90, label: '90 Days' },
  { v: 365, label: '365 Days' },
];
function DateRangeSelector({ days, onDays }) {
  return (
    <div className="ins-seg" role="tablist" aria-label="Date range">
      {RANGES.map((r) => (
        <button key={r.v} type="button" role="tab" aria-selected={days === r.v}
          className={`ins-seg-btn ${days === r.v ? 'on' : ''}`} onClick={() => onDays(r.v)}>
          {r.label}
        </button>
      ))}
    </div>
  );
}

function InsightsHeader({ days, onDays, dashboard, refreshing, onRefresh, lastSync }) {
  return (
    <header className="ins-head">
      <div className="ins-head-titles">
        <span className="ins-eyebrow">STORE ANALYTICS</span>
        <h1 className="ins-h1">Insights</h1>
        <p className="ins-lede">Sales, loyalty and app performance from Square</p>
        <SquareConnectionStatus dashboard={dashboard} lastSync={lastSync} />
      </div>
      <div className="ins-head-controls">
        <DateRangeSelector days={days} onDays={onDays} />
        <button type="button" className="ins-refresh" onClick={onRefresh} disabled={refreshing}
          aria-label="Refresh data" title="Refresh">
          <span className={refreshing ? 'ins-spin' : ''}><IcoRefresh size={18} /></span>
        </button>
      </div>
    </header>
  );
}

// ── Charts ───────────────────────────────────────────────────────────────────
// Build a smooth-ish polyline path (straight segments) mapped into a box.
function linePoints(values, W, H, pad) {
  const n = values.length;
  const max = Math.max(1, ...values);
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const x = (i) => pad.l + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v) => pad.t + innerH - (v / max) * innerH;
  return { x, y, max, innerH, innerW };
}

function Sparkline({ values }) {
  const W = 220, H = 56, pad = { l: 2, r: 2, t: 6, b: 4 };
  if (!values || values.length === 0) return null;
  const { x, y } = linePoints(values, W, H, pad);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const area = `M${pad.l},${H - pad.b} L${pts.join(' L')} L${(W - pad.r)},${H - pad.b} Z`;
  const line = `M${pts.join(' L')}`;
  return (
    <svg className="ins-spark" viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="insSparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--ins-accent)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="var(--ins-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#insSparkFill)" />
      <path d={line} fill="none" stroke="var(--ins-accent)" strokeWidth="2" vectorEffect="non-scaling-stroke"
        strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function RevenueOverviewCard({ sales }) {
  if (sales && sales.error) {
    return (
      <DashboardCard title="Revenue" subtitle="Live from Square" span="2" className="ins-overview">
        <ErrorState message={sales.error === true ? 'Sales data unavailable.' : sales.error} />
      </DashboardCard>
    );
  }
  const s = sales || {};
  const cur = s.currency || 'AUD';
  const daily = s.daily || [];
  const revVals = daily.map((d) => d.revenue || 0);
  const activeDays = daily.length || 1;
  const avgPerDay = Math.round((s.revenue || 0) / activeDays);
  return (
    <DashboardCard span="2" className="ins-overview">
      <div className="ins-overview-grid">
        <div className="ins-overview-main">
          <span className="ins-metric-label">Revenue</span>
          <div className="ins-big-value">{formatMoney(s.revenue || 0, cur)}</div>
          <div className="ins-overview-meta">
            <span className="ins-chip-soft">Avg {formatMoney(avgPerDay, cur)}/day</span>
            <span className="ins-muted-sm">Across {daily.length || 0} day{daily.length === 1 ? '' : 's'} of sales</span>
          </div>
        </div>
        <div className="ins-overview-spark">
          {revVals.length ? <Sparkline values={revVals} />
            : <span className="ins-muted-sm">No completed sales in this period.</span>}
        </div>
      </div>
    </DashboardCard>
  );
}

function MetricCard({ label, value, Icon, prominent, loading }) {
  return (
    <div className={`ins-metric ${prominent ? 'prominent' : ''}`}>
      <div className="ins-metric-top">
        <span className="ins-metric-label">{label}</span>
        {Icon && <span className="ins-metric-ico"><Icon size={18} /></span>}
      </div>
      {loading ? <Skeleton h={26} w="60%" /> : <div className="ins-metric-value">{value}</div>}
    </div>
  );
}

function RevenuePerformanceChart({ sales }) {
  const s = sales || {};
  const cur = s.currency || 'AUD';
  const daily = s.daily || [];
  const W = 720, H = 260, pad = { l: 54, r: 16, t: 20, b: 30 };

  if (sales && sales.error) {
    return <DashboardCard title="Revenue performance" subtitle="Daily sales from Square" span="3">
      <ErrorState message={sales.error === true ? 'Sales data unavailable.' : sales.error} />
    </DashboardCard>;
  }
  if (daily.length === 0) {
    return <DashboardCard title="Revenue performance" subtitle="Daily sales from Square" span="3">
      <EmptyState>No completed sales in this period.</EmptyState>
    </DashboardCard>;
  }

  const vals = daily.map((d) => d.revenue || 0);
  const { x, y, max, innerH } = linePoints(vals, W, H, pad);
  const pts = daily.map((d, i) => `${x(i).toFixed(1)},${y(d.revenue || 0).toFixed(1)}`);
  const area = `M${pad.l},${H - pad.b} L${pts.join(' L')} L${(W - pad.r)},${H - pad.b} Z`;
  const line = `M${pts.join(' L')}`;
  const best = daily.reduce((a, b) => ((b.revenue || 0) > (a.revenue || 0) ? b : a), daily[0]);
  const totalOrders = daily.reduce((n, d) => n + (d.orders || 0), 0);
  const avgDaily = Math.round((s.revenue || 0) / (daily.length || 1));
  // gridlines at 0/50/100%
  const grid = [0, 0.5, 1];
  const labelStep = Math.max(1, Math.ceil(daily.length / 7));

  const chips = (
    <div className="ins-chips">
      <span className="ins-chip"><b>{formatMoney(best.revenue || 0, cur)}</b> best day</span>
      <span className="ins-chip"><b>{formatMoney(avgDaily, cur)}</b> avg / day</span>
      <span className="ins-chip"><b>{num(totalOrders)}</b> orders</span>
    </div>
  );

  return (
    <DashboardCard title="Revenue performance" subtitle="Daily sales from Square" span="3" right={chips}>
      <div className="ins-chart-wrap">
        <svg className="ins-chart" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Daily revenue chart">
          <defs>
            <linearGradient id="insRevFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--ins-accent)" stopOpacity="0.24" />
              <stop offset="100%" stopColor="var(--ins-accent)" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {grid.map((g) => {
            const gy = pad.t + innerH - g * innerH;
            return (
              <g key={g}>
                <line x1={pad.l} y1={gy} x2={W - pad.r} y2={gy} stroke="var(--ins-line)" strokeWidth="1" />
                <text x={pad.l - 8} y={gy + 4} textAnchor="end" className="ins-axis">
                  {formatMoney(Math.round(max * g), cur)}
                </text>
              </g>
            );
          })}
          <path d={area} fill="url(#insRevFill)" />
          <path d={line} fill="none" stroke="var(--ins-accent)" strokeWidth="2.5" vectorEffect="non-scaling-stroke"
            strokeLinejoin="round" strokeLinecap="round" />
          {daily.map((d, i) => (
            <g key={i}>
              <circle cx={x(i)} cy={y(d.revenue || 0)} r="3" fill="var(--ins-card)" stroke="var(--ins-accent)" strokeWidth="2" />
              {/* invisible hit target with native tooltip */}
              <rect x={x(i) - 10} y={pad.t} width="20" height={innerH} fill="transparent">
                <title>{`${longDate(d.day)} — ${formatMoney(d.revenue || 0, cur)} · ${num(d.orders || 0)} order${d.orders === 1 ? '' : 's'}`}</title>
              </rect>
              {i % labelStep === 0 && (
                <text x={x(i)} y={H - 10} textAnchor="middle" className="ins-axis">{shortDate(d.day)}</text>
              )}
            </g>
          ))}
        </svg>
      </div>
    </DashboardCard>
  );
}

function LoyaltyGrowthCard({ signups }) {
  if (signups && signups.error) {
    return <DashboardCard title="Loyalty growth" subtitle="New members over time">
      <ErrorState message={signups.error === true ? 'Signups unavailable — enable the Square loyalty program.' : signups.error} />
    </DashboardCard>;
  }
  const su = signups || {};
  const daily = su.daily || [];
  const total = su.newInRange || 0;
  const activeDays = daily.filter((d) => (d.n || 0) > 0).length;
  const avgActive = activeDays ? (total / activeDays) : 0;
  const max = Math.max(1, ...daily.map((d) => d.n || 0));
  const W = 340, H = 160, pad = { l: 6, r: 6, t: 12, b: 22 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const bw = daily.length ? Math.max(2, (innerW / daily.length) * 0.62) : 0;
  const labelStep = Math.max(1, Math.ceil(daily.length / 6));

  const right = (
    <div className="ins-chips">
      <span className="ins-chip"><b>{num(total)}</b> new</span>
      {activeDays > 0 && <span className="ins-chip"><b>{avgActive.toFixed(1)}</b> / active day</span>}
    </div>
  );

  return (
    <DashboardCard title="Loyalty growth" subtitle="New members over time" right={right}>
      {daily.length === 0 ? (
        <EmptyState>No new signups in this period.</EmptyState>
      ) : (
        <svg className="ins-chart" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Daily loyalty signups">
          {daily.map((d, i) => {
            const cx = pad.l + (daily.length <= 1 ? innerW / 2 : (i / (daily.length - 1)) * (innerW - bw)) + bw / 2;
            const h = ((d.n || 0) / max) * innerH;
            return (
              <g key={i}>
                <rect x={cx - bw / 2} y={pad.t + innerH - h} width={bw} height={Math.max(0, h)} rx="2.5"
                  fill="var(--ins-accent)" opacity={(d.n || 0) > 0 ? 0.9 : 0.15}>
                  <title>{`${longDate(d.day)} — ${num(d.n || 0)} signup${d.n === 1 ? '' : 's'}`}</title>
                </rect>
                {(d.n || 0) > 0 && (
                  <text x={cx} y={Math.max(9, pad.t + innerH - h - 4)} textAnchor="middle" className="ins-bar-count">{num(d.n)}</text>
                )}
                {i % labelStep === 0 && (
                  <text x={cx} y={H - 6} textAnchor="middle" className="ins-axis">{shortDate(d.day)}</text>
                )}
              </g>
            );
          })}
        </svg>
      )}
    </DashboardCard>
  );
}

function CustomerRow({ rank, u }) {
  const name = (u.name || '').trim();
  const display = name || anonLabel(u.id || u.customerId);
  const pts = (u.lifetime != null ? u.lifetime : u.points) || 0;
  return (
    <li className="ins-cust">
      <span className="ins-cust-rank">{rank}</span>
      <span className="ins-avatar" aria-hidden="true">{name ? initials(name) : '••'}</span>
      <span className="ins-cust-body">
        <span className="ins-cust-name" title={display}>{display}</span>
        <span className="ins-cust-id">{anonLabel(u.id || u.customerId)}</span>
      </span>
      <span className="ins-cust-metric"><b>{num(pts)}</b> pts</span>
    </li>
  );
}

function TopCustomersCard({ customers }) {
  const [expanded, setExpanded] = useState(false);
  const ranked = useMemo(() => {
    if (!Array.isArray(customers)) return null;
    return customers
      .filter((u) => (u.name && u.name.trim()) || (u.lifetime || u.points))
      .map((u) => ({ ...u, _pts: (u.lifetime != null ? u.lifetime : u.points) || 0 }))
      .sort((a, b) => b._pts - a._pts);
  }, [customers]);

  if (ranked == null) {
    return <DashboardCard title="Top customers" subtitle="By loyalty points">
      <ul className="ins-cust-list">{[0, 1, 2, 3, 4].map((i) => (
        <li className="ins-cust" key={i}><Skeleton h={40} r={10} /></li>))}</ul>
    </DashboardCard>;
  }
  if (ranked.length === 0) {
    return <DashboardCard title="Top customers" subtitle="By loyalty points">
      <EmptyState>No loyalty members yet.</EmptyState>
    </DashboardCard>;
  }
  const shown = expanded ? ranked.slice(0, 20) : ranked.slice(0, 5);
  return (
    <DashboardCard title="Top customers" subtitle="By loyalty points earned">
      <ol className="ins-cust-list">
        {shown.map((u, i) => <CustomerRow key={u.id || u.customerId || i} rank={i + 1} u={u} />)}
      </ol>
      <p className="ins-note">Anonymous walk-in customers aren’t shown.</p>
      {ranked.length > 5 && (
        <button type="button" className="ins-viewall" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Show less' : `View all (${Math.min(ranked.length, 20)})`}
        </button>
      )}
    </DashboardCard>
  );
}

function EngagementMetrics({ totals }) {
  const t = totals || {};
  const conv = t.visitors ? Math.round((t.purchases / t.visitors) * 100) : null;
  const cards = [
    { label: 'Visitors', value: num(t.visitors), Icon: IcoUsers },
    { label: 'Product views', value: num(t.productViews), Icon: IcoEye },
    { label: 'Orders', value: num(t.purchases), Icon: IcoBag },
    { label: 'Conversion', value: conv == null ? '—' : `${conv}%`, Icon: IcoTarget, prominent: true },
    { label: 'App revenue', value: formatMoney(t.revenue || 0, 'AUD'), Icon: IcoDollar, prominent: true },
    { label: 'Contact taps', value: num(t.contactClicks), Icon: IcoPhone },
  ];
  return (
    <div className="ins-eng-grid">
      {cards.map((c) => <MetricCard key={c.label} {...c} />)}
    </div>
  );
}

function VisitsOrdersChart({ daily }) {
  const data = daily || [];
  const W = 720, H = 240, pad = { l: 40, r: 16, t: 18, b: 30 };
  if (data.length === 0) {
    return <DashboardCard title="Visits & orders" subtitle="Daily app activity" span="3">
      <EmptyState>No activity recorded yet.</EmptyState>
    </DashboardCard>;
  }
  const visMax = Math.max(1, ...data.map((d) => d.views || 0));
  const ordMax = Math.max(1, ...data.map((d) => d.purchases || 0));
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const x = (i) => pad.l + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const yv = (v) => pad.t + innerH - (v / visMax) * innerH;
  const yo = (v) => pad.t + innerH - (v / ordMax) * innerH;
  const visPts = data.map((d, i) => `${x(i).toFixed(1)},${yv(d.views || 0).toFixed(1)}`);
  const visArea = `M${pad.l},${H - pad.b} L${visPts.join(' L')} L${(W - pad.r)},${H - pad.b} Z`;
  const ordLine = `M${data.map((d, i) => `${x(i).toFixed(1)},${yo(d.purchases || 0).toFixed(1)}`).join(' L')}`;
  const labelStep = Math.max(1, Math.ceil(data.length / 7));

  const legend = (
    <div className="ins-legend">
      <span><i className="ins-sw" style={{ background: 'var(--ins-accent-soft)' }} /> Visits <em>(peak {num(visMax)})</em></span>
      <span><i className="ins-sw" style={{ background: 'var(--ins-pos)' }} /> Orders <em>(peak {num(ordMax)})</em></span>
    </div>
  );

  return (
    <DashboardCard title="Visits & orders" subtitle="Daily app activity" span="3" right={legend}>
      <div className="ins-chart-wrap">
        <svg className="ins-chart" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Daily visits and orders">
          <defs>
            <linearGradient id="insVisFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--ins-accent)" stopOpacity="0.18" />
              <stop offset="100%" stopColor="var(--ins-accent)" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {[0, 0.5, 1].map((g) => {
            const gy = pad.t + innerH - g * innerH;
            return <line key={g} x1={pad.l} y1={gy} x2={W - pad.r} y2={gy} stroke="var(--ins-line)" strokeWidth="1" />;
          })}
          <path d={visArea} fill="url(#insVisFill)" />
          <path d={`M${visPts.join(' L')}`} fill="none" stroke="var(--ins-accent)" strokeWidth="1.5" opacity="0.55"
            vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          <path d={ordLine} fill="none" stroke="var(--ins-pos)" strokeWidth="2.5" vectorEffect="non-scaling-stroke"
            strokeLinejoin="round" strokeLinecap="round" />
          {data.map((d, i) => (
            <g key={i}>
              <circle cx={x(i)} cy={yo(d.purchases || 0)} r="2.6" fill="var(--ins-card)" stroke="var(--ins-pos)" strokeWidth="1.8" />
              <rect x={x(i) - 10} y={pad.t} width="20" height={innerH} fill="transparent">
                <title>{`${longDate(d.day)} — ${num(d.views || 0)} visit${d.views === 1 ? '' : 's'}, ${num(d.purchases || 0)} order${d.purchases === 1 ? '' : 's'}`}</title>
              </rect>
              {i % labelStep === 0 && (
                <text x={x(i)} y={H - 10} textAnchor="middle" className="ins-axis">{shortDate(d.day)}</text>
              )}
            </g>
          ))}
        </svg>
      </div>
      <p className="ins-note">Each series is scaled to its own peak so shapes can be compared — visits and orders don’t share a numeric axis.</p>
    </DashboardCard>
  );
}

function CheckoutFunnel({ totals }) {
  const t = totals || {};
  const visitors = t.visitors || 0;
  if (!visitors) {
    return <DashboardCard title="Checkout funnel" subtitle="From visit to order">
      <EmptyState>No visitors yet — the funnel appears once customers browse the app.</EmptyState>
    </DashboardCard>;
  }
  const stages = [
    { label: 'Visitors', v: visitors },
    { label: 'Viewed a product', v: t.productViews || 0 },
    { label: 'Added to cart', v: t.addCart || 0 },
    { label: 'Reached checkout', v: t.checkouts || 0 },
    { label: 'Ordered', v: t.purchases || 0 },
  ];
  return (
    <DashboardCard title="Checkout funnel" subtitle="From visit to order">
      <div className="ins-funnel">
        {stages.map((st, i) => {
          const pct = Math.round((st.v / visitors) * 100);
          const prev = i > 0 ? stages[i - 1].v : null;
          const drop = prev != null && prev > 0 ? Math.round(((prev - st.v) / prev) * 100) : null;
          const last = i === stages.length - 1;
          return (
            <div key={st.label} className={`ins-funnel-row ${last ? 'final' : ''}`}>
              <div className="ins-funnel-top">
                <span className="ins-funnel-label">{st.label}</span>
                <span className="ins-funnel-vals">
                  <b>{num(st.v)}</b> · {pct}%
                  {drop != null && drop > 0 && <span className="ins-drop">−{drop}%</span>}
                </span>
              </div>
              <div className="ins-funnel-track">
                <div className="ins-funnel-fill" style={{ width: `${Math.max(pct, st.v > 0 ? 2 : 0)}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </DashboardCard>
  );
}

// Friendly labels for arrival-source keys captured on the 'view' event.
const SOURCE_LABELS = { qr: 'QR code (table)', direct: 'Direct / typed URL', social: 'Social', search: 'Search', referral: 'Referral link' };
function sourceLabel(s) { return SOURCE_LABELS[s] || (s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Unknown'); }

function ProductRankingCard({ title, items }) {
  const list = items || [];
  const max = Math.max(1, ...list.map((p) => p.n || 0));
  return (
    <DashboardCard title={title}>
      {list.length === 0 ? (
        <EmptyState>No data yet.</EmptyState>
      ) : (
        <ol className="ins-rank">
          {list.map((p, i) => (
            <li key={p.name + i} className="ins-rank-row">
              <div className="ins-rank-top">
                <span className="ins-rank-name" title={p.name}>{p.name}</span>
                <span className="ins-rank-n">{num(p.n)}</span>
              </div>
              <div className="ins-rank-track">
                <div className="ins-rank-fill" style={{ width: `${Math.round((p.n / max) * 100)}%` }} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </DashboardCard>
  );
}

// ── Skeleton dashboards ──────────────────────────────────────────────────────
function ExecSkeleton() {
  return (
    <div className="ins-grid">
      <DashboardCard span="2"><Skeleton h={90} r={12} /></DashboardCard>
      <div className="ins-kpi-grid ins-span-2">
        {[0, 1, 2, 3].map((i) => (
          <div className="ins-metric" key={i}><Skeleton h={14} w="50%" /><Skeleton h={26} w="70%" style={{ marginTop: 10 }} /></div>
        ))}
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
export default function Insights({ days, onDays, dashboard, analytics, customers, refreshing, onRefresh, lastSync }) {
  const dashLoading = dashboard == null;
  const dashFailed = dashboard && dashboard.error;
  const sales = dashboard && !dashboard.error ? dashboard.sales : null;
  const signups = dashboard && !dashboard.error ? dashboard.signups : null;

  const anaLoading = analytics == null;
  const anaEmpty = analytics && analytics.empty;
  const anaError = analytics && analytics.error;
  const totals = analytics && !anaEmpty && !anaError ? analytics.totals : null;
  const anaDaily = analytics && !anaEmpty && !anaError ? analytics.daily : null;

  const periodLabel = `Last ${days} day${days === 1 ? '' : 's'}`;

  return (
    <div className="ins-dash">
      <InsightsHeader days={days} onDays={onDays} dashboard={dashboard}
        refreshing={refreshing} onRefresh={onRefresh} lastSync={lastSync} />

      {/* ── Executive summary ── */}
      <div className="ins-section">
        <div className="ins-section-head">
          <h2 className="ins-h2">Overview</h2>
          <span className="ins-period">{periodLabel}</span>
        </div>

        {dashLoading && <ExecSkeleton />}

        {dashFailed && (
          <ErrorState message="Couldn’t load the Square dashboard." onRetry={onRefresh} />
        )}

        {dashboard && !dashboard.error && (
          <div className="ins-grid">
            <RevenueOverviewCard sales={sales} />
            <div className="ins-kpi-grid ins-span-2">
              {sales && sales.error ? (
                <div className="ins-kpi-err">
                  <ErrorState
                    message={sales.error === true ? 'Sales couldn’t load — your Square token needs Orders (read).' : sales.error}
                    onRetry={onRefresh} />
                </div>
              ) : (
                <>
                  <MetricCard label="Orders" value={num((sales || {}).orders)} Icon={IcoBag} />
                  <MetricCard label="Average order" value={formatMoney((sales || {}).avgOrder || 0, (sales || {}).currency || 'AUD')} Icon={IcoAvg} />
                </>
              )}
              {signups && signups.error ? (
                <div className="ins-kpi-err">
                  <ErrorState
                    message={signups.error === true ? 'Signups need the Square loyalty program enabled.' : signups.error}
                    onRetry={onRefresh} />
                </div>
              ) : (
                <>
                  <MetricCard label="New signups" value={num((signups || {}).newInRange)} Icon={IcoUserPlus} />
                  <MetricCard label="Members" value={num((signups || {}).totalMembers)} Icon={IcoUsers} />
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Sales performance ── */}
      {dashboard && !dashboard.error && (
        <div className="ins-section">
          <div className="ins-grid">
            <RevenuePerformanceChart sales={sales} />
          </div>
        </div>
      )}
      {dashLoading && (
        <div className="ins-section"><div className="ins-grid">
          <DashboardCard span="3" title="Revenue performance"><Skeleton h={220} r={12} /></DashboardCard>
        </div></div>
      )}

      {/* ── Loyalty + customers ── */}
      <div className="ins-section">
        <div className="ins-grid ins-grid-2">
          {dashLoading
            ? <DashboardCard title="Loyalty growth"><Skeleton h={150} r={12} /></DashboardCard>
            : (dashboard && !dashboard.error
              ? <LoyaltyGrowthCard signups={signups} />
              : <DashboardCard title="Loyalty growth"><ErrorState message="Loyalty data unavailable." onRetry={onRefresh} /></DashboardCard>)}
          <TopCustomersCard customers={customers} />
        </div>
      </div>

      {/* ── App engagement ── */}
      <div className="ins-section ins-section-sep">
        <div className="ins-section-head">
          <div>
            <h2 className="ins-h2">App engagement</h2>
            <p className="ins-lede-sm">How customers discover products and move towards an order</p>
          </div>
        </div>

        {anaLoading && (
          <div className="ins-grid">
            <div className="ins-eng-grid ins-span-3">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div className="ins-metric" key={i}><Skeleton h={14} w="50%" /><Skeleton h={24} w="70%" style={{ marginTop: 10 }} /></div>
              ))}
            </div>
          </div>
        )}

        {anaError && <ErrorState message="App analytics couldn’t load." onRetry={onRefresh} />}
        {anaEmpty && <EmptyState>No app analytics yet — data appears as customers use the app.</EmptyState>}

        {totals && (
          <>
            <EngagementMetrics totals={totals} />
            <div className="ins-grid">
              <VisitsOrdersChart daily={anaDaily} />
            </div>
            <div className="ins-grid ins-grid-2">
              <CheckoutFunnel totals={totals} />
              <div className="ins-grid ins-grid-2 ins-nested">
                <ProductRankingCard title="Most viewed" items={analytics.topViewed} />
                <ProductRankingCard title="Most purchased" items={analytics.topPurchased} />
              </div>
            </div>
            <div className="ins-grid ins-grid-2">
              <ProductRankingCard title="How they found us" items={(analytics.sources || []).map((s) => ({ name: sourceLabel(s.source), n: s.n }))} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
