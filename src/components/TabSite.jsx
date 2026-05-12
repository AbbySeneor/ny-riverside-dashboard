import React, { useState, useMemo } from 'react';
import MapView from './MapView.jsx';
import LandcoverCompare from './LandcoverCompare.jsx';
import { PALETTE, FONTS, SLOPE_RAMP, LST_RAMP } from '../lib/colors.js';
import { Trees, Mountain, Thermometer, AlertTriangle, Activity } from 'lucide-react';
import { siteAcres } from '../siteMeta.js';

const LAYER_OPTIONS = [
  { key: 'trees',         label: 'Tree points',     icon: Trees,         desc: 'TNC × UVM SAL 2021 LiDAR centroids · clipped to site boundary' },
  { key: 'slope',         label: 'Slope (>20°)',    icon: Mountain,      desc: 'DEM-derived slope (NYC 1-ft or USGS 3DEP)' },
  { key: 'invasive',      label: 'Invasive zones',  icon: AlertTriangle, desc: 'Sentinel-2 NDVI phenology proxy' },
  { key: 'canopy_change', label: 'Canopy loss',     icon: Activity,      desc: '2017 → 2021 pixel change' },
  { key: 'lst',           label: 'Surface temp',    icon: Thermometer,   desc: 'Landsat 8/9 July composite' },
  { key: 'hvi',           label: 'Heat vuln. (HVI)', icon: AlertTriangle, desc: 'NYC DOHMH 2018 census tracts' },
];

