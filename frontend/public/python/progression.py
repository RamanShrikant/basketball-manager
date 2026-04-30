# progression.py
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple
import random
import math

import datetime as _dt

PROGRESSION_PY_VERSION = "2026-01-10_progression_v2_attr_array"


# -------------------------
# Helpers
# -------------------------
def _stoch_round(x: float, rng: random.Random) -> int:
    """
    Stochastic rounding: preserves expected value while allowing small deltas
    to sometimes show up as +/- 1 instead of always rounding to 0.
    """
    lo = math.floor(x)
    frac = x - lo
    if rng.random() < frac:
        return int(lo + 1)
    return int(lo)


def _clamp(x: float, lo: float, hi: float) -> float:
    return lo if x < lo else hi if x > hi else x


def _safe_int(x: Any, default: int = 0) -> int:
    try:
        return int(x)
    except Exception:
        return default


def _safe_float(x: Any, default: float = 0.0) -> float:
    try:
        return float(x)
    except Exception:
        return default


def _calculate_bird_level(seasons_toward_bird: int) -> str:
    seasons = max(0, min(3, _safe_int(seasons_toward_bird, 0)))
    if seasons >= 3:
        return "bird"
    if seasons == 2:
        return "early_bird"
    if seasons == 1:
        return "non_bird"
    return "none"


def _normalize_rights_dict(p: Dict[str, Any]) -> Dict[str, Any]:
    rights = p.get("rights")
    if not isinstance(rights, dict):
        rights = {}

    seasons = max(0, min(3, _safe_int(rights.get("seasonsTowardBird"), 0)))
    level = str(rights.get("birdLevel") or _calculate_bird_level(seasons)).strip().lower().replace("-", "_").replace(" ", "_")
    aliases = {
        "full_bird": "bird",
        "fullbird": "bird",
        "bird_rights": "bird",
        "earlybird": "early_bird",
        "early_bird": "early_bird",
        "nonbird": "non_bird",
        "non_bird": "non_bird",
        "none": "none",
        "no_rights": "none",
    }
    level = aliases.get(level, level)
    if level not in ["bird", "early_bird", "non_bird", "none"]:
        level = _calculate_bird_level(seasons)

    return {
        "heldByTeam": rights.get("heldByTeam"),
        "seasonsTowardBird": seasons,
        "birdLevel": level,
        "rookieScale": bool(rights.get("rookieScale", False)),
        "restrictedFreeAgent": bool(rights.get("restrictedFreeAgent", False)),
    }


def advance_rostered_player_rights_one_season(league: Dict[str, Any]) -> Dict[str, Any]:
    """
    Run once at season rollover. Only rostered players gain Bird/pro-season credit.
    Unsigned free agents do not gain seasonsTowardBird while sitting in the FA pool.
    """
    for team in _iter_teams(league):
        team_name = _team_name(team)
        if not team_name:
            continue

        for p in (team.get("players") or []):
            if not isinstance(p, dict):
                continue

            meta = p.get("meta")
            if not isinstance(meta, dict):
                meta = {}
                p["meta"] = meta

            meta["proSeasons"] = max(0, _safe_int(meta.get("proSeasons"), 0)) + 1
            meta["yearsWithCurrentTeam"] = max(0, _safe_int(meta.get("yearsWithCurrentTeam"), 0)) + 1

            rights = _normalize_rights_dict(p)
            old_seasons = max(0, _safe_int(rights.get("seasonsTowardBird"), 0))
            new_seasons = min(3, old_seasons + 1)

            p["rights"] = {
                "heldByTeam": team_name,
                "seasonsTowardBird": new_seasons,
                "birdLevel": _calculate_bird_level(new_seasons),
                "rookieScale": bool(rights.get("rookieScale", False)),
                "restrictedFreeAgent": bool(rights.get("restrictedFreeAgent", False)),
            }

    return league


def _parse_iso_date(date_iso: str) -> _dt.date:
    # expects "YYYY-MM-DD"
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
      - Player__PreviousTeam (important for free agents)
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
# Settings (friend-tweakable)
# -------------------------

