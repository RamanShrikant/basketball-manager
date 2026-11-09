"""CPU-team contract-extension offer construction and decision logic."""
from __future__ import annotations

# BM_PATCH32_ECONOMIC_IMPORT
try:
    from deflated_trade_scale import economic_player_copy, player_economic_overall, player_economic_potential, economy_ovr, TRADE_TIER
except Exception:  # pragma: no cover - patch fallback
    def economic_player_copy(player):
        return player
    def player_economic_overall(player):
        try:
            return float(player.get("overall", player.get("ovr", 0)))
        except Exception:
            return 0.0
    def player_economic_potential(player):
        try:
            return max(player_economic_overall(player), float(player.get("potential", player.get("pot", player_economic_overall(player)))))
        except Exception:
            return player_economic_overall(player)
    def economy_ovr(value):
        try:
            return float(value)
        except Exception:
            return 0.0
    TRADE_TIER = {"MEGA": 86, "STAR": 84, "STARTER": 76, "CORE": 80, "SUPERSTAR": 88, "FRANCHISE": 90}


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
    player = economic_player_copy(player)  # BM_PATCH32_EXTENSION_CORE_ECONOMY
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
    player = economic_player_copy(player)  # BM_PATCH32_EXTENSION_ASK_ECONOMY
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
    player = economic_player_copy(player)  # BM_PATCH32_EXTENSION_OFFER_ECONOMY
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

# ============================================================================
# V10 CPU EXTENSION DECISION
# ============================================================================
# First-apron payroll is financial pressure, not a universal ban on retaining
# a team's own players. Core value remains selective, and projected extension
# salary is included in the budget check.