export default function TabSite({ data }) {
  const [active, setActive] = useState(new Set(['trees']));
  const [selectedTree, setSelectedTree] = useState(null);
  const [lcCompare, setLcCompare] = useState(false);
  const acres = siteAcres(data.siteId);

  const layerDesc = (opt) => {
    if (opt.key === 'trees') {
      const count = data.treeSummary?.count ?? data.trees?.features?.length ?? 0;
      return `${opt.desc} · ${count} points (not NYC street-tree inventory)`;
    }
    if (opt.key === 'invasive') {
      const count = data.invasive?.features?.length ?? 0;
      if (!count) return `${opt.desc} · no polygons in this AOI`;
      const rpc = (data.invasive?.features || []).some(
        (f) => f?.properties?.proxy_source === 'rpc_management_context',
      );
      if (rpc) {
        return `${opt.desc} · ${count} polygon(s); includes RPC Goatham clearing footprint where S2 found no match`;
      }
      return `${opt.desc} · ${count} polygon(s)`;
    }
    return opt.desc;
  };

  const toggleLayer = (k) => {
    setActive((prev) => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });
  };

  // Headline metrics computed live from data
  const metrics = useMemo(() => {
    const c = data.canopyTrajectory?.epochs || [];
    const baseline = c.find(e => e.phase === 'baseline')
                   || c.find(e => e.year === 2021)
                   || c[c.length - 1];
    const eco = data.ecosystemServices;
    const ts = data.treeSummary;
    const lst = data.lstZones;

    return [
      {
        label: 'Trees · LiDAR-detected',
        value: ts?.count?.toLocaleString() ?? '—',
        unit: '',
        note: ts?.mean_height_m ? `mean height ${ts.mean_height_m}m · max ${ts.max_height_m}m` : 'TNC 2021',
      },
      {
        label: 'Canopy cover',
        value: baseline?.canopy_pct ?? '—',
        unit: '%',
        note: baseline?.source ?? 'baseline',
      },
      {
        label: 'Stems per hectare',
        value: ts?.stems_per_ha ?? '—',
        unit: '',
        note: 'NAC FMF target 300/ha',
      },
      {
        label: 'Cooling vs Riv. Drive',
        value: lst?.cooling_vs_street_F ?? '—',
        unit: '°F',
        note: lst?.composite ? 'Landsat July composite' : 'pending GEE compute',
      },
      {
        label: 'Annual ecosystem $',
        value: eco?.total_annual_usd
          ? `$${(eco.total_annual_usd / 1000).toFixed(0)}K`
          : '—',
        unit: '',
        note: 'i-Tree Eco × computed canopy',
      },
      {
        label: 'Compensatory value',
        value: eco?.compensatory_value_total_usd
          ? `$${(eco.compensatory_value_total_usd / 1e6).toFixed(2)}M`
          : '—',
        unit: '',
        note: `${ts?.count ?? 0} trees × $1,106 (CTLA)`,
      },
    ];
  }, [data]);

  return (
    <section style={{ padding: '32px 36px' }}>
      <Kicker>01 / 05 · the site</Kicker>
      <h2 style={{
        fontFamily: FONTS.display, fontSize: 28, fontWeight: 400,
        letterSpacing: '-0.02em', margin: '12px 0 14px', lineHeight: 1.15,
      }}>
        {acres != null ? `${acres} acres` : 'Site footprint'}. Real coordinates. Live data.
      </h2>
      <p style={{
        fontSize: 14, lineHeight: 1.6, maxWidth: 760, margin: '0 0 28px',
        color: PALETTE.bodyMuted,
      }}>
        Click any tree for LiDAR height, crown, and NDVI-based health class (method in popup).
        Use the polygon tool (top-right on the map) to measure a zone. Toggle land-cover split to compare 2010 vs 2021 when rasters exist.
      </p>

      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }} className="no-print">
        <button
          type="button"
          onClick={() => setLcCompare((v) => !v)}
          style={{
            background: lcCompare ? PALETTE.forest : PALETTE.elevated,
            color: lcCompare ? PALETTE.onAccent : PALETTE.ink,
            border: `1px solid ${PALETTE.rule}`,
            padding: '8px 14px',
            fontFamily: FONTS.mono,
            fontSize: 10,
            letterSpacing: '0.1em',
            cursor: 'pointer',
          }}
        >
          {lcCompare ? 'EXIT LAND COVER SPLIT' : '2010 VS 2021 LAND COVER'}
        </button>
        <span style={{ fontSize: 11, color: PALETTE.subtle, maxWidth: 420 }}>
          Split view uses clipped NYC 2010 and TNC 2021 rasters when the pipeline produced PNGs + bounds.
        </span>
      </div>

      {/* Headline metric strip */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)',
        gap: 24, marginBottom: 28,
        background: PALETTE.elevated, border: `1px solid ${PALETTE.rule}`,
        padding: '20px 24px',
      }}>
        {metrics.map((m, i) => (
          <div key={i} style={{
            borderRight: i < 5 ? `1px solid ${PALETTE.rule}` : 'none',
            paddingRight: 20,
          }}>
            <div style={{
              fontFamily: FONTS.mono, fontSize: 9, letterSpacing: '0.1em',
              textTransform: 'uppercase', color: PALETTE.subtle, marginBottom: 8,
            }}>{m.label}</div>
            <div style={{
              fontFamily: FONTS.display, fontSize: 26, fontWeight: 400,
              lineHeight: 1, color: PALETTE.ink, letterSpacing: '-0.02em',
            }}>
              {m.value}
              {m.unit && <span style={{ fontSize: 14, color: PALETTE.subtle, marginLeft: 3 }}>{m.unit}</span>}
            </div>
            <div style={{
              fontSize: 10, color: PALETTE.subtle, marginTop: 6,
              fontFamily: FONTS.body,
            }}>{m.note}</div>
          </div>
        ))}
      </div>

      {/* Map + controls */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 280px',
        gap: 20, height: 620,
      }}>
        {/* Map */}
        <div style={{
          position: 'relative', background: PALETTE.mapWell,
          border: `1px solid ${PALETTE.rule}`, overflow: 'hidden',
        }}>
          {lcCompare ? (
            <LandcoverCompare
              boundary={data.boundary}
              rasterBounds={data.rasterBounds}
              imageBase={data.dataBase}
            />
          ) : (
            <MapView
              key={data.siteId}
              layers={active}
              data={data}
              imageBase={data.dataBase}
              onTreeClick={setSelectedTree}
            />
          )}
          {/* Active layers indicator */}
          <div style={{
            position: 'absolute', top: 12, left: 12,
            background: PALETTE.overlay, color: PALETTE.ink,
            padding: '10px 14px', borderRadius: 0,
            fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '0.08em',
            backdropFilter: 'blur(6px)',
          }}>
            <div style={{ color: PALETTE.sage, fontSize: 9, marginBottom: 4 }}>
              ACTIVE LAYERS
            </div>
            {[...active].length === 0
              ? <span style={{ color: PALETTE.subtle }}>—</span>
              : [...active].map(k => (
                  <div key={k} style={{ marginTop: 2 }}>· {k}</div>
                ))}
          </div>
        </div>

        {/* Layer controls + legend */}
        <div style={{
          background: PALETTE.elevated, border: `1px solid ${PALETTE.rule}`,
          padding: '18px 18px', overflowY: 'auto',
        }}>
          <Kicker>map layers</Kicker>
          <div style={{ marginTop: 12 }}>
            {LAYER_OPTIONS.map(opt => {
              const Icon = opt.icon;
              const isActive = active.has(opt.key);
              return (
                <button
                  key={opt.key}
                  onClick={() => toggleLayer(opt.key)}
                  style={{
                    width: '100%', textAlign: 'left',
                    background: isActive ? PALETTE.forest : 'transparent',
                    color: isActive ? PALETTE.onAccent : PALETTE.ink,
                    border: `1px solid ${isActive ? PALETTE.forest : PALETTE.rule}`,
                    padding: '10px 12px', marginBottom: 6,
                    cursor: 'pointer', fontFamily: FONTS.body, fontSize: 12,
                    display: 'flex', alignItems: 'flex-start', gap: 10,
                    transition: 'all 0.15s',
                  }}
                >
                  <Icon size={14} style={{ marginTop: 2, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontWeight: isActive ? 600 : 500 }}>
                      {opt.label}
                    </div>
                    <div style={{
                      fontSize: 10, marginTop: 3,
                      color: isActive ? 'rgba(5,16,12,0.75)' : PALETTE.subtle,
                    }}>
                      {layerDesc(opt)}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Legends for active raster layers */}
          {active.has('slope') && (
            <RampLegend title="Slope (degrees)" stops={SLOPE_RAMP.map(s => ({
              value: s.deg, hex: s.hex,
            }))} />
          )}
          {active.has('lst') && (
            <RampLegend title="Surface temp (°F)" stops={LST_RAMP.map(s => ({
              value: s.f, hex: s.hex,
            }))} />
          )}
          {active.has('canopy_change') && (
            <RampLegend title="Canopy 2017 → 2021" stops={[
              { value: 'loss', hex: PALETTE.coral },
              { value: 'gain', hex: PALETTE.moss },
              { value: 'no change', hex: PALETTE.rule },
            ]} discrete />
          )}
          {active.has('hvi') && (
            <RampLegend title="Heat Vulnerability (1=low → 5=high)" stops={[
              { value: 1, hex: '#fff7e6' },
              { value: 3, hex: '#f59952' },
              { value: 5, hex: '#7a2618' },
            ]} />
          )}
          {active.has('trees') && (
            <RampLegend title="Tree health" stops={[
              { value: 'healthy', hex: PALETTE.moss },
              { value: 'stressed', hex: PALETTE.ochre },
              { value: 'critical', hex: PALETTE.coral },
            ]} discrete />
          )}
        </div>
      </div>

      {/* Selected tree detail strip */}
      {selectedTree && (
        <div style={{
          marginTop: 16, background: PALETTE.elevated,
          border: `1px solid ${PALETTE.forest}`, padding: '16px 20px',
          display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 24,
          alignItems: 'center',
        }}>
          <div>
            <div style={{
              fontFamily: FONTS.mono, fontSize: 9,
              color: PALETTE.subtle, letterSpacing: '0.1em',
              textTransform: 'uppercase',
            }}>
              SELECTED TREE
            </div>
            <div style={{ fontFamily: FONTS.display, fontSize: 22, marginTop: 4 }}>
              #{selectedTree.properties?.site_id ?? '—'}
            </div>
          </div>
          <div style={{
            fontFamily: FONTS.mono, fontSize: 11, color: PALETTE.subtle,
            letterSpacing: '0.05em', display: 'flex', gap: 24,
          }}>
            <span>HEIGHT · {selectedTree.properties?.height_m ?? '—'}m</span>
            <span>CROWN · {selectedTree.properties?.crown_diameter ?? '—'}m</span>
            <span>HEALTH · {selectedTree.properties?.health_class ?? 'unknown'}</span>
          </div>
          <button onClick={() => setSelectedTree(null)} style={{
            background: 'none', border: `1px solid ${PALETTE.subtle}`,
            color: PALETTE.subtle, padding: '6px 12px', fontSize: 10,
            fontFamily: FONTS.mono, letterSpacing: '0.1em', cursor: 'pointer',
          }}>CLEAR</button>
        </div>
      )}
    </section>
  );
}

function Kicker({ children, color = PALETTE.moss }) {
  return (
    <div style={{
      fontFamily: FONTS.mono, fontSize: 11, fontWeight: 500,
      letterSpacing: '0.15em', textTransform: 'uppercase', color,
    }}>{children}</div>
  );
}

function RampLegend({ title, stops, discrete = false }) {
  return (
    <div style={{
      marginTop: 16, paddingTop: 14,
      borderTop: `1px solid ${PALETTE.rule}`,
    }}>
      <div style={{
        fontFamily: FONTS.mono, fontSize: 9, letterSpacing: '0.1em',
        color: PALETTE.subtle, textTransform: 'uppercase', marginBottom: 8,
      }}>{title}</div>
      {discrete ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {stops.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 14, height: 14, background: s.hex,
                border: `1px solid ${PALETTE.rule}`,
              }} />
              <span style={{ fontSize: 11, fontFamily: FONTS.mono }}>
                {s.value}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div style={{
            height: 12, marginBottom: 6,
            background: `linear-gradient(to right, ${stops.map(s => s.hex).join(', ')})`,
            border: `1px solid ${PALETTE.rule}`,
          }} />
          <div style={{
            display: 'flex', justifyContent: 'space-between',
            fontFamily: FONTS.mono, fontSize: 9, color: PALETTE.subtle,
          }}>
            <span>{stops[0].value}</span>
            <span>{stops[stops.length - 1].value}</span>
          </div>
        </>
      )}
    </div>
  );
}
