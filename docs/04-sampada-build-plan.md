# SAMPADA — build plan

Two pillars joined by a closed loop. Prediction becomes a plan; reality corrects
the prediction.

```
  Pillar 1 (geologist)                        Pillar 2 (mine planner)
  prospectivity surface                       monthly target
        |                                           |
        v                                           v
  block model  ---------------------------->  mining sequence
   (t, grade, confidence)                           |
        ^                                           v
        |                                     daily actuals
        +--------- grade truth feedback <-----------+
```

---

## What already exists, and what it becomes

| Built | Role in SAMPADA |
|---|---|
| GEE acquisition (68 bands, 6 products) | Engine 1 satellite half |
| `models/signature.py`, `models/anomaly.py` | Engine 2 core |
| `validate/score.py` — LOCO, negative controls, p-value | Engine 2 sanity gates + scorecard seed |
| `models/targets.py` | Feeds G7 target list |
| `dashboard/` | Becomes the Pillar-1 lens of the shared spine |

**Deliberate divergence from the spec.** The plan calls for XGBoost on positives vs
background. We already have a validated unsupervised design (p = 0.040, negative
controls at chance) built precisely because 9 labels cannot support a supervised
classifier — with 5 effective spatial folds, a gradient-boosted model would overfit
and its AUC-PR would be noise. The spec's *reasoning* is right and is already
honoured: spatial-block CV, no raw accuracy, sanity gates. Supervised training
switches on when GSI Bhukosh raises the label count; the interface is unchanged.

---

## The honesty problem, and how it is solved

MOIL's production registers are not public. The spec says demo on synthetic data.
That is correct, but synthetic data invented end-to-end teaches nothing and a
mining-literate judge will smell it.

**So: real physics, synthetic ledger.**

| Layer | Source |
|---|---|
| Rainfall per mine, daily | **Real** — CHIRPS via Earth Engine |
| Soil moisture | **Real** — SMAP |
| Block grades | **Real** — from our own prospectivity + grade model |
| Production tonnage, downtime, blasts | **Synthetic**, seeded, generated *from* the real rainfall |

Rain-days are real. When the waterfall says "rain cost 2,100 t", the rain is
genuine CHIRPS data for that mine on those dates; only the tonnage response is
modelled. Every synthetic record carries `synthetic: true` and the UI never
displays one without a marker.

---

## Engines to build

### Engine 1 — Ingestion (`src/ingest/`)
- `schemas.py` — the §3 input contracts as typed schemas, one place
- `reason_codes.py` — the fixed picklist. **This is the highest-leverage decision
  in the whole spec**: free-text downtime is unmodellable, a picklist is a feature
  vector on day one
- `harmonize.py` — fuzzy column mapping + confirm payload; unit-sanity checks
  (grade as fraction vs percent, pH x10, -32768 sentinels, UTM vs lat/lon)

### Engine 3 — Block model (`src/reserve/`)
- `blocks.py` — probability surface + grade interpolation -> blocks carrying
  tonnage, grade, and a confidence class. Tonnage is always a **range**.
- This is the join: Pillar 2's re-sequencing advice is only credible because a
  block model says Bench-5 is richer.

### Engine 4 — Shortfall (`src/shortfall/`)
- `forecast.py` — month-end projection with a band, from MTD actuals, days
  remaining, fleet state, forecast rain
- `attribution.py` — decompose the gap into named causes, tonnage each
- `actions.py` — corrective actions as objects: recovery, cost, lead time,
  owner, approval level

### The loop (`src/loop/`)
- `feedback.py` — mined grade per block becomes a label; confidence class
  upgrades; scorecard recomputes

---

## Build order (spec §9, adjusted for what exists)

1. **Reason codes + schemas** — small, unblocks everything downstream
2. **Real climate pull** — CHIRPS/SMAP per mine (script exists, never run)
3. **Synthetic registers** driven by that real rainfall
4. **Forecaster + driver waterfall** — spec priority 2
5. **Corrective actions + tracker** — spec priority 3
6. **Block model** — spec priority 4, and the pillar join
7. **Loop + scorecard** — spec priority 6
8. **Dashboard v2** — two personas, one spatial spine

Drill-program planner (priority 5) and exports/RBAC (7) are last and may be cut.

---

## Metrics rule, carried over

Never a headline accuracy on an imbalanced label. Report AUC-PR on the positive
class, run the spatial-clustering gate, show both on screen. Already enforced in
`validate/score.py`; extend the same rule to Pillar 2 (forecast error as MAPE
plus a band, never a single hero number).
