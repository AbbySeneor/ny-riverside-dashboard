import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import * as turf from '@turf/turf';
import { PALETTE, TREE_HEALTH_PAINT, FONTS } from '../lib/colors.js';
import 'mapbox-gl/dist/mapbox-gl.css';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const SITE_CENTER = [-73.951, 40.829];

function layerKeys(layersSet) {
  if (!layersSet) return new Set();
  if (layersSet instanceof Set) return layersSet;
  if (Array.isArray(layersSet)) return new Set(layersSet);
  return new Set();
}

/** `beforeId` must reference an existing layer or Mapbox throws and aborts the rest of setup. */
function safeBeforeId(m, layerId) {
  return m.getLayer(layerId) ? layerId : undefined;
}

/** RFC 7946 GeoJSON only; pipeline files may include legacy `crs` which can break GL parsers. */
function geoJsonForMap(fc) {
  if (!fc || typeof fc !== 'object') return fc;
  const { crs, ...rest } = fc;
  return rest;
}

function rasterUrl(imageBase, rasterBoundsEntry, fallbackPath) {
  const p = rasterBoundsEntry?.path || fallbackPath;
  if (!p) return null;
  // `path` in bounds.json is typically "rasters/<name>.png"
  return p.startsWith('http') ? p : `${imageBase}/${p}`.replace(/\/{2,}/g, '/');
}

/** Apply UI layer toggles — call after custom layers exist and whenever `layers` changes. */
function applyLayerVisibility(m, layersSet) {
  if (!m || !m.isStyleLoaded()) return;
  const keys = layerKeys(layersSet);
  const setOp = (id, prop, val) => {
    if (m.getLayer(id)) m.setPaintProperty(id, prop, val);
  };
  setOp('trees', 'circle-opacity', keys.has('trees') ? 0.85 : 0);
  setOp('trees', 'circle-stroke-width', keys.has('trees') ? 0.5 : 0);
  setOp('trees-hit', 'circle-opacity', keys.has('trees') ? 0.0001 : 0);
  setOp('slope-raster', 'raster-opacity', keys.has('slope') ? 0.65 : 0);
  setOp('lst-raster', 'raster-opacity', keys.has('lst') ? 0.7 : 0);
  setOp('canopy-change-raster', 'raster-opacity', keys.has('canopy_change') ? 0.75 : 0);
  setOp('invasive-fill', 'fill-opacity', keys.has('invasive') ? 0.35 : 0);
  setOp('invasive-line', 'line-opacity', keys.has('invasive') ? 0.9 : 0);
  setOp('hvi-fill', 'fill-opacity', keys.has('hvi') ? 0.45 : 0);
}

