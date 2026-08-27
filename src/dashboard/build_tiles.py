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

WHAT THIS SCRIPT DOES NOT DO
    It does not run the model. --score/--dem must already exist - src/models/predict.py
    writes the score raster, src/gee/terrain.py exports the DEM. For mp_state specifically,
    that needs Earth Engine auth and statewide exports synced to data/raw/gee/, neither of
    which is available on every machine - if --score is missing, this script says so and
    stops rather than guessing.

USAGE
    Belt (real data, once predict.py --aoi belt_sausar and terrain.py have run):
    python -m src.dashboard.build_tiles --aoi belt_sausar \
        --score data/processed/prospectivity_belt_sausar.tif \
        --dem data/raw/gee/TERRAIN_glo30_belt_sausar.tif \
        --min-zoom 6 --max-zoom 11

    Statewide, once predict.py --aoi mp_state has run:
    python -m src.dashboard.build_tiles --aoi mp_state \
        --score data/processed/prospectivity_mp_state.tif \
        --min-zoom 6 --max-zoom 12

    Smoke-test against a small synthetic raster (no real data needed, no --dem):
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


def _iter_intersecting_tiles(reader: COGReader, min_zoom: int, max_zoom: int):
    """Every (x, y, z) tile in [min_zoom, max_zoom] that actually overlaps the raster.

    Shared by _tile_layer and _tile_terrain_rgb so both walk the same tile set the same way.
    """
    west, south, east, north = reader.get_geographic_bounds(CRS.from_epsg(4326))
    for zoom in range(min_zoom, max_zoom + 1):
        for t in mercantile.tiles(west, south, east, north, [zoom]):
            if reader.tile_exists(t.x, t.y, t.z):
                yield t


def _write_tile_png(rgba: np.ndarray, out_dir: Path, zoom: int, x: int, y: int) -> None:
    # rio_tiler's render() wants band-first (count, height, width), the opposite of the
    # (height, width, count) shape everything above builds in.
    png_bytes = render(rgba.transpose(2, 0, 1), img_format="PNG")
    dest = out_dir / str(zoom) / str(x)
    dest.mkdir(parents=True, exist_ok=True)
    (dest / f"{y}.png").write_bytes(png_bytes)


def _tile_layer(cog_path: Path, band: int, cmap_name: str, out_dir: Path, min_zoom: int, max_zoom: int) -> int:
    """Render every tile in [min_zoom, max_zoom] that intersects the raster. Returns tile count."""
    lo, hi = _percentile_stretch(cog_path, band)
    lut = _colormap(cmap_name)
    palette = np.zeros((256, 3), dtype="uint8")
    palette[1:] = lut[np.linspace(0, 255, 255).astype("uint8")]
    written = 0

    with COGReader(str(cog_path)) as reader:
        for t in _iter_intersecting_tiles(reader, min_zoom, max_zoom):
            tile_data = reader.tile(t.x, t.y, t.z, indexes=band)
            arr = tile_data.data[0].astype("float32")
            mask = tile_data.mask > 0
            idx = np.zeros(arr.shape, dtype="uint8")
            span = max(hi - lo, 1e-6)
            idx[mask] = 1 + np.clip((arr[mask] - lo) / span * 254, 0, 254).astype("uint8")

            rgba = np.zeros((*arr.shape, 4), dtype="uint8")
            rgba[..., :3] = palette[idx]
            rgba[..., 3] = np.where(mask, 255, 0)
            _write_tile_png(rgba, out_dir, t.z, t.x, t.y)
            written += 1

    return written


# Mapbox/deck.gl Terrain-RGB encoding: height = -10000 + (R*256^2 + G*256 + B) * 0.1
# deck.gl's TerrainLayer decodes this exact scheme by default (elevationDecoder), which is
# why this encodes to it rather than inventing a custom one - one less thing seat 1's map
# code has to configure.
_TERRAIN_RGB_BASE = -10000.0
_TERRAIN_RGB_INTERVAL = 0.1


def _tile_terrain_rgb(cog_path: Path, band: int, out_dir: Path, min_zoom: int, max_zoom: int) -> int:
    """Same tile walk as _tile_layer, but encodes raw elevation into RGB instead of a colour ramp."""
    written = 0

    with COGReader(str(cog_path)) as reader:
        for t in _iter_intersecting_tiles(reader, min_zoom, max_zoom):
            tile_data = reader.tile(t.x, t.y, t.z, indexes=band)
            elevation = tile_data.data[0].astype("float64")
            mask = tile_data.mask > 0

            encoded = np.round((elevation - _TERRAIN_RGB_BASE) / _TERRAIN_RGB_INTERVAL)
            encoded = np.clip(encoded, 0, 256**3 - 1).astype("uint32")

            rgba = np.zeros((*elevation.shape, 4), dtype="uint8")
            rgba[..., 0] = (encoded >> 16) & 255
            rgba[..., 1] = (encoded >> 8) & 255
            rgba[..., 2] = encoded & 255
            rgba[..., 3] = np.where(mask, 255, 0)
            _write_tile_png(rgba, out_dir, t.z, t.x, t.y)
            written += 1

    return written


