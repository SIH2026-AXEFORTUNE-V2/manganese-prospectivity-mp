"""A6 - Climate and moisture time series for the production-shortfall model.

This is the second half of PS 26009 and needs no geology at all. Rainfall, soil
moisture, land-surface temperature and vegetation drive mine downtime through pit
flooding, haul-road degradation and blasting delays.

Exported as CSV time series per site rather than rasters - the shortfall model is
tabular, so pulling 20 years of national-scale rasters would be pure waste.

    python -m src.gee.climate_series --sites data/validation/known_mn_occurrences.geojson
    python -m src.gee.climate_series --aoi belt_sausar   # AOI-mean fallback
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import ee
import pandas as pd

from src.config import ROOT, cfg, out_dir
from src.gee import auth
from src.gee.common import analysis_region

# Buffer around each mine point over which climate variables are averaged.
SITE_BUFFER_M = 5000


def _sites_from_geojson(path: Path) -> ee.FeatureCollection:
    with open(path, encoding="utf-8") as fh:
        gj = json.load(fh)
    features = [
        ee.Feature(
            ee.Geometry(f["geometry"]).buffer(SITE_BUFFER_M),
            {"site": f["properties"].get("name", f"site_{i}")},
        )
        for i, f in enumerate(gj["features"])
    ]
    return ee.FeatureCollection(features)


# Earth Engine aborts a collection query past ~5000 accumulated elements. One
# reduceRegions per image per site multiplies fast: CHIRPS daily over three years
# is ~1100 images, which across 9 mines is ~10k features and fails outright.
EE_ELEMENT_CAP = 4000


def _reduce_window(
    collection: ee.ImageCollection,
    bands: list[str],
    sites: ee.FeatureCollection,
    reducer: ee.Reducer,
) -> list[dict]:
    def per_image(img: ee.Image) -> ee.FeatureCollection:
        # setOutputs is required, not cosmetic. reduceRegions names its output
        # after the BAND when several bands are reduced, but after the REDUCER
        # ("mean") when there is only one - so single-band products like CHIRPS
        # silently came back as an all-NaN column keyed on the band name.
        stats = img.select(bands).reduceRegions(
            collection=sites, reducer=reducer.setOutputs(bands), scale=1000
        )
        date = img.date().format("YYYY-MM-dd")
        return stats.map(lambda f: f.set("date", date).setGeometry(None))

    return collection.map(per_image).flatten().getInfo()["features"]


def _reduce_series(
    collection: ee.ImageCollection,
    bands: list[str],
    sites: ee.FeatureCollection,
    reducer: ee.Reducer,
    start: str,
    end: str,
    n_sites: int,
) -> list[dict]:
    """Per-image, per-site zonal mean, chunked to stay under the element cap.

    Chunk width is derived from the actual image count rather than guessed, so a
    3-hourly product (SMAP) and a daily one (CHIRPS) both work without tuning.
    """
    total = collection.size().getInfo()
    if total == 0:
        return []

    per_chunk_images = max(1, EE_ELEMENT_CAP // max(n_sites, 1))
    n_chunks = max(1, -(-total // per_chunk_images))

    begin, finish = pd.Timestamp(start), pd.Timestamp(end)
    edges = pd.date_range(begin, finish, periods=n_chunks + 1)

    out: list[dict] = []
    for i in range(n_chunks):
        lo = edges[i].strftime("%Y-%m-%d")
        # filterDate's end is exclusive, so the next chunk starts exactly here.
        # Adding a day instead would double-count the boundary date.
        hi = edges[i + 1].strftime("%Y-%m-%d")
        if i == n_chunks - 1:
            hi = (edges[i + 1] + pd.Timedelta(days=1)).strftime("%Y-%m-%d")
        window = collection.filterDate(lo, hi)
        try:
            out.extend(_reduce_window(window, bands, sites, reducer))
        except ee.EEException as exc:
            print(f"      chunk {lo}..{hi} failed: {str(exc)[:80]}")
        if n_chunks > 1:
            print(f"      chunk {i + 1}/{n_chunks} ({lo}) -> {len(out)} rows", flush=True)
    return out


def _to_frame(features: list[dict], value_cols: list[str]) -> pd.DataFrame:
    rows = []
    for feat in features:
        props = feat["properties"]
        row = {"date": props.get("date"), "site": props.get("site")}
        for col in value_cols:
            row[col] = props.get(col)
        rows.append(row)
    frame = pd.DataFrame(rows)
    if not frame.empty:
        frame["date"] = pd.to_datetime(frame["date"])
        frame = frame.sort_values(["site", "date"]).reset_index(drop=True)
    return frame


def export_series(sites: ee.FeatureCollection, start: str, end: str, out: Path) -> None:
    """Pull each climate product and write one CSV per product."""
    conf = cfg()["gee"]["climate"]

    products = {
        "rainfall_chirps": (conf["rainfall"]["collection"], [conf["rainfall"]["band"]], ee.Reducer.mean()),
        "lst_modis": (conf["lst"]["collection"], conf["lst"]["bands"], ee.Reducer.mean()),
        "soil_moisture_smap": (conf["soil_moisture"]["collection"], conf["soil_moisture"]["bands"], ee.Reducer.mean()),
        "era5_land": (conf["era5"]["collection"], conf["era5"]["bands"], ee.Reducer.mean()),
    }

    for name, (collection_id, bands, reducer) in products.items():
        print(f"  {name}: {collection_id}")
        try:
            collection = (
                ee.ImageCollection(collection_id)
                .filterDate(start, end)
                .filterBounds(sites.geometry())
            )
            n = collection.size().getInfo()
            if n == 0:
                print(f"    no images in range - skipped")
                continue
            print(f"    {n} images, reducing...")
            n_sites = sites.size().getInfo()
            features = _reduce_series(collection, bands, sites, reducer, start, end, n_sites)
            frame = _to_frame(features, bands)
            path = out / f"{name}.csv"
            frame.to_csv(path, index=False)
            print(f"    wrote {len(frame)} rows -> {path.relative_to(ROOT)}")
        except ee.EEException as exc:
            # One unavailable collection should not abort the whole pull.
            print(f"    FAILED: {exc}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sites", help="GeoJSON of mine sites to sample")
    parser.add_argument("--aoi", help="fall back to AOI centroid if no sites file")
    parser.add_argument("--start", help="override start date, YYYY-MM-DD")
    parser.add_argument("--end", help="override end date, YYYY-MM-DD")
    args = parser.parse_args()

    auth.init()
    conf = cfg()["gee"]["climate"]
    start = args.start or conf["start_date"]
    end = args.end or pd.Timestamp.today().strftime("%Y-%m-%d")

    if args.sites:
        path = Path(args.sites)
        if not path.is_absolute():
            path = ROOT / path
        if not path.exists():
            print(
                f"ERROR: {path} not found.\n"
                "Build the site file first: python -m src.validate.build_validation_set --template"
            )
            return 1
        sites = _sites_from_geojson(path)
    elif args.aoi:
        sites = ee.FeatureCollection(
            [ee.Feature(analysis_region(args.aoi), {"site": args.aoi})]
        )
    else:
        print("ERROR: pass --sites or --aoi")
        return 1

    out = out_dir("processed", "climate")
    print(f"Climate series {start} -> {end}")
    export_series(sites, start, end, out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
