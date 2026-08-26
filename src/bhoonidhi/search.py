"""Bhoonidhi catalogue search client.

Wraps POST /bhoonidhi/ProductSearch, the undocumented JSON endpoint behind the
Bhoonidhi UI. Contract was captured live on 2026-08-25; see
docs/bhoonidhi-data-inventory.md section 1 for the full field reference.

IMPORTANT - this is a CATALOGUE api, not a data api. It returns scene metadata
only: ids, footprints, dates, product codes. No pixels. Downloading still means
cart -> confirm -> authenticated per-product call through the browser. This module
produces the manifest that drives that manual step.

Auth: needs a logged-in session. Two values must be supplied, both obtainable from
devtools while logged into the portal:
    BHOONIDHI_USER_ID   e.g. ONL_xxxxxxx     (the userId field in any request body)
    BHOONIDHI_SRT       e.g. 20260825_XXXnnnnnn  (rotates per session)
    BHOONIDHI_COOKIE    the full Cookie header from any authenticated request

    python -m src.bhoonidhi.search --product Sentinel-2A_MSI_Level-2A --aoi mp_bbox
    python -m src.bhoonidhi.search --verify        # regression-check reference counts
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

import pandas as pd
import requests

from src.config import ROOT, aoi_bounds, cfg, out_dir

MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]


class BhoonidhiAuthError(RuntimeError):
    pass


def _credentials() -> tuple[str, str, str]:
    user_id = os.environ.get("BHOONIDHI_USER_ID", "").strip()
    srt = os.environ.get("BHOONIDHI_SRT", "").strip()
    cookie = os.environ.get("BHOONIDHI_COOKIE", "").strip()
    missing = [
        name
        for name, value in (
            ("BHOONIDHI_USER_ID", user_id),
            ("BHOONIDHI_SRT", srt),
            ("BHOONIDHI_COOKIE", cookie),
        )
        if not value
    ]
    if missing:
        raise BhoonidhiAuthError(
            f"Missing environment variables: {', '.join(missing)}\n\n"
            "To obtain them:\n"
            "  1. Log in at https://bhoonidhi.nrsc.gov.in/bhoonidhi/index.html\n"
            "  2. Open devtools > Network, run any search\n"
            "  3. Find the ProductSearch request. Copy userId and srt from the payload,\n"
            "     and the Cookie header from the request headers.\n"
            "  4. Set them as environment variables (the srt token rotates each session)."
        )
    return user_id, srt, cookie


def to_bhoonidhi_date(value: str) -> str:
    """ISO YYYY-MM-DD -> the portal's MON/D/YYYY format."""
    dt = datetime.strptime(value, "%Y-%m-%d")
    return f"{MONTHS[dt.month - 1]}/{dt.day}/{dt.year}"


def build_payload(
    products: list[str],
    aoi: str,
    start: str,
    end: str,
    offset: int,
    user_id: str,
    srt: str,
    *,
    low_cloud: bool = False,
) -> dict[str, str]:
    """Construct one ProductSearch request body.

    Quirk worth knowing: several values are URL-encoded *inside* the JSON body -
    the portal's own client encodes them before serialising, and the server expects
    that double treatment. Sending clean values gets a "Range [0, ...]" error.

    Kept separate from search() so it can be diffed against a real captured request.
    """
    conf = cfg()["bhoonidhi"]
    min_lon, min_lat, max_lon, max_lat = aoi_bounds(aoi)

    if "-" in start:
        start = to_bhoonidhi_date(start)
    if "-" in end:
        end = to_bhoonidhi_date(end)

    filters: dict[str, dict[str, str]] = {}
    if low_cloud:
        # The cloud filter is binary only - "1" means 0-10%, "0" means any.
        # There is no numeric threshold, and no per-scene cloud % in the response.
        filters = {p: {"CLOUD": conf["cloud_filter_low"]} for p in products}

    return {
        "userId": user_id,
        "prod": "Standard",
        "selSats": quote(",".join(products), safe=""),
        "offset": str(offset),
        "sdate": quote(start, safe=""),
        "edate": quote(end, safe=""),
        "query": "area",
        "queryType": "polygon",
        "isMX": "No",
        "tllat": f"{max_lat}",
        "tllon": f"{min_lon}",
        "brlat": f"{min_lat}",
        "brlon": f"{max_lon}",
        "filters": quote(json.dumps(filters, separators=(",", ":")), safe=""),
        "srt": srt,
    }


def search(
    products: list[str],
    aoi: str,
    start: str,
    end: str,
    *,
    low_cloud: bool = False,
    page_size: int | None = None,
    max_pages: int = 200,
    session: requests.Session | None = None,
) -> list[dict]:
    """Page through every matching scene. Returns raw result records.

    `start`/`end` accept either ISO dates or the portal's MON/D/YYYY form.
    """
    conf = cfg()["bhoonidhi"]
    page_size = page_size or conf["page_size"]

    if len(products) > conf["max_sensors_per_search"]:
        raise ValueError(
            f"Bhoonidhi allows at most {conf['max_sensors_per_search']} sensors per search, "
            f"got {len(products)}. Split the request."
        )

    user_id, srt, cookie = _credentials()

    sess = session or requests.Session()
    sess.headers.update(
        {
            "Content-Type": "application/json",
            "Cookie": cookie,
            "Referer": "https://bhoonidhi.nrsc.gov.in/bhoonidhi/index.html",
            "User-Agent": "Mozilla/5.0 (SIH26009 research pipeline)",
        }
    )

    results: list[dict] = []
    offset = 0

    for _ in range(max_pages):
        payload = build_payload(
            products, aoi, start, end, offset, user_id, srt, low_cloud=low_cloud
        )

        response = sess.post(conf["endpoint"], data=json.dumps(payload), timeout=120)
        if response.status_code == 401 or "login" in response.text[:200].lower():
            raise BhoonidhiAuthError(
                "Session rejected. The srt token or cookie has expired - re-capture both."
            )
        response.raise_for_status()

        try:
            page = response.json()
        except ValueError as exc:
            raise RuntimeError(
                f"Non-JSON response at offset {offset}: {response.text[:200]}"
            ) from exc

        batch = page.get("Results") or []
        results.extend(batch)
        print(f"    offset {offset:>6}: {len(batch):>4} scenes  (total {len(results)})")

        if len(batch) < page_size:
            break
        offset += page_size
        time.sleep(0.4)  # be polite to a government portal

    return results


