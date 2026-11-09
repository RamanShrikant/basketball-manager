"""Player-side contract-extension acceptance logic.

This module is intentionally separate from the orchestration layer so the
player decision model can be reviewed and tuned without touching UI, worker,
or contract-application code.
"""
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


import hashlib
import math
import random
from typing import Any, Dict, Optional

try:
    from free_agency_logic import estimate_market_value, classify_team_direction
except Exception:  # pragma: no cover - standalone fallback
    estimate_market_value = None
    classify_team_direction = None


def _num(value: Any, fallback: float = 0.0) -> float:
    try:
        if value is None or value == "":
            return float(fallback)
        n = float(value)
        return n if math.isfinite(n) else float(fallback)
    except Exception:
        return float(fallback)


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def _norm(value: Any) -> str:
    return "".join(ch.lower() for ch in str(value or "") if ch.isalnum())


def _player_key(player: Dict[str, Any]) -> str:
    return str(player.get("id") or player.get("playerId") or _norm(player.get("name")))


def _seeded_jitter(parts: list[Any], lo: float = -3.5, hi: float = 3.5) -> float:
    raw = "|".join(str(part or "") for part in parts)
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    rng = random.Random(int(digest[:16], 16))
    return rng.uniform(lo, hi)


def _market_value(player: Dict[str, Any]) -> Dict[str, Any]:
    existing = player.get("marketValue") if isinstance(player.get("marketValue"), dict) else None
    if existing:
        return existing
    if estimate_market_value is not None:
        try:
            row = estimate_market_value(player)
            if isinstance(row, dict):
                return row
        except Exception:
            pass

    overall = _num(player.get("overall"), 70)
    potential = _num(player.get("potential"), overall)
    age = _num(player.get("age"), 27)
    first = max(1_500_000, (overall - 58) * 1_050_000 + max(0, potential - overall) * 400_000)
    if age >= 32:
        first *= max(0.62, 1.0 - (age - 31) * 0.055)
    years = 4 if age <= 28 and overall >= 78 else 3 if age <= 31 else 2
    salaries = [int(round(first * (1.05 ** i) / 1000.0) * 1000) for i in range(years)]
    return {
        "expectedYears": years,
        "expectedYear1Salary": salaries[0],
        "expectedAAV": sum(salaries) / len(salaries),
        "minAcceptableAAV": salaries[0] * 0.84,
        "salaryByYear": salaries,
    }


def _saved_mood_score(league_data: Dict[str, Any], player: Dict[str, Any]) -> float:
    explicit = player.get("mood")
    if isinstance(explicit, dict):
        value = _num(explicit.get("value") or explicit.get("score"), 50)
        return _clamp((value - 50) / 5.0, -8, 8)
    if isinstance(explicit, (int, float)):
        return _clamp((_num(explicit, 50) - 50) / 5.0, -8, 8)

    state = league_data.get("playerMoodState") if isinstance(league_data.get("playerMoodState"), dict) else {}
    players = state.get("players") if isinstance(state.get("players"), dict) else {}
    keys = [
        f"id:{_player_key(player)}",
        _player_key(player),
        str(player.get("name") or ""),
        f"name:{player.get('name') or ''}",
        _norm(player.get("name")),
    ]
    for key in keys:
        row = players.get(key)
        if not isinstance(row, dict):
            continue
        value = _num(row.get("value") or row.get("score") or row.get("mood"), 50)
        if value:
            return _clamp((value - 50) / 5.0, -8, 8)
    return 0.0


def _team_direction_bonus(team: Dict[str, Any], league_data: Dict[str, Any], player: Dict[str, Any]) -> float:
    direction = "balanced"
    if classify_team_direction is not None:
        try:
            row = classify_team_direction(team, league_data=league_data)
            if isinstance(row, dict):
                direction = str(row.get("direction") or direction).lower()
        except Exception:
            pass
    age = _num(player.get("age"), 27)
    overall = _num(player.get("overall"), 70)
    if direction in {"contender", "title_contender", "win_now"}:
        return 4.0 if overall >= 78 or age >= 28 else 2.0
    if direction in {"rebuilding", "rebuild"}:
        return 3.0 if age <= 25 else -3.0 if age >= 30 else 0.0
    return 1.0


