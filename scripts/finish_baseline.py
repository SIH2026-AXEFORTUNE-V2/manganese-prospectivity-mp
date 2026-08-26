"""Wait for the pending exports, re-download them, then run the full validation.

Blocks until the TERRAIN and ASTER re-exports finish, replaces the stale local
copies, verifies the bands that were previously broken are now populated, and runs
src.validate.score at full resolution.

    python -m scripts.finish_baseline
"""

from __future__ import annotations

import subprocess
import sys
import time

import numpy as np
import rasterio

import ee

from src.config import ROOT
from src.gee import auth

WATCH = ("TERRAIN_glo30_belt_sausar", "ASTER_swir_minerals_belt_sausar_pre2008")
POLL_SECONDS = 90
MAX_WAIT_SECONDS = 3 * 60 * 60

# Bands that came back all-NaN in the first terrain export.
TERRAIN_REPAIRED = ["slope", "aspect_sin", "aspect_cos",
                    "hillshade_000", "hillshade_045", "hillshade_090", "hillshade_135"]


def pending_states() -> dict[str, tuple[str, float]]:
    """Newest operation per watched description."""
    newest: dict[str, tuple[str, float, str]] = {}
    for op in ee.data.listOperations():
        md = op.get("metadata", {})
        desc = md.get("description", "")
        if desc not in WATCH:
            continue
        start = md.get("startTime", "")
        if desc not in newest or start > newest[desc][2]:
            newest[desc] = (md.get("state", "?"), md.get("progress", 0.0), start)
    return {k: (v[0], v[1]) for k, v in newest.items()}


def wait_for_exports() -> bool:
    waited = 0
    while waited < MAX_WAIT_SECONDS:
        states = pending_states()
        line = "  ".join(f"{d.split('_')[0]}={s} {p*100:.0f}%" for d, (s, p) in states.items())
        print(f"[{waited//60:>3} min] {line}", flush=True)

        if states and all(s in ("SUCCEEDED", "FAILED", "CANCELLED") for s, _ in states.values()):
            failed = [d for d, (s, _) in states.items() if s != "SUCCEEDED"]
            if failed:
                print(f"ERROR: these did not succeed: {failed}")
                return False
            return True

        time.sleep(POLL_SECONDS)
        waited += POLL_SECONDS

    print(f"ERROR: exports still unfinished after {MAX_WAIT_SECONDS//3600}h")
    return False


def run(cmd: list[str]) -> int:
    print(f"\n$ {' '.join(cmd)}", flush=True)
    return subprocess.call([sys.executable, "-m", *cmd], cwd=ROOT)


def verify_terrain() -> bool:
    path = ROOT / "data" / "raw" / "gee" / "TERRAIN_glo30_belt_sausar.tif"
    with rasterio.open(path) as src:
        window = rasterio.windows.Window(4000, 1500, 200, 200)
        bad = []
        for i, desc in enumerate(src.descriptions, 1):
            if desc not in TERRAIN_REPAIRED:
                continue
            arr = src.read(i, window=window).astype("float64")
            finite = float(np.isfinite(arr).mean())
            print(f"    {desc:<16} finite={finite*100:>5.1f}%")
            if finite < 0.5:
                bad.append(desc)
    if bad:
        print(f"  STILL BROKEN: {bad}")
        return False
    print("  all previously-empty terrain bands are now populated")
    return True


def main() -> int:
    auth.init()
    print("Waiting for TERRAIN and ASTER re-exports...\n")
    if not wait_for_exports():
        return 1

    print("\nBoth exports succeeded. Replacing stale local copies.")
    gee_dir = ROOT / "data" / "raw" / "gee"
    for name in WATCH:
        stale = gee_dir / f"{name}.tif"
        if stale.exists():
            stale.unlink()
            print(f"  removed stale {stale.name}")

    for name in WATCH:
        prefix = name.split("_")[0]
        if run(["src.gee.sync_drive", "--match", prefix]) != 0:
            print(f"ERROR: download failed for {prefix}")
            return 1

    print("\nVerifying the terrain bands that were empty before:")
    if not verify_terrain():
        return 1

    print("\n" + "=" * 78)
    print("FULL-RESOLUTION VALIDATION")
    print("=" * 78)
    return run(["src.validate.score", "--permutations", "25"])


if __name__ == "__main__":
    raise SystemExit(main())
