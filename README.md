# Manganese Prospectivity from Satellite Data — Madhya Pradesh

SIH 2026, Problem Statement **26009** (Ministry of Steel / MOIL Ltd).

Phase 1 of this repo is **data acquisition**. It pulls satellite imagery for the
Balaghat–Chhindwara–Seoni (Sausar Group) manganese belt and the wider state, and
builds a held-out validation set of known manganese locations.

- Plan: [docs/00-project-plan.md](docs/00-project-plan.md)
- Bhoonidhi API + catalogue survey: [docs/bhoonidhi-data-inventory.md](docs/bhoonidhi-data-inventory.md)
- Web app (in progress): [web/](web/) — Next.js + MapLibre + deck.gl, reads
  [docs/04-data-contract.md](docs/04-data-contract.md). Open tasks are tracked as
  self-contained specs in [docs/issues/](docs/issues/) — start at
  [docs/issues/00-milestones.md](docs/issues/00-milestones.md).

---

## Design in one paragraph

The model is trained **fully unsupervised** — no labels ever enter it. Known MOIL
mine locations are withheld and used only *afterwards*, to ask whether the model
independently rediscovered them. That avoids circularity, and it is what the
mineral-prospectivity literature treats as best practice.

Two things you should know before trusting any output:

1. **Manganese has no strong diagnostic absorption feature between 400–2500 nm.**
   It is detected *indirectly* — via ferruginous gossan capping, Mn-rich laterite,
   host lithology and structure. A realistic good result is 60–80% of known
   occurrences landing in the top 20% of predicted area. This is an **exploration
   targeting** tool, not reserve estimation.

2. **Active mine pits are bare, excavated ground.** An anomaly detector flags them
   because they are holes in the earth, not because it detected Mn geology.
   Validation therefore scores on a **halo ring** with the pit cut out — see
   `src/validate/build_validation_set.py`.

---

## Setup

```bash
pip install -r requirements.txt
```

### Earth Engine (primary data source)

Earth Engine needs a Google Cloud project — free for non-commercial use.

1. Create or pick a project at <https://console.cloud.google.com/>
2. Register it at <https://code.earthengine.google.com/register>
3. Set it and authenticate:

```bash
setx EE_PROJECT your-project-id
```

Open a new shell, then:

```bash
python -m src.gee.auth --authenticate
```

Verify:

```bash
python -m src.gee.auth
```

### Bhoonidhi (secondary — Indian products Earth Engine lacks)

Bhoonidhi has no public API key. You supply a logged-in session, captured from
devtools while signed in to the portal:

```bash
setx BHOONIDHI_USER_ID ONL_xxxxxxx
setx BHOONIDHI_SRT 20260825_XXXnnnnnn
setx BHOONIDHI_COOKIE "the full Cookie header"
```

The `srt` token rotates every session, so expect to re-capture it.

---

## Runbook

Always dry-run and count first — Earth Engine exports are slow and quota-limited.

```bash
python -m src.gee.s2_composite --aoi belt_sausar --count-only
```

```bash
python -m src.gee.s2_composite --aoi belt_sausar --dry-run
```

Then the belt AOI, which is the training surface:

```bash
python -m src.gee.s2_composite --aoi belt_sausar --per-season --ten-metre
```

```bash
python -m src.gee.aster --aoi belt_sausar
```

```bash
python -m src.gee.landsat --aoi belt_sausar
```

```bash
python -m src.gee.terrain --aoi belt_sausar
```

```bash
python -m src.gee.sentinel1 --aoi belt_sausar
```

Statewide, for inference — tiled, because a single 20 m GeoTIFF over MP is far too big:

```bash
python -m src.gee.s2_composite --aoi mp_state --tiled
```

Exports land in your Google Drive under `SIH26009_MN_MP`, then sync into `data/raw/gee/`.

### Bhoonidhi

Confirm the client still matches the portal before relying on it:

```bash
python -m src.bhoonidhi.search --verify
```

```bash
python -m src.bhoonidhi.search --all-configured
```

This writes scene manifests to `data/raw/bhoonidhi/manifests/`. **It does not
download pixels** — `ProductSearch` is a catalogue API. Downloading still means
cart → confirm → authenticated per-product call in the browser, capped at 1000
open-data items per cart. The manifest is what drives that step.

### Validation set

```bash
python -m src.validate.build_validation_set --template
```

Edit `data/validation/known_mn_occurrences.geojson`. The template coordinates are
**approximate district-level anchors, not ground truth** — verify each against MOIL
disclosures, IBM tenement data, Bhuvan or high-resolution imagery, correct them,
then set `verified: true`. The build step refuses to run otherwise.

```bash
python -m src.validate.build_validation_set --build
```

### Climate covariates (production-shortfall half of the problem statement)

```bash
python -m src.gee.climate_series --sites data/validation/known_mn_occurrences.geojson
```

---

## Tests

```bash
python -m tests.test_bhoonidhi_payload
```

Checks our request body byte-for-byte against a real ProductSearch request captured
from the live portal. If it fails, the payload encoding has drifted and every
Bhoonidhi search in the project is suspect.

---

## Layout

```
config/     aoi.geojson (AOIs), datasets.yaml (collections, bands, dates, scales)
src/gee/    Earth Engine acquisition - S2, Landsat, ASTER, terrain, S1, climate
src/bhoonidhi/  catalogue search client + manifest builder
src/features/   indices, PCA, lineaments          (Phase 2)
src/models/     unsupervised anomaly detectors    (Phase 2)
src/validate/   validation-set builder; scoring   (Phase 2)
data/raw/       downloaded/exported source data
data/processed/ aligned, stacked feature cubes
data/validation/  HELD OUT - never read by training code
```

**Rule:** nothing under `data/validation/` may be read by training code. That
separation is the entire basis of the accuracy claim.

---

## Data sources and their limits

| Source | What it gives | Limit worth knowing |
|---|---|---|
| Earth Engine | S2 (2015→), Landsat L2 (1972→), ASTER SWIR, DEM, S1, CHIRPS, MODIS, SMAP | Needs a GCP project |
| Bhoonidhi | CartoDEM, LISS3/LISS4, EOS-04 SAR + soil moisture | S2 mirror only ~2021→; Landsat is L1/TOA only; no bulk download |
| GSI Bhukosh | Mn occurrences, Sausar lithology, lineaments | **Not used** — deliberately excluded to keep training satellite-only |

ASTER is pulled **pre-April-2008 only**. The SWIR detector failed then, and later
data would silently corrupt every band ratio; `src/gee/aster.py` asserts this at
runtime rather than trusting a comment.
