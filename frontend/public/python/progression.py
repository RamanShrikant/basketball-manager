# progression_v17_dynamic_core_shape_ceiling_hit.py
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple
import random
import math
import datetime as _dt
import hashlib

PROGRESSION_PY_VERSION = "2026-08-09_progression_v25d_polished_outliers"


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
        # v21 uses the current 2027 roster ecosystem as the progression shape
        # target. The upper shelves are intentionally tighter so 97+/98+ does
        # not overpopulate while younger stars can still replace aging stars.
        "use_2027_shape_targets": True,
        "target_avg_shift": 0.00,       # legacy-compatible fallback
        "avg_tolerance": 0.10,          # legacy-compatible fallback
        "governor_strength": 1.00,
        "max_90_count_increase": 1,     # legacy-compatible fallback
        "baseline_min_overall": 77,
        "baseline_avg_tolerance": 0.03,
        "top300_avg_tolerance": 0.35,
        "top300_governor_strength": 1.65,
        "top300_band_governor_strength": 1.45,
        "tier_governor_strength": 1.00,
        "depth_tier_governor_strength": 1.35,
        "band_governor_strength": 1.35,
        "deep_band_governor_strength": 1.10,
        "young_dev_failure_mult": 0.95,
        "free_agent_regression_bias": 0.44,
        "ninety_nine_stay_chance": 0.32,
        "ninety_eight_stay_chance": 0.78,

        # Attribute movement limits.
        "max_attr_change_per_player": 7,
        "max_total_attr_steps": 160,
        "max_force_cap_attr_steps": 260,

        # Keep volatility, but reduce broad positive drift. Young low/mid
        # variance is handled with a separate development outcome roll.
        "variance_mult": 0.58,
        "rare_event_mult": 0.42,
    },

    "potential_update": {
        # v20: potential is recalculated every offseason and should feel alive.
        # It is still a guide, not a guarantee, but breakout seasons and real
        # progression now move ceilings enough that future faces of the league
        # can emerge across different saves.
        "young_anchor_pull": 0.165,
        "mid_anchor_pull": 0.135,
        "late_anchor_pull": 0.095,

        # How strongly this season's OVR change affects potential.
        "young_progress_signal": 0.420,
        "mid_progress_signal": 0.335,
        "late_progress_signal": 0.220,

        # Season box-score production is intentionally ignored by progression.
        # Careers are driven by age, current OVR, potential gap, randomness, and
        # soft league-shape targets so one noisy sim season cannot force growth.
        "young_performance_signal": 0.000,
        "mid_performance_signal": 0.000,
        "late_performance_signal": 0.000,

        # Potential volatility.
        "young_noise": 0.320,
        "mid_noise": 0.270,
        "late_noise": 0.210,
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
    rng: random.Random,
    player: Optional[Dict[str, Any]] = None,
    team_name: str = "",
    stats: Optional[Dict[str, Any]] = None,
) -> int:
    """V23 potential recalculation.

    Potential follows the age/OVR relationship in the supplied 2027 universe,
    but it remains a probabilistic guide rather than a promised destination.
    Season production and minutes are intentionally ignored.
    """
    old_age = _safe_int(old_age, 25)
    new_age = _safe_int(new_age, old_age + 1)
    old_overall = int(_clamp(_safe_int(old_overall, 70), 25, 99))
    new_overall = int(_clamp(_safe_int(new_overall, old_overall), 25, 99))
    old_potential = int(_clamp(_safe_int(old_potential, max(old_overall, new_overall)), old_overall, 99))

    if new_age >= 29:
        return new_overall

    # Empirical POT-gap anchors from Raman's 2027 roster + free-agent file.
    age_gap = {
        18: 15, 19: 14, 20: 13, 21: 11, 22: 9, 23: 8,
        24: 6, 25: 4, 26: 3, 27: 2, 28: 1,
    }.get(new_age, 0)
    anchor = int(_clamp(new_overall + age_gap, new_overall, 99))
    ovr_delta = new_overall - old_overall
    player = player or {}

    # Preserve genuine high ceilings through the early evaluation window. A
    # player can be flat for 2-3 years and still break out later.
    if new_age <= 21:
        max_drop = 1
    elif new_age <= 23:
        max_drop = 1 if old_potential >= 90 else 2
    elif new_age <= 25:
        max_drop = 2
    elif new_age == 26:
        max_drop = 3
    else:
        max_drop = 4

    anchor_pull = 0.14 if new_age <= 22 else 0.20 if new_age <= 25 else 0.28
    raw = old_potential + (anchor - old_potential) * anchor_pull
    raw += ovr_delta * (0.48 if new_age <= 23 else 0.38 if new_age <= 26 else 0.28)
    raw += rng.gauss(0.0, 0.42 if new_age <= 22 else 0.34 if new_age <= 25 else 0.26)

    # Real breakouts can reopen or raise a ceiling; early struggles do not
    # permanently close it after one season.
    if ovr_delta >= 3 and new_age <= 26:
        raw += 0.85
    elif ovr_delta >= 2 and new_age <= 27:
        raw += 0.40
    elif ovr_delta <= -3:
        raw -= 0.55

    candidate = _stoch_round(raw, rng)
    candidate = max(candidate, old_potential - max_drop)

    # Surprise breakouts are allowed to exceed an old low ceiling.
    if ovr_delta >= 3 and old_potential <= old_overall + 2:
        candidate = max(candidate, new_overall + (2 if new_age <= 24 else 1))
    if ovr_delta >= 4 and new_age <= 24:
        candidate = max(candidate, new_overall + 2)

    # Keep young premium ceilings plausible but never above 99.
    hard_cap = max(_dynamic_potential_hard_cap(new_age, new_overall), old_potential if new_age <= 23 else new_overall)
    if ovr_delta >= 2:
        hard_cap = max(hard_cap, min(99, new_overall + (4 if new_age <= 24 else 3)))

    return int(_clamp(candidate, new_overall, min(99, hard_cap)))


def apply_dynamic_potential_recalc(
    league: Dict[str, Any],
    before: Dict[str, Dict[str, Any]],
    settings: Dict[str, Any],
    rng: random.Random,
    stats_by_key: Optional[Dict[str, Dict[str, Any]]] = None,
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
        if _is_current_draft_shape_protected(p):
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
            rng = rng,
            player = p,
            team_name = tname,
            stats = _stat_lookup(stats_by_key, p, tname),
        )

        if "marketValue" in p:
            p.pop("marketValue", None)

    return league


# -------------------------
# Progression model
# -------------------------


def _minutes_factor(mpg: Optional[float], settings: Dict[str, Any]) -> float:
    """
    Tiny usage modifier only.

    v12 intentionally makes stats/minutes a very small factor. Progression
    should come from age/current rating/potential/dev outcome and league shape,
    not from one season of box-score production.
    """
    if mpg is None:
        return 1.0

    lo = float(settings.get("minutes_min_mpg", 5.0))
    hi = float(settings.get("minutes_cap_mpg", 32.0))

    if mpg <= lo:
        return 0.88
    if mpg >= hi:
        return 1.0

    return 0.88 + 0.12 * ((mpg - lo) / (hi - lo))

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



def _extract_mpg(stats: Optional[Dict[str, Any]]) -> Optional[float]:
    if not isinstance(stats, dict):
        return None
    if "mpg" in stats and stats["mpg"] is not None:
        return _safe_float(stats.get("mpg"), None)

    gp = _safe_float(stats.get("gp"), 0.0)
    if gp <= 0:
        gp = _safe_float(stats.get("games"), 0.0)

    mins = _safe_float(stats.get("min"), 0.0)
    if mins <= 0:
        mins = _safe_float(stats.get("mins"), 0.0)
    if mins <= 0:
        mins = _safe_float(stats.get("minutes"), 0.0)

    if gp > 0 and mins > 0:
        return mins / gp
    return None


def _performance_signal(stats: Optional[Dict[str, Any]], age: int, overall: int) -> float:
    """
    v20 season-performance signal.

    This is intentionally not destiny: it creates a meaningful nudge for
    breakouts, role growth, and older-star decline resistance while keeping
    age/POT/dev path and the league-shape lock in control.
    """
    if not isinstance(stats, dict):
        return 0.0

    gp = _safe_float(stats.get("gp"), 0.0)
    if gp <= 0:
        gp = _safe_float(stats.get("games"), 0.0)
    if gp <= 0:
        return 0.0

    mpg = _extract_mpg(stats)
    prod_score = _production_score(stats)
    if prod_score <= 0:
        return 0.0

    # A starter-level season is compared against the player's current tier.
    # Lower-rated players can earn a positive signal without needing superstar
    # box scores; established stars need true star production to get a boost.
    if overall >= 90:
        expected_prod = 31.0
    elif overall >= 85:
        expected_prod = 25.0
    elif overall >= 80:
        expected_prod = 19.0
    elif overall >= 76:
        expected_prod = 14.5
    elif overall >= 72:
        expected_prod = 10.5
    else:
        expected_prod = 7.5

    raw = (prod_score - expected_prod) / 16.0

    if mpg is not None:
        if mpg >= 30:
            raw += 0.18
        elif mpg >= 24:
            raw += 0.10
        elif mpg >= 16:
            raw += 0.02
        elif mpg < 10:
            raw -= 0.12

    # Young players should get more developmental evidence from a good season.
    if age <= 24:
        raw *= 1.15
    elif age <= 27:
        raw *= 1.00
    elif age >= 32:
        raw *= 0.55

    return _clamp(raw, -0.42, 0.52)


def _stat_context(stats: Optional[Dict[str, Any]], settings: Dict[str, Any], age: int = 25, overall: int = 75) -> Tuple[float, float]:
    """Return neutral stat context.

    Progression intentionally ignores season box-score output and minutes. The
    long-term engine should create career variety from age, OVR, potential,
    variance, and league-shape pressure, not from one simulated stat line.
    """
    return 1.0, 0.0


def _age_expected_delta(age: int) -> float:
    """
    Expected OVR movement from age alone.

    v12 makes the base curve harsh. Young age now means "possible upside",
    not automatic growth. Real growth comes only when the development outcome
    and threshold gates allow it.
    """
    if age <= 18:
        return 0.22
    if age == 19:
        return 0.20
    if age == 20:
        return 0.16
    if age == 21:
        return 0.10
    if age == 22:
        return 0.04
    if age == 23:
        return 0.00
    if age == 24:
        return -0.05
    if age == 25:
        return -0.08
    if age == 26:
        return -0.08
    if age == 27:
        return -0.04
    if age == 28:
        return -0.02
    if age == 29:
        return -0.05
    if age == 30:
        return -0.16
    if age == 31:
        return -0.50
    if age == 32:
        return -0.86
    if age == 33:
        return -1.18
    if age == 34:
        return -1.42
    if age == 35:
        return -1.78
    if age == 36:
        return -2.12
    if age == 37:
        return -2.48
    if age == 38:
        return -2.84
    if age == 39:
        return -3.18
    return -3.50


def _potential_gap_effect(age: int, overall: int, potential: int) -> float:
    """
    Generic potential-gap lift.

    v12 makes this tiny. Potential should be a ceiling/probability modifier,
    not a yearly-growth guarantee. True star creation is handled separately.
    """
    gap = max(0, potential - overall)

    if age <= 21:
        return _clamp(gap / 30.0, 0.0, 0.30)
    if age <= 24:
        return _clamp(gap / 42.0, 0.0, 0.16)
    if age <= 26:
        return _clamp(gap / 60.0, 0.0, 0.06)
    if age <= 28:
        return _clamp(gap / 80.0, 0.0, 0.02)
    return 0.0


def _star_pipeline_bonus(age: int, overall: int, potential: int) -> float:
    """
    Very selective star-creation lane.

    This keeps true blue-chip paths alive while removing broad support for
    ordinary 74-84 prospects. Most low/mid players should stall unless they
    win a real development outcome.
    """
    gap = max(0, potential - overall)
    if gap <= 0:
        return 0.0

    # True top prospects only.
    if age <= 22 and 78 <= overall <= 86 and potential >= 96 and gap >= 12:
        return _clamp(0.06 + (gap * 0.018), 0.0, 0.30)

    # Very small support for high-upside, already-good prospects.
    if age <= 23 and 82 <= overall <= 86 and potential >= 95 and gap >= 10:
        return _clamp(0.02 + (gap * 0.008), 0.0, 0.12)

    # Young high-80s blue chips can still become stars.
    if age <= 25 and 86 <= overall <= 90 and potential >= 95 and gap >= 6:
        return _clamp(0.05 + (gap * 0.022), 0.0, 0.24)

    # Late star push is rare.
    if age <= 27 and 88 <= overall <= 91 and potential >= 94 and gap >= 5:
        return _clamp(0.03 + (gap * 0.014), 0.0, 0.14)

    return 0.0

def _elite_aging_pressure(age: int, overall: int) -> float:
    """
    Extra decline pressure for older elite players.

    v11 adds elite-only pressure starting at age 30. This targets sticky
    Giannis/Jokic/SGA-style 96-99 longevity without making normal 28-30 or
    older role players collapse.
    """
    if age < 30:
        return 0.0

    pressure = 0.0

    # Age-30 pressure is elite-only.
    if age == 30:
        if overall >= 98:
            pressure += 0.38
        elif overall >= 96:
            pressure += 0.26
        elif overall >= 94:
            pressure += 0.14
        return pressure

    if overall >= 98:
        pressure += 0.84
    elif overall >= 97:
        pressure += 0.68
    elif overall >= 95:
        pressure += 0.54
    elif overall >= 92:
        pressure += 0.40
    elif overall >= 90:
        pressure += 0.25
    elif age >= 33 and overall >= 88:
        pressure += 0.15
    elif age >= 35 and overall >= 85:
        pressure += 0.10

    # Age-layer pressure. 31-33 gets slightly more bite for high OVR players;
    # 34+ stays close to v10 because that range already looked good.
    if age == 31 and overall >= 92:
        pressure += 0.12
    if age >= 32:
        pressure += 0.12
    if age >= 33:
        pressure += 0.24
    if age >= 34:
        pressure += 0.24
    if age >= 35:
        pressure += 0.24
    if age >= 36:
        pressure += 0.24
    # Extra anti-stickiness for old 95+ faces. This does not force every legend
    # off a cliff, but it stops shape locks from keeping 34-year-old 97/98s as
    # permanent top-shelf placeholders.
    if age >= 32 and overall >= 95:
        pressure += 0.18
    if age >= 34 and overall >= 95:
        pressure += 0.22

    return pressure

def _high_overall_resistance(age: int, overall: int, raw_positive: float, potential: Optional[int] = None) -> float:
    if raw_positive <= 0:
        return raw_positive

    potential = _safe_int(potential, overall) if potential is not None else overall
    gap = max(0, potential - overall)
    high_upside = age <= 27 and potential >= 92 and gap >= 3

    if overall >= 97:
        mult = 0.34 if age <= 24 else 0.25
    elif overall >= 95:
        mult = 0.50 if age <= 24 else 0.36
    elif overall >= 92:
        mult = 0.70 if high_upside else (0.64 if age <= 24 else 0.50)
    elif overall >= 90:
        mult = 0.80 if high_upside else (0.72 if age <= 24 else 0.60)
    elif overall >= 87:
        mult = 0.92 if high_upside else 0.80
    elif overall >= 84:
        mult = 0.96 if high_upside else 0.90
    else:
        mult = 1.0

    return raw_positive * mult


def _low_overall_young_dampener(age: int, overall: int, potential: int, expected: float) -> float:
    """
    Slow broad low/mid prospect creep without killing real blue-chip paths.

    v10 is stricter for normal low/mid young players because repeated tests
    still showed too many 70s climbing into the playable 77-84 range.
    """
    if expected <= 0.0 or age > 25 or overall >= 84:
        return expected

    gap = max(0, potential - overall)

    if overall < 70:
        mult = 0.18
    elif overall < 74:
        mult = 0.22
    elif overall < 77:
        mult = 0.28
    elif overall < 80:
        mult = 0.36
    elif overall < 83:
        mult = 0.46
    else:
        mult = 0.56

    # Protect only true premium prospects. Good-but-not-great upside no longer
    # gets full protection because that was feeding depth inflation.
    if potential >= 96 and gap >= 14:
        mult = max(mult, 0.68)
    elif potential >= 94 and gap >= 12:
        mult = max(mult, 0.56)
    elif potential >= 92 and gap >= 11:
        mult = max(mult, 0.46)

    return expected * mult



def _variance_sigma(age: int, overall: int) -> float:
    """
    Smaller raw variance for young low/mid players.

    v11 still let random positive swings create too many +2/+3 jumps. v12
    makes big jumps come mostly from explicit breakout outcomes.
    """
    if age <= 22:
        sigma = 0.72 if overall < 77 else 0.82
    elif age <= 24:
        sigma = 0.68 if overall < 77 else 0.78
    elif age <= 26:
        sigma = 0.76
    elif age == 27:
        sigma = 0.82
    elif age <= 30:
        sigma = 0.94
    elif age <= 31:
        sigma = 0.98
    elif age <= 34:
        sigma = 1.14
    else:
        sigma = 1.40

    if overall >= 95:
        sigma *= 0.75
    elif overall >= 90:
        sigma *= 0.86

    return sigma

def _delta_bounds(age: int, overall: int) -> Tuple[int, int]:
    if age <= 22:
        lo, hi = -3, 4
    elif age <= 26:
        lo, hi = -3, 4
    elif age <= 31:
        lo, hi = -3, 2
    elif age <= 34:
        lo, hi = -4, 2
    else:
        lo, hi = -5, 1

    # Allow young high-overall stars to still move, but keep elite inflation controlled.
    if overall >= 95:
        hi = min(hi, 2 if age <= 24 else 1)
    elif overall >= 92:
        hi = min(hi, 2 if age <= 24 else 1)
    elif overall >= 90:
        hi = min(hi, 2)

    return lo, hi


def _rare_event_adjustment(age: int, overall: int, potential: int, rng: random.Random, settings: Dict[str, Any]) -> float:
    cfg = settings.get("progression", {}) or {}
    mult = float(cfg.get("rare_event_mult", 1.0))
    roll = rng.random()
    gap = max(0, potential - overall)

    if roll < 0.030 * mult:
        return -rng.uniform(1.4, 3.4)

    if roll < 0.120 * mult:
        return -rng.uniform(0.5, 1.8)

    # Rare exceed-potential surprise. Potential guides careers, but it is not
    # a permanent prison for every player.
    if age <= 27 and 84 <= overall <= 92 and potential <= overall + 1:
        if roll > 1.0 - (0.008 * mult):
            return rng.uniform(1.0, 2.4)

    if roll > 1.0 - (0.030 * mult):
        leap = rng.uniform(1.3, 3.6)
        if overall >= 90:
            leap *= 0.66 if (age <= 25 and gap >= 3) else (0.52 if age <= 24 else 0.40)
        elif overall >= 85:
            leap *= 0.92 if (age <= 27 and potential >= 92 and gap >= 3) else 0.74
        return leap

    if roll > 1.0 - (0.120 * mult):
        bump = rng.uniform(0.4, 1.8)
        if overall >= 90:
            bump *= 0.70 if (age <= 25 and gap >= 3) else (0.58 if age <= 24 else 0.50)
        elif overall >= 85:
            bump *= 0.92 if (age <= 27 and potential >= 92 and gap >= 3) else 0.80
        return bump

    return 0.0



def _apply_young_development_outcome_roll(
    age: int,
    overall: int,
    potential: int,
    raw: float,
    rng: random.Random,
    settings: Dict[str, Any],
) -> float:
    """
    Main development gate for young low/mid players.

    v12 changes the model from "young players usually grow" to "young players
    have upside, but most low/mid prospects stall or fail unless they roll a
    real development outcome."
    """
    if age > 24 or overall >= 85:
        return raw

    cfg = settings.get("progression", {}) or {}
    failure_mult = float(cfg.get("young_dev_failure_mult", 1.0))
    gap = max(0, potential - overall)

    elite = (potential >= 96 and gap >= 12) or (overall >= 80 and potential >= 96 and gap >= 9)
    strong = (not elite) and (potential >= 92 and gap >= 11)

    # Probabilities sum to < 1.0; leftover is breakout.
    # Non-elite low/mid players should mostly be bad/stagnant/normal-small.
    if overall < 70:
        if elite:
            bad, stagnant, normal = 0.18, 0.34, 0.36
        elif strong:
            bad, stagnant, normal = 0.30, 0.38, 0.26
        else:
            bad, stagnant, normal = 0.42, 0.36, 0.17
    elif overall < 74:
        if elite:
            bad, stagnant, normal = 0.17, 0.32, 0.38
        elif strong:
            bad, stagnant, normal = 0.28, 0.38, 0.28
        else:
            bad, stagnant, normal = 0.38, 0.35, 0.21
    elif overall < 77:
        if elite:
            bad, stagnant, normal = 0.15, 0.30, 0.40
        elif strong:
            bad, stagnant, normal = 0.25, 0.36, 0.31
        else:
            bad, stagnant, normal = 0.32, 0.34, 0.27
    elif overall < 81:
        if elite:
            bad, stagnant, normal = 0.13, 0.29, 0.41
        elif strong:
            bad, stagnant, normal = 0.22, 0.34, 0.34
        else:
            bad, stagnant, normal = 0.26, 0.32, 0.34
    else:
        if elite:
            bad, stagnant, normal = 0.12, 0.30, 0.42
        elif strong:
            bad, stagnant, normal = 0.22, 0.36, 0.33
        else:
            bad, stagnant, normal = 0.25, 0.34, 0.34

    bad = _clamp(bad * failure_mult, 0.0, 0.78)
    stagnant = _clamp(stagnant * (0.90 + 0.10 * failure_mult), 0.0, 0.78)
    # Keep at least tiny breakout room.
    if bad + stagnant + normal > 0.97:
        normal = max(0.05, 0.97 - bad - stagnant)

    roll = rng.random()

    if roll < bad:
        # Bad/bust year: force flat-negative. Potential does not rescue it.
        if elite:
            return rng.uniform(-1.10, 0.15)
        if strong:
            return rng.uniform(-1.55, 0.05)
        return rng.uniform(-2.20, -0.05)

    if roll < bad + stagnant:
        # Stagnant year: mostly 0/-1, sometimes tiny +0 before rounding.
        if elite:
            return min(raw * 0.18 if raw > 0 else raw, rng.uniform(-0.35, 0.45))
        if strong:
            return min(raw * 0.12 if raw > 0 else raw, rng.uniform(-0.45, 0.30))
        return min(raw * 0.12 if raw > 0 else raw, rng.uniform(-0.60, 0.24))

    if roll < bad + stagnant + normal:
        # Normal year: small gains only. This should usually become -1/0/+1.
        if raw > 0:
            raw *= 0.46 if elite else (0.38 if strong else 0.34)
        cap = 1.15 if elite else (0.95 if strong else 0.90)
        floor = -0.65 if not elite else -0.35
        return _clamp(raw, floor, cap)

    # Breakout year: meaningful growth remains possible, but rare.
    if elite:
        return _clamp(raw + rng.uniform(0.45, 1.45), -0.20, 3.05)
    if strong:
        return _clamp(raw + rng.uniform(0.30, 1.05), -0.35, 2.15)

    cap = 1.45
    if overall >= 77:
        cap = 1.85
    return _clamp(raw + rng.uniform(0.15, 0.75), -0.50, cap)


def _prospect_level(age: int, overall: int, potential: int) -> str:
    """
    Legacy-safe prospect tier. v14 intentionally makes this stricter so
    potential is not treated like a guaranteed destination.
    """
    gap = max(0, potential - overall)
    if potential >= 97 and gap >= 13 and overall >= 76:
        return "elite"
    if potential >= 95 and gap >= 12 and overall >= 78:
        return "elite"
    if potential >= 94 and gap >= 12:
        return "strong"
    return "normal"


def _draft_slot_value(p: Dict[str, Any]) -> int:
    """Best available draft slot/projection. Lower is better; 999 = unknown."""
    vals: List[int] = []
    for k in ("draftProjection", "trueRank", "rank", "draftRank", "pick"):
        if k in p and p.get(k) is not None:
            v = _safe_int(p.get(k), 999)
            if v > 0:
                vals.append(v)
    meta = p.get("meta")
    if isinstance(meta, dict):
        for k in ("draftPick", "draftProjection", "trueRank", "rank"):
            if k in meta and meta.get(k) is not None:
                v = _safe_int(meta.get(k), 999)
                if v > 0:
                    vals.append(v)
    return min(vals) if vals else 999


def _trait_float(p: Dict[str, Any], key: str, default: float = 0.0) -> float:
    traits = p.get("traits")
    if isinstance(traits, dict):
        return _safe_float(traits.get(key), default)
    return default


def _player_dev_path_value(p: Dict[str, Any]) -> str:
    """Return the saved long-term development path, if one exists."""
    if not isinstance(p, dict):
        return ""
    direct = str(p.get("devPath") or p.get("developmentPath") or "").strip().lower()
    if direct:
        return direct
    profile = p.get("developmentProfile")
    if isinstance(profile, dict):
        return str(profile.get("path") or "").strip().lower()
    return ""


def _assign_development_path(
    p: Dict[str, Any],
    team_name: str,
    age: int,
    overall: int,
    potential: int,
    rng: random.Random,
) -> str:
    """
    v17 persistent career path.

    Potential is a ceiling/probability signal, not a guarantee. The saved path
    creates sim-to-sim career variety: some elite prospects truly hit, some
    become ordinary stars, some plateau, and some bust. This path is assigned
    once and then stored on the player so the career has continuity.
    """
    existing = _player_dev_path_value(p)
    valid = {"ceiling_hit", "star", "good", "normal", "slow", "bust", "late_bloomer", "volatile"}
    if existing in valid:
        return existing

    age = _safe_int(age, 25)
    overall = _safe_int(overall, 70)
    potential = _safe_int(potential, overall)
    gap = max(0, potential - overall)
    draft_slot = _draft_slot_value(p)
    star_upside = _trait_float(p, "starUpside", 0.0)
    work_ethic = _trait_float(p, "workEthic", 0.0)
    boom_bust = _trait_float(p, "boomBust", 0.38)
    tier_text = str(p.get("tier") or p.get("prospectTier") or "").lower()

    elite_label = "elite" in tier_text
    lottery_label = "lottery" in tier_text
    first_round = draft_slot <= 30
    top4 = draft_slot <= 4
    top10 = draft_slot <= 10

    # Ceiling-hit is the key v17 addition. It is rare for ordinary prospects,
    # but real for top-end prospects so 95-98 POT is actually reachable.
    ceiling = 0.0
    if age <= 20 and potential >= 95 and (top4 or star_upside >= 0.88 or elite_label):
        if draft_slot <= 1:
            ceiling = 0.28
        elif draft_slot == 2:
            ceiling = 0.24
        elif draft_slot == 3:
            ceiling = 0.20
        else:
            ceiling = 0.18
        if star_upside >= 0.94:
            ceiling += 0.03
    elif age <= 21 and potential >= 92 and (top10 or star_upside >= 0.78 or lottery_label):
        ceiling = 0.10 if potential <= 93 else 0.12
    elif age <= 22 and potential >= 88 and (draft_slot <= 20 or lottery_label or star_upside >= 0.68):
        ceiling = 0.075
    elif age <= 23 and potential >= 84 and first_round:
        ceiling = 0.055
    elif age <= 24 and potential >= 82 and star_upside >= 0.60:
        ceiling = 0.030

    # No path should make potential destiny. Boom-bust increases both ceiling
    # and bust possibilities slightly.
    ceiling = _clamp(ceiling + max(0.0, boom_bust - 0.42) * 0.08, 0.0, 0.33)

    if potential >= 95:
        star = 0.23 if top4 or elite_label else 0.17
        good = 0.28
        normal = 0.22
        slow = 0.11
        bust = 0.07 + max(0.0, boom_bust - 0.40) * 0.10
    elif potential >= 90:
        star = 0.14 if top10 or lottery_label else 0.10
        good = 0.27
        normal = 0.29
        slow = 0.16
        bust = 0.08 + max(0.0, boom_bust - 0.40) * 0.08
    elif potential >= 85:
        star = 0.07
        good = 0.24
        normal = 0.36
        slow = 0.20
        bust = 0.09 + max(0.0, boom_bust - 0.40) * 0.06
    else:
        star = 0.025
        good = 0.14
        normal = 0.43
        slow = 0.25
        bust = 0.13

    # Work ethic shifts slow/bust outcomes toward good/normal, but never turns
    # everyone into a riser.
    if work_ethic >= 0.74:
        good += 0.04
        slow = max(0.03, slow - 0.025)
        bust = max(0.02, bust - 0.015)
    elif work_ethic <= 0.60:
        bust += 0.025
        good = max(0.03, good - 0.025)

    late = 0.025 if age <= 22 and 82 <= potential <= 90 else 0.010
    volatile = 0.025 if boom_bust >= 0.43 else 0.012

    weights = [
        ("ceiling_hit", ceiling),
        ("star", star),
        ("good", good),
        ("normal", normal),
        ("slow", slow),
        ("bust", bust),
        ("late_bloomer", late),
        ("volatile", volatile),
    ]
    total = sum(max(0.0, w) for _, w in weights)
    roll = rng.random() * total if total > 0 else 0.0
    acc = 0.0
    path = "normal"
    for name, weight in weights:
        acc += max(0.0, weight)
        if roll <= acc:
            path = name
            break

    p["devPath"] = path
    p["developmentProfile"] = {
        "path": path,
        "model": "v17_dynamic_core_shape_ceiling_hit",
        "assignedAge": age,
        "assignedOverall": overall,
        "assignedPotential": potential,
    }
    return path


