"""Feature stack: a lazy view over the exported rasters.

WHY THERE IS NO SINGLE STACKED FILE
    ~68 bands over the Sausar belt at 20 m is roughly 74 million pixels per band -
    about 20 GB as float32. Materialising that would be slow, fragile and mostly
    wasted: training touches only the halo pixels and the background points, and
    inference can run a window at a time.

    So this exposes the stack as a lazy view. Sources stay where they are; pixels are
    read and resampled on demand onto one common grid.

NODATA
    Earth Engine writes masked pixels as 0 when no nodata value is set, and none of
    these exports carry one. Zero is treated as nodata throughout - defensible here
    because every band is either a reflectance (never exactly 0) or a positive band
    ratio. Terrain is the exception and is handled explicitly, since 0 m elevation is
    a real value.

    from src.features.stack import FeatureStack
    fs = FeatureStack()
    df = fs.sample_polygons(halos, label_col="name")
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd
import rasterio
from rasterio.enums import Resampling
from rasterio.vrt import WarpedVRT
from rasterio.windows import Window, from_bounds

from src.config import ROOT, aoi_geometry, cfg

RAW_GEE = ROOT / "data" / "raw" / "gee"

# Bands whose 0 value is genuine rather than a masked pixel.
ZERO_IS_VALID = {"elevation", "aspect_sin", "aspect_cos", "tpi", "tri", "curvature"}

# Earth Engine splits exports over ~4 GB into `<name>-<row>-<col>.tif` pieces.
TILE_SUFFIX = re.compile(r"-\d{10}-\d{10}$")


def _group_key(path: Path) -> str:
    """Collapse Earth Engine's split-export suffixes back to one logical product."""
    return TILE_SUFFIX.sub("", path.stem)


@dataclass
class Source:
    """One logical product, possibly spread over several GeoTIFF pieces."""

    name: str
    paths: list[Path]
    band_names: list[str] = field(default_factory=list)
    scale: float = 1.0

    def __post_init__(self) -> None:
        if not self.band_names:
            with rasterio.open(self.paths[0]) as src:
                self.band_names = [
                    d or f"{self.name}_b{i}" for i, d in enumerate(src.descriptions, 1)
                ]


def discover_sources(directory: Path = RAW_GEE) -> list[Source]:
    """Find exported products in data/raw/gee, regrouping split pieces."""
    if not directory.exists():
        raise FileNotFoundError(f"{directory} does not exist - run src.gee.sync_drive")

    groups: dict[str, list[Path]] = {}
    for path in sorted(directory.glob("*.tif")):
        groups.setdefault(_group_key(path), []).append(path)

    if not groups:
        raise FileNotFoundError(
            f"No GeoTIFFs in {directory}. Exports may still be downloading."
        )

    # Reflectance and mineral-ratio products were exported as scaled integers.
    scales = {"S2_": 1e-4, "LS89_dryseason_median_belt_sausar_optical": 1e-4,
              "LS89_dryseason_median_belt_sausar_thermal": 1e-2, "ASTER_": 1e-3}

    sources = []
    for name, paths in sorted(groups.items()):
        scale = next((v for k, v in scales.items() if name.startswith(k) or name == k), 1.0)
        sources.append(Source(name=name, paths=paths, scale=scale))
    return sources


def target_grid(aoi: str = "belt_sausar") -> tuple[rasterio.crs.CRS, float, tuple]:
    """Common analysis grid: project CRS, project scale, AOI bounds in that CRS."""
    from pyproj import Transformer

    crs = rasterio.crs.CRS.from_string(cfg()["project"]["crs"])
    scale = float(cfg()["project"]["scale_m"])

    coords = aoi_geometry(aoi)["coordinates"][0]
    tf = Transformer.from_crs("EPSG:4326", crs.to_string(), always_xy=True)
    xs, ys = zip(*[tf.transform(lon, lat) for lon, lat in coords])

    # Snap outward to whole pixels so every product lands on an identical grid.
    left = np.floor(min(xs) / scale) * scale
    bottom = np.floor(min(ys) / scale) * scale
    right = np.ceil(max(xs) / scale) * scale
    top = np.ceil(max(ys) / scale) * scale
    return crs, scale, (left, bottom, right, top)


