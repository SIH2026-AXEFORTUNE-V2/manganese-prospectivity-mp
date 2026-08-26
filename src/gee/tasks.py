"""Monitor Earth Engine export tasks.

    python -m src.gee.tasks              # current status
    python -m src.gee.tasks --watch      # poll until everything settles
"""

from __future__ import annotations

import argparse
import time

import ee

from src.gee import auth

ACTIVE = {"PENDING", "RUNNING", "READY", "SUBMITTED"}


def snapshot(limit: int = 25) -> list[dict]:
    """Recent export operations, newest first."""
    rows = []
    for op in ee.data.listOperations()[:limit]:
        md = op.get("metadata", {})
        rows.append(
            {
                "name": op.get("name", ""),
                "state": md.get("state", "UNKNOWN"),
                "description": md.get("description", "?"),
                "progress": float(md.get("progress", 0) or 0),
                "error": (op.get("error") or {}).get("message", ""),
            }
        )
    return rows


def render(rows: list[dict]) -> tuple[int, int, int]:
    """Print a status table. Returns (active, done, failed) counts."""
    active = done = failed = 0
    print(f"{'STATE':<11}{'PROGRESS':>9}  DESCRIPTION")
    print("-" * 78)
    for r in rows:
        state = r["state"]
        if state in ACTIVE:
            active += 1
        elif state == "SUCCEEDED":
            done += 1
        elif state in {"FAILED", "CANCELLED"}:
            failed += 1
        print(f"{state:<11}{r['progress'] * 100:>8.0f}%  {r['description'][:52]}")
        if r["error"]:
            print(f"{'':<11}{'':>9}  ERROR: {r['error'][:70]}")
    print("-" * 78)
    print(f"{active} active, {done} succeeded, {failed} failed/cancelled")
    return active, done, failed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--watch", action="store_true", help="poll until nothing is active")
    parser.add_argument("--interval", type=int, default=60, help="seconds between polls")
    parser.add_argument("--limit", type=int, default=25)
    args = parser.parse_args()

    auth.init()

    while True:
        rows = snapshot(args.limit)
        active, _, failed = render(rows)
        if not args.watch or not active:
            # Non-zero exit if anything failed, so this can gate a sync step.
            return 1 if failed else 0
        print(f"\nre-checking in {args.interval}s...\n")
        time.sleep(args.interval)


if __name__ == "__main__":
    raise SystemExit(main())
