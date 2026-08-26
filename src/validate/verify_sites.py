"""Check candidate mine coordinates against Sentinel-2 imagery.

WHAT THIS DOES AND DOES NOT ESTABLISH
    It confirms a *location*: is there a visible mine/excavation where OSM or MOIL
    says one is? It does NOT confirm the commodity. Bare ground looks the same
    whether it sits on manganese, coal or basalt - commodity comes from the source
    attribution (OSM tags, MOIL disclosures), never from the pixels.

    That distinction matters because these points are the blind-validation set. If
    the coordinates were *chosen* by spectral anomaly, validating a spectral anomaly
    detector against them would be circular. They are not: sources name the sites,
    and this script only asks whether the coordinate is in the right spot.

METHOD
    For each candidate, compare a 300 m disc against a 3-8 km background annulus on
    the multi-year dry-season composite. A working open-cut shows sharply lower NDVI
    and higher bare-soil index than its surroundings. Underground mines show a much
    weaker signal - which is expected, not a failure, and is flagged rather than
    treated as a rejection.

    python -m src.validate.verify_sites --candidates data/interim/candidate_sites.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import ee

from src.config import ROOT, cfg, dry_season_range
from src.gee import auth
from src.gee.common import dry_season_month_filter

SITE_RADIUS_M = 300
BACKGROUND_INNER_M = 3000
BACKGROUND_OUTER_M = 8000


def probe(lon: float, lat: float, start: str, end: str) -> dict:
    """Site-vs-background statistics for one candidate.

    Deliberately lean: only the four bands the three indices need, and a single
    dry season rather than the full multi-year stack. Reusing the full
    build_composite here (10 bands, 9 indices, 7 seasons) exceeds Earth Engine's
    per-request memory limit. This is a location check, not the training surface -
    it does not need that depth.
    """
    point = ee.Geometry.Point([lon, lat])
    local = point.buffer(BACKGROUND_OUTER_M + 500).bounds()

    conf = cfg()["gee"]["sentinel2"]
    needed = ["B2", "B4", "B8", "B11"]

    s2 = (
        ee.ImageCollection(conf["collection"])
        .filterBounds(local)
        .filterDate(start, end)
        .filter(dry_season_month_filter())
    )
    cs = ee.ImageCollection(conf["cloud_score"])
    band, thresh = conf["cloud_score_band"], conf["cloud_score_threshold"]

    def mask(img: ee.Image) -> ee.Image:
        return (
            img.select(needed)
            .multiply(conf["scale_factor"])
            .updateMask(img.select(band).gte(thresh))
        )

    composite = s2.linkCollection(cs, [band]).map(mask).median()

    ndvi = composite.normalizedDifference(["B8", "B4"]).rename("NDVI")
    bsi = (
        composite.select("B11").add(composite.select("B4"))
        .subtract(composite.select("B8").add(composite.select("B2")))
    ).divide(
        composite.select("B11").add(composite.select("B4"))
        .add(composite.select("B8")).add(composite.select("B2"))
    ).rename("BSI")
    iron = composite.select("B4").divide(composite.select("B2")).rename("IRON_OXIDE")
    stats = ee.Image.cat([ndvi, bsi, iron])

    site = point.buffer(SITE_RADIUS_M)
    background = point.buffer(BACKGROUND_OUTER_M).difference(
        point.buffer(BACKGROUND_INNER_M), maxError=50
    )
    return {
        "site": stats.reduceRegion(ee.Reducer.median(), site, 20, maxPixels=1e9),
        "background": stats.reduceRegion(ee.Reducer.median(), background, 20, maxPixels=1e9),
    }


def verify(candidates: list[dict]) -> list[dict]:
    # Two recent dry seasons: enough for a clean composite, cheap enough to run.
    start = dry_season_range(2023)[0]
    end = dry_season_range(2025)[1]
    results = []

    for cand in candidates:
        print(f"  probing {cand['name'][:40]}...", flush=True)
        r = ee.Dictionary(probe(cand["lon"], cand["lat"], start, end)).getInfo()
        site, bg = r["site"], r["background"]
        ndvi_drop = (bg.get("NDVI") or 0) - (site.get("NDVI") or 0)
        bsi_rise = (site.get("BSI") or 0) - (bg.get("BSI") or 0)

        # Thresholds are deliberately loose. They separate "clearly disturbed" from
        # "indistinguishable from surroundings"; they are not a mine classifier.
        if ndvi_drop > 0.12 and bsi_rise > 0.03:
            signal = "STRONG"
        elif ndvi_drop > 0.05 or bsi_rise > 0.015:
            signal = "WEAK"
        else:
            signal = "NONE"

        results.append(
            {
                **cand,
                "ndvi_site": round(site.get("NDVI") or 0, 4),
                "ndvi_background": round(bg.get("NDVI") or 0, 4),
                "ndvi_drop": round(ndvi_drop, 4),
                "bsi_rise": round(bsi_rise, 4),
                "surface_signal": signal,
            }
        )
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--candidates", default="data/interim/candidate_sites.json",
        help="JSON list of {name, lon, lat, source, mine_type}",
    )
    parser.add_argument("--out", default="data/interim/site_verification.json")
    args = parser.parse_args()

    path = Path(args.candidates)
    if not path.is_absolute():
        path = ROOT / path
    candidates = json.loads(path.read_text(encoding="utf-8"))

    auth.init()
    print(f"Probing {len(candidates)} candidate sites against the S2 dry-season composite\n")
    results = verify(candidates)

    print(f"{'site':<22}{'type':<12}{'NDVI site':>10}{'bg':>8}{'drop':>8}{'BSI+':>8}  signal")
    print("-" * 82)
    for r in results:
        print(
            f"{r['name'][:21]:<22}{r.get('mine_type','?')[:11]:<12}"
            f"{r['ndvi_site']:>10.3f}{r['ndvi_background']:>8.3f}"
            f"{r['ndvi_drop']:>8.3f}{r['bsi_rise']:>8.3f}  {r['surface_signal']}"
        )

    out = ROOT / args.out
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(f"\nwrote {out.relative_to(ROOT)}")
    print(
        "\nNOTE: WEAK/NONE is expected for underground mines - the orebody is at depth\n"
        "      and surface disturbance is limited to headgear, dumps and plant."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
