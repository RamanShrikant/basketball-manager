# progression_v17_dynamic_core_shape_ceiling_hit.py
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple
import random
import math
import datetime as _dt

PROGRESSION_PY_VERSION = "2026-06-23_progression_v19_absolute_derived_formula"


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
        # v11 adds a top-300 playable-core governor, keeps deep band guards,
        # makes young low/mid development less automatic, and hard-enforces
        # planned caps after attributes are moved.
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
        "ninety_nine_stay_chance": 0.10,
        "ninety_eight_stay_chance": 0.50,

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
        # How strongly potential moves toward the age + overall formula.
        # Lower values preserve old potential more.
        "young_anchor_pull": 0.055,
        "mid_anchor_pull": 0.055,
        "late_anchor_pull": 0.045,

        # How strongly this season's OVR change affects potential.
        "young_progress_signal": 0.055,
        "mid_progress_signal": 0.050,
        "late_progress_signal": 0.040,

        # Potential volatility.
        "young_noise": 0.105,
        "mid_noise": 0.100,
        "late_noise": 0.095,
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

    num90 = sum(1 for v in a if float(v) > 90.0)
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
    team_name: str = ""
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

    # v13: failed/flat low-mid development must actually close the ceiling.
    # This is intentionally harsh; otherwise the same 70-76 prospects keep
    # getting infinite yearly chances until the league floods with 77-84s.
    if new_age <= 27 and new_overall < 83:
        pot_gap_after = max(0, old_potential - new_overall)
        # v16: v16 closed ceilings too aggressively and crushed entire draft
        # classes by year 5-7. Failed years still matter, but rostered prospects
        # need an evaluation window so one flat season does not erase their
        # ceiling immediately.
        if ovr_delta <= -2:
            raw_delta -= 0.72
        elif ovr_delta == -1:
            raw_delta -= 0.38
        elif ovr_delta == 0:
            raw_delta -= 0.14
        if new_age >= 24 and new_overall < 77:
            raw_delta -= 0.12
        if new_age >= 25 and new_overall < 80:
            raw_delta -= 0.08
        if pot_gap_after >= 10 and ovr_delta <= 0:
            raw_delta -= 0.10

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

    player = player or {}
    dev_path = _player_dev_path_value(player) if isinstance(player, dict) else ""
    draft_slot = _draft_slot_value(player) if isinstance(player, dict) else 999
    tier_text = str(player.get("tier") or player.get("prospectTier") or "").lower() if isinstance(player, dict) else ""
    premium_label = ("elite" in tier_text) or ("lottery" in tier_text)
    top_lottery = draft_slot <= 10 or premium_label
    first_round = draft_slot <= 30

    # Only true premium prospects get patience. Normal 70s prospects should
    # lose ceiling after flat/bad years so they stop re-entering the growth
    # pipeline forever.
    true_premium = new_age <= 25 and old_potential >= 94 and (old_overall >= 74 or top_lottery)
    strong_pedigree = new_age <= 25 and old_potential >= 89 and (old_overall >= 74 or first_round)
    if dev_path == "ceiling_hit" and new_age <= 27 and old_potential >= 84:
        # Ceiling-hit players are still allowed to bust by failing to improve,
        # but their listed ceiling should not disappear before their prime
        # window. This makes 5-10% potential hits possible without broad
        # potential inflation.
        if ovr_delta >= 0 and pot_delta < 0:
            pot_delta = 0
        elif ovr_delta == -1 and pot_delta < -1:
            pot_delta = -1
        elif ovr_delta <= -2 and pot_delta < -1 and new_age <= 24:
            pot_delta = -1
        elif ovr_delta <= -2 and pot_delta < -2:
            pot_delta = -2

    if true_premium:
        # High-pedigree prospects can still bust, but their ceiling should not
        # evaporate after one or two flat seasons. This was the main issue in
        # the v16 2026 rookie cohort.
        if ovr_delta >= 0 and pot_delta < 0:
            pot_delta = 0
        elif ovr_delta == -1 and pot_delta < -1:
            pot_delta = -1
        elif ovr_delta <= -2 and pot_delta < -2:
            pot_delta = -2
    elif strong_pedigree and pot_delta < -1:
        pot_delta = -1

    # Strong progression should protect potential only for real prospects.
    if ovr_delta >= 2 and new_age <= 25 and old_potential >= 90 and pot_delta < 0:
        pot_delta = 0

    if ovr_delta >= 4 and new_age <= 24 and old_potential >= 94 and pot_delta < 1:
        pot_delta = 1

    # Bad/flat low-mid years should not increase potential for normal players.
    # Premium prospects can hold ceiling, but not gain ceiling while failing.
    if ovr_delta <= 0 and new_age <= 26 and new_overall < 80 and pot_delta > 0:
        pot_delta = 0
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
            rng = rng,
            player = p,
            team_name = tname
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



