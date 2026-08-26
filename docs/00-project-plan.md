# Plan — Satellite Data Acquisition for Manganese Prospectivity (SIH PS 26009)

## Context

MOIL (Ministry of Steel) needs better manganese reserve identification and production-shortfall
prediction across Madhya Pradesh. This repo (`D:\Delfi\projects\SIH-2026\Satellite-ml`) is
currently empty apart from `docs/bhoonidhi-data-inventory.md`, which records a live survey of
ISRO's Bhoonidhi portal done on 2026-08-25.

**This plan covers Phase 1 only: acquire all data and land it in the folder.** Modelling phases
are sketched at the end so the folder layout and band selection don't have to be redone later.

### Decisions already made
- **Compute:** Google Earth Engine as primary (server-side, export finished composites),
  Bhoonidhi for Indian-only products GEE lacks.
- **Labels:** **Fully unsupervised training. No labels enter the model.** Known MOIL mines are
  held out entirely and used only for post-hoc blind validation.
- **Scope:** Train on the Balaghat–Chhindwara–Seoni (Sausar Group) belt at full resolution;
  run inference statewide.

### Honest expectation setting
Mn oxide has **no strong diagnostic absorption feature** in the 400–2500 nm range. It is detected
*indirectly* via ferruginous gossan capping, Mn-rich laterite, host lithology and structure.
A realistic good result is **60–80% of known Mn occurrences falling inside the top 20% of
predicted area**. The map will also light up unrelated lateritic/ferruginous terrain and iron ore.
Pitch this as **exploration targeting**, not reserve estimation.

---

## Areas of interest

Define once in `config/aoi.geojson`; every script reads from it.

| Name | Approx bbox | Use |
|---|---|---|
| `belt_sausar` | 21.30–22.30 N, 78.30–80.90 E | **Training AOI.** Chhindwara–Seoni–Balaghat; spills into Nagpur/Bhandara |
| `belt_jhabua` | ~22.55–23.05 N, 74.35–74.95 E | Secondary belt — **verify extent before use** |
| `mp_state` | clip to actual MP boundary polygon | **Inference AOI** |
| `mp_bbox` | 21.0–26.9 N, 74.0–82.8 E | Search bbox only — ~2/3 of it is *not* MP |

Get the MP state polygon from GADM, Survey of India, or `FAO/GAUL/2015/level1` in GEE.
**Do not use the raw bbox as the inference area** — it wastes ~65% of compute on other states.

---

## Part A — Google Earth Engine (primary; no bulk download)

Prereq: GEE account linked to a Google Cloud project (free for non-commercial), `earthengine-api`
plus `geemap` in a Python env.

Scripts go in `src/gee/`. Each exports GeoTIFF to Google Drive, then a sync step pulls to
`data/raw/gee/`.

### A1. Sentinel-2 dry-season composite — the core dataset
- Collection `COPERNICUS/S2_SR_HARMONIZED`, joined with `COPERNICUS/S2_CLOUD_PROBABILITY`
  (or the newer `COPERNICUS/S2_CLOUD_SCORE_PLUS`) for masking.
- **Dry season only: 01-Nov → 30-Apr.** Minimum vegetation, minimum cloud, maximum rock exposure.
- Seasons 2019/20 → 2025/26. Per-season median **and** a multi-year median.
- Bands at 20 m: `B2 B3 B4 B5 B6 B7 B8 B8A B11 B12`.
- Also export a 10 m version of `B2 B3 B4 B8` for the belt AOI only.
- GEE's archive goes back to 2015 — **use it.** Bhoonidhi's S2 mirror only starts ~2021.

### A2. Landsat 8/9 surface reflectance + thermal
- `LANDSAT/LC08/C02/T1_L2` and `LANDSAT/LC09/C02/T1_L2`, QA_PIXEL cloud mask, scaling applied.
- Bands `SR_B1..SR_B7` at 30 m plus `ST_B10` (surface temperature).
- Gives true L2 surface reflectance, which **Bhoonidhi does not serve** (it is L1/TOA only).

