"""Generate web-ready assets for the dashboard.

THE CONSTRAINT
    prospectivity_belt_sausar.tif is 457 MB at 20 m. A browser cannot load that, and
    an Artifact cannot embed it. So this produces a small, self-contained asset bundle:
    score rasters become colour-mapped PNGs with bounds, vectors are simplified, and
    metrics are flattened to JSON. Target for the whole bundle is well under 15 MB.

WHAT IS DELIBERATELY NOT SIMPLIFIED
    Target centroids and scores stay at full precision. Geometry is simplified for
    drawing; the numbers a geologist would act on are not.

    python -m src.dashboard.build_assets
"""

from __future__ import annotations

import argparse
import base64
import json
from pathlib import Path

import geopandas as gpd
import numpy as np
import rasterio
from rasterio.enums import Resampling

from src.config import ROOT

PROC = ROOT / "data" / "processed"
VAL = ROOT / "data" / "validation"
OUT = ROOT / "dashboard" / "assets"

# Max width for the web overlays. 1600px across a ~270 km belt is ~170 m/px -
# plenty for a browser map, and keeps each PNG in the low hundreds of KB.
WEB_WIDTH = 1400

# Focal-mean radius applied before downsampling, in source pixels (20 m each).
# Deliberately lighter than the radius src.models.targets uses. The map should show
# favourability at full fidelity - drainage, ridge domains, structural grain are all
# real signal - while target polygons need heavier filtering to come out as coherent
# regions rather than fragments. Showing detailed favourability alongside coarser
# delineated zones is standard practice in prospectivity mapping.
SMOOTH_PX = 5


def _colormap(name: str) -> np.ndarray:
    """256x3 uint8 lookup table from matplotlib's perceptually-uniform maps.

    An earlier hand-rolled approximation was a mistake: its green channel saturated
    far too early and its blue channel was non-monotonic, so the ramp collapsed into
    near-binary yellow-against-purple with almost no midtone. Real geological
    structure - drainage networks, ridge-and-valley domains - was being flattened
    into what looked like noise. matplotlib is already a dependency; use it.
    """
    from matplotlib import colormaps

    cmap = colormaps[name]
    return (cmap(np.linspace(0, 1, 256))[:, :3] * 255).astype("uint8")