DEFAULT_SETTINGS: Dict[str, Any] = {
    "age_curve": {
        18: 0.08, 19: 0.08, 20: 0.07, 21: 0.06,
        22: 0.05, 23: 0.04, 24: 0.03, 25: 0.02, 26: 0.01,
        27: 0.00, 28: 0.00, 29: 0.00,
        30: 0.00, 31: -0.10, 32: -0.16, 33: -0.24, 34: -0.34,
        35: -0.46, 36: -0.60, 37: -0.76, 38: -0.94, 39: -1.14, 40: -1.36
    },

    "dev_trait_mult": {
        "Bust": 0.95,
        "Normal": 1.00,
        "High": 1.04,
        "Star": 1.08
    },

    "potential_scale": 0.008,

    "peak_age": 30,
    "decline_start_age": 30,
    "young_progress_attr_scale": 0.30,
    "young_max_delta": 1.05,
    "peak_age_gap_scale": 0.08,
     "old_decline_base": 0.28,
    "old_decline_age_scale": 0.10,
    "old_decline_mult": 1.06,
    "old_max_decline": 1.35,

    "minutes_cap_mpg": 32.0,
    "minutes_min_mpg": 5.0,

    "noise_sigma": 0.06,

    "max_abs_delta_per_attr": 2.5,
    "min_rating": 25,
    "max_rating": 99,

    "attrs": {
        "young_mult_all": 0.92,
        "old_mult_all": 1.02,
        "groups": {}
    },

    "derived_fields": {
        "overall_mult": 0.28,
        "off_mult": 0.28,
        "def_mult": 0.28,
        "stamina_mult": 0.30,
        "scoring_mult": 0.22,
        "max_abs_delta_per_field": 2.8
    },
}

# -------------------------
# Overall calculator (JS parity with LeagueEditor.jsx)
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


def calc_overall_from_attrs(attrs: List[Any], pos: str) -> int:
    # JS: p = posParams[pos]; if (!p) return 0;
    p = _POS_PARAMS.get(str(pos or "SF"), _POS_PARAMS["SF"])

    # Ensure length 15, default 75
    a = list(attrs or [])
    if len(a) < 15:
        a = a + [75] * (15 - len(a))
    elif len(a) > 15:
        a = a[:15]

    weights = p["weights"]
    alpha = float(p["alpha"])
    prim = [int(i) - 1 for i in p["prim"]]  # JS converts 1-based to 0-based

    # W = sum(weights[i] * attrs[i])
    W = 0.0
    for i in range(15):
        W += float(weights[i]) * float(a[i] if a[i] is not None else 75)

    # Peak = max(attrs[prim])
    peak_vals = []
    for idx in prim:
        if 0 <= idx < 15:
            peak_vals.append(float(a[idx] if a[idx] is not None else 75))
    Peak = max(peak_vals) if peak_vals else 75.0

    # B = alpha*Peak + (1-alpha)*W
    B = alpha * Peak + (1.0 - alpha) * W

    # overall = 60 + 39*sigmoid(B); clamp 60..99; round
    overall = 60.0 + 39.0 * _sigmoid_overall(B)
    overall = max(60.0, min(99.0, overall))
    overall = int(math.floor(overall + 0.5))  # JS Math.round for positive numbers

    # JS bonus: num90 >= 3 => bonus = num90 - 2
    num90 = sum(1 for v in a if float(v if v is not None else 0) >= 90.0)
    if num90 >= 3:
        overall = min(99, overall + (num90 - 2))

    return int(overall)


# -------------------------
# Birthdays / aging
# -------------------------

def ensure_progression_fields(league: Dict[str, Any], season_start_year: Optional[int] = None) -> Dict[str, Any]:
    """
    Safe to run on every load. Adds defaults:
      birthMonth=0, birthDay=0 (disabled unless real birthdays are provided),
      dev_trait="Normal", potential if missing, lastBirthdayYear.
    """
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
        p.setdefault("potential", 50)
        p.setdefault("dev_trait", "Normal")

        if "lastBirthdayYear" not in p:
            p["lastBirthdayYear"] = season_start_year - 1

        if "age" not in p:
            p["age"] = 25

    league.setdefault("seasonStartYear", season_start_year)
    return league


def apply_birthdays_for_date(league: Dict[str, Any], date_iso: str) -> Dict[str, Any]:
    """
    Call before simulating a game on date_iso.
    Players age up once per calendar year when date passes their birthday.

    ✅ if birthday is not a real date (0/0 or invalid), skip aging.
    """
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
# Progression core
# -------------------------

def _age_curve_value(age: int, settings: Dict[str, Any]) -> float:
    curve = settings.get("age_curve", {})
    if age in curve:
        return float(curve[age])
    if age < 18:
        return float(curve.get(18, 1.6))
    if age > 40:
        return float(curve.get(40, -1.7))
    return float(curve.get(max(min(age, 40), 18), 0.0))


def _minutes_factor(mpg: Optional[float], settings: Dict[str, Any]) -> float:
    # If no stats, treat as neutral minutes.
    if mpg is None:
        return 1.0

    lo = float(settings.get("minutes_min_mpg", 5.0))
    hi = float(settings.get("minutes_cap_mpg", 32.0))

    if mpg <= lo:
        return 0.45
    if mpg >= hi:
        return 1.0

    return 0.45 + 0.55 * ((mpg - lo) / (hi - lo))


