# awards.py


from typing import Any, Dict, List, Optional
AWARDS_PY_VERSION = "2025-12-26_awards_refresh_v1"



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


def _tpg(p: Dict[str, Any]) -> float:
    gp = max(_gp(p), 1)
    return float(p.get("to", 0)) / gp


def _stocks_pg(p: Dict[str, Any]) -> float:
    """Steals + blocks per game (for quick DPOY proxy)."""
    return _spg(p) + _bpg(p)
def _fg_pct(p: Dict[str, Any]) -> Optional[float]:
    fga = float(p.get("fga", 0))
    if fga <= 0:
        return None
    return 100.0 * float(p.get("fgm", 0)) / fga


def _tp_pct(p: Dict[str, Any]) -> Optional[float]:
    tpa = float(p.get("tpa", 0))
    if tpa <= 0:
        return None
    return 100.0 * float(p.get("tpm", 0)) / tpa



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
    """
    return (
        1.0 * _ppg(p)
        + 0.7 * _apg(p)
        + 0.5 * _rpg(p)
    )


def _all_nba_payload(p: Dict[str, Any]) -> Dict[str, Any]:
    """
    Payload for All-NBA team entries.
    """
    return {
        "player": p.get("player") or p.get("name"),
        "team": p.get("team"),
        "gp": _gp(p),
        "ppg": round(_ppg(p), 1),
        "rpg": round(_rpg(p), 1),
        "apg": round(_apg(p), 1),
    }

# ---------------------------------------------------------------------------
# SIXTH MAN HELPERS (ROLE-AWARE)
# Relies on Calendar.jsx now storing per-season fields:
#   started = games started count
#   sixth   = games as "sixth_man" count
# ---------------------------------------------------------------------------

def _mpg(p: Dict[str, Any]) -> float:
    gp = max(_gp(p), 1)
    return float(p.get("min", 0)) / gp


def _started(p: Dict[str, Any]) -> int:
    return int(p.get("started", 0) or 0)


def _sixth(p: Dict[str, Any]) -> int:
    return int(p.get("sixth", 0) or 0)


def _sixth_man_payload(p: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "player": p.get("player") or p.get("name"),
        "team": p.get("team"),
        "gp": _gp(p),
        "ppg": round(_ppg(p), 1),
        "mpg": round(_mpg(p), 1),
        "started": _started(p),
        "sixth": _sixth(p),
    }


# ---------------------------------------------------------------------------
# FINALS MVP (NEW) ✅
# Expects FINALS-ONLY aggregated stat dicts (per player) from JS:
#   {
#     player: "Name",
#     team: "Team",
#     gp: 6,
#     min: 220,
#     pts: 180,
#     reb: 55,
#     ast: 42,
#     stl: 9,
#     blk: 6,
#     to: 14,   # OPTIONAL (safe if missing)
#   }
# ---------------------------------------------------------------------------

def _finals_mvp_score(p: Dict[str, Any]) -> float:
    """
    Finals MVP scoring formula (edit this as desired).
    NOTE: This is per-game based so series length doesn't automatically dominate.
    """
    return (
        1.00 * _ppg(p)
        + 0.70 * _apg(p)
        + 0.55 * _rpg(p)
        + 0.40 * _stocks_pg(p)
        - 0.25 * _tpg(p)
    )


def _finals_mvp_payload(p: Dict[str, Any]) -> Dict[str, Any]:
    fg_pct = _fg_pct(p)
    tp_pct = _tp_pct(p)

    return {
        "player": p.get("player") or p.get("name"),
        "team": p.get("team"),
        "gp": _gp(p),
        "ppg": round(_ppg(p), 1),
        "rpg": round(_rpg(p), 1),
        "apg": round(_apg(p), 1),
        "spg": round(_spg(p), 1),
        "bpg": round(_bpg(p), 1),
        "tpg": round(_tpg(p), 1),
        "fg_pct": round(fg_pct, 1) if fg_pct is not None else None,
        "tp_pct": round(tp_pct, 1) if tp_pct is not None else None,
        "score": round(float(_finals_mvp_score(p)), 2),
    }



def compute_finals_mvp(
    finals_players_js,
    champion_team_js: Optional[str] = None,
    season_js: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Entry point for Finals MVP.
    finals_players_js: list of FINALS-ONLY aggregated stat dicts.
    champion_team_js: used to restrict finalists to champion (fail-closed to that team if provided).
    """
    finals_players = _to_py_players(finals_players_js)
    if not finals_players:
        return {
            "season": season_js,
            "champion_team": champion_team_js,
            "finals_mvp": None,
            "finals_mvp_race": [],
            "awards_py_version": AWARDS_PY_VERSION,
        }

    # Only players who actually appeared in the Finals
    MIN_FINALS_GP = 1
    eligible = [p for p in finals_players if _gp(p) >= MIN_FINALS_GP]

    # If champion team provided, restrict to that team (classic Finals MVP behavior)
    if champion_team_js:
        eligible = [p for p in eligible if p.get("team") == champion_team_js]

    if not eligible:
        return {
            "season": season_js,
            "champion_team": champion_team_js,
            "finals_mvp": None,
            "finals_mvp_race": [],
            "awards_py_version": AWARDS_PY_VERSION,
        }

    fmvp_sorted = sorted(eligible, key=_finals_mvp_score, reverse=True)
    finals_mvp_race = [_finals_mvp_payload(p) for p in fmvp_sorted[:5]]
    finals_mvp = finals_mvp_race[0] if finals_mvp_race else None

    return {
        "season": season_js,
        "champion_team": champion_team_js,
        "finals_mvp": finals_mvp,
        "finals_mvp_race": finals_mvp_race,
        "awards_py_version": AWARDS_PY_VERSION,
    }


