# Issue 3 — Evidence & Validation panels

**Seat:** 2 · Product surface
**Depends on:** nothing (targets/validation data already ship in the M0 fixture)

## Why

Right now clicking a target card in `TargetRail` does nothing except sit there looking good.
The old dashboard's whole credibility argument — this is the actual USP, see the plan
artifacts — lives in two panels it has and this app doesn't yet: **Evidence** (why this one
target scored the way it did) and **Validation** (why the model should be trusted at all).
Read `dashboard/index.template.html`'s `renderEvidence()` / `renderValidation()` functions for
the exact numbers and wording the old version used — don't reinvent the copy, port it.

## Current state

- `web/src/lib/contract.ts` has `TargetProperties` and `ValidationReport` types already
  matching the real data (see [../04-data-contract.md](../04-data-contract.md)).
- `web/src/lib/useOreCompassData.ts` already fetches `targets` and `validation` once at the
  page level.
- `web/src/components/TargetRail.tsx` renders the cards but has no click handler and no
  selected state.
- There is no side panel / drawer component yet.

## Task

1. Add selection state to `web/src/app/page.tsx` (`useState<number | null>` for the selected
   target's `rank`), pass a click handler down to `TargetRail`.
2. Build `web/src/components/EvidencePanel.tsx`: given the selected target's
   `TargetProperties`, show:
   - Centroid, area, mean/max score, rank
   - Whether it's flagged `near_non_mn_mine` (surface it, don't hide it — see the contract's
     note on that field)
   - The fixed 0.7/0.3 signature/anomaly fusion split (this is a constant today, not
     per-target — say so plainly, the way the old dashboard's copy does: *"Fusion weights are
     fixed, not per-target. Per-feature attribution needs a SHAP pass over the full band
     stack, which is not yet built."*)
3. Build `web/src/components/ValidationPanel.tsx` reading `ValidationReport`:
   - Leave-one-cluster-out bars from `validation.loco` (cluster name, `heldout_pct` as the
     bar, `negatives_pct` as a reference tick — port the old dashboard's SVG bar approach or
     use a simple `<div>` width-percentage bar, your call)
   - Capture-efficiency table from `capture_signature` / `capture_anomaly` / `capture_fused`
     (top5/top10/top20 vs the fixed chance values 5/10/20, with the lift ratio computed
     client-side, same as `dashboard/index.template.html`'s `capRows`)
   - `heldout_pct_mean ± heldout_pct_sd`, `permutation_p`, `n_features`, `dropped.length`
4. Wire both panels into a tab or side-drawer UI reachable from a selected target — doesn't
   have to be a modal, a slide-over panel matching the glass aesthetic is fine.

## Acceptance criteria

- [ ] Clicking any target card opens Evidence for that specific target, with real numbers
      (verify against `web/public/data/targets.geojson` directly if unsure)
- [ ] Validation panel numbers match `web/public/data/validation.json` exactly — don't
      recompute anything the report already contains, and use the same `negatives_pct`
      average as `web/src/components/StatCards.tsx` already does (import that helper rather
      than writing a second copy)
- [ ] The "fusion weights are fixed" caveat and any other honesty notes from the old
      dashboard are preserved, not dropped for looking nicer
- [ ] `npm run build --prefix web` is clean
