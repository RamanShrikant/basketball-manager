"""
league_financials.py
Central financial rules and 6.5% annual league inflation helpers.

Existing signed contracts should stay fixed. These helpers update only league
rules used for future contracts, cap holds, exceptions, rookie deals, and UI
cap values.
"""
from __future__ import annotations

import copy
import math
import datetime as _dt
from typing import Any, Dict, Optional

LEAGUE_FINANCIALS_VERSION = "2026-06-14_league_inflation_v1"
DEFAULT_ANNUAL_INFLATION_RATE = 0.065
DEFAULT_BASE_SEASON_YEAR = 2026

DEFAULT_BASE_FINANCIAL_RULES: Dict[str, float] = {
    "salaryCap": 154_647_000,
    "luxuryTaxLine": 187_895_000,
    "firstApron": 195_945_000,
    "secondApron": 207_824_000,
    "hardCap": 207_824_000,

    "minimumSalary": 1_200_000,
    "minimumException": 1_500_000,
    "veteranMinimum": 1_500_000,
    "twoWaySalary": 580_000,

    "maxSalary": 54_000_000,
    "roomException": 8_781_000,
    "nonTaxpayerMLE": 14_104_000,
    "midLevelException": 14_104_000,
    "taxpayerMLE": 5_685_000,

    "rookiePick1Salary": 11_800_000,
    "rookieFirstRoundDecline": 315_000,
    "rookieFirstRoundFloor": 2_400_000,
    "rookieSecondRoundBase": 2_250_000,
    "rookieSecondRoundDecline": 28_000,
    "rookieSecondRoundFloor": 1_250_000,
}


def _num(value: Any, fallback: float = 0.0) -> float:
    try:
        if value is None:
            return float(fallback)
        return float(value)
    except Exception:
        return float(fallback)


def _season_year(value: Any, fallback: int = DEFAULT_BASE_SEASON_YEAR) -> int:
    try:
        y = int(float(value))
        if 2020 <= y <= 2100:
            return y
    except Exception:
        pass
    return int(fallback)


def round_money(value: float, nearest: int = 1_000) -> int:
    base = max(1, int(nearest or 1))
    return int(base * round(float(value or 0) / base))


def get_league_season_year(league_data: Optional[Dict[str, Any]]) -> int:
    league_data = league_data or {}
    return _season_year(
        league_data.get("seasonYear")
        or league_data.get("currentSeasonYear")
        or league_data.get("seasonStartYear"),
        DEFAULT_BASE_SEASON_YEAR,
    )


def get_current_financial_season_year(league_data: Optional[Dict[str, Any]]) -> int:
    league_data = league_data or {}
    financials = league_data.get("financials") if isinstance(league_data.get("financials"), dict) else {}
    return _season_year(
        league_data.get("currentFinancialSeasonYear")
        or financials.get("currentSeasonYear")
        or financials.get("currentFinancialSeasonYear")
        or financials.get("appliedThroughSeasonYear")
        or financials.get("appliedInflationThroughSeason")
        or get_league_season_year(league_data),
        get_league_season_year(league_data),
    )


