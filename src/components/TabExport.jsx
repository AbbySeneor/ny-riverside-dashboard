import React, { useState, useMemo } from 'react';
import { PALETTE, FONTS } from '../lib/colors.js';
import {
  exportPDF, exportTreesGeoJSON, exportTreesCSV, exportScorecardCSV,
  shareableURL,
} from '../lib/exporters.js';
import { siteLabel, siteAcres } from '../siteMeta.js';
import { Link2, FileText, MapPin, Table, Check } from 'lucide-react';

export default function TabExport({ data, tabIndex }) {
  const [copied, setCopied] = useState(false);
  const [pdfGenerating, setPdfGenerating] = useState(false);

  const pdfCover = useMemo(() => {
    const b0 = data.boundary?.features?.[0]?.properties;
    const label = siteLabel(data.siteId);
    const cfgAcres = siteAcres(data.siteId);
    const parts = [
      b0?.name,
      b0?.extent,
      b0?.area_acres != null ? `${b0.area_acres} acres (boundary)` : null,
    ];
    if (cfgAcres != null && b0?.area_acres == null) parts.push(`${cfgAcres} acres (site config)`);
    const extentLine = parts.filter(Boolean).join(' · ') || null;
    const funderLine = b0?.funder && b0?.grant_usd != null && b0?.duration_years
      ? `Funder: ${b0.funder} ($${(Number(b0.grant_usd) / 1e6).toFixed(2)}M / ${b0.duration_years}-year)`
      : b0?.funder
        ? `Funder: ${b0.funder}`
        : null;
    return {
      siteTitle: `The ${label}`,
      extentLine,
      partnerLine: 'Restoration partner: Riverside Park Conservancy × NAC × NYC Parks',
      funderLine,
    };
  }, [data.boundary, data.siteId]);

  const handlePDF = async () => {
    setPdfGenerating(true);
    try {
      const dashboard = document.querySelector('main');
      await exportPDF(
        data.scorecard, data.ecosystemServices,
        data.treeSummary, data.lstZones, dashboard,
        pdfCover,
      );
    } finally {
      setPdfGenerating(false);
    }
  };

  const handleShare = () => {
    const url = shareableURL({
      siteId: data.siteId || 'west_harlem',
      tab: tabIndex,
    });
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    });
  };

  const exports = [
    {
      icon: FileText,
      title: 'Full baseline PDF',
      desc: 'Cover · scorecard · annotated map · methodology. ~4 pages.',
      action: handlePDF,
      buttonLabel: pdfGenerating ? 'Generating…' : 'Download PDF',
      disabled: !data.scorecard,
    },
    {
      icon: MapPin,
      title: 'Tree points (GeoJSON)',
      desc: `${data.trees?.features?.length ?? 0} features · WGS84 · QGIS / ArcGIS / Mapbox ready.`,
      action: () => exportTreesGeoJSON(data.trees),
      buttonLabel: 'Download GeoJSON',
      disabled: !data.trees?.features?.length,
    },
    {
      icon: Table,
      title: 'Scorecard (CSV)',
      desc: 'All 8 NAC FMF metrics with baseline, target, and source per row.',
      action: () => exportScorecardCSV(data.scorecard),
      buttonLabel: 'Download CSV',
      disabled: !data.scorecard,
    },
    {
      icon: Table,
      title: 'Tree inventory (CSV)',
      desc: 'Every tree with height, crown, health class, coordinates.',
      action: () => exportTreesCSV(data.trees),
      buttonLabel: 'Download CSV',
      disabled: !data.trees?.features?.length,
    },
    {
      icon: Link2,
      title: 'Shareable URL',
      desc: 'Copy a link to this exact dashboard view. Replace with signed R2 URL in prod.',
      action: handleShare,
      buttonLabel: copied ? '✓ Copied' : 'Copy link',
    },
  ];

  return (
    <section style={{ padding: '32px 36px' }}>
      <Kicker>export · share</Kicker>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: 16, marginTop: 18,
      }}>
        {exports.map((e, i) => {
          const Icon = e.icon;
          return (
            <div key={i} style={{
              background: PALETTE.elevated, border: `1px solid ${PALETTE.rule}`,
              padding: '20px 22px',
              display: 'flex', flexDirection: 'column',
              opacity: e.disabled ? 0.5 : 1,
            }}>
              <Icon size={22} color={PALETTE.forest} style={{ marginBottom: 12 }} />
              <div style={{
                fontFamily: FONTS.display, fontSize: 17, fontWeight: 400,
                marginBottom: 6,
              }}>{e.title}</div>
              <div style={{
                fontSize: 12, color: PALETTE.subtle,
                lineHeight: 1.5, marginBottom: 16, flex: 1,
              }}>{e.desc}</div>
              <button
                onClick={e.action}
                disabled={e.disabled}
                style={{
                  background: PALETTE.moss, color: PALETTE.onAccent,
                  border: 'none', padding: '10px 16px',
                  fontFamily: FONTS.mono, fontSize: 11,
                  letterSpacing: '0.1em', textTransform: 'uppercase',
                  cursor: e.disabled ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  gap: 8, transition: 'background 0.15s',
                }}
              >
                {e.buttonLabel.startsWith('✓') && <Check size={13} />}
                {e.buttonLabel}
              </button>
            </div>
          );
        })}
      </div>
    </section>
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
