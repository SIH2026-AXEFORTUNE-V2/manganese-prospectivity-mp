# Acquisition Log

Record of what has actually been fetched, as opposed to what is planned.

---

## 2026-08-25 — Bhoonidhi manifests: COMPLETE

Collected live from the Bhoonidhi portal against an authenticated session
(user `<your-portal-user>` / `ONL_example123`).

**3,031 unique scenes, every one `OpenData_DirectDownload` (free).**
Written to `data/raw/bhoonidhi/manifests/`.

| Product | Scenes | Date range | AOI |
|---|---:|---|---|
| `ResourceSat-2_LISS4(MX70)_L2` | 818 | 2019-11-01 → 2026-04-29 | belt_sausar |
| `ResourceSat-2A_LISS4(MX70)_L2` | 693 | 2019-11-22 → 2026-04-22 | belt_sausar |
| `EOS-04_SAR(MRS)_L2B` | 500 | 2022-12-08 → 2026-04-23 | belt_sausar |
| `ResourceSat-2A_LISS3_BOA-Archives` | 453 | 2020-10-04 → 2026-04-22 | belt_sausar |
| `EOS-04_SAR(MRS)_SoilMoisture` | 300 | 2022-11-03 → 2026-04-23 | belt_sausar |
| `ResourceSat-2_LISS3_BOA-Archives` | 177 | 2024-01-05 → 2026-04-29 | belt_sausar |
| `CartoSat-1_PAN_CartoDEM-30m` | 54 | 2024-05-10 | mp_bbox (statewide) |
| `EOS-04_SAR(MRS)_WaterSpread` | 36 | 2026-01-15 → 2026-04-10 | belt_sausar |

`_combined.csv` holds all of the above with a `product` column, de-duplicated on
scene `ID` (10 duplicates removed — the same scene can be returned under more than
one product query).

### Caveats worth remembering

- **`EOS-04_SAR(MRS)_L2B` returned exactly 500.** That is precisely one page, which
  is suspicious. It may be a server-side cap rather than a true count. Re-check by
  splitting the query into shorter date windows before assuming 500 is complete.
- **These are manifests, not imagery.** `ProductSearch` is a catalogue API. Turning
  a manifest into pixels still means cart → confirm → authenticated per-product
  download in the browser, capped at 1000 open-data items per cart.
- **`CartoDEM-30m` is a single 2024-05-10 acquisition date** across all 54 tiles —
  it is a static DEM product, not a time series. Expected.
- **The `srt` token survived a full browser restart**, so it appears to be tied to
  the login session rather than the page instance. Do not rely on that.

### How this was collected, and why not via Python

`src/bhoonidhi/search.py` implements the request contract correctly and is covered
by `tests/test_bhoonidhi_payload.py`, which diffs its output byte-for-byte against a
real captured request. But it needs a session cookie, and **Bhoonidhi's cookie is
`HttpOnly`** — `document.cookie` returns an empty string, so the session cannot be
extracted programmatically.

The practical route is `src/bhoonidhi/browser_collect.js`, which runs inside the
already-authenticated page where the browser attaches the cookie automatically.
The Python client remains the reference implementation of the contract.

Chrome blocks multiple script-triggered downloads from one page; the collector
therefore saves a single combined CSV rather than one file per product.

---

## 2026-08-25 — Earth Engine: AUTHENTICATED, exports running

Project **`<your-gcp-project>`** registered by the account owner and
authenticated on this machine. Credentials live at the path printed by
`python -c "import ee.oauth as o; print(o.get_credentials_path())"`.
`EE_PROJECT` is persisted via `setx`, so new shells pick it up automatically.

### Verified scene counts

Cloud-masked (Cloud Score+, `cs_cdf >= 0.60`) Sentinel-2 over `belt_sausar`:

| Dry season | Usable scenes |
|---|---:|
| 2019/20 | 507 |
| 2020/21 | 512 |
| 2021/22 | 495 |
| 2022/23 | 524 |
| 2023/24 | 513 |
| 2024/25 | 569 |
| 2025/26 | 630 |
| **Total** | **3,750** |

**ASTER pre-2008 SWIR over `belt_sausar`: 194 scenes, 2000-06-29 → 2008-02-12.**
The runtime date guard confirmed the latest scene falls before the 2008-04-01
detector failure, so the SWIR mineral ratios are safe to compute.

Note the seven full seasons reaching back to 2019/20. Bhoonidhi's Sentinel-2 mirror
only reaches ~2021 — this is the concrete payoff for using Earth Engine as the
primary optical source.

### Exports queued (belt_sausar)

| Task | Product | Scale |
|---|---|---|
| `S2_dryseason_median_belt_sausar_multiyear` | S2 multi-year median + 9 alteration indices | 20 m |
| `ASTER_swir_minerals_belt_sausar_pre2008` | ASTER VNIR+SWIR + 8 mineral ratios | 30 m |
| `LS89_dryseason_median_belt_sausar_optical` | Landsat 8/9 L2 surface reflectance + indices | 30 m |
| `LS89_dryseason_median_belt_sausar_thermal` | Landsat surface temperature | 30 m |
| `TERRAIN_glo30_belt_sausar` | elevation, slope, aspect sin/cos, TPI, TRI, curvature, 4 hillshades | 30 m |
| `S1_des_belt_sausar` | Sentinel-1 descending VV/VH median + SD | 20 m |

Output lands in Google Drive under `SIH26009_MN_MP`; sync into `data/raw/gee/`.

Check progress with:

```
python -m src.gee.tasks
```

### Findings worth carrying forward

- **Sentinel-1 has NO ascending coverage over the Sausar belt.** Only descending
  (464 scenes). Any InSAR or multi-look-direction plan must assume a single
  geometry here. `src/gee/sentinel1.py` skips the empty pass rather than exporting
  an empty raster.
- **`COPERNICUS/DEM/GLO30` is deprecated**, superseded by
  `COPERNICUS/DEM/GLO30_2024_1`. `config/datasets.yaml` now points at the current
  asset; the task queued against the old one was cancelled to avoid a duplicate file.
- **The Earth Engine OAuth out-of-band flow (`urn:ietf:wg:oauth:2.0:oob`) is dead** —
  Google returns `Error 400: invalid_request`. Authentication must use the localhost
  redirect flow. Relevant if this ever has to be re-run on another machine.
- The consent grants Earth Engine its standard scope set, which includes **full
  Google Drive access**. That breadth is required for `Export.image.toDrive`, but it
  is worth knowing, and it can be revoked from the Google Account permissions page.

---

## Still outstanding

1. **Verify the validation coordinates.** `data/validation/known_mn_occurrences.geojson`
   holds 10 approximate district-level anchors, all `verified: false`. These points
   are the entire basis of the accuracy claim — see Part C of the plan.
2. **Statewide inference stack** — `python -m src.gee.s2_composite --aoi mp_state --tiled`
   once the belt exports are confirmed good.
3. **Re-check `EOS-04_SAR(MRS)_L2B`**, which returned exactly 500 (one page) and may
   be server-capped rather than complete.
4. **Bhoonidhi pixel download** — manifests are collected, but turning them into
   imagery is still the manual cart → confirm → download loop, 1000 items at a time.
