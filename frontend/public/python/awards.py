# awards.py

from typing import Any, Dict, List, Optional

AWARDS_PY_VERSION = "2026-06-28_awards_65gp_bench_6moy_v1"

# ---------------------------------------------------------------------------
# UTILITIES
# ---------------------------------------------------------------------------

def _to_py_players(players_js) -> List[Dict[str, Any]]:
    if players_js is None:
        return []

    out = []
    try:
        iterable = list(players_js)
    except Exception:
        iterable = []

    for p in iterable:
        try:
            out.append(dict(p))
        except Exception:
            out.append(p)
    return out


def _gp(p): return int(p.get("gp", 0))
def _pg(p, k): return float(p.get(k, 0)) / max(_gp(p), 1)

def _ppg(p): return _pg(p, "pts")
def _apg(p): return _pg(p, "ast")
def _rpg(p): return _pg(p, "reb")
def _spg(p): return _pg(p, "stl")
def _bpg(p): return _pg(p, "blk")
def _mpg(p): return float(p.get("min", 0)) / max(_gp(p), 1)

def _started(p): return int(p.get("started", 0) or 0)
def _sixth(p): return int(p.get("sixth", 0) or 0)
def _bench_games(p):
    gp = _gp(p)
    starts = _started(p)
    if "started" in p or "sixth" in p:
        return max(0, gp - starts)
    return max(0, _sixth(p))

def _has_role_data(p):
    return "started" in p or "sixth" in p

def _defr(p) -> float:
    # In this game: defense rating is a 0-100 rating where higher is better.
    try:
        for key in ["def_rating", "defRating", "defensive_rating", "defensiveRating", "drtg", "defrtg"]:
            value = p.get(key)
            if value not in [None, ""]:
                return float(value or 0)
    except Exception:
        pass
    return 0.0

def _rookie_value(p, key):
    if p.get(key) not in [None, ""]:
        return p.get(key)
    meta = p.get("meta") if isinstance(p.get("meta"), dict) else {}
    if meta.get(key) not in [None, ""]:
        return meta.get(key)
    contract = p.get("contract") if isinstance(p.get("contract"), dict) else {}
    return contract.get(key)

def _rookie_int(value, default=None):
    try:
        if value in [None, ""]:
            return default
        return int(float(value))
    except Exception:
        return default

def _rookie_bool(value):
    if isinstance(value, bool):
        return value
    if value in [None, ""]:
        return False
    if isinstance(value, (int, float)):
        return value != 0
    return str(value).strip().lower() in ["true", "yes", "y", "1", "rookie"]

def _season_close(value, season_js):
    year = _rookie_int(value)
    season = _rookie_int(season_js)
    if year is None or season is None:
        return False
    return year == season

def _is_rookie_candidate(p, season_js=None):
    season = _rookie_int(season_js)
    explicit_year_found = False

    for key in ["draftYear", "rookieYear", "rookieSeason", "rookieSeasonYear"]:
        value = _rookie_value(p, key)
        year = _rookie_int(value)
        if year is None:
            continue
        explicit_year_found = True
        if season is not None and year == season:
            return True

    if explicit_year_found:
        return False

    for key in ["isRookie", "rookie", "rookieEligible", "rotyEligible"]:
        value = _rookie_value(p, key)
        if value not in [None, ""] and _rookie_bool(value):
            return True

    contract = p.get("contract") if isinstance(p.get("contract"), dict) else {}
    meta = p.get("meta") if isinstance(p.get("meta"), dict) else {}
    source_text = " ".join(str(x or "").lower() for x in [
        p.get("contractType"), p.get("rosterStatus"), contract.get("type"),
        contract.get("source"), meta.get("acquiredVia"), meta.get("rookieSigningDecision"),
    ])

    if "rookie" in source_text:
        start_year = contract.get("startYear") or meta.get("draftYear") or p.get("draftYear")
        if season_js is None or _season_close(start_year, season_js):
            return True

    for key in ["proSeasons", "seasonsPro", "yearsPro", "yearsOfExperience", "yoe"]:
        pro_seasons = _rookie_int(_rookie_value(p, key))
        if pro_seasons is not None:
            return pro_seasons <= 1

    return False

def _is_young_roty_fallback(p):
    age = _rookie_int(_rookie_value(p, "age"))
    return age is not None and age <= 22

# ---------------------------------------------------------------------------
# NORMALIZATION
# ---------------------------------------------------------------------------

def _norm(v, vmax):
    return 0.0 if vmax <= 0 else max(0.0, min(1.0, v / vmax))

