"""Inline the asset bundle into a single self-contained dashboard HTML.

The Artifact CSP blocks every external host except Google Fonts, so the score PNGs
cannot be referenced as files - they have to travel inside the document as data URIs.
Palette PNGs keep that affordable: three overlays at ~570 KB each become ~2.3 MB of
base64, against a 16 MB ceiling.

    python -m src.dashboard.inline
"""

from __future__ import annotations

import base64
import json

from src.config import ROOT

DASH = ROOT / "dashboard"
ASSETS = DASH / "assets"


def main() -> int:
    template = (DASH / "index.template.html").read_text(encoding="utf-8")
    bundle = json.loads((ASSETS / "bundle.json").read_text(encoding="utf-8"))

    images = {}
    for key, meta in (bundle.get("layers") or {}).items():
        path = ASSETS / meta["file"]
        if not path.exists():
            print(f"  WARNING: {meta['file']} missing")
            continue
        raw = base64.b64encode(path.read_bytes()).decode()
        images[key] = f"data:image/png;base64,{raw}"
        print(f"  {key}: {len(raw) / 1e6:.2f} MB base64")

    html = template.replace("__BUNDLE__", json.dumps(bundle, separators=(",", ":")))
    html = html.replace("__IMAGES__", json.dumps(images))

    dest = DASH / "index.html"
    dest.write_text(html, encoding="utf-8")
    mb = dest.stat().st_size / 1e6
    print(f"\nwrote {dest.relative_to(ROOT)}  ({mb:.2f} MB)")
    if mb > 15:
        print("  WARNING: over 15 MB - close to the 16 MB Artifact ceiling")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
