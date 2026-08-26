"""Shared config + AOI loading.

Every acquisition script goes through here so that paths, CRS, date windows and
AOI geometry are defined in exactly one place (config/datasets.yaml, config/aoi.geojson).
"""

from __future__ import annotations

import json
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parent.parent
CONFIG_DIR = ROOT / "config"
DATA_DIR = ROOT / "data"


@lru_cache(maxsize=1)
def cfg() -> dict[str, Any]:
    """Parsed config/datasets.yaml."""
    with open(CONFIG_DIR / "datasets.yaml", encoding="utf-8") as fh:
        return yaml.safe_load(fh)


@lru_cache(maxsize=1)
def _aoi_collection() -> dict[str, Any]:
    with open(CONFIG_DIR / "aoi.geojson", encoding="utf-8") as fh:
        return json.load(fh)


def aoi_names() -> list[str]:
    return [f["properties"]["name"] for f in _aoi_collection()["features"]]


def aoi_feature(name: str) -> dict[str, Any]:
    """One AOI feature by name, e.g. 'belt_sausar'."""
    for feature in _aoi_collection()["features"]:
        if feature["properties"]["name"] == name:
            return feature
    raise KeyError(f"AOI {name!r} not found. Available: {aoi_names()}")


def aoi_geometry(name: str) -> dict[str, Any]:
    """GeoJSON geometry dict for an AOI."""
    return aoi_feature(name)["geometry"]


def aoi_bounds(name: str) -> tuple[float, float, float, float]:
    """(min_lon, min_lat, max_lon, max_lat) for an AOI."""
    coords = aoi_geometry(name)["coordinates"][0]
    lons = [c[0] for c in coords]
    lats = [c[1] for c in coords]
    return min(lons), min(lats), max(lons), max(lats)


def dry_season_range(start_year: int) -> tuple[str, str]:
    """Dry-season window for a season labelled by its starting year.

    Season 2024 means 2024-11-01 -> 2025-04-30. The window crosses the new year,
    which is why seasons are labelled by start year rather than calendar year.
    """
    season = cfg()["project"]["dry_season"]
    start = f"{start_year}-{season['start_month_day']}"
    end = f"{start_year + 1}-{season['end_month_day']}"
    return start, end


def dry_seasons() -> list[int]:
    """Season start-years, filtered to those that have actually begun."""
    today = date.today()
    return [y for y in cfg()["project"]["dry_season"]["seasons"] if y <= today.year]


def full_dry_span() -> tuple[str, str]:
    """Earliest season start -> latest season end, for multi-year composites."""
    seasons = dry_seasons()
    return dry_season_range(seasons[0])[0], dry_season_range(seasons[-1])[1]


def out_dir(*parts: str) -> Path:
    """Resolve (and create) a directory under data/."""
    path = DATA_DIR.joinpath(*parts)
    path.mkdir(parents=True, exist_ok=True)
    return path