# Range normalization where higher is better (maps lo->0, hi->1)
def _norm_range_hi(v, lo, hi):
    return 0.0 if hi <= lo else max(0.0, min(1.0, (v - lo) / (hi - lo)))

# Balanced win normalization:
# - caps at 82
# - gives every team a 0.30 floor
# - scales linearly from 0.30 to 1.00
# - keeps winning valuable without crushing stars on weaker teams
def _norm_wins(wins: float, cap: float, gamma: float = 2.0) -> float:
    base = _norm(wins, cap)  # [0..1]
    floor = 0.30
    return floor + (1.0 - floor) * base

# ---------------------------------------------------------------------------
# CONTEXT BUILDERS
# ---------------------------------------------------------------------------

def _ctx(players):
    # NOTE: ctx["wins"] stays 82 by design (cap normalization).
    # Safe defaults keep the awards page from crashing before stats exist.
    if not players:
        return {
            "ppg": 1,
            "apg": 1,
            "rpg": 1,
            "spg": 1,
            "bpg": 1,
            "wins": 82,
            "def_lo": 0,
            "def_hi": 100,
        }

    return {
        "ppg": max(max(_ppg(p) for p in players), 1),
        "apg": max(max(_apg(p) for p in players), 1),
        "rpg": max(max(_rpg(p) for p in players), 1),
        "spg": max(max(_spg(p) for p in players), 1),
        "bpg": max(max(_bpg(p) for p in players), 1),
        "wins": 82,
        "def_lo": min(_defr(p) for p in players),
        "def_hi": max(_defr(p) for p in players),
    }

# ---------------------------------------------------------------------------
# IMPACT SCORES
# ---------------------------------------------------------------------------

# MVP:
# 28% team wins, 27% ppg, 11% apg, 11% rpg, 9% spg, 9% bpg, 5% def_rating
def _impact_mvp(p, c):
    return (
        0.28 * _norm_wins(p["_team_wins"], c["wins"], gamma=2.0) +
        0.27 * _norm(_ppg(p), c["ppg"]) +
        0.11 * _norm(_apg(p), c["apg"]) +
        0.11 * _norm(_rpg(p), c["rpg"]) +
        0.09 * _norm(_spg(p), c["spg"]) +
        0.09 * _norm(_bpg(p), c["bpg"]) +
        0.05 * _norm_range_hi(_defr(p), c["def_lo"], c["def_hi"])
    )

# DPOY:
# 32.5% spg, 32.5% bpg, 25% def_rating, 10% team wins
def _impact_dpoy(p, c):
    return (
        0.325 * _norm(_spg(p), c["spg"]) +
        0.325 * _norm(_bpg(p), c["bpg"]) +
        0.25 * _norm_range_hi(_defr(p), c["def_lo"], c["def_hi"]) +
        0.10 * _norm_wins(p["_team_wins"], c["wins"], gamma=2.0)
    )

# 6MOY weights (also used for All-NBA now):
# 15% team wins, 30% ppg, 15% apg, 15% rpg, 10% spg, 10% bpg, 5% def_rating
def _impact_6moy(p, c):
    return (
        0.15 * _norm_wins(p["_team_wins"], c["wins"], gamma=2.0) +
        0.30 * _norm(_ppg(p), c["ppg"]) +
        0.15 * _norm(_apg(p), c["apg"]) +
        0.15 * _norm(_rpg(p), c["rpg"]) +
        0.10 * _norm(_spg(p), c["spg"]) +
        0.10 * _norm(_bpg(p), c["bpg"]) +
        0.05 * _norm_range_hi(_defr(p), c["def_lo"], c["def_hi"])
    )

# ROTY: heavy box-score production, with minutes and team wins as smaller tiebreakers
def _impact_roty(p, c, max_mpg):
    return (
        0.08 * _norm_wins(p["_team_wins"], c["wins"], gamma=2.0) +
        0.34 * _norm(_ppg(p), c["ppg"]) +
        0.14 * _norm(_apg(p), c["apg"]) +
        0.14 * _norm(_rpg(p), c["rpg"]) +
        0.07 * _norm(_spg(p), c["spg"]) +
        0.07 * _norm(_bpg(p), c["bpg"]) +
        0.12 * _norm(_mpg(p), max_mpg) +
        0.04 * _norm_range_hi(_defr(p), c["def_lo"], c["def_hi"])
    )

