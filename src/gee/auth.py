"""Earth Engine authentication and initialisation.

Since 2024 Earth Engine requires a Google Cloud project. Set it once:

    setx EE_PROJECT your-gcp-project-id       (Windows, new shell after)
    export EE_PROJECT=your-gcp-project-id     (bash)

First-time setup, which opens a browser:

    python -m src.gee.auth --authenticate

Thereafter:

    python -m src.gee.auth        # verifies the connection
"""

from __future__ import annotations

import argparse
import os
import sys

import ee

PROJECT_ENV_VAR = "EE_PROJECT"


def get_project() -> str:
    project = os.environ.get(PROJECT_ENV_VAR, "").strip()
    if not project:
        raise RuntimeError(
            f"{PROJECT_ENV_VAR} is not set.\n"
            "Earth Engine needs a Google Cloud project (free for non-commercial use).\n"
            "  1. Create/pick a project at https://console.cloud.google.com/\n"
            "  2. Register it at https://code.earthengine.google.com/register\n"
            f"  3. setx {PROJECT_ENV_VAR} your-project-id   then open a new shell"
        )
    return project


def init(quiet: bool = True) -> str:
    """Initialise the EE client. Returns the project id."""
    project = get_project()
    try:
        ee.Initialize(project=project)
    except Exception as exc:  # noqa: BLE001 - surface the real cause to the user
        raise RuntimeError(
            f"Earth Engine init failed for project {project!r}: {exc}\n"
            "If this is the first run: python -m src.gee.auth --authenticate"
        ) from exc
    if not quiet:
        print(f"Earth Engine initialised on project: {project}")
    return project


def authenticate() -> None:
    """Interactive browser-based auth. Only needed once per machine."""
    ee.Authenticate()
    print("Authentication complete.")


def _self_test() -> None:
    """Round-trip a trivial computation to prove the connection really works."""
    value = ee.Number(26009).multiply(2).getInfo()
    assert value == 52018, f"unexpected round-trip result: {value}"
    n_s2 = (
        ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
        .filterDate("2024-11-01", "2024-11-08")
        .filterBounds(ee.Geometry.Point([80.19, 21.81]))  # Balaghat area
        .size()
        .getInfo()
    )
    print(f"  round-trip OK")
    print(f"  Sentinel-2 scenes near Balaghat, 01-08 Nov 2024: {n_s2}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--authenticate",
        action="store_true",
        help="run the interactive browser auth flow (first-time setup)",
    )
    args = parser.parse_args()

    if args.authenticate:
        authenticate()

    try:
        init(quiet=False)
        _self_test()
    except RuntimeError as exc:
        print(f"\nERROR: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
