# Data contract — Python pipeline ↔ web app

**Owner: Seat 3.** Nobody else edits this file's shape without telling the other two seats —
every issue in `docs/issues/` assumes this contract is stable.

The pipeline (`src/gee`, `src/features`, `src/models`, `src/validate`) never talks to the web
app directly. It writes files; the web app only ever reads files. There is no live backend for
the map or the score data — see [00-project-plan.md](00-project-plan.md) and
[02-modelling-plan.md](02-modelling-plan.md) for why (rank-normalisation needs a fixed reference,
so scores can't be recomputed per-request anyway).

All files below live under `web/public/data/`. That directory is generated, not hand-edited —
regenerate it with `python -m src.dashboard.build_web_fixture` (belt-only fixture, works today)
or the statewide tiling script (issue #3, not built yet).

---

## `manifest.json` — the one file everything else hangs off

```jsonc
{
  "generated_at": "2026-08-27T00:00:00Z",
  "aoi": "belt_sausar",              // or "mp_state" once statewide tiling exists
  "bounds": [78.30, 21.28, 80.90, 22.32], // [west, south, east, north], EPSG:4326
  "layers": {
    "fused":     { "static_image": "score_fused.png",     "tiles": null, "bounds": [ /* w,s,e,n */ ], "value_range": [0, 1] },
    "signature": { "static_image": "score_signature.png", "tiles": null, "bounds": [ /* ... */ ],     "value_range": [0, 1] },
    "anomaly":   { "static_image": "score_anomaly.png",   "tiles": null, "bounds": [ /* ... */ ],     "value_range": [0, 1] }
  },
  "terrain": {
    "static_grid": "terrain.json",   // today's base64 uint16 blob — belt only
    "terrain_rgb_tiles": null,       // issue #3 target: "/tiles/terrain/{z}/{x}/{y}.png", Mapbox terrain-RGB encoding
    "elevation_range_m": [180, 620]
  },
  "vectors": {
    "mines": "mines.geojson",
    "negatives": "negatives.geojson",
    "clusters": "clusters.geojson",
    "targets": "targets.geojson"
  },
  "validation": "validation.json",
  "risk": "risk.json"
}
```

**Rule for `layers.*`:** exactly one of `static_image` or `tiles` is non-null at any time.
`static_image` is a single PNG covering the whole `bounds` — what the fixture ships today, fine
for the belt, **not valid for `mp_state`** (too large for one image, see
[docs/02-modelling-plan.md](02-modelling-plan.md)). `tiles` is an XYZ template string. The web
app must handle both — check which one is set, don't assume.

## `targets.geojson` — unchanged from today's `dashboard/assets/bundle.json`

FeatureCollection, EPSG:4326, one Feature per ranked target polygon. Properties:

| field | type | meaning |
|---|---|---|
| `rank` | int | 1 = highest fused score |
| `area_ha` | float | polygon area, hectares |
| `score_mean` | float | 0–1, fused score |
| `score_max` | float | 0–1 |
| `lat`, `lon` | float | centroid, EPSG:4326 |
| `near_non_mn_mine` | bool | true if within `KNOWN_BUFFER_M` of a negative-control mine — surface this in the UI, don't hide it |

## `mines.geojson` / `negatives.geojson` / `clusters.geojson` — unchanged from today

Same shape as `dashboard/assets/bundle.json`'s `mines` / `negatives` / `clusters` keys.
`mines.geojson` properties add two fields the current dashboard doesn't use yet:

| field | type | meaning |
|---|---|---|
| `mine_type` | `"underground"` \| `"opencast"` | drives whether a shaft-depth marker is drawn |
| `depth_m` | float \| null | e.g. 383 for Balaghat; null for opencast |

## `validation.json` — unchanged from today's `bundle.json["validation"]`

Whatever `data/processed/validation_report.json` contains — held-out percentile, negative
control score, permutation p-value, leave-one-cluster-out per-fold table, capture-efficiency
table. Read it, don't recompute it; it's the output of
[src/validate/score.py](../src/validate/score.py).

## `risk.json` — new, Seat 3 + Seat 2 own this together

One entry per operating mine (11 total). This is what the Protect lane reads. **No production
or equipment data exists in this project** — see the gap analysis this plan came out of — so
`risk_tier` here is a **rule threshold over climate variables only**, not a trained model.
Label it that way in the UI; do not imply it is more than it is.

```jsonc
[
  {
    "mine_id": "balaghat",
    "name": "Balaghat",
    "lat": 21.85, "lon": 80.23,
    "mine_type": "underground", "depth_m": 383,
    "series": [
      { "date": "2026-08-01", "rainfall_mm": 12.4, "soil_moisture": 0.31, "lst_c": 29.1, "ndvi": 0.42 }
      // one entry per day or per week — Seat 3 decides granularity, document it here once fixed
    ],
    "risk_tier": "watch",                 // "normal" | "watch" | "critical"
    "risk_reasons": ["soil_moisture above 30-day threshold for 4 consecutive days"]
  }
]
```

Thresholds live in one place — `src/validate/risk_rules.py` (to be created, issue #4) — not
scattered across the frontend. The frontend renders `risk_tier` and `risk_reasons`; it never
computes them.

---

## What changes this contract (and what doesn't)

- Adding a field to any object above: fine, additive, tell the other two seats in passing.
- Renaming or removing a field, or changing `static_image`/`tiles` semantics: **stop, message
  both other seats before writing the code**, then update this file in the same commit.
- Anything under `data/validation/`: never enters this contract. It is scoring input only —
  see the rule in [README.md](../README.md).