def _build_base_rules_from_league(league_data: Optional[Dict[str, Any]]) -> Dict[str, float]:
    league_data = league_data or {}
    financials = league_data.get("financials") if isinstance(league_data.get("financials"), dict) else {}
    existing_base = financials.get("baseRules") if isinstance(financials.get("baseRules"), dict) else {}
    out = dict(DEFAULT_BASE_FINANCIAL_RULES)
    out.update(existing_base)

    out["salaryCap"] = _num(existing_base.get("salaryCap") or league_data.get("salaryCap") or league_data.get("capLimit"), out["salaryCap"])
    out["luxuryTaxLine"] = _num(existing_base.get("luxuryTaxLine") or league_data.get("luxuryTaxLine") or league_data.get("taxLine"), out["luxuryTaxLine"])
    out["firstApron"] = _num(existing_base.get("firstApron") or league_data.get("firstApron") or league_data.get("apron1"), out["firstApron"])
    out["secondApron"] = _num(existing_base.get("secondApron") or league_data.get("secondApron") or league_data.get("apron2"), out["secondApron"])
    out["hardCap"] = _num(existing_base.get("hardCap") or league_data.get("hardCap") or league_data.get("hardCapLimit") or league_data.get("secondApron") or league_data.get("apron2"), out["hardCap"])

    out["minimumSalary"] = _num(existing_base.get("minimumSalary") or league_data.get("minimumSalary"), out["minimumSalary"])
    out["minimumException"] = _num(existing_base.get("minimumException") or league_data.get("minimumException"), out["minimumException"])
    out["veteranMinimum"] = _num(existing_base.get("veteranMinimum") or league_data.get("veteranMinimum") or league_data.get("minimumException"), out["veteranMinimum"])
    out["twoWaySalary"] = _num(existing_base.get("twoWaySalary") or league_data.get("twoWaySalary"), out["twoWaySalary"])

    out["maxSalary"] = _num(existing_base.get("maxSalary") or league_data.get("maxSalary") or league_data.get("maxContract") or league_data.get("maxContractAmount"), out["maxSalary"])
    out["roomException"] = _num(existing_base.get("roomException") or league_data.get("roomException") or league_data.get("roomExceptionAmount"), out["roomException"])
    out["nonTaxpayerMLE"] = _num(existing_base.get("nonTaxpayerMLE") or league_data.get("nonTaxpayerMLE") or league_data.get("nonTaxpayerMidLevelException") or league_data.get("midLevelException"), out["nonTaxpayerMLE"])
    out["midLevelException"] = _num(existing_base.get("midLevelException") or league_data.get("midLevelException") or league_data.get("nonTaxpayerMLE") or league_data.get("nonTaxpayerMidLevelException"), out["midLevelException"])
    out["taxpayerMLE"] = _num(existing_base.get("taxpayerMLE") or league_data.get("taxpayerMLE") or league_data.get("taxpayerMidLevelException"), out["taxpayerMLE"])

    for key in [
        "rookiePick1Salary", "rookieFirstRoundDecline", "rookieFirstRoundFloor",
        "rookieSecondRoundBase", "rookieSecondRoundDecline", "rookieSecondRoundFloor",
    ]:
        out[key] = _num(existing_base.get(key), DEFAULT_BASE_FINANCIAL_RULES[key])

    return out


def _inflation_index(base_season_year: int, season_year: int, annual_rate: float) -> float:
    years = max(0, _season_year(season_year) - _season_year(base_season_year))
    return math.pow(1.0 + float(annual_rate), years)


def get_financial_rules(league_data: Optional[Dict[str, Any]], season_year: Optional[int] = None) -> Dict[str, Any]:
    league_data = league_data or {}
    financials = league_data.get("financials") if isinstance(league_data.get("financials"), dict) else {}
    base_season_year = _season_year(financials.get("baseSeasonYear") or get_league_season_year(league_data))
    current_year = _season_year(season_year or get_current_financial_season_year(league_data), base_season_year)
    annual_rate = _num(financials.get("annualInflationRate"), DEFAULT_ANNUAL_INFLATION_RATE)
    base_rules = _build_base_rules_from_league(league_data)
    index = _inflation_index(base_season_year, current_year, annual_rate)

    def scaled(key: str, nearest: int = 1_000) -> int:
        return round_money(_num(base_rules.get(key), DEFAULT_BASE_FINANCIAL_RULES.get(key, 0)) * index, nearest)

    rules = {
        "version": LEAGUE_FINANCIALS_VERSION,
        "baseSeasonYear": base_season_year,
        "seasonYear": current_year,
        "currentFinancialSeasonYear": current_year,
        "annualInflationRate": annual_rate,
        "inflationIndex": index,

        "salaryCap": scaled("salaryCap"),
        "luxuryTaxLine": scaled("luxuryTaxLine"),
        "firstApron": scaled("firstApron"),
        "secondApron": scaled("secondApron"),
        "hardCap": scaled("hardCap"),

        "minimumSalary": scaled("minimumSalary"),
        "minimumException": scaled("minimumException"),
        "veteranMinimum": scaled("veteranMinimum"),
        "twoWaySalary": scaled("twoWaySalary"),

        "maxSalary": scaled("maxSalary"),
        "roomException": scaled("roomException"),
        "nonTaxpayerMLE": scaled("nonTaxpayerMLE"),
        "midLevelException": scaled("nonTaxpayerMLE"),
        "taxpayerMLE": scaled("taxpayerMLE"),
    }
    rules["capLimit"] = rules["salaryCap"]
    rules["taxLine"] = rules["luxuryTaxLine"]
    rules["apron1"] = rules["firstApron"]
    rules["apron2"] = rules["secondApron"]
    rules["hardCapLimit"] = rules["hardCap"]
    rules["maxContract"] = rules["maxSalary"]
    rules["maxContractAmount"] = rules["maxSalary"]
    rules["roomExceptionAmount"] = rules["roomException"]
    rules["nonTaxpayerMidLevelException"] = rules["nonTaxpayerMLE"]
    rules["taxpayerMidLevelException"] = rules["taxpayerMLE"]
    return rules


