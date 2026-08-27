# Issue 4 — Risk-tier rules engine

**Seat:** 3 · Pipeline & data contract
**Depends on:** nothing. **Blocks** issue #5 (Protect lane UI has nothing to show without this).

## Why, and the one thing to get right

**There is no MOIL production or equipment data anywhere in this project.** Read the gap
analysis this whole plan came from before writing a line of code here: the honest, buildable
version of the Protect lane is a **rule threshold over climate variables**, not a trained
model, and the UI must say so — see `dashboard/index.template.html`'s Production Risk
placeholder copy: *"Showing an invented risk curve would be worse than showing nothing."*
This issue is what turns that placeholder into something real, without pretending it's more
than it is.

## Current state

- `src/gee/climate_series.py` already pulls CHIRPS rainfall, SMAP soil moisture, MODIS LST,
  and NDVI **per mine site**, exported as CSV (`python -m src.gee.climate_series --sites
  data/validation/known_mn_occurrences.geojson`). Run it if the CSVs don't exist yet under
  `data/processed/` — check there first.
- `web/public/data/risk.json` currently exists as an empty placeholder (`[]`), written by
  `src/dashboard/build_web_fixture.py`.
- The contract shape for each entry is fully specified in
  [../04-data-contract.md](../04-data-contract.md) under `risk.json` — follow it exactly,
  the frontend (issue #5) is built against that shape already.

## Task

1. Create `src/validate/risk_rules.py`. This is the **one place** threshold logic lives —
   nothing in the frontend computes a risk tier, ever.
2. Define thresholds explicitly and document *why* each one is where it is (a comment citing
   a rough real-world rationale — e.g. "sustained soil moisture above X over Y days precedes
   haul-road flooding" — is enough; this doesn't need a literature review, it needs to not be
   an arbitrary magic number with no explanation).
3. For each of the 11 operating mines (`data/validation/known_mn_occurrences.geojson` plus
   whatever full list exists — MOIL's own 11: Kandri, Munsar, Beldongri, Gumgaon, Chikla,
   Balaghat, Ukwa, Dongri Buzurg, Sitapatore, Tirodi — check
   `data/validation/known_mn_occurrences.geojson` for which of these are already present with
   coordinates and add any missing), compute:
   - `risk_tier`: `"normal"` | `"watch"` | `"critical"`
   - `risk_reasons`: a list of short strings explaining *which* threshold(s) fired (e.g.
     `"soil_moisture above 30-day threshold for 4 consecutive days"`) — never return a tier
     with an empty reasons list except for `"normal"`
4. Write the output to match `risk.json`'s exact shape from the contract, including the raw
   `series` (so the frontend can draw the ribbon chart in issue #5, not just show the final
   tier).
5. Wire this into `src/dashboard/build_web_fixture.py` (replace the `[]` placeholder branch)
   so a normal fixture rebuild produces real risk data.

## Acceptance criteria

- [ ] `python -m src.validate.risk_rules` (or wherever you wire the entry point) produces a
      `risk.json` with one entry per operating mine, matching the contract shape exactly
      (field names, types)
- [ ] Every threshold has a one-line comment explaining its rationale
- [ ] At least one mine in the sample data lands in `"watch"` or `"critical"` — if the
      thresholds are set so loosely that everything is always `"normal"`, the feature is
      pointless; tune them against the real CSV data until they discriminate
- [ ] Re-running `python -m src.dashboard.build_web_fixture` overwrites the `[]` placeholder
      with real data
- [ ] Nothing here touches `data/validation/` as an input in a way that violates the
      held-out rule — climate covariates are fair game (see
      [../02-modelling-plan.md](../02-modelling-plan.md)'s "what we are NOT doing" section);
      the Mn occurrence *labels* are not
