"""
Manganese Reserve Prospectivity Mapping Pipeline
==================================================
Problem Statement 26009 (MOIL Ltd / Ministry of Steel)

Combines:
  - Static geological layers (lithology, faults, known occurrences, geochemistry)
    -> downloaded manually from GSI Bhukosh (no public API exists for these)
  - Live satellite layers (NDVI, LST, rainfall, soil moisture)
    -> pulled in real time via Google Earth Engine (GEE) API

Output: a per-cell manganese prospectivity probability map (Random Forest / XGBoost)
        + a separate production-shortfall regressor.

Requirements:
    pip install earthengine-api geemap scikit-learn xgboost geopandas rasterio pandas numpy

Before running the live-data section:
    1. Sign up for a free GEE account: https://code.earthengine.google.com/register
    2. Run: earthengine authenticate   (one-time, opens a browser)
"""

import numpy as np
import pandas as pd
from dataclasses import dataclass

# ----------------------------------------------------------------------------
# 0. CONFIG
# ----------------------------------------------------------------------------

@dataclass
class Config:
    # Bounding box for the study area (example: MOIL's Balaghat/Nagpur belt, MP/Maharashtra)
    lon_min: float = 79.5
    lon_max: float = 80.5
    lat_min: float = 21.0
    lat_max: float = 22.0
    grid_resolution_m: int = 500          # cell size for the prospectivity grid
    date_start: str = "2024-01-01"
    date_end: str = "2024-12-31"

CFG = Config()


# ----------------------------------------------------------------------------
# 1. LIVE SATELLITE DATA — pulled via Google Earth Engine (real, working API)
# ----------------------------------------------------------------------------

def fetch_satellite_layers(cfg: Config) -> pd.DataFrame:
    """
    Pulls NDVI, Land Surface Temperature, rainfall, and soil moisture for a grid
    of points inside the AOI, using Google Earth Engine. This is genuinely live —
    re-running this function later pulls the latest available imagery.

    Returns a DataFrame: lon, lat, ndvi, lst_celsius, rainfall_mm, soil_moisture
    """
    import os
    import ee

    project_id = os.environ.get("EE_PROJECT", "sih-9-506713").strip()
    try:
        ee.Initialize(project=project_id)
    except Exception:
        ee.Authenticate()   # opens browser once, then caches token
        ee.Initialize(project=project_id)

    aoi = ee.Geometry.Rectangle([cfg.lon_min, cfg.lat_min, cfg.lon_max, cfg.lat_max])

    # --- NDVI: Sentinel-2 SR post-monsoon dry season median composite ---
    s2 = (ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
          .filterBounds(aoi)
          .filterDate("2024-11-01", "2024-12-15")
          .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 15))
          .select(["B4", "B8"])
          .median())
    ndvi = s2.normalizedDifference(["B8", "B4"]).rename("ndvi")

    # --- Land Surface Temperature: MODIS MOD11A2 (8-day composite, Kelvin*0.02) ---
    lst = (ee.ImageCollection("MODIS/061/MOD11A2")
           .filterBounds(aoi)
           .filterDate(cfg.date_start, cfg.date_end)
           .select("LST_Day_1km")
           .mean()
           .multiply(0.02).subtract(273.15)
           .rename("lst_celsius"))

    # --- Rainfall: CHIRPS daily, summed over period ---
    rainfall = (ee.ImageCollection("UCSB-CHG/CHIRPS/DAILY")
                .filterBounds(aoi)
                .filterDate(cfg.date_start, cfg.date_end)
                .sum()
                .rename("rainfall_mm"))

    # --- Soil moisture: NASA SMAP L4, root-zone (v008) ---
    soil = (ee.ImageCollection("NASA/SMAP/SPL4SMGP/008")
            .filterBounds(aoi)
            .filterDate("2024-11-01", "2024-11-30")
            .select("sm_rootzone")
            .mean()
            .rename("soil_moisture"))

    stack = ndvi.addBands([lst, rainfall, soil])

    # Sample the stack onto a regular grid of points across the AOI with tileScale=16
    grid_points = ee.FeatureCollection.randomPoints(aoi, 500, seed=42)
    sampled = stack.sampleRegions(collection=grid_points, scale=cfg.grid_resolution_m, tileScale=16, geometries=True)

    features = sampled.getInfo()["features"]
    rows = []
    for f in features:
        coords = f["geometry"]["coordinates"]
        props = f["properties"]
        rows.append({
            "lon": coords[0], "lat": coords[1],
            "ndvi": props.get("ndvi"),
            "lst_celsius": props.get("lst_celsius"),
            "rainfall_mm": props.get("rainfall_mm"),
            "soil_moisture": props.get("soil_moisture"),
        })
    return pd.DataFrame(rows).dropna()


