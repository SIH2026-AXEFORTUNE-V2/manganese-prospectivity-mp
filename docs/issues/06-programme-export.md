# Issue 6 — Programme + export

**Seat:** 2 · Product surface
**Depends on:** [Issue 3](03-evidence-validation-panels.md) for target selection;
[Issue 5](05-protect-lane.md) for mine-action assignment. Can be built with mock/local-only
state before either lands, but the real "add to programme" actions live in those two issues.

## Why

This is the screen that makes the two lanes read as one product instead of two demos — see
the userflow plan's convergence point. A planner should be able to shortlist targets from
Explore *and* acknowledge risk actions from Protect, then walk into a meeting with one list.

## Task

1. Add a lightweight client-side "programme" store — React context or a simple
   `useState`/`localStorage` combo at the layout level is enough, this doesn't need a real
   backend (nothing in this app has one, see [../04-data-contract.md](../04-data-contract.md)'s
   opening paragraph).
2. From the Evidence panel (issue #3), add an "Add to programme" action per target.
3. From the Protect lane (issue #5), add an "Acknowledge & assign owner" action per mine risk
   flag (a plain text field for "owner" is enough, no auth/user system needed).
4. Build `web/src/app/programme/page.tsx`: one table combining both — target rows (rank, area,
   score, lat/lon) and mine-action rows (mine, risk tier, reasons, owner) — with a running
   "area committed vs budget" style number if useful, matching the spirit of the old
   dashboard's "Area committed / Budget used" chips.
5. Add an export button: CSV at minimum (reuse the CSV-building approach from the old
   dashboard's `$('copyBtn')` handler in `dashboard/index.template.html` — same columns for
   targets, plus new columns for mine actions), GeoJSON export is a nice-to-have if time
   allows.

## Acceptance criteria

- [ ] Targets added from Explore and actions acknowledged from Protect both show up on one
      Programme page
- [ ] Export produces a CSV that opens cleanly in a spreadsheet, with real data
- [ ] Programme state survives a page reload (localStorage is fine — this genuinely is the
      kind of per-viewer convenience state that belongs there, not anything more durable)
- [ ] `npm run build --prefix web` is clean
