"""player_mood_logic.py

Persistent-feeling morale model for the Locker Room page.

Drop this file into:
  frontend/public/python/player_mood_logic.py

What this version adds:
- Player expectations scale by talent, age, role, contract, and team context.
- Every player gets a dated mood ledger/event log instead of only a flat snapshot.
- Teams get preseason-style expectation tiers: rebuilding, retooling, play-in,
  playoff team, contender, title favorite.
- Mood reacts to expectation vs reality: surprise playoff runs boost morale;
  contenders underperforming or exiting early get punished hard.
- Stars/80s/90s are more expectation-sensitive. Depth 60s/70s are more stable
  and often happy to have role/security unless buried with upside.
- Selected real-player historical tags create preloaded context.
- Trade history / trade desk entries, if present in leagueData, create mood events.

Important:
- This module does not mutate leagueData. It returns a rich player ledger that
  the existing Locker Room UI can display through reasons/eventLog fields.
"""

from __future__ import annotations

import json
import math
from datetime import date as _date
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
MOOD_SYSTEM_VERSION = "2026-06-27_superstar_story_decay_v3"


# -----------------------------------------------------------------------------
# Basic helpers
# -----------------------------------------------------------------------------

def num(value: Any, fallback: float = 0.0) -> float:
    try:
        if value is None or value == "":
            return float(fallback)
        n = float(value)
        if math.isfinite(n):
            return n
    except Exception:
        pass
    return float(fallback)


def clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def round_int(value: float) -> int:
    return int(round(float(value)))


def normalize_name(value: Any) -> str:
    return "".join(ch.lower() for ch in str(value or "") if ch.isalnum())


def clean_text(value: Any) -> str:
    return " ".join(str(value or "").replace("\n", " ").split())


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



def get_current_display_season_year(league_data: Dict[str, Any]) -> int:
    """Return the basketball display season year.

    In this app, seasonYear is usually the start year of the season
    (2025 for the 2025-26 season), while player history rows use the
    display/end year (2026). The mood model should use the display year
    only to decide whether a history row is current-season/live data.
    """
    if not isinstance(league_data, dict):
        return DEFAULT_SEASON_YEAR

    for key in ["displaySeasonYear", "currentDisplaySeasonYear", "calendarSeasonYear"]:
        value = league_data.get(key)
        n = int(num(value, 0))
        if n > 1900:
            return n

    # Prefer seasonYear as season START, matching the rest of this app's UI.
    for key in ["seasonYear", "seasonStartYear", "startSeasonYear", "simStartYear"]:
        value = league_data.get(key)
        n = int(num(value, 0))
        if n > 1900:
            return n + 1

    value = league_data.get("currentSeasonYear")
    n = int(num(value, 0))
    if n > 1900:
        return n

    return DEFAULT_SEASON_YEAR


def is_current_live_stats_row(row: Dict[str, Any], current_display_year: int) -> bool:
    if not isinstance(row, dict):
        return False

    season_year = int(num(row.get("seasonYear") or row.get("season") or row.get("year"), 0))
    if season_year and season_year != int(current_display_year):
        return False

    source = str(row.get("source") or "").lower()
    if source in ["live", "sim", "simulated", "current", "generated", "boxscore"]:
        return True

    if row.get("simulated") is True or row.get("isLive") is True or row.get("isCurrentSeason") is True:
        return True

    # Rows without a source are usually imported real-life history, not live sim stats.
    return False


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


def player_name(player: Dict[str, Any]) -> str:
    return str(player.get("name") or player.get("player") or player.get("playerName") or "Unknown Player")


def player_key(player: Dict[str, Any]) -> str:
    pid = player.get("id") or player.get("playerId") or player.get("uuid")
    if pid not in [None, ""]:
        return f"id:{pid}"
    return f"name:{player_name(player)}"


def same_player(a: Dict[str, Any], b: Dict[str, Any]) -> bool:
    return player_key(a) == player_key(b)


# -----------------------------------------------------------------------------
# Contracts / value
# -----------------------------------------------------------------------------

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
    if len(salaries) == 1 and idx == -1:
        idx = 0
    if idx < 0:
        idx = 0
    if idx >= len(salaries):
        return int(num(salaries[-1], 0)) if salaries else 0
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


def is_rookie_scale_mood_exempt(
    player: Dict[str, Any],
    contract: Optional[Dict[str, Any]],
    season_year: int,
    salary: int = 0,
    years_left: int = 0,
) -> bool:
    """Block veteran-market underpaid complaints for rookie-scale players.

    Rookie deals are intentionally below open-market AAV. A Y1-Y4 player should
    care about role, minutes, development, and future security before he cares
    about being "underpaid" against a veteran market-value estimate.
    """
    if not isinstance(player, dict):
        return False

    meta = player.get("meta") if isinstance(player.get("meta"), dict) else {}
    rights = player.get("rights") if isinstance(player.get("rights"), dict) else {}
    contract_obj = contract if isinstance(contract, dict) else {}

    explicit_values = [
        player.get("rookieScale"),
        player.get("isRookieScale"),
        player.get("rookieScaleContract"),
        player.get("rookieContract"),
        meta.get("rookieScale"),
        meta.get("isRookieScale"),
        rights.get("rookieScale"),
        rights.get("rookieScaleContract"),
        contract_obj.get("rookieScale"),
        contract_obj.get("isRookieScale"),
        contract_obj.get("rookieScaleContract"),
    ]

    if any(value is True for value in explicit_values):
        return True

    text_values = [
        player.get("contractType"),
        player.get("rosterStatus"),
        player.get("acquiredVia"),
        meta.get("contractType"),
        meta.get("acquiredVia"),
        contract_obj.get("type"),
        contract_obj.get("source"),
        contract_obj.get("contractType"),
    ]

    if any("rookie" in str(value or "").lower() for value in text_values):
        return True

    draft_year = int(
        num(
            meta.get("draftYear")
            or player.get("draftYear")
            or player.get("draftClassYear")
            or player.get("draftedYear"),
            0,
        )
    )

    if draft_year > 0:
        years_since_draft = int(season_year) - draft_year
        if 0 <= years_since_draft <= 4:
            return True

    raw_pro_seasons = (
        meta.get("proSeasons")
        if meta.get("proSeasons") not in [None, ""]
        else player.get("proSeasons")
    )
    if raw_pro_seasons not in [None, ""]:
        pro_seasons = int(num(raw_pro_seasons, 99))
        if 0 <= pro_seasons <= 4:
            return True

    # Conservative fallback for imported rosters that do not carry draft/proYears.
    # This catches young rookie-scale contracts like Alex Sarr without affecting
    # veteran bargain contracts.
    age = int(num(player.get("age"), 99))
    if age <= 23 and int(years_left or 0) >= 2 and int(salary or 0) <= 18_000_000:
        return True

    return False


def fallback_market_value(player: Dict[str, Any]) -> Dict[str, Any]:
    overall = num(player.get("overall") or player.get("ovr"), 75)
    age = int(num(player.get("age"), 27))
    potential = num(player.get("potential") or player.get("pot"), overall)
    upside = max(0.0, potential - overall)

    if overall >= 94:
        aav = 57_000_000
    elif overall >= 90:
        aav = 47_000_000 + (overall - 90) * 2_250_000
    elif overall >= 86:
        aav = 32_000_000 + (overall - 86) * 3_300_000
    elif overall >= 82:
        aav = 21_000_000 + (overall - 82) * 2_750_000
    elif overall >= 78:
        aav = 11_000_000 + (overall - 78) * 2_400_000
    elif overall >= 74:
        aav = 4_000_000 + (overall - 74) * 1_600_000
    else:
        aav = 1_500_000

    if age <= 24:
        aav *= 1.04 + min(0.20, upside * 0.025)
    elif age >= 33:
        aav *= max(0.62, 1.0 - ((age - 32) * 0.055))

    return {
        "expectedAAV": int(aav),
        "expectedYear1Salary": int(aav),
        "expectedYears": 4 if overall >= 80 and age <= 31 else 3 if overall >= 78 and age <= 28 else 2 if overall >= 75 else 1,
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


# -----------------------------------------------------------------------------
# Team record / profile / expectations
# -----------------------------------------------------------------------------

def read_record(team: Dict[str, Any]) -> Tuple[int, int, Optional[float]]:
    wins = num(team.get("wins"), 0)
    losses = num(team.get("losses"), 0)

    for key in ["record", "seasonRecord", "currentRecord"]:
        if wins == 0 and losses == 0 and isinstance(team.get(key), dict):
            row = team.get(key) or {}
            wins = num(row.get("wins") if "wins" in row else row.get("w"), 0)
            losses = num(row.get("losses") if "losses" in row else row.get("l"), 0)

    games = wins + losses
    return int(wins), int(losses), (wins / games if games > 0 else None)


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


def roster_strength_score(team: Dict[str, Any]) -> float:
    players = [p for p in team.get("players", []) if isinstance(p, dict)]
    if not players:
        return 65.0
    ranked = sorted(players, key=lambda p: num(p.get("overall"), 0), reverse=True)
    top1 = num(ranked[0].get("overall"), 70) if ranked else 70
    top3 = sum(num(p.get("overall"), 0) for p in ranked[:3]) / max(1, len(ranked[:3]))
    top8 = sum(num(p.get("overall"), 0) for p in ranked[:8]) / max(1, len(ranked[:8]))
    pot_top5 = sum(num(p.get("potential"), num(p.get("overall"), 0)) for p in ranked[:5]) / max(1, len(ranked[:5]))
    # Top-end star power should matter a lot for expectations, but depth still matters.
    return round(top1 * 0.27 + top3 * 0.33 + top8 * 0.32 + pot_top5 * 0.08, 3)


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
        "directionConfidence": 0.66,
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
        "directionReasons": ["Roster strength, age curve, and current record were used to infer team direction."],
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
            player_name(p),
        ),
    )
    target_key = player_key(player)
    for idx, row in enumerate(ranked, start=1):
        if player_key(row) == target_key or player_name(row) == player_name(player):
            return idx
    return len(ranked) + 1