### A3. ASTER — this closes the biggest spectral gap
- `ASTER/AST_L1T_003`. VNIR `B01 B02 B3N` + **SWIR `B04..B09`** + TIR `B10..B14`.
- **Hard constraint: SWIR detector failed April 2008. Filter to `< 2008-04-01` for B04–B09.**
- ASTER's six SWIR bands resolve clay/carbonate/Mn-oxide features Sentinel-2's two broad SWIR
  bands cannot. Classic Mn and gossan ratios are ASTER-based.
- Getting this through GEE avoids a separate NASA Earthdata download pipeline entirely.

### A4. Terrain
- `COPERNICUS/DEM/GLO30` (primary) and `USGS/SRTMGL1_003` (fallback/cross-check).
- Derive in GEE: slope, aspect, hillshade (multi-azimuth), curvature, TPI, TRI,
  flow accumulation, drainage density.

### A5. Sentinel-1 SAR
- `COPERNICUS/S1_GRD`, IW, VV+VH, ascending and descending kept separate.
- Dry-season median + temporal SD. Add GLCM texture bands.

### A6. Shortfall-prediction covariates (no geology needed)
- Rainfall: `UCSB-CHG/CHIRPS/DAILY`
- LST: `MODIS/061/MOD11A2`
- Soil moisture: `NASA/SMAP/SPL4SMGP/007`
- Reanalysis: `ECMWF/ERA5_LAND/DAILY_AGGR`
- Vegetation: NDVI/EVI series from A1
- Export as **time series CSV per mine lease**, not rasters.

### Export strategy
- Belt AOI: single GeoTIFF per product per season.
- Statewide: tile into 1° × 1° blocks (~35 tiles) at 20 m, `maxPixels` raised, `int16` scaled
  to keep size down. Expect ~15–25 GB total.

---

## Part B — Bhoonidhi (download; Indian products GEE lacks)

Full API contract is already documented in `docs/bhoonidhi-data-inventory.md` §1 and §6.

Scripts in `src/bhoonidhi/`:
- `search.py` — wraps `POST /bhoonidhi/ProductSearch`, pages `offset += 500`, writes scene
  inventory to `data/raw/bhoonidhi/manifests/*.csv` (footprint corners, DOP, product code).
- `manifest_to_cart.py` — turns a manifest into batched cart lists respecting the
  **1000-item open-data cart cap**.

Pull these, **belt AOI first**, statewide only where cheap:

| Product | Why | Priority |
|---|---|---|
| `CartoSat-1_PAN_CartoDEM-30m` | Indian DEM; ISRO-sourced terrain story | High — only 54 tiles statewide |
| `ResourceSat-2/2A_LISS3_BOA-Archives` | 23.5 m **with SWIR**, atmospherically corrected, archive back to ~2012 | High |
| `ResourceSat-2/2A_LISS4(MX70)_L2` | 5.8 m detail for mine-footprint mapping (no SWIR) | Medium |
| `EOS-04_SAR(MRS)_L2B` | Indian C-band SAR | Medium |
| `EOS-04_SAR(MRS)_SoilMoisture` | Feeds shortfall model | Medium |
| `EOS-04_SAR(MRS)_WaterSpread` | Pit flooding → downtime | Low |

**Known friction — plan for it.** Bhoonidhi has no direct download URL. Even
`OpenData_DirectDownload` goes cart → confirm → authenticated per-product call, and the session
carries an `srt` token that rotates. Fully automating this is fragile.
**Recommended:** script the *search and manifest* step; drive the *cart and order* step through
the browser UI in batches. Also note the portal's own warning that data older than 3 months
"may be served with a delay" — order early, collect later. Do not block Part C on Part B.

---

## Part C — Validation set (built, then locked away)

This is deliberately **not** training data.

1. Digitize MOIL and other known Mn locations as points/polygons →
   `data/validation/known_mn_occurrences.geojson`.
   Anchors: Balaghat, Ukwa, Tirodi, Munsar, Beldongri, Sitapatore, Kandri, Chikla, Mansar.
   Source coordinates from MOIL public disclosures, OSM, Bhuvan or IBM tenement data —
   **verify each, do not guess.**
