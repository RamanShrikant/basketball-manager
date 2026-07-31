"""CPU-team contract-extension offer construction and decision logic."""
from __future__ import annotations

import math
from typing import Any, Dict, Optional

from contract_extension_acceptance import evaluate_extension_offer


def _num(value: Any, fallback: float = 0.0) -> float:
    try:
        n = float(value)
        return n if math.isfinite(n) else float(fallback)
    except Exception:
        return float(fallback)


def _round_money(value: float) -> int:
    return int(round(float(value or 0) / 1000.0) * 1000)


def _team_payroll_for_year(team: Dict[str, Any], season_year: int) -> int:
    total = 0
    for player in team.get("players", []) or []:
        contract = player.get("contract") if isinstance(player.get("contract"), dict) else {}
        salaries = contract.get("salaryByYear") if isinstance(contract.get("salaryByYear"), list) else []
        start = int(_num(contract.get("startYear"), season_year))
        idx = int(season_year) - start
        if 0 <= idx < len(salaries):
            total += int(_num(salaries[idx], 0))
    return total


def _core_score(player: Dict[str, Any], team: Dict[str, Any], extension_type: str) -> float:
    overall = _num(player.get("overall"), 70)
    potential = _num(player.get("potential"), overall)
    age = _num(player.get("age"), 27)
    years_with_team = _num((player.get("meta") or {}).get("yearsWithCurrentTeam"), 0)

    score = overall * 0.72 + potential * 0.28
    score += min(4.5, years_with_team * 0.45)
    if extension_type == "rookie_scale":
        score += max(0, potential - overall) * 0.45
    if age >= 31:
        score -= (age - 30) * 1.6
    if overall >= 88:
        score += 5
    return score


def build_cpu_extension_offer(
    league_data: Dict[str, Any],
    team: Dict[str, Any],
    player: Dict[str, Any],
    eligibility: Dict[str, Any],
    phase: str = "opening",
) -> Optional[Dict[str, Any]]:
    if not eligibility.get("eligible"):
        return None

    extension_type = str(eligibility.get("extensionType") or "veteran")
    core_score = _core_score(player, team, extension_type)
    overall = _num(player.get("overall"), 70)
    potential = _num(player.get("potential"), overall)
    age = _num(player.get("age"), 27)

    minimum_core = 75.0 if extension_type == "rookie_scale" else 77.0
    if phase == "deadline":
        minimum_core -= 1.5
    if core_score < minimum_core:
        return None

    max_years = max(1, int(_num(eligibility.get("maxYears"), 1)))
    market = eligibility.get("marketValue") if isinstance(eligibility.get("marketValue"), dict) else {}
    market_first = _num(market.get("expectedYear1Salary") or eligibility.get("recommendedFirstYearSalary"), eligibility.get("minFirstYearSalary"))
    max_first = _num(eligibility.get("maxFirstYearSalary"), market_first)
    min_first = _num(eligibility.get("minFirstYearSalary"), max(1_200_000, market_first * 0.72))

    if age <= 25:
        years = min(max_years, 5 if overall >= 80 or potential >= 84 else 4)
    elif age <= 29:
        years = min(max_years, 4 if overall >= 80 else 3)
    elif age <= 32:
        years = min(max_years, 3 if overall >= 79 else 2)
    else:
        years = min(max_years, 2)

    value_factor = 0.94
    if core_score >= 91:
        value_factor = 1.02
    elif core_score >= 86:
        value_factor = 0.99
    elif core_score >= 81:
        value_factor = 0.965
    if phase == "deadline":
        value_factor += 0.02

    first = max(min_first, min(max_first, market_first * value_factor))

    extension_start = int(_num(eligibility.get("extensionStartYear"), 0))
    salary_cap = _num(eligibility.get("salaryCapAtExtensionStart"), 0)
    first_apron = _num(eligibility.get("firstApronAtExtensionStart"), salary_cap * 1.25)
    payroll = _team_payroll_for_year(team, extension_start) if extension_start else 0
    future_room = first_apron - payroll
    if future_room < first and overall < 85:
        first = max(min_first, min(first, future_room * 0.88))
    if first < min_first:
        return None

    raise_pct = 8.0 if overall >= 82 or extension_type == "rookie_scale" else 5.0
    salaries = [_round_money(first * ((1 + raise_pct / 100.0) ** i)) for i in range(years)]
    option_type = "player" if overall >= 88 and years >= 4 else "none"

    offer = {
        "years": years,
        "firstYearSalary": salaries[0],
        "annualRaisePct": raise_pct,
        "salaryByYear": salaries,
        "optionType": option_type,
        "extensionType": extension_type,
        "source": "cpu_contract_extension",
        "phase": phase,
    }

    decision = evaluate_extension_offer(league_data, team, player, offer, eligibility)
    if not decision.get("accepted") and phase == "deadline":
        boosted_first = min(max_first, max(first, market_first * 1.015))
        boosted = [_round_money(boosted_first * ((1 + raise_pct / 100.0) ** i)) for i in range(years)]
        offer["firstYearSalary"] = boosted[0]
        offer["salaryByYear"] = boosted
        decision = evaluate_extension_offer(league_data, team, player, offer, eligibility)

    return {
        "offer": offer,
        "decision": decision,
        "coreScore": round(core_score, 2),
        "futurePayrollBeforeExtension": payroll,
        "futureRoomBeforeExtension": int(round(future_room)),
    }
