# progression.py
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple
import random
import math
import datetime as _dt

PROGRESSION_PY_VERSION = "2026-01-10_progression_v5_dynamic_potential_blend"


# -------------------------
# Helpers
# -------------------------
def _stoch_round(x: float, rng: random.Random) -> int:
    """
    Stochastic rounding. Preserves expected value better than normal rounding.
    """
    lo = math.floor(float(x))
    frac = float(x) - lo
    if rng.random() < frac:
        return int(lo + 1)
    return int(lo)


def _round_half_up(x: float) -> int:
    return int(math.floor(float(x) + 0.5))


def _clamp(x: float, lo: float, hi: float) -> float:
    return lo if x < lo else hi if x > hi else x


def _safe_int(x: Any, default: int = 0) -> int:
    try:
        if x is None:
            return default
        return int(float(x))
    except Exception:
        return default


def _safe_float(x: Any, default: float = 0.0) -> float:
    try:
        if x is None:
            return default
        return float(x)
    except Exception:
        return default


def _parse_iso_date(date_iso: str) -> _dt.date:
    y, m, d = date_iso.split("-")
    return _dt.date(int(y), int(m), int(d))


def _player_id(p: Dict[str, Any]) -> str:
    for k in ("id", "pid", "playerId", "player_id"):
        if k in p and p[k] is not None:
            return str(p[k])
    return str(p.get("name", p.get("player", "UNKNOWN_PLAYER")))


def _player_name(p: Dict[str, Any]) -> str:
    return str(p.get("name") or p.get("player") or "UNKNOWN_PLAYER")