def _v10_cpu_extension_evaluation(
    league_data: Dict[str, Any],
    team: Dict[str, Any],
    player: Dict[str, Any],
    eligibility: Dict[str, Any],
    phase: str = "opening",
) -> Dict[str, Any]:
    player = economic_player_copy(player)  # BM_PATCH32_EXTENSION_V10_ECONOMY
    if not eligibility.get("eligible"):
        return {"approved": False, "reason": "player_not_willing_or_ineligible", "result": None}

    extension_type = str(eligibility.get("extensionType") or "veteran")
    core_score = _core_score(player, team, extension_type)
    overall = _num(player.get("overall"), 70)
    potential = _num(player.get("potential"), overall)
    age = _num(player.get("age"), 27)

    # BM_PATCH45_ROOKIE_SIGNINGS_CPU_EXTENSIONS
    # These are economic/old-feel OVR values, but previous gates were still too
    # selective for a deflated roster ecosystem. CPU should retain useful young
    # cores and mid-rotation pieces more often while keeping late-career role
    # player extensions selective.
    if extension_type == "rookie_scale":
        if potential < 80 and overall < 70:
            return {"approved": False, "reason": "team_value_rookie_low_upside", "result": None, "coreScore": round(core_score, 2)}
        if overall < 68 and potential < 84:
            return {"approved": False, "reason": "team_value_rookie_not_core", "result": None, "coreScore": round(core_score, 2)}
        minimum_core = 72.5
    else:
        if overall < 72 and core_score < 78.0:
            return {"approved": False, "reason": "team_value_veteran_not_core", "result": None, "coreScore": round(core_score, 2)}
        if age >= 34 and overall < 75 and core_score < 83.0:
            return {"approved": False, "reason": "team_value_older_role_player", "result": None, "coreScore": round(core_score, 2)}
        if age >= 36 and overall < 80:
            return {"approved": False, "reason": "team_value_late_career", "result": None, "coreScore": round(core_score, 2)}
        minimum_core = 75.0

    if phase in {"deadline", "rookie_deadline", "veteran_deadline"}:
        minimum_core -= 1.0
    if core_score < minimum_core:
        return {"approved": False, "reason": "team_value_core_score", "result": None, "coreScore": round(core_score, 2)}

    packages = eligibility.get("askPackages") if isinstance(eligibility.get("askPackages"), list) else []
    if not packages:
        return {"approved": False, "reason": "no_player_ask_package", "result": None, "coreScore": round(core_score, 2)}

    extension_start = int(_num(eligibility.get("extensionStartYear"), 0))
    salary_cap = _num(eligibility.get("salaryCapAtExtensionStart"), 0)
    first_apron = _num(eligibility.get("firstApronAtExtensionStart"), salary_cap * 1.27)
    if salary_cap <= 0:
        salary_cap = max(1.0, first_apron / 1.27) if first_apron > 0 else 154_647_000.0
    if first_apron <= 0:
        first_apron = salary_cap * 1.27
    payroll = _team_payroll_for_year(team, extension_start) if extension_start else 0

    # Keep payroll discipline, but define "core asset" on the new scale. This
    # lets CPU teams retain useful young/core pieces instead of only stars.
    hard_budget = first_apron + max(10_000_000.0, salary_cap * 0.075)
    core_asset = bool(
        overall >= 80
        or (extension_type == "rookie_scale" and potential >= 84 and overall >= 70)
        or (age <= 27 and overall >= 74 and potential >= 78)
    )

    candidates = []
    saw_budget_reject = False
    for package in packages:
        first = _num(package.get("firstYearSalary"), 0)
        years = int(_num(package.get("years"), 1))
        if first <= 0 or years <= 0:
            continue

        projected = payroll + first
        if projected > hard_budget and not core_asset:
            saw_budget_reject = True
            continue
        if projected > first_apron and overall < 74 and not (
            extension_type == "rookie_scale" and potential >= 82
        ):
            saw_budget_reject = True
            continue

        package_score = 0.0
        if extension_type == "rookie_scale":
            package_score += years * 4.5
            package_score += max(0.0, potential - 76.0) * 0.42
        else:
            preferred_years = 4 if age <= 28 else 3 if age <= 32 else 2
            package_score -= abs(years - preferred_years) * 3.25
            if age >= 33 and years >= 4:
                package_score -= 7.0

        package_score += min(12.0, max(-4.0, core_score - 72.0))
        package_score -= _num(package.get("valueRatio"), 1.0) * 2.0

        # Soft payroll pressure affects which ask the CPU chooses rather than
        # automatically killing the negotiation.
        over_apron = max(0.0, projected - first_apron)
        package_score -= min(7.0, (over_apron / max(1.0, salary_cap)) * 50.0)
        candidates.append((package_score, package, projected))

    if not candidates:
        reason = "payroll_pressure" if saw_budget_reject else "no_viable_player_ask"
        return {
            "approved": False,
            "reason": reason,
            "result": None,
            "coreScore": round(core_score, 2),
            "futurePayrollBeforeExtension": payroll,
        }

    candidates.sort(key=lambda row: row[0], reverse=True)
    _, ask_package, projected = candidates[0]
    offer = {
        "years": int(_num(ask_package.get("years"), 1)),
        "firstYearSalary": int(_num(ask_package.get("firstYearSalary"), 0)),
        "annualRaisePct": _num(ask_package.get("annualRaisePct"), 0),
        "salaryByYear": [int(_num(x, 0)) for x in (ask_package.get("salaryByYear") or [])],
        "optionType": str(ask_package.get("optionType") or "none"),
        "extensionType": extension_type,
        "askPackageId": ask_package.get("askPackageId") or ask_package.get("packageId"),
        "packageId": ask_package.get("packageId") or ask_package.get("askPackageId"),
        "source": "cpu_contract_extension_player_ask_v10_patch45",
        "phase": phase,
        "playerAsk": True,
        "acceptedByPlayerAsk": True,
    }
    market = eligibility.get("marketValue") if isinstance(eligibility.get("marketValue"), dict) else {}
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
    result = {
        "offer": offer,
        "decision": decision,
        "coreScore": round(core_score, 2),
        "futurePayrollBeforeExtension": payroll,
        "futurePayrollWithExtension": int(round(projected)),
        "futureRoomBeforeExtension": int(round(first_apron - payroll)),
        "firstApronAtExtensionStart": int(round(first_apron)),
    }
    return {"approved": True, "reason": "approved", "result": result, **{k: v for k, v in result.items() if k in {"coreScore", "futurePayrollBeforeExtension", "futurePayrollWithExtension"}}}

def build_cpu_extension_offer(
    league_data: Dict[str, Any],
    team: Dict[str, Any],
    player: Dict[str, Any],
    eligibility: Dict[str, Any],
    phase: str = "opening",
) -> Optional[Dict[str, Any]]:
    return _v10_cpu_extension_evaluation(league_data, team, player, eligibility, phase).get("result")


def cpu_extension_offer_diagnostic(
    league_data: Dict[str, Any],
    team: Dict[str, Any],
    player: Dict[str, Any],
    eligibility: Dict[str, Any],
    phase: str = "opening",
) -> Dict[str, Any]:
    row = _v10_cpu_extension_evaluation(league_data, team, player, eligibility, phase)
    return {
        "approved": bool(row.get("approved")),
        "reason": row.get("reason") or "unknown",
        "coreScore": row.get("coreScore"),
        "futurePayrollBeforeExtension": row.get("futurePayrollBeforeExtension"),
        "futurePayrollWithExtension": row.get("futurePayrollWithExtension"),
    }
