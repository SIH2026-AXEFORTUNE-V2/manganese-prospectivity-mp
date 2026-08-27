"""Engine 4b - decompose the production gap into named, quantified causes.

This is the answer to "why are we short", and it is the screen a mine head opens
first. A forecast that says 88% of target and stops is a worse tool than no
forecast: it creates alarm without a handle.

METHOD - COSTED AGAINST NORMAL, NOT AGAINST ZERO
    The obvious counterfactual is "what if it had not rained at all", and it is
    wrong. A July target already assumes a monsoon; charging the plan for every
    wet-day tonne double-counts what the planner had allowed for. Doing that here
    produced a -2,089 t rain bar against a -596 t gap, and dumped the difference
    into an implausible +1,879 t residual.

    So every driver is costed against the SEASONAL NORMAL for that mine and that
    calendar month, drawn from its own history. Rain is charged only for the
    excess over a normal July; downtime only for hours above the usual.

    The chain is: target -> plan optimism -> normal capacity -> named deviations
    -> forecast. Separating plan optimism matters: a target set above what the
    fleet can deliver in an average month is a planning problem, not an
    operational one, and telling a planner that on day 8 is the whole point.

    Causes still interact - a machine down on a rain day costs less than the two
    effects added separately - so a residual remains. It is shown as its own bar
    rather than scaled away. A waterfall that always closes perfectly is one that
    has been fudged.

    python -m src.shortfall.attribution --mine Tirodi --month 2026-07 --target 12500
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from src.config import ROOT
from src.ingest.reason_codes import ActionClass, get as get_reason
from src.shortfall.forecast import load_production, forecast_month
from src.synth.registers import rain_factor

OPS = ROOT / "data" / "processed" / "operations"


@dataclass
class Driver:
    code: str
    label: str
    tonnes: float                  # negative = lost tonnage
    recoverable: bool
    addressed_by: str
    detail: str = ""


@dataclass
class Waterfall:
    mine: str
    month: str
    target: float
    forecast: float
    drivers: list[Driver] = field(default_factory=list)

    @property
    def gap(self) -> float:
        return self.forecast - self.target

    @property
    def recoverable_tonnes(self) -> float:
        return -sum(d.tonnes for d in self.drivers if d.recoverable and d.tonnes < 0)

    @property
    def explained(self) -> float:
        return sum(d.tonnes for d in self.drivers)


def _load(name: str) -> pd.DataFrame:
    path = OPS / f"{name}.csv"
    if not path.exists():
        raise FileNotFoundError(f"{path.relative_to(ROOT)} missing - run src.synth.registers")
    return pd.read_csv(path, parse_dates=["date"])


def attribute(mine: str, month: str, target: float, as_of: str | None = None) -> Waterfall:
    prod_all = load_production()
    prod = prod_all[prod_all.mine == mine]
    period = pd.Period(month, freq="M")
    month_rows = prod[prod.date.dt.to_period("M") == period]
    if month_rows.empty:
        raise ValueError(f"No production for {mine} in {month}")

    f = forecast_month(mine, month, target, as_of, prod_all)
    wf = Waterfall(mine=mine, month=month, target=target, forecast=f.projected_tonnes)

    history = prod[prod.date < period.start_time]
    same_month = history[history.date.dt.month == period.month]
    if len(same_month) < 20:
        same_month = history

    # What this mine delivers in a NORMAL month of this season - the honest
    # baseline. Includes typical rain and typical breakdowns, because the target
    # was set knowing those happen.
    normal_per_day = float(same_month.ore_tonnes.median())
    # Days actually recorded, not calendar days - a part-month must not be charged
    # for days that were never worked or never logged.
    days = len(month_rows)
    normal_capacity = normal_per_day * days

    # ---- plan optimism ---------------------------------------------------
    optimism = normal_capacity - target
    if abs(optimism) > 1:
        wf.drivers.append(Driver(
            "PLAN_OPTIMISM",
            "Plan vs normal capacity", round(optimism, 0), False, "none",
            f"a normal {period.strftime('%B')} here delivers ~{normal_capacity:,.0f} t"
            + (" - target is above that before work starts" if optimism < 0 else ""),
        ))

    # ---- rain, charged on SEVERITY over a normal season -------------------
    # Counting wet days is not enough. July 2026 at Tirodi had 16 rain-days against
    # a normal 16.5 - no excess by count - yet delivered 368 t/day against a normal
    # 441, because the rain was heavier. Severity is the sum of per-day capacity
    # loss implied by observed rainfall, which sees intensity as well as frequency.
    method = "opencast" if mine in ("Tirodi", "Dongri Buzurg") else "underground"

    def severity(rain_series) -> float:
        return float(sum(1.0 - rain_factor(float(mm), method)[0] for mm in rain_series))

    month_sev = severity(month_rows.rainfall_mm)
    normal_sev = severity(same_month.rainfall_mm) / len(same_month) * days
    excess_sev = month_sev - normal_sev

    wet = month_rows[month_rows.rainfall_mm >= 10]
    if excess_sev > 0.05:
        rain_loss = excess_sev * normal_per_day
        rc = get_reason("RAIN")
        wf.drivers.append(Driver(
            "RAIN", rc.label, -round(rain_loss, 0), rc.addressed_by is not ActionClass.NONE,
            rc.addressed_by.value,
            f"{len(wet)} rain-days (CHIRPS), {wet.rainfall_mm.max():.0f} mm peak; "
            f"severity {month_sev:.1f} vs {normal_sev:.1f} normal",
        ))

    # ---- fleet availability ---------------------------------------------
    # Attributed on AVAILABILITY, not on summed downtime hours by reason code.
    # Availability is what actually moves tonnage, and charging each breakdown
    # code separately double-counts machines that were down together. The named
    # codes still appear, as the explanation inside this bar.
    equip = _load("equipment_log")
    equip_month = equip[(equip.mine == mine) & (equip.date.dt.to_period("M") == period)]

    normal_avail = float(same_month.fleet_availability.median())
    month_avail = float(month_rows.fleet_availability.mean())
    avail_gap = normal_avail - month_avail

    if avail_gap > 0.005:
        lost = normal_capacity * (avail_gap / normal_avail) * (len(month_rows) / days)
        if lost > 1 and not equip_month.empty:
            downs = equip_month[equip_month.downtime_reason_code.isin(
                ["BREAKDOWN_MECH", "BREAKDOWN_ELEC"])]
            if len(downs):
                worst = downs.groupby("machine_id").downtime_hours.sum().idxmax()
                code = downs.downtime_reason_code.mode()[0]
                worst_h = downs.groupby("machine_id").downtime_hours.sum().max()
            else:
                worst, code, worst_h = "-", "BREAKDOWN_MECH", 0.0
            rc = get_reason(code)
            wf.drivers.append(Driver(
                code, "Fleet availability", -round(lost, 0), rc.preventable,
                rc.addressed_by.value,
                f"{month_avail * 100:.0f}% vs {normal_avail * 100:.0f}% normal; "
                f"worst machine {worst} ({worst_h:.0f} h down)",
            ))

    # ---- grade dilution --------------------------------------------------
    # Grade below plan does not reduce tonnes mined, it reduces saleable tonnes at
    # spec. Costed against the mine's own historical median grade.
    hist_grade = float(prod[prod.date < period.start_time].grade_Mn_pct.median())
    month_grade = float(month_rows.grade_Mn_pct.mean())
    if hist_grade - month_grade > 0.3:
        shortfall_frac = (hist_grade - month_grade) / hist_grade
        lost = month_rows.ore_tonnes.sum() * shortfall_frac
        rc = get_reason("GRADE_REJECT")
        worst_bench = month_rows.groupby("bench_or_stope_id").grade_Mn_pct.mean().idxmin()
        wf.drivers.append(Driver(
            "GRADE_REJECT", "Grade dilution", -round(lost, 0), True, rc.addressed_by.value,
            f"{month_grade:.1f}% vs {hist_grade:.1f}% historical; weakest: {worst_bench}",
        ))

    # ---- blast delays ----------------------------------------------------
    blasts = _load("blast_register")
    blasts = blasts[(blasts.mine == mine) & (blasts.date.dt.to_period("M") == period)]
    delayed = blasts[blasts.delay_flag]
    non_rain = delayed[delayed.delay_reason_code != "RAIN"]
    if len(non_rain):
        typical = float(blasts[~blasts.delay_flag].tonnage_broken.median() or 0)
        lost = len(non_rain) * typical * 0.25   # a delayed blast defers, not destroys
        if lost > 1:
            code = non_rain.delay_reason_code.mode()[0]
            rc = get_reason(code)
            wf.drivers.append(Driver(
                code, rc.label, -round(lost, 0), rc.addressed_by is not ActionClass.NONE,
                rc.addressed_by.value, f"{len(non_rain)} blasts delayed",
            ))

    # ---- residual --------------------------------------------------------
    residual = wf.gap - wf.explained
    if abs(residual) > 1:
        wf.drivers.append(Driver(
            "INTERACTION", "Interaction / forecast error", round(residual, 0), False, "none",
            "Causes overlap, and the drivers are measured from actuals while the "
            "forecast is projected from day 8 - this bar carries both. Shown "
            "rather than scaled away.",
        ))

    wf.drivers.sort(key=lambda d: d.tonnes)
    return wf


def _rain_share(row) -> float:
    """How much of a wet day's shortfall to blame on rain rather than the fleet.

    On a day that is both wet and short-handed, splitting the loss by the relative
    severity of each avoids double-counting it into both bars.
    """
    rain_sev = min(1.0, (row.rainfall_mm - 10) / 45.0)
    fleet_sev = max(0.0, 1.0 - row.fleet_availability)
    total = rain_sev + fleet_sev
    return 1.0 if total <= 0 else rain_sev / total


def render(wf: Waterfall) -> str:
    lines = [
        f"{wf.mine} - {wf.month}   [SYNTHETIC registers, REAL rainfall]",
        "",
        f"  {'Target':<34}{wf.target:>10,.0f} t",
    ]
    running = wf.target
    for d in wf.drivers:
        running += d.tonnes
        flag = "" if d.recoverable else "  (not recoverable)"
        lines.append(f"  {d.label:<34}{d.tonnes:>+10,.0f} t{flag}")
        if d.detail:
            lines.append(f"      {d.detail}")
    lines += [
        "",
        f"  {'Forecast':<34}{wf.forecast:>10,.0f} t",
        f"  {'Gap':<34}{wf.gap:>+10,.0f} t   ({wf.forecast / wf.target * 100:.1f}% of target)",
        f"  {'Of which recoverable':<34}{wf.recoverable_tonnes:>10,.0f} t",
    ]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mine", default="Tirodi")
    parser.add_argument("--month", default="2026-07")
    parser.add_argument("--target", type=float, required=True)
    parser.add_argument("--as-of", default=None)
    args = parser.parse_args()

    wf = attribute(args.mine, args.month, args.target, args.as_of)
    print(render(wf))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