# MIP: compares current simulated production to the real/saved previous season
# attached by Calendar.jsx from player.history.seasons. This deliberately does
# not require a worker or sim-engine change because it rides inside each row.
def _safe_float(value, default=0.0):
    try:
        if value in [None, ""]:
            return default
        return float(value)
    except Exception:
        return default

def _mip_prev_row(p):
    for key in ["mip_prev", "mipPrev", "previousSeasonStats", "prevSeasonStats"]:
        row = p.get(key)
        if isinstance(row, dict) and row:
            return row
    return {}

def _mip_prev_games(prev):
    return int(_safe_float(prev.get("games", prev.get("gp", 0)), 0))

def _mip_prev_stat(prev, key):
    aliases = {
        "ppg": ["ppg", "pts", "PTS"],
        "rpg": ["rpg", "reb", "REB"],
        "apg": ["apg", "ast", "AST"],
        "spg": ["spg", "stl", "STL"],
        "bpg": ["bpg", "blk", "BLK"],
        "fgPct": ["fgPct", "fg_pct", "FG", "fg"],
        "threePct": ["threePct", "tpPct", "three_pct", "3P", "tp"],
        "ftPct": ["ftPct", "ft_pct", "FT", "ft"],
    }.get(key, [key])

    for alias in aliases:
        if alias in prev and prev.get(alias) not in [None, ""]:
            return _safe_float(prev.get(alias), 0.0)
    return 0.0

def _mip_current_fg_pct(p):
    fga = _safe_float(p.get("fga"), 0.0)
    if fga <= 0:
        return 0.0
    return 100.0 * _safe_float(p.get("fgm"), 0.0) / fga

def _mip_prod(ppg, rpg, apg, spg, bpg):
    return (
        ppg +
        0.55 * rpg +
        0.65 * apg +
        1.35 * spg +
        1.35 * bpg
    )

def _is_mip_candidate(p, season_js=None):
    if _is_rookie_candidate(p, season_js):
        return False

    prev = _mip_prev_row(p)
    if not prev:
        return False

    prev_games = _mip_prev_games(prev)
    if _gp(p) < 65 or prev_games < 25:
        return False

    # Keeps pure garbage-time jumps out while still allowing real breakout bench-to-starter seasons.
    if _mpg(p) < 18:
        return False

    prev_ppg = _mip_prev_stat(prev, "ppg")
    prev_prod = _mip_prod(
        prev_ppg,
        _mip_prev_stat(prev, "rpg"),
        _mip_prev_stat(prev, "apg"),
        _mip_prev_stat(prev, "spg"),
        _mip_prev_stat(prev, "bpg"),
    )
    curr_prod = _mip_prod(_ppg(p), _rpg(p), _apg(p), _spg(p), _bpg(p))

    # Already-superstar seasons should stay in MVP/All-NBA instead of stealing MIP.
    if prev_ppg >= 24.0 and prev_prod >= 32.0:
        return False

    # Require an actual improvement, not just a different stat shape.
    if (curr_prod - prev_prod) < 1.0 and (_ppg(p) - prev_ppg) < 1.0:
        return False

    return True

def _impact_mip(p):
    prev = _mip_prev_row(p)

    prev_ppg = _mip_prev_stat(prev, "ppg")
    prev_rpg = _mip_prev_stat(prev, "rpg")
    prev_apg = _mip_prev_stat(prev, "apg")
    prev_spg = _mip_prev_stat(prev, "spg")
    prev_bpg = _mip_prev_stat(prev, "bpg")
    prev_fg = _mip_prev_stat(prev, "fgPct")

    curr_ppg = _ppg(p)
    curr_rpg = _rpg(p)
    curr_apg = _apg(p)
    curr_spg = _spg(p)
    curr_bpg = _bpg(p)

    prev_prod = _mip_prod(prev_ppg, prev_rpg, prev_apg, prev_spg, prev_bpg)
    curr_prod = _mip_prod(curr_ppg, curr_rpg, curr_apg, curr_spg, curr_bpg)
    prod_delta = curr_prod - prev_prod
    relative_gain = prod_delta / max(prev_prod, 5.0)

    ppg_delta = curr_ppg - prev_ppg
    rpg_delta = curr_rpg - prev_rpg
    apg_delta = curr_apg - prev_apg
    spg_delta = curr_spg - prev_spg
    bpg_delta = curr_bpg - prev_bpg

    fg_delta = _mip_current_fg_pct(p) - prev_fg if prev_fg > 0 else 0.0
    role_bonus = min(_mpg(p), 36.0) / 36.0
    wins_bonus = _norm_wins(p.get("_team_wins", 0), 82, gamma=2.0)

    score = (
        3.25 * max(0.0, relative_gain) +
        0.88 * max(0.0, ppg_delta) +
        0.42 * max(0.0, rpg_delta) +
        0.48 * max(0.0, apg_delta) +
        1.10 * max(0.0, spg_delta) +
        1.10 * max(0.0, bpg_delta) +
        0.18 * max(0.0, fg_delta) +
        0.35 * role_bonus +
        0.18 * wins_bonus
    )

    # Tiny baselines can inflate relative_gain, so temper those cases.
    if prev_prod < 6.0:
        score *= 0.78

    # Strong established scorers can still win, but they need a very real leap.
    if prev_ppg >= 18.0:
        score *= 0.88

    p["_mip"] = score
    p["_mipEligible"] = True
    p["mip_prev_season_year"] = prev.get("seasonYear") or prev.get("season") or prev.get("year")
    p["mip_prev_team"] = prev.get("teamName") or prev.get("team")
    p["mip_prev_games"] = _mip_prev_games(prev)
    p["mip_prev_ppg"] = round(prev_ppg, 3)
    p["mip_prev_rpg"] = round(prev_rpg, 3)
    p["mip_prev_apg"] = round(prev_apg, 3)
    p["mip_ppg_delta"] = round(ppg_delta, 3)
    p["mip_rpg_delta"] = round(rpg_delta, 3)
    p["mip_apg_delta"] = round(apg_delta, 3)
    p["mip_prod_delta"] = round(prod_delta, 3)
    return score

