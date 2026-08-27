"""The fixed reason-code master.

WHY A PICKLIST AND NOT FREE TEXT
    This is the single highest-leverage design decision in the operational half of
    the system. "Heavy rain from noon, pit flooded" and "rains" and "water logging"
    are the same cause written three ways; as free text they are three unrelated
    strings and driver attribution is impossible. As a code they are one feature
    with a tonnage attached.

    Everything Pillar 2 claims - the waterfall, the corrective actions, the
    "how much did rain cost us this year" answer - exists only because downtime is
    recorded against a closed vocabulary.

Each code carries what the recommender needs to reason about it: whether it is
weather-driven (so a forecast can anticipate it), whether it is preventable, and
which action class addresses it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class Category(str, Enum):
    WEATHER = "weather"
    EQUIPMENT = "equipment"
    SUPPLY = "supply"
    REGULATORY = "regulatory"
    LABOUR = "labour"
    INFRASTRUCTURE = "infrastructure"
    QUALITY = "quality"
    LOGISTICS = "logistics"


class ActionClass(str, Enum):
    RESEQUENCE = "resequence"
    MAINTENANCE = "maintenance"
    BLAST_RESCHEDULE = "blast_reschedule"
    STOCKPILE = "stockpile"
    LOGISTICS = "logistics"
    BLENDING = "blending"
    NONE = "none"


@dataclass(frozen=True)
class ReasonCode:
    code: str
    label: str
    category: Category
    # Can a weather forecast see this coming? Drives the 14-day risk radar.
    weather_driven: bool
    # Can the mine act to prevent it, or only absorb it? A statutory hold is not
    # preventable; a predicted bearing failure is.
    preventable: bool
    # Which corrective-action class addresses this cause.
    addressed_by: ActionClass
    note: str = ""


REASON_CODES: tuple[ReasonCode, ...] = (
    ReasonCode(
        "RAIN", "Rain / wet pit", Category.WEATHER,
        weather_driven=True, preventable=False, addressed_by=ActionClass.BLAST_RESCHEDULE,
        note="Cannot be prevented, but blasts and haulage can be moved ahead of it.",
    ),
    ReasonCode(
        "BREAKDOWN_MECH", "Mechanical breakdown", Category.EQUIPMENT,
        weather_driven=False, preventable=True, addressed_by=ActionClass.MAINTENANCE,
    ),
    ReasonCode(
        "BREAKDOWN_ELEC", "Electrical breakdown", Category.EQUIPMENT,
        weather_driven=False, preventable=True, addressed_by=ActionClass.MAINTENANCE,
    ),
    ReasonCode(
        "EXPLOSIVE_SHORTAGE", "Explosive shortage", Category.SUPPLY,
        weather_driven=False, preventable=True, addressed_by=ActionClass.BLAST_RESCHEDULE,
    ),
    ReasonCode(
        "STATUTORY_HOLD", "Statutory / DGMS hold", Category.REGULATORY,
        weather_driven=False, preventable=False, addressed_by=ActionClass.NONE,
        note="Outside the mine's control; excluded from recoverable gap.",
    ),
    ReasonCode(
        "MANPOWER", "Manpower shortage", Category.LABOUR,
        weather_driven=False, preventable=True, addressed_by=ActionClass.RESEQUENCE,
    ),
    ReasonCode(
        "POWER_FAIL", "Power failure", Category.INFRASTRUCTURE,
        weather_driven=False, preventable=False, addressed_by=ActionClass.NONE,
    ),
    ReasonCode(
        "HAUL_ROAD", "Haul road condition", Category.INFRASTRUCTURE,
        weather_driven=True, preventable=True, addressed_by=ActionClass.LOGISTICS,
        note="Degrades after rain; the weather link is why it is weather_driven.",
    ),
    ReasonCode(
        "GRADE_REJECT", "Grade below despatch spec", Category.QUALITY,
        weather_driven=False, preventable=True, addressed_by=ActionClass.BLENDING,
    ),
    ReasonCode(
        "NO_WAGON", "No wagon / rake unavailable", Category.LOGISTICS,
        weather_driven=False, preventable=True, addressed_by=ActionClass.LOGISTICS,
    ),
)

BY_CODE: dict[str, ReasonCode] = {r.code: r for r in REASON_CODES}
CODES: tuple[str, ...] = tuple(r.code for r in REASON_CODES)


def get(code: str) -> ReasonCode:
    """Look up a code, raising with the valid set rather than a bare KeyError."""
    try:
        return BY_CODE[code.strip().upper()]
    except KeyError:
        raise KeyError(
            f"Unknown reason code {code!r}. Valid codes: {', '.join(CODES)}"
        ) from None


def is_valid(code: str) -> bool:
    return isinstance(code, str) and code.strip().upper() in BY_CODE


def recoverable_codes() -> tuple[str, ...]:
    """Codes a corrective action can actually address.

    Used to split the shortfall gap into recoverable and unavoidable. Promising to
    recover tonnage lost to a statutory hold would be dishonest, so those are
    reported separately rather than folded into the recommender's total.
    """
    return tuple(r.code for r in REASON_CODES if r.addressed_by is not ActionClass.NONE)


def weather_codes() -> tuple[str, ...]:
    return tuple(r.code for r in REASON_CODES if r.weather_driven)


def as_table() -> list[dict]:
    """Flat rows, for the UI picklist and the docs."""
    return [
        {
            "code": r.code,
            "label": r.label,
            "category": r.category.value,
            "weather_driven": r.weather_driven,
            "preventable": r.preventable,
            "addressed_by": r.addressed_by.value,
            "note": r.note,
        }
        for r in REASON_CODES
    ]


if __name__ == "__main__":
    print(f"{'code':<20}{'category':<16}{'weather':<9}{'prevent':<9}addressed by")
    print("-" * 78)
    for r in REASON_CODES:
        print(
            f"{r.code:<20}{r.category.value:<16}"
            f"{'yes' if r.weather_driven else '-':<9}"
            f"{'yes' if r.preventable else '-':<9}{r.addressed_by.value}"
        )
    print(f"\n{len(REASON_CODES)} codes; "
          f"{len(recoverable_codes())} recoverable, {len(weather_codes())} weather-driven")