def _stat_context(stats: Optional[Dict[str, Any]], settings: Dict[str, Any]) -> Tuple[float, float]:
    """
    Return a tiny minutes/production nudge.

    Missing stats are neutral. Provided stats are only a small tiebreaker.
    This prevents simulated box-score quirks from becoming a major progression
    engine.
    """
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

    # v11 allowed +/-0.35 expected OVR. v12 makes this almost irrelevant.
    prod_adj = _clamp((prod_score - 20.0) / 70.0, -0.08, 0.08) if prod_score > 0 else 0.0
    return min_fac, prod_adj


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
        pressure += 0.18
    if age >= 34:
        pressure += 0.16
    if age >= 35:
        pressure += 0.18
    if age >= 36:
        pressure += 0.20

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


def _gate_chance_with_path(dev_path: str, level: str, normal: float, strong: float, elite: float) -> float:
    chance = _gate_chance(level, normal, strong, elite)
    if dev_path == "ceiling_hit":
        chance += 0.20
    elif dev_path == "star":
        chance += 0.08
    elif dev_path in {"good", "late_bloomer"}:
        chance += 0.035
    elif dev_path == "bust":
        chance -= 0.09
    elif dev_path == "slow":
        chance -= 0.04
    return float(_clamp(chance, 0.0, 0.94))


def _ceiling_lane_expected_bonus(
    p: Dict[str, Any],
    team_name: str,
    age: int,
    overall: int,
    potential: int,
    rng: random.Random,
) -> float:
    """Small expected-value push for saved ceiling/star paths near their prime."""
    path = _dev_path_for_player(p, team_name, age, overall, potential, rng)
    gap = max(0, potential - overall)
    if gap <= 0 or age > 28:
        return 0.0

    if path == "ceiling_hit":
        if potential >= 95 and age <= 27:
            if overall < 85:
                return 0.10
            if overall < 88:
                return 0.18
            if overall < 91:
                return 0.28
            if overall < 94:
                return 0.42
            if overall < potential:
                return 0.30
        if age <= 26 and potential >= 84:
            return 0.12
    elif path == "star":
        if age <= 26 and potential >= 90 and overall < min(potential, 91):
            return 0.12 if overall < 88 else 0.08
    elif path in {"good", "late_bloomer"}:
        if age <= 25 and potential >= 84 and overall < min(potential, 85):
            return 0.045
    elif path == "bust":
        return -0.12 if age <= 25 and overall < 85 else -0.04
    elif path == "slow":
        return -0.04
    return 0.0


