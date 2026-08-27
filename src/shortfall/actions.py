"""Engine 4c - corrective actions as objects, not advice text.

The problem statement asks for corrective actions by name, so they are first-class
records: each carries expected recovery, cost, lead time, owner and approval level.
"Consider optimising your fleet deployment" is not an action. "Move 2 dumpers from
Bench-3 to Bench-5, recovers ~1,800 t, zero cost, 1 day, Mine Planner approves" is.

TWO RULES THAT KEEP THIS HONEST
    1. An action may only claim tonnage against a driver that is actually
       recoverable. Rain that has already fallen is spent; a statutory hold is not
       the mine's to lift. Those drivers generate no action, and the UI says why.

    2. Recovery is capped by the remaining days. On day 8 there is a month left to
       recover in; on day 26 there is not. An action recommended too late to work
       is worse than none, because it burns the planner's trust.

    python -m src.shortfall.actions --mine "Balaghat / Bharveli" --month 2026-02 --target 30000
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass, field

import pandas as pd

from src.config import ROOT
from src.ingest.reason_codes import ActionClass
from src.shortfall.attribution import Waterfall, attribute
from src.shortfall.forecast import load_production

OPS = ROOT / "data" / "processed" / "operations"

# Who signs off. Anything with real spend leaves the planner's authority.
APPROVAL_BY_COST = ((0, "Mine Planner"), (100_000, "Mine Head"), (1_000_000, "HQ Planning"))


def approval_for(cost_inr: float) -> str:
    level = APPROVAL_BY_COST[0][1]
    for threshold, who in APPROVAL_BY_COST:
        if cost_inr >= threshold:
            level = who
    return level


@dataclass
class Action:
    action_class: str
    title: str
    rationale: str
    recovery_t: float
    cost_inr: float
    lead_time_days: int
    owner: str
    approval: str
    addresses: str                 # the driver code it answers
    assumptions: str = ""
    confidence: str = "medium"     # high | medium | low

    def as_row(self) -> dict:
        return {
            "class": self.action_class, "title": self.title,
            "recovery_t": round(self.recovery_t), "cost_inr": round(self.cost_inr),
            "lead_days": self.lead_time_days, "owner": self.owner,
            "approval": self.approval, "addresses": self.addresses,
            "confidence": self.confidence,
        }


def _grade_by_face(mine: str, month: str) -> pd.DataFrame:
    """Recent grade per bench/stope - the basis for a re-sequencing call."""
    prod = load_production()
    prod = prod[prod.mine == mine]
    period = pd.Period(month, freq="M")
    window = prod[prod.date >= period.start_time - pd.Timedelta(days=90)]
    return (window.groupby("bench_or_stope_id")
            .agg(grade=("grade_Mn_pct", "mean"), tonnes=("ore_tonnes", "sum"))
            .sort_values("grade", ascending=False))


def recommend(wf: Waterfall, remaining_days: int = 20) -> list[Action]:
    actions: list[Action] = []

    # How much of the month is left to recover in. An action landing with 3 days
    # to go cannot deliver a full month's worth of its effect.
    horizon = max(0.0, min(1.0, remaining_days / 26.0))

    for d in wf.drivers:
        if not d.recoverable or d.tonnes >= 0:
            continue
        lost = abs(d.tonnes)

        if d.addressed_by == ActionClass.MAINTENANCE.value:
            machine = d.detail.split("worst machine ")[-1].split(" ")[0] if "worst machine" in d.detail else "the worst unit"
            recovery = lost * 0.55 * horizon
            cost = 240_000
            actions.append(Action(
                "maintenance", f"Advance preventive maintenance on {machine}",
                f"Fleet availability is below normal and {machine} dominates the downtime. "
                "Servicing it now pre-empts a repeat failure rather than reacting to one.",
                recovery, cost, 2, "Mine Mechanical Engineer", approval_for(cost),
                d.code,
                "Assumes ~55% of availability loss is recoverable by pre-empting the "
                "worst unit; the rest is spread across the fleet.",
                "medium",
            ))

        elif d.addressed_by == ActionClass.BLENDING.value:
            faces = _grade_by_face(wf.mine, wf.month)
            if len(faces) >= 2:
                best, worst = faces.index[0], faces.index[-1]
                recovery = lost * 0.7 * horizon
                actions.append(Action(
                    "blending", f"Blend {worst} output against {best}",
                    f"{best} runs {faces.iloc[0].grade:.1f}% Mn against "
                    f"{faces.iloc[-1].grade:.1f}% at {worst}. Blending meets despatch "
                    "spec without mining an extra tonne.",
                    recovery, 0, 1, "Mine Planner", approval_for(0), d.code,
                    "Assumes stockpile capacity exists to blend against and that the "
                    "despatch spec is a blend-average, not a per-rake minimum.",
                    "high",
                ))
                # Re-sequencing is the action that only exists because Pillar 1
                # knows which ground is richer. This is where the two halves meet.
                if faces.iloc[0].grade - faces.iloc[-1].grade > 1.5:
                    recovery_rs = lost * 0.5 * horizon
                    actions.append(Action(
                        "resequence", f"Move fleet from {worst} to {best}",
                        f"Re-sequencing into higher-grade ground ({faces.iloc[0].grade:.1f}% "
                        f"vs {faces.iloc[-1].grade:.1f}%) lifts saleable tonnes at the same "
                        "mining rate.",
                        recovery_rs, 0, 1, "Mine Planner", approval_for(0), d.code,
                        "Assumes the richer face has developed capacity to absorb the "
                        "extra fleet; check the block model before committing.",
                        "medium",
                    ))

        elif d.addressed_by == ActionClass.BLAST_RESCHEDULE.value:
            recovery = lost * 0.4 * horizon
            actions.append(Action(
                "blast_reschedule", "Pull scheduled blasts ahead of the next wet window",
                "Rain that has already fallen cannot be recovered, but the next one can "
                "be worked around. Blasting early banks broken stock to haul through "
                "the wet days.",
                recovery, 35_000, 3, "Mine Planner", approval_for(35_000), d.code,
                "Assumes explosive stock and DGMS clearance are in hand, and that "
                "broken stock can be stored at the face.",
                "medium",
            ))

        elif d.addressed_by == ActionClass.LOGISTICS.value:
            recovery = lost * 0.6 * horizon
            cost = 150_000
            actions.append(Action(
                "logistics", "Haul-road repair and rake follow-up",
                "Haulage, not the face, is the binding constraint.",
                recovery, cost, 4, "Mine Head", approval_for(cost), d.code,
                "Assumes a contractor is available inside the lead time.",
                "low",
            ))

    # Stockpile buffering is pre-emptive rather than driver-triggered: it only makes
    # sense ahead of the monsoon, so it is offered on the calendar, not the gap.
    month_num = pd.Period(wf.month, freq="M").month
    if month_num in (4, 5) and wf.gap < 0:
        actions.append(Action(
            "stockpile", "Build pre-monsoon ore stock",
            "June-September is when this belt loses days to rain. Stock built now is "
            "despatchable through the wet months.",
            abs(wf.gap) * 0.3, 80_000, 10, "Mine Head", approval_for(80_000),
            "RAIN",
            "Assumes stockyard capacity and that stored ore holds grade.",
            "medium",
        ))

    actions.sort(key=lambda a: (-a.recovery_t, a.cost_inr))
    return actions


def render(wf: Waterfall, actions: list[Action], remaining_days: int) -> str:
    lines = [
        f"{wf.mine} - {wf.month}   [SYNTHETIC registers, REAL rainfall]",
        f"  gap {wf.gap:+,.0f} t   recoverable {wf.recoverable_tonnes:,.0f} t   "
        f"{remaining_days} days remain",
        "",
    ]
    if not actions:
        lines.append("  No corrective action available.")
        lines.append("  Every driver in this month is either already spent (rain that has")
        lines.append("  fallen) or outside the mine's control. Saying so beats inventing one.")
        return "\n".join(lines)

    total = sum(a.recovery_t for a in actions)
    for i, a in enumerate(actions, 1):
        lines += [
            f"  {i}. {a.title}",
            f"     recovers ~{a.recovery_t:,.0f} t   "
            f"cost {'nil' if a.cost_inr == 0 else f'INR {a.cost_inr:,.0f}'}   "
            f"lead {a.lead_time_days} d   {a.approval} approves   [{a.confidence}]",
            f"     {a.rationale}",
            f"     assumes: {a.assumptions}",
            "",
        ]
    lines.append(f"  Total claimed recovery {total:,.0f} t of {wf.recoverable_tonnes:,.0f} t recoverable")
    if total > wf.recoverable_tonnes:
        lines.append("  NOTE: actions overlap - they address the same driver and are not additive.")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mine", default="Balaghat / Bharveli")
    parser.add_argument("--month", default="2026-02")
    parser.add_argument("--target", type=float, required=True)
    parser.add_argument("--as-of", default=None)
    parser.add_argument("--remaining-days", type=int, default=20)
    args = parser.parse_args()

    wf = attribute(args.mine, args.month, args.target, args.as_of)
    actions = recommend(wf, args.remaining_days)
    print(render(wf, actions, args.remaining_days))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
