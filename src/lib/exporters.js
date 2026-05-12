/**
 * Export utilities — PDF report, GeoJSON, CSV, shareable URL.
 */
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import Papa from 'papaparse';

/**
 * Trigger a browser download of any blob/string/object.
 */
export function downloadBlob(content, filename, mimeType = 'application/octet-stream') {
  const blob = content instanceof Blob ? content : new Blob([
    typeof content === 'string' ? content : JSON.stringify(content, null, 2),
  ], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Export the tree GeoJSON exactly as served — for downstream GIS work.
 */
export function exportTreesGeoJSON(treeFeatureCollection) {
  downloadBlob(
    JSON.stringify(treeFeatureCollection, null, 2),
    `treelyon_riverside_trees_${stamp()}.geojson`,
    'application/geo+json'
  );
}

/**
 * Flatten the scorecard into CSV for spreadsheet users.
 */
export function exportScorecardCSV(scorecard) {
  const rows = scorecard.metrics.map((m) => ({
    metric: m.metric,
    domain: m.domain,
    unit: m.unit,
    baseline: m.baseline ?? '',
    target_y3: m.target ?? '',
    delta: (m.target != null && m.baseline != null)
      ? (m.inverse ? m.baseline - m.target : m.target - m.baseline)
      : '',
    source: m.source,
  }));
  const csv = Papa.unparse(rows);
  downloadBlob(csv, `treelyon_riverside_scorecard_${stamp()}.csv`, 'text/csv');
}

/**
 * Tree details to CSV.
 */
export function exportTreesCSV(trees) {
  if (!trees?.features?.length) return;
  const rows = trees.features.map((f, i) => ({
    id: f.properties?.site_id ?? i,
    longitude: f.geometry.coordinates[0],
    latitude: f.geometry.coordinates[1],
    height_m: f.properties?.height_m ?? '',
    crown_diameter_m: f.properties?.crown_diameter ?? '',
    health_class: f.properties?.health_class ?? '',
    species_genus: f.properties?.species_genus ?? '',
  }));
  downloadBlob(Papa.unparse(rows), `treelyon_riverside_trees_${stamp()}.csv`, 'text/csv');
}

/**
 * Generate a multi-page PDF report from the dashboard.
 *  - Page 1: cover
 *  - Pages 2-N: rasterised screenshots of each tab
 *  - Final page: data sources
 * @param {object} [cover] — optional cover lines from loaded site data (avoid hardcoded site copy).
 */
export async function exportPDF(scorecard, ecosystem, treeSummary, lstZones, dashboardEl, cover = {}) {
  const {
    siteTitle = 'Baseline site',
    extentLine = 'Populate public/data via pipeline (npm run sync:data).',
    partnerLine = 'Riverside Park Conservancy × NAC × NYC Parks',
    funderLine = null,
  } = cover;
  const pdf = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();

  // === COVER PAGE ===
  pdf.setFillColor(245, 241, 232);
  pdf.rect(0, 0, W, H, 'F');

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.setTextColor(61, 107, 61);
  pdf.text('TREELYON · RIVERSIDE PARK CONSERVANCY · BASELINE REPORT', 48, 64);

  pdf.setFontSize(36);
  pdf.setTextColor(26, 31, 26);
  pdf.text(`${siteTitle},`, 48, 140);
  pdf.setFont('helvetica', 'italic');
  pdf.setTextColor(61, 107, 61);
  pdf.text('measured.', 48, 188);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.setTextColor(138, 138, 130);
  const ext = String(extentLine || '').slice(0, 120);
  pdf.text(ext, 48, 218);
  pdf.text(partnerLine.slice(0, 120), 48, 234);
  let yMeta = 250;
  if (funderLine) {
    pdf.text(String(funderLine).slice(0, 120), 48, yMeta);
    yMeta += 16;
  }
  pdf.text(`Generated: ${new Date().toUTCString()}`, 48, yMeta);

  // Headline metrics on cover
  pdf.setFontSize(8);
  pdf.text('BASELINE 2026', 48, 320);
  pdf.setLineWidth(0.5);
  pdf.line(48, 326, W - 48, 326);
  let y = 348;
  const headline = [
    ['Trees mapped (LiDAR)',  treeSummary?.count, ''],
    ['Mean canopy height',     treeSummary?.mean_height_m, 'm'],
    ['Cooling vs Riv. Drive',  lstZones?.cooling_vs_street_F, '°F'],
    ['Annual ecosystem value', ecosystem?.total_annual_usd
        ? `$${ecosystem.total_annual_usd.toLocaleString()}` : null, ''],
  ];
  headline.forEach(([label, val, unit]) => {
    pdf.setTextColor(138, 138, 130);
    pdf.setFontSize(8);
    pdf.text(label, 48, y);
    pdf.setTextColor(26, 31, 26);
    pdf.setFontSize(20);
    pdf.text(`${val ?? '—'}${unit}`, 240, y);
    y += 32;
  });

  // === SCORECARD PAGE ===
  if (scorecard) {
    pdf.addPage();
    pdf.setFillColor(245, 241, 232);
    pdf.rect(0, 0, W, H, 'F');
    pdf.setFontSize(8);
    pdf.setTextColor(61, 107, 61);
    pdf.text('NAC FOREST MANAGEMENT FRAMEWORK · RAPID SITE ASSESSMENT', 48, 48);

    pdf.setFontSize(22);
    pdf.setTextColor(26, 31, 26);
    pdf.text('Scorecard', 48, 88);

    let row = 132;
    pdf.setFontSize(8);
    pdf.setTextColor(138, 138, 130);
    pdf.text('METRIC', 48, row);
    pdf.text('BASELINE', 360, row);
    pdf.text('TARGET Y3', 460, row);
    pdf.text('SOURCE', 560, row);
    pdf.line(48, row + 6, W - 48, row + 6);
    row += 22;

    scorecard.metrics.forEach((m) => {
      if (row > H - 60) return;
      pdf.setTextColor(26, 31, 26);
      pdf.setFontSize(11);
      pdf.text(m.metric, 48, row);
      pdf.setFontSize(13);
      pdf.text(`${m.baseline ?? '—'}${m.unit || ''}`, 360, row);
      pdf.setTextColor(61, 107, 61);
      pdf.text(`${m.target ?? '—'}${m.unit || ''}`, 460, row);
      pdf.setFontSize(8);
      pdf.setTextColor(138, 138, 130);
      const src = (m.source || '').slice(0, 30);
      pdf.text(src, 560, row);
      row += 24;
    });
  }

  // === DASHBOARD SCREENSHOT PAGE ===
  if (dashboardEl) {
    try {
      const canvas = await html2canvas(dashboardEl, {
        scale: 1.5,
        backgroundColor: '#f5f1e8',
        logging: false,
      });
      const img = canvas.toDataURL('image/jpeg', 0.85);
      pdf.addPage();
      const ratio = canvas.width / canvas.height;
      const imgW = W - 96;
      const imgH = imgW / ratio;
      pdf.addImage(img, 'JPEG', 48, 48, imgW, Math.min(imgH, H - 96));
    } catch (e) {
      console.warn('Dashboard screenshot failed:', e);
    }
  }

  // === SOURCES PAGE ===
  pdf.addPage();
  pdf.setFillColor(245, 241, 232);
  pdf.rect(0, 0, W, H, 'F');
  pdf.setFontSize(8);
  pdf.setTextColor(61, 107, 61);
  pdf.text('METHODOLOGY · DATA SOURCES', 48, 48);
  pdf.setFontSize(22);
  pdf.setTextColor(26, 31, 26);
  pdf.text('How this report was built', 48, 88);

  const sources = [
    ['Tree centroids + crown polygons', 'TNC × UVM SAL · 2021 NYC LiDAR-derived (Zenodo 14053441)'],
    ['Canopy cover 2010, 2017, 2021', '6-inch land cover from NYC Open Data + TNC 2021'],
    ['2017→2021 canopy change', 'TNC × UVM SAL pixel-level change raster'],
    ['Site slope', 'NYC 1-foot LiDAR-derived bare-earth DEM (NYS GIS Clearinghouse)'],
    ['Landsat thermal (LST)', 'Landsat 8/9 C2L2 ST_B10, July+August median 2020-2025'],
    ['NDVI time series', 'Sentinel-2 SR Harmonized, monthly composites'],
    ['Invasive zone proxy', 'Sentinel-2 NDVI phenology (porcelain-berry / English ivy signature)'],
    ['Ecosystem services valuation', 'i-Tree Eco unit values (USFS-NRS RB-117) × computed canopy'],
    ['Heat Vulnerability Index', 'NYC DOHMH Environmental Health Tracking 2018'],
    ['Forest Management Framework', 'NAC × NYC Parks 2018 (25-year plan, Rapid Site Assessment)'],
  ];

  let y2 = 132;
  sources.forEach(([what, src]) => {
    pdf.setFontSize(11);
    pdf.setTextColor(26, 31, 26);
    pdf.text(what, 48, y2);
    pdf.setFontSize(9);
    pdf.setTextColor(138, 138, 130);
    pdf.text(src, 48, y2 + 14);
    y2 += 38;
  });

  // Footer on all pages
  const pages = pdf.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i);
    pdf.setFontSize(7);
    pdf.setTextColor(138, 138, 130);
    pdf.text(`Treelyon · abby@treelyon.com · page ${i} of ${pages}`, 48, H - 24);
  }

  pdf.save(`treelyon_riverside_baseline_${stamp()}.pdf`);
}

function stamp() {
  const d = new Date();
  return `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}${String(d.getUTCDate()).padStart(2,'0')}`;
}

/**
 * Compose a shareable URL with site and tab in the query string (stable for email/slides).
 */
export function shareableURL(state) {
  const u = new URL(window.location.href);
  u.searchParams.set('site', state.siteId || 'west_harlem');
  if (state.tab != null && state.tab !== '') u.searchParams.set('tab', String(state.tab));
  u.hash = '';
  return u.toString();
}

export function readShareableURL() {
  const m = window.location.hash.match(/s=([^&]+)/);
  if (!m) return null;
  try {
    return JSON.parse(atob(m[1]));
  } catch {
    return null;
  }
}
