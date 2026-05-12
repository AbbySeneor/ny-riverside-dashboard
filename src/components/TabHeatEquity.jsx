import React, { useState, useMemo } from 'react';
import MapView from './MapView.jsx';
import { PALETTE, FONTS } from '../lib/colors.js';
import { siteAcres } from '../siteMeta.js';
import { Thermometer } from 'lucide-react';

export default function TabHeatEquity({ data }) {
  const lst = data.lstZones;
  const acres = siteAcres(data.siteId);
  const [showHVI, setShowHVI] = useState(true);
  const active = new Set(['lst', 'boundary', ...(showHVI ? ['hvi'] : [])]);
  const hviTier = useMemo(() => {
    const feats = data.hvi?.features || [];
    let max = null;
    feats.forEach((f) => {
      const v = Number(f?.properties?.hvi_2018 ?? f?.properties?.hvi);
      if (Number.isFinite(v) && (max === null || v > max)) max = v;
    });
    return max;
  }, [data.hvi]);

  if (!lst) {
    return <EmptyState script="05_gee_thermal.py" />;
  }

  const canopyTemp = lst.canopy_interior;
  const streetTemp = lst.riverside_drive;
  const hudsonTemp = lst.hudson;
  const pkwyTemp = lst.henry_hudson_pkwy;
  const cooling = lst.cooling_vs_street_F;

  return (
    <section style={{ padding: '32px 36px' }}>
      <Kicker color={PALETTE.coral}>04 / 05 · heat equity</Kicker>
      <h2 style={{
        fontFamily: FONTS.display, fontSize: 32, fontWeight: 400,
        letterSpacing: '-0.02em', margin: '12px 0 14px', lineHeight: 1.1,
      }}>
        Under the canopy, <em style={{ color: PALETTE.moss }}>
          {cooling ? `${cooling}°F cooler` : 'measurably cooler'}
        </em>.
      </h2>
      <p style={{
        fontSize: 14, lineHeight: 1.6, maxWidth: 760, color: PALETTE.bodyMuted,
        margin: '0 0 28px',
      }}>
        Surrounding MODZCTAs on this map include NYC DOHMH Heat Vulnerability tiers
        4–5. Heat is the leading weather-related cause of death in NYC. This chart
        ties Landsat-derived temperatures on the
        {acres != null ? `${acres}-acre` : 'site'} footprint to that public-health context.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 24 }}>
        {/* Thermal map */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{
            position: 'relative',
            background: PALETTE.mapWell, border: `1px solid ${PALETTE.rule}`,
            height: 480, overflow: 'hidden',
          }}>
            <MapView layers={active} data={data} imageBase={data.dataBase} />
            <div style={{
              position: 'absolute', top: 12, left: 12,
              background: PALETTE.overlay, color: PALETTE.ink,
              padding: '10px 14px',
              fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '0.1em',
            }}>
              <div style={{ color: PALETTE.sage, fontSize: 9, marginBottom: 4 }}>
                LANDSAT 8/9 · ST_B10 · JUL MEDIAN 2020–2025
              </div>
              <div>BLUE ← COOL · WARM → RED</div>
            </div>
            <label style={{
              position: 'absolute', bottom: 12, left: 12,
              background: PALETTE.overlay, color: PALETTE.ink,
              padding: '8px 12px',
              fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '0.08em',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <input type="checkbox" checked={showHVI}
                onChange={(e) => setShowHVI(e.target.checked)} />
              SHOW HVI OVERLAY
            </label>
          </div>

          {/* Temperature strip */}
          <div style={{
            background: PALETTE.elevated, border: `1px solid ${PALETTE.rule}`,
            padding: '18px 20px',
            display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16,
          }}>
            <TempTile label="Hudson River" temp={hudsonTemp} color={PALETTE.sky} />
            <TempTile label="Under canopy" temp={canopyTemp} color={PALETTE.forest} />
            <TempTile label="Riverside Drive" temp={streetTemp} color={PALETTE.ochre} />
            <TempTile label="HH Parkway" temp={pkwyTemp} color={PALETTE.coral} />
          </div>
        </div>

        {/* HVI callout + political value */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{
            background: PALETTE.coral, color: PALETTE.onAccent,
            padding: '24px 26px',
          }}>
            <Kicker color="rgba(251,248,241,0.75)">
              nyc dohmh · heat vulnerability
            </Kicker>
            <div style={{
              fontFamily: FONTS.display, fontSize: 64, fontWeight: 300,
              lineHeight: 1, margin: '12px 0 8px', letterSpacing: '-0.03em',
            }}>{hviTier != null ? `Tier ${hviTier}` : 'HVI'}</div>
            <div style={{ fontSize: 12, lineHeight: 1.5, opacity: 0.95 }}>
              {hviTier != null
                ? `Highest MODZCTA tier overlapping this site: ${hviTier} (NYC DOHMH 2018 HVI). Heat is the leading weather-related cause of death in NYC. This forest is clinical infrastructure.`
                : 'Heat is the leading weather-related cause of death in NYC. This forest is clinical infrastructure.'}
            </div>
          </div>

          <div style={{
            background: PALETTE.elevated, border: `1px solid ${PALETTE.rule}`,
            padding: '20px 22px',
          }}>
            <Kicker>nyc urban forest plan benchmark</Kicker>
            <div style={{
              fontFamily: FONTS.display, fontSize: 16, margin: '10px 0 12px',
              lineHeight: 1.35, fontStyle: 'italic',
            }}>
              "Forested natural areas average 6°F cooler than surrounding
              neighborhoods — 3× the cooling of individual street trees."
            </div>
            <div style={{ fontSize: 11, color: PALETTE.subtle, lineHeight: 1.5 }}>
              Current site cooling: <strong style={{ color: PALETTE.ink }}>
                {cooling}°F
              </strong>.
              Y3 target: close the gap to the 6°F citywide benchmark.
            </div>
          </div>

          <div style={{
            background: PALETTE.forest, color: PALETTE.onAccent,
            padding: '20px 22px',
          }}>
            <Kicker color={PALETTE.onAccent}>the political value</Kicker>
            <div style={{
              fontFamily: FONTS.display, fontSize: 15, marginTop: 10,
              lineHeight: 1.5, fontStyle: 'italic',
            }}>
              Hoylman-Sigal and Council Majority Leader Abreu now have a
              quantified cooling claim for West Harlem — sourceable,
              reproducible, updated every summer.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function TempTile({ label, temp, color }) {
  return (
    <div style={{ borderLeft: `2px solid ${color}`, paddingLeft: 12 }}>
      <div style={{
        fontFamily: FONTS.mono, fontSize: 9, letterSpacing: '0.1em',
        textTransform: 'uppercase', color: PALETTE.subtle, marginBottom: 6,
      }}>{label}</div>
      <div style={{
        fontFamily: FONTS.display, fontSize: 28, fontWeight: 400,
        lineHeight: 1, color, letterSpacing: '-0.02em',
      }}>
        {temp ?? '—'}<span style={{ fontSize: 13, color: PALETTE.subtle, marginLeft: 2 }}>°F</span>
      </div>
    </div>
  );
}

function Kicker({ children, color = PALETTE.moss }) {
  return (
    <div style={{
      fontFamily: FONTS.mono, fontSize: 10, fontWeight: 500,
      letterSpacing: '0.15em', textTransform: 'uppercase', color,
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
        }}>thermal data not yet computed</div>
        <div style={{ fontFamily: FONTS.body, fontSize: 14 }}>
          Run <code style={{
            background: PALETTE.paper, padding: '3px 8px',
            fontFamily: FONTS.mono, fontSize: 12,
          }}>python {script}</code>{' '}
          (requires Earth Engine auth)
        </div>
      </div>
    </section>
  );
}
