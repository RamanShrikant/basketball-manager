"""
trade_team_ai.py

Team-direction / team-personality helpers for Basketball Manager trade CPU.

This file is intentionally easy to edit. It answers questions like:
- Is a team contending, rebuilding, retooling, or tanking?
- Does that team prefer current talent, young players, picks, or cap flexibility?
- Are there manual team personality overrides?

It does not mutate league data. It only returns context/weights used by the trade CPU.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List


# -----------------------------------------------------------------------------
# Main knobs your friend can tune
# -----------------------------------------------------------------------------

PHASE_PREFERENCES: Dict[str, Dict[str, float]] = {
    # Current = win-now overall. Upside = age/potential. Picks = draft capital.
    "contender": {
        "currentTalent": 1.18,
        "upside": 0.72,
        "picks": 0.82,
        "salaryFlex": 0.82,
        "starRetention": 1.25,
    },
    "playoff": {
        "currentTalent": 1.08,
        "upside": 0.88,
        "picks": 0.90,
        "salaryFlex": 0.90,
        "starRetention": 1.12,
    },
    "middle": {
        "currentTalent": 1.00,
        "upside": 1.00,
        "picks": 1.00,
        "salaryFlex": 1.00,
        "starRetention": 1.00,
    },
    "retool": {
        "currentTalent": 0.92,
        "upside": 1.16,
        "picks": 1.08,
        "salaryFlex": 1.08,
        "starRetention": 0.95,
    },
    "rebuild": {
        "currentTalent": 0.78,
        "upside": 1.34,
        "picks": 1.22,
        "salaryFlex": 1.16,
        "starRetention": 0.82,
    },
    "tank": {
        "currentTalent": 0.70,
        "upside": 1.42,
        "picks": 1.30,
        "salaryFlex": 1.22,
        "starRetention": 0.72,
    },
}

# Optional team-specific personality overrides.
# Keep keys as actual team names. Values multiply the phase preferences above.
TEAM_PERSONALITY_OVERRIDES: Dict[str, Dict[str, float]] = {
    # Examples for later tuning:
    # "Oklahoma City Thunder": {"picks": 0.90, "upside": 1.10},
    # "Miami Heat": {"currentTalent": 1.08, "starRetention": 1.08},
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


def team_name_of(team_or_name: Any) -> str:
    if isinstance(team_or_name, dict):
        return _str(team_or_name.get("name") or team_or_name.get("teamName"), "")
    return _str(team_or_name, "")


def _team_players(team: Dict[str, Any]) -> List[Dict[str, Any]]:
    players = team.get("players") if isinstance(team, dict) else []
    return players if isinstance(players, list) else []


def _player_overall(player: Dict[str, Any]) -> float:
    return _num(
        player.get("overall")
        or player.get("ovr")
        or player.get("rating")
        or player.get("overallRating"),
        60.0,
    )


def _player_age(player: Dict[str, Any]) -> float:
    return _num(player.get("age"), 27.0)


def _team_record_from_sources(team: Dict[str, Any], team_context: Dict[str, Any] | None = None) -> Dict[str, float]:
    name = team_name_of(team)
    context_row = {}

    if isinstance(team_context, dict):
        context_row = team_context.get(name) or team_context.get(normalize_name(name)) or {}
        if not isinstance(context_row, dict):
            context_row = {}

    wins = _num(
        context_row.get("wins")
        if "wins" in context_row
        else team.get("wins")
        or (team.get("record") or {}).get("wins")
        or (team.get("seasonRecord") or {}).get("wins")
        or (team.get("stats") or {}).get("wins"),
        0.0,
    )
    losses = _num(
        context_row.get("losses")
        if "losses" in context_row
        else team.get("losses")
        or (team.get("record") or {}).get("losses")
        or (team.get("seasonRecord") or {}).get("losses")
        or (team.get("stats") or {}).get("losses"),
        0.0,
    )
    return {"wins": wins, "losses": losses}


def average_top_overall(team: Dict[str, Any], count: int = 8) -> float:
    overalls = sorted(
        [_player_overall(p) for p in _team_players(team) if isinstance(p, dict)],
        reverse=True,
    )[:count]
    if not overalls:
        return 0.0
    return sum(overalls) / len(overalls)


def average_roster_age(team: Dict[str, Any]) -> float:
    ages = [_player_age(p) for p in _team_players(team) if isinstance(p, dict)]
    if not ages:
        return 27.0
    return sum(ages) / len(ages)


# -----------------------------------------------------------------------------
# Public API
# -----------------------------------------------------------------------------


def infer_team_phase(team: Dict[str, Any] | str, team_context: Dict[str, Any] | None = None) -> str:
    """
    Return one of: contender, playoff, middle, retool, rebuild, tank.

    Priority:
    1. Explicit phase/status from team_context or team object.
    2. Win percentage if record exists.
    3. Roster strength fallback.
    """
    if isinstance(team, str):
        team_obj: Dict[str, Any] = {"name": team}
    elif isinstance(team, dict):
        team_obj = team
    else:
        team_obj = {"name": ""}

    name = team_name_of(team_obj)
    context_row = {}
    if isinstance(team_context, dict):
        context_row = team_context.get(name) or team_context.get(normalize_name(name)) or {}
        if not isinstance(context_row, dict):
            context_row = {}

    explicit = _str(
        context_row.get("phase")
        or context_row.get("status")
        or team_obj.get("phase")
        or team_obj.get("status")
        or team_obj.get("direction"),
        "",
    ).lower().strip()

    if explicit in PHASE_PREFERENCES:
        return explicit

    record = _team_record_from_sources(team_obj, team_context)
    games = record["wins"] + record["losses"]
    if games > 0:
        win_pct = record["wins"] / max(games, 1)
        if win_pct >= 0.62:
            return "contender"
        if win_pct >= 0.52:
            return "playoff"
        if win_pct >= 0.43:
            return "middle"
        if win_pct >= 0.32:
            return "retool"
        return "rebuild"

    top_overall = average_top_overall(team_obj)
    avg_age = average_roster_age(team_obj)

    if top_overall >= 85:
        return "contender"
    if top_overall >= 81:
        return "playoff"
    if top_overall >= 78:
        return "middle"
    if top_overall >= 75 or avg_age <= 25:
        return "retool"
    return "rebuild"


def get_team_preferences(team: Dict[str, Any] | str, team_context: Dict[str, Any] | None = None) -> Dict[str, Any]:
    """Return phase and preference multipliers for a team."""
    team_name = team_name_of(team)
    phase = infer_team_phase(team, team_context)
    base = dict(PHASE_PREFERENCES.get(phase, PHASE_PREFERENCES["middle"]))

    override = None
    normalized_team = normalize_name(team_name)
    for key, values in TEAM_PERSONALITY_OVERRIDES.items():
        if normalize_name(key) == normalized_team:
            override = values
            break

    if isinstance(override, dict):
        for pref_key, multiplier in override.items():
            if pref_key in base:
                base[pref_key] = base[pref_key] * _num(multiplier, 1.0)

    return {
        "teamName": team_name,
        "phase": phase,
        "preferences": base,
    }
