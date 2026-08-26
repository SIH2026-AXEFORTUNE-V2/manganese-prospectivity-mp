"""A1 - Sentinel-2 dry-season surface-reflectance composites.

The core dataset. Dry season only (Nov-Apr): minimum vegetation, minimum cloud,
maximum rock exposure - which is what matters when the target is lithology and
alteration rather than land cover.

Cloud masking uses Cloud Score+, which supersedes the older s2cloudless
COPERNICUS/S2_CLOUD_PROBABILITY collection and handles haze and cirrus far better.

    python -m src.gee.s2_composite --aoi belt_sausar
    python -m src.gee.s2_composite --aoi belt_sausar --per-season
    python -m src.gee.s2_composite --aoi mp_state --tiled
"""

from __future__ import annotations

import argparse

import ee

from src.config import cfg, dry_season_range, dry_seasons, full_dry_span
from src.gee import auth
from src.gee.common import (
    analysis_region,
    degree_tiles,
    dry_season_month_filter,
    scale_to_int16,
    submit_export,
)


def _masked_collection(region: ee.Geometry, start: str, end: str) -> ee.ImageCollection:
    """Cloud-masked S2 SR over a region and date span, restricted to dry-season months."""
    conf = cfg()["gee"]["sentinel2"]

    s2 = (
        ee.ImageCollection(conf["collection"])
        .filterBounds(region)
        .filterDate(start, end)
        .filter(dry_season_month_filter())  # keeps Nov,Dec,Jan,Feb,Mar,Apr
    )
    cs = ee.ImageCollection(conf["cloud_score"])
    linked = s2.linkCollection(cs, [conf["cloud_score_band"]])

    threshold = conf["cloud_score_threshold"]
    band = conf["cloud_score_band"]
    scale_factor = conf["scale_factor"]
    bands = conf["bands"]

    def mask(img: ee.Image) -> ee.Image:
        clear = img.select(band).gte(threshold)
        return (
            img.select(bands)
            .multiply(scale_factor)
            .updateMask(clear)
            .copyProperties(img, ["system:time_start"])
        )

    return linked.map(mask)


def _add_indices(img: ee.Image) -> ee.Image:
    """Alteration and vegetation indices computed in-place on the composite.

    These are the standard band ratios for ferruginous/altered terrain. Manganese
    itself has no strong absorption feature in 400-2500nm, so it is targeted
    indirectly via gossan capping, Mn-rich laterite and iron-oxide alteration.
    """
    iron_oxide = img.select("B4").divide(img.select("B2")).rename("IRON_OXIDE")
    ferrous = img.select("B11").divide(img.select("B8")).rename("FERROUS")
    ferrous_silicate = img.select("B12").divide(img.select("B8A")).rename("FERROUS_SILICATE")
    clay = img.select("B11").divide(img.select("B12")).rename("CLAY_HYDROXYL")
    gossan = iron_oxide.multiply(clay).rename("GOSSAN")

    # Mn oxides are spectrally DARK across the visible-NIR rather than showing a
    # diagnostic absorption feature. This pairs that darkness with iron enrichment,
    # which is the signature of Mn-rich ferruginous capping.
    # (Deliberately not B11/B12 again - that is already CLAY_HYDROXYL above.)
    vis_albedo = (
        img.select("B2").add(img.select("B3")).add(img.select("B4")).divide(3)
    )
    mn_dark = iron_oxide.divide(vis_albedo.add(1e-6)).rename("MN_DARK_FERRUGINOUS")

    ndvi = img.normalizedDifference(["B8", "B4"]).rename("NDVI")
    ndwi = img.normalizedDifference(["B3", "B8"]).rename("NDWI")
    # Bare-rock proxy: high SWIR, low NIR-red contrast.
    bsi = (
        img.select("B11").add(img.select("B4")).subtract(img.select("B8").add(img.select("B2")))
    ).divide(
        img.select("B11").add(img.select("B4")).add(img.select("B8")).add(img.select("B2"))
    ).rename("BSI")

    return img.addBands(
        [iron_oxide, ferrous, ferrous_silicate, clay, gossan, mn_dark, ndvi, ndwi, bsi]
    )


