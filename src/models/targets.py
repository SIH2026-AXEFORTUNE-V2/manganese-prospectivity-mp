"""Turn the prospectivity raster into a ranked list of exploration targets.

A per-pixel score map is not actionable. What a planner needs is a short list of
discrete, ranked polygons with an area and a centroid - something that fits in a
dashboard table and can be handed to a field team.

WHAT IS EXCLUDED, AND WHY
    Known workings are removed before ranking. Rediscovering Bharveli is not a
    result, and leaving it at rank 1 would make the whole list look impressive while
    saying nothing. Every target here is ground that is NOT already mined.

    python -m src.models.targets --top 25
"""

from __future__ import annotations

import argparse

import geopandas as gpd
import numpy as np
import pandas as pd
import rasterio
from rasterio.features import shapes
from scipy import ndimage
from shapely.geometry import shape

from src.config import ROOT, cfg

VAL = ROOT / "data" / "validation"

# A target smaller than this is noise at 20 m resolution, not a prospect.
MIN_AREA_HA = 25.0
# Distance from a known mine within which a target is considered "already known".
KNOWN_BUFFER_M = 2500


def load_scores(path, band: int = 3) -> tuple[np.ndarray, dict]:
    with rasterio.open(path) as src:
        arr = src.read(band).astype("float32")
        meta = {"transform": src.transform, "crs": src.crs, "shape": arr.shape}
    return arr, meta


def smooth_scores(arr: np.ndarray, radius_px: int) -> np.ndarray:
    """Focal mean over a disc, ignoring NaN.

    Prospectivity is a property of ground, not of individual pixels. The raw fused
    score is speckly: thresholding it directly gave 13,000 components of which only
    three were larger than 25 ha. Smoothing first turns scattered high pixels into
    coherent regions, which is both what a geologist means by a target and what makes
    the polygons usable.
    """
    if radius_px <= 0:
        return arr

    valid = np.isfinite(arr).astype("float32")
    filled = np.where(np.isfinite(arr), arr, 0.0).astype("float32")

    size = radius_px * 2 + 1
    num = ndimage.uniform_filter(filled, size=size, mode="nearest")
    den = ndimage.uniform_filter(valid, size=size, mode="nearest")

    out = np.divide(num, den, out=np.full_like(num, np.nan), where=den > 0.25)
    # Never invent data where there was none.
    return np.where(np.isfinite(arr), out, np.nan)


def threshold_mask(arr: np.ndarray, percentile: float) -> np.ndarray:
    finite = arr[np.isfinite(arr)]
    if finite.size == 0:
        raise ValueError("score raster is entirely non-finite")
    cutoff = np.percentile(finite, percentile)
    print(f"  top {100 - percentile:g}% cutoff = {cutoff:.4f}")
    return np.isfinite(arr) & (arr >= cutoff)


def polygonise(
    mask: np.ndarray, arr: np.ndarray, meta: dict, min_pixels: int
) -> gpd.GeoDataFrame:
    """Connected high-score regions -> polygons with summary statistics.

    Size-filters BEFORE polygonising. A percentile threshold over 58 million pixels
    fragments into ~200k connected components, almost all of them one- or two-pixel
    speckle; polygonising every one of them takes hours and then throws the results
    away at the area filter. Removing speckle first turns that into a few hundred
    real candidates.
    """
    # Morphological opening removes isolated pixels and hairline connections that
    # would otherwise weld separate prospects into one sprawling blob.
    cleaned = ndimage.binary_opening(mask, structure=np.ones((3, 3)))

    labelled, n = ndimage.label(cleaned)
    print(f"  {n} connected components after speckle removal")
    if n == 0:
        return gpd.GeoDataFrame(columns=["geometry"], crs=meta["crs"])

    counts = np.bincount(labelled.ravel())
    keep_labels = np.flatnonzero(counts >= min_pixels)
    keep_labels = keep_labels[keep_labels != 0]
    print(f"  {len(keep_labels)} component(s) >= {min_pixels} px")
    if len(keep_labels) == 0:
        return gpd.GeoDataFrame(columns=["geometry"], crs=meta["crs"])

    big = np.isin(labelled, keep_labels)
    labelled_big = np.where(big, labelled, 0).astype("int32")

    # Per-label statistics in one pass, rather than a full-array scan per component.
    safe = np.where(np.isfinite(arr), arr, 0.0)
    sums = ndimage.sum_labels(safe, labelled_big, index=keep_labels)
    maxs = ndimage.maximum(safe, labelled_big, index=keep_labels)
    npix = counts[keep_labels]
    stats = {
        int(lab): (float(s / c), float(m), int(c))
        for lab, s, m, c in zip(keep_labels, sums, maxs, npix)
    }

    records = []
    for geom, value in shapes(labelled_big, mask=big, transform=meta["transform"]):
        label = int(value)
        if label == 0 or label not in stats:
            continue
        poly = shape(geom)
        mean, mx, count = stats[label]
        records.append(
            {
                "geometry": poly,
                "label": label,
                "area_ha": poly.area / 10_000.0,
                "score_mean": mean,
                "score_max": mx,
                "n_pixels": count,
            }
        )

    gdf = gpd.GeoDataFrame(records, crs=meta["crs"])
    if gdf.empty:
        return gdf

    # shapes() can emit several rings per label; dissolve back to one row per target.
    gdf = gdf.dissolve(
        by="label", aggfunc={"area_ha": "sum", "score_mean": "first",
                             "score_max": "first", "n_pixels": "first"}
    ).reset_index(drop=True)
    return gdf


