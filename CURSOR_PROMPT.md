# Cursor Prompt — Extend the Treelyon Riverside Dashboard

> **Before using this prompt**: run `npm install` and `npm run dev` first to
> confirm the scaffold boots. Ideally run `bash data-prep/run_all.sh` once
> so real data is present.
>
> Open Cursor's composer, attach the whole `treelyon-riverside/` directory
> as context, and paste this prompt in **Agent mode** (Claude Opus 4.7 or Sonnet 4.6).

---

## What already exists — DO NOT rebuild

You are extending an existing, working dashboard. The scaffold includes:

- **Real data pipeline** in `data-prep/` (7 Python scripts + `run_all.sh`)
  that pulls from TNC Zenodo, NYC Open Data, Earth Engine (Sentinel-2 +
  Landsat), and writes JSON + GeoJSON + rasters to `data-prep/out/`.
- **React + Mapbox GL frontend** in `src/` with:
  - `App.jsx` — 5-tab shell, data-loading hook, sticky header.
  - `MapView.jsx` — real Mapbox GL JS map with boundary, trees (clickable),
    6 toggleable layers (trees, slope, LST, canopy change, invasives, HVI).
  - `TabSite.jsx` — interactive map + layer controls + live metric strip.
  - `TabCanopy.jsx` — year scrubber, trajectory chart, Sentinel-2 NDVI.
  - `TabScorecard.jsx` — 8-metric NAC FMF table + radar + ecosystem valuation.
  - `TabHeatEquity.jsx` — thermal map + HVI + 4-zone temperature strip.
  - `TabExport.jsx` — PDF, GeoJSON, CSV, shareable URL exports.
- **Real exports** in `src/lib/exporters.js` — jsPDF + html2canvas + papaparse.

All components render from real data files in `public/data/`. The data
pipeline populates those files from the real sources listed in
`data-prep/config.py`.

## Your tasks (in priority order)

### 1. Run and verify the scaffold end-to-end

```bash
npm install
cp .env.example .env.local
# user must paste their VITE_MAPBOX_TOKEN
npm run dev
```

Fix any boot errors you find. Test every tab loads. If `public/data/` is
empty, the app shows a data-missing banner pointing at the pipeline — that
is correct behavior.

Then:

```bash
cd data-prep
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
earthengine authenticate
bash run_all.sh
cp -r out/* ../public/data/
```

Fix any Python errors. The most likely issues:
- TNC GDB layer name differs from the one in `02_clip_to_site.py` (log the
  layers and pick the centroid layer).
- NYC DEM zip has a different internal folder structure (update
  `04_slope_analysis.py:find_dem_for_site` to handle it).
- GEE project name wrong (user must set `GEE_PROJECT` in env).

### 2. Make the tree health classification real

The scaffold reads `health_class` from the TNC tree GeoJSON but that column
doesn't exist in the source. Extend `02_clip_to_site.py` or add an
`08_classify_tree_health.py` that:

1. For each tree centroid, sample Sentinel-2 NDVI in a 3-pixel buffer around
   the tree's crown diameter.
2. Take July maximum NDVI.
3. Classify:
   - NDVI ≥ 0.70 → `healthy`
   - 0.55 ≤ NDVI < 0.70 → `stressed`
   - NDVI < 0.55 → `critical`
4. Write `health_class` and `crown_diameter` into the tree GeoJSON.

Use Earth Engine to sample NDVI per feature with `reduceRegions` rather
than `reduceRegion` in a loop — it's 100x faster.

### 3. Add the canopy-change raster to the map

The pipeline produces `out/rasters/canopychange_clipped.tif`. Convert it to
a colorized PNG (`coral` for loss, `moss` for gain, transparent for no-change)
and add the layer toggle to `MapView.jsx`. Follow the pattern used for the
slope raster.

Implementation sketch (add to `04_slope_analysis.py` or a new script):

```python
with rasterio.open(OUT / "rasters" / "canopychange_clipped.tif") as src:
    arr = src.read(1)
    # Class codes per TNC metadata:
    #   1 = no change, 2 = gain (2017→2021), 3 = loss
    rgba = np.zeros((*arr.shape, 4), dtype=np.uint8)
    loss = arr == 3
    gain = arr == 2
    rgba[loss]  = [201, 74, 59, 220]   # coral
    rgba[gain]  = [61, 107, 61, 220]   # moss
    # Reproject to EPSG:4326 and save PNG
```

Update `src/data/rasters/bounds.json` to include the `canopychange` bounds.
Then the existing `MapView.jsx` layer toggle will work out of the box.

### 4. Add a "Draw area to measure" tool on the site map

Using `@turf/turf` (already in `package.json`) and Mapbox GL Draw
(`npm install @mapbox/mapbox-gl-draw`):

- Add a polygon draw control to `MapView.jsx`.
- On polygon finish, compute: area (acres), tree count inside, mean height,
  canopy % (via point-in-polygon on the tree layer), mean slope (via raster
  sampling), mean LST (raster sampling).
