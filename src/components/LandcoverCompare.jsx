import React, { useEffect, useRef, useState, useMemo } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { PALETTE } from '../lib/colors.js';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

function linkMaps(a, b) {
  let syncing = false;
  const syncA = () => {
    if (syncing) return;
    syncing = true;
    b.jumpTo({
      center: a.getCenter(),
      zoom: a.getZoom(),
      pitch: a.getPitch(),
      bearing: a.getBearing(),
    });
    syncing = false;
  };
  const syncB = () => {
    if (syncing) return;
    syncing = true;
    a.jumpTo({
      center: b.getCenter(),
      zoom: b.getZoom(),
      pitch: b.getPitch(),
      bearing: b.getBearing(),
    });
    syncing = false;
  };
  a.on('move', syncA);
  b.on('move', syncB);
  return () => {
    a.off('move', syncA);
    b.off('move', syncB);
  };
}

export default function LandcoverCompare({ boundary, rasterBounds, imageBase }) {
  const leftRef = useRef(null);
  const rightRef = useRef(null);
  const [splitPct, setSplitPct] = useState(50);

  const b10 = rasterBounds?.lc2010?.bounds_4326;
  const b21 = rasterBounds?.lc2021?.bounds_4326;
  const p10 = rasterBounds?.lc2010?.path || 'rasters/lc2010.png';
  const p21 = rasterBounds?.lc2021?.path || 'rasters/lc2021.png';

  const center = useMemo(() => {
    try {
      const g = boundary?.features?.[0]?.geometry;
      if (!g) return [-73.951, 40.829];
      if (g.type === 'Polygon') {
        const ring = g.coordinates[0];
        let sx = 0;
        let sy = 0;
        ring.forEach(([x, y]) => { sx += x; sy += y; });
        return [sx / ring.length, sy / ring.length];
      }
    } catch {
      /* fall through */
    }
    return [-73.951, 40.829];
  }, [boundary]);

  useEffect(() => {
    if (!leftRef.current || !rightRef.current || !mapboxgl.accessToken) return;
    if (!b10 || !b21) return;

    const common = {
      style: 'mapbox://styles/mapbox/satellite-streets-v12',
      center,
      zoom: 15.2,
      pitch: 0,
      bearing: 0,
    };

    const mapL = new mapboxgl.Map({ container: leftRef.current, ...common });
    const mapR = new mapboxgl.Map({ container: rightRef.current, ...common });
    const unlink = linkMaps(mapL, mapR);

    const addBoundary = (m) => {
      if (!boundary) return;
      m.addSource('boundary', { type: 'geojson', data: boundary });
      m.addLayer({
        id: 'boundary-line',
        type: 'line',
        source: 'boundary',
        paint: { 'line-color': PALETTE.forest, 'line-width': 2 },
      });
    };

    const coords = (b) => [
      [b[0], b[3]],
      [b[2], b[3]],
      [b[2], b[1]],
      [b[0], b[1]],
    ];

    mapL.on('load', () => {
      addBoundary(mapL);
      mapL.addSource('lc2010', {
        type: 'image',
        url: `${imageBase}/${p10}`.replace(/\/{2,}/g, '/'),
        coordinates: coords(b10),
      });
      mapL.addLayer({ id: 'lc2010-layer', type: 'raster', source: 'lc2010', paint: { 'raster-opacity': 0.88 } });
    });
    mapR.on('load', () => {
      addBoundary(mapR);
      mapR.addSource('lc2021', {
        type: 'image',
        url: `${imageBase}/${p21}`.replace(/\/{2,}/g, '/'),
        coordinates: coords(b21),
      });
      mapR.addLayer({ id: 'lc2021-layer', type: 'raster', source: 'lc2021', paint: { 'raster-opacity': 0.88 } });
    });

    return () => {
      unlink();
      mapL.remove();
      mapR.remove();
    };
  }, [boundary, b10, b21, center, imageBase, p10, p21]);

  if (!mapboxgl.accessToken) {
    return <div style={{ padding: 24, fontFamily: 'system-ui' }}>Mapbox token required for land-cover compare.</div>;
  }

  if (!b10 || !b21) {
    return (
      <div style={{ padding: 20, background: PALETTE.elevated, border: `1px solid ${PALETTE.rule}`, fontSize: 13, color: PALETTE.ink }}>
        Land-cover compare needs <code>lc2010</code> and <code>lc2021</code> in <code>rasters/bounds.json</code> with
        matching PNGs from the pipeline (NYC 2010 + TNC 2021 rasters clipped).
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 480 }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.12em',
        color: PALETTE.subtle, padding: '0 4px 8px',
      }}>
        <span>2010 land cover (NYC)</span>
        <span>2021 land cover (TNC)</span>
      </div>
      <div style={{ position: 'relative', flex: 1, minHeight: 440 }}>
        <div style={{ display: 'flex', height: '100%' }}>
          <div ref={leftRef} style={{ width: `${splitPct}%`, height: '100%' }} />
          <div ref={rightRef} style={{ flex: 1, height: '100%' }} />
        </div>
        <input
          type="range"
          min={20}
          max={80}
          value={splitPct}
          onChange={(e) => setSplitPct(Number(e.target.value))}
          aria-label="Adjust split between 2010 and 2021 land cover"
          style={{
            position: 'absolute', left: `calc(${splitPct}% - 6px)`, top: 0, bottom: 0, width: 12, zIndex: 2,
            opacity: 0, cursor: 'ew-resize',
          }}
        />
      </div>
    </div>
  );
}
