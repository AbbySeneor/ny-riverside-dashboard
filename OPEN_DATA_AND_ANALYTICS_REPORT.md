# Open data, methodology, and analytics

This document describes **all open and programmatic data sources** used by the Treelyon Riverside dashboard, **how they are processed** in `data-prep/`, and **what conclusions** the combined analytics support. It complements `README.md` with a single reference for partners, funders, and technical reviewers.

Numbers cited under **West Harlem** reflect the site bundle in `public/data/west_harlem/` produced by the pipeline at the time of writing; re-run `SITE_ID=west_harlem bash data-prep/run_all.sh` and `npm run sync:data` to refresh.

---

## 1. Open data and reference frameworks

### 1.1 LiDAR and high-resolution land products (Zenodo)

| Dataset | Provider | Use in dashboard |
|--------|----------|------------------|
| [TNC × UVM SAL 2021 NYC](https://zenodo.org/records/14053441) | The Nature Conservancy / University of Vermont | Tree centroids (layer `treecentroids_2021_nyc` in the GDB zip), crown radius and height; 6-inch **2021 land cover**; **2017→2021 canopy change** raster |

**Pipeline files:** `Trees_Centroids_Crown_Objects_2021.gdb.zip`, `landcover_nyc_2021_6in.tif`, `treecanopychange_nyc_2017_2021_6in.tif` (see `data-prep/config.py` → `SOURCES`).

### 1.2 New York City open data

| Dataset | NYC Open Data / endpoint | Use |
|---------|--------------------------|-----|
| Land cover 2017 | `he6d-2qns` (zip download) | Historical land-cover grid when available; combined with TNC change for derived epochs |
| Land cover 2010 | City-hosted static zip | 2010 baseline when download succeeds |
| Canopy change 2010–2017 | `by9k-vhck` | Derives 2010 canopy where needed |
| NYC ForMS trees | `hn5i-inap` | Adjacent street-tree inventory (clipped to site bbox), not park-interior LiDAR |
| HVI rankings | `4mhf-duep` | Heat vulnerability context |
| HVI / MODZCTA zones | `pri4-ifjk` (GeoJSON) | Choropleth and tract-level context |
| NYC 1-ft DEM | NYS GIS Clearinghouse mirror in config | Slope when tile covers site centroid |

**Park boundaries (all sites except West Harlem’s special case):** [NYC Parks Properties](https://data.cityofnewyork.us/City-Government/Parks-Properties/enfh-gkve) (`enfh-gkve`) — GeoJSON export used in `build_site_boundaries.py`.

### 1.3 Google Earth Engine collections

| Collection | Use |
|------------|-----|
| `USGS/3DEP/10m` | Digital elevation when NYC 1-ft DEM is missing or does not cover the site; slope in degrees |
| `LANDSAT/LC08/C02/T1_L2`, `LANDSAT/LC09/C02/T1_L2` | **ST_B10** surface temperature; July–August median from **2020** through the **latest calendar year** (at least 2026); °F conversion per collection metadata |
| `COPERNICUS/S2_SR_HARMONIZED` (Sentinel-2) | Monthly NDVI time series (**2017** through latest year); July max NDVI for **baseline canopy proxy** (most recent complete July) and **tree health**; **invasive phenology** mask (August vs May in `06_gee_ndvi.py`) |

Earth Engine requires a GCP-linked project (`GEE_PROJECT` in `config.py`, overridable via environment) and authentication (user OAuth or service account JSON).

### 1.4 Frameworks and unit values (not “raw” downloads)

| Reference | Role |
|-----------|------|
| **NAC Forest Management Framework** | Scorecard structure and qualitative targets (Rapid Site Assessment–compatible rows in `07_compute_scorecard.py`) |
| **i-Tree Eco** (USFS-NRS RB-117–style unit rates) | `ITREE_VALUES` in `config.py`: stormwater, carbon, air quality, energy **per canopy acre per year**; compensatory value per tree (CTLA-style constant in product) |

These are **methodological multipliers** applied to modeled canopy area and tree count, not field-measured cash flows.

### 1.5 Project-specific geometry (not third-party open data)

| File | Role |
|------|------|
| `data-prep/boundary/*.geojson` | Per-site clip polygon (NYC Parks property union or Riverside **M072** for West Harlem) |
| `data-prep/boundary/project_boundary.geojson` | West Harlem restoration sketch (grant narrative, intersection with park for focus metrics) |
| `data-prep/boundary/*_context.geojson` | RPC / management overlays (e.g. Goatham clearing footprint) for invasive fallback |

---

## 2. Methodology (pipeline overview)

End-to-end order is `data-prep/run_all.sh` (steps 0–8). Outputs land in `data-prep/out/<SITE_ID>/` and are copied to `public/data/<SITE_ID>/` via `npm run sync:data`.

### Step 0 — `build_site_boundaries.py`

Builds or refreshes `boundary/<site>.geojson` from NYC Parks Properties (and Riverside **M072** for West Harlem). Computes area in projected CRS for metadata.

### Step 1 — `01_download_sources.py`

Downloads Zenodo archives, NYC zips, and ForMS GeoJSON into `data-prep/raw/`.

### Step 2 — `02_clip_to_site.py`

- Clips **tree centroids** to the site polygon (`intersects`).
- Clips **rasters** (canopy change, land cover, etc.) with `rasterio.mask`.
- Writes `trees_2021.geojson`, `boundary.geojson`, `context.geojson`, clipped GeoTIFFs, and merges **`rasters/bounds.json`** so later steps’ PNG metadata are not wiped on partial reruns.

### Step 3 — `03_tree_canopy_stats.py`

- Counts **tree canopy class** pixels inside the boundary for each available land-cover epoch (NYC / TNC class `1` = tree canopy where applicable).
- Derives **2017** from TNC 2021 + 2017→2021 change when needed; **2010** from NYC 2010→2017 change + 2017 baseline when needed.
- Adds **Sentinel-2 baseline canopy** from `_s2_canopy_2026.json` (written in step 6; year inside JSON, usually the most recent complete July).
- Applies **i-Tree** per-acre factors using `SITE_ACRES` from config for ecosystem rows (see §4 for acreage caveat).

### Step 4 — `04_slope_analysis.py`

- Prefers **NYC 1-ft DEM** tile covering site centroid; else **USGS 3DEP 10 m** via Earth Engine download.
- Computes **slope in degrees** (gradient on elevation), buckets into scorecard buckets, writes `rasters/slope.png` and `_slope_buckets.json`.
- Renders **canopy change** and land-cover previews to **PNG** for Mapbox and updates `bounds.json` keys (`slope`, `canopychange_2017_2021`, `lc2010`, `lc2021`).

### Step 5 — `05_gee_thermal.py`

- Builds Landsat **median composite** (July–August, **2020 through latest year**), converts **ST_B10** to °F.
- Samples mean LST in four **reference rectangles** (Hudson, canopy interior = site polygon, Henry Hudson Parkway edge, Riverside Drive edge) — simplified geometry for storytelling, not census blocks.
- Writes `lst_zones.json` and `rasters/lst.png` + `bounds.json` → `lst`.

### Step 6 — `06_gee_ndvi.py`

- Monthly **NDVI** time series for the site.
- **Invasive proxy:** phenology / NDVI rules on Sentinel-2; if the mask is empty, emits **RPC management context** polygons from `*_context.geojson` (e.g. Goatham zone) with `proxy_source: rpc_management_context`.
- Writes `ndvi_timeseries.json`, `invasive_zones.geojson`, and `_s2_canopy_2026.json` for step 3.

`run_all.sh` then **re-runs step 3** so `canopy_trajectory.json` includes the Sentinel-2 baseline epoch.

### Step 7 — `07_compute_scorecard.py`

Assembles **scorecard.json** (baselines, targets, sources), **tree_summary.json** (counts, heights, stems/ha), **ecosystem_services.json** (i-Tree-style totals).

### Step 8 — `08_classify_tree_health.py`

Joins **July max NDVI** from Sentinel-2 to each tree point; assigns health classes used in the map and exports.

---

## 3. Important limitations (read before quoting numbers)

1. **Grant acres vs map acres:** `SITE_ACRES` in `config.py` is often the **grant footprint** (e.g. 7.5 ac for West Harlem) while the **map boundary** may follow the full NYC Parks polygon (~138 ac for Riverside M072). Scorecard labels and some ecosystem scaling use grant acres; map layers and LiDAR counts use the **clip polygon**. Always state which geometry a metric uses.

2. **Tree points** are **TNC LiDAR crown centroids**, not NYC street trees and not a field stem tally.

3. **Tree health** and **invasive** layers are **remote-sensing proxies**, not field inventory.

4. **HVI** sourcing has evolved; clipped tracts are for **context**, not a replacement for DOHMH’s official narrative products.

5. **LST reference boxes** are coarse rectangles for **relative cooling** comparisons, not microclimate validation.

6. **i-Tree dollar totals** are **model outputs** from literature unit values × modeled canopy area — useful for order-of-magnitude communication, not compliance-grade valuation.

---

## 4. Interesting conclusions and analytics (West Harlem example)

The following illustrate **patterns you can defend from the pipeline outputs**; refresh numbers after each full run.

### 4.1 Canopy trajectory and loss signal

From `canopy_trajectory.json` (land-cover epochs on the clipped grid):

- **2017 → 2021** tree-canopy **share of valid pixels** moved from roughly **82% → 72%** — a large drop at the resolution of the TNC/NYC land-cover stack for this AOI.
- The **canopy loss** map layer encodes TNC **2017→2021 change** classes (loss vs gain) for visual communication.

**Interpretation:** Strong evidence of **material canopy change** in the satellite/LiDAR land-cover sense; exact % depends on classification noise and boundary alignment.

### 4.2 Summer “greenness” vs land-cover canopy

The **Sentinel-2 baseline** epoch (year from `_s2_canopy_2026.json`, e.g. **2025** when run before August) uses **July max NDVI > 0.55** and can read **higher** than the 2021 land-cover canopy percentage.

**Interpretation:** NDVI responds to **all green biomass and sun angle**, not identical to “tree canopy” class in a land-cover product. Tension between metrics is expected and scientifically interesting.

### 4.3 LiDAR structure: tall trees, moderate stem density

From `tree_summary.json` / `scorecard.json` (representative snapshot):

- On the order of **~240** LiDAR-detected trees, **mean height ~20 m**, **max height ~35–38 m**.
- **Stems per hectare** (~79 in the same snapshot) sits **below** the NAC-style target band (**300 stems/ha**) used on the scorecard.

**Interpretation:** The site shows **mature height** with **relatively open stem spacing** in the LiDAR product sense—useful for arguing **structural planting** vs **canopy retention** tradeoffs.

### 4.4 Urban heat island and cooling narrative

From `lst_zones.json` (Landsat thermal composite):

- **Canopy interior** mean LST is several **°F lower** than **Riverside Drive** and **Henry Hudson Parkway** reference rectangles (dashboard reports on the order of **~4 °F** vs Riverside Drive in the bundled snapshot).

**Interpretation:** Consistent with **park cool island** literature at Landsat resolution; not a substitute for pedestrian-height weather stations.

### 4.5 Topography

From `_slope_buckets.json` (10 m DEM when 1-ft is absent):

- **Mean slope** on the order of **12°**, with a double-digit **share of pixels steeper than 20°**, and **max slope** approaching **35°** in the same run.

**Interpretation:** Physically **non-flat** park terrain—relevant to **erosion**, **access**, and **steep-slope** restoration tactics.

### 4.6 Invasive proxy vs management context

When the Sentinel-2 phenology mask is **empty**, the app surfaces **Goatham / RPC clearing** polygons as **management context**, not as “species detected.”

**Interpretation:** Honest UX: **remote sensing did not fire**, but **known disturbance** is still shown for planning conversations.

### 4.7 Ecosystem services (illustrative)

From `ecosystem_services.json` (i-Tree-style coefficients × modeled canopy acres):

- Combined **annual USD** on the order of **single-digit thousands** and **compensatory** tree value on the order of **hundreds of thousands USD** in the bundled snapshot—both **model-only**.

**Interpretation:** Good for **stakeholder decks**; pair with Phase 1 field data for defensible accounting.

---

## 5. Data currency (2025 / 2026)

**Earth Engine layers** pick up new imagery automatically when you re-run the pipeline:

- **Landsat LST** (`05_gee_thermal.py`): July–August median from **2020-01-01** through **December 31 of `max(2026, current calendar year)`**, so 2026 (and beyond) scenes are included as they become available.
- **Sentinel-2 NDVI** (`06_gee_ndvi.py`): monthly series from **2017** through the same rolling end year; **baseline canopy** uses the most recent **complete July** (before August 1, the prior year is used).
- **Tree health** (`08_classify_tree_health.py`): July-only max NDVI composite from **2019** through **December 31 of `max(2026, current calendar year)`**.

**Zenodo TNC 2021** products (trees, 2021 land cover, 2017→2021 change) do not update until a newer public release exists; the dashboard still labels those as 2021 LiDAR.

**i-Tree `monetary_year`** in `07_compute_scorecard.py` is set to the **current calendar year** when the scorecard is built (reporting label, not a change to unit rates).

---

## 6. Reproducibility

```bash
cd data-prep
python -m venv .venv && source .venv/bin/activate   # or venv per README
pip install -r requirements.txt
earthengine authenticate   # or service account env vars
SITE_ID=west_harlem bash run_all.sh
cd ..
SITE_ID=west_harlem npm run sync:data
npm run dev
```

Document version: generated as part of the repository; update this file when adding new datasets or changing scorecard logic.
