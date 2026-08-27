"""Generate operational registers for the nine MOIL mines.

THESE RECORDS ARE SYNTHETIC. SAY SO EVERYWHERE.
    MOIL's daily production, equipment and blast registers are not public. Rather
    than invent an operational history end to end, this generates the ledger *from
    real weather*: every rain-day comes from CHIRPS satellite observations for that
    mine on that date. Only the tonnage response is modelled.

    So when the driver waterfall later says "rain cost 2,100 t", the rain is a real
    measurement and the coefficient is an assumption. That distinction is the whole
    point, and it is why this module writes `synthetic: true` on every row and why
    the UI must never render one without a marker.

    Mine capacities are ILLUSTRATIVE. They are scaled to put total annual output in
    the published MOIL ballpark (~1.1-1.3 Mt/yr) with Balaghat largest, but no
    per-mine figure here should be read as MOIL's actual rated capacity.

    python -m src.synth.registers --start 2024-04-01 --end 2026-07-31
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass

import numpy as np
import pandas as pd

from src.config import ROOT, out_dir
from src.ingest.reason_codes import CODES

SEED = 26009
CLIMATE = ROOT / "data" / "processed" / "climate" / "rainfall_chirps.csv"

# Rainfall thresholds, mm/day. Below light, mining is unaffected; above heavy the
# pit is worked at a fraction; above washout it stops. Open-cast is far more
# exposed than underground, which is the main structural difference between mines.
RAIN_LIGHT, RAIN_HEAVY, RAIN_WASHOUT = 10.0, 25.0, 55.0


@dataclass(frozen=True)
class Mine:
    name: str
    method: str            # opencast | underground
    daily_capacity_t: float
    grade_mean: float      # Mn %
    grade_sd: float
    fleet: tuple[str, ...]
    benches: tuple[str, ...]


MINES: tuple[Mine, ...] = (
    Mine("Balaghat / Bharveli", "underground", 1115, 39.5, 2.6,
         ("EX-201", "EX-204", "LHD-11", "LHD-12", "DT-31", "DT-32", "DT-33"),
         ("Level-4", "Level-6", "Stope-2B", "Stope-3A")),
    Mine("Ukwa", "underground", 400, 36.0, 3.0,
         ("EX-210", "LHD-21", "DT-41", "DT-42"),
         ("Level-2", "Level-3", "Stope-1A")),
    Mine("Chikla", "underground", 330, 41.0, 2.4,
         ("EX-215", "LHD-31", "DT-51", "DT-52"),
         ("Level-1", "Level-3", "Stope-4C")),
    Mine("Munsar", "underground", 295, 37.5, 2.8,
         ("EX-220", "LHD-41", "DT-61"),
         ("Level-2", "Stope-2A")),
    Mine("Mansar", "underground", 260, 38.0, 2.7,
         ("EX-225", "LHD-51", "DT-71"),
         ("Level-1", "Level-2")),
    Mine("Kandri", "underground", 230, 35.5, 3.1,
         ("EX-230", "LHD-61", "DT-81"),
         ("Level-1", "Stope-1B")),
    Mine("Beldongri (via Satak P.O.)", "underground", 200, 34.0, 3.4,
         ("EX-235", "LHD-71", "DT-91"),
         ("Level-1", "Level-2")),
    Mine("Tirodi", "opencast", 470, 33.0, 3.6,
         ("EX-240", "EX-241", "DT-101", "DT-102", "DT-103", "DZ-01"),
         ("Bench-1", "Bench-3", "Bench-5")),
    Mine("Dongri Buzurg", "opencast", 430, 32.5, 3.8,
         ("EX-250", "EX-251", "DT-111", "DT-112", "DZ-02"),
         ("Bench-2", "Bench-4", "Bench-6")),
)

BY_NAME = {m.name: m for m in MINES}


def rain_factor(mm: float, method: str) -> tuple[float, bool]:
    """Fraction of capacity achievable, and whether rain is the binding cause.

    Open-cast loses the face to standing water and haul roads soften; underground
    keeps producing but hoisting, ventilation and surface haulage still suffer.
    """
    exposure = 1.0 if method == "opencast" else 0.45

    if mm >= RAIN_WASHOUT:
        loss = 0.92 * exposure
    elif mm >= RAIN_HEAVY:
        loss = (0.35 + 0.45 * (mm - RAIN_HEAVY) / (RAIN_WASHOUT - RAIN_HEAVY)) * exposure
    elif mm >= RAIN_LIGHT:
        loss = 0.16 * ((mm - RAIN_LIGHT) / (RAIN_HEAVY - RAIN_LIGHT)) * exposure
    else:
        loss = 0.0
    return max(0.0, 1.0 - loss), mm >= RAIN_LIGHT


def _machine_states(mine: Mine, dates: pd.DatetimeIndex, rng: np.random.Generator) -> dict:
    """Per-machine up/down timeline from a simple hazard model.

    Failure hazard rises with days since service, which is what makes the
    maintenance-advancement action meaningful later: a machine deep into its cycle
    is genuinely more likely to fail, so pre-empting it recovers real tonnage.
    """
    states = {}
    for machine in mine.fleet:
        since_service = rng.integers(0, 90)
        down_left = 0
        rows = []
        for _ in dates:
            if down_left > 0:
                rows.append(("down", since_service))
                down_left -= 1
                if down_left == 0:
                    since_service = 0
                continue
            hazard = 0.0018 + 0.00010 * max(0, since_service - 45)
            if rng.random() < hazard:
                down_left = int(rng.integers(2, 9))
                rows.append(("down", since_service))
            else:
                rows.append(("up", since_service))
                since_service += 1
        states[machine] = rows
    return states


def generate(start: str, end: str, seed: int = SEED) -> dict[str, pd.DataFrame]:
    if not CLIMATE.exists():
        raise FileNotFoundError(
            f"{CLIMATE.relative_to(ROOT)} not found. Run:\n"
            "  python -m src.gee.climate_series --sites data/validation/known_mn_occurrences.geojson"
        )

    rain = pd.read_csv(CLIMATE, parse_dates=["date"])
    rain = rain[(rain.date >= start) & (rain.date <= end)]
    # Chunked Earth Engine pulls can repeat a boundary date; one row per site-day.
    rain = rain.groupby(["site", "date"], as_index=False)["precipitation"].mean()

    rng = np.random.default_rng(seed)
    prod_rows, equip_rows, blast_rows = [], [], []

    for mine in MINES:
        site_rain = rain[rain.site == mine.name].set_index("date")["precipitation"]
        if site_rain.empty:
            print(f"  WARNING: no rainfall rows for {mine.name} - skipped")
            continue
        dates = pd.DatetimeIndex(sorted(site_rain.index.unique()))
        states = _machine_states(mine, dates, rng)

        for i, day in enumerate(dates):
            mm = float(site_rain.loc[day]) if day in site_rain.index else 0.0
            rfac, rain_binding = rain_factor(mm, mine.method)

            up = sum(1 for m in mine.fleet if states[m][i][0] == "up")
            avail = up / len(mine.fleet)

            # Sunday is a maintenance/short shift day across Indian mines.
            day_factor = 0.55 if day.dayofweek == 6 else 1.0

            noise = float(rng.normal(1.0, 0.06))
            tonnes = mine.daily_capacity_t * rfac * avail * day_factor * noise
            tonnes = max(0.0, tonnes)

            # Grade drifts slowly by bench and dips when working wet ground.
            bench = mine.benches[i % len(mine.benches)]
            grade = float(rng.normal(mine.grade_mean, mine.grade_sd))
            if mm >= RAIN_HEAVY:
                grade -= 1.2   # dilution from wet, sloughed material
            grade = float(np.clip(grade, 18.0, 52.0))

            prod_rows.append({
                "date": day.date(), "mine": mine.name, "shift": "aggregate",
                "bench_or_stope_id": bench,
                "ore_tonnes": round(tonnes, 1),
                "waste_tonnes": round(tonnes * float(rng.uniform(0.8, 2.1)), 1),
                "grade_Mn_pct": round(grade, 2),
                "operating_hours": round(18 * avail * day_factor, 1),
                "rainfall_mm": round(mm, 2),
                "fleet_availability": round(avail, 3),
                "synthetic": True,
            })

            for machine in mine.fleet:
                state, since = states[machine][i]
                if state == "down":
                    code = "RAIN" if rain_binding and rng.random() < 0.25 else (
                        "BREAKDOWN_ELEC" if rng.random() < 0.3 else "BREAKDOWN_MECH")
                    equip_rows.append({
                        "date": day.date(), "mine": mine.name, "machine_id": machine,
                        "hours_run": 0.0, "downtime_hours": 18.0,
                        "downtime_reason_code": code,
                        "days_since_service": int(since), "synthetic": True,
                    })
                else:
                    down_h = 0.0
                    code = ""
                    if rain_binding:
                        down_h = round(18 * (1 - rfac), 1)
                        code = "RAIN" if down_h > 0 else ""
                    equip_rows.append({
                        "date": day.date(), "mine": mine.name, "machine_id": machine,
                        "hours_run": round(18 * day_factor - down_h, 1),
                        "downtime_hours": down_h,
                        "downtime_reason_code": code,
                        "days_since_service": int(since), "synthetic": True,
                    })

            # Blasts roughly twice a week at open-cast, weekly underground.
            cadence = 3 if mine.method == "opencast" else 7
            if i % cadence == 0 and day.dayofweek != 6:
                delayed = mm >= RAIN_HEAVY or rng.random() < 0.06
                reason = ""
                if delayed:
                    reason = "RAIN" if mm >= RAIN_HEAVY else (
                        "EXPLOSIVE_SHORTAGE" if rng.random() < 0.5 else "STATUTORY_HOLD")
                blast_rows.append({
                    "date": day.date(), "mine": mine.name, "bench_id": bench,
                    "holes": int(rng.integers(18, 46)),
                    "explosive_kg": int(rng.integers(400, 1400)),
                    "tonnage_broken": 0 if delayed else int(tonnes * rng.uniform(2.5, 4.0)),
                    "delay_flag": bool(delayed),
                    "delay_reason_code": reason,
                    "synthetic": True,
                })

    frames = {
        "production_daily": pd.DataFrame(prod_rows),
        "equipment_log": pd.DataFrame(equip_rows),
        "blast_register": pd.DataFrame(blast_rows),
    }
    for name, f in frames.items():
        bad = set(f.get("downtime_reason_code", pd.Series(dtype=str)).dropna()) - set(CODES) - {""}
        bad |= set(f.get("delay_reason_code", pd.Series(dtype=str)).dropna()) - set(CODES) - {""}
        assert not bad, f"{name} emitted reason codes outside the master: {bad}"
    return frames


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start", default="2024-04-01")
    parser.add_argument("--end", default="2026-07-31")
    parser.add_argument("--seed", type=int, default=SEED)
    args = parser.parse_args()

    print("SYNTHETIC OPERATIONAL REGISTERS")
    print("  rainfall: REAL (CHIRPS satellite observations)")
    print("  tonnage, downtime, blasts: MODELLED from that rainfall\n")

    frames = generate(args.start, args.end, args.seed)
    dest = out_dir("processed", "operations")

    for name, frame in frames.items():
        path = dest / f"{name}.csv"
        frame.to_csv(path, index=False)
        print(f"  {name:<20} {len(frame):>7,} rows -> {path.relative_to(ROOT)}")

    prod = frames["production_daily"]
    annual = prod.groupby(prod.mine).ore_tonnes.sum() / (
        (pd.Timestamp(args.end) - pd.Timestamp(args.start)).days / 365.25)
    print(f"\n  implied annual output: {annual.sum() / 1e6:.2f} Mt across {len(annual)} mines")
    print("  (published MOIL scale is ~1.1-1.3 Mt/yr - capacities are illustrative)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
