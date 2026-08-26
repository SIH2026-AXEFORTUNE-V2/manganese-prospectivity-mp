# Bhoonidhi (NRSC/ISRO) — Satellite Data Inventory for Manganese Prospectivity, Madhya Pradesh

**Verified live on 2026-08-25** by driving https://bhoonidhi.nrsc.gov.in/bhoonidhi/index.html
(logged in as `ONL_example123`). All counts below are real query results, not estimates.

**AOI used:** TL 26.9N / 74.0E — BR 21.0N / 82.8E (full Madhya Pradesh bbox)
**Probe window:** 01-NOV-2024 → 30-APR-2025 (dry season = minimum vegetation = best for geology)

---

## 1. The search API (this is how you bulk-collect)

Bhoonidhi has no STAC / no public REST catalog, but the UI is backed by a single JSON endpoint:

```
POST https://bhoonidhi.nrsc.gov.in/bhoonidhi/ProductSearch
Content-Type: application/json
(session cookie required — must be logged in)
```

Body (all string values; several are URL-encoded *inside* the JSON):

```json
{
  "userId":   "ONL_example123",
  "prod":     "Standard",
  "selSats":  "Sentinel-2A_MSI_Level-2A%2CSentinel-2B_MSI_Level-2A",
  "offset":   "0",
  "sdate":    "NOV%2F1%2F2024",
  "edate":    "APR%2F30%2F2025",
  "query":    "area",
  "queryType":"polygon",
  "isMX":     "No",
  "tllat":"26.9","tllon":"74.0","brlat":"21.0","brlon":"82.8",
  "filters":  "%7B%22Sentinel-2A_MSI_Level-2A%22%3A%7B%22CLOUD%22%3A%221%22%7D%7D",
  "srt":      "20260825_AAA000000"
}
```

- `offset` is a true offset; **page size is fixed at 500**. Loop `offset += 500` until a page returns `< 500`.
- `sdate`/`edate` format is `MON/D/YYYY` (URL-encoded slashes).
- `selSats` = comma-separated sensor keys (**max 10 per search**), URL-encoded comma.
- `filters` = URL-encoded JSON, `{"<sensorKey>":{"CLOUD":"1"}}`. **`CLOUD` is binary only**: `"1"` = 0–10% cloud, `"0"` = any. There is no numeric cloud threshold, and **no per-scene cloud % in the response**.
- `srt` is a per-session search token (changes each session — scrape it from a UI search).

**Response:** `{ "Results": [...], "AOI": ... }`. Per-record fields:

`ID, FILENAME, DIRPATH, IMAGING_ORBIT_NO, GROUND_ORBIT_NO, SEGMENT_NO, ROLL, PITCH, YAW,
TILE_ID, SCENE_NO, COVERAGE, ImgCrnNW/NE/SE/SWLat/Lon, CrnNW/NE/SE/SWLat/Lon,
SCENE_CENTER_LAT, SCENE_CENTER_LONG, OBSID, ACQUISITION_MODE, IMAGING_MODE, SATELLITE,
SENSOR, PRICED, TABLETYPE, O2_MODE, DOP, QUALITY_SCORE, PRODCODE, PRODTYPE,
BINPERIOD, BINRESOLUTION, PASS_TYPE, QAZIP, QAPDF, srt, SELECTION`

Note: `QUALITY_SCORE` is `"0"` for Sentinel-2 — not usable as a quality proxy.

**Download is NOT a plain URL.** Even for `OpenData_DirectDownload`, each product goes
cart → confirm → authenticated per-product download call. Cart limits: **1000 items (open data)**,
3000 (priced). A full-MP collection must be run in batches.

Also flagged in the UI: *"Open data for the last 3-months can be downloaded immediately, while
older data may be served with a delay."* — older scenes are staged, not instant.

---

## 2. What Madhya Pradesh actually has (verified counts, Nov 2024 – Apr 2025)