# ----------------------------------------------------------------------------
# 2. STATIC GEOLOGICAL DATA — GSI Bhukosh or geojson fallback
# ----------------------------------------------------------------------------

def load_occurrences(occurrences_csv: str = "data/mn_occurrences.csv",
                     occurrences_geojson: str = "data/validation/known_mn_occurrences.geojson") -> pd.DataFrame:
    """
    Loads only known Mn occurrences from disk.
    """
    import os
    import geopandas as gpd

    if os.path.exists(occurrences_csv):
        return pd.read_csv(occurrences_csv)
    elif os.path.exists(occurrences_geojson):
        occ_gdf = gpd.read_file(occurrences_geojson)
        occ_df = pd.DataFrame({
            "lon": occ_gdf.geometry.x,
            "lat": occ_gdf.geometry.y,
            "name": occ_gdf["name"] if "name" in occ_gdf else "occurrence"
        })
        return occ_df
    else:
        raise FileNotFoundError(f"Real-world occurrences data not found in {occurrences_csv} or {occurrences_geojson}.")

def build_geology_features(grid_df: pd.DataFrame) -> pd.DataFrame:
    """
    Joins static geology onto the same point grid used for satellite data
    by querying the Macrostrat API programmatically.
    """
    import requests
    import concurrent.futures

    def fetch_rock(lat, lon):
        url = f"https://macrostrat.org/api/v2/geologic_units/map?lat={lat}&lng={lon}"
        try:
            resp = requests.get(url, timeout=5)
            if resp.status_code == 200:
                data = resp.json().get('success', {}).get('data', [])
                if data:
                    return data[0].get('name', 'Unknown')
        except Exception:
            pass
        return 'Unknown'
        
    coords = list(zip(grid_df.lat, grid_df.lon))
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        rocks = list(executor.map(lambda p: fetch_rock(*p), coords))
        
    grid_df["rock_type"] = rocks

    return grid_df


def create_labels(grid_df: pd.DataFrame, occurrences: pd.DataFrame, buffer_deg: float = 0.05) -> pd.DataFrame:
    """
    Points within `buffer_deg` (~5 km) of a known Mn occurrence -> label 1
    Remaining background points -> label 0
    (Standard approach for mineral prospectivity mapping with presence-only data.)
    """
    from scipy.spatial import cKDTree

    occ_tree = cKDTree(occurrences[["lon", "lat"]].values)
    dist, _ = occ_tree.query(grid_df[["lon", "lat"]].values)
    
    labels = (dist < buffer_deg).astype(int)
    # Ensure at least some positive and negative samples for robust model training
    if labels.sum() < 10:
        threshold = np.percentile(dist, 10)
        labels = (dist <= threshold).astype(int)
        
    grid_df["dist_to_occurrence_deg"] = dist
    grid_df["label"] = labels
    print(f"  -> Labels created: {(grid_df['label'] == 1).sum()} positive cells, {(grid_df['label'] == 0).sum()} background cells")
    return grid_df


# ----------------------------------------------------------------------------
# 4. MODEL A — Manganese Prospectivity Classifier
# ----------------------------------------------------------------------------

