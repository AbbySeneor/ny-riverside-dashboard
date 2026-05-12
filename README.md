# Treelyon × Riverside Park — West Harlem Forest baseline

Investor-grade open-data baseline for the 7.5-acre restoration between W143rd
and W153rd Streets. Built for the Josh Lehrer call.

Numbers, map layers, and charts all read from files under `public/data/<site_id>/`.
Those files are produced by the `data-prep/` pipeline (open sources listed below) and
copied in with `npm run sync:data` — they are not shipped as synthetic demo data in git.

## Quick start

```bash
# 1. Install frontend deps
npm install

# 2. Set your Mapbox token
cp .env.example .env.local
# edit .env.local → VITE_MAPBOX_TOKEN=pk.…

# 3. Run the data pipeline (one-time; can take 15–45+ minutes depending on downloads / GEE)
cd data-prep
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
earthengine authenticate            # required for thermal / NDVI / invasive (GEE)
SITE_ID=west_harlem bash run_all.sh
cd ..

# 4. Copy pipeline outputs into the app (required before the dashboard has real data)
SITE_ID=west_harlem npm run sync:data

# 5. Run the dashboard
npm run dev     # → http://localhost:5173
```

If `public/data/<site_id>/` is missing or incomplete, the UI shows a data-missing banner
and the map tabs stay empty until you run the pipeline and `npm run sync:data` again.

## What each pipeline script does

| Script | Reads | Writes | Requires |
|---|---|---|---|
| `01_download_sources.py` | — | `data-prep/raw/*` | Internet |
| `02_clip_to_site.py` | `raw/*`, `boundary/*` | `out/trees_2021.geojson`, clipped rasters | GDAL |
| `03_tree_canopy_stats.py` | clipped rasters | `out/canopy_trajectory.json` | rasterio |
| `04_slope_analysis.py` | NYC 1-ft DEM | `out/rasters/slope.png` + buckets | rasterio, PIL |
| `05_gee_thermal.py` | Landsat 8/9 C2L2 (GEE) | `out/lst_zones.json`, `out/rasters/lst.png` | earthengine-api |
| `06_gee_ndvi.py` | Sentinel-2 SR (GEE) | `out/ndvi_timeseries.json`, `out/invasive_zones.geojson` | earthengine-api |
| `07_compute_scorecard.py` | all above | `out/scorecard.json`, `out/ecosystem_services.json` | — |

## Data sources (all open)

- **[TNC × UVM SAL 2021 NYC LiDAR](https://zenodo.org/records/14053441)** —
  individual tree centroids, 6-inch land cover, 2017→2021 canopy change.
- **NYC Open Data** — 2010, 2017 land cover rasters; canopy change 2010-2017;
  forestry tree points (ForMS); Heat Vulnerability Index.
- **NYC 1-ft LiDAR-derived DEM** — for slope and root-zone analysis.
- **Sentinel-2 SR Harmonized** (via Earth Engine) — monthly NDVI, invasive
  phenology proxy, 2026 canopy estimate.
- **Landsat 8/9 Collection 2 Level 2** (via Earth Engine) — ST_B10 land
  surface temperature, July+August median 2020–2025.
- **NAC Forest Management Framework** — scorecard thresholds (Rapid Site
  Assessment methodology).
- **i-Tree Eco** — per-canopy-acre ecosystem service unit values, USFS-NRS RB-117.

## What's in each tab

1. **The site** — interactive Mapbox map with 6 toggleable layers (tree
   health, slope, invasives, canopy loss, surface temp, HVI). Click any
   tree for LiDAR-derived attributes. Live metric strip updates from data.
2. **Canopy decline** — real canopy % per LiDAR epoch (2010, 2017, 2021),
   Sentinel-2 NDVI time series overlay, ecosystem service values per year,
   year scrubber, 2027-2029 restoration targets.
3. **Scorecard** — 8-metric NAC FMF Rapid Site Assessment with baseline vs
   Y3 target bars, composite radar, ecosystem services valuation from i-Tree.
4. **Heat equity** — Landsat thermal composite rendered over the map with
   HVI choropleth toggle, 4-zone temperature comparison, Tier 5 callout,
   political-value framing for Hoylman-Sigal / Abreu.
5. **Export & propose** — PDF report, GeoJSON trees, CSV scorecard, CSV
   tree inventory, shareable URL. Phase 0/1/2 proposal and the ask.

## Exports

- **PDF**: Cover page + scorecard table + dashboard screenshot + methodology.
- **GeoJSON (trees)**: WGS84, every feature with attributes. Drop straight
  into QGIS / ArcGIS / Mapbox Studio.
- **CSV (scorecard)**: All 8 metrics flat with baseline, target, source.
- **CSV (tree inventory)**: Every tree with height, crown, health, lat/lng.
- **Shareable URL**: State encoded in the hash. Swap for a signed R2 URL
  in production.

## Production deployment

Simplest path:

```bash
npm run build
# Deploy the /dist folder to Cloudflare Pages, Vercel, or Netlify.
# Copy data-prep/out/<SITE_ID>/ into dist/data/<SITE_ID>/ before deploying (same as npm run sync:data).
```

For multi-site expansion (RPC's Morningside, Highbridge, Inwood, Van Cortlandt,
Pelham Bay, etc.), parameterize `data-prep/config.py` with a `SITE_ID` and re-run
the pipeline per site.

## Known gaps before Phase 1

- **Tree health classification** uses Sentinel-2 NDVI proxy until Q-Module
  ground-truth arrives. Replace in `02_clip_to_site.py` once surveys run.
- **Invasive polygons** are NDVI phenology proxies. Phase 1 field survey
  produces species-specific ground truth.
- **Tree species** not in TNC 2021 product (centroid + height only). NYC
  ForMS has species for street trees; park interior trees need Phase 1.
- **2010 canopy baseline** derived from 2010→2017 change raster + 2017
  absolute. Edge uncertainty ±1.5 pts.

## Files of interest

- `src/components/MapView.jsx` — Mapbox GL JS. Add new layers here.
- `src/lib/exporters.js` — PDF, GeoJSON, CSV logic. Add export types here.
- `data-prep/config.py` — single source of truth for paths, URLs,
  thresholds, i-Tree values.
- `data-prep/boundary/project_boundary.geojson` — refine after on-site
  coordinate capture. Current polygon is digitized from Google Earth.

## Contact

Abby · abby@treelyon.com · +33 7 45 16 44 41