def normalize_financial_aliases(league_data: Dict[str, Any], rules: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    if not isinstance(league_data, dict):
        return league_data
    rules = rules or get_financial_rules(league_data)
    league_data["currentFinancialSeasonYear"] = rules["seasonYear"]
    league_data["salaryCap"] = rules["salaryCap"]
    league_data["capLimit"] = rules["salaryCap"]
    league_data["luxuryTaxLine"] = rules["luxuryTaxLine"]
    league_data["taxLine"] = rules["luxuryTaxLine"]
    league_data["firstApron"] = rules["firstApron"]
    league_data["apron1"] = rules["firstApron"]
    league_data["secondApron"] = rules["secondApron"]
    league_data["apron2"] = rules["secondApron"]
    league_data["hardCap"] = rules["hardCap"]
    league_data["hardCapLimit"] = rules["hardCap"]
    league_data["minimumSalary"] = rules["minimumSalary"]
    league_data["minimumException"] = rules["minimumException"]
    league_data["veteranMinimum"] = rules["veteranMinimum"]
    league_data["twoWaySalary"] = rules["twoWaySalary"]
    league_data["maxSalary"] = rules["maxSalary"]
    league_data["maxContract"] = rules["maxSalary"]
    league_data["maxContractAmount"] = rules["maxSalary"]
    league_data["roomException"] = rules["roomException"]
    league_data["roomExceptionAmount"] = rules["roomException"]
    league_data["midLevelException"] = rules["midLevelException"]
    league_data["nonTaxpayerMLE"] = rules["nonTaxpayerMLE"]
    league_data["nonTaxpayerMidLevelException"] = rules["nonTaxpayerMLE"]
    league_data["taxpayerMLE"] = rules["taxpayerMLE"]
    league_data["taxpayerMidLevelException"] = rules["taxpayerMLE"]
    return league_data


def ensure_league_financials(league_data: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not isinstance(league_data, dict):
        return league_data

    financials = league_data.get("financials") if isinstance(league_data.get("financials"), dict) else {}
    base_season_year = _season_year(financials.get("baseSeasonYear") or get_league_season_year(league_data))
    current_year = _season_year(
        financials.get("currentSeasonYear")
        or financials.get("currentFinancialSeasonYear")
        or league_data.get("currentFinancialSeasonYear")
        or financials.get("appliedThroughSeasonYear")
        or financials.get("appliedInflationThroughSeason")
        or get_league_season_year(league_data),
        base_season_year,
    )
    annual_rate = _num(financials.get("annualInflationRate"), DEFAULT_ANNUAL_INFLATION_RATE)
    base_rules = _build_base_rules_from_league(league_data)
    applied_year = _season_year(
        financials.get("appliedThroughSeasonYear")
        or financials.get("appliedInflationThroughSeason")
        or current_year,
        current_year,
    )

    next_financials = dict(financials)
    next_financials.update({
        "version": LEAGUE_FINANCIALS_VERSION,
        "baseSeasonYear": base_season_year,
        "annualInflationRate": annual_rate,
        "baseRules": base_rules,
        "currentSeasonYear": current_year,
        "currentFinancialSeasonYear": current_year,
        "appliedThroughSeasonYear": applied_year,
    })
    history = next_financials.get("history") if isinstance(next_financials.get("history"), dict) else {}
    next_financials["history"] = history
    league_data["financials"] = next_financials

    rules = get_financial_rules(league_data, current_year)
    history[str(current_year)] = {
        **(history.get(str(current_year)) if isinstance(history.get(str(current_year)), dict) else {}),
        "seasonYear": current_year,
        "inflationIndex": rules["inflationIndex"],
        "salaryCap": rules["salaryCap"],
        "luxuryTaxLine": rules["luxuryTaxLine"],
        "firstApron": rules["firstApron"],
        "secondApron": rules["secondApron"],
        "hardCap": rules["hardCap"],
        "minimumSalary": rules["minimumSalary"],
        "minimumException": rules["minimumException"],
        "maxSalary": rules["maxSalary"],
        "midLevelException": rules["midLevelException"],
        "taxpayerMLE": rules["taxpayerMLE"],
        "roomException": rules["roomException"],
        "twoWaySalary": rules["twoWaySalary"],
    }
    return normalize_financial_aliases(league_data, rules)


def apply_league_inflation_for_offseason(league_data: Dict[str, Any], target_season_year: Optional[int] = None) -> Dict[str, Any]:
    league_data = ensure_league_financials(copy.deepcopy(league_data or {}))
    target_year = _season_year(target_season_year or get_league_season_year(league_data) + 1)
    financials = league_data.get("financials", {})
    applied_year = _season_year(
        financials.get("appliedThroughSeasonYear") or financials.get("appliedInflationThroughSeason") or financials.get("currentSeasonYear"),
        get_league_season_year(league_data),
    )

    if applied_year < target_year:
        financials["currentSeasonYear"] = target_year
        financials["currentFinancialSeasonYear"] = target_year
        financials["appliedThroughSeasonYear"] = target_year
        financials["appliedInflationThroughSeason"] = target_year
        financials["lastAppliedAt"] = _dt.datetime.utcnow().isoformat() + "Z"
        league_data["currentFinancialSeasonYear"] = target_year

    rules = get_financial_rules(league_data, target_year)
    history = financials.get("history") if isinstance(financials.get("history"), dict) else {}
    financials["history"] = history
    history[str(target_year)] = {
        "seasonYear": target_year,
        "inflationIndex": rules["inflationIndex"],
        "salaryCap": rules["salaryCap"],
        "luxuryTaxLine": rules["luxuryTaxLine"],
        "firstApron": rules["firstApron"],
        "secondApron": rules["secondApron"],
        "hardCap": rules["hardCap"],
        "minimumSalary": rules["minimumSalary"],
        "minimumException": rules["minimumException"],
        "veteranMinimum": rules["veteranMinimum"],
        "maxSalary": rules["maxSalary"],
        "midLevelException": rules["midLevelException"],
        "taxpayerMLE": rules["taxpayerMLE"],
        "roomException": rules["roomException"],
        "twoWaySalary": rules["twoWaySalary"],
        "appliedAt": financials.get("lastAppliedAt"),
    }
    return normalize_financial_aliases(league_data, rules)


def get_rookie_salary_for_pick(league_data: Optional[Dict[str, Any]], round_num: int, pick_num: int, season_year: Optional[int] = None) -> int:
    league_data = ensure_league_financials(league_data or {})
    rules = get_financial_rules(league_data, season_year or get_current_financial_season_year(league_data))
    base_rules = league_data.get("financials", {}).get("baseRules", DEFAULT_BASE_FINANCIAL_RULES)
    index = _num(rules.get("inflationIndex"), 1.0)

    if int(round_num or 1) == 1:
        base_salary = max(
            _num(base_rules.get("rookieFirstRoundFloor"), DEFAULT_BASE_FINANCIAL_RULES["rookieFirstRoundFloor"]),
            _num(base_rules.get("rookiePick1Salary"), DEFAULT_BASE_FINANCIAL_RULES["rookiePick1Salary"]) -
            (max(1, int(pick_num or 1)) - 1) * _num(base_rules.get("rookieFirstRoundDecline"), DEFAULT_BASE_FINANCIAL_RULES["rookieFirstRoundDecline"]),
        )
    else:
        pick_in_round = max(1, int(pick_num or 31) - 30)
        base_salary = max(
            _num(base_rules.get("rookieSecondRoundFloor"), DEFAULT_BASE_FINANCIAL_RULES["rookieSecondRoundFloor"]),
            _num(base_rules.get("rookieSecondRoundBase"), DEFAULT_BASE_FINANCIAL_RULES["rookieSecondRoundBase"]) -
            (pick_in_round - 1) * _num(base_rules.get("rookieSecondRoundDecline"), DEFAULT_BASE_FINANCIAL_RULES["rookieSecondRoundDecline"]),
        )

    return round_money(base_salary * index, 1_000)
