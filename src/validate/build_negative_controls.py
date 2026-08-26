"""Build the negative-control set: mines that are NOT manganese.

WHY THIS IS THE CREDIBILITY TEST
    A model trained on ground around manganese mines can succeed for the wrong
    reason. If it has actually learned "excavated ground" rather than "manganese
    geology", it will score every coal pit and copper mine in the state just as
    highly - and a prospectivity map that flags the Kamptee coalfield is worthless.

    These sites are commodity-labelled by an external source and never enter
    training. At scoring time they answer one question: did the model learn the
    commodity, or just the hole?

Source: the OSM pull already on disk (data/interim/osm_mines_raw.json), filtered to
quarries with an explicit non-manganese `resource` tag.

    python -m src.validate.build_negative_controls
"""

from __future__ import annotations

import argparse
import json

import geopandas as gpd
from shapely.geometry import Point

from src.config import ROOT, cfg

# Commodities that are definitively not the target. Anything without an explicit
# resource tag is skipped - an untagged quarry might be manganese for all we know,
# and a false negative control is worse than none.
NON_MN_RESOURCES = {"coal", "copper", "sand", "limestone", "iron", "bauxite", "stone", "gravel"}

RAW = "data/interim/osm_mines_raw.json"


def load_candidates() -> list[dict]:
    path = ROOT / RAW
    if not path.exists():
        raise FileNotFoundError(
            f"{RAW} not found. Run the Overpass pull first "
            "(see docs/02-modelling-plan.md step 1)."
        )
    elements = json.loads(path.read_text(encoding="utf-8"))

    out = []
    for el in elements:
        tags = el.get("tags", {})
        resource = (tags.get("resource") or "").strip().lower()
        if resource not in NON_MN_RESOURCES:
            continue
        lat = el.get("lat") or (el.get("center") or {}).get("lat")
        lon = el.get("lon") or (el.get("center") or {}).get("lon")
        if lat is None or lon is None:
            continue
        out.append(
            {
                "name": tags.get("name") or f"unnamed {resource} quarry",
                "commodity": resource,
                "operator": tags.get("operator", ""),
                "source": f"OSM landuse=quarry resource={resource}",
                "lon": float(lon),
                "lat": float(lat),
            }
        )
    return out


def build(dry_run: bool = False) -> gpd.GeoDataFrame:
    candidates = load_candidates()
    if not candidates:
        raise RuntimeError("No tagged non-manganese quarries found in the OSM pull.")

    gdf = gpd.GeoDataFrame(
        candidates,
        geometry=[Point(c["lon"], c["lat"]) for c in candidates],
        crs="EPSG:4326",
    )

    # Same halo geometry as the positives, so scores are directly comparable.
    conf = cfg()["validation"]
    crs = cfg()["project"]["crs"]
    projected = gdf.to_crs(crs)
    halos = projected.geometry.buffer(conf["halo_outer_m"]).difference(
        projected.geometry.buffer(conf["halo_inner_m"])
    )

    by_commodity = gdf["commodity"].value_counts().to_dict()
    print(f"Negative controls: {len(gdf)} sites")
    for commodity, n in sorted(by_commodity.items(), key=lambda kv: -kv[1]):
        print(f"  {commodity:<12} {n}")
    print()
    for _, row in gdf.iterrows():
        print(f"  {row['name'][:38]:<40} {row['commodity']:<10} {row.geometry.y:.4f},{row.geometry.x:.4f}")

    if dry_run:
        print("\n[dry-run] nothing written")
        return gdf

    out_dir = ROOT / conf["dir"]
    out_dir.mkdir(parents=True, exist_ok=True)

    points_path = out_dir / "negative_control_mines.geojson"
    gdf.to_file(points_path, driver="GeoJSON")

    halo_gdf = gpd.GeoDataFrame(
        projected.drop(columns="geometry"), geometry=halos, crs=crs
    ).to_crs("EPSG:4326")
    halo_path = out_dir / "negative_control_halos.geojson"
    halo_gdf.to_file(halo_path, driver="GeoJSON")

    print(f"\nwrote {points_path.relative_to(ROOT)}")
    print(f"wrote {halo_path.relative_to(ROOT)}")
    print("\nHELD OUT - scoring only. Never read by training code.")
    return gdf


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    build(dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