def _dev_path_for_player(
    p: Dict[str, Any],
    team_name: str,
    age: int,
    overall: int,
    potential: int,
    rng: Optional[random.Random] = None,
) -> str:
    existing = _player_dev_path_value(p)
    if existing:
        return existing
    if rng is None:
        return ""
    return _assign_development_path(p, team_name, age, overall, potential, rng)


def _path_score(path: str) -> int:
    if path == "ceiling_hit":
        return 5
    if path == "star":
        return 4
    if path in {"good", "late_bloomer"}:
        return 3
    if path == "volatile":
        return 2
    if path == "normal":
        return 1
    return 0


def _development_momentum_state(p: Dict[str, Any]) -> Dict[str, Any]:
    raw = p.get("developmentMomentum")
    if isinstance(raw, dict):
        return raw
    return {}


def _development_momentum_adjustment(p: Dict[str, Any], age: int, overall: int, potential: int) -> float:
    """Legacy momentum is stored for audit only and has zero rating impact."""
    return 0.0


def _update_development_momentum(league: Dict[str, Any], before: Dict[str, Dict[str, Any]]) -> None:
    for p, tname in _all_players_with_team(league):
        if not isinstance(p, dict):
            continue
        key = f"{_player_name(p)}__{tname}"
        b = before.get(key)
        if not b:
            continue
        old_ovr = _safe_int(b.get("overall"), _safe_int(p.get("overall"), 70))
        new_ovr = _safe_int(p.get("overall"), old_ovr)
        old_pot = _safe_int(b.get("potential"), old_ovr)
        new_pot = _safe_int(p.get("potential"), max(new_ovr, old_pot))
        delta = new_ovr - old_ovr

        prev = _development_momentum_state(p)
        hot = _safe_int(prev.get("hotYears"), 0)
        stalled = _safe_int(prev.get("stalledYears"), 0)
        decline = _safe_int(prev.get("declineYears"), 0)

        if delta >= 2:
            outcome = "breakout"
            hot = min(4, hot + 1)
            stalled = 0
            decline = 0
        elif delta == 1:
            outcome = "growth"
            hot = min(4, hot + 1) if new_pot > new_ovr else max(0, hot - 1)
            stalled = 0
            decline = 0
        elif delta == 0:
            outcome = "flat"
            hot = max(0, hot - 1)
            stalled = min(5, stalled + 1) if old_pot > old_ovr + 2 else max(0, stalled - 1)
            decline = 0
        elif delta <= -2:
            outcome = "decline"
            hot = 0
            stalled = min(5, stalled + 1) if old_pot > old_ovr + 2 else stalled
            decline = min(5, decline + 1)
        else:
            outcome = "minor_decline"
            hot = max(0, hot - 1)
            stalled = min(5, stalled + 1) if old_pot > old_ovr + 2 else stalled
            decline = min(5, decline + 1)

        p["developmentMomentum"] = {
            "model": "v20",
            "lastOutcome": outcome,
            "lastOvrDelta": delta,
            "lastPotDelta": new_pot - old_pot,
            "hotYears": hot,
            "stalledYears": stalled,
            "declineYears": decline,
        }


def _gate_chance_with_path(dev_path: str, level: str, normal: float, strong: float, elite: float) -> float:
    # Legacy devPath is intentionally not used by v22. Potential/draft pedigree
    # and the new light career-timing profile control opportunity instead.
    return _gate_chance(level, normal, strong, elite)


def _ceiling_lane_expected_bonus(
    p: Dict[str, Any],
    team_name: str,
    age: int,
    overall: int,
    potential: int,
    rng: random.Random,
) -> float:
    return 0.0


def _ceiling_lane_raw_adjustment(
    p: Dict[str, Any],
    team_name: str,
    age: int,
    overall: int,
    potential: int,
    rng: random.Random,
) -> float:
    return 0.0


def _prospect_level_context(
    p: Dict[str, Any],
    team_name: str,
    age: int,
    overall: int,
    potential: int,
) -> str:
    """
    v14 prospect tier. Potential alone is not enough.

    A normal 72 OVR / 84 POT or 75 OVR / 90 POT player should usually still
    be treated as a normal prospect. Strong/elite tiers require actual evidence
    of premium prospect status: very high POT plus draft slot/tier/traits or
    already-useful current ability.
    """
    age = _safe_int(age, 25)
    overall = _safe_int(overall, 70)
    potential = _safe_int(potential, overall)
    gap = max(0, potential - overall)
    if age >= 26 and overall < 85:
        # By this point, low/mid players should mostly be what they are.
        return "normal"

    draft_slot = _draft_slot_value(p)
    star_upside = _trait_float(p, "starUpside", 0.0)
    work_ethic = _trait_float(p, "workEthic", 0.0)
    tier_text = str(p.get("tier") or p.get("prospectTier") or "").lower()

    top5 = draft_slot <= 5
    top10 = draft_slot <= 10
    top20 = draft_slot <= 20
    elite_label = "elite" in tier_text
    lottery_label = "lottery" in tier_text

    premium_evidence = top10 or elite_label or star_upside >= 0.88
    strong_evidence = top20 or lottery_label or star_upside >= 0.78 or work_ethic >= 0.80

    # Unsigned normal low/mid players should not keep a strong-development lane
    # just because their POT is decent. True premium prospects remain protected.
    if team_name == "__FREE_AGENCY__" and overall < 80 and not premium_evidence and potential < 97:
        return "normal"

    if potential >= 97 and gap >= 12 and (overall >= 76 or premium_evidence):
        return "elite"
    if potential >= 95 and gap >= 10 and premium_evidence and overall >= 75:
        return "elite"

    if potential >= 94 and gap >= 12 and strong_evidence:
        return "strong"
    if potential >= 92 and gap >= 14 and (top10 or star_upside >= 0.84):
        return "strong"

    return "normal"


def _gate_chance(level: str, normal: float, strong: float, elite: float) -> float:
    if level == "elite":
        return elite
    if level == "strong":
        return strong
    return normal


def _apply_threshold_crossing_gates(
    p: Dict[str, Any],
    team_name: str,
    before: int,
    target: int,
    stats: Optional[Dict[str, Any]],
    settings: Dict[str, Any],
    rng: random.Random,
) -> int:
    """
    Hard gates for the exact jumps that inflated the league:
      70-73 -> 75/77
      74-76 -> 77/80
      77-80 -> 80/83
      81-84 -> 85

    Potential improves the chance, but does not guarantee crossing.
    Stats are deliberately ignored here except for not being a major driver.
    """
    age = _safe_int(p.get("age"), 25)
    potential = _safe_int(p.get("potential"), before)
    level = _prospect_level_context(p, team_name, age, before, potential)
    dev_path = _dev_path_for_player(p, team_name, age, before, potential, rng)

    if target <= before:
        # Tiny free-agency bias: if already regressing, unsigned low/mid players
        # have a small chance to slip one more point.
        if team_name == "__FREE_AGENCY__" and before < 80 and level == "normal":
            bias = float((settings.get("progression", {}) or {}).get("free_agent_regression_bias", 0.12))
            if rng.random() < bias * 0.35:
                return max(60, target - 1)
        return target

    # Tiny free-agency bias for players who begin progression unsigned.
    # This is intentionally small; the league-wide harsh model is the real fix.
    if team_name == "__FREE_AGENCY__" and before < 80 and level == "normal":
        bias = float((settings.get("progression", {}) or {}).get("free_agent_regression_bias", 0.12))
        if rng.random() < bias:
            target = max(before, target - 1)
        if target <= before:
            return target

    if age <= 24:
        # Below 70 should almost never jump into the mid-70s in one year.
        if before < 70 and target >= 75:
            chance = _gate_chance_with_path(dev_path, level, 0.04, 0.10, 0.22)
            if rng.random() > chance:
                target = min(target, 74)

        # 70-73 should rarely become truly playable immediately.
        if 70 <= before <= 73:
            if target >= 77:
                chance = _gate_chance_with_path(dev_path, level, 0.015, 0.055, 0.15)
                if rng.random() > chance:
                    target = min(target, 76)
            if target >= 75:
                chance = _gate_chance_with_path(dev_path, level, 0.18, 0.30, 0.46)
                if rng.random() > chance:
                    target = min(target, 74)

        # This was the biggest leak: 74-76 -> 77+.
        if 74 <= before <= 76:
            if target >= 80:
                chance = _gate_chance_with_path(dev_path, level, 0.015, 0.055, 0.15)
                if rng.random() > chance:
                    target = min(target, 79)
            if target >= 77:
                chance = _gate_chance_with_path(dev_path, level, 0.27, 0.43, 0.66)
                if rng.random() > chance:
                    target = min(target, 76)

        # 77-80 should not frequently become 80+/83+ without a real hit.
        if 77 <= before <= 80:
            if target >= 83:
                chance = _gate_chance_with_path(dev_path, level, 0.025, 0.075, 0.18)
                if rng.random() > chance:
                    target = min(target, 82)
            if target >= 80:
                chance = _gate_chance_with_path(dev_path, level, 0.30, 0.46, 0.68)
                if rng.random() > chance:
                    target = min(target, 79)

        # 81-84 -> 85+ should be a premium-prospect/star outcome.
        if 81 <= before <= 84 and target >= 85:
            chance = _gate_chance_with_path(dev_path, level, 0.12, 0.23, 0.42)
            if rng.random() > chance:
                target = min(target, 84)

    elif age == 25:
        # Age 25 was still too friendly. It should be near-neutral unless
        # the player is genuinely high-upside.
        if before < 77 and target >= 77:
            chance = _gate_chance_with_path(dev_path, level, 0.12, 0.22, 0.36)
            if rng.random() > chance:
                target = min(target, 76)
        if before < 80 and target >= 80:
            chance = _gate_chance_with_path(dev_path, level, 0.07, 0.13, 0.24)
            if rng.random() > chance:
                target = min(target, 79)
        if 81 <= before <= 84 and target >= 85:
            chance = _gate_chance_with_path(dev_path, level, 0.08, 0.15, 0.28)
            if rng.random() > chance:
                target = min(target, 84)

    return int(_clamp(target, 60, 99))



def _sample_delta_from_distribution(rng: random.Random, dist: List[Tuple[int, float]]) -> int:
    """Sample an integer OVR delta from an explicit probability table."""
    total = sum(max(0.0, float(prob)) for _delta, prob in dist)
    if total <= 0:
        return 0
    roll = rng.random() * total
    acc = 0.0
    for delta, prob in dist:
        acc += max(0.0, float(prob))
        if roll <= acc:
            return int(delta)
    return int(dist[-1][0])


def _controlled_free_agent_low_mid_delta(
    age: int,
    overall: int,
    level: str,
    rng: random.Random,
) -> int:
    """Balanced V23 free-agent/depth progression.

    Being unsigned is a small negative signal, not a sentence. Young and
    mid-20s players below 74 can improve, hold, or regress. Older unsigned
    veterans remain progressively more decline-prone. This keeps the deep pool
    alive while the hard 74+ shelf controls how many players enter the playable
    NBA-quality pool.
    """
    age = _safe_int(age, 25)
    overall = _safe_int(overall, 70)

    if overall < 70:
        band = "under70"
    elif overall <= 73:
        band = "70_73"
    elif overall <= 76:
        band = "74_76"
    elif overall <= 80:
        band = "77_80"
    else:
        band = "81_84"

    if age <= 24:
        normal = {
            "under70": [(-3, .008), (-2, .037), (-1, .145), (0, .500), (1, .235), (2, .065), (3, .010)],
            "70_73":  [(-3, .008), (-2, .040), (-1, .160), (0, .470), (1, .245), (2, .065), (3, .012)],
            "74_76":  [(-3, .010), (-2, .050), (-1, .185), (0, .455), (1, .225), (2, .063), (3, .012)],
            "77_80":  [(-3, .012), (-2, .060), (-1, .215), (0, .455), (1, .195), (2, .055), (3, .008)],
            "81_84":  [(-3, .015), (-2, .070), (-1, .235), (0, .455), (1, .170), (2, .047), (3, .008)],
        }
        strong = {
            "under70": [(-3, .006), (-2, .030), (-1, .120), (0, .455), (1, .270), (2, .095), (3, .024)],
            "70_73":  [(-3, .005), (-2, .025), (-1, .105), (0, .430), (1, .285), (2, .115), (3, .035)],
            "74_76":  [(-3, .006), (-2, .030), (-1, .120), (0, .415), (1, .285), (2, .110), (3, .034)],
            "77_80":  [(-3, .007), (-2, .035), (-1, .135), (0, .405), (1, .280), (2, .105), (3, .033)],
            "81_84":  [(-3, .008), (-2, .040), (-1, .150), (0, .410), (1, .275), (2, .090), (3, .027)],
        }
        elite = {
            key: [(-3, .003), (-2, .017), (-1, .080), (0, .370), (1, .330), (2, .145), (3, .055)]
            for key in normal
        }
        table = elite if level == "elite" else strong if level == "strong" else normal
        delta = _sample_delta_from_distribution(rng, table[band])
    elif age <= 27:
        normal = {
            "under70": [(-3, .010), (-2, .045), (-1, .170), (0, .510), (1, .215), (2, .043), (3, .007)],
            "70_73":  [(-3, .010), (-2, .045), (-1, .175), (0, .490), (1, .215), (2, .055), (3, .010)],
            "74_76":  [(-3, .014), (-2, .060), (-1, .205), (0, .475), (1, .195), (2, .045), (3, .006)],
            "77_80":  [(-3, .022), (-2, .090), (-1, .265), (0, .445), (1, .145), (2, .030), (3, .003)],
            "81_84":  [(-3, .025), (-2, .105), (-1, .285), (0, .435), (1, .125), (2, .023), (3, .002)],
        }
        strong = {
            "under70": [(-3, .008), (-2, .040), (-1, .155), (0, .475), (1, .240), (2, .070), (3, .012)],
            "70_73":  [(-3, .007), (-2, .035), (-1, .145), (0, .455), (1, .260), (2, .080), (3, .018)],
            "74_76":  [(-3, .010), (-2, .045), (-1, .165), (0, .440), (1, .250), (2, .075), (3, .015)],
            "77_80":  [(-3, .012), (-2, .055), (-1, .185), (0, .430), (1, .240), (2, .065), (3, .013)],
            "81_84":  [(-3, .015), (-2, .065), (-1, .205), (0, .430), (1, .220), (2, .055), (3, .010)],
        }
        elite = {
            key: [(-3, .004), (-2, .022), (-1, .100), (0, .410), (1, .300), (2, .125), (3, .039)]
            for key in normal
        }
        table = elite if level == "elite" else strong if level == "strong" else normal
        delta = _sample_delta_from_distribution(rng, table[band])
    elif age <= 29:
        if level == "elite":
            dist = [(-3, .012), (-2, .055), (-1, .205), (0, .480), (1, .190), (2, .052), (3, .006)]
        elif level == "strong":
            dist = [(-3, .020), (-2, .085), (-1, .270), (0, .480), (1, .120), (2, .023), (3, .002)]
        elif overall < 74:
            dist = [(-3, .025), (-2, .095), (-1, .280), (0, .480), (1, .105), (2, .014), (3, .001)]
        else:
            dist = [(-3, .032), (-2, .120), (-1, .315), (0, .455), (1, .068), (2, .010), (3, .000)]
        delta = _sample_delta_from_distribution(rng, dist)
    elif age <= 32:
        if level == "elite":
            dist = [(-3, .025), (-2, .100), (-1, .300), (0, .430), (1, .120), (2, .023), (3, .002)]
        else:
            dist = [(-3, .045), (-2, .160), (-1, .365), (0, .350), (1, .070), (2, .010), (3, .000)]
        delta = _sample_delta_from_distribution(rng, dist)
    else:
        dist = [(-5, .010), (-4, .030), (-3, .105), (-2, .255), (-1, .360), (0, .205), (1, .032), (2, .003)]
        delta = _sample_delta_from_distribution(rng, dist)

    return int(_clamp(delta, -5 if age >= 34 else -3, 3))


# -------------------------
# V23 career timing (light, non-deterministic career arcs)
# -------------------------
_CAREER_TIMING_VERSION = "v23"


def _career_timing_profile(
    p: Dict[str, Any],
    age: int,
    overall: int,
    potential: int,
    rng: random.Random,
) -> Dict[str, Any]:
    """Assign a light timing profile once per save.

    This is not a deterministic dev path and it never guarantees success. It
    only changes *when* a player is slightly more likely to stall, break out,
    or peak. Potential remains the main upside guide and yearly randomness can
    override every profile.
    """
    existing = p.get("careerTimingProfile") if isinstance(p, dict) else None
    if isinstance(existing, dict) and existing.get("version") == _CAREER_TIMING_VERSION:
        return existing

    age = _safe_int(age, 25)
    overall = _safe_int(overall, 70)
    potential = _safe_int(potential, overall)
    gap = max(0, potential - overall)

    weights = {
        "steady": 0.38,
        "early_peak": 0.15,
        "late_bloomer": 0.17,
        "plateau_then_leap": 0.15,
        "volatile": 0.15,
    }
    if gap >= 10 and age <= 23:
        weights["late_bloomer"] += 0.03
        weights["steady"] += 0.03
        weights["early_peak"] -= 0.02
    if gap <= 2:
        weights["volatile"] += 0.03
        weights["early_peak"] += 0.02
        weights["late_bloomer"] -= 0.02

    roll = rng.random() * sum(max(0.0, v) for v in weights.values())
    acc = 0.0
    kind = "steady"
    for name, weight in weights.items():
        acc += max(0.0, weight)
        if roll <= acc:
            kind = name
            break

    if kind == "early_peak":
        breakout_age = rng.randint(19, 22)
        peak_age = rng.randint(24, 27)
        volatility = rng.uniform(0.88, 1.08)
    elif kind == "late_bloomer":
        breakout_age = rng.randint(24, 28)
        peak_age = rng.randint(max(28, breakout_age + 1), 32)
        volatility = rng.uniform(0.92, 1.12)
    elif kind == "plateau_then_leap":
        breakout_age = rng.randint(23, 27)
        peak_age = rng.randint(max(27, breakout_age + 1), 31)
        volatility = rng.uniform(0.90, 1.10)
    elif kind == "volatile":
        breakout_age = rng.randint(20, 27)
        peak_age = rng.randint(max(25, breakout_age), 31)
        volatility = rng.uniform(1.15, 1.42)
    else:
        breakout_age = rng.randint(21, 25)
        peak_age = rng.randint(max(27, breakout_age + 2), 31)
        volatility = rng.uniform(0.86, 1.04)

    profile = {
        "version": _CAREER_TIMING_VERSION,
        "kind": kind,
        "breakoutAge": breakout_age,
        "peakAge": peak_age,
        "volatility": round(volatility, 4),
        "assignedAge": age,
        "assignedOverall": overall,
        "assignedPotential": potential,
    }
    if isinstance(p, dict):
        p["careerTimingProfile"] = profile
    return profile


def _career_timing_expected_adjustment(
    p: Dict[str, Any], age: int, overall: int, potential: int, rng: random.Random
) -> float:
    profile = _career_timing_profile(p, age, overall, potential, rng)
    kind = str(profile.get("kind") or "steady")
    breakout = _safe_int(profile.get("breakoutAge"), 24)
    peak = _safe_int(profile.get("peakAge"), 29)
    gap = max(0, potential - overall)
    adj = 0.0

    if kind in {"late_bloomer", "plateau_then_leap"} and age < breakout - 1:
        adj -= 0.10
    if abs(age - breakout) <= 1 and gap >= 3:
        adj += 0.20 if kind in {"late_bloomer", "plateau_then_leap"} else 0.10
    if age > peak:
        adj -= min(0.52, 0.14 * (age - peak))
        if kind == "early_peak":
            adj -= 0.12
    return _clamp(adj, -0.62, 0.34)


def _career_timing_sigma_mult(
    p: Dict[str, Any], age: int, overall: int, potential: int, rng: random.Random
) -> float:
    profile = _career_timing_profile(p, age, overall, potential, rng)
    return float(_clamp(_safe_float(profile.get("volatility"), 1.0), 0.82, 1.45))


def _apply_career_timing_to_controlled_delta(
    p: Dict[str, Any], age: int, overall: int, potential: int, delta: int, rng: random.Random
) -> int:
    profile = _career_timing_profile(p, age, overall, potential, rng)
    kind = str(profile.get("kind") or "steady")
    breakout = _safe_int(profile.get("breakoutAge"), 24)
    peak = _safe_int(profile.get("peakAge"), 29)
    gap = max(0, potential - overall)

    # Delayed arcs can genuinely stall for several seasons, then receive a
    # larger probability window around year 4/5. Nothing here guarantees it.
    if kind in {"late_bloomer", "plateau_then_leap"}:
        if age < breakout - 1 and delta > 0 and rng.random() < 0.32:
            delta -= 1
        elif abs(age - breakout) <= 1 and gap >= 3:
            if delta <= 0 and rng.random() < 0.24:
                delta += 1
            if delta == 1 and rng.random() < 0.10:
                delta += 1

    if kind == "early_peak":
        if age <= breakout + 1 and gap > 0 and delta <= 0 and rng.random() < 0.15:
            delta += 1
        if age > peak:
            if delta > 0 and rng.random() < 0.42:
                delta -= 1
            elif delta == 0 and rng.random() < 0.13:
                delta = -1

    if kind == "volatile" and rng.random() < 0.16:
        delta += rng.choice([-1, 1])

    if age > peak and kind != "late_bloomer" and delta > 0 and rng.random() < 0.20:
        delta -= 1

    return int(_clamp(delta, -3, 4))

def _controlled_low_mid_delta(
    p: Dict[str, Any],
    team_name: str,
    age: int,
    overall: int,
    potential: int,
    settings: Dict[str, Any],
    rng: random.Random,
    stats: Optional[Dict[str, Any]] = None,
) -> Optional[int]:
    """Balanced V23 player-level outcomes below 85 OVR.

    The league-wide hard shelves control population totals. This function only
    decides which individual players rise, stall, or fall. In particular,
    players below 74 are no longer treated as automatic regression inventory:
    young and mid-20s depth players have balanced outcomes, low-70s players can
    enter the 74+ pool, and older/low-upside players can rotate back out.
    """
    age = _safe_int(age, 25)
    overall = _safe_int(overall, 70)
    potential = _safe_int(potential, overall)

    if overall >= 85 or age >= 30:
        return None

    level = _prospect_level_context(p, team_name, age, overall, potential)
    if team_name == "__FREE_AGENCY__":
        delta = _controlled_free_agent_low_mid_delta(age, overall, level, rng)
        delta = _apply_career_timing_to_controlled_delta(p, age, overall, potential, delta, rng)
        return int(_clamp(delta, -3, 3))

    if overall < 70:
        band = "under70"
    elif overall <= 73:
        band = "70_73"
    elif overall <= 76:
        band = "74_76"
    elif overall <= 80:
        band = "77_80"
    else:
        band = "81_84"

    young_normal = {
        "under70": [(-3, .008), (-2, .037), (-1, .145), (0, .500), (1, .235), (2, .065), (3, .010)],
        "70_73":  [(-3, .007), (-2, .033), (-1, .140), (0, .465), (1, .260), (2, .080), (3, .015)],
        "74_76":  [(-3, .012), (-2, .055), (-1, .185), (0, .445), (1, .225), (2, .065), (3, .013)],
        "77_80":  [(-3, .012), (-2, .060), (-1, .200), (0, .455), (1, .210), (2, .053), (3, .010)],
        "81_84":  [(-3, .010), (-2, .050), (-1, .180), (0, .460), (1, .235), (2, .055), (3, .010)],
    }
    young_strong = {
        "under70": [(-3, .004), (-2, .021), (-1, .095), (0, .440), (1, .295), (2, .115), (3, .030)],
        "70_73":  [(-3, .003), (-2, .018), (-1, .085), (0, .415), (1, .315), (2, .130), (3, .034)],
        "74_76":  [(-3, .006), (-2, .030), (-1, .120), (0, .405), (1, .285), (2, .115), (3, .039)],
        "77_80":  [(-3, .008), (-2, .038), (-1, .140), (0, .400), (1, .280), (2, .100), (3, .034)],
        "81_84":  [(-3, .008), (-2, .040), (-1, .140), (0, .410), (1, .295), (2, .085), (3, .022)],
    }
    young_elite = {
        "under70": [(-3, .002), (-2, .010), (-1, .055), (0, .350), (1, .345), (2, .175), (3, .063)],
        "70_73":  [(-3, .002), (-2, .008), (-1, .045), (0, .325), (1, .355), (2, .195), (3, .070)],
        "74_76":  [(-3, .003), (-2, .015), (-1, .070), (0, .340), (1, .350), (2, .165), (3, .057)],
        "77_80":  [(-3, .004), (-2, .026), (-1, .095), (0, .355), (1, .340), (2, .135), (3, .045)],
        "81_84":  [(-3, .004), (-2, .024), (-1, .085), (0, .365), (1, .330), (2, .145), (3, .047)],
    }

    if age <= 24:
        table = young_elite if level == "elite" else young_strong if level == "strong" else young_normal
        delta = _sample_delta_from_distribution(rng, table[band])
    elif age <= 27:
        mid_normal = {
            "under70": [(-3, .012), (-2, .050), (-1, .185), (0, .515), (1, .195), (2, .038), (3, .005)],
            "70_73":  [(-3, .010), (-2, .045), (-1, .175), (0, .495), (1, .215), (2, .052), (3, .008)],
            "74_76":  [(-3, .020), (-2, .075), (-1, .235), (0, .465), (1, .165), (2, .035), (3, .005)],
            "77_80":  [(-3, .025), (-2, .095), (-1, .275), (0, .445), (1, .130), (2, .027), (3, .003)],
            "81_84":  [(-3, .028), (-2, .105), (-1, .290), (0, .435), (1, .120), (2, .020), (3, .002)],
        }
        mid_strong = {
            "under70": [(-3, .006), (-2, .030), (-1, .125), (0, .480), (1, .265), (2, .078), (3, .016)],
            "70_73":  [(-3, .005), (-2, .025), (-1, .115), (0, .455), (1, .285), (2, .092), (3, .023)],
            "74_76":  [(-3, .010), (-2, .045), (-1, .165), (0, .440), (1, .250), (2, .075), (3, .015)],
            "77_80":  [(-3, .012), (-2, .055), (-1, .185), (0, .430), (1, .240), (2, .065), (3, .013)],
            "81_84":  [(-3, .015), (-2, .065), (-1, .205), (0, .430), (1, .220), (2, .055), (3, .010)],
        }
        mid_elite = {
            key: [(-3, .004), (-2, .020), (-1, .090), (0, .405), (1, .315), (2, .125), (3, .041)]
            for key in mid_normal
        }
        table = mid_elite if level == "elite" else mid_strong if level == "strong" else mid_normal
        delta = _sample_delta_from_distribution(rng, table[band])
    else:  # ages 28-29: modest decline pressure, not a cliff
        if level == "elite":
            dist = [(-3, .010), (-2, .045), (-1, .195), (0, .500), (1, .195), (2, .050), (3, .005)]
        elif level == "strong":
            dist = [(-3, .018), (-2, .075), (-1, .255), (0, .490), (1, .135), (2, .025), (3, .002)]
        elif overall < 74:
            dist = [(-3, .025), (-2, .090), (-1, .275), (0, .485), (1, .110), (2, .014), (3, .001)]
        else:
            dist = [(-3, .035), (-2, .125), (-1, .330), (0, .440), (1, .062), (2, .008), (3, .000)]
        delta = _sample_delta_from_distribution(rng, dist)

    delta = _apply_career_timing_to_controlled_delta(p, age, overall, potential, delta, rng)

    # Potential is an opportunity signal, not destiny. These limits keep
    # ordinary depth players from receiving repeated +3s while still allowing
    # a low-70s player to cross into 74+ naturally.
    if level == "normal" and overall < 81:
        delta = min(delta, 2)
    if level != "elite" and overall < 77:
        delta = min(delta, 2)
    if potential <= overall + 1 and delta > 0 and rng.random() < 0.36:
        delta = max(0, delta - 1)

    return int(_clamp(delta, -3, 3))


def _open_career_arc_adjustment(age: int, overall: int, potential: int, rng: random.Random, settings: Dict[str, Any]) -> float:
    # Kept for API compatibility. V23 career timing is player-specific and is
    # applied in _target_delta_for_player / controlled outcome tables.
    return 0.0