class FeatureStack:
    """Lazy multi-source feature reader on one common grid."""

    def __init__(self, aoi: str = "belt_sausar", sources: list[Source] | None = None):
        self.aoi = aoi
        self.sources = sources if sources is not None else discover_sources()
        self.crs, self.scale, self.bounds = target_grid(aoi)

        left, bottom, right, top = self.bounds
        self.width = int(round((right - left) / self.scale))
        self.height = int(round((top - bottom) / self.scale))
        self.transform = rasterio.transform.from_origin(left, top, self.scale, self.scale)

        self.band_names: list[str] = []
        for src in self.sources:
            self.band_names.extend(src.band_names)

    def __repr__(self) -> str:
        return (
            f"FeatureStack(aoi={self.aoi!r}, {len(self.sources)} sources, "
            f"{len(self.band_names)} bands, {self.height}x{self.width} @ {self.scale:g}m)"
        )

    def describe(self) -> pd.DataFrame:
        rows = []
        for src in self.sources:
            with rasterio.open(src.paths[0]) as ds:
                rows.append(
                    {
                        "product": src.name,
                        "pieces": len(src.paths),
                        "bands": len(src.band_names),
                        "native_res_m": ds.res[0],
                        "native_crs": str(ds.crs),
                        "dtype": ds.dtypes[0],
                        "scale": src.scale,
                    }
                )
        return pd.DataFrame(rows)

    def _sample_source(self, src: Source, xs: np.ndarray, ys: np.ndarray) -> np.ndarray:
        """Sample one product at projected coordinates. Returns (n_points, n_bands)."""
        out = np.full((len(xs), len(src.band_names)), np.nan, dtype="float32")

        for path in src.paths:
            with rasterio.open(path) as ds:
                with WarpedVRT(ds, crs=self.crs, resampling=Resampling.bilinear) as vrt:
                    left, bottom, right, top = vrt.bounds
                    inside = (xs >= left) & (xs < right) & (ys > bottom) & (ys <= top)
                    if not inside.any():
                        continue
                    coords = list(zip(xs[inside], ys[inside]))
                    vals = np.array(list(vrt.sample(coords)), dtype="float32")

                    for j, band in enumerate(src.band_names):
                        column = vals[:, j]
                        if band not in ZERO_IS_VALID:
                            column = np.where(column == 0, np.nan, column)
                        out[np.flatnonzero(inside), j] = column * src.scale
        return out

    def sample_xy(self, xs: np.ndarray, ys: np.ndarray) -> pd.DataFrame:
        """Sample every band at projected coordinates."""
        blocks = [self._sample_source(s, xs, ys) for s in self.sources]
        return pd.DataFrame(np.hstack(blocks), columns=self.band_names)

    def sample_points(self, gdf) -> pd.DataFrame:
        """Sample every band at point geometries (any CRS)."""
        projected = gdf.to_crs(self.crs)
        xs = projected.geometry.x.to_numpy()
        ys = projected.geometry.y.to_numpy()
        frame = self.sample_xy(xs, ys)
        for col in gdf.columns:
            if col != "geometry":
                frame[col] = gdf[col].to_numpy()
        return frame

    def sample_polygons(
        self, gdf, label_col: str = "name", max_per_polygon: int = 4000, seed: int = 26009
    ) -> pd.DataFrame:
        """Randomly sample pixels inside each polygon.

        Capped per polygon so a large halo cannot dominate a small one. The cap is
        about balance between sites, not statistical power - pixels inside one halo
        are heavily autocorrelated and do not represent independent evidence.
        """
        from shapely.geometry import Point

        rng = np.random.default_rng(seed)
        projected = gdf.to_crs(self.crs)
        frames = []

        for idx, row in projected.iterrows():
            geom = row.geometry
            if geom is None or geom.is_empty:
                continue
            minx, miny, maxx, maxy = geom.bounds
            picked_x, picked_y = [], []
            attempts = 0
            while len(picked_x) < max_per_polygon and attempts < max_per_polygon * 60:
                n = max_per_polygon
                cx = rng.uniform(minx, maxx, n)
                cy = rng.uniform(miny, maxy, n)
                for x, y in zip(cx, cy):
                    if geom.contains(Point(x, y)):
                        picked_x.append(x)
                        picked_y.append(y)
                        if len(picked_x) >= max_per_polygon:
                            break
                attempts += n

            if not picked_x:
                continue
            frame = self.sample_xy(np.array(picked_x), np.array(picked_y))
            frame[label_col] = row.get(label_col, idx)
            for extra in ("cluster", "commodity", "mine_type"):
                if extra in projected.columns:
                    frame[extra] = row.get(extra)
            frames.append(frame)

        if not frames:
            return pd.DataFrame(columns=self.band_names + [label_col])
        return pd.concat(frames, ignore_index=True)

    def windows(self, size: int = 1024):
        """Iterate over output windows for tiled inference."""
        for row in range(0, self.height, size):
            for col in range(0, self.width, size):
                yield Window(
                    col, row, min(size, self.width - col), min(size, self.height - row)
                )

    def read_window(self, window: Window) -> np.ndarray:
        """Read every band over one output window. Returns (n_bands, h, w)."""
        win_transform = rasterio.windows.transform(window, self.transform)
        left, top = win_transform * (0, 0)
        right, bottom = win_transform * (window.width, window.height)

        planes = []
        for src in self.sources:
            block = np.full(
                (len(src.band_names), window.height, window.width), np.nan, dtype="float32"
            )
            for path in src.paths:
                with rasterio.open(path) as ds:
                    with WarpedVRT(
                        ds,
                        crs=self.crs,
                        transform=win_transform,
                        width=window.width,
                        height=window.height,
                        resampling=Resampling.bilinear,
                    ) as vrt:
                        data = vrt.read(out_dtype="float32")
                merged = np.where(np.isnan(block), data, block)
                block = merged
            for j, band in enumerate(src.band_names):
                if band not in ZERO_IS_VALID:
                    block[j] = np.where(block[j] == 0, np.nan, block[j])
                block[j] *= src.scale
            planes.append(block)
        return np.vstack(planes)


def prune_correlated(
    frame: pd.DataFrame, columns: list[str], threshold: float = 0.95
) -> tuple[list[str], list[tuple[str, str, float]]]:
    """Drop near-duplicate features.

    Mahalanobis distance and one-class SVM are both distorted by redundant columns:
    a signal present twice is weighted twice. This is the same failure that had
    CLAY_HYDROXYL and LATERITE computing an identical ratio under two names.
    """
    numeric = frame[columns].astype("float64")
    corr = numeric.corr().abs()

    keep, dropped = [], []
    for col in columns:
        redundant_with = None
        for kept in keep:
            r = corr.loc[col, kept]
            if pd.notna(r) and r >= threshold:
                redundant_with = (col, kept, float(r))
                break
        if redundant_with:
            dropped.append(redundant_with)
        else:
            keep.append(col)
    return keep, dropped