2. For each, digitize the **current pit footprint** from high-res imagery →
   `active_mine_footprints.geojson`.
3. Generate a **halo ring** per site (exclude pit, keep 0.5–2 km buffer) →
   `validation_halos.geojson`.

**Why the halo matters.** An anomaly detector flags active pits because they are bare excavated
ground, not because it sees Mn. Validating on raw pit polygons produces an impressive score that
means nothing. Scoring on the halo tests whether the model found the *geology*.

4. Generate ~10k random background points inside `mp_state`, excluding all known sites, for the
   negative class in post-hoc ROC.

**Rule: nothing in `data/validation/` is ever read by training code.** Enforce with a lint check
or a separate loader module.

---

## Folder layout

```
Satellite-ml/
├── config/
│   ├── aoi.geojson              # belt_sausar, belt_jhabua, mp_state, mp_bbox
│   └── datasets.yaml            # GEE ids, band lists, date windows, export scales
├── docs/
│   └── bhoonidhi-data-inventory.md   # already written
├── src/
│   ├── gee/          # auth.py, s2_composite.py, landsat.py, aster.py,
│   │                 # terrain.py, sentinel1.py, climate_series.py, export.py
│   ├── bhoonidhi/    # search.py, manifest_to_cart.py
│   ├── features/     # indices.py, crosta_pca.py, terrain_features.py, lineaments.py, stack.py
│   ├── models/       # anomaly detectors (Phase 2)
│   └── validate/     # capture_efficiency.py, pa_plot.py, roc.py  (Phase 2)
├── data/
│   ├── raw/{gee,bhoonidhi}/
│   ├── interim/
│   ├── processed/    # aligned, stacked feature cubes
│   └── validation/   # HELD OUT — never read by training
└── notebooks/
```

---

## Verification for Phase 1

1. `python -m src.gee.auth` — confirms EE init against the Cloud project.
2. Run each GEE export for `belt_sausar` **first**; check the task completes and the GeoTIFF opens
   in QGIS with correct CRS and no all-nodata bands.
3. `rasterio` check on every raw file: CRS, transform, dtype, nodata, band count vs `datasets.yaml`.
4. Visual QA: render the S2 dry-season median as false-colour SWIR (B12/B11/B4) over the belt.
   Rock exposure should be obvious and cloud artefacts absent.
5. **Sanity check the ASTER date filter** — assert `max(date) < 2008-04-01` for any SWIR band.
   Silently including post-2008 SWIR would poison every downstream ratio.
6. `src/bhoonidhi/search.py` reproduces the counts in `docs/bhoonidhi-data-inventory.md` §2
   for the same bbox and window (S2 L2A ≈ 4,575; low-cloud ≈ 2,964). If not, the `srt` token
   or the payload encoding has drifted.
7. Confirm all rasters co-register: reproject to a common grid (UTM 44N / EPSG:32644, 20 m) and
   assert identical shape and transform across the stack.
8. Print a coverage report: % of `belt_sausar` and % of `mp_state` with valid (non-masked) pixels
   per product. Anything under ~95% for the S2 multi-year median needs investigating.

---

## Phase 2 sketch (not in scope now — recorded so Phase 1 collects the right bands)

**Features:** iron-oxide (B4/B2), ferrous iron (B11/B8), clay-hydroxyl (B11/B12), gossan
(B4/B2 × B11/B12), laterite, NDVI mask; ASTER SWIR mineral ratios; Crósta directed-PCA for
iron-oxide and hydroxyl anomalies; terrain derivatives; lineament density from DEM + SAR.

**Unsupervised models** (ensemble, rank-normalized then combined): PCA + Mahalanobis distance,
Isolation Forest, deep autoencoder reconstruction error, Self-Organizing Map, GMM clustering
with centroid matched to a gossan/laterite spectral profile.

**Blind validation:** Prediction-Area (P-A) plot and capture-efficiency curve — the standard
metrics in prospectivity mapping. Report % of held-out occurrences in the top 5/10/20% of area,
ROC-AUC against random background, and a **permutation test vs a random baseline**. With only
10–15 known sites, statistical power is low — report confidence intervals, and score on the
**halo**, not the pit.
