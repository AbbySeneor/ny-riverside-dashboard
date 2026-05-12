"""
04_slope_analysis.py — derive slope from NYC 1-ft DEM, identify steep zones.

Steep zones (>20°) are exactly where:
  • Goats are deployed (RPC Goatham program)
  • Erosion risk is highest
  • Native plantings will need physical slope stabilization
  • Q-Module deployment requires special access

Outputs:
  out/rasters/slope.png            — colorized slope ramp for Mapbox
  out/rasters/bounds.json (merged) — bounds for the PNG layer
  out/scorecard_slope.json         — % of site by slope bucket
"""
import json
import os
import urllib.request
import zipfile
from pathlib import Path
import numpy as np
import rasterio
import rasterio.mask
import rasterio.warp
from rasterio.enums import Resampling
import ee
import geopandas as gpd
from PIL import Image
from config import GEE_PROJECT, RAW, SITE_OUT, OUTPUTS, PROJECT_BOUNDARY, SITE_BBOX


def init_ee() -> None:
    sa_email = os.environ.get("GEE_SERVICE_ACCOUNT_EMAIL")
    sa_key_file = os.environ.get("GEE_PRIVATE_KEY_FILE")
    if sa_email and sa_key_file and os.path.exists(sa_key_file):
        with open(sa_key_file, "r", encoding="utf-8") as f:
            info = json.load(f)
        email = sa_email or info.get("client_email")
        key = info.get("private_key")
        if not email or not key:
            raise RuntimeError("Service account JSON missing client_email/private_key")
        creds = ee.ServiceAccountCredentials(email, key_data=key)
        ee.Initialize(creds, project=GEE_PROJECT)
        return
    ee.Initialize(project=GEE_PROJECT)


def find_nyc_dem_tile():
    """The NYC DEM ships as many tiled GeoTIFFs in a zip. Find the tile that
    covers our site."""
    dem_zip = RAW / "nyc_dem_1ft.zip"
    if not dem_zip.exists():
        return None
    extract_dir = RAW / "nyc_dem_extracted"
    if not extract_dir.exists():
        print(f"→ Extracting NYC DEM zip (this is large)...")
        extract_dir.mkdir(exist_ok=True)
        with zipfile.ZipFile(dem_zip) as zf:
            zf.extractall(extract_dir)

    # Find tile containing our site
    boundary = gpd.read_file(PROJECT_BOUNDARY).geometry.iloc[0]
    centroid = boundary.centroid
    for tif in extract_dir.rglob("*.tif"):
        try:
            with rasterio.open(tif) as src:
                bounds_4326 = rasterio.warp.transform_bounds(src.crs, "EPSG:4326", *src.bounds)
                if (bounds_4326[0] <= centroid.x <= bounds_4326[2]
                        and bounds_4326[1] <= centroid.y <= bounds_4326[3]):
                    print(f"   ✓ DEM tile: {tif.name}")
                    return tif
        except Exception:
            continue
    return None


def find_gee_dem_tile() -> Path | None:
    out_tif = SITE_OUT / "rasters" / "_gee_dem.tif"
    if out_tif.exists() and out_tif.stat().st_size > 0:
        return out_tif
    try:
        init_ee()
        boundary = gpd.read_file(PROJECT_BOUNDARY).to_crs("EPSG:4326")
        region = ee.Geometry(boundary.geometry.iloc[0].__geo_interface__)
        dem = ee.Image("USGS/3DEP/10m").clip(region)
        url = dem.getDownloadURL(
            {
                "scale": 10,
                "crs": "EPSG:4326",
                "region": region,
                "format": "GEO_TIFF",
            }
        )
        out_tif.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(url, out_tif)
        print(f"   ✓ DEM tile from USGS 3DEP (Earth Engine): {out_tif.name}")
        return out_tif
    except Exception as e:
        print(f"   ⚠  Earth Engine DEM fallback failed: {e}")
        return None


