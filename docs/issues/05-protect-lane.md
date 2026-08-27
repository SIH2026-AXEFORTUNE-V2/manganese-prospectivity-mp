# Issue 5 — Protect lane UI

**Seat:** 2 · Product surface
**Depends on:** [Issue 4](04-risk-rules.md) — `risk.json` needs real content, not the `[]`
placeholder, before this UI has anything to show.

## Why

`TopNav.tsx` already has an Explore/Protect switch, but Protect goes nowhere — `page.tsx`
only ever renders the Explore home screen. This is the other half of PS 26009's ask
("overcome production shortfalls"); see the userflow plan's two-lane structure.

## Current state

- `web/src/components/TopNav.tsx`: the switch exists, `onWorkspaceChange` callback exists,
  `page.tsx` holds `workspace` state but never branches on it.
- `web/src/lib/contract.ts` has the full `RiskEntry` type already.
- No route or component for Protect exists yet.

## Task

1. Add a new route: `web/src/app/protect/page.tsx` (or branch inside the existing home page
   on `workspace === "protect"` — either is fine, pick whichever is less code given how
   `TopNav` is wired; if you add a route, make `TopNav`'s switch use `next/link` /
   `router.push` instead of local state).
2. Fetch `risk.json` (extend `useOreCompassData.ts` to include it, following the same pattern
   as `targets`/`mines`/`validation` — one shared fetch, not a new one-off).
3. Build `web/src/components/MinePortfolioGrid.tsx`: 11 tiles, one per mine, coloured by
   `risk_tier` using the semantic tokens already in `globals.css` (`--good` / `--warn` /
   `--critical`) — **do not reuse `--accent-lime` for this**, semantic risk color is separate
   from the brand accent, same rule the design plan calls out.
4. Build `web/src/components/RiskRibbon.tsx`: a time-series chart per selected mine showing
   `rainfall_mm`, `soil_moisture`, `lst_c`, `ndvi` from `RiskEntry.series`, with a marked
   threshold line if convenient — doesn't need to be fancy, a set of small sparklines is
   enough for v1.
5. Show `risk_reasons` as plain text under the tier badge whenever tier isn't `"normal"` —
   this is the whole point of the field, don't ship a tier without its reasons visible.
6. Label this screen honestly: a small note near the top saying this is a rule-based signal
   over climate variables, not a trained production forecast — port the spirit of the old
   dashboard's placeholder copy instead of dropping it now that there's something to show.

## Acceptance criteria

- [ ] Switching to Protect in `TopNav` actually navigates/renders the new screen
- [ ] All 11 mines appear in the portfolio grid with a real tier color, not a placeholder
- [ ] Clicking a mine shows its ribbon and its `risk_reasons` if any
- [ ] The "rule-based, not a trained model" caveat is visible somewhere on this screen
- [ ] `npm run build --prefix web` is clean
