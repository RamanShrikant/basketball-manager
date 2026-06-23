"""player_mood_logic.py

CPU/player morale model for the Locker Room page.

Design goals:
- Read the real league/team/player data already stored in leagueData.
- Reuse free-agency style concepts when available: team direction, role rank,
  and market value.
- Never mutate leagueData. This is a pure evaluation/reporting module.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, Tuple

try:
    from free_agency_logic import (  # type: ignore
        build_team_roster_profile as _fa_build_team_roster_profile,
        estimate_market_value as _fa_estimate_market_value,
        get_current_season_year as _fa_get_current_season_year,
        get_player_role_rank_on_team as _fa_get_player_role_rank_on_team,
    )
except Exception:  # pragma: no cover - Pyodide fallback path
    _fa_build_team_roster_profile = None
    _fa_estimate_market_value = None
    _fa_get_current_season_year = None
    _fa_get_player_role_rank_on_team = None

DEFAULT_SEASON_YEAR = 2026


def num(value: Any, fallback: float = 0.0) -> float:
    try:
        if value is None or value == "":
            return float(fallback)
        return float(value)
    except Exception:
        return float(fallback)


def clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def round_int(value: float) -> int:
    return int(round(float(value)))


def get_current_season_year(league_data: Dict[str, Any]) -> int:
    if _fa_get_current_season_year is not None:
        try:
            return int(_fa_get_current_season_year(league_data))
        except Exception:
            pass

    return int(
        num(
            league_data.get("seasonYear")
            or league_data.get("currentSeasonYear")
            or league_data.get("seasonStartYear"),
            DEFAULT_SEASON_YEAR,
        )
    )


def get_all_teams(league_data: Dict[str, Any]) -> List[Dict[str, Any]]:
    if isinstance(league_data.get("teams"), list):
        return [t for t in league_data.get("teams", []) if isinstance(t, dict)]

    teams: List[Dict[str, Any]] = []
    conferences = league_data.get("conferences")
    if isinstance(conferences, dict):
        for rows in conferences.values():
            if isinstance(rows, list):
                teams.extend([t for t in rows if isinstance(t, dict)])
    return teams


def normalize_name(value: Any) -> str:
    return "".join(ch.lower() for ch in str(value or "") if ch.isalnum())


def find_team(league_data: Dict[str, Any], team_name: Optional[str]) -> Optional[Dict[str, Any]]:
    teams = get_all_teams(league_data)
    if not teams:
        return None
    if not team_name:
        return teams[0]

    target = normalize_name(team_name)
    for team in teams:
        if normalize_name(team.get("name") or team.get("teamName")) == target:
            return team
    return teams[0]


def team_logo_of(team: Optional[Dict[str, Any]]) -> str:
    if not team:
        return ""
    return str(
        team.get("logo")
        or team.get("teamLogo")
        or team.get("newTeamLogo")
        or team.get("logoUrl")
        or team.get("image")
        or ""
    )


def get_team_name(team: Optional[Dict[str, Any]]) -> str:
    if not team:
        return ""
    return str(team.get("name") or team.get("teamName") or "")


def normalize_contract(contract: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not isinstance(contract, dict):
        return None
    salaries = contract.get("salaryByYear")
    if not isinstance(salaries, list) or not salaries:
        return None
    return {
        "startYear": int(num(contract.get("startYear"), DEFAULT_SEASON_YEAR)),
        "salaryByYear": [int(num(x, 0)) for x in salaries],
        "option": contract.get("option") if isinstance(contract.get("option"), dict) else None,
    }


def get_contract_salary_for_year(contract: Optional[Dict[str, Any]], season_year: int) -> int:
    contract = normalize_contract(contract)
    if not contract:
        return 0
    idx = int(season_year) - int(contract["startYear"])
    salaries = contract.get("salaryByYear") or []
    if idx < 0:
        idx = 0
    if idx >= len(salaries):
        return 0
    return int(num(salaries[idx], 0))


def get_contract_years_remaining(contract: Optional[Dict[str, Any]], season_year: int) -> int:
    contract = normalize_contract(contract)
    if not contract:
        return 0
    idx = int(season_year) - int(contract["startYear"])
    if idx < 0:
        idx = 0
    return max(0, len(contract.get("salaryByYear") or []) - idx)


def get_contract_option_label(contract: Optional[Dict[str, Any]]) -> Optional[str]:
    contract = normalize_contract(contract)
    option = contract.get("option") if contract else None
    if not isinstance(option, dict):
        return None
    option_type = str(option.get("type") or "").lower()
    if option_type == "player":
        return "Player Option"
    if option_type == "team":
        return "Team Option"
    return None


def fallback_market_value(player: Dict[str, Any]) -> Dict[str, Any]:
    overall = num(player.get("overall"), 75)
    age = int(num(player.get("age"), 27))
    potential = num(player.get("potential"), overall)
    upside = max(0.0, potential - overall)

    if overall >= 92:
        aav = 52_000_000
    elif overall >= 88:
        aav = 40_000_000 + (overall - 88) * 2_500_000
    elif overall >= 84:
        aav = 27_000_000 + (overall - 84) * 3_000_000
    elif overall >= 80:
        aav = 16_000_000 + (overall - 80) * 2_500_000
    elif overall >= 76:
        aav = 7_000_000 + (overall - 76) * 2_000_000
    elif overall >= 73:
        aav = 2_500_000 + (overall - 73) * 1_200_000
    else:
        aav = 1_500_000

    if age <= 24:
        aav *= 1.05 + min(0.18, upside * 0.025)
    elif age >= 33:
        aav *= max(0.66, 1.0 - ((age - 32) * 0.055))

    return {
        "expectedAAV": int(aav),
        "expectedYear1Salary": int(aav),
        "expectedYears": 4 if overall >= 80 and age <= 31 else 2 if overall >= 75 else 1,
        "minAcceptableAAV": int(aav * 0.90),
    }


def estimate_market_value(player: Dict[str, Any]) -> Dict[str, Any]:
    if _fa_estimate_market_value is not None:
        try:
            result = _fa_estimate_market_value(player)
            if isinstance(result, dict):
                return result
        except Exception:
            pass
    return fallback_market_value(player)


def read_record(team: Dict[str, Any]) -> Tuple[int, int, Optional[float]]:
    wins = num(team.get("wins"), 0)
    losses = num(team.get("losses"), 0)

    if wins == 0 and losses == 0:
        record = team.get("record") if isinstance(team.get("record"), dict) else {}
        wins = num(record.get("wins"), 0)
        losses = num(record.get("losses"), 0)

    if wins == 0 and losses == 0:
        season_record = team.get("seasonRecord") if isinstance(team.get("seasonRecord"), dict) else {}
        wins = num(season_record.get("wins"), 0)
        losses = num(season_record.get("losses"), 0)

    games = wins + losses
    return int(wins), int(losses), (wins / games if games > 0 else None)


def get_team_history_rows(league_data: Dict[str, Any], team_name: str, max_seasons: int = 3) -> List[Dict[str, Any]]:
    history = league_data.get("seasonHistory")
    if not isinstance(history, list):
        return []

    rows: List[Dict[str, Any]] = []
    target = normalize_name(team_name)
    for season in history:
        if not isinstance(season, dict):
            continue
        teams = season.get("teams")
        if not isinstance(teams, list):
            continue
        for row in teams:
            if not isinstance(row, dict):
                continue
            if normalize_name(row.get("teamName") or row.get("name")) != target:
                continue
            copied = dict(row)
            copied["seasonYear"] = season.get("seasonYear")
            copied["championTeam"] = season.get("champion")
            rows.append(copied)
            break

    rows.sort(key=lambda r: int(num(r.get("seasonYear"), 0)), reverse=True)
    return rows[:max_seasons]


def fallback_team_profile(team: Dict[str, Any], league_data: Dict[str, Any]) -> Dict[str, Any]:
    players = [p for p in team.get("players", []) if isinstance(p, dict)]
    ranked = sorted(players, key=lambda p: num(p.get("overall"), 0), reverse=True)
    top3 = ranked[:3]
    top8 = ranked[:8]
    top3_ovr = sum(num(p.get("overall"), 0) for p in top3) / max(1, len(top3))
    top8_ovr = sum(num(p.get("overall"), 0) for p in top8) / max(1, len(top8))
    core_age = sum(num(p.get("age"), 27) for p in top8) / max(1, len(top8))
    young_count = sum(1 for p in ranked if num(p.get("overall"), 0) >= 76 and num(p.get("age"), 27) <= 25)
    star_count = sum(1 for p in ranked if num(p.get("overall"), 0) >= 85)
    wins, losses, win_pct = read_record(team)

    if win_pct is not None and win_pct >= 0.60:
        direction = "contending"
    elif win_pct is not None and win_pct >= 0.50:
        direction = "win now"
    elif win_pct is not None and win_pct <= 0.34 and young_count >= 2:
        direction = "rebuilding"
    elif top3_ovr >= 84 and top8_ovr >= 78:
        direction = "contending"
    elif core_age <= 26.5 and young_count >= 3:
        direction = "rebuilding"
    elif top8_ovr >= 76:
        direction = "retooling"
    else:
        direction = "balanced"

    return {
        "direction": direction,
        "directionConfidence": 0.62,
        "top3Overall": round(top3_ovr, 1),
        "top8Overall": round(top8_ovr, 1),
        "coreAge": round(core_age, 1),
        "starCount": star_count,
        "youngCoreCount": young_count,
        "resultsProfile": {
            "historyAvailable": False,
            "lastSeasonWins": None,
            "lastSeasonLosses": None,
            "recentWinPct": win_pct,
        },
        "directionReasons": ["Roster and current record were used to infer team direction."],
    }


def build_team_profile(team: Dict[str, Any], league_data: Dict[str, Any]) -> Dict[str, Any]:
    if _fa_build_team_roster_profile is not None:
        try:
            profile = _fa_build_team_roster_profile(team, league_data=league_data)
            if isinstance(profile, dict):
                return profile
        except Exception:
            pass
    return fallback_team_profile(team, league_data)


def player_key(player: Dict[str, Any]) -> str:
    pid = player.get("id") or player.get("playerId") or player.get("uuid")
    if pid not in [None, ""]:
        return f"id:{pid}"
    return f"name:{player.get('name') or player.get('player') or ''}"


def same_player(a: Dict[str, Any], b: Dict[str, Any]) -> bool:
    return player_key(a) == player_key(b)


def get_role_rank_on_team(team: Dict[str, Any], player: Dict[str, Any]) -> int:
    if _fa_get_player_role_rank_on_team is not None:
        try:
            return int(_fa_get_player_role_rank_on_team(team, player))
        except Exception:
            pass

    players = [p for p in team.get("players", []) if isinstance(p, dict)]
    ranked = sorted(
        players,
        key=lambda p: (
            -num(p.get("overall"), 0),
            -num(p.get("potential"), num(p.get("overall"), 0)),
            num(p.get("age"), 27),
        ),
    )
    for idx, row in enumerate(ranked, start=1):
        if same_player(row, player):
            return idx
    return len(ranked) + 1


def get_roster_players_with_status(team: Dict[str, Any]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for p in team.get("players", []) or []:
        if isinstance(p, dict):
            row = dict(p)
            row["moodRosterStatus"] = "standard"
            out.append(row)
    for p in team.get("twoWayPlayers", []) or []:
        if isinstance(p, dict):
            row = dict(p)
            row["moodRosterStatus"] = "two_way"
            row["isTwoWay"] = True
            out.append(row)
    for p in team.get("stashPlayers", []) or []:
        if isinstance(p, dict):
            row = dict(p)
            row["moodRosterStatus"] = "stash"
            row["isStash"] = True
            out.append(row)
    return out


def get_latest_stats_row(player: Dict[str, Any]) -> Dict[str, Any]:
    for key in ["currentStats", "seasonStats", "stats", "totals"]:
        raw = player.get(key)
        if isinstance(raw, dict):
            return raw

    history = player.get("history") if isinstance(player.get("history"), dict) else {}
    seasons = history.get("seasons") if isinstance(history.get("seasons"), list) else []
    for row in reversed(seasons):
        if isinstance(row, dict) and not row.get("rowType") == "total":
            gp = num(row.get("games") or row.get("gp") or row.get("GP"), 0)
            if gp > 0:
                return row
    return {}


def read_stat(row: Dict[str, Any], keys: List[str], fallback: float = 0.0) -> float:
    for key in keys:
        if key in row:
            return num(row.get(key), fallback)
    return fallback


def get_player_stats_summary(player: Dict[str, Any]) -> Dict[str, Any]:
    row = get_latest_stats_row(player)
    gp = read_stat(row, ["games", "gp", "GP", "g"], 0)
    mpg = read_stat(row, ["mpg", "minutesPerGame", "min", "minutes", "MP"], 0)
    ppg = read_stat(row, ["ppg", "pointsPerGame", "pts", "points", "PTS"], 0)
    rpg = read_stat(row, ["rpg", "reboundsPerGame", "reb", "trb", "REB"], 0)
    apg = read_stat(row, ["apg", "assistsPerGame", "ast", "AST"], 0)

    # If totals are stored instead of per-game, convert when possible.
    if gp > 0:
        if ppg > 60:
            ppg = ppg / gp
        if rpg > 35:
            rpg = rpg / gp
        if apg > 25:
            apg = apg / gp
        if mpg > 82:
            mpg = mpg / gp

    return {
        "games": round_int(gp),
        "minutesPerGame": round(mpg, 1),
        "pointsPerGame": round(ppg, 1),
        "reboundsPerGame": round(rpg, 1),
        "assistsPerGame": round(apg, 1),
        "source": "current_or_latest_history" if row else "none",
    }


# ------------------------------------------------------------
# GAMEPLAN / MINUTES CONTEXT
# ------------------------------------------------------------
# Coach Gameplan minutes currently live on the JS side in localStorage, not on
# each player stat row. LockerRoom.jsx passes a tiny gameplan snapshot through
# leagueData.moodGameplansByTeam so the Python mood model can read the same
# rotation minutes the user sees on the Coach Gameplan page.

def get_matching_map_value(raw: Dict[str, Any], team_name: str) -> Optional[Any]:
    if not isinstance(raw, dict) or not team_name:
        return None

    keys_to_try = [
        team_name,
        normalize_name(team_name),
        team_name.lower(),
        team_name.upper(),
    ]

    for key in keys_to_try:
        if key in raw:
            return raw.get(key)

    target = normalize_name(team_name)
    for key, value in raw.items():
        if normalize_name(key) == target:
            return value

    return None


def get_team_gameplan_snapshot(league_data: Dict[str, Any], team: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    team_name = get_team_name(team)

    for key in [
        "moodGameplansByTeam",
        "gameplansByTeam",
        "gamePlansByTeam",
        "coachGameplansByTeam",
        "gameplans",
        "gamePlans",
    ]:
        raw = league_data.get(key)
        found = get_matching_map_value(raw, team_name) if isinstance(raw, dict) else None
        if isinstance(found, dict) and isinstance(found.get("minutes"), dict):
            return found

    for key in ["gameplan", "gamePlan", "coachGameplan", "rotationPlan"]:
        raw = team.get(key)
        if isinstance(raw, dict) and isinstance(raw.get("minutes"), dict):
            return raw

    raw_minutes = team.get("minutes") or team.get("playerMinutes") or team.get("rotationMinutes")
    if isinstance(raw_minutes, dict):
        return {"teamName": team_name, "source": "team_minutes_map", "minutes": raw_minutes}

    return None


def get_gameplan_minutes_for_player(
    league_data: Dict[str, Any],
    team: Dict[str, Any],
    player: Dict[str, Any],
) -> float:
    snapshot = get_team_gameplan_snapshot(league_data, team)
    minutes = snapshot.get("minutes") if isinstance(snapshot, dict) else None
    if not isinstance(minutes, dict):
        return 0.0

    candidate_keys = []
    for key in ["name", "player", "playerName"]:
        value = player.get(key)
        if value not in [None, ""]:
            candidate_keys.append(str(value))

    for key in ["id", "playerId", "uuid"]:
        value = player.get(key)
        if value not in [None, ""]:
            candidate_keys.extend([str(value), f"id:{value}"])

    for key in candidate_keys:
        if key in minutes:
            return max(0.0, num(minutes.get(key), 0))

    normalized_minutes = {
        normalize_name(key): value
        for key, value in minutes.items()
        if key not in [None, ""]
    }
    for key in candidate_keys:
        normalized_key = normalize_name(key)
        if normalized_key in normalized_minutes:
            return max(0.0, num(normalized_minutes.get(normalized_key), 0))

    return 0.0


def apply_gameplan_minutes_fallback(
    stats: Dict[str, Any],
    planned_mpg: float,
) -> Dict[str, Any]:
    out = dict(stats or {})
    planned = max(0.0, num(planned_mpg, 0))
    actual_mpg = max(0.0, num(out.get("minutesPerGame"), 0))

    out["plannedMinutesPerGame"] = round(planned, 1)

    if actual_mpg > 0:
        out["minutesSource"] = out.get("source") or "player_stats"
        return out

    if planned > 0:
        out["minutesPerGame"] = round(planned, 1)
        out["minutesSource"] = "coach_gameplan"
        source = str(out.get("source") or "none")
        out["source"] = f"{source}+coach_gameplan_fallback"
    else:
        out["minutesSource"] = out.get("source") or "none"

    return out


def get_team_games_played_context(team: Dict[str, Any]) -> int:
    wins, losses, _ = read_record(team)
    if wins + losses > 0:
        return int(wins + losses)

    max_gp = 0
    for player in get_roster_players_with_status(team):
        row = get_latest_stats_row(player)
        gp = int(round(read_stat(row, ["games", "gp", "GP", "g"], 0)))
        max_gp = max(max_gp, gp)

    return int(max_gp)


def expected_role_from_overall(overall: float, potential: float, age: int) -> Dict[str, Any]:
    if overall >= 90:
        return {"label": "Franchise Star", "maxRank": 1, "minutes": 34}
    if overall >= 86:
        return {"label": "All-Star / Lead Option", "maxRank": 2, "minutes": 32}
    if overall >= 82:
        return {"label": "Top Starter", "maxRank": 4, "minutes": 29}
    if overall >= 79:
        return {"label": "Starter", "maxRank": 5, "minutes": 26}
    if overall >= 76:
        return {"label": "Rotation Player", "maxRank": 9, "minutes": 18}
    if potential >= 80 and age <= 24:
        return {"label": "Development Prospect", "maxRank": 11, "minutes": 12}
    return {"label": "Depth", "maxRank": 15, "minutes": 8}


def actual_role_from_rank(rank: int, status: str) -> str:
    if status == "two_way":
        return "Two-Way"
    if status == "stash":
        return "Stash"
    if rank <= 1:
        return "First Option"
    if rank <= 3:
        return "Core Player"
    if rank <= 5:
        return "Starter"
    if rank <= 9:
        return "Rotation"
    return "Bench / Depth"


def add_reason(reasons: List[Dict[str, Any]], category: str, impact: float, text: str, detail: str = "") -> None:
    reasons.append({
        "category": category,
        "impact": round(impact, 1),
        "text": text,
        "detail": detail,
    })


def evaluate_player_mood(
    league_data: Dict[str, Any],
    team: Dict[str, Any],
    team_profile: Dict[str, Any],
    player: Dict[str, Any],
) -> Dict[str, Any]:
    season_year = get_current_season_year(league_data)
    team_name = get_team_name(team)
    status = str(player.get("moodRosterStatus") or player.get("rosterStatus") or "standard")
    overall = num(player.get("overall"), 0)
    potential = num(player.get("potential"), overall)
    age = int(num(player.get("age"), 27))
    upside = max(0.0, potential - overall)
    rank = get_role_rank_on_team(team, player) if status == "standard" else 99
    expected_role = expected_role_from_overall(overall, potential, age)
    actual_role = actual_role_from_rank(rank, status)
    wins, losses, win_pct = read_record(team)
    profile_results = team_profile.get("resultsProfile") if isinstance(team_profile.get("resultsProfile"), dict) else {}
    direction = str(team_profile.get("direction") or "balanced")
    raw_stats = get_player_stats_summary(player)
    planned_mpg = get_gameplan_minutes_for_player(league_data, team, player)
    stats = apply_gameplan_minutes_fallback(raw_stats, planned_mpg)
    team_games_played = get_team_games_played_context(team)
    if team_games_played > 0:
        stats["teamGamesContext"] = int(team_games_played)
    market = estimate_market_value(player)
    contract = normalize_contract(player.get("contract"))
    salary = get_contract_salary_for_year(contract, season_year)
    years_left = get_contract_years_remaining(contract, season_year)
    option_label = get_contract_option_label(contract)
    expected_aav = int(num(market.get("expectedAAV") or market.get("expectedYear1Salary"), 0))
    meta = player.get("meta") if isinstance(player.get("meta"), dict) else {}
    years_with_team = int(num(meta.get("yearsWithCurrentTeam"), 0))

    factors = {
        "teamPerformance": 0.0,
        "role": 0.0,
        "playingTime": 0.0,
        "availability": 0.0,
        "contract": 0.0,
        "futureSecurity": 0.0,
        "careerStage": 0.0,
        "teamFit": 0.0,
        "continuity": 0.0,
    }
    reasons: List[Dict[str, Any]] = []

    # Team performance and direction.
    effective_win_pct = win_pct
    if effective_win_pct is None:
        effective_win_pct = profile_results.get("recentWinPct") if isinstance(profile_results, dict) else None
    if effective_win_pct is not None:
        if effective_win_pct >= 0.650:
            factors["teamPerformance"] += 12
            add_reason(reasons, "Team Success", 12, f"{team_name} is playing like a top contender.", f"Record context: {wins}-{losses}")
        elif effective_win_pct >= 0.550:
            factors["teamPerformance"] += 7
            add_reason(reasons, "Team Success", 7, f"Winning situation is helping morale.", f"Record context: {wins}-{losses}")
        elif effective_win_pct >= 0.470:
            factors["teamPerformance"] += 1
        elif effective_win_pct <= 0.300:
            penalty = -13 if age >= 27 or overall >= 82 else -6
            factors["teamPerformance"] += penalty
            add_reason(reasons, "Team Performance", penalty, "Losing is weighing on him.", f"Record context: {wins}-{losses}")
        elif effective_win_pct <= 0.400:
            penalty = -8 if age >= 27 or overall >= 80 else -4
            factors["teamPerformance"] += penalty
            add_reason(reasons, "Team Performance", penalty, "Team results are below expectations.", f"Record context: {wins}-{losses}")

    if direction in ["contending", "win now"] and age >= 29 and overall >= 76:
        factors["teamFit"] += 4
        add_reason(reasons, "Team Fit", 4, "His career stage fits a win-now team.")
    if direction == "rebuilding" and age <= 24 and upside >= 3:
        factors["teamFit"] += 5
        add_reason(reasons, "Development Fit", 5, "A rebuilding timeline gives his development more room.")
    if direction == "rebuilding" and age >= 30 and overall >= 80:
        factors["teamFit"] -= 8
        add_reason(reasons, "Timeline", -8, "Veteran talent may be impatient with a rebuild.")

    # Role and hierarchy.
    if status == "standard":
        expected_max_rank = int(expected_role["maxRank"])
        if rank <= expected_max_rank:
            bonus = 6 if overall >= 80 else 3
            factors["role"] += bonus
            add_reason(reasons, "Role", bonus, "His team role matches his talent level.", f"Role rank: #{rank}")
        else:
            gap = rank - expected_max_rank
            penalty = -min(18, 4 + gap * 2.5)
            if age <= 24 and upside >= 4:
                penalty -= 4
            factors["role"] += penalty
            add_reason(reasons, "Role", penalty, "He may feel underused relative to his talent.", f"Expected: {expected_role['label']}; current rank: #{rank}")

        mpg = float(num(stats.get("minutesPerGame"), 0))
        expected_mpg = float(expected_role["minutes"])
        minutes_source = str(stats.get("minutesSource") or stats.get("source") or "")
        if mpg > 0:
            if minutes_source == "coach_gameplan":
                minute_detail = f"Current gameplan: {mpg:.1f} MPG"
            else:
                planned_detail = float(num(stats.get("plannedMinutesPerGame"), 0))
                minute_detail = f"{mpg:.1f} MPG"
                if planned_detail > 0:
                    minute_detail += f"; current gameplan {planned_detail:.1f}"

            if mpg >= expected_mpg - 3:
                factors["playingTime"] += 4
                add_reason(reasons, "Playing Time", 4, "Minutes look aligned with his expected role.", minute_detail)
            elif mpg <= max(4, expected_mpg - 10):
                penalty = -min(16, (expected_mpg - mpg) * 0.85)
                factors["playingTime"] += penalty
                add_reason(reasons, "Playing Time", penalty, "His minutes are below what a player like him expects.", f"{minute_detail} vs expected around {expected_mpg:.0f}")
        elif overall >= 78:
            factors["playingTime"] -= 5
            add_reason(reasons, "Playing Time", -5, "No reliable minutes or gameplan data found for a rotation-level player.")
    elif status == "two_way":
        if overall >= 73 or potential >= 78:
            factors["role"] -= 7
            add_reason(reasons, "Role", -7, "He may want a standard roster spot soon.", "Currently two-way")
        else:
            factors["careerStage"] += 2
            add_reason(reasons, "Development", 2, "Two-way status is reasonable for his current stage.")
    elif status == "stash":
        if potential >= 78:
            factors["futureSecurity"] -= 4
            add_reason(reasons, "Development", -4, "He may want clarity on when he joins the NBA roster.", "Currently stashed")

    # Contract / next deal pressure.
    if salary > 0 and expected_aav > 0:
        salary_ratio = salary / max(1, expected_aav)
        if salary_ratio <= 0.55 and overall >= 78:
            penalty = -10 if years_left <= 2 else -6
            factors["contract"] += penalty
            add_reason(reasons, "Contract", penalty, "He appears underpaid compared with his current market value.", f"Salary ${salary:,}; estimated market AAV ${expected_aav:,}")
        elif salary_ratio >= 1.10:
            factors["contract"] += 4
            add_reason(reasons, "Contract", 4, "Contract security is helping his mood.", f"Salary ${salary:,}")
        elif salary_ratio >= 0.85:
            factors["contract"] += 2

    if years_left <= 0:
        factors["futureSecurity"] -= 7
        add_reason(reasons, "Next Contract", -7, "No secure future salary is stored for him.")
    elif years_left == 1:
        if overall >= 80 or age <= 25:
            factors["futureSecurity"] -= 6
            add_reason(reasons, "Next Contract", -6, "He is entering a contract year and thinking about his next deal.")
        else:
            factors["futureSecurity"] -= 2
    elif years_left >= 3:
        factors["futureSecurity"] += 4
        add_reason(reasons, "Security", 4, "Multi-year security is stabilizing his mood.", f"{years_left} years left")

    if option_label:
        option_penalty = -3 if option_label == "Team Option" and overall >= 76 else -1
        factors["futureSecurity"] += option_penalty
        add_reason(reasons, "Option Year", option_penalty, f"{option_label} adds some uncertainty.")

    # Performance / production context.
    gp = int(num(stats.get("games"), 0))
    ppg = float(num(stats.get("pointsPerGame"), 0))
    if gp > 0:
        if overall >= 84 and ppg >= 20:
            factors["careerStage"] += 3
            add_reason(reasons, "Production", 3, "His production matches a lead-player role.", f"{ppg:.1f} PPG")
        elif overall >= 84 and ppg < 14:
            factors["careerStage"] -= 5
            add_reason(reasons, "Production", -5, "His box-score role may not match his star talent.", f"{ppg:.1f} PPG")
        elif 76 <= overall < 84 and ppg >= 12:
            factors["careerStage"] += 2
        if team_games_played > 0:
            missed_games = max(0, int(team_games_played) - gp)
            played_share = gp / max(1, int(team_games_played))
            if (
                int(team_games_played) >= 20
                and missed_games >= 8
                and played_share < 0.75
                and not player.get("injury")
            ):
                availability_penalty = -5 if played_share < 0.45 else -3
                factors["availability"] += availability_penalty
                add_reason(
                    reasons,
                    "Availability",
                    availability_penalty,
                    "Low games played may be affecting rhythm or role security.",
                    f"{gp} GP out of roughly {int(team_games_played)} team games",
                )

    # Young upside buried on depth chart.
    if age <= 23 and potential >= overall + 5 and status == "standard" and rank > 9:
        factors["careerStage"] -= 8
        add_reason(reasons, "Development", -8, "Young upside player is buried on the depth chart.", f"POT {round_int(potential)} / rank #{rank}")

    # Continuity.
    if years_with_team >= 3 and effective_win_pct is not None and effective_win_pct >= 0.500:
        factors["continuity"] += 3
        add_reason(reasons, "Continuity", 3, "Winning with a familiar team helps stability.", f"{years_with_team} years with team")
    elif years_with_team >= 3 and effective_win_pct is not None and effective_win_pct < 0.400 and overall >= 80:
        factors["continuity"] -= 3
        add_reason(reasons, "Continuity", -3, "Long-term losing with the same team can create restlessness.")

    score = clamp(70 + sum(factors.values()), 0, 100)
    mood_score = round_int(score)

    if mood_score >= 88:
        label = "Thriving"
        tone = "elite"
    elif mood_score >= 76:
        label = "Happy"
        tone = "positive"
    elif mood_score >= 63:
        label = "Content"
        tone = "neutral"
    elif mood_score >= 50:
        label = "Uneasy"
        tone = "warning"
    elif mood_score >= 35:
        label = "Frustrated"
        tone = "negative"
    else:
        label = "Very Frustrated"
        tone = "critical"

    negative_reasons = [r for r in reasons if num(r.get("impact"), 0) < 0]
    if negative_reasons:
        main = sorted(negative_reasons, key=lambda r: num(r.get("impact"), 0))[0]
        main_concern = main.get("category") or "Role"
    else:
        main_concern = "None"

    if sum(factors.values()) >= 8:
        trend = "rising"
    elif sum(factors.values()) <= -8:
        trend = "falling"
    else:
        trend = "stable"

    # Put the most important reasons first: strongest negatives, then strongest positives.
    reasons_sorted = sorted(reasons, key=lambda r: (num(r.get("impact"), 0) >= 0, abs(num(r.get("impact"), 0))), reverse=True)

    return {
        "playerId": player.get("id") or player.get("playerId"),
        "playerKey": player_key(player),
        "playerName": player.get("name") or player.get("player") or "Unknown Player",
        "name": player.get("name") or player.get("player") or "Unknown Player",
        "headshot": player.get("headshot") or player.get("playerHeadshot") or player.get("image") or "",
        "position": player.get("pos") or player.get("position") or "-",
        "secondaryPos": player.get("secondaryPos") or player.get("secondaryPosition"),
        "age": age,
        "overall": round_int(overall),
        "potential": round_int(potential),
        "rosterStatus": status,
        "moodScore": mood_score,
        "moodLabel": label,
        "moodTone": tone,
        "trend": trend,
        "mainConcern": main_concern,
        "factors": {k: round(v, 1) for k, v in factors.items()},
        "reasons": reasons_sorted[:9],
        "role": {
            "rank": rank if status == "standard" else None,
            "actualRole": actual_role,
            "expectedRole": expected_role.get("label"),
            "expectedMinutes": expected_role.get("minutes"),
        },
        "contract": {
            "salary": int(salary),
            "yearsLeft": int(years_left),
            "optionLabel": option_label,
            "estimatedMarketAAV": int(expected_aav),
        },
        "stats": stats,
    }


def get_locker_room_moods(league_data: Dict[str, Any], team_name: Optional[str] = None) -> Dict[str, Any]:
    team = find_team(league_data, team_name)
    if not team:
        return {"ok": False, "reason": "No team found in leagueData.", "players": []}

    resolved_team_name = get_team_name(team)
    profile = build_team_profile(team, league_data)
    players = get_roster_players_with_status(team)
    rows = [evaluate_player_mood(league_data, team, profile, player) for player in players]

    rows.sort(key=lambda row: (row.get("moodScore", 0), -num(row.get("overall"), 0), str(row.get("playerName", ""))))

    avg = sum(num(row.get("moodScore"), 0) for row in rows) / max(1, len(rows))
    low_count = sum(1 for row in rows if num(row.get("moodScore"), 0) < 55)
    high_count = sum(1 for row in rows if num(row.get("moodScore"), 0) >= 76)

    return {
        "ok": True,
        "teamName": resolved_team_name,
        "teamLogo": team_logo_of(team),
        "seasonYear": get_current_season_year(league_data),
        "summary": {
            "averageMood": round(avg, 1),
            "lowMoodCount": low_count,
            "happyCount": high_count,
            "playerCount": len(rows),
            "teamDirection": profile.get("direction") or "balanced",
            "teamDirectionConfidence": profile.get("directionConfidence"),
            "top3Overall": profile.get("top3Overall"),
            "top8Overall": profile.get("top8Overall"),
        },
        "players": rows,
        "teamProfile": profile,
    }


def handle_request(request: Dict[str, Any]) -> Dict[str, Any]:
    try:
        action = request.get("action") if isinstance(request, dict) else None
        league_data = request.get("leagueData") if isinstance(request, dict) else None
        payload = request.get("payload") if isinstance(request, dict) else None
        if not isinstance(league_data, dict):
            league_data = {}
        if not isinstance(payload, dict):
            payload = {}

        if action in ["get_locker_room_moods", "locker_room_moods", "player_moods"]:
            return get_locker_room_moods(
                league_data=league_data,
                team_name=payload.get("teamName") or payload.get("selectedTeamName"),
            )

        return {"ok": False, "reason": f"Unknown player mood action: {action}", "players": []}
    except Exception as exc:
        return {"ok": False, "reason": str(exc), "players": []}


def get_locker_room_moods_json(request_json: str) -> str:
    try:
        request = json.loads(request_json or "{}")
        return json.dumps(handle_request(request))
    except Exception as exc:
        return json.dumps({"ok": False, "reason": str(exc), "players": []})
