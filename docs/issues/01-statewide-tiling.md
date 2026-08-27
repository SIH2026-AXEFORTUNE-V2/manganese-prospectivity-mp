# Issue 1 — Statewide tiling

**Seat:** 3 · Pipeline & data contract
**Depends on:** nothing, but is the highest-leverage issue in the whole build — every other
seat is capped at "belt demo" until this ships.

## Why

`dashboard/assets/bundle.json` (and the `web/public/data/` fixture built from it) ships one
flat PNG per score layer, sized for the belt (~270 km). That approach caps out completely at
statewide scale — a single image covering Madhya Pradesh at 20 m would be enormous and the
browser would have to download all of it just to look at one district. See
[../02-modelling-plan.md](../02-modelling-plan.md) step 7 and
[../04-data-contract.md](../04-data-contract.md)'s note on `static_image` vs `tiles`.

The fix is standard web-mapping practice: cut the raster into an XYZ tile pyramid so the
browser only ever fetches the tiles on screen at the current zoom.

## Current state

- `src/models/predict.py` already runs statewide inference in principle
  (`python -m src.models.predict --aoi mp_state`) but tiles the *scoring* into windows for
  memory reasons — it still writes one big output GeoTIFF at the end. Read that file before
  starting; don't duplicate its windowing logic.
- Nothing in the repo converts a GeoTIFF into XYZ tiles yet.

## Task

1. Run the statewide prediction if it hasn't been run yet:
   ```bash
   python -m src.models.predict --aoi mp_state
   ```
   This is slow and produces a large file under `data/processed/`. Expect it to take a while;
   don't kill it early.

2. Add `rio-tiler` and `rio-cogeo` to `requirements.txt`, then write
   `src/dashboard/build_tiles.py`:
   - Convert the output GeoTIFF to a Cloud-Optimized GeoTIFF (COG) with `rio-cogeo`.
   - Generate an XYZ PNG tile pyramid from the COG with `rio-tiler` (or shell out to
     `gdal2tiles.py` if that's simpler to get working — either is fine, document which one
     you used and why in the script's docstring, matching the style of every other script in
     `src/`).
   - Write tiles to `web/public/tiles/{layer}/{z}/{x}/{y}.png` for each of `fused`,
     `signature`, `anomaly`.
   - Colour-map each layer the same way `src/dashboard/build_assets.py`'s `raster_to_png`
     does (`inferno` for fused/signature, `viridis` for anomaly, 2nd–99.5th percentile
     stretch) — reuse that function, don't reimplement the colour ramp.

3. Update `src/dashboard/build_web_fixture.py` (or a new statewide equivalent) so
   `manifest.json`'s `layers.<name>.tiles` is set to `"/tiles/<name>/{z}/{x}/{y}.png"` and
   `static_image` is `null` for the statewide case, per the contract's rule ("exactly one of
   `static_image` or `tiles` is non-null").

4. Do the same for terrain: `terrain_rgb_tiles`, using the **Mapbox terrain-RGB encoding**
   (`height = -10000 + ((R * 256 * 256 + G * 256 + B) * 0.1)`) so deck.gl's `TerrainLayer` can
   read it directly via its built-in `elevationDecoder` — this is what issue #2 needs.

## Acceptance criteria

- [ ] `web/public/tiles/fused/{z}/{x}/{y}.png` exists for a reasonable zoom range (start with
      z6–z12, expand later if it's too coarse)
- [ ] `manifest.json`'s `aoi` field says `"mp_state"`, `tiles` is populated, `static_image` is
      `null`, and `bounds` covers the whole state
- [ ] Loading `web/src/components/CommandMap.tsx` unmodified still works against this new
      manifest — if it doesn't, the contract wasn't followed; fix the tiling output, not the
      frontend component (that's the whole point of freezing the contract)
- [ ] Total `web/public/tiles/` size is sane to commit or documented as excluded from git
      (large binary tile sets usually don't belong in git — if that's the call, say so in the
      PR and where the tiles are actually hosted instead, e.g. Vercel Blob or a static bucket)

## Don't

- Don't change `manifest.json`'s field *names* — only fill in `tiles` and null out
  `static_image`. If you think a name needs to change, stop and update
  [../04-data-contract.md](../04-data-contract.md) first, in the same commit, and say so to
  seats 1 and 2.
