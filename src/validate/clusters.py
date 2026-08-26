"""Group validation sites into spatially independent clusters.

WHY THIS EXISTS
    Leave-one-site-out cross-validation looks rigorous and is not, when sites are
    near-neighbours. Munsar, Mansar and Kandri lie within ~3 km of each other - the
    same hillside, the same lithology, very likely the same orebody. Training on one
    and testing on another measures nothing except spatial autocorrelation, and would
    hand back a flattering, meaningless score.

    Grouping by distance and holding out whole clusters gives fewer folds but honest
    ones. Reporting 5 real folds beats reporting 9 fake ones.

    python -m src.validate.clusters
"""

from __future__ import annotations

import argparse
import json

import geopandas as gpd
import numpy as np
from scipy.cluster.hierarchy import fcluster, linkage
from scipy.spatial.distance import pdist

from src.config import ROOT, cfg

# Sites closer than this are treated as one geological neighbourhood.
CLUSTER_DISTANCE_M = 8000


def assign_clusters(gdf: gpd.GeoDataFrame, distance_m: int = CLUSTER_DISTANCE_M) -> gpd.GeoDataFrame:
    """Single-linkage clustering on projected distance."""
    crs = cfg()["project"]["crs"]
    projected = gdf.to_crs(crs)
    coords = np.column_stack([projected.geometry.x, projected.geometry.y])

    if len(coords) == 1:
        labels = np.array([1])
    else:
        # Single linkage: chains sites together transitively, which is what we want -
        # A near B near C should be one neighbourhood even if A and C are further apart.
        labels = fcluster(linkage(pdist(coords), method="single"), t=distance_m, criterion="distance")

    out = gdf.copy()
    out["cluster_id"] = labels
    # Name each cluster after its alphabetically-first member, for readable fold names.
    names = out.groupby("cluster_id")["name"].apply(lambda s: sorted(s)[0].split()[0].lower())
    out["cluster"] = out["cluster_id"].map(names)
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--distance", type=int, default=CLUSTER_DISTANCE_M)
    parser.add_argument("--out", default="data/validation/site_clusters.geojson")
    args = parser.parse_args()

    conf = cfg()["validation"]
    src = ROOT / conf["dir"] / conf["occurrences_file"]
    gdf = gpd.read_file(src)

    clustered = assign_clusters(gdf, args.distance)

    n_sites = len(clustered)
    n_clusters = clustered["cluster"].nunique()
    print(f"{n_sites} sites -> {n_clusters} spatially independent clusters "
          f"(linkage distance {args.distance / 1000:g} km)\n")

    for cluster, group in clustered.groupby("cluster"):
        members = ", ".join(sorted(group["name"]))
        print(f"  {cluster:<12} n={len(group)}  {members}")

    print(f"\nCross-validation will run {n_clusters} folds, not {n_sites}.")
    if n_clusters < 5:
        print("WARNING: fewer than 5 folds. Confidence intervals will be very wide.")

    dest = ROOT / args.out
    clustered.to_file(dest, driver="GeoJSON")
    print(f"\nwrote {dest.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
