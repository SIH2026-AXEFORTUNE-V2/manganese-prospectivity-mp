"""Shared Earth Engine helpers: AOI geometry, statewide tiling, export submission."""

from __future__ import annotations

import math
from typing import Iterator

import ee

from src.config import aoi_bounds, aoi_geometry, cfg


def ee_aoi(name: str) -> ee.Geometry:
    """AOI from config/aoi.geojson as an ee.Geometry."""
    return ee.Geometry(aoi_geometry(name))


def mp_state() -> ee.Geometry:
    """Actual Madhya Pradesh boundary, not the bounding box.

    Using the bbox for inference would waste ~65% of compute on Rajasthan, UP,
    Maharashtra, Chhattisgarh and Gujarat.
    """
    conf = cfg()["project"]["mp_boundary"]
    fc = ee.FeatureCollection(conf["source"]).filter(
        ee.Filter.eq(conf["filter_field"], conf["filter_value"])
    )
    return fc.geometry()


def analysis_region(name: str) -> ee.Geometry:
    """Resolve an AOI name, with 'mp_state' handled specially."""
    return mp_state() if name == "mp_state" else ee_aoi(name)


def degree_tiles(name: str, step: float | None = None) -> Iterator[tuple[str, ee.Geometry]]:
    """Cut an AOI bbox into step-degree blocks for large exports.

    Yields (tile_id, geometry). Statewide 20 m exports are far too big for one
    GeoTIFF, so they are tiled.
    """
    step = step or cfg()["gee"]["export"]["tile_degrees"]
    min_lon, min_lat, max_lon, max_lat = aoi_bounds(name) if name != "mp_state" else (
        74.0, 21.0, 82.9, 26.9
    )

    n_lon = math.ceil((max_lon - min_lon) / step)
    n_lat = math.ceil((max_lat - min_lat) / step)

    for i in range(n_lon):
        for j in range(n_lat):
            lon0 = min_lon + i * step
            lat0 = min_lat + j * step
            lon1 = min(lon0 + step, max_lon)
            lat1 = min(lat0 + step, max_lat)
            tile_id = f"lon{lon0:.1f}_lat{lat0:.1f}".replace(".", "p").replace("-", "m")
            yield tile_id, ee.Geometry.Rectangle([lon0, lat0, lon1, lat1], proj="EPSG:4326", geodesic=False)


def submit_export(
    image: ee.Image,
    description: str,
    region: ee.Geometry,
    scale: int,
    *,
    folder: str | None = None,
    crs: str | None = None,
    dry_run: bool = False,
) -> ee.batch.Task | None:
    """Queue a Drive export. Returns the started task, or None on a dry run.

    Earth Engine truncates task descriptions at 100 chars and rejects anything
    outside [A-Za-z0-9_-], so the description is sanitised here.
    """
    export_cfg = cfg()["gee"]["export"]
    safe = "".join(ch if (ch.isalnum() or ch in "_-") else "_" for ch in description)[:100]

    if dry_run:
        print(f"  [dry-run] would export {safe} @ {scale}m")
        return None

    task = ee.batch.Export.image.toDrive(
        image=image,
        description=safe,
        folder=folder or export_cfg["drive_folder"],
        fileNamePrefix=safe,
        region=region,
        scale=scale,
        crs=crs or cfg()["project"]["crs"],
        maxPixels=int(float(export_cfg["max_pixels"])),
        fileFormat=export_cfg["file_format"],
        formatOptions={"cloudOptimized": True},
    )
    task.start()
    print(f"  queued {safe} @ {scale}m  (task {task.id})")
    return task


def dry_season_month_filter() -> ee.Filter:
    """Keep only dry-season months (Nov-Apr).

    Written as an explicit OR of two ranges rather than calendarRange(11, 4).
    A single wrapping range relies on start > end being interpreted as a wrap; if
    that assumption is ever wrong the filter silently matches nothing and every
    composite comes back empty. Two non-wrapping ranges cannot be misread.
    """
    return ee.Filter.Or(
        ee.Filter.calendarRange(11, 12, "month"),
        ee.Filter.calendarRange(1, 4, "month"),
    )


def scale_to_int16(image: ee.Image, factor: int = 10000) -> ee.Image:
    """Reflectance floats -> int16, to keep export sizes sane."""
    return image.multiply(factor).round().toInt16()
