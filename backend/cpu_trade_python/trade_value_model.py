"""
trade_value_model.py

Player, pick, and package valuation for Basketball Manager trade CPU.

This file is where your friend should tune how much the CPU values:
- current overall
- potential/upside
- age
- contracts
- stars
- draft picks and pick protections

It has no final accept/reject logic. It only assigns value.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List


# -----------------------------------------------------------------------------
# Main knobs your friend can tune
# -----------------------------------------------------------------------------

PLAYER_VALUE_KNOBS: Dict[str, float] = {
    "overallBase": 60.0,
    "overallMultiplier": 2.35,
    "potentialMultiplier": 1.0,
    "salaryPenaltyMultiplier": 0.75,
    "bargainContractMultiplier": 0.25,
    "rookieScaleBonus": 6.0,
    "badLongContractPenalty": 5.0,
    "superstarBonus": 24.0,  # 92+
    "allStarBonus": 14.0,    # 88-91
    "starterBonus": 7.0,     # 84-87
}

PICK_VALUE_KNOBS: Dict[str, float] = {
    # Unresolved future-pick baseline.
    "firstRoundBase": 34.0,
    "firstRoundRankPenalty": 0.85,
    "firstRoundFloor": 6.0,
    "secondRoundBase": 6.0,
    "secondRoundRankPenalty": 0.08,
    "secondRoundFloor": 1.0,

    # Exact post-lottery picks. These make #1/#2/#3 feel meaningfully different
    # from a vague future first while keeping late firsts in a realistic band.
    "exactFirstPickBonus": 10.0,
    "exactTopThreeBonus": 6.0,
    "exactLotteryBonus": 2.5,
    "exactSecondRoundBonus": 1.0,

    "futureDiscountPerYear": 0.045,
    "futureDiscountFloor": 0.72,
}

PROTECTION_MULTIPLIERS: Dict[str, float] = {
    "unprotected": 1.00,
    "top1": 0.92,
    "top3": 0.82,
    "top5": 0.72,
    "top8": 0.62,
    "top10": 0.55,
    "lottery": 0.45,
    "top20": 0.35,
    "other": 0.70,
}


# -----------------------------------------------------------------------------
# Safe helpers
# -----------------------------------------------------------------------------


def _num(value: Any, default: float = 0.0) -> float:
    try:
        n = float(value)
        if math.isfinite(n):
            return n
    except Exception:
        pass
    return default


def _str(value: Any, default: str = "") -> str:
    if value is None:
        return default
    return str(value)


def normalize_name(name: Any) -> str:
    return " ".join(_str(name).lower().replace(".", "").replace("-", " ").split())


def same_name(a: Any, b: Any) -> bool:
    return normalize_name(a) == normalize_name(b)


def player_name(player: Dict[str, Any]) -> str:
    return _str(player.get("name") or player.get("player"), "Unknown Player")


def player_pos(player: Dict[str, Any]) -> str:
    return _str(player.get("pos") or player.get("position"), "")


def player_overall(player: Dict[str, Any]) -> float:
    return _num(
        player.get("overall")
        or player.get("ovr")
        or player.get("rating")
        or player.get("overallRating"),
        60.0,
    )


def player_potential(player: Dict[str, Any]) -> float:
    return _num(player.get("potential") or player.get("pot"), player_overall(player))


def player_age(player: Dict[str, Any]) -> float:
    return _num(player.get("age"), 27.0)


def player_salary(player: Dict[str, Any]) -> float:
    direct = _num(
        player.get("salary")
        or player.get("currentSalary")
        or player.get("contractSalary")
        or player.get("capHit")
        or player.get("aav"),
        -1.0,
    )
    if direct >= 0:
        return direct

    contract = player.get("contract") if isinstance(player.get("contract"), dict) else {}
    salary_by_year = contract.get("salaryByYear")
    if isinstance(salary_by_year, list) and salary_by_year:
        return _num(salary_by_year[0], 0.0)

    return 0.0


def contract_years_left(player: Dict[str, Any]) -> int:
    years = _num(player.get("yearsLeft") or player.get("contractYears"), -1)
    if years >= 0:
        return int(years)

    contract = player.get("contract") if isinstance(player.get("contract"), dict) else {}
    salary_by_year = contract.get("salaryByYear")
    if isinstance(salary_by_year, list):
        return len(salary_by_year)

    return 0


def is_rookie_scale(player: Dict[str, Any]) -> bool:
    rights = player.get("rights") if isinstance(player.get("rights"), dict) else {}
    return bool(rights.get("rookieScale") or player.get("rookieScale"))


def is_tradeable_standard_player(player: Dict[str, Any]) -> bool:
    status = _str(player.get("rosterStatus") or player.get("contractType"), "").lower()
    return not (
        player.get("isTwoWay")
        or player.get("isStash")
        or "two_way" in status
        or "two-way" in status
        or "stash" in status
    )


def _age_value(age: float) -> float:
    if age <= 22:
        return 9.0
    if age <= 25:
        return 6.0
    if age <= 29:
        return 2.0
    if age <= 32:
        return -2.0
    if age <= 34:
        return -7.0
    return -13.0


def _upside_age_multiplier(age: float) -> float:
    if age <= 21:
        return 2.4
    if age <= 24:
        return 1.9
    if age <= 27:
        return 1.15
    return 0.35


def _protection_key(text: str) -> str:
    s = _str(text, "").lower().replace("-", " ")
    if not s or "unprotected" in s or "resolved" in s or s in {"none", "null"}:
        return "unprotected"
    if "top 1" in s:
        return "top1"
    if "top 3" in s:
        return "top3"
    if "top 5" in s:
        return "top5"
    if "top 8" in s:
        return "top8"
    if "top 10" in s:
        return "top10"
    if "lottery" in s or "1 14" in s or "1-14" in s:
        return "lottery"
    if "top 20" in s:
        return "top20"
    return "other"


def _pick_number(pick: Dict[str, Any]) -> int:
    """Exact draft slot when the lottery/draft order has already locked."""
    raw = (
        pick.get("pickNumber")
        or pick.get("overallPick")
        or pick.get("resolvedPickNumber")
        or pick.get("draftPickNumber")
        or pick.get("pickNo")
        or pick.get("pick")
    )
    n = int(_num(raw, 0))
    return n if n > 0 else 0


def _current_season_year_from_pick(pick: Dict[str, Any], default: int = 2026) -> int:
    for key in ["currentSeasonYear", "leagueSeasonYear", "seasonNow", "baseSeasonYear"]:
        year = int(_num(pick.get(key), 0))
        if 2020 <= year <= 2100:
            return year
    return default


def _is_resolved_pick(pick: Dict[str, Any]) -> bool:
    t = _str(pick.get("assetType") or pick.get("type"), "").lower()
    return t == "resolved" or bool(_pick_number(pick))


def pick_label(pick: Dict[str, Any]) -> str:
    year = pick.get("year") or pick.get("seasonYear") or pick.get("season") or "Future"
    round_num = int(_num(pick.get("round") or pick.get("roundNum") or pick.get("pickRound"), 1))
    suffix = "1st" if round_num == 1 else "2nd" if round_num == 2 else f"R{round_num}"
    original = pick.get("originalTeam") or pick.get("originalTeamName") or pick.get("team") or pick.get("fromTeam") or "Own"
    pick_no = _pick_number(pick)
    pick_text = f" #{pick_no}" if pick_no else ""
    return f"{year} {suffix}{pick_text} - {original}"


# -----------------------------------------------------------------------------
# Public valuation API
# -----------------------------------------------------------------------------


def player_trade_value(player: Dict[str, Any], team_preferences: Dict[str, Any] | None = None) -> float:
    """Return a rough trade value for a player from the perspective of a team."""
    if not isinstance(player, dict):
        return 0.0

    prefs = team_preferences if isinstance(team_preferences, dict) else {}
    phase_prefs = prefs.get("preferences") if isinstance(prefs.get("preferences"), dict) else {}

    current_mult = _num(phase_prefs.get("currentTalent"), 1.0)
    upside_mult = _num(phase_prefs.get("upside"), 1.0)
    salary_flex_mult = _num(phase_prefs.get("salaryFlex"), 1.0)

    overall = player_overall(player)
    potential = player_potential(player)
    age = player_age(player)
    salary = player_salary(player)
    years_left = contract_years_left(player)

    current_value = max(0.0, (overall - PLAYER_VALUE_KNOBS["overallBase"]) * PLAYER_VALUE_KNOBS["overallMultiplier"])

    upside_gap = max(0.0, potential - overall)
    upside_value = upside_gap * _upside_age_multiplier(age) * PLAYER_VALUE_KNOBS["potentialMultiplier"]

    age_bonus = _age_value(age)

    salary_m = salary / 1_000_000.0
    expected_salary_m = max(1.5, (overall - 55.0) * 1.55)
    salary_delta = salary_m - expected_salary_m
    contract_penalty = 0.0

    if salary_delta > 0:
        contract_penalty += salary_delta * PLAYER_VALUE_KNOBS["salaryPenaltyMultiplier"] * salary_flex_mult
    else:
        contract_penalty += salary_delta * PLAYER_VALUE_KNOBS["bargainContractMultiplier"]

    if years_left >= 4 and salary_delta > 8:
        contract_penalty += PLAYER_VALUE_KNOBS["badLongContractPenalty"] * salary_flex_mult

    if is_rookie_scale(player) and potential >= 78:
        contract_penalty -= PLAYER_VALUE_KNOBS["rookieScaleBonus"]

    value = (current_value * current_mult) + (upside_value * upside_mult) + age_bonus - contract_penalty

    if overall >= 92:
        value += PLAYER_VALUE_KNOBS["superstarBonus"]
    elif overall >= 88:
        value += PLAYER_VALUE_KNOBS["allStarBonus"]
    elif overall >= 84:
        value += PLAYER_VALUE_KNOBS["starterBonus"]

    return round(max(-25.0, value), 2)


def pick_trade_value(pick: Dict[str, Any], team_preferences: Dict[str, Any] | None = None) -> float:
    """Return trade value for a draft pick.

    Important: after the draft lottery locks, React sends exact resolved picks
    with pickNumber/overallPick/projectedRank. This function values those picks
    by the real slot, so #1/#2/#3 carry true premium value and pick #28 does not
    get treated like a generic future first.
    """
    if not isinstance(pick, dict):
        return 0.0

    prefs = team_preferences if isinstance(team_preferences, dict) else {}
    phase_prefs = prefs.get("preferences") if isinstance(prefs.get("preferences"), dict) else {}
    picks_mult = _num(phase_prefs.get("picks"), 1.0)

    round_num = int(_num(pick.get("round") or pick.get("roundNum") or pick.get("pickRound"), 1))
    year = int(_num(pick.get("year") or pick.get("seasonYear"), 2026))
    pick_no = _pick_number(pick)
    exact_pick = _is_resolved_pick(pick)

    projected_rank = _num(
        pick_no
        or pick.get("projectedRank")
        or pick.get("recordRank")
        or pick.get("expectedRank")
        or pick.get("slot"),
        18.0,
    )

    if round_num <= 1:
        base = PICK_VALUE_KNOBS["firstRoundBase"] - projected_rank * PICK_VALUE_KNOBS["firstRoundRankPenalty"]
        base = max(PICK_VALUE_KNOBS["firstRoundFloor"], base)
        if exact_pick:
            if projected_rank <= 1:
                base += PICK_VALUE_KNOBS["exactFirstPickBonus"]
            elif projected_rank <= 3:
                base += PICK_VALUE_KNOBS["exactTopThreeBonus"]
            elif projected_rank <= 14:
                base += PICK_VALUE_KNOBS["exactLotteryBonus"]
    else:
        base = PICK_VALUE_KNOBS["secondRoundBase"] - projected_rank * PICK_VALUE_KNOBS["secondRoundRankPenalty"]
        base = max(PICK_VALUE_KNOBS["secondRoundFloor"], base)
        if exact_pick:
            base += PICK_VALUE_KNOBS["exactSecondRoundBonus"]

    protection_text = _str(
        pick.get("protection")
        or pick.get("protections")
        or pick.get("displayProtection")
        or pick.get("protectionText"),
        "",
    )
    protection_mult = PROTECTION_MULTIPLIERS.get(_protection_key(protection_text), PROTECTION_MULTIPLIERS["other"])

    # For exact current-year resolved picks, never apply a future discount. For
    # future picks, use the season year React sends instead of hardcoding 2026.
    current_season = _current_season_year_from_pick(pick, 2026)
    years_out = 0 if exact_pick and year == current_season else max(0, year - current_season)
    future_discount = max(
        PICK_VALUE_KNOBS["futureDiscountFloor"],
        1.0 - years_out * PICK_VALUE_KNOBS["futureDiscountPerYear"],
    )

    value = base * protection_mult * future_discount * picks_mult
    return round(max(0.5, value), 2)


def package_value(package: Dict[str, Any], team_preferences: Dict[str, Any] | None = None) -> Dict[str, Any]:
    """Value a package shape: {players: [...], picks: [...]}"""
    if not isinstance(package, dict):
        package = {}

    players = package.get("players") if isinstance(package.get("players"), list) else []
    picks = package.get("picks") if isinstance(package.get("picks"), list) else []

    player_rows: List[Dict[str, Any]] = []
    pick_rows: List[Dict[str, Any]] = []
    total = 0.0
    salary_total = 0.0

    for player in players:
        if not isinstance(player, dict):
            continue
        value = player_trade_value(player, team_preferences)
        salary = player_salary(player)
        salary_total += salary
        total += value
        player_rows.append(
            {
                "name": player_name(player),
                "pos": player_pos(player),
                "overall": player_overall(player),
                "potential": player_potential(player),
                "age": player_age(player),
                "salary": salary,
                "value": value,
            }
        )

    for pick in picks:
        if not isinstance(pick, dict):
            continue
        value = pick_trade_value(pick, team_preferences)
        total += value
        pick_rows.append(
            {
                "label": pick_label(pick),
                "year": pick.get("year") or pick.get("seasonYear"),
                "round": pick.get("round") or pick.get("roundNum") or pick.get("pickRound"),
                "pickNumber": _pick_number(pick) or None,
                "owner": pick.get("owner") or pick.get("ownerTeam") or pick.get("team") or pick.get("originalTeam"),
                "originalTeam": pick.get("originalTeam") or pick.get("originalTeamName") or pick.get("team"),
                "protection": pick.get("protection") or pick.get("protections") or pick.get("displayProtection") or "Unprotected",
                "value": value,
            }
        )

    return {
        "totalValue": round(total, 2),
        "salaryTotal": round(salary_total, 2),
        "players": player_rows,
        "picks": pick_rows,
    }


def get_owned_picks_for_team(league_state: Dict[str, Any], team_name: str) -> List[Dict[str, Any]]:
    rows = league_state.get("draftPicks") if isinstance(league_state, dict) else []
    if not isinstance(rows, list):
        return []

    owned: List[Dict[str, Any]] = []
    for raw in rows:
        if not isinstance(raw, dict):
            continue
        status = _str(raw.get("status") or "active", "active").lower()
        if status != "active":
            continue
        owner = raw.get("ownerTeam") or raw.get("owner") or raw.get("currentOwnerTeamName") or raw.get("teamName")
        if same_name(owner, team_name):
            owned.append(raw)

    def pick_sort_key(p: Dict[str, Any]):
        return (
            int(_num(p.get("year") or p.get("seasonYear"), 2099)),
            int(_num(p.get("round"), 9)),
            _pick_number(p) or 99,
        )

    return sorted(owned, key=pick_sort_key)


def candidate_assets_for_team(team: Dict[str, Any], league_state: Dict[str, Any] | None = None, team_preferences: Dict[str, Any] | None = None) -> List[Dict[str, Any]]:
    """Return tradeable player and pick assets for Trade Finder offer generation."""
    if league_state is None:
        league_state = {}
    team_name = _str(team.get("name") or team.get("teamName"), "") if isinstance(team, dict) else ""

    candidates: List[Dict[str, Any]] = []

    players = team.get("players") if isinstance(team, dict) and isinstance(team.get("players"), list) else []
    for player in players:
        if not isinstance(player, dict) or not is_tradeable_standard_player(player):
            continue
        value = player_trade_value(player, team_preferences)
        candidates.append(
            {
                "type": "player",
                "player": player,
                "label": player_name(player),
                "value": value,
                "salary": player_salary(player),
            }
        )

    for pick in get_owned_picks_for_team(league_state, team_name):
        protection = pick.get("protection") or pick.get("protections") or pick.get("displayProtection") or "Unprotected"
        value = pick_trade_value(pick, team_preferences)
        candidates.append(
            {
                "type": "pick",
                "pick": pick,
                "protection": protection,
                "label": f"{protection} {pick_label(pick)}",
                "value": value,
                "salary": 0,
            }
        )

    return sorted(candidates, key=lambda item: _num(item.get("value"), 0.0), reverse=True)


def items_to_package(items: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    players: List[Dict[str, Any]] = []
    picks: List[Dict[str, Any]] = []

    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        if item.get("type") == "player" and isinstance(item.get("player"), dict):
            players.append(item["player"])
        elif item.get("type") == "pick" and isinstance(item.get("pick"), dict):
            pick = dict(item["pick"])
            protection = item.get("protection") or pick.get("protection") or pick.get("protections") or "Unprotected"
            pick["protection"] = protection
            pick["protections"] = protection
            pick["displayProtection"] = protection
            picks.append(pick)

    return {"players": players, "picks": picks}
