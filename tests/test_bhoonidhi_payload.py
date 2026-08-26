"""Regression test: our request body must match what the portal's own client sends.

The reference below is a verbatim capture of a real ProductSearch request made by
the Bhoonidhi web UI on 2026-08-25, intercepted by hooking XMLHttpRequest.send in
the page. If build_payload drifts from this, every search in the project silently
breaks - the server answers a malformed body with "Range [0, ...]" rather than a
clean error.

    python -m tests.test_bhoonidhi_payload
"""

from __future__ import annotations

import json

from src.bhoonidhi.search import build_payload

# Captured live from the portal UI, low-cloud filter active, first page.
CAPTURED = {
    "userId": "ONL_example123",
    "prod": "Standard",
    "selSats": "Sentinel-2A_MSI_Level-2A%2CSentinel-2B_MSI_Level-2A%2CSentinel-2C_MSI_Level-2A",
    "offset": "0",
    "sdate": "NOV%2F1%2F2024",
    "edate": "APR%2F30%2F2025",
    "query": "area",
    "queryType": "polygon",
    "isMX": "No",
    "tllat": "26.9",
    "tllon": "74.0",
    "brlat": "21.0",
    "brlon": "82.8",
    "filters": (
        "%7B%22Sentinel-2A_MSI_Level-2A%22%3A%7B%22CLOUD%22%3A%221%22%7D%2C"
        "%22Sentinel-2B_MSI_Level-2A%22%3A%7B%22CLOUD%22%3A%221%22%7D%2C"
        "%22Sentinel-2C_MSI_Level-2A%22%3A%7B%22CLOUD%22%3A%221%22%7D%7D"
    ),
    "srt": "20260825_AAA000000",
}

PRODUCTS = [
    "Sentinel-2A_MSI_Level-2A",
    "Sentinel-2B_MSI_Level-2A",
    "Sentinel-2C_MSI_Level-2A",
]


def test_payload_matches_capture() -> None:
    generated = build_payload(
        PRODUCTS,
        aoi="mp_bbox",
        start="NOV/1/2024",
        end="APR/30/2025",
        offset=0,
        user_id=CAPTURED["userId"],
        srt=CAPTURED["srt"],
        low_cloud=True,
    )

    mismatches = {
        key: (CAPTURED[key], generated.get(key))
        for key in CAPTURED
        if CAPTURED[key] != generated.get(key)
    }
    assert not mismatches, f"payload drift: {json.dumps(mismatches, indent=2)}"
    assert set(generated) == set(CAPTURED), (
        f"field set differs: extra={set(generated) - set(CAPTURED)}, "
        f"missing={set(CAPTURED) - set(generated)}"
    )


def test_iso_dates_are_converted() -> None:
    generated = build_payload(
        PRODUCTS, "mp_bbox", "2024-11-01", "2025-04-30", 0, "u", "s", low_cloud=True
    )
    assert generated["sdate"] == CAPTURED["sdate"]
    assert generated["edate"] == CAPTURED["edate"]


def test_no_cloud_filter_gives_empty_object() -> None:
    generated = build_payload(PRODUCTS, "mp_bbox", "NOV/1/2024", "APR/30/2025", 0, "u", "s")
    assert generated["filters"] == "%7B%7D", generated["filters"]


def test_bbox_corners_are_not_swapped() -> None:
    """tllat is the TOP (max) latitude and brlat the BOTTOM (min) - easy to invert."""
    generated = build_payload(PRODUCTS, "mp_bbox", "NOV/1/2024", "APR/30/2025", 0, "u", "s")
    assert float(generated["tllat"]) > float(generated["brlat"])
    assert float(generated["tllon"]) < float(generated["brlon"])


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"  PASS  {name}")
            except AssertionError as exc:
                failures += 1
                print(f"  FAIL  {name}\n        {exc}")
    print(f"\n{'all passed' if not failures else f'{failures} failed'}")
    raise SystemExit(1 if failures else 0)