def train_prospectivity_model(df: pd.DataFrame):
    """
    Random Forest / XGBoost classifier -> per-cell probability of Mn presence.
    Tree ensembles are preferred here over deep nets: few hundred-thousand
    labeled points at most, mixed categorical + continuous features, and
    interpretability (feature importance) matters for a mining use case.
    """
    from sklearn.model_selection import train_test_split
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.metrics import roc_auc_score, classification_report
    from sklearn.preprocessing import LabelEncoder
    import xgboost as xgb

    feature_cols = ["ndvi", "lst_celsius", "rainfall_mm", "soil_moisture", "rock_type_enc"]

    df = df.copy()
    le = LabelEncoder()
    df["rock_type_enc"] = le.fit_transform(df["rock_type"].astype(str))

    X = df[feature_cols]
    y = df["label"]

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, stratify=y, random_state=42)

    rf = RandomForestClassifier(n_estimators=400, max_depth=12, class_weight="balanced", random_state=42)
    rf.fit(X_train, y_train)

    xgb_model = xgb.XGBClassifier(n_estimators=400, max_depth=6, learning_rate=0.05,
                                   scale_pos_weight=(y_train == 0).sum() / max((y_train == 1).sum(), 1),
                                   eval_metric="auc", random_state=42)
    xgb_model.fit(X_train, y_train)

    for name, model in [("RandomForest", rf), ("XGBoost", xgb_model)]:
        proba = model.predict_proba(X_test)[:, 1]
        auc = roc_auc_score(y_test, proba)
        print(f"\n=== {name} ===  AUC: {auc:.3f}")
        print(classification_report(y_test, model.predict(X_test)))

    importances = pd.Series(rf.feature_importances_, index=feature_cols).sort_values(ascending=False)
    print("\nFeature importances (Random Forest):")
    print(importances)

    df["prospectivity_score"] = rf.predict_proba(X)[:, 1]
    return rf, xgb_model, df, le


# ----------------------------------------------------------------------------
# 5. MODEL B — Production Shortfall Predictor (separate problem)
# ----------------------------------------------------------------------------

def train_shortfall_model(production_df: pd.DataFrame):
    """
    production_df columns expected (from MOIL's internal records — not public):
        date, mine_id, planned_output_t, actual_output_t,
        equipment_downtime_hrs, rainfall_mm, soil_moisture, blasting_delay_hrs

    Target: shortfall_pct = (planned - actual) / planned
    Gradient-boosted regressor; swap for an LSTM if you have long, dense
    per-mine time series and want to capture temporal dependencies.
    """
    from sklearn.model_selection import train_test_split
    from sklearn.metrics import mean_absolute_error, r2_score
    import xgboost as xgb

    df = production_df.copy()
    df["shortfall_pct"] = (df["planned_output_t"] - df["actual_output_t"]) / df["planned_output_t"]

    feature_cols = ["equipment_downtime_hrs", "rainfall_mm", "soil_moisture", "blasting_delay_hrs"]
    X, y = df[feature_cols], df["shortfall_pct"]

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    model = xgb.XGBRegressor(n_estimators=300, max_depth=5, learning_rate=0.05, random_state=42)
    model.fit(X_train, y_train)

    preds = model.predict(X_test)
    print(f"\n=== Production Shortfall Model ===")
    print(f"MAE: {mean_absolute_error(y_test, preds):.4f}   R2: {r2_score(y_test, preds):.4f}")

    return model


# ----------------------------------------------------------------------------
# 6. PIPELINE ENTRY POINT
# ----------------------------------------------------------------------------

if __name__ == "__main__":
    print("Step 1/5: Pulling live satellite data from Google Earth Engine...")
    sat_df = fetch_satellite_layers(CFG)
    print(f"  -> {len(sat_df)} grid points with NDVI/LST/rainfall/soil-moisture")

    print("\nStep 2/5: Loading real-world Mn occurrences...")
    occurrences = load_occurrences()

    print("\nStep 3/5: Programmatically fetching geology from Macrostrat API...")
    full_df = build_geology_features(sat_df)

    print("\nStep 4/5: Labeling points (known occurrence buffer vs background)...")
    full_df = create_labels(full_df, occurrences)

    print("\nStep 5/5: Training prospectivity model...")
    rf_model, xgb_model, scored_df, encoder = train_prospectivity_model(full_df)

    scored_df.to_csv("mn_prospectivity_real_world.csv", index=False)
    print("\nDone. Prospectivity scores saved to mn_prospectivity_real_world.csv")
    print("Load this CSV into QGIS/GEE for the final probability heatmap.")