def evaluate_extension_offer(
    league_data: Dict[str, Any],
    team: Dict[str, Any],
    player: Dict[str, Any],
    offer: Dict[str, Any],
    eligibility: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    player = economic_player_copy(player)  # BM_PATCH32_EXTENSION_ECONOMY
    """Return a deterministic player decision for one exact extension offer."""
    eligibility = eligibility or {}
    market = _market_value(player)
    salaries = [int(_num(x, 0)) for x in (offer.get("salaryByYear") or []) if _num(x, 0) > 0]
    years = len(salaries)
    if not salaries:
        return {
            "accepted": False,
            "score": 0,
            "threshold": 100,
            "interestLabel": "Invalid offer",
            "reason": "The offer does not contain guaranteed extension salary.",
            "marketValue": market,
        }

    offer_aav = sum(salaries) / years
    market_aav = max(1.0, _num(market.get("expectedAAV") or market.get("expectedYear1Salary"), salaries[0]))
    first_salary = salaries[0]
    market_first = max(1.0, _num(market.get("expectedYear1Salary"), market_aav))
    value_ratio = offer_aav / market_aav
    first_ratio = first_salary / market_first

    age = _num(player.get("age"), 27)
    overall = _num(player.get("overall"), 70)
    potential = _num(player.get("potential"), overall)
    team_years = _num((player.get("meta") or {}).get("yearsWithCurrentTeam"), 0)
    option_type = str(offer.get("optionType") or "none").lower()

    score = 0.0
    score += _clamp(value_ratio, 0.45, 1.25) * 61.0
    score += _clamp(first_ratio, 0.50, 1.25) * 13.0

    security_weight = 2.0 + max(0.0, age - 28.0) * 0.7
    score += min(years, 5) * security_weight
    score += min(7.0, team_years * 0.85)
    score += _saved_mood_score(league_data, player)
    score += _team_direction_bonus(team, league_data, player)

    upside_gap = max(0.0, potential - overall)
    if age <= 25:
        score -= min(10.0, upside_gap * 0.7)
        if value_ratio < 0.97:
            score -= 4.0
    if age >= 31 and years >= 3:
        score += 4.0
    if overall >= 90 and first_ratio < 0.98:
        score -= 9.0
    elif overall >= 84 and first_ratio < 0.93:
        score -= 5.0

    if option_type == "player":
        score += 3.5
    elif option_type == "team":
        score -= 4.0 if age <= 29 else 2.0

    extension_type = str(eligibility.get("extensionType") or offer.get("extensionType") or "veteran")
    if extension_type == "rookie_scale" and age <= 24:
        score -= 2.0

    season_year = league_data.get("seasonYear") or league_data.get("seasonStartYear") or 0
    offer_signature = ",".join(str(x) for x in salaries)
    jitter = _seeded_jitter([
        "contract_extension_acceptance_v1",
        season_year,
        team.get("name"),
        _player_key(player),
        offer_signature,
        option_type,
    ])
    threshold = 78.0 + jitter
    accepted = score >= threshold

    if score >= threshold + 9:
        interest = "Very likely to accept"
    elif score >= threshold:
        interest = "Open to an extension"
    elif score >= threshold - 7:
        interest = "Would need a stronger offer"
    elif value_ratio >= 0.88:
        interest = "Leaning toward free agency"
    else:
        interest = "Prefers to test free agency"

    if accepted:
        reason = "The guaranteed value, term, and team situation meet the player's expectations."
    elif first_ratio < 0.86:
        reason = "The first-year salary is too far below the player's projected market."
    elif value_ratio < 0.90:
        reason = "The total guaranteed value is below the player's extension expectations."
    elif age <= 25 and upside_gap >= 4:
        reason = "The player is willing to bet on continued development before committing."
    else:
        reason = "The player is not ready to commit at this structure."

    return {
        "accepted": bool(accepted),
        "score": round(score, 2),
        "threshold": round(threshold, 2),
        "interestLabel": interest,
        "reason": reason,
        "offerAAV": int(round(offer_aav)),
        "marketAAV": int(round(market_aav)),
        "valueRatio": round(value_ratio, 4),
        "marketValue": market,
    }
