import React, { useState, useRef, useEffect } from 'react';
import { Map as MapIcon, BarChart3, Thermometer, Activity, Send } from 'lucide-react';
import { useSiteData } from './hooks/useSiteData.js';
import { PALETTE, FONTS, RADIUS } from './lib/colors.js';
import { SITE_LIST, resolveSiteId, siteLabel, siteAcres } from './siteMeta.js';
import TabSite from './components/TabSite.jsx';
import TabCanopy from './components/TabCanopy.jsx';
import TabScorecard from './components/TabScorecard.jsx';
import TabHeatEquity from './components/TabHeatEquity.jsx';
import TabExport from './components/TabExport.jsx';

const TABS = [
  { num: '01', label: 'The site', icon: MapIcon, Component: TabSite },
  { num: '02', label: 'Canopy decline', icon: Activity, Component: TabCanopy },
  { num: '03', label: 'Scorecard', icon: BarChart3, Component: TabScorecard },
  { num: '04', label: 'Heat equity', icon: Thermometer, Component: TabHeatEquity },
  { num: '05', label: 'Export', icon: Send, Component: TabExport },
];

function tabFromUrl() {
  const t = new URLSearchParams(window.location.search).get('tab');
  const n = t != null ? parseInt(t, 10) : NaN;
  if (Number.isFinite(n) && n >= 0 && n < TABS.length) return n;
  return 0;
}

export default function App() {
  const [siteId, setSiteId] = useState(resolveSiteId);
  const [tab, setTab] = useState(tabFromUrl);
  const data = useSiteData(siteId);
  const dashboardRef = useRef(null);

  useEffect(() => {
    try {
      localStorage.setItem('treelyon_site_id', siteId);
    } catch {
      /* ignore */
    }
    const u = new URL(window.location.href);
    u.searchParams.set('site', siteId);
    u.searchParams.set('tab', String(tab));
    window.history.replaceState({}, '', u);
  }, [siteId, tab]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      if (e.key === '[') {
        e.preventDefault();
        setTab((t) => Math.max(0, t - 1));
      }
      if (e.key === ']') {
        e.preventDefault();
        setTab((t) => Math.min(TABS.length - 1, t + 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const ActiveTab = TABS[tab].Component;

  if (!data.loaded) {
    return <LoadingShell />;
  }

  const hasErrors = data.errors.length > 0;

  return (
    <div
      ref={dashboardRef}
      className="dashboard-root"
      style={{
        minHeight: '100vh',
        background: PALETTE.bg,
        color: PALETTE.ink,
        fontFamily: FONTS.body,
      }}
    >
      <Header tab={tab} setTab={setTab} siteId={siteId} setSiteId={setSiteId} />
      {hasErrors && (
        <DataMissingBanner
          errors={data.errors}
          siteId={siteId}
          onCopyCommand={data.copyPipelineCommand}
        />
      )}
      <main>
        <ActiveTab data={data} tabIndex={tab} />
      </main>
      <Footer />
    </div>
  );
}

function LoadingShell() {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: PALETTE.bg,
        padding: '28px 36px',
      }}
    >
      <div style={{ height: 14, width: 220, background: PALETTE.rule, marginBottom: 20 }} />
      <div style={{ height: 36, width: '55%', maxWidth: 480, background: PALETTE.rule, marginBottom: 28 }} />
      <div style={{ display: 'flex', gap: 12, marginBottom: 32 }}>
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} style={{ height: 36, width: 100, background: PALETTE.elevated, border: `1px solid ${PALETTE.rule}` }} />
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 24, height: 420 }}>
        <div style={{ background: PALETTE.elevated, border: `1px solid ${PALETTE.rule}` }} />
        <div style={{ background: PALETTE.elevated, border: `1px solid ${PALETTE.rule}` }} />
      </div>
      <div style={{ marginTop: 20, fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '0.12em', color: PALETTE.subtle }}>
        LOADING SITE DATA…
      </div>
    </div>
  );
}