def infer_team_expectations(league_data: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    """Create a locked-preseason-style expectation profile from current roster strength.

    If leagueData already contains teamExpectationState/teamExpectations, those values are
    respected and merged. Otherwise this generates deterministic expectations from roster
    strength so the model works on old saves with no setup step.
    """
    teams = get_all_teams(league_data)
    ranked = sorted(
        [{"team": t, "score": roster_strength_score(t)} for t in teams],
        key=lambda row: row["score"],
        reverse=True,
    )
    count = max(1, len(ranked))
    by_name: Dict[str, Dict[str, Any]] = {}

    for idx, row in enumerate(ranked, start=1):
        team = row["team"]
        name = get_team_name(team)
        score = row["score"]
        pressure = 20
        tier = "rebuilding"
        expected_wins = 28
        expected_finish = "miss_playoffs"
        expected_round_index = 0.0

        if idx <= 3 or score >= 86.5:
            tier = "title_favorite"
            expected_wins = 57
            expected_finish = "finals"
            expected_round_index = 4.0
            pressure = 96
        elif idx <= 6 or score >= 84.2:
            tier = "contender"
            expected_wins = 52
            expected_finish = "conference_finals"
            expected_round_index = 3.0
            pressure = 88
        elif idx <= 12 or score >= 81.3:
            tier = "playoff_team"
            expected_wins = 46
            expected_finish = "second_round"
            expected_round_index = 2.0
            pressure = 70
        elif idx <= 20 or score >= 78.4:
            tier = "play_in_hopeful"
            expected_wins = 39
            expected_finish = "play_in_or_low_seed"
            expected_round_index = 0.75
            pressure = 50
        elif idx <= 25 or score >= 75.5:
            tier = "retooling"
            expected_wins = 34
            expected_finish = "development_year"
            expected_round_index = 0.25
            pressure = 36
        else:
            tier = "rebuilding"
            expected_wins = 26
            expected_finish = "miss_playoffs"
            expected_round_index = 0.0
            pressure = 22

        by_name[name] = {
            "teamName": name,
            "preseasonPowerRank": idx,
            "leagueTeamCount": count,
            "strengthScore": round(score, 2),
            "preseasonTier": tier,
            "expectedWins": expected_wins,
            "expectedWinPct": round(expected_wins / 82, 3),
            "expectedPlayoffResult": expected_finish,
            "expectedRoundIndex": expected_round_index,
            "pressureLevel": pressure,
            "source": "generated_from_roster_strength",
        }

    # Respect already-saved expectation profiles if your save later adds them.
    saved_sources = []
    for key in ["teamExpectationState", "teamExpectations", "preseasonExpectations"]:
        raw = league_data.get(key)
        if isinstance(raw, dict):
            saved_sources.append(raw)

    for raw in saved_sources:
        teams_map = raw.get("teams") if isinstance(raw.get("teams"), dict) else raw
        if not isinstance(teams_map, dict):
            continue
        for key, value in teams_map.items():
            if not isinstance(value, dict):
                continue
            name = str(value.get("teamName") or key)
            existing = by_name.get(name) or by_name.get(resolve_team_name_key(by_name, name), {})
            merged = {**existing, **value, "source": value.get("source") or "saved_expectation_state"}
            by_name[name] = merged

    return by_name


def resolve_team_name_key(mapping: Dict[str, Any], team_name: str) -> str:
    target = normalize_name(team_name)
    for key in mapping.keys():
        if normalize_name(key) == target:
            return key
    return team_name


def get_team_expectation(league_data: Dict[str, Any], team: Dict[str, Any]) -> Dict[str, Any]:
    all_exp = infer_team_expectations(league_data)
    name = get_team_name(team)
    key = resolve_team_name_key(all_exp, name)
    return all_exp.get(key) or all_exp.get(name) or {
        "teamName": name,
        "preseasonPowerRank": None,
        "preseasonTier": "balanced",
        "expectedWins": 41,
        "expectedWinPct": 0.500,
        "expectedPlayoffResult": "unknown",
        "expectedRoundIndex": 1.0,
        "pressureLevel": 50,
        "source": "fallback",
    }


# -----------------------------------------------------------------------------
# Stats / gameplan context
# -----------------------------------------------------------------------------

def get_latest_stats_row(
    player: Dict[str, Any],
    league_data: Optional[Dict[str, Any]] = None,
    team: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    # Direct current-season stat containers are allowed.
    for key in ["currentStats", "seasonStats", "stats", "totals"]:
        raw = player.get(key)
        if isinstance(raw, dict):
            out = dict(raw)
            out["__moodStatsSource"] = key
            return out

    # Imported roster files can contain a 2026 history row even before your
    # simmed 2025-26 season starts. Do NOT treat those historical rows as
    # live current-season GP/PPG. Only use current display-year rows that
    # are explicitly marked live/sim/current.
    current_display_year = get_current_display_season_year(league_data or {})
    history = player.get("history") if isinstance(player.get("history"), dict) else {}
    seasons = history.get("seasons") if isinstance(history.get("seasons"), list) else []

    for row in reversed(seasons):
        if not isinstance(row, dict) or row.get("rowType") == "total":
            continue
        if not is_current_live_stats_row(row, current_display_year):
            continue

        gp = num(row.get("games") or row.get("gp") or row.get("GP"), 0)
        if gp > 0:
            out = dict(row)
            out["__moodStatsSource"] = "current_live_history"
            out["__moodStatsSeasonYear"] = current_display_year
            return out

    return {}


def read_stat(row: Dict[str, Any], keys: List[str], fallback: float = 0.0) -> float:
    for key in keys:
        if key in row:
            return num(row.get(key), fallback)
    return fallback


def get_player_stats_summary(
    player: Dict[str, Any],
    league_data: Optional[Dict[str, Any]] = None,
    team: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    row = get_latest_stats_row(player, league_data, team)
    gp = read_stat(row, ["games", "gp", "GP", "g"], 0)
    mpg = read_stat(row, ["mpg", "minutesPerGame", "min", "minutes", "MP"], 0)
    ppg = read_stat(row, ["ppg", "pointsPerGame", "pts", "points", "PTS"], 0)
    rpg = read_stat(row, ["rpg", "reboundsPerGame", "reb", "trb", "REB"], 0)
    apg = read_stat(row, ["apg", "assistsPerGame", "ast", "AST"], 0)
    spg = read_stat(row, ["spg", "stealsPerGame", "stl", "STL"], 0)
    bpg = read_stat(row, ["bpg", "blocksPerGame", "blk", "BLK"], 0)
    starts = read_stat(row, ["starts", "started", "gs", "GS"], 0)

    # If totals are stored instead of per-game, convert when possible.
    if gp > 0:
        if ppg > 60:
            ppg = ppg / gp
        if rpg > 35:
            rpg = rpg / gp
        if apg > 25:
            apg = apg / gp
        if spg > 8:
            spg = spg / gp
        if bpg > 8:
            bpg = bpg / gp
        if mpg > 82:
            mpg = mpg / gp

    return {
        "games": round_int(gp),
        "minutesPerGame": round(mpg, 1),
        "pointsPerGame": round(ppg, 1),
        "reboundsPerGame": round(rpg, 1),
        "assistsPerGame": round(apg, 1),
        "stealsPerGame": round(spg, 1),
        "blocksPerGame": round(bpg, 1),
        "starts": round_int(starts),
        "source": str(row.get("__moodStatsSource") or "current_season") if row else "none",
    }


def get_matching_map_value(raw: Dict[str, Any], team_name: str) -> Optional[Any]:
    if not isinstance(raw, dict) or not team_name:
        return None

    keys_to_try = [team_name, normalize_name(team_name), team_name.lower(), team_name.upper()]
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


def get_gameplan_minutes_for_player(league_data: Dict[str, Any], team: Dict[str, Any], player: Dict[str, Any]) -> float:
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

    normalized_minutes = {normalize_name(key): value for key, value in minutes.items() if key not in [None, ""]}
    for key in candidate_keys:
        normalized_key = normalize_name(key)
        if normalized_key in normalized_minutes:
            return max(0.0, num(normalized_minutes.get(normalized_key), 0))
    return 0.0


def apply_gameplan_minutes_fallback(stats: Dict[str, Any], planned_mpg: float) -> Dict[str, Any]:
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


def get_team_games_played_context(team: Dict[str, Any], league_data: Optional[Dict[str, Any]] = None) -> int:
    wins, losses, _ = read_record(team)
    if wins + losses > 0:
        return int(wins + losses)

    max_gp = 0
    for player in get_roster_players_with_status(team):
        row = get_latest_stats_row(player, league_data, team)
        gp = int(round(read_stat(row, ["games", "gp", "GP", "g"], 0)))
        max_gp = max(max_gp, gp)
    return int(max_gp)


# -----------------------------------------------------------------------------
# Roles / player personality / historical tags
# -----------------------------------------------------------------------------

def expected_role_from_overall(overall: float, potential: float, age: int) -> Dict[str, Any]:
    if overall >= 94:
        return {"label": "MVP-Level Franchise Star", "maxRank": 1, "minutes": 35, "usageClass": "superstar"}
    if overall >= 90:
        return {"label": "Franchise Star", "maxRank": 1, "minutes": 34, "usageClass": "superstar"}
    if overall >= 86:
        return {"label": "All-Star / Lead Option", "maxRank": 2, "minutes": 32, "usageClass": "star"}
    if overall >= 82:
        return {"label": "Top Starter", "maxRank": 4, "minutes": 30, "usageClass": "core"}
    if overall >= 79:
        return {"label": "Starter", "maxRank": 5, "minutes": 27, "usageClass": "starter"}
    if overall >= 76:
        return {"label": "Rotation Player", "maxRank": 9, "minutes": 19, "usageClass": "rotation"}
    if potential >= 80 and age <= 24:
        return {"label": "Development Prospect", "maxRank": 11, "minutes": 12, "usageClass": "prospect"}
    return {"label": "Depth", "maxRank": 15, "minutes": 7, "usageClass": "depth"}


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


def player_tier(overall: float) -> str:
    if overall >= 94:
        return "mvp"
    if overall >= 90:
        return "superstar"
    if overall >= 86:
        return "star"
    if overall >= 82:
        return "core"
    if overall >= 79:
        return "starter"
    if overall >= 76:
        return "rotation"
    if overall >= 70:
        return "depth"
    return "fringe"


def build_player_personality(player: Dict[str, Any], team_expectation: Dict[str, Any], status: str) -> Dict[str, Any]:
    overall = num(player.get("overall"), 70)
    potential = num(player.get("potential"), overall)
    age = int(num(player.get("age"), 27))
    upside = max(0.0, potential - overall)
    tier = player_tier(overall)
    pressure = num(team_expectation.get("pressureLevel"), 50)

    ambition = clamp(35 + max(0, overall - 72) * 2.1 + max(0, potential - 78) * 1.0, 20, 99)
    ego = clamp(28 + max(0, overall - 76) * 2.3 + (8 if overall >= 86 else 0), 15, 99)
    patience = clamp(78 - max(0, overall - 78) * 1.6 + max(0, 24 - age) * 1.2, 20, 90)
    loyalty = clamp(58 + max(0, age - 28) * 0.7 - max(0, pressure - 70) * 0.15, 25, 88)
    role_sensitivity = clamp(30 + max(0, overall - 74) * 2.2 + (12 if tier in ["star", "superstar", "mvp"] else 0), 20, 99)
    winning_sensitivity = clamp(25 + max(0, age - 25) * 1.2 + max(0, overall - 80) * 1.9 + pressure * 0.22, 18, 99)
    development_sensitivity = clamp(max(0, 25 - age) * 5.0 + upside * 5.0, 0, 99)
    media_sensitivity = clamp(25 + max(0, overall - 82) * 1.8, 10, 92)

    if status in ["two_way", "stash"]:
        ambition = max(ambition, 52 if upside >= 4 else 42)
        patience = max(patience, 58)
        ego = min(ego, 55)

    return {
        "tier": tier,
        "ambition": round_int(ambition),
        "ego": round_int(ego),
        "patience": round_int(patience),
        "loyalty": round_int(loyalty),
        "roleSensitivity": round_int(role_sensitivity),
        "winningSensitivity": round_int(winning_sensitivity),
        "developmentSensitivity": round_int(development_sensitivity),
        "mediaSensitivity": round_int(media_sensitivity),
    }


HISTORICAL_PLAYER_TAGS: Dict[str, List[Dict[str, Any]]] = {
    "jamorant": [
        {
            "id": "public_reputation_recovery_arc",
            "label": "Public Reputation Recovery Arc",
            "impact": -3,
            "category": "History",
            "detail": "Starts with extra pressure to stabilize the season and rebuild trust.",
            "mediaSensitivity": 10,
            "volatility": 7,
        }
    ],
    "jaylenbrown": [
        {
            "id": "previous_trade_rumor_friction",
            "label": "Previous Trade Rumor Friction",
            "impact": -20,
            "category": "Trade Rumors",
            "detail": "Past trade speculation makes new rumors hit harder, but the friction fades over time.",
            "tradeSensitivity": 8,
            "frontOfficeTrustPenalty": 3,
            "modifierType": "temporary",
            "duration": "temporary",
            "decayPctPerWeek": 5,
            "decayMode": "percent_of_original",
            "date": "2025-10-19",
        }
    ],
    "damianlillard": [
        {
            "id": "win_now_clock",
            "label": "Win-Now Clock",
            "impact": 0,
            "category": "Legacy",
            "detail": "Championship contention matters more than raw role security.",
            "winningSensitivity": 12,
            "timelineSensitivity": 10,
        }
    ],
    "lebronjames": [
        {
            "id": "legacy_standard",
            "label": "Legacy Standard",
            "impact": 0,
            "category": "Legacy",
            "detail": "Deep playoff expectations are part of the baseline.",
            "winningSensitivity": 14,
            "pressure": 10,
        }
    ],
    "kevindurant": [
        {
            "id": "championship_standard",
            "label": "Championship Standard",
            "impact": 0,
            "category": "Legacy",
            "detail": "Early exits and underpowered rosters carry extra frustration.",
            "winningSensitivity": 12,
            "timelineSensitivity": 8,
        }
    ],
    "kyrieirving": [
        {
            "id": "media_spotlight",
            "label": "Media Spotlight",
            "impact": -1,
            "category": "History",
            "detail": "External attention can amplify mood swings.",
            "mediaSensitivity": 10,
            "volatility": 5,
        }
    ],
    "traeyoung": [
        {
            "id": "franchise_pressure",
            "label": "Franchise Pressure",
            "impact": -1,
            "category": "Role",
            "detail": "A high-usage lead guard expects the roster direction to match his role.",
            "roleSensitivity": 8,
            "winningSensitivity": 8,
        }
    ],
    "jamesharden": [
        {
            "id": "role_and_contention_watch",
            "label": "Role / Contention Watch",
            "impact": -1,
            "category": "Role",
            "detail": "Role clarity and winning situation matter more than for most veterans.",
            "roleSensitivity": 7,
            "winningSensitivity": 9,
        }
    ],
    "jimmybutler": [
        {
            "id": "high_standard_leader",
            "label": "High-Standard Veteran Leader",
            "impact": 0,
            "category": "Leadership",
            "detail": "Winning habits boost morale, but soft underperformance hurts.",
            "winningSensitivity": 10,
            "pressure": 7,
        }
    ],
    "zionwilliamson": [
        {
            "id": "availability_spotlight",
            "label": "Availability Spotlight",
            "impact": -1,
            "category": "History",
            "detail": "Availability and franchise-direction scrutiny start as part of his context.",
            "mediaSensitivity": 7,
            "volatility": 4,
        }
    ],
}


def get_historical_tags(player: Dict[str, Any]) -> List[Dict[str, Any]]:
    name_key = normalize_name(player_name(player))
    tags = []
    if name_key in HISTORICAL_PLAYER_TAGS:
        tags.extend([dict(row) for row in HISTORICAL_PLAYER_TAGS[name_key]])

    # Also respect future save-data tags if you add them later from an editor.
    raw_tags = player.get("moodHistoricalTags") or player.get("historicalMoodTags")
    if isinstance(raw_tags, list):
        for row in raw_tags:
            if isinstance(row, dict):
                tags.append(dict(row))
    return tags


def apply_historical_personality_mods(personality: Dict[str, Any], tags: List[Dict[str, Any]]) -> Dict[str, Any]:
    out = dict(personality)
    key_map = {
        "mediaSensitivity": "mediaSensitivity",
        "winningSensitivity": "winningSensitivity",
        "roleSensitivity": "roleSensitivity",
        "developmentSensitivity": "developmentSensitivity",
        "timelineSensitivity": "winningSensitivity",
        "pressure": "mediaSensitivity",
    }
    for tag in tags:
        for raw_key, target_key in key_map.items():
            if raw_key in tag:
                out[target_key] = round_int(clamp(num(out.get(target_key), 50) + num(tag.get(raw_key), 0), 0, 99))
    return out


# -----------------------------------------------------------------------------
# Mood event log
# -----------------------------------------------------------------------------

_MONTHS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

def season_opening_date(league_data: Optional[Dict[str, Any]] = None) -> str:
    season_year = get_current_season_year(league_data or {})
    return f"{int(season_year) - 1}-10-19"

def parse_iso_date(value: Any) -> Optional[_date]:
    raw = clean_text(value)
    if not raw or raw.lower() in ["current", "current season"]:
        return None
    try:
        return _date.fromisoformat(raw[:10])
    except Exception:
        pass
    # Light fallback for labels like Oct 19, 2025.
    parts = raw.replace(",", "").split()
    if len(parts) >= 3:
        month_lookup = {m.lower(): i + 1 for i, m in enumerate(_MONTHS)}
        month = month_lookup.get(parts[0].lower()[:3])
        if month:
            try:
                return _date(int(parts[2]), int(month), int(parts[1]))
            except Exception:
                return None
    return None

def format_date_label(value: Any, fallback: str = "2025-10-19") -> str:
    parsed = parse_iso_date(value) or parse_iso_date(fallback)
    if not parsed:
        return clean_text(value) or "Oct 19, 2025"
    return f"{_MONTHS[parsed.month - 1]} {parsed.day}, {parsed.year}"

def get_current_league_date(league_data: Dict[str, Any]) -> str:
    for key in ["currentDate", "calendarDate", "today", "date", "leagueDate"]:
        parsed = parse_iso_date(league_data.get(key))
        if parsed:
            return parsed.isoformat()

    calendar = league_data.get("calendar") if isinstance(league_data.get("calendar"), dict) else {}
    for key in ["currentDate", "date", "cursorDate"]:
        parsed = parse_iso_date(calendar.get(key))
        if parsed:
            return parsed.isoformat()

    for context_key in ["moodCalendarContext", "calendarContext"]:
        context = league_data.get(context_key)
        if isinstance(context, dict):
            for key in ["currentDate", "date", "cursorDate"]:
                parsed = parse_iso_date(context.get(key))
                if parsed:
                    return parsed.isoformat()

    return season_opening_date(league_data)

def weeks_since(event_date: Any, current_date: Any) -> int:
    start = parse_iso_date(event_date)
    end = parse_iso_date(current_date)
    if not start or not end or end < start:
        return 0
    return int((end - start).days // 7)

def decayed_impact(base_impact: float, event_date: Any, current_date: Any, decay_per_week: float = 0.0) -> float:
    base = float(num(base_impact, 0))
    decay = abs(float(num(decay_per_week, 0)))
    if base == 0 or decay <= 0:
        return round(base, 1)
    remaining = max(0.0, abs(base) - weeks_since(event_date, current_date) * decay)
    if remaining <= 0:
        return 0.0
    return round(remaining if base > 0 else -remaining, 1)


def decayed_impact_pct(base_impact: float, event_date: Any, current_date: Any, decay_pct_per_week: float = 0.0) -> float:
    """Decay by a fixed percent of the original impact each league week.

    Example: -20 with 5%/week loses 1.0 point per week and reaches 0
    after 20 weeks. This is intentionally linear so temporary mood events
    can fully disappear instead of asymptotically lingering forever.
    """
    base = float(num(base_impact, 0))
    pct = abs(float(num(decay_pct_per_week, 0)))
    if base == 0 or pct <= 0:
        return round(base, 1)
    weekly_decay = abs(base) * (pct / 100.0)
    remaining = max(0.0, abs(base) - weeks_since(event_date, current_date) * weekly_decay)
    if remaining <= 0:
        return 0.0
    return round(remaining if base > 0 else -remaining, 1)


def add_days_to_date(value: Any, days: int) -> Optional[str]:
    parsed = parse_iso_date(value)
    if not parsed:
        return None
    try:
        return _date.fromordinal(parsed.toordinal() + int(days)).isoformat()
    except Exception:
        return None


def expiry_date_for_decay(event_date: Any, base_impact: float, decay_per_week: float) -> Optional[str]:
    decay = abs(float(num(decay_per_week, 0)))
    original = abs(float(num(base_impact, 0)))
    if decay <= 0 or original <= 0:
        return None
    weeks_to_zero = int(math.ceil(original / decay))
    return add_days_to_date(event_date, weeks_to_zero * 7)


def expiry_date_for_pct_decay(event_date: Any, base_impact: float, decay_pct_per_week: float) -> Optional[str]:
    pct = abs(float(num(decay_pct_per_week, 0)))
    original = abs(float(num(base_impact, 0)))
    if pct <= 0 or original <= 0:
        return None
    weekly_decay = original * (pct / 100.0)
    if weekly_decay <= 0:
        return None
    weeks_to_zero = int(math.ceil(original / weekly_decay))
    return add_days_to_date(event_date, weeks_to_zero * 7)


def make_decay_text(event: Dict[str, Any]) -> str:
    decay_pct = num(event.get("decayPctPerWeek") or event.get("decayPercentPerWeek") or event.get("weeklyDecayPct"), 0)
    decay = num(event.get("decayPerWeek"), 0)
    if decay_pct <= 0 and decay <= 0:
        return clean_text(event.get("decayText") or event.get("decayLabel") or "Permanent modifier while its condition remains.")

    original = num(event.get("baseImpact", event.get("impact")), 0)
    current = num(event.get("impact"), 0)
    removal = clean_text(event.get("expiresOnLabel") or "")
    if decay_pct > 0:
        if removal:
            return f"Original {original:+.1f}; now {current:+.1f}; decays {decay_pct:g}%/week; removed {removal}"
        return f"Original {original:+.1f}; now {current:+.1f}; decays {decay_pct:g}%/week until 0"
    if removal:
        return f"Original {original:+.1f}; now {current:+.1f}; decays {decay:g}/week; removed {removal}"
    return f"Original {original:+.1f}; now {current:+.1f}; decays {decay:g}/week until 0"

def add_event(
    events: List[Dict[str, Any]],
    category: str,
    impact: float,
    text: str,
    detail: str = "",
    event_type: str = "situation",
    duration: str = "active",
    date: Optional[str] = None,
    source: str = "mood_engine",
    base_impact: Optional[float] = None,
    decay_per_week: float = 0.0,
    decay_pct_per_week: float = 0.0,
    decay_mode: str = "flat",
    modifier_type: Optional[str] = None,
) -> None:
    event_date = date or "2025-10-19"
    base_value = round(float(base_impact if base_impact is not None else impact), 1)
    current_value = round(float(impact), 1)
    pct_decay_value = float(num(decay_pct_per_week, 0))
    flat_decay_value = float(num(decay_per_week, 0))
    resolved_modifier_type = clean_text(modifier_type or "")
    if not resolved_modifier_type:
        resolved_modifier_type = "temporary" if pct_decay_value > 0 or flat_decay_value > 0 or str(duration).lower() == "temporary" else "permanent"

    row = {
        "category": category,
        "impact": current_value,
        "baseImpact": base_value,
        "text": clean_text(text),
        "detail": clean_text(detail),
        "type": event_type,
        "duration": duration,
        "modifierType": resolved_modifier_type,
        "date": event_date,
        "dateLabel": format_date_label(event_date),
        "source": source,
    }
    if pct_decay_value > 0:
        row["decayPctPerWeek"] = pct_decay_value
        row["decayMode"] = decay_mode or "percent_of_original"
        expiry = expiry_date_for_pct_decay(event_date, base_value, pct_decay_value)
        if expiry:
            row["expiresOn"] = expiry
            row["expiresOnLabel"] = format_date_label(expiry)
        original_abs = abs(base_value)
        current_abs = abs(current_value)
        if original_abs > 0:
            row["decayProgress"] = round(clamp(current_abs / original_abs, 0, 1), 3)
        row["remainingWeeks"] = int(math.ceil((current_abs / max(original_abs * (pct_decay_value / 100.0), 0.0001)))) if current_abs > 0 and original_abs > 0 else 0
        row["decayText"] = make_decay_text(row)
    elif decay_per_week and num(decay_per_week, 0) > 0:
        decay_value = float(num(decay_per_week, 0))
        row["decayPerWeek"] = decay_value
        expiry = expiry_date_for_decay(event_date, base_value, decay_value)
        if expiry:
            row["expiresOn"] = expiry
            row["expiresOnLabel"] = format_date_label(expiry)
        original_abs = abs(base_value)
        current_abs = abs(current_value)
        if original_abs > 0:
            row["decayProgress"] = round(clamp(current_abs / original_abs, 0, 1), 3)
        if decay_value > 0:
            row["remainingWeeks"] = int(math.ceil(current_abs / decay_value)) if current_abs > 0 else 0
        row["decayText"] = make_decay_text(row)
    events.append(row)


def get_player_stored_mood_events(league_data: Dict[str, Any], player: Dict[str, Any]) -> List[Dict[str, Any]]:
    state = league_data.get("playerMoodState") if isinstance(league_data.get("playerMoodState"), dict) else {}
    players_state = state.get("players") if isinstance(state.get("players"), dict) else {}
    keys = [
        player_key(player),
        player_name(player),
        f"name:{player_name(player)}",
        normalize_name(player_name(player)),
    ]

    raw = None
    for key in keys:
        if key in players_state:
            raw = players_state.get(key)
            break

    if not isinstance(raw, dict):
        return []

    for list_key in ["events", "eventLog", "moodEvents", "activeModifiers"]:
        rows = raw.get(list_key)
        if isinstance(rows, list):
            return [r for r in rows if isinstance(r, dict)]
    return []


def apply_stored_mood_events(
    events: List[Dict[str, Any]],
    league_data: Dict[str, Any],
    player: Dict[str, Any],
) -> float:
    current_date = get_current_league_date(league_data)
    total = 0.0
    for row in get_player_stored_mood_events(league_data, player):
        event_date = row.get("date") or row.get("createdAt") or season_opening_date(league_data)
        base = num(row.get("baseImpact", row.get("impact", row.get("moodImpact", 0))), 0)
        decay = num(row.get("decayPerWeek", row.get("weeklyDecay", 0)), 0)
        decay_pct = num(row.get("decayPctPerWeek", row.get("decayPercentPerWeek", row.get("weeklyDecayPct", 0))), 0)
        active = decayed_impact_pct(base, event_date, current_date, decay_pct) if decay_pct > 0 else decayed_impact(base, event_date, current_date, decay)

        # Temporary events automatically disappear once their decayed value hits zero.
        if active == 0 and (decay > 0 or decay_pct > 0) and row.get("hideWhenExpired", True):
            continue

        add_event(
            events,
            str(row.get("category") or row.get("label") or "Mood Event"),
            active,
            str(row.get("text") or row.get("headline") or row.get("label") or "Mood event"),
            str(row.get("detail") or row.get("description") or ""),
            event_type=str(row.get("type") or "stored_event"),
            duration=str(row.get("duration") or ("temporary" if decay > 0 else "active")),
            date=str(event_date),
            source=str(row.get("source") or "player_mood_state"),
            base_impact=base,
            decay_per_week=decay,
            decay_pct_per_week=decay_pct,
            decay_mode=str(row.get("decayMode") or ("percent_of_original" if decay_pct > 0 else "flat")),
            modifier_type=str(row.get("modifierType") or ("temporary" if decay > 0 or decay_pct > 0 else "permanent")),
        )
        total += active
    return round(total, 1)


def is_giannis_player(player: Dict[str, Any]) -> bool:
    name = normalize_name(player_name(player))
    return name in {"giannisantetokounmpo", "g_antetokounmpo"} or name.startswith("giannisantet")


def seeded_bucks_story_events(
    events: List[Dict[str, Any]],
    league_data: Dict[str, Any],
    team: Dict[str, Any],
    player: Dict[str, Any],
) -> float:
    """Preloaded 2025-26 story context for the Bucks/Giannis situation.

    These are intentionally returned as normal dated mood events, not hard-coded
    final scores. They decay like the rest of the ledger and disappear at 0.
    """
    team_name = get_team_name(team)
    if normalize_name(team_name) != "milwaukeebucks" or not is_giannis_player(player):
        return 0.0

    current_date = get_current_league_date(league_data)
    story_rows = [
        {
            "date": "2025-07-05",
            "baseImpact": -40,
            "decayPerWeek": 1,
            "category": "Trust Fracture",
            "text": "The offseason roster reset badly damaged his trust in the direction of the franchise.",
            "detail": "Dame exit, repeated postseason disappointment, and a sudden pivot around a new frontcourt fit.",
        },
        {
            "date": "2025-10-07",
            "baseImpact": -25,
            "decayPerWeek": 1,
            "category": "Trade Rumors",
            "text": "Extensive trade rumors around the franchise star created a major mood hit.",
            "detail": "The uncertainty feels personal because the entire team direction is being questioned.",
        },
    ]

    total = 0.0
    for row in story_rows:
        active = decayed_impact(row["baseImpact"], row["date"], current_date, row["decayPerWeek"])
        if active == 0:
            continue
        total += active
        add_event(
            events,
            row["category"],
            active,
            row["text"],
            row["detail"],
            event_type="preloaded_story",
            duration="temporary",
            date=row["date"],
            source="2025_26_bucks_story_seed",
            base_impact=row["baseImpact"],
            decay_per_week=row["decayPerWeek"],
        )

    return round(total, 1)


def superstar_carrying_event(
    events: List[Dict[str, Any]],
    league_data: Dict[str, Any],
    team: Dict[str, Any],
    player: Dict[str, Any],
) -> float:
    overall = num(player.get("overall"), 0)
    if overall < 92:
        return 0.0

    teammates = []
    key = player_key(player)
    for teammate in get_roster_players_with_status(team):
        if player_key(teammate) == key:
            continue
        teammates.append(num(teammate.get("overall"), 0))

    if not teammates:
        return 0.0

    next_best = max(teammates)
    gap = overall - next_best
    if gap < 10:
        return 0.0

    impact = -round(min(14.0, 4.0 + gap * 0.38), 1)
    add_event(
        events,
        "Carrying Burden",
        impact,
        "He may feel the roster falls too far without him.",
        f"His OVR {round_int(overall)} vs next-highest teammate OVR {round_int(next_best)}.",
        event_type="team_context",
        duration="active_condition",
        date=get_current_league_date(league_data),
        source="superstar_support_gap",
    )
    return impact


def superstar_unrest_team_event(
    events: List[Dict[str, Any]],
    league_data: Dict[str, Any],
    team: Dict[str, Any],
    player: Dict[str, Any],
) -> float:
    """Teammates feel it when the franchise player is deeply unsettled."""
    team_name = get_team_name(team)
    if normalize_name(team_name) != "milwaukeebucks" or is_giannis_player(player):
        return 0.0

    current_date = get_current_league_date(league_data)
    giannis_unrest = (
        decayed_impact(-40, "2025-07-05", current_date, 1)
        + decayed_impact(-25, "2025-10-07", current_date, 1)
    )
    if giannis_unrest > -30:
        return 0.0

    overall = num(player.get("overall"), 0)
    impact = -7.5 if overall >= 78 else -5.0
    add_event(
        events,
        "Star Unrest",
        impact,
        "The franchise star's frustration is dragging down the room.",
        "When the top player is this unsettled, the rest of the roster feels the instability.",
        event_type="team_context",
        duration="active_condition",
        date=get_current_league_date(league_data),
        source="superstar_unrest_spillover",
    )
    return impact


def expectation_gap_event(
    events: List[Dict[str, Any]],
    team_name: str,
    wins: int,
    losses: int,
    expectation: Dict[str, Any],
    player: Dict[str, Any],
    personality: Dict[str, Any],
) -> float:
    games = wins + losses
    if games <= 0:
        add_event(
            events,
            "Preseason Expectation",
            0,
            f"{team_name} enters the year as a {humanize_tier(expectation.get('preseasonTier'))}.",
            f"Preseason rank: #{expectation.get('preseasonPowerRank')}; expected wins: {expectation.get('expectedWins')}",
            event_type="baseline",
            duration="season",
        )
        return 0.0

    actual_pct = wins / max(1, games)
    expected_pct = num(expectation.get("expectedWinPct"), 0.500)
    gap = actual_pct - expected_pct
    pressure = num(expectation.get("pressureLevel"), 50) / 100
    overall = num(player.get("overall"), 70)
    tier = player_tier(overall)
    role_weight = player_expectation_weight(player, personality)

    impact = 0.0
    if gap >= 0.145:
        raw = 7 + min(11, gap * 55)
        if num(expectation.get("expectedWins"), 41) <= 38:
            raw += 5
        impact = raw * (0.78 + role_weight * 0.22)
        add_event(
            events,
            "Expectation Beat",
            impact,
            f"{team_name} is outperforming preseason expectations.",
            f"Current record {wins}-{losses}; expected pace around {round_int(expected_pct * games)}-{round_int((1 - expected_pct) * games)} at this point.",
            event_type="expectation_gap",
            duration="active",
        )
    elif gap >= 0.075:
        raw = 4 + min(7, gap * 42)
        impact = raw * (0.84 + role_weight * 0.16)
        add_event(
            events,
            "Positive Surprise",
            impact,
            "The team is ahead of schedule.",
            f"Current record {wins}-{losses} vs preseason tier: {humanize_tier(expectation.get('preseasonTier'))}.",
            event_type="expectation_gap",
            duration="active",
        )
    elif gap <= -0.155:
        raw = -(7 + min(16, abs(gap) * 60))
        # Great teams falling short should hurt much more than rebuilding teams losing.
        raw *= 0.65 + pressure * 0.75
        if tier in ["mvp", "superstar", "star", "core"]:
            raw *= 1.10
        impact = raw
        add_event(
            events,
            "Expectation Miss",
            impact,
            f"{team_name} is falling short of its preseason standard.",
            f"Current record {wins}-{losses}; expected tier: {humanize_tier(expectation.get('preseasonTier'))}.",
            event_type="expectation_gap",
            duration="active",
        )
    elif gap <= -0.080:
        raw = -(4 + min(8, abs(gap) * 42))
        raw *= 0.70 + pressure * 0.55
        impact = raw
        add_event(
            events,
            "Under Pressure",
            impact,
            "The team is slightly behind its expected pace.",
            f"Current record {wins}-{losses}; pressure level {round_int(num(expectation.get('pressureLevel'), 50))}/100.",
            event_type="expectation_gap",
            duration="active",
        )

    return impact


def humanize_tier(value: Any) -> str:
    text = str(value or "balanced").replace("_", " ").replace("-", " ").strip()
    if not text:
        return "Balanced"
    return text.title()


def player_expectation_weight(player: Dict[str, Any], personality: Dict[str, Any]) -> float:
    overall = num(player.get("overall"), 70)
    age = int(num(player.get("age"), 27))
    tier = player_tier(overall)
    weight = 0.55
    if tier == "mvp":
        weight = 1.35
    elif tier == "superstar":
        weight = 1.25
    elif tier == "star":
        weight = 1.12
    elif tier == "core":
        weight = 1.00
    elif tier == "starter":
        weight = 0.88
    elif tier == "rotation":
        weight = 0.70
    elif tier == "depth":
        weight = 0.48
    else:
        weight = 0.36

    if age >= 31 and overall >= 76:
        weight += 0.15
    if age <= 23 and num(player.get("potential"), overall) >= overall + 5:
        weight += 0.10
    weight += (num(personality.get("ambition"), 50) - 50) / 250
    return clamp(weight, 0.25, 1.55)


def get_playoff_outcome_for_team(league_data: Dict[str, Any], team_name: str) -> Optional[Dict[str, Any]]:
    target = normalize_name(team_name)

    # Direct maps/fields first.
    for key in ["playoffResultsByTeam", "postseasonResultsByTeam", "teamPlayoffResults"]:
        raw = league_data.get(key)
        if isinstance(raw, dict):
            for k, v in raw.items():
                if normalize_name(k) == target and isinstance(v, dict):
                    return normalize_playoff_outcome(v)

    postseason = league_data.get("postseasonState") or league_data.get("playoffsState") or league_data.get("playoffState")
    if isinstance(postseason, dict):
        for key in ["resultsByTeam", "teamResults", "eliminatedTeams", "finishByTeam"]:
            raw = postseason.get(key)
            if isinstance(raw, dict):
                for k, v in raw.items():
                    if normalize_name(k) == target:
                        if isinstance(v, dict):
                            return normalize_playoff_outcome(v)
                        return normalize_playoff_outcome({"finish": v})

    # Last completed season history if it contains team rows.
    history = league_data.get("seasonHistory")
    if isinstance(history, list) and history:
        latest = history[-1] if isinstance(history[-1], dict) else None
        teams = latest.get("teams") if isinstance(latest, dict) and isinstance(latest.get("teams"), list) else []
        for row in teams:
            if isinstance(row, dict) and normalize_name(row.get("teamName") or row.get("name")) == target:
                return normalize_playoff_outcome(row)
    return None


def normalize_playoff_outcome(row: Dict[str, Any]) -> Dict[str, Any]:
    raw = str(
        row.get("finish")
        or row.get("playoffResult")
        or row.get("roundReached")
        or row.get("result")
        or row.get("status")
        or ""
    ).lower()
    wins_champ = bool(row.get("champion") or row.get("wonTitle") or row.get("title"))
    finals = bool(row.get("finals") or row.get("madeFinals"))
    round_num = num(row.get("round") or row.get("roundIndex") or row.get("lastRound") or row.get("playoffRound"), -1)

    index = None
    label = "Unknown"
    if wins_champ or "champ" in raw or "title" in raw:
        index, label = 5.0, "Champion"
    elif finals or "final" in raw:
        index, label = 4.0, "Finals"
    elif "conference" in raw or "cf" in raw:
        index, label = 3.0, "Conference Finals"
    elif "second" in raw or "semifinal" in raw or round_num == 2:
        index, label = 2.0, "Second Round"
    elif "first" in raw or "round 1" in raw or round_num == 1:
        index, label = 1.0, "First Round"
    elif "play" in raw and "miss" not in raw:
        index, label = 0.75, "Play-In / Low Seed"
    elif "miss" in raw or "lottery" in raw:
        index, label = 0.0, "Missed Playoffs"
    elif round_num >= 0:
        index = float(round_num)
        label = f"Round {round_int(round_num)}"

    if index is None:
        return {"available": False}
    return {"available": True, "roundIndex": index, "label": label, "raw": row}


def playoff_expectation_event(
    events: List[Dict[str, Any]],
    league_data: Dict[str, Any],
    team_name: str,
    expectation: Dict[str, Any],
    player: Dict[str, Any],
    personality: Dict[str, Any],
) -> float:
    outcome = get_playoff_outcome_for_team(league_data, team_name)
    if not outcome or not outcome.get("available"):
        return 0.0

    actual = num(outcome.get("roundIndex"), 0)
    expected = num(expectation.get("expectedRoundIndex"), 1.0)
    gap = actual - expected
    pressure = num(expectation.get("pressureLevel"), 50) / 100
    role_weight = player_expectation_weight(player, personality)
    impact = 0.0

    if gap >= 2.0:
        impact = (14 + min(10, gap * 4)) * (0.85 + role_weight * 0.15)
        add_event(
            events,
            "Playoff Breakthrough",
            impact,
            f"{team_name} smashed preseason expectations by reaching {outcome.get('label')}.",
            f"Expected: {humanize_playoff_result(expectation.get('expectedPlayoffResult'))}.",
            event_type="major_season_event",
            duration="season_memory",
        )
    elif gap >= 1.0:
        impact = (8 + min(7, gap * 4)) * (0.88 + role_weight * 0.12)
        add_event(
            events,
            "Exceeded Expectations",
            impact,
            f"A better-than-expected playoff finish lifted the locker room.",
            f"Finished: {outcome.get('label')} vs expected {humanize_playoff_result(expectation.get('expectedPlayoffResult'))}.",
            event_type="major_season_event",
            duration="season_memory",
        )
    elif gap <= -2.0:
        impact = -(13 + min(18, abs(gap) * 5)) * (0.60 + pressure * 0.75) * (0.72 + role_weight * 0.28)
        add_event(
            events,
            "Playoff Disappointment",
            impact,
            "The postseason result fell far short of the team's standard.",
            f"Finished: {outcome.get('label')} vs expected {humanize_playoff_result(expectation.get('expectedPlayoffResult'))}.",
            event_type="major_season_event",
            duration="season_memory",
        )
    elif gap <= -1.0:
        impact = -(7 + min(10, abs(gap) * 4)) * (0.66 + pressure * 0.55) * (0.80 + role_weight * 0.20)
        add_event(
            events,
            "Early Exit Pressure",
            impact,
            "The playoff finish was below expectation.",
            f"Finished: {outcome.get('label')} vs expected {humanize_playoff_result(expectation.get('expectedPlayoffResult'))}.",
            event_type="major_season_event",
            duration="season_memory",
        )
    elif actual >= 5:
        impact = 20 * (0.85 + role_weight * 0.15)
        add_event(events, "Championship", impact, "Winning the championship created a massive morale boost.", "Title memory is season-defining.", event_type="major_season_event", duration="long_term")

    return impact


def humanize_playoff_result(value: Any) -> str:
    text = str(value or "unknown").replace("_", " ").replace("-", " ").strip()
    return text.title() if text else "Unknown"


# -----------------------------------------------------------------------------
# Trade mood context
# -----------------------------------------------------------------------------

def collect_trade_entries_for_player(league_data: Dict[str, Any], team_name: str, player: Dict[str, Any]) -> List[Dict[str, Any]]:
    player_norm = normalize_name(player_name(player))
    team_norm = normalize_name(team_name)
    rows: List[Dict[str, Any]] = []

    candidates: List[Any] = []
    for key in ["tradeDeskFeed", "tradeFeed", "tradeRumors", "tradeIntelFeed"]:
        raw = league_data.get(key)
        if isinstance(raw, list):
            candidates.extend(raw)
    history = league_data.get("tradeHistory")
    if isinstance(history, list):
        candidates.extend(history)

    for entry in candidates:
        if not isinstance(entry, dict):
            continue
        headline = clean_text(entry.get("headline") or entry.get("message") or entry.get("text") or "")
        entry_type = str(entry.get("type") or entry.get("kind") or entry.get("source") or "trade").lower()
        player_names = entry.get("playerNames") or entry.get("players") or []
        team_names = entry.get("teamNames") or entry.get("teams") or []

        mentioned_player = player_norm and player_norm in normalize_name(headline)
        if isinstance(player_names, list):
            mentioned_player = mentioned_player or any(normalize_name(x) == player_norm for x in player_names)

        mentioned_team = team_norm and team_norm in normalize_name(headline)
        if isinstance(team_names, list):
            mentioned_team = mentioned_team or any(normalize_name(x) == team_norm for x in team_names)

        # Scan saved package assets too.
        for pkg in entry.get("teamPackages") or []:
            if not isinstance(pkg, dict):
                continue
            if normalize_name(pkg.get("teamName")) == team_norm:
                mentioned_team = True
            for side_key in ["received", "sent"]:
                for asset in pkg.get(side_key) or []:
                    if isinstance(asset, dict):
                        label = asset.get("playerName") or asset.get("label") or asset.get("name")
                        if normalize_name(label) == player_norm:
                            mentioned_player = True

        if mentioned_player or mentioned_team:
            copied = dict(entry)
            copied["_mentionedPlayer"] = mentioned_player
            copied["_mentionedTeam"] = mentioned_team
            copied["_headline"] = headline
            copied["_type"] = entry_type
            rows.append(copied)

    return rows[-8:]


def trade_context_events(
    events: List[Dict[str, Any]],
    league_data: Dict[str, Any],
    team_name: str,
    player: Dict[str, Any],
    personality: Dict[str, Any],
    historical_tags: List[Dict[str, Any]],
) -> float:
    entries = collect_trade_entries_for_player(league_data, team_name, player)
    if not entries:
        return 0.0

    total = 0.0
    current_date = get_current_league_date(league_data)
    trade_sensitive_bonus = sum(num(tag.get("tradeSensitivity"), 0) for tag in historical_tags)
    sensitivity = 1.0 + (num(personality.get("mediaSensitivity"), 50) - 50) / 160 + trade_sensitive_bonus / 35
    overall = num(player.get("overall"), 70)

    for entry in entries[-3:]:
        entry_type = str(entry.get("_type") or "trade").lower()
        headline = entry.get("_headline") or "Trade activity touched this situation."
        mentioned_player = bool(entry.get("_mentionedPlayer"))
        impact = 0.0
        category = "Trade Desk"
        text = "Trade activity affected the locker room."
        duration = "short_term"

        if "rumor" in entry_type:
            impact = -4.5
            text = "Trade rumors created uncertainty."
            if mentioned_player:
                impact -= 3.5
                text = "Being directly mentioned in trade rumors created real frustration."
            if overall >= 86:
                impact -= 2.5
            duration = "45_days"
        elif "negotiation" in entry_type or "talk" in entry_type:
            impact = -3.5
            text = "Reported trade talks made the locker room uneasy."
            if mentioned_player:
                impact -= 3.0
            duration = "30_days"
        elif "transaction" in entry_type or "completed" in entry_type or "cpu_cpu_trade" in entry_type or "trade" in entry_type:
            impact = -2.0 if mentioned_player else -1.0
            text = "A completed trade changed the team's stability."
            if mentioned_player:
                impact = -6.0
                text = "Being moved or attached to a completed trade created a major mood swing."
            duration = "season_memory"

        impact *= sensitivity
        total += impact
        event_date = entry.get("date") or entry.get("currentDate") or entry.get("createdAt") or current_date
        add_event(
            events,
            category,
            impact,
            text,
            headline[:180],
            event_type="trade_context",
            duration="temporary",
            date=str(event_date)[:10],
            source="trade_feed_or_history",
            base_impact=impact,
            decay_pct_per_week=5,
            decay_mode="percent_of_original",
            modifier_type="temporary",
        )

    return total


# -----------------------------------------------------------------------------
# Main player evaluation
# -----------------------------------------------------------------------------

def evaluate_player_mood(
    league_data: Dict[str, Any],
    team: Dict[str, Any],
    team_profile: Dict[str, Any],
    team_expectation: Dict[str, Any],
    player: Dict[str, Any],
) -> Dict[str, Any]:
    season_year = get_current_season_year(league_data)
    current_date = get_current_league_date(league_data)
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
    raw_stats = get_player_stats_summary(player, league_data, team)
    planned_mpg = get_gameplan_minutes_for_player(league_data, team, player)
    stats = apply_gameplan_minutes_fallback(raw_stats, planned_mpg)
    team_games_played = get_team_games_played_context(team, league_data)
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

    historical_tags = get_historical_tags(player)
    personality = build_player_personality(player, team_expectation, status)
    personality = apply_historical_personality_mods(personality, historical_tags)
    role_weight = player_expectation_weight(player, personality)

    # Every player starts from a clean base mood of 50. Talent does not directly
    # grant mood; it raises expectations, which then creates positive/negative events.
    baseline = 50.0
    tier = player_tier(overall)

    factors = {
        "baseline": 0.0,
        "status": 0.0,
        "teamPerformance": 0.0,
        "expectations": 0.0,
        "role": 0.0,
        "playingTime": 0.0,
        "availability": 0.0,
        "contract": 0.0,
        "futureSecurity": 0.0,
        "careerStage": 0.0,
        "teamFit": 0.0,
        "continuity": 0.0,
        "tradeContext": 0.0,
        "history": 0.0,
    }
    events: List[Dict[str, Any]] = []

    add_event(
        events,
        "Season Baseline",
        0,
        f"{player_name(player)} starts the season from a neutral 50 mood baseline.",
        f"OVR {round_int(overall)}, POT {round_int(potential)}, role expectation: {expected_role.get('label')}.",
        event_type="baseline",
        duration="season",
        date=season_opening_date(league_data),
    )

    status_impact = 0.0
    if overall >= 95:
        status_impact = 16.0
    elif overall >= 90:
        status_impact = 10.0
    elif overall >= 84:
        status_impact = 5.0
    elif overall >= 78:
        status_impact = 2.0
    if status_impact:
        factors["status"] += status_impact
        add_event(
            events,
            "Star Status" if overall >= 84 else "Roster Status",
            status_impact,
            "His standing in the league gives him confidence and leverage.",
            f"OVR {round_int(overall)} status modifier.",
            event_type="status",
            duration="active_condition",
            date=season_opening_date(league_data),
        )

    for tag in historical_tags:
        impact = num(tag.get("impact"), 0)
        factors["history"] += impact
        add_event(
            events,
            str(tag.get("category") or "History"),
            impact,
            str(tag.get("label") or "Historical context"),
            str(tag.get("detail") or "Preloaded player context affects this player's reactions."),
            event_type=str(tag.get("type") or "historical_modifier"),
            duration=str(tag.get("duration") or ("temporary" if num(tag.get("decayPctPerWeek") or tag.get("decayPerWeek"), 0) > 0 else "long_term")),
            date=str(tag.get("date") or season_opening_date(league_data)),
            source="preloaded_history",
            base_impact=num(tag.get("baseImpact", impact), impact),
            decay_per_week=num(tag.get("decayPerWeek"), 0),
            decay_pct_per_week=num(tag.get("decayPctPerWeek") or tag.get("decayPercentPerWeek"), 0),
            decay_mode=str(tag.get("decayMode") or "percent_of_original"),
            modifier_type=str(tag.get("modifierType") or ("temporary" if num(tag.get("decayPctPerWeek") or tag.get("decayPerWeek"), 0) > 0 else "permanent")),
        )

    factors["history"] += apply_stored_mood_events(events, league_data, player)
    factors["history"] += seeded_bucks_story_events(events, league_data, team, player)
    factors["teamFit"] += superstar_carrying_event(events, league_data, team, player)
    factors["teamFit"] += superstar_unrest_team_event(events, league_data, team, player)

    # Team performance and expectation gap.
    effective_win_pct = win_pct
    if effective_win_pct is None:
        effective_win_pct = profile_results.get("recentWinPct") if isinstance(profile_results, dict) else None

    factors["expectations"] += expectation_gap_event(events, team_name, wins, losses, team_expectation, player, personality)
    factors["expectations"] += playoff_expectation_event(events, league_data, team_name, team_expectation, player, personality)

    if effective_win_pct is not None:
        if effective_win_pct >= 0.650:
            impact = 10 * (0.82 + role_weight * 0.18)
            factors["teamPerformance"] += impact
            add_event(events, "Winning", impact, f"{team_name} is playing like a top contender.", f"Record context: {wins}-{losses}", event_type="team_result", duration="active")
        elif effective_win_pct >= 0.550:
            impact = 6 * (0.84 + role_weight * 0.16)
            factors["teamPerformance"] += impact
            add_event(events, "Winning", impact, "Winning situation is helping morale.", f"Record context: {wins}-{losses}", event_type="team_result", duration="active")
        elif effective_win_pct <= 0.300:
            impact = (-7 if age < 26 and upside >= 4 else -12) * (0.65 + role_weight * 0.35)
            factors["teamPerformance"] += impact
            add_event(events, "Losing", impact, "Losing is weighing on him.", f"Record context: {wins}-{losses}", event_type="team_result", duration="active")
        elif effective_win_pct <= 0.400:
            impact = (-4 if age < 26 and upside >= 4 else -8) * (0.70 + role_weight * 0.30)
            factors["teamPerformance"] += impact
            add_event(events, "Losing", impact, "Team results are below a stable morale level.", f"Record context: {wins}-{losses}", event_type="team_result", duration="active")

    # Direction/timeline fit.
    if direction in ["contending", "win now"] and age >= 29 and overall >= 76:
        impact = 4 + min(3, (age - 29) * 0.4)
        factors["teamFit"] += impact
        add_event(events, "Timeline Fit", impact, "His career stage fits a win-now team.", f"Team direction: {direction}", event_type="timeline", duration="active")
    if direction == "rebuilding" and age <= 24 and upside >= 3:
        impact = 5 + min(4, upside * 0.45)
        factors["teamFit"] += impact
        add_event(events, "Development Fit", impact, "A rebuilding timeline gives his development more room.", f"POT {round_int(potential)} / OVR {round_int(overall)}", event_type="timeline", duration="active")
    if direction == "rebuilding" and age >= 30 and overall >= 80:
        impact = -9 * (0.85 + role_weight * 0.15)
        factors["teamFit"] += impact
        add_event(events, "Timeline Clash", impact, "Veteran talent may be impatient with a rebuild.", f"Team direction: {direction}", event_type="timeline", duration="active")

    # Role and hierarchy.
    if status == "standard":
        expected_max_rank = int(expected_role["maxRank"])
        if rank <= expected_max_rank:
            impact = (6 if overall >= 80 else 3) * (0.85 + role_weight * 0.15)
            factors["role"] += impact
            add_event(events, "Role", impact, "His team role matches his talent level.", f"Role rank: #{rank}; expected: {expected_role['label']}", event_type="role", duration="active")
        else:
            gap = rank - expected_max_rank
            impact = -min(22, 4 + gap * 2.6) * (0.70 + role_weight * 0.30)
            if age <= 24 and upside >= 4:
                impact -= 4
            factors["role"] += impact
            add_event(events, "Role", impact, "He feels underused relative to his talent.", f"Expected: {expected_role['label']}; current rank: #{rank}", event_type="role", duration="active")

        mpg = float(num(stats.get("minutesPerGame"), 0))
        expected_mpg = float(expected_role["minutes"])
        minutes_source = str(stats.get("minutesSource") or stats.get("source") or "")
        if mpg > 0:
            minute_detail = f"{mpg:.1f} MPG"
            planned_detail = float(num(stats.get("plannedMinutesPerGame"), 0))
            if planned_detail > 0 and abs(planned_detail - mpg) > 0.1:
                minute_detail += f"; current gameplan {planned_detail:.1f}"
            elif minutes_source == "coach_gameplan":
                minute_detail = f"Current gameplan: {mpg:.1f} MPG"

            if mpg >= expected_mpg - 3:
                impact = 4 * (0.85 + role_weight * 0.15)
                factors["playingTime"] += impact
                add_event(events, "Minutes", impact, "Minutes look aligned with his expected role.", minute_detail, event_type="minutes", duration="active")
            elif mpg <= max(4, expected_mpg - 10):
                impact = -min(19, (expected_mpg - mpg) * 0.88) * (0.72 + role_weight * 0.28)
                factors["playingTime"] += impact
                add_event(events, "Minutes", impact, "His minutes are below what a player like him expects.", f"{minute_detail} vs expected around {expected_mpg:.0f}", event_type="minutes", duration="active")
            elif mpg < expected_mpg - 5:
                impact = -min(10, (expected_mpg - mpg) * 0.62) * (0.76 + role_weight * 0.24)
                factors["playingTime"] += impact
                add_event(events, "Minutes", impact, "Minutes are a little below his preferred role.", f"{minute_detail} vs expected around {expected_mpg:.0f}", event_type="minutes", duration="active")
        elif overall >= 78:
            impact = -7 * (0.75 + role_weight * 0.25)
            factors["playingTime"] += impact
            add_event(events, "Minutes", impact, "No reliable minutes or gameplan data found for a rotation-level player.", "Missing minutes data", event_type="minutes", duration="active")
    elif status == "two_way":
        if overall >= 73 or potential >= 78:
            impact = -7
            factors["role"] += impact
            add_event(events, "Role", impact, "He may want a standard roster spot soon.", "Currently two-way", event_type="role", duration="active")
        else:
            factors["careerStage"] += 2
            add_event(events, "Development", 2, "Two-way status is reasonable for his current stage.", "Currently two-way", event_type="role", duration="active")
    elif status == "stash":
        if potential >= 78:
            factors["futureSecurity"] -= 4
            add_event(events, "Development", -4, "He may want clarity on when he joins the NBA roster.", "Currently stashed", event_type="role", duration="active")

    # Contract / next deal pressure.
    rookie_scale_mood_exempt = is_rookie_scale_mood_exempt(player, contract, season_year, salary, years_left)
    if salary > 0 and expected_aav > 0:
        salary_ratio = salary / max(1, expected_aav)
        if salary_ratio <= 0.55 and overall >= 78 and not rookie_scale_mood_exempt:
            impact = (-11 if years_left <= 2 else -7) * (0.75 + role_weight * 0.25)
            factors["contract"] += impact
            add_event(events, "Contract", impact, "He appears underpaid compared with his current market value.", f"Salary ${salary:,}; estimated market AAV ${expected_aav:,}", event_type="contract", duration="active")
        elif salary_ratio >= 1.10:
            impact = 4 if overall < 84 else 3
            factors["contract"] += impact
            add_event(events, "Contract", impact, "Contract security is helping his mood.", f"Salary ${salary:,}", event_type="contract", duration="active")
        elif salary_ratio >= 0.85:
            factors["contract"] += 2

    if years_left <= 0:
        impact = -7 * (0.82 + role_weight * 0.18)
        factors["futureSecurity"] += impact
        add_event(events, "Next Contract", impact, "No secure future salary is stored for him.", "Free-agency uncertainty", event_type="contract", duration="active")
    elif years_left == 1:
        if overall >= 80 or age <= 25:
            impact = -6 * (0.80 + role_weight * 0.20)
            factors["futureSecurity"] += impact
            add_event(events, "Next Contract", impact, "He is entering a contract year and thinking about his next deal.", "1 year left", event_type="contract", duration="active")
        else:
            factors["futureSecurity"] -= 2
    elif years_left >= 3:
        impact = 4 if overall < 88 else 2
        factors["futureSecurity"] += impact
        add_event(events, "Security", impact, "Multi-year security is stabilizing his mood.", f"{years_left} years left", event_type="contract", duration="active")

    if option_label:
        impact = -3 if option_label == "Team Option" and overall >= 76 else -1
        factors["futureSecurity"] += impact
        add_event(events, "Option Year", impact, f"{option_label} adds some uncertainty.", "Option decision can affect long-term security.", event_type="contract", duration="active")

    # Performance / production context.
    gp = int(num(stats.get("games"), 0))
    ppg = float(num(stats.get("pointsPerGame"), 0))
    apg = float(num(stats.get("assistsPerGame"), 0))
    rpg = float(num(stats.get("reboundsPerGame"), 0))
    if gp > 0:
        if overall >= 84 and ppg >= 20:
            impact = 3 + min(4, (ppg - 20) * 0.25)
            factors["careerStage"] += impact
            add_event(events, "Production", impact, "His production matches a lead-player role.", f"{ppg:.1f} PPG", event_type="production", duration="active")
        elif overall >= 84 and ppg < 14:
            impact = -5 * (0.80 + role_weight * 0.20)
            factors["careerStage"] += impact
            add_event(events, "Production", impact, "His box-score role may not match his star talent.", f"{ppg:.1f} PPG", event_type="production", duration="active")
        elif 76 <= overall < 84 and (ppg >= 12 or apg >= 5 or rpg >= 7):
            factors["careerStage"] += 2
            add_event(events, "Production", 2, "He is producing within his role.", f"{ppg:.1f} PPG, {rpg:.1f} RPG, {apg:.1f} APG", event_type="production", duration="active")

        if team_games_played > 0:
            missed_games = max(0, int(team_games_played) - gp)
            played_share = gp / max(1, int(team_games_played))
            if int(team_games_played) >= 20 and missed_games >= 8 and played_share < 0.75 and not player.get("injury"):
                impact = -5 if played_share < 0.45 else -3
                factors["availability"] += impact
                add_event(events, "Availability", impact, "Low games played may be affecting rhythm or role security.", f"{gp} GP out of roughly {int(team_games_played)} team games", event_type="availability", duration="active")

    # Young upside buried on depth chart.
    if age <= 23 and potential >= overall + 5 and status == "standard" and rank > 9:
        impact = -8 - min(5, upside * 0.35)
        factors["careerStage"] += impact
        add_event(events, "Development", impact, "Young upside player is buried on the depth chart.", f"POT {round_int(potential)} / rank #{rank}", event_type="development", duration="active")

    # Continuity.
    if years_with_team >= 3 and effective_win_pct is not None and effective_win_pct >= 0.500:
        impact = 3
        factors["continuity"] += impact
        add_event(events, "Continuity", impact, "Winning with a familiar team helps stability.", f"{years_with_team} years with team", event_type="continuity", duration="active")
    elif years_with_team >= 3 and effective_win_pct is not None and effective_win_pct < 0.400 and overall >= 80:
        impact = -3 * (0.85 + role_weight * 0.15)
        factors["continuity"] += impact
        add_event(events, "Continuity", impact, "Long-term losing with the same team can create restlessness.", f"{years_with_team} years with team", event_type="continuity", duration="active")

    factors["tradeContext"] += trade_context_events(events, league_data, team_name, player, personality, historical_tags)

    # Depth/fringe stability: do not punish low-end guys like stars unless they have real upside concerns.
    if overall < 74 and potential < 78 and status == "standard":
        impact = 3
        factors["careerStage"] += impact
        add_event(events, "Role Acceptance", impact, "Depth players with secure roster spots are generally happy to be in the league.", f"OVR {round_int(overall)} role-player baseline", event_type="personality", duration="active")

    visible_event_delta = sum(num(e.get("impact"), 0) for e in events)
    raw_score = baseline + sum(factors.values())
    mood_score = round_int(clamp(raw_score, 0, 100))

    # Do not create a fake "Other Context" row only to force the visible event log
    # to mathematically equal the final mood score. The UI should show real causes only.
    if mood_score >= 88:
        label, tone = "Thriving", "elite"
    elif mood_score >= 76:
        label, tone = "Happy", "positive"
    elif mood_score >= 63:
        label, tone = "Content", "neutral"
    elif mood_score >= 50:
        label, tone = "Uneasy", "warning"
    elif mood_score >= 35:
        label, tone = "Frustrated", "negative"
    else:
        label, tone = "Very Frustrated", "critical"

    negative_events = [r for r in events if num(r.get("impact"), 0) < 0]
    if negative_events:
        main = sorted(negative_events, key=lambda r: num(r.get("impact"), 0))[0]
        main_concern = main.get("category") or "Role"
    else:
        main_concern = "None"

    active_delta = round(raw_score - 50, 1)
    if active_delta >= 8:
        trend = "rising"
    elif active_delta <= -8:
        trend = "falling"
    else:
        trend = "stable"

    # Calendar wiring: active engine-generated events should reflect the league's
    # current calendar date instead of looking permanently stuck on opening night.
    for event in events:
        if (
            event.get("source") == "mood_engine"
            and event.get("duration") in ["active", "active_condition", "short_term", "30_days", "45_days", "temporary"]
            and event.get("date") == "2025-10-19"
        ):
            event["date"] = current_date
            event["dateLabel"] = format_date_label(current_date)

    # Current UI reads reasons. Make these the strongest ledger events so the
    # page immediately shows the story even without UI changes.
    reasons_sorted = sorted(events, key=lambda r: (abs(num(r.get("impact"), 0)), -1 if num(r.get("impact"), 0) < 0 else 0), reverse=True)
    event_log_sorted = sorted(events, key=lambda r: (abs(num(r.get("impact"), 0)), r.get("date") or ""), reverse=True)

    wants_out_risk = "low"
    if mood_score < 35 and overall >= 82:
        wants_out_risk = "high"
    elif mood_score < 50 and overall >= 84:
        wants_out_risk = "medium"
    elif mood_score < 45 and overall >= 78:
        wants_out_risk = "medium"

    return {
        "playerId": player.get("id") or player.get("playerId"),
        "playerKey": player_key(player),
        "playerName": player_name(player),
        "name": player_name(player),
        "headshot": player.get("headshot") or player.get("playerHeadshot") or player.get("image") or "",
        "position": player.get("pos") or player.get("position") or "-",
        "secondaryPos": player.get("secondaryPos") or player.get("secondaryPosition"),
        "age": age,
        "overall": round_int(overall),
        "potential": round_int(potential),
        "rosterStatus": status,
        "baseMood": 50,
        "moodScore": mood_score,
        "moodLabel": label,
        "moodTone": tone,
        "trend": trend,
        "mainConcern": main_concern,
        "wantsOutRisk": wants_out_risk,
        "factors": {k: round(v, 1) for k, v in factors.items()},
        "reasons": reasons_sorted[:12],
        "eventLog": event_log_sorted[:20],
        "activeModifiers": [e for e in reasons_sorted if e.get("duration") not in ["expired"]][:12],
        "historicalTags": historical_tags,
        "personality": personality,
        "role": {
            "rank": rank if status == "standard" else None,
            "actualRole": actual_role,
            "expectedRole": expected_role.get("label"),
            "expectedMinutes": expected_role.get("minutes"),
            "usageClass": expected_role.get("usageClass"),
        },
        "contract": {
            "salary": int(salary),
            "yearsLeft": int(years_left),
            "optionLabel": option_label,
            "estimatedMarketAAV": int(expected_aav),
        },
        "stats": stats,
        "expectationProfile": team_expectation,
    }


# -----------------------------------------------------------------------------
# Public endpoint
# -----------------------------------------------------------------------------

def get_locker_room_moods(league_data: Dict[str, Any], team_name: Optional[str] = None) -> Dict[str, Any]:
    team = find_team(league_data, team_name)
    if not team:
        return {"ok": False, "reason": "No team found in leagueData.", "players": []}

    resolved_team_name = get_team_name(team)
    profile = build_team_profile(team, league_data)
    expectation = get_team_expectation(league_data, team)
    all_expectations = infer_team_expectations(league_data)
    players = get_roster_players_with_status(team)
    rows = [evaluate_player_mood(league_data, team, profile, expectation, player) for player in players]

    # Keep user's current UI behavior: worst mood first if the page sorts this way,
    # but include enough data for OVR sorting too.
    rows.sort(key=lambda row: (row.get("moodScore", 0), -num(row.get("overall"), 0), str(row.get("playerName", ""))))

    avg = sum(num(row.get("moodScore"), 0) for row in rows) / max(1, len(rows))
    low_count = sum(1 for row in rows if num(row.get("moodScore"), 0) < 55)
    high_count = sum(1 for row in rows if num(row.get("moodScore"), 0) >= 76)
    wants_out_count = sum(1 for row in rows if row.get("wantsOutRisk") in ["medium", "high"])

    return {
        "ok": True,
        "version": MOOD_SYSTEM_VERSION,
        "teamName": resolved_team_name,
        "teamLogo": team_logo_of(team),
        "seasonYear": get_current_season_year(league_data),
        "summary": {
            "averageMood": round(avg, 1),
            "lowMoodCount": low_count,
            "happyCount": high_count,
            "playerCount": len(rows),
            "wantsOutWatchCount": wants_out_count,
            "teamDirection": profile.get("direction") or "balanced",
            "teamDirectionConfidence": profile.get("directionConfidence"),
            "top3Overall": profile.get("top3Overall"),
            "top8Overall": profile.get("top8Overall"),
            "preseasonTier": expectation.get("preseasonTier"),
            "preseasonPowerRank": expectation.get("preseasonPowerRank"),
            "expectedWins": expectation.get("expectedWins"),
            "expectedPlayoffResult": expectation.get("expectedPlayoffResult"),
            "pressureLevel": expectation.get("pressureLevel"),
        },
        "players": rows,
        "teamProfile": profile,
        "teamExpectation": expectation,
        "leagueExpectations": all_expectations,
        "moodSystem": {
            "version": MOOD_SYSTEM_VERSION,
            "mode": "ck3_expectation_ledger",
            "notes": [
                "Mood is now expectation-relative instead of raw-record-only.",
                "High-end players have higher ambition, role pressure, and winning sensitivity.",
                "Depth players are more stable unless development/role context says otherwise.",
                "Historical tags and trade context produce mood events.",
            ],
        },
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
