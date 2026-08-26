# Baseline Results — Model B + Model A

**Run: 2026-08-26, `--quick` settings** (250 px/halo, 1500 background points, 15 null rounds).
Report: `data/processed/validation_report.json`

Terrain slope/aspect/hillshade were **empty in this run** — see "Known gaps" below.
So this is 61 usable bands, not the full 68.

---

## Headline

| Metric | Value | Chance | Read |
|---|---|---|---|
| Held-out percentile | **67.0 ± 12.0** | 50 | Modest real separation |
| Negative controls | **45.2** | — | **Passes** — low is good |
| Random-location null | **p = 0.062** | — | Borderline, not significant |

### Capture efficiency (share of positives in the top N% of area)

| Model | top 5% | top 10% | top 20% |
|---|---|---|---|
| B — signature | 12% | 23% | 41% |
| A — anomaly | 4% | 10% | 21% |
| **Fused (0.7 B / 0.3 A)** | **18%** | **30%** | **50%** |
| *chance* | *5%* | *10%* | *20%* |

Fused gives a **3.6× lift at the top 5%** and **2.5× at the top 20%**.

---

## What this means

**The commodity test passes.** Negative controls — 13 coal, copper and sand mines —
score at 45.2, *below* the manganese halos at 67.0. The model is responding to
mineralogy, not to bare excavated ground. This was the single most likely way for the
whole approach to be quietly worthless, and it is not happening.

**Model A is useless alone but useful fused.** At 4/10/21% it is indistinguishable from
chance by itself, yet adding it at 30% weight lifts every capture bracket well above
Model B alone. It is contributing genuinely complementary information.

**The result is not yet statistically significant.** p = 0.062 means roughly 1 random
set of 9 belt patches in 16 scores as well as the real mines. Suggestive, not
demonstrated. With 5 folds this is close to the best that can be shown.

**Ukwa is the failing fold** (47.2, below chance). The other four range 68–80. Worth
checking whether the Ukwa coordinate is right, or whether it is geologically atypical.

---

## Two bugs found in the validation code itself

Both produced confident-looking numbers that meant nothing.

**1. Capture efficiency was pinned to chance by construction.** Scores are
rank-normalised *within the frame passed to `score()`*. Positives and background were
being scored in separate calls, so each came out uniform on [0, 1] and any comparison
landed on chance no matter how good the model was. Fixed by `score_together()`, which
scores one concatenated frame and splits afterwards. This alone moved top-20 capture
from 17% to 41%.

**2. The permutation test tested the wrong null.** Shuffling cluster labels keeps
training and test pixels inside the *same nine halos* — leakage that makes the shuffled
task easier than the real spatial holdout, which is why it returned p = 1.000. Replaced
with `random_location_null()`: draw 9 fake sites at random inside the belt, build
identical halos, run the identical pipeline. That is the question that matters — *would
any nine patches of belt ground have scored this well?*

---

## Known gaps in this run

- **Terrain slope / aspect / 4 hillshades were empty.** `ee.Algorithms.Terrain` and
  `ee.Terrain.hillshade` derive output from the image's own projection, and mosaicking
  an ImageCollection leaves it at WGS84 1°/pixel, so both returned all-NaN. Fixed in
  `src/gee/terrain.py` with `setDefaultProjection`; re-export has **succeeded** and needs
  re-downloading. Structure is a first-order control on Sausar manganese, so these 7
  bands may matter.
- **`AST_LATERITE` duplicated `AST_ALTERATION`** (both `B04/B05`, r = 1.000).
  Redefined to `B04/B08`; needs an ASTER re-export to take effect.
- `--quick` settings throughout. Full run uses 6× more pixels.

---

## Next, in order of expected value

1. **Re-download terrain, re-run.** Free, already exported, adds 7 structural bands.
2. **Re-export ASTER** with the fixed laterite ratio.
3. **Full-resolution run** (`python -m src.validate.score`) for the publishable number.
4. **More labels.** p = 0.062 is a sample-size ceiling, not a modelling failure. GSI
   Bhukosh occurrences would move this more than any modelling change.
5. Only then: statewide inference and the prospectivity map.
