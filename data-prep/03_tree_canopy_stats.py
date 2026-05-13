"""
03_tree_canopy_stats.py — compute real canopy % per LiDAR epoch.

Reads the clipped 2010, 2017, 2021 land cover rasters and counts canopy pixels
inside the project boundary. Writes canopy_trajectory.json.

NYC TNC land cover class codes (2021 product):
    1 = tree canopy
    2 = grass / shrub
    3 = bare ground
    4 = open water
    5 = building
    6 = road
    7 = other impervious
    8 = railroad
"""
import json
from pathlib import Path
import rasterio
import rasterio.mask
import geopandas as gpd
import numpy as np
from config import SITE_OUT, OUTPUTS, PROJECT_BOUNDARY, SITE_ACRES, SITE_ID

CANOPY_CLASS = 1


def canopy_pct(raster_path: Path, boundary_geom) -> dict:
    with rasterio.open(raster_path) as src:
        # Reproject boundary to raster CRS
        boundary_proj = gpd.GeoSeries([boundary_geom], crs="EPSG:4326").to_crs(src.crs)
        out_image, _ = rasterio.mask.mask(src, [boundary_proj.iloc[0]], crop=True)
        valid = out_image > 0
        canopy = (out_image == CANOPY_CLASS) & valid
        total_px = int(valid.sum())
        canopy_px = int(canopy.sum())
        # Approx area: 6-inch resolution = 0.0233 m² per pixel
        if "6in" in raster_path.name or src.res[0] < 0.5:
            px_area_m2 = 0.0233
        else:
            px_area_m2 = src.res[0] * src.res[1]
        return {
            "canopy_pct": round(canopy_px / total_px * 100, 2) if total_px else 0,
            "canopy_m2":  round(canopy_px * px_area_m2, 1),
            "total_m2":   round(total_px * px_area_m2, 1),
            "px_total":   total_px,
            "px_canopy":  canopy_px,
            "source":     raster_path.name,
        }


