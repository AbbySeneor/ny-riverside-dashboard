#!/usr/bin/env python3
"""
Copy data-prep pipeline outputs into public/data/<SITE_ID>/ for the Vite app.

Source of truth: data-prep/out/<SITE_ID>/ (produced by run_all.sh and scripts 01–08).
Do not hand-edit JSON in public/ — re-run the pipeline and sync.

Usage:
  SITE_ID=west_harlem python3 scripts/sync_public_data.py
"""
from __future__ import annotations

import os
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE_ID = os.environ.get("SITE_ID", "west_harlem")
SRC = ROOT / "data-prep" / "out" / SITE_ID
DST = ROOT / "public" / "data" / SITE_ID
REQUIRED_FILES = (
    "boundary.geojson",
    "context.geojson",
    "trees_2021.geojson",
    "invasive_zones.geojson",
    "hvi.geojson",
    "canopy_trajectory.json",
    "scorecard.json",
    "lst_zones.json",
    "ndvi_timeseries.json",
    "ecosystem_services.json",
    "tree_summary.json",
    "rasters/bounds.json",
)


def main() -> None:
    if not SRC.is_dir():
        raise SystemExit(
            f"Missing pipeline output directory:\n  {SRC}\n\n"
            "Run the pipeline first, for example:\n"
            f"  cd data-prep && SITE_ID={SITE_ID} bash run_all.sh\n"
        )
    if not any(SRC.iterdir()):
        raise SystemExit(f"Pipeline directory is empty (no files): {SRC}")

    DST.parent.mkdir(parents=True, exist_ok=True)
    staging = DST.parent / f".{SITE_ID}.syncing"
    if staging.exists():
        shutil.rmtree(staging)
    shutil.copytree(SRC, staging)
    missing = [name for name in REQUIRED_FILES if not (staging / name).is_file()]
    if missing:
        shutil.rmtree(staging)
        raise SystemExit(
            f"Pipeline output for {SITE_ID} is incomplete. Missing:\n"
            + "\n".join(f"  - {name}" for name in missing)
        )
    if DST.exists():
        shutil.rmtree(DST)
    staging.rename(DST)
    print(f"Copied {SRC.relative_to(ROOT)} → {DST.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