def _ceiling_lane_raw_adjustment(
    p: Dict[str, Any],
    team_name: str,
    age: int,
    overall: int,
    potential: int,
    rng: random.Random,
) -> float:
    """Rare star/ceiling burst layered after ordinary variance."""
    path = _dev_path_for_player(p, team_name, age, overall, potential, rng)
    gap = max(0, potential - overall)
    if age > 28 or gap <= 0:
        return 0.0

    if path == "ceiling_hit" and potential >= 95:
        # The missing lane from v16: a 90-94 OVR elite prospect can actually
        # touch 95-98 in some sims. Shape lock then offsets elsewhere.
        if 92 <= overall < potential and rng.random() < 0.26:
            return rng.uniform(0.75, 2.05)
        if 88 <= overall < 92 and rng.random() < 0.22:
            return rng.uniform(0.55, 1.45)
        if 80 <= overall < 88 and rng.random() < 0.12:
            return rng.uniform(0.45, 1.20)
    if path == "ceiling_hit" and potential >= 84 and overall < potential and rng.random() < 0.08:
        return rng.uniform(0.35, 1.10)
    if path == "star" and potential >= 90 and overall < min(potential, 92) and rng.random() < 0.075:
        return rng.uniform(0.30, 1.10)
    if path == "volatile":
        return rng.choice([-1.0, 1.0]) * rng.uniform(0.25, 1.10) if rng.random() < 0.16 else 0.0
    if path == "bust" and rng.random() < 0.09:
        return -rng.uniform(0.30, 1.20)
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
    dev_path = _player_dev_path_value(p)

    if dev_path == "ceiling_hit" and age <= 27 and potential >= 84 and overall >= 68:
        return "elite" if potential >= 90 or overall >= 78 else "strong"
    if dev_path == "star" and age <= 27 and potential >= 86 and overall >= 70:
        return "strong"

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
    """
    v17 free-agent volatility table.

    Free agents are still slightly negative on average, but no longer dead.
    They can improve, hold, or regress in controlled probabilities so the FA
    market feels alive without flooding the core top-14 roster shape.
    """
    age = _safe_int(age, 25)
    overall = _safe_int(overall, 70)

    if age <= 27:
        if level == "elite":
            dist = [(-3, 0.010), (-2, 0.055), (-1, 0.210), (0, 0.405), (1, 0.230), (2, 0.075), (3, 0.015)]
        elif level == "strong":
            dist = [(-3, 0.018), (-2, 0.080), (-1, 0.260), (0, 0.400), (1, 0.175), (2, 0.055), (3, 0.012)]
        else:
            if overall < 74:
                dist = [(-3, 0.035), (-2, 0.120), (-1, 0.310), (0, 0.405), (1, 0.105), (2, 0.022), (3, 0.003)]
            elif overall <= 80:
                dist = [(-3, 0.028), (-2, 0.105), (-1, 0.285), (0, 0.405), (1, 0.130), (2, 0.038), (3, 0.009)]
            else:
                dist = [(-3, 0.025), (-2, 0.100), (-1, 0.280), (0, 0.410), (1, 0.145), (2, 0.035), (3, 0.005)]
    elif age <= 32:
        if level == "elite":
            dist = [(-3, 0.020), (-2, 0.090), (-1, 0.290), (0, 0.405), (1, 0.155), (2, 0.035), (3, 0.005)]
        else:
            dist = [(-3, 0.035), (-2, 0.145), (-1, 0.345), (0, 0.355), (1, 0.100), (2, 0.018), (3, 0.002)]
    else:
        # Older unsigned vets should usually decline, but max yearly drop is
        # capped elsewhere and a flat/mini-rebound remains possible.
        dist = [(-5, 0.010), (-4, 0.030), (-3, 0.105), (-2, 0.255), (-1, 0.360), (0, 0.205), (1, 0.032), (2, 0.003)]

    delta = _sample_delta_from_distribution(rng, dist)
    return int(_clamp(delta, -5 if age >= 34 else -3, 3))

