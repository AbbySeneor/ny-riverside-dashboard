import { useEffect, useState, useCallback } from 'react';

/**
 * Load pipeline outputs served from /data/<siteId>/ (see scripts/sync_public_data.py).
 */
export function useSiteData(siteId) {
  const dataBase = `/data/${siteId}`;

  const [data, setData] = useState({
    siteId,
    dataBase,
    boundary: null,
    context: null,
    trees: null,
    invasive: null,
    hvi: null,
    canopyTrajectory: null,
    scorecard: null,
    lstZones: null,
    ndviTimeseries: null,
    ecosystemServices: null,
    treeSummary: null,
    rasterBounds: null,
    loaded: false,
    errors: [],
  });

  useEffect(() => {
    const base = `/data/${siteId}`;
    setData((d) => ({
      ...d,
      siteId,
      dataBase: base,
      loaded: false,
      errors: [],
    }));

    const loaders = [
      ['boundary',          `${base}/boundary.geojson`],
      ['context',           `${base}/context.geojson`],
      ['trees',             `${base}/trees_2021.geojson`],
      ['invasive',          `${base}/invasive_zones.geojson`],
      ['hvi',               `${base}/hvi.geojson`],
      ['canopyTrajectory',  `${base}/canopy_trajectory.json`],
      ['scorecard',         `${base}/scorecard.json`],
      ['lstZones',          `${base}/lst_zones.json`],
      ['ndviTimeseries',    `${base}/ndvi_timeseries.json`],
      ['ecosystemServices', `${base}/ecosystem_services.json`],
      ['treeSummary',       `${base}/tree_summary.json`],
      ['rasterBounds',      `${base}/rasters/bounds.json`],
    ];

    let cancelled = false;

    Promise.all(loaders.map(async ([key, url]) => {
      try {
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok) throw new Error(`${url}: ${r.status}`);
        return [key, await r.json(), null];
      } catch (e) {
        return [key, null, e.message];
      }
    })).then((results) => {
      if (cancelled) return;
      const next = {
        siteId,
        dataBase: base,
        loaded: true,
        errors: [],
      };
      results.forEach(([key, value, err]) => {
        next[key] = value;
        if (err) next.errors.push({ key, err });
      });
      setData((d) => ({ ...d, ...next }));
    });

    return () => { cancelled = true; };
  }, [siteId]);

  const copyPipelineCommand = useCallback(() => {
    const cmd =
      `cd data-prep && python -m venv venv && source venv/bin/activate && ` +
      `pip install -r requirements.txt && earthengine authenticate && ` +
      `SITE_ID=${siteId} bash run_all.sh && cd .. && SITE_ID=${siteId} npm run sync:data`;
    void navigator.clipboard.writeText(cmd);
  }, [siteId]);

  return { ...data, copyPipelineCommand };
}
