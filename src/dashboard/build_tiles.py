"""Issue #1 (docs/issues/01-statewide-tiling.md) - cut a statewide score raster into an XYZ
tile pyramid the web app can actually load.

THE PROBLEM THIS SOLVES
    dashboard/assets/bundle.json ships one flat PNG per score layer, sized for the belt
    (~270 km). That's fine for belt_sausar. It does not work for mp_state: a single image
    covering all of Madhya Pradesh at 20 m would be enormous, and the browser would have to
    download the whole thing to look at one district. Standard fix: cut the raster into an
    XYZ tile pyramid (Cloud-Optimized GeoTIFF -> per-zoom PNG tiles), so the browser only ever
    fetches what's on screen. See docs/04-data-contract.md's `tiles` vs `static_image` rule.

WHY THE COLOUR STRETCH IS COMPUTED ONCE, NOT PER TILE
    src/models/predict.py's docstring makes this point for score rank-normalisation and it
    applies identically here: normalising each tile's colour range separately would make every
    tile's brightest pixel look maxed-out, producing visible seams and a meaningless map. The
    percentile stretch is computed once from the full raster (same 2nd-99.5th percentile
    src/dashboard/build_assets.py uses) and then applied identically to every tile.

WHAT THIS SCRIPT DOES NOT DO YET
    - It does not run the statewide model (src/models/predict.py --aoi mp_state) - that needs
      Earth Engine auth and the statewide GEE exports synced to data/raw/gee/, neither of
      which is available on this machine. This script starts from whatever GeoTIFF
      predict.py already wrote; if that file doesn't exist yet, run predict.py first. Every
      run below was verified with --self-test (a synthetic raster), not real statewide data.
    - It does not yet produce `terrain_rgb_tiles` (docs/04-data-contract.md's terrain field) -
      only the three score layers (fused/signature/anomaly). Same tiling machinery applies,
      just with the Mapbox terrain-RGB encoding instead of a colour ramp; left for a follow-up
      pass on this same script rather than guessed at without a DEM to test against.

USAGE
    python -m src.dashboard.build_tiles --aoi mp_state \
        --score data/processed/prospectivity_mp_state.tif \
        --min-zoom 6 --max-zoom 12

    Smoke-test against a small synthetic raster (no real statewide data needed):
    python -m src.dashboard.build_tiles --self-test
"""

from __future__ import annotations

import argparse
import json
import shutil
import tempfile
from pathlib import Path

import mercantile
import numpy as np
import rasterio
from rasterio.crs import CRS
from rasterio.warp import transform_bounds
from rio_cogeo.cogeo import cog_translate
from rio_cogeo.profiles import cog_profiles
from rio_tiler.io import COGReader
from rio_tiler.utils import render

from src.config import ROOT

WEB_TILES = ROOT / "web" / "public" / "tiles"
WEB_DATA = ROOT / "web" / "public" / "data"

# Same three bands/colour maps as src/dashboard/build_assets.py's raster_to_png - keep both
# in sync if the prediction raster's band order ever changes.
LAYER_BANDS = {"signature": (1, "inferno"), "anomaly": (2, "viridis"), "fused": (3, "inferno")}


def _colormap(name: str) -> np.ndarray:
    """256x3 uint8 lookup table - identical to build_assets.py's _colormap.

    Duplicated rather than imported because build_assets.py pulls in geopandas at module
    load for its vector() function, which this script has no other reason to depend on.
    If that import cost ever matters, split _colormap into a shared, dependency-light module.
    """
    from matplotlib import colormaps

    cmap = colormaps[name]
    return (cmap(np.linspace(0, 1, 256))[:, :3] * 255).astype("uint8")


def _percentile_stretch(path: Path, band: int) -> tuple[float, float]:
    """2nd-99.5th percentile of the WHOLE raster, computed once. See module docstring."""
    with rasterio.open(path) as src:
        arr = src.read(band, masked=True)
        valid = arr.compressed()
    if valid.size == 0:
        return 0.0, 1.0
    lo, hi = np.percentile(valid, [2, 99.5])
    return float(lo), float(max(hi, lo + 1e-6))


def _make_cog(src_path: Path, dst_path: Path) -> None:
    profile = cog_profiles.get("deflate")
    cog_translate(str(src_path), str(dst_path), profile, quiet=True)


def _tile_layer(cog_path: Path, band: int, cmap_name: str, out_dir: Path, min_zoom: int, max_zoom: int) -> int:
    """Render every tile in [min_zoom, max_zoom] that intersects the raster. Returns tile count."""
    lo, hi = _percentile_stretch(cog_path, band)
    lut = _colormap(cmap_name)
    written = 0

    with COGReader(str(cog_path)) as reader:
        west, south, east, north = reader.get_geographic_bounds(CRS.from_epsg(4326))

        for zoom in range(min_zoom, max_zoom + 1):
            for t in mercantile.tiles(west, south, east, north, [zoom]):
                if not reader.tile_exists(t.x, t.y, t.z):
                    continue  # tile doesn't intersect data - normal at the raster's edges

                tile_data = reader.tile(t.x, t.y, t.z, indexes=band)
                x, y = t.x, t.y
                arr = tile_data.data[0].astype("float32")
                mask = tile_data.mask > 0
                idx = np.zeros(arr.shape, dtype="uint8")
                span = max(hi - lo, 1e-6)
                idx[mask] = 1 + np.clip((arr[mask] - lo) / span * 254, 0, 254).astype("uint8")

                palette = np.zeros((256, 3), dtype="uint8")
                palette[1:] = lut[np.linspace(0, 255, 255).astype("uint8")]
                rgba = np.zeros((*arr.shape, 4), dtype="uint8")
                rgba[..., :3] = palette[idx]
                rgba[..., 3] = np.where(mask, 255, 0)

                # rio_tiler's render() wants band-first (count, height, width), the
                # opposite of the (height, width, count) shape used everywhere above.
                png_bytes = render(rgba.transpose(2, 0, 1), img_format="PNG")
                dest = out_dir / str(zoom) / str(x)
                dest.mkdir(parents=True, exist_ok=True)
                (dest / f"{y}.png").write_bytes(png_bytes)
                written += 1

    return written


