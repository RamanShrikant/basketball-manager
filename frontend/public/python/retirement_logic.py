import copy
import json
import random
import sys
from typing import Any, Dict, List, Optional, Tuple

DEFAULT_SEASON_YEAR = 2026


def num(value: Any, fallback: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return float(fallback)


def clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def get_current_season_year(league_data: Dict[str, Any]) -> int:
    return int(
        league_data.get("seasonYear")
        or league_data.get("currentSeasonYear")
        or DEFAULT_SEASON_YEAR
    )


def iter_teams(league_data: Dict[str, Any]):
    conferences = league_data.get("conferences", {})
    for conf_name in ["East", "West"]:
        for idx, team in enumerate(conferences.get(conf_name, [])):
            yield conf_name, idx, team


def get_all_teams(league_data: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [team for _, _, team in iter_teams(league_data)]


def build_exact_stats_key(player_name: str, team_name: str) -> str:
    return f"{player_name}__{team_name}"


def get_player_stats_entry(
    stats_by_key: Optional[Dict[str, Any]],
    player_name: str,
    team_name: str,
) -> Dict[str, Any]:
    if not isinstance(stats_by_key, dict):
        return {}

    exact_key = build_exact_stats_key(player_name, team_name)
    entry = stats_by_key.get(exact_key)
    if isinstance(entry, dict):
        return entry

    for key, value in stats_by_key.items():
        if not isinstance(key, str) or not isinstance(value, dict):
            continue
        if key.startswith(f"{player_name}__"):
            return value

    return {}


def extract_games_played(stats_entry: Dict[str, Any]) -> int:
    for key in ["gp", "gamesPlayed", "games", "g"]:
        value = num(stats_entry.get(key), -1)
        if value >= 0:
            return int(value)
    return 0


def extract_minutes_per_game(stats_entry: Dict[str, Any]) -> float:
    for key in ["mpg", "minutesPerGame"]:
        value = num(stats_entry.get(key), -1)
        if value >= 0:
            return float(value)

    total_minutes = None
    for key in ["min", "minutes", "totMinutes", "totalMinutes"]:
        value = num(stats_entry.get(key), -1)
        if value >= 0:
            total_minutes = float(value)
            break

    gp = extract_games_played(stats_entry)
    if total_minutes is not None and gp > 0:
        return total_minutes / gp

    return 0.0


def extract_points_per_game(stats_entry: Dict[str, Any]) -> float:
    for key in ["ppg", "pointsPerGame"]:
        value = num(stats_entry.get(key), -1)
        if value >= 0:
            return float(value)

    total_points = None
    for key in ["pts", "points"]:
        value = num(stats_entry.get(key), -1)
        if value >= 0:
            total_points = float(value)
            break

    gp = extract_games_played(stats_entry)
    if total_points is not None and gp > 0:
        return total_points / gp

    return 0.0


def get_age_base_probability(age: int) -> float:
    if age <= 32:
        return 0.0
    if age == 33:
        return 0.02
    if age == 34:
        return 0.05
    if age == 35:
        return 0.10
    if age == 36:
        return 0.18
    if age == 37:
        return 0.28
    if age == 38:
        return 0.40
    if age == 39:
        return 0.52
    if age == 40:
        return 0.65
    if age == 41:
        return 0.78
    if age == 42:
        return 0.88
    if age == 43:
        return 0.95
    return 1.0


def get_overall_rating_adjustment(overall: float) -> float:
    if overall >= 90:
        return -0.20
    if overall >= 85:
        return -0.15
    if overall >= 80:
        return -0.10
    if overall >= 75:
        return -0.05
    if overall >= 72:
        return 0.0
    if overall >= 70:
        return 0.10
    if overall >= 69:
        return 0.22
    if overall >= 68:
        return 0.32
    if overall >= 66:
        return 0.40
    if overall >= 64:
        return 0.48
    if overall >= 60:
        return 0.55
    return 0.65


def get_remaining_guaranteed_years(player: Dict[str, Any], season_year: int) -> int:
    contract = player.get("contract") or {}
    start_year = int(num(contract.get("startYear"), season_year))
    salary_by_year = contract.get("salaryByYear", [])

    if not isinstance(salary_by_year, list) or not salary_by_year:
        return 0

    remaining = 0
    for idx, amount in enumerate(salary_by_year):
        current_year = start_year + idx
        if current_year >= season_year and num(amount, 0) > 0:
            remaining += 1

    return remaining


def get_free_agent_last_team_name(player: Dict[str, Any]) -> str:
    possible_keys = [
        "lastTeam",
        "previousTeam",
        "formerTeam",
        "team",
        "rightsHeldBy",
        "lastKnownTeam",
    ]

    for key in possible_keys:
        value = player.get(key)
        if isinstance(value, str) and value.strip():
            normalized = value.strip()
            if normalized.lower() not in ["free agent", "free agency", "fa", "none"]:
                return normalized

    return "Free Agency"


def add_free_agent_pool_ref(
    refs: List[Tuple[Dict[str, Any], str, List[Dict[str, Any]], str]],
    seen_pool_ids: set,
    container: Dict[str, Any],
    key: str,
    label: str,
) -> None:
    pool = container.get(key)

    if not isinstance(pool, list):
        return

    pool_id = id(pool)
    if pool_id in seen_pool_ids:
        return

    seen_pool_ids.add(pool_id)
    refs.append((container, key, pool, label))


def get_free_agent_pool_refs(
    league_data: Dict[str, Any],
) -> List[Tuple[Dict[str, Any], str, List[Dict[str, Any]], str]]:
    refs: List[Tuple[Dict[str, Any], str, List[Dict[str, Any]], str]] = []
    seen_pool_ids = set()

    top_level_list_keys = [
        "freeAgents",
        "freeAgentPool",
        "availableFreeAgents",
        "unsignedPlayers",
        "freeAgentsPool",
    ]

    for key in top_level_list_keys:
        add_free_agent_pool_ref(
            refs = refs,
            seen_pool_ids = seen_pool_ids,
            container = league_data,
            key = key,
            label = "Free Agency",
        )

    top_level_object_keys = [
        "freeAgency",
        "freeAgentMarket",
        "freeAgentData",
    ]

    nested_list_keys = [
        "players",
        "freeAgents",
        "freeAgentPool",
        "availablePlayers",
        "availableFreeAgents",
        "unsignedPlayers",
        "pool",
        "list",
    ]

    for object_key in top_level_object_keys:
        value = league_data.get(object_key)

        if isinstance(value, list):
            pool_id = id(value)
            if pool_id not in seen_pool_ids:
                seen_pool_ids.add(pool_id)
                refs.append((league_data, object_key, value, "Free Agency"))

        if isinstance(value, dict):
            for nested_key in nested_list_keys:
                add_free_agent_pool_ref(
                    refs = refs,
                    seen_pool_ids = seen_pool_ids,
                    container = value,
                    key = nested_key,
                    label = "Free Agency",
                )

    return refs


def compute_retirement_probability(
    player: Dict[str, Any],
    team_name: str,
    stats_by_key: Optional[Dict[str, Any]] = None,
    settings: Optional[Dict[str, Any]] = None,
    season_year: Optional[int] = None,
) -> Dict[str, Any]:
    current_year = int(season_year or DEFAULT_SEASON_YEAR)

    name = player.get("name") or player.get("player") or "Unknown"
    age = int(num(player.get("age"), 25))
    overall = num(player.get("overall", player.get("ovr")), 75)
    potential = num(player.get("potential", player.get("pot")), overall)

    stats_entry = get_player_stats_entry(stats_by_key, name, team_name)
    gp = extract_games_played(stats_entry)
    mpg = extract_minutes_per_game(stats_entry)
    ppg = extract_points_per_game(stats_entry)

    age_base_probability = get_age_base_probability(age)
    overall_adjustment = get_overall_rating_adjustment(overall)

    if age <= 32:
        probability = 0.0
    elif age >= 44:
        probability = 1.0
    else:
        probability = age_base_probability + overall_adjustment
        probability = clamp(probability, 0.0, 0.99)

    remaining_years = get_remaining_guaranteed_years(player, current_year)

    return {
        "playerName": name,
        "teamName": team_name,
        "age": age,
        "overall": int(round(overall)),
        "potential": int(round(potential)),
        "gamesPlayed": gp,
        "minutesPerGame": round(mpg, 1),
        "pointsPerGame": round(ppg, 1),
        "remainingGuaranteedYears": remaining_years,
        "ageBaseProbability": round(age_base_probability, 4),
        "overallAdjustment": round(overall_adjustment, 4),
        "retirementProbability": round(probability, 4),
    }


def apply_player_retirements(
    league_data: Dict[str, Any],
    stats_by_key: Optional[Dict[str, Any]] = None,
    settings: Optional[Dict[str, Any]] = None,
    seed: Optional[int] = None,
    season_year: Optional[int] = None,
) -> Dict[str, Any]:
    updated = copy.deepcopy(league_data)
    current_year = int(season_year or get_current_season_year(updated))
    rng = random.Random(seed if seed is not None else current_year)

    retired_players: List[Dict[str, Any]] = []
    teams_affected = set()

    # 1. Check all rostered players
    for _, _, team in iter_teams(updated):
        team_name = team.get("name", "Unknown Team")
        old_players = team.get("players", [])
        kept_players = []

        for player in old_players:
            if not isinstance(player, dict):
                kept_players.append(player)
                continue

            retirement_eval = compute_retirement_probability(
                player = player,
                team_name = team_name,
                stats_by_key = stats_by_key,
                settings = settings,
                season_year = current_year,
            )

            retirement_eval["currentStatus"] = "Rostered"
            retirement_eval["currentTeam"] = team_name

            probability = retirement_eval["retirementProbability"]
            roll = rng.random()

            auto_retire = retirement_eval["age"] >= 44
            should_retire = auto_retire or (roll < probability)

            if should_retire:
                retired_record = copy.deepcopy(player)

                retired_record["retired"] = True
                retired_record["retiredSeasonYear"] = current_year
                retired_record["retiredFromTeam"] = team_name
                retired_record["retirementSource"] = "Roster"
                retired_record["retirementProbability"] = probability
                retired_record["retirementRoll"] = round(roll, 4)
                retired_record["retirementSnapshot"] = retirement_eval

                retired_players.append(retired_record)
                teams_affected.add(team_name)
            else:
                kept_players.append(player)

        team["players"] = kept_players

    # 2. Check all free-agent pools
    free_agent_pool_refs = get_free_agent_pool_refs(updated)

    for free_agent_container, free_agent_key, free_agents, pool_label in free_agent_pool_refs:
        kept_free_agents = []

        for player in free_agents:
            if not isinstance(player, dict):
                kept_free_agents.append(player)
                continue

            last_team_name = get_free_agent_last_team_name(player)

            retirement_eval = compute_retirement_probability(
                player = player,
                team_name = last_team_name,
                stats_by_key = stats_by_key,
                settings = settings,
                season_year = current_year,
            )

            retirement_eval["currentStatus"] = "Free Agent"
            retirement_eval["currentTeam"] = "Free Agency"
            retirement_eval["lastKnownTeam"] = last_team_name
            retirement_eval["freeAgentPoolKey"] = free_agent_key

            probability = retirement_eval["retirementProbability"]
            roll = rng.random()

            auto_retire = retirement_eval["age"] >= 44
            should_retire = auto_retire or (roll < probability)

            if should_retire:
                retired_record = copy.deepcopy(player)

                retired_record["retired"] = True
                retired_record["retiredSeasonYear"] = current_year
                retired_record["retiredFromTeam"] = "Free Agency"
                retired_record["lastKnownTeam"] = last_team_name
                retired_record["retirementSource"] = pool_label
                retired_record["retirementPoolKey"] = free_agent_key
                retired_record["retirementProbability"] = probability
                retired_record["retirementRoll"] = round(roll, 4)
                retired_record["retirementSnapshot"] = retirement_eval

                retired_players.append(retired_record)
                teams_affected.add("Free Agency")
            else:
                kept_free_agents.append(player)

        free_agent_container[free_agent_key] = kept_free_agents

    retired_players.sort(
        key = lambda p: (
            -int(num(p.get("age"), 0)),
            -int(num(p.get("overall", p.get("ovr")), 0)),
            str(p.get("name", "")),
        )
    )

    history = updated.setdefault("retiredPlayersHistory", [])
    history.extend(copy.deepcopy(retired_players))

    avg_age = 0.0
    avg_ovr = 0.0
    if retired_players:
        avg_age = sum(num(p.get("age"), 0) for p in retired_players) / len(retired_players)
        avg_ovr = sum(num(p.get("overall", p.get("ovr")), 0) for p in retired_players) / len(retired_players)

    summary = {
        "retiredCount": len(retired_players),
        "teamsAffected": len(teams_affected),
        "teamNames": sorted(teams_affected),
        "averageAge": round(avg_age, 1) if retired_players else 0.0,
        "averageOverall": round(avg_ovr, 1) if retired_players else 0.0,
        "seasonYear": current_year,
        "seed": seed if seed is not None else current_year,
        "checkedFreeAgentPools": len(free_agent_pool_refs),
    }

    return {
        "ok": True,
        "leagueData": updated,
        "retiredPlayers": retired_players,
        "summary": summary,
    }


def preview_player_retirements(
    league_data: Dict[str, Any],
    stats_by_key: Optional[Dict[str, Any]] = None,
    settings: Optional[Dict[str, Any]] = None,
    season_year: Optional[int] = None,
) -> Dict[str, Any]:
    current_year = int(season_year or get_current_season_year(league_data))
    previews = []

    # 1. Preview rostered players
    for _, _, team in iter_teams(league_data):
        team_name = team.get("name", "Unknown Team")
        for player in team.get("players", []):
            if not isinstance(player, dict):
                continue

            preview = compute_retirement_probability(
                player = player,
                team_name = team_name,
                stats_by_key = stats_by_key,
                settings = settings,
                season_year = current_year,
            )

            preview["currentStatus"] = "Rostered"
            preview["currentTeam"] = team_name

            previews.append(preview)

    # 2. Preview free agents
    free_agent_pool_refs = get_free_agent_pool_refs(league_data)

    for _, free_agent_key, free_agents, pool_label in free_agent_pool_refs:
        for player in free_agents:
            if not isinstance(player, dict):
                continue

            last_team_name = get_free_agent_last_team_name(player)

            preview = compute_retirement_probability(
                player = player,
                team_name = last_team_name,
                stats_by_key = stats_by_key,
                settings = settings,
                season_year = current_year,
            )

            preview["currentStatus"] = "Free Agent"
            preview["currentTeam"] = "Free Agency"
            preview["lastKnownTeam"] = last_team_name
            preview["freeAgentPoolKey"] = free_agent_key
            preview["retirementSource"] = pool_label

            previews.append(preview)

    previews.sort(
        key = lambda row: (
            -num(row.get("retirementProbability"), 0),
            -num(row.get("age"), 0),
            -num(row.get("overall"), 0),
        )
    )

    return {
        "ok": True,
        "seasonYear": current_year,
        "checkedFreeAgentPools": len(free_agent_pool_refs),
        "preview": previews,
    }


def handle_request(request: Dict[str, Any]) -> Dict[str, Any]:
    action = request.get("action")
    league_data = request.get("leagueData", {})
    payload = request.get("payload", {}) or {}

    if action == "run_player_retirements":
        return apply_player_retirements(
            league_data = league_data,
            stats_by_key = payload.get("statsByKey", {}),
            settings = payload.get("settings", {}),
            seed = payload.get("seed"),
            season_year = payload.get("seasonYear"),
        )

    if action == "preview_player_retirements":
        return preview_player_retirements(
            league_data = league_data,
            stats_by_key = payload.get("statsByKey", {}),
            settings = payload.get("settings", {}),
            season_year = payload.get("seasonYear"),
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