def nan_aware_downsample(
    path: Path, band: int, target_width: int, smooth_px: int = 0
) -> tuple[np.ndarray, object, object]:
    """Read a band at full resolution and block-reduce with nanmean.

    rasterio's `out_shape` decimation with `Resampling.average` propagates NaN: one
    NaN in a block poisons the whole output cell. On this raster ~24% of pixels are
    NaN, so every output cell touched a NaN and the entire downsample came back empty
    - a fully transparent PNG and a 0-0 m elevation range.

    Reading full-res and reducing with nanmean costs ~300 MB briefly and is correct.
    """
    with rasterio.open(path) as src:
        arr = src.read(band).astype("float32")
        bounds, crs = src.bounds, src.crs

    if smooth_px > 0:
        from scipy import ndimage

        valid = np.isfinite(arr).astype("float32")
        filled = np.where(np.isfinite(arr), arr, 0.0).astype("float32")
        size = smooth_px * 2 + 1
        num = ndimage.uniform_filter(filled, size=size, mode="nearest")
        den = ndimage.uniform_filter(valid, size=size, mode="nearest")
        smoothed = np.divide(num, den, out=np.full_like(num, np.nan), where=den > 0.25)
        arr = np.where(np.isfinite(arr), smoothed, np.nan)

    factor = max(1, int(round(arr.shape[1] / target_width)))
    h = (arr.shape[0] // factor) * factor
    w = (arr.shape[1] // factor) * factor
    arr = arr[:h, :w]

    blocks = arr.reshape(h // factor, factor, w // factor, factor)
    with np.errstate(invalid="ignore"):
        # all-NaN blocks legitimately produce NaN; the warning is noise.
        out = np.nanmean(blocks, axis=(1, 3))
    return out.astype("float32"), bounds, crs


def raster_to_png(band: int, name: str, cmap: str = "inferno") -> dict:
    """Downsample one score band, colour-map it, write RGBA PNG + bounds."""
    from PIL import Image

    src_path = PROC / "prospectivity_belt_sausar.tif"
    # Light smoothing only - see SMOOTH_PX. Enough to suppress single-pixel noise
    # without erasing the drainage and ridge structure the model is actually keying on.
    arr, bounds, crs = nan_aware_downsample(src_path, band, WEB_WIDTH, smooth_px=SMOOTH_PX)
    h = arr.shape[0]

    valid = np.isfinite(arr)
    lut = _colormap(cmap)

    # Palette PNG, not RGBA. The score field is speckly, so full-colour PNG compresses
    # badly - about 2.7 MB each, which is far too heavy to embed three of as data URIs.
    # Index 0 is reserved for transparent and data occupies 1-255, which drops each
    # file to a few hundred KB with no visible loss (the colormap only has 256 steps
    # to begin with).
    idx = np.zeros(arr.shape, dtype="uint8")
    if valid.any():
        # Percentile stretch so the map is readable rather than dominated by outliers.
        lo, hi = np.percentile(arr[valid], [2, 99.5])
        span = max(hi - lo, 1e-6)
        idx[valid] = 1 + np.clip((arr[valid] - lo) / span * 254, 0, 254).astype("uint8")

    palette = np.zeros((256, 3), dtype="uint8")
    palette[1:] = lut[np.linspace(0, 255, 255).astype("uint8")]

    OUT.mkdir(parents=True, exist_ok=True)
    png_path = OUT / f"{name}.png"
    img = Image.fromarray(np.ascontiguousarray(idx), mode="P")
    img.putpalette(palette.flatten().tolist())
    img.info["transparency"] = 0
    img.save(png_path, optimize=True, transparency=0)

    # Web maps need WGS84 corners.
    from pyproj import Transformer

    tf = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
    west, south = tf.transform(bounds.left, bounds.bottom)
    east, north = tf.transform(bounds.right, bounds.top)

    kb = png_path.stat().st_size / 1024
    print(f"  {name}.png  {arr.shape[1]}x{h}  {kb:,.1f} KB  valid={valid.mean()*100:.1f}%")
    return {
        "file": f"{name}.png",
        "bounds": [round(west, 6), round(south, 6), round(east, 6), round(north, 6)],
        "valid_pct": round(float(valid.mean()) * 100, 1),
    }


def terrain_grid(step: int = 8) -> dict:
    """Coarse elevation grid for the 3D view, as a flat array plus dimensions."""
    path = ROOT / "data" / "raw" / "gee" / "TERRAIN_glo30_belt_sausar.tif"
    if not path.exists():
        print("  terrain raster missing - 3D view will fall back to flat")
        return {}

    arr, bounds, crs = nan_aware_downsample(path, 1, WEB_WIDTH // step)
    h, w = arr.shape
    # Fill gaps with the scene median rather than 0 - a 0 m plateau would read as a
    # cliff in the 3D view.
    fill = float(np.nanmedian(arr)) if np.isfinite(arr).any() else 0.0
    arr = np.where(np.isfinite(arr), arr, fill).astype("float32")
    from pyproj import Transformer

    tf = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
    west, south = tf.transform(bounds.left, bounds.bottom)
    east, north = tf.transform(bounds.right, bounds.top)

    print(f"  terrain grid {w}x{h}  range {arr.min():.0f}-{arr.max():.0f} m")
    return {
        "width": w,
        "height": h,
        "bounds": [round(west, 6), round(south, 6), round(east, 6), round(north, 6)],
        "min": float(arr.min()),
        "max": float(arr.max()),
        # Quantised to uint16 to keep the JSON small; decoded in the page.
        "data": base64.b64encode(
            ((arr - arr.min()) / max(arr.max() - arr.min(), 1e-6) * 65535)
            .astype("uint16")
            .tobytes()
        ).decode(),
    }


def vector(path: Path, name: str, tolerance_m: float = 0.0, keep: list[str] | None = None) -> dict:
    if not path.exists():
        print(f"  {name}: MISSING ({path.name})")
        return {"type": "FeatureCollection", "features": []}

    gdf = gpd.read_file(path)
    if tolerance_m and gdf.crs and gdf.crs.is_projected:
        gdf["geometry"] = gdf.geometry.simplify(tolerance_m)
    gdf = gdf.to_crs("EPSG:4326")
    if keep:
        cols = [c for c in keep if c in gdf.columns] + ["geometry"]
        gdf = gdf[cols]

    gj = json.loads(gdf.to_json())
    print(f"  {name}: {len(gdf)} features")
    return gj


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--skip-terrain", action="store_true")
    args = parser.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    bundle: dict = {}

    print("Score overlays:")
    if (PROC / "prospectivity_belt_sausar.tif").exists():
        bundle["layers"] = {
            "fused": raster_to_png(3, "score_fused", "inferno"),
            "signature": raster_to_png(1, "score_signature", "inferno"),
            "anomaly": raster_to_png(2, "score_anomaly", "viridis"),
        }
    else:
        print("  prospectivity raster missing - run src.models.predict")
        bundle["layers"] = {}

    print("\nVectors:")
    bundle["mines"] = vector(
        VAL / "known_mn_occurrences.geojson", "known Mn mines",
        keep=["name", "mine_type", "source", "offset_from_source_m"],
    )
    bundle["negatives"] = vector(
        VAL / "negative_control_mines.geojson", "negative controls",
        keep=["name", "commodity", "operator"],
    )
    bundle["clusters"] = vector(VAL / "site_clusters.geojson", "site clusters", keep=["name", "cluster"])
    bundle["targets"] = vector(
        PROC / "targets.geojson", "ranked targets", tolerance_m=40,
        keep=["rank", "area_ha", "score_mean", "score_max", "lat", "lon", "near_non_mn_mine"],
    )

    print("\nMetrics:")
    report_path = PROC / "validation_report.json"
    if report_path.exists():
        report = json.loads(report_path.read_text(encoding="utf-8"))
        bundle["validation"] = report
        print(f"  validation report: {report['n_features']} features, p={report.get('permutation_p')}")
    else:
        bundle["validation"] = {}
        print("  validation report MISSING")

    if not args.skip_terrain:
        print("\nTerrain:")
        bundle["terrain"] = terrain_grid()

    dest = OUT / "bundle.json"
    dest.write_text(json.dumps(bundle, separators=(",", ":")), encoding="utf-8")

    total = sum(f.stat().st_size for f in OUT.iterdir() if f.is_file())
    print(f"\nwrote {dest.relative_to(ROOT)}")
    print(f"bundle total: {total / 1e6:.1f} MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
