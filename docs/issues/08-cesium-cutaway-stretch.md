# Issue 8 — Cesium cutaway view (stretch)

**Seat:** 1 · Geospatial
**Depends on:** [Issue 2](02-3d-terrain-layer.md) should be solid first. **Do not start this
before M0–M4 (see [00-milestones.md](00-milestones.md)) are done.** This is explicitly the one
call worth re-litigating only if there's time left over — see the build plan's stack-decision
table for why Cesium wasn't the default pick (SSR/worker/asset friction inside Next.js).

## Why

deck.gl's `TerrainLayer` (issue #2) gives an honest, georeferenced 3D surface, but it can't
show a true cutaway below ground — and 8 of MOIL's 11 mines are underground, so "what does
−383 m actually look like under this ridge" is a real storytelling gap a flat depth label
(issue #2's "▼ 383 m" marker) only gestures at.

## Task, if you get here

1. Add CesiumJS as a second, separate view — not a replacement for the deck.gl map. Use
   `next/dynamic` with `ssr: false` the same way `page.tsx` already loads `CommandMap`.
2. Expect friction: Cesium needs its static assets (workers, web assembly, textures) copied
   into `public/` — check Cesium's own Next.js/webpack integration docs for the current
   approach, it changes between versions.
3. Scope this to **one mine** (Balaghat, since it's the one sourced depth figure) rather than
   trying to generalise — a single well-built cutaway is a better demo than a half-built
   general system.
4. Use Cesium's terrain provider + a manually placed vertical cross-section or extruded shaft
   geometry at Balaghat's coordinates, labelled with the sourced −383 m figure. Do not
   fabricate the shape or extent of the actual underground workings — nobody in this project
   has that data; the point is showing *depth*, not a real mine-plan cutaway.

## Acceptance criteria

- [ ] A separate view/route shows Balaghat with a real terrain surface and a depth
      annotation reaching -383 m, clearly labelled as illustrative depth, not an actual mine
      plan
- [ ] Turning this off entirely (feature-flag or just not linking to the route) leaves the
      rest of the app fully working — this must never be a dependency for anything else