def _controlled_low_mid_delta(
    p: Dict[str, Any],
    team_name: str,
    age: int,
    overall: int,
    potential: int,
    settings: Dict[str, Any],
    rng: random.Random,
) -> Optional[int]:
    """
    v14 probability lock.

    Low/mid players are controlled by explicit outcome odds, not by an additive
    age + potential formula. Potential is only an upside signal; most players
    with decent potential still stall, regress, or remain near their current
    rating. Free agents get a meaningfully harsher table.
    """
    age = _safe_int(age, 25)
    overall = _safe_int(overall, 70)
    potential = _safe_int(potential, overall)

    if overall >= 85 or age >= 30:
        return None

    level = _prospect_level_context(p, team_name, age, overall, potential)
    dev_path = _dev_path_for_player(p, team_name, age, overall, potential, rng)

    if team_name == "__FREE_AGENCY__":
        return _controlled_free_agent_low_mid_delta(age, overall, level, rng)

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

    # v16 balanced tables.
    # v14 proved the structure worked but overcorrected. These distributions
    # keep +2/+3 rare while allowing enough rostered young players to hold the
    # league's 77/80/83 bands steady over time. Free agents still use the much
    # harsher table above.
    young_normal = {
        "under70": [(-3, 0.025), (-2, 0.090), (-1, 0.255), (0, 0.500), (1, 0.105), (2, 0.022), (3, 0.003)],
        "70_73":  [(-3, 0.020), (-2, 0.080), (-1, 0.240), (0, 0.490), (1, 0.140), (2, 0.027), (3, 0.003)],
        "74_76":  [(-3, 0.016), (-2, 0.070), (-1, 0.220), (0, 0.480), (1, 0.175), (2, 0.035), (3, 0.004)],
        "77_80":  [(-3, 0.012), (-2, 0.060), (-1, 0.200), (0, 0.460), (1, 0.215), (2, 0.047), (3, 0.006)],
        "81_84":  [(-3, 0.010), (-2, 0.050), (-1, 0.180), (0, 0.460), (1, 0.235), (2, 0.055), (3, 0.010)],
    }
    young_strong = {
        "under70": [(-3, 0.018), (-2, 0.070), (-1, 0.210), (0, 0.465), (1, 0.185), (2, 0.045), (3, 0.007)],
        "70_73":  [(-3, 0.015), (-2, 0.060), (-1, 0.195), (0, 0.445), (1, 0.220), (2, 0.055), (3, 0.010)],
        "74_76":  [(-3, 0.012), (-2, 0.052), (-1, 0.175), (0, 0.425), (1, 0.255), (2, 0.067), (3, 0.014)],
        "77_80":  [(-3, 0.010), (-2, 0.045), (-1, 0.155), (0, 0.405), (1, 0.285), (2, 0.080), (3, 0.020)],
        "81_84":  [(-3, 0.008), (-2, 0.040), (-1, 0.140), (0, 0.410), (1, 0.295), (2, 0.085), (3, 0.022)],
    }
    young_elite = {
        "under70": [(-3, 0.008), (-2, 0.040), (-1, 0.150), (0, 0.415), (1, 0.270), (2, 0.090), (3, 0.027)],
        "70_73":  [(-3, 0.006), (-2, 0.035), (-1, 0.130), (0, 0.395), (1, 0.295), (2, 0.105), (3, 0.034)],
        "74_76":  [(-3, 0.005), (-2, 0.030), (-1, 0.115), (0, 0.370), (1, 0.325), (2, 0.120), (3, 0.035)],
        "77_80":  [(-3, 0.004), (-2, 0.026), (-1, 0.095), (0, 0.355), (1, 0.340), (2, 0.135), (3, 0.045)],
        "81_84":  [(-3, 0.004), (-2, 0.024), (-1, 0.085), (0, 0.365), (1, 0.330), (2, 0.145), (3, 0.047)],
    }

    if age <= 24:
        table = young_elite if level == "elite" else young_strong if level == "strong" else young_normal
        delta = _sample_delta_from_distribution(rng, table[band])
        if age <= 20 and level in {"strong", "elite"} and delta <= 1 and rng.random() < (0.04 if level == "strong" else 0.08):
            delta += 1
    elif age == 25:
        if level == "elite":
            dist = [(-3, 0.012), (-2, 0.055), (-1, 0.185), (0, 0.450), (1, 0.225), (2, 0.060), (3, 0.013)]
        elif level == "strong":
            dist = [(-3, 0.018), (-2, 0.080), (-1, 0.245), (0, 0.440), (1, 0.170), (2, 0.042), (3, 0.005)]
        else:
            dist = [(-3, 0.030), (-2, 0.110), (-1, 0.300), (0, 0.405), (1, 0.130), (2, 0.023), (3, 0.002)]
        delta = _sample_delta_from_distribution(rng, dist)
    else:
        if level == "elite" and age <= 27:
            dist = [(-3, 0.012), (-2, 0.060), (-1, 0.230), (0, 0.430), (1, 0.210), (2, 0.052), (3, 0.006)]
        elif level == "strong" and age <= 27:
            dist = [(-3, 0.022), (-2, 0.095), (-1, 0.285), (0, 0.410), (1, 0.155), (2, 0.030), (3, 0.003)]
        else:
            dist = [(-3, 0.035), (-2, 0.130), (-1, 0.335), (0, 0.390), (1, 0.100), (2, 0.010), (3, 0.000)]
        delta = _sample_delta_from_distribution(rng, dist)

    # v16 rostered-player oxygen: v16 kept free agents under control but made
    # rostered young/prime players too negative. Convert some deep negatives
    # to flat and some flat years to +1, then let the top300 shape lock trim if
    # the league actually gets too high. Free agents never reach this block.
    if team_name != "__FREE_AGENCY__" and age <= 27 and overall < 85:
        if delta <= -2 and overall >= 68 and rng.random() < (0.62 if age <= 24 else 0.48):
            delta += 1
        if delta == -1 and overall >= 70 and rng.random() < (0.34 if age <= 24 else 0.24):
            delta = 0
        flat_to_plus = 0.0
        if age <= 24:
            flat_to_plus = 0.20 if level == "normal" else 0.28 if level == "strong" else 0.34
        elif age <= 27:
            flat_to_plus = 0.10 if level == "normal" else 0.18 if level == "strong" else 0.24
        # Do not manufacture a bunch of below-70 risers; shortage boosts handle
        # league shape. This is mainly to keep 72-84 rostered players alive.
        if delta == 0 and overall >= 72 and rng.random() < flat_to_plus:
            delta = 1
        # Anti-graveyard floor: the app can accumulate hundreds of rostered
        # young bodies over long saves. Do not repeatedly grind rostered
        # prospects from the high-60s into the low-60s; free agents can still
        # wash out through their own harsher table.
        if overall <= 65:
            delta = max(delta, 0)
        elif overall <= 68:
            delta = max(delta, 0 if (level in {"strong", "elite"} or potential >= 80) else -1)
        elif age <= 24 and overall >= 68:
            delta = max(delta, -1)
        elif age <= 27 and overall >= 74:
            delta = max(delta, -1)

    # Persistent career path overlay. This is intentionally modest: it creates
    # different career stories without making every young player a riser.
    if team_name != "__FREE_AGENCY__":
        gap = max(0, potential - overall)
        if dev_path == "ceiling_hit" and age <= 26 and gap > 0:
            if delta <= 0 and rng.random() < (0.34 if potential >= 95 else 0.18):
                delta += 1
            elif delta == 1 and potential >= 95 and overall >= 80 and rng.random() < 0.14:
                delta += 1
        elif dev_path == "star" and age <= 25 and gap > 0:
            if delta <= 0 and rng.random() < 0.16:
                delta += 1
        elif dev_path in {"good", "late_bloomer"} and age <= 25 and gap > 0:
            if delta <= -1 and rng.random() < 0.10:
                delta += 1
        elif dev_path == "bust" and age <= 25:
            if delta > 0 and rng.random() < 0.28:
                delta -= 1
        elif dev_path == "slow" and age <= 25:
            if delta > 1:
                delta -= 1

    if level == "normal" and overall < 81:
        delta = min(delta, 2)
    if level != "elite" and overall < 77:
        delta = min(delta, 2)

    if potential <= overall + 1 and delta > 0 and dev_path != "ceiling_hit" and rng.random() < 0.55:
        delta = max(0, delta - 1)

    if age >= 24 and overall < 77 and delta > 0 and level == "normal" and rng.random() < 0.35:
        delta -= 1

    return int(_clamp(delta, -3, 3))

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
    controlled_delta = _controlled_low_mid_delta(p, team_name, age, overall, potential, settings, rng)
    if controlled_delta is not None:
        return controlled_delta

    min_fac, prod_adj = _stat_context(stats, settings)

    expected = _age_expected_delta(age)
    expected += _potential_gap_effect(age, overall, potential)
    expected += _star_pipeline_bonus(age, overall, potential)
    expected += _ceiling_lane_expected_bonus(p, team_name, age, overall, potential, rng)
    expected -= _elite_aging_pressure(age, overall)

    if expected > 0:
        expected *= (0.96 + 0.04 * min_fac)

    expected += prod_adj
    expected = _high_overall_resistance(age, overall, expected, potential)
    expected = _low_overall_young_dampener(age, overall, potential, expected)

    cfg = settings.get("progression", {}) or {}
    variance_mult = float(cfg.get("variance_mult", 1.0))
    sigma = _variance_sigma(age, overall) * variance_mult

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
        })

    return plan



