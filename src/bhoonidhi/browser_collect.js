/*
 * Bhoonidhi manifest collector - runs in the BROWSER console, not Node.
 *
 * WHY THIS EXISTS
 *   Bhoonidhi's session cookie is HttpOnly. document.cookie returns an empty
 *   string, so the session cannot be lifted out of the page and handed to the
 *   Python client in src/bhoonidhi/search.py. Rather than ask you to hand-copy a
 *   rotating Cookie header out of devtools every session, this script runs inside
 *   the already-authenticated page, where the browser attaches the cookie for us.
 *
 *   src/bhoonidhi/search.py remains the reference implementation of the request
 *   contract (and is covered by tests/test_bhoonidhi_payload.py). This file is the
 *   practical way to actually run it.
 *
 * HOW TO USE
 *   1. Log in at https://bhoonidhi.nrsc.gov.in/bhoonidhi/index.html
 *   2. Run any search through the UI once - this mints the per-session `srt` token.
 *   3. Open devtools > Network, click the ProductSearch request, and copy `userId`
 *      and `srt` out of the request payload into the CONFIG block below.
 *   4. Paste this whole file into the devtools Console and press Enter.
 *   5. When it finishes it saves one combined CSV. Chrome may block the download
 *      the first time - allow it in the address-bar prompt and re-run save().
 *   6. Move the CSV to data/raw/bhoonidhi/manifests/
 *
 * The response is scene METADATA only. Downloading pixels still means
 * cart -> confirm -> authenticated per-product call, capped at 1000 open-data
 * items per cart. This manifest is what drives that step.
 */

(() => {
  // ------------------------------------------------------------------ CONFIG
  const CONFIG = {
    userId: "ONL_xxxxxxx",              // from the ProductSearch payload
    srt: "YYYYMMDD_XXXnnnnnn",          // rotates every session
  };

  // Must match config/aoi.geojson. [minLon, minLat, maxLon, maxLat]
  const BOXES = {
    belt_sausar: [78.3, 21.3, 80.9, 22.3],
    mp_bbox: [74.0, 21.0, 82.8, 26.9],
  };

  // [productKey, boxName, startDate, endDate] - dates in MON/D/YYYY
  const JOBS = [
    ["CartoSat-1_PAN_CartoDEM-30m",       "mp_bbox",     "JAN/1/2005", "AUG/25/2026"],
    ["ResourceSat-2_LISS3_BOA-Archives",  "belt_sausar", "NOV/1/2019", "APR/30/2026"],
    ["ResourceSat-2A_LISS3_BOA-Archives", "belt_sausar", "NOV/1/2019", "APR/30/2026"],
    ["ResourceSat-2_LISS4(MX70)_L2",      "belt_sausar", "NOV/1/2019", "APR/30/2026"],
    ["ResourceSat-2A_LISS4(MX70)_L2",     "belt_sausar", "NOV/1/2019", "APR/30/2026"],
    ["EOS-04_SAR(MRS)_L2B",               "belt_sausar", "NOV/1/2019", "APR/30/2026"],
    ["EOS-04_SAR(MRS)_SoilMoisture",      "belt_sausar", "NOV/1/2022", "APR/30/2026"],
    ["EOS-04_SAR(MRS)_WaterSpread",       "belt_sausar", "NOV/1/2019", "APR/30/2026"],
  ];

  const COLS = [
    "ID", "FILENAME", "DIRPATH", "SATELLITE", "SENSOR", "DOP", "TILE_ID",
    "PRODCODE", "PRODTYPE", "PRICED", "IMAGING_ORBIT_NO", "PASS_TYPE",
    "ImgCrnNWLat", "ImgCrnNWLon", "ImgCrnNELat", "ImgCrnNELon",
    "ImgCrnSELat", "ImgCrnSELon", "ImgCrnSWLat", "ImgCrnSWLon",
    "OverLapPercent", "QUALITY_SCORE",
  ];

  const PAGE_SIZE = 500;   // server-fixed
  const MAX_PAGES = 200;   // safety stop

  // ------------------------------------------------------------------- CORE

  /* Several values are URL-encoded INSIDE the JSON body. The portal's own client
   * does this, and the server expects it - send clean values and it answers
   * "Range [0, ...]" instead of a usable error. */
  async function query(offset, product, sdate, edate, box, filters) {
    const [minLon, minLat, maxLon, maxLat] = box;
    const body = {
      userId: CONFIG.userId,
      prod: "Standard",
      selSats: encodeURIComponent(product),
      offset: String(offset),
      sdate: encodeURIComponent(sdate),
      edate: encodeURIComponent(edate),
      query: "area",
      queryType: "polygon",
      isMX: "No",
      tllat: String(maxLat),
      tllon: String(minLon),
      brlat: String(minLat),
      brlon: String(maxLon),
      filters: encodeURIComponent(JSON.stringify(filters || {})),
      srt: CONFIG.srt,
    };
    const res = await fetch("/bhoonidhi/ProductSearch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { return { err: text.slice(0, 200) }; }
  }

  async function collect(product, sdate, edate, box, filters) {
    let offset = 0, rows = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const json = await query(offset, product, sdate, edate, box, filters);
      if (json.err) return { error: json.err, partial: rows.length, rows };
      const batch = json.Results || [];
      rows = rows.concat(batch);
      if (batch.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
    return { n: rows.length, rows };
  }

  function toCsv(manifests) {
    const esc = (v) => {
      v = (v === undefined || v === null) ? "" : String(v);
      return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    const lines = [["product"].concat(COLS).join(",")];
    for (const [key, m] of Object.entries(manifests)) {
      if (!m || !m.rows) continue;
      for (const r of m.rows) {
        lines.push([esc(key)].concat(COLS.map((c) => esc(r[c]))).join(","));
      }
    }
    return lines.join("\n");
  }

  function save(csv, filename) {
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "bhoonidhi_manifests_combined.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  // ------------------------------------------------------------------- RUN
  const state = { manifests: {}, progress: [], done: false };
  window.bhoonidhi = state;
  state.save = () => save(toCsv(state.manifests));

  (async () => {
    for (const [product, boxName, sdate, edate] of JOBS) {
      const result = await collect(product, sdate, edate, BOXES[boxName], {});
      state.manifests[product] = result;
      const note = result.error ? `ERROR ${result.error}` : `${result.n} scenes`;
      state.progress.push(`${product} [${boxName}]: ${note}`);
      console.log(state.progress[state.progress.length - 1]);
    }
    state.done = true;
    console.log("Done. Call bhoonidhi.save() to download the combined CSV.");
    state.save();
  })();

  console.log("Collecting. Watch bhoonidhi.progress, then call bhoonidhi.save().");
})();