def drop_known(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Remove targets sitting on ground that is already a working mine."""
    known = gpd.read_file(VAL / "known_mn_occurrences.geojson").to_crs(gdf.crs)
    exclusion = known.geometry.buffer(KNOWN_BUFFER_M).union_all()

    before = len(gdf)
    keep = gdf[~gdf.geometry.intersects(exclusion)].copy()
    print(f"  {before - len(keep)} target(s) dropped as already-known workings")
    return keep


def flag_negative_overlap(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Mark targets that coincide with a known non-manganese mine.

    Not dropped - flagged. A target landing on the Kamptee coalfield is a signal
    about the model, and hiding it would hide the diagnostic.
    """
    path = VAL / "negative_control_mines.geojson"
    if not path.exists():
        gdf["near_non_mn_mine"] = False
        return gdf

    neg = gpd.read_file(path).to_crs(gdf.crs)
    zone = neg.geometry.buffer(KNOWN_BUFFER_M).union_all()
    gdf["near_non_mn_mine"] = gdf.geometry.intersects(zone)
    n = int(gdf["near_non_mn_mine"].sum())
    if n:
        print(f"  WARNING: {n} target(s) coincide with coal/copper/sand mines - flagged")
    return gdf


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raster", default="data/processed/prospectivity_belt_sausar.tif")
    parser.add_argument("--band", type=int, default=3, help="1=signature 2=anomaly 3=fused")
    parser.add_argument("--percentile", type=float, default=98.0)
    parser.add_argument("--top", type=int, default=25)
    parser.add_argument("--min-area-ha", type=float, default=MIN_AREA_HA)
    parser.add_argument("--smooth", type=int, default=20,
                        help="focal-mean radius in pixels (20m each); 0 disables")
    parser.add_argument("--out", default="data/processed/targets.geojson")
    args = parser.parse_args()

    path = ROOT / args.raster
    if not path.exists():
        print(f"ERROR: {args.raster} not found. Run: python -m src.models.predict")
        return 1

    print(f"Ranking targets from {args.raster} band {args.band}")
    arr, meta = load_scores(path, args.band)

    if args.smooth:
        print(f"  smoothing scores with a {args.smooth}px ({args.smooth*20}m) focal mean")
        arr = smooth_scores(arr, args.smooth)

    mask = threshold_mask(arr, args.percentile)

    # Convert the area floor to a pixel count so it can be applied before polygonising.
    px_area_m2 = abs(meta["transform"].a * meta["transform"].e)
    min_pixels = int(args.min_area_ha * 10_000 / px_area_m2)

    gdf = polygonise(mask, arr, meta, min_pixels)
    if gdf.empty:
        print("No targets survived the size filter - lower --min-area-ha or --percentile")
        return 1

    gdf = gdf[gdf["area_ha"] >= args.min_area_ha]
    print(f"  {len(gdf)} target(s) >= {args.min_area_ha:g} ha")

    gdf = drop_known(gdf)
    gdf = flag_negative_overlap(gdf)

    gdf = gdf.sort_values("score_mean", ascending=False).head(args.top).reset_index(drop=True)
    gdf.insert(0, "rank", gdf.index + 1)

    centroids = gdf.geometry.centroid.to_crs("EPSG:4326")
    gdf["lon"] = centroids.x.round(5)
    gdf["lat"] = centroids.y.round(5)

    dest = ROOT / args.out
    dest.parent.mkdir(parents=True, exist_ok=True)
    gdf.to_file(dest, driver="GeoJSON")

    print(f"\nTop {len(gdf)} exploration targets:\n")
    table = gdf[["rank", "lat", "lon", "area_ha", "score_mean", "near_non_mn_mine"]].copy()
    table["area_ha"] = table["area_ha"].round(1)
    table["score_mean"] = table["score_mean"].round(4)
    print(table.to_string(index=False))
    print(f"\nwrote {dest.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