def find_dem_for_site():
    dem = find_nyc_dem_tile()
    if dem is not None:
        return dem, "NYC 1-ft DEM"
    gee_dem = find_gee_dem_tile()
    if gee_dem is not None:
        return gee_dem, "USGS 3DEP 10 m (Earth Engine)"
    return None, None


def compute_slope(dem_path: Path, out_tif: Path):
    """Compute slope in degrees using the standard 3x3 kernel approach."""
    boundary = gpd.read_file(PROJECT_BOUNDARY)
    with rasterio.open(dem_path) as src:
        metric_crs = "EPSG:2263"
        boundary_metric = boundary.to_crs(metric_crs)
        buffered = boundary_metric.geometry.buffer(20).to_crs(src.crs)
        arr, transform = rasterio.mask.mask(src, [buffered.iloc[0]],
                                             crop=True, filled=True, nodata=-9999)
        elev = arr[0].astype(np.float32)
        elev[elev == -9999] = np.nan

        dx = abs(transform[0])
        dy = abs(transform[4])
        if src.crs.is_geographic:
            lat = boundary.to_crs("EPSG:4326").geometry.iloc[0].centroid.y
            meters_per_deg_lat = 111_320.0
            meters_per_deg_lon = 111_320.0 * np.cos(np.radians(lat))
            dx *= meters_per_deg_lon
            dy *= meters_per_deg_lat
        elif "ft" in str(src.crs).lower() or "foot" in str(src.crs).lower():
            dx *= 0.3048
            dy *= 0.3048
            elev *= 0.3048

        # Sobel-like gradient
        gx = np.gradient(elev, dx, axis=1)
        gy = np.gradient(elev, dy, axis=0)
        slope_rad = np.arctan(np.hypot(gx, gy))
        slope_deg = np.degrees(slope_rad)
        slope_deg = np.where(np.isnan(elev), -1, slope_deg)

        profile = src.profile.copy()
        profile.update({
            "dtype": "float32",
            "height": slope_deg.shape[0],
            "width": slope_deg.shape[1],
            "transform": transform,
            "count": 1,
            "nodata": -1,
        })
        out_tif.parent.mkdir(parents=True, exist_ok=True)
        with rasterio.open(out_tif, "w", **profile) as dst:
            dst.write(slope_deg.astype(np.float32), 1)

        return slope_deg, transform, src.crs


def colorize_to_png(slope_arr: np.ndarray, transform, src_crs, out_png: Path):
    """Apply ochre/coral ramp 0–45° → write PNG with alpha. Reproject to 4326."""
    # First reproject to EPSG:4326 so Mapbox image source aligns
    from rasterio import Affine
    from rasterio.warp import calculate_default_transform, reproject

    h, w = slope_arr.shape
    bounds_src = rasterio.transform.array_bounds(h, w, transform)
    dst_transform, dw, dh = calculate_default_transform(
        src_crs, "EPSG:4326", w, h, *bounds_src)

    dst = np.full((dh, dw), -1, dtype=np.float32)
    reproject(slope_arr, dst, src_transform=transform, src_crs=src_crs,
              dst_transform=dst_transform, dst_crs="EPSG:4326",
              resampling=Resampling.bilinear,
              src_nodata=-1, dst_nodata=-1)

    # Build RGBA image
    rgba = np.zeros((dh, dw, 4), dtype=np.uint8)
    valid = dst >= 0
    norm = np.clip(dst / 45.0, 0, 1)

    # Color ramp: cream → ochre → coral
    r = np.where(norm < 0.5, 245 - norm * 2 * (245 - 196),
                              196 - (norm - 0.5) * 2 * (196 - 201)).clip(0, 255)
    g = np.where(norm < 0.5, 241 - norm * 2 * (241 - 140),
                              140 - (norm - 0.5) * 2 * (140 - 74)).clip(0, 255)
    b = np.where(norm < 0.5, 232 - norm * 2 * (232 - 46),
                              46 + (norm - 0.5) * 2 * (59 - 46)).clip(0, 255)
    a = np.where(valid, np.clip(norm * 255, 30, 230), 0)

    rgba[..., 0] = r
    rgba[..., 1] = g
    rgba[..., 2] = b
    rgba[..., 3] = a

    Image.fromarray(rgba, "RGBA").save(out_png)

    # Bounds for Mapbox image source (in [W, S, E, N] order)
    dst_bounds = rasterio.transform.array_bounds(dh, dw, dst_transform)
    return list(dst_bounds)


