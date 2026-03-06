import copy
import json
import sys
from typing import Any, Dict, List, Optional, Tuple

DEFAULT_SALARY_CAP = 150_000_000
DEFAULT_ROSTER_LIMIT = 15
DEFAULT_SEASON_YEAR = 2026

MIN_DEAL = 1_200_000
MAX_SALARY = 45_000_000
YEARLY_RAISE = 0.05


def num(value: Any, fallback: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return float(fallback)


def round_to_nearest(value: float, base: int = 1_000) -> int:
    return int(base * round(float(value) / base))


def clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


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
        or DEFAULT_ROSTER_LIMIT
    )


def iter_teams(league_data: Dict[str, Any]):
    conferences = league_data.get("conferences", {})
    for conf_name in ["East", "West"]:
        for idx, team in enumerate(conferences.get(conf_name, [])):
            yield conf_name, idx, team


def find_team_entry(league_data: Dict[str, Any], team_name: str) -> Tuple[Optional[str], Optional[int], Optional[Dict[str, Any]]]:
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


def get_contract_salary_for_year(contract: Optional[Dict[str, Any]], season_year: int) -> int:
    contract = normalize_contract(contract)
    if not contract:
        return 0

    start_year = contract["startYear"]
    salary_by_year = contract["salaryByYear"]
    idx = season_year - start_year

    if idx < 0 or idx >= len(salary_by_year):
        return 0

    return int(salary_by_year[idx])


def get_player_salary_for_year(player: Dict[str, Any], season_year: int) -> int:
    return get_contract_salary_for_year(player.get("contract"), season_year)


def get_team_players(team: Dict[str, Any]) -> List[Dict[str, Any]]:
    return team.get("players", [])


def get_team_payroll(team: Dict[str, Any], season_year: int) -> int:
    payroll = 0
    for player in get_team_players(team):
        payroll += get_player_salary_for_year(player, season_year)
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

    payroll = get_team_payroll(team, season_year)
    roster_count = len(get_team_players(team))

    return {
        "ok": True,
        "teamName": team_name,
        "seasonYear": season_year,
        "salaryCap": salary_cap,
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

    salary_by_year = []
    for i in range(years):
        salary = year1_salary * ((1 + YEARLY_RAISE) ** i)
        salary_by_year.append(int(round_to_nearest(salary, base = 1_000)))

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


def evaluate_offer(
    league_data: Dict[str, Any],
    team_name: str,
    player: Dict[str, Any],
    offer: Dict[str, Any],
) -> Dict[str, Any]:
    snapshot = get_team_cap_snapshot(league_data, team_name)
    if not snapshot.get("ok"):
        return snapshot

    team_conf, team_idx, team = find_team_entry(league_data, team_name)
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
        }

    contract = build_contract_from_offer(league_data, offer)
    season_year = get_current_season_year(league_data)
    offered_current_salary = get_contract_salary_for_year(contract, season_year)

    if snapshot["payroll"] + offered_current_salary > snapshot["salaryCap"]:
        over_by = snapshot["payroll"] + offered_current_salary - snapshot["salaryCap"]
        return {
            "ok": False,
            "reason": f"{team_name} is over the cap by ${over_by:,}.",
            "teamSnapshot": snapshot,
        }

    market_value = player.get("marketValue") or estimate_market_value(player)

    offered_years = len(contract["salaryByYear"])
    offered_aav = int(sum(contract["salaryByYear"]) / offered_years)
    expected_years = int(market_value["expectedYears"])
    expected_aav = int(market_value["expectedAAV"])
    min_acceptable_aav = int(market_value["minAcceptableAAV"])

    salary_ratio = offered_aav / max(1, expected_aav)
    year_penalty = abs(offered_years - expected_years) * 0.06
    acceptance_score = salary_ratio - year_penalty

    accepted = offered_aav >= min_acceptable_aav and acceptance_score >= 0.92

    reason = "Offer accepted." if accepted else "Offer rejected."

    return {
        "ok": True,
        "accepted": accepted,
        "reason": reason,
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


def find_free_agent_index(free_agents: List[Dict[str, Any]], player_id: Optional[str], player_name: Optional[str]) -> int:
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

    conf_name, team_idx, team = find_team_entry(updated, team_name)
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
    conf_name, team_idx, team = find_team_entry(updated, team_name)

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
    released_player["contract"] = None
    released_player["marketValue"] = estimate_market_value(released_player)

    updated.setdefault("freeAgents", []).append(released_player)

    return {
        "ok": True,
        "reason": f"{released_player.get('name', 'Player')} released to free agency.",
        "leagueData": updated,
        "releasedPlayer": released_player,
        "teamName": team_name,
        "teamSnapshot": get_team_cap_snapshot(updated, team_name),
    }


def handle_request(request: Dict[str, Any]) -> Dict[str, Any]:
    action = request.get("action")
    league_data = request.get("leagueData", {})
    payload = request.get("payload", {})

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