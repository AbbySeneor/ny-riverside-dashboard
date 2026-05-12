"""
07_compute_scorecard.py — assemble the 8-metric NAC FMF Rapid Site Assessment.

Reads:
  out/canopy_trajectory.json  (from 03)
  out/_slope_buckets.json     (from 04)
  out/lst_zones.json          (from 05)
  out/_invasive_proxy.json    (from 06)
  out/trees_2021.geojson      (from 02)

Writes:
  out/scorecard.json
  out/tree_summary.json
  out/ecosystem_services.json
"""
import json
from pathlib import Path
import geopandas as gpd
from shapely.geometry import shape
from config import SITE_OUT, OUTPUTS, ITREE_VALUES, NAC_THRESHOLDS, PROJECT_BOUNDARY, SITE_ACRES, SITE_ID


def safe_load(path: Path, default=None):
    try:
        return json.loads(path.read_text())
    except Exception:
        return default


def main():
    canopy_traj = safe_load(OUTPUTS["canopy_traj"], {"epochs": []})
    slope = safe_load(SITE_OUT / "_slope_buckets.json", {})
    lst = safe_load(OUTPUTS["lst_zones"], {})
    invasive = safe_load(SITE_OUT / "_invasive_proxy.json", {"invasive_pct_proxy": None})

    # === Tree counts and height stats ===
    tree_summary = {"count": 0, "mean_height_m": None, "max_height_m": None}
    if OUTPUTS["trees"].exists():
        try:
            trees = gpd.read_file(OUTPUTS["trees"])
            tree_summary["count"] = len(trees)
            # Look for height columns in TNC schema
            height_col = None
            for preferred in ("height_m", "h_m", "tree_height"):
                if preferred in trees.columns:
                    height_col = preferred
                    break
            if height_col is None:
                height_col = next(
                    (c for c in trees.columns if c.lower() == "height"),
                    None,
                )
            if height_col:
                heights = trees[height_col].astype(float)
                if height_col.lower() == "height":
                    heights = heights * 0.3048
                tree_summary["mean_height_m"] = round(float(heights.mean()), 1)
                tree_summary["max_height_m"] = round(float(heights.max()), 1)
            # Stems per hectare
            site_ha = SITE_ACRES * 0.404685642  # acres → hectares
            tree_summary["stems_per_ha"] = round(len(trees) / site_ha, 0)
        except Exception as e:
            print(f"   Tree summary failed: {e}")

    OUTPUTS["tree_summary"].write_text(json.dumps(tree_summary, indent=2))

    # === Find baseline canopy epoch ===
    baseline = next((e for e in canopy_traj["epochs"]
                      if e.get("phase") == "baseline"), None)
    if not baseline:
        # Fall back to most recent historical
        hist = [e for e in canopy_traj["epochs"] if e.get("year", 0) <= 2026]
        baseline = hist[-1] if hist else {"canopy_pct": None}

    target_y3 = next((e for e in canopy_traj["epochs"]
                       if e.get("year") == 2029), None)

    # === Compose scorecard ===
    scorecard = {
        "site": f"{SITE_ID} · {SITE_ACRES} ac",
        "computed_at_utc": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "framework": "NAC Forest Management Framework — Rapid Site Assessment compatible",
        "metrics": [
            {
                "metric": "Canopy cover",
                "domain": "ecology",
                "unit": "%",
                "baseline": baseline.get("canopy_pct"),
                "target":   (target_y3 or {}).get("canopy_pct"),
                "max":      100,
                "inverse":  False,
                "source":   baseline.get("source", "TNC 2021 LiDAR + S2 update"),
            },
            {
                "metric": "Invasive dominance (proxy)",
                "domain": "ecology",
                "unit": "%",
                "baseline": invasive.get("invasive_pct_proxy"),
                "target":   NAC_THRESHOLDS["invasive_low_pct"],
                "max":      100,
                "inverse":  True,
                "source":   "Sentinel-2 NDVI phenology proxy",
            },
            {
                "metric": "Tree count (LiDAR-detected)",
                "domain": "ecology",
                "unit": "trees",
                "baseline": tree_summary.get("count"),
                "target":   None,
                "max":      None,
                "inverse":  False,
                "source":   "TNC/UVM 2021",
            },
            {
                "metric": "Stems per hectare",
                "domain": "ecology",
                "unit": "stems/ha",
                "baseline": tree_summary.get("stems_per_ha"),
                "target":   NAC_THRESHOLDS["stems_target_per_ha"],
                "max":      400,
                "inverse":  False,
                "source":   "TNC 2021 / area",
            },
            {
                "metric": "Mean tree height",
                "domain": "physical",
                "unit": "m",
                "baseline": tree_summary.get("mean_height_m"),
                "target":   None,
                "source":   "TNC 2021 LiDAR",
            },
            {
                "metric": "Site mean slope",
                "domain": "physical",
                "unit": "°",
                "baseline": slope.get("mean"),
                "target":   None,
                "source":   slope.get("dem_source") or "DEM-derived slope",
            },
            {
                "metric": "Steep zones (>20°)",
                "domain": "physical",
                "unit": "% of site",
                "baseline": (slope.get("20_30", 0) + slope.get("gt_30", 0)) if slope else None,
                "target":   None,
                "source":   f"{slope.get('dem_source') or 'DEM'}, derived slope",
            },
            {
                "metric": "Cooling vs Riverside Drive",
                "domain": "climate",
                "unit": "°F",
                "baseline": lst.get("cooling_vs_street_F"),
                "target":   6.0,
                "max":      8,
                "inverse":  False,
                "source":   "Landsat 8/9 ST_B10 July composite",
            },
            {
                "metric": "Cooling vs Henry Hudson Parkway",
                "domain": "climate",
                "unit": "°F",
                "baseline": lst.get("cooling_vs_pkwy_F"),
                "target":   None,
                "source":   "Landsat 8/9 ST_B10 July composite",
            },
        ],
    }

    OUTPUTS["scorecard"].write_text(json.dumps(scorecard, indent=2))
    print(f"✓ Scorecard → {OUTPUTS['scorecard'].relative_to(SITE_OUT.parent)}")

    # === Ecosystem services valuation ===
    canopy_pct = baseline.get("canopy_pct") or 0
    canopy_acres = SITE_ACRES * canopy_pct / 100
    services = {
        "canopy_acres": round(canopy_acres, 2),
        "stormwater": {
            "gallons_per_year": round(canopy_acres * ITREE_VALUES["stormwater_gal_per_canopy_acre_yr"]),
            "usd_per_year":      round(canopy_acres * ITREE_VALUES["stormwater_gal_per_canopy_acre_yr"]
                                       / 1000 * ITREE_VALUES["stormwater_dollar_per_kgal"]),
        },
        "carbon_sequestration": {
            "tC_per_year":   round(canopy_acres * ITREE_VALUES["carbon_seq_tC_per_canopy_acre_yr"], 2),
            "tCO2e_per_year": round(canopy_acres * ITREE_VALUES["carbon_seq_tC_per_canopy_acre_yr"] * 3.67, 2),
            "usd_per_year":   round(canopy_acres * ITREE_VALUES["carbon_seq_tC_per_canopy_acre_yr"] * 3.67
                                    * ITREE_VALUES["carbon_dollar_per_tCO2e"]),
        },
        "air_pollution_removal": {
            "lb_per_year":  round(canopy_acres * ITREE_VALUES["air_pollution_lb_per_canopy_acre_yr"]),
            "usd_per_year": round(canopy_acres * ITREE_VALUES["air_pollution_lb_per_canopy_acre_yr"]
                                  * ITREE_VALUES["air_pollution_dollar_per_lb"]),
        },
        "energy_savings": {
            "kwh_per_year": round(canopy_acres * ITREE_VALUES["energy_kwh_per_canopy_acre_yr"]),
            "usd_per_year": round(canopy_acres * ITREE_VALUES["energy_kwh_per_canopy_acre_yr"]
                                  * ITREE_VALUES["energy_dollar_per_kwh"]),
        },
        "compensatory_value_total_usd":
            round(tree_summary.get("count", 0) * ITREE_VALUES["compensatory_dollar_per_tree"]),
        "method": "i-Tree Eco per-canopy-acre (USFS-NRS RB-117) × computed canopy area",
        "monetary_year": 2024,
    }
    services["total_annual_usd"] = sum(
        v.get("usd_per_year", 0) for v in services.values() if isinstance(v, dict)
    )
    OUTPUTS["ecosystem"].write_text(json.dumps(services, indent=2))
    print(f"✓ Ecosystem services → {OUTPUTS['ecosystem'].relative_to(SITE_OUT.parent)}")

    # === Print human summary ===
    print("\n" + "=" * 60)
    print(f"  {SITE_ID.upper()} · BASELINE 2026")
    print("=" * 60)
    for m in scorecard["metrics"]:
        b = m.get("baseline")
        t = m.get("target")
        line = f"  {m['metric']:<35s} {str(b)+m['unit']:>12s}"
        if t is not None:
            line += f"  →  {t}{m['unit']}"
        print(line)
    print("=" * 60)
    print(f"  Annual ecosystem value: ${services['total_annual_usd']:,}")
    print(f"  Compensatory value:     ${services['compensatory_value_total_usd']:,}")
    print("=" * 60)


if __name__ == "__main__":
    main()
