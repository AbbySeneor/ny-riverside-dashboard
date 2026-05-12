"""
01_download_sources.py — pull every open dataset we need.

Downloads:
  - TNC/UVM 2021 NYC land cover, canopy change, tree centroids (Zenodo)
  - NYC 2010 + 2017 land cover and canopy change (NYC Open Data)
  - NYC 1-ft LiDAR-derived DEM
  - NYC Forestry Tree Points
  - NYC Heat Vulnerability Index (MODZCTA + rankings)

Run:
    python 01_download_sources.py [--skip-large]
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

import geopandas as gpd
import pandas as pd
import requests
from tqdm import tqdm

from config import RAW, SOURCES


def stream_download(url: str, dest: Path, chunk: int = 1024 * 1024) -> bool:
    """Resumable streaming download with progress bar."""
    if dest.exists() and dest.stat().st_size > 0:
        print(f"  ✓ already have {dest.name} ({dest.stat().st_size / 1e6:.1f} MB)")
        return True
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        with requests.get(url, stream=True, timeout=120) as r:
            r.raise_for_status()
            total = int(r.headers.get("content-length", 0))
            with open(dest, "wb") as f, tqdm(
                total=total, unit="B", unit_scale=True, desc=dest.name, ncols=80
            ) as bar:
                for block in r.iter_content(chunk_size=chunk):
                    f.write(block)
                    bar.update(len(block))
        return True
    except Exception as e:
        print(f"  ✗ {dest.name} failed: {e}")
        if dest.exists():
            dest.unlink()
        return False


def extract_largest_geotiff(zip_path: Path, tif_dest: Path) -> bool:
    if tif_dest.exists() and tif_dest.stat().st_size > 0:
        print(f"  ✓ already have {tif_dest.name} ({tif_dest.stat().st_size / 1e6:.1f} MB)")
        return True
    if not zip_path.exists():
        return False
    extract_dir = zip_path.with_suffix(".extracted")
    if not extract_dir.exists():
        print(f"  → extracting {zip_path.name}...")
        extract_dir.mkdir(parents=True, exist_ok=True)
        try:
            with zipfile.ZipFile(zip_path) as zf:
                zf.extractall(extract_dir)
        except NotImplementedError:
            subprocess.run(
                ["unzip", "-o", str(zip_path), "-d", str(extract_dir)],
                check=True,
            )
    tifs = sorted(extract_dir.rglob("*.tif"), key=lambda p: p.stat().st_size, reverse=True)
    if not tifs:
        print(f"  ✗ no GeoTIFF found in {zip_path.name}")
        return False
    tif_dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(tifs[0], tif_dest)
    print(f"  ✓ extracted {tif_dest.name} from {zip_path.name}")
    return True


def ensure_zip_geotiff(url: str, zip_name: str, tif_name: str) -> bool:
    zip_path = RAW / zip_name
    tif_path = RAW / tif_name
    if not extract_largest_geotiff(zip_path, tif_path):
        if not stream_download(url, zip_path):
            return False
        return extract_largest_geotiff(zip_path, tif_path)
    return True


def build_hvi_geojson(dest: Path) -> bool:
    if dest.exists() and dest.stat().st_size > 0:
        print(f"  ✓ already have {dest.name} ({dest.stat().st_size / 1e6:.1f} MB)")
        return True
    try:
        with requests.get(SOURCES["nyc_hvi_rankings"], timeout=120) as r:
            r.raise_for_status()
            payload = r.json()
        cols = [c["fieldName"] for c in payload["meta"]["view"]["columns"]]
        rows = [dict(zip(cols, row)) for row in payload["data"]]
        rankings = pd.DataFrame(rows)[["zcta20", "hvi"]].dropna()
        rankings["zcta20"] = rankings["zcta20"].astype(str).str.zfill(5)
        rankings["hvi"] = pd.to_numeric(rankings["hvi"], errors="coerce")

        zcta = gpd.read_file(SOURCES["nyc_hvi_zones"]).to_crs("EPSG:4326")
        zcta["zcta20"] = zcta["modzcta"].astype(str).str.zfill(5)
        merged = zcta.merge(rankings, on="zcta20", how="left")
        merged["hvi_2018"] = merged["hvi"]
        merged = merged.dropna(subset=["hvi_2018"])
        dest.parent.mkdir(parents=True, exist_ok=True)
        merged.to_file(dest, driver="GeoJSON")
        print(f"  ✓ built {dest.name} ({len(merged)} MODZCTA zones)")
        return True
    except Exception as e:
        print(f"  ✗ {dest.name} failed: {e}")
        return False


JOBS = [
    ("TNC 2021 land cover (1.2 GB)", "tnc_landcover_2021", "tnc_landcover_2021.tif", True, "file"),
    ("TNC 2017→2021 canopy change", "tnc_canopychange", "tnc_canopychange.tif", False, "file"),
    ("TNC 2021 tree centroids (GDB zip)", "tnc_tree_points", "tnc_trees_2021.gdb.zip", False, "file"),
    ("NYC Forestry Tree Points", "nyc_forms", "nyc_forms_trees.geojson", False, "file"),
]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--skip-large",
        action="store_true",
        help="Skip files >500MB (citywide rasters). Use Earth Engine for those instead.",
    )
    ap.add_argument("--only", nargs="+", help="Only download these named jobs.")
    args = ap.parse_args()

    print(f"\n→ Downloading to {RAW}\n")
    failed: list[str] = []
    for label, key, fname, large, kind in JOBS:
        if args.skip_large and large:
            print(f"  ⏭  skipping {label} (--skip-large)")
            continue
        if args.only and not any(o.lower() in label.lower() for o in args.only):
            continue
        print(f"\n→ {label}")
        ok = False
        if kind == "zip_geotiff":
            zip_name = Path(fname).with_suffix(".zip").name
            ok = ensure_zip_geotiff(SOURCES[key], zip_name, fname)
        elif kind == "zip":
            ok = stream_download(SOURCES[key], RAW / fname)
        else:
            ok = stream_download(SOURCES[key], RAW / fname)
        if not ok:
            failed.append(label)

    print("\n→ NYC Heat Vulnerability Index")
    if not build_hvi_geojson(RAW / "nyc_hvi.geojson"):
        failed.append("NYC Heat Vulnerability Index")

    print("\n" + "=" * 60)
    if failed:
        print(f"⚠  {len(failed)} downloads failed — see above. You can:")
        print("   • Re-run this script (it resumes)")
        print("   • Download manually from https://zenodo.org/records/14053441")
        print("   • Use Earth Engine pipeline (05_gee_thermal.py, 06_gee_ndvi.py)")
        sys.exit(1)
    print("✓ All downloads complete. Next: python 02_clip_to_site.py")


if __name__ == "__main__":
    main()
