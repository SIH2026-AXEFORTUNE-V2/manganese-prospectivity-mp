"""Compute the Pillar-2 payload the dashboard renders.

Runs the forecast, driver attribution and corrective-action chain for every mine
and writes one JSON the page can load. Doing it here rather than in the browser
keeps the modelling in Python, where it is testable, and keeps the page a view.

MONTHLY TARGETS
    MOIL's actual HQ targets are not public. Rather than invent a number per mine,
    each target is derived as a fixed stretch over what that mine delivers in a
    normal month of that season - which is how targets are usually set, and which
    makes "plan vs normal capacity" a meaningful bar rather than a tautology.
    The stretch factor is stated on screen.

    python -m src.dashboard.build_operations
"""

from __future__ import annotations

import argparse
import json

import pandas as pd

from src.config import ROOT
from src.shortfall.actions import recommend
from src.shortfall.attribution import attribute
from src.shortfall.forecast import backtest, forecast_month, load_production
from src.synth.registers import MINES

OUT = ROOT / "dashboard" / "assets"

# Targets are set this much above a normal month for the season.
STRETCH = 1.06
# Day of month the forecast is made - the whole point is acting early.
AS_OF_DAY = 8


def target_for(prod: pd.DataFrame, mine: str, period: pd.Period) -> float:
    hist = prod[(prod.mine == mine) & (prod.date < period.start_time)]
    same_month = hist[hist.date.dt.month == period.month]
    if len(same_month) < 20:
        same_month = hist
    if same_month.empty:
        return 0.0
    return round(float(same_month.ore_tonnes.median()) * period.days_in_month * STRETCH, -1)


def build(month: str | None = None) -> dict:
    prod = load_production()
    period = pd.Period(month, freq="M") if month else prod.date.max().to_period("M")
    as_of = (period.start_time + pd.Timedelta(days=AS_OF_DAY - 1)).strftime("%Y-%m-%d")

    mines_payload = []
    for m in MINES:
        rows = prod[(prod.mine == m.name) & (prod.date.dt.to_period("M") == period)]
        if rows.empty:
            continue
        target = target_for(prod, m.name, period)
        if target <= 0:
            continue

        try:
            f = forecast_month(m.name, str(period), target, as_of, prod)
            wf = attribute(m.name, str(period), target, as_of)
        except ValueError as exc:
            print(f"  {m.name}: skipped ({exc})")
            continue

        remaining = f.remaining_days
        actions = recommend(wf, remaining)

        try:
            bt = backtest(m.name, prod)
            mape = round(float(bt.error_pct.abs().mean()), 2)
            coverage = round(float(bt.in_band.mean()) * 100)
            bt_rows = bt.tail(8).to_dict("records")
        except Exception:
            mape, coverage, bt_rows = None, None, []

        mines_payload.append({
            "mine": m.name,
            "method": m.method,
            "target_t": target,
            "mtd_t": f.mtd_tonnes,
            "projected_t": f.projected_tonnes,
            "low_t": f.low,
            "high_t": f.high,
            "elapsed_days": f.elapsed_days,
            "remaining_days": remaining,
            "attainment_pct": round(f.attainment, 1) if f.attainment else None,
            "gap_t": round(f.gap) if f.gap is not None else None,
            "recoverable_t": round(wf.recoverable_tonnes),
            "drivers": [
                {"code": d.code, "label": d.label, "tonnes": d.tonnes,
                 "recoverable": d.recoverable, "detail": d.detail}
                for d in wf.drivers
            ],
            "actions": [a.as_row() | {"rationale": a.rationale, "assumptions": a.assumptions}
                        for a in actions],
            "backtest": {"mape_pct": mape, "band_coverage_pct": coverage, "recent": bt_rows},
        })

    # Fleet detail for the risk radar: machines deepest into their service cycle.
    equip = pd.read_csv(ROOT / "data/processed/operations/equipment_log.csv",
                        parse_dates=["date"])
    latest = equip[equip.date == equip.date.max()]
    at_risk = (latest.sort_values("days_since_service", ascending=False)
               .head(12)[["mine", "machine_id", "days_since_service"]]
               .to_dict("records"))

    rain = pd.read_csv(ROOT / "data/processed/climate/rainfall_chirps.csv",
                       parse_dates=["date"])
    rain_month = rain[rain.date.dt.to_period("M") == period]

    return {
        "month": str(period),
        "as_of": as_of,
        "stretch_factor": STRETCH,
        "mines": mines_payload,
        "fleet_at_risk": at_risk,
        "rain_summary": {
            "days_over_10mm": int((rain_month.precipitation >= 10).sum() / max(1, rain_month.site.nunique())),
            "peak_mm": round(float(rain_month.precipitation.max()), 1) if len(rain_month) else 0.0,
        },
        "provenance": {
            "rainfall": "REAL - CHIRPS satellite observations",
            "soil_moisture": "REAL - SMAP",
            "production": "SYNTHETIC - modelled from the real rainfall",
            "equipment": "SYNTHETIC - hazard model, seeded",
            "blasts": "SYNTHETIC - modelled",
            "targets": f"DERIVED - normal seasonal capacity x {STRETCH}",
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--month", default=None)
    args = parser.parse_args()

    payload = build(args.month)
    OUT.mkdir(parents=True, exist_ok=True)
    dest = OUT / "operations.json"
    dest.write_text(json.dumps(payload, separators=(",", ":"), default=str), encoding="utf-8")

    print(f"month {payload['month']}, forecast made {payload['as_of']}\n")
    print(f"{'mine':<28}{'target':>9}{'proj':>9}{'att%':>7}{'gap':>9}{'actions':>9}")
    print("-" * 72)
    for m in payload["mines"]:
        print(f"{m['mine'][:27]:<28}{m['target_t']:>9,.0f}{m['projected_t']:>9,.0f}"
              f"{m['attainment_pct']:>7.1f}{m['gap_t']:>+9,.0f}{len(m['actions']):>9}")
    print(f"\nwrote {dest.relative_to(ROOT)}  ({dest.stat().st_size / 1024:.0f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
