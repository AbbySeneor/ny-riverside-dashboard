"""
02_clip_to_site.py — clip everything to the project polygon.

Outputs:
  out/trees_2021.geojson           — tree centroids inside the site
  out/boundary.geojson             — copy for the frontend
  out/context.geojson              — copy for the frontend
  out/hvi.geojson                  — NYC HVI for surrounding tracts
  out/rasters/*_clipped.tif         — clipped intermediate rasters
  out/rasters/bounds.json           — pixel bounds for Mapbox raster sources

Run after: 01_download_sources.py
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

import geopandas as gpd
import numpy as np
import rasterio
import rasterio.mask
import rasterio.warp
from shapely.geometry import box

from config import RAW, SITE_OUT, OUTPUTS, PROJECT_BOUNDARY, SITE_CONTEXT, SITE_BBOX, SITE_ID, SITE_ACRES

CANOPY_CLASS = 1
FEET_TO_METERS = 0.3048


def load_boundary() -> gpd.GeoDataFrame:
    return gpd.read_file(PROJECT_BOUNDARY).to_crs("EPSG:4326")


def raster_meta(out_path: Path, data_shape: tuple[int, ...], transform, src_crs) -> dict:
    bounds = rasterio.warp.transform_bounds(
        src_crs,
        "EPSG:4326",
        *rasterio.transform.array_bounds(data_shape[1], data_shape[2], transform),
    )
    return {
        "path": str(out_path.relative_to(SITE_OUT)),
        "bounds_4326": list(bounds),
        "shape": list(data_shape),
        "crs": str(src_crs),
    }


def clip_raster(in_path: Path, out_path: Path, boundary: gpd.GeoDataFrame) -> dict:
    """Clip a raster to the site polygon."""
    with rasterio.open(in_path) as src:
        boundary_proj = boundary.to_crs(src.crs)
        data, transform = rasterio.mask.mask(
            src,
            boundary_proj.geometry,
            crop=True,
            filled=True,
        )
        profile = src.profile.copy()
        profile.update(
            {
                "height": data.shape[1],
                "width": data.shape[2],
                "transform": transform,
            }
        )
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with rasterio.open(out_path, "w", **profile) as dst:
            dst.write(data)
        return raster_meta(out_path, data.shape, transform, src.crs)


def write_derived_landcover(
    base_path: Path,
    change_path: Path,
    out_path: Path,
    *,
    target_year: int,
    source_label: str,
) -> None:
    with rasterio.open(base_path) as src_base, rasterio.open(change_path) as src_change:
        base = src_base.read(1)
        change = src_change.read(1)
        if base.shape != change.shape:
            raise ValueError(f"Raster shape mismatch for {target_year} land cover derivation")

        derived = base.copy()
        derived[(base == CANOPY_CLASS) & (change == 2)] = 2
        derived[change == 3] = CANOPY_CLASS

        profile = src_base.profile.copy()
        profile.update(dtype=rasterio.uint8, count=1)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with rasterio.open(out_path, "w", **profile) as dst:
            dst.write(derived.astype(np.uint8), 1)
    print(f"   ✓ derived landcover_{target_year}_clipped.tif from {source_label}")


def enrich_tree_attributes(trees: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    out = trees.copy()
    if "Height" in out.columns:
        out["height_m"] = (out["Height"].astype(float) * FEET_TO_METERS).round(2)
    if "Radius" in out.columns:
        out["crown_diameter_m"] = (out["Radius"].astype(float) * 2 * FEET_TO_METERS).round(2)
    return out


def merge_raster_bounds_for_map(bounds_meta: dict) -> dict:
    """Merge with any existing bounds.json so re-running 02 does not drop PNG map layers from 04/05."""
    prev: dict = {}
    if OUTPUTS["raster_bounds"].exists():
        try:
            prev = json.loads(OUTPUTS["raster_bounds"].read_text())
        except Exception:
            prev = {}
    merged = {**prev, **bounds_meta}
    png_keep = [
        ("canopychange_2017_2021", "rasters/canopy_change.png"),
        ("slope", "rasters/slope.png"),
        ("lst", "rasters/lst.png"),
        ("lc2010", "rasters/lc2010.png"),
        ("lc2021", "rasters/lc2021.png"),
    ]
    for key, rel in png_keep:
        if not (SITE_OUT / rel).is_file():
            continue
        old = prev.get(key)
        if old and str(old.get("path", "")).endswith(".png") and old.get("bounds_4326"):
            merged[key] = old
    if (SITE_OUT / "rasters/lst.png").is_file() and not merged.get("lst"):
        west, south, east, north = SITE_BBOX
        merged["lst"] = {
            "path": "rasters/lst.png",
            "bounds_4326": [west - 0.005, south - 0.003, east + 0.005, north + 0.003],
        }
    return merged


def clip_geojson(in_path: Path, out_path: Path, boundary_buffer_deg: float = 0.005) -> int:
    """Spatial filter a GeoJSON to features intersecting the buffered site bbox."""
    src_gdf = gpd.read_file(in_path).to_crs("EPSG:4326")
    bb = box(
        SITE_BBOX[0] - boundary_buffer_deg,
        SITE_BBOX[1] - boundary_buffer_deg,
        SITE_BBOX[2] + boundary_buffer_deg,
        SITE_BBOX[3] + boundary_buffer_deg,
    )
    clipped = src_gdf[src_gdf.intersects(bb)].copy()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    clipped.to_file(out_path, driver="GeoJSON")
    return len(clipped)


def main() -> None:
    boundary = load_boundary()
    site_poly = boundary.geometry.iloc[0]
    site_area_m2 = boundary.to_crs("EPSG:2263").geometry.area.iloc[0]
    print(f"\n→ SITE_ID={SITE_ID}")
    print(f"→ Site polygon loaded: {site_area_m2:.0f} m² ({site_area_m2 / 4046.86:.1f} ac)")

    shutil.copy(PROJECT_BOUNDARY, OUTPUTS["boundary_copy"])
    shutil.copy(SITE_CONTEXT, OUTPUTS["context"])

    bounds_meta: dict[str, dict] = {}

    tnc_zip = RAW / "tnc_trees_2021.gdb.zip"
    if tnc_zip.exists():
        print("\n→ Clipping TNC 2021 tree centroids...")
        try:
            tnc_trees = gpd.read_file(f"zip://{tnc_zip}", layer="tree_centroids_2021").to_crs("EPSG:4326")
        except Exception:
            import fiona

            layers = fiona.listlayers(f"zip://{tnc_zip}")
            print(f"   GDB layers found: {layers}")
            cent_layer = next((layer for layer in layers if "centroid" in layer.lower()), layers[0])
            tnc_trees = gpd.read_file(f"zip://{tnc_zip}", layer=cent_layer).to_crs("EPSG:4326")

        clipped = tnc_trees[tnc_trees.intersects(site_poly)].copy()
        clipped = enrich_tree_attributes(clipped)
        clipped["site_id"] = range(len(clipped))
        clipped.to_file(OUTPUTS["trees"], driver="GeoJSON")
        print(f"   ✓ {len(clipped)} trees intersecting the site polygon → {OUTPUTS['trees'].name}")
    else:
        print(f"\n⚠  TNC tree centroids zip not present in {RAW}.")
        print("   Run 01_download_sources.py first, or grab from Zenodo manually.")
        OUTPUTS["trees"].write_text(
            json.dumps(
                {
                    "type": "FeatureCollection",
                    "features": [],
                    "_note": "Run data-prep pipeline to populate.",
                }
            )
        )

    nyc_forms = RAW / "nyc_forms_trees.geojson"
    if nyc_forms.exists():
        n = clip_geojson(nyc_forms, SITE_OUT / "nyc_forms_trees_clipped.geojson")
        print(f"   ✓ NYC ForMS clipped: {n} adjacent street trees")

    hvi = RAW / "nyc_hvi.geojson"
    if hvi.exists():
        n = clip_geojson(hvi, OUTPUTS["hvi"], boundary_buffer_deg=0.02)
        print(f"   ✓ HVI clipped: {n} census tracts")

    cc = RAW / "tnc_canopychange.tif"
    if cc.exists():
        print("\n→ Clipping TNC canopy change raster...")
        bounds_meta["canopychange_2017_2021"] = clip_raster(
            cc, SITE_OUT / "rasters" / "canopychange_clipped.tif", boundary
        )

    nyc_cc = RAW / "nyc_canopychange_2010_2017.tif"
    if nyc_cc.exists():
        print("→ Clipping NYC 2010→2017 canopy change...")
        bounds_meta["canopychange_2010_2017"] = clip_raster(
            nyc_cc, SITE_OUT / "rasters" / "nyc_canopychange_2010_2017_clipped.tif", boundary
        )

    for year, fname in [
        (2021, "tnc_landcover_2021.tif"),
        (2017, "nyc_landcover_2017.tif"),
        (2010, "nyc_landcover_2010.tif"),
    ]:
        lc_path = RAW / fname
        if lc_path.exists():
            print(f"→ Clipping {year} land cover...")
            bounds_meta[f"landcover_{year}"] = clip_raster(
                lc_path, SITE_OUT / "rasters" / f"landcover_{year}_clipped.tif", boundary
            )

    lc2021 = SITE_OUT / "rasters" / "landcover_2021_clipped.tif"
    tnc_cc = SITE_OUT / "rasters" / "canopychange_clipped.tif"
    if lc2021.exists() and tnc_cc.exists() and not (SITE_OUT / "rasters" / "landcover_2017_clipped.tif").exists():
        print("→ Deriving 2017 land cover from TNC 2021 baseline + 2017→2021 change...")
        write_derived_landcover(
            lc2021,
            tnc_cc,
            SITE_OUT / "rasters" / "landcover_2017_clipped.tif",
            target_year=2017,
            source_label="TNC 2021 + 2017→2021 canopy change",
        )
        out17 = SITE_OUT / "rasters" / "landcover_2017_clipped.tif"
        with rasterio.open(out17) as src:
            bounds_meta["landcover_2017"] = raster_meta(
                out17,
                (1, src.height, src.width),
                src.transform,
                src.crs,
            )

    lc2017 = SITE_OUT / "rasters" / "landcover_2017_clipped.tif"
    nyc_cc = SITE_OUT / "rasters" / "nyc_canopychange_2010_2017_clipped.tif"
    if lc2017.exists() and nyc_cc.exists() and not (SITE_OUT / "rasters" / "landcover_2010_clipped.tif").exists():
        print("→ Deriving 2010 land cover from 2017 baseline + 2010→2017 change...")
        write_derived_landcover(
            lc2017,
            nyc_cc,
            SITE_OUT / "rasters" / "landcover_2010_clipped.tif",
            target_year=2010,
            source_label="2017 baseline + NYC 2010→2017 canopy change",
        )
        out10 = SITE_OUT / "rasters" / "landcover_2010_clipped.tif"
        with rasterio.open(out10) as src:
            bounds_meta["landcover_2010"] = raster_meta(
                out10,
                (1, src.height, src.width),
                src.transform,
                src.crs,
            )

    merged_bounds = merge_raster_bounds_for_map(bounds_meta)
    OUTPUTS["raster_bounds"].write_text(json.dumps(merged_bounds, indent=2))
    print(f"\n✓ Raster bounds written → {OUTPUTS['raster_bounds'].relative_to(SITE_OUT.parent)}")
    print("\n→ Next: python 03_tree_canopy_stats.py")


if __name__ == "__main__":
    main()
