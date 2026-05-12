import React, { useMemo } from 'react';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { PALETTE, FONTS } from '../lib/colors.js';

export default function TabScorecard({ data }) {
  const sc = data.scorecard;
  const eco = data.ecosystemServices;

  if (!sc) {
    return <EmptyState script="07_compute_scorecard.py" />;
  }

  // Radar requires 0-100 normalization
  const radarData = useMemo(() => {
    return sc.metrics
      .filter(m => m.baseline != null && m.max != null)
      .map(m => ({
        metric: m.metric.split(' ').slice(0, 2).join(' '),
        baseline: m.inverse
          ? 100 - (m.baseline / m.max * 100)
          : (m.baseline / m.max * 100),
        target: m.target != null
          ? (m.inverse ? 100 - (m.target / m.max * 100)
                       : (m.target / m.max * 100))
          : null,
      }));
  }, [sc]);

  return (
    <section style={{ padding: '32px 36px' }}>
      <Kicker>03 / 05 · nac framework scorecard</Kicker>
      <h2 style={{
        fontFamily: FONTS.display, fontSize: 32, fontWeight: 400,
        letterSpacing: '-0.02em', margin: '12px 0 14px', lineHeight: 1.1,
      }}>
        Metrics Treebed can hold us to.
      </h2>
      <p style={{
        fontSize: 14, lineHeight: 1.6, maxWidth: 760, color: PALETTE.bodyMuted,
        margin: '0 0 28px',
      }}>
        Compatible with the NAC Forest Management Framework Rapid Site Assessment.
        Each row re-computes automatically at year 1, 2, and 3 from the same
        open-source pipeline that produced this baseline.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 24 }}>
        {/* Scorecard table */}
        <div style={{
          background: PALETTE.elevated, border: `1px solid ${PALETTE.rule}`,
        }}>
          <div style={{
            padding: '14px 24px', borderBottom: `2px solid ${PALETTE.ink}`,
            display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1.4fr',
            gap: 12, fontFamily: FONTS.mono, fontSize: 10,
            letterSpacing: '0.1em', textTransform: 'uppercase',
            color: PALETTE.subtle, fontWeight: 500,
          }}>
            <div>Metric</div>
            <div>Baseline '26</div>
            <div>Target Y3</div>
            <div>Progress</div>
          </div>

          {sc.metrics.map((m, i) => {
            const hasTarget = m.target != null;
            const delta = hasTarget
              ? (m.inverse ? m.baseline - m.target : m.target - m.baseline)
              : null;
            const baselinePos = m.max ? (m.baseline / m.max * 100) : 50;
            const targetPos = m.max && hasTarget ? (m.target / m.max * 100) : null;

            return (
              <div key={i} style={{
                padding: '16px 24px',
                borderBottom: i < sc.metrics.length - 1 ? `1px solid ${PALETTE.rule}` : 'none',
                display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1.4fr',
                gap: 12, alignItems: 'center', fontSize: 13,
              }}>
                <div>
                  <div style={{ fontWeight: 500 }}>{m.metric}</div>
                  <div style={{
                    fontFamily: FONTS.mono, fontSize: 9,
                    color: PALETTE.subtle, marginTop: 3,
                    letterSpacing: '0.1em', textTransform: 'uppercase',
                  }}>{m.domain}</div>
                </div>
                <div style={{
                  fontFamily: FONTS.display, fontSize: 20,
                  color: m.inverse && m.baseline > 20 ? PALETTE.coral : PALETTE.ink,
                }}>
                  {m.baseline ?? '—'}
                  <span style={{ fontSize: 11, color: PALETTE.subtle, marginLeft: 3 }}>
                    {m.unit}
                  </span>
                </div>
                <div style={{
                  fontFamily: FONTS.display, fontSize: 20,
                  color: hasTarget ? PALETTE.moss : PALETTE.subtle,
                }}>
                  {m.target ?? '—'}
                  <span style={{ fontSize: 11, color: PALETTE.subtle, marginLeft: 3 }}>
                    {m.unit}
                  </span>
                </div>
                <div>
                  {m.max && hasTarget && (
                    <>
                      <div style={{
                        position: 'relative', height: 6,
                        background: PALETTE.rule, marginBottom: 6,
                      }}>
                        <div style={{
                          position: 'absolute',
                          left: `${Math.min(baselinePos, targetPos)}%`,
                          width: `${Math.abs(targetPos - baselinePos)}%`,
                          height: '100%', background: PALETTE.moss,
                        }} />
                        <div style={{
                          position: 'absolute', left: `${baselinePos}%`,
                          top: -3, width: 2, height: 12, background: PALETTE.coral,
                        }} />
                        <div style={{
                          position: 'absolute', left: `${targetPos}%`,
                          top: -3, width: 2, height: 12, background: PALETTE.forest,
                        }} />
                      </div>
                      <div style={{
                        fontFamily: FONTS.mono, fontSize: 9,
                        color: PALETTE.subtle, letterSpacing: '0.05em',
                      }}>
                        {delta > 0 ? '+' : ''}{delta?.toFixed(m.unit === '°F' ? 1 : 0)}{m.unit}
                      </div>
                    </>
                  )}
                  {(!m.max || !hasTarget) && (
                    <div style={{
                      fontFamily: FONTS.mono, fontSize: 9,
                      color: PALETTE.subtle, fontStyle: 'italic',
                    }}>baseline only</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Radar chart */}
        <div style={{
          background: PALETTE.elevated, border: `1px solid ${PALETTE.rule}`, padding: 20,
        }}>
          <Kicker>composite condition index</Kicker>
          <div style={{ height: 340, marginTop: 12 }}>
            <ResponsiveContainer>
              <RadarChart data={radarData}>
                <PolarGrid stroke={PALETTE.rule} />
                <PolarAngleAxis dataKey="metric"
                  tick={{ fontFamily: FONTS.mono, fontSize: 9,
                          fill: PALETTE.ink, letterSpacing: '0.05em' }} />
                <PolarRadiusAxis angle={90} domain={[0, 100]}
                  tick={{ fontSize: 8, fill: PALETTE.subtle }} />
                <Radar name="Baseline" dataKey="baseline"
                  stroke={PALETTE.coral} fill={PALETTE.coral}
                  fillOpacity={0.18} strokeWidth={1.5} />
                <Radar name="Target Y3" dataKey="target"
                  stroke={PALETTE.forest} fill={PALETTE.forest}
                  fillOpacity={0.22} strokeWidth={1.5} />
                <Tooltip contentStyle={{
                  background: PALETTE.elevated, border: `1px solid ${PALETTE.rule}`,
                  fontFamily: FONTS.mono, fontSize: 11,
                }} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
          <div style={{
            display: 'flex', gap: 18, justifyContent: 'center',
            fontFamily: FONTS.mono, fontSize: 10, color: PALETTE.subtle,
          }}>
            <div><span style={{ color: PALETTE.coral, marginRight: 6 }}>■</span>BASELINE</div>
            <div><span style={{ color: PALETTE.forest, marginRight: 6 }}>■</span>Y3 TARGET</div>
          </div>
        </div>
      </div>

      {/* Ecosystem services valuation */}
      {eco && (
        <div style={{
          marginTop: 24, background: PALETTE.elevated,
          border: `1px solid ${PALETTE.rule}`, padding: 24,
        }}>
          <Kicker>annual ecosystem services · i-tree eco valuation</Kicker>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)',
            gap: 24, marginTop: 20,
          }}>
            <EcoStat label="Stormwater" value={eco.stormwater?.usd_per_year} note={
              `${(eco.stormwater?.gallons_per_year / 1000).toFixed(0)}K gal/yr`
            } color={PALETTE.sky} />
            <EcoStat label="Carbon" value={eco.carbon_sequestration?.usd_per_year} note={
              `${eco.carbon_sequestration?.tC_per_year} tC/yr`
            } color={PALETTE.forest} />
            <EcoStat label="Air pollution" value={eco.air_pollution_removal?.usd_per_year} note={
              `${eco.air_pollution_removal?.lb_per_year} lb/yr`
            } color={PALETTE.moss} />
            <EcoStat label="Energy savings" value={eco.energy_savings?.usd_per_year} note={
              `${(eco.energy_savings?.kwh_per_year / 1000).toFixed(0)}K kWh/yr`
            } color={PALETTE.ochre} />
            <EcoStat label="Total annual" value={eco.total_annual_usd} note={
              `${eco.canopy_acres} canopy acres`
            } color={PALETTE.ink} emphasis />
          </div>
          <div style={{
            marginTop: 20, paddingTop: 16,
            borderTop: `1px solid ${PALETTE.rule}`,
            fontFamily: FONTS.mono, fontSize: 11, color: PALETTE.subtle,
            letterSpacing: '0.05em',
          }}>
            COMPENSATORY VALUE (CTLA, all trees):{' '}
            <span style={{
              color: PALETTE.ink, fontSize: 14, marginLeft: 8,
              fontFamily: FONTS.display,
            }}>
              ${(eco.compensatory_value_total_usd || 0).toLocaleString()}
            </span>
            <span style={{ marginLeft: 20 }}>
              METHOD · {eco.method}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

function EcoStat({ label, value, note, color, emphasis }) {
  return (
    <div style={{
      borderLeft: `2px solid ${color}`, paddingLeft: 14,
    }}>
      <div style={{
        fontFamily: FONTS.mono, fontSize: 9, letterSpacing: '0.1em',
        textTransform: 'uppercase', color: PALETTE.subtle, marginBottom: 6,
      }}>{label}</div>
      <div style={{
        fontFamily: FONTS.display,
        fontSize: emphasis ? 30 : 22, fontWeight: 400,
        lineHeight: 1, color, letterSpacing: '-0.02em',
      }}>
        ${value ? value.toLocaleString() : '—'}
      </div>
      <div style={{
        fontSize: 10, color: PALETTE.subtle, marginTop: 4,
        fontFamily: FONTS.body,
      }}>{note}</div>
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

function EmptyState({ script }) {
  return (
    <section style={{ padding: '40px 36px' }}>
      <div style={{
        background: PALETTE.elevated, border: `1px solid ${PALETTE.ochre}`,
        padding: 32, textAlign: 'center', maxWidth: 600, margin: '40px auto',
      }}>
        <div style={{
          fontFamily: FONTS.mono, fontSize: 11, color: PALETTE.ochre,
          letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10,
        }}>scorecard not computed</div>
        <div style={{ fontFamily: FONTS.body, fontSize: 14 }}>
          Run <code style={{
            background: PALETTE.paper, padding: '3px 8px',
            fontFamily: FONTS.mono, fontSize: 12,
          }}>python {script}</code>
        </div>
      </div>
    </section>
  );
}