def _dev_multiplier(potential: float, dev_trait: str, settings: Dict[str, Any]) -> float:
    trait_mult = settings.get("dev_trait_mult", {}).get(dev_trait, 1.0)
    pot_scale = float(settings.get("potential_scale", 0.06))
    pot_bonus = (potential - 50.0) * pot_scale
    return float(trait_mult) * (1.0 + pot_bonus)


def _production_bonus(stats: Optional[Dict[str, Any]]) -> float:
    if not stats:
        return 1.0

    gp = max(_safe_float(stats.get("gp"), 0.0), 0.0)
    if gp <= 0:
        return 1.0

    pts = _safe_float(stats.get("pts"), 0.0) / gp
    ast = _safe_float(stats.get("ast"), 0.0) / gp
    reb = _safe_float(stats.get("reb"), 0.0) / gp
    stl = _safe_float(stats.get("stl"), 0.0) / gp
    blk = _safe_float(stats.get("blk"), 0.0) / gp

    idx = pts + 1.2 * ast + 1.0 * reb + 2.0 * stl + 2.0 * blk
    return _clamp(1.0 + (idx - 20.0) / 800.0, 0.97, 1.03)
def apply_end_of_season_progression(
    league: Dict[str, Any],
    stats_by_key: Optional[Dict[str, Dict[str, Any]]] = None,
    settings: Optional[Dict[str, Any]] = None,
    seed: Optional[int] = None
) -> Dict[str, Any]:
    """
    Run once after playoffs/awards, before next season.
    stats_by_key optional.
    """
    if not isinstance(league, dict):
        return league

    settings = settings or DEFAULT_SETTINGS
    rng = random.Random(seed)

    rmin = int(settings.get("min_rating", 25))
    rmax = int(settings.get("max_rating", 99))
    max_abs_attr = float(settings.get("max_abs_delta_per_attr", 6.0))

    attrs_cfg = settings.get("attrs", {}) or {}
    groups = (attrs_cfg.get("groups") or {}) if isinstance(attrs_cfg.get("groups"), dict) else {}
    group_idx_to_mult: Dict[int, Any] = {}

    for _, gcfg in groups.items():
        idxs = gcfg.get("idx")
        if not isinstance(idxs, list):
            continue
        ym = float(gcfg.get("young_mult", 1.0))
        om = float(gcfg.get("old_mult", 1.0))
        for i in idxs:
            try:
                group_idx_to_mult[int(i)] = (ym, om)
            except Exception:
                pass

    young_mult_all = float(attrs_cfg.get("young_mult_all", 1.0))
    old_mult_all = float(attrs_cfg.get("old_mult_all", 1.15))

    derived = settings.get("derived_fields", {}) or {}
    overall_mult = float(derived.get("overall_mult", 0.35))
    off_mult = float(derived.get("off_mult", 0.35))
    def_mult = float(derived.get("def_mult", 0.35))
    stamina_mult = float(derived.get("stamina_mult", 0.50))
    scoring_mult = float(derived.get("scoring_mult", 0.25))
    max_abs_field = float(derived.get("max_abs_delta_per_field", 4.0))

    for p, tname in _all_players_with_team(league):
        if not isinstance(p, dict):
            continue

        stats = _stat_lookup(stats_by_key, p, tname)

        age = _safe_int(p.get("age"), 25)
        potential = _safe_float(p.get("potential"), 50.0)
        dev_trait = str(p.get("dev_trait", "Normal"))

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

        current_overall = _safe_float(p.get("overall"), 0.0)
        if current_overall <= 0 and isinstance(p.get("attrs"), list) and len(p.get("attrs") or []) > 0:
            current_overall = float(
                calc_overall_from_attrs(
                    p.get("attrs") or [],
                    p.get("pos") or p.get("position") or "SF"
                )
            )

        peak_age = int(settings.get("peak_age", 30))
        decline_start_age = int(settings.get("decline_start_age", 30))
        gap_to_potential = potential - current_overall

        min_fac = _minutes_factor(mpg, settings)
        dev_fac = _dev_multiplier(potential, dev_trait, settings)
        prod_fac = _production_bonus(stats)
        age_curve = _age_curve_value(age, settings)
        noise = rng.gauss(0.0, float(settings.get("noise_sigma", 0.10)))

        if age < peak_age:
            years_to_peak = max(1, peak_age - age)
            progress_step = max(0.0, gap_to_potential) / years_to_peak
            base_delta = progress_step * float(settings.get("young_progress_attr_scale", 0.32))
            base_delta *= min_fac * prod_fac * dev_fac
            base_delta += age_curve + noise
            base_delta = _clamp(base_delta, 0.0, float(settings.get("young_max_delta", 1.15)))
        elif age == peak_age:
            settle_gap = gap_to_potential * float(settings.get("peak_age_gap_scale", 0.10))
            base_delta = _clamp((settle_gap * min_fac * prod_fac) + noise, -0.15, 0.35)
        else:
            years_past_peak = age - decline_start_age
            decline = float(settings.get("old_decline_base", 0.30)) + (
                years_past_peak * float(settings.get("old_decline_age_scale", 0.10))
            )

            if current_overall >= 85:
                decline += 0.08
            if current_overall >= 90:
                decline += 0.08

            decline *= float(settings.get("old_decline_mult", 1.00))
            if min_fac >= 0.85:
                decline *= 0.95

            base_delta = -decline + noise
            base_delta = _clamp(
                base_delta,
                -float(settings.get("old_max_decline", 1.40)),
                -0.05
            )

        is_old = age > decline_start_age

        attrs = p.get("attrs")
        if isinstance(attrs, list) and len(attrs) > 0:
            for i in range(len(attrs)):
                old_val = _safe_float(attrs[i], 0.0)

                if i in group_idx_to_mult:
                    ym, om = group_idx_to_mult[i]
                    mult = om if is_old else ym
                else:
                    mult = old_mult_all if is_old else young_mult_all

                d = _clamp(base_delta * mult, -max_abs_attr, max_abs_attr)
                new_val = _clamp(old_val + d, rmin, rmax)
                attrs[i] = _stoch_round(new_val, rng)

        if isinstance(p.get("attrs"), list) and len(p.get("attrs")) > 0:
            p["overall"] = calc_overall_from_attrs(p.get("attrs") or [], p.get("pos") or p.get("position") or "SF")

        def _bump_field(field_key: str, mult: float) -> None:
            if field_key not in p or p[field_key] is None:
                return
            old_val = _safe_float(p[field_key], 0.0)
            d = _clamp(base_delta * mult, -max_abs_field, max_abs_field)
            p[field_key] = _stoch_round(_clamp(old_val + d, rmin, rmax), rng)

        _bump_field("offRating", off_mult)
        _bump_field("defRating", def_mult)
        _bump_field("stamina", stamina_mult)

        if "scoringRating" in p and p["scoringRating"] is not None:
            old_sr = _safe_float(p.get("scoringRating"), 0.0)
            d_sr = _clamp(base_delta * scoring_mult, -max_abs_field, max_abs_field)
            p["scoringRating"] = float(_clamp(old_sr + d_sr, 0.0, 100.0))

        ovr = _safe_int(p.get("overall"), 0)
        pot = _safe_int(p.get("potential"), 50)

        if age <= 27:
            upside_cap = 12
            pot_decay = 0
        elif age <= 30:
            upside_cap = 8
            pot_decay = max(0, age - 28)
        elif age <= 33:
            upside_cap = 4
            pot_decay = 2 + (age - 31)
        else:
            upside_cap = 2
            pot_decay = 4 + (max(0, age - 34) * 2)

        new_potential = max(ovr, pot - pot_decay)
        new_potential = min(new_potential, ovr + upside_cap)

        if ovr > new_potential:
            new_potential = ovr

        p["potential"] = min(rmax, new_potential)

        # Clear stale market value so free agency logic recalculates it later
        if "marketValue" in p:
            p.pop("marketValue", None)

    return league


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
    Placeholder rule: everyone ages +1 once per season.
    Guarded by lastBirthdayYear so it can't stack.
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
    """
    if not isinstance(league, dict):
        return {"league": league, "deltas": {}, "version": PROGRESSION_PY_VERSION}

    ensure_progression_fields(league, season_start_year = season_year)

    # snapshot before (keyed by composite to avoid collisions)
    before: Dict[str, Dict[str, Any]] = {}
    for p, tname in _all_players_with_team(league):
        name = _player_name(p)
        key = f"{name}__{tname}"
        before[key] = {
            "age": _safe_int(p.get("age"), 25),
            "overall": _safe_int(p.get("overall"), 0),
            "offRating": _safe_int(p.get("offRating"), 0),
            "defRating": _safe_int(p.get("defRating"), 0),
            "stamina": _safe_int(p.get("stamina"), 0),
            "potential": _safe_int(p.get("potential"), 50),
            "attrs": list(p.get("attrs") or []),
            "name": name,
            "team": tname
        }

    # ✅ Progress first (uses current season age)
    apply_end_of_season_progression(
        league = league,
        stats_by_key = stats_by_key,
        settings = settings,
        seed = seed
    )

    # ✅ Age up after progression so next season starts older
    apply_jan1_age_up_all_players(league = league, season_year = season_year)

    # ✅ Rostered players gain one pro/team/Bird-right season at rollover.
    # Free agents do not gain Bird years while unsigned.
    advance_rostered_player_rights_one_season(league)

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