- Display in a floating panel with a "Copy metrics" button.

This turns the dashboard into a diligence tool: Josh can select the
Goatham zone and see its post-clearing metrics separately from the rest.

### 5. Side-by-side 2010 vs 2021 slider on the map

Mapbox GL has a `beforeId` compare plugin, or implement a custom split with
two `MapView` instances. Show the 2010 land cover raster on the left, 2021
on the right, with a draggable divider. Label each side.

This one image does more for the decline narrative than any chart.

### 6. Add the remaining RPC parks (expansion-ready)

Parameterize `data-prep/config.py` to accept a `SITE_ID` env var:

```python
SITES = {
    "west_harlem":    {"boundary": "west_harlem.geojson", "acres": 7.5},
    "morningside":    {"boundary": "morningside.geojson", "acres": 12.1},
    "highbridge":     {"boundary": "highbridge.geojson",  "acres": 18.7},
    "inwood_hill":    {"boundary": "inwood_hill.geojson", "acres": 73.0},
    "van_cortlandt":  {"boundary": "van_cortlandt.geojson", "acres": 635},
    "pelham_bay":     {"boundary": "pelham_bay.geojson",  "acres": 778},
}
SITE_ID = os.environ.get("SITE_ID", "west_harlem")
```

Pipeline writes to `out/<site_id>/...`. Frontend reads from
`/data/<site_id>/...`. Add a site picker dropdown in the header.

This is what positions Treelyon as NAC's reference across the 7,300-acre
Forest Management Framework. Build it before the Josh call if you can.

### 7. Polish pass

- **Hover card on the tree layer**: on mouseenter (not click), show a
  tiny tooltip with height. Click still opens the full popup.
- **Keyboard**: tab navigation through all buttons; `← →` arrow keys to
  scrub the year slider.
- **Print stylesheet**: `@media print` that removes the header, expands
  all tabs, forces page breaks per section. Critical — someone will print
  this.
- **Loading skeleton**: replace the raw "LOADING SITE DATA…" with skeleton
  placeholders that match the eventual layout. Improves perceived speed.
- **Empty-state banner**: show a "Run pipeline" CTA that copies the exact
  command to clipboard.

## Tone guardrails

This dashboard will be shown to **Josh Lehrer**, a Trustee of RPC who
personally funds the Archangel Ancient Tree Archive and planted 25
redwoods in North Salem intending them to become the largest grove of
old-growth redwoods on the East Coast. He treats individual trees as
civilizationally significant.

- **No invented tree species**. If species data isn't in the source,
  leave the field blank or show "Unknown · pending Phase 1 ground truth".
- **No unsourced dollar figures**. Every $ value must flow from
  `ITREE_VALUES` in `config.py` × a computed canopy area.
- **No estimated totals presented as measured**. When a value is a
  proxy (invasive %, tree health from NDVI), surface the method in
  the UI.
- **Do not change the typography, color palette, or tab structure**.
  These are calibrated to the Treelyon brand and the call's emotional
  arc. Extend, don't redesign.

## File map — where to change what

| Task | Files to edit |
|---|---|
| New map layer | `MapView.jsx` (source+layer), `TabSite.jsx` (toggle), `colors.js` (ramp) |
| New pipeline step | `data-prep/NN_*.py` + `run_all.sh` + `config.py:OUTPUTS` |
| New chart | the relevant `Tab*.jsx` component |
| New export type | `src/lib/exporters.js` (logic) + `TabExport.jsx` (button) |
| Site polygon | `data-prep/boundary/project_boundary.geojson` |
| Ecosystem service constants | `data-prep/config.py:ITREE_VALUES` |
| Scorecard metrics | `data-prep/07_compute_scorecard.py` (backend) + frontend just reads `scorecard.json` |

## What to ship as the deliverable

1. `npm run dev` works on a clean checkout with only a Mapbox token and
   GEE project set.
2. `bash data-prep/run_all.sh` completes without errors. Time budget: 30
   min with good internet.
3. All 5 tabs render real data. No placeholder strings remain.
4. Exports work: PDF renders, GeoJSON downloads, CSV downloads, share
   URL copies.
5. `npm run build` produces a clean production bundle deployable to
   Vercel/Netlify/Cloudflare Pages.

## If you get stuck

- Earth Engine auth failing → user must run `earthengine authenticate`
  and enable the Earth Engine API on their GCP project.
- Mapbox raster source showing black → check `bounds.json` has the PNG's
  actual lat/lng bounds (not the source raster's projected bounds).
- Tree layer not clickable → check the GeoJSON actually has features;
  check that the layer `id` matches the one in `map.on('click', ...)`.
- TNC Zenodo download times out → user can download manually from the
  [Zenodo record](https://zenodo.org/records/14053441) and place files
  in `data-prep/raw/`.
