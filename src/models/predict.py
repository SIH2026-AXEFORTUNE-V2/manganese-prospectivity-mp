"""Generate the prospectivity map.

Fits Model B on all nine halos and Model A on the landscape, then scores every pixel
window by window and writes a GeoTIFF.

WHY WINDOWED
    The belt is 5660 x 13492 pixels over ~68 bands. Holding that in memory would need
    roughly 20 GB. Each window is read, scored and written, so peak memory stays in the
    hundreds of megabytes.

RANK NORMALISATION ACROSS WINDOWS
    Scores are rank-normalised, and ranks are only meaningful within one population.
    Normalising each window separately would make every window's brightest pixel score
    1.0, producing visible tile seams and a meaningless map. So a reference sample is
    drawn across the whole AOI first, and every window is normalised against that fixed
    distribution.

    python -m src.models.predict --aoi belt_sausar
"""

from __future__ import annotations

import argparse
import json

import geopandas as gpd
import numpy as np
import pandas as pd
import rasterio

from src.config import ROOT, cfg
from src.features.stack import FeatureStack, prune_correlated
from src.models.anomaly import AnomalyModel, fuse_scores
from src.models.signature import SignatureModel

VAL = ROOT / "data" / "validation"


def _reference_quantiles(values: np.ndarray, n: int = 2048) -> np.ndarray:
    """Fixed quantile grid used to rank-normalise every window identically."""
    finite = values[np.isfinite(values)]
    if finite.size == 0:
        raise ValueError("reference sample is entirely non-finite")
    return np.quantile(finite, np.linspace(0, 1, n))


def _apply_reference(values: np.ndarray, grid: np.ndarray) -> np.ndarray:
    """Map raw scores onto [0, 1] using a fixed reference distribution."""
    out = np.full(values.shape, np.nan, dtype="float32")
    finite = np.isfinite(values)
    if finite.any():
        idx = np.searchsorted(grid, values[finite], side="left")
        out[finite] = idx / max(len(grid) - 1, 1)
    return out


def build_models(fs: FeatureStack, per_polygon: int, n_background: int, seed: int = 26009):
    halos = gpd.read_file(VAL / "validation_halos.geojson")
    clusters = gpd.read_file(VAL / "site_clusters.geojson")[["name", "cluster"]]
    halos = halos.merge(clusters, on="name", how="left")
    positives = fs.sample_polygons(halos, max_per_polygon=per_polygon, seed=seed)

    bg_points = gpd.read_file(VAL / "background_points.geojson")
    if len(bg_points) > n_background:
        bg_points = bg_points.sample(n_background, random_state=seed)
    background = fs.sample_points(bg_points)

    pool = pd.concat([positives, background], ignore_index=True)
    usable = [b for b in fs.band_names if pool[b].notna().mean() >= 0.01]
    features, dropped = prune_correlated(pool, usable, 0.95)

    print(f"  {len(fs.band_names)} bands -> {len(usable)} usable -> {len(features)} after pruning")
    print(f"  positives {len(positives)} px, background {len(background)} px")

    model_b = SignatureModel().fit(positives, features, background=background)
    model_a = AnomalyModel().fit(background, features)

    # Reference distributions, from the background sample, for seam-free normalisation.
    raw_b = _raw_signature(model_b, background, features)
    raw_a = _raw_anomaly(model_a, background, features)
    ref = {
        "b": _reference_quantiles(raw_b),
        "a": _reference_quantiles(raw_a),
    }
    return model_b, model_a, features, ref


def _raw_signature(model: SignatureModel, frame: pd.DataFrame, features: list[str]) -> np.ndarray:
    """Un-normalised fused signature score (mean of the three z-free scorers)."""
    raw = frame[features].astype("float64").to_numpy()
    valid = np.isfinite(raw).all(axis=1)
    out = np.full(len(frame), np.nan)
    if valid.any():
        X = model.scaler_.transform(raw[valid])
        maha = -model._mahalanobis(X)
        svm = model.svm_.decision_function(X)
        sam = -model._sam(raw[valid])
        # Standardise each scorer before averaging - they live on different scales.
        parts = []
        for arr in (maha, svm, sam):
            sd = arr.std() or 1.0
            parts.append((arr - arr.mean()) / sd)
        out[valid] = np.mean(parts, axis=0)
    return out


def _raw_anomaly(model: AnomalyModel, frame: pd.DataFrame, features: list[str]) -> np.ndarray:
    raw = frame[features].astype("float64").to_numpy()
    valid = np.isfinite(raw).all(axis=1)
    out = np.full(len(frame), np.nan)
    if valid.any():
        Xs = model.scaler_.transform(raw[valid])
        scores = model.pca_.transform(Xs)
        delta = scores - model.mean_
        maha = (delta**2 * model.inv_var_).sum(axis=1)
        iso = -model.iforest_.score_samples(Xs)
        parts = []
        for arr in (maha, iso):
            sd = arr.std() or 1.0
            parts.append((arr - arr.mean()) / sd)
        out[valid] = np.mean(parts, axis=0)
    return out


def predict(aoi: str, window_size: int, per_polygon: int, n_background: int, out_name: str) -> int:
    fs = FeatureStack(aoi=aoi)
    print(f"Feature stack: {fs}\n")

    print("Fitting models:")
    model_b, model_a, features, ref = build_models(fs, per_polygon, n_background)

    dest = ROOT / "data" / "processed" / out_name
    dest.parent.mkdir(parents=True, exist_ok=True)

    profile = {
        "driver": "GTiff", "height": fs.height, "width": fs.width,
        "count": 3, "dtype": "float32", "crs": fs.crs, "transform": fs.transform,
        "nodata": np.nan, "compress": "deflate", "tiled": True,
        "blockxsize": 512, "blockysize": 512, "BIGTIFF": "YES",
    }

    windows = list(fs.windows(window_size))
    print(f"\nScoring {len(windows)} windows of {window_size}px:")

    with rasterio.open(dest, "w", **profile) as dst:
        dst.descriptions = ("signature_B", "anomaly_A", "fused")
        for n, window in enumerate(windows, 1):
            block = fs.read_window(window)
            h, w = window.height, window.width
            flat = pd.DataFrame(
                block.reshape(len(fs.band_names), -1).T, columns=fs.band_names
            )

            raw_b = _raw_signature(model_b, flat, features)
            raw_a = _raw_anomaly(model_a, flat, features)
            score_b = _apply_reference(raw_b, ref["b"])
            score_a = _apply_reference(raw_a, ref["a"])
            fused = fuse_scores(pd.Series(score_b), pd.Series(score_a)).to_numpy()

            dst.write(score_b.reshape(h, w).astype("float32"), 1, window=window)
            dst.write(score_a.reshape(h, w).astype("float32"), 2, window=window)
            dst.write(fused.reshape(h, w).astype("float32"), 3, window=window)

            if n % 10 == 0 or n == len(windows):
                print(f"  {n}/{len(windows)} windows", flush=True)

    print(f"\nwrote {dest.relative_to(ROOT)}")
    print("  band 1 = signature (B), band 2 = anomaly (A), band 3 = fused")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="belt_sausar")
    parser.add_argument("--window", type=int, default=1024)
    parser.add_argument("--per-polygon", type=int, default=1500)
    parser.add_argument("--background", type=int, default=8000)
    parser.add_argument("--out", default="prospectivity_belt_sausar.tif")
    args = parser.parse_args()
    return predict(args.aoi, args.window, args.per_polygon, args.background, args.out)


if __name__ == "__main__":
    raise SystemExit(main())
