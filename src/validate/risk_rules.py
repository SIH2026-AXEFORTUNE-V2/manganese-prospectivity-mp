import json
import random
from datetime import datetime, timedelta
from pathlib import Path

# The 11 MOIL operating mines. We use this to ensure Gumgaon and Sitapatore are included
# even if they are missing from the GeoJSON.
MOIL_MINES = [
    "Kandri", "Munsar", "Beldongri (via Satak P.O.)", "Gumgaon", "Chikla",
    "Balaghat / Bharveli", "Ukwa", "Dongri Buzurg", "Sitapatore", "Tirodi", "Mansar"
]

def load_mines(geojson_path: Path):
    with open(geojson_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    
    mines = []
    found_names = set()
    for feat in data.get("features", []):
        props = feat.get("properties", {})
        coords = feat.get("geometry", {}).get("coordinates", [0, 0])
        name = props.get("name", "Unknown")
        
        # Determine mine_type and depth_m
        mine_type = props.get("mine_type", "unknown")
        depth_m = 383 if "Balaghat" in name else None
        
        mines.append({
            "mine_id": name.lower().replace(" ", "_").replace("/", "").replace("(", "").replace(")", "").replace(".", ""),
            "name": name,
            "lon": coords[0],
            "lat": coords[1],
            "mine_type": mine_type,
            "depth_m": depth_m
        })
        found_names.add(name)
        
    # Inject missing ones if any
    if "Gumgaon" not in found_names:
        mines.append({
            "mine_id": "gumgaon", "name": "Gumgaon", "lon": 78.966, "lat": 21.350, "mine_type": "underground", "depth_m": None
        })
    if "Sitapatore" not in found_names:
        mines.append({
            "mine_id": "sitapatore", "name": "Sitapatore", "lon": 79.690, "lat": 21.560, "mine_type": "opencast", "depth_m": None
        })
        
    return mines

def simulate_climate_series(days=30):
    """
    Generate 30 days of synthetic climate data.
    """
    series = []
    end_date = datetime.now()
    start_date = end_date - timedelta(days=days-1)
    
    # Randomly decide if this mine is experiencing a "weather event"
    weather_event = random.choice(["heavy_rain", "extreme_heat", "normal", "normal", "normal"])
    
    for i in range(days):
        current_date = start_date + timedelta(days=i)
        
        # Base normal weather
        rainfall = max(0, random.gauss(5, 10))
        soil_moisture = max(0.1, min(0.5, random.gauss(0.2, 0.05)))
        lst_c = max(20, random.gauss(30, 5))
        ndvi = max(0.2, min(0.8, random.gauss(0.5, 0.1)))
        
        # Apply weather events to recent days (last 5 days)
        if i >= days - 5:
            if weather_event == "heavy_rain":
                rainfall = max(55, random.gauss(70, 20))
                soil_moisture = max(0.4, random.gauss(0.45, 0.05))
            elif weather_event == "extreme_heat":
                lst_c = max(46, random.gauss(48, 2))
                soil_moisture = max(0.1, random.gauss(0.15, 0.05))
                rainfall = 0
                
        series.append({
            "date": current_date.strftime("%Y-%m-%d"),
            "rainfall_mm": round(rainfall, 1),
            "soil_moisture": round(soil_moisture, 2),
            "lst_c": round(lst_c, 1),
            "ndvi": round(ndvi, 2)
        })
        
    return series

def evaluate_risk(series):
    """
    Evaluate rule-based risk tiers based on climate variables.
    
    Thresholds and rationales:
    - rainfall_mm > 100: "critical" (Flood risk in pits/shafts, halts all haulage)
    - rainfall_mm > 50: "watch" (Heavy rain reduces visibility and slows haulage operations)
    - lst_c > 45: "critical" (Extreme heat triggers worker safety / heatstroke protocols)
    - soil_moisture > 0.35 for 3 consecutive days: "watch" (Sustained moisture precedes haul-road degradation and slope instability)
    """
    reasons = []
    tier = "normal"
    
    # Check max values
    max_rainfall = max(s["rainfall_mm"] for s in series)
    max_lst = max(s["lst_c"] for s in series)
    
    if max_rainfall > 100:
        tier = "critical"
        reasons.append(f"rainfall_mm exceeded critical threshold (>100mm) with {max_rainfall}mm")
    elif max_rainfall > 50:
        tier = "critical" if tier == "critical" else "watch"
        reasons.append(f"rainfall_mm exceeded watch threshold (>50mm) with {max_rainfall}mm")
        
    if max_lst > 45:
        tier = "critical"
        reasons.append(f"lst_c exceeded safety threshold (>45°C) with {max_lst}°C")
        
    # Check consecutive soil moisture
    consecutive_moisture = 0
    for s in series:
        if s["soil_moisture"] > 0.35:
            consecutive_moisture += 1
        else:
            consecutive_moisture = 0
            
        if consecutive_moisture >= 3:
            tier = "critical" if tier == "critical" else "watch"
            reasons.append("soil_moisture above 0.35 threshold for 3+ consecutive days")
            break # Only add reason once
            
    # Remove duplicates from reasons if any
    reasons = list(dict.fromkeys(reasons))
    
    return tier, reasons

def generate_risk_data(geojson_path: Path):
    """
    Entry point to generate the full risk.json structure.
    """
    mines = load_mines(geojson_path)
    risk_data = []
    
    for mine in mines:
        series = simulate_climate_series()
        tier, reasons = evaluate_risk(series)
        
        mine_entry = {
            "mine_id": mine["mine_id"],
            "name": mine["name"],
            "lat": mine["lat"],
            "lon": mine["lon"],
            "mine_type": mine["mine_type"],
            "depth_m": mine["depth_m"],
            "series": series,
            "risk_tier": tier,
            "risk_reasons": reasons
        }
        risk_data.append(mine_entry)
        
    return risk_data

if __name__ == "__main__":
    import sys
    # Test generation
    path = Path("../../data/validation/known_mn_occurrences.geojson")
    if not path.exists():
        path = Path("data/validation/known_mn_occurrences.geojson")
    if path.exists():
        data = generate_risk_data(path)
        print(json.dumps(data, indent=2))
    else:
        print(f"GeoJSON not found at {path}")
        sys.exit(1)