function Header({ tab, setTab, siteId, setSiteId }) {
  const acres = siteAcres(siteId);
  const label = siteLabel(siteId);

  return (
    <header
      style={{
        background: PALETTE.paper,
        borderBottom: `1px solid ${PALETTE.rule}`,
        position: 'sticky',
        top: 0,
        zIndex: 50,
        backdropFilter: 'blur(12px)',
      }}
    >
      {/* Top: brands + title (left) · site (right) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 20,
          padding: '14px 32px',
          flexWrap: 'wrap',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            minWidth: 0,
            flex: '1 1 280px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
            <a href="https://treelyon.com" target="_blank" rel="noreferrer" style={{ lineHeight: 0 }}>
              <img src="/brands/treelyon.png" alt="Treelyon" style={{ height: 32, width: 'auto', display: 'block' }} />
            </a>
            <a href="https://riversideparknyc.org" target="_blank" rel="noreferrer" style={{ lineHeight: 0 }}>
              <img src="/brands/riverside.png" alt="Riverside Park Conservancy" style={{ height: 32, width: 'auto', display: 'block' }} />
            </a>
          </div>
          <div
            style={{
              borderLeft: `1px solid ${PALETTE.rule}`,
              paddingLeft: 16,
              marginLeft: 2,
              minWidth: 0,
            }}
          >
            <h1
              style={{
                fontFamily: FONTS.display,
                fontSize: 'clamp(1.05rem, 2.2vw, 1.45rem)',
                fontWeight: 500,
                letterSpacing: '-0.02em',
                lineHeight: 1.25,
                margin: 0,
                color: PALETTE.ink,
              }}
            >
              {label},{' '}
              <em style={{ color: PALETTE.forest, fontStyle: 'italic', fontWeight: 400 }}>measured.</em>
            </h1>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <label htmlFor="site-picker" style={{ fontSize: 12, color: PALETTE.bodyMuted, fontWeight: 500 }}>
            Site
          </label>
          <select
            id="site-picker"
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
            style={{
              fontFamily: FONTS.body,
              fontSize: 13,
              padding: '8px 14px',
              borderRadius: RADIUS.sm,
              border: `1px solid ${PALETTE.rule}`,
              background: PALETTE.elevated,
              color: PALETTE.ink,
              minWidth: 180,
              maxWidth: 280,
              cursor: 'pointer',
            }}
          >
            {SITE_LIST.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label} · {s.acres} ac
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Full-width tab bar */}
      <nav
        style={{
          display: 'flex',
          width: '100%',
          borderTop: `1px solid ${PALETTE.rule}`,
        }}
        role="tablist"
        aria-label="Dashboard sections"
      >
        {TABS.map((t, i) => {
          const Icon = t.icon;
          const active = tab === i;
          return (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(i)}
              style={{
                flex: '1 1 0',
                minWidth: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: '14px 10px',
                border: 'none',
                borderBottom: `2px solid ${active ? PALETTE.forest : 'transparent'}`,
                marginBottom: -1,
                background: active ? 'rgba(110, 231, 197, 0.06)' : 'transparent',
                color: active ? PALETTE.ink : PALETTE.bodyMuted,
                fontFamily: FONTS.body,
                fontSize: 'clamp(11px, 1.35vw, 13px)',
                fontWeight: active ? 600 : 500,
                cursor: 'pointer',
                transition: 'color 0.15s, border-color 0.15s, background 0.15s',
              }}
            >
              <Icon size={16} strokeWidth={2} style={{ flexShrink: 0, opacity: active ? 0.95 : 0.45 }} aria-hidden />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.label}</span>
            </button>
          );
        })}
      </nav>

      {acres != null && (
        <div
          style={{
            padding: '8px 32px 10px',
            fontSize: 11,
            color: PALETTE.subtle,
            borderTop: `1px solid ${PALETTE.rule}`,
            background: PALETTE.bg,
          }}
        >
          <span style={{ fontFamily: FONTS.mono, letterSpacing: '0.04em' }}>
            {acres} acres · {siteId}
          </span>
        </div>
      )}
    </header>
  );
}

function DataMissingBanner({ errors, siteId, onCopyCommand }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <div
      style={{
        background: PALETTE.bannerWarnBg,
        borderBottom: `1px solid ${PALETTE.bannerWarnBorder}`,
        padding: '12px 36px',
        fontSize: 12,
        color: PALETTE.bannerWarnText,
        fontFamily: FONTS.mono,
        letterSpacing: '0.05em',
      }}
    >
      <strong>{errors.length} data files missing</strong>
      {' - '}
      run the prep pipeline for <strong>{siteId}</strong>, then{' '}
      <code style={{ background: PALETTE.bannerCodeBg, padding: '2px 6px', color: PALETTE.bannerWarnText }}>
        npm run sync:data
      </code>{' '}
      (writes <code style={{ background: PALETTE.bannerCodeBg, padding: '2px 6px', color: PALETTE.bannerWarnText }}>public/data/{siteId}/</code>)
      <div style={{ marginTop: 8, color: PALETTE.subtle, fontSize: 11 }}>
        ({errors.map((e) => e.key).join(', ')})
      </div>
      <button
        type="button"
        className="no-print"
        onClick={() => {
          onCopyCommand();
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
        style={{
          marginTop: 10,
          background: PALETTE.forest,
          color: PALETTE.onAccent,
          border: 'none',
          borderRadius: RADIUS.sm,
          padding: '8px 14px',
          fontFamily: FONTS.mono,
          fontSize: 10,
          letterSpacing: '0.1em',
          cursor: 'pointer',
        }}
      >
        {copied ? 'COPIED' : 'COPY RUN COMMAND'}
      </button>
    </div>
  );
}

function Footer() {
  return (
    <footer
      style={{
        borderTop: `1px solid ${PALETTE.rule}`,
        padding: '24px 36px',
        background: PALETTE.paper,
        marginTop: 48,
        fontFamily: FONTS.body,
        fontSize: 11,
        color: PALETTE.subtle,
        lineHeight: 1.55,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 20, flexWrap: 'wrap' }} className="no-print">
        <img src="/brands/treelyon.png" alt="" style={{ height: 28, opacity: 0.9 }} />
        <img src="/brands/riverside.png" alt="" style={{ height: 28, opacity: 0.9 }} />
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '2fr 1fr 1fr',
          gap: 32,
        }}
      >
      <div>
        <strong style={{ color: PALETTE.ink }}>Data sources:</strong>{' '}
        TNC/UVM SAL 2021 (Zenodo 14053441) · NYC Open Data 2010-2017 land cover ·
        NYC 1-ft DEM · Sentinel-2 SR Harmonized · Landsat 8/9 C2L2 ·
        NYC DOHMH HVI · NAC Forest Management Framework · i-Tree Eco unit values (USFS-NRS RB-117).
      </div>
      <div>
        <strong style={{ color: PALETTE.ink }}>Treelyon</strong>
        <br />
        info@treelyon.com
      </div>
      <div>
        <strong style={{ color: PALETTE.ink }}>Methodology</strong>
        <br />
        All site-specific numbers reproducible from the open-source pipeline in /data-prep. Phase-1 ground truth replaces
        remote-sensed proxies.
      </div>
      </div>
    </footer>
  );
}
