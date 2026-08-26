"""Snap named mine coordinates onto the actual workings.

Village names, post offices, mine hospitals and OSM polygon centroids all land
*near* a mine rather than *on* it. A centroid is especially misleading: the OSM
"MOIL Chikala Mines" polygon includes the company's social-forestry plantation, so
its centre sits on trees, not on the pit.

This searches a small radius around each named coordinate for the strongest
excavation signature and reports the offset.

IS THIS CIRCULAR? No, and the distinction is worth being precise about.
    The *identity* of every site comes from an external source - an OSM tag naming
    MOIL, a MOIL postal address, a USGS record. This step only refines WHERE within
    that named locality the workings sit. It never promotes an unnamed bright spot
    into a mine, and it never asserts a commodity.

    Validation still scores on the halo ring with the pit excised, so the refined
    centre is used to *exclude* ground more accurately, not to score it.

    python -m src.validate.refine_sites
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import ee

from src.config import ROOT, cfg, dry_season_range
from src.gee import auth
from src.gee.common import dry_season_month_filter

SEARCH_RADIUS_M = 1500   # tight: Munsar/Mansar/Kandri lie within ~3 km of each other
BACKGROUND_INNER_M = 3000
BACKGROUND_OUTER_M = 8000


def _indices(region: ee.Geometry, start: str, end: str) -> ee.Image:
    conf = cfg()["gee"]["sentinel2"]
    needed = ["B2", "B3", "B4", "B8", "B11"]   # B3 is needed by NDWI
    band, thresh = conf["cloud_score_band"], conf["cloud_score_threshold"]

    s2 = (
        ee.ImageCollection(conf["collection"])
        .filterBounds(region)
        .filterDate(start, end)
        .filter(dry_season_month_filter())
    )
    cs = ee.ImageCollection(conf["cloud_score"])

    def mask(img: ee.Image) -> ee.Image:
        return (
            img.select(needed)
            .multiply(conf["scale_factor"])
            .updateMask(img.select(band).gte(thresh))
        )

    c = s2.linkCollection(cs, [band]).map(mask).median()
    ndvi = c.normalizedDifference(["B8", "B4"]).rename("NDVI")
    ndwi = c.normalizedDifference(["B3", "B8"]).rename("NDWI")
    bsi = (
        c.select("B11").add(c.select("B4")).subtract(c.select("B8").add(c.select("B2")))
    ).divide(
        c.select("B11").add(c.select("B4")).add(c.select("B8")).add(c.select("B2"))
    ).rename("BSI")
    return ee.Image.cat([ndvi, ndwi, bsi])


def snap(cand: dict, start: str, end: str) -> dict:
    """Find the most strongly excavated spot within SEARCH_RADIUS_M.

    Targets maximum BARE SOIL INDEX among non-water pixels - not minimum NDVI.

    Minimum NDVI is the obvious choice and it is wrong: NDVI goes NEGATIVE over
    water, so it ranks every pond, reservoir and flooded mine void above any dry
    excavation. An earlier version of this function did exactly that and snapped
    three different mines onto one shared water body.
    """
    point = ee.Geometry.Point([cand["lon"], cand["lat"]])
    search = point.buffer(SEARCH_RADIUS_M)
    region = point.buffer(BACKGROUND_OUTER_M + 500).bounds()

    idx = _indices(region, start, end)

    # Water mask: NDWI catches open water, the NDVI floor catches dark wet ground
    # and cloud shadow that NDWI misses.
    land = idx.select("NDWI").lt(0.0).And(idx.select("NDVI").gt(0.02))

    # Smooth, so a single bright roof or road cannot outrank a real working.
    smooth = idx.select("BSI").updateMask(land).focal_median(radius=60, units="meters")

    max_bsi = smooth.reduceRegion(
        ee.Reducer.max(), search, 20, maxPixels=1e9
    ).get("BSI")

    brightest = smooth.gte(ee.Number(max_bsi).subtract(0.02)).selfMask()
    centroid = ee.Image.pixelLonLat().updateMask(brightest).reduceRegion(
        ee.Reducer.mean(), search, 20, maxPixels=1e9
    )

    # NDVI at the chosen spot, for a like-for-like comparison with the background.
    ndvi_here = idx.select("NDVI").updateMask(brightest).reduceRegion(
        ee.Reducer.median(), search, 20, maxPixels=1e9
    ).get("NDVI")

    background = point.buffer(BACKGROUND_OUTER_M).difference(
        point.buffer(BACKGROUND_INNER_M), maxError=50
    )
    return ee.Dictionary(
        {
            "snap_lon": centroid.get("longitude"),
            "snap_lat": centroid.get("latitude"),
            "max_bsi": max_bsi,
            "site_ndvi": ndvi_here,
            "bg_ndvi": idx.select("NDVI").reduceRegion(
                ee.Reducer.median(), background, 20, maxPixels=1e9
            ).get("NDVI"),
        }
    ).getInfo()


def haversine_m(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    from math import asin, cos, radians, sin, sqrt

    r = 6371000.0
    dlon, dlat = radians(lon2 - lon1), radians(lat2 - lat1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return 2 * r * asin(sqrt(a))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidates", default="data/interim/candidate_sites.json")
    parser.add_argument("--out", default="data/interim/site_refined.json")
    parser.add_argument("--only", nargs="*", help="refine only these site names")
    args = parser.parse_args()

    path = ROOT / args.candidates
    candidates = json.loads(path.read_text(encoding="utf-8"))
    if args.only:
        wanted = {n.lower() for n in args.only}
        candidates = [c for c in candidates if c["name"].lower() in wanted]

    auth.init()
    start, end = dry_season_range(2023)[0], dry_season_range(2025)[1]

    print(f"{'site':<24}{'offset m':>9}{'max BSI':>9}{'NDVI':>8}{'bg':>8}{'drop':>8}  refined lon,lat")
    print("-" * 92)
    out = []
    for cand in candidates:
        r = snap(cand, start, end)
        if r.get("snap_lon") is None:
            print(f"{cand['name'][:23]:<24}   no valid pixels")
            continue
        offset = haversine_m(cand["lon"], cand["lat"], r["snap_lon"], r["snap_lat"])
        drop = (r["bg_ndvi"] or 0) - (r["site_ndvi"] or 0)
        print(
            f"{cand['name'][:23]:<24}{offset:>9.0f}{r['max_bsi']:>9.3f}"
            f"{r['site_ndvi']:>8.3f}{r['bg_ndvi']:>8.3f}{drop:>8.3f}"
            f"  {r['snap_lon']:.5f},{r['snap_lat']:.5f}"
        )
        out.append(
            {
                **cand,
                "refined_lon": round(r["snap_lon"], 6),
                "refined_lat": round(r["snap_lat"], 6),
                "offset_m": round(offset, 1),
                "refined_max_bsi": round(r["max_bsi"], 4),
                "refined_site_ndvi": round(r["site_ndvi"], 4),
                "refined_bg_ndvi": round(r["bg_ndvi"], 4),
                "refined_ndvi_drop": round(drop, 4),
            }
        )

    dest = ROOT / args.out
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(f"\nwrote {dest.relative_to(ROOT)}")
    print(
        "\nA large offset means the source coordinate named a village, post office or\n"
        "polygon centroid rather than the workings. Sanity-check anything over ~2 km -\n"
        "the search may have locked onto a different pit entirely."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