def slope_buckets(slope_arr: np.ndarray) -> dict:
    valid = slope_arr >= 0
    total = int(valid.sum())
    if total == 0:
        return {}
    return {
        "0_5":   round((slope_arr[valid] < 5).sum() / total * 100, 1),
        "5_10":  round(((slope_arr[valid] >= 5) & (slope_arr[valid] < 10)).sum() / total * 100, 1),
        "10_20": round(((slope_arr[valid] >= 10) & (slope_arr[valid] < 20)).sum() / total * 100, 1),
        "20_30": round(((slope_arr[valid] >= 20) & (slope_arr[valid] < 30)).sum() / total * 100, 1),
        "gt_30": round((slope_arr[valid] >= 30).sum() / total * 100, 1),
        "mean":  round(float(np.mean(slope_arr[valid])), 1),
        "max":   round(float(np.max(slope_arr[valid])), 1),
        "_total_pixels": total,
    }


def write_canopy_change_png():
    """TNC class codes: 1 = no change, 2 = gain (2017→2021), 3 = loss."""
    tif_path = SITE_OUT / "rasters" / "canopychange_clipped.tif"
    if not tif_path.exists():
        print("  (skip canopy_change.png — no canopychange_clipped.tif)")
        return
    with rasterio.open(tif_path) as src:
        arr = src.read(1)
        transform = src.transform
        crs = src.crs
    h, w = arr.shape
    rgba_src = np.zeros((h, w, 4), dtype=np.uint8)
    loss = arr == 3
    gain = arr == 2
    rgba_src[loss] = [201, 74, 59, 220]
    rgba_src[gain] = [61, 107, 61, 220]
    from rasterio.warp import calculate_default_transform, reproject

    bounds_src = rasterio.transform.array_bounds(h, w, transform)
    dst_transform, dw, dh = calculate_default_transform(crs, "EPSG:4326", w, h, *bounds_src)
    out_rgba = np.zeros((dh, dw, 4), dtype=np.uint8)
    for c in range(4):
        reproject(
            rgba_src[..., c],
            out_rgba[..., c],
            src_transform=transform,
            src_crs=crs,
            dst_transform=dst_transform,
            dst_crs="EPSG:4326",
            resampling=Resampling.nearest,
        )
    OUTPUTS["raster_canopy_change"].parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(out_rgba, "RGBA").save(OUTPUTS["raster_canopy_change"])
    b4326 = list(rasterio.transform.array_bounds(dh, dw, dst_transform))
    bounds_path = OUTPUTS["raster_bounds"]
    bounds_meta = json.loads(bounds_path.read_text()) if bounds_path.exists() else {}
    bounds_meta["canopychange_2017_2021"] = {
        "path": "rasters/canopy_change.png",
        "bounds_4326": b4326,
    }
    bounds_path.write_text(json.dumps(bounds_meta, indent=2))
    print(f"  ✓ canopy_change.png (coral loss / moss gain)")