KEEP_COLUMNS = [
    "ID", "FILENAME", "DIRPATH", "SATELLITE", "SENSOR", "DOP", "TILE_ID",
    "PRODCODE", "PRODTYPE", "PRICED", "IMAGING_ORBIT_NO", "PASS_TYPE",
    "ImgCrnNWLat", "ImgCrnNWLon", "ImgCrnNELat", "ImgCrnNELon",
    "ImgCrnSELat", "ImgCrnSELon", "ImgCrnSWLat", "ImgCrnSWLon",
    "OverLapPercent", "QUALITY_SCORE",
]


def to_manifest(results: list[dict], path: Path) -> pd.DataFrame:
    """Write a scene manifest CSV. This is what feeds the cart step."""
    frame = pd.DataFrame(results)
    if not frame.empty:
        present = [c for c in KEEP_COLUMNS if c in frame.columns]
        frame = frame[present]
    path.parent.mkdir(parents=True, exist_ok=True)
    frame.to_csv(path, index=False)
    print(f"  wrote {len(frame)} rows -> {path.relative_to(ROOT)}")
    return frame


def verify_reference_counts() -> int:
    """Re-run the exact searches recorded in the inventory doc and compare.

    A mismatch means the payload encoding or the srt token handling has drifted,
    and every other search in this module is suspect.
    """
    conf = cfg()["bhoonidhi"]
    ref = conf["reference_counts"]
    window = ref["window"]

    checks = [
        (
            "sentinel2_l2a_any_cloud",
            ["Sentinel-2A_MSI_Level-2A", "Sentinel-2B_MSI_Level-2A", "Sentinel-2C_MSI_Level-2A"],
            False,
        ),
        (
            "sentinel2_l2a_low_cloud",
            ["Sentinel-2A_MSI_Level-2A", "Sentinel-2B_MSI_Level-2A", "Sentinel-2C_MSI_Level-2A"],
            True,
        ),
        ("landsat_8_9_l1", ["LandSat-8_OLI+TIRS_L1", "LandSat-9_OLI+TIRS_L1"], False),
        ("cartodem_30m", ["CartoSat-1_PAN_CartoDEM-30m"], False),
    ]

    failures = 0
    for key, products, low_cloud in checks:
        expected = ref[key]
        print(f"  {key}: expecting {expected}")
        actual = len(
            search(products, "mp_bbox", window["start"], window["end"], low_cloud=low_cloud)
        )
        status = "OK" if actual == expected else "MISMATCH"
        if actual != expected:
            failures += 1
        print(f"    got {actual}  [{status}]\n")

    if failures:
        print(
            f"{failures} of {len(checks)} checks failed.\n"
            "The archive does grow over time, so small upward drift on recent windows is\n"
            "expected. A large or downward change means the payload encoding is wrong."
        )
    else:
        print("All reference counts match the 2026-08-25 survey.")
    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--product", action="append", help="sensor key; repeat for several")
    parser.add_argument("--aoi", default="mp_bbox")
    parser.add_argument("--start", help="YYYY-MM-DD or MON/D/YYYY")
    parser.add_argument("--end", help="YYYY-MM-DD or MON/D/YYYY")
    parser.add_argument("--low-cloud", action="store_true", help="restrict to 0-10%% cloud")
    parser.add_argument("--all-configured", action="store_true", help="search every product in datasets.yaml")
    parser.add_argument("--verify", action="store_true", help="regression-check reference counts")
    args = parser.parse_args()

    try:
        if args.verify:
            return 1 if verify_reference_counts() else 0

        conf = cfg()["bhoonidhi"]
        window = conf["reference_counts"]["window"]
        start = args.start or window["start"]
        end = args.end or window["end"]
        manifest_dir = out_dir("raw", "bhoonidhi", "manifests")

        if args.all_configured:
            for entry in conf["products"]:
                key, aoi = entry["key"], entry["aoi"]
                print(f"{key}  [{entry['priority']}]  aoi={aoi}")
                results = search([key], aoi, start, end, low_cloud=args.low_cloud)
                safe = key.replace("/", "_").replace("(", "").replace(")", "").replace("+", "")
                to_manifest(results, manifest_dir / f"{safe}_{aoi}.csv")
            return 0

        if not args.product:
            print("ERROR: pass --product, --all-configured or --verify")
            return 1

        print(f"Searching {', '.join(args.product)} over {args.aoi}  {start} -> {end}")
        results = search(args.product, args.aoi, start, end, low_cloud=args.low_cloud)
        safe = "_".join(args.product)[:60].replace("/", "_").replace("(", "").replace(")", "").replace("+", "")
        to_manifest(results, manifest_dir / f"{safe}_{args.aoi}.csv")
        return 0

    except BhoonidhiAuthError as exc:
        print(f"\nAUTH ERROR\n{exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