def main():
    boundary = gpd.read_file(PROJECT_BOUNDARY).geometry.iloc[0]

    epochs = []
    for year, fname in [
        (2017, "landcover_2017_clipped.tif"),
        (2021, "landcover_2021_clipped.tif"),
    ]:
        path = SITE_OUT / "rasters" / fname
        if not path.exists():
            print(f"⚠  {fname} not found — run 02_clip_to_site.py first")
            continue
        print(f"\n→ Computing canopy for {year}...")
        stats = canopy_pct(path, boundary)
        stats["year"] = year
        epochs.append(stats)
        print(f"   {stats['canopy_pct']}% canopy "
              f"({stats['px_canopy']:,}/{stats['px_total']:,} pixels)")

    if not any(e["year"] == 2017 for e in epochs):
        tnc_cc = SITE_OUT / "rasters" / "canopychange_clipped.tif"
        baseline_2021 = next((e for e in epochs if e["year"] == 2021), None)
        if tnc_cc.exists() and baseline_2021:
            print("\n→ Deriving 2017 canopy from TNC 2017→2021 change raster + 2021 baseline...")
            with rasterio.open(tnc_cc) as src:
                boundary_proj = gpd.GeoSeries([boundary], crs="EPSG:4326").to_crs(src.crs)
                arr, _ = rasterio.mask.mask(src, [boundary_proj.iloc[0]], crop=True)
                no_change = int((arr == 1).sum())
                gain = int((arr == 2).sum())
                loss = int((arr == 3).sum())
                site_total = baseline_2021["px_total"]
                canopy_2017_px = no_change + loss
                canopy_2017_pct = canopy_2017_px / site_total * 100 if site_total else 0
                px_area_m2 = baseline_2021["canopy_m2"] / max(baseline_2021["px_canopy"], 1)
                epochs.append({
                    "year": 2017,
                    "canopy_pct": round(canopy_2017_pct, 2),
                    "canopy_m2": round(canopy_2017_px * px_area_m2, 1),
                    "px_canopy": canopy_2017_px,
                    "px_total": site_total,
                    "source": "derived from tnc_canopychange_2017_2021",
                    "loss_2017_2021_px": loss,
                    "gain_2017_2021_px": gain,
                })
                print(f"   2017 canopy: {canopy_2017_pct:.2f}% "
                      f"(loss '17→'21: {loss:,} px, gain: {gain:,} px)")

    # 2010 — derived from canopy change raster (2010→2017)
    cc_path = SITE_OUT / "rasters" / "nyc_canopychange_2010_2017_clipped.tif"
    if cc_path.exists() and len(epochs) >= 1:
        print(f"\n→ Deriving 2010 canopy from change raster + 2017 baseline...")
        with rasterio.open(cc_path) as src:
            boundary_proj = gpd.GeoSeries([boundary], crs="EPSG:4326").to_crs(src.crs)
            arr, _ = rasterio.mask.mask(src, [boundary_proj.iloc[0]], crop=True)
            # Class codes per NYC metadata: 1=no_change, 2=gain, 3=loss
            no_change = (arr == 1).sum()
            gain      = (arr == 2).sum()
            loss      = (arr == 3).sum()
            valid     = (arr > 0).sum()
            # 2010 canopy = no_change + loss (anything that was canopy in 2010)
            # 2017 canopy = no_change + gain
            canopy_2010_px = int(no_change + loss)
            canopy_2017_px = int(no_change + gain)
            total_canopy_universe = int(no_change + loss + gain)
            # We need % relative to total site, not just canopy universe
            site_total = next((e["px_total"] for e in epochs if e["year"] == 2017),
                              int(valid))
            canopy_2010_pct = canopy_2010_px / site_total * 100
            epochs.insert(0, {
                "year": 2010,
                "canopy_pct": round(canopy_2010_pct, 2),
                "canopy_m2": round(canopy_2010_px * 0.0233, 1),
                "px_canopy": canopy_2010_px,
                "px_total": site_total,
                "source": "derived from nyc_canopychange_2010_2017",
                "loss_2010_2017_px": loss,
                "gain_2010_2017_px": gain,
            })
            print(f"   2010 canopy: {canopy_2010_pct:.2f}% "
                  f"(loss '10→'17: {loss:,} px, gain: {gain:,} px)")

    # Sentinel-2 NDVI proxy — year from 06_gee_ndvi output (most recent July)
    s2_path = SITE_OUT / "_s2_canopy_2026.json"
    if s2_path.exists():
        s2 = json.loads(s2_path.read_text())
        s2_year = int(s2.get("year", 2026))
        epochs.append({
            "year": s2_year,
            "canopy_pct": s2["canopy_pct_estimated"],
            "source": s2.get("source") or "Sentinel-2 NDVI > 0.55 threshold, July max",
            "phase": "baseline",
        })

    # === Project ecosystem services for each epoch ===
    from config import ITREE_VALUES
    site_acres = SITE_ACRES
    for e in epochs:
        canopy_acres = site_acres * e["canopy_pct"] / 100
        e["ecosystem"] = {
            "stormwater_gal_yr":   round(canopy_acres * ITREE_VALUES["stormwater_gal_per_canopy_acre_yr"]),
            "stormwater_usd_yr":   round(canopy_acres * ITREE_VALUES["stormwater_gal_per_canopy_acre_yr"]
                                         / 1000 * ITREE_VALUES["stormwater_dollar_per_kgal"]),
            "carbon_seq_tC_yr":    round(canopy_acres * ITREE_VALUES["carbon_seq_tC_per_canopy_acre_yr"], 2),
            "energy_kwh_yr":       round(canopy_acres * ITREE_VALUES["energy_kwh_per_canopy_acre_yr"]),
            "air_pollution_lb_yr": round(canopy_acres * ITREE_VALUES["air_pollution_lb_per_canopy_acre_yr"]),
        }

    # Restoration targets — derived from baseline + NAC FMF "good condition" goal
    if epochs and any(e.get("phase") == "baseline" for e in epochs):
        baseline = next(e for e in epochs if e.get("phase") == "baseline")
        for delta_year, delta_pct in [(2027, 4), (2028, 7), (2029, 10)]:
            target_pct = min(75, baseline["canopy_pct"] + delta_pct)
            canopy_acres = site_acres * target_pct / 100
            epochs.append({
                "year": delta_year,
                "canopy_pct": target_pct,
                "phase": "projected",
                "source": "NAC FMF 'good condition' restoration target",
                "ecosystem": {
                    "stormwater_gal_yr": round(canopy_acres * ITREE_VALUES["stormwater_gal_per_canopy_acre_yr"]),
                    "carbon_seq_tC_yr":  round(canopy_acres * ITREE_VALUES["carbon_seq_tC_per_canopy_acre_yr"], 2),
                },
            })

    epochs.sort(key=lambda x: x["year"])

    OUTPUTS["canopy_traj"].write_text(json.dumps({
        "site": f"{SITE_ID} · {SITE_ACRES} ac",
        "computed_at_utc": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "epochs": epochs,
    }, indent=2))
    print(f"\n✓ Wrote {OUTPUTS['canopy_traj'].relative_to(SITE_OUT.parent)}")
    print(f"\n→ Next: python 04_slope_analysis.py")


if __name__ == "__main__":
    main()