def _target_delta_for_player(
    p: Dict[str, Any],
    stats: Optional[Dict[str, Any]],
    settings: Dict[str, Any],
    rng: random.Random,
    team_name: str = ""
) -> int:
    age = _safe_int(p.get("age"), 25)
    overall = _safe_int(p.get("overall"), 70)
    potential = _safe_int(p.get("potential"), overall)

    # v16: for low/mid players, especially young players, use explicit odds
    # instead of the old additive model. This is the actual fix for the
    # 77-84 flood: the final delta itself is low-end biased.
    controlled_delta = _controlled_low_mid_delta(p, team_name, age, overall, potential, settings, rng, stats=stats)
    if controlled_delta is not None:
        return controlled_delta

    min_fac, prod_adj = _stat_context(stats, settings, age=age, overall=overall)

    expected = _age_expected_delta(age)
    expected += _potential_gap_effect(age, overall, potential)
    expected += _star_pipeline_bonus(age, overall, potential)
    expected += _ceiling_lane_expected_bonus(p, team_name, age, overall, potential, rng)
    expected += _career_timing_expected_adjustment(p, age, overall, potential, rng)
    expected -= _elite_aging_pressure(age, overall)

    if expected > 0:
        expected *= (0.96 + 0.04 * min_fac)

    expected += prod_adj
    expected = _high_overall_resistance(age, overall, expected, potential)
    expected = _low_overall_young_dampener(age, overall, potential, expected)

    cfg = settings.get("progression", {}) or {}
    variance_mult = float(cfg.get("variance_mult", 1.0))
    sigma = _variance_sigma(age, overall) * variance_mult * _career_timing_sigma_mult(p, age, overall, potential, rng)

    raw = expected + rng.gauss(0.0, sigma)
    raw += _rare_event_adjustment(age, overall, potential, rng, settings)
    raw += _ceiling_lane_raw_adjustment(p, team_name, age, overall, potential, rng)
    raw = _apply_young_development_outcome_roll(age, overall, potential, raw, rng, settings)

    # Do not run high-overall resistance a second time on the entire random roll.
    # The first pass controls expected inflation; variance should still allow
    # rare breakouts and rare collapses.
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
    """
    Frontend-derived ratings source-of-truth guard.

    Python progression owns attrs, overall, age, potential, and shape locks.
    The React LeagueEditor/V19 formulas own offRating, defRating, stamina,
    and scoringRating. Older versions bumped those fields here with a noisy
    overall-delta multiplier, which created fake OFF/DEF/STAM deltas whenever
    a frontend path later recomputed V19 values. Leaving these fields untouched
    keeps every progression route consistent: frontend recomputes them once
    after Python returns and builds the visible deltas from final saved values.
    """
    return


def _is_current_draft_shape_protected(player: Any) -> bool:
    return isinstance(player, dict) and bool(player.get("__skipProgressionCurrentRookie"))


def _is_shape_protected_item(item: Dict[str, Any]) -> bool:
    return bool(item.get("shape_protected")) or _is_current_draft_shape_protected(item.get("player"))



# -------------------------
# V25 hidden career-path engine
# -------------------------

_V25_PROFILE_VERSION = "v25d_polished_outliers_v1"
_V25_AUDIT_KEY = "v25CareerAudit"
_V25_FAST_DECLINE_PROFILES = {"fast_decliner", "short_peak", "true_bust"}
_V25_BREAKOUT_PROFILES = {"generational_hit", "star_hit", "hidden_gem", "raw_tools_outlier", "skill_feel_outlier", "late_bloomer", "slow_burn"}
_V25_PROTECTED_PROFILES = {"generational_hit", "star_hit", "hidden_gem", "raw_tools_outlier", "skill_feel_outlier", "long_prime", "late_bloomer"}
# V25C: hidden upside is an overlay, not a competing profile. A player can be
# steady/slow-burn/volatile and ALSO secretly have more ceiling than his visible
# POT suggests. This is the missing low/mid-tier surprise lane.
_V25_HIDDEN_UPSIDE_LEVELS = {"none": 0, "rotation_gem": 1, "starter_gem": 2, "star_gem": 3, "elite_gem": 4}
_V25_HIDDEN_UPSIDE_SET = {"rotation_gem", "starter_gem", "star_gem", "elite_gem"}