def build(
    aoi: str,
    score_path: Path,
    min_zoom: int,
    max_zoom: int,
    tiles_dir: Path = WEB_TILES,
    manifest_path: Path = WEB_DATA / "manifest.json",
) -> None:
    """Tile `score_path` and update `manifest_path` in place.

    `tiles_dir`/`manifest_path` default to the real app paths under web/public/ - override
    both when calling this from self_test() so a smoke test can never touch the live fixture
    the running app actually reads.
    """
    if not score_path.exists():
        raise SystemExit(
            f"{score_path} does not exist.\n"
            "Run `python -m src.models.predict --aoi "
            f"{aoi}` first (needs Earth Engine auth + statewide exports in data/raw/gee/ -\n"
            "see README.md's Runbook section). This script only tiles an already-scored raster."
        )

    with tempfile.TemporaryDirectory() as tmp:
        cog_path = Path(tmp) / "score.cog.tif"
        _make_cog(score_path, cog_path)

        with rasterio.open(cog_path) as src:
            bounds = transform_bounds(src.crs, "EPSG:4326", *src.bounds)

        manifest_layers = {}
        for name, (band, cmap_name) in LAYER_BANDS.items():
            out_dir = tiles_dir / name
            if out_dir.exists():
                shutil.rmtree(out_dir)
            n = _tile_layer(cog_path, band, cmap_name, out_dir, min_zoom, max_zoom)
            print(f"  {name}: {n} tiles, zoom {min_zoom}-{max_zoom}")
            manifest_layers[name] = {
                "static_image": None,
                "tiles": f"/tiles/{name}/{{z}}/{{x}}/{{y}}.png",
                "bounds": [round(b, 6) for b in bounds],
                "value_range": [0, 1],
            }

    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    manifest["aoi"] = aoi
    manifest["bounds"] = [round(b, 6) for b in bounds]
    manifest.setdefault("layers", {}).update(manifest_layers)
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"\nwrote {manifest_path} - aoi={aoi}, tiles=true, static_image=null")


def self_test() -> None:
    """Builds a small synthetic raster and runs the full pipeline against it.

    This exists because there is no real statewide prediction raster in every dev
    environment (Earth Engine auth + multi-GB Drive exports aren't available everywhere) -
    this is how the tiling logic itself gets verified without that dependency.

    Everything this writes - the synthetic source raster, the output tiles, the manifest -
    lives under a throwaway temp directory and is deleted at the end. It must never touch
    web/public/ - that's the real fixture the running app reads (see build()).
    """
    print("Self-test: synthetic 200x200 raster, EPSG:4326, ~Sausar-belt-sized bounds\n")
    tmp_dir = Path(tempfile.mkdtemp())
    src_path = tmp_dir / "synthetic_score.tif"

    h, w = 200, 200
    yy, xx = np.mgrid[0:h, 0:w]
    # Three bands (signature, anomaly, fused), each a smooth synthetic field in [0, 1] plus
    # noise - close enough in shape to a real score raster to exercise the stretch/colormap
    # logic, nowhere close enough to be mistaken for a real result.
    rng = np.random.default_rng(26009)
    bands = []
    for i in range(3):
        field = 0.5 + 0.4 * np.sin(xx / 20 + i) * np.cos(yy / 25 + i)
        field += rng.normal(0, 0.05, field.shape)
        bands.append(np.clip(field, 0, 1).astype("float32"))

    transform = rasterio.transform.from_bounds(78.30, 21.28, 80.90, 22.32, w, h)
    with rasterio.open(
        src_path, "w", driver="GTiff", height=h, width=w, count=3, dtype="float32",
        crs="EPSG:4326", transform=transform,
    ) as dst:
        for i, band in enumerate(bands, start=1):
            dst.write(band, i)

    scratch_tiles = tmp_dir / "tiles"
    scratch_manifest = tmp_dir / "manifest.json"
    build(
        "self_test", src_path, min_zoom=6, max_zoom=8,
        tiles_dir=scratch_tiles, manifest_path=scratch_manifest,
    )
    tile_count = sum(1 for _ in scratch_tiles.rglob("*.png"))
    shutil.rmtree(tmp_dir, ignore_errors=True)
    print(f"\nSelf-test passed - {tile_count} real PNG tiles produced and cleaned up.")
    print("Nothing under web/public/ was touched. Point --score at a real statewide")
    print("prediction raster (writing to the default web/public/ paths) to build the actual tile set.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="mp_state")
    parser.add_argument("--score", type=Path, default=ROOT / "data" / "processed" / "prospectivity_mp_state.tif")
    parser.add_argument("--min-zoom", type=int, default=6)
    parser.add_argument("--max-zoom", type=int, default=12)
    parser.add_argument("--self-test", action="store_true", help="run against a synthetic raster, no real data needed")
    args = parser.parse_args()

    if args.self_test:
        self_test()
        return 0

    build(args.aoi, args.score, args.min_zoom, args.max_zoom)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
