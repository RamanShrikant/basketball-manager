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



def _choose_cpu_ask_package(
    player: Dict[str, Any],
    eligibility: Dict[str, Any],
    phase: str,
    core_score: float,
    future_room: float,
) -> Optional[Dict[str, Any]]:
    packages = eligibility.get("askPackages") if isinstance(eligibility.get("askPackages"), list) else []
    if not packages:
        return None
    overall = _num(player.get("overall"), 70)
    potential = _num(player.get("potential"), overall)
    age = _num(player.get("age"), 27)
    extension_type = str(eligibility.get("extensionType") or "veteran")

    candidates = []
    for package in packages:
        first = _num(package.get("firstYearSalary"), 0)
        years = int(_num(package.get("years"), 1))
        if first <= 0:
            continue
        # Stronger future-payroll restraint than v1: non-stars should not pile onto
        # an already overloaded future apron sheet. Stars/core rookies can still be kept.
        if future_room <= 0 and overall < 88 and not (extension_type == "rookie_scale" and potential >= 90 and overall >= 78):
            continue
        if future_room > 0 and first > future_room * 1.02 and overall < 86 and extension_type != "rookie_scale":
            continue
        if extension_type == "rookie_scale" and overall < 76 and potential < 86:
            continue
        score = 0.0
        if extension_type == "rookie_scale":
            score += years * 5.0
            score += max(0, potential - 80) * 0.55
        else:
            preferred_years = 4 if age <= 29 else 3 if age <= 32 else 2
            score -= abs(years - preferred_years) * 4.0
            if age >= 32 and years >= 4:
                score -= 9.0
        score += min(12.0, core_score - 75.0)
        score -= _num(package.get("valueRatio"), 1.0) * 2.0
        candidates.append((score, package))
    if not candidates:
        return None
    candidates.sort(key=lambda row: row[0], reverse=True)
    return candidates[0][1]

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

    if extension_type == "rookie_scale":
        if potential < 84 and overall < 78:
            return None
        if overall < 76 and potential < 86:
            return None
        minimum_core = 78.0
    else:
        if overall < 79 and core_score < 84:
            return None
        if age >= 32 and overall < 82:
            return None
        if age >= 35 and overall < 90:
            return None
        minimum_core = 84.0
    if phase in {"deadline", "rookie_deadline", "veteran_deadline"}:
        minimum_core -= 0.75
    if core_score < minimum_core:
        return None

    max_years = max(1, int(_num(eligibility.get("maxYears"), 1)))
    market = eligibility.get("marketValue") if isinstance(eligibility.get("marketValue"), dict) else {}
    market_first = _num(market.get("expectedYear1Salary") or eligibility.get("recommendedFirstYearSalary"), eligibility.get("minFirstYearSalary"))
    max_first = _num(eligibility.get("maxFirstYearSalary"), market_first)
    min_first = _num(eligibility.get("minFirstYearSalary"), max(1_200_000, market_first * 0.72))

    extension_start = int(_num(eligibility.get("extensionStartYear"), 0))
    salary_cap = _num(eligibility.get("salaryCapAtExtensionStart"), 0)
    first_apron = _num(eligibility.get("firstApronAtExtensionStart"), salary_cap * 1.25)
    payroll = _team_payroll_for_year(team, extension_start) if extension_start else 0
    future_room = first_apron - payroll

    ask_package = _choose_cpu_ask_package(player, eligibility, phase, core_score, future_room)
    if ask_package is None:
        return None

    offer = {
        "years": int(_num(ask_package.get("years"), 1)),
        "firstYearSalary": int(_num(ask_package.get("firstYearSalary"), 0)),
        "annualRaisePct": _num(ask_package.get("annualRaisePct"), 0),
        "salaryByYear": [int(_num(x, 0)) for x in (ask_package.get("salaryByYear") or [])],
        "optionType": str(ask_package.get("optionType") or "none"),
        "extensionType": extension_type,
        "askPackageId": ask_package.get("askPackageId") or ask_package.get("packageId"),
        "packageId": ask_package.get("packageId") or ask_package.get("askPackageId"),
        "source": "cpu_contract_extension_player_ask",
        "phase": phase,
        "playerAsk": True,
        "acceptedByPlayerAsk": True,
    }
    decision = {
        "accepted": True,
        "score": 100,
        "threshold": 0,
        "interestLabel": "Accepted asking price",
        "reason": "CPU matched one of the player's requested extension packages.",
        "offerAAV": int(_num(ask_package.get("aav"), 0)),
        "marketAAV": int(_num(ask_package.get("marketAAV"), 0)),
        "valueRatio": _num(ask_package.get("valueRatio"), 1),
        "marketValue": market,
    }
    return {
        "offer": offer,
        "decision": decision,
        "coreScore": round(core_score, 2),
        "futurePayrollBeforeExtension": payroll,
        "futureRoomBeforeExtension": int(round(future_room)),
    }
