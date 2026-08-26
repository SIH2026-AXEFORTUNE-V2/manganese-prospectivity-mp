"""Assemble the blind-validation occurrence set from refined candidates.

Turns data/interim/site_refined.json into the two files validation consumes:

    data/validation/known_mn_occurrences.geojson   manganese sites (the positives)
    data/validation/negative_control_mines.geojson non-manganese mines

WHY THE NEGATIVE CONTROLS MATTER
    A coal pit and a manganese pit look near-identical from orbit - both are bare
    excavated ground. The Kamptee coal mine scores as strongly "disturbed" as any
    MOIL site. So if the model ranks Kamptee and Malanjkhand as highly as the
    manganese mines, it has learned to find HOLES, not manganese, and the headline
    number is worthless.

    Scoring these separately is what turns a nice-looking result into an honest one.

CONFIDENCE
    high   external source names both operator and commodity, or names the mine
           explicitly with corroborating infrastructure
    medium external source names the locality (MOIL postal address, village) and
           imagery confirms workings there, but the exact lease is unconfirmed

    Every site carries its source string. None of this is a substitute for GSI
    Bhukosh or IBM tenement data - it is the best that open sources support.

    python -m src.validate.assemble_occurrences
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from src.config import ROOT, cfg

# Provenance, assigned from how the site was identified - not from imagery.
CONFIDENCE = {
    "Balaghat (Bharveli)": ("high", "MOIL"),
    "Chikla": ("high", "MOIL"),
    "Tirodi": ("high", "MOIL"),
    "Dongri Buzurg": ("medium", "MOIL"),
    "Ukwa": ("medium", "MOIL"),
    "Munsar": ("medium", "MOIL"),
    "Mansar": ("medium", "MOIL"),
    "Kandri (Nagpur)": ("medium", "MOIL"),
    "Satak": ("medium", "MOIL"),
}

# Renames where the source name is not the mine name.
RENAME = {
    "Satak": "Beldongri (via Satak P.O.)",
    "Balaghat (Bharveli)": "Balaghat / Bharveli",
    "Kandri (Nagpur)": "Kandri",
}

MAX_OFFSET_M = 2000


def build(refined: list[dict]) -> tuple[list[dict], list[dict]]:
    positives, negatives = [], []

    for r in refined:
        name = r["name"]
        is_negative = r.get("tier") == "NEG"
        lon, lat = r["refined_lon"], r["refined_lat"]

        # An offset beyond the sanity threshold means the search probably locked
        # onto a neighbouring pit; keep the source coordinate instead.
        offset_ok = r["offset_m"] <= MAX_OFFSET_M
        if not offset_ok:
            lon, lat = r["lon"], r["lat"]

        props = {
            "name": RENAME.get(name, name).replace(" (COPPER - negative control)", "")
                                          .replace(" (COAL - negative control)", ""),
            "mine_type": r.get("mine_type", "unknown"),
            "source": r["source"],
            "coord_refined": offset_ok,
            "offset_from_source_m": r["offset_m"],
            "ndvi_drop_vs_background": r["refined_ndvi_drop"],
        }

        feature = {
            "type": "Feature",
            "properties": props,
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
        }

        if is_negative:
            props["commodity"] = "copper" if "COPPER" in name else "coal"
            props["role"] = "negative_control"
            negatives.append(feature)
        else:
            confidence, operator = CONFIDENCE.get(name, ("low", "unknown"))
            props["commodity"] = "manganese"
            props["operator"] = operator
            props["confidence"] = confidence
            props["verified"] = confidence in ("high", "medium")
            positives.append(feature)

    return positives, negatives


def write(features: list[dict], path: Path, name: str, note: str) -> None:
    payload = {
        "type": "FeatureCollection",
        "name": name,
        "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3/CRS84"}},
        "_note": note,
        "features": features,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"  {len(features):>2} features -> {path.relative_to(ROOT)}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refined", default="data/interim/site_refined.json")
    args = parser.parse_args()

    refined = json.loads((ROOT / args.refined).read_text(encoding="utf-8"))
    positives, negatives = build(refined)

    conf = cfg()["validation"]
    vdir = ROOT / conf["dir"]

    write(
        positives,
        vdir / conf["occurrences_file"],
        "known_mn_occurrences",
        "HELD OUT. Never read by training code. Coordinates derived from OSM/MOIL "
        "attribution then snapped to the strongest non-water bare-ground signature "
        "within 1.5 km. Commodity comes from source attribution, never from pixels.",
    )
    write(
        negatives,
        vdir / "negative_control_mines.geojson",
        "negative_control_mines",
        "Non-manganese mines. If the model ranks these as highly as the manganese "
        "sites it has learned to detect excavation, not manganese.",
    )

    print("\nManganese sites by confidence:")
    for level in ("high", "medium", "low"):
        names = [f["properties"]["name"] for f in positives
                 if f["properties"]["confidence"] == level]
        if names:
            print(f"  {level:<7} {len(names)}  {', '.join(names)}")

    print(
        "\nThese are open-source derived, not official. GSI Bhukosh or IBM tenement\n"
        "data would upgrade every 'medium' to 'high' and should be obtained if the\n"
        "result is going to be defended publicly."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
