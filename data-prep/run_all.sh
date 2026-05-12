#!/usr/bin/env bash
# run_all.sh — execute the full data prep pipeline end to end.
set -e
cd "$(dirname "$0")"

export SITE_ID="${SITE_ID:-west_harlem}"

echo "=== TREELYON DATA PIPELINE · SITE_ID=${SITE_ID} ==="
echo

if [ -d "venv" ]; then
    source venv/bin/activate
fi

echo "→ STEP 0/8: Build site boundaries"
python build_site_boundaries.py

if [ "${SKIP_DOWNLOAD:-0}" != "1" ]; then
    echo "→ STEP 1/8: Download open data sources"
    python 01_download_sources.py "$@"
else
    echo "→ STEP 1/8: Skipping downloads (SKIP_DOWNLOAD=1)"
fi

echo "→ STEP 2/8: Clip to project boundary"
python 02_clip_to_site.py

echo "→ STEP 3/8: Compute canopy trajectory"
python 03_tree_canopy_stats.py

echo "→ STEP 4/8: Slope + canopy-change / land-cover PNGs"
python 04_slope_analysis.py

echo "→ STEP 5/8: Landsat thermal composite (Earth Engine)"
python 05_gee_thermal.py

echo "→ STEP 6/8: Sentinel-2 NDVI + invasive proxy (Earth Engine)"
python 06_gee_ndvi.py

echo "→ STEP 7/8: Scorecard + ecosystem services"
python 07_compute_scorecard.py

echo "→ STEP 8/8: Tree health (S2 July max NDVI, Earth Engine)"
python 08_classify_tree_health.py

echo
echo "✓ Pipeline complete. Outputs in ./out/${SITE_ID}/"
echo "  Copy into the Vite public folder:"
echo "      mkdir -p ../public/data/${SITE_ID} && cp -r out/${SITE_ID}/* ../public/data/${SITE_ID}/"
echo