| Dataset (sensor key) | Res | Scenes over MP | Notes |
|---|---|---|---|
| `Sentinel-2A/2B/2C_MSI_Level-2A` | 10/20/60 m | **4,575** (2,964 at 0–10% cloud, 88 MGRS tiles) | **Primary dataset.** BOA reflectance, 13 bands incl. SWIR B11/B12 |
| `Sentinel-2A/2B/2C_MSI_Level-1C` | 10/20/60 m | available | TOA — use L2A instead |
| `ResourceSat-2/2A_LISS4(MX70)_L2` | 5.8 m | 968 | 3 bands only (G, R, NIR) — **no SWIR** |
| `LandSat-8/9_OLI+TIRS_L1` | 30 m / 100 m TIR | 953 | SWIR1/SWIR2 + thermal. **L1 (TOA) only** — no L2 surface reflectance here |
| `Sentinel-1A/1C_SAR(IW)_GRD` | ~10–20 m | 519 | C-band VV+VH, roughness/texture |
| `ResourceSat-2/2A_LISS3_BOA-Archives` | 23.5 m | 509 | Atmospherically corrected, **has SWIR (1.55–1.70 µm)** |
| `EOS-04_SAR(MRS)_L2B` | ~25 m | 500+ | Indian C-band SAR |
| `ResourceSat-2/2A_AWIFS_BOA-Archives` | 56 m | 499 | Wide swath + SWIR |
| `EOS-04_SAR(MRS)_SoilMoisture` | ~25 m | 369 | Derived soil moisture — feeds the shortfall model |
| `CartoSat-1_PAN_CartoDEM-30m` | 30 m | 54 | **Free DEM** → slope, curvature, drainage, lineaments |
| `CartoSat-1_PAN_CartoDEM-10m / -2.5m` | 10 / 2.5 m | priced | Better terrain, costs money |
| `ResourceSat-2_AWIFS_NDVI-10x10deg-tiles_15day_100m` | 100 m | ready-made | Pre-computed NDVI composites |
| `EOS-06_OCM(LAC)_NDVI/EVI/VF/BA/VA_8day_360m` | 360 m | ready-made | 8-day NDVI, EVI, veg fraction, albedo |
| `EOS-04_SAR(MRS)_WaterSpread` | ~25 m | — | Surface water extent |
| `NISAR_SSAR_*` (GCOV/GSLC/GUNW/RSLC/RIFG/RUNW) | L+S band | from 08-Jul-2026 | Dual-freq SAR + InSAR — **new; worth watching for subsidence/mine deformation** |
| `Novasar-1_SAR(20–40m ScanSAR)_GRD` | 20–40 m | priced | S-band |
| `CartoSat-2S/-3_PAN/MX(SPOT)` | 0.3–1.6 m | priced | Very high res for mine-face / stockpile monitoring |

### Archive depth — Bhoonidhi's foreign-sensor mirrors are shallow

Probed January of each year over the same MP bbox:

| Sensor | 2012 | 2015 | 2018 | 2020 | 2021 | 2024 | 2026 |
|---|---|---|---|---|---|---|---|
| Sentinel-2 L2A | 0 | 0 | 0 | **0** | 500+ | 500+ | 390 |
| Landsat-8 OLI+TIRS L1 | — | **0** | **0** | 81 | 82 | 88 | — |
| ResourceSat LISS3 L2 | 91 | 77 | — | 182 | — | 175 | — |

**Sentinel-2 on Bhoonidhi effectively starts ~2021. Landsat-8 starts ~2019/2020.**
For anything older, ESA Copernicus Data Space and USGS EarthExplorer have the full record
(S2 from 2015, Landsat from 1972). Indian sensors (LISS3/AWIFS) reach further back via
`OpenData_OnOrder` (ResourceSat-1 → 2003).

---

## 3. Full Bhoonidhi catalogue

**Satellites:** Aqua, CartoSat-1/-2/-2S/-3, EOS-04, EOS-06, IRS-1A/1B/1C/1D, JPSS1,
KompSat-3/3A, LandSat-8/9, MetOp-B/C, NISAR, NOAA-11…19, Novasar-1, OceanSat-1/2, RISAT-1,
ResourceSat-1/2/2A, ScatSat-1, Sentinel-1A/1B/1C/1D, Sentinel-2A/2B/2C, Suomi-NPP, Terra.

**Sensors:** AIS, AVHRR, AWIFS, LISS1, LISS2, LISS3, LISS4, MODIS, MSI, OCM, OLI+TIRS,
PAN, SAR, SCAT, SSAR, VIIRS, WIFS.

**Themes offered:** Agriculture, Coastal Studies, DEM, Flood, Forestry, Geohazards,
Glacial Lake Monitoring, Land Use / Land Cover, Oceans and Climate, Urban Studies,
Water Resources. There is **no "Geology" or "Mineral Exploration" theme.**

---

## 4. Is Bhoonidhi alone enough?

**No.** It gives a strong optical/SAR/DEM backbone, but four things are missing, and two are blockers.

### 4a. Missing — spectrally critical

| Missing | Why it matters for manganese | Free source |
|---|---|---|
| **ASTER** (SWIR bands 4–9) | The most-used sensor in mineral mapping. Six SWIR bands resolve clay/carbonate/Mn-oxide absorption features that Sentinel-2's two broad SWIR bands cannot. Classic Mn/gossan band ratios are ASTER-based. | NASA Earthdata / LP DAAC (`AST_L1T`, `AST_07XT`). SWIR detector failed Apr-2008 — use pre-2008 scenes. |
| **Hyperspectral** (EMIT, PRISMA, EnMAP) | Continuous 400–2500 nm; can actually discriminate pyrolusite / psilomelane / braunite rather than infer them. | EMIT: NASA Earthdata. PRISMA: ASI portal (registration). EnMAP: DLR. |
| **Landsat surface reflectance (L2)** | Bhoonidhi serves Landsat **L1 (TOA) only**; multi-date band ratios need atmospheric correction. | USGS EarthExplorer / M2M API — Collection-2 L2SP. |
| **Deep S2/Landsat archive (pre-2021)** | Multi-year median compositing to strip vegetation and cloud needs 5–10 years, not 4. | Copernicus Data Space Ecosystem (STAC + S3), AWS/Google open buckets, Microsoft Planetary Computer. |

