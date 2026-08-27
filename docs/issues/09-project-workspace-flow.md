# Issue 9 — Project workspace: login → project → plan → daily actuals → retrain

**Seat:** 2 · Product surface (with a Seat 3 hand-off at the end — see "What actually retrains what")
**Depends on:** nothing hard. Reuses the existing `web/public/data/` fixture
([../04-data-contract.md](../04-data-contract.md)) as the AI's input. Supersedes the
localStorage "programme store" sketch in [06-programme-export.md](06-programme-export.md) —
the programme is now a *project*, and the store built here is the one to extend.

## Why

M0 shipped two lanes (Explore map, Protect grid) that read as two demos sharing a nav bar.
A planner does not think in lanes; they think in **projects**: "Balaghat North, day 14 of 26,
71% of target". This issue reorganises the whole app around that noun, and closes the loop
that makes the AI claim credible — the app must be able to say *what it predicted*, *what
actually came out of the ground*, *why they differed*, and *what it learned from the gap*.

## The flow

### 1. Login → Projects home
`/login` collects a name + organisation and stores a demo session. **This is not auth** — it
is a session label so the Projects list has an owner and a "last updated by" line. Do not
present it as security; there is no backend to authenticate against
(see [../04-data-contract.md](../04-data-contract.md), opening paragraph).

`/projects` is the landing screen: one card per project (name, AOI, mode, and — for
production projects — a live "Day 14/26 · 71% of target" progress line), plus **+ New Project**.
No role-based home screens. One list.

### 2. New project — a 3-step wizard, not one giant form
Step 1 asks **what are you here for**, because the follow-up questions diverge:

| Mode | Follow-up |
|---|---|
| `discover` | AOI only. Output is a ranked zone map. |
| `produce` | Monthly tonnage target, required grade %, period start/length, bench list. Output is a schedule. |
| `both` | Both, in that order. |

Step 2 is the AOI (bbox over the belt, or pick a known MOIL lease from `mines.geojson`).
Step 3 is optional seed data (old borehole logs / production registers) — the same parser
as §6, offered early so a project starts warm.

### 3. Reserve results — ranked zone cards
For `discover`/`both`: the targets whose centroid falls in the AOI, rendered as one card each,
side by side, next to the map:

```
Zone A · Bharveli NE extension · High grade (36–42% Mn) · 1.8–2.4 Mt · Confidence High
Zone B · Tirodi E ridge        · Medium (28–33% Mn)     · 0.6–0.9 Mt · Confidence Medium
```

Card fields: place name (nearest known mine + bearing, from `mines.geojson`), grade band,
tonnage range, confidence. Clicking opens the existing Evidence/Validation drawer — the
reasoning already built in [03-evidence-validation-panels.md](03-evidence-validation-panels.md).

**Every number on that card is derived, not measured.** Grade band and tonnage come from
`score_mean` + `area_ha` through a stated assumption set (thickness, density, recovery) that
is printed on the card's back. Label them as estimates in the UI. A judge who asks "where did
1.8 Mt come from" must get an answer from the screen, not from us.

### 4. AI Suggestion sidebar — forward-looking only
A persistent right rail on the project screen: recommended mining days, depth per day, and
flagged days (monsoon window, scheduled maintenance, blast-permit gaps). It shows **the plan**.
It must never show what already happened — that is §5's job, and mixing them makes it
impossible to tell a recommendation from a result.

### 5. Calendar — planned vs actual, per day
One cell per day for the project period. Each cell: planned (tonnes, bench, depth), actual
(entered end-of-day), and an auto-derived variance line with the reason attached.

**The actuals form is structured fields only — no free text as the primary record.** Tonnes,
grade, then zero or more delay events, each of which is `{reason code, machine id, bench,
start hour, end hour}` picked from fixed lists. A free-text note field may exist, but nothing
downstream reads it.

This is not UI fussiness. The data audit on this project already found that an ungoverned
field (the fabricated `manganese_present` label) produces a model that looks fine on a
dashboard and has learned nothing. "Downtime 6–9pm on EX-204" as a dropdown + machine id
takes the same fifteen seconds to type and is the difference between retraining and theatre.

**Surplus is its own event, not negative shortfall.** Predicted 30 t, got 40 t asks a
one-tap question: *richer than modelled* (a real signal for the reserve model) or *one-off*
(stockpile blend, extra shift). They train different things; do not average them together.

### 6. Upload raw data → training rows
`/projects/[id]/data`: drop a CSV/register, the parser sniffs headers and proposes a column
mapping, the user confirms it ("we read `PROD_TON` as tonnes — correct?"), and only then do
rows enter the store. Real registers are messier than any schema; the confirm step is the
whole feature.

### 7. What actually retrains what — say it precisely

| Feedback | Model it improves | Cadence | Where it lives |
|---|---|---|---|
| Daily tonnes / grade / downtime at a known bench | **Production forecast** | Every day, in-app | `calibrate()` in `lib/forecast.ts` — runs in the browser on every log |
| A mined block's real grade vs. what the map predicted | **Reserve / prospectivity** | Only when a new block is actually mined | Queued as `BlockOutcome`, exported for the Python pipeline |

The daily loop is real and runs client-side: a bias factor plus per-reason expected tonnage
loss, refitted on every entry, with rolling MAE shown so the user can watch it improve.

The reserve loop **does not** run daily and must not be drawn as if it does. Ordinary
production numbers from an already-mined bench carry no information about whether an
unmined polygon 40 km away is prospective. That map only updates when someone drills or
mines where the model made a call. The honest version — *"production feedback sharpens the
forecast daily; reserve feedback sharpens the map every time a new block is mined"* — is the
stronger technical story, because it shows we know what informs what.

## Implementation notes

- **No backend.** State is localStorage behind `lib/store.ts`; the seeded demo project is
  generated from `web/public/data/` so the app is never empty on first run. Any real
  deployment swaps that one module.
- The "AI" in §3/§4 is deterministic and reads the real fixture — it is a derivation layer
  over the validated pipeline output, not a second model. Keep it that way; two sources of
  truth for a score is how a demo starts lying.
- Existing routes (`/` explore map, `/protect`, `/cutaway`) stay as the atlas views, reachable
  from the project shell.

## Acceptance criteria

- [ ] Login → projects list → new project → results → calendar → data upload all reachable
- [ ] A day log entered on the calendar changes the next day's forecast, visibly
- [ ] Delay reasons are enumerated fields; no free text feeds the model
- [ ] Reserve feedback is queued separately and labelled with its real cadence
- [ ] State survives reload; `npm run build --prefix web` is clean
