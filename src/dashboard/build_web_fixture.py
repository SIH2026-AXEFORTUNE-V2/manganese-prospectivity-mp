"""Convert today's belt-only dashboard bundle into the web/ data contract.

WHY THIS EXISTS
    docs/04-data-contract.md is what the three build seats agreed to read and write. This
    script is the bridge: it takes the existing `dashboard/assets/bundle.json` (built by
    `src/dashboard/build_assets.py`, already correct) and re-shapes it into the contract's
    file layout under `web/public/data/`, so Seat 1 and Seat 2 have real, non-fabricated
    numbers to build against from day one instead of waiting on statewide tiling.

    This is a FIXTURE, not the final pipeline. It ships `static_image` (one PNG per layer,
    belt-only), never `tiles`. Statewide XYZ tiling is a separate, not-yet-built step -
    see docs/04-data-contract.md and the "tiling" issue in docs/issues/.

    python -m src.dashboard.build_web_fixture
"""

from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone

from src.config import ROOT

BUNDLE = ROOT / "dashboard" / "assets" / "bundle.json"
ASSETS = ROOT / "dashboard" / "assets"
OUT = ROOT / "web" / "public" / "data"

# Public depth figures only - never guess. Balaghat's -383 m is publicly documented
# (MOIL's own disclosures); every other known site stays depth_m: null until someone
# sources it. See docs/04-data-contract.md's rule against fabricated numbers.
KNOWN_DEPTH_M = {
    "Balaghat / Bharveli": 383,
}


def main() -> int:
    if not BUNDLE.exists():
        print(f"missing {BUNDLE.relative_to(ROOT)} - run `python -m src.dashboard.build_assets` first")
        return 1

    bundle = json.loads(BUNDLE.read_text(encoding="utf-8"))
    OUT.mkdir(parents=True, exist_ok=True)

    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "aoi": "belt_sausar",
        "bounds": None,
        "layers": {},
        "terrain": {"static_grid": None, "terrain_rgb_tiles": None, "elevation_range_m": None},
        "vectors": {
            "mines": "mines.geojson",
            "negatives": "negatives.geojson",
            "clusters": "clusters.geojson",
            "targets": "targets.geojson",
        },
        "validation": "validation.json",
        "risk": "risk.json",
    }

    print("Layers:")
    all_bounds = []
    for key, meta in bundle.get("layers", {}).items():
        src_png = ASSETS / meta["file"]
        if not src_png.exists():
            print(f"  {key}: MISSING {src_png.name}, skipping")
            continue
        shutil.copyfile(src_png, OUT / meta["file"])
        manifest["layers"][key] = {
            "static_image": meta["file"],
            "tiles": None,
            "bounds": meta["bounds"],
            "value_range": [0, 1],
        }
        all_bounds.append(meta["bounds"])
        print(f"  {key}: {meta['file']}")

    if all_bounds:
        w = min(b[0] for b in all_bounds)
        s = min(b[1] for b in all_bounds)
        e = max(b[2] for b in all_bounds)
        n = max(b[3] for b in all_bounds)
        manifest["bounds"] = [w, s, e, n]

    terrain = bundle.get("terrain") or {}
    if terrain:
        (OUT / "terrain.json").write_text(json.dumps(terrain, separators=(",", ":")), encoding="utf-8")
        manifest["terrain"]["static_grid"] = "terrain.json"
        manifest["terrain"]["elevation_range_m"] = [terrain.get("min"), terrain.get("max")]
        print(f"Terrain: {terrain.get('width')}x{terrain.get('height')} grid")
    else:
        print("Terrain: MISSING (3D view will have nothing to render)")

    print("\nVectors:")
    mines = bundle.get("mines", {"type": "FeatureCollection", "features": []})
    for feat in mines.get("features", []):
        props = feat.setdefault("properties", {})
        props.setdefault("mine_type", "unknown")
        props["depth_m"] = KNOWN_DEPTH_M.get(props.get("name"))
    for name, gj_key, fname in [
        ("mines", "mines", "mines.geojson"),
        ("negatives", "negatives", "negatives.geojson"),
        ("clusters", "clusters", "clusters.geojson"),
        ("targets", "targets", "targets.geojson"),
    ]:
        gj = mines if name == "mines" else bundle.get(gj_key, {"type": "FeatureCollection", "features": []})
        (OUT / fname).write_text(json.dumps(gj, separators=(",", ":")), encoding="utf-8")
        print(f"  {fname}: {len(gj.get('features', []))} features")

    validation = bundle.get("validation", {})
    (OUT / "validation.json").write_text(json.dumps(validation, separators=(",", ":")), encoding="utf-8")
    print(f"\nValidation: {'present' if validation else 'MISSING'}")

    # risk.json has no source yet - src/validate/risk_rules.py doesn't exist (see
    # docs/issues/04-risk-rules.md). Ship an empty, contract-shaped array rather than
    # nothing, so the frontend's loader code has a real (if empty) file to point at.
    if not (OUT / "risk.json").exists():
        (OUT / "risk.json").write_text("[]", encoding="utf-8")
        print("Risk: [] placeholder written - see docs/issues/04-risk-rules.md")

    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"\nwrote {(OUT / 'manifest.json').relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