def build_composite(
    region: ee.Geometry, start: str, end: str, *, with_indices: bool = True
) -> ee.Image:
    """Median dry-season composite, optionally with alteration indices appended."""
    collection = _masked_collection(region, start, end)
    composite = collection.median()
    if with_indices:
        composite = _add_indices(composite)
    return composite.clip(region)


def export_multiyear(aoi: str, *, dry_run: bool = False, tiled: bool = False) -> None:
    """Multi-year dry-season median. This is the primary training surface."""
    region = analysis_region(aoi)
    start, end = full_dry_span()
    conf = cfg()["gee"]["sentinel2"]

    print(f"Sentinel-2 multi-year dry-season median: {aoi}  {start} -> {end}")

    if tiled:
        for tile_id, tile_geom in degree_tiles(aoi):
            geom = tile_geom.intersection(region, maxError=100)
            image = build_composite(geom, start, end)
            submit_export(
                scale_to_int16(image),
                f"S2_dryseason_median_{aoi}_{tile_id}",
                geom,
                conf["scale_m"],
                dry_run=dry_run,
            )
    else:
        image = build_composite(region, start, end)
        submit_export(
            scale_to_int16(image),
            f"S2_dryseason_median_{aoi}_multiyear",
            region,
            conf["scale_m"],
            dry_run=dry_run,
        )


def export_per_season(aoi: str, *, dry_run: bool = False) -> None:
    """One composite per dry season. Used for change detection and mine monitoring."""
    region = analysis_region(aoi)
    conf = cfg()["gee"]["sentinel2"]

    for season in dry_seasons():
        start, end = dry_season_range(season)
        print(f"Sentinel-2 season {season}/{season + 1}: {start} -> {end}")
        image = build_composite(region, start, end)
        submit_export(
            scale_to_int16(image),
            f"S2_dryseason_median_{aoi}_{season}",
            region,
            conf["scale_m"],
            dry_run=dry_run,
        )


def export_10m(aoi: str, *, dry_run: bool = False) -> None:
    """10 m RGB+NIR for the belt only - mine footprint and dump mapping."""
    region = analysis_region(aoi)
    conf = cfg()["gee"]["sentinel2"]
    start, end = full_dry_span()

    image = build_composite(region, start, end, with_indices=False).select(conf["bands_10m"])
    submit_export(
        scale_to_int16(image),
        f"S2_dryseason_median_{aoi}_multiyear_10m",
        region,
        10,
        dry_run=dry_run,
    )


def scene_count(aoi: str) -> None:
    """Report how many usable scenes back each composite. Run before exporting."""
    region = analysis_region(aoi)
    print(f"Usable Sentinel-2 scenes over {aoi} by dry season:")
    total = 0
    for season in dry_seasons():
        start, end = dry_season_range(season)
        n = _masked_collection(region, start, end).size().getInfo()
        total += n
        print(f"  {season}/{season + 1}: {n:>6}")
    print(f"  {'total':>9}: {total:>6}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="belt_sausar", help="AOI name from config/aoi.geojson, or mp_state")
    parser.add_argument("--per-season", action="store_true", help="one composite per dry season")
    parser.add_argument("--ten-metre", action="store_true", help="also export 10m RGB+NIR")
    parser.add_argument("--tiled", action="store_true", help="cut the export into 1-degree tiles")
    parser.add_argument("--count-only", action="store_true", help="report scene counts, export nothing")
    parser.add_argument("--dry-run", action="store_true", help="print what would be exported")
    args = parser.parse_args()

    auth.init()

    if args.count_only:
        scene_count(args.aoi)
        return 0

    export_multiyear(args.aoi, dry_run=args.dry_run, tiled=args.tiled)
    if args.per_season:
        export_per_season(args.aoi, dry_run=args.dry_run)
    if args.ten_metre:
        export_10m(args.aoi, dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
