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
        }

    # simple games-played cutoff so some random 10-game guy doesn't win
    MIN_GAMES = 40

    eligible = [p for p in players if _gp(p) >= MIN_GAMES]
    if not eligible:
        eligible = players

    # -----------------------
    # MVP: highest PPG ladder
    # -----------------------
    # sort once by your current metric (PPG)
    mvp_sorted = sorted(eligible, key=_ppg, reverse=True)
    # ladder = top N with per-game stats
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

    # ROTY + Sixth Man: placeholders for now
    roty = None
    sixth_man = None
    roty_race: List[Dict[str, Any]] = []
    sixth_man_race: List[Dict[str, Any]] = []

    return {
        "season": season_js,
        # winners (exactly as before, just with a couple extra fields)
        "mvp": mvp,
        "dpoy": dpoy,
        "roty": roty,
        "sixth_man": sixth_man,
        # 🔥 full award ladders – entirely Python-driven
        "mvp_race": mvp_race,
        "dpoy_race": dpoy_race,
        "roty_race": roty_race,
        "sixth_man_race": sixth_man_race,
    }
