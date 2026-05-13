"""
05_gee_thermal.py — Landsat 8/9 LST composite via Earth Engine.

Computes:
  • July–August median LST 2020 through latest full year (≥2026) in °F, clipped to site bbox
  • Mean LST in 4 zones: Hudson, canopy interior, Riverside Drive, Henry Hudson Pkwy
  • LST raster exported as colorized PNG for Mapbox

Setup:
  1. pip install earthengine-api
  2. earthengine authenticate
  3. set env var GEE_PROJECT (or edit config.py)

Run:
    python 05_gee_thermal.py
"""
import json
import io
import urllib.request
from datetime import datetime
from pathlib import Path
import ee
from PIL import Image
import numpy as np
from config import SITE_OUT, OUTPUTS, GEE_PROJECT, SITE_BBOX, PROJECT_BOUNDARY
import geopandas as gpd
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
        # Service account path (recommended)
        sa_email = os.environ.get("GEE_SERVICE_ACCOUNT_EMAIL")
        sa_key_file = os.environ.get("GEE_PRIVATE_KEY_FILE")
        if sa_email and sa_key_file and os.path.exists(sa_key_file):
            with open(sa_key_file, "r", encoding="utf-8") as f:
                info = _json.load(f)
            # Allow either env email or the JSON's client_email
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


def fahrenheit(img):
    """Convert Landsat C2L2 ST_B10 → °F."""
    lst_k = img.select("ST_B10").multiply(0.00341802).add(149.0)
    lst_f = lst_k.subtract(273.15).multiply(9 / 5).add(32)
    return lst_f.rename("LST_F").copyProperties(img, ["system:time_start"])


def main():
    init_ee()
    print(f"\n→ Earth Engine project: {GEE_PROJECT}")

    # AOI = site bbox + buffer for context
    west, south, east, north = SITE_BBOX
    aoi = ee.Geometry.Rectangle([west - 0.005, south - 0.003,
                                  east + 0.005, north + 0.003])

    lst_end_year = max(2026, datetime.now().year)
    lst_start = "2020-01-01"
    lst_end = f"{lst_end_year}-12-31"
    print(f"→ Landsat LST composite: {lst_start} … {lst_end} (July–August median)")

    # Landsat 8 + 9 Collection 2 Level 2, July+August median
    L8 = ee.ImageCollection("LANDSAT/LC08/C02/T1_L2")
    L9 = ee.ImageCollection("LANDSAT/LC09/C02/T1_L2")

    composite = (L8.merge(L9)
        .filterBounds(aoi)
        .filter(ee.Filter.calendarRange(7, 8, "month"))
        .filterDate(lst_start, lst_end)
        .map(fahrenheit)
        .median()
        .clip(aoi))

    # === Download tile as PNG via getThumbURL ===
    print(f"→ Generating colorized thumbnail...")
    vis = {
        "min": 70, "max": 100,
        "palette": ["1c4a73", "2d6e8f", "5a8fa8", "8bb08b", "c48c2e", "c94a3b", "8a2c20"],
    }
    url = composite.getThumbURL({
        "region": aoi,
        "dimensions": 1024,
        **vis,
        "format": "png",
    })
    print(f"   URL: {url[:80]}...")
    raw_png = SITE_OUT / "rasters" / "lst_raw.png"
    urllib.request.urlretrieve(url, raw_png)

    # Re-save as RGBA (the GEE thumbnail is RGB; we want some transparency for low values)
    img = Image.open(raw_png).convert("RGBA")
    arr = np.array(img)
    # Pixels that are pure black are nodata → make transparent
    nodata_mask = (arr[..., :3].sum(axis=-1) < 8)
    arr[nodata_mask, 3] = 0
    arr[~nodata_mask, 3] = 200  # 200/255 opacity
    Image.fromarray(arr).save(OUTPUTS["raster_lst"])
    raw_png.unlink()

    # === Sample LST in 4 reference zones ===
    print(f"\n→ Sampling LST in reference zones...")
    boundary = gpd.read_file(PROJECT_BOUNDARY)
    site_geom = ee.Geometry(boundary.geometry.iloc[0].__geo_interface__)

    # Approximate reference geometries
    hudson    = ee.Geometry.Rectangle([west - 0.004, south, west - 0.001, north])
    parkway   = ee.Geometry.Rectangle([west, south - 0.0008, east, south])
    riv_drive = ee.Geometry.Rectangle([east + 0.0005, south, east + 0.0015, north])

    zones = {
        "hudson":          hudson,
        "canopy_interior": site_geom,
        "henry_hudson_pkwy": parkway,
        "riverside_drive": riv_drive,
    }

    results = {}
    for name, geom in zones.items():
        mean = composite.reduceRegion(
            reducer=ee.Reducer.mean(),
            geometry=geom,
            scale=30,
            maxPixels=1e9,
        ).get("LST_F").getInfo()
        results[name] = round(mean, 1) if mean is not None else None
        print(f"   {name:25s}: {mean:.1f} °F" if mean else f"   {name}: nodata")

    # Cooling differential — canopy vs Riverside Drive
    if results.get("canopy_interior") and results.get("riverside_drive"):
        results["cooling_vs_street_F"] = round(
            results["riverside_drive"] - results["canopy_interior"], 1
        )
    if results.get("canopy_interior") and results.get("henry_hudson_pkwy"):
        results["cooling_vs_pkwy_F"] = round(
            results["henry_hudson_pkwy"] - results["canopy_interior"], 1
        )

    results["composite"] = (
        f"Landsat 8/9 C2L2, ST_B10, July+August median {lst_start[:4]}–{lst_end_year}"
    )
    results["computed_at_utc"] = datetime.utcnow().isoformat() + "Z"

    OUTPUTS["lst_zones"].write_text(json.dumps(results, indent=2))
    print(f"\n✓ LST zones → {OUTPUTS['lst_zones'].relative_to(SITE_OUT.parent)}")
    print(f"✓ LST raster → {OUTPUTS['raster_lst'].relative_to(SITE_OUT.parent)}")

    # Update bounds metadata
    bounds_path = OUTPUTS["raster_bounds"]
    bounds_meta = json.loads(bounds_path.read_text()) if bounds_path.exists() else {}
    bounds_meta["lst"] = {
        "path": "rasters/lst.png",
        "bounds_4326": [west - 0.005, south - 0.003, east + 0.005, north + 0.003],
    }
    bounds_path.write_text(json.dumps(bounds_meta, indent=2))

    print(f"\n→ Next: python 06_gee_ndvi.py")


if __name__ == "__main__":
    main()
