#!/usr/bin/env python3
"""Build per-site boundary and context GeoJSON files under boundary/."""
from __future__ import annotations

import json
import shutil
from pathlib import Path

import geopandas as gpd
from shapely.geometry import MultiPolygon
from shapely.ops import unary_union

from config import BOUNDARY, SITES

PARKS_URL = "https://data.cityofnewyork.us/api/geospatial/enfh-gkve?method=export&format=GeoJSON"
PARK_MATCH = {
    "morningside": "Morningside Park",
    "highbridge": "Highbridge Park",
    "inwood_hill": "Inwood Hill Park",
    "van_cortlandt": "Van Cortlandt Park",
    "pelham_bay": "Pelham Bay Park",
}
WEST_HARLEM_PARK = "Riverside Park"
MIN_BOUNDARY_PART_ACRES = 1.0


def drop_sliver_polygons(geom, min_acres: float = MIN_BOUNDARY_PART_ACRES):
    """Drop tiny intersection fragments that are not meaningful site footprints."""
    if geom.geom_type != "MultiPolygon":
        return geom
    parts = []
    for part in geom.geoms:
        acres = gpd.GeoDataFrame(geometry=[part], crs="EPSG:4326").to_crs("EPSG:2263").geometry.area.iloc[0] / 4046.86
        if acres >= min_acres:
            parts.append(part)
    if not parts:
        return geom
    if len(parts) == 1:
        return parts[0]
    return MultiPolygon(parts)


def write_context(site_id: str, label: str, acres: float) -> None:
    path = BOUNDARY / SITES[site_id]["context"]
    path.write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "name": f"{site_id}_context_layers",
                "features": [],
                "properties": {
                    "name": label,
                    "site_id": site_id,
                    "area_acres": acres,
                    "note": "Context layers pending RPC / NAC field mapping.",
                },
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def build_west_harlem_boundary(
    parks: gpd.GeoDataFrame,
    legacy_boundary: Path,
    legacy_context: Path,
    west_boundary: Path,
    west_context: Path,
) -> None:
    if not legacy_boundary.exists():
        raise SystemExit(f"Missing legacy boundary: {legacy_boundary}")

    legacy = gpd.read_file(legacy_boundary).to_crs("EPSG:4326")
    riverside = parks[parks["signname"].str.fullmatch(WEST_HARLEM_PARK, case=False, na=False)]
    if riverside.empty:
        shutil.copy2(legacy_boundary, west_boundary)
        if legacy_context.exists():
            shutil.copy2(legacy_context, west_context)
        print("⚠ west_harlem: no Riverside Park polygon found; kept legacy boundary")
        return

    refined = gpd.overlay(legacy, riverside, how="intersection")
    if refined.empty:
        shutil.copy2(legacy_boundary, west_boundary)
        if legacy_context.exists():
            shutil.copy2(legacy_context, west_context)
        print("⚠ west_harlem: Riverside Park did not intersect legacy sketch; kept legacy boundary")
        return

    geom = drop_sliver_polygons(unary_union(refined.geometry))
    acres = gpd.GeoDataFrame(geometry=[geom], crs="EPSG:4326").to_crs("EPSG:2263").geometry.area.iloc[0] / 4046.86
    legacy_props = legacy.drop(columns="geometry").iloc[0].to_dict()
    park_ids = ",".join(sorted({str(v) for v in refined["gispropnum"].dropna().unique()}))
    feature = {
        **legacy_props,
        "site_id": "west_harlem",
        "area_acres": round(float(acres), 2),
        "grant_acres": legacy_props.get("area_acres", SITES["west_harlem"]["acres"]),
        "source": f"RPC restoration sketch ∩ NYC Parks Riverside ({park_ids})",
        "note": "Boundary aligned to NYC Parks Riverside footprint within the RPC restoration corridor.",
    }
    gpd.GeoDataFrame([feature], geometry=[geom], crs="EPSG:4326").to_file(west_boundary, driver="GeoJSON")
    if legacy_context.exists():
        shutil.copy2(legacy_context, west_context)
    print(f"✓ west_harlem: {west_boundary.name} ({feature['area_acres']} ac · {park_ids})")


def main() -> None:
    BOUNDARY.mkdir(parents=True, exist_ok=True)

    legacy_boundary = BOUNDARY / "project_boundary.geojson"
    legacy_context = BOUNDARY / "site_context.geojson"
    west_boundary = BOUNDARY / SITES["west_harlem"]["boundary"]
    west_context = BOUNDARY / SITES["west_harlem"]["context"]

    parks = gpd.read_file(PARKS_URL).to_crs("EPSG:4326")
    build_west_harlem_boundary(parks, legacy_boundary, legacy_context, west_boundary, west_context)

    for site_id, park_name in PARK_MATCH.items():
        subset = parks[parks["signname"].str.fullmatch(park_name, case=False, na=False)]
        if subset.empty:
            raise SystemExit(f"No NYC Parks polygon found for {park_name!r}")
        geom = unary_union(subset.geometry)
        gdf = gpd.GeoDataFrame(
            [
                {
                    "name": park_name,
                    "site_id": site_id,
                    "area_acres": float(SITES[site_id]["acres"]),
                    "source": "NYC Parks Properties (enfh-gkve)",
                }
            ],
            geometry=[geom],
            crs="EPSG:4326",
        )
        out = BOUNDARY / SITES[site_id]["boundary"]
        gdf.to_file(out, driver="GeoJSON")
        write_context(site_id, park_name, float(SITES[site_id]["acres"]))
        print(f"✓ {site_id}: {out.name}")


if __name__ == "__main__":
    main()