function mean(nums) {
  const v = nums.filter((n) => Number.isFinite(n));
  if (!v.length) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

function computeDrawMetrics(polygonFeature, treesFc) {
  const poly = polygonFeature;
  const trees = (treesFc?.features || []).filter(Boolean);
  const inside = trees.filter((t) => {
    const g = t.geometry;
    if (!g) return false;
    try {
      if (g.type === 'Point') return turf.booleanPointInPolygon(g, poly);
      return turf.booleanPointInPolygon(turf.centroid(t), poly);
    } catch {
      return false;
    }
  });
  const areaM2 = turf.area(poly);
  const acres = areaM2 * 0.000247105;
  const heights = inside.map((f) => Number(f.properties?.height_m)).filter(Number.isFinite);
  const canopyVals = inside
    .map((f) => Number(f.properties?.canopy_cover_pct ?? f.properties?.canopy_pct))
    .filter(Number.isFinite);
  const slopes = inside.map((f) => Number(f.properties?.slope_deg)).filter(Number.isFinite);
  const lst = inside.map((f) => Number(f.properties?.lst_c)).filter(Number.isFinite);
  let canopyPct = null;
  if (canopyVals.length) canopyPct = mean(canopyVals);
  else {
    const crowns = inside
      .map((f) => {
        const d = Number(f.properties?.crown_diameter ?? f.properties?.crown_diameter_m);
        if (!Number.isFinite(d) || d <= 0) return 0;
        return Math.PI * (d / 2) ** 2;
      })
      .reduce((a, b) => a + b, 0);
    if (areaM2 > 0 && crowns > 0) canopyPct = Math.min(100, (crowns / areaM2) * 100);
  }
  return {
    acres,
    treeCount: inside.length,
    meanHeightM: mean(heights),
    canopyPct,
    meanSlopeDeg: mean(slopes),
    meanLstC: mean(lst),
  };
}

/**
 * Props:
 *   imageBase       — e.g. `/data/west_harlem` for raster PNG URLs
 *   layers, onTreeClick, onMapReady, data, highlightZone — as before
 */
export default function MapView({
  layers = new Set(['trees', 'boundary']),
  onTreeClick,
  onMapReady,
  data,
  highlightZone,
  imageBase = '/data/west_harlem',
}) {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const drawRef = useRef(null);
  const treesDataRef = useRef(null);
  const [hoverTip, setHoverTip] = useState(null);
  const [drawMetrics, setDrawMetrics] = useState(null);
  const popupRef = useRef(null);
  const layersRef = useRef(layers);
  layersRef.current = layers;

  treesDataRef.current = data?.trees;

  useEffect(() => {
    if (map.current || !mapContainer.current) return;

    if (!mapboxgl.accessToken) {
      console.warn('Mapbox token missing — set VITE_MAPBOX_TOKEN in .env.local');
    }

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/satellite-streets-v12',
      center: SITE_CENTER,
      zoom: 15.2,
      pitch: 0,
      bearing: -8,
      /** GL v3 defaults to globe at higher zooms; fills/circles often fail to show — stay flat. */
      projection: { name: 'mercator' },
      attributionControl: false,
    });

    map.current.addControl(new mapboxgl.NavigationControl({ showCompass: true }), 'top-right');
    map.current.addControl(new mapboxgl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    map.current.addControl(new mapboxgl.AttributionControl({
      compact: true,
      customAttribution: 'Treelyon · Open data: TNC, NYC, Sentinel-2, Landsat',
    }), 'bottom-right');

    const draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: { polygon: true, trash: true },
      defaultMode: 'simple_select',
    });
    map.current.addControl(draw, 'top-right');
    drawRef.current = draw;

    const onDrawUpdate = (e) => {
      const poly = e.features?.find((f) =>
        f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon');
      if (!poly) return;
      setDrawMetrics(computeDrawMetrics(poly, treesDataRef.current));
    };
    const onDrawDelete = () => setDrawMetrics(null);

    map.current.on('draw.create', onDrawUpdate);
    map.current.on('draw.update', onDrawUpdate);
    map.current.on('draw.delete', onDrawDelete);

    // Site overlays run from the data effect after style load. 3D terrain is disabled so
    // circle/fill overlays stay visible (terrain + pitch often hid tree points on satellite).
    map.current.on('load', () => {
      onMapReady && onMapReady(map.current);
    });

    return () => {
      if (map.current) {
        map.current.off('draw.create', onDrawUpdate);
        map.current.off('draw.update', onDrawUpdate);
        map.current.off('draw.delete', onDrawDelete);
      }
      drawRef.current = null;
      map.current?.remove();
      map.current = null;
    };
  }, [onMapReady]);

  useEffect(() => {
    const m = map.current;
    if (!m || !data) return;

    const syncDataLayers = () => {
      if (!m.isStyleLoaded()) return;

      try {
        m.setProjection?.({ name: 'mercator' });
      } catch {
        /* ignore */
      }

      const warn = (label, e) => {
        console.warn(`MapView: ${label}`, e);
      };

      try {
        if (!m.getLayer('warm-tint')) {
          m.addLayer({
            id: 'warm-tint',
            type: 'background',
            paint: {
              'background-color': PALETTE.deep,
              'background-opacity': 0.12,
            },
          });
        }
      } catch (e) {
        warn('warm-tint', e);
      }

    try {
    if (data.boundary && !m.getSource('boundary')) {
      const boundaryGj = geoJsonForMap(data.boundary);
      m.addSource('boundary', { type: 'geojson', data: boundaryGj });
      m.addLayer({
        id: 'boundary-fill',
        type: 'fill',
        source: 'boundary',
        paint: {
          'fill-color': PALETTE.forest,
          'fill-opacity': 0.22,
        },
      });
      m.addLayer({
        id: 'boundary-line',
        type: 'line',
        source: 'boundary',
        paint: {
          'line-color': PALETTE.forest,
          'line-width': 3,
          'line-dasharray': [2, 1.5],
        },
      });
      try {
        const boundaryBbox = turf.bbox(boundaryGj);
        const treeBbox = data.trees?.features?.length
          ? turf.bbox(geoJsonForMap(data.trees))
          : null;
        const fitBbox = data.siteId === 'west_harlem' && treeBbox
          ? treeBbox
          : boundaryBbox;
        m.fitBounds(
          [[fitBbox[0], fitBbox[1]], [fitBbox[2], fitBbox[3]]],
          { padding: 48, duration: 800, maxZoom: data.siteId === 'west_harlem' ? 18 : 17 },
        );
      } catch {
        /* ignore */
      }
    }
    } catch (e) {
      warn('boundary', e);
    }

    try {
    if (data.context && !m.getSource('context')) {
      m.addSource('context', { type: 'geojson', data: geoJsonForMap(data.context) });
      m.addLayer({
        id: 'context-goatham',
        type: 'fill',
        source: 'context',
        filter: ['==', ['get', 'kind'], 'goatham'],
        paint: {
          'fill-color': PALETTE.sage,
          'fill-opacity': 0.18,
          'fill-outline-color': PALETTE.forest,
        },
      });
      m.addLayer({
        id: 'context-infrastructure',
        type: 'fill',
        source: 'context',
        filter: ['==', ['get', 'kind'], 'infrastructure'],
        paint: {
          'fill-color': PALETTE.ink,
          'fill-opacity': 0.22,
        },
      });
      m.addLayer({
        id: 'context-labels',
        type: 'symbol',
        source: 'context',
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Italic', 'Arial Unicode MS Regular'],
          'text-size': 11,
          'text-offset': [0, 0.6],
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': PALETTE.ink,
          'text-halo-color': PALETTE.deep,
          'text-halo-width': 1.5,
        },
      });
    }
    } catch (e) {
      warn('context', e);
    }

    try {
    if (data.trees && !m.getSource('trees')) {
      m.addSource('trees', { type: 'geojson', data: geoJsonForMap(data.trees) });
      m.addLayer({
        id: 'trees-hit',
        type: 'circle',
        source: 'trees',
        layout: {
          'circle-pitch-alignment': 'map',
          'circle-pitch-scale': 'map',
        },
        paint: {
          'circle-radius': 14,
          'circle-opacity': 0.0001,
          'circle-color': '#000',
        },
      });
      m.addLayer({
        id: 'trees',
        type: 'circle',
        source: 'trees',
        layout: {
          'circle-pitch-alignment': 'map',
          'circle-pitch-scale': 'map',
        },
        paint: TREE_HEALTH_PAINT,
      });

      m.on('click', 'trees-hit', (e) => {
        const f = e.features?.[0];
        if (!f) return;
        if (popupRef.current) popupRef.current.remove();
        const props = f.properties || {};
        const genus = props.species_genus
          ? `<div>genus</div><div><i>${props.species_genus}</i></div>`
          : `<div>genus</div><div style="color:${PALETTE.subtle}">Unknown · pending Phase 1 ground truth</div>`;
        const healthNote = props.health_class
          ? ''
          : `<div style="grid-column:1/-1;font-size:10px;color:${PALETTE.subtle};margin-top:4px">Health NDVI proxy: Sentinel-2 July max (see methodology).</div>`;
        const html = `
          <div style="font-family: 'Figtree', sans-serif; font-size: 12px; color: ${PALETTE.ink}; padding: 4px 6px; min-width: 200px;">
            <div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.1em; color: ${PALETTE.subtle}; text-transform: uppercase; margin-bottom: 6px;">tree · TNC 2021 LiDAR</div>
            <div style="display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; font-family: 'JetBrains Mono', monospace; font-size: 11px;">
              ${props.height_m ? `<div>height</div><div>${props.height_m} m</div>` : ''}
              ${props.crown_diameter ? `<div>crown</div><div>${props.crown_diameter} m</div>` : ''}
              ${props.health_class ? `<div>health</div><div style="color:${
                props.health_class === 'critical' ? PALETTE.coral :
                props.health_class === 'stressed' ? PALETTE.ochre : PALETTE.moss
              }">${props.health_class}</div>` : ''}
              ${props.site_id ? `<div>id</div><div>#${props.site_id}</div>` : ''}
              ${genus}
              ${healthNote}
            </div>
          </div>`;
        popupRef.current = new mapboxgl.Popup({
          closeButton: true,
          closeOnClick: true,
          offset: 8,
          className: 'treelyon-popup',
        })
          .setLngLat(e.lngLat)
          .setHTML(html)
          .addTo(m);
        onTreeClick && onTreeClick(f);
      });

      const showHover = (e) => {
        m.getCanvas().style.cursor = 'pointer';
        const f = e.features?.[0];
        const h = f?.properties?.height_m;
        if (Number.isFinite(Number(h))) {
          const pt = m.project(e.lngLat);
          setHoverTip({ x: pt.x, y: pt.y, text: `${Number(h).toFixed(1)} m` });
        } else setHoverTip(null);
      };
      m.on('mouseenter', 'trees-hit', showHover);
      m.on('mousemove', 'trees-hit', showHover);
      m.on('mouseleave', 'trees-hit', () => {
        m.getCanvas().style.cursor = '';
        setHoverTip(null);
      });
    }
    } catch (e) {
      warn('trees', e);
    }

    const imgCoords = (b) => [
      [b[0], b[3]],
      [b[2], b[3]],
      [b[2], b[1]],
      [b[0], b[1]],
    ];

    try {
    if (data.rasterBounds?.slope && !m.getSource('slope-raster')) {
      const entry = data.rasterBounds.slope;
      const b = entry.bounds_4326;
      const url = rasterUrl(imageBase, entry, 'rasters/slope.png');
      if (!url) throw new Error('Missing slope raster URL');
      m.addSource('slope-raster', {
        type: 'image',
        url,
        coordinates: imgCoords(b),
      });
      m.addLayer({
        id: 'slope-raster',
        type: 'raster',
        source: 'slope-raster',
        paint: { 'raster-opacity': 0 },
      }, safeBeforeId(m, 'boundary-line'));
    }
    } catch (e) {
      warn('slope raster', e);
    }

    try {
    if (data.rasterBounds?.lst && !m.getSource('lst-raster')) {
      const entry = data.rasterBounds.lst;
      const b = entry.bounds_4326;
      const url = rasterUrl(imageBase, entry, 'rasters/lst.png');
      if (!url) throw new Error('Missing LST raster URL');
      m.addSource('lst-raster', {
        type: 'image',
        url,
        coordinates: imgCoords(b),
      });
      m.addLayer({
        id: 'lst-raster',
        type: 'raster',
        source: 'lst-raster',
        paint: { 'raster-opacity': 0 },
      }, safeBeforeId(m, 'boundary-line'));
    }
    } catch (e) {
      warn('lst raster', e);
    }

    try {
    if (data.rasterBounds?.canopychange_2017_2021 && !m.getSource('canopy-change-raster')) {
      const entry = data.rasterBounds.canopychange_2017_2021;
      const b = entry.bounds_4326;
      const url = rasterUrl(imageBase, entry, 'rasters/canopy_change.png');
      if (!url) throw new Error('Missing canopy-change raster URL');
      m.addSource('canopy-change-raster', {
        type: 'image',
        url,
        coordinates: imgCoords(b),
      });
      m.addLayer({
        id: 'canopy-change-raster',
        type: 'raster',
        source: 'canopy-change-raster',
        paint: { 'raster-opacity': 0 },
      }, safeBeforeId(m, 'boundary-line'));
    }
    } catch (e) {
      warn('canopy-change raster', e);
    }

    try {
    if (data.invasive && !m.getSource('invasive')) {
      m.addSource('invasive', { type: 'geojson', data: geoJsonForMap(data.invasive) });
      m.addLayer({
        id: 'invasive-fill',
        type: 'fill',
        source: 'invasive',
        paint: {
          'fill-color': [
            'case',
            ['==', ['get', 'proxy_source'], 'rpc_management_context'],
            PALETTE.sage,
            PALETTE.coral,
          ],
          'fill-opacity': 0,
          'fill-outline-color': [
            'case',
            ['==', ['get', 'proxy_source'], 'rpc_management_context'],
            PALETTE.forest,
            PALETTE.coral,
          ],
        },
      });
      m.addLayer({
        id: 'invasive-line',
        type: 'line',
        source: 'invasive',
        paint: {
          'line-color': [
            'case',
            ['==', ['get', 'proxy_source'], 'rpc_management_context'],
            PALETTE.forest,
            PALETTE.coral,
          ],
          'line-width': 1.2,
          'line-opacity': 0,
        },
      });
    }
    } catch (e) {
      warn('invasive', e);
    }

    try {
    if (data.hvi && !m.getSource('hvi')) {
      m.addSource('hvi', { type: 'geojson', data: geoJsonForMap(data.hvi) });
      m.addLayer({
        id: 'hvi-fill',
        type: 'fill',
        source: 'hvi',
        paint: {
          'fill-color': [
            'interpolate', ['linear'], ['to-number', ['get', 'hvi_2018'], 1],
            1, '#fff7e6',
            2, '#fbd592',
            3, '#f59952',
            4, '#d04a3a',
            5, '#7a2618',
          ],
          'fill-opacity': 0,
        },
      }, safeBeforeId(m, 'boundary-fill'));
    }
    } catch (e) {
      warn('hvi', e);
    }

    applyLayerVisibility(m, layersRef.current);
    m.once('idle', () => applyLayerVisibility(m, layersRef.current));
    };

    const runSyncWhenStyleReady = () => {
      m.off('load', runSyncWhenStyleReady);
      syncDataLayers();
    };

    if (m.isStyleLoaded()) {
      syncDataLayers();
    } else {
      m.on('load', runSyncWhenStyleReady);
    }

    let catchUpTimer = 0;
    const catchUpSync = () => {
      if (m.getSource('boundary') || !data?.boundary || !m.isStyleLoaded()) return;
      syncDataLayers();
    };
    catchUpTimer = window.setTimeout(catchUpSync, 0);
    const catchUpTimerLate = window.setTimeout(catchUpSync, 900);

    return () => {
      m.off('load', runSyncWhenStyleReady);
      window.clearTimeout(catchUpTimer);
      window.clearTimeout(catchUpTimerLate);
    };
  }, [data, onTreeClick, imageBase]);

  const layerSig = [...layerKeys(layers)].sort().join(',');
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const apply = () => {
      applyLayerVisibility(m, layers);
      requestAnimationFrame(() => applyLayerVisibility(m, layers));
    };
    const applyWhenReady = () => {
      m.off('load', applyWhenReady);
      apply();
    };
    if (m.isStyleLoaded()) {
      apply();
    } else {
      m.on('load', applyWhenReady);
    }
    return () => {
      m.off('load', applyWhenReady);
    };
  }, [layerSig, layers]);

  useEffect(() => {
    const m = map.current;
    if (!m || !m.isStyleLoaded()) return;
    if (highlightZone === 'goatham' && m.getLayer('context-goatham')) {
      m.setPaintProperty('context-goatham', 'fill-opacity', 0.45);
    }
  }, [highlightZone]);

  const copyMetrics = () => {
    if (!drawMetrics) return;
    const lines = [
      `Area (acres): ${drawMetrics.acres.toFixed(2)}`,
      `Trees (centroids in polygon): ${drawMetrics.treeCount}`,
      drawMetrics.meanHeightM != null ? `Mean height (m): ${drawMetrics.meanHeightM.toFixed(1)}` : 'Mean height (m): -',
      drawMetrics.canopyPct != null
        ? `Canopy cover est. (%): ${drawMetrics.canopyPct.toFixed(1)}`
        : 'Canopy cover est. (%): -',
      drawMetrics.meanSlopeDeg != null
        ? `Mean slope (deg): ${drawMetrics.meanSlopeDeg.toFixed(1)} (tree-attributed)`
        : 'Mean slope (deg): -',
      drawMetrics.meanLstC != null
        ? `Mean LST (°C): ${drawMetrics.meanLstC.toFixed(2)} (tree-attributed)`
        : 'Mean LST (°C): -',
    ];
    void navigator.clipboard.writeText(lines.join('\n'));
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: 480 }}>
      <div
        ref={mapContainer}
        style={{
          width: '100%',
          height: '100%',
          minHeight: 480,
          background: PALETTE.mapWell,
        }}
      />
      {hoverTip ? (
        <div
          style={{
            position: 'absolute',
            left: hoverTip.x + 10,
            top: hoverTip.y + 10,
            pointerEvents: 'none',
            zIndex: 5,
            background: PALETTE.overlay,
            color: PALETTE.ink,
            fontFamily: FONTS.mono,
            fontSize: 10,
            letterSpacing: '0.08em',
            padding: '4px 8px',
            border: `1px solid ${PALETTE.rule}`,
          }}
        >
          {hoverTip.text}
        </div>
      ) : null}
      {drawMetrics ? (
        <div
          style={{
            position: 'absolute',
            bottom: 12,
            left: 12,
            zIndex: 4,
            maxWidth: 320,
            background: PALETTE.elevated,
            border: `1px solid ${PALETTE.rule}`,
            padding: '12px 14px',
            fontFamily: FONTS.body,
            fontSize: 12,
            color: PALETTE.ink,
            boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
          }}
        >
          <div style={{ fontFamily: FONTS.mono, fontSize: 9, letterSpacing: '0.12em', color: PALETTE.subtle, marginBottom: 8 }}>
            DRAWN AREA
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.5 }}>
            <li>{drawMetrics.acres.toFixed(2)} acres</li>
            <li>{drawMetrics.treeCount} trees</li>
            <li>Mean height: {drawMetrics.meanHeightM != null ? `${drawMetrics.meanHeightM.toFixed(1)} m` : '-'}</li>
            <li>Canopy % (est.): {drawMetrics.canopyPct != null ? `${drawMetrics.canopyPct.toFixed(1)}%` : '-'}</li>
            <li>Mean slope: {drawMetrics.meanSlopeDeg != null ? `${drawMetrics.meanSlopeDeg.toFixed(1)}°` : '-'}</li>
            <li>Mean LST: {drawMetrics.meanLstC != null ? `${drawMetrics.meanLstC.toFixed(2)} °C` : '-'}</li>
          </ul>
          <p style={{ fontSize: 10, color: PALETTE.subtle, margin: '10px 0 8px', lineHeight: 1.45 }}>
            NDVI-based health is a remote-sensed proxy. Draw metrics use tree attributes where the pipeline joined them.
          </p>
          <button
            type="button"
            onClick={copyMetrics}
            style={{
              background: PALETTE.moss,
              color: PALETTE.onAccent,
              border: 'none',
              padding: '6px 12px',
              fontFamily: FONTS.mono,
              fontSize: 10,
              letterSpacing: '0.1em',
              cursor: 'pointer',
            }}
          >
            COPY METRICS
          </button>
        </div>
      ) : null}
    </div>
  );
}
