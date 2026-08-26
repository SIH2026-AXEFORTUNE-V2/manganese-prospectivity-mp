"""A3 - ASTER SWIR mineral mapping.

This closes the biggest spectral gap in the project. ASTER has six SWIR bands
(B04-B09, 30 m) spanning 1.60-2.43 um, where clays, carbonates and Mn/Fe oxides
have their diagnostic absorption features. Sentinel-2 has only two broad SWIR
bands and cannot resolve them.

CRITICAL CONSTRAINT
    The ASTER SWIR detector failed in April 2008 due to a cooler malfunction.
    Every SWIR pixel acquired after that is saturated garbage. Including it would
    silently poison every band ratio downstream, so the date filter here is a
    hard precondition, asserted at runtime rather than left as a comment.

    python -m src.gee.aster --aoi belt_sausar
    python -m src.gee.aster --aoi belt_sausar --count-only
"""

from __future__ import annotations

import argparse

import ee

from src.config import cfg
from src.gee import auth
from src.gee.common import analysis_region, submit_export


def swir_collection(region: ee.Geometry) -> ee.ImageCollection:
    """Pre-2008 ASTER scenes that carry all VNIR + SWIR bands."""
    conf = cfg()["gee"]["aster"]
    needed = conf["vnir_bands"] + conf["swir_bands"]

    collection = (
        ee.ImageCollection(conf["collection"])
        .filterBounds(region)
        .filterDate("2000-03-01", conf["swir_valid_before"])
        .filter(ee.Filter.lt("CLOUDCOVER", conf["max_cloud_pct"]))
    )
    # Not every ASTER granule carries SWIR; drop the ones that do not.
    for band in needed:
        collection = collection.filter(ee.Filter.listContains("system:band_names", band))
    return collection.select(needed)


def assert_swir_dates_valid(region: ee.Geometry) -> None:
    """Fail loudly if any selected scene post-dates the SWIR detector failure."""
    conf = cfg()["gee"]["aster"]
    cutoff = conf["swir_valid_before"]
    collection = swir_collection(region)

    n = collection.size().getInfo()
    if n == 0:
        raise RuntimeError(
            "No pre-2008 ASTER scenes with SWIR found over this AOI. "
            "Widen the AOI or relax max_cloud_pct in config/datasets.yaml."
        )

    latest_ms = collection.aggregate_max("system:time_start").getInfo()
    latest = ee.Date(latest_ms).format("YYYY-MM-dd").getInfo()
    if latest >= cutoff:
        raise AssertionError(
            f"ASTER SWIR date filter is broken: latest scene {latest} >= cutoff {cutoff}. "
            "Post-April-2008 SWIR is unusable and would corrupt every band ratio."
        )
    print(f"  SWIR date guard OK: {n} scenes, latest {latest} (cutoff {cutoff})")


def _mineral_ratios(img: ee.Image) -> ee.Image:
    """Published ASTER band ratios relevant to Mn/Fe/alteration mapping.

    B04 1.65um, B05 2.17um, B06 2.21um, B07 2.26um, B08 2.33um, B09 2.40um
    B01 0.56um, B02 0.66um, B3N 0.82um
    """
    b = {name: img.select(name) for name in img.bandNames().getInfo()}

    ferric_iron = b["B02"].divide(b["B01"]).rename("AST_FERRIC_IRON")
    ferrous_iron = b["B05"].add(b["B3N"]).divide(b["B04"]).rename("AST_FERROUS_IRON")
    gossan = b["B04"].divide(b["B02"]).rename("AST_GOSSAN")
    alteration = b["B04"].divide(b["B05"]).rename("AST_ALTERATION")
    # Kaolinite / clay - 2.17um absorption
    clay = b["B04"].add(b["B06"]).divide(b["B05"]).rename("AST_CLAY")
    # Al-OH group, the classic hydrothermal alteration indicator
    aloh = b["B05"].add(b["B07"]).divide(b["B06"]).rename("AST_ALOH")
    # Mg-OH / carbonate - 2.33um, tracks the Sausar Group marbles and dolomites
    mgoh = b["B06"].add(b["B09"]).divide(b["B07"].add(b["B08"])).rename("AST_MGOH_CARBONATE")
    # Laterite / ferruginous capping - the main indirect Mn indicator.
    # Uses the 2.33um Mg-OH/carbonate band against 1.65um, which is a genuinely
    # different contrast from AST_ALTERATION (B04/B05). Both were B04/B05 at one
    # point: two names for one band, which double-weighted that signal in every
    # distance-based scorer downstream.
    laterite = b["B04"].divide(b["B08"]).rename("AST_LATERITE")

    return img.addBands(
        [ferric_iron, ferrous_iron, gossan, alteration, clay, aloh, mgoh, laterite]
    )


def build_composite(region: ee.Geometry) -> ee.Image:
    """Median pre-2008 ASTER mosaic with mineral ratios appended."""
    collection = swir_collection(region)
    composite = collection.median()
    return _mineral_ratios(composite).clip(region)


def export(aoi: str, *, dry_run: bool = False) -> None:
    region = analysis_region(aoi)
    conf = cfg()["gee"]["aster"]

    print(f"ASTER SWIR mineral composite: {aoi}")
    assert_swir_dates_valid(region)

    image = build_composite(region)
    submit_export(
        image.multiply(1000).round().toInt16(),
        f"ASTER_swir_minerals_{aoi}_pre2008",
        region,
        conf["swir_scale_m"],
        dry_run=dry_run,
    )


def count(aoi: str) -> None:
    region = analysis_region(aoi)
    conf = cfg()["gee"]["aster"]
    collection = swir_collection(region)
    n = collection.size().getInfo()
    print(f"ASTER pre-2008 SWIR scenes over {aoi}: {n}")
    if n:
        first = ee.Date(collection.aggregate_min("system:time_start")).format("YYYY-MM-dd").getInfo()
        last = ee.Date(collection.aggregate_max("system:time_start")).format("YYYY-MM-dd").getInfo()
        print(f"  date range: {first} -> {last}  (cutoff {conf['swir_valid_before']})")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="belt_sausar")
    parser.add_argument("--count-only", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    auth.init()
    if args.count_only:
        count(args.aoi)
        return 0
    export(args.aoi, dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
