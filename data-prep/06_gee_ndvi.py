"""
06_gee_ndvi.py — Sentinel-2 NDVI time series and current-year baseline canopy.

Outputs:
  • out/ndvi_timeseries.json   — monthly mean NDVI for the site, 2017 through latest year
  • out/_s2_canopy_2026.json   — current-year canopy % estimate (filename legacy; year inside JSON)
                                  (read by 03_tree_canopy_stats.py)

Setup:
  Same as 05_gee_thermal.py
"""
import json
from datetime import datetime
from pathlib import Path
import ee
import geopandas as gpd
from config import SITE_OUT, OUTPUTS, GEE_PROJECT, PROJECT_BOUNDARY, SITE_CONTEXT, SITE_ID, SITE_ACRES
import os
import json as _json


def init_ee():
    """
    Authenticate to Earth Engine.

    Preferred for automation: service account JSON key file.
      - set GEE_SERVICE_ACCOUNT_EMAIL (client_email)
      - set GEE_PRIVATE_KEY_FILE (path to a service account JSON key)

    Fallback: interactive auth (earthengine authenticate).
    """
    try:
        sa_email = os.environ.get("GEE_SERVICE_ACCOUNT_EMAIL")
        sa_key_file = os.environ.get("GEE_PRIVATE_KEY_FILE")
        if sa_email and sa_key_file and os.path.exists(sa_key_file):
            with open(sa_key_file, "r", encoding="utf-8") as f:
                info = _json.load(f)
            email = sa_email or info.get("client_email")
            key = info.get("private_key")
            if not email or not key:
                raise RuntimeError("Service account JSON missing client_email/private_key")
            creds = ee.ServiceAccountCredentials(email, key_data=key)
            ee.Initialize(creds, project=GEE_PROJECT)
            return

        ee.Initialize(project=GEE_PROJECT)
    except Exception:
        ee.Authenticate()
        ee.Initialize(project=GEE_PROJECT)


def context_management_invasive_fallback() -> dict:
    """When the S2 phenology mask is empty, surface RPC Goatham clearing context."""
    if not SITE_CONTEXT.exists():
        return {"type": "FeatureCollection", "features": []}
    raw = json.loads(SITE_CONTEXT.read_text(encoding="utf-8"))
    features = []
    for feat in raw.get("features", []):
        props = feat.get("properties") or {}
        if props.get("kind") != "goatham":
            continue
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "name": props.get("name", "Management context"),
                    "kind": props.get("kind"),
                    "proxy_source": "rpc_management_context",
                    "method": (
                        "RPC Goatham clearing footprint; "
                        "Sentinel-2 invasive phenology proxy found no matching patches."
                    ),
                },
                "geometry": feat["geometry"],
            }
        )
    return {"type": "FeatureCollection", "features": features}


def monthly_ndvi_composite(collection, start, end):
    month = collection.filterDate(start, end)
    if month.size().getInfo() == 0:
        return None
    composite = month.select(["B4", "B8"]).median().divide(10000)
    if not composite.bandNames().getInfo():
        return None
    return composite.normalizedDifference(["B8", "B4"])


