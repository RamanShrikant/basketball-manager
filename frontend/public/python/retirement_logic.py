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
    if age <= 29:
        return 0.0
    if age == 30:
        return 0.002
    if age == 31:
        return 0.006
    if age == 32:
        return 0.015
    if age == 33:
        return 0.035
    if age == 34:
        return 0.075
    if age == 35:
        return 0.14
    if age == 36:
        return 0.24
    if age == 37:
        return 0.37
    if age == 38:
        return 0.53
    if age == 39:
        return 0.72
    if age == 40:
        return 0.86
    return 0.96


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


def compute_retirement_probability(
    player: Dict[str, Any],
    team_name: str,
    stats_by_key: Optional[Dict[str, Any]] = None,
    settings: Optional[Dict[str, Any]] = None,
    season_year: Optional[int] = None,
) -> Dict[str, Any]:
    settings = settings or {}
    current_year = int(season_year or DEFAULT_SEASON_YEAR)

    name = player.get("name") or player.get("player") or "Unknown"
    age = int(num(player.get("age"), 25))
    overall = num(player.get("overall", player.get("ovr")), 75)
    potential = num(player.get("potential", player.get("pot")), overall)

    stats_entry = get_player_stats_entry(stats_by_key, name, team_name)
    gp = extract_games_played(stats_entry)
    mpg = extract_minutes_per_game(stats_entry)
    ppg = extract_points_per_game(stats_entry)

    probability = get_age_base_probability(age)

    # Older lower-end players retire more often
    if age >= 32 and overall <= 74:
        probability += 0.05
    if age >= 33 and overall <= 70:
        probability += 0.08
    if age >= 35 and overall <= 67:
        probability += 0.10

    # Declining players are more likely to walk away
    if age >= 33 and potential <= overall - 4:
        probability += 0.04
    if age >= 35 and potential <= overall - 8:
        probability += 0.05

    # Deep bench / barely played players retire more often
    if age >= 33 and gp <= 12:
        probability += 0.08
    if age >= 34 and gp <= 5:
        probability += 0.08
    if age >= 33 and mpg > 0 and mpg < 10:
        probability += 0.06
    if age >= 35 and mpg > 0 and mpg < 6:
        probability += 0.07

    # Productive veterans hang on a bit longer
    if overall >= 82:
        probability -= 0.06
    if overall >= 87:
        probability -= 0.06
    if ppg >= 18:
        probability -= 0.04
    if mpg >= 28:
        probability -= 0.04
    if potential >= overall + 3:
        probability -= 0.03

    # Multi-year money can keep players around slightly longer in v1
    remaining_years = get_remaining_guaranteed_years(player, current_year)
    if remaining_years >= 2 and age <= 37:
        probability -= 0.03
    elif remaining_years >= 1 and age <= 35:
        probability -= 0.015

    # Settings knobs for your friend later
    global_age_bonus = num(settings.get("globalAgeBonus"), 0.0)
    global_probability_shift = num(settings.get("globalRetirementShift"), 0.0)

    if age >= int(num(settings.get("extraBonusAgeThreshold"), 99)):
        probability += global_age_bonus

    probability += global_probability_shift

    # Hard guards
    if age <= 27:
        probability = 0.0
    elif age <= 30:
        probability = min(probability, 0.015)
    elif age <= 32:
        probability = min(probability, 0.07)

    probability = clamp(probability, 0.0, 0.99)

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

    for _, _, team in iter_teams(updated):
        team_name = team.get("name", "Unknown Team")
        old_players = team.get("players", [])
        kept_players = []

        for player in old_players:
            retirement_eval = compute_retirement_probability(
                player = player,
                team_name = team_name,
                stats_by_key = stats_by_key,
                settings = settings,
                season_year = current_year,
            )

            probability = retirement_eval["retirementProbability"]
            roll = rng.random()

            auto_retire = retirement_eval["age"] >= 42
            should_retire = auto_retire or (roll < probability)

            if should_retire:
                retired_record = copy.deepcopy(player)

                retired_record["retired"] = True
                retired_record["retiredSeasonYear"] = current_year
                retired_record["retiredFromTeam"] = team_name
                retired_record["retirementProbability"] = probability
                retired_record["retirementRoll"] = round(roll, 4)
                retired_record["retirementSnapshot"] = retirement_eval

                retired_players.append(retired_record)
                teams_affected.add(team_name)
            else:
                kept_players.append(player)

        team["players"] = kept_players

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

    for _, _, team in iter_teams(league_data):
        team_name = team.get("name", "Unknown Team")
        for player in team.get("players", []):
            previews.append(
                compute_retirement_probability(
                    player = player,
                    team_name = team_name,
                    stats_by_key = stats_by_key,
                    settings = settings,
                    season_year = current_year,
                )
            )

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