_PROGRESS_TIER_THRESHOLDS = (77, 80, 81, 83, 85, 88, 90, 92, 93, 94, 95, 96, 97)
# Cumulative governors protect the league ceiling.
_PROGRESS_FULL_CONTROL_TIERS = (97, 96, 95, 94, 93, 92, 90, 88, 85)
# Cumulative depth tiers are anti-inflation only.
_PROGRESS_DEPTH_TRIM_ONLY_TIERS = (83, 81, 80, 77)

# Band governors protect the exact Y1 shape inside the ceiling and below it.
# Format: (label, low_inclusive, high_inclusive, mode)
# mode="full" can shortage-boost carefully; mode="trim" never boosts.
_PROGRESS_BANDS = (
    ("97_99", 97, 99, "full"),
    ("95_96", 95, 96, "full"),
    ("92_94", 92, 94, "light"),
    ("90_91", 90, 91, "light"),
    ("88_89", 88, 89, "trim"),
    ("85_87", 85, 87, "trim"),
    ("83_84", 83, 84, "trim"),
    ("81_82", 81, 82, "trim"),
    ("77_80", 77, 80, "trim"),
    ("74_76", 74, 76, "trim"),
    ("71_73", 71, 73, "trim"),
    ("68_70", 68, 70, "trim"),
    ("64_67", 64, 67, "trim"),
    ("60_63", 60, 63, "trim"),
)
_PROGRESS_BASELINE_KEY = "progressionBaseline"



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
    path = _player_dev_path_value(p)
    # User-facing realism guard: no normal one-year collapse bigger than -5.
    if age < 30:
        lo = -3
    elif age <= 33:
        lo = -4
    else:
        lo = -5
    # Growth is also capped; +4 exists only for young high-upside paths.
    if age <= 27 and path in {"ceiling_hit", "star", "volatile"}:
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
    top300 = _top_n_values(before_values, 300)
    top300_band_counts = _band_counts_from_values(top300)
    core_values = _core_values_from_plan(plan, use_before=True)
    core_counts = _tier_counts_from_values(core_values)
    core_band_counts = _band_counts_from_values(core_values)

    return {
        "version": "v14_lifecycle_shape_lock_baseline",
        "createdBy": PROGRESSION_PY_VERSION,
        "minOverall": min_ovr,
        "sampleSize": len(before_values),
        "sampleSize77Plus": len([v for v in before_values if v >= 77]),
        "avg77Plus": sum(float(v) for v in meaningful) / max(1, len(meaningful)),
        "counts": counts,
        "bandCounts": band_counts,
        "top300SampleSize": len(top300),
        "top300Avg": _avg_value(top300, 0.0),
        "top300Median": _median_value(top300, 0.0),
        "top300Cutoff": int(top300[-1]) if top300 else 0,
        "top300BandCounts": top300_band_counts,
        "coreSampleSize": len(core_values),
        "coreAvg": _avg_value(core_values, 0.0),
        "coreMedian": _median_value(core_values, 0.0),
        "coreCounts": core_counts,
        "coreBandCounts": core_band_counts,
    }


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
            return existing

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
            existing.setdefault("top300SampleSize", fallback.get("top300SampleSize", 0))
            existing.setdefault("top300Avg", fallback.get("top300Avg", 0.0))
            existing.setdefault("top300Median", fallback.get("top300Median", 0.0))
            existing.setdefault("top300Cutoff", fallback.get("top300Cutoff", 0))
            existing.setdefault("top300BandCounts", fallback.get("top300BandCounts", {}))
            existing.setdefault("coreSampleSize", fallback.get("coreSampleSize", 0))
            existing.setdefault("coreAvg", fallback.get("coreAvg", 0.0))
            existing.setdefault("coreMedian", fallback.get("coreMedian", 0.0))
            existing.setdefault("coreCounts", fallback.get("coreCounts", {}))
            existing.setdefault("coreBandCounts", fallback.get("coreBandCounts", {}))
            return existing

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
    premium = 1 if ((level == "elite" or dev_path in {"ceiling_hit", "star"}) and age <= 25 and after >= 84 and after < pot) else 0
    normal_depth = 0 if 77 <= after <= 84 else 1
    return (premium, normal_depth, gap, pot, -age, -after, rng.random())


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
    return (free_agent_penalty, level_score, age_score, close_score, draft_score, gap, pot, -abs(25 - age), rng.random())


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