def main():
    init_ee()
    print(f"\n→ Earth Engine project: {GEE_PROJECT}")

    boundary = gpd.read_file(PROJECT_BOUNDARY)
    aoi = ee.Geometry(boundary.geometry.iloc[0].__geo_interface__)

    ndvi_end_year = max(2026, datetime.utcnow().year)
    ndvi_end = f"{ndvi_end_year}-12-31"

    # === Monthly mean NDVI 2017 through latest year ===
    print(f"→ Computing monthly NDVI 2017–{ndvi_end_year}...")
    s2 = (ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
          .filterBounds(aoi)
          .filterDate("2017-01-01", ndvi_end)
          .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 40)))

    months = []
    for year in range(2017, ndvi_end_year + 1):
        for month in range(1, 13):
            if year == 2026 and month > datetime.utcnow().month:
                break
            try:
                start = ee.Date.fromYMD(year, month, 1)
                end = start.advance(1, "month")
                ndvi = monthly_ndvi_composite(s2, start, end)
                if ndvi is None:
                    print(f"   {year}-{month:02d}: skipped (no clear imagery)")
                    continue
                stat = ndvi.reduceRegion(
                    reducer=ee.Reducer.mean(),
                    geometry=aoi,
                    scale=10,
                    maxPixels=1e9,
                ).get("nd").getInfo()
                if stat is not None:
                    months.append({
                        "year": year, "month": month,
                        "ndvi": round(float(stat), 3),
                    })
                    if month == 7:
                        print(f"   {year}-{month:02d}: NDVI = {stat:.3f}")
            except Exception as e:
                print(f"   {year}-{month:02d}: skipped ({e})")

    OUTPUTS["ndvi_ts"].write_text(json.dumps({
        "site": f"{SITE_ID} · {SITE_ACRES} ac",
        "source": "Sentinel-2 SR Harmonized (COPERNICUS/S2_SR_HARMONIZED)",
        "computed_at_utc": datetime.utcnow().isoformat() + "Z",
        "monthly": months,
    }, indent=2))
    print(f"✓ NDVI time series → {OUTPUTS['ndvi_ts'].relative_to(SITE_OUT.parent)}")

    # === Baseline canopy % from most recent complete July NDVI ===
    peak_year = datetime.utcnow().year
    if datetime.utcnow().month < 8:
        peak_year -= 1
    print(f"\n→ Estimating baseline canopy from July NDVI (peak year {peak_year})...")
    ndvi_peak = monthly_ndvi_composite(
        s2,
        ee.Date.fromYMD(peak_year, 7, 1),
        ee.Date.fromYMD(peak_year, 8, 1),
    )
    pixel_area = ee.Image.pixelArea()
    total_area = aoi.area().getInfo()
    canopy_area = None
    canopy_pct = 0.0
    if ndvi_peak is not None:
        canopy_mask = ndvi_peak.gt(0.55)
        canopy_area = canopy_mask.multiply(pixel_area).reduceRegion(
            reducer=ee.Reducer.sum(),
            geometry=aoi,
            scale=10,
            maxPixels=1e9,
        ).get("nd").getInfo()
        canopy_pct = round(canopy_area / total_area * 100, 2) if canopy_area else 0
    print(f"   Baseline canopy estimate ({peak_year}): {canopy_pct}% ({(canopy_area or 0):.0f} m² / {total_area:.0f} m²)")

    (SITE_OUT / "_s2_canopy_2026.json").write_text(json.dumps({
        "year": peak_year,
        "canopy_pct_estimated": canopy_pct,
        "canopy_m2": round(canopy_area or 0, 1),
        "total_m2": round(total_area, 1),
        "ndvi_threshold": 0.55,
        "source": f"Sentinel-2 NDVI > 0.55, July {peak_year}",
    }, indent=2))

    # === Invasive proxy: high uniform NDVI zones ===
    # Porcelain berry, English ivy form dense uniform mats.
    # Heuristic: NDVI >0.78 AND late green-up (NDVI in May < 0.55)
    print(f"\n→ Detecting invasive zones via NDVI uniformity proxy...")
    inv_pct = 0.0
    inv_area = None
    inv_method = "S2 NDVI Aug>0.70 AND May<0.50 (porcelain-berry/English ivy phenology)"
    inv_features: list[dict] = []
    try:
        may_ndvi = monthly_ndvi_composite(
            s2,
            ee.Date.fromYMD(peak_year, 5, 1),
            ee.Date.fromYMD(peak_year, 6, 1),
        )
        aug_ndvi = monthly_ndvi_composite(
            s2,
            ee.Date.fromYMD(peak_year, 8, 1),
            ee.Date.fromYMD(peak_year, 9, 1),
        )
        if may_ndvi is not None and aug_ndvi is not None:
            for aug_min, may_max, label in (
                (0.70, 0.50, inv_method),
                (0.65, 0.55, "S2 NDVI Aug>0.65 AND May<0.55 (relaxed phenology)"),
            ):
                invasive_proxy = aug_ndvi.gt(aug_min).And(may_ndvi.lt(may_max))
                inv_area = invasive_proxy.multiply(pixel_area).reduceRegion(
                    reducer=ee.Reducer.sum(), geometry=aoi, scale=10, maxPixels=1e9
                ).get("nd").getInfo()
                inv_pct = round(inv_area / total_area * 100, 1) if inv_area else 0
                print(f"   Invasive-suspected area: {inv_pct}% ({label})")

                print(f"   Vectorizing invasive zones...")
                vectors = invasive_proxy.selfMask().reduceToVectors(
                    geometry=aoi, scale=10, maxPixels=1e9,
                    eightConnected=True, geometryType="polygon",
                )
                fc = vectors.getInfo()
                inv_features = fc.get("features", [])
                if inv_features:
                    inv_method = label
                    break
        else:
            raise RuntimeError("no clear imagery for invasive proxy")
    except Exception as e:
        print(f"   Invasive proxy skipped ({e})")

    if not inv_features:
        fc = context_management_invasive_fallback()
        inv_features = fc.get("features", [])
        if inv_features:
            inv_method = "RPC Goatham clearing footprint (S2 phenology proxy empty)"
            print(f"   ✓ {len(inv_features)} management-context polygon(s) from site context")
    else:
        fc = {"type": "FeatureCollection", "features": inv_features}

    OUTPUTS["invasive_zones"].write_text(json.dumps(fc, indent=2))
    print(f"   ✓ {len(inv_features)} invasive polygons "
          f"→ {OUTPUTS['invasive_zones'].relative_to(SITE_OUT.parent)}")

    (SITE_OUT / "_invasive_proxy.json").write_text(json.dumps({
        "method": inv_method,
        "invasive_pct_proxy": inv_pct,
        "polygon_count": len(inv_features),
        "_caveat": "Replace with Phase-1 ground-truth invasive polygons.",
    }, indent=2))

    print(f"\n→ Next: python 07_compute_scorecard.py")


if __name__ == "__main__":
    main()
