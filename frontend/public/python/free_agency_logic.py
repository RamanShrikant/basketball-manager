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
DEFAULT_ROOM_EXCEPTION = 8_000_000
DEFAULT_NON_TAXPAYER_MLE = 14_100_000
DEFAULT_TAXPAYER_MLE = 5_700_000
TAXPAYING_TEAM_BUFFER = 20_000_000


def get_room_exception_amount(league_data: Dict[str, Any]) -> int:
    return int(
        league_data.get("roomException")
        or league_data.get("roomExceptionAmount")
        or DEFAULT_ROOM_EXCEPTION
    )


def get_non_taxpayer_mle_amount(league_data: Dict[str, Any]) -> int:
    return int(
        league_data.get("midLevelException")
        or league_data.get("nonTaxpayerMLE")
        or league_data.get("nonTaxpayerMidLevelException")
        or DEFAULT_NON_TAXPAYER_MLE
    )


def get_taxpayer_mle_amount(league_data: Dict[str, Any]) -> int:
    return int(
        league_data.get("taxpayerMLE")
        or league_data.get("taxpayerMidLevelException")
        or DEFAULT_TAXPAYER_MLE
    )
OFFSEASON_MIN_ROSTER = REGULAR_SEASON_MIN_ROSTER

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

def get_operating_season_year(league_data: Dict[str, Any]) -> int:
    season_year = get_current_season_year(league_data)
    state = league_data.get("freeAgencyState", {})
    if isinstance(state, dict) and state.get("isActive"):
        return season_year + 1
    return season_year


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

def get_free_agency_min_roster_target(league_data: Dict[str, Any]) -> int:
    return int(
        league_data.get("freeAgencyMinRosterSize")
        or league_data.get("offseasonMinRosterSize")
        or league_data.get("minRosterSize")
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

    salary_by_year = contract["salaryByYear"]
    year_indices = get_option_year_indices(option)
    target_idx = season_year - contract["startYear"]

    # Normal case: the option year already exists as a real future salary slot
    if 0 <= target_idx < len(salary_by_year) and target_idx in year_indices:
        picked_value = get_option_pick_value(option, target_idx)
        if picked_value is not None:
            return None

        return {
            "type": option.get("type"),
            "yearIndex": target_idx,
            "salary": int(salary_by_year[target_idx]),
            "picked": picked_value,
            "bridgeOption": False,
            "targetSeasonYear": season_year,
        }

    # Bridge case: one stored salary year with option index [0]
    # Treat that as a pending option decision for the following offseason
    source_idx = target_idx - 1
    if (
        len(salary_by_year) == 1
        and source_idx == 0
        and source_idx in year_indices
    ):
        picked_value = get_option_pick_value(option, source_idx)
        if picked_value is not None:
            return None

        return {
            "type": option.get("type"),
            "yearIndex": source_idx,
            "salary": int(salary_by_year[source_idx]),
            "picked": picked_value,
            "bridgeOption": True,
            "targetSeasonYear": season_year,
        }

    return None
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

def apply_option_exercise_to_contract(
    contract: Dict[str, Any],
    active_option: Dict[str, Any]
) -> Dict[str, Any]:
    normalized = normalize_contract(contract)
    if not normalized or not active_option:
        return normalized

    if active_option.get("bridgeOption"):
        target_season_year = int(active_option.get("targetSeasonYear"))
        target_idx = target_season_year - normalized["startYear"]
        salary_by_year = list(normalized.get("salaryByYear", []))

        while len(salary_by_year) <= target_idx:
            salary_by_year.append(int(active_option.get("salary", 0)))

        salary_by_year[target_idx] = int(active_option.get("salary", 0))
        normalized["salaryByYear"] = salary_by_year

    normalized = set_option_pick_for_year(
        contract = normalized,
        year_index = int(active_option.get("yearIndex", 0)),
        picked_value = True,
    )
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
def _optional_int(value: Any) -> Optional[int]:
    try:
        if value in [None, "", False]:
            return None
        return int(round(float(value)))
    except (TypeError, ValueError):
        return None


def is_team_hard_capped(league_data: Dict[str, Any], team_name: str) -> bool:
    _, _, team = find_team_entry(league_data, team_name)
    team = team or {}

    if bool(team.get("isHardCapped")):
        return True
    if bool(team.get("hardCapped")):
        return True
    if bool(team.get("hardCapTriggered")):
        return True
    if bool(team.get("triggeredHardCap")):
        return True

    for key in ["hardCappedByTeam", "hardCapTriggeredByTeam"]:
        raw = league_data.get(key)
        if isinstance(raw, dict) and bool(raw.get(team_name)):
            return True

    raw_list = league_data.get("hardCappedTeams")
    if isinstance(raw_list, list) and team_name in raw_list:
        return True

    return False


def get_team_hard_cap(league_data: Dict[str, Any], team_name: str) -> Optional[int]:
    _, _, team = find_team_entry(league_data, team_name)
    team = team or {}

    team_keys = [
        "hardCap",
        "hardCapValue",
        "hardCapAmount",
        "hardCapLine",
        "hardCapLimit",
        "secondApron",
        "secondApronValue",
        "secondApronAmount",
        "secondApronLine",
        "apron2",
    ]

    for key in team_keys:
        value = _optional_int(team.get(key))
        if value is not None and value > 0:
            return value

    for map_key in [
        "hardCapByTeam",
        "teamHardCaps",
        "hardCapMap",
        "secondApronByTeam",
        "teamSecondAprons",
    ]:
        raw = league_data.get(map_key)
        if isinstance(raw, dict):
            value = _optional_int(raw.get(team_name))
            if value is not None and value > 0:
                return value

    league_keys = [
        "hardCap",
        "hardCapValue",
        "hardCapAmount",
        "hardCapLine",
        "hardCapLimit",
        "secondApron",
        "secondApronValue",
        "secondApronAmount",
        "secondApronLine",
        "apron2",
    ]

    for key in league_keys:
        value = _optional_int(league_data.get(key))
        if value is not None and value > 0:
            return value

    return None

def get_team_cap_snapshot(league_data: Dict[str, Any], team_name: str) -> Dict[str, Any]:
    season_year = get_operating_season_year(league_data)
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

    hard_cap = get_team_hard_cap(league_data, team_name)
    hard_cap_room = None
    if hard_cap is not None:
        hard_cap_room = int(hard_cap) - int(payroll)

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
        "hardCap": hard_cap,
        "hardCapRoom": hard_cap_room,
        "isHardCapped": is_team_hard_capped(league_data, team_name),
    }


def estimate_market_value(player: Dict[str, Any]) -> Dict[str, Any]:
    overall = num(player.get("overall"), 75)
    age = int(num(player.get("age"), 27))
    potential = num(player.get("potential"), overall)
    upside = max(0.0, potential - overall)

    off_rating = num(player.get("offRating"), overall)
    def_rating = num(player.get("defRating"), overall)
    scoring_rating = num(player.get("scoringRating"), 50)

    minimum_bucket = (
        overall <= 74
        or (overall <= 75 and (age >= 23 or upside <= 1))
        or (overall <= 76 and (age >= 25 or upside <= 2))
        or (overall <= 77 and (age >= 27 or upside <= 2))
        or (overall <= 78 and age >= 30 and upside <= 2)
    )

    if minimum_bucket:
        years = 1 if age >= 29 else 2
        salary_by_year = build_salary_by_year(MIN_DEAL, years)
        return {
            "expectedYears": years,
            "salaryByYear": salary_by_year,
            "expectedYear1Salary": salary_by_year[0],
            "expectedAAV": int(sum(salary_by_year) / len(salary_by_year)),
            "minAcceptableAAV": MIN_DEAL,
        }

    if overall <= 78:
        base_salary = 1_800_000 + max(0.0, overall - 75.0) * 900_000
    elif overall <= 81:
        base_salary = 5_500_000 + (overall - 79.0) * 1_750_000
    elif overall <= 84:
        base_salary = 10_500_000 + (overall - 82.0) * 2_500_000
    elif overall <= 87:
        base_salary = 18_000_000 + (overall - 85.0) * 3_300_000
    else:
        base_salary = 29_000_000 + (overall - 88.0) * 3_800_000

    if age <= 23:
        base_salary *= 1.02 + (upside * 0.012)
    elif 24 <= age <= 27:
        base_salary *= 1.00 + (upside * 0.006)
    elif 28 <= age <= 30:
        base_salary *= 1.00
    elif 31 <= age <= 33:
        base_salary *= max(0.82, 1.0 - ((age - 30) * 0.055))
    else:
        base_salary *= max(0.55, 0.82 - ((age - 33) * 0.09))

    if age >= 30 and overall <= 80:
        base_salary *= 0.88
    if age >= 33 and overall <= 78:
        base_salary *= 0.82
    if age >= 35 and overall <= 82:
        base_salary *= 0.90

    if off_rating >= 90:
        base_salary *= 1.02
    if def_rating >= 90:
        base_salary *= 1.02
    if scoring_rating >= 88:
        base_salary *= 1.02

    year1_salary = int(
        round_to_nearest(
            clamp(base_salary, MIN_DEAL, MAX_SALARY),
            base = 1_000,
        )
    )

    if age >= 35:
        years = 1
    elif overall <= 78:
        years = 2 if age <= 26 and upside >= 3 else 1
    elif overall <= 81:
        years = 2 if age <= 29 else 1
    elif overall <= 84:
        years = 3 if age <= 28 else 2
    elif overall <= 87:
        years = 4 if age <= 30 else 2
    else:
        years = 4 if age <= 31 else 3

    if age <= 24 and upside >= 3 and overall >= 79:
        years = min(4, years + 1)

    years = int(clamp(years, 1, 4))
    salary_by_year = build_salary_by_year(year1_salary, years)

    if overall <= 78:
        min_accept_mult = 0.68
    elif overall <= 81:
        min_accept_mult = 0.76
    elif overall <= 84:
        min_accept_mult = 0.84
    elif overall <= 87:
        min_accept_mult = 0.92
    else:
        min_accept_mult = 0.96

    if age >= 30 and overall <= 80:
        min_accept_mult -= 0.04
    if age >= 33 and overall <= 78:
        min_accept_mult -= 0.04

    min_accept_mult = clamp(min_accept_mult, 0.62, 0.98)

    min_acceptable_aav = int(
        round_to_nearest(
            max(MIN_DEAL, year1_salary * min_accept_mult),
            base = 1_000,
        )
    )

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
def refresh_free_agent_market_values(league_data: Dict[str, Any]) -> None:
    for player in league_data.get("freeAgents", []):
        player["marketValue"] = estimate_market_value(player)