def compute_awards(players_js, season_js: Optional[int] = None) -> Dict[str, Any]:
    """
    Entry point used by simWorkerV2.
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
            "all_nba_first": [],
            "all_nba_second": [],
            "all_nba_third": [],
            "awards_py_version": AWARDS_PY_VERSION,

        }

    MIN_GAMES = 40
    eligible = [p for p in players if _gp(p) >= MIN_GAMES]
    if not eligible:
        eligible = players

    # -----------------------
    # MVP
    # -----------------------
    mvp_sorted = sorted(eligible, key=_ppg, reverse=True)
    mvp_race = [_mvp_payload(p) for p in mvp_sorted[:5]]
    mvp = mvp_race[0] if mvp_race else None

    # -----------------------
    # DPOY
    # -----------------------
    dpoy_sorted = sorted(eligible, key=_stocks_pg, reverse=True)
    dpoy_race = [_dpoy_payload(p) for p in dpoy_sorted[:5]]
    dpoy = dpoy_race[0] if dpoy_race else None

    # -----------------------
    # ROTY (unchanged placeholder)
    # -----------------------
    roty = None
    roty_race: List[Dict[str, Any]] = []

    # -----------------------
    # SIXTH MAN (ROLE-AWARE)  ✅ FAIL-CLOSED
    # -----------------------
    # If started/sixth role counts are missing, we do NOT guess.
    # This prevents superstars/starters from ever winning 6MOY due to missing role data.
    def _has_role_counts(pp: Dict[str, Any]) -> bool:
        return ("started" in pp) or ("sixth" in pp)

    def _is_sixth_eligible(pp: Dict[str, Any]) -> bool:
        gp = _gp(pp)
        if gp < MIN_GAMES:
            return False

        if not _has_role_counts(pp):
            return False  # fail-closed (no role info => cannot win 6MOY)

        started = _started(pp)
        sixth = _sixth(pp)
        mpg = _mpg(pp)

        if mpg < 14.0:
            return False
        if started > int(0.20 * gp):  # started too often
            return False
        if sixth < max(10, int(0.25 * gp)):  # must be sixth often enough
            return False

        return True

    sixth_candidates = [p for p in eligible if _is_sixth_eligible(p)]

    # winner rule: best scorer among eligible sixth candidates
    sixth_sorted = sorted(sixth_candidates, key=_ppg, reverse=True)
    sixth_man_race = [_sixth_man_payload(p) for p in sixth_sorted[:5]]
    sixth_man = sixth_man_race[0] if sixth_man_race else None

    # -----------------------
    # ALL-NBA
    # -----------------------
    all_nba_sorted = sorted(eligible, key=_all_nba_score, reverse=True)
    all_nba_first = [_all_nba_payload(p) for p in all_nba_sorted[:5]]
    all_nba_second = [_all_nba_payload(p) for p in all_nba_sorted[5:10]]
    all_nba_third = [_all_nba_payload(p) for p in all_nba_sorted[10:15]]

    return {
        "season": season_js,
        "mvp": mvp,
        "dpoy": dpoy,
        "roty": roty,
        "sixth_man": sixth_man,
        "mvp_race": mvp_race,
        "dpoy_race": dpoy_race,
        "roty_race": roty_race,
        "sixth_man_race": sixth_man_race,
        "all_nba_first": all_nba_first,
        "all_nba_second": all_nba_second,
        "all_nba_third": all_nba_third,
        "awards_py_version": AWARDS_PY_VERSION,  # ✅ add this
    }

