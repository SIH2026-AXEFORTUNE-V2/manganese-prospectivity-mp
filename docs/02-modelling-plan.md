# Phase 2 — Modelling Plan

**Design: B primary + A alongside.**

- **B (primary) — signature matching.** Learn what ground *known to host manganese*
  looks like, then score all of MP for similarity. This is the targeting product.
- **A (alongside) — unsupervised anomaly.** Flag terrain that is unusual regardless of
  whether it resembles the known nine. Weaker, but it is the only component that can
  find a deposit unlike anything already mined.

Fused by rank, with agreement between the two ranked highest.

---

## The two constraints that shape everything

### 1. Sample the signature from the HALO, never the pit

Pixels inside an active pit describe *excavation*, not *manganese*. A model trained on
them will rediscover coal mines and quarries. Every positive sample is drawn from the
halo ring — 500 m to 2000 m from the workings, pit excised.

This fits the deposit style: **8 of MOIL's 11 mines are underground**, so the surface
above them *is* intact Mn-hosting geology.

### 2. Effective sample size is ~5, not 9, and not 265,000

The 9 halos hold roughly 265,000 pixels at 20 m. They are not 265,000 samples. Pixels
within one halo are the same hillside, and several sites are near-neighbours:

| Cluster | Sites | Approx centre |
|---|---|---|
| `nagpur` | Munsar, Mansar, Kandri, Beldongri | 21.39 N, 79.27 E |
| `bhandara` | Chikla, Dongri Buzurg | 21.53 N, 79.70 E |
| `tirodi` | Tirodi | 21.68 N, 79.72 E |
| `balaghat` | Bharveli | 21.85 N, 80.23 E |
| `ukwa` | Ukwa | 21.97 N, 80.46 E |

Munsar, Mansar and Kandri sit within ~3 km of one another. Training on one and testing
on another is leakage, not validation.

**So: leave-one-CLUSTER-out, not leave-one-site-out.** That gives 5 honest folds.
Fewer, but real.

---

## Step 1 — Feature stack

`src/features/stack.py`

- Reproject everything to **EPSG:32644 @ 20 m**, one common grid, assert identical
  shape and transform across layers.
- Layers: Sentinel-2 (10 bands + 9 indices), Landsat (7 optical + 5 indices + 1 thermal),
  ASTER (9 bands + 8 mineral ratios), terrain (11), Sentinel-1 (VV, VH + GLCM texture).
- **Drop correlated features (|r| > 0.95).** Both Mahalanobis and one-class SVM are
  distorted by redundant columns — the same failure that made `CLAY_HYDROXYL` and
  `LATERITE` double-count one signal.
- Standardise (z-score) using statistics from the **whole belt**, not from the positives,
  so the scaler carries no label information.

## Step 2 — Model B, signature matching

`src/models/signature.py` — three scorers, rank-fused:

| Scorer | Why |
|---|---|
| **Mahalanobis distance** to halo-pixel distribution | Principled, accounts for feature covariance |
| **One-class SVM** (RBF) | Captures a non-linear boundary the Gaussian assumption misses |
| **Spectral Angle Mapper** | Illumination-invariant; standard in remote sensing |

Output: per-pixel similarity, rank-normalised to 0–1.

## Step 3 — Model A, unsupervised anomaly

`src/models/anomaly.py` — trained on the landscape, no labels:

- PCA + Mahalanobis on the whole-scene distribution
- Isolation Forest
- Autoencoder reconstruction error
- Crósta directed PCA for iron-oxide and hydroxyl anomalies

## Step 4 — Fusion

`src/models/fuse.py` — rank-normalise both maps, combine by geometric mean.
Report B alone, A alone, and fused, so each one's contribution is visible.

---

## Step 5 — Validation (this is what makes it defensible)

`src/validate/score.py`

1. **Leave-one-cluster-out CV** — 5 folds. Per fold, record the percentile rank of the
   held-out cluster's halo in the resulting score map.
2. **Capture efficiency** — % of held-out sites in the top 5 / 10 / 20 % of area.
3. **Prediction–Area (P–A) plot** — the standard mineral-prospectivity curve.
4. **Negative controls** — do coal and copper mines score high? If Malanjkhand and the
   Kamptee coalfield rank in the top decile, the model learned *"mine"*, not
   *"manganese"*. This is the credibility test.
5. **Within-belt discrimination** — the one that decides whether this is useful.
   Compare site halos against random points **inside the Sausar belt**, not against
   random MP. A model that only separates the belt from Rajasthan has learned
   geography, not prospectivity, and is worthless for targeting.
6. **Permutation test** — shuffle labels, re-score, repeat. Confirms the result beats
   chance given only 5 effective folds.

Report confidence intervals throughout. With 5 folds they will be wide; stating that
plainly is stronger than implying precision that is not there.

---

## Expected failure modes, and how each is caught

| Failure | Symptom | Caught by |
|---|---|---|
| Learned "excavation", not geology | Coal/copper mines score high | Negative controls (step 4) |
| Learned "Sausar Group", no finer | Whole belt scores uniformly high | Within-belt test (step 5) |
| Overfit to 9 sites | High train score, poor held-out rank | Leave-one-cluster-out (step 1) |
| Redundant features dominate | One signal dominates loadings | Correlation pruning (step 1) |

---

## What we are NOT doing, and why

- **No Mn occurrence points as training labels beyond the halo signature.** They stay in
  `data/validation/`. GSI occurrence points, when obtained, go to validation — never
  into training. Lithology and structure *are* fair as features.
- **No extra imagery before a baseline exists.** More layers now is guessing. Adding
  them after a baseline is measurable evidence.

---

## Order of work

1. Expand negative controls 2 → ~12 from the OSM pull already on disk *(free)*
2. Sync the 6 finished Drive exports to `data/raw/gee/`
3. Build the feature stack
4. Model B + leave-one-cluster-out
5. Model A
6. Fuse, score, P–A plot
7. **Baseline number** — only then consider GSI occurrences, EOS-04, LISS4, re-scoring each