def build_contract_from_offer(league_data: Dict[str, Any], offer: Dict[str, Any]) -> Dict[str, Any]:
    season_year = get_operating_season_year(league_data)
    salary_by_year = offer.get("salaryByYear", [])

    if not isinstance(salary_by_year, list) or not salary_by_year:
        raise ValueError("Offer must include salaryByYear as a non-empty list.")

    safe_salary_by_year = [int(round(num(x, 0))) for x in salary_by_year]
    state = ensure_free_agency_state(league_data)

    start_year = season_year
    if not state.get("isActive"):
        start_year = int(offer.get("startYear", season_year))

    return normalize_contract({
        "startYear": start_year,
        "salaryByYear": safe_salary_by_year,
        "option": offer.get("option"),
    })
def apply_free_agency_start_year(
    league_data: Dict[str, Any],
    contract: Optional[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    normalized = normalize_contract(contract)
    if not normalized:
        return normalized

    state = ensure_free_agency_state(league_data)
    if state.get("isActive"):
        normalized["startYear"] = get_current_season_year(league_data) + 1

    return normalized

def is_minimum_contract_for_current_year(
    league_data: Dict[str, Any],
    contract: Dict[str, Any]
) -> bool:
    season_year = get_operating_season_year(league_data)
    offered_current_salary = get_contract_salary_for_year(contract, season_year)
    return int(offered_current_salary) <= int(MIN_DEAL)

def is_emergency_fill_candidate(player: Dict[str, Any]) -> bool:
    overall = int(round(num(player.get("overall"), 0)))
    age = int(num(player.get("age"), 27))
    potential = int(round(num(player.get("potential"), overall)))

    return (
        overall <= 74
        or (overall <= 75 and (age >= 23 or potential <= overall + 1))
        or (overall <= 76 and (age >= 25 or potential <= overall + 2))
        or (overall <= 77 and (age >= 27 or potential <= overall + 2))
        or (overall <= 78 and age >= 30 and potential <= overall + 2)
    )
def finalize_cpu_min_roster_cleanup(
    league_data: Dict[str, Any],
    current_day: int,
    user_team_name: Optional[str] = None,
    min_roster_target_override: Optional[int] = None,
) -> List[Dict[str, Any]]:
    cleanup_signings = []
    min_roster_target = (
        int(min_roster_target_override)
        if min_roster_target_override is not None
        else get_min_roster_target(league_data)
    )
    season_year = get_operating_season_year(league_data)
    state = ensure_free_agency_state(league_data)

    def _record_cleanup_signing(
        signed_player: Dict[str, Any],
        team_name: str,
        source: str,
    ) -> Dict[str, Any]:
        player_key = get_player_key_from_player(signed_player)
        if player_key in state.get("offersByPlayer", {}):
            del state["offersByPlayer"][player_key]

        state["signedPlayersLog"].append({
            "day": current_day,
            "playerId": signed_player.get("id"),
            "playerName": signed_player.get("name"),
            "teamName": team_name,
            "contract": signed_player.get("contract"),
            "allOffers": [],
            "source": source,
        })

        signing_row = {
            "playerId": signed_player.get("id"),
            "playerName": signed_player.get("name"),
            "signedWith": team_name,
            "day": current_day,
            "contract": signed_player.get("contract"),
            "totalValue": int(sum(signed_player["contract"]["salaryByYear"])),
            "aav": int(sum(signed_player["contract"]["salaryByYear"]) / len(signed_player["contract"]["salaryByYear"])),
            "cleanupSigning": True,
            "emergencySigning": True,
        }
        cleanup_signings.append(signing_row)
        return signing_row

    while True:
        made_move = False
        teams_below_min = []

        for _, _, team in iter_teams(league_data):
            team_name = team.get("name")
            if not team_name:
                continue
            if user_team_name and team_name == user_team_name:
                continue

            deficit = max(0, min_roster_target - len(get_team_players(team)))
            if deficit > 0:
                teams_below_min.append((deficit, team_name))

        if not teams_below_min:
            break

        teams_below_min.sort(key = lambda x: (-x[0], x[1]))

        for _, team_name in teams_below_min:
            while True:
                _, _, live_team = find_team_entry(league_data, team_name)
                if live_team is None:
                    break
                if len(get_team_players(live_team)) >= min_roster_target:
                    break
                if len(get_team_players(live_team)) >= get_roster_limit(league_data):
                    break

                snapshot = get_team_cap_snapshot(league_data, team_name)
                if not snapshot.get("ok"):
                    break

                hard_cap = snapshot.get("hardCap")
                is_hard_capped = bool(snapshot.get("isHardCapped"))
                projected_payroll = int(num(snapshot.get("payroll"), 0)) + MIN_DEAL
                if is_hard_capped and hard_cap is not None and projected_payroll > int(num(hard_cap, 0)):
                    break

                emergency_rows = []
                for fa in league_data.get("freeAgents", []):
                    if not is_emergency_fill_candidate(fa):
                        continue

                    emergency_rows.append((
                        -int(round(num(fa.get("overall"), 0))),
                        int(num(fa.get("age"), 27)),
                        str(fa.get("name", "")),
                        fa,
                    ))

                if not emergency_rows:
                    break

                emergency_rows.sort(key = lambda x: (x[0], x[1], x[2]))

                signed_this_round = None

                for _, _, _, fa in emergency_rows:
                    player_idx = find_free_agent_index(
                        league_data.get("freeAgents", []),
                        fa.get("id"),
                        fa.get("name"),
                    )
                    if player_idx == -1:
                        continue

                    signed_player = copy.deepcopy(league_data["freeAgents"][player_idx])
                    signed_player["contract"] = normalize_contract({
                        "startYear": season_year,
                        "salaryByYear": [MIN_DEAL],
                        "option": None,
                    })
                    signed_player["marketValue"] = estimate_market_value(signed_player)

                    league_data["freeAgents"].pop(player_idx)
                    live_team.setdefault("players", []).append(signed_player)

                    signed_this_round = _record_cleanup_signing(
                        signed_player = signed_player,
                        team_name = team_name,
                        source = "cpu_emergency_min_roster_cleanup",
                    )
                    made_move = True
                    break

                if not signed_this_round:
                    break

        if not made_move:
            break

    return cleanup_signings

# ------------------------------------------------------------
# TEAM DIRECTION / CPU BEHAVIOR HELPERS
# ------------------------------------------------------------
def get_player_position_bucket(player: Dict[str, Any]) -> str:
    raw = str(player.get("pos") or player.get("position") or "").upper().replace("-", "/")
    if "PG" in raw:
        return "PG"
    if "SG" in raw:
        return "SG"
    if "SF" in raw:
        return "SF"
    if "PF" in raw:
        return "PF"
    if "C" in raw:
        return "C"
    return "UTIL"


def build_team_roster_profile(team: Dict[str, Any]) -> Dict[str, Any]:
    players = list(team.get("players", []))
    ranked = sorted(
        players,
        key = lambda p: num(p.get("overall"), 0),
        reverse = True,
    )

    if not ranked:
        return {
            "direction": "rebuilding",
            "coreOverall": 0.0,
            "coreAge": 0.0,
            "corePotentialGap": 0.0,
            "starCount": 0,
            "starterQualityCount": 0,
            "rotationQualityCount": 0,
            "youngCoreCount": 0,
            "oldCoreCount": 0,
            "top3Overall": 0.0,
            "top8Overall": 0.0,
            "positionCounts": {"PG": 0, "SG": 0, "SF": 0, "PF": 0, "C": 0, "UTIL": 0},
            "qualityCounts": {"PG": 0, "SG": 0, "SF": 0, "PF": 0, "C": 0, "UTIL": 0},
            "needs": {"PG": 1.0, "SG": 1.0, "SF": 1.0, "PF": 1.0, "C": 1.0, "UTIL": 0.5},
            "weakestPositions": ["PG", "SG", "SF"],
        }

    core = ranked[:8] if len(ranked) >= 8 else ranked
    top3 = ranked[:3] if len(ranked) >= 3 else ranked
    top8 = ranked[:8] if len(ranked) >= 8 else ranked

    core_overall = sum(num(p.get("overall"), 0) for p in core) / max(1, len(core))
    core_age = sum(num(p.get("age"), 0) for p in core) / max(1, len(core))
    core_potential_gap = (
        sum(num(p.get("potential"), num(p.get("overall"), 0)) - num(p.get("overall"), 0) for p in core)
        / max(1, len(core))
    )
    top3_overall = sum(num(p.get("overall"), 0) for p in top3) / max(1, len(top3))
    top8_overall = sum(num(p.get("overall"), 0) for p in top8) / max(1, len(top8))

    star_count = sum(1 for p in ranked if num(p.get("overall"), 0) >= 85)
    starter_quality_count = sum(1 for p in ranked if num(p.get("overall"), 0) >= 80)
    rotation_quality_count = sum(1 for p in ranked if num(p.get("overall"), 0) >= 76)
    young_core_count = sum(
        1 for p in ranked
        if num(p.get("overall"), 0) >= 77 and int(num(p.get("age"), 27)) <= 26
    )
    old_core_count = sum(
        1 for p in ranked
        if num(p.get("overall"), 0) >= 78 and int(num(p.get("age"), 27)) >= 31
    )

    position_counts = {"PG": 0, "SG": 0, "SF": 0, "PF": 0, "C": 0, "UTIL": 0}
    quality_counts = {"PG": 0, "SG": 0, "SF": 0, "PF": 0, "C": 0, "UTIL": 0}

    for player in ranked:
        bucket = get_player_position_bucket(player)
        position_counts[bucket] = position_counts.get(bucket, 0) + 1
        if num(player.get("overall"), 0) >= 76:
            quality_counts[bucket] = quality_counts.get(bucket, 0) + 1

    if top3_overall >= 83.0 and top8_overall >= 78.5 and core_age >= 26:
        direction = "contending"
    elif young_core_count >= 4 and core_potential_gap >= 2.5 and core_age <= 26.5:
        direction = "rebuilding"
    elif core_potential_gap >= 2.0 and core_age <= 28.5:
        direction = "retooling"
    else:
        direction = "balanced"

    target_counts = {"PG": 2, "SG": 2, "SF": 2, "PF": 2, "C": 2}
    needs = {}

    for bucket, target_count in target_counts.items():
        total_gap = max(0, target_count - position_counts.get(bucket, 0))
        quality_gap = max(0, target_count - quality_counts.get(bucket, 0))
        need_score = 0.18 + (total_gap * 0.24) + (quality_gap * 0.18)

        if bucket == "C" and quality_counts.get("C", 0) == 0:
            need_score += 0.18
        if bucket in ["SF", "PF"] and quality_counts.get(bucket, 0) == 0:
            need_score += 0.12

        needs[bucket] = round(clamp(need_score, 0.0, 1.0), 3)

    needs["UTIL"] = round(
        clamp(0.12 + max(0, 8 - rotation_quality_count) * 0.06, 0.0, 1.0),
        3,
    )

    weakest_positions = sorted(
        ["PG", "SG", "SF", "PF", "C"],
        key = lambda bucket: (-needs[bucket], quality_counts.get(bucket, 0), position_counts.get(bucket, 0), bucket),
    )

    return {
        "direction": direction,
        "coreOverall": round(core_overall, 1),
        "coreAge": round(core_age, 1),
        "corePotentialGap": round(core_potential_gap, 1),
        "starCount": star_count,
        "starterQualityCount": starter_quality_count,
        "rotationQualityCount": rotation_quality_count,
        "youngCoreCount": young_core_count,
        "oldCoreCount": old_core_count,
        "top3Overall": round(top3_overall, 1),
        "top8Overall": round(top8_overall, 1),
        "positionCounts": position_counts,
        "qualityCounts": quality_counts,
        "needs": needs,
        "weakestPositions": weakest_positions,
    }


def get_player_role_rank_on_team(team: Dict[str, Any], player: Dict[str, Any]) -> int:
    players = list(team.get("players", []))
    ranked = sorted(
        players,
        key = lambda p: (
            -num(p.get("overall"), 0),
            -num(p.get("potential"), num(p.get("overall"), 0)),
            int(num(p.get("age"), 27)),
        ),
    )

    player_id = player.get("id")
    player_name = player.get("name")

    for idx, roster_player in enumerate(ranked, start = 1):
        if player_id not in [None, ""] and roster_player.get("id") == player_id:
            return idx
        if player_name not in [None, ""] and roster_player.get("name") == player_name:
            return idx

    return len(ranked) + 1


def get_player_need_score_for_team(team: Dict[str, Any], player: Dict[str, Any]) -> float:
    profile = build_team_roster_profile(team)
    bucket = get_player_position_bucket(player)
    return float(profile["needs"].get(bucket, profile["needs"].get("UTIL", 0.15)))


def get_team_exception_room(
    league_data: Dict[str, Any],
    team_name: str,
    player: Optional[Dict[str, Any]] = None
) -> int:
    snapshot = get_team_cap_snapshot(league_data, team_name)
    if not snapshot.get("ok"):
        return 0

    cap_room = max(0, int(num(snapshot.get("capRoom"), 0)))
    payroll = int(num(snapshot.get("payroll"), 0))
    salary_cap = int(num(snapshot.get("salaryCap"), get_salary_cap(league_data)))

    room_exception = get_room_exception_amount(league_data)
    non_taxpayer_mle = get_non_taxpayer_mle_amount(league_data)
    taxpayer_mle = get_taxpayer_mle_amount(league_data)

    if cap_room > 0:
        # Cap-space teams can always use actual room.
        # If they only have a little room left, give them a room-exception lane too.
        usable_room = cap_room
        if cap_room <= room_exception:
            usable_room = max(usable_room, room_exception)
    else:
        # Over-the-cap teams get an exception lane instead of being fully dead.
        if payroll >= salary_cap + TAXPAYING_TEAM_BUFFER:
            usable_room = taxpayer_mle
        else:
            usable_room = non_taxpayer_mle

    hard_cap_room = snapshot.get("hardCapRoom")
    if hard_cap_room is not None:
        usable_room = min(usable_room, max(0, int(num(hard_cap_room, 0))))

    return max(0, int(usable_room))


def classify_team_direction(team: Dict[str, Any]) -> Dict[str, Any]:
    return build_team_roster_profile(team)


def estimate_team_re_sign_interest(team: Dict[str, Any], player: Dict[str, Any]) -> Dict[str, Any]:
    profile = build_team_roster_profile(team)
    direction = profile["direction"]

    age = int(num(player.get("age"), 27))
    overall = num(player.get("overall"), 75)
    potential = num(player.get("potential"), overall)
    upside = max(0.0, potential - overall)
    role_rank = get_player_role_rank_on_team(team, player)
    need_score = get_player_need_score_for_team(team, player)

    score = 0.42
    score += max(0.0, (overall - 74.0) * 0.018)
    score += max(0.0, upside * 0.028)
    score += need_score * 0.12

    if role_rank <= 3:
        score += 0.24
    elif role_rank <= 5:
        score += 0.14
    elif role_rank <= 8:
        score += 0.06

    if direction == "contending":
        if overall >= 79:
            score += 0.12
        if role_rank <= 5 and overall >= 77:
            score += 0.10
        if age >= 29 and overall >= 79:
            score += 0.08
        if age <= 25 and overall <= 75:
            score -= 0.05

    elif direction == "rebuilding":
        if age <= 26:
            score += 0.12
        if upside >= 3:
            score += 0.10
        if age >= 31 and overall <= 80 and role_rank > 4:
            score -= 0.18
        if age >= 29 and upside <= 1 and overall <= 78:
            score -= 0.10

    elif direction == "retooling":
        if age <= 28:
            score += 0.08
        if upside >= 2:
            score += 0.07
        if 27 <= age <= 31 and overall >= 79:
            score += 0.05

    else:
        if 24 <= age <= 31:
            score += 0.05
        if overall >= 79:
            score += 0.05

    if age >= 34 and overall <= 80:
        score -= 0.10
    if age >= 36 and overall <= 82:
        score -= 0.12

    score = clamp(score, 0.0, 1.0)

    return {
        "teamDirection": direction,
        "reSignInterestScore": round(score, 3),
        "roleRank": role_rank,
        "needScore": round(need_score, 3),
    }


def estimate_team_free_agent_fit(team: Dict[str, Any], player: Dict[str, Any]) -> Dict[str, Any]:
    profile = build_team_roster_profile(team)
    direction = profile["direction"]

    age = int(num(player.get("age"), 27))
    overall = num(player.get("overall"), 75)
    potential = num(player.get("potential"), overall)
    upside = max(0.0, potential - overall)
    need_score = get_player_need_score_for_team(team, player)

    score = 0.22
    score += max(0.0, (overall - 72.0) * 0.020)
    score += max(0.0, (overall - 81.0) * 0.015)
    score += need_score * 0.28
    score += min(0.18, max(0.0, overall - 84.0) * 0.020)

    if direction == "contending":
        if overall >= 79:
            score += 0.10
        score += max(0.0, min(0.10, (age - 27) * 0.010))
        if age <= 24 and overall < 78:
            score -= 0.05

    elif direction == "rebuilding":
        if age <= 26:
            score += 0.10
        if upside >= 2:
            score += 0.08
        if upside >= 4:
            score += 0.04

        # Older players are discounted, but talent can overpower that discount.
        age_penalty = max(0.0, (age - 29) * 0.020)
        talent_relief = max(0.0, (overall - 80) * 0.017)
        score -= max(0.0, age_penalty - talent_relief)

    elif direction == "retooling":
        if age <= 29:
            score += 0.07
        if upside >= 2:
            score += 0.06
        if overall >= 79:
            score += 0.05
        if 27 <= age <= 31 and overall >= 80:
            score += 0.04

    else:
        if 24 <= age <= 31:
            score += 0.05
        if overall >= 79:
            score += 0.05
        if upside >= 2:
            score += 0.03

    if overall >= 85:
        score += 0.10
    elif overall >= 82:
        score += 0.05

    if age >= 34 and overall <= 79:
        score -= 0.06
    if age >= 36 and overall <= 81:
        score -= 0.08

    bucket = get_player_position_bucket(player)
    if bucket in profile["weakestPositions"][:2]:
        score += 0.08

    score = clamp(score, 0.0, 1.20)

    return {
        "teamDirection": direction,
        "interestScore": round(score, 3),
        "needScore": round(need_score, 3),
        "positionBucket": bucket,
        "weakestPositions": profile["weakestPositions"],
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
    upside = max(0.0, potential - overall)

    direction_info = classify_team_direction(team)
    direction = direction_info["direction"]

    value_ratio = expected_aav / max(1.0, float(option_salary))
    score = value_ratio
    score += max(0.0, (overall - 74.0) * 0.025)
    score += max(0.0, upside * 0.04)

    if overall >= 78:
        score += 0.30
    elif overall >= 75:
        score += 0.16
    elif overall >= 72:
        score += 0.06

    if age <= 25 and overall >= 72:
        score += 0.22
    if age <= 27 and upside >= 2:
        score += 0.18
    if age <= 24 and upside >= 3:
        score += 0.14

    if direction == "contending":
        if overall >= 76:
            score += 0.16
        if age >= 29 and overall >= 78:
            score += 0.08
    elif direction == "rebuilding":
        if age <= 27:
            score += 0.14
        if upside >= 3:
            score += 0.14
        if age >= 31 and overall <= 78 and upside <= 1:
            score -= 0.20
    elif direction == "retooling":
        if age <= 29:
            score += 0.08
        if upside >= 2:
            score += 0.08
    else:
        if 24 <= age <= 31:
            score += 0.05
        if overall >= 77:
            score += 0.05

    if option_salary <= int(round(expected_aav * 0.90)):
        score += 0.12
    elif option_salary <= int(round(expected_aav * 1.00)):
        score += 0.06
    elif option_salary >= int(round(expected_aav * 1.20)):
        score -= 0.14

    if age >= 34 and overall <= 79:
        score -= 0.12
    if age >= 36 and overall <= 81:
        score -= 0.16

    exercise = False

    if overall >= 78:
        exercise = True
    elif age <= 25 and overall >= 72:
        exercise = True
    elif age <= 27 and upside >= 3 and overall >= 71:
        exercise = True
    elif option_salary <= int(round(expected_aav * 1.08)) and overall >= 75:
        exercise = True
    elif option_salary <= int(round(expected_aav * 0.95)) and overall >= 72:
        exercise = True
    else:
        threshold = 1.02
        if age >= 32 and overall <= 77 and upside <= 1:
            threshold = 1.08
        if age >= 35 and overall <= 80:
            threshold = 1.12
        exercise = score >= threshold

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

    if active_option and salary_this_year <= 0:
        salary_this_year = int(active_option.get("salary", 0))
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
    season_year = get_operating_season_year(league_data)

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

            if active_option and salary_this_year <= 0:
                salary_this_year = int(active_option.get("salary", 0))

            if contract is None or (salary_this_year <= 0 and not active_option):
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
                    kept_player["contract"] = apply_option_exercise_to_contract(
                        contract = kept_player.get("contract"),
                        active_option = active_option,
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
                    kept_player["contract"] = apply_option_exercise_to_contract(
                        contract = kept_player.get("contract"),
                        active_option = active_option,
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
    state.setdefault("pendingUserDecisions", [])
    state.setdefault("pendingUserTeamName", None)
    state.setdefault("pendingUserTeamSnapshot", None)
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
    state: Optional[Dict[str, Any]] = None,
    target_override: Optional[int] = None
) -> int:
    min_roster_target = (
        int(target_override)
        if target_override is not None
        else get_min_roster_target(league_data)
    )

    _, _, team = find_team_entry(league_data, team_name)
    if team is None:
        return 0

    actual_count = len(get_team_players(team))
    return max(0, min_roster_target - actual_count)
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
    state: Dict[str, Any],
    target_override: Optional[int] = None
) -> int:
    _, _, team = find_team_entry(league_data, team_name)
    if team is None:
        return MAX_ACTIVE_OFFERS_PER_TEAM

    roster_target = (
        int(target_override)
        if target_override is not None
        else get_min_roster_target(league_data)
    )

    current_roster_count = len(get_team_players(team))
    roster_deficit = max(0, roster_target - current_roster_count)
    snapshot = get_team_cap_snapshot(league_data, team_name)
    cap_room = int(snapshot.get("capRoom", 0)) if snapshot.get("ok") else 0

    if roster_deficit >= 4:
        desired_limit = 14
    elif roster_deficit >= 3:
        desired_limit = 12
    elif roster_deficit >= 2:
        desired_limit = 11
    elif roster_deficit >= 1:
        desired_limit = 9
    elif cap_room >= 20_000_000:
        desired_limit = 8
    elif cap_room >= 8_000_000:
        desired_limit = 7
    elif current_roster_count <= roster_target + 1:
        desired_limit = 6
    else:
        desired_limit = 4

    return int(clamp(desired_limit, 0, 16))

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

def build_pending_user_decision_entry(
    league_data: Dict[str, Any],
    team_name: str,
    player: Dict[str, Any],
    chosen_offer: Dict[str, Any],
    all_offers: List[Dict[str, Any]],
    current_day: int,
) -> Dict[str, Any]:
    player_key = get_player_key_from_player(player)

    chosen_offer_copy = copy.deepcopy(chosen_offer)
    chosen_offer_copy["contract"] = normalize_contract(chosen_offer_copy.get("contract"))

    contract = normalize_contract(chosen_offer_copy.get("contract"))
    salary_by_year = list(contract.get("salaryByYear", [])) if contract else []
    total_value = int(sum(salary_by_year))
    years = len(salary_by_year)
    current_year_salary = int(salary_by_year[0]) if salary_by_year else 0

    return {
        "playerKey": player_key,
        "playerId": player.get("id"),
        "playerName": player.get("name"),
        "player": {
            "id": player.get("id"),
            "name": player.get("name"),
            "overall": player.get("overall"),
            "age": player.get("age"),
            "position": player.get("pos"),
            "headshot": player.get("headshot"),
        },
        "teamName": team_name,
        "day": current_day,
        "chosenOffer": chosen_offer_copy,
        "contract": contract,
        "salaryByYear": salary_by_year,
        "currentYearSalary": current_year_salary,
        "years": years,
        "totalValue": total_value,
        "allOffers": sort_offers_for_display(copy.deepcopy(all_offers)),
    }


def upsert_pending_user_decision(
    league_data: Dict[str, Any],
    team_name: str,
    player: Dict[str, Any],
    chosen_offer: Dict[str, Any],
    all_offers: List[Dict[str, Any]],
    current_day: int,
) -> Dict[str, Any]:
    state = ensure_free_agency_state(league_data)
    entry = build_pending_user_decision_entry(
        league_data = league_data,
        team_name = team_name,
        player = player,
        chosen_offer = chosen_offer,
        all_offers = all_offers,
        current_day = current_day,
    )

    pending_rows = [
        row for row in state.get("pendingUserDecisions", [])
        if row.get("playerKey") != entry.get("playerKey")
    ]
    pending_rows.append(entry)
    pending_rows.sort(
        key = lambda row: (
            -num(row.get("totalValue"), 0),
            str(row.get("playerName", "")),
        )
    )

    state["pendingUserDecisions"] = pending_rows
    state["pendingUserTeamName"] = team_name

    snapshot = get_team_cap_snapshot(league_data, team_name)
    state["pendingUserTeamSnapshot"] = snapshot if snapshot.get("ok") else None

    return entry


def clear_pending_user_decisions(state: Dict[str, Any]) -> None:
    state["pendingUserDecisions"] = []
    state["pendingUserTeamSnapshot"] = None


def process_pending_user_decisions(
    league_data: Dict[str, Any],
    user_team_name: Optional[str] = None,
    selected_player_keys: Optional[List[str]] = None,
) -> Dict[str, Any]:
    updated = copy.deepcopy(league_data)
    state = ensure_free_agency_state(updated)

    pending_rows = list(state.get("pendingUserDecisions", []))
    if not pending_rows:
        return {
            "ok": True,
            "leagueData": updated,
            "processedSignings": [],
            "generatedOffers": [],
            "stateSummary": build_free_agency_state_summary(updated),
            "teamSnapshot": state.get("pendingUserTeamSnapshot"),
        }

    if not user_team_name:
        user_team_name = state.get("pendingUserTeamName")

    selected_set = {str(x) for x in (selected_player_keys or [])}

    preview = copy.deepcopy(updated)
    preview_state = ensure_free_agency_state(preview)
    current_day = int(num(preview_state.get("currentDay"), 1))
    max_days = int(num(preview_state.get("maxDays"), DEFAULT_FREE_AGENCY_DAYS))

    processed_signings = []

    for row in pending_rows:
        player_key = row.get("playerKey") or get_player_key(
            row.get("playerId"),
            row.get("playerName"),
        )       

        if player_key not in selected_set:
            continue

        free_agents = preview.setdefault("freeAgents", [])
        player_idx = find_free_agent_index(
            free_agents,
            row.get("playerId"),
            row.get("playerName"),
        )
        if player_idx == -1:
            return {
                "ok": False,
                "reason": f"{row.get('playerName', 'Player')} is no longer available.",
                "leagueData": updated,
                "blockedPlayerKey": player_key,
                "stateSummary": build_free_agency_state_summary(updated),
                "teamSnapshot": state.get("pendingUserTeamSnapshot"),
            }

        player = free_agents[player_idx]
        chosen_offer = copy.deepcopy(row.get("chosenOffer") or {})

        if not chosen_offer:
            contract = normalize_contract(row.get("contract"))
            total_value = int(num(row.get("totalValue"), 0))
            years = int(num(row.get("years"), 1))
            chosen_offer = {
                "offerId": f"{player_key}|{user_team_name}",
                "playerId": row.get("playerId"),
                "playerName": row.get("playerName"),
                "playerKey": player_key,
                "teamName": user_team_name,
                "source": "user",
                "submittedDay": current_day,
                "status": "active",
                "contract": contract,
                "salaryByYear": list(contract.get("salaryByYear", [])) if contract else [],
                "currentYearSalary": int((contract.get("salaryByYear") or [0])[0]) if contract else 0,
                "years": years,
                "totalValue": total_value,
                "aav": int(total_value / max(1, years)),
            }

        chosen_offer["teamName"] = user_team_name
        chosen_offer["contract"] = normalize_contract(
            chosen_offer.get("contract") or row.get("contract")
        )

        signed = finalize_free_agent_signing_from_offer(
            league_data = preview,
            player = player,
            chosen_offer = chosen_offer,
            current_day = current_day,
        )
        if not signed:
            return {
                "ok": False,
                "reason": f"Unable to sign {row.get('playerName', 'player')} with the current cap / roster situation.",
                "leagueData": updated,
                "blockedPlayerKey": player_key,
                "stateSummary": build_free_agency_state_summary(updated),
                "teamSnapshot": state.get("pendingUserTeamSnapshot"),
            }

        processed_signings.append(signed)

    preview_state = ensure_free_agency_state(preview)
    clear_pending_user_decisions(preview_state)
    preview_state["pendingUserTeamName"] = user_team_name

    generated_offers = []

    if current_day >= max_days or len(preview.get("freeAgents", [])) == 0:
        final_cleanup_target = get_min_roster_target(preview)

        final_cleanup_signings = finalize_cpu_min_roster_cleanup(
            league_data = preview,
            current_day = current_day,
            user_team_name = user_team_name,
            min_roster_target_override = final_cleanup_target,
        )

        if final_cleanup_signings:
            processed_signings.extend(final_cleanup_signings)
            preview_state["dailyLog"].append({
                "day": current_day,
                "type": "cpu_final_min_roster_cleanup",
                "signings": len(final_cleanup_signings),
                "targetRosterSize": final_cleanup_target,
            })

        preview_state["isActive"] = False
        preview_state["pendingUserTeamSnapshot"] = None
    else:
        preview_state["currentDay"] = current_day + 1

        generated_offers = generate_cpu_offers_for_day(
            league_data = preview,
            user_team_name = user_team_name,
        )

        preview_state["dailyLog"].append({
            "day": preview_state["currentDay"],
            "type": "offer_generation",
            "offersGenerated": len(generated_offers),
        })

        snapshot = get_team_cap_snapshot(preview, user_team_name) if user_team_name else None
        preview_state["pendingUserTeamSnapshot"] = snapshot if snapshot and snapshot.get("ok") else None

    return {
        "ok": True,
        "leagueData": preview,
        "processedSignings": processed_signings,
        "generatedOffers": generated_offers,
        "stateSummary": build_free_agency_state_summary(preview),
        "teamSnapshot": preview_state.get("pendingUserTeamSnapshot"),
    }


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
    offered_current_salary = get_contract_salary_for_year(contract, get_operating_season_year(league_data))
    outstanding_current_salary = get_outstanding_offer_year1_total(
        state = state,
        team_name = team_name,
        exclude_offer_id = exclude_offer_id,
    )

    active_offer_count = get_active_offer_count_for_team(state, team_name)
    existing_offer = exclude_offer_id is not None
    effective_offer_count = active_offer_count if existing_offer else active_offer_count + 1

    roster_limit = get_roster_limit(league_data)
    current_roster_count = len(get_team_players(team))
    remaining_slots_now = max(0, roster_limit - current_roster_count)

    if remaining_slots_now <= 0:
        return {
            "ok": False,
            "reason": f"{team_name} already has a full roster.",
            "teamSnapshot": snapshot,
        }

    if effective_offer_count > remaining_slots_now:
        return {
            "ok": False,
            "reason": f"{team_name} does not have enough real roster space for another live offer.",
            "teamSnapshot": snapshot,
        }

    allow_minimum_exception = is_minimum_contract_for_current_year(
        league_data = league_data,
        contract = contract,
    )

    available_room = get_team_exception_room(
        league_data = league_data,
        team_name = team_name,
        player = player,
    )

    hard_cap = snapshot.get("hardCap")
    is_hard_capped = bool(snapshot.get("isHardCapped"))
    projected_payroll = int(num(snapshot.get("payroll"), 0)) + int(outstanding_current_salary) + int(offered_current_salary)

    if is_hard_capped and hard_cap is not None and projected_payroll > int(num(hard_cap, 0)):
        over_by = projected_payroll - int(num(hard_cap, 0))
        return {
            "ok": False,
            "reason": f"{team_name} would exceed its hard cap by ${int(over_by):,}.",
            "teamSnapshot": snapshot,
            "exceptionRoom": available_room,
        }

    if not allow_minimum_exception and outstanding_current_salary + offered_current_salary > available_room:
        over_by = outstanding_current_salary + offered_current_salary - available_room
        return {
            "ok": False,
            "reason": f"{team_name} does not have enough room for this live offer. Over by ${int(over_by):,}.",
            "teamSnapshot": snapshot,
            "exceptionRoom": available_room,
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
        "exceptionRoom": available_room,
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
    expected_years = int(market_value["expectedYears"])

    offered_aav = int(num(offer.get("aav"), 0))
    offered_years = int(num(offer.get("years"), 1))
    team_name = offer.get("teamName")

    contract = normalize_contract(offer.get("contract"))
    if not contract:
        contract = normalize_contract({
            "startYear": get_operating_season_year(league_data),
            "salaryByYear": list(offer.get("salaryByYear", [])) or [offered_aav],
            "option": None,
        })

    threshold = get_market_acceptance_threshold(
        league_data = league_data,
        player = player,
        contract = contract,
        exclude_offer_id = offer.get("offerId"),
    )

    required_aav = int(max(MIN_DEAL, num(threshold.get("requiredAAV"), MIN_DEAL)))

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
    score += offered_aav / max(1.0, float(required_aav))
    score -= abs(offered_years - expected_years) * 0.05

    if threshold.get("autoAccept"):
        score = max(score, 1.08)

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
        "pendingUserDecisionCount": len(state.get("pendingUserDecisions", [])),
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
    profile = build_team_roster_profile(team)
    direction = profile["direction"]

    age = int(num(player.get("age"), 27))
    overall = int(round(num(player.get("overall"), 75)))
    potential = int(round(num(player.get("potential"), overall)))
    upside = max(0, potential - overall)

    off_rating = int(round(num(player.get("offRating"), overall)))
    def_rating = int(round(num(player.get("defRating"), overall)))
    scoring_rating = int(round(num(player.get("scoringRating"), overall)))

    expected_year1 = int(market_value["expectedYear1Salary"])
    expected_years = int(market_value["expectedYears"])

    team_name = team.get("name")
    snapshot = get_team_cap_snapshot(league_data, team_name) if team_name else {"ok": False, "capRoom": 0, "rosterCount": 0}
    cap_room = int(snapshot.get("capRoom", 0)) if snapshot.get("ok") else 0
    exception_room = get_team_exception_room(
        league_data = league_data,
        team_name = team_name,
        player = player,
    ) if team_name else cap_room

    actual_roster_count = len(get_team_players(team))
    offseason_min_target = get_free_agency_min_roster_target(league_data)
    roster_deficit = max(0, offseason_min_target - actual_roster_count)
    day_progress = current_day / max(1, max_days)

    need_score = get_player_need_score_for_team(team, player)
    previous_team = None
    if isinstance(player.get("freeAgencyMeta"), dict):
        previous_team = player["freeAgencyMeta"].get("fromTeam")
    is_returning_team_target = bool(team_name and previous_team == team_name)

    premium_talent = overall >= 84
    high_end_talent = overall >= 81

    fringe_player = (
        overall <= 74
        or (overall <= 75 and (age >= 23 or potential <= overall + 1))
        or (overall <= 76 and (age >= 25 or potential <= overall + 2))
        or (overall <= 77 and (age >= 27 or potential <= overall + 2))
        or (overall <= 78 and age >= 30 and potential <= overall + 2)
    )

    if fringe_player:
        years = 1 if age >= 29 else 2
        return normalize_contract({
            "startYear": get_operating_season_year(league_data),
            "salaryByYear": build_salary_by_year(MIN_DEAL, years),
            "option": None,
        })

    multiplier = 0.94 + (0.05 * rng.random()) + (0.07 * day_progress)
    multiplier += max(0.0, (overall - 79.0) * 0.012)

    if overall >= 84:
        multiplier += 0.04
    if overall >= 88:
        multiplier += 0.04

    if direction == "contending":
        if overall >= 79:
            multiplier += 0.05
        if age >= 28:
            multiplier += 0.03
        if def_rating >= 84:
            multiplier += 0.02

    elif direction == "rebuilding":
        if age <= 26:
            multiplier += 0.05
        if upside >= 2:
            multiplier += 0.05
        if upside >= 4:
            multiplier += 0.03

        veteran_penalty = max(0.0, (age - 29) * 0.015)
        veteran_penalty -= max(0.0, (overall - 81) * 0.012)
        multiplier -= max(0.0, veteran_penalty)

    elif direction == "retooling":
        if age <= 29:
            multiplier += 0.03
        if upside >= 2:
            multiplier += 0.04

    else:
        if 24 <= age <= 31:
            multiplier += 0.02

    if need_score >= 0.70:
        multiplier += 0.06
    elif need_score >= 0.45:
        multiplier += 0.03

    if roster_deficit >= 4:
        multiplier += 0.12
    elif roster_deficit >= 2:
        multiplier += 0.08
    elif roster_deficit >= 1:
        multiplier += 0.05

    if cap_room >= 30_000_000 and overall >= 79:
        multiplier += 0.12
    elif cap_room >= 20_000_000 and overall >= 78:
        multiplier += 0.09
    elif cap_room >= 12_000_000 and overall >= 76:
        multiplier += 0.05
    elif exception_room >= 8_000_000 and overall >= 78:
        multiplier += 0.03

    if is_returning_team_target:
        multiplier += 0.08

    if direction == "rebuilding" and cap_room >= 15_000_000 and overall >= 83:
        multiplier += 0.06
    if direction == "contending" and overall >= 80 and age >= 28:
        multiplier += 0.05
    if off_rating >= 87 and scoring_rating >= 86 and age <= 30:
        multiplier += 0.03
    if age >= 34 and overall <= 79:
        multiplier -= 0.04

    if roster_deficit == 0 and cap_room < 5_000_000 and overall <= 77 and age >= 29:
        multiplier = min(multiplier, 0.92)

    if overall >= 85:
        multiplier = max(multiplier, 1.06)
    elif overall >= 82:
        multiplier = max(multiplier, 1.01)
    elif roster_deficit >= 2 and overall >= 77:
        multiplier = max(multiplier, 0.97)

    year1_salary = int(
        round_to_nearest(
            clamp(expected_year1 * multiplier, MIN_DEAL, MAX_SALARY),
            base = 1_000,
        )
    )

    years = expected_years

    if overall <= 77:
        years = 2 if age <= 27 else 1
    elif overall <= 81:
        years = 3 if age <= 29 else 2
    elif overall <= 85:
        years = max(expected_years, 4 if age <= 29 else 3)
    else:
        years = max(expected_years, 4 if age <= 31 else 3)

    if direction == "contending" and age >= 32:
        years = max(1, years - 1)
    elif direction == "rebuilding":
        if age <= 25 and upside >= 3:
            years = min(4, years + 1)
        elif age >= 29:
            years = min(years, 2)

    if is_returning_team_target and age <= 31 and overall >= 79:
        years = max(years, min(4, expected_years))

    years = int(clamp(years, 1, 4))

    available_room = exception_room

    if available_room <= MIN_DEAL:
        year1_salary = MIN_DEAL
        years = 1 if age >= 29 else min(2, years)
    else:
        if premium_talent and cap_room >= int(expected_year1 * 0.90):
            affordable_share = 1.00
        elif premium_talent:
            affordable_share = 0.95
        elif high_end_talent:
            affordable_share = 0.88
        else:
            affordable_share = 0.82
        affordable_year1 = int(
            round_to_nearest(
                clamp(max(MIN_DEAL, available_room * affordable_share), MIN_DEAL, MAX_SALARY),
                base = 1_000,
            )
        )
        if year1_salary > affordable_year1:
            year1_salary = max(MIN_DEAL, affordable_year1)

    return normalize_contract({
        "startYear": get_operating_season_year(league_data),
        "salaryByYear": build_salary_by_year(year1_salary, years),
        "option": None,
    })

def generate_cpu_offers_for_day(
    league_data: Dict[str, Any],
    user_team_name: Optional[str] = None
) -> List[Dict[str, Any]]:
    state = ensure_free_agency_state(league_data)
    refresh_free_agent_market_values(league_data)
    current_day = int(num(state.get("currentDay"), 1))
    max_days = int(num(state.get("maxDays"), DEFAULT_FREE_AGENCY_DAYS))
    season_year = get_current_season_year(league_data)
    offseason_min_target = get_free_agency_min_roster_target(league_data)

    generated = []
    free_agents = sorted(
        league_data.get("freeAgents", []),
        key = lambda p: (
            -num(p.get("overall"), 0),
            -num((p.get("marketValue") or {}).get("expectedAAV"), 0),
            int(num(p.get("age"), 27)),
        ),
    )

    for player in free_agents:
        player_key = get_player_key_from_player(player)
        active_offers = get_active_offers_for_player(state, player_key)
        existing_team_names = {offer.get("teamName") for offer in active_offers}

        overall = int(round(num(player.get("overall"), 0)))
        age = int(num(player.get("age"), 27))
        potential = int(round(num(player.get("potential"), overall)))
        upside = max(0, potential - overall)

        desired_offer_count = 2
        if overall >= 90:
            desired_offer_count = 8
        elif overall >= 86:
            desired_offer_count = 7
        elif overall >= 82:
            desired_offer_count = 6
        elif overall >= 79:
            desired_offer_count = 5
        elif overall >= 76:
            desired_offer_count = 4
        elif overall >= 73:
            desired_offer_count = 3

        if current_day >= max_days - 1:
            desired_offer_count += 1

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

            actual_roster_count = len(get_team_players(team))
            actual_roster_deficit = max(0, offseason_min_target - actual_roster_count)
            active_offer_count = get_active_offer_count_for_team(state, team_name)

            active_offer_limit = get_active_offer_limit_for_team(
                league_data = league_data,
                team_name = team_name,
                state = state,
                target_override = offseason_min_target,
            )
            if active_offer_count >= active_offer_limit:
                continue

            remaining_roster_slots = get_team_remaining_roster_slots(
                league_data = league_data,
                team_name = team_name,
                state = state,
            )
            if remaining_roster_slots <= 0:
                continue

            if active_offer_count >= remaining_roster_slots:
                continue

            snapshot = get_team_cap_snapshot(league_data, team_name)
            cap_room = int(snapshot.get("capRoom", 0)) if snapshot.get("ok") else 0
            exception_room = get_team_exception_room(
                league_data = league_data,
                team_name = team_name,
                player = player,
            )

            if exception_room < MIN_DEAL:
                continue

            fit = estimate_team_free_agent_fit(team, player)

            min_fit_threshold = 0.42
            if actual_roster_deficit >= 3:
                min_fit_threshold = 0.12
            elif actual_roster_deficit >= 1:
                min_fit_threshold = 0.18
            elif cap_room >= 18_000_000:
                min_fit_threshold = 0.26
            elif cap_room >= 8_000_000:
                min_fit_threshold = 0.32

            min_fit_threshold -= max(0.0, (overall - 78.0) * 0.015)

            if exception_room >= 12_000_000:
                min_fit_threshold -= 0.06
            elif exception_room >= 8_000_000:
                min_fit_threshold -= 0.03

            if current_day >= max_days - 1:
                min_fit_threshold -= 0.10
            elif current_day >= max_days - 2:
                min_fit_threshold -= 0.06

            min_fit_threshold = max(0.06, min_fit_threshold)
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

            profile = build_team_roster_profile(team)
            candidate_score = fit["interestScore"] + (rng.random() * 0.05)
            candidate_score += max(0.0, (overall - 75.0) * 0.010)
            candidate_score += max(0.0, (overall - 82.0) * 0.018)
            candidate_score += fit.get("needScore", 0.0) * 0.22
            candidate_score += min(0.45, actual_roster_deficit * 0.13)

            if cap_room >= 25_000_000:
                candidate_score += max(0.0, (overall - 77.0) * 0.022)
            elif cap_room >= 15_000_000:
                candidate_score += max(0.0, (overall - 78.0) * 0.016)
            elif cap_room >= 8_000_000 or exception_room >= 8_000_000:
                candidate_score += max(0.0, (overall - 79.0) * 0.010)

            if overall >= 85 and cap_room >= 12_000_000:
                candidate_score += 0.14
            elif overall >= 85 and cap_room >= 8_000_000:
                candidate_score += 0.08

            if profile["direction"] == "contending" and overall >= 79 and age >= 27:
                candidate_score += 0.08
            if profile["direction"] == "rebuilding" and age <= 27 and upside >= 2:
                candidate_score += 0.08

            previous_team = None
            if isinstance(player.get("freeAgencyMeta"), dict):
                previous_team = player["freeAgencyMeta"].get("fromTeam")
            if previous_team and previous_team == team_name:
                candidate_score += 0.18

            if current_day >= max_days - 1:
                candidate_score += 0.10
            elif current_day >= max_days - 2:
                candidate_score += 0.05

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
    if not snapshot.get("ok"):
        return None

    contract = apply_free_agency_start_year(league_data, chosen_offer.get("contract"))
    offered_current_salary = get_contract_salary_for_year(contract, get_operating_season_year(league_data))

    allow_minimum_exception = is_minimum_contract_for_current_year(
        league_data = league_data,
        contract = contract,
    )

    available_room = get_team_exception_room(
        league_data = league_data,
        team_name = chosen_offer.get("teamName"),
        player = player,
    )

    hard_cap = snapshot.get("hardCap")
    is_hard_capped = bool(snapshot.get("isHardCapped"))
    projected_payroll = int(num(snapshot.get("payroll"), 0)) + int(offered_current_salary)

    if is_hard_capped and hard_cap is not None and projected_payroll > int(num(hard_cap, 0)):
        return None

    if not allow_minimum_exception and offered_current_salary > available_room:
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

def resolve_signings_for_day(
    league_data: Dict[str, Any],
    current_day: int,
    user_team_name: Optional[str] = None,
) -> List[Dict[str, Any]]:
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

        overall = int(round(num(player.get("overall"), 0)))
        age = int(num(player.get("age"), 27))
        offer_count = len(offers)
        market_value = player.get("marketValue") or estimate_market_value(player)
        expected_aav = int(num(market_value.get("expectedAAV"), MIN_DEAL))
        best_offer_aav = int(num(best_offer.get("aav"), 0))

        best_market = get_market_acceptance_threshold(
            league_data = league_data,
            player = player,
            contract = normalize_contract(best_offer.get("contract")),
            exclude_offer_id = best_offer.get("offerId"),
        )

        should_sign = False

        if current_day >= max_days:
            should_sign = True
        elif best_market.get("autoAccept"):
            should_sign = True
        else:
            if overall >= 87:
                threshold = 1.02 if current_day <= 2 else 0.99 if current_day <= 4 else 0.94
                margin_needed = 0.05 if current_day <= 3 else 0.02
            elif overall >= 82:
                threshold = 0.99 if current_day <= 2 else 0.95 if current_day <= 4 else 0.90
                margin_needed = 0.04 if current_day <= 2 else 0.01
            elif overall >= 78:
                threshold = 0.95 if current_day <= 2 else 0.92 if current_day <= 4 else 0.87
                margin_needed = 0.03 if current_day <= 2 else 0.01
            else:
                threshold = 0.89 if current_day <= 2 else 0.85 if current_day <= 4 else 0.81
                margin_needed = 0.00

            if current_day >= max_days:
                threshold = min(threshold, 0.82)
                margin_needed = 0.00

            if current_day == 1 and overall >= 85 and offer_count < 2:
                should_sign = False
            elif best_score >= threshold:
                if second_score is None:
                    should_sign = current_day >= 2 or overall <= 83 or best_score >= threshold + 0.03
                elif best_score - num(second_score, 0) >= margin_needed:
                    should_sign = True
                elif offer_count >= 3:
                    should_sign = True
                elif current_day >= 3 and best_score >= threshold + 0.01:
                    should_sign = True

            if not should_sign and current_day >= max_days - 1:
                if overall >= 82 and best_score >= 0.84:
                    should_sign = True
                elif overall >= 76 and best_score >= 0.80:
                    should_sign = True
                elif best_score >= 0.77:
                    should_sign = True

            if not should_sign and current_day >= max_days - 1:
                strong_late_market_offer = (
                    overall >= 80
                    and offer_count >= 2
                    and best_offer_aav >= int(round(expected_aav * 0.88))
                    and best_score >= 0.79
                )
                veteran_good_money = (
                    age >= 32
                    and offer_count >= 3
                    and best_offer_aav >= int(round(expected_aav * 0.90))
                    and best_score >= 0.80
                )
                if strong_late_market_offer or veteran_good_money:
                    should_sign = True

            if not should_sign and current_day >= max_days:
                general_last_call = (
                    overall >= 78
                    and offer_count >= 2
                    and best_offer_aav >= int(round(expected_aav * 0.84))
                    and best_score >= 0.77
                )
                veteran_last_call = (
                    age >= 30
                    and offer_count >= 2
                    and best_offer_aav >= int(round(expected_aav * 0.86))
                    and best_score >= 0.78
                )
                if general_last_call or veteran_last_call:
                    should_sign = True

        if not should_sign:
            continue

        if (
            user_team_name
            and best_offer.get("teamName") == user_team_name
            and best_offer.get("source") == "user"
        ):
            upsert_pending_user_decision(
                league_data = league_data,
                team_name = user_team_name,
                player = player,
                chosen_offer = best_offer,
                all_offers = offers,
                current_day = current_day,
            )
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

    updated.setdefault("freeAgents", [])
    refresh_free_agent_market_values(updated)

    state = ensure_free_agency_state(updated)
    state["isActive"] = True
    state["currentDay"] = 1
    state["maxDays"] = int(clamp(max_days, 1, 30))
    state["offersByPlayer"] = {}
    state["dailyLog"] = []
    state["signedPlayersLog"] = []
    state["offerHistory"] = []
    state["pendingUserDecisions"] = []
    state["pendingUserTeamName"] = user_team_name
    state["pendingUserTeamSnapshot"] = get_team_cap_snapshot(updated, user_team_name) if user_team_name else None

    offseason_min_target = get_free_agency_min_roster_target(updated)
    opening_cleanup_target = max(10, offseason_min_target - 4)
    opening_cleanup_signings = []

    opening_offers = generate_cpu_offers_for_day(
        league_data = updated,
        user_team_name = user_team_name,
    )

    state["dailyLog"].append({
        "day": 1,
        "type": "opening_market",
        "offersGenerated": len(opening_offers),
        "openingCleanupSignings": 0,
        "openingCleanupTarget": opening_cleanup_target,
        "fullMinTarget": offseason_min_target,
    })

    return {
        "ok": True,
        "leagueData": updated,
        "openingOffers": opening_offers,
        "cleanupSignings": opening_cleanup_signings,
        "stateSummary": build_free_agency_state_summary(updated),
    }


def advance_free_agency_day(
    league_data: Dict[str, Any],
    user_team_name: Optional[str] = None
) -> Dict[str, Any]:
    updated = copy.deepcopy(league_data)
    state = ensure_free_agency_state(updated)
    refresh_free_agent_market_values(updated)

    if not state.get("isActive"):
        return {
            "ok": False,
            "reason": "Free agency period is not active.",
            "stateSummary": build_free_agency_state_summary(updated),
        }

    if state.get("pendingUserDecisions"):
        return {
            "ok": False,
            "reason": "Process your pending user signings before advancing the day.",
            "leagueData": updated,
            "stateSummary": build_free_agency_state_summary(updated),
        }

    current_day = int(num(state.get("currentDay"), 1))
    max_days = int(num(state.get("maxDays"), DEFAULT_FREE_AGENCY_DAYS))
    offseason_min_target = get_free_agency_min_roster_target(updated)

    signings = resolve_signings_for_day(
        league_data = updated,
        current_day = current_day,
        user_team_name = user_team_name,
    )

    state["dailyLog"].append({
        "day": current_day,
        "type": "resolution",
        "signings": len(signings),
    })

    if state.get("pendingUserDecisions"):
        return {
            "ok": True,
            "leagueData": updated,
            "dayResolved": current_day,
            "signings": signings,
            "generatedOffers": [],
            "stateSummary": build_free_agency_state_summary(updated),
        }

    if current_day >= max_days or len(updated.get("freeAgents", [])) == 0:
        final_cleanup_target = get_min_roster_target(updated)

        final_cleanup_signings = finalize_cpu_min_roster_cleanup(
            league_data = updated,
            current_day = current_day,
            user_team_name = user_team_name,
            min_roster_target_override = final_cleanup_target,
        )

        if final_cleanup_signings:
            signings.extend(final_cleanup_signings)
            state["dailyLog"].append({
                "day": current_day,
                "type": "cpu_final_min_roster_cleanup",
                "signings": len(final_cleanup_signings),
                "targetRosterSize": final_cleanup_target,
            })

        state["isActive"] = False
        state["pendingUserTeamSnapshot"] = None

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

    state["pendingUserTeamSnapshot"] = get_team_cap_snapshot(updated, user_team_name) if user_team_name else None

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
def get_market_acceptance_threshold(
    league_data: Dict[str, Any],
    player: Dict[str, Any],
    contract: Dict[str, Any],
    exclude_offer_id: Optional[str] = None
) -> Dict[str, Any]:
    contract = normalize_contract(contract)
    if not contract:
        return {
            "requiredAAV": MAX_SALARY,
            "autoAccept": False,
            "offerCount": 0,
            "bestLiveAAV": 0,
            "fringePlayer": False,
        }

    market_value = player.get("marketValue") or estimate_market_value(player)

    min_acceptable_aav = int(market_value["minAcceptableAAV"])
    offered_years = len(contract["salaryByYear"])
    offered_aav = int(sum(contract["salaryByYear"]) / max(1, offered_years))

    overall = int(round(num(player.get("overall"), 0)))
    age = int(num(player.get("age"), 27))
    potential = int(round(num(player.get("potential"), overall)))

    state = ensure_free_agency_state(league_data)
    player_key = get_player_key_from_player(player)
    active_offers = [
        o for o in state.get("offersByPlayer", {}).get(player_key, [])
        if o.get("status", "active") == "active"
        and (exclude_offer_id is None or o.get("offerId") != exclude_offer_id)
    ]

    offer_count = len(active_offers)
    best_live_aav = max([int(num(o.get("aav"), 0)) for o in active_offers], default = 0)

    current_day = int(num(state.get("currentDay"), 1))
    max_days = int(num(state.get("maxDays"), DEFAULT_FREE_AGENCY_DAYS))
    day_progress = current_day / max(1, max_days)

    fringe_player = (
        overall <= 74
        or (overall <= 75 and (age >= 24 or potential <= overall + 1))
        or (overall <= 76 and age >= 27 and potential <= overall + 2)
        or (overall <= 77 and age >= 31 and potential <= overall + 1)
    )

    if fringe_player and offer_count == 0 and offered_years <= 2 and offered_aav >= MIN_DEAL:
        return {
            "requiredAAV": MIN_DEAL,
            "autoAccept": True,
            "offerCount": offer_count,
            "bestLiveAAV": best_live_aav,
            "fringePlayer": True,
        }

    required_aav = min_acceptable_aav

    if offer_count == 0:
        if fringe_player:
            accept_mult = 0.50 - (0.18 * day_progress)
        elif overall <= 78:
            accept_mult = 0.66 - (0.12 * day_progress)
        elif overall <= 81:
            accept_mult = 0.80 - (0.10 * day_progress)
        elif overall <= 84:
            accept_mult = 0.88 - (0.07 * day_progress)
        elif overall <= 87:
            accept_mult = 0.96 - (0.03 * day_progress)
        else:
            accept_mult = 0.98 - (0.02 * day_progress)

        if age >= 31 and overall <= 81:
            accept_mult -= 0.03
        if age >= 34 and overall <= 78:
            accept_mult -= 0.03

        accept_mult = clamp(accept_mult, 0.45, 0.98)

        required_aav = max(
            MIN_DEAL,
            int(round(min_acceptable_aav * accept_mult))
        )

        if overall >= 88:
            required_aav = max(
                required_aav,
                int(round(max(MIN_DEAL, market_value["expectedAAV"] * 0.95)))
            )
        elif overall >= 85:
            required_aav = max(
                required_aav,
                int(round(max(MIN_DEAL, market_value["expectedAAV"] * 0.91)))
            )
        elif overall >= 82:
            required_aav = max(
                required_aav,
                int(round(max(MIN_DEAL, market_value["expectedAAV"] * 0.86)))
            )
    else:
        if overall >= 85:
            best_offer_mult = 0.98
            market_floor_mult = 0.92
        elif overall >= 80:
            best_offer_mult = 0.96
            market_floor_mult = 0.88
        else:
            best_offer_mult = 0.94
            market_floor_mult = 0.82

        if age >= 31 and overall <= 81:
            market_floor_mult -= 0.03

        required_aav = max(
            MIN_DEAL,
            int(round(max(
                best_live_aav * best_offer_mult,
                min_acceptable_aav * market_floor_mult,
            )))
        )

    return {
        "requiredAAV": required_aav,
        "autoAccept": False,
        "offerCount": offer_count,
        "bestLiveAAV": best_live_aav,
        "fringePlayer": fringe_player,
    }
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
            "reason": f"{team_name} not found.",
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
    season_year = get_operating_season_year(league_data)
    offered_current_salary = get_contract_salary_for_year(contract, season_year)

    allow_minimum_exception = is_minimum_contract_for_current_year(
        league_data = league_data,
        contract = contract,
    )

    available_room = get_team_exception_room(
        league_data = league_data,
        team_name = team_name,
        player = player,
    )

    hard_cap = snapshot.get("hardCap")
    is_hard_capped = bool(snapshot.get("isHardCapped"))
    projected_payroll = int(num(snapshot.get("payroll"), 0)) + int(offered_current_salary)

    if is_hard_capped and hard_cap is not None and projected_payroll > int(num(hard_cap, 0)):
        over_by = projected_payroll - int(num(hard_cap, 0))
        return {
            "ok": False,
            "accepted": False,
            "reason": f"{team_name} would exceed its hard cap by ${int(over_by):,}.",
            "teamSnapshot": snapshot,
            "contract": contract,
        }

    if not allow_minimum_exception and offered_current_salary > available_room:
        over_by = offered_current_salary - available_room
        return {
            "ok": False,
            "reason": f"{team_name} is over its available room by ${int(over_by):,}.",
            "teamSnapshot": snapshot,
            "exceptionRoom": available_room,
            "contract": contract,
        }

    market_value = player.get("marketValue") or estimate_market_value(player)

    offered_years = len(contract["salaryByYear"])
    offered_aav = int(sum(contract["salaryByYear"]) / max(1, offered_years))
    expected_years = int(market_value["expectedYears"])
    expected_aav = int(market_value["expectedAAV"])
    min_acceptable_aav = int(market_value["minAcceptableAAV"])

    market_threshold = get_market_acceptance_threshold(
        league_data = league_data,
        player = player,
        contract = contract,
    )

    required_aav = int(market_threshold["requiredAAV"])
    year_penalty = abs(offered_years - expected_years) * 0.06
    acceptance_score = (offered_aav / max(1, required_aav)) - year_penalty

    accepted = bool(market_threshold["autoAccept"]) or (
        offered_aav >= required_aav and acceptance_score >= 0.90
    )

    return {
        "ok": True,
        "accepted": accepted,
        "reason": "Offer accepted." if accepted else "Offer rejected.",
        "teamSnapshot": snapshot,
        "contract": contract,
        "marketValue": market_value,
        "exceptionRoom": available_room,
        "details": {
            "offeredYears": offered_years,
            "offeredAAV": offered_aav,
            "expectedYears": expected_years,
            "expectedAAV": expected_aav,
            "minAcceptableAAV": min_acceptable_aav,
            "requiredAAV": required_aav,
            "acceptanceScore": round(acceptance_score, 3),
            "offerCount": market_threshold["offerCount"],
            "bestLiveAAV": market_threshold["bestLiveAAV"],
            "fringePlayer": market_threshold["fringePlayer"],
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

    _, _, team = find_team_entry(updated, team_name)
    if team is None:
        return {
            "ok": False,
            "reason": f"Team '{team_name}' not found.",
        }

    player = free_agents[player_idx]
    state = ensure_free_agency_state(updated)
    offer = offer or {}

    post_market_cleanup_mode = bool(state.get("maxDays")) and not state.get("isActive")
    if post_market_cleanup_mode:
        preview_contract = build_contract_from_offer(
            updated,
            offer or {
                "startYear": get_operating_season_year(updated),
                "salaryByYear": [MIN_DEAL],
                "option": None,
            },
        )

        if len(get_team_players(team)) >= get_min_roster_target(updated):
            return {
                "ok": False,
                "reason": f"{team_name} is already at or above the minimum roster size.",
            }

        if not is_emergency_fill_candidate(player):
            return {
                "ok": False,
                "reason": "After the live market closes, only low-end emergency roster-fill players can be signed directly.",
            }

        if not is_minimum_contract_for_current_year(updated, preview_contract):
            return {
                "ok": False,
                "reason": "After the live market closes, only minimum contracts are allowed.",
            }

    evaluation = evaluate_offer(updated, team_name, player, offer)
    if not evaluation.get("ok"):
        return evaluation
    if not evaluation.get("accepted"):
        return evaluation

    signed_player = copy.deepcopy(player)
    signed_player["contract"] = apply_free_agency_start_year(
        updated,
        evaluation["contract"],
    )
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

def repair_cpu_teams_to_min_roster(
    league_data: Dict[str, Any],
    user_team_name: Optional[str] = None,
    min_players: Optional[int] = None,
    current_day: int = 0,
) -> Dict[str, Any]:
    updated = copy.deepcopy(league_data)

    if min_players is not None:
        try:
            updated["minRosterSize"] = int(min_players)
        except (TypeError, ValueError):
            pass

    refresh_free_agent_market_values(updated)

    cleanup_signings = finalize_cpu_min_roster_cleanup(
        league_data = updated,
        current_day = int(num(current_day, 0)),
        user_team_name = user_team_name,
    )

    min_target = get_min_roster_target(updated)
    failed_teams = []

    for _, _, team in iter_teams(updated):
        team_name = team.get("name")
        if not team_name:
            continue
        if user_team_name and team_name == user_team_name:
            continue

        player_count = len(get_team_players(team))
        if player_count < min_target:
            failed_teams.append({
                "teamName": team_name,
                "playerCount": player_count,
                "minPlayers": min_target,
            })

    return {
        "ok": len(failed_teams) == 0,
        "leagueData": updated,
        "signings": cleanup_signings,
        "failedTeams": failed_teams,
        "minPlayers": min_target,
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

    if action in ["preview_offseason_contracts", "preview_player_team_options"]:
        return preview_offseason_contracts(
            league_data = league_data,
            user_team_name = payload.get("userTeamName"),
        )

    if action in ["apply_offseason_contract_decisions", "apply_player_team_options"]:
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

    if action == "process_pending_user_decisions":
        return process_pending_user_decisions(
            league_data = league_data,
            user_team_name = payload.get("userTeamName"),
            selected_player_keys = payload.get("selectedPlayerKeys", []) or [],
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

    if action == "repair_cpu_teams_to_min_roster":
        return repair_cpu_teams_to_min_roster(
            league_data = league_data,
            user_team_name = payload.get("userTeamName"),
            min_players = payload.get("minPlayers"),
            current_day = int(num(payload.get("currentDay"), 0)),
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