"""A5 - Sentinel-1 C-band SAR backscatter and texture.

SAR adds surface roughness and dielectric information that optical sensors cannot
see, and it works through cloud. Ascending and descending passes are kept strictly
separate: they illuminate terrain from opposite sides, so averaging them destroys
exactly the directional shading that makes SAR useful for structural mapping.

    python -m src.gee.sentinel1 --aoi belt_sausar
"""

from __future__ import annotations

import argparse

import ee

from src.config import cfg, full_dry_span
from src.gee import auth
from src.gee.common import analysis_region, dry_season_month_filter, submit_export


def _collection(region: ee.Geometry, start: str, end: str, orbit: str) -> ee.ImageCollection:
    conf = cfg()["gee"]["sentinel1"]
    collection = (
        ee.ImageCollection(conf["collection"])
        .filterBounds(region)
        .filterDate(start, end)
        .filter(ee.Filter.eq("instrumentMode", conf["instrument_mode"]))
        .filter(ee.Filter.eq("orbitProperties_pass", orbit))
        .filter(dry_season_month_filter())
    )
    for pol in conf["polarisations"]:
        collection = collection.filter(ee.Filter.listContains("transmitterReceiverPolarisation", pol))
    return collection.select(conf["polarisations"])


def build_stack(region: ee.Geometry, start: str, end: str, orbit: str) -> ee.Image:
    """Median backscatter, temporal variability and GLCM texture for one orbit pass."""
    conf = cfg()["gee"]["sentinel1"]
    collection = _collection(region, start, end, orbit)
    suffix = orbit[:3].lower()  # asc / des

    median = collection.median().rename([f"{p}_median_{suffix}" for p in conf["polarisations"]])
    stddev = collection.reduce(ee.Reducer.stdDev()).rename(
        [f"{p}_stddev_{suffix}" for p in conf["polarisations"]]
    )
    ratio = median.select(0).subtract(median.select(1)).rename(f"VV_VH_ratio_{suffix}")

    # GLCM needs integer input; dB values are scaled and cast.
    #
    # glcmTexture prefixes its outputs with the INPUT band name, so the source is
    # renamed to a fixed label first. Selecting on a guessed prefix breaks silently
    # the moment the upstream rename changes - which is exactly how this failed
    # before ("Band pattern 'constant_contrast' did not match any bands").
    glcm_source = median.select(0).multiply(100).toInt32().rename("vv")
    glcm = glcm_source.glcmTexture(size=3).select(
        ["vv_contrast", "vv_ent", "vv_corr"]
    ).rename([f"VV_contrast_{suffix}", f"VV_entropy_{suffix}", f"VV_corr_{suffix}"])

    return ee.Image.cat([median, stddev, ratio, glcm]).clip(region)


def export(aoi: str, *, dry_run: bool = False) -> None:
    region = analysis_region(aoi)
    conf = cfg()["gee"]["sentinel1"]
    start, end = full_dry_span()

    for orbit in conf["orbit_passes"]:
        print(f"Sentinel-1 {orbit}: {aoi}  {start} -> {end}")
        n = _collection(region, start, end, orbit).size().getInfo()
        if n == 0:
            print(f"  no {orbit} scenes over this AOI - skipping")
            continue
        print(f"  {n} scenes")
        stack = build_stack(region, start, end, orbit)
        submit_export(
            stack.toFloat(),
            f"S1_{orbit[:3].lower()}_{aoi}",
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
