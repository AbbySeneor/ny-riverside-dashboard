import React, { useState, useMemo, useEffect } from 'react';
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea, BarChart, Bar,
} from 'recharts';
import { PALETTE, FONTS } from '../lib/colors.js';

export default function TabCanopy({ data }) {
  const [year, setYear] = useState(null);
  const traj = data.canopyTrajectory?.epochs || [];
  const ndvi = data.ndviTimeseries?.monthly || [];

  const baseline = traj.find(e => e.phase === 'baseline')
                || traj.find(e => e.year === 2021);
  const earliest = traj.find(e => e.year === 2010);
  const target = traj.find(e => e.year === 2029);

  const canopyDelta = (baseline && earliest)
    ? (baseline.canopy_pct - earliest.canopy_pct)
    : null;

  // Default selected year to baseline
  const selectedYear = year ?? baseline?.year ?? 2021;
  const selected = traj.find(e => e.year === selectedYear) || baseline;

  // NDVI yearly summer max (July) to overlay
  const yearsSorted = useMemo(() => [...new Set(traj.map((d) => d.year))].sort((a, b) => a - b), [traj]);

  useEffect(() => {
    if (!yearsSorted.length) return;
    const onKey = (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      const cur = selectedYear;
      const idx = yearsSorted.indexOf(cur);
      if (idx < 0) return;
      if (e.key === 'ArrowLeft' && idx > 0) setYear(yearsSorted[idx - 1]);
      if (e.key === 'ArrowRight' && idx < yearsSorted.length - 1) setYear(yearsSorted[idx + 1]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [yearsSorted, selectedYear]);

  const ndviYearly = useMemo(() => {
    const byYear = {};
    ndvi.forEach((m) => {
      if (m.month >= 6 && m.month <= 8) {
        if (!byYear[m.year] || m.ndvi > byYear[m.year].ndvi) {
          byYear[m.year] = { year: m.year, ndvi: m.ndvi };
        }
      }
    });
    return Object.values(byYear).sort((a, b) => a.year - b.year);
  }, [ndvi]);

  if (traj.length === 0) {
    return <EmptyState what="canopy trajectory" script="03_tree_canopy_stats.py" />;
  }

  return (
    <section style={{ padding: '32px 36px' }}>
      <Kicker>02 / 05 · trajectory</Kicker>
      <h2 style={{
        fontFamily: FONTS.display, fontSize: 32, fontWeight: 400,
        letterSpacing: '-0.02em', margin: '12px 0 14px', lineHeight: 1.1,
      }}>
        Canopy cover {earliest?.canopy_pct ?? '—'}% → {baseline?.canopy_pct ?? '—'}%{' '}
        {canopyDelta != null && (
          <span style={{
            color: canopyDelta < 0 ? PALETTE.coral : PALETTE.moss,
          }}>
            ({canopyDelta > 0 ? '+' : ''}{canopyDelta.toFixed(1)} pts)
          </span>
        )}
      </h2>
      <p style={{
        fontSize: 14, lineHeight: 1.6, maxWidth: 760, color: PALETTE.bodyMuted,
        margin: '0 0 28px',
      }}>
        Computed pixel-by-pixel from the 6-inch land cover rasters published by
        TNC and NYC Open Data, clipped to the project polygon. NDVI overlay is
        Sentinel-2 SR Harmonized, July max per year.
      </p>

      {/* Year scrubber */}
      <div style={{
        background: PALETTE.elevated, border: `1px solid ${PALETTE.rule}`,
        padding: '20px 28px', marginBottom: 28,
      }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          alignItems: 'flex-end', marginBottom: 18,
        }}>
          <div>
            <Kicker>
              {selected?.phase === 'baseline' ? 'baseline · pre-restoration' :
               selected?.phase === 'projected' ? 'projected · post-restoration' :
               'historical · lidar'}
            </Kicker>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginTop: 6 }}>
              <div style={{
                fontFamily: FONTS.display, fontSize: 80, fontWeight: 300,
                letterSpacing: '-0.04em', lineHeight: 1,
              }}>{selectedYear}</div>
              <div style={{
                fontFamily: FONTS.display, fontSize: 48, fontWeight: 300,
                color: selected?.phase === 'projected' ? PALETTE.moss : PALETTE.ink,
              }}>
                {selected?.canopy_pct ?? '—'}%
              </div>
              <div style={{
                fontSize: 11, color: PALETTE.subtle,
                fontFamily: FONTS.mono, letterSpacing: '0.1em', marginBottom: 12,
              }}>CANOPY COVER</div>
            </div>
          </div>

          {selected?.ecosystem && (
            <div style={{
              display: 'flex', gap: 24, fontFamily: FONTS.mono, fontSize: 10,
              color: PALETTE.subtle, letterSpacing: '0.08em',
            }}>
              <KV
                label="STORMWATER"
                value={`${(selected.ecosystem.stormwater_gal_yr / 1000).toFixed(0)}K`}
                unit="gal/yr"
              />
              <KV
                label="CARBON SEQ."
                value={selected.ecosystem.carbon_seq_tC_yr}
                unit="tC/yr"
              />
              {selected.ecosystem.energy_kwh_yr && (
                <KV
                  label="ENERGY"
                  value={`${(selected.ecosystem.energy_kwh_yr / 1000).toFixed(0)}K`}
                  unit="kWh/yr"
                />
              )}
              {selected.ecosystem.air_pollution_lb_yr && (
                <KV
                  label="AIR POLL."
                  value={selected.ecosystem.air_pollution_lb_yr}
                  unit="lb/yr"
                />
              )}
            </div>
          )}
        </div>

        <div style={{ position: 'relative' }}>
          <input
            type="range"
            min={traj[0].year} max={traj[traj.length - 1].year} step={1}
            value={selectedYear}
            onChange={(e) => {
              const v = +e.target.value;
              const known = traj.map(d => d.year);
              const closest = known.reduce((a, b) =>
                Math.abs(b - v) < Math.abs(a - v) ? b : a);
              setYear(closest);
            }}
            style={{ width: '100%', accentColor: PALETTE.forest }}
          />
          <div style={{
            display: 'flex', justifyContent: 'space-between',
            fontFamily: FONTS.mono, fontSize: 10, color: PALETTE.subtle,
            marginTop: 10,
          }}>
            {traj.map(d => (
              <button key={d.year} onClick={() => setYear(d.year)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: selectedYear === d.year ? PALETTE.ink : PALETTE.subtle,
                  fontWeight: selectedYear === d.year ? 600 : 400,
                  fontFamily: 'inherit', fontSize: 'inherit',
                }}>
                {d.year}
                {d.phase === 'baseline' && (
                  <span style={{ color: PALETTE.coral, marginLeft: 3 }}>●</span>
                )}
                {d.phase === 'projected' && (
                  <span style={{ color: PALETTE.moss, marginLeft: 3 }}>○</span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 24 }}>
        <Panel title="canopy cover trajectory">
          <div style={{ height: 320 }}>
            <ResponsiveContainer>
              <AreaChart data={traj} margin={{ top: 20, right: 30, bottom: 10, left: 0 }}>
                <defs>
                  <linearGradient id="histgrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={PALETTE.coral} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={PALETTE.coral} stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={PALETTE.rule} strokeDasharray="2 2" vertical={false} />
                <XAxis dataKey="year" stroke={PALETTE.subtle}
                  tick={{ fontFamily: FONTS.mono, fontSize: 10 }} />
                <YAxis stroke={PALETTE.subtle}
                  tick={{ fontFamily: FONTS.mono, fontSize: 10 }}
                  domain={['auto', 'auto']} />
                <Tooltip contentStyle={{
                  background: PALETTE.paper, border: `1px solid ${PALETTE.rule}`,
                  fontFamily: FONTS.mono, fontSize: 11,
                }} />
                {baseline && (
                  <ReferenceLine x={baseline.year} stroke={PALETTE.coral}
                    strokeDasharray="3 3"
                    label={{ value: 'baseline', fill: PALETTE.coral, fontSize: 10,
                             position: 'top', fontFamily: FONTS.mono }} />
                )}
                {target && (
                  <ReferenceArea x1={baseline?.year} x2={target.year}
                    fill={PALETTE.moss} fillOpacity={0.04} />
                )}
                <Area type="monotone" dataKey="canopy_pct"
                  stroke={PALETTE.forest} strokeWidth={2.5}
                  fill="url(#histgrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div style={{
            marginTop: 12, paddingTop: 12,
            borderTop: `1px solid ${PALETTE.rule}`,
            fontFamily: FONTS.mono, fontSize: 10, color: PALETTE.subtle,
          }}>
            Y-axis: % canopy cover. Source for each point shown on hover.
          </div>
        </Panel>

        {ndviYearly.length > 0 && (
          <Panel title="sentinel-2 ndvi · july max">
            <div style={{ height: 200 }}>
              <ResponsiveContainer>
                <LineChart data={ndviYearly}>
                  <CartesianGrid stroke={PALETTE.rule} strokeDasharray="2 2" vertical={false} />
                  <XAxis dataKey="year" stroke={PALETTE.subtle}
                    tick={{ fontFamily: FONTS.mono, fontSize: 10 }} />
                  <YAxis stroke={PALETTE.subtle} domain={[0.4, 1]}
                    tick={{ fontFamily: FONTS.mono, fontSize: 10 }} />
                  <Tooltip contentStyle={{
                    background: PALETTE.paper, border: `1px solid ${PALETTE.rule}`,
                    fontFamily: FONTS.mono, fontSize: 11,
                  }} />
                  <Line type="monotone" dataKey="ndvi"
                    stroke={PALETTE.moss} strokeWidth={2}
                    dot={{ fill: PALETTE.forest, r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div style={{
              marginTop: 12, paddingTop: 12,
              borderTop: `1px solid ${PALETTE.rule}`,
              fontFamily: FONTS.mono, fontSize: 10, color: PALETTE.subtle,
            }}>
              NDVI &gt; 0.55 ≈ closed canopy. Tracks degradation between LiDAR epochs.
            </div>
          </Panel>
        )}
      </div>
    </section>
  );
}

function Panel({ title, children }) {
  return (
    <div style={{
      background: PALETTE.elevated, border: `1px solid ${PALETTE.rule}`,
      padding: 24,
    }}>
      <Kicker>{title}</Kicker>
      <div style={{ marginTop: 18 }}>{children}</div>
    </div>
  );
}

function Kicker({ children }) {
  return (
    <div style={{
      fontFamily: FONTS.mono, fontSize: 10, fontWeight: 500,
      letterSpacing: '0.15em', textTransform: 'uppercase', color: PALETTE.moss,
    }}>{children}</div>
  );
}

function KV({ label, value, unit }) {
  return (
    <div>
      <div>{label}</div>
      <div style={{
        fontFamily: FONTS.display, fontSize: 22, color: PALETTE.ink, marginTop: 4,
      }}>
        {value}{' '}
        <span style={{ fontSize: 11, color: PALETTE.subtle }}>{unit}</span>
      </div>
    </div>
  );
}

function EmptyState({ what, script }) {
  return (
    <section style={{ padding: '40px 36px' }}>
      <div style={{
        background: PALETTE.elevated, border: `1px solid ${PALETTE.ochre}`,
        padding: 32, textAlign: 'center', maxWidth: 600, margin: '40px auto',
      }}>
        <div style={{ fontFamily: FONTS.mono, fontSize: 11,
                      color: PALETTE.ochre, letterSpacing: '0.1em',
                      textTransform: 'uppercase', marginBottom: 10 }}>
          {what} not yet computed
        </div>
        <div style={{ fontFamily: FONTS.body, fontSize: 14, color: PALETTE.ink }}>
          Run <code style={{
            background: PALETTE.paper, padding: '3px 8px',
            fontFamily: FONTS.mono, fontSize: 12,
          }}>python {script}</code> in <code>data-prep/</code>
          {' '}to populate this view.
        </div>
      </div>
    </section>
  );
}