def write_landcover_preview_pngs():
    """Simple class-value → green ramp previews for map split (2010 vs 2021)."""
    from rasterio.warp import calculate_default_transform, reproject

    hist_source = SITE_OUT / "rasters" / "landcover_2010_clipped.tif"
    if not hist_source.exists():
        hist_2017 = SITE_OUT / "rasters" / "landcover_2017_clipped.tif"
        if hist_2017.exists():
            hist_source = hist_2017

    jobs = [
        (hist_source, OUTPUTS["raster_lc2010"], "lc2010", (40, 55, 30)),
        (SITE_OUT / "rasters" / "landcover_2021_clipped.tif", OUTPUTS["raster_lc2021"], "lc2021", (30, 70, 45)),
    ]
    for tif_path, out_png, meta_key, base_rgb in jobs:
        if not tif_path.exists():
            continue
        with rasterio.open(tif_path) as src:
            arr = src.read(1).astype(np.float32)
            transform = src.transform
            crs = src.crs
        h, w = arr.shape
        valid = np.isfinite(arr) & (arr > 0)
        mx = float(np.nanpercentile(arr[valid], 99)) if valid.any() else 1.0
        norm = np.clip(arr / max(mx, 1.0), 0, 1)
        r = (base_rgb[0] + norm * 50).astype(np.uint8)
        g = (base_rgb[1] + norm * 80).astype(np.uint8)
        b = (base_rgb[2] + norm * 40).astype(np.uint8)
        a = np.where(valid, 210, 0).astype(np.uint8)
        rgba_src = np.stack([r, g, b, a], axis=-1)
        bounds_src = rasterio.transform.array_bounds(h, w, transform)
        dst_transform, dw, dh = calculate_default_transform(crs, "EPSG:4326", w, h, *bounds_src)
        out_rgba = np.zeros((dh, dw, 4), dtype=np.uint8)
        for c in range(4):
            reproject(
                rgba_src[..., c],
                out_rgba[..., c],
                src_transform=transform,
                src_crs=crs,
                dst_transform=dst_transform,
                dst_crs="EPSG:4326",
                resampling=Resampling.nearest,
            )
        Image.fromarray(out_rgba, "RGBA").save(out_png)
        b4326 = list(rasterio.transform.array_bounds(dh, dw, dst_transform))
        bounds_path = OUTPUTS["raster_bounds"]
        bounds_meta = json.loads(bounds_path.read_text()) if bounds_path.exists() else {}
        bounds_meta[meta_key] = {"path": f"rasters/{out_png.name}", "bounds_4326": b4326}
        bounds_path.write_text(json.dumps(bounds_meta, indent=2))
        print(f"  ✓ {out_png.name} ({meta_key})")


def main():
    dem, dem_source = find_dem_for_site()
    if not dem:
        print("⚠  No NYC DEM tile available. Skipping slope. (Run 01_download_sources.py)")
        OUTPUTS["raster_slope"].parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGBA", (10, 10)).save(OUTPUTS["raster_slope"])
    else:
        print(f"\n→ Computing slope from {dem_source}...")
        slope_tif = SITE_OUT / "rasters" / "slope_clipped.tif"
        slope_arr, transform, crs = compute_slope(dem, slope_tif)

        print(f"→ Colorizing → PNG...")
        bounds_4326 = colorize_to_png(slope_arr, transform, crs, OUTPUTS["raster_slope"])

        buckets = slope_buckets(slope_arr)
        buckets["dem_source"] = dem_source
        print(f"   Slope distribution:")
        for k, v in buckets.items():
            if not k.startswith("_") and k not in ("mean", "max"):
                print(f"     {k}°: {v}%")
        print(f"   Mean slope: {buckets.get('mean', '?')}° · Max: {buckets.get('max', '?')}°")

        bounds_path = OUTPUTS["raster_bounds"]
        bounds_meta = json.loads(bounds_path.read_text()) if bounds_path.exists() else {}
        bounds_meta["slope"] = {"path": "rasters/slope.png", "bounds_4326": bounds_4326}
        bounds_path.write_text(json.dumps(bounds_meta, indent=2))

        (SITE_OUT / "_slope_buckets.json").write_text(json.dumps(buckets, indent=2))

        print(f"\n✓ Slope raster → {OUTPUTS['raster_slope'].relative_to(SITE_OUT.parent)}")

    write_canopy_change_png()
    write_landcover_preview_pngs()
    print(f"\n→ Next: python 05_gee_thermal.py")


if __name__ == "__main__":
    main()