### 4b. Missing — non-satellite, and these are the real blockers

| Missing | Why it blocks | Source |
|---|---|---|
| **Ground-truth labels (known Mn occurrences)** | You cannot train a supervised prospectivity model with zero positive labels. This is the #1 dependency. | GSI **Bhukosh / NGDR** (bhukosh.gsi.gov.in) — mineral occurrence points, exportable. IBM Mining Tenement System. MOIL mine boundaries: Balaghat, Ukwa, Tirodi, Sitapatore, Munsar, Beldongri. |
| **Geological map / lithology** | Mn in MP sits in the Sausar Group (Mansar / Lohangi / Chorbaoli formations). Lithology is the strongest single predictor and is not derivable from spectra alone. | GSI Bhukosh 1:50k geology, structural and lineament layers. |
| **Aeromagnetic / gravity geophysics** | Sub-surface indicators. PS 26009 explicitly asks for *"surface **and sub-surface** indicators"* — optical satellite data is surface-only. | GSI NGDR aerogeophysics; NGRI. |
| **Regional gravity** | Basin/structure context. | GRACE / GOCE via NASA Earthdata (coarse but free). |

### 4c. Missing for the *production-shortfall* half of PS 26009

The problem statement also wants rainfall, soil moisture, LST and vegetation. Bhoonidhi
partially covers this (EOS-04 SoilMoisture, EOS-06 NDVI/EVI), but the operationally useful
series are elsewhere:

- **Rainfall:** IMD gridded 0.25° daily (imdpune.gov.in) — the authoritative Indian source; or CHIRPS / GPM IMERG.
- **Land surface temperature:** MODIS `MOD11A2` / Landsat TIRS ST. (Bhoonidhi has `Terra_MODIS` only as *OnOrder*, and disabled for recent dates.)
- **Soil moisture:** SMAP L3/L4 (NASA) — daily, global, better cadence than EOS-04.
- **Equipment downtime, blasting logs, production records:** MOIL internal — no satellite substitute exists.

---

## 5. Recommended collection plan

**Tier 1 — Bhoonidhi (free, Indian-sourced):**
1. Sentinel-2 L2A, `CLOUD=1`, Nov–Apr of 2021/22 → 2025/26 → ~15k scenes.
   Batch by MGRS tile (96 tiles cover MP) to stay under the 1000-item cart cap.
2. ResourceSat-2/2A LISS3 BOA-Archives — SWIR at 23.5 m, reaches back to ~2012.
3. CartoDEM-30m — 54 tiles, one-time.
4. Sentinel-1 GRD + EOS-04 SAR MRS — texture/roughness, all-weather.
5. EOS-04 SoilMoisture + AWIFS NDVI composites — for the shortfall model.

**Tier 2 — outside Bhoonidhi (required, not optional):**
6. GSI Bhukosh: Mn occurrence points + Sausar Group lithology + lineaments → **your labels**.
7. ASTER L1T / AST_07XT pre-2008 from NASA Earthdata → SWIR mineral ratios.
8. EMIT / PRISMA over the Balaghat–Chhindwara–Jhabua belt → hyperspectral validation.
9. IMD rainfall + SMAP + MODIS LST → shortfall predictors.

**Scope warning:** the full MP bbox is ~9° × 9° ≈ 300,000 km². At Sentinel-2 10 m that is
roughly 3 TB per cloud-free epoch. Manganese in MP is confined to a narrow belt
(Balaghat ~21.8N/80.2E, Chhindwara, Seoni, Jhabua). Train on the belt at full resolution,
then run inference across the state — do not download all of MP at 10 m.

---

## 6. Reproducing the queries

Log into Bhoonidhi, open devtools, grab a fresh `srt` token from any UI search, then:

```js
async function search(off, sats, sd, ed, filters) {
  const body = {
    userId: "ONL_example123", prod: "Standard",
    selSats: encodeURIComponent(sats), offset: String(off),
    sdate: encodeURIComponent(sd), edate: encodeURIComponent(ed),
    query: "area", queryType: "polygon", isMX: "No",
    tllat: "26.9", tllon: "74.0", brlat: "21.0", brlon: "82.8",
    filters: encodeURIComponent(JSON.stringify(filters || {})),
    srt: "<FRESH_SRT_TOKEN>"
  };
  const r = await fetch('/bhoonidhi/ProductSearch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return r.json();
}
// page: off = 0, 500, 1000, ... until Results.length < 500
```