def _iter_teams(league: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Supports:
      - league["teams"] = [ {name, players:[...]} ]
      - league["conferences"] = { "East":[teams...], "West":[teams...] }
    """
    if not isinstance(league, dict):
        return []

    if isinstance(league.get("teams"), list):
        return [t for t in league["teams"] if isinstance(t, dict)]

    confs = league.get("conferences")
    if isinstance(confs, dict):
        out: List[Dict[str, Any]] = []
        for _, arr in confs.items():
            if isinstance(arr, list):
                out.extend([t for t in arr if isinstance(t, dict)])
        return out

    return []


def _iter_free_agents(league: Dict[str, Any]) -> List[Dict[str, Any]]:
    fas = league.get("freeAgents")
    if isinstance(fas, list):
        return [p for p in fas if isinstance(p, dict)]
    return []


def _team_name(team: Dict[str, Any]) -> str:
    return str(team.get("name") or team.get("team") or "")


def _stat_lookup(
    stats_by_key: Optional[Dict[str, Dict[str, Any]]],
    p: Dict[str, Any],
    team_name: str
) -> Optional[Dict[str, Any]]:
    """
    Supports:
      - player id
      - Player__CurrentTeam
      - Player__PreviousTeam
      - name-only fallback
    """
    if not stats_by_key:
        return None

    pid = _player_id(p)
    name = _player_name(p)

    lookup_keys = [pid]

    if team_name:
        lookup_keys.append(f"{name}__{team_name}")

    prev_team = None
    fam = p.get("freeAgencyMeta")
    if isinstance(fam, dict):
        prev_team = fam.get("fromTeam")

    prev_team = prev_team or p.get("previousTeam") or p.get("team")

    if prev_team:
        lookup_keys.append(f"{name}__{prev_team}")

    lookup_keys.append(name)

    for k in lookup_keys:
        if k in stats_by_key:
            return stats_by_key[k]

    return None


# -------------------------
# Settings
# -------------------------

DEFAULT_SETTINGS: Dict[str, Any] = {
    "min_rating": 25,
    "max_rating": 99,

    "progression": {
        # League balance guardrails.
        "target_avg_shift": 0.00,
        "avg_tolerance": 0.10,
        "governor_strength": 1.00,
        "max_90_count_increase": 1,

        # Attribute movement limits.
        "max_attr_change_per_player": 7,
        "max_total_attr_steps": 100,

        # Slightly more volatility than v4.
        "variance_mult": 1.08,
        "rare_event_mult": 1.06,
    },

    "potential_update": {
        # How strongly potential moves toward the age + overall formula.
        # Lower values preserve old potential more.
        "young_anchor_pull": 0.24,
        "mid_anchor_pull": 0.20,
        "late_anchor_pull": 0.16,

        # How strongly this season's OVR change affects potential.
        "young_progress_signal": 0.58,
        "mid_progress_signal": 0.42,
        "late_progress_signal": 0.26,

        # Potential volatility.
        "young_noise": 0.45,
        "mid_noise": 0.38,
        "late_noise": 0.32,
    },

    "minutes_cap_mpg": 32.0,
    "minutes_min_mpg": 5.0,

    "derived_fields": {
        "off_mult": 0.70,
        "def_mult": 0.70,
        "stamina_mult": 0.45,
        "scoring_mult": 0.40,
        "noise": 0.35,
    },
}


# -------------------------
# Overall calculator
# -------------------------

def _sigmoid_overall(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-0.12 * (x - 77.0)))


_POS_PARAMS = {
    "PG": {
        "weights": [0.11, 0.05, 0.03, 0.05, 0.17, 0.17, 0.10, 0.07, 0.10, 0.02, 0.01, 0.07, 0.05, 0.01, 0.01],
        "prim": [5, 6, 1, 7],
        "alpha": 0.25,
    },
    "SG": {
        "weights": [0.15, 0.08, 0.05, 0.05, 0.12, 0.07, 0.11, 0.07, 0.11, 0.03, 0.02, 0.08, 0.06, 0.01, 0.01],
        "prim": [1, 5, 7],
        "alpha": 0.28,
    },
    "SF": {
        "weights": [0.12, 0.09, 0.07, 0.04, 0.08, 0.07, 0.10, 0.10, 0.10, 0.06, 0.04, 0.08, 0.05, 0.01, 0.01],
        "prim": [1, 8, 9],
        "alpha": 0.22,
    },
    "PF": {
        "weights": [0.07, 0.07, 0.12, 0.03, 0.05, 0.05, 0.08, 0.12, 0.07, 0.13, 0.08, 0.08, 0.05, 0.01, 0.01],
        "prim": [3, 10, 8],
        "alpha": 0.24,
    },
    "C": {
        "weights": [0.04, 0.06, 0.17, 0.03, 0.02, 0.04, 0.07, 0.12, 0.05, 0.16, 0.13, 0.06, 0.08, 0.01, 0.01],
        "prim": [3, 10, 11, 13],
        "alpha": 0.30,
    },
}


def _normalized_pos(pos: Any) -> str:
    p = str(pos or "SF").upper()
    return p if p in _POS_PARAMS else "SF"


def _ensure_attrs(attrs: Any) -> List[int]:
    a = list(attrs or []) if isinstance(attrs, list) else []
    if len(a) < 15:
        a = a + [75] * (15 - len(a))
    elif len(a) > 15:
        a = a[:15]
    return [int(_clamp(_safe_float(v, 75.0), 25, 99)) for v in a]


def calc_overall_from_attrs(attrs: List[Any], pos: str) -> int:
    p = _POS_PARAMS.get(_normalized_pos(pos), _POS_PARAMS["SF"])
    a = _ensure_attrs(attrs)

    weights = p["weights"]
    alpha = float(p["alpha"])
    prim = [int(i) - 1 for i in p["prim"]]

    W = 0.0
    for i in range(15):
        W += float(weights[i]) * float(a[i])

    peak_vals = []
    for idx in prim:
        if 0 <= idx < 15:
            peak_vals.append(float(a[idx]))
    Peak = max(peak_vals) if peak_vals else 75.0

    B = alpha * Peak + (1.0 - alpha) * W

    overall = 60.0 + 39.0 * _sigmoid_overall(B)
    overall = max(60.0, min(99.0, overall))
    overall = int(math.floor(overall + 0.5))

    num90 = sum(1 for v in a if float(v) >= 90.0)
    if num90 >= 3:
        overall = min(99, overall + (num90 - 2))

    return int(overall)


# -------------------------
# Birthdays / aging
# -------------------------

def ensure_progression_fields(league: Dict[str, Any], season_start_year: Optional[int] = None) -> Dict[str, Any]:
    if not isinstance(league, dict):
        return league

    if season_start_year is None:
        season_start_year = _safe_int(
            league.get("seasonYear") or league.get("seasonStartYear") or league.get("season_year") or 2025,
            2025
        )

    for p in _all_players(league):
        if not isinstance(p, dict):
            continue

        p.setdefault("birthMonth", 0)
        p.setdefault("birthDay", 0)
        p.setdefault("potential", _safe_int(p.get("overall"), 70))

        if "lastBirthdayYear" not in p:
            p["lastBirthdayYear"] = season_start_year - 1

        if "age" not in p:
            p["age"] = 25

        if not isinstance(p.get("attrs"), list):
            p["attrs"] = [75] * 15

    league.setdefault("seasonStartYear", season_start_year)
    return league


def apply_birthdays_for_date(league: Dict[str, Any], date_iso: str) -> Dict[str, Any]:
    if not isinstance(league, dict):
        return league

    dt = _parse_iso_date(date_iso)
    year = dt.year
    md_today = (dt.month, dt.day)

    teams = _iter_teams(league)
    for t in teams:
        for p in (t.get("players") or []):
            if not isinstance(p, dict):
                continue

            bm = _safe_int(p.get("birthMonth", 0), 0)
            bd = _safe_int(p.get("birthDay", 0), 0)

            if bm < 1 or bm > 12 or bd < 1 or bd > 31:
                continue

            md_birth = (bm, bd)
            last_y = _safe_int(p.get("lastBirthdayYear"), year - 1)

            if md_today >= md_birth and last_y < year:
                p["age"] = _safe_int(p.get("age"), 25) + 1
                p["lastBirthdayYear"] = year

    return league


# -------------------------
# Standard potential formula
# -------------------------

def _potential_base_age_growth(age: int) -> int:
    if age <= 18:
        return 14
    if age == 19:
        return 13
    if age == 20:
        return 11
    if age == 21:
        return 9
    if age == 22:
        return 8
    if age == 23:
        return 6
    if age == 24:
        return 5
    if age == 25:
        return 4
    if age == 26:
        return 3
    if age == 27:
        return 2
    if age == 28:
        return 1
    return 0


def _potential_overall_multiplier(overall: int) -> float:
    if overall <= 68:
        return 1.05
    if overall <= 72:
        return 1.00
    if overall <= 76:
        return 0.96
    if overall <= 79:
        return 0.87
    if overall <= 84:
        return 0.72
    if overall <= 89:
        return 0.53
    if overall <= 92:
        return 0.40
    if overall <= 94:
        return 0.31
    if overall <= 96:
        return 0.22
    return 0.14


def _potential_base_ceiling(overall: int) -> int:
    if overall <= 68:
        return 80
    if overall <= 72:
        return 83
    if overall <= 76:
        return 87
    if overall <= 79:
        return 89
    if overall <= 84:
        return 92
    if overall <= 89:
        return 94
    if overall <= 92:
        return 96
    if overall <= 94:
        return 97
    if overall <= 96:
        return 98
    return 99


def _potential_age_ceiling_adjustment(age: int) -> int:
    if age <= 20:
        return 2
    if age <= 22:
        return 1
    if age <= 24:
        return 0
    if age <= 26:
        return -1
    if age <= 28:
        return -2
    return -99


def _dynamic_potential_hard_cap(age: int, overall: int) -> int:
    if age >= 29:
        return overall

    if overall >= 97:
        return 99

    cap = _potential_base_ceiling(overall) + _potential_age_ceiling_adjustment(age)

    # Slightly more allowant for young high-overall stars.
    if age <= 20 and overall >= 84:
        cap += 1
    if age <= 22 and overall >= 90:
        cap += 1
    if age <= 24 and overall >= 94:
        cap += 1

    return int(_clamp(cap, overall, 99))


def predict_potential_from_age_and_overall(age: int, overall: int) -> int:
    age = _safe_int(age, 25)
    overall = int(_clamp(_safe_int(overall, 70), 25, 99))

    if age >= 29:
        return overall

    base_growth = _potential_base_age_growth(age)
    multiplier = _potential_overall_multiplier(overall)
    growth = _round_half_up(base_growth * multiplier)

    if age <= 28 and overall < 90 and growth < 1:
        growth = 1

    if age <= 27 and overall >= 97 and growth < 1:
        growth = 1

    max_allowed_potential = _dynamic_potential_hard_cap(age, overall)
    raw_potential = overall + growth

    return int(_clamp(raw_potential, overall, max_allowed_potential))


# -------------------------
# Dynamic potential update
# -------------------------

def _potential_update_settings(settings: Dict[str, Any]) -> Dict[str, Any]:
    return settings.get("potential_update", {}) or {}


def _predict_dynamic_potential_after_progression(
    old_age: int,
    new_age: int,
    old_overall: int,
    new_overall: int,
    old_potential: int,
    settings: Dict[str, Any],
    rng: random.Random
) -> int:
    """
    Potential update after offseason progression.

    This is intentionally NOT a hard reset.

    It blends:
      - previous potential
      - standard age + overall potential anchor
      - this season's actual overall movement
      - small random scouting noise
    """
    old_age = _safe_int(old_age, 25)
    new_age = _safe_int(new_age, old_age + 1)
    old_overall = _safe_int(old_overall, 70)
    new_overall = _safe_int(new_overall, old_overall)
    old_potential = _safe_int(old_potential, max(old_overall, new_overall))

    new_overall = int(_clamp(new_overall, 25, 99))
    old_potential = int(_clamp(old_potential, old_overall, 99))

    # Once a player is 29+, potential mostly means current ability ceiling.
    # If the player improved, potential can still rise because it tracks current overall.
    if new_age >= 29:
        return new_overall

    cfg = _potential_update_settings(settings)

    anchor = predict_potential_from_age_and_overall(new_age, new_overall)
    hard_cap = _dynamic_potential_hard_cap(new_age, new_overall)

    ovr_delta = new_overall - old_overall

    if new_age <= 22:
        anchor_pull = float(cfg.get("young_anchor_pull", 0.24))
        progress_signal = float(cfg.get("young_progress_signal", 0.58))
        noise_sigma = float(cfg.get("young_noise", 0.45))
        lo, hi = -3, 3
    elif new_age <= 25:
        anchor_pull = float(cfg.get("mid_anchor_pull", 0.20))
        progress_signal = float(cfg.get("mid_progress_signal", 0.42))
        noise_sigma = float(cfg.get("mid_noise", 0.38))
        lo, hi = -2, 3
    else:
        anchor_pull = float(cfg.get("late_anchor_pull", 0.16))
        progress_signal = float(cfg.get("late_progress_signal", 0.26))
        noise_sigma = float(cfg.get("late_noise", 0.32))
        lo, hi = -2, 2

    anchor_gap = anchor - old_potential

    # If a player improved this year, do not let the anchor drag potential down too aggressively.
    if ovr_delta > 0 and anchor_gap < 0:
        anchor_gap *= 0.35

    # If a player regressed, do not let a high anchor instantly save his potential.
    if ovr_delta < 0 and anchor_gap > 0:
        anchor_gap *= 0.50

    raw_delta = (anchor_gap * anchor_pull) + (ovr_delta * progress_signal)
    raw_delta += rng.gauss(0.0, noise_sigma)

    # Breakout/collapse nudges.
    if ovr_delta >= 4 and new_age <= 24:
        raw_delta += 0.90
    elif ovr_delta >= 3 and new_age <= 25:
        raw_delta += 0.45

    if ovr_delta <= -4 and new_age <= 26:
        raw_delta -= 0.90
    elif ovr_delta <= -3:
        raw_delta -= 0.45

    pot_delta = _stoch_round(raw_delta, rng)
    pot_delta = int(_clamp(pot_delta, lo, hi))

    # Strong progression should almost never reduce young potential.
    if ovr_delta >= 2 and new_age <= 25 and pot_delta < 0:
        pot_delta = 0

    if ovr_delta >= 4 and new_age <= 24 and pot_delta < 1:
        pot_delta = 1

    # Bad regression should almost never increase potential.
    if ovr_delta <= -2 and pot_delta > 0:
        pot_delta = 0

    # If old potential is above the standard cap, do not instantly crush it.
    # Let it drift down over time unless the player continues progressing.
    if old_potential > hard_cap:
        max_allowed = old_potential
    else:
        max_allowed = hard_cap

    new_potential = old_potential + pot_delta
    new_potential = int(_clamp(new_potential, new_overall, max_allowed))
    new_potential = int(_clamp(new_potential, new_overall, 99))

    return new_potential


def apply_dynamic_potential_recalc(
    league: Dict[str, Any],
    before: Dict[str, Dict[str, Any]],
    settings: Dict[str, Any],
    rng: random.Random
) -> Dict[str, Any]:
    """
    Recalculate potential dynamically after:
      1. progression
      2. age-up

    Uses previous potential, new age, new overall, and actual OVR movement.
    """
    if not isinstance(league, dict):
        return league

    for p, tname in _all_players_with_team(league):
        if not isinstance(p, dict):
            continue

        name = _player_name(p)
        key = f"{name}__{tname}"
        old = before.get(key)

        if not old:
            age = _safe_int(p.get("age"), 25)
            overall = _safe_int(p.get("overall"), 70)
            p["potential"] = predict_potential_from_age_and_overall(age, overall)
            continue

        old_age = _safe_int(old.get("age"), 25)
        new_age = _safe_int(p.get("age"), old_age + 1)
        old_overall = _safe_int(old.get("overall"), 70)
        new_overall = _safe_int(p.get("overall"), old_overall)
        old_potential = _safe_int(old.get("potential"), max(old_overall, new_overall))

        p["potential"] = _predict_dynamic_potential_after_progression(
            old_age = old_age,
            new_age = new_age,
            old_overall = old_overall,
            new_overall = new_overall,
            old_potential = old_potential,
            settings = settings,
            rng = rng
        )

        if "marketValue" in p:
            p.pop("marketValue", None)

    return league


# -------------------------
# Progression model
# -------------------------

def _minutes_factor(mpg: Optional[float], settings: Dict[str, Any]) -> float:
    if mpg is None:
        return 1.0

    lo = float(settings.get("minutes_min_mpg", 5.0))
    hi = float(settings.get("minutes_cap_mpg", 32.0))

    if mpg <= lo:
        return 0.45
    if mpg >= hi:
        return 1.0

    return 0.45 + 0.55 * ((mpg - lo) / (hi - lo))


def _production_score(stats: Optional[Dict[str, Any]]) -> float:
    if not stats:
        return 0.0

    gp = max(_safe_float(stats.get("gp"), 0.0), 0.0)
    if gp <= 0:
        gp = max(_safe_float(stats.get("games"), 0.0), 0.0)
    if gp <= 0:
        return 0.0

    pts = _safe_float(stats.get("pts"), 0.0) / gp
    ast = _safe_float(stats.get("ast"), 0.0) / gp
    reb = _safe_float(stats.get("reb"), 0.0) / gp
    stl = _safe_float(stats.get("stl"), 0.0) / gp
    blk = _safe_float(stats.get("blk"), 0.0) / gp

    return pts + 1.2 * ast + 1.0 * reb + 2.0 * stl + 2.0 * blk


def _stat_context(stats: Optional[Dict[str, Any]], settings: Dict[str, Any]) -> Tuple[float, float]:
    mpg: Optional[float] = None

    if isinstance(stats, dict):
        if "mpg" in stats and stats["mpg"] is not None:
            mpg = _safe_float(stats.get("mpg"), None)
        else:
            gp = _safe_float(stats.get("gp"), 0.0)
            if gp <= 0:
                gp = _safe_float(stats.get("games"), 0.0)

            mins = _safe_float(stats.get("min"), 0.0)
            if mins <= 0:
                mins = _safe_float(stats.get("mins"), 0.0)
            if mins <= 0:
                mins = _safe_float(stats.get("minutes"), 0.0)

            if gp > 0 and mins > 0:
                mpg = mins / gp

    min_fac = _minutes_factor(mpg, settings)
    prod_score = _production_score(stats)

    prod_adj = _clamp((prod_score - 20.0) / 22.0, -0.35, 0.35) if prod_score > 0 else 0.0
    return min_fac, prod_adj


def _age_expected_delta(age: int) -> float:
    if age <= 18:
        return 1.25
    if age == 19:
        return 1.15
    if age == 20:
        return 1.00
    if age == 21:
        return 0.85
    if age == 22:
        return 0.70
    if age == 23:
        return 0.52
    if age == 24:
        return 0.36
    if age == 25:
        return 0.22
    if age == 26:
        return 0.10
    if age == 27:
        return 0.02
    if age == 28:
        return 0.00
    if age == 29:
        return 0.00
    if age == 30:
        return -0.05
    if age == 31:
        return -0.18
    if age == 32:
        return -0.38
    if age == 33:
        return -0.62
    if age == 34:
        return -0.90
    if age == 35:
        return -1.20
    if age == 36:
        return -1.52
    if age == 37:
        return -1.86
    if age == 38:
        return -2.20
    if age == 39:
        return -2.55
    return -2.90


def _potential_gap_effect(age: int, overall: int, potential: int) -> float:
    gap = max(0, potential - overall)

    if age <= 21:
        return _clamp(gap / 8.5, 0.0, 1.65)
    if age <= 24:
        return _clamp(gap / 10.0, 0.0, 1.10)
    if age <= 26:
        return _clamp(gap / 12.0, 0.0, 0.65)
    if age <= 28:
        return _clamp(gap / 16.0, 0.0, 0.30)
    if age <= 31:
        return _clamp(gap / 20.0, 0.0, 0.10)
    return 0.0


def _high_overall_resistance(age: int, overall: int, raw_positive: float) -> float:
    if raw_positive <= 0:
        return raw_positive

    # Slightly more allowant for young high-overall stars.
    if overall >= 97:
        return raw_positive * (0.34 if age <= 24 else 0.25)
    if overall >= 95:
        return raw_positive * (0.46 if age <= 24 else 0.35)
    if overall >= 92:
        return raw_positive * (0.62 if age <= 24 else 0.48)
    if overall >= 90:
        return raw_positive * (0.70 if age <= 24 else 0.58)
    if overall >= 87:
        return raw_positive * 0.76
    if overall >= 84:
        return raw_positive * 0.88
    return raw_positive


def _variance_sigma(age: int, overall: int) -> float:
    if age <= 22:
        sigma = 1.45
    elif age <= 26:
        sigma = 1.18
    elif age <= 31:
        sigma = 0.92
    elif age <= 34:
        sigma = 1.12
    else:
        sigma = 1.38

    if overall >= 95:
        sigma *= 0.75
    elif overall >= 90:
        sigma *= 0.86

    return sigma


def _delta_bounds(age: int, overall: int) -> Tuple[int, int]:
    if age <= 22:
        lo, hi = -3, 5
    elif age <= 26:
        lo, hi = -3, 4
    elif age <= 31:
        lo, hi = -3, 2
    elif age <= 34:
        lo, hi = -4, 2
    else:
        lo, hi = -6, 1

    # Allow young high-overall stars to still move, but keep elite inflation controlled.
    if overall >= 95:
        hi = min(hi, 2 if age <= 24 else 1)
    elif overall >= 92:
        hi = min(hi, 2 if age <= 24 else 1)
    elif overall >= 90:
        hi = min(hi, 2)

    return lo, hi


def _rare_event_adjustment(age: int, overall: int, rng: random.Random, settings: Dict[str, Any]) -> float:
    cfg = settings.get("progression", {}) or {}
    mult = float(cfg.get("rare_event_mult", 1.0))
    roll = rng.random()

    if roll < 0.030 * mult:
        return -rng.uniform(1.4, 3.3)

    if roll < 0.120 * mult:
        return -rng.uniform(0.5, 1.8)

    if roll > 1.0 - (0.030 * mult):
        leap = rng.uniform(1.3, 3.5)
        if overall >= 90:
            leap *= 0.52 if age <= 24 else 0.40
        elif overall >= 85:
            leap *= 0.72
        return leap

    if roll > 1.0 - (0.120 * mult):
        bump = rng.uniform(0.4, 1.7)
        if overall >= 90:
            bump *= 0.58 if age <= 24 else 0.50
        elif overall >= 85:
            bump *= 0.78
        return bump

    return 0.0


def _target_delta_for_player(
    p: Dict[str, Any],
    stats: Optional[Dict[str, Any]],
    settings: Dict[str, Any],
    rng: random.Random
) -> int:
    age = _safe_int(p.get("age"), 25)
    overall = _safe_int(p.get("overall"), 70)
    potential = _safe_int(p.get("potential"), overall)

    min_fac, prod_adj = _stat_context(stats, settings)

    expected = _age_expected_delta(age)
    expected += _potential_gap_effect(age, overall, potential)

    if expected > 0:
        expected *= (0.72 + 0.28 * min_fac)

    expected += prod_adj
    expected = _high_overall_resistance(age, overall, expected)

    cfg = settings.get("progression", {}) or {}
    variance_mult = float(cfg.get("variance_mult", 1.0))
    sigma = _variance_sigma(age, overall) * variance_mult

    raw = expected + rng.gauss(0.0, sigma)
    raw += _rare_event_adjustment(age, overall, rng, settings)

    raw = _high_overall_resistance(age, overall, raw)

    lo, hi = _delta_bounds(age, overall)
    delta = _stoch_round(raw, rng)

    return int(_clamp(delta, lo, hi))


def _priority_indices_for_pos(pos: Any, rng: random.Random, positive: bool = True) -> List[int]:
    pos_key = _normalized_pos(pos)
    cfg = _POS_PARAMS[pos_key]
    weights = list(cfg["weights"])
    prim = {int(i) - 1 for i in cfg["prim"]}

    scored: List[Tuple[float, int]] = []
    for i, w in enumerate(weights):
        score = float(w)
        if i in prim:
            score += 0.06
        score += rng.random() * 0.025
        scored.append((score, i))

    scored.sort(reverse = positive)
    return [i for _, i in scored]


def _candidate_indices(
    attrs: List[int],
    pos: Any,
    rng: random.Random,
    direction: int,
    change_counts: Dict[int, int],
    max_change: int
) -> List[int]:
    positive = direction > 0
    priority = _priority_indices_for_pos(pos, rng, positive = positive)

    if positive:
        eligible = [i for i in priority if attrs[i] < 99 and change_counts.get(i, 0) < max_change]
    else:
        high_attr_order = sorted(range(len(attrs)), key = lambda i: (attrs[i], rng.random()), reverse = True)
        mixed = []
        for i in priority + high_attr_order:
            if i not in mixed:
                mixed.append(i)
        eligible = [i for i in mixed if attrs[i] > 25 and change_counts.get(i, 0) < max_change]

    if not eligible:
        eligible = [i for i in range(len(attrs)) if 25 < attrs[i] < 99]

    rng.shuffle(eligible)
    return eligible[:12]


def _move_attrs_toward_target_overall(
    p: Dict[str, Any],
    target_overall: int,
    settings: Dict[str, Any],
    rng: random.Random
) -> None:
    attrs = _ensure_attrs(p.get("attrs"))
    pos = p.get("pos") or p.get("position") or "SF"
    current_overall = calc_overall_from_attrs(attrs, pos)
    target_overall = int(_clamp(target_overall, 60, 99))

    if current_overall == target_overall:
        p["attrs"] = attrs
        p["overall"] = current_overall
        return

    direction = 1 if target_overall > current_overall else -1
    cfg = settings.get("progression", {}) or {}
    max_change = int(cfg.get("max_attr_change_per_player", 7))
    max_steps = int(cfg.get("max_total_attr_steps", 100))

    best_attrs = list(attrs)
    best_overall = current_overall
    best_dist = abs(best_overall - target_overall)
    change_counts: Dict[int, int] = {}

    steps = 0
    while steps < max_steps:
        current_overall = calc_overall_from_attrs(attrs, pos)
        current_dist = abs(current_overall - target_overall)

        if current_dist < best_dist:
            best_attrs = list(attrs)
            best_overall = current_overall
            best_dist = current_dist

        if current_overall == target_overall:
            best_attrs = list(attrs)
            best_overall = current_overall
            break

        if direction > 0 and current_overall > target_overall:
            break
        if direction < 0 and current_overall < target_overall:
            break

        candidates = _candidate_indices(attrs, pos, rng, direction, change_counts, max_change)
        if not candidates:
            break

        best_candidate_attrs: Optional[List[int]] = None
        best_candidate_overall: Optional[int] = None
        best_candidate_dist = 999
        best_candidate_overshoot = True

        for idx in candidates:
            trial = list(attrs)
            trial[idx] = int(_clamp(trial[idx] + direction, 25, 99))
            trial_overall = calc_overall_from_attrs(trial, pos)
            trial_dist = abs(trial_overall - target_overall)
            overshoot = (direction > 0 and trial_overall > target_overall) or (direction < 0 and trial_overall < target_overall)

            if trial_dist < best_candidate_dist or (
                trial_dist == best_candidate_dist and best_candidate_overshoot and not overshoot
            ):
                best_candidate_attrs = trial
                best_candidate_overall = trial_overall
                best_candidate_dist = trial_dist
                best_candidate_overshoot = overshoot

        if best_candidate_attrs is None or best_candidate_overall is None:
            break

        if best_candidate_dist > current_dist and current_dist <= 1:
            break

        changed_idx = -1
        for i in range(len(attrs)):
            if best_candidate_attrs[i] != attrs[i]:
                changed_idx = i
                break

        attrs = best_candidate_attrs
        if changed_idx >= 0:
            change_counts[changed_idx] = change_counts.get(changed_idx, 0) + 1

        if best_candidate_dist < best_dist:
            best_attrs = list(attrs)
            best_overall = best_candidate_overall
            best_dist = best_candidate_dist

        steps += 1

    p["attrs"] = best_attrs
    p["overall"] = calc_overall_from_attrs(best_attrs, pos)


def _apply_small_attribute_churn(p: Dict[str, Any], settings: Dict[str, Any], rng: random.Random) -> None:
    attrs = _ensure_attrs(p.get("attrs"))
    pos = p.get("pos") or p.get("position") or "SF"
    start_overall = calc_overall_from_attrs(attrs, pos)

    if rng.random() > 0.32:
        p["attrs"] = attrs
        p["overall"] = start_overall
        return

    trial = list(attrs)
    indices = list(range(len(trial)))
    rng.shuffle(indices)

    for idx in indices[:5]:
        direction = 1 if rng.random() < 0.50 else -1
        new_val = int(_clamp(trial[idx] + direction, 25, 99))
        if new_val != trial[idx]:
            old_val = trial[idx]
            trial[idx] = new_val
            if calc_overall_from_attrs(trial, pos) != start_overall:
                trial[idx] = old_val

    p["attrs"] = trial
    p["overall"] = calc_overall_from_attrs(trial, pos)


def _bump_derived_fields(p: Dict[str, Any], overall_delta: int, settings: Dict[str, Any], rng: random.Random) -> None:
    derived = settings.get("derived_fields", {}) or {}
    rmin = int(settings.get("min_rating", 25))
    rmax = int(settings.get("max_rating", 99))
    noise_sigma = float(derived.get("noise", 0.35))

    def bump(field_key: str, mult_key: str, lo: float = 25.0, hi: float = 99.0) -> None:
        if field_key not in p or p[field_key] is None:
            return
        old_val = _safe_float(p.get(field_key), 0.0)
        mult = float(derived.get(mult_key, 0.50))
        raw = old_val + (overall_delta * mult) + rng.gauss(0.0, noise_sigma)
        p[field_key] = _stoch_round(_clamp(raw, lo, hi), rng)

    bump("offRating", "off_mult", rmin, rmax)
    bump("defRating", "def_mult", rmin, rmax)
    bump("stamina", "stamina_mult", rmin, rmax)

    if "scoringRating" in p and p["scoringRating"] is not None:
        old_sr = _safe_float(p.get("scoringRating"), 0.0)
        mult = float(derived.get("scoring_mult", 0.40))
        raw_sr = old_sr + (overall_delta * mult) + rng.gauss(0.0, noise_sigma)
        p["scoringRating"] = float(_clamp(raw_sr, 0.0, 100.0))


def _compute_raw_progression_plan(
    league: Dict[str, Any],
    stats_by_key: Optional[Dict[str, Dict[str, Any]]],
    settings: Dict[str, Any],
    rng: random.Random
) -> List[Dict[str, Any]]:
    plan: List[Dict[str, Any]] = []

    for p, tname in _all_players_with_team(league):
        if not isinstance(p, dict):
            continue

        if isinstance(p.get("attrs"), list) and len(p.get("attrs") or []) > 0:
            p["attrs"] = _ensure_attrs(p.get("attrs"))
            current_overall = calc_overall_from_attrs(p.get("attrs") or [], p.get("pos") or p.get("position") or "SF")
            p["overall"] = current_overall
        else:
            current_overall = _safe_int(p.get("overall"), 70)

        stats = _stat_lookup(stats_by_key, p, tname)
        delta = _target_delta_for_player(p, stats, settings, rng)

        target = int(_clamp(current_overall + delta, 60, 99))

        plan.append({
            "player": p,
            "team": tname,
            "before_overall": current_overall,
            "target_delta": target - current_overall,
            "target_overall": target,
        })

    return plan


def _apply_league_rating_governor(plan: List[Dict[str, Any]], settings: Dict[str, Any], rng: random.Random) -> None:
    if not plan:
        return

    cfg = settings.get("progression", {}) or {}
    target_avg_shift = float(cfg.get("target_avg_shift", 0.0))
    avg_tolerance = float(cfg.get("avg_tolerance", 0.10))
    governor_strength = float(cfg.get("governor_strength", 1.00))
    max_90_count_increase = int(cfg.get("max_90_count_increase", 1))

    n = len(plan)
    before_avg = sum(float(x["before_overall"]) for x in plan) / n
    desired_avg = sum(float(x["target_overall"]) for x in plan) / n
    max_avg = before_avg + target_avg_shift + avg_tolerance
    min_avg = before_avg + target_avg_shift - avg_tolerance

    def refresh_targets() -> None:
        for item in plan:
            item["target_overall"] = int(_clamp(
                int(item["before_overall"]) + int(item["target_delta"]),
                60,
                99
            ))

    if desired_avg > max_avg:
        excess_points = int(math.ceil((desired_avg - max_avg) * n * governor_strength))

        candidates = [item for item in plan if int(item["target_delta"]) > 0]
        candidates.sort(
            key = lambda item: (
                _safe_int(item["player"].get("overall"), 70),
                _safe_int(item["player"].get("age"), 25),
                int(item["target_delta"]),
                rng.random()
            ),
            reverse = True
        )

        idx = 0
        while excess_points > 0 and candidates:
            item = candidates[idx % len(candidates)]
            if int(item["target_delta"]) > 0:
                item["target_delta"] = int(item["target_delta"]) - 1
                excess_points -= 1
            idx += 1
            if idx > len(candidates) * 8:
                break

        refresh_targets()

    desired_avg = sum(float(x["target_overall"]) for x in plan) / n

    if desired_avg < min_avg:
        missing_points = int(math.ceil((min_avg - desired_avg) * n * 0.55))

        candidates = []
        for item in plan:
            p = item["player"]
            age = _safe_int(p.get("age"), 25)
            ovr = int(item["before_overall"])
            pot = _safe_int(p.get("potential"), ovr)
            if age <= 27 and ovr < 88 and pot > ovr:
                candidates.append(item)

        candidates.sort(
            key = lambda item: (
                _safe_int(item["player"].get("potential"), int(item["before_overall"])) - int(item["before_overall"]),
                -int(item["before_overall"]),
                rng.random()
            ),
            reverse = True
        )

        idx = 0
        while missing_points > 0 and candidates:
            item = candidates[idx % len(candidates)]
            before = int(item["before_overall"])
            if before + int(item["target_delta"]) < 89:
                item["target_delta"] = int(item["target_delta"]) + 1
                missing_points -= 1
            idx += 1
            if idx > len(candidates) * 5:
                break

        refresh_targets()

    before_90 = sum(1 for item in plan if int(item["before_overall"]) >= 90)
    after_90 = sum(1 for item in plan if int(item["target_overall"]) >= 90)
    allowed_90 = before_90 + max_90_count_increase

    if after_90 > allowed_90:
        excess_90 = after_90 - allowed_90
        crossers = [
            item for item in plan
            if int(item["before_overall"]) < 90 and int(item["target_overall"]) >= 90 and int(item["target_delta"]) > 0
        ]

        crossers.sort(
            key = lambda item: (
                _safe_int(item["player"].get("age"), 25),
                int(item["before_overall"]),
                rng.random()
            ),
            reverse = True
        )

        for item in crossers[:excess_90]:
            item["target_delta"] = max(0, 89 - int(item["before_overall"]))

        refresh_targets()


def apply_end_of_season_progression(
    league: Dict[str, Any],
    stats_by_key: Optional[Dict[str, Dict[str, Any]]] = None,
    settings: Optional[Dict[str, Any]] = None,
    seed: Optional[int] = None
) -> Dict[str, Any]:
    """
    Run once after playoffs/awards, before next season.

    This only changes attributes, overall, and derived fields.
    Potential is updated after age-up in apply_end_of_season_progression_with_deltas.
    """
    if not isinstance(league, dict):
        return league

    settings = settings or DEFAULT_SETTINGS
    rng = random.Random(seed)

    plan = _compute_raw_progression_plan(league, stats_by_key, settings, rng)
    _apply_league_rating_governor(plan, settings, rng)

    for item in plan:
        p = item["player"]
        before_overall = int(item["before_overall"])
        target_overall = int(item["target_overall"])
        target_delta = target_overall - before_overall

        if target_delta == 0:
            _apply_small_attribute_churn(p, settings, rng)
        else:
            _move_attrs_toward_target_overall(p, target_overall, settings, rng)

        actual_delta = _safe_int(p.get("overall"), before_overall) - before_overall
        _bump_derived_fields(p, actual_delta, settings, rng)

        if "marketValue" in p:
            p.pop("marketValue", None)

    return league


# -------------------------
# Player iteration / aging wrappers
# -------------------------

def _all_players(league: Dict[str, Any]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []

    for t in _iter_teams(league):
        for p in (t.get("players") or []):
            if isinstance(p, dict):
                out.append(p)

    for p in _iter_free_agents(league):
        out.append(p)

    return out


def _all_players_with_team(league: Dict[str, Any]) -> List[Tuple[Dict[str, Any], str]]:
    out: List[Tuple[Dict[str, Any], str]] = []

    for t in _iter_teams(league):
        tname = _team_name(t)
        for p in (t.get("players") or []):
            if isinstance(p, dict):
                out.append((p, tname))

    for p in _iter_free_agents(league):
        out.append((p, "__FREE_AGENCY__"))

    return out


def apply_jan1_age_up_all_players(league: Dict[str, Any], season_year: Optional[int] = None) -> Dict[str, Any]:
    """
    Everyone ages +1 once per season.
    Guarded by lastBirthdayYear so it cannot stack.
    """
    if season_year is None:
        season_year = _safe_int(
            league.get("seasonYear") or league.get("seasonStartYear") or league.get("season_year") or 0,
            0
        )
        if season_year <= 0:
            season_year = _dt.date.today().year

    for p in _all_players(league):
        last_y = _safe_int(p.get("lastBirthdayYear"), season_year - 1)
        if last_y < season_year:
            p["age"] = _safe_int(p.get("age"), 25) + 1
            p["lastBirthdayYear"] = season_year

    return league


def apply_end_of_season_progression_with_deltas(
    league: Dict[str, Any],
    stats_by_key: Optional[Dict[str, Dict[str, Any]]] = None,
    settings: Optional[Dict[str, Any]] = None,
    seed: Optional[int] = None,
    season_year: Optional[int] = None
) -> Dict[str, Any]:
    """
    Returns:
      {
        "league": <updated league dict>,
        "deltas": { "player__team": {...} },
        "version": PROGRESSION_PY_VERSION
      }

    Offseason order:
      1. Snapshot players.
      2. Apply attribute changes and recalculate overall using current age.
      3. Age everyone up by 1.
      4. Dynamically update potential using old potential, standard formula,
         and this season's OVR progression.
      5. Return deltas.
    """
    if not isinstance(league, dict):
        return {"league": league, "deltas": {}, "version": PROGRESSION_PY_VERSION}

    settings = settings or DEFAULT_SETTINGS

    # Use one shared RNG stream for progression and potential updates.
    rng = random.Random(seed)

    ensure_progression_fields(league, season_start_year = season_year)

    before: Dict[str, Dict[str, Any]] = {}
    for p, tname in _all_players_with_team(league):
        name = _player_name(p)
        key = f"{name}__{tname}"

        if isinstance(p.get("attrs"), list) and len(p.get("attrs") or []) > 0:
            p["attrs"] = _ensure_attrs(p.get("attrs"))
            p["overall"] = calc_overall_from_attrs(
                p.get("attrs") or [],
                p.get("pos") or p.get("position") or "SF"
            )

        before[key] = {
            "age": _safe_int(p.get("age"), 25),
            "overall": _safe_int(p.get("overall"), 0),
            "offRating": _safe_int(p.get("offRating"), 0),
            "defRating": _safe_int(p.get("defRating"), 0),
            "stamina": _safe_int(p.get("stamina"), 0),
            "potential": _safe_int(p.get("potential"), _safe_int(p.get("overall"), 70)),
            "attrs": list(p.get("attrs") or []),
            "name": name,
            "team": tname,
        }

    # 1. Progress ratings and attributes using current season age.
    # Pass an RNG-derived seed so the shared RNG remains deterministic.
    progression_seed = rng.randint(0, 2_147_483_647)
    apply_end_of_season_progression(
        league = league,
        stats_by_key = stats_by_key,
        settings = settings,
        seed = progression_seed
    )

    # 2. Age players up for the next season.
    apply_jan1_age_up_all_players(league = league, season_year = season_year)

    # 3. Dynamically recalculate potential using old potential + progression result.
    apply_dynamic_potential_recalc(
        league = league,
        before = before,
        settings = settings,
        rng = rng
    )

    deltas: Dict[str, Dict[str, Any]] = {}

    for p, tname in _all_players_with_team(league):
        name = _player_name(p)
        key = f"{name}__{tname}"
        b = before.get(key)

        if not b:
            continue

        d: Dict[str, Any] = {}
        d["age"] = _safe_int(p.get("age"), 0) - _safe_int(b.get("age"), 0)

        for k in ("overall", "offRating", "defRating", "stamina", "potential"):
            d[k] = _safe_int(p.get(k), 0) - _safe_int(b.get(k), 0)

        new_attrs = list(p.get("attrs") or [])
        old_attrs = list(b.get("attrs") or [])
        n = max(len(new_attrs), len(old_attrs))

        for i in range(n):
            nv = _safe_int(new_attrs[i], 0) if i < len(new_attrs) else 0
            ov = _safe_int(old_attrs[i], 0) if i < len(old_attrs) else 0
            d[f"attr{i}"] = nv - ov

        deltas[key] = d

    return {"league": league, "deltas": deltas, "version": PROGRESSION_PY_VERSION}