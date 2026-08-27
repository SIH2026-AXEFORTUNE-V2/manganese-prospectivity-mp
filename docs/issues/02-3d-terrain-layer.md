# Issue 2 — Georeferenced 3D terrain

**Seat:** 1 · Geospatial
**Depends on:** nothing to start (build against the belt fixture's `terrain.json`); swap to
`terrain_rgb_tiles` once issue #1 ships them.

## Why

The old static dashboard (`dashboard/index.template.html`) has a hand-rolled WebGL terrain
view that works, but its mesh is a normalised −1…1 tile with no real coordinates — it can't be
pinned against a basemap, can't show a target's true lat/lon, and can't extend past one belt.
8 of MOIL's 11 mines are underground, so a prospectivity score only means something once you
can see it sitting on the actual ridge above the actual workings — see the userflow review
this plan came out of.

## Current state

- `web/src/components/CommandMap.tsx` is the working 2D map: MapLibre base map + a deck.gl
  `BitmapLayer` draping the fused score + `GeoJsonLayer`s for targets and mines. **Extend this
  file, don't replace it or start a second map component.**
- `web/public/data/terrain.json` exists (belt-only): `{width, height, bounds, min, max, data}`
  where `data` is a base64-encoded `Uint16Array` heightmap, min/max-normalised. This is the
  same blob format the old dashboard uses (`decodeTerrain()` in
  `dashboard/index.template.html`) — read that function to understand the encoding before
  writing a decoder here.
- `web/public/data/mines.geojson` already carries `mine_type` and `depth_m` per the contract
  (`depth_m` is `383` for Balaghat, `null` for everyone else until someone sources more real
  figures — see `KNOWN_DEPTH_M` in `src/dashboard/build_web_fixture.py`. **Never invent a
  depth figure that isn't sourced.**

## Task

1. Add `@deck.gl/geo-layers`'s `TerrainLayer` to `CommandMap.tsx`, alongside the existing
   `BitmapLayer`/`GeoJsonLayer`s (all three run in the same `MapboxOverlay`).
2. For now, build the terrain layer from `terrain.json`'s heightmap directly (decode the
   base64 `Uint16Array`, same approach as `decodeTerrain()` in the old dashboard) and drape
   the same score PNG as its texture. This gets you real georeferencing immediately, because
   `terrain.json`'s `bounds` are real lat/lon — use them, don't normalise to −1…1 like the old
   version did.
3. Add a toggle (reuse the pattern already in `TopNav.tsx` or add a sibling control) between
   the flat map and the terrain view — `pitch`/`bearing` on the MapLibre camera plus swapping
   which deck.gl layers are active is enough; you don't need two separate map instances.
4. Add a vertical-exaggeration control (a slider, matching the old dashboard's
   `$('exag').oninput` behaviour) that scales the terrain layer's `elevationScale` prop.
5. Render mine markers at their true elevation, and for `mine_type === "underground"` with a
   non-null `depth_m`, draw a small marker or label offset *below* the surface point showing
   the depth (e.g. "▼ 383 m") — a simple annotation is enough, a true 3D cutaway mesh is
   issue #8, not this one.
6. **Once issue #1 ships `terrain_rgb_tiles`:** switch this layer to deck.gl's built-in
   Mapbox-terrain-RGB support (`elevationDecoder` on `TerrainLayer` pointed at the tile
   template) instead of the single heightmap blob. This is a follow-up PR to this same file,
   not a new component.

## A real bug you will otherwise lose time to

Turbopack (and Webpack) can't statically resolve the `new Worker(...)` call maplibre-gl makes
internally — the worker 404s silently (served the app's HTML shell instead of JS), so **no
tiles ever render and there is no console error**, just a blank map. This is already fixed in
`CommandMap.tsx` via `setWorkerUrl("/maplibre-gl-worker.mjs")` plus a copy of the worker file
at `web/public/maplibre-gl-worker.mjs`. If you ever bump the `maplibre-gl` package version,
re-run:
```bash
cp web/node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs web/public/maplibre-gl-worker.mjs
```
and you're fine. If the map ever looks blank again, check `console.error` for `"MapLibre
error:"` first — that handler is already wired up in `CommandMap.tsx`.

## Acceptance criteria

- [ ] Toggling to 3D shows the belt terrain, textured with the fused score, tilted and
      orbitable
- [ ] The view is built from real lat/lon bounds — verify by checking that a known mine's
      marker sits at the correct location relative to the terrain, not just "somewhere in the
      middle"
- [ ] Vertical exaggeration slider visibly changes relief
- [ ] Balaghat's marker shows a depth annotation; every other underground mine shows nothing
      if it has no sourced `depth_m` (no placeholder numbers)
- [ ] `npm run build --prefix web` is clean