def _v25_meta(p: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(p, dict):
        return {}
    meta = p.get("meta")
    if not isinstance(meta, dict):
        meta = {}
        p["meta"] = meta
    return meta


def _v25_league_meta(league: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(league, dict):
        return {}
    meta = league.get("meta")
    if not isinstance(meta, dict):
        meta = {}
        league["meta"] = meta
    return meta


def _v25_stable_int(*parts: Any) -> int:
    raw = "|".join(str(x) for x in parts)
    return int(hashlib.sha256(raw.encode("utf-8", "ignore")).hexdigest()[:16], 16)


def _v25_unit(*parts: Any) -> float:
    return _v25_stable_int(*parts) / float(0xFFFFFFFFFFFFFFFF)


def _v25_choice(weighted: List[Tuple[str, float]], *seed_parts: Any) -> str:
    total = sum(max(0.0, float(w)) for _, w in weighted)
    if total <= 0:
        return weighted[0][0] if weighted else "steady_growth"
    roll = _v25_unit("choice", *seed_parts) * total
    acc = 0.0
    last = weighted[-1][0]
    for name, weight in weighted:
        acc += max(0.0, float(weight))
        if roll <= acc:
            return name
    return last


def _v25_league_seed(league: Dict[str, Any], fallback_seed: Any = None) -> str:
    meta = _v25_league_meta(league)
    seed = meta.get("progressionSeedV25") or league.get("progressionSeedV25") or meta.get("progressionUniverseSeedV25")
    if seed is None or str(seed) == "":
        # Frontend normally creates a new-save seed. This fallback only exists for
        # direct Python smoke tests; it is deterministic for the same passed seed.
        seed = f"fallback_{fallback_seed if fallback_seed is not None else 'no_seed'}_{_v25_stable_int('league', league.get('leagueName', ''), len(_all_players(league))) % 10_000_000}"
    seed = str(seed)
    meta["progressionSeedV25"] = seed
    league["progressionSeedV25"] = seed
    return seed


def _v25_traits(p: Dict[str, Any]) -> Dict[str, float]:
    raw = p.get("traits") or _v25_meta(p).get("traits") or {}
    if not isinstance(raw, dict):
        return {"nbaReady": 0.5, "boomBust": 0.5, "workEthic": 0.5, "injuryRisk": 0.15, "starUpside": 0.5}
    return {
        "nbaReady": _clamp(_safe_float(raw.get("nbaReady"), 0.5), 0.0, 1.0),
        "boomBust": _clamp(_safe_float(raw.get("boomBust"), 0.5), 0.0, 1.0),
        "workEthic": _clamp(_safe_float(raw.get("workEthic"), 0.5), 0.0, 1.0),
        "injuryRisk": _clamp(_safe_float(raw.get("injuryRisk"), 0.15), 0.0, 1.0),
        "starUpside": _clamp(_safe_float(raw.get("starUpside"), 0.5), 0.0, 1.0),
    }


def _v25_class_type(p: Dict[str, Any]) -> str:
    meta = _v25_meta(p)
    raw = (
        meta.get("v25DraftClassType") or meta.get("draftClassType") or meta.get("classType") or
        p.get("v25DraftClassType") or p.get("draftClassType") or p.get("classType") or "normal"
    )
    raw = str(raw or "normal").lower()
    if raw in {"custom", "provided", "loaded"}:
        return "normal"
    return raw


def _v25_class_quality_mult(class_type: str) -> float:
    class_type = str(class_type or "normal").lower()
    return {
        "weak": 0.86,
        "normal": 1.00,
        "deep": 1.06,
        "star_heavy": 1.12,
        "generational": 1.18,
        "defensive_class": 1.00,
        "guard_heavy": 1.01,
        "big_man_heavy": 1.01,
        "top_heavy": 1.10,
        "deep_no_superstars": 1.04,
        "boom_bust": 1.07,
        "flat": 0.96,
    }.get(class_type, 1.00)


def _v25_draft_origin(p: Dict[str, Any]) -> str:
    meta = _v25_meta(p)
    acquired = str(meta.get("acquiredVia") or p.get("acquiredVia") or "").lower()
    round_num = _safe_int(meta.get("draftRound"), _safe_int(p.get("draftRound"), 0))
    pick = _safe_int(meta.get("draftPick"), _safe_int(p.get("draftPick"), 0))
    if acquired == "undrafted_free_agent" or (round_num <= 0 and pick <= 0):
        if acquired == "draft":
            return "unknown_drafted"
        return "undrafted"
    if pick == 1:
        return "pick_1"
    if 2 <= pick <= 3:
        return "top_3"
    if 4 <= pick <= 5:
        return "top_5"
    if 6 <= pick <= 14:
        return "lottery"
    if 15 <= pick <= 20:
        return "mid_first"
    if 21 <= pick <= 30 or round_num == 1:
        return "late_first"
    if 31 <= pick <= 40:
        return "early_second"
    if 41 <= pick <= 60 or round_num == 2:
        return "late_second"
    return "unknown_drafted"


def _v25_pre_draft_rank(p: Dict[str, Any]) -> int:
    meta = _v25_meta(p)
    for key in ("v25PreDraftRank", "v25PreDraftProjection", "trueRank", "draftProjection", "rank", "boardRank"):
        value = meta.get(key) if key in meta else p.get(key)
        rank = _safe_int(value, 0)
        if rank > 0:
            return rank
    return 999


def _v25_prospect_grade(p: Dict[str, Any], age: int, overall: int, potential: int) -> float:
    meta = _v25_meta(p)
    existing = meta.get("v25ProspectGrade") or p.get("v25ProspectGrade")
    if existing is not None:
        return _clamp(_safe_float(existing, 50.0), 35.0, 99.0)
    traits = _v25_traits(p)
    rank = _v25_pre_draft_rank(p)
    class_mult = _v25_class_quality_mult(_v25_class_type(p))
    gap = max(0, potential - overall)
    age_bonus = _clamp((23 - age) * 1.15, -5.0, 6.0)
    rank_bonus = 0.0
    if rank <= 3:
        rank_bonus = 4.0
    elif rank <= 10:
        rank_bonus = 2.4
    elif rank <= 20:
        rank_bonus = 1.1
    elif rank <= 40:
        rank_bonus = 0.2
    elif rank < 999:
        rank_bonus = -1.2
    trait_bonus = (
        (traits["starUpside"] - 0.5) * 7.0 +
        (traits["workEthic"] - 0.5) * 4.0 +
        (traits["boomBust"] - 0.5) * 1.8 -
        max(0.0, traits["injuryRisk"] - 0.20) * 5.0
    )
    grade = (0.52 * potential + 0.36 * overall + 0.12 * (overall + min(12, gap)))
    grade += age_bonus + rank_bonus + trait_bonus
    grade = 50.0 + (grade - 50.0) * class_mult
    return _clamp(grade, 35.0, 99.0)


def _v25_hidden_gem_chance(p: Dict[str, Any], age: int, overall: int, potential: int, grade: float, origin: str, class_type: str) -> float:
    """V25D: rare but visible low/mid-POT hidden-gem lane.

    V25C proved the overlay works but was still too conservative for true
    76-80 visible-POT surprises. This version gives low/mid young players a
    little more oxygen while leaving hard league caps in charge of inflation.
    """
    traits = _v25_traits(p)
    chance = 0.012
    if age <= 19:
        chance += 0.024
    elif age <= 21:
        chance += 0.020
    elif age <= 23:
        chance += 0.012
    elif age <= 25:
        chance += 0.004

    if 76 <= potential <= 80:
        chance += 0.022
    elif 81 <= potential <= 84:
        chance += 0.014
    elif potential <= 75:
        chance += 0.006

    if 68 <= overall <= 72:
        chance += 0.018
    elif 73 <= overall <= 76:
        chance += 0.012
    elif overall < 68:
        chance += 0.006

    if origin in {"late_first", "early_second", "late_second"}:
        chance += 0.017
    if origin == "undrafted":
        chance += 0.012
    if class_type in {"deep", "boom_bust", "guard_heavy", "big_man_heavy", "deep_no_superstars"}:
        chance += 0.012

    chance += max(0.0, traits["workEthic"] - 0.50) * 0.048
    chance += max(0.0, traits["starUpside"] - 0.50) * 0.042
    chance += max(0.0, traits["boomBust"] - 0.52) * 0.026

    archetype = str(p.get("archetype") or _v25_meta(p).get("archetype") or "").lower()
    if any(word in archetype for word in ("raw", "tool", "upside", "international", "jumbo", "giant")):
        chance += 0.008
    if any(word in archetype for word in ("smart", "feel", "lead", "creator", "point", "pass")):
        chance += 0.006

    # A low grade can still hide a useful player, but star/elite outcomes remain rare.
    if grade < 45:
        chance *= 0.62
    elif grade < 50:
        chance *= 0.80
    if age >= 26:
        chance *= 0.36
    if overall >= 78:
        chance *= 0.50
    return _clamp(chance, 0.002, 0.155)


def _v25_hidden_upside_overlay(
    p: Dict[str, Any],
    age: int,
    overall: int,
    potential: int,
    grade: float,
    origin: str,
    class_type: str,
    league_seed: str,
    seed_key: str,
) -> str:
    """V25C hidden-gem overlay.

    This is intentionally separate from the main career profile. It creates a
    small pool of low/mid visible-POT players with hidden rotation/starter/star
    upside, then lets the yearly engine and hard caps decide who actually hits.
    """
    if age > 25 or overall > 80 or potential > 90:
        return "none"

    traits = _v25_traits(p)
    gap = max(0, potential - overall)
    base = _v25_hidden_gem_chance(p, age, overall, potential, grade, origin, class_type)

    # Most eligible players get nothing. Better youth/tools/work-ethic/class
    # context increase the chance, but visible POT is not allowed to fully gate it.
    mult = 1.0
    if age <= 19:
        mult += 0.45
    elif age <= 21:
        mult += 0.28
    elif age <= 23:
        mult += 0.12
    if 68 <= overall <= 72:
        mult += 0.36
    elif 73 <= overall <= 76:
        mult += 0.28
    elif overall < 68:
        mult += 0.10
    if 76 <= potential <= 80:
        mult += 0.40
    elif 81 <= potential <= 84:
        mult += 0.30
    elif potential <= 75:
        mult -= 0.06
    if origin in {"late_first", "early_second", "late_second", "undrafted"}:
        mult += 0.22
    if class_type in {"deep", "boom_bust", "deep_no_superstars", "guard_heavy", "big_man_heavy"}:
        mult += 0.18
    mult += max(0.0, traits["workEthic"] - 0.50) * 0.55
    mult += max(0.0, traits["starUpside"] - 0.50) * 0.45
    mult += max(0.0, traits["boomBust"] - 0.55) * 0.30
    if grade < 42:
        mult *= 0.48
    elif grade < 48:
        mult *= 0.70
    elif grade >= 60:
        mult *= 1.15

    # Chances are per player, not guaranteed outcomes. The actual hit rate is
    # lower after organic rolls, POT reveal, and hard-cap competition.
    total = _clamp(base * mult + 0.012, 0.004, 0.220)
    star_share = 0.10
    if age <= 22 and 70 <= overall <= 77 and 76 <= potential <= 85:
        star_share += 0.050
    if age <= 21 and 68 <= overall <= 74 and 76 <= potential <= 80:
        star_share += 0.040
    star_share += max(0.0, traits["starUpside"] - 0.58) * 0.12
    star_share += max(0.0, traits["workEthic"] - 0.60) * 0.08
    if origin in {"early_second", "late_second", "undrafted"}:
        star_share += 0.025
    if class_type in {"deep", "boom_bust", "deep_no_superstars"}:
        star_share += 0.020
    star_share = _clamp(star_share, 0.055, 0.24)

    elite_share = 0.010
    if age <= 21 and overall <= 74 and traits["starUpside"] >= 0.64 and traits["workEthic"] >= 0.58:
        elite_share += 0.014
    if age <= 22 and 68 <= overall <= 74 and 76 <= potential <= 80 and traits["workEthic"] >= 0.60:
        elite_share += 0.006
    if class_type == "boom_bust":
        elite_share += 0.007
    elite_share = _clamp(elite_share, 0.002, 0.040)

    roll = _v25_unit(league_seed, seed_key, "hidden_upside_overlay")
    if roll >= total:
        return "none"
    # Within hidden-upside hits, choose level. Keep true 90+ low-POT outliers rare.
    inner = roll / max(total, 1e-9)
    if inner < elite_share:
        return "elite_gem"
    if inner < elite_share + star_share:
        return "star_gem"
    starter_share = 0.36 + max(0.0, traits["workEthic"] - 0.50) * 0.20 + max(0.0, grade - 52.0) * 0.006
    starter_share = _clamp(starter_share, 0.28, 0.56)
    if inner < elite_share + star_share + starter_share:
        return "starter_gem"
    return "rotation_gem"


def _v25_hidden_upside_level_from_profile(prof: Dict[str, Any]) -> int:
    if not isinstance(prof, dict):
        return 0
    return int(_V25_HIDDEN_UPSIDE_LEVELS.get(str(prof.get("hiddenUpside") or "none"), 0))


def _v25_hidden_upside_level(p: Dict[str, Any], rng: Optional[random.Random] = None) -> int:
    return _v25_hidden_upside_level_from_profile(_v25_profile(p, rng))


def _v25_hidden_upside_name(p: Dict[str, Any], rng: Optional[random.Random] = None) -> str:
    prof = _v25_profile(p, rng)
    return str(prof.get("hiddenUpside") or "none") if isinstance(prof, dict) else "none"


def _v25_outlier_fit(p: Dict[str, Any], age: int, overall: int, potential: int, origin: str) -> Tuple[float, float]:
    traits = _v25_traits(p)
    attrs = _ensure_attrs(p.get("attrs"))
    height = _safe_int(p.get("height"), 78)
    # Attribute labels vary across the project; use broad, low-risk signals only.
    athletic_tools = max(attrs[6], attrs[7], attrs[13], attrs[14]) / 99.0
    defensive_tools = max(attrs[8], attrs[9], attrs[10], attrs[11]) / 99.0
    feel_tools = max(attrs[5], attrs[4], attrs[12]) / 99.0
    raw_fit = 0.0
    skill_fit = 0.0
    if age <= 21 and overall <= 78:
        raw_fit = 0.55 * traits["starUpside"] + 0.25 * traits["boomBust"] + 0.20 * traits["workEthic"]
        raw_fit += 0.22 * max(athletic_tools, defensive_tools)
        if height >= 80:
            raw_fit += 0.05
    if age <= 23 and overall <= 76 and origin in {"early_second", "late_second", "undrafted", "late_first"}:
        skill_fit = 0.46 * traits["workEthic"] + 0.34 * feel_tools + 0.12 * traits["starUpside"] + 0.08 * traits["boomBust"]
    return _clamp(raw_fit, 0.0, 1.0), _clamp(skill_fit, 0.0, 1.0)


def _v25_profile_weights(p: Dict[str, Any], age: int, overall: int, potential: int, grade: float, origin: str, class_type: str) -> List[Tuple[str, float]]:
    traits = _v25_traits(p)
    gap = max(0, potential - overall)
    class_mult = _v25_class_quality_mult(class_type)
    raw_fit, skill_fit = _v25_outlier_fit(p, age, overall, potential, origin)
    boom = traits["boomBust"]
    work = traits["workEthic"]
    star = traits["starUpside"]

    if age >= 30:
        # V25B: early-30s stars should not cliff by default. Keep decline
        # variance, but move some fast-decliner odds into long-prime/steady.
        base = [
            ("long_prime", 18 + max(0, overall - 82) * 1.0),
            ("steady_growth", 34),
            ("short_peak", 9 + max(0, overall - 86) * 0.45),
            ("fast_decliner", 11 + max(0, age - 33) * 2.7),
            ("volatile", 5),
        ]
        if overall >= 90:
            base.append(("star_hit", 10))
        return base

    if overall >= 90:
        return [
            ("generational_hit", 7 if potential >= 96 and age <= 27 else 2),
            ("star_hit", 33),
            ("long_prime", 14),
            ("short_peak", 10),
            ("steady_growth", 18),
            ("volatile", 8),
            ("fast_decliner", 3 if age >= 27 else 1),
            ("disappointment", 4),
        ]

    if potential >= 95 and age <= 23:
        # V25B: elite prospects should have real middle outcomes. True busts
        # exist, but most misses should become starters/rotation disappointments
        # instead of falling straight into the low 70s.
        return [
            ("generational_hit", 15 * class_mult),
            ("star_hit", 29 * class_mult),
            ("quality_starter", 24),
            ("steady_growth", 8),
            ("slow_burn", 13 + 3 * boom),
            ("late_bloomer", 7 + 2 * work),
            ("volatile", 7 + 4 * boom),
            ("disappointment", 12 + 4 * (1 - work)),
            ("true_bust", 1.0 + 1.0 * boom),
        ]
    if potential >= 90 and age <= 24:
        return [
            ("generational_hit", 3.5 * class_mult),
            ("star_hit", 18 * class_mult),
            ("quality_starter", 31),
            ("steady_growth", 8),
            ("slow_burn", 15 + 3 * boom),
            ("late_bloomer", 10 + 2 * work),
            ("volatile", 9 + 4 * boom),
            ("disappointment", 16 + 5 * (1 - work)),
            ("true_bust", 2.0 + 1.2 * boom),
            ("raw_tools_outlier", 3.0 * raw_fit),
        ]
    if potential >= 84 and age <= 25:
        gem_chance = _v25_hidden_gem_chance(p, age, overall, potential, grade, origin, class_type)
        return [
            ("star_hit", 4.5 * class_mult),
            ("quality_starter", 26),
            ("steady_growth", 23),
            ("slow_burn", 13 + 2 * boom),
            ("late_bloomer", 10 + 3 * work),
            ("volatile", 9 + 5 * boom),
            ("disappointment", 15),
            ("true_bust", 3 + 1.5 * boom),
            ("hidden_gem", 3 + gem_chance * 85),
            ("raw_tools_outlier", 2.3 * raw_fit),
            ("skill_feel_outlier", 1.8 * skill_fit),
        ]

    # Already-playable young rotation players with moderate POT (Jamal Shead /
    # Miles McBride type) should usually become backup/rotation pieces, not
    # roll as true busts as often as raw 19-year-olds.
    if overall >= 76 and potential >= 80 and age <= 26:
        return [
            ("star_hit", 1.0 * class_mult),
            ("quality_starter", 18 + max(0, grade - 72) * 0.25),
            ("steady_growth", 34 + max(0, potential - overall) * 0.7),
            ("late_bloomer", 10 + 2 * work),
            ("slow_burn", 4),
            ("volatile", 10 + 4 * boom),
            ("disappointment", 13 + 3 * (1 - work)),
            ("true_bust", 2.5 + 1.5 * max(0.0, boom - 0.5)),
            ("hidden_gem", 1.5 + _v25_hidden_gem_chance(p, age, overall, potential, grade, origin, class_type) * 45),
        ]

    # Moderate/low visible POT: mostly role/fringe, but young players can still
    # roll hidden-gem/outlier stories very rarely.
    gem_chance = _v25_hidden_gem_chance(p, age, overall, potential, grade, origin, class_type)
    return [
        ("quality_starter", 8 + max(0, grade - 58) * 0.32),
        ("steady_growth", 27 + max(0, potential - overall) * 0.9),
        ("slow_burn", 10 if age <= 23 else 4),
        ("late_bloomer", 10 if 21 <= age <= 26 else 4),
        ("volatile", 8 + 5 * boom),
        ("disappointment", 22),
        ("true_bust", 10 + max(0, 75 - potential) * 0.55),
        ("hidden_gem", 2 + gem_chance * 165),
        ("raw_tools_outlier", 2.1 * raw_fit),
        ("skill_feel_outlier", 2.0 * skill_fit),
    ]


def _v25_build_profile(p: Dict[str, Any], league_seed: str, season_year: Any, rng: Optional[random.Random] = None) -> Dict[str, Any]:
    age = _safe_int(p.get("age"), 25)
    overall = int(_clamp(_safe_int(p.get("overall"), 70), 25, 99))
    potential = int(_clamp(_safe_int(p.get("potential"), overall), overall, 99))
    meta = _v25_meta(p)
    origin = _v25_draft_origin(p)
    class_type = _v25_class_type(p)
    grade = _v25_prospect_grade(p, age, overall, potential)
    seed_key = str(p.get("id") or _player_name(p) or "unknown")
    profile = _v25_choice(
        _v25_profile_weights(p, age, overall, potential, grade, origin, class_type),
        league_seed, seed_key, age, overall, potential, origin, class_type, "profile"
    )

    # Rare hard overrides for Giannis/Jokic-style outliers. These use prospect
    # quality + traits, not actual draft slot magic.
    raw_fit, skill_fit = _v25_outlier_fit(p, age, overall, potential, origin)
    raw_roll = _v25_unit(league_seed, seed_key, "raw_tools_override")
    skill_roll = _v25_unit(league_seed, seed_key, "skill_feel_override")
    if age <= 22 and overall <= 78 and raw_fit >= 0.62:
        chance = 0.014 + 0.058 * raw_fit
        if class_type in {"generational", "star_heavy", "boom_bust"}:
            chance += 0.012
        if raw_roll < chance:
            profile = "raw_tools_outlier"
    if age <= 23 and overall <= 76 and origin in {"early_second", "late_second", "undrafted", "late_first", "mid_first"} and skill_fit >= 0.56:
        chance = 0.006 + 0.036 * skill_fit
        if class_type in {"deep", "boom_bust"}:
            chance += 0.006
        if skill_roll < chance:
            profile = "skill_feel_outlier"

    hidden_upside = _v25_hidden_upside_overlay(
        p, age, overall, potential, grade, origin, class_type, league_seed, seed_key
    )
    hidden_level = int(_V25_HIDDEN_UPSIDE_LEVELS.get(hidden_upside, 0))
    # Hidden upside should not be killed by a main-profile bust/disappointment
    # roll. It should express as a slow/volatile/late career arc instead.
    if hidden_level >= 3 and profile in {"true_bust", "disappointment", "fast_decliner"}:
        profile = "slow_burn" if age <= 22 else "late_bloomer"
    elif hidden_level >= 2 and profile == "true_bust":
        profile = "volatile"
    elif hidden_level >= 1 and profile == "true_bust" and age <= 22:
        profile = "steady_growth"

    u = lambda label: _v25_unit(league_seed, seed_key, label)
    if profile == "early_peak":
        peak_start = 22 + int(u("peak_start") * 3)
        peak_end = peak_start + 2 + int(u("peak_end") * 3)
        decline_start = peak_end + 1 + int(u("decline") * 3)
        decline_sharp = 0.70 + u("sharp") * 0.35
    elif profile == "late_bloomer":
        peak_start = 26 + int(u("peak_start") * 3)
        peak_end = peak_start + 3 + int(u("peak_end") * 3)
        decline_start = peak_end + 1 + int(u("decline") * 3)
        decline_sharp = 0.42 + u("sharp") * 0.24
    elif profile in {"slow_burn", "skill_feel_outlier"}:
        peak_start = 25 + int(u("peak_start") * 4)
        peak_end = peak_start + 3 + int(u("peak_end") * 4)
        decline_start = peak_end + 1 + int(u("decline") * 3)
        decline_sharp = 0.38 + u("sharp") * 0.25
    elif profile == "long_prime":
        peak_start = 26 + int(u("peak_start") * 3)
        peak_end = 32 + int(u("peak_end") * 4)
        decline_start = peak_end + 1 + int(u("decline") * 3)
        decline_sharp = 0.26 + u("sharp") * 0.20
    elif profile == "short_peak":
        peak_start = 23 + int(u("peak_start") * 4)
        peak_end = peak_start + 1 + int(u("peak_end") * 2)
        decline_start = peak_end + 1 + int(u("decline") * 2)
        decline_sharp = 0.78 + u("sharp") * 0.40
    elif profile == "fast_decliner":
        peak_start = max(24, age - 1)
        peak_end = max(peak_start, age + int(u("peak_end") * 2))
        decline_start = min(31, max(28, peak_end))
        decline_sharp = 0.88 + u("sharp") * 0.45
    else:
        peak_start = 24 + int(u("peak_start") * 4)
        peak_end = peak_start + 3 + int(u("peak_end") * 3)
        decline_start = peak_end + 1 + int(u("decline") * 3)
        decline_sharp = 0.48 + u("sharp") * 0.28

    if hidden_level > 0:
        # Hidden gems often reveal later: early years can look ordinary before
        # the real leap. Elite/Star overlays get a little earlier runway.
        reveal_age = 22 + int(u("hidden_reveal_age") * 4)
        if hidden_level >= 3:
            reveal_age = max(21, reveal_age - 1)
        if age <= 24:
            peak_start = max(peak_start, min(28, reveal_age))
            peak_end = max(peak_end, peak_start + 3 + int(u("hidden_peak_len") * 2))
            decline_start = max(decline_start, peak_end + 2)
            decline_sharp = min(decline_sharp, 0.58 + u("hidden_decline") * 0.20)

    base_ceiling = max(overall, potential)
    ceiling = base_ceiling
    if profile == "generational_hit":
        ceiling = max(96, base_ceiling + 2, overall + 8)
    elif profile == "star_hit":
        ceiling = max(90, base_ceiling + 1, overall + 5)
    elif profile == "quality_starter":
        ceiling = max(83, base_ceiling, overall + 4)
    elif profile == "steady_growth":
        ceiling = max(base_ceiling, overall + 2)
    elif profile in {"slow_burn", "late_bloomer"}:
        ceiling = max(base_ceiling + 1, overall + 5)
    elif profile == "hidden_gem":
        ceiling = max(base_ceiling + 5 + int(u("gem_ceiling") * 8), overall + 8)
        # A minority of hidden gems are true hidden-ceiling mismatches. This is
        # the missing V25B lane: normal visible POT, real starter/star upside.
        if age <= 24 and overall <= 76 and u("gem_star_ceiling") < 0.22:
            ceiling = max(ceiling, 87 + int(u("gem_star_height") * 8))
    elif profile == "raw_tools_outlier":
        ceiling = max(base_ceiling + 6 + int(u("raw_ceiling") * 5), 89 if potential < 88 else 92)
    elif profile == "skill_feel_outlier":
        ceiling = max(base_ceiling + 6 + int(u("skill_ceiling") * 6), 87 if potential < 86 else 91)
    elif profile == "volatile":
        ceiling = max(base_ceiling + int(u("vol_ceiling") * 4), overall + 3)
    elif profile == "disappointment":
        # Most elite misses should land in the middle: useful starter/rotation,
        # not automatic low-70s collapse.
        if potential >= 92 and age <= 24:
            ceiling = max(overall + 4, min(base_ceiling, overall + 9, 88))
        else:
            ceiling = max(overall + 1, min(base_ceiling, overall + 6, 88))
    elif profile == "true_bust":
        if potential >= 95 and age <= 23:
            ceiling = max(overall + 2, min(base_ceiling - 2, overall + 6, 84))
        elif potential >= 90 and age <= 24:
            ceiling = max(overall + 1, min(base_ceiling - 2, overall + 5, 83))
        else:
            ceiling = max(overall, min(base_ceiling - 3, overall + 3, 82))
    elif profile == "long_prime":
        ceiling = max(base_ceiling, overall + 2)
    elif profile == "short_peak":
        ceiling = max(base_ceiling, overall + 4)
    elif profile == "fast_decliner":
        ceiling = max(overall, min(base_ceiling, overall + 1))

    hidden_upside_ceiling = 0
    if hidden_upside == "rotation_gem":
        hidden_upside_ceiling = max(80 + int(u("hidden_rot_height") * 5), overall + 6)
    elif hidden_upside == "starter_gem":
        hidden_upside_ceiling = max(85 + int(u("hidden_starter_height") * 5), overall + 9)
    elif hidden_upside == "star_gem":
        hidden_upside_ceiling = max(89 + int(u("hidden_star_height") * 6), overall + 12)
    elif hidden_upside == "elite_gem":
        hidden_upside_ceiling = max(93 + int(u("hidden_elite_height") * 6), overall + 14)
    if hidden_upside_ceiling:
        ceiling = max(ceiling, hidden_upside_ceiling)

    # Weak classes mute future rookie ceilings, but never override already-good current players.
    if class_type == "weak" and age <= 23 and overall < 86:
        if hidden_level >= 3:
            ceiling = min(ceiling, max(base_ceiling + 5, 91))
        elif hidden_level >= 2:
            ceiling = min(ceiling, max(base_ceiling + 4, 88))
        else:
            ceiling = min(ceiling, max(base_ceiling + 3, 90 if profile in {"star_hit", "raw_tools_outlier", "skill_feel_outlier"} else 86))
    if class_type == "generational" and profile in {"generational_hit", "star_hit"}:
        ceiling = max(ceiling, 96 if profile == "generational_hit" else 92)

    if profile == "true_bust" and potential >= 92 and age <= 24:
        floor = max(25, overall - 3)
    elif profile == "disappointment" and potential >= 90 and age <= 24:
        floor = max(25, overall - 2)
    else:
        floor = max(25, overall - (7 if profile in {"true_bust", "fast_decliner"} else 5 if profile in {"disappointment", "volatile"} else 3))
    v25 = {
        "version": _V25_PROFILE_VERSION,
        "profile": profile,
        "hiddenCeiling": int(_clamp(ceiling, overall, 99)),
        "hiddenFloor": int(_clamp(floor, 25, overall)),
        "peakStartAge": int(_clamp(peak_start, 18, 38)),
        "peakEndAge": int(_clamp(max(peak_start, peak_end), 19, 40)),
        "declineStartAge": int(_clamp(max(peak_end + 1, decline_start), 23, 42)),
        "declineSharpness": round(float(_clamp(decline_sharp, 0.15, 1.45)), 3),
        "volatility": round(float(_clamp(0.55 + u("volatility") * 0.70 + (0.35 if profile == "volatile" else 0.0), 0.45, 1.70)), 3),
        "longevity": round(float(_clamp(1.15 - decline_sharp + u("longevity") * 0.35, 0.15, 1.25)), 3),
        "potTrust": round(float(_clamp(0.45 + (potential - overall) / 30.0 + u("pot_trust") * 0.20, 0.30, 0.95)), 3),
        "originalOvr": overall,
        "originalPot": potential,
        "originalAge": age,
        "prospectGrade": round(float(grade), 2),
        "draftOrigin": origin,
        "classQuality": class_type,
        "preDraftRank": _v25_pre_draft_rank(p),
        "hiddenUpside": hidden_upside,
        "hiddenUpsideLevel": hidden_level,
        "hiddenUpsideCeiling": int(_clamp(hidden_upside_ceiling or ceiling, overall, 99)),
        "hiddenRevealAge": int(_clamp(peak_start, 18, 34)),
    }
    meta["devProfileV25"] = v25
    p["devProfileV25"] = v25
    return v25


def _v25_profile(p: Dict[str, Any], rng: Optional[random.Random] = None) -> Dict[str, Any]:
    existing = None
    meta = _v25_meta(p)
    if isinstance(meta.get("devProfileV25"), dict):
        existing = meta.get("devProfileV25")
    elif isinstance(p.get("devProfileV25"), dict):
        existing = p.get("devProfileV25")
    if isinstance(existing, dict) and existing.get("version") == _V25_PROFILE_VERSION:
        if p.get("devProfileV25") is not existing:
            p["devProfileV25"] = existing
        return existing
    # Fallback for isolated calls: deterministic but not new-save varied unless the frontend seeded the league.
    return _v25_build_profile(p, str(p.get("__v25LeagueSeed") or "no_league_seed"), p.get("__v25SeasonYear"), rng)


def _ensure_v25_profiles_for_league(league: Dict[str, Any], fallback_seed: Any = None, season_year: Any = None) -> Dict[str, Any]:
    seed = _v25_league_seed(league, fallback_seed)
    counts: Dict[str, int] = {}
    class_counts: Dict[str, int] = {}
    hidden_gems = 0
    hidden_upside_counts = {"rotation_gem": 0, "starter_gem": 0, "star_gem": 0, "elite_gem": 0}
    outliers = 0
    busts = 0
    for p in _all_players(league):
        if not isinstance(p, dict):
            continue
        p["__v25LeagueSeed"] = seed
        p["__v25SeasonYear"] = season_year
        prof = _v25_profile(p)
        name = str(prof.get("profile") or "unknown")
        counts[name] = counts.get(name, 0) + 1
        cq = str(prof.get("classQuality") or "normal")
        class_counts[cq] = class_counts.get(cq, 0) + 1
        hidden_name = str(prof.get("hiddenUpside") or "none")
        if hidden_name in hidden_upside_counts:
            hidden_upside_counts[hidden_name] += 1
        if name == "hidden_gem" or hidden_name in _V25_HIDDEN_UPSIDE_SET:
            hidden_gems += 1
        if name in {"raw_tools_outlier", "skill_feel_outlier"}:
            outliers += 1
        if name == "true_bust":
            busts += 1
    audit = {
        "version": _V25_PROFILE_VERSION,
        "leagueSeed": seed,
        "seasonYear": season_year,
        "playerCount": len(_all_players(league)),
        "profileCounts": counts,
        "classQualityCounts": class_counts,
        "hiddenGemCount": hidden_gems,
        "hiddenUpsideCounts": hidden_upside_counts,
        "outlierCount": outliers,
        "trueBustCount": busts,
    }
    _v25_league_meta(league)[_V25_AUDIT_KEY] = audit
    league[_V25_AUDIT_KEY] = audit
    return audit


def _v25_profile_expected_adjustment(p: Dict[str, Any], age: int, overall: int, potential: int, rng: random.Random) -> float:
    prof = _v25_profile(p, rng)
    name = str(prof.get("profile") or "steady_growth")
    ceiling = _safe_int(prof.get("hiddenCeiling"), max(overall, potential))
    room = max(0, ceiling - overall)
    peak_start = _safe_int(prof.get("peakStartAge"), 25)
    peak_end = _safe_int(prof.get("peakEndAge"), 30)
    decline_start = _safe_int(prof.get("declineStartAge"), 32)
    sharp = _safe_float(prof.get("declineSharpness"), 0.5)
    adj = 0.0

    if name == "generational_hit":
        adj += 0.52 if room >= 4 else 0.15
    elif name == "star_hit":
        adj += 0.34 if room >= 3 else 0.08
    elif name == "quality_starter":
        adj += 0.16 if room >= 2 else 0.0
    elif name == "steady_growth":
        adj += 0.05 if room >= 2 and age <= 27 else 0.0
    elif name == "slow_burn":
        adj += -0.14 if age < peak_start - 2 else 0.32 if age <= peak_end and room >= 2 else 0.04
    elif name == "late_bloomer":
        adj += -0.08 if age < peak_start - 1 else 0.42 if age <= peak_end and room >= 2 else 0.02
    elif name == "early_peak":
        adj += 0.30 if age <= peak_end and room >= 2 else -0.18 if age >= decline_start else 0.0
    elif name == "short_peak":
        adj += 0.28 if peak_start <= age <= peak_end and room >= 2 else -0.28 if age >= decline_start else 0.0
    elif name == "volatile":
        adj += rng.choice([-0.34, -0.16, 0.16, 0.38])
    elif name == "disappointment":
        # Disappointment means underachieving, not instant collapse.
        adj -= 0.16 if potential >= 90 and age <= 24 else 0.26
        if age <= 23 and rng.random() < 0.14:
            adj += 0.30
    elif name == "true_bust":
        # True busts are rare. Elite young busts should mostly stall/slide, not
        # repeatedly nuke into the low 70s unless the cap layer later confirms it.
        adj -= 0.30 if potential >= 90 and age <= 24 else 0.50
        if age <= 22 and rng.random() < 0.08:
            adj += 0.55
    elif name == "hidden_gem":
        adj += 0.28 if age < peak_start else 0.78 if age <= peak_end and room >= 2 else 0.14
    elif name == "raw_tools_outlier":
        adj += 0.16 if age < 21 else 0.70 if age <= peak_end and room >= 3 else 0.10
    elif name == "skill_feel_outlier":
        adj += 0.10 if age < 22 else 0.60 if age <= peak_end and room >= 2 else 0.14
    elif name == "long_prime":
        adj += 0.08 if age <= peak_end else 0.18 if age >= decline_start else 0.0
    elif name == "fast_decliner":
        adj -= 0.40 if age >= decline_start - 1 else 0.0

    if ceiling >= 98 and 23 <= age <= 29 and overall >= 94 and name in {"generational_hit", "star_hit", "hidden_gem", "raw_tools_outlier", "skill_feel_outlier"}:
        adj += 0.12
    if ceiling >= 99 and 24 <= age <= 28 and overall >= 96 and name in {"generational_hit", "star_hit", "hidden_gem"}:
        adj += 0.16

    hidden_level = _v25_hidden_upside_level_from_profile(prof)
    if hidden_level > 0 and room > 0:
        reveal_age = _safe_int(prof.get("hiddenRevealAge"), peak_start)
        # Small setup boost before reveal, then a stronger but finite runway.
        if age < reveal_age - 1:
            adj += 0.08 + hidden_level * 0.055
        elif age <= peak_end:
            adj += 0.22 + hidden_level * 0.205
        else:
            adj += 0.05 + hidden_level * 0.05
        # Low visible POT should not be a prison once the hidden overlay exists.
        if potential <= 84 and age <= 26:
            adj += 0.11 + hidden_level * 0.075
        if hidden_level >= 3 and age <= 24 and overall <= 78 and room >= 10:
            adj += 0.18
        if hidden_level >= 4 and age <= 23 and overall <= 76 and room >= 12:
            adj += 0.22

    if age >= decline_start:
        decline_pressure = min(2.2, (age - decline_start + 1) * sharp * 0.36)
        if name == "long_prime":
            decline_pressure *= 0.35
        elif name in {"fast_decliner", "short_peak"}:
            decline_pressure *= 1.30
        # V25B: avoid too many age-31/32/33 cliff drops for elite stars unless
        # they explicitly rolled a fast/short decline path.
        if age <= 33 and overall >= 90 and name not in {"fast_decliner", "short_peak"}:
            decline_pressure *= 0.52
        elif age <= 33 and overall >= 86 and name not in {"fast_decliner", "short_peak"}:
            decline_pressure *= 0.72
        adj -= decline_pressure

    # No profile can force endless climbing after ceiling is reached.
    if room <= 0 and adj > 0:
        adj *= 0.18
    return float(adj)


def _v25_sigma_mult(p: Dict[str, Any], age: int, overall: int, potential: int, rng: random.Random) -> float:
    prof = _v25_profile(p, rng)
    name = str(prof.get("profile") or "steady_growth")
    mult = _safe_float(prof.get("volatility"), 1.0)
    if name in {"volatile", "raw_tools_outlier", "skill_feel_outlier", "hidden_gem"}:
        mult *= 1.12
    if name in {"steady_growth", "long_prime"}:
        mult *= 0.88
    if name in {"true_bust", "disappointment"} and age <= 23:
        mult *= 1.05
    hidden_level = _v25_hidden_upside_level_from_profile(prof)
    if hidden_level > 0 and age <= 26:
        mult *= 1.0 + hidden_level * 0.06
    return float(_clamp(mult, 0.55, 1.95))


def _v25_random_event_adjustment(p: Dict[str, Any], age: int, overall: int, potential: int, rng: random.Random) -> float:
    prof = _v25_profile(p, rng)
    name = str(prof.get("profile") or "steady_growth")
    traits = _v25_traits(p)
    chance = 0.018 + max(0, potential - overall) * 0.0015
    if age <= 23:
        chance += 0.010
    if name in {"volatile", "hidden_gem", "raw_tools_outlier", "skill_feel_outlier"}:
        chance += 0.026
    hidden_level = _v25_hidden_upside_level_from_profile(prof)
    if hidden_level > 0 and age <= 26:
        chance += 0.010 + hidden_level * 0.006
    if traits["boomBust"] >= 0.65:
        chance += 0.012
    chance = _clamp(chance, 0.006, 0.075)
    roll = rng.random()
    if roll < chance * 0.45:
        hidden_level = _v25_hidden_upside_level_from_profile(prof)
        if hidden_level >= 4 and age <= 23 and overall <= 78 and _safe_int(prof.get("hiddenCeiling"), potential) >= 90:
            return rng.choice([1.35, 1.75, 2.25, 2.65])
        if hidden_level >= 3 and age <= 24 and overall <= 80 and _safe_int(prof.get("hiddenCeiling"), potential) >= 88:
            return rng.choice([1.05, 1.45, 1.85, 2.20])
        return rng.choice([0.70, 1.05, 1.45])
    if roll > 1.0 - chance * 0.55:
        if potential >= 90 and age <= 24 and name not in {"true_bust", "volatile"}:
            return -rng.choice([0.30, 0.55, 0.80])
        return -rng.choice([0.55, 0.90, 1.20])
    return 0.0


def _v25_bound_delta(p: Dict[str, Any], age: int, overall: int, potential: int, delta: int, rng: random.Random) -> int:
    prof = _v25_profile(p, rng)
    name = str(prof.get("profile") or "steady_growth")
    ceiling = _safe_int(prof.get("hiddenCeiling"), max(overall, potential))
    if age < 30:
        lo = -3
    elif age <= 33:
        lo = -4
    else:
        lo = -5
    if name in {"true_bust", "fast_decliner"}:
        lo -= 1 if age >= 24 else 0
    if potential >= 92 and age <= 24 and name in {"true_bust", "disappointment"}:
        lo = max(lo, -2)
    elif potential >= 90 and age <= 24:
        lo = max(lo, -3)
    gap = max(0, potential - overall)
    room = max(0, ceiling - overall)
    hidden_level = _v25_hidden_upside_level_from_profile(prof)
    if age <= 23 and hidden_level >= 4 and overall <= 76 and room >= 12:
        hi = 5 if rng.random() < 0.58 else 4
    elif age <= 24 and hidden_level >= 3 and overall <= 78 and room >= 10:
        hi = 5 if rng.random() < 0.25 else 4
    elif age <= 22 and name in {"generational_hit", "raw_tools_outlier"} and room >= 8:
        hi = 4
    elif age <= 26 and (name in {"hidden_gem", "raw_tools_outlier", "skill_feel_outlier"} or hidden_level >= 2) and room >= 6:
        hi = 4 if rng.random() < (0.58 if hidden_level >= 3 else 0.42) else 3
    elif age <= 24 and (name in {"star_hit", "hidden_gem", "skill_feel_outlier", "slow_burn", "late_bloomer"} or hidden_level >= 1) and room >= 5:
        hi = 4 if ((name in {"hidden_gem", "raw_tools_outlier", "skill_feel_outlier"} or hidden_level >= 3) and rng.random() < 0.34) else 3
    elif age <= 24:
        hi = 3
    elif age <= 29:
        hi = 2
    else:
        hi = 1
    if overall >= 95:
        hi = min(hi, 2)
    elif overall >= 90:
        hi = min(hi, 3)
    if room <= 0:
        hi = min(hi, 0)
    elif room == 1:
        hi = min(hi, 1)
    if name in {"disappointment", "true_bust"}:
        if potential >= 92 and age <= 24:
            hi = min(hi, 2 if name == "disappointment" else 1)
        else:
            hi = min(hi, 1 if age <= 23 else 0)
    return int(_clamp(delta, lo, hi))


def _v25_cap_trim_protection_score(item: Dict[str, Any], rng: Optional[random.Random] = None) -> int:
    p = item.get("player") or {}
    before = int(item.get("before_overall", _safe_int(p.get("overall"), 70)))
    after = int(item.get("target_overall", before))
    age = _safe_int(p.get("age"), 25)
    pot = _safe_int(p.get("potential"), before)
    prof = _v25_profile(p, rng)
    name = str(prof.get("profile") or "steady_growth")
    ceiling = _safe_int(prof.get("hiddenCeiling"), max(before, pot))
    peak_start = _safe_int(prof.get("peakStartAge"), 25)
    peak_end = _safe_int(prof.get("peakEndAge"), 30)
    score = 0
    hidden_level = _v25_hidden_upside_level_from_profile(prof)
    if name in _V25_PROTECTED_PROFILES:
        score += 3
    if name in {"hidden_gem", "raw_tools_outlier", "skill_feel_outlier"}:
        score += 2
    if hidden_level > 0:
        score += 2 + hidden_level
        if age <= 26 and after <= 86 and ceiling >= after + 2:
            score += 3
        if age <= 24 and before <= 78 and hidden_level >= 3 and ceiling >= 88:
            score += 3
        if age <= 23 and before <= 76 and hidden_level >= 4 and ceiling >= 92:
            score += 4
    if age <= 24 and ceiling >= after + 3:
        score += 2
    if peak_start - 1 <= age <= peak_end and ceiling >= after + 2:
        score += 2
    if after - before >= 2:
        score += 1
    if pot >= after + 4:
        score += 1
    if name in {"true_bust", "disappointment", "fast_decliner"}:
        score -= 1 if hidden_level > 0 else 3
    decline_start = _safe_int(prof.get("declineStartAge"), 32)
    if 30 <= age <= 34 and before >= 92 and name not in {"fast_decliner", "short_peak", "true_bust"}:
        score += 3
    if 30 <= age <= 34 and before >= 95 and name in {"long_prime", "star_hit", "generational_hit"}:
        score += 2
    if age >= decline_start:
        score -= 2
    return int(score)


def _v25_boost_priority_score(item: Dict[str, Any], threshold: int, rng: Optional[random.Random] = None) -> int:
    p = item.get("player") or {}
    after = int(item.get("target_overall", item.get("before_overall", 70)))
    prof = _v25_profile(p, rng)
    name = str(prof.get("profile") or "steady_growth")
    ceiling = _safe_int(prof.get("hiddenCeiling"), _safe_int(p.get("potential"), after))
    age = _safe_int(p.get("age"), 25)
    score = 0
    hidden_level = _v25_hidden_upside_level_from_profile(prof)
    if ceiling >= threshold:
        score += 3
    if hidden_level > 0 and age <= 26 and ceiling >= threshold:
        score += 2 + hidden_level
    if name in _V25_BREAKOUT_PROFILES:
        score += 2
    if name in {"generational_hit", "star_hit"}:
        score += 2
    if threshold >= 95 and ceiling >= 98 and 23 <= age <= 29 and name in {"generational_hit", "star_hit", "hidden_gem", "raw_tools_outlier", "skill_feel_outlier"}:
        score += 3
    if threshold >= 98 and ceiling >= 99 and 24 <= age <= 29:
        score += 4
    if name in {"true_bust", "disappointment", "fast_decliner"}:
        score -= 1 if hidden_level > 0 else 3
    if age <= 24:
        score += 1
    return int(score)


def _v25_reconcile_potential_candidate(p: Dict[str, Any], candidate: int, old_potential: int, new_overall: int, ovr_delta: int, new_age: int, rng: random.Random) -> int:
    prof = _v25_profile(p, rng)
    name = str(prof.get("profile") or "steady_growth")
    hidden_ceiling = _safe_int(prof.get("hiddenCeiling"), max(old_potential, new_overall))
    candidate = int(candidate)
    if new_age >= 29:
        return new_overall

    if name in {"generational_hit", "star_hit"} and old_potential >= 90:
        # One bad year should not instantly reveal a failed star path.
        candidate = max(candidate, old_potential - (1 if new_age <= 24 else 2))
    hidden_level = _v25_hidden_upside_level_from_profile(prof)
    if name in {"hidden_gem", "raw_tools_outlier", "skill_feel_outlier", "late_bloomer", "slow_burn"} or hidden_level > 0:
        if ovr_delta >= 2:
            runway = 4 if new_age <= 25 else 3
            if hidden_level >= 3:
                runway += 1
            candidate = max(candidate, min(99, new_overall + runway, hidden_ceiling))
        elif ovr_delta >= 1:
            runway = 2 + (1 if hidden_level >= 2 and new_age <= 25 else 0)
            candidate = max(candidate, min(99, new_overall + runway, hidden_ceiling))
        elif hidden_level > 0 and new_age <= 24 and new_overall + 3 < hidden_ceiling:
            # Slow reveal even before the first big OVR spike; avoids visible POT
            # acting as a hard prison for real hidden-gem overlays.
            reveal_step = 2 if hidden_level >= 3 and new_age <= 23 else 1
            candidate = max(candidate, min(hidden_ceiling, old_potential + reveal_step, new_overall + 3 + max(0, hidden_level - 1)))
        # Keep a little unrevealed runway for true hidden stories.
        if new_overall + 2 < hidden_ceiling and new_age <= 26:
            candidate = max(candidate, min(hidden_ceiling, new_overall + 2 + max(0, hidden_level - 1)))
    if name in {"disappointment", "true_bust"}:
        if old_potential >= 92 and new_age <= 24:
            # Slow reveal: repeated non-growth lowers POT, but not all the way
            # from 95+ to the 70s in one or two offseasons.
            drop = 1 if name == "disappointment" else 2
            candidate = max(candidate, old_potential - drop)
            candidate = min(candidate, max(new_overall + (2 if name == "disappointment" else 1), old_potential - (drop - 1))) if ovr_delta <= -2 else candidate
        else:
            if ovr_delta <= 0:
                candidate = min(candidate, max(new_overall, old_potential - (2 if name == "true_bust" else 1)))
            if name == "true_bust" and new_age >= 23:
                candidate = min(candidate, max(new_overall, hidden_ceiling))
    return int(_clamp(candidate, new_overall, 99))


# -------------------------
# V24 organic player-level progression
# -------------------------

def _v24_age_expectation(age: int, overall: int) -> float:
    """Organic age curve used before any league-shape bend.

    Age guides probability, it does not dictate the result. The random roll below
    can still send a young prospect down or an older player up in any one season.
    """
    age = _safe_int(age, 25)
    if age <= 18:
        base = 1.28
    elif age == 19:
        base = 1.12
    elif age == 20:
        base = 0.98
    elif age == 21:
        base = 0.82
    elif age == 22:
        base = 0.64
    elif age == 23:
        base = 0.46
    elif age == 24:
        base = 0.30
    elif age == 25:
        base = 0.16
    elif age == 26:
        base = 0.06
    elif age == 27:
        base = 0.00
    elif age == 28:
        base = -0.08
    elif age == 29:
        base = -0.18
    elif age == 30:
        base = -0.32
    elif age == 31:
        base = -0.50
    elif age == 32:
        base = -0.72
    elif age == 33:
        base = -0.96
    elif age == 34:
        base = -1.25
    elif age == 35:
        base = -1.60
    elif age == 36:
        base = -1.98
    elif age == 37:
        base = -2.35
    elif age == 38:
        base = -2.70
    elif age == 39:
        base = -3.02
    else:
        base = -3.28

    # High ratings are harder to improve organically; low ratings are not doomed.
    if overall >= 97:
        base -= 0.42
    elif overall >= 95:
        base -= 0.28
    elif overall >= 92:
        base -= 0.16
    elif overall >= 90:
        base -= 0.08
    elif overall < 68 and age <= 27:
        base += 0.08
    return base


def _v24_potential_expectation(age: int, overall: int, potential: int) -> float:
    gap = max(-8, _safe_int(potential, overall) - _safe_int(overall, 70))
    age = _safe_int(age, 25)
    if gap <= -2:
        return -0.16
    if gap <= 0:
        return -0.06 if age <= 28 else 0.0
    # POT is a probability shifter, not a promise. High gaps matter more while
    # the player is still young; by late prime it mostly preserves variance.
    if age <= 21:
        return _clamp(0.075 * gap, 0.0, 0.95)
    if age <= 24:
        return _clamp(0.060 * gap, 0.0, 0.72)
    if age <= 27:
        return _clamp(0.042 * gap, 0.0, 0.46)
    if age <= 29:
        return _clamp(0.025 * gap, 0.0, 0.24)
    return _clamp(0.010 * gap, 0.0, 0.10)


def _v24_rating_tier_expectation(age: int, overall: int, potential: int) -> float:
    # Natural resistance before league caps. This keeps the organic roll from
    # constantly creating top-end inflation, while still letting rare stars pop.
    gap = max(0, potential - overall)
    if overall >= 97:
        return -0.52 if gap < 2 else -0.32
    if overall >= 95:
        return -0.34 if gap < 4 else -0.18
    if overall >= 92:
        return -0.18 if gap < 5 else -0.04
    if overall >= 90:
        return -0.08 if gap < 4 else 0.02
    if 70 <= overall <= 73 and age <= 27:
        return 0.06
    if 60 <= overall <= 69 and age <= 27:
        return 0.05
    return 0.0


def _v24_random_event_adjustment(age: int, overall: int, potential: int, rng: random.Random) -> float:
    gap = max(0, potential - overall)
    roll = rng.random()
    # Rare boom/bust layer. Anything can happen, but it is actually rare.
    boom_chance = 0.010
    bust_chance = 0.010
    if age <= 24 and gap >= 8:
        boom_chance += 0.018
    if age <= 27 and gap >= 5:
        boom_chance += 0.008
    if overall >= 90:
        boom_chance *= 0.55
        bust_chance += 0.006
    if age >= 33:
        bust_chance += 0.018
        boom_chance *= 0.55

    if roll < boom_chance:
        return rng.choice([0.75, 1.15, 1.65])
    if roll > 1.0 - bust_chance:
        return -rng.choice([0.75, 1.15, 1.65])
    # Smaller yearly noise events.
    if rng.random() < 0.055:
        return rng.choice([-0.55, 0.55])
    return 0.0


def _v24_organic_sigma(p: Dict[str, Any], age: int, overall: int, potential: int, rng: random.Random) -> float:
    # Wider than V23's table-based low/mid logic so repeated sims diverge.
    if age <= 22:
        sigma = 1.05
    elif age <= 25:
        sigma = 1.00
    elif age <= 29:
        sigma = 0.94
    elif age <= 33:
        sigma = 1.02
    else:
        sigma = 1.15
    if overall >= 95:
        sigma *= 0.72
    elif overall >= 90:
        sigma *= 0.84
    elif overall < 74:
        sigma *= 1.08
    return sigma * _career_timing_sigma_mult(p, age, overall, potential, rng)


def _v24_bound_delta(age: int, overall: int, potential: int, delta: int) -> int:
    if age < 30:
        lo = -3
    elif age <= 33:
        lo = -4
    else:
        lo = -5
    gap = max(0, potential - overall)
    if age <= 23 and potential >= 92 and gap >= 8:
        hi = 4
    elif age <= 24:
        hi = 3
    elif age <= 30:
        hi = 2
    else:
        hi = 1
    if overall >= 95:
        hi = min(hi, 2)
    elif overall >= 90:
        hi = min(hi, 3)
    return int(_clamp(delta, lo, hi))


def _target_delta_for_player(
    p: Dict[str, Any],
    stats: Optional[Dict[str, Any]],
    settings: Dict[str, Any],
    rng: random.Random,
    team_name: str = ""
) -> int:
    """V25 hidden-career player-first progression.

    This remains organic and player-first: age/OVR/POT provide the expectation,
    but the saved V25 hidden profile changes the career story. Current-season
    stats/minutes are still intentionally ignored.
    """
    age = _safe_int(p.get("age"), 25)
    overall = int(_clamp(_safe_int(p.get("overall"), 70), 25, 99))
    potential = int(_clamp(_safe_int(p.get("potential"), overall), overall, 99))

    expected = 0.0
    expected += _v24_age_expectation(age, overall)
    expected += _v24_potential_expectation(age, overall, potential)
    expected += _v24_rating_tier_expectation(age, overall, potential)
    expected += _v25_profile_expected_adjustment(p, age, overall, potential, rng)
    expected += _v25_random_event_adjustment(p, age, overall, potential, rng)

    sigma = _v24_organic_sigma(p, age, overall, potential, rng) * _v25_sigma_mult(p, age, overall, potential, rng)
    raw = expected + rng.gauss(0.0, sigma)
    delta = _stoch_round(raw, rng)

    prof = _v25_profile(p, rng)
    name = str(prof.get("profile") or "steady_growth")
    surprise = 0.025
    if name in {"volatile", "hidden_gem", "raw_tools_outlier", "skill_feel_outlier"}:
        surprise += 0.025
    if rng.random() < surprise:
        delta += rng.choice([-1, 1])

    return _v25_bound_delta(p, age, overall, potential, delta, rng)

def _apply_threshold_crossing_gates(
    p: Dict[str, Any],
    team_name: str,
    before: int,
    target: int,
    stats: Optional[Dict[str, Any]],
    settings: Dict[str, Any],
    rng: random.Random,
) -> int:
    """V24 light individual plausibility gates.

    These gates no longer decide the whole low/mid ecosystem. They only stop the
    most unrealistic one-season band jumps before the final league cap pass.
    """
    age = _safe_int(p.get("age"), 25)
    potential = _safe_int(p.get("potential"), before)
    gap = max(0, potential - before)
    prof = _v25_profile(p, rng)
    hidden_level = _v25_hidden_upside_level_from_profile(prof)
    hidden_gate_bonus = 0.0
    if hidden_level > 0 and age <= 26:
        hidden_gate_bonus = 0.14 + hidden_level * 0.105
        if hidden_level >= 3 and before <= 78:
            hidden_gate_bonus += 0.08
    if target <= before:
        return int(_clamp(target, 60, 99))

    # Extremely low players can rise, but only premium outliers should fly all
    # the way into playable depth in one season.
    if before < 68 and target >= 73:
        chance = 0.06 + min(0.20, gap * 0.012) + (0.04 if age <= 22 else 0.0) + hidden_gate_bonus
        if rng.random() > chance:
            target = min(target, 72)
    if before < 70 and target >= 75:
        chance = 0.04 + min(0.18, gap * 0.010) + (0.04 if age <= 22 else 0.0) + hidden_gate_bonus
        if rng.random() > chance:
            target = min(target, 74)

    # Low 70s should have a real chance to enter 74+, but 77+ remains uncommon.
    if 70 <= before <= 73 and target >= 77:
        chance = 0.08 + min(0.18, gap * 0.012) + (0.05 if age <= 23 else 0.0) + hidden_gate_bonus
        if rng.random() > chance:
            target = min(target, 76)

    # Role-player leaps into the 80s are possible, just not routine.
    if 74 <= before <= 76 and target >= 80:
        chance = 0.09 + min(0.18, gap * 0.012) + (0.05 if age <= 24 else 0.0) + hidden_gate_bonus
        if rng.random() > chance:
            target = min(target, 79)
    if 77 <= before <= 80 and target >= 83:
        chance = 0.12 + min(0.18, gap * 0.014) + (0.05 if age <= 24 else 0.0) + hidden_gate_bonus
        if rng.random() > chance:
            target = min(target, 82)

    return int(_clamp(target, 60, 99))


def _predict_dynamic_potential_after_progression(
    old_age: int,
    new_age: int,
    old_overall: int,
    new_overall: int,
    old_potential: int,
    settings: Dict[str, Any],
    rng: random.Random,
    player: Optional[Dict[str, Any]] = None,
    team_name: str = "",
    stats: Optional[Dict[str, Any]] = None,
) -> int:
    """V24 potential update based on age/OVR/career movement.

    POT follows the supplied 2027 age-to-OVR relationship as a strong guideline,
    but it reacts to the player's actual multi-season career direction. Breakouts
    can reopen a ceiling; repeated stalls/declines slowly close it.
    """
    old_age = _safe_int(old_age, 25)
    new_age = _safe_int(new_age, old_age + 1)
    old_overall = int(_clamp(_safe_int(old_overall, 70), 25, 99))
    new_overall = int(_clamp(_safe_int(new_overall, old_overall), 25, 99))
    old_potential = int(_clamp(_safe_int(old_potential, max(old_overall, new_overall)), old_overall, 99))

    if new_age >= 29:
        return new_overall

    anchor = predict_potential_from_age_and_overall(new_age, new_overall)
    ovr_delta = new_overall - old_overall
    player = player or {}
    momentum = player.get("developmentMomentum") if isinstance(player.get("developmentMomentum"), dict) else {}
    stalled = _safe_int(momentum.get("stalledYears"), 0)
    decline = _safe_int(momentum.get("declineYears"), 0)
    hot = _safe_int(momentum.get("hotYears"), 0)

    # Start by blending old ceiling toward the age/OVR anchor.
    pull = 0.12 if new_age <= 22 else 0.18 if new_age <= 25 else 0.28
    raw = old_potential + (anchor - old_potential) * pull

    # The actual progression result is important evidence, but never the only
    # evidence. A one-year bad roll should not permanently crush a prospect.
    if ovr_delta >= 4:
        raw += 1.35
    elif ovr_delta == 3:
        raw += 0.95
    elif ovr_delta == 2:
        raw += 0.46
    elif ovr_delta == 1:
        raw += 0.12
    elif ovr_delta <= -3:
        raw -= 0.70
    elif ovr_delta == -2:
        raw -= 0.34
    elif ovr_delta == -1:
        raw -= 0.12

    raw += min(0.45, hot * 0.10)
    raw -= min(0.65, stalled * 0.10)
    raw -= min(0.80, decline * 0.14)
    raw += rng.gauss(0.0, 0.38 if new_age <= 23 else 0.30 if new_age <= 26 else 0.24)

    candidate = _stoch_round(raw, rng)

    # Ceiling cannot collapse too fast for young players, especially true high-upside guys.
    if new_age <= 21:
        max_drop = 1
    elif new_age <= 23:
        max_drop = 1 if old_potential >= 90 else 2
    elif new_age <= 25:
        max_drop = 2
    elif new_age <= 27:
        max_drop = 3
    else:
        max_drop = 4
    candidate = max(candidate, old_potential - max_drop)

    # Breakouts can create new upside even if the previous POT was stale/low.
    if ovr_delta >= 3 and new_age <= 25:
        candidate = max(candidate, new_overall + 2)
    elif ovr_delta >= 2 and new_age <= 27:
        candidate = max(candidate, new_overall + 1)

    # Strong age/OVR relationship from the source roster: older players tighten,
    # younger players keep room, and POT never displays below OVR.
    hard_cap = _dynamic_potential_hard_cap(new_age, new_overall)
    if old_potential >= 94 and new_age <= 23:
        hard_cap = max(hard_cap, old_potential)
    if ovr_delta >= 2:
        hard_cap = max(hard_cap, min(99, new_overall + (4 if new_age <= 24 else 3)))

    candidate = _v25_reconcile_potential_candidate(
        player or {},
        candidate,
        old_potential,
        new_overall,
        ovr_delta,
        new_age,
        rng,
    )

    return int(_clamp(candidate, new_overall, min(99, hard_cap)))

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
            formula_overall = calc_overall_from_attrs(p.get("attrs") or [], p.get("pos") or p.get("position") or "SF")
            current_overall = _safe_int(p.get("overall"), formula_overall)
            if p.get("overall") is None:
                p["overall"] = current_overall
        else:
            current_overall = _safe_int(p.get("overall"), 70)

        if _is_current_draft_shape_protected(p):
            # Current-draft rookies count toward every hard shelf, but they do
            # not receive progression, age-up, or potential recalculation before
            # playing their first NBA season. Other players move around them.
            plan.append({
                "player": p,
                "team": tname,
                "before_overall": current_overall,
                "target_delta": 0,
                "target_overall": current_overall,
                "shape_protected": True,
                "v25_profile": _v25_profile(p, rng),
            })
            continue

        stats = _stat_lookup(stats_by_key, p, tname)
        delta = _target_delta_for_player(p, stats, settings, rng, tname)

        target = int(_clamp(current_overall + delta, 60, 99))
        target = _apply_threshold_crossing_gates(
            p = p,
            team_name = tname,
            before = current_overall,
            target = target,
            stats = stats,
            settings = settings,
            rng = rng,
        )
        delta = target - current_overall

        plan.append({
            "player": p,
            "team": tname,
            "before_overall": current_overall,
            "target_delta": target - current_overall,
            "target_overall": target,
            "v25_profile": _v25_profile(p, rng),
        })

    return plan



# v20 fine-grained cumulative shelves. These match the current 2026-27 roster
# ecosystem and are rebuilt from the imported league, including free agents.
_PROGRESS_TIER_THRESHOLDS = (97, 96, 95, 94, 93, 92, 91, 90, 89, 88, 87, 86, 85, 84, 83, 82, 81, 80, 79, 78, 77, 75, 74)
# Cumulative governors protect the league ceiling and the playable middle.
_PROGRESS_FULL_CONTROL_TIERS = _PROGRESS_TIER_THRESHOLDS
_PROGRESS_DEPTH_TRIM_ONLY_TIERS = ()

# Band governors remain as coarse fallback governors, but v20 adds exact-rung
# smoothing below so the league does not collect too many players at 85/80/77.
_PROGRESS_BANDS = (
    ("97_99", 97, 99, "full"),
    ("95_96", 95, 96, "full"),
    ("92_94", 92, 94, "light"),
    ("90_91", 90, 91, "light"),
    ("88_89", 88, 89, "light"),
    ("85_87", 85, 87, "light"),
    ("83_84", 83, 84, "light"),
    ("81_82", 81, 82, "light"),
    ("77_80", 77, 80, "light"),
    ("74_76", 74, 76, "light"),
    ("71_73", 71, 73, "trim"),
    ("68_70", 68, 70, "trim"),
    ("64_67", 64, 67, "trim"),
    ("60_63", 60, 63, "trim"),
)
_PROGRESS_EXACT_RUNG_MIN = 74
_PROGRESS_EXACT_RUNG_MAX = 99
_PROGRESS_BASELINE_KEY = "progressionBaseline"

# Canonical shape derived from Raman's 2027 roster JSON, using rostered players
# plus free agents. These are not exact locks; corridors below still allow churn,
# but they stop later saves from preserving a bad/inflated interim baseline.
_CANONICAL_2027_SHELF_COUNTS = {
    97: 3, 96: 5, 95: 7, 94: 9, 93: 12, 92: 15, 91: 18, 90: 22,
    89: 27, 88: 33, 87: 40, 86: 48, 85: 57, 84: 67, 83: 79, 82: 93,
    81: 110, 80: 130, 79: 154, 78: 182, 77: 215, 75: 301, 74: 353,
}

_CANONICAL_2027_EXACT_COUNTS = {
    98: 1, 97: 2, 96: 2, 95: 2, 94: 2, 93: 3, 92: 3, 91: 3, 90: 4,
    89: 5, 88: 6, 87: 7, 86: 8, 85: 9, 84: 10, 83: 12, 82: 14,
    81: 17, 80: 20, 79: 24, 78: 28, 77: 33, 76: 39, 75: 47, 74: 52,
}


def _use_2027_shape_targets(settings: Dict[str, Any]) -> bool:
    cfg = settings.get("progression", {}) if isinstance(settings, dict) else {}
    return bool(cfg.get("use_2027_shape_targets", True))


def _apply_2027_shape_targets_to_baseline(baseline: Dict[str, Any], settings: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(baseline, dict) or not _use_2027_shape_targets(settings):
        return baseline
    baseline["targetSource"] = "2027_roster_plus_free_agents"
    baseline["counts"] = {str(k): int(v) for k, v in _CANONICAL_2027_SHELF_COUNTS.items()}
    # Preserve any exact counts outside the controlled rungs, but override 98-74.
    exact = baseline.get("exactCounts") if isinstance(baseline.get("exactCounts"), dict) else {}
    exact = dict(exact)
    for k, v in _CANONICAL_2027_EXACT_COUNTS.items():
        exact[str(k)] = int(v)
    baseline["exactCounts"] = exact
    return baseline



def _refresh_plan_targets(plan: List[Dict[str, Any]]) -> None:
    for item in plan:
        item["target_overall"] = int(_clamp(
            int(item["before_overall"]) + int(item["target_delta"]),
            60,
            99
        ))


def _yearly_delta_caps_for_item(item: Dict[str, Any]) -> Tuple[int, int]:
    p = item.get("player") or {}
    age = _safe_int(p.get("age"), 25)
    before = int(item.get("before_overall", _safe_int(p.get("overall"), 70)))
    potential = _safe_int(p.get("potential"), before)
    gap = max(0, potential - before)
    # User-facing realism guard: no normal one-year collapse bigger than -5.
    if age < 30:
        lo = -3
    elif age <= 33:
        lo = -4
    else:
        lo = -5
    # Legacy devPath never controls the yearly ceiling. V25D adds a rare +5
    # lane for genuine low-OVR hidden superstar overlays/outliers.
    prof = _v25_profile(p, None)
    hidden_level = _v25_hidden_upside_level_from_profile(prof)
    profile_name = str(prof.get("profile") or "steady_growth") if isinstance(prof, dict) else "steady_growth"
    hidden_ceiling = _safe_int(prof.get("hiddenCeiling") if isinstance(prof, dict) else None, max(potential, before))
    room = max(0, hidden_ceiling - before)
    if age <= 23 and before <= 76 and room >= 12 and (hidden_level >= 4 or profile_name in {"raw_tools_outlier", "skill_feel_outlier"}):
        hi = 5
    elif age <= 24 and before <= 78 and room >= 10 and hidden_level >= 3:
        hi = 4
    elif age <= 23 and potential >= 92 and gap >= 8:
        hi = 4
    elif age <= 24:
        hi = 3
    elif age <= 30:
        hi = 2
    else:
        hi = 1
    if before >= 95:
        hi = min(hi, 2)
    elif before >= 90:
        hi = min(hi, 3)
    return lo, hi


def _cap_plan_yearly_deltas(plan: List[Dict[str, Any]]) -> None:
    for item in plan:
        before = int(item.get("before_overall", 70))
        lo, hi = _yearly_delta_caps_for_item(item)
        target = int(item.get("target_overall", before))
        capped = int(_clamp(target, before + lo, before + hi))
        item["target_overall"] = int(_clamp(capped, 60, 99))
        item["target_delta"] = item["target_overall"] - before


def _tier_counts_from_values(values: List[int]) -> Dict[str, int]:
    return {str(t): sum(1 for v in values if int(v) >= t) for t in _PROGRESS_TIER_THRESHOLDS}


def _band_counts_from_values(values: List[int]) -> Dict[str, int]:
    out: Dict[str, int] = {}
    for label, lo, hi, _mode in _PROGRESS_BANDS:
        out[label] = sum(1 for v in values if lo <= int(v) <= hi)
    return out


def _exact_counts_from_values(values: List[int], lo: int = _PROGRESS_EXACT_RUNG_MIN, hi: int = _PROGRESS_EXACT_RUNG_MAX) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    for rung in range(int(lo), int(hi) + 1):
        counts[str(rung)] = sum(1 for v in values if int(v) == rung)
    return counts


def _exact_count_from_plan(plan: List[Dict[str, Any]], rung: int) -> int:
    return sum(1 for item in plan if int(item.get("target_overall", 0)) == int(rung))


def _band_count_from_plan(plan: List[Dict[str, Any]], lo: int, hi: int) -> int:
    return sum(1 for item in plan if lo <= int(item["target_overall"]) <= hi)



def _top_n_values(values: List[int], n: int = 300) -> List[int]:
    vals = sorted([int(v) for v in values], reverse=True)
    return vals[:min(n, len(vals))]


def _avg_value(values: List[int], fallback: float = 0.0) -> float:
    return sum(float(v) for v in values) / len(values) if values else fallback


def _median_value(values: List[int], fallback: float = 0.0) -> float:
    if not values:
        return fallback
    vals = sorted([int(v) for v in values])
    mid = len(vals) // 2
    if len(vals) % 2:
        return float(vals[mid])
    return (float(vals[mid - 1]) + float(vals[mid])) / 2.0


def _top_n_band_counts_from_values(values: List[int], n: int = 300) -> Dict[str, int]:
    return _band_counts_from_values(_top_n_values(values, n))


def _top_n_items_from_plan(plan: List[Dict[str, Any]], n: int = 300) -> List[Dict[str, Any]]:
    items = sorted(
        plan,
        key=lambda item: (int(item.get("target_overall", 0)), int(item.get("before_overall", 0))),
        reverse=True,
    )
    return items[:min(n, len(items))]


def _top_n_after_values_from_plan(plan: List[Dict[str, Any]], n: int = 300) -> List[int]:
    return [int(item["target_overall"]) for item in _top_n_items_from_plan(plan, n)]


def _core_items_from_plan(plan: List[Dict[str, Any]], n_per_team: int = 14, use_before: bool = False) -> List[Dict[str, Any]]:
    """Top N active roster players per team; free agents/two-way/stash do not define core shape."""
    groups: Dict[str, List[Dict[str, Any]]] = {}
    for item in plan:
        team = str(item.get("team") or "")
        if not team or team == "__FREE_AGENCY__":
            continue
        p = item.get("player") or {}
        # The plan only knows bucket indirectly. Active roster entries from
        # team.players are added before twoWay/stash in _all_players_with_team,
        # but bucket is not persisted here. We still use team top-14, which is
        # exactly the user's requested core-population approximation.
        groups.setdefault(team, []).append(item)
    out: List[Dict[str, Any]] = []
    value_key = "before_overall" if use_before else "target_overall"
    for _team, items in groups.items():
        items_sorted = sorted(
            items,
            key=lambda it: (int(it.get(value_key, 0)), int(it.get("before_overall", 0))),
            reverse=True,
        )
        out.extend(items_sorted[:min(n_per_team, len(items_sorted))])
    return out


def _core_values_from_plan(plan: List[Dict[str, Any]], use_before: bool = False) -> List[int]:
    key = "before_overall" if use_before else "target_overall"
    return [int(item.get(key, 0)) for item in _core_items_from_plan(plan, 14, use_before=use_before)]


def _core_cumulative_count_from_baseline(baseline: Dict[str, Any], threshold: int) -> int:
    counts = baseline.get("coreCounts") if isinstance(baseline.get("coreCounts"), dict) else {}
    if str(threshold) in counts:
        return _safe_int(counts.get(str(threshold)), 0)
    return 0



def _build_progression_baseline_from_plan(plan: List[Dict[str, Any]], settings: Dict[str, Any]) -> Dict[str, Any]:
    cfg = settings.get("progression", {}) or {}
    min_ovr = int(cfg.get("baseline_min_overall", 77))
    before_values = [int(item["before_overall"]) for item in plan]
    meaningful = [v for v in before_values if v >= min_ovr]

    if not meaningful:
        meaningful = before_values[:] if before_values else [77]

    counts = _tier_counts_from_values(before_values)
    band_counts = _band_counts_from_values(before_values)
    exact_counts = _exact_counts_from_values(before_values)
    top300 = _top_n_values(before_values, 300)
    top300_band_counts = _band_counts_from_values(top300)
    top300_exact_counts = _exact_counts_from_values(top300)
    core_values = _core_values_from_plan(plan, use_before=True)
    core_counts = _tier_counts_from_values(core_values)
    core_band_counts = _band_counts_from_values(core_values)
    core_exact_counts = _exact_counts_from_values(core_values)

    baseline = {
        "version": "v21_fine_shelf_exact_rung_baseline",
        "createdBy": PROGRESSION_PY_VERSION,
        "minOverall": min_ovr,
        "sampleSize": len(before_values),
        "sampleSize77Plus": len([v for v in before_values if v >= 77]),
        "avg77Plus": sum(float(v) for v in meaningful) / max(1, len(meaningful)),
        "counts": counts,
        "bandCounts": band_counts,
        "exactCounts": exact_counts,
        "top300SampleSize": len(top300),
        "top300Avg": _avg_value(top300, 0.0),
        "top300Median": _median_value(top300, 0.0),
        "top300Cutoff": int(top300[-1]) if top300 else 0,
        "top300BandCounts": top300_band_counts,
        "top300ExactCounts": top300_exact_counts,
        "coreSampleSize": len(core_values),
        "coreAvg": _avg_value(core_values, 0.0),
        "coreMedian": _median_value(core_values, 0.0),
        "coreCounts": core_counts,
        "coreBandCounts": core_band_counts,
        "coreExactCounts": core_exact_counts,
    }
    return _apply_2027_shape_targets_to_baseline(baseline, settings)


def _get_or_create_progression_baseline(
    league: Optional[Dict[str, Any]],
    plan: List[Dict[str, Any]],
    settings: Dict[str, Any]
) -> Dict[str, Any]:
    fallback = _build_progression_baseline_from_plan(plan, settings)

    if not isinstance(league, dict):
        return fallback

    existing = league.get(_PROGRESS_BASELINE_KEY)
    if isinstance(existing, dict):
        existing_created_by = str(existing.get("createdBy") or "")
        existing_model = str(existing.get("version") or "")
        # v14 intentionally refuses stale v6-v13 baselines because old baselines
        # can preserve the exact inflated shape we are trying to eliminate.
        if existing_created_by and existing_created_by != PROGRESSION_PY_VERSION:
            existing = None
        elif existing_model and existing_model != fallback.get("version"):
            existing = None

    if isinstance(existing, dict):
        if isinstance(existing.get("counts"), dict):
            # Fill in any missing keys for forward compatibility.
            counts = existing.get("counts") or {}
            for t, v in fallback["counts"].items():
                counts.setdefault(str(t), v)
            existing["counts"] = counts
            band_counts = existing.get("bandCounts") if isinstance(existing.get("bandCounts"), dict) else {}
            for k, v in (fallback.get("bandCounts") or {}).items():
                band_counts.setdefault(str(k), v)
            existing["bandCounts"] = band_counts
            exact_counts = existing.get("exactCounts") if isinstance(existing.get("exactCounts"), dict) else {}
            for k, v in (fallback.get("exactCounts") or {}).items():
                exact_counts.setdefault(str(k), v)
            existing["exactCounts"] = exact_counts
            existing.setdefault("minOverall", fallback["minOverall"])
            existing.setdefault("avg77Plus", fallback["avg77Plus"])
            existing.setdefault("sampleSize", fallback["sampleSize"])
            existing.setdefault("sampleSize77Plus", fallback["sampleSize77Plus"])
            existing.setdefault("top300SampleSize", fallback.get("top300SampleSize", 0))
            existing.setdefault("top300Avg", fallback.get("top300Avg", 0.0))
            existing.setdefault("top300Median", fallback.get("top300Median", 0.0))
            existing.setdefault("top300Cutoff", fallback.get("top300Cutoff", 0))
            top300_band_counts = existing.get("top300BandCounts") if isinstance(existing.get("top300BandCounts"), dict) else {}
            for k, v in (fallback.get("top300BandCounts") or {}).items():
                top300_band_counts.setdefault(str(k), v)
            existing["top300BandCounts"] = top300_band_counts
            top300_exact_counts = existing.get("top300ExactCounts") if isinstance(existing.get("top300ExactCounts"), dict) else {}
            for k, v in (fallback.get("top300ExactCounts") or {}).items():
                top300_exact_counts.setdefault(str(k), v)
            existing["top300ExactCounts"] = top300_exact_counts
            existing.setdefault("coreSampleSize", fallback.get("coreSampleSize", 0))
            existing.setdefault("coreAvg", fallback.get("coreAvg", 0.0))
            existing.setdefault("coreMedian", fallback.get("coreMedian", 0.0))
            core_counts = existing.get("coreCounts") if isinstance(existing.get("coreCounts"), dict) else {}
            for k, v in (fallback.get("coreCounts") or {}).items():
                core_counts.setdefault(str(k), v)
            existing["coreCounts"] = core_counts
            core_band_counts = existing.get("coreBandCounts") if isinstance(existing.get("coreBandCounts"), dict) else {}
            for k, v in (fallback.get("coreBandCounts") or {}).items():
                core_band_counts.setdefault(str(k), v)
            existing["coreBandCounts"] = core_band_counts
            core_exact_counts = existing.get("coreExactCounts") if isinstance(existing.get("coreExactCounts"), dict) else {}
            for k, v in (fallback.get("coreExactCounts") or {}).items():
                core_exact_counts.setdefault(str(k), v)
            existing["coreExactCounts"] = core_exact_counts
            return _apply_2027_shape_targets_to_baseline(existing, settings)

        # Accept older/flat baseline shapes if they ever existed.
        flat_counts: Dict[str, int] = {}
        for t in _PROGRESS_TIER_THRESHOLDS:
            for key in (f"count{t}", f"count{t}Plus"):
                if key in existing:
                    flat_counts[str(t)] = _safe_int(existing.get(key), fallback["counts"][str(t)])
                    break
        if flat_counts:
            for t, v in fallback["counts"].items():
                flat_counts.setdefault(str(t), v)
            existing["counts"] = flat_counts
            existing.setdefault("minOverall", fallback["minOverall"])
            existing.setdefault("avg77Plus", fallback["avg77Plus"])
            existing.setdefault("bandCounts", fallback.get("bandCounts", {}))
            existing.setdefault("exactCounts", fallback.get("exactCounts", {}))
            existing.setdefault("top300SampleSize", fallback.get("top300SampleSize", 0))
            existing.setdefault("top300Avg", fallback.get("top300Avg", 0.0))
            existing.setdefault("top300Median", fallback.get("top300Median", 0.0))
            existing.setdefault("top300Cutoff", fallback.get("top300Cutoff", 0))
            existing.setdefault("top300BandCounts", fallback.get("top300BandCounts", {}))
            existing.setdefault("top300ExactCounts", fallback.get("top300ExactCounts", {}))
            existing.setdefault("coreSampleSize", fallback.get("coreSampleSize", 0))
            existing.setdefault("coreAvg", fallback.get("coreAvg", 0.0))
            existing.setdefault("coreMedian", fallback.get("coreMedian", 0.0))
            existing.setdefault("coreCounts", fallback.get("coreCounts", {}))
            existing.setdefault("coreBandCounts", fallback.get("coreBandCounts", {}))
            existing.setdefault("coreExactCounts", fallback.get("coreExactCounts", {}))
            return _apply_2027_shape_targets_to_baseline(existing, settings)

    league[_PROGRESS_BASELINE_KEY] = fallback
    return fallback


def _tier_band(threshold: int, baseline_count: int) -> Tuple[int, int]:
    # v10 cumulative caps are tighter on the playable-depth tiers while still
    # allowing normal star churn. Band governors handle exact range shape.
    if threshold >= 97:
        return max(0, baseline_count - 1), baseline_count + 1
    if threshold >= 96:
        return max(0, baseline_count - 1), baseline_count + 1
    if threshold >= 95:
        return max(0, baseline_count - 1), baseline_count + 1
    if threshold >= 94:
        return max(0, baseline_count - 1), baseline_count + 1
    if threshold >= 93:
        return max(0, baseline_count - 2), baseline_count + 1
    if threshold >= 92:
        return max(0, baseline_count - 2), baseline_count + 2
    if threshold >= 90:
        return max(0, baseline_count - 3), baseline_count + 3
    if threshold >= 88:
        return max(0, baseline_count - 4), baseline_count + 2
    if threshold >= 85:
        return max(0, baseline_count - 6), baseline_count + 3
    if threshold >= 83:
        return max(0, baseline_count - 999), baseline_count + 1
    if threshold >= 81:
        return max(0, baseline_count - 999), baseline_count + 2
    if threshold >= 80:
        return max(0, baseline_count - 999), baseline_count + 2
    return max(0, baseline_count - 999), baseline_count + 3

def _meaningful_after_values(plan: List[Dict[str, Any]], min_ovr: int) -> List[int]:
    vals = []
    for item in plan:
        before = int(item["before_overall"])
        after = int(item["target_overall"])
        if before >= min_ovr or after >= min_ovr:
            vals.append(after)
    return vals


def _governor_boost_limit_for_tier(threshold: int) -> int:
    if threshold >= 92:
        return 1
    if threshold >= 90:
        return 2
    if threshold >= 85:
        return 1
    return 0


def _can_tier_boost(item: Dict[str, Any], threshold: int) -> bool:
    p = item["player"]
    age = _safe_int(p.get("age"), 25)
    before = int(item["before_overall"])
    after = int(item["target_overall"])
    pot = _safe_int(p.get("potential"), before)

    if after >= threshold:
        return False

    if threshold >= 97:
        return age <= 27 and before >= 94 and pot >= 97
    if threshold >= 96:
        return age <= 27 and before >= 93 and pot >= 96
    if threshold >= 95:
        return age <= 27 and before >= 91 and pot >= 95
    if threshold >= 94:
        return age <= 27 and before >= 90 and pot >= 94
    if threshold >= 93:
        return age <= 27 and before >= 89 and pot >= 93
    if threshold >= 92:
        return age <= 27 and before >= 88 and pot >= 92
    if threshold >= 90:
        return age <= 27 and before >= 84 and pot >= 90
    if threshold >= 88:
        return age <= 27 and before >= 83 and pot >= 89
    if threshold >= 85:
        return age <= 28 and before >= 80 and pot >= 86
    return False


def _apply_tier_shortage_boosts(
    plan: List[Dict[str, Any]],
    threshold: int,
    needed: int,
    rng: random.Random
) -> None:
    if needed <= 0:
        return

    max_extra = _governor_boost_limit_for_tier(threshold)
    candidates = [item for item in plan if _can_tier_boost(item, threshold)]
    candidates.sort(
        key = lambda item: (
            _safe_int(item["player"].get("potential"), int(item["before_overall"])) - int(item["before_overall"]),
            _safe_int(item["player"].get("potential"), int(item["before_overall"])),
            int(item["before_overall"]),
            -_safe_int(item["player"].get("age"), 25),
            rng.random(),
        ),
        reverse = True
    )

    promoted = 0
    for item in candidates:
        if promoted >= needed:
            break

        before = int(item["before_overall"])
        after = int(item["target_overall"])
        pot = _safe_int(item["player"].get("potential"), before)
        ceiling = min(99, pot)
        desired = min(threshold, after + max_extra, ceiling)

        if desired >= threshold and desired > after:
            item["target_delta"] = desired - before
            promoted += 1

    _refresh_plan_targets(plan)


def _apply_tier_excess_trims(
    plan: List[Dict[str, Any]],
    threshold: int,
    excess: int,
    rng: random.Random
) -> None:
    if excess <= 0:
        return

    crossers = [
        item for item in plan
        if int(item["before_overall"]) < threshold
        and int(item["target_overall"]) >= threshold
        and int(item["target_delta"]) > 0
    ]

    # Trim older/lower-upside crossers first. Existing elite players are not
    # artificially nerfed here; age regression handles that naturally.
    crossers.sort(
        key = lambda item: (
            _safe_int(item["player"].get("potential"), int(item["before_overall"])),
            -_safe_int(item["player"].get("age"), 25),
            int(item["before_overall"]),
            rng.random(),
        )
    )

    trimmed = 0
    for item in crossers[:excess]:
        before = int(item["before_overall"])
        item["target_delta"] = max(0, (threshold - 1) - before)
        trimmed += 1

    # For depth tiers only, if the band is already bloated and there are not
    # enough new crossers to trim, also stop some existing 81+/83+ players from
    # climbing further. This prevents the 80-84 middle class from compounding
    # upward every season without forcibly regressing them.
    remaining = excess - trimmed
    if remaining > 0 and threshold in _PROGRESS_DEPTH_TRIM_ONLY_TIERS:
        inside_positive = [
            item for item in plan
            if int(item["before_overall"]) >= threshold
            and int(item["target_delta"]) > 0
        ]
        inside_positive.sort(
            key = lambda item: (
                _safe_int(item["player"].get("potential"), int(item["before_overall"])),
                -_safe_int(item["player"].get("age"), 25),
                int(item["before_overall"]),
                rng.random(),
            )
        )
        for item in inside_positive[:remaining]:
            item["target_delta"] = max(0, int(item["target_delta"]) - 1)

    _refresh_plan_targets(plan)

def _band_high_limit(label: str, baseline_count: int) -> int:
    # Strict highs based on the Y1 band count. v10 is harsher on 88-89,
    # 83-84, 81-82, and 77-80 because those were still inflated in v9.
    if label == "97_99":
        return baseline_count + 1
    if label == "95_96":
        return baseline_count + 1
    if label == "92_94":
        return baseline_count + 1
    if label == "90_91":
        return baseline_count + 2
    if label == "88_89":
        return baseline_count + 1
    if label == "85_87":
        return baseline_count + 3
    if label == "83_84":
        return baseline_count + 0
    if label == "81_82":
        return baseline_count + 1
    if label == "77_80":
        return baseline_count + 1
    if label == "74_76":
        return baseline_count + 8
    if label == "71_73":
        return baseline_count + 8
    if label == "68_70":
        return baseline_count + 7
    if label == "64_67":
        return baseline_count + 6
    if label == "60_63":
        return baseline_count + 6
    return baseline_count + 4


def _band_low_limit(label: str, baseline_count: int) -> int:
    # Only top/star bands get meaningful shortage protection. Depth/lower bands
    # are trim-only so the governor never creates extra playable-depth inflation.
    if label == "97_99":
        return max(0, baseline_count - 1)
    if label == "95_96":
        return max(0, baseline_count - 1)
    if label == "92_94":
        return max(0, baseline_count - 2)
    if label == "90_91":
        return max(0, baseline_count - 2)
    return 0

def _band_trim_priority(item: Dict[str, Any], rng: random.Random) -> Tuple[Any, ...]:
    before = int(item["before_overall"])
    after = int(item["target_overall"])
    p = item["player"]
    age = _safe_int(p.get("age"), 25)
    pot = _safe_int(p.get("potential"), before)
    gap = max(0, pot - before)

    # Protect true premium prospects, not every young player with decent POT.
    if after >= 85:
        protected = 1 if (age <= 24 and (pot >= 92 or gap >= 9)) else 0
    elif after >= 77:
        protected = 1 if (age <= 23 and pot >= 94 and gap >= 12) else 0
    else:
        protected = 1 if (age <= 22 and pot >= 92 and gap >= 12) else 0

    return (protected, gap, pot, -age, -after, rng.random())

def _set_plan_target(item: Dict[str, Any], target: int) -> None:
    before = int(item["before_overall"])
    target = int(_clamp(target, 60, 99))
    item["target_delta"] = target - before
    item["target_overall"] = target


def _apply_band_excess_trims(
    plan: List[Dict[str, Any]],
    label: str,
    lo: int,
    hi: int,
    excess: int,
    rng: random.Random,
) -> None:
    if excess <= 0:
        return

    # Phase 1: stop new players from entering the crowded band.
    entrants = [
        item for item in plan
        if int(item["before_overall"]) < lo
        and lo <= int(item["target_overall"]) <= hi
        and int(item["target_delta"]) > 0
    ]
    entrants.sort(key=lambda item: _band_trim_priority(item, rng))

    trimmed = 0
    for item in entrants:
        if trimmed >= excess:
            break
        _set_plan_target(item, lo - 1)
        trimmed += 1

    _refresh_plan_targets(plan)
    remaining = max(0, excess - trimmed)

    # Phase 2: stop low-upside players already inside the band from improving.
    if remaining > 0:
        inside_positive = [
            item for item in plan
            if lo <= int(item["before_overall"]) <= hi
            and lo <= int(item["target_overall"]) <= hi
            and int(item["target_delta"]) > 0
        ]
        inside_positive.sort(key=lambda item: _band_trim_priority(item, rng))
        for item in inside_positive[:remaining]:
            _set_plan_target(item, int(item["before_overall"]))
            trimmed += 1

    _refresh_plan_targets(plan)

    # Phase 3: if the band is still overfilled, apply downward pressure to
    # low-upside players. Lower bands are also governed later, so overflow is
    # cascaded instead of becoming a fake 76/73/70 pileup.
    still_excess = excess - trimmed
    if still_excess <= 0:
        return

    pressure_candidates = [item for item in plan if lo <= int(item["target_overall"]) <= hi]
    pressure_candidates.sort(key=lambda item: _band_trim_priority(item, rng))

    for item in pressure_candidates:
        if still_excess <= 0:
            break

        before = int(item["before_overall"])
        after = int(item["target_overall"])
        p = item["player"]
        age = _safe_int(p.get("age"), 25)
        pot = _safe_int(p.get("potential"), before)
        gap = max(0, pot - before)

        # Protect legit young upside unless the player is already at/above POT.
        premium_prospect = age <= 23 and pot >= 94 and gap >= 12 and after < pot
        if premium_prospect:
            continue

        # High bands should not hard-crash players. Depth/lower bands can move
        # a little more because otherwise they stay bloated forever.
        if label in {"97_99", "95_96", "92_94", "90_91", "88_89", "85_87"}:
            desired = max(lo - 1, after - 1)
        elif label == "83_84":
            # Low-upside 83/84s must be allowed to leave the band.
            desired = max(79, after - 4)
        elif label == "81_82":
            desired = max(76, after - 4)
        elif label == "77_80":
            desired = max(73, after - 4)
        elif label == "74_76":
            desired = max(71, after - 2)
        elif label == "71_73":
            desired = max(68, after - 2)
        elif label == "68_70":
            desired = max(64, after - 2)
        elif label == "64_67":
            desired = max(60, after - 2)
        else:
            desired = max(60, after - 1)

        if desired < after:
            _set_plan_target(item, desired)
            still_excess -= 1

    _refresh_plan_targets(plan)

def _can_band_shortage_boost(item: Dict[str, Any], lo: int, hi: int, label: str) -> bool:
    p = item["player"]
    age = _safe_int(p.get("age"), 25)
    before = int(item["before_overall"])
    after = int(item["target_overall"])
    pot = _safe_int(p.get("potential"), before)
    if after >= lo:
        return False
    if label == "97_99":
        return age <= 27 and before >= 94 and pot >= 97
    if label == "95_96":
        return age <= 27 and before >= 92 and pot >= 95
    if label == "92_94":
        return age <= 27 and before >= 88 and pot >= 93
    if label == "90_91":
        return age <= 27 and before >= 86 and pot >= 91
    return False


def _apply_band_shortage_boosts(
    plan: List[Dict[str, Any]],
    label: str,
    lo: int,
    hi: int,
    needed: int,
    rng: random.Random,
) -> None:
    if needed <= 0:
        return
    candidates = [item for item in plan if _can_band_shortage_boost(item, lo, hi, label)]
    candidates.sort(
        key=lambda item: (
            _safe_int(item["player"].get("potential"), int(item["before_overall"])) - int(item["before_overall"]),
            _safe_int(item["player"].get("potential"), int(item["before_overall"])),
            int(item["before_overall"]),
            -_safe_int(item["player"].get("age"), 25),
            rng.random(),
        ),
        reverse=True,
    )
    boosted = 0
    for item in candidates:
        if boosted >= needed:
            break
        before = int(item["before_overall"])
        pot = _safe_int(item["player"].get("potential"), before)
        desired = min(lo, pot, 99)
        if desired >= lo and desired > int(item["target_overall"]):
            _set_plan_target(item, desired)
            boosted += 1
    _refresh_plan_targets(plan)


def _apply_band_rating_governor(
    plan: List[Dict[str, Any]],
    baseline: Dict[str, Any],
    settings: Dict[str, Any],
    rng: random.Random,
    allow_shortage_boosts: bool = True,
) -> None:
    cfg = settings.get("progression", {}) or {}
    strength = float(cfg.get("band_governor_strength", cfg.get("depth_tier_governor_strength", 1.0)))
    deep_strength = float(cfg.get("deep_band_governor_strength", strength))
    band_counts = baseline.get("bandCounts") if isinstance(baseline.get("bandCounts"), dict) else {}

    _refresh_plan_targets(plan)

    # Trim bands from high to low. This catches traffic jams just below the
    # cumulative cutoffs, e.g. 92-94, 88-89, and 83-84.
    for label, lo, hi, mode in _PROGRESS_BANDS:
        base = _safe_int(band_counts.get(label), 0)
        high = _band_high_limit(label, base)
        after_count = _band_count_from_plan(plan, lo, hi)
        if after_count > high:
            band_strength = deep_strength if hi <= 76 else strength
            excess = int(math.ceil((after_count - high) * band_strength))
            _apply_band_excess_trims(plan, label, lo, hi, excess, rng)

    if not allow_shortage_boosts:
        _refresh_plan_targets(plan)
        return

    # Only top bands can receive shortage boosts. Depth bands stay trim-only.
    for label, lo, hi, mode in _PROGRESS_BANDS:
        if mode == "trim":
            continue
        base = _safe_int(band_counts.get(label), 0)
        low = _band_low_limit(label, base)
        after_count = _band_count_from_plan(plan, lo, hi)
        if after_count < low:
            needed = int(math.ceil((low - after_count) * min(1.0, strength)))
            _apply_band_shortage_boosts(plan, label, lo, hi, needed, rng)

    _refresh_plan_targets(plan)


def _core_trim_priority(item: Dict[str, Any], rng: random.Random) -> Tuple[Any, ...]:
    before = int(item["before_overall"])
    after = int(item["target_overall"])
    p = item["player"]
    age = _safe_int(p.get("age"), 25)
    pot = _safe_int(p.get("potential"), before)
    gap = max(0, pot - before)

    premium = 1 if (age <= 23 and pot >= 95 and gap >= 12 and after < pot) else 0
    star_band = 1 if after >= 88 else 0
    useful_depth_band = 0 if 77 <= after <= 82 else (1 if 83 <= after <= 87 else 2)

    # Sort ascending: non-premium, playable-depth, low gap/POT, older players first.
    return (premium, star_band, useful_depth_band, gap, pot, -age, -after, rng.random())


def _apply_top300_core_governor(
    plan: List[Dict[str, Any]],
    baseline: Dict[str, Any],
    settings: Dict[str, Any],
    rng: random.Random,
) -> None:
    """
    Directly controls the real playable population: roughly the top 300 players.

    Earlier governors could keep 90+/95+ reasonable while the actual rotation
    pool still crept from the 70s into 77-82. This guard trims low-upside
    top-300 depth when the core average or core bands drift too far above Y1.
    """
    if not plan:
        return

    cfg = settings.get("progression", {}) or {}
    tolerance = float(cfg.get("top300_avg_tolerance", 0.45))
    strength = float(cfg.get("top300_governor_strength", 1.25))
    band_strength = float(cfg.get("top300_band_governor_strength", 1.15))

    base_avg = _safe_float(baseline.get("top300Avg"), 0.0)
    if base_avg <= 0:
        return

    def trim_once(candidates: List[Dict[str, Any]], max_drop_floor: int = 60) -> bool:
        candidates.sort(key=lambda item: _core_trim_priority(item, rng))
        for item in candidates:
            before = int(item["before_overall"])
            after = int(item["target_overall"])
            if after <= max_drop_floor:
                continue
            p = item["player"]
            age = _safe_int(p.get("age"), 25)
            pot = _safe_int(p.get("potential"), before)
            gap = max(0, pot - before)
            if age <= 23 and pot >= 95 and gap >= 12 and after < pot:
                continue
            _set_plan_target(item, after - 1)
            return True
        return False

    _refresh_plan_targets(plan)

    # A. Average guard for top 300.
    for _ in range(6):
        top_items = _top_n_items_from_plan(plan, 300)
        top_vals = [int(item["target_overall"]) for item in top_items]
        if not top_vals:
            return
        current_avg = _avg_value(top_vals, base_avg)
        max_avg = base_avg + tolerance
        if current_avg <= max_avg:
            break

        excess_points = int(math.ceil((current_avg - max_avg) * len(top_vals) * strength))
        candidates = [
            item for item in top_items
            if int(item["target_overall"]) >= 74
            and int(item["target_overall"]) < 90
        ]
        if not candidates:
            candidates = [item for item in top_items if int(item["target_overall"]) < 94]

        applied = 0
        while applied < excess_points and candidates:
            if not trim_once(candidates, max_drop_floor=70):
                break
            applied += 1
            _refresh_plan_targets(plan)
            top_items = _top_n_items_from_plan(plan, 300)
            candidates = [
                item for item in top_items
                if int(item["target_overall"]) >= 74
                and int(item["target_overall"]) < 90
            ]

        if applied <= 0:
            break

    # B. Top-300 cumulative threshold guard. This is the hard safety check
    # v11 was missing. The playable core cannot become almost all 77+.
    top_band_counts = baseline.get("top300BandCounts") if isinstance(baseline.get("top300BandCounts"), dict) else {}

    def base_top_count_at(threshold: int) -> int:
        total = 0
        for label, lo, hi, _mode in _PROGRESS_BANDS:
            if hi >= threshold:
                # Count full band only when its low is at/above threshold.
                # For these thresholds, bands align cleanly enough.
                if lo >= threshold:
                    total += _safe_int(top_band_counts.get(label), 0)
        return total

    threshold_rules = (
        (85, 10, 84),
        (83, 12, 82),
        (80, 18, 79),
        (77, 24, 76),
    )

    for threshold, allowed_plus, demote_to in threshold_rules:
        base = base_top_count_at(threshold)
        high = base + allowed_plus
        for _ in range(5):
            top_items = _top_n_items_from_plan(plan, 300)
            over_items = [item for item in top_items if int(item["target_overall"]) >= threshold and int(item["target_overall"]) < 90]
            if len(over_items) <= high:
                break
            excess = int(math.ceil((len(over_items) - high) * band_strength))
            applied = 0
            over_items.sort(key=lambda item: _core_trim_priority(item, rng))
            for item in over_items:
                if applied >= excess:
                    break
                after = int(item["target_overall"])
                desired = min(after - 1, demote_to)
                if desired < after:
                    _set_plan_target(item, desired)
                    applied += 1
            _refresh_plan_targets(plan)
            if applied <= 0:
                break

    # C. Top-300 band guard. This targets exact congestion bands.
    band_rules = (
        ("83_84", 83, 84, 1),
        ("81_82", 81, 82, 2),
        ("77_80", 77, 80, 4),
    )

    for label, lo, hi, allowed_plus in band_rules:
        base = _safe_int(top_band_counts.get(label), 0)
        high = base + allowed_plus
        for _ in range(4):
            top_items = _top_n_items_from_plan(plan, 300)
            band_items = [item for item in top_items if lo <= int(item["target_overall"]) <= hi]
            after_count = len(band_items)
            if after_count <= high:
                break
            excess = int(math.ceil((after_count - high) * band_strength))
            applied = 0
            band_items.sort(key=lambda item: _core_trim_priority(item, rng))
            for item in band_items:
                if applied >= excess:
                    break
                after = int(item["target_overall"])
                if label == "83_84":
                    desired = max(79, after - 3)
                elif label == "81_82":
                    desired = max(76, after - 3)
                else:
                    desired = max(73, after - 3)
                if desired < after:
                    _set_plan_target(item, desired)
                    applied += 1
            _refresh_plan_targets(plan)
            if applied <= 0:
                break

    _refresh_plan_targets(plan)


def _top300_cumulative_count_from_baseline(baseline: Dict[str, Any], threshold: int) -> int:
    bands = baseline.get("top300BandCounts") if isinstance(baseline.get("top300BandCounts"), dict) else {}
    total = 0
    for label, lo, hi, _mode in _PROGRESS_BANDS:
        if hi >= threshold:
            # Count full band only if the band is at/above threshold. For the
            # supported thresholds below, all band boundaries line up cleanly.
            if lo >= threshold:
                total += _safe_int(bands.get(label), 0)
    return total


def _hard_shape_trim_priority(item: Dict[str, Any], rng: random.Random) -> Tuple[Any, ...]:
    before = int(item["before_overall"])
    after = int(item["target_overall"])
    p = item["player"]
    age = _safe_int(p.get("age"), 25)
    pot = _safe_int(p.get("potential"), before)
    gap = max(0, pot - before)
    level = _prospect_level_context(p, str(item.get("team", "")), age, before, pot)
    dev_path = _player_dev_path_value(p)

    # Hard lock still protects only true future stars. It does NOT protect
    # every young 78 with decent potential, because that was the source of the
    # 77-84 flood.
    v25_protect = _v25_cap_trim_protection_score(item, rng)
    premium = 1 if ((level == "elite" or dev_path in {"ceiling_hit", "star"}) and age <= 25 and after >= 84 and after < pot) else 0
    normal_depth = 0 if 77 <= after <= 84 else 1
    return (premium + v25_protect, normal_depth, gap, pot, -age, -after, rng.random())


def _shape_shortage_boost_priority(item: Dict[str, Any], threshold: int, rng: random.Random) -> Tuple[Any, ...]:
    before = int(item["before_overall"])
    after = int(item["target_overall"])
    p = item["player"]
    team = str(item.get("team") or "")
    age = _safe_int(p.get("age"), 25)
    pot = _safe_int(p.get("potential"), before)
    gap = max(0, pot - before)
    level = _prospect_level_context(p, team, age, before, pot)
    dev_path = _player_dev_path_value(p)
    draft_slot = _draft_slot_value(p)

    # Sort descending. Rostered young/prime players with real upside first;
    # free agents last. This lets the league replace aging stars without using
    # unsigned filler as artificial inflation.
    free_agent_penalty = -1 if team == "__FREE_AGENCY__" else 0
    level_score = (2 if level == "elite" else 1 if level == "strong" else 0) + _path_score(dev_path)
    age_score = 3 if age <= 24 else 2 if age <= 27 else 1 if age <= 30 else 0
    close_score = max(0, 4 - max(0, threshold - after))
    draft_score = 2 if draft_slot <= 10 else 1 if draft_slot <= 30 else 0
    v25_score = _v25_boost_priority_score(item, threshold, rng)
    return (free_agent_penalty, level_score + v25_score, age_score, close_score, draft_score, gap, pot, -abs(25 - age), rng.random())


def _can_shape_shortage_boost(item: Dict[str, Any], threshold: int) -> bool:
    before = int(item.get("before_overall", 0))
    after = int(item.get("target_overall", 0))
    p = item.get("player") or {}
    team = str(item.get("team") or "")
    age = _safe_int(p.get("age"), 25)
    pot = _safe_int(p.get("potential"), before)
    gap = max(0, pot - before)
    level = _prospect_level_context(p, team, age, before, pot)

    if after >= threshold:
        return False
    if team == "__FREE_AGENCY__":
        # Only true premium free agents should be shortage-boosted. Normal FAs
        # are intentionally more likely to regress/stall.
        return level == "elite" and age <= 24 and pot >= threshold + 6
    if age > 32:
        return False
    prof = _v25_profile(p)
    hidden_level = _v25_hidden_upside_level_from_profile(prof)
    hidden_ceiling = _safe_int(prof.get("hiddenCeiling"), pot) if isinstance(prof, dict) else pot
    if hidden_level > 0 and age <= 26 and team != "__FREE_AGENCY__" and hidden_ceiling >= threshold:
        if threshold >= 90:
            return before >= threshold - 5 and after >= threshold - 6 and hidden_level >= 3
        if threshold >= 85:
            return before >= threshold - 5 and after >= threshold - 6 and hidden_level >= 2
        if threshold >= 80:
            return before >= threshold - 5 and after >= threshold - 6
        if threshold >= 77:
            return before >= threshold - 4 or after >= threshold - 4
    # Allow deeper rescue only for the 77+ floor. Higher bands stay close to
    # the threshold so shortage boosts do not create unrealistic giant jumps.
    if threshold >= 90 and after < 87:
        return False
    if threshold >= 85 and after < 82:
        return False
    if threshold >= 83 and after < 80:
        return False
    if threshold >= 80 and after < 77:
        return False
    if threshold >= 77 and after < 73:
        return False

    if threshold >= 90:
        return age <= 27 and level == "elite" and before >= threshold - 4 and pot >= threshold + 1
    if threshold >= 85:
        return age <= 29 and before >= threshold - 4 and (level in {"strong", "elite"} or pot >= threshold + 2 or before >= 83)
    if threshold >= 83:
        return age <= 30 and before >= threshold - 4 and (level in {"strong", "elite"} or pot >= threshold + 2 or before >= 80)
    if threshold >= 80:
        return age <= 30 and before >= threshold - 3 and (level != "normal" or pot >= threshold + 1 or 77 <= before <= 79)
    if threshold >= 77:
        # The 77+ floor is the main playable-depth stabilizer. v14/v16 tests
        # showed this band can underfill as older players retire/regress, so
        # allow established rostered 75-76 players and plausible 74s to be
        # pulled into the bottom of the playable pool. Free agents are still
        # excluded above unless they are true elite prospects.
        return age <= 33 and before >= threshold - 3 and (pot >= threshold - 1 or before >= 74)
    return False


def _apply_shape_shortage_boosts(
    plan: List[Dict[str, Any]],
    threshold: int,
    low: int,
    rng: random.Random,
    max_boosts: int,
) -> int:
    """Carefully add +1s when the top-300 distribution falls below its floor."""
    if low <= 0 or max_boosts <= 0:
        return 0
    applied_total = 0
    for _pass in range(6):
        _refresh_plan_targets(plan)
        top_items = _top_n_items_from_plan(plan, 300)
        current = sum(1 for item in top_items if int(item["target_overall"]) >= threshold)
        if current >= low:
            break
        need = min(low - current, max_boosts - applied_total)
        if need <= 0:
            break
        candidates = [item for item in plan if _can_shape_shortage_boost(item, threshold)]
        candidates.sort(key=lambda item: _shape_shortage_boost_priority(item, threshold, rng), reverse=True)
        applied = 0
        for item in candidates:
            if applied >= need:
                break
            after = int(item["target_overall"])
            before = int(item["before_overall"])
            p = item["player"]
            pot = _safe_int(p.get("potential"), max(before, after))
            # For the 77+ floor, selected rostered 75-76 players can be
            # pulled directly to 77. This is not potential-as-destiny; it is a
            # distribution stabilizer used only when the league is below the
            # Y1 corridor. Higher thresholds stay mostly +1 only.
            if threshold == 77 and after >= 73:
                desired = 77 if after >= 74 else after + 1
            elif threshold == 80 and after >= 77:
                desired = min(80, after + 2)
            elif threshold == 83 and after >= 80:
                desired = min(83, after + 2)
            elif threshold == 85 and after >= 82:
                desired = min(85, after + 2)
            elif threshold == 90 and after >= 87:
                desired = min(90, after + 1)
            else:
                desired = min(threshold, after + 1)
            if desired > after:
                _set_plan_target(item, desired)
                applied += 1
                applied_total += 1
        if applied <= 0:
            break
    _refresh_plan_targets(plan)
    return applied_total


def _apply_hard_top300_shape_lock(
    plan: List[Dict[str, Any]],
    baseline: Dict[str, Any],
    settings: Dict[str, Any],
    rng: random.Random,
) -> None:
    """
    v16 balanced top-300 shape lock.

    v13/v14 proved the shape lock is necessary, but v14 was one-way: it could
    cut excess 77-84 depth but could not protect the league when it fell below
    the Y1 distribution. This version uses corridors: trim if the league is
    above the corridor, carefully boost/protect if it is below the corridor.
    """
    if not plan:
        return

    base_avg = _safe_float(baseline.get("top300Avg"), 0.0)
    if base_avg <= 0:
        return

    top_band_counts = baseline.get("top300BandCounts") if isinstance(baseline.get("top300BandCounts"), dict) else {}

    # Cumulative top-300 corridors. v16 keeps the distribution much closer to
    # the original Y1 core. v16 allowed playable depth to drain for too long,
    # so the lower floors are stronger and the upward rescue budget is larger.
    corridor_rules = (
        (90, 5, 5, 89, 90, 95),
        (85, 6, 8, 84, 85, 89),
        (83, 8, 9, 82, 83, 87),
        (80, 10, 13, 79, 80, 84),
        (77, 12, 18, 76, 77, 82),
    )

    max_down_corrections = 34
    max_up_corrections = 240
    down_used = 0
    up_used = 0

    def enforce_high(threshold: int, high: int, demote_to: int, max_lo: int, max_hi: int) -> None:
        nonlocal down_used
        for _pass in range(4):
            if down_used >= max_down_corrections:
                break
            _refresh_plan_targets(plan)
            top_items = _top_n_items_from_plan(plan, 300)
            current = sum(1 for item in top_items if int(item["target_overall"]) >= threshold)
            if current <= high:
                break
            excess = min(current - high, max_down_corrections - down_used)
            candidates = [
                item for item in top_items
                if int(item["target_overall"]) >= threshold
                and max_lo <= int(item["target_overall"]) <= max_hi
            ]
            if not candidates:
                candidates = [item for item in top_items if int(item["target_overall"]) >= threshold and int(item["target_overall"]) < 90]
            candidates.sort(key=lambda item: _hard_shape_trim_priority(item, rng))
            applied = 0
            for item in candidates:
                if applied >= excess:
                    break
                after = int(item["target_overall"])
                desired = min(demote_to, after - 1)
                if desired < after:
                    _set_plan_target(item, desired)
                    applied += 1
                    down_used += 1
            if applied <= 0:
                break

    # High-side trims: still stop a return to the old flood, but no longer
    # overcorrect for multiple passes until the league is crushed.
    for threshold, _low_minus, high_plus, demote_to, max_lo, max_hi in corridor_rules:
        base_count = _top300_cumulative_count_from_baseline(baseline, threshold)
        if base_count <= 0:
            continue
        enforce_high(threshold, base_count + high_plus, demote_to, max_lo, max_hi)

    # Low-side protection/boosts: if the league falls below baseline floors,
    # use +1 boosts on plausible rostered players rather than free-agent filler.
    for threshold, low_minus, _high_plus, _demote_to, _max_lo, _max_hi in reversed(corridor_rules):
        base_count = _top300_cumulative_count_from_baseline(baseline, threshold)
        if base_count <= 0:
            continue
        low = max(0, base_count - low_minus)
        remaining = max_up_corrections - up_used
        if remaining <= 0:
            break
        up_used += _apply_shape_shortage_boosts(plan, threshold, low, rng, remaining)

    _refresh_plan_targets(plan)

    # Keep the 74-76 borderline layer alive, but do not force it so hard that
    # it drains the real 77/80 population like v14 did.
    base_7476 = _safe_int(top_band_counts.get("74_76"), 0)
    min_7476 = max(0, base_7476 - 28)
    max_7476 = base_7476 + 24
    top_items = _top_n_items_from_plan(plan, 300)
    count_7476 = sum(1 for item in top_items if 74 <= int(item["target_overall"]) <= 76)
    if count_7476 < min_7476 and down_used < max_down_corrections:
        need = min(min_7476 - count_7476, max_down_corrections - down_used)
        candidates = [item for item in top_items if 77 <= int(item["target_overall"]) <= 79]
        candidates.sort(key=lambda item: _hard_shape_trim_priority(item, rng))
        for item in candidates[:need]:
            _set_plan_target(item, 76)
            down_used += 1
    elif count_7476 > max_7476 and up_used < max_up_corrections:
        # If the borderline layer gets too crowded, promote only plausible
        # players to 77, not random low-upside free agents.
        need = min(count_7476 - max_7476, max_up_corrections - up_used)
        candidates = [item for item in top_items if 74 <= int(item["target_overall"]) <= 76 and _can_shape_shortage_boost(item, 77)]
        candidates.sort(key=lambda item: _shape_shortage_boost_priority(item, 77, rng), reverse=True)
        for item in candidates[:need]:
            _set_plan_target(item, 77)
            up_used += 1

    _refresh_plan_targets(plan)

    # Average corridor. Use mild one-point nudges only if the top300 average is
    # meaningfully outside the desired range. This prevents v14-style long-term
    # deflation while still protecting against v13 inflation.
    min_avg = base_avg - 0.35
    max_avg = base_avg + 0.55
    for _pass in range(7):
        top_items = _top_n_items_from_plan(plan, 300)
        vals = [int(item["target_overall"]) for item in top_items]
        if not vals:
            return
        avg = _avg_value(vals, base_avg)
        if avg > max_avg and down_used < max_down_corrections:
            need = min(int(math.ceil((avg - max_avg) * len(vals) * 0.70)), max_down_corrections - down_used)
            candidates = [item for item in top_items if 77 <= int(item["target_overall"]) < 90]
            candidates.sort(key=lambda item: _hard_shape_trim_priority(item, rng))
            applied = 0
            for item in candidates:
                if applied >= need:
                    break
                after = int(item["target_overall"])
                desired = max(76, after - 1)
                if desired < after:
                    _set_plan_target(item, desired)
                    applied += 1
                    down_used += 1
            if applied <= 0:
                break
        elif avg < min_avg and up_used < max_up_corrections:
            need = min(int(math.ceil((min_avg - avg) * len(vals) * 0.70)), max_up_corrections - up_used)
            candidates = []
            for item in top_items:
                after = int(item["target_overall"])
                p = item["player"]
                team = str(item.get("team") or "")
                age = _safe_int(p.get("age"), 25)
                pot = _safe_int(p.get("potential"), after)
                # Average-shortage boosts are allowed below 77 too, otherwise
                # the top300 cutoff can sink to 69-72 while 80+ stays healthy.
                # Keep free agents out unless they are true premium prospects.
                if 70 <= after <= 84 and age <= 33:
                    if team != "__FREE_AGENCY__" or _prospect_level_context(p, team, age, after, pot) == "elite":
                        if after >= 74 or pot >= after + 1:
                            candidates.append(item)
            candidates.sort(key=lambda item: _shape_shortage_boost_priority(item, min(85, int(item["target_overall"]) + 1), rng), reverse=True)
            applied = 0
            for item in candidates:
                if applied >= need:
                    break
                after = int(item["target_overall"])
                desired = after + 1
                if desired > after:
                    _set_plan_target(item, desired)
                    applied += 1
                    up_used += 1
            if applied <= 0:
                break
        else:
            break
        _refresh_plan_targets(plan)

    _refresh_plan_targets(plan)

def _fine_shelf_corridor(threshold: int, baseline_count: int) -> Tuple[int, int]:
    """v20 cumulative shelf corridor for full-league roster+FA distribution."""
    if threshold >= 97:
        spread = 1
    elif threshold >= 96:
        spread = 1
    elif threshold >= 95:
        spread = 1
    elif threshold >= 92:
        spread = 2
    elif threshold >= 90:
        spread = 3
    elif threshold >= 87:
        spread = 4
    elif threshold >= 85:
        spread = 6
    elif threshold >= 82:
        spread = 8
    elif threshold >= 80:
        spread = 9
    elif threshold >= 77:
        spread = 12
    else:
        spread = 16
    low = max(0, int(baseline_count) - spread)
    high = int(baseline_count) + spread
    return low, high


def _exact_rung_corridor(rung: int, baseline_count: int) -> Tuple[int, int]:
    """Keep exact OVR rungs populated without making them exact locks."""
    if rung >= 97:
        spread = 1
    elif rung >= 95:
        spread = 1
    elif rung >= 90:
        spread = 2
    elif rung >= 85:
        spread = 3
    elif rung >= 80:
        spread = 4
    elif rung >= 77:
        spread = 6
    else:
        spread = 8
    low = max(0, int(baseline_count) - spread)
    # The seed file has at least one player at every 74+ rung. Keep the same
    # general curve by trying not to completely empty 80+ rungs when candidates
    # are available, but never force impossible exact counts.
    if baseline_count > 0 and rung >= 80:
        low = max(1, low)
    high = int(baseline_count) + spread
    return low, high


def _fine_shelf_trim_candidates(plan: List[Dict[str, Any]], threshold: int) -> List[Dict[str, Any]]:
    candidates = [
        item for item in plan
        if int(item.get("target_overall", 0)) >= threshold
        and int(item.get("target_overall", 0)) <= min(99, threshold + 3)
    ]
    if not candidates:
        candidates = [item for item in plan if int(item.get("target_overall", 0)) >= threshold]
    return candidates


def _fine_can_exact_boost(item: Dict[str, Any], rung: int) -> bool:
    after = int(item.get("target_overall", 0))
    before = int(item.get("before_overall", after))
    p = item.get("player") or {}
    age = _safe_int(p.get("age"), 25)
    pot = _safe_int(p.get("potential"), before)
    team = str(item.get("team") or "")
    if after >= rung:
        return False
    if after < rung - 2:
        return False
    if _can_shape_shortage_boost(item, rung):
        return True
    if team == "__FREE_AGENCY__":
        return False
    if rung >= 90:
        return age <= 27 and before >= rung - 2 and pot >= rung
    if rung >= 85:
        return age <= 29 and before >= rung - 2 and (pot >= rung or before >= rung - 1)
    if rung >= 80:
        return age <= 31 and before >= rung - 2 and (pot >= rung - 1 or before >= rung - 1)
    return age <= 33 and before >= rung - 2 and (pot >= rung - 1 or before >= rung - 1)


def _apply_v20_fine_shape_lock(
    plan: List[Dict[str, Any]],
    baseline: Dict[str, Any],
    settings: Dict[str, Any],
    rng: random.Random,
) -> None:
    """
    Fine-grained v20 shape lock.

    Uses cumulative shelves at 97/96/95/.../74 and exact-rung smoothing so the
    league can change faces without turning into a flat pile at 85, 80, or 77.
    Baseline counts are built from the entire player pool, including free agents.
    """
    if not plan or not isinstance(baseline, dict):
        return

    counts = baseline.get("counts") if isinstance(baseline.get("counts"), dict) else {}
    exact_counts = baseline.get("exactCounts") if isinstance(baseline.get("exactCounts"), dict) else {}
    down_budget = 72
    up_budget = 30
    down_used = 0
    up_used = 0

    # Cumulative shelf trims/boosts.
    for threshold in _PROGRESS_TIER_THRESHOLDS:
        _refresh_plan_targets(plan)
        base = _safe_int(counts.get(str(threshold)), 0)
        if base <= 0:
            continue
        low, high = _fine_shelf_corridor(threshold, base)
        current = sum(1 for item in plan if int(item.get("target_overall", 0)) >= threshold)

        if current > high and down_used < down_budget:
            need = min(current - high, down_budget - down_used)
            candidates = _fine_shelf_trim_candidates(plan, threshold)
            candidates.sort(key=lambda item: _hard_shape_trim_priority(item, rng))
            applied = 0
            for item in candidates:
                if applied >= need:
                    break
                after = int(item.get("target_overall", 0))
                # Do not turn a one-year breakout into a full crash; one rung is
                # enough because lower cumulative shelves run afterward.
                desired = max(60, min(threshold - 1, after - 1))
                if desired < after:
                    _set_plan_target(item, desired)
                    applied += 1
                    down_used += 1

        elif current < low and up_used < up_budget:
            need = min(low - current, up_budget - up_used)
            candidates = [item for item in plan if _can_shape_shortage_boost(item, threshold)]
            candidates.sort(key=lambda item: _shape_shortage_boost_priority(item, threshold, rng), reverse=True)
            applied = 0
            for item in candidates:
                if applied >= need:
                    break
                after = int(item.get("target_overall", 0))
                p = item.get("player") or {}
                pot = _safe_int(p.get("potential"), after)
                # Higher shelves can only be filled by players with the listed
                # ceiling; lower shelves can use near-rung stable players.
                if threshold >= 85:
                    desired = min(threshold, after + 1, max(pot, after))
                else:
                    desired = min(threshold, after + 1, max(pot, threshold if after >= threshold - 1 else after + 1))
                if desired > after:
                    _set_plan_target(item, desired)
                    applied += 1
                    up_used += 1

    _refresh_plan_targets(plan)

    # Exact-rung smoothing. This is not a hard exact lock. It trims obvious
    # overpopulation and lightly fills empty/underpopulated 80+ rungs only when
    # close, plausible players exist.
    for rung in range(_PROGRESS_EXACT_RUNG_MAX, _PROGRESS_EXACT_RUNG_MIN - 1, -1):
        _refresh_plan_targets(plan)
        base = _safe_int(exact_counts.get(str(rung)), 0)
        if base <= 0:
            continue
        low, high = _exact_rung_corridor(rung, base)
        current = _exact_count_from_plan(plan, rung)

        if current > high and down_used < down_budget:
            need = min(current - high, down_budget - down_used)
            candidates = [item for item in plan if int(item.get("target_overall", 0)) == rung]
            candidates.sort(key=lambda item: _hard_shape_trim_priority(item, rng))
            for item in candidates[:need]:
                _set_plan_target(item, rung - 1)
                down_used += 1

        elif current < low and up_used < up_budget:
            need = min(low - current, up_budget - up_used)
            candidates = [item for item in plan if _fine_can_exact_boost(item, rung)]
            candidates.sort(key=lambda item: _shape_shortage_boost_priority(item, rung, rng), reverse=True)
            applied = 0
            for item in candidates:
                if applied >= need:
                    break
                after = int(item.get("target_overall", 0))
                if after < rung:
                    _set_plan_target(item, min(rung, after + 1))
                    applied += 1
                    up_used += 1

    _refresh_plan_targets(plan)



# -------------------------
# V23 final saved-pool hard league-shape lock
# -------------------------
_HARD_SHAPE_VERSION = "v25d_final_saved_pool_hard_caps_2027_universe"


def _hard_cumulative_spread(threshold: int) -> int:
    # V23 uses fixed, population-independent corridors. Adding draft classes
    # can increase the number of sub-74 players, but it can never expand these
    # playable-quality shelves.
    if threshold >= 90:
        return 1
    if threshold >= 85:
        return 2
    if threshold >= 80:
        return 3
    if threshold >= 77:
        return 4
    return 5


def _hard_exact_spread(rung: int) -> int:
    if rung >= 85:
        return 1
    if rung >= 80:
        return 2
    if rung >= 77:
        return 2
    return 3


def _hard_cumulative_corridors() -> Dict[int, Tuple[int, int]]:
    out: Dict[int, Tuple[int, int]] = {}
    for threshold, base in _CANONICAL_2027_SHELF_COUNTS.items():
        upper_spread = _hard_cumulative_spread(threshold)
        # Upper limits are the literal hard caps. Lower floors are slightly
        # wider in the depth tiers so the engine can create natural churn
        # instead of force-boosting a specific number of 65-73 OVR players.
        if threshold >= 90:
            lower_spread = upper_spread
        elif threshold >= 85:
            lower_spread = upper_spread + 1
        elif threshold >= 80:
            lower_spread = upper_spread + 2
        elif threshold >= 77:
            lower_spread = 7
        elif threshold >= 75:
            lower_spread = 11
        else:
            lower_spread = 13
        out[int(threshold)] = (max(0, int(base) - lower_spread), int(base) + upper_spread)
    return out


def _hard_exact_corridors() -> Dict[int, Tuple[int, int]]:
    # Exact rungs are hard *maximums* only. Cumulative shelves provide the
    # league-quality floors. Requiring an exact minimum at every rung caused
    # artificial boosts simply to fill a number such as 82 or 76.
    out: Dict[int, Tuple[int, int]] = {99: (0, 1)}
    for rung in range(98, 73, -1):
        base = int(_CANONICAL_2027_EXACT_COUNTS.get(rung, 0))
        spread = _hard_exact_spread(rung)
        out[rung] = (0, base + spread)
    return out


def _age_peak_overall_cap(item: Dict[str, Any], rng: random.Random) -> int:
    p = item.get("player") or {}
    age = _safe_int(p.get("age"), 25)
    profile = _career_timing_profile(
        p,
        age,
        int(item.get("before_overall", _safe_int(p.get("overall"), 70))),
        _safe_int(p.get("potential"), _safe_int(p.get("overall"), 70)),
        rng,
    )
    kind = str(profile.get("kind") or "steady")
    caps = {
        30: 98, 31: 97, 32: 96, 33: 95, 34: 94, 35: 93,
        36: 91, 37: 89, 38: 87, 39: 84, 40: 81, 41: 78,
        42: 75, 43: 72,
    }
    if age < 30:
        cap = 99
    elif age >= 43:
        cap = 72
    else:
        cap = caps.get(age, 99)

    # Small timing variance. V25D adds mild elite-vet protection for real
    # long-prime/star profiles without creating immortal late-30s 97s.
    if kind == "late_bloomer" and 30 <= age <= 33:
        cap += 1
    try:
        v25_prof = _v25_profile(p, rng)
        v25_name = str(v25_prof.get("profile") or "steady_growth")
        before_ovr = int(item.get("before_overall", _safe_int(p.get("overall"), 70)))
        if 30 <= age <= 34 and before_ovr >= 92 and v25_name in {"long_prime", "star_hit", "generational_hit", "steady_growth"}:
            cap += 1
        if 30 <= age <= 32 and before_ovr >= 96 and v25_name in {"long_prime", "generational_hit"}:
            cap += 1
    except Exception:
        pass
    if kind == "early_peak" and age > _safe_int(profile.get("peakAge"), 26):
        cap -= 1
    return int(_clamp(cap, 60, 99))


def _hard_item_bounds(item: Dict[str, Any], rng: random.Random) -> Tuple[int, int]:
    p = item.get("player") or {}
    current = int(item.get("target_overall", item.get("before_overall", 70)))
    before = int(item.get("before_overall", _safe_int(p.get("overall"), 70)))

    # During the final post-JS reconciliation pass, __progressionOriginalOverall
    # preserves the true pre-progression OVR. This prevents a second shape pass
    # from granting another +4 or another -5 on top of the player's actual roll.
    has_original_window = p.get("__progressionOriginalOverall") is not None
    if has_original_window:
        lo_delta, hi_delta = _yearly_delta_caps_for_item(item)
        lo = int(_clamp(before + lo_delta, 60, 99))
        hi = int(_clamp(before + hi_delta, 60, 99))
    elif item.get("final_shape_only"):
        # Roster/draft/free-agency lifecycle reconciliation is a one-rung
        # distribution correction, not a second progression event.
        lo = int(_clamp(current - 1, 60, 99))
        hi = int(_clamp(current + 1, 60, 99))
    else:
        lo_delta, hi_delta = _yearly_delta_caps_for_item(item)
        lo = int(_clamp(before + lo_delta, 60, 99))
        hi = int(_clamp(before + hi_delta, 60, 99))

    hi = min(hi, _age_peak_overall_cap(item, rng))
    if hi < lo:
        # Yearly/lifecycle movement limits outrank the age ceiling in a single
        # season. The age cap creates pressure over multiple years; it cannot
        # manufacture a one-year fall larger than the user's -5 maximum.
        hi = lo
    return lo, hi


def _hard_trim_priority(item: Dict[str, Any], rng: random.Random) -> Tuple[Any, ...]:
    p = item.get("player") or {}
    age = _safe_int(p.get("age"), 25)
    before = int(item.get("before_overall", _safe_int(p.get("overall"), 70)))
    after = int(item.get("target_overall", before))
    pot = _safe_int(p.get("potential"), before)
    gap = max(0, pot - before)
    profile = _career_timing_profile(p, age, before, pot, rng)
    early_peak = 0 if str(profile.get("kind")) == "early_peak" else 1
    v25_protect = _v25_cap_trim_protection_score(item, rng)
    # Ascending: old/low-upside/early-peaking players leave crowded shelves first.
    # Low/negative V25 scores are trim candidates. Positive V25 scores protect
    # hidden gems, late bloomers, and real outliers from being erased by caps.
    return (v25_protect, -age, gap, pot, early_peak, after - before, rng.random())


def _hard_boost_priority(item: Dict[str, Any], threshold: int, rng: random.Random) -> Tuple[Any, ...]:
    p = item.get("player") or {}
    age = _safe_int(p.get("age"), 25)
    before = int(item.get("before_overall", _safe_int(p.get("overall"), 70)))
    after = int(item.get("target_overall", before))
    pot = _safe_int(p.get("potential"), before)
    gap = max(0, pot - before)
    profile = _career_timing_profile(p, age, before, pot, rng)
    breakout = _safe_int(profile.get("breakoutAge"), 24)
    timing = 2 if abs(age - breakout) <= 1 else 1 if age < breakout + 2 else 0
    youth = max(0, 31 - age)
    v25_score = _v25_boost_priority_score(item, threshold, rng)
    # Descending: plausible young/high-POT/V25-breakout players occupy vacancies.
    return (v25_score, pot >= threshold, min(gap, 20), timing, youth, after, before, rng.random())


def _hard_set_target(item: Dict[str, Any], desired: int, rng: random.Random, force: bool = False) -> bool:
    current = int(item.get("target_overall", item.get("before_overall", 70)))
    lo, hi = _hard_item_bounds(item, rng)
    # V23 never bypasses the yearly/lifecycle window. If a pathological save
    # makes the hard cap mathematically impossible, the final audit fails and
    # the UI blocks completion instead of silently creating an oversized jump.
    target = int(_clamp(desired, lo, hi))
    if target == current:
        return False
    _set_plan_target(item, target)
    return True


def _hard_count(plan: List[Dict[str, Any]], threshold: int) -> int:
    return sum(1 for item in plan if int(item.get("target_overall", 0)) >= int(threshold))


def _hard_exact_count(plan: List[Dict[str, Any]], rung: int) -> int:
    return sum(1 for item in plan if int(item.get("target_overall", 0)) == int(rung))


def audit_current_league_shape(league: Dict[str, Any]) -> Dict[str, Any]:
    """Audit the exact player pool the UI will save and display.

    This is deliberately independent of the progression plan. It counts every
    standard roster, two-way, stash, and free-agent player after all Python and
    frontend transformations. Hard-cap success is only true when this final
    visible pool is legal.
    """
    players = [p for p in _all_players(league) if isinstance(p, dict)] if isinstance(league, dict) else []
    values = [int(_clamp(_safe_int(p.get("overall"), p.get("ovr", 70)), 25, 99)) for p in players]
    cumulative = _hard_cumulative_corridors()
    exact = _hard_exact_corridors()
    violations: List[Dict[str, Any]] = []
    cumulative_audit: Dict[str, Any] = {}
    exact_audit: Dict[str, Any] = {}

    for threshold in _PROGRESS_TIER_THRESHOLDS:
        low, high = cumulative[int(threshold)]
        actual = sum(1 for value in values if value >= threshold)
        ok = actual <= high
        cumulative_audit[str(threshold)] = {
            "actual": actual, "targetMin": low, "max": high,
            "ok": ok, "belowTarget": actual < low,
        }
        if actual > high:
            violations.append({"type": "cumulative_max", "threshold": threshold, "actual": actual, "max": high})

    for rung in range(99, 73, -1):
        _low, high = exact.get(rung, (0, 9999))
        actual = sum(1 for value in values if value == rung)
        hard = rung >= 90
        ok = (actual <= high) if hard else True
        exact_audit[str(rung)] = {"actual": actual, "max": high, "hard": hard, "ok": ok}
        if hard and actual > high:
            violations.append({"type": "exact_max", "rung": rung, "actual": actual, "max": high})

    potential_below_overall = []
    for p in players:
        overall = int(_clamp(_safe_int(p.get("overall"), 70), 25, 99))
        potential = int(_clamp(_safe_int(p.get("potential"), p.get("pot", overall)), 25, 99))
        if potential < overall:
            potential_below_overall.append({
                "id": p.get("id"),
                "name": p.get("name"),
                "overall": overall,
                "potential": potential,
            })
    if potential_below_overall:
        violations.append({"type": "potential_below_overall", "count": len(potential_below_overall)})

    return {
        "version": _HARD_SHAPE_VERSION,
        "ok": len(violations) == 0,
        "playerCount": len(players),
        "violations": violations,
        "cumulative": cumulative_audit,
        "exact": exact_audit,
        "potentialBelowOverallCount": len(potential_below_overall),
        "potentialBelowOverallExamples": potential_below_overall[:12],
    }


def _apply_age_peak_caps(plan: List[Dict[str, Any]], rng: random.Random) -> None:
    for item in plan:
        if _is_shape_protected_item(item):
            continue
        cap = _age_peak_overall_cap(item, rng)
        if int(item.get("target_overall", 0)) > cap:
            _hard_set_target(item, cap, rng)
    _refresh_plan_targets(plan)


def _apply_true_hard_shape_lock(
    plan: List[Dict[str, Any]],
    settings: Dict[str, Any],
    rng: random.Random,
) -> Dict[str, Any]:
    """Guarantee the requested 2027-universe corridors.

    Cumulative shelves 97+ through 74+ have hard upper limits and tight lower
    targets. Exact OVR rungs also have hard anti-clump limits. This function is
    intentionally idempotent when the league is already legal.
    """
    if not plan:
        return {"version": _HARD_SHAPE_VERSION, "ok": True, "violations": []}

    cumulative = _hard_cumulative_corridors()
    exact = _hard_exact_corridors()
    _refresh_plan_targets(plan)
    _apply_age_peak_caps(plan, rng)

    # 1. Hard cumulative maximums, highest shelf first.
    for threshold in _PROGRESS_TIER_THRESHOLDS:
        _refresh_plan_targets(plan)
        _low, high = cumulative[int(threshold)]
        while _hard_count(plan, threshold) > high:
            candidates = [
                item for item in plan
                if not _is_shape_protected_item(item)
                and int(item.get("target_overall", 0)) >= threshold
                and _hard_item_bounds(item, rng)[0] <= threshold - 1
            ]
            candidates.sort(key=lambda item: _hard_trim_priority(item, rng))
            if not candidates:
                candidates = [item for item in plan if not _is_shape_protected_item(item) and int(item.get("target_overall", 0)) >= threshold]
                if not candidates:
                    break
                candidates.sort(key=lambda item: _hard_trim_priority(item, rng))
            if not _hard_set_target(candidates[0], threshold - 1, rng):
                break

    # 2. Hard exact-rung anti-clump maximums.
    for rung in range(99, 73, -1):
        _refresh_plan_targets(plan)
        _low, high = exact.get(rung, (0, 9999))
        while _hard_exact_count(plan, rung) > high:
            candidates = [
                item for item in plan
                if not _is_shape_protected_item(item)
                and int(item.get("target_overall", 0)) == rung
                and _hard_item_bounds(item, rng)[0] <= rung - 1
            ]
            candidates.sort(key=lambda item: _hard_trim_priority(item, rng))
            if not candidates:
                candidates = [item for item in plan if not _is_shape_protected_item(item) and int(item.get("target_overall", 0)) == rung]
                if not candidates:
                    break
                candidates.sort(key=lambda item: _hard_trim_priority(item, rng))
            if not _hard_set_target(candidates[0], rung - 1, rng):
                break

    # 3. Tight cumulative floors create replacement stars when old players
    # leave. Only plausible candidates within their yearly/age bounds can fill.
    for _pass in range(3):
        changed = False
        for threshold in _PROGRESS_TIER_THRESHOLDS:
            _refresh_plan_targets(plan)
            low, _high = cumulative[int(threshold)]
            need = low - _hard_count(plan, threshold)
            if need <= 0:
                continue
            candidates = []
            for item in plan:
                if _is_shape_protected_item(item):
                    continue
                after = int(item.get("target_overall", 0))
                _lo, hi = _hard_item_bounds(item, rng)
                p = item.get("player") or {}
                age = _safe_int(p.get("age"), 25)
                pot = _safe_int(p.get("potential"), int(item.get("before_overall", after)))
                if after < threshold and hi >= threshold:
                    if threshold >= 95 and (age > 30 or pot < threshold):
                        continue
                    if threshold >= 90 and (age > 31 or pot < threshold - 1):
                        continue
                    candidates.append(item)
            candidates.sort(key=lambda item: _hard_boost_priority(item, threshold, rng), reverse=True)
            for item in candidates[:need]:
                if _hard_set_target(item, threshold, rng):
                    changed = True
        if not changed:
            break

    # 4. Exact-rung minimums prevent empty rungs. We only pull close plausible
    # players upward, then re-run all hard maximums.
    for rung in range(98, 73, -1):
        low, _high = exact.get(rung, (0, 9999))
        need = low - _hard_exact_count(plan, rung)
        if need <= 0:
            continue
        candidates = []
        for item in plan:
            if _is_shape_protected_item(item):
                continue
            after = int(item.get("target_overall", 0))
            _lo, hi = _hard_item_bounds(item, rng)
            if rung - 2 <= after < rung and hi >= rung:
                candidates.append(item)
        candidates.sort(key=lambda item: _hard_boost_priority(item, rung, rng), reverse=True)
        for item in candidates[:need]:
            _hard_set_target(item, rung, rng)

    # Re-assert every upper cap after floor filling. These loops terminate
    # because each correction moves a player below the current threshold/rung.
    for threshold in _PROGRESS_TIER_THRESHOLDS:
        _low, high = cumulative[int(threshold)]
        while _hard_count(plan, threshold) > high:
            candidates = [item for item in plan if not _is_shape_protected_item(item) and int(item.get("target_overall", 0)) >= threshold]
            candidates.sort(key=lambda item: _hard_trim_priority(item, rng))
            if not candidates:
                break
            if not _hard_set_target(candidates[0], threshold - 1, rng):
                break
    for rung in range(99, 73, -1):
        _low, high = exact.get(rung, (0, 9999))
        while _hard_exact_count(plan, rung) > high:
            candidates = [item for item in plan if not _is_shape_protected_item(item) and int(item.get("target_overall", 0)) == rung]
            candidates.sort(key=lambda item: _hard_trim_priority(item, rng))
            if not candidates:
                break
            if not _hard_set_target(candidates[0], rung - 1, rng):
                break

    _refresh_plan_targets(plan)
    violations: List[Dict[str, Any]] = []
    cumulative_audit: Dict[str, Any] = {}
    exact_audit: Dict[str, Any] = {}
    for threshold in _PROGRESS_TIER_THRESHOLDS:
        low, high = cumulative[int(threshold)]
        actual = _hard_count(plan, threshold)
        cumulative_audit[str(threshold)] = {
            "actual": actual, "targetMin": low, "max": high,
            "ok": actual <= high, "belowTarget": actual < low,
        }
        if actual > high:
            violations.append({"type": "cumulative_max", "threshold": threshold, "actual": actual, "max": high})
    for rung in range(99, 73, -1):
        low, high = exact.get(rung, (0, 9999))
        actual = _hard_exact_count(plan, rung)
        hard = rung >= 90
        exact_audit[str(rung)] = {"actual": actual, "max": high, "hard": hard, "ok": (actual <= high) if hard else True}
        if hard and actual > high:
            violations.append({"type": "exact_max", "rung": rung, "actual": actual, "max": high})

    return {
        "version": _HARD_SHAPE_VERSION,
        "ok": len(violations) == 0,
        "violations": violations,
        "cumulative": cumulative_audit,
        "exact": exact_audit,
    }

def _apply_league_rating_governor(
    league: Optional[Dict[str, Any]],
    plan: List[Dict[str, Any]],
    settings: Dict[str, Any],
    rng: random.Random
) -> None:
    if not plan:
        return
    _cap_plan_yearly_deltas(plan)
    _apply_true_hard_shape_lock(plan, settings, rng)
    _refresh_plan_targets(plan)

def _apply_elite_peak_caps(plan: List[Dict[str, Any]], settings: Dict[str, Any], rng: random.Random) -> None:
    """
    99 and 98 OVR are treated as peak-season outcomes.

    Rules:
      - A target 99 has a tuned rare chance to stay 99.
      - A target 99 that fails becomes 98 and is SAFE from the 98 roll.
      - A natural target 98 has a tuned chance to stay 98 and otherwise
        falls to 97.

    This runs after progression/governors and before attributes are moved.
    """
    cfg = settings.get("progression", {}) or {}
    stay_99 = float(_clamp(float(cfg.get("ninety_nine_stay_chance", 0.10)), 0.0, 1.0))
    stay_98 = float(_clamp(float(cfg.get("ninety_eight_stay_chance", 0.50)), 0.0, 1.0))

    for item in plan:
        target = int(item.get("target_overall", 0))
        item.pop("_elite_cap_safe_98", None)

        if target >= 99:
            if rng.random() <= stay_99:
                _set_plan_target(item, 99)
            else:
                _set_plan_target(item, 98)
                item["_elite_cap_safe_98"] = True
            continue

        if target == 98:
            if rng.random() > stay_98:
                _set_plan_target(item, 97)

    _refresh_plan_targets(plan)



def _force_overall_at_most(
    p: Dict[str, Any],
    cap_overall: int,
    settings: Dict[str, Any],
    rng: random.Random,
) -> None:
    """
    Hard post-attribute cap.

    _move_attrs_toward_target_overall is intentionally gentle and can fail to
    lower a stacked player enough for the calculated OVR to match the planned
    target. Governors and 98/99 rules only matter if the final calculated OVR
    actually respects the plan, so this keeps lowering high-impact attributes
    until overall <= cap or the safety step limit is reached.
    """
    attrs = _ensure_attrs(p.get("attrs"))
    pos = p.get("pos") or p.get("position") or "SF"
    cap_overall = int(_clamp(cap_overall, 60, 99))

    current = calc_overall_from_attrs(attrs, pos)
    if current <= cap_overall:
        p["attrs"] = attrs
        p["overall"] = current
        return

    cfg = settings.get("progression", {}) or {}
    max_steps = int(cfg.get("max_force_cap_attr_steps", 220))
    pos_cfg = _POS_PARAMS.get(_normalized_pos(pos), _POS_PARAMS["SF"])
    weights = list(pos_cfg["weights"])
    prim = {int(i) - 1 for i in pos_cfg["prim"]}

    steps = 0
    while current > cap_overall and steps < max_steps:
        candidates = [i for i, v in enumerate(attrs) if int(v) > 25]
        if not candidates:
            break

        best_trial = None
        best_score = None

        for idx in candidates:
            trial = list(attrs)
            trial[idx] = int(_clamp(trial[idx] - 1, 25, 99))
            trial_ovr = calc_overall_from_attrs(trial, pos)
            impact = current - trial_ovr
            score = (
                impact,
                float(weights[idx]) + (0.08 if idx in prim else 0.0),
                int(attrs[idx]),
                rng.random(),
            )
            if best_score is None or score > best_score:
                best_score = score
                best_trial = trial

        if best_trial is None:
            break

        attrs = best_trial
        new_current = calc_overall_from_attrs(attrs, pos)

        # If OVR did not move, keep chipping away at high-impact attributes.
        # Some 98/99/84/82 cliffs require several attribute points before the
        # displayed overall finally drops.
        current = new_current
        steps += 1

    p["attrs"] = attrs
    p["overall"] = calc_overall_from_attrs(attrs, pos)


def _enforce_post_attribute_elite_cap(
    p: Dict[str, Any],
    item: Dict[str, Any],
    settings: Dict[str, Any],
    rng: random.Random,
) -> None:
    """
    Final calculated-overall guard.

    Despite the historical name, v11 enforces more than elite caps. It hardens
    any planned downward move, because otherwise the 77-82 governors can plan
    trims that the attribute mover fails to realize visually.
    """
    planned = int(item.get("target_overall", _safe_int(p.get("overall"), 70)))
    current = _safe_int(p.get("overall"), planned)
    target_delta = int(item.get("target_delta", 0))

    # Always enforce the peak-season caps.
    if planned >= 97 and current > planned:
        _force_overall_at_most(p, planned, settings, rng)
        current = _safe_int(p.get("overall"), planned)

    # If a failed 99 roll made the player safe at 98, never let him sneak back
    # to 99 through recalculation.
    if item.get("_elite_cap_safe_98") and current > 98:
        _force_overall_at_most(p, 98, settings, rng)
        current = _safe_int(p.get("overall"), planned)

    # v14: enforce the planned target as a real maximum for every player.
    # The attribute mover can occasionally overshoot or fail to realize trims.
    # If the plan says a player should finish at 79, the final calculated OVR
    # cannot be allowed to display 80+ and leak through the shape lock.
    if current > planned:
        _force_overall_at_most(p, planned, settings, rng)




def _shape_metrics_from_players(players: List[Dict[str, Any]]) -> Dict[str, Any]:
    values = []
    for p in players:
        if not isinstance(p, dict):
            continue
        if isinstance(p.get("attrs"), list) and len(p.get("attrs") or []) > 0:
            values.append(calc_overall_from_attrs(p.get("attrs") or [], p.get("pos") or p.get("position") or "SF"))
        else:
            values.append(_safe_int(p.get("overall"), 0))
    top300 = _top_n_values(values, 300)
    return {
        "players": len(values),
        "avg": round(_avg_value(values, 0.0), 3),
        "median": round(_median_value(values, 0.0), 3),
        "top300Avg": round(_avg_value(top300, 0.0), 3),
        "top300Cutoff": int(top300[-1]) if top300 else 0,
        "top300_77_plus": sum(1 for v in top300 if v >= 77),
        "top300_80_plus": sum(1 for v in top300 if v >= 80),
        "top300_83_plus": sum(1 for v in top300 if v >= 83),
        "top300_85_plus": sum(1 for v in top300 if v >= 85),
        "top300_74_76": sum(1 for v in top300 if 74 <= v <= 76),
    }


def _metrics_from_plan(plan: List[Dict[str, Any]]) -> Dict[str, Any]:
    values = [int(item.get("target_overall", item.get("before_overall", 0))) for item in plan]
    top300 = _top_n_values(values, 300)
    return {
        "planPlayers": len(values),
        "top300Avg": round(_avg_value(top300, 0.0), 3),
        "top300Cutoff": int(top300[-1]) if top300 else 0,
        "top300_77_plus": sum(1 for v in top300 if v >= 77),
        "top300_80_plus": sum(1 for v in top300 if v >= 80),
        "top300_83_plus": sum(1 for v in top300 if v >= 83),
        "top300_85_plus": sum(1 for v in top300 if v >= 85),
        "top300_74_76": sum(1 for v in top300 if 74 <= v <= 76),
    }


def _build_current_shape_plan(league: Dict[str, Any]) -> List[Dict[str, Any]]:
    plan: List[Dict[str, Any]] = []
    for p, tname in _all_players_with_team(league):
        if not isinstance(p, dict):
            continue
        if isinstance(p.get("attrs"), list) and len(p.get("attrs") or []) > 0:
            p["attrs"] = _ensure_attrs(p.get("attrs"))
            formula_current = calc_overall_from_attrs(p.get("attrs") or [], p.get("pos") or p.get("position") or "SF")
            current = _safe_int(p.get("overall"), formula_current)
            if p.get("overall") is None:
                p["overall"] = current
        else:
            current = _safe_int(p.get("overall"), 70)

        original_marker = p.get("__progressionOriginalOverall")
        has_original = original_marker is not None
        before = _safe_int(original_marker, current) if has_original else current
        plan.append({
            "player": p,
            "team": tname,
            "before_overall": before,
            "target_delta": current - before,
            "target_overall": current,
            "shape_protected": _is_current_draft_shape_protected(p),
            "final_shape_only": not has_original,
        })
    return plan


def _apply_core_roster_shape_lock(
    plan: List[Dict[str, Any]],
    baseline: Dict[str, Any],
    settings: Dict[str, Any],
    rng: random.Random,
) -> None:
    """
    v17 core-league shape lock: top 14 active players per team.

    This is the main league-quality controller. It ignores autogenerated 60 OVR
    filler, deep stashes, and free-agent noise while keeping the playable NBA
    core close to the Y1 roster shape. Corrections are small and selective so
    player careers can still feel dynamic.
    """
    core_items = _core_items_from_plan(plan, 14)
    if not core_items:
        return

    core_base_avg = _safe_float(baseline.get("coreAvg"), 0.0)
    if core_base_avg <= 0:
        return

    # Tightest control in the old danger zone: 77-84. Slightly tight at 85-90+.
    rules = (
        (95, 1, 1, 94, 95, 99),
        (90, 3, 3, 89, 90, 94),
        (85, 5, 5, 84, 85, 89),
        (83, 6, 6, 82, 83, 86),
        (80, 8, 8, 79, 80, 84),
        (77, 10, 10, 76, 77, 82),
    )

    max_down = int((settings.get("progression", {}) or {}).get("core_shape_max_down", 72))
    max_up = int((settings.get("progression", {}) or {}).get("core_shape_max_up", 54))
    down_used = 0
    up_used = 0

    def current_core() -> List[Dict[str, Any]]:
        _refresh_plan_targets(plan)
        return _core_items_from_plan(plan, 14)

    # High-side: if core bands get crowded, trim lower-priority players by one.
    for threshold, _low_minus, high_plus, demote_to, max_lo, max_hi in rules:
        base_count = _core_cumulative_count_from_baseline(baseline, threshold)
        if base_count <= 0:
            continue
        high = base_count + high_plus
        for _ in range(3):
            if down_used >= max_down:
                break
            items = current_core()
            count = sum(1 for item in items if int(item["target_overall"]) >= threshold)
            if count <= high:
                break
            need = min(count - high, max_down - down_used)
            candidates = [
                item for item in items
                if int(item["target_overall"]) >= threshold
                and max_lo <= int(item["target_overall"]) <= max_hi
            ]
            if not candidates:
                candidates = [item for item in items if int(item["target_overall"]) >= threshold]
            candidates.sort(key=lambda item: _hard_shape_trim_priority(item, rng))
            applied = 0
            for item in candidates:
                if applied >= need:
                    break
                after = int(item["target_overall"])
                # For 95+ surplus, never auto-trim a young ceiling-hit player
                # first. Let older stars/low-upside players offset the new face.
                p = item.get("player") or {}
                age = _safe_int(p.get("age"), 25)
                if threshold >= 95 and _player_dev_path_value(p) == "ceiling_hit" and age <= 27:
                    continue
                desired = min(demote_to, after - 1)
                if desired < after:
                    _set_plan_target(item, desired)
                    applied += 1
                    down_used += 1
            if applied <= 0:
                break

    # Band-specific crowd control for 77-84. This is where old versions flooded.
    band_base = baseline.get("coreBandCounts") if isinstance(baseline.get("coreBandCounts"), dict) else {}
    band_rules = (
        ("77_80", 77, 80, 8),
        ("81_82", 81, 82, 5),
        ("83_84", 83, 84, 5),
        ("85_87", 85, 87, 4),
        ("88_89", 88, 89, 3),
    )
    for label, lo, hi, plus in band_rules:
        if down_used >= max_down:
            break
        base = _safe_int(band_base.get(label), 0)
        if base <= 0:
            continue
        items = current_core()
        current = [item for item in items if lo <= int(item["target_overall"]) <= hi]
        high = base + plus
        if len(current) <= high:
            continue
        need = min(len(current) - high, max_down - down_used)
        current.sort(key=lambda item: _hard_shape_trim_priority(item, rng))
        applied = 0
        for item in current:
            if applied >= need:
                break
            after = int(item["target_overall"])
            desired = max(60, after - 1)
            if desired < after:
                _set_plan_target(item, desired)
                down_used += 1
                applied += 1

    # Low-side: protect/boost plausible rostered players when core shape falls
    # below floor. This lets old stars decline while new faces replace them.
    for threshold, low_minus, _high_plus, _demote_to, _max_lo, _max_hi in reversed(rules):
        base_count = _core_cumulative_count_from_baseline(baseline, threshold)
        if base_count <= 0:
            continue
        low = max(0, base_count - low_minus)
        for _ in range(4):
            if up_used >= max_up:
                break
            items = current_core()
            count = sum(1 for item in items if int(item["target_overall"]) >= threshold)
            if count >= low:
                break
            need = min(low - count, max_up - up_used)
            candidates = [item for item in items if _can_shape_shortage_boost(item, threshold)]
            # 95+ boosts are only for real ceiling-hit / elite paths near the band.
            if threshold >= 95:
                candidates = [
                    item for item in candidates
                    if _player_dev_path_value(item.get("player") or {}) == "ceiling_hit"
                    and int(item["target_overall"]) >= 92
                ]
            candidates.sort(key=lambda item: _shape_shortage_boost_priority(item, threshold, rng), reverse=True)
            applied = 0
            for item in candidates:
                if applied >= need:
                    break
                after = int(item["target_overall"])
                p = item.get("player") or {}
                pot = _safe_int(p.get("potential"), after)
                desired = min(after + 1, threshold, pot)
                # 77/80/83 shortage can pull close players one step; no large
                # artificial jumps from shape lock.
                if desired > after:
                    _set_plan_target(item, desired)
                    applied += 1
                    up_used += 1
            if applied <= 0:
                break

    _refresh_plan_targets(plan)

    # Average core corridor only nudges by one point. We do not care if full
    # league average falls because filler classes add 60 OVR bodies.
    min_avg = core_base_avg - 0.45
    max_avg = core_base_avg + 0.45
    for _ in range(4):
        items = current_core()
        vals = [int(item["target_overall"]) for item in items]
        if not vals:
            break
        avg = _avg_value(vals, core_base_avg)
        if avg > max_avg and down_used < max_down:
            need = min(int(math.ceil((avg - max_avg) * len(vals) * 0.50)), max_down - down_used)
            candidates = [item for item in items if 77 <= int(item["target_overall"]) <= 89]
            candidates.sort(key=lambda item: _hard_shape_trim_priority(item, rng))
            for item in candidates[:need]:
                _set_plan_target(item, int(item["target_overall"]) - 1)
                down_used += 1
        elif avg < min_avg and up_used < max_up:
            need = min(int(math.ceil((min_avg - avg) * len(vals) * 0.50)), max_up - up_used)
            candidates = [item for item in items if _can_shape_shortage_boost(item, min(90, int(item["target_overall"]) + 1))]
            candidates.sort(key=lambda item: _shape_shortage_boost_priority(item, min(90, int(item["target_overall"]) + 1), rng), reverse=True)
            for item in candidates[:need]:
                after = int(item["target_overall"])
                pot = _safe_int((item.get("player") or {}).get("potential"), after)
                _set_plan_target(item, min(after + 1, pot))
                up_used += 1
        else:
            break

    _refresh_plan_targets(plan)


def _apply_final_shape_lock_to_current_league(
    league: Dict[str, Any],
    settings: Dict[str, Any],
    rng: random.Random,
) -> Dict[str, Any]:
    if not isinstance(league, dict):
        return {}

    before_metrics = _shape_metrics_from_players(_all_players(league))
    has_original_markers = any(
        isinstance(p, dict) and p.get("__progressionOriginalOverall") is not None
        for p in _all_players(league)
    )
    # Progression reconciliation can make multiple passes because every player
    # is still bounded by the true pre-progression OVR. Lifecycle-only calls are
    # intentionally one-pass, one-rung adjustments.
    max_passes = 4 if has_original_markers else 1
    pass_debug: List[Dict[str, Any]] = []
    baseline: Dict[str, Any] = {}
    final_audit: Dict[str, Any] = audit_current_league_shape(league)

    for pass_index in range(max_passes):
        plan = _build_current_shape_plan(league)
        baseline = _get_or_create_progression_baseline(league, plan, settings)
        planned_audit = _apply_true_hard_shape_lock(plan, settings, rng)
        planned_metrics = _metrics_from_plan(plan)

        changed = 0
        for item in plan:
            p = item["player"]
            current = int(_clamp(_safe_int(p.get("overall"), 70), 25, 99))
            target = int(item.get("target_overall", current))
            if target < current:
                _force_overall_at_most(p, target, settings, rng)
            elif target > current:
                _move_attrs_toward_target_overall(p, target, settings, rng)
            # Listed OVR is the source of truth. Attribute movement keeps the
            # profile directionally aligned; it cannot override the hard shelf.
            p["overall"] = target
            if target != current:
                changed += 1
                p.pop("marketValue", None)

        _finalize_potential_floor(league)
        final_audit = audit_current_league_shape(league)
        pass_debug.append({
            "pass": pass_index + 1,
            "changedPlayers": changed,
            "planned": planned_metrics,
            "plannedAudit": planned_audit,
            "actualAudit": final_audit,
        })
        if final_audit.get("ok") is True:
            break
        if changed <= 0:
            break

    after_metrics = _shape_metrics_from_players(_all_players(league))
    return {
        "version": PROGRESSION_PY_VERSION,
        "before": before_metrics,
        "after": after_metrics,
        "hardShapeAudit": final_audit,
        "passes": pass_debug,
        "baselineCreatedBy": baseline.get("createdBy") if isinstance(baseline, dict) else None,
        "baselineVersion": baseline.get("version") if isinstance(baseline, dict) else None,
    }


def _finalize_potential_floor(league: Dict[str, Any]) -> None:
    """Potential must never display below current overall.

    Shape locks run after dynamic POT recalculation and can change OVR by one
    point. This final pass keeps the visible model sane: veterans use POT as
    current ability, while younger players keep at least their current OVR as
    their floor.
    """
    if not isinstance(league, dict):
        return
    for p, _tname in _all_players_with_team(league):
        if not isinstance(p, dict):
            continue
        overall = int(_clamp(_safe_int(p.get("overall"), 70), 25, 99))
        age = _safe_int(p.get("age"), 25)
        potential = _safe_int(p.get("potential"), overall)
        if age >= 29:
            final_potential = overall
        else:
            final_potential = int(_clamp(max(potential, overall), overall, 99))
        p["potential"] = final_potential
        if "pot" in p:
            p["pot"] = final_potential



def _reconcile_potential_after_final_shape(
    league: Dict[str, Any],
    before: Dict[str, Dict[str, Any]],
    settings: Dict[str, Any],
    rng: random.Random,
) -> None:
    for p, tname in _all_players_with_team(league):
        if _is_current_draft_shape_protected(p):
            continue
        key = f"{_player_name(p)}__{tname}"
        old = before.get(key)
        if not old:
            continue
        p["potential"] = _predict_dynamic_potential_after_progression(
            old_age=_safe_int(old.get("age"), 25),
            new_age=_safe_int(p.get("age"), _safe_int(old.get("age"), 25) + 1),
            old_overall=_safe_int(old.get("overall"), 70),
            new_overall=_safe_int(p.get("overall"), _safe_int(old.get("overall"), 70)),
            old_potential=_safe_int(old.get("potential"), _safe_int(old.get("overall"), 70)),
            settings=settings,
            rng=rng,
            player=p,
            team_name=tname,
            stats=None,
        )
    _finalize_potential_floor(league)



def _before_snapshot_from_progression_markers(league: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    before: Dict[str, Dict[str, Any]] = {}
    if not isinstance(league, dict):
        return before
    for p, tname in _all_players_with_team(league):
        if not isinstance(p, dict):
            continue
        marker = p.get("__progressionOriginalOverall")
        if marker is None:
            continue
        key = f"{_player_name(p)}__{tname}"
        before[key] = {
            "overall": _safe_int(marker, _safe_int(p.get("overall"), 70)),
            "potential": _safe_int(p.get("__progressionOriginalPotential"), _safe_int(p.get("potential"), _safe_int(marker, 70))),
            "age": _safe_int(p.get("__progressionOriginalAge"), max(18, _safe_int(p.get("age"), 25) - 1)),
        }
    return before

def apply_final_league_shape_lock(
    league: Dict[str, Any],
    settings: Optional[Dict[str, Any]] = None,
    seed: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Public post-offseason hook.

    Call this after retirements, draft imports, rookie signings, free agency,
    and any roster movement. This is the missing lifecycle step that prevents
    rookies/free agents/two-ways/stashes from rebuilding the 77-84 flood after
    progression.py already locked the old roster.
    """
    if not isinstance(league, dict):
        return {"league": league, "debug": {}, "version": PROGRESSION_PY_VERSION}
    settings = settings or DEFAULT_SETTINGS
    rng = random.Random(seed)
    debug = _apply_final_shape_lock_to_current_league(league, settings, rng)
    before = _before_snapshot_from_progression_markers(league)
    if before:
        _reconcile_potential_after_final_shape(league, before, settings, rng)
    _finalize_potential_floor(league)
    return {"league": league, "debug": debug, "version": PROGRESSION_PY_VERSION}

def _enforce_actual_yearly_delta_window(
    p: Dict[str, Any],
    item: Dict[str, Any],
    settings: Dict[str, Any],
    rng: random.Random,
) -> None:
    """Keep actual calculated OVR inside the user-facing yearly movement cap."""
    before = int(item.get("before_overall", _safe_int(p.get("overall"), 70)))
    lo, hi = _yearly_delta_caps_for_item(item)
    min_allowed = int(_clamp(before + lo, 60, 99))
    max_allowed = int(_clamp(before + hi, 60, 99))
    current = _safe_int(p.get("overall"), before)
    if current > max_allowed:
        _force_overall_at_most(p, max_allowed, settings, rng)
        current = _safe_int(p.get("overall"), current)
    if current < min_allowed:
        _move_attrs_toward_target_overall(p, min_allowed, settings, rng)
        current = _safe_int(p.get("overall"), current)
        if current > max_allowed:
            _force_overall_at_most(p, max_allowed, settings, rng)


def apply_end_of_season_progression(
    league: Dict[str, Any],
    stats_by_key: Optional[Dict[str, Dict[str, Any]]] = None,
    settings: Optional[Dict[str, Any]] = None,
    seed: Optional[int] = None
) -> Dict[str, Any]:
    """
    Run once after playoffs/awards, before next season.

    This only changes attributes and overall. Frontend V19 recomputes derived fields.
    Potential is updated after age-up in apply_end_of_season_progression_with_deltas.
    """
    if not isinstance(league, dict):
        return league

    settings = settings or DEFAULT_SETTINGS
    rng = random.Random(seed)

    plan = _compute_raw_progression_plan(league, stats_by_key, settings, rng)
    _apply_league_rating_governor(league, plan, settings, rng)
    _apply_elite_peak_caps(plan, settings, rng)
    _apply_true_hard_shape_lock(plan, settings, rng)

    for item in plan:
        p = item["player"]
        before_overall = int(item["before_overall"])
        target_overall = int(item["target_overall"])

        if _is_shape_protected_item(item):
            # Shape-only current-draft rookies are returned untouched.
            p["overall"] = before_overall
            continue
        target_delta = target_overall - before_overall

        if target_delta == 0:
            formula_now = calc_overall_from_attrs(_ensure_attrs(p.get("attrs")), p.get("pos") or p.get("position") or "SF")
            if formula_now != before_overall:
                _move_attrs_toward_target_overall(p, before_overall, settings, rng)
                # If the formula cannot fully reconcile to the curated file OVR
                # in one offseason, preserve the intended listed OVR rather than
                # creating a fake regression before progression even starts.
                if _safe_int(p.get("overall"), before_overall) != before_overall:
                    p["overall"] = before_overall
            else:
                _apply_small_attribute_churn(p, settings, rng)
        else:
            _move_attrs_toward_target_overall(p, target_overall, settings, rng)
            if _safe_int(p.get("overall"), target_overall) != target_overall:
                p["overall"] = target_overall

        _enforce_post_attribute_elite_cap(p, item, settings, rng)
        _enforce_actual_yearly_delta_window(p, item, settings, rng)

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
    seen = set()

    def add_player(p: Dict[str, Any]) -> None:
        if not isinstance(p, dict):
            return
        key = str(p.get("id") or p.get("name") or len(out))
        if key in seen:
            return
        seen.add(key)
        out.append(p)

    for t in _iter_teams(league):
        for bucket in ["players", "twoWayPlayers", "stashPlayers"]:
            for p in (t.get(bucket) or []):
                add_player(p)

    for p in _iter_free_agents(league):
        add_player(p)

    return out


def _all_players_with_team(league: Dict[str, Any]) -> List[Tuple[Dict[str, Any], str]]:
    """
    All progression-relevant players with a team context.

    v14 includes normal roster, two-way, stash, and free-agent buckets. The
    tracker/PDF counts those players, so the progression/shape lock must also
    control those players. Previous versions only planned team.players + FAs,
    which meant two-way/stash rookies could sit outside the shape governor.
    """
    out: List[Tuple[Dict[str, Any], str]] = []
    seen = set()

    def add(p: Dict[str, Any], tname: str) -> None:
        if not isinstance(p, dict):
            return
        key = str(p.get("id") or f"{p.get('name')}__{tname}")
        if key in seen:
            return
        seen.add(key)
        out.append((p, tname))

    for t in _iter_teams(league):
        tname = _team_name(t)
        for bucket in ("players", "twoWayPlayers", "stashPlayers"):
            for p in (t.get(bucket) or []):
                add(p, tname)

    for p in _iter_free_agents(league):
        add(p, "__FREE_AGENCY__")

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
        if _is_current_draft_shape_protected(p):
            continue
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

    _v25_league_seed(league, seed)
    ensure_progression_fields(league, season_start_year = season_year)
    v25_career_audit = _ensure_v25_profiles_for_league(league, seed, season_year)

    before: Dict[str, Dict[str, Any]] = {}
    for p, tname in _all_players_with_team(league):
        name = _player_name(p)
        key = f"{name}__{tname}"

        if isinstance(p.get("attrs"), list) and len(p.get("attrs") or []) > 0:
            p["attrs"] = _ensure_attrs(p.get("attrs"))
            if p.get("overall") is None:
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
        rng = rng,
        stats_by_key = stats_by_key,
    )

    # Preserve each player's true pre-progression OVR for the final saved-pool
    # reconciliation. Without this marker a second shape pass can accidentally
    # stack another +1 on top of a +4 roll, or another decline on top of -5.
    for p, tname in _all_players_with_team(league):
        key = f"{_player_name(p)}__{tname}"
        old = before.get(key)
        if old is not None:
            p["__progressionOriginalOverall"] = _safe_int(old.get("overall"), _safe_int(p.get("overall"), 70))
            p["__progressionOriginalPotential"] = _safe_int(old.get("potential"), _safe_int(p.get("potential"), _safe_int(p.get("overall"), 70)))
            p["__progressionOriginalAge"] = _safe_int(old.get("age"), max(18, _safe_int(p.get("age"), 25) - 1))

    # Final lock for all currently loaded buckets after potential update.
    # The public apply_final_league_shape_lock() is also called after frontend
    # transformations and after roster lifecycle events.
    shape_debug = _apply_final_shape_lock_to_current_league(league, settings, rng)
    _reconcile_potential_after_final_shape(league, before, settings, rng)

    _finalize_potential_floor(league)
    _update_development_momentum(league, before)

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

    return {"league": league, "deltas": deltas, "version": PROGRESSION_PY_VERSION, "debug": {"shapeLock": shape_debug, "careerAudit": v25_career_audit}}