import copy
import json
import random
import sys
from typing import Any, Dict, List, Optional, Tuple

DEFAULT_SALARY_CAP = 150_000_000
REGULAR_SEASON_MIN_ROSTER = 14
REGULAR_SEASON_MAX_ROSTER = 15
DEFAULT_ROSTER_LIMIT = REGULAR_SEASON_MAX_ROSTER
DEFAULT_SEASON_YEAR = 2026

MIN_DEAL = 1_200_000
MAX_SALARY = 45_000_000
YEARLY_RAISE = 0.05

DEFAULT_FREE_AGENCY_DAYS = 7
MAX_ACTIVE_OFFERS_PER_TEAM = 5


def num(value: Any, fallback: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return float(fallback)


def round_to_nearest(value: float, base: int = 1_000) -> int:
    return int(base * round(float(value) / base))


def clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def stable_text_seed(text: str) -> int:
    out = 0
    for idx, ch in enumerate(str(text)):
        out += (idx + 1) * ord(ch)
    return out


def get_current_season_year(league_data: Dict[str, Any]) -> int:
    return int(
        league_data.get("seasonYear")
        or league_data.get("currentSeasonYear")
        or DEFAULT_SEASON_YEAR
    )


def get_salary_cap(league_data: Dict[str, Any]) -> int:
    return int(
        league_data.get("salaryCap")
        or league_data.get("capLimit")
        or DEFAULT_SALARY_CAP
    )


def get_roster_limit(league_data: Dict[str, Any]) -> int:
    return int(
        league_data.get("rosterLimit")
        or league_data.get("maxRosterSize")
        or REGULAR_SEASON_MAX_ROSTER
    )


def get_min_roster_target(league_data: Dict[str, Any]) -> int:
    return int(
        league_data.get("minRosterSize")
        or league_data.get("minRosterLimit")
        or REGULAR_SEASON_MIN_ROSTER
    )


def iter_teams(league_data: Dict[str, Any]):
    conferences = league_data.get("conferences", {})
    for conf_name in ["East", "West"]:
        for idx, team in enumerate(conferences.get(conf_name, [])):
            yield conf_name, idx, team


def find_team_entry(
    league_data: Dict[str, Any],
    team_name: str
) -> Tuple[Optional[str], Optional[int], Optional[Dict[str, Any]]]:
    for conf_name, idx, team in iter_teams(league_data):
        if team.get("name") == team_name:
            return conf_name, idx, team
    return None, None, None


def get_option_year_indices(option: Optional[Dict[str, Any]]) -> List[int]:
    if not option:
        return []

    if isinstance(option.get("yearIndices"), list):
        raw = option.get("yearIndices", [])
    elif option.get("yearIndex") is not None:
        raw = [option.get("yearIndex")]
    else:
        raw = []

    out = []
    seen = set()

    for item in raw:
        try:
            n = int(item)
        except (TypeError, ValueError):
            continue
        if n < 0 or n in seen:
            continue
        seen.add(n)
        out.append(n)

    out.sort()
    return out


def normalize_contract(contract: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if contract is None:
        return None

    start_year = int(contract.get("startYear", DEFAULT_SEASON_YEAR))
    salary_by_year = contract.get("salaryByYear", [8_000_000])

    if not isinstance(salary_by_year, list) or not salary_by_year:
        salary_by_year = [8_000_000]

    safe_salary_by_year = [int(round(num(x, 0))) for x in salary_by_year]
    raw_option = contract.get("option")

    safe_option = None
    if raw_option:
        option_type = raw_option.get("type")
        if option_type in ["team", "player"]:
            safe_option = {
                "type": option_type,
                "yearIndices": get_option_year_indices(raw_option),
                "picked": raw_option.get("picked"),
            }

    return {
        "startYear": start_year,
        "salaryByYear": safe_salary_by_year,
        "option": safe_option,
    }


def build_salary_by_year(year1_salary: int, years: int) -> List[int]:
    out = []
    for i in range(int(clamp(years, 1, 4))):
        salary = year1_salary * ((1 + YEARLY_RAISE) ** i)
        out.append(int(round_to_nearest(salary, base = 1_000)))
    return out


def get_contract_year_index(contract: Optional[Dict[str, Any]], season_year: int) -> Optional[int]:
    contract = normalize_contract(contract)
    if not contract:
        return None
    return season_year - contract["startYear"]


def get_contract_last_year(contract: Optional[Dict[str, Any]]) -> Optional[int]:
    contract = normalize_contract(contract)
    if not contract:
        return None
    return contract["startYear"] + len(contract["salaryByYear"]) - 1


def get_contract_salary_for_year(contract: Optional[Dict[str, Any]], season_year: int) -> int:
    contract = normalize_contract(contract)
    if not contract:
        return 0

    idx = season_year - contract["startYear"]
    salary_by_year = contract["salaryByYear"]

    if idx < 0 or idx >= len(salary_by_year):
        return 0

    return int(salary_by_year[idx])


def get_next_season_salary(contract: Optional[Dict[str, Any]], season_year: int) -> int:
    return get_contract_salary_for_year(contract, season_year + 1)


def get_option_pick_value(option: Optional[Dict[str, Any]], year_index: int):
    if not option:
        return None

    raw_picked = option.get("picked")

    if isinstance(raw_picked, dict):
        if str(year_index) in raw_picked:
            return raw_picked[str(year_index)]
        if "default" in raw_picked:
            return raw_picked["default"]
        return None

    return raw_picked


def get_active_option_for_year(contract: Optional[Dict[str, Any]], season_year: int) -> Optional[Dict[str, Any]]:
    contract = normalize_contract(contract)
    if not contract:
        return None

    option = contract.get("option")
    if not option:
        return None

    idx = get_contract_year_index(contract, season_year)
    if idx is None or idx < 0:
        return None

    year_indices = get_option_year_indices(option)
    if idx not in year_indices:
        return None

    picked_value = get_option_pick_value(option, idx)
    if picked_value is not None:
        return None

    return {
        "type": option.get("type"),
        "yearIndex": idx,
        "salary": get_contract_salary_for_year(contract, season_year),
        "picked": picked_value,
    }


def set_option_pick_for_year(contract: Dict[str, Any], year_index: int, picked_value: bool) -> Dict[str, Any]:
    normalized = normalize_contract(contract)
    if not normalized or not normalized.get("option"):
        return normalized

    raw_picked = normalized["option"].get("picked")

    if isinstance(raw_picked, dict):
        picked_map = dict(raw_picked)
    elif raw_picked is None:
        picked_map = {}
    else:
        picked_map = {"default": raw_picked}

    picked_map[str(year_index)] = bool(picked_value)
    normalized["option"]["picked"] = picked_map
    return normalized


def get_player_salary_for_year(player: Dict[str, Any], season_year: int) -> int:
    return get_contract_salary_for_year(player.get("contract"), season_year)


def get_team_players(team: Dict[str, Any]) -> List[Dict[str, Any]]:
    return team.get("players", [])


def get_dead_cap_map(league_data: Dict[str, Any]) -> Dict[str, Any]:
    raw = league_data.setdefault("deadCapByTeam", {})
    if not isinstance(raw, dict):
        league_data["deadCapByTeam"] = {}
    return league_data["deadCapByTeam"]


def get_team_dead_cap_rows(league_data: Dict[str, Any], team_name: str) -> List[Dict[str, Any]]:
    dead_cap_map = get_dead_cap_map(league_data)
    rows = dead_cap_map.setdefault(team_name, [])
    if not isinstance(rows, list):
        dead_cap_map[team_name] = []
        rows = dead_cap_map[team_name]
    return rows


def get_team_dead_cap_for_year(league_data: Dict[str, Any], team_name: str, season_year: int) -> int:
    total = 0
    for row in get_team_dead_cap_rows(league_data, team_name):
        if int(num(row.get("seasonYear"), -1)) == int(season_year):
            total += int(num(row.get("amount"), 0))
    return total


def add_dead_cap_from_player_contract(
    league_data: Dict[str, Any],
    team_name: str,
    player: Dict[str, Any],
    current_season_year: int,
    reason: str = "release"
) -> List[Dict[str, Any]]:
    contract = normalize_contract(player.get("contract"))
    if not contract:
        return []

    rows = get_team_dead_cap_rows(league_data, team_name)
    created = []

    for idx, amount in enumerate(contract["salaryByYear"]):
        season_year = contract["startYear"] + idx
        if season_year < current_season_year:
            continue
        if int(num(amount, 0)) <= 0:
            continue

        row = {
            "playerName": player.get("name"),
            "playerId": player.get("id"),
            "seasonYear": season_year,
            "amount": int(num(amount, 0)),
            "reason": reason,
        }
        rows.append(row)
        created.append(row)

    return created


def get_team_player_payroll(team: Dict[str, Any], season_year: int) -> int:
    payroll = 0
    for player in get_team_players(team):
        payroll += get_player_salary_for_year(player, season_year)
    return payroll


def get_team_payroll(
    team: Dict[str, Any],
    season_year: int,
    league_data: Optional[Dict[str, Any]] = None,
    team_name: Optional[str] = None
) -> int:
    payroll = get_team_player_payroll(team, season_year)
    if league_data is not None and team_name:
        payroll += get_team_dead_cap_for_year(league_data, team_name, season_year)
    return payroll


def get_team_cap_snapshot(league_data: Dict[str, Any], team_name: str) -> Dict[str, Any]:
    season_year = get_current_season_year(league_data)
    salary_cap = get_salary_cap(league_data)
    roster_limit = get_roster_limit(league_data)

    _, _, team = find_team_entry(league_data, team_name)
    if not team:
        return {
            "ok": False,
            "reason": f"Team '{team_name}' not found.",
        }

    player_payroll = get_team_player_payroll(team, season_year)
    dead_cap = get_team_dead_cap_for_year(league_data, team_name, season_year)
    payroll = player_payroll + dead_cap
    roster_count = len(get_team_players(team))

    return {
        "ok": True,
        "teamName": team_name,
        "seasonYear": season_year,
        "salaryCap": salary_cap,
        "playerPayroll": player_payroll,
        "deadCap": dead_cap,
        "payroll": payroll,
        "capRoom": salary_cap - payroll,
        "rosterCount": roster_count,
        "rosterLimit": roster_limit,
    }


def estimate_market_value(player: Dict[str, Any]) -> Dict[str, Any]:
    overall = num(player.get("overall"), 75)
    age = int(num(player.get("age"), 27))
    potential = num(player.get("potential"), overall)
    off_rating = num(player.get("offRating"), overall)
    def_rating = num(player.get("defRating"), overall)
    scoring_rating = num(player.get("scoringRating"), 50)

    base_salary = MIN_DEAL + (max(0, overall - 65) ** 1.65) * 180_000

    if age <= 23:
        base_salary *= 1.05 + max(0, potential - overall) * 0.01
    elif 24 <= age <= 29:
        base_salary *= 1.03
    elif age >= 32:
        base_salary *= max(0.72, 1.0 - (age - 31) * 0.045)

    if off_rating >= 85:
        base_salary *= 1.05
    if def_rating >= 85:
        base_salary *= 1.05
    if scoring_rating >= 80:
        base_salary *= 1.05

    year1_salary = int(
        round_to_nearest(
            clamp(base_salary, MIN_DEAL, MAX_SALARY),
            base = 1_000,
        )
    )

    if age >= 35:
        years = 1
    elif age >= 31:
        years = 2 if overall >= 78 else 1
    elif age <= 24 and potential - overall >= 4:
        years = 4
    elif overall >= 82:
        years = 4 if age <= 29 else 3
    elif overall >= 75:
        years = 3 if age <= 29 else 2
    else:
        years = 2 if age <= 30 else 1

    years = int(clamp(years, 1, 4))
    salary_by_year = build_salary_by_year(year1_salary, years)
    min_acceptable_aav = int(round_to_nearest(year1_salary * 0.85, base = 1_000))

    return {
        "expectedYears": years,
        "salaryByYear": salary_by_year,
        "expectedYear1Salary": salary_by_year[0],
        "expectedAAV": int(sum(salary_by_year) / len(salary_by_year)),
        "minAcceptableAAV": min_acceptable_aav,
    }


def add_market_values_to_free_agents(league_data: Dict[str, Any]) -> Dict[str, Any]:
    updated = copy.deepcopy(league_data)
    free_agents = updated.get("freeAgents", [])

    for player in free_agents:
        player["marketValue"] = estimate_market_value(player)

    return {
        "ok": True,
        "leagueData": updated,
        "freeAgentCount": len(free_agents),
    }


def build_contract_from_offer(league_data: Dict[str, Any], offer: Dict[str, Any]) -> Dict[str, Any]:
    season_year = get_current_season_year(league_data)
    salary_by_year = offer.get("salaryByYear", [])

    if not isinstance(salary_by_year, list) or not salary_by_year:
        raise ValueError("Offer must include salaryByYear as a non-empty list.")

    safe_salary_by_year = [int(round(num(x, 0))) for x in salary_by_year]

    return normalize_contract({
        "startYear": int(offer.get("startYear", season_year)),
        "salaryByYear": safe_salary_by_year,
        "option": offer.get("option"),
    })


def is_minimum_contract_for_current_year(
    league_data: Dict[str, Any],
    contract: Dict[str, Any]
) -> bool:
    season_year = get_current_season_year(league_data)
    offered_current_salary = get_contract_salary_for_year(contract, season_year)
    return int(offered_current_salary) <= int(MIN_DEAL)


# ------------------------------------------------------------
# TEAM DIRECTION / CPU BEHAVIOR HELPERS
# ------------------------------------------------------------
def classify_team_direction(team: Dict[str, Any]) -> Dict[str, Any]:
    players = list(team.get("players", []))
    if not players:
        return {
            "direction": "rebuilding",
            "coreOverall": 0.0,
            "coreAge": 0.0,
            "corePotentialGap": 0.0,
        }

    ranked = sorted(
        players,
        key = lambda p: num(p.get("overall"), 0),
        reverse = True,
    )
    core = ranked[:5] if len(ranked) >= 5 else ranked

    core_overall = sum(num(p.get("overall"), 0) for p in core) / max(1, len(core))
    core_age = sum(num(p.get("age"), 0) for p in core) / max(1, len(core))
    core_potential_gap = (
        sum(num(p.get("potential"), num(p.get("overall"), 0)) - num(p.get("overall"), 0) for p in core)
        / max(1, len(core))
    )

    if core_overall >= 82 and core_age >= 27:
        direction = "contending"
    elif core_overall <= 74 and core_age <= 25:
        direction = "rebuilding"
    elif core_potential_gap >= 3 and core_age <= 26:
        direction = "retooling"
    else:
        direction = "balanced"

    return {
        "direction": direction,
        "coreOverall": round(core_overall, 1),
        "coreAge": round(core_age, 1),
        "corePotentialGap": round(core_potential_gap, 1),
    }


def estimate_team_re_sign_interest(team: Dict[str, Any], player: Dict[str, Any]) -> Dict[str, Any]:
    direction_info = classify_team_direction(team)
    direction = direction_info["direction"]

    age = int(num(player.get("age"), 27))
    overall = num(player.get("overall"), 75)
    potential = num(player.get("potential"), overall)

    score = 0.50
    score += max(0.0, (overall - 75.0) * 0.012)
    score += max(0.0, (potential - overall) * 0.02)

    if direction == "contending":
        score += max(0.0, (overall - 78.0) * 0.01)
        if age >= 31 and overall >= 78:
            score += 0.08
    elif direction == "rebuilding":
        if age >= 30:
            score -= 0.12
        if age <= 25 and potential - overall >= 2:
            score += 0.10
    elif direction == "retooling":
        if age <= 28 and potential - overall >= 2:
            score += 0.08

    if age >= 34:
        score -= 0.08
    if age >= 37:
        score -= 0.12

    score = clamp(score, 0.0, 1.0)

    return {
        "teamDirection": direction,
        "reSignInterestScore": round(score, 3),
    }


def estimate_team_free_agent_fit(team: Dict[str, Any], player: Dict[str, Any]) -> Dict[str, Any]:
    direction_info = classify_team_direction(team)
    direction = direction_info["direction"]

    age = int(num(player.get("age"), 27))
    overall = num(player.get("overall"), 75)
    potential = num(player.get("potential"), overall)

    score = 0.45
    score += max(0.0, (overall - 72.0) * 0.015)

    if direction == "contending":
        if overall >= 78:
            score += 0.10
        if age >= 29:
            score += 0.06
        if age <= 24 and overall < 76:
            score -= 0.06
    elif direction == "rebuilding":
        if age <= 26:
            score += 0.12
        if potential - overall >= 2:
            score += 0.10
        if age >= 30:
            score -= 0.15
    elif direction == "retooling":
        if age <= 29:
            score += 0.05
        if potential - overall >= 2:
            score += 0.06
    else:
        if 24 <= age <= 30:
            score += 0.04

    score = clamp(score, 0.0, 1.0)

    return {
        "teamDirection": direction,
        "interestScore": round(score, 3),
    }


# ------------------------------------------------------------
# OFFSEASON CONTRACT DECISIONS
# ------------------------------------------------------------
def decide_player_option(player: Dict[str, Any], season_year: int) -> Dict[str, Any]:
    contract = normalize_contract(player.get("contract"))
    active_option = get_active_option_for_year(contract, season_year)
    market_value = player.get("marketValue") or estimate_market_value(player)

    if not active_option or active_option.get("type") != "player":
        return {
            "hasDecision": False,
            "exerciseOption": False,
            "score": 0.0,
            "reason": "No active player option.",
        }

    option_salary = int(active_option["salary"])
    expected_aav = int(market_value["expectedAAV"])
    expected_years = int(market_value["expectedYears"])

    age = int(num(player.get("age"), 27))
    overall = num(player.get("overall"), 75)
    potential = num(player.get("potential"), overall)

    score = 0.0
    score += option_salary / max(1.0, float(expected_aav))

    if age >= 32:
        score += 0.12
    if age >= 35:
        score += 0.18
    if potential - overall >= 3:
        score -= 0.10
    if age <= 26 and overall >= 78:
        score -= 0.08
    if expected_years >= 3:
        score -= 0.05

    exercise = score >= 1.0

    return {
        "hasDecision": True,
        "exerciseOption": exercise,
        "score": round(score, 3),
        "optionSalary": option_salary,
        "expectedAAV": expected_aav,
        "reason": "Player option accepted." if exercise else "Player option declined.",
    }


def decide_cpu_team_option(team: Dict[str, Any], player: Dict[str, Any], season_year: int) -> Dict[str, Any]:
    contract = normalize_contract(player.get("contract"))
    active_option = get_active_option_for_year(contract, season_year)
    market_value = player.get("marketValue") or estimate_market_value(player)

    if not active_option or active_option.get("type") != "team":
        return {
            "hasDecision": False,
            "exerciseOption": False,
            "score": 0.0,
            "reason": "No active team option.",
        }

    option_salary = int(active_option["salary"])
    expected_aav = int(market_value["expectedAAV"])

    age = int(num(player.get("age"), 27))
    overall = num(player.get("overall"), 75)
    potential = num(player.get("potential"), overall)

    direction_info = classify_team_direction(team)
    direction = direction_info["direction"]

    score = 0.0
    score += expected_aav / max(1.0, float(option_salary))
    score += max(0.0, (overall - 75.0) * 0.02)
    score += max(0.0, (potential - overall) * 0.03)

    if direction == "contending":
        if overall >= 76:
            score += 0.10
        if age >= 30 and overall >= 78:
            score += 0.06
    elif direction == "rebuilding":
        if age >= 29:
            score -= 0.18
        if potential - overall >= 3:
            score += 0.10
    elif direction == "retooling":
        if age <= 28:
            score += 0.05

    if age >= 34:
        score -= 0.10
    if age >= 37:
        score -= 0.15

    exercise = score >= 1.0

    return {
        "hasDecision": True,
        "exerciseOption": exercise,
        "score": round(score, 3),
        "optionSalary": option_salary,
        "expectedAAV": expected_aav,
        "teamDirection": direction,
        "reason": "CPU team exercised team option." if exercise else "CPU team declined team option.",
    }


def build_free_agent_record(
    player: Dict[str, Any],
    from_team_name: str,
    season_year: int,
    reason: str
) -> Dict[str, Any]:
    fa_player = copy.deepcopy(player)
    fa_player["previousContract"] = normalize_contract(player.get("contract"))
    fa_player["freeAgencyMeta"] = {
        "fromTeam": from_team_name,
        "seasonYear": season_year,
        "reason": reason,
    }
    fa_player["contract"] = None
    fa_player["marketValue"] = estimate_market_value(fa_player)
    return fa_player


def remove_existing_free_agent_match(
    free_agents: List[Dict[str, Any]],
    player_id: Optional[Any],
    player_name: Optional[str]
) -> None:
    keep = []
    for p in free_agents:
        same_id = player_id not in [None, ""] and p.get("id") == player_id
        same_name = player_name not in [None, ""] and p.get("name") == player_name
        if same_id or same_name:
            continue
        keep.append(p)
    free_agents[:] = keep


def add_player_to_free_agency(
    updated: Dict[str, Any],
    player: Dict[str, Any],
    from_team_name: str,
    season_year: int,
    reason: str
) -> Dict[str, Any]:
    free_agents = updated.setdefault("freeAgents", [])
    remove_existing_free_agent_match(
        free_agents = free_agents,
        player_id = player.get("id"),
        player_name = player.get("name"),
    )

    fa_player = build_free_agent_record(
        player = player,
        from_team_name = from_team_name,
        season_year = season_year,
        reason = reason,
    )
    free_agents.append(fa_player)
    return fa_player


def build_contract_status_row(
    team: Dict[str, Any],
    player: Dict[str, Any],
    season_year: int
) -> Dict[str, Any]:
    contract = normalize_contract(player.get("contract"))
    market_value = player.get("marketValue") or estimate_market_value(player)
    team_direction = classify_team_direction(team)
    re_sign_interest = estimate_team_re_sign_interest(team, player)

    upcoming_year = season_year + 1

    salary_this_year = get_contract_salary_for_year(contract, upcoming_year)
    salary_next_year = get_contract_salary_for_year(contract, upcoming_year + 1) if contract else 0
    active_option = get_active_option_for_year(contract, upcoming_year)
    contract_last_year = get_contract_last_year(contract)

    status = "signed"
    if not contract:
        status = "no_contract"
    elif salary_this_year <= 0:
        status = "expired"
    elif active_option:
        status = f"{active_option['type']}_option"

    row = {
        "playerId": player.get("id"),
        "playerName": player.get("name"),
        "teamName": team.get("name"),
        "age": int(num(player.get("age"), 0)),
        "overall": int(round(num(player.get("overall"), 0))),
        "potential": int(round(num(player.get("potential"), num(player.get("overall"), 0)))),
        "position": player.get("pos"),
        "status": status,
        "seasonYear": season_year,
        "salaryThisYear": int(salary_this_year),
        "salaryNextYear": int(salary_next_year),
        "contractLastYear": contract_last_year,
        "marketValue": market_value,
        "teamDirection": team_direction["direction"],
        "reSignInterestScore": re_sign_interest["reSignInterestScore"],
    }

    if active_option:
        row["option"] = active_option

        if active_option["type"] == "player":
            row["playerOptionDecision"] = decide_player_option(player, upcoming_year)
        elif active_option["type"] == "team":
            row["cpuTeamOptionDecision"] = decide_cpu_team_option(team, player, upcoming_year)

    return row


def preview_offseason_contracts(
    league_data: Dict[str, Any],
    user_team_name: Optional[str] = None
) -> Dict[str, Any]:
    season_year = get_current_season_year(league_data)

    expired_contracts = []
    player_options = []
    team_options = []
    signed_players = []

    for _, _, team in iter_teams(league_data):
        for player in team.get("players", []):
            row = build_contract_status_row(team, player, season_year)

            if row["status"] in ["expired", "no_contract"]:
                expired_contracts.append(row)
            elif row["status"] == "player_option":
                player_options.append(row)
            elif row["status"] == "team_option":
                team_options.append(row)
            else:
                signed_players.append(row)

    def sort_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        return sorted(
            rows,
            key = lambda r: (
                str(r.get("teamName", "")),
                -num(r.get("overall"), 0),
                str(r.get("playerName", "")),
            )
        )

    expired_contracts = sort_rows(expired_contracts)
    player_options = sort_rows(player_options)
    team_options = sort_rows(team_options)

    pending_user_team_options = []
    if user_team_name:
        pending_user_team_options = [
            row for row in team_options
            if row.get("teamName") == user_team_name
        ]

    projected_new_free_agents = len(expired_contracts)

    for row in player_options:
        decision = row.get("playerOptionDecision", {})
        if decision.get("hasDecision") and not decision.get("exerciseOption"):
            projected_new_free_agents += 1

    for row in team_options:
        if row.get("teamName") == user_team_name:
            projected_new_free_agents += 1
        else:
            cpu_decision = row.get("cpuTeamOptionDecision", {})
            if cpu_decision.get("hasDecision") and not cpu_decision.get("exerciseOption"):
                projected_new_free_agents += 1

    return {
        "ok": True,
        "seasonYear": season_year,
        "userTeamName": user_team_name,
        "summary": {
            "expiredContractCount": len(expired_contracts),
            "playerOptionCount": len(player_options),
            "teamOptionCount": len(team_options),
            "pendingUserTeamOptionCount": len(pending_user_team_options),
            "projectedNewFreeAgents": projected_new_free_agents,
            "currentFreeAgentCount": len(league_data.get("freeAgents", [])),
        },
        "expiredContracts": expired_contracts,
        "playerOptions": player_options,
        "teamOptions": team_options,
        "pendingUserTeamOptions": pending_user_team_options,
    }


def get_user_team_option_choice(
    decisions: Dict[str, Any],
    player: Dict[str, Any]
) -> Optional[bool]:
    player_id = player.get("id")
    player_name = player.get("name")

    if player_id not in [None, ""] and str(player_id) in decisions:
        return bool(decisions[str(player_id)])

    if player_name not in [None, ""] and str(player_name) in decisions:
        return bool(decisions[str(player_name)])

    return None


def apply_offseason_contract_decisions(
    league_data: Dict[str, Any],
    user_team_name: Optional[str] = None,
    team_option_decisions: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    season_year = get_current_season_year(league_data)
    preview = preview_offseason_contracts(
        league_data = league_data,
        user_team_name = user_team_name,
    )

    team_option_decisions = team_option_decisions or {}

    if user_team_name:
        missing = []
        for row in preview["pendingUserTeamOptions"]:
            player_id = row.get("playerId")
            player_name = row.get("playerName")

            has_id_choice = player_id not in [None, ""] and str(player_id) in team_option_decisions
            has_name_choice = player_name not in [None, ""] and str(player_name) in team_option_decisions

            if not has_id_choice and not has_name_choice:
                missing.append({
                    "playerId": player_id,
                    "playerName": player_name,
                    "teamName": row.get("teamName"),
                    "salaryThisYear": row.get("salaryThisYear"),
                    "option": row.get("option"),
                })

        if missing:
            return {
                "ok": False,
                "reason": "Pending user team option decisions are required before finalizing pre-free-agency.",
                "seasonYear": season_year,
                "pendingTeamOptions": missing,
                "preview": preview,
            }

    updated = copy.deepcopy(league_data)
    decision_log = []
    teams_affected = set()

    for _, _, team in iter_teams(updated):
        team_name = team.get("name", "Unknown Team")
        original_players = list(team.get("players", []))
        kept_players = []

        for player in original_players:
            contract = normalize_contract(player.get("contract"))
            upcoming_year = season_year + 1
            salary_this_year = get_contract_salary_for_year(contract, upcoming_year)
            active_option = get_active_option_for_year(contract, upcoming_year)

            if contract is None or salary_this_year <= 0:
                add_player_to_free_agency(
                    updated = updated,
                    player = player,
                    from_team_name = team_name,
                    season_year = season_year,
                    reason = "expired_contract" if contract else "no_contract",
                )
                decision_log.append({
                    "type": "expired_contract",
                    "playerName": player.get("name"),
                    "teamName": team_name,
                    "result": "entered_free_agency",
                })
                teams_affected.add(team_name)
                continue

            if active_option and active_option.get("type") == "player":
                decision = decide_player_option(player, upcoming_year)
                if decision["exerciseOption"]:
                    kept_player = copy.deepcopy(player)
                    kept_player["contract"] = set_option_pick_for_year(
                        contract = kept_player.get("contract"),
                        year_index = active_option["yearIndex"],
                        picked_value = True,
                    )
                    kept_players.append(kept_player)
                    decision_log.append({
                        "type": "player_option",
                        "playerName": player.get("name"),
                        "teamName": team_name,
                        "result": "accepted_option",
                        "score": decision["score"],
                    })
                else:
                    add_player_to_free_agency(
                        updated = updated,
                        player = player,
                        from_team_name = team_name,
                        season_year = season_year,
                        reason = "declined_player_option",
                    )
                    decision_log.append({
                        "type": "player_option",
                        "playerName": player.get("name"),
                        "teamName": team_name,
                        "result": "declined_option_entered_free_agency",
                        "score": decision["score"],
                    })
                    teams_affected.add(team_name)
                continue

            if active_option and active_option.get("type") == "team":
                if user_team_name and team_name == user_team_name:
                    exercise = get_user_team_option_choice(team_option_decisions, player)
                    if exercise is None:
                        return {
                            "ok": False,
                            "reason": f"Missing team option decision for {player.get('name')}.",
                        }
                    decision = {
                        "exerciseOption": exercise,
                        "score": None,
                    }
                else:
                    decision = decide_cpu_team_option(team, player, upcoming_year)
                    exercise = decision["exerciseOption"]

                if exercise:
                    kept_player = copy.deepcopy(player)
                    kept_player["contract"] = set_option_pick_for_year(
                        contract = kept_player.get("contract"),
                        year_index = active_option["yearIndex"],
                        picked_value = True,
                    )
                    kept_players.append(kept_player)
                    decision_log.append({
                        "type": "team_option",
                        "playerName": player.get("name"),
                        "teamName": team_name,
                        "result": "option_exercised",
                        "score": decision.get("score"),
                        "userControlled": bool(user_team_name and team_name == user_team_name),
                    })
                else:
                    add_player_to_free_agency(
                        updated = updated,
                        player = player,
                        from_team_name = team_name,
                        season_year = season_year,
                        reason = "declined_team_option",
                    )
                    decision_log.append({
                        "type": "team_option",
                        "playerName": player.get("name"),
                        "teamName": team_name,
                        "result": "option_declined_entered_free_agency",
                        "score": decision.get("score"),
                        "userControlled": bool(user_team_name and team_name == user_team_name),
                    })
                    teams_affected.add(team_name)
                continue

            kept_players.append(player)

        team["players"] = kept_players

    for player in updated.setdefault("freeAgents", []):
        player["marketValue"] = estimate_market_value(player)

    summary = {
        "seasonYear": season_year,
        "enteredFreeAgencyCount": len([
            x for x in decision_log
            if "entered_free_agency" in str(x.get("result", ""))
        ]),
        "playerOptionAcceptedCount": len([
            x for x in decision_log
            if x.get("type") == "player_option" and x.get("result") == "accepted_option"
        ]),
        "teamOptionExercisedCount": len([
            x for x in decision_log
            if x.get("type") == "team_option" and x.get("result") == "option_exercised"
        ]),
        "teamOptionDeclinedCount": len([
            x for x in decision_log
            if x.get("type") == "team_option" and x.get("result") == "option_declined_entered_free_agency"
        ]),
        "teamsAffected": sorted(teams_affected),
        "freeAgentCount": len(updated.get("freeAgents", [])),
    }

    return {
        "ok": True,
        "leagueData": updated,
        "summary": summary,
        "decisionLog": decision_log,
        "previewAfter": preview_offseason_contracts(
            league_data = updated,
            user_team_name = user_team_name,
        ),
    }


# ------------------------------------------------------------
# LIVE FREE AGENCY MARKET STATE
# ------------------------------------------------------------
def get_player_key(player_id: Optional[Any], player_name: Optional[str]) -> str:
    if player_id not in [None, ""]:
        return f"id:{player_id}"
    return f"name:{player_name or ''}"


def get_player_key_from_player(player: Dict[str, Any]) -> str:
    return get_player_key(player.get("id"), player.get("name"))


def ensure_free_agency_state(league_data: Dict[str, Any]) -> Dict[str, Any]:
    state = league_data.setdefault("freeAgencyState", {})
    if not isinstance(state, dict):
        league_data["freeAgencyState"] = {}
        state = league_data["freeAgencyState"]

    state.setdefault("isActive", False)
    state.setdefault("currentDay", 0)
    state.setdefault("maxDays", DEFAULT_FREE_AGENCY_DAYS)
    state.setdefault("offersByPlayer", {})
    state.setdefault("dailyLog", [])
    state.setdefault("signedPlayersLog", [])
    state.setdefault("offerHistory", [])
    return state


def get_active_offers_for_player(state: Dict[str, Any], player_key: str) -> List[Dict[str, Any]]:
    offers = state.setdefault("offersByPlayer", {}).setdefault(player_key, [])
    return [o for o in offers if o.get("status", "active") == "active"]


def get_active_offer_count_for_team(state: Dict[str, Any], team_name: str) -> int:
    count = 0
    for offers in state.get("offersByPlayer", {}).values():
        for offer in offers:
            if offer.get("status", "active") == "active" and offer.get("teamName") == team_name:
                count += 1
    return count


def get_projected_team_roster_count(
    league_data: Dict[str, Any],
    team_name: str,
    state: Optional[Dict[str, Any]] = None
) -> int:
    _, _, team = find_team_entry(league_data, team_name)
    if team is None:
        return 0

    projected_count = len(get_team_players(team))
    if state is not None:
        projected_count += get_active_offer_count_for_team(state, team_name)

    return projected_count


def get_team_roster_deficit(
    league_data: Dict[str, Any],
    team_name: str,
    state: Optional[Dict[str, Any]] = None
) -> int:
    min_roster_target = get_min_roster_target(league_data)
    projected_count = get_projected_team_roster_count(
        league_data = league_data,
        team_name = team_name,
        state = state,
    )
    return max(0, min_roster_target - projected_count)


def get_team_remaining_roster_slots(
    league_data: Dict[str, Any],
    team_name: str,
    state: Optional[Dict[str, Any]] = None
) -> int:
    max_roster_limit = get_roster_limit(league_data)
    projected_count = get_projected_team_roster_count(
        league_data = league_data,
        team_name = team_name,
        state = state,
    )
    return max(0, max_roster_limit - projected_count)


def get_active_offer_limit_for_team(
    league_data: Dict[str, Any],
    team_name: str,
    state: Dict[str, Any]
) -> int:
    _, _, team = find_team_entry(league_data, team_name)
    if team is None:
        return MAX_ACTIVE_OFFERS_PER_TEAM

    current_roster_count = len(get_team_players(team))
    remaining_slots_now = max(0, get_roster_limit(league_data) - current_roster_count)
    roster_deficit = get_team_roster_deficit(
        league_data = league_data,
        team_name = team_name,
        state = state,
    )

    desired_limit = max(MAX_ACTIVE_OFFERS_PER_TEAM, roster_deficit)

    if remaining_slots_now <= 0:
        return 0

    return min(remaining_slots_now, desired_limit)


def get_outstanding_offer_year1_total(
    state: Dict[str, Any],
    team_name: str,
    exclude_offer_id: Optional[str] = None
) -> int:
    total = 0
    for offers in state.get("offersByPlayer", {}).values():
        for offer in offers:
            if offer.get("status", "active") != "active":
                continue
            if offer.get("teamName") != team_name:
                continue
            if exclude_offer_id and offer.get("offerId") == exclude_offer_id:
                continue
            total += int(num(offer.get("currentYearSalary"), 0))
    return total


def find_existing_offer_for_team_player(
    state: Dict[str, Any],
    player_key: str,
    team_name: str
) -> Optional[Dict[str, Any]]:
    offers = state.setdefault("offersByPlayer", {}).setdefault(player_key, [])
    for offer in offers:
        if offer.get("status", "active") == "active" and offer.get("teamName") == team_name:
            return offer
    return None


def upsert_offer_record(
    league_data: Dict[str, Any],
    player_key: str,
    offer_record: Dict[str, Any]
) -> Dict[str, Any]:
    state = ensure_free_agency_state(league_data)
    offers_by_player = state.setdefault("offersByPlayer", {})
    offers = offers_by_player.setdefault(player_key, [])

    replaced = False
    for idx, existing in enumerate(offers):
        if (
            existing.get("status", "active") == "active"
            and existing.get("teamName") == offer_record.get("teamName")
        ):
            old = copy.deepcopy(existing)
            old["status"] = "replaced"
            state["offerHistory"].append(old)
            offers[idx] = offer_record
            replaced = True
            break

    if not replaced:
        offers.append(offer_record)

    return offer_record


def sort_offers_for_display(offers: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return sorted(
        offers,
        key = lambda o: (
            -num(o.get("playerViewScore"), 0),
            -num(o.get("totalValue"), 0),
            -num(o.get("aav"), 0),
            str(o.get("teamName", "")),
        )
    )


def build_offer_record(
    league_data: Dict[str, Any],
    team_name: str,
    player: Dict[str, Any],
    contract: Dict[str, Any],
    source: str,
    current_day: int
) -> Dict[str, Any]:
    salary_by_year = list(contract.get("salaryByYear", []))
    total_value = int(sum(salary_by_year))
    years = len(salary_by_year)
    aav = int(total_value / max(1, years))

    player_key = get_player_key_from_player(player)

    return {
        "offerId": f"{player_key}|{team_name}",
        "playerId": player.get("id"),
        "playerName": player.get("name"),
        "playerKey": player_key,
        "teamName": team_name,
        "source": source,
        "submittedDay": current_day,
        "status": "active",
        "contract": normalize_contract(contract),
        "salaryByYear": salary_by_year,
        "currentYearSalary": int(salary_by_year[0]) if salary_by_year else 0,
        "years": years,
        "totalValue": total_value,
        "aav": aav,
    }


def evaluate_market_offer_submission(
    league_data: Dict[str, Any],
    team_name: str,
    player: Dict[str, Any],
    contract: Dict[str, Any],
    exclude_offer_id: Optional[str] = None
) -> Dict[str, Any]:
    snapshot = get_team_cap_snapshot(league_data, team_name)
    if not snapshot.get("ok"):
        return snapshot

    _, _, team = find_team_entry(league_data, team_name)
    if team is None:
        return {
            "ok": False,
            "reason": f"Team '{team_name}' not found.",
        }

    state = ensure_free_agency_state(league_data)
    offered_current_salary = get_contract_salary_for_year(contract, get_current_season_year(league_data))
    outstanding_current_salary = get_outstanding_offer_year1_total(
        state = state,
        team_name = team_name,
        exclude_offer_id = exclude_offer_id,
    )

    active_offer_count = get_active_offer_count_for_team(state, team_name)
    existing_offer = exclude_offer_id is not None
    effective_offer_count = active_offer_count if existing_offer else active_offer_count + 1

    if len(get_team_players(team)) + effective_offer_count > get_roster_limit(league_data):
        return {
            "ok": False,
            "reason": f"{team_name} does not have enough roster flexibility for another live offer.",
            "teamSnapshot": snapshot,
        }

    allow_minimum_exception = is_minimum_contract_for_current_year(
        league_data = league_data,
        contract = contract,
    )

    if not allow_minimum_exception and snapshot["payroll"] + outstanding_current_salary + offered_current_salary > snapshot["salaryCap"]:
        over_by = snapshot["payroll"] + outstanding_current_salary + offered_current_salary - snapshot["salaryCap"]
        return {
            "ok": False,
            "reason": f"{team_name} does not have enough cap room for this live offer. Over by ${int(over_by):,}.",
            "teamSnapshot": snapshot,
        }

    market_value = player.get("marketValue") or estimate_market_value(player)
    offered_years = len(contract["salaryByYear"])
    offered_aav = int(sum(contract["salaryByYear"]) / max(1, offered_years))
    expected_years = int(market_value["expectedYears"])
    expected_aav = int(market_value["expectedAAV"])
    min_acceptable_aav = int(market_value["minAcceptableAAV"])

    salary_ratio = offered_aav / max(1, expected_aav)
    year_penalty = abs(offered_years - expected_years) * 0.06
    acceptance_score = salary_ratio - year_penalty

    return {
        "ok": True,
        "reason": "Offer can be submitted to the live market.",
        "teamSnapshot": snapshot,
        "contract": contract,
        "marketValue": market_value,
        "details": {
            "offeredYears": offered_years,
            "offeredAAV": offered_aav,
            "expectedYears": expected_years,
            "expectedAAV": expected_aav,
            "minAcceptableAAV": min_acceptable_aav,
            "acceptanceScore": round(acceptance_score, 3),
        },
    }


def score_offer_for_player(
    league_data: Dict[str, Any],
    player: Dict[str, Any],
    offer: Dict[str, Any]
) -> float:
    market_value = player.get("marketValue") or estimate_market_value(player)
    expected_aav = int(market_value["expectedAAV"])
    expected_years = int(market_value["expectedYears"])

    offered_aav = int(num(offer.get("aav"), 0))
    offered_years = int(num(offer.get("years"), 1))
    team_name = offer.get("teamName")

    _, _, team = find_team_entry(league_data, team_name)
    direction = classify_team_direction(team)["direction"] if team else "balanced"

    age = int(num(player.get("age"), 27))
    overall = num(player.get("overall"), 75)
    potential = num(player.get("potential"), overall)
    previous_team = (
        player.get("freeAgencyMeta", {}).get("fromTeam")
        if isinstance(player.get("freeAgencyMeta"), dict)
        else None
    )

    score = 0.0
    score += offered_aav / max(1.0, float(expected_aav))
    score -= abs(offered_years - expected_years) * 0.05

    if previous_team and previous_team == team_name:
        score += 0.05

    if age >= 30 and direction == "contending":
        score += 0.08
    if age >= 34 and direction == "contending":
        score += 0.04
    if age <= 25 and direction in ["rebuilding", "retooling"]:
        score += 0.07
    if potential - overall >= 2 and direction in ["rebuilding", "retooling"]:
        score += 0.05
    if age >= 34 and offered_years >= 3:
        score -= 0.06

    return round(score, 3)


def build_free_agency_state_summary(league_data: Dict[str, Any]) -> Dict[str, Any]:
    state = ensure_free_agency_state(league_data)
    active_offer_count = 0
    for offers in state.get("offersByPlayer", {}).values():
        for offer in offers:
            if offer.get("status", "active") == "active":
                active_offer_count += 1

    return {
        "isActive": bool(state.get("isActive")),
        "currentDay": int(num(state.get("currentDay"), 0)),
        "maxDays": int(num(state.get("maxDays"), DEFAULT_FREE_AGENCY_DAYS)),
        "freeAgentCount": len(league_data.get("freeAgents", [])),
        "activeOfferCount": active_offer_count,
        "signedCount": len(state.get("signedPlayersLog", [])),
    }


def build_cpu_offer_contract(
    league_data: Dict[str, Any],
    team: Dict[str, Any],
    player: Dict[str, Any],
    current_day: int,
    max_days: int,
    rng: random.Random
) -> Dict[str, Any]:
    market_value = player.get("marketValue") or estimate_market_value(player)
    direction = classify_team_direction(team)["direction"]

    age = int(num(player.get("age"), 27))
    overall = num(player.get("overall"), 75)
    potential = num(player.get("potential"), overall)

    expected_year1 = int(market_value["expectedYear1Salary"])
    expected_years = int(market_value["expectedYears"])

    roster_deficit = max(0, get_min_roster_target(league_data) - len(get_team_players(team)))

    multiplier = 0.90 + (0.10 * rng.random()) + (0.04 * (current_day / max(1, max_days)))

    if direction == "contending" and age >= 29:
        multiplier += 0.03
    if direction == "rebuilding" and age <= 25 and potential - overall >= 2:
        multiplier += 0.02
    if overall >= 85:
        multiplier += 0.04
    if roster_deficit > 0:
        multiplier += min(0.14, roster_deficit * 0.02)

    year1_salary = int(round_to_nearest(clamp(expected_year1 * multiplier, MIN_DEAL, MAX_SALARY), base = 1_000))
    years = expected_years

    if direction == "contending" and age >= 31:
        years = max(1, years - 1)
    elif direction in ["rebuilding", "retooling"] and age <= 25:
        years = min(4, years + 1)

    if roster_deficit > 0 and age <= 29:
        years = min(4, years + 1)

    years = int(clamp(years, 1, 4))

    return normalize_contract({
        "startYear": get_current_season_year(league_data),
        "salaryByYear": build_salary_by_year(year1_salary, years),
        "option": None,
    })


def generate_cpu_offers_for_day(
    league_data: Dict[str, Any],
    user_team_name: Optional[str] = None
) -> List[Dict[str, Any]]:
    state = ensure_free_agency_state(league_data)
    current_day = int(num(state.get("currentDay"), 1))
    max_days = int(num(state.get("maxDays"), DEFAULT_FREE_AGENCY_DAYS))
    season_year = get_current_season_year(league_data)
    min_roster_target = get_min_roster_target(league_data)

    generated = []
    free_agents = sorted(
        league_data.get("freeAgents", []),
        key = lambda p: num(p.get("overall"), 0),
        reverse = True,
    )

    for player in free_agents:
        player_key = get_player_key_from_player(player)
        active_offers = get_active_offers_for_player(state, player_key)
        existing_team_names = {offer.get("teamName") for offer in active_offers}

        overall = num(player.get("overall"), 0)
        desired_offer_count = 1
        if overall >= 86:
            desired_offer_count = 4
        elif overall >= 80:
            desired_offer_count = 3
        elif overall >= 74:
            desired_offer_count = 2

        target_new_offers = max(0, desired_offer_count - len(active_offers))
        if target_new_offers <= 0:
            continue

        candidates = []
        for _, _, team in iter_teams(league_data):
            team_name = team.get("name")
            if not team_name:
                continue
            if user_team_name and team_name == user_team_name:
                continue
            if team_name in existing_team_names:
                continue

            projected_roster_count = get_projected_team_roster_count(
                league_data = league_data,
                team_name = team_name,
                state = state,
            )
            remaining_roster_slots = get_team_remaining_roster_slots(
                league_data = league_data,
                team_name = team_name,
                state = state,
            )
            active_offer_limit = get_active_offer_limit_for_team(
                league_data = league_data,
                team_name = team_name,
                state = state,
            )

            if remaining_roster_slots <= 0:
                continue
            if get_active_offer_count_for_team(state, team_name) >= active_offer_limit:
                continue

            fit = estimate_team_free_agent_fit(team, player)
            min_fit_threshold = 0.34 if projected_roster_count < min_roster_target else 0.52
            if fit["interestScore"] < min_fit_threshold:
                continue

            seed = stable_text_seed(f"{season_year}|{current_day}|{team_name}|{player_key}")
            rng = random.Random(seed)
            contract = build_cpu_offer_contract(
                league_data = league_data,
                team = team,
                player = player,
                current_day = current_day,
                max_days = max_days,
                rng = rng,
            )

            existing_offer = find_existing_offer_for_team_player(state, player_key, team_name)
            exclude_offer_id = existing_offer.get("offerId") if existing_offer else None

            eval_res = evaluate_market_offer_submission(
                league_data = league_data,
                team_name = team_name,
                player = player,
                contract = contract,
                exclude_offer_id = exclude_offer_id,
            )
            if not eval_res.get("ok"):
                continue

            roster_deficit = max(0, min_roster_target - projected_roster_count)

            candidate_score = fit["interestScore"] + rng.random() * 0.08
            if roster_deficit > 0:
                candidate_score += min(0.40, roster_deficit * 0.07)
                candidate_score += min(0.08, remaining_roster_slots * 0.01)

            candidates.append((candidate_score, team_name, contract))

        candidates.sort(key = lambda x: x[0], reverse = True)

        for _, team_name, contract in candidates[:target_new_offers]:
            offer_record = build_offer_record(
                league_data = league_data,
                team_name = team_name,
                player = player,
                contract = contract,
                source = "cpu",
                current_day = current_day,
            )
            upsert_offer_record(
                league_data = league_data,
                player_key = player_key,
                offer_record = offer_record,
            )
            generated.append({
                "playerName": player.get("name"),
                "playerId": player.get("id"),
                "teamName": team_name,
                "contract": offer_record["contract"],
                "totalValue": offer_record["totalValue"],
                "aav": offer_record["aav"],
            })

    return generated


def get_free_agent_offers(
    league_data: Dict[str, Any],
    player_id: Optional[str] = None,
    player_name: Optional[str] = None
) -> Dict[str, Any]:
    state = ensure_free_agency_state(league_data)
    free_agents = league_data.get("freeAgents", [])

    idx = -1
    for i, player in enumerate(free_agents):
        if player_id and player.get("id") == player_id:
            idx = i
            break
        if player_name and player.get("name") == player_name:
            idx = i
            break

    if idx == -1:
        return {
            "ok": False,
            "reason": "Free agent not found.",
        }

    player = free_agents[idx]
    player_key = get_player_key_from_player(player)

    offers = []
    for offer in state.get("offersByPlayer", {}).get(player_key, []):
        enriched = copy.deepcopy(offer)
        enriched["playerViewScore"] = score_offer_for_player(league_data, player, offer)
        offers.append(enriched)

    offers = sort_offers_for_display(offers)

    best_offer_id = offers[0]["offerId"] if offers else None
    for offer in offers:
        offer["isBestOffer"] = offer.get("offerId") == best_offer_id

    return {
        "ok": True,
        "player": {
            "id": player.get("id"),
            "name": player.get("name"),
            "overall": player.get("overall"),
            "age": player.get("age"),
            "position": player.get("pos"),
            "marketValue": player.get("marketValue") or estimate_market_value(player),
        },
        "offers": offers,
        "stateSummary": build_free_agency_state_summary(league_data),
    }


def submit_user_free_agent_offer(
    league_data: Dict[str, Any],
    team_name: str,
    player_id: Optional[str] = None,
    player_name: Optional[str] = None,
    offer: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    updated = copy.deepcopy(league_data)
    state = ensure_free_agency_state(updated)

    if not state.get("isActive"):
        return {
            "ok": False,
            "reason": "Free agency period is not active.",
        }

    free_agents = updated.setdefault("freeAgents", [])
    player_idx = -1
    for idx, player in enumerate(free_agents):
        if player_id and player.get("id") == player_id:
            player_idx = idx
            break
        if player_name and player.get("name") == player_name:
            player_idx = idx
            break

    if player_idx == -1:
        return {
            "ok": False,
            "reason": "Free agent not found.",
        }

    player = free_agents[player_idx]
    contract = build_contract_from_offer(updated, offer or {})
    player_key = get_player_key_from_player(player)

    existing_offer = find_existing_offer_for_team_player(state, player_key, team_name)
    exclude_offer_id = existing_offer.get("offerId") if existing_offer else None

    eval_res = evaluate_market_offer_submission(
        league_data = updated,
        team_name = team_name,
        player = player,
        contract = contract,
        exclude_offer_id = exclude_offer_id,
    )
    if not eval_res.get("ok"):
        return eval_res

    current_day = int(num(state.get("currentDay"), 1))
    offer_record = build_offer_record(
        league_data = updated,
        team_name = team_name,
        player = player,
        contract = contract,
        source = "user",
        current_day = current_day,
    )
    upsert_offer_record(
        league_data = updated,
        player_key = player_key,
        offer_record = offer_record,
    )

    offers_res = get_free_agent_offers(
        league_data = updated,
        player_id = player.get("id"),
        player_name = player.get("name"),
    )

    return {
        "ok": True,
        "reason": "Offer submitted to free agency market.",
        "leagueData": updated,
        "submittedOffer": offer_record,
        "offersView": offers_res,
        "stateSummary": build_free_agency_state_summary(updated),
    }


def finalize_free_agent_signing_from_offer(
    league_data: Dict[str, Any],
    player: Dict[str, Any],
    chosen_offer: Dict[str, Any],
    current_day: int
) -> Optional[Dict[str, Any]]:
    player_key = get_player_key_from_player(player)
    state = ensure_free_agency_state(league_data)

    _, _, team = find_team_entry(league_data, chosen_offer.get("teamName"))
    if team is None:
        return None

    snapshot = get_team_cap_snapshot(league_data, chosen_offer.get("teamName"))
    contract = normalize_contract(chosen_offer.get("contract"))
    offered_current_salary = get_contract_salary_for_year(contract, get_current_season_year(league_data))
    allow_minimum_exception = is_minimum_contract_for_current_year(
        league_data = league_data,
        contract = contract,
    )

    if not allow_minimum_exception and snapshot["payroll"] + offered_current_salary > snapshot["salaryCap"]:
        return None
    if len(get_team_players(team)) >= get_roster_limit(league_data):
        return None

    free_agents = league_data.setdefault("freeAgents", [])
    player_idx = -1
    for idx, p in enumerate(free_agents):
        if player.get("id") not in [None, ""] and p.get("id") == player.get("id"):
            player_idx = idx
            break
        if p.get("name") == player.get("name"):
            player_idx = idx
            break

    if player_idx == -1:
        return None

    signed_player = copy.deepcopy(player)
    signed_player["contract"] = contract
    signed_player["marketValue"] = estimate_market_value(signed_player)

    free_agents.pop(player_idx)
    team.setdefault("players", []).append(signed_player)

    all_offers = []
    for offer in state.get("offersByPlayer", {}).get(player_key, []):
        logged = copy.deepcopy(offer)
        if logged.get("offerId") == chosen_offer.get("offerId"):
            logged["status"] = "accepted"
        else:
            logged["status"] = "lost"
        logged["playerViewScore"] = score_offer_for_player(league_data, player, offer)
        all_offers.append(logged)

    state["signedPlayersLog"].append({
        "day": current_day,
        "playerId": player.get("id"),
        "playerName": player.get("name"),
        "teamName": chosen_offer.get("teamName"),
        "contract": contract,
        "allOffers": sort_offers_for_display(all_offers),
    })

    if player_key in state.get("offersByPlayer", {}):
        del state["offersByPlayer"][player_key]

    return {
        "playerId": player.get("id"),
        "playerName": player.get("name"),
        "signedWith": chosen_offer.get("teamName"),
        "day": current_day,
        "contract": contract,
        "totalValue": chosen_offer.get("totalValue"),
        "aav": chosen_offer.get("aav"),
    }


def resolve_signings_for_day(league_data: Dict[str, Any], current_day: int) -> List[Dict[str, Any]]:
    state = ensure_free_agency_state(league_data)
    max_days = int(num(state.get("maxDays"), DEFAULT_FREE_AGENCY_DAYS))

    free_agents = sorted(
        league_data.get("freeAgents", []),
        key = lambda p: (
            -num(p.get("overall"), 0),
            -num((p.get("marketValue") or {}).get("expectedAAV"), 0),
        ),
    )

    signings = []

    for player in free_agents:
        player_key = get_player_key_from_player(player)
        offers = []
        for offer in state.get("offersByPlayer", {}).get(player_key, []):
            if offer.get("status", "active") != "active":
                continue
            enriched = copy.deepcopy(offer)
            enriched["playerViewScore"] = score_offer_for_player(league_data, player, offer)
            offers.append(enriched)

        if not offers:
            continue

        offers = sort_offers_for_display(offers)
        best_offer = offers[0]
        second_score = offers[1]["playerViewScore"] if len(offers) > 1 else None
        best_score = num(best_offer.get("playerViewScore"), 0)

        threshold = max(0.84, 1.03 - 0.03 * max(0, current_day - 1))
        margin_needed = 0.04 if current_day <= 2 else 0.02 if current_day <= 4 else 0.0

        should_sign = False
        if current_day >= max_days:
            should_sign = best_score >= 0.82
        elif best_score >= threshold:
            if second_score is None:
                should_sign = True
            elif best_score - num(second_score, 0) >= margin_needed:
                should_sign = True
            elif len(offers) >= 3 and best_score >= threshold + 0.02:
                should_sign = True

        if not should_sign:
            continue

        signed = finalize_free_agent_signing_from_offer(
            league_data = league_data,
            player = player,
            chosen_offer = best_offer,
            current_day = current_day,
        )
        if signed:
            signings.append(signed)

    return signings


def initialize_free_agency_period(
    league_data: Dict[str, Any],
    user_team_name: Optional[str] = None,
    max_days: int = DEFAULT_FREE_AGENCY_DAYS
) -> Dict[str, Any]:
    updated = copy.deepcopy(league_data)

    for player in updated.setdefault("freeAgents", []):
        player["marketValue"] = estimate_market_value(player)

    state = ensure_free_agency_state(updated)
    state["isActive"] = True
    state["currentDay"] = 1
    state["maxDays"] = int(clamp(max_days, 1, 30))
    state["offersByPlayer"] = {}
    state["dailyLog"] = []
    state["signedPlayersLog"] = []
    state["offerHistory"] = []

    opening_offers = generate_cpu_offers_for_day(
        league_data = updated,
        user_team_name = user_team_name,
    )

    state["dailyLog"].append({
        "day": 1,
        "type": "opening_market",
        "offersGenerated": len(opening_offers),
    })

    return {
        "ok": True,
        "leagueData": updated,
        "openingOffers": opening_offers,
        "stateSummary": build_free_agency_state_summary(updated),
    }


def advance_free_agency_day(
    league_data: Dict[str, Any],
    user_team_name: Optional[str] = None
) -> Dict[str, Any]:
    updated = copy.deepcopy(league_data)
    state = ensure_free_agency_state(updated)

    if not state.get("isActive"):
        return {
            "ok": False,
            "reason": "Free agency period is not active.",
            "stateSummary": build_free_agency_state_summary(updated),
        }

    current_day = int(num(state.get("currentDay"), 1))
    max_days = int(num(state.get("maxDays"), DEFAULT_FREE_AGENCY_DAYS))

    signings = resolve_signings_for_day(
        league_data = updated,
        current_day = current_day,
    )

    state["dailyLog"].append({
        "day": current_day,
        "type": "resolution",
        "signings": len(signings),
    })

    if current_day >= max_days or len(updated.get("freeAgents", [])) == 0:
        state["isActive"] = False
        return {
            "ok": True,
            "leagueData": updated,
            "dayResolved": current_day,
            "signings": signings,
            "generatedOffers": [],
            "stateSummary": build_free_agency_state_summary(updated),
        }

    state["currentDay"] = current_day + 1

    generated_offers = generate_cpu_offers_for_day(
        league_data = updated,
        user_team_name = user_team_name,
    )

    state["dailyLog"].append({
        "day": state["currentDay"],
        "type": "offer_generation",
        "offersGenerated": len(generated_offers),
    })

    if len(updated.get("freeAgents", [])) == 0:
        state["isActive"] = False

    return {
        "ok": True,
        "leagueData": updated,
        "dayResolved": current_day,
        "signings": signings,
        "generatedOffers": generated_offers,
        "stateSummary": build_free_agency_state_summary(updated),
    }


# ------------------------------------------------------------
# IMMEDIATE OFFER EVALUATION / SIGN / RELEASE
# ------------------------------------------------------------
def evaluate_offer(
    league_data: Dict[str, Any],
    team_name: str,
    player: Dict[str, Any],
    offer: Dict[str, Any],
) -> Dict[str, Any]:
    snapshot = get_team_cap_snapshot(league_data, team_name)
    if not snapshot.get("ok"):
        return snapshot

    _, _, team = find_team_entry(league_data, team_name)
    if team is None:
        return {
            "ok": False,
            "reason": f"Team '{team_name}' not found.",
        }

    roster_count = len(get_team_players(team))
    roster_limit = get_roster_limit(league_data)
    if roster_count >= roster_limit:
        return {
            "ok": False,
            "reason": f"{team_name} already has {roster_count} players.",
            "teamSnapshot": snapshot,
        }

    contract = build_contract_from_offer(league_data, offer)
    season_year = get_current_season_year(league_data)
    offered_current_salary = get_contract_salary_for_year(contract, season_year)
    allow_minimum_exception = is_minimum_contract_for_current_year(
        league_data = league_data,
        contract = contract,
    )

    if not allow_minimum_exception and snapshot["payroll"] + offered_current_salary > snapshot["salaryCap"]:
        over_by = snapshot["payroll"] + offered_current_salary - snapshot["salaryCap"]
        return {
            "ok": False,
            "reason": f"{team_name} is over the cap by ${int(over_by):,}.",
            "teamSnapshot": snapshot,
        }

    market_value = player.get("marketValue") or estimate_market_value(player)

    offered_years = len(contract["salaryByYear"])
    offered_aav = int(sum(contract["salaryByYear"]) / max(1, offered_years))
    expected_years = int(market_value["expectedYears"])
    expected_aav = int(market_value["expectedAAV"])
    min_acceptable_aav = int(market_value["minAcceptableAAV"])

    salary_ratio = offered_aav / max(1, expected_aav)
    year_penalty = abs(offered_years - expected_years) * 0.06
    acceptance_score = salary_ratio - year_penalty

    accepted = offered_aav >= min_acceptable_aav and acceptance_score >= 0.92

    return {
        "ok": True,
        "accepted": accepted,
        "reason": "Offer accepted." if accepted else "Offer rejected.",
        "teamSnapshot": snapshot,
        "contract": contract,
        "marketValue": market_value,
        "details": {
            "offeredYears": offered_years,
            "offeredAAV": offered_aav,
            "expectedYears": expected_years,
            "expectedAAV": expected_aav,
            "minAcceptableAAV": min_acceptable_aav,
            "acceptanceScore": round(acceptance_score, 3),
        },
    }


def find_free_agent_index(
    free_agents: List[Dict[str, Any]],
    player_id: Optional[str],
    player_name: Optional[str]
) -> int:
    for idx, player in enumerate(free_agents):
        if player_id and player.get("id") == player_id:
            return idx
        if player_name and player.get("name") == player_name:
            return idx
    return -1


def sign_free_agent(
    league_data: Dict[str, Any],
    team_name: str,
    player_id: Optional[str] = None,
    player_name: Optional[str] = None,
    offer: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    updated = copy.deepcopy(league_data)
    free_agents = updated.setdefault("freeAgents", [])

    player_idx = find_free_agent_index(free_agents, player_id, player_name)
    if player_idx == -1:
        return {
            "ok": False,
            "reason": "Free agent not found.",
        }

    player = free_agents[player_idx]
    offer = offer or {}

    evaluation = evaluate_offer(updated, team_name, player, offer)
    if not evaluation.get("ok"):
        return evaluation
    if not evaluation.get("accepted"):
        return evaluation

    _, _, team = find_team_entry(updated, team_name)
    if team is None:
        return {
            "ok": False,
            "reason": f"Team '{team_name}' not found.",
        }

    signed_player = copy.deepcopy(player)
    signed_player["contract"] = evaluation["contract"]
    signed_player["marketValue"] = estimate_market_value(signed_player)

    free_agents.pop(player_idx)
    team.setdefault("players", []).append(signed_player)

    return {
        "ok": True,
        "reason": f"{signed_player.get('name', 'Player')} signed with {team_name}.",
        "leagueData": updated,
        "signedPlayer": signed_player,
        "teamName": team_name,
        "teamSnapshot": get_team_cap_snapshot(updated, team_name),
    }


def release_player(
    league_data: Dict[str, Any],
    team_name: str,
    player_id: Optional[str] = None,
    player_name: Optional[str] = None,
) -> Dict[str, Any]:
    updated = copy.deepcopy(league_data)
    season_year = get_current_season_year(updated)
    _, _, team = find_team_entry(updated, team_name)

    if team is None:
        return {
            "ok": False,
            "reason": f"Team '{team_name}' not found.",
        }

    players = team.setdefault("players", [])
    release_idx = -1

    for idx, player in enumerate(players):
        if player_id and player.get("id") == player_id:
            release_idx = idx
            break
        if player_name and player.get("name") == player_name:
            release_idx = idx
            break

    if release_idx == -1:
        return {
            "ok": False,
            "reason": "Player not found on team roster.",
        }

    released_player = copy.deepcopy(players.pop(release_idx))
    dead_cap_rows = add_dead_cap_from_player_contract(
        league_data = updated,
        team_name = team_name,
        player = released_player,
        current_season_year = season_year,
        reason = "release_to_free_agency",
    )

    released_player["previousContract"] = normalize_contract(released_player.get("contract"))
    released_player["contract"] = None
    released_player["marketValue"] = estimate_market_value(released_player)
    released_player["freeAgencyMeta"] = {
        "fromTeam": team_name,
        "seasonYear": season_year,
        "reason": "released",
    }

    updated.setdefault("freeAgents", []).append(released_player)

    return {
        "ok": True,
        "reason": f"{released_player.get('name', 'Player')} released to free agency.",
        "leagueData": updated,
        "releasedPlayer": released_player,
        "deadCapRows": dead_cap_rows,
        "teamName": team_name,
        "teamSnapshot": get_team_cap_snapshot(updated, team_name),
    }


def handle_request(request: Dict[str, Any]) -> Dict[str, Any]:
    action = request.get("action")
    league_data = request.get("leagueData", {})
    payload = request.get("payload", {}) or {}

    if action == "get_team_cap_snapshot":
        return get_team_cap_snapshot(
            league_data,
            payload.get("teamName", ""),
        )

    if action == "estimate_market_for_player":
        player = payload.get("player", {})
        return {
            "ok": True,
            "marketValue": estimate_market_value(player),
        }

    if action == "generate_market_for_all_free_agents":
        return add_market_values_to_free_agents(league_data)

    if action == "preview_offseason_contracts":
        return preview_offseason_contracts(
            league_data = league_data,
            user_team_name = payload.get("userTeamName"),
        )

    if action == "apply_offseason_contract_decisions":
        return apply_offseason_contract_decisions(
            league_data = league_data,
            user_team_name = payload.get("userTeamName"),
            team_option_decisions = payload.get("teamOptionDecisions", {}) or {},
        )

    if action == "initialize_free_agency_period":
        return initialize_free_agency_period(
            league_data = league_data,
            user_team_name = payload.get("userTeamName"),
            max_days = int(num(payload.get("maxDays"), DEFAULT_FREE_AGENCY_DAYS)),
        )

    if action == "get_free_agency_state_summary":
        return {
            "ok": True,
            "stateSummary": build_free_agency_state_summary(league_data),
        }

    if action == "get_free_agent_offers":
        return get_free_agent_offers(
            league_data = league_data,
            player_id = payload.get("playerId"),
            player_name = payload.get("playerName"),
        )

    if action == "submit_user_free_agent_offer":
        return submit_user_free_agent_offer(
            league_data = league_data,
            team_name = payload.get("teamName", ""),
            player_id = payload.get("playerId"),
            player_name = payload.get("playerName"),
            offer = payload.get("offer", {}),
        )

    if action == "advance_free_agency_day":
        return advance_free_agency_day(
            league_data = league_data,
            user_team_name = payload.get("userTeamName"),
        )

    if action == "evaluate_offer":
        player = payload.get("player", {})
        return evaluate_offer(
            league_data = league_data,
            team_name = payload.get("teamName", ""),
            player = player,
            offer = payload.get("offer", {}),
        )

    if action == "sign_free_agent":
        return sign_free_agent(
            league_data = league_data,
            team_name = payload.get("teamName", ""),
            player_id = payload.get("playerId"),
            player_name = payload.get("playerName"),
            offer = payload.get("offer", {}),
        )

    if action == "release_player":
        return release_player(
            league_data = league_data,
            team_name = payload.get("teamName", ""),
            player_id = payload.get("playerId"),
            player_name = payload.get("playerName"),
        )

    return {
        "ok": False,
        "reason": f"Unknown action '{action}'.",
    }


def main():
    raw = sys.stdin.read().strip()
    if not raw:
        print(json.dumps({
            "ok": False,
            "reason": "No JSON request provided on stdin.",
        }))
        return

    try:
        request = json.loads(raw)
    except json.JSONDecodeError as exc:
        print(json.dumps({
            "ok": False,
            "reason": f"Invalid JSON: {exc}",
        }))
        return

    result = handle_request(request)
    print(json.dumps(result))


if __name__ == "__main__":
    main()