# Finals MVP weights unchanged, but def_rating direction is fixed (higher is better)
def _impact_fmvp(p, c):
    return (
        0.35 * _norm(_ppg(p), c["ppg"]) +
        0.20 * _norm(_apg(p), c["apg"]) +
        0.20 * _norm(_rpg(p), c["rpg"]) +
        0.10 * _norm(_spg(p), c["spg"]) +
        0.10 * _norm(_bpg(p), c["bpg"]) +
        0.05 * _norm_range_hi(_defr(p), c["def_lo"], c["def_hi"])
    )

# ---------------------------------------------------------------------------
# FINALS MVP
# ---------------------------------------------------------------------------

def compute_finals_mvp(finals_players_js, champion_team=None, season_js=None):
    players = _to_py_players(finals_players_js)
    if champion_team:
        players = [p for p in players if p.get("team") == champion_team]
    if not players:
        return {"finals_mvp": None, "finals_mvp_race": [], "season": season_js}

    ctx = _ctx(players)
    for p in players:
        p["_fmvp"] = _impact_fmvp(p, ctx)

    ranked = sorted(players, key=lambda p: p["_fmvp"], reverse=True)
    return {
        "season": season_js,
        "finals_mvp": ranked[0],
        "finals_mvp_race": ranked[:5],
        "awards_py_version": AWARDS_PY_VERSION,
    }

# ---------------------------------------------------------------------------
# MAIN ENTRY
# ---------------------------------------------------------------------------

def compute_awards(players_js, teams_js, season_js=None):
    # --- DEBUG: what did we receive? ---

    players = _to_py_players(players_js)

    # ✅ GUARDRAIL:
    # If teams_js is actually the season year (int), Calendar is calling compute_awards wrong.
    if isinstance(teams_js, (int, float)) and season_js is None:
        season_js = int(teams_js)
        teams_js = []

    if isinstance(teams_js, dict):
        teams_js = list(teams_js.values())

    teams = _to_py_players(teams_js)

    # --- DEBUG: teams payload sanity ---

    team_wins: Dict[str, int] = {}
    for t in teams:
        key = t.get("team") or t.get("name")
        if key is None:
            continue
        team_wins[key] = int(t.get("wins", 0) or 0)

    sample = list(team_wins.items())[:5]
    nonzero = sum(1 for _, w in team_wins.items() if w > 0)

    MIN_GAMES = 65
    eligible = [p for p in players if _gp(p) >= MIN_GAMES]

    for p in eligible:
        p["_team_wins"] = team_wins.get(p.get("team"), 0)

    # --- DEBUG: show team wins for current top few PPG players ---
    top_ppg = sorted(eligible, key=lambda x: _ppg(x), reverse=True)[:5]
    dbg = [(x.get("player"), x.get("team"), _ppg(x), x.get("_team_wins")) for x in top_ppg]

    # Build context from ALL eligible players
    ctx = _ctx(eligible)

    # Compute impacts (MVP + DPOY)
    for p in eligible:
        p["_impact"] = _impact_mvp(p, ctx)
        p["_dpoy"] = _impact_dpoy(p, ctx)

    # MVP ladder
    ranked_mvp = sorted(eligible, key=lambda p: p["_impact"], reverse=True)
    mvp_race = ranked_mvp[:5]

    # -----------------------------------------------------------------------
    # ALL-NBA: NOW USES THE SAME WEIGHTING SYSTEM AS 6MOY,
    # BUT WITHOUT THE "must come off the bench" eligibility requirement.
    # (So we score ALL eligible players using _impact_6moy and rank by that.)
    # -----------------------------------------------------------------------
    for p in eligible:
        p["_allnba"] = _impact_6moy(p, ctx)

    ranked_allnba = sorted(eligible, key=lambda p: p.get("_allnba", 0.0), reverse=True)
    all_nba_first = ranked_allnba[:5]
    all_nba_second = ranked_allnba[5:10]
    all_nba_third = ranked_allnba[10:15]

    # DPOY ladder
    dpoy_sorted = sorted(eligible, key=lambda p: p["_dpoy"], reverse=True)
    dpoy_race = dpoy_sorted[:5]

    # 6MOY eligibility: must come off the bench in more games than he starts.
    def is_6m(p):
        return (
            _gp(p) >= MIN_GAMES and
            _has_role_data(p) and
            _mpg(p) >= 14 and
            _bench_games(p) > _started(p)
        )

    sixth = [p for p in eligible if is_6m(p)]
    ctx6 = _ctx(sixth) if sixth else ctx

    for p in sixth:
        p["_6m"] = _impact_6moy(p, ctx6)

    sixth_sorted = sorted(sixth, key=lambda p: p.get("_6m", 0.0), reverse=True)

    # ROTY ladder
    rookie_candidates = [p for p in eligible if _is_rookie_candidate(p, season_js)]
    if not rookie_candidates:
        rookie_candidates = [p for p in eligible if _is_young_roty_fallback(p)]

    MIN_ROOKIE_GAMES = 30
    rookies = [p for p in rookie_candidates if _gp(p) >= MIN_ROOKIE_GAMES] or rookie_candidates
    ctx_roty = _ctx(rookies) if rookies else ctx
    max_roty_mpg = max((_mpg(p) for p in rookies), default=0)

    for p in rookies:
        p["_roty"] = _impact_roty(p, ctx_roty, max_roty_mpg)
        p["_rookieEligible"] = True

    roty_sorted = sorted(rookies, key=lambda p: p.get("_roty", 0.0), reverse=True)

    # MIP ladder: current simulated stats vs player.history.seasons previous row.
    mip_candidates = [p for p in eligible if _is_mip_candidate(p, season_js)]
    for p in mip_candidates:
        _impact_mip(p)

    mip_sorted = sorted(mip_candidates, key=lambda p: p.get("_mip", 0.0), reverse=True)

    # --- DEBUG: MVP race with wins + impact ---
    dbg_mvp = [(p.get("player"), p.get("team"), p.get("_team_wins"), p.get("_impact")) for p in mvp_race]

    # --- DEBUG: All-NBA top 5 with _allnba score ---
    dbg_allnba = [(p.get("player"), p.get("team"), p.get("_team_wins"), p.get("_allnba")) for p in all_nba_first]

    # --- DEBUG: DPOY race with wins + dpoy score ---
    dbg_dpoy = [(p.get("player"), p.get("team"), p.get("_team_wins"), p.get("_dpoy")) for p in dpoy_race]

    # --- DEBUG: ROTY race with wins + roty score ---
    dbg_roty = [(p.get("player"), p.get("team"), p.get("_team_wins"), p.get("_roty")) for p in roty_sorted[:5]]

    return {
        "season": season_js,
        "mvp": mvp_race[0] if mvp_race else None,
        "mvp_race": mvp_race,

        # All-NBA now strictly from 6MOY-weight ranking (open to all eligible players)
        "all_nba_first": all_nba_first,
        "all_nba_second": all_nba_second,
        "all_nba_third": all_nba_third,

        "dpoy": dpoy_race[0] if dpoy_race else None,
        "dpoy_race": dpoy_race,

        "sixth_man": sixth_sorted[0] if sixth_sorted else None,
        "sixth_man_race": sixth_sorted[:5],

        "mip": mip_sorted[0] if mip_sorted else None,
        "mip_race": mip_sorted[:5],

        "roty": roty_sorted[0] if roty_sorted else None,
        "roty_race": roty_sorted[:5],

        "awards_py_version": AWARDS_PY_VERSION,
    }
