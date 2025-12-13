# awards.py

from typing import Any, Dict, List, Optional


def _to_py_players(players_js) -> List[Dict[str, Any]]:
    """
    Convert the JS → Pyodide proxy list into a normal list[dict].
    """
    out = []
    for p in list(players_js):
        try:
            out.append(dict(p))
        except Exception:
            out.append(p)
    return out


def _gp(p: Dict[str, Any]) -> int:
    return int(p.get("gp", 0))


def _ppg(p: Dict[str, Any]) -> float:
    gp = max(_gp(p), 1)
    return float(p.get("pts", 0)) / gp


def _rpg(p: Dict[str, Any]) -> float:
    gp = max(_gp(p), 1)
    return float(p.get("reb", 0)) / gp


def _apg(p: Dict[str, Any]) -> float:
    gp = max(_gp(p), 1)
    return float(p.get("ast", 0)) / gp


def _spg(p: Dict[str, Any]) -> float:
    gp = max(_gp(p), 1)
    return float(p.get("stl", 0)) / gp


def _bpg(p: Dict[str, Any]) -> float:
    gp = max(_gp(p), 1)
    return float(p.get("blk", 0)) / gp


def _stocks_pg(p: Dict[str, Any]) -> float:
    """Steals + blocks per game (for quick DPOY proxy)."""
    return _spg(p) + _bpg(p)


def _basic_award_payload(
    p: Dict[str, Any],
    metric_name: str,
    metric_value: float,
) -> Dict[str, Any]:
    return {
        "player": p.get("player") or p.get("name"),
        "team": p.get("team"),
        "gp": _gp(p),
        metric_name: round(float(metric_value), 1),
    }


def _mvp_payload(p: Dict[str, Any]) -> Dict[str, Any]:
    """
    Full payload for MVP ladders + winner.
    """
    base = _basic_award_payload(p, "ppg", _ppg(p))
    base["rpg"] = round(_rpg(p), 1)
    base["apg"] = round(_apg(p), 1)
    return base


def _dpoy_payload(p: Dict[str, Any]) -> Dict[str, Any]:
    """
    Full payload for DPOY ladders + winner.
    """
    base = _basic_award_payload(p, "stocks_pg", _stocks_pg(p))
    base["spg"] = round(_spg(p), 1)
    base["bpg"] = round(_bpg(p), 1)
    return base


# ---------------------------------------------------------------------------
# ALL-NBA HELPERS
# ---------------------------------------------------------------------------

def _all_nba_score(p: Dict[str, Any]) -> float:
    """
    Simple impact score for All-NBA selection.
    Positionless: higher = more likely to make All-NBA.
    Feel free to tweak the weights later.
    """
    return (
        1.0 * _ppg(p)
        + 0.7 * _apg(p)
        + 0.5 * _rpg(p)
    )


def _all_nba_payload(p: Dict[str, Any]) -> Dict[str, Any]:
    """
    Payload for All-NBA team entries.
    Mirrors MVP payload so JS can reuse it easily.
    """
    return {
        "player": p.get("player") or p.get("name"),
        "team": p.get("team"),
        "gp": _gp(p),
        "ppg": round(_ppg(p), 1),
        "rpg": round(_rpg(p), 1),
        "apg": round(_apg(p), 1),
    }


def compute_awards(players_js, season_js: Optional[int] = None) -> Dict[str, Any]:
    """
    Entry point used by simWorkerV2.

    players_js: list of season stat dicts from bm_player_stats_v1
    season_js:  season year (optional)
    """
    players = _to_py_players(players_js)
    if not players:
        return {
            "season": season_js,
            "mvp": None,
            "dpoy": None,
            "roty": None,
            "sixth_man": None,
            "mvp_race": [],
            "dpoy_race": [],
            "roty_race": [],
            "sixth_man_race": [],
            # All-NBA placeholders when there are no players
            "all_nba_first": [],
            "all_nba_second": [],
            "all_nba_third": [],
        }

    # simple games-played cutoff so some random 10-game guy doesn't win
    MIN_GAMES = 40

    eligible = [p for p in players if _gp(p) >= MIN_GAMES]
    if not eligible:
        eligible = players

    # -----------------------
    # MVP: highest PPG ladder
    # -----------------------
    mvp_sorted = sorted(eligible, key=_ppg, reverse=True)
    MVP_LADDER_SIZE = 5
    mvp_race = [_mvp_payload(p) for p in mvp_sorted[:MVP_LADDER_SIZE]]
    mvp = mvp_race[0] if mvp_race else None

    # ------------------------------
    # DPOY: highest (STL+BLK)/G ladder
    # ------------------------------
    dpoy_sorted = sorted(eligible, key=_stocks_pg, reverse=True)
    DPOY_LADDER_SIZE = 5
    dpoy_race = [_dpoy_payload(p) for p in dpoy_sorted[:DPOY_LADDER_SIZE]]
    dpoy = dpoy_race[0] if dpoy_race else None

    # ------------------------------
    # ROTY + Sixth Man: placeholders
    # ------------------------------
    roty = None
    sixth_man = None
    roty_race: List[Dict[str, Any]] = []
    sixth_man_race: List[Dict[str, Any]] = []

    # ------------------------------
    # ALL-NBA: positionless Top 15
    # ------------------------------
    # Sort everyone by our impact score
    all_nba_sorted = sorted(eligible, key=_all_nba_score, reverse=True)

    # Take up to 15 players, chunk into 3×5
    first_raw = all_nba_sorted[:5]
    second_raw = all_nba_sorted[5:10]
    third_raw = all_nba_sorted[10:15]

    all_nba_first = [_all_nba_payload(p) for p in first_raw]
    all_nba_second = [_all_nba_payload(p) for p in second_raw]
    all_nba_third = [_all_nba_payload(p) for p in third_raw]

    return {
        "season": season_js,
        # winners
        "mvp": mvp,
        "dpoy": dpoy,
        "roty": roty,
        "sixth_man": sixth_man,
        # ladders
        "mvp_race": mvp_race,
        "dpoy_race": dpoy_race,
        "roty_race": roty_race,
        "sixth_man_race": sixth_man_race,
        # NEW: All-NBA teams (positionless)
        "all_nba_first": all_nba_first,
        "all_nba_second": all_nba_second,
        "all_nba_third": all_nba_third,
    }