def _apply_league_rating_governor(
    league: Optional[Dict[str, Any]],
    plan: List[Dict[str, Any]],
    settings: Dict[str, Any],
    rng: random.Random
) -> None:
    """
    Baseline-aware league governor.

    v10 combines cumulative tier caps with deep band/range governors.
    Cumulative tiers protect the league ceiling; bands protect against traffic
    jams below the cutoffs and keep overflow from collecting at 76/73/70.
    """
    if not plan:
        return

    cfg = settings.get("progression", {}) or {}
    strength = float(cfg.get("tier_governor_strength", cfg.get("governor_strength", 1.0)))
    min_ovr = int(cfg.get("baseline_min_overall", 77))
    avg_tolerance = float(cfg.get("baseline_avg_tolerance", 0.35))

    baseline = _get_or_create_progression_baseline(league, plan, settings)
    baseline_counts = baseline.get("counts") if isinstance(baseline.get("counts"), dict) else {}

    _refresh_plan_targets(plan)

    # 0. Directly protect the real playable population. Top 300 is a better
    # gameplay signal than total league average because two-way/stash/filler
    # bodies can hide inflation in the actual rotation pool.
    _apply_top300_core_governor(plan, baseline, settings, rng)

    # 1. Prevent broad inflation in the playable 77+ band without touching
    # low-end autogenerated filler.
    values_after = _meaningful_after_values(plan, min_ovr)
    if values_after:
        baseline_avg = _safe_float(baseline.get("avg77Plus"), sum(values_after) / len(values_after))
        desired_avg = sum(float(v) for v in values_after) / len(values_after)
        max_avg = baseline_avg + avg_tolerance

        if desired_avg > max_avg:
            excess_points = int(math.ceil((desired_avg - max_avg) * len(values_after) * strength))
            candidates = [
                item for item in plan
                if int(item["target_delta"]) > 0
                and (int(item["before_overall"]) >= min_ovr or int(item["target_overall"]) >= min_ovr)
            ]
            candidates.sort(
                key = lambda item: (
                    _safe_int(item["player"].get("potential"), int(item["before_overall"])) - int(item["before_overall"]),
                    -_safe_int(item["player"].get("age"), 25),
                    int(item["target_overall"]),
                    rng.random(),
                )
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

            _refresh_plan_targets(plan)

    # 2. Detailed tier control. Upper trims run first to stop runaway inflation.
    # Depth tiers are trim-only; shortage boosts are only for 85+ and above.
    depth_strength = float(cfg.get("depth_tier_governor_strength", strength))

    for threshold in (*_PROGRESS_FULL_CONTROL_TIERS, *_PROGRESS_DEPTH_TRIM_ONLY_TIERS):
        base = _safe_int(baseline_counts.get(str(threshold)), 0)
        _low, high = _tier_band(threshold, base)
        after_count = sum(1 for item in plan if int(item["target_overall"]) >= threshold)

        if after_count > high:
            tier_strength = depth_strength if threshold in _PROGRESS_DEPTH_TRIM_ONLY_TIERS else strength
            excess = int(math.ceil((after_count - high) * tier_strength))
            _apply_tier_excess_trims(plan, threshold, excess, rng)

    for threshold in _PROGRESS_FULL_CONTROL_TIERS:
        base = _safe_int(baseline_counts.get(str(threshold)), 0)
        low, _high = _tier_band(threshold, base)
        after_count = sum(1 for item in plan if int(item["target_overall"]) >= threshold)

        if after_count < low:
            needed = int(math.ceil((low - after_count) * strength))
            _apply_tier_shortage_boosts(plan, threshold, needed, rng)

    # 3. True rating-band control. This is the v10 fix for players piling up
    # just below cumulative cutoffs.
    _apply_band_rating_governor(plan, baseline, settings, rng)

    # 4. Re-run cumulative depth trims after band trims/boosts in case band
    # movement still leaves too many playable players overall.
    for threshold in _PROGRESS_DEPTH_TRIM_ONLY_TIERS:
        base = _safe_int(baseline_counts.get(str(threshold)), 0)
        _low, high = _tier_band(threshold, base)
        after_count = sum(1 for item in plan if int(item["target_overall"]) >= threshold)
        if after_count > high:
            excess = int(math.ceil((after_count - high) * depth_strength))
            _apply_tier_excess_trims(plan, threshold, excess, rng)

    # 5. Final deep shape cleanup. This second trim-only pass catches any
    # overflow created by the last cumulative-depth pass and prevents 76/73/70
    # from becoming the new hiding spot.
    _apply_band_rating_governor(
        plan = plan,
        baseline = baseline,
        settings = settings,
        rng = rng,
        allow_shortage_boosts = False,
    )

    # 6. Final playable-core safety pass after all other movement. v13 uses
    # a hard probability/shape lock, not another soft governor.
    _apply_top300_core_governor(plan, baseline, settings, rng)
    _apply_hard_top300_shape_lock(plan, baseline, settings, rng)
    _apply_core_roster_shape_lock(plan, baseline, settings, rng)
    _cap_plan_yearly_deltas(plan)

    _refresh_plan_targets(plan)

def _apply_elite_peak_caps(plan: List[Dict[str, Any]], settings: Dict[str, Any], rng: random.Random) -> None:
    """
    99 and 98 OVR are treated as peak-season outcomes.

    Rules:
      - A target 99 has a 10% chance to stay 99.
      - A target 99 that fails becomes 98 and is SAFE from the 98 roll.
      - A natural target 98 has a 50% chance to stay 98 and a 50% chance
        to fall to 97.

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
            current = calc_overall_from_attrs(p.get("attrs") or [], p.get("pos") or p.get("position") or "SF")
            p["overall"] = current
        else:
            current = _safe_int(p.get("overall"), 70)
        plan.append({
            "player": p,
            "team": tname,
            "before_overall": current,
            "target_delta": 0,
            "target_overall": current,
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
    """
    v14 lifecycle guard.

    This can be run after progression and also after the full offseason/draft.
    It uses the saved Y1 baseline and locks the final player pool, including
    active rosters, two-way players, stashes, and free agents.
    """
    if not isinstance(league, dict):
        return {}

    before_metrics = _shape_metrics_from_players(_all_players(league))
    plan = _build_current_shape_plan(league)
    baseline = _get_or_create_progression_baseline(league, plan, settings)

    _apply_top300_core_governor(plan, baseline, settings, rng)
    _apply_hard_top300_shape_lock(plan, baseline, settings, rng)
    _apply_core_roster_shape_lock(plan, baseline, settings, rng)
    _cap_plan_yearly_deltas(plan)
    _refresh_plan_targets(plan)

    planned_metrics = _metrics_from_plan(plan)

    for item in plan:
        p = item["player"]
        before = int(item.get("before_overall", _safe_int(p.get("overall"), 70)))
        target = int(item.get("target_overall", before))
        if target < before:
            _force_overall_at_most(p, target, settings, rng)
        elif target > before:
            # v16: final lifecycle lock is two-sided. If the league fell below
            # its Y1 corridor, carefully selected rostered players can receive
            # small +1 corrections so the distribution stays stable.
            _move_attrs_toward_target_overall(p, target, settings, rng)
            _force_overall_at_most(p, target, settings, rng)
        if target != before:
            _enforce_actual_yearly_delta_window(p, item, settings, rng)
            actual_delta = _safe_int(p.get("overall"), before) - before
            _bump_derived_fields(p, actual_delta, settings, rng)
            if "marketValue" in p:
                p.pop("marketValue", None)

    after_metrics = _shape_metrics_from_players(_all_players(league))
    return {
        "version": PROGRESSION_PY_VERSION,
        "before": before_metrics,
        "planned": planned_metrics,
        "after": after_metrics,
        "baselineCreatedBy": baseline.get("createdBy"),
        "baselineVersion": baseline.get("version"),
    }


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
    _cap_plan_yearly_deltas(plan)

    for item in plan:
        p = item["player"]
        before_overall = int(item["before_overall"])
        target_overall = int(item["target_overall"])
        target_delta = target_overall - before_overall

        if target_delta == 0:
            _apply_small_attribute_churn(p, settings, rng)
        else:
            _move_attrs_toward_target_overall(p, target_overall, settings, rng)

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

    # v14: final lock for all currently loaded buckets after potential update.
    # The public apply_final_league_shape_lock() should also be called after
    # rookies/free agents are finalized, because rookies may enter after this
    # progression call in the wider offseason pipeline.
    shape_debug = _apply_final_shape_lock_to_current_league(league, settings, rng)

    # Final season-level movement guard. The final shape lock can add/subtract
    # a point after ordinary progression, so enforce the user-facing yearly cap
    # relative to the original pre-progression snapshot, not just relative to
    # the final-lock starting point.
    for p, tname in _all_players_with_team(league):
        name = _player_name(p)
        key = f"{name}__{tname}"
        b = before.get(key)
        if not b:
            continue
        item = {
            "player": p,
            "team": tname,
            "before_overall": _safe_int(b.get("overall"), _safe_int(p.get("overall"), 70)),
            "target_delta": _safe_int(p.get("overall"), 70) - _safe_int(b.get("overall"), 70),
            "target_overall": _safe_int(p.get("overall"), 70),
        }
        _enforce_actual_yearly_delta_window(p, item, settings, rng)

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

    return {"league": league, "deltas": deltas, "version": PROGRESSION_PY_VERSION, "debug": {"shapeLock": shape_debug}}