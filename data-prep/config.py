"""
Treelyon × Riverside — data pipeline configuration.

Set SITE_ID to run the pipeline for a given RPC / NAC footprint. Outputs land in
out/<site_id>/ and should be copied to public/data/<site_id>/ for the app.
"""
from pathlib import Path
import os

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "raw"
OUT = ROOT / "out"
BOUNDARY = ROOT / "boundary"

RAW.mkdir(exist_ok=True)
OUT.mkdir(exist_ok=True)

SITES = {
    "west_harlem": {
        "boundary": "west_harlem.geojson",
        "context": "west_harlem_context.geojson",
        "acres": 7.5,
    },
    "morningside": {
        "boundary": "morningside.geojson",
        "context": "morningside_context.geojson",
        "acres": 12.1,
    },
    "highbridge": {
        "boundary": "highbridge.geojson",
        "context": "highbridge_context.geojson",
        "acres": 18.7,
    },
    "inwood_hill": {
        "boundary": "inwood_hill.geojson",
        "context": "inwood_hill_context.geojson",
        "acres": 73.0,
    },
    "van_cortlandt": {
        "boundary": "van_cortlandt.geojson",
        "context": "van_cortlandt_context.geojson",
        "acres": 635,
    },
    "pelham_bay": {
        "boundary": "pelham_bay.geojson",
        "context": "pelham_bay_context.geojson",
        "acres": 778,
    },
}

SITE_ID = os.environ.get("SITE_ID", "west_harlem")
if SITE_ID not in SITES:
    raise SystemExit(f"Unknown SITE_ID={SITE_ID!r}. Valid: {', '.join(SITES)}")

SITE = SITES[SITE_ID]
SITE_OUT = OUT / SITE_ID
SITE_OUT.mkdir(parents=True, exist_ok=True)
(SITE_OUT / "rasters").mkdir(parents=True, exist_ok=True)

PROJECT_BOUNDARY = BOUNDARY / SITE["boundary"]
SITE_CONTEXT = BOUNDARY / SITE["context"]
SITE_ACRES = float(SITE["acres"])

try:
    import geopandas as gpd

    _tb = gpd.read_file(PROJECT_BOUNDARY).to_crs("EPSG:4326").total_bounds
    _pad = max((_tb[2] - _tb[0]) * 0.08, 0.0015)
    SITE_BBOX = (float(_tb[0] - _pad), float(_tb[1] - _pad), float(_tb[2] + _pad), float(_tb[3] + _pad))
except Exception:
    SITE_BBOX = (-73.9560, 40.8240, -73.9445, 40.8330)

# Default matches service-account setup in scripts/run_pipeline_all_sites.sh; override with GEE_PROJECT.
GEE_PROJECT = os.environ.get("GEE_PROJECT", "southern-tempo-387417")

SOURCES = {
    "tnc_2021_zenodo": "https://zenodo.org/records/14053441",
    "tnc_landcover_2021": "https://zenodo.org/records/14053441/files/landcover_nyc_2021_6in.tif",
    "tnc_canopychange": "https://zenodo.org/records/14053441/files/treecanopychange_nyc_2017_2021_6in.tif",
    "tnc_tree_points": "https://zenodo.org/records/14053441/files/Trees_Centroids_Crown_Objects_2021.gdb.zip",
    "nyc_landcover_2017": "https://data.cityofnewyork.us/download/he6d-2qns/application/zip",
    "nyc_landcover_2010": "https://sa-static-customer-assets-us-east-1-fedramp-prod.s3.amazonaws.com/data.cityofnewyork.us/landcover_2010_nyc_05ft.zip",
    "nyc_canopychange_2010_2017": "https://data.cityofnewyork.us/download/by9k-vhck/application/zip",
    "nyc_dem_1ft": "https://sa-static-customer-assets-us-east-1-fedramp-prod.s3.amazonaws.com/data.cityofnewyork.us/NYC_DEM_1ft_Int.zip",
    "nyc_forms": "https://data.cityofnewyork.us/resource/hn5i-inap.geojson",
    "nyc_hvi_rankings": "https://data.cityofnewyork.us/api/views/4mhf-duep/rows.json?accessType=DOWNLOAD",
    "nyc_hvi_zones": "https://data.cityofnewyork.us/api/geospatial/pri4-ifjk?method=export&format=GeoJSON",
    "zhang_tree_height": "https://figshare.com/ndownloader/files/35825478",
}

OUTPUTS = {
    "trees": SITE_OUT / "trees_2021.geojson",
    "boundary_copy": SITE_OUT / "boundary.geojson",
    "context": SITE_OUT / "context.geojson",
    "invasive_zones": SITE_OUT / "invasive_zones.geojson",
    "canopy_change": SITE_OUT / "canopy_change.geojson",
    "hvi": SITE_OUT / "hvi.geojson",
    "canopy_traj": SITE_OUT / "canopy_trajectory.json",
    "scorecard": SITE_OUT / "scorecard.json",
    "lst_zones": SITE_OUT / "lst_zones.json",
    "ndvi_ts": SITE_OUT / "ndvi_timeseries.json",
    "tree_summary": SITE_OUT / "tree_summary.json",
    "ecosystem": SITE_OUT / "ecosystem_services.json",
    "raster_slope": SITE_OUT / "rasters" / "slope.png",
    "raster_lst": SITE_OUT / "rasters" / "lst.png",
    "raster_canopy_change": SITE_OUT / "rasters" / "canopy_change.png",
    "raster_lc2010": SITE_OUT / "rasters" / "lc2010.png",
    "raster_lc2021": SITE_OUT / "rasters" / "lc2021.png",
    "raster_bounds": SITE_OUT / "rasters" / "bounds.json",
}

ITREE_VALUES = {
    "stormwater_gal_per_canopy_acre_yr": 29500,
    "stormwater_dollar_per_kgal": 9.92,
    "carbon_seq_tC_per_canopy_acre_yr": 0.97,
    "carbon_dollar_per_tCO2e": 51.0,
    "air_pollution_lb_per_canopy_acre_yr": 33,
    "air_pollution_dollar_per_lb": 5.36,
    "energy_kwh_per_canopy_acre_yr": 3450,
    "energy_dollar_per_kwh": 0.126,
    "compensatory_dollar_per_tree": 1106,
}

NAC_THRESHOLDS = {
    "canopy_excellent_pct": 75,
    "canopy_good_pct": 55,
    "canopy_fair_pct": 35,
    "invasive_low_pct": 10,
    "invasive_high_pct": 35,
    "stems_target_per_ha": 300,
}
