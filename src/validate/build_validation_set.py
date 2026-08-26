"""Part C - build the blind-validation set.

Nothing produced here may ever be read by training code. The whole point of the
unsupervised design is that known manganese locations are withheld from the model,
then used afterwards to ask: did the model independently rediscover them?

THE CONFOUND THIS MODULE EXISTS TO HANDLE
    An active mine is bare, excavated, disturbed ground. Any anomaly detector will
    flag it - because it is a hole in the earth, not because it detected manganese
    geology. Scoring on raw pit polygons produces a beautiful number that means
    nothing.

    So validation happens on a HALO: a ring around each site with the pit itself
    cut out. Scoring on the halo asks whether the model found the geology, which is
    the only question worth asking.

    python -m src.validate.build_validation_set --template   # writes a stub to fill in
    python -m src.validate.build_validation_set --build      # halos + background points
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import geopandas as gpd
import numpy as np
from shapely.geometry import Point

from src.config import ROOT, aoi_bounds, cfg

# District-level anchors for known MOIL / Sausar-belt manganese mines.
#
# THESE ARE APPROXIMATE AND UNVERIFIED. They exist so the template has the right
# shape and roughly the right place on a map - not as ground truth. Every entry
# must be checked against MOIL public disclosures, IBM tenement data, Bhuvan or
# high-resolution imagery, and its `verified` flag set to true, before it can be
# used to score anything.
TEMPLATE_SITES = [
    {"name": "Balaghat",    "district": "Balaghat",   "state": "MP", "lon": 80.19, "lat": 21.81},
    {"name": "Ukwa",        "district": "Balaghat",   "state": "MP", "lon": 80.52, "lat": 21.95},
    {"name": "Tirodi",      "district": "Balaghat",   "state": "MP", "lon": 79.72, "lat": 21.68},
    {"name": "Sitapatore",  "district": "Chhindwara", "state": "MP", "lon": 78.95, "lat": 22.05},
    {"name": "Munsar",      "district": "Nagpur",     "state": "MH", "lon": 79.22, "lat": 21.42},
    {"name": "Beldongri",   "district": "Nagpur",     "state": "MH", "lon": 79.30, "lat": 21.45},
    {"name": "Kandri",      "district": "Nagpur",     "state": "MH", "lon": 79.15, "lat": 21.38},
    {"name": "Mansar",      "district": "Nagpur",     "state": "MH", "lon": 79.25, "lat": 21.40},
    {"name": "Chikla",      "district": "Bhandara",   "state": "MH", "lon": 79.95, "lat": 21.32},
    {"name": "Gumgaon",     "district": "Nagpur",     "state": "MH", "lon": 79.12, "lat": 21.35},
]


def validation_dir() -> Path:
    path = ROOT / cfg()["validation"]["dir"]
    path.mkdir(parents=True, exist_ok=True)
    return path


def write_template() -> Path:
    """Emit an editable GeoJSON stub of known occurrences."""
    conf = cfg()["validation"]
    features = [
        {
            "type": "Feature",
            "properties": {
                "name": site["name"],
                "district": site["district"],
                "state": site["state"],
                "commodity": "manganese",
                "operator": "MOIL",
                "source": "TEMPLATE - approximate, unverified",
                "verified": False,
            },
            "geometry": {"type": "Point", "coordinates": [site["lon"], site["lat"]]},
        }
        for site in TEMPLATE_SITES
    ]
    payload = {
        "type": "FeatureCollection",
        "name": "known_mn_occurrences",
        "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3/CRS84"}},
        "_warning": (
            "Coordinates are APPROXIMATE district-level anchors, not ground truth. "
            "Verify each against MOIL disclosures / IBM tenement data / imagery, "
            "correct the coordinates, then set verified=true. "
            "build_validation_set --build refuses to run on unverified sites."
        ),
        "features": features,
    }

    path = validation_dir() / conf["occurrences_file"]
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2)
    print(f"Wrote template: {path.relative_to(ROOT)}")
    print(f"  {len(features)} sites, all verified=false")
    return path


def _load_verified() -> gpd.GeoDataFrame:
    conf = cfg()["validation"]
    path = validation_dir() / conf["occurrences_file"]
    if not path.exists():
        raise FileNotFoundError(
            f"{path.relative_to(ROOT)} not found. Run with --template first."
        )

    gdf = gpd.read_file(path)
    if "verified" not in gdf.columns:
        raise ValueError("occurrences file has no 'verified' column")

    verified = gdf[gdf["verified"].astype(str).str.lower().isin(["true", "1"])]
    if verified.empty:
        raise ValueError(
            f"No verified sites in {path.name}.\n"
            "The template coordinates are approximate anchors, not ground truth.\n"
            "Check each against MOIL/IBM/Bhuvan/imagery, fix the coordinates, then\n"
            "set verified=true. Scoring against unverified points would be meaningless."
        )
    print(f"  {len(verified)} of {len(gdf)} sites verified")
    return verified


def build_halos() -> Path:
    """Ring geometry per site: outer buffer minus inner buffer.

    The inner cut-out removes the excavated pit so the model is scored on
    surrounding geology rather than on bare disturbed ground.
    """
    conf = cfg()["validation"]
    sites = _load_verified()

    # Buffer in metres, so project to the analysis CRS first.
    crs = cfg()["project"]["crs"]
    projected = sites.to_crs(crs)

    outer = projected.geometry.buffer(conf["halo_outer_m"])
    inner = projected.geometry.buffer(conf["halo_inner_m"])
    halos = outer.difference(inner)

    result = gpd.GeoDataFrame(
        projected.drop(columns="geometry").assign(
            halo_inner_m=conf["halo_inner_m"], halo_outer_m=conf["halo_outer_m"]
        ),
        geometry=halos,
        crs=crs,
    ).to_crs("EPSG:4326")

    path = validation_dir() / conf["halos_file"]
    result.to_file(path, driver="GeoJSON")
    print(f"  wrote {len(result)} halos -> {path.relative_to(ROOT)}")
    return path


def build_background_points() -> Path:
    """Random background points for post-hoc ROC, excluding all known sites."""
    conf = cfg()["validation"]
    rng = np.random.default_rng(conf["random_seed"])

    min_lon, min_lat, max_lon, max_lat = aoi_bounds("belt_sausar")
    sites = _load_verified().to_crs(cfg()["project"]["crs"])
    exclusion = sites.geometry.buffer(conf["halo_outer_m"]).union_all()

    n_target = conf["n_background_points"]
    kept: list[Point] = []
    attempts = 0

    while len(kept) < n_target and attempts < n_target * 50:
        batch = 5000
        lons = rng.uniform(min_lon, max_lon, batch)
        lats = rng.uniform(min_lat, max_lat, batch)
        candidates = gpd.GeoSeries(
            [Point(x, y) for x, y in zip(lons, lats)], crs="EPSG:4326"
        ).to_crs(cfg()["project"]["crs"])
        outside = candidates[~candidates.intersects(exclusion)]
        kept.extend(outside.to_crs("EPSG:4326").tolist())
        attempts += batch

    kept = kept[:n_target]
    result = gpd.GeoDataFrame(
        {"point_id": range(len(kept)), "kind": "background"},
        geometry=kept,
        crs="EPSG:4326",
    )

    path = validation_dir() / "background_points.geojson"
    result.to_file(path, driver="GeoJSON")
    print(f"  wrote {len(result)} background points -> {path.relative_to(ROOT)}")
    return path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--template", action="store_true", help="write the editable stub")
    parser.add_argument("--build", action="store_true", help="build halos + background points")
    args = parser.parse_args()

    if args.template:
        write_template()
        print(
            "\nNEXT: verify every coordinate, then set verified=true on each site.\n"
            "      Then re-run with --build."
        )
        return 0

    if args.build:
        print("Building validation geometry")
        try:
            build_halos()
            build_background_points()
        except (ValueError, FileNotFoundError) as exc:
            print(f"\nERROR: {exc}")
            return 1
        print("\nReminder: nothing under data/validation/ may be read by training code.")
        return 0

    parser.print_help()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
