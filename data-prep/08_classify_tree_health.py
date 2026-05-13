#!/usr/bin/env python3
"""
08_classify_tree_health.py — tree health from Sentinel-2 July max NDVI (Earth Engine).

For each LiDAR tree centroid:
  • Buffer (m) = max(crown diameter / 2 + 15 m, 20 m) ≈ crown + ~3 Sentinel-2 pixels.
  • July-only S2_SR_HARMONIZED through latest calendar year (2019–present), pixel-wise max NDVI composite, reduceRegions (not per-tree loops).

Writes health_class (healthy / stressed / critical), crown_diameter (m), and s2_ndvi_july_max on OUTPUTS["trees"].
"""
from __future__ import annotations

import json
import math
import os
import sys
from datetime import datetime

import ee
import geopandas as gpd

from config import GEE_PROJECT, OUTPUTS, SITE_ID, ROOT


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


def crown_m_from_row(row) -> float:
    for k in (
        "crown_diameter_m",
        "crown_diameter",
        "CRWN_DIA",
        "crownwidth",
        "CrownWidth",
        "diameter",
        "CRWNWDTH",
        "Radius",
    ):
        if k not in row.index:
            continue
        v = row[k]
        if v is None or (isinstance(v, float) and math.isnan(v)):
            continue
        try:
            fv = float(v)
            if fv <= 0:
                continue
            if k == "Radius":
                return fv * 2 * 0.3048
            return fv
        except (TypeError, ValueError):
            continue
    return 6.0


def classify_ndvi(ndvi: float | None) -> str | None:
    if ndvi is None or not math.isfinite(ndvi):
        return None
    if ndvi >= 0.70:
        return "healthy"
    if ndvi >= 0.55:
        return "stressed"
    return "critical"


def main() -> None:
    trees_path = OUTPUTS["trees"]
    if not trees_path.exists():
        print("No trees GeoJSON; skip 08.")
        return
    gdf = gpd.read_file(trees_path)
    if gdf.empty:
        print("0 trees; skip 08.")
        return

    try:
        init_ee()
    except Exception as e:
        print(f"Earth Engine init failed ({e}). Run: earthengine authenticate", file=sys.stderr)
        sys.exit(1)

    feats = []
    crown_by_sid = {}
    for idx, row in gdf.iterrows():
        geom = row.geometry
        if geom is None or geom.geom_type != "Point":
            continue
        cd = crown_m_from_row(row)
        try:
            sid = int(row["site_id"])
        except (KeyError, TypeError, ValueError):
            sid = int(idx)
        crown_by_sid[sid] = cd
        feats.append(
            ee.Feature(
                ee.Geometry.Point(geom.x, geom.y),
                {"site_id": sid, "crown_diameter": float(cd)},
            )
        )

    if not feats:
        print("No point geometries; skip 08.")
        return

    roi = ee.FeatureCollection(feats).geometry()

    health_end_year = max(2026, datetime.now().year)
    s2 = (
        ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
        .filterBounds(roi)
        .filterDate("2019-01-01", f"{health_end_year}-12-31")
        .filter(ee.Filter.calendarRange(7, 7, "month"))
        .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 80))
    )

    def add_ndvi(img):
        return img.normalizedDifference(["B8", "B4"]).rename("NDVI").copyProperties(img, ["system:time_start"])

    ndvi_max = s2.map(add_ndvi).max()

    ndvi_by_sid: dict[int, float] = {}
    batch_size = 2000
    total_batches = (len(feats) + batch_size - 1) // batch_size
    for start in range(0, len(feats), batch_size):
        batch = feats[start:start + batch_size]
        batch_no = start // batch_size + 1
        print(f"   tree health batch {batch_no}/{total_batches} ({len(batch)} trees)...")
        fc = ee.FeatureCollection(batch)
        reduced = ndvi_max.reduceRegions(
            collection=fc,
            reducer=ee.Reducer.max(),
            scale=10,
            tileScale=4,
        )
        try:
            payload = reduced.getInfo()
        except Exception as e:
            print(f"reduceRegions failed (batch {batch_no}): {e}", file=sys.stderr)
            sys.exit(1)
        for f in payload.get("features", []):
            p = f.get("properties") or {}
            sid = p.get("site_id")
            raw = p.get("NDVI")
            if raw is None:
                raw = p.get("max")
            if sid is None or raw is None:
                continue
            try:
                ndvi_by_sid[int(sid)] = float(raw)
            except (TypeError, ValueError):
                continue

    ndvi_col = []
    health_col = []
    crown_col = []
    for idx, row in gdf.iterrows():
        try:
            sid = int(row["site_id"])
        except (KeyError, TypeError, ValueError):
            sid = int(idx)
        nd = ndvi_by_sid.get(sid)
        ndvi_col.append(nd)
        health_col.append(classify_ndvi(nd))
        crown_col.append(float(crown_by_sid.get(sid, crown_m_from_row(row))))

    gdf = gdf.copy()
    gdf["s2_ndvi_july_max"] = ndvi_col
    gdf["health_class"] = health_col
    gdf["crown_diameter"] = crown_col
    gdf["health_method"] = (
        f"Sentinel-2 SR Harmonized · July 2019–{health_end_year} max NDVI · reduceRegions"
    )

    gdf.to_file(trees_path, driver="GeoJSON")
    print(f"✓ {SITE_ID}: classified {len(gdf)} trees → {trees_path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