def build(
    aoi: str,
    score_path: Path,
    min_zoom: int,
    max_zoom: int,
    tiles_dir: Path = WEB_TILES,
    manifest_path: Path = WEB_DATA / "manifest.json",
    dem_path: Path | None = None,
    dem_band: int = 1,
) -> None:
    """Tile `score_path` (and optionally `dem_path`) and update `manifest_path` in place.

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
    if dem_path is not None and not dem_path.exists():
        raise SystemExit(f"{dem_path} does not exist - pass --dem pointing at a real DEM, or omit --dem.")

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

        terrain_manifest = None
        if dem_path is not None:
            dem_cog_path = Path(tmp) / "dem.cog.tif"
            _make_cog(dem_path, dem_cog_path)
            with rasterio.open(dem_cog_path) as src:
                dem_bounds = transform_bounds(src.crs, "EPSG:4326", *src.bounds)

            terrain_dir = tiles_dir / "terrain_rgb"
            if terrain_dir.exists():
                shutil.rmtree(terrain_dir)
            n = _tile_terrain_rgb(dem_cog_path, dem_band, terrain_dir, min_zoom, max_zoom)
            print(f"  terrain_rgb: {n} tiles, zoom {min_zoom}-{max_zoom} (Mapbox/deck.gl encoding)")
            terrain_manifest = {
                "tiles": "/tiles/terrain_rgb/{z}/{x}/{y}.png",
                "bounds": [round(b, 6) for b in dem_bounds],
                "encoding": "terrarium-mapbox",  # base=-10000, interval=0.1, see _TERRAIN_RGB_*
            }

    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    manifest["aoi"] = aoi
    manifest["bounds"] = [round(b, 6) for b in bounds]
    manifest.setdefault("layers", {}).update(manifest_layers)
    if terrain_manifest is not None:
        manifest["terrain"] = terrain_manifest
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

    # Synthetic DEM too - realistic Sausar-belt elevation range (~250-750m), just to exercise
    # _tile_terrain_rgb end to end and round-trip the encoding back to a sane elevation.
    dem_path = tmp_dir / "synthetic_dem.tif"
    elevation = (500 + 200 * np.sin(np.linspace(0, 6, h))[:, None] * np.cos(np.linspace(0, 6, w))[None, :]).astype("float32")
    with rasterio.open(
        dem_path, "w", driver="GTiff", height=h, width=w, count=1, dtype="float32",
        crs="EPSG:4326", transform=transform,
    ) as dst:
        dst.write(elevation, 1)

    scratch_tiles = tmp_dir / "tiles"
    scratch_manifest = tmp_dir / "manifest.json"
    build(
        "self_test", src_path, min_zoom=6, max_zoom=8,
        tiles_dir=scratch_tiles, manifest_path=scratch_manifest,
        dem_path=dem_path, dem_band=1,
    )
    tile_count = sum(1 for _ in scratch_tiles.rglob("*.png"))

    # Decode one terrain-RGB tile back to elevation and confirm it lands near the source
    # range - catches an encoding bug that a tile-count check alone would miss.
    from PIL import Image

    terrain_tiles = list((scratch_tiles / "terrain_rgb").rglob("*.png"))
    im = np.array(Image.open(terrain_tiles[0]))
    r, g, b, a = (im[..., i].astype("int64") for i in range(4))
    decoded = _TERRAIN_RGB_BASE + (r * 256 * 256 + g * 256 + b) * _TERRAIN_RGB_INTERVAL
    valid = decoded[a > 0]
    assert 200 < valid.min() and valid.max() < 800, f"terrain-RGB round-trip out of range: {valid.min()}-{valid.max()}"

    shutil.rmtree(tmp_dir, ignore_errors=True)
    print(f"\nSelf-test passed - {tile_count} real PNG tiles (incl. {len(terrain_tiles)} terrain-RGB) produced,")
    print(f"terrain-RGB round-trip decoded to {valid.min():.0f}-{valid.max():.0f}m (source was ~300-700m), all cleaned up.")
    print("Nothing under web/public/ was touched. Point --score/--dem at real rasters")
    print("(writing to the default web/public/ paths) to build the actual tile set.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="mp_state")
    parser.add_argument("--score", type=Path, default=ROOT / "data" / "processed" / "prospectivity_mp_state.tif")
    parser.add_argument("--dem", type=Path, default=None, help="optional DEM GeoTIFF -> terrain-RGB tiles")
    parser.add_argument("--dem-band", type=int, default=1, help="elevation band index in --dem (default 1)")
    parser.add_argument("--min-zoom", type=int, default=6)
    parser.add_argument("--max-zoom", type=int, default=12)
    parser.add_argument("--self-test", action="store_true", help="run against a synthetic raster, no real data needed")
    args = parser.parse_args()

    if args.self_test:
        self_test()
        return 0

    build(args.aoi, args.score, args.min_zoom, args.max_zoom, dem_path=args.dem, dem_band=args.dem_band)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
