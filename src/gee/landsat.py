"""A2 - Landsat 8/9 Collection-2 Level-2 surface reflectance + thermal.

Why this exists alongside Sentinel-2: Bhoonidhi serves Landsat as L1 (top-of-atmosphere)
only. Multi-date band ratios need atmospheric correction, so the L2 surface-reflectance
product is pulled from Earth Engine instead. The thermal band (ST_B10) also has no
Sentinel-2 equivalent and is useful as a silica/quartz proxy and for detecting bare,
sun-heated rock.

    python -m src.gee.landsat --aoi belt_sausar
"""

from __future__ import annotations

import argparse

import ee

from src.config import cfg, full_dry_span
from src.gee import auth
from src.gee.common import analysis_region, dry_season_month_filter, submit_export


def _prep(img: ee.Image) -> ee.Image:
    """Apply Collection-2 scaling and mask cloud/shadow/snow via QA_PIXEL bits."""
    conf = cfg()["gee"]["landsat"]
    qa = img.select(conf["qa_band"])

    # QA_PIXEL bit flags: 1 dilated cloud, 2 cirrus, 3 cloud, 4 cloud shadow, 5 snow
    bad = (
        qa.bitwiseAnd(1 << 1)
        .Or(qa.bitwiseAnd(1 << 2))
        .Or(qa.bitwiseAnd(1 << 3))
        .Or(qa.bitwiseAnd(1 << 4))
        .Or(qa.bitwiseAnd(1 << 5))
    )

    optical = (
        img.select(conf["optical_bands"])
        .multiply(conf["sr_mult"])
        .add(conf["sr_add"])
    )
    thermal = (
        img.select(conf["thermal_bands"])
        .multiply(conf["st_mult"])
        .add(conf["st_add"])
    )

    return (
        optical.addBands(thermal)
        .updateMask(bad.Not())
        .copyProperties(img, ["system:time_start"])
    )


def _add_indices(img: ee.Image) -> ee.Image:
    """Landsat-band equivalents of the alteration ratios used on Sentinel-2."""
    # SR_B2 blue, SR_B4 red, SR_B5 NIR, SR_B6 SWIR1, SR_B7 SWIR2
    iron_oxide = img.select("SR_B4").divide(img.select("SR_B2")).rename("LS_IRON_OXIDE")
    ferrous = img.select("SR_B6").divide(img.select("SR_B5")).rename("LS_FERROUS")
    clay = img.select("SR_B6").divide(img.select("SR_B7")).rename("LS_CLAY_HYDROXYL")
    gossan = iron_oxide.multiply(clay).rename("LS_GOSSAN")
    ndvi = img.normalizedDifference(["SR_B5", "SR_B4"]).rename("LS_NDVI")
    return img.addBands([iron_oxide, ferrous, clay, gossan, ndvi])


def build_composite(region: ee.Geometry, start: str, end: str) -> ee.Image:
    conf = cfg()["gee"]["landsat"]
    collections = [
        ee.ImageCollection(name)
        .filterBounds(region)
        .filterDate(start, end)
        .filter(dry_season_month_filter())
        for name in conf["collections"]
    ]
    merged = collections[0]
    for extra in collections[1:]:
        merged = merged.merge(extra)

    composite = merged.map(_prep).median()
    return _add_indices(composite).clip(region)


def export(aoi: str, *, dry_run: bool = False) -> None:
    region = analysis_region(aoi)
    conf = cfg()["gee"]["landsat"]
    start, end = full_dry_span()

    print(f"Landsat 8/9 L2 dry-season median: {aoi}  {start} -> {end}")
    image = build_composite(region, start, end)

    # Optical is reflectance (~0-1), thermal is kelvin (~280-330). Scaling both by
    # 10000 would overflow int16 on the thermal band, so they export separately.
    optical = image.select([b for b in image.bandNames().getInfo() if not b.startswith("ST_")])
    thermal = image.select(conf["thermal_bands"])

    submit_export(
        optical.multiply(10000).round().toInt16(),
        f"LS89_dryseason_median_{aoi}_optical",
        region,
        conf["scale_m"],
        dry_run=dry_run,
    )
    submit_export(
        thermal.multiply(100).round().toInt16(),  # kelvin * 100 fits int16
        f"LS89_dryseason_median_{aoi}_thermal",
        region,
        conf["scale_m"],
        dry_run=dry_run,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="belt_sausar")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    auth.init()
    export(args.aoi, dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
