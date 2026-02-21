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

def _team_name(team: Dict[str, Any]) -> str:
    return str(team.get("name") or team.get("team") or "")

def _stat_lookup(
    stats_by_key: Optional[Dict[str, Dict[str, Any]]],
    p: Dict[str, Any],
    team_name: str
) -> Optional[Dict[str, Any]]:
    """
    Your JS stores season stats as:
      "Player Name__Team Name" (or occasionally name-only)

    We also allow lookup by player id for future-proofing.
    """
    if not stats_by_key:
        return None

    pid = _player_id(p)
    name = _player_name(p)

    for k in (pid, f"{name}__{team_name}", name):
        if k in stats_by_key:
            return stats_by_key[k]
    return None


# -------------------------
# Settings (friend-tweakable)
# -------------------------

DEFAULT_SETTINGS: Dict[str, Any] = {
    "age_curve": {
        18: 1.60, 19: 1.50, 20: 1.35, 21: 1.20,
        22: 1.00, 23: 0.90, 24: 0.75, 25: 0.60, 26: 0.40,
        27: 0.20, 28: 0.10, 29: 0.05,
        30: -0.20, 31: -0.35, 32: -0.50, 33: -0.65, 34: -0.80,
        35: -0.95, 36: -1.10, 37: -1.25, 38: -1.40, 39: -1.55, 40: -1.70
    },

    "dev_trait_mult": {
        "Bust": 0.80,
        "Normal": 1.00,
        "High": 1.15,
        "Star": 1.30
    },

    "potential_scale": 0.060,

    "minutes_cap_mpg": 30.0,
    "minutes_min_mpg": 5.0,

    "noise_sigma": 0.20,

    "max_abs_delta_per_attr": 6.0,
    "min_rating": 25,
    "max_rating": 99,

    "attrs": {
        "young_mult_all": 1.00,
        "old_mult_all": 1.15,
        "groups": {}
    },

    "derived_fields": {
        "overall_mult": 0.35,
        "off_mult": 0.35,
        "def_mult": 0.35,
        "stamina_mult": 0.50,
        "scoring_mult": 0.25,
        "max_abs_delta_per_field": 4.0
    },
}


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
        # ✅ Prefer seasonYear if present, then seasonStartYear, then season_year, then fallback.
        season_start_year = _safe_int(
            league.get("seasonYear") or league.get("seasonStartYear") or league.get("season_year") or 2025,
            2025
        )

    teams = _iter_teams(league)
    for t in teams:
        for p in (t.get("players") or []):
            if not isinstance(p, dict):
                continue

            # ✅ disable birthdays unless real values exist
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
    # ✅ If no stats, treat as neutral minutes (don’t kill progression).
    if mpg is None:
        return 1.0

    lo = float(settings.get("minutes_min_mpg", 5.0))
    hi = float(settings.get("minutes_cap_mpg", 30.0))
    if mpg <= lo:
        return 0.15
    if mpg >= hi:
        return 1.0
    return 0.15 + 0.85 * ((mpg - lo) / (hi - lo))

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

    idx = pts + 1.5 * ast + 1.2 * reb + 3.0 * stl + 3.0 * blk
    return _clamp(1.0 + (idx - 20.0) / 400.0, 0.95, 1.05)


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

    teams = _iter_teams(league)

    for t in teams:
        tname = _team_name(t)
        for p in (t.get("players") or []):
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

            base = _age_curve_value(age, settings)
            min_fac = _minutes_factor(mpg, settings)
            dev_fac = _dev_multiplier(potential, dev_trait, settings)
            prod_fac = _production_bonus(stats)

            noise = rng.gauss(0.0, float(settings.get("noise_sigma", 0.2)))
            base_delta = base * dev_fac * min_fac * prod_fac * (1.0 + noise)

            is_old = age >= 30

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


            def _bump_field(field_key: str, mult: float) -> None:
                if field_key not in p or p[field_key] is None:
                    return
                old_val = _safe_float(p[field_key], 0.0)
                d = _clamp(base_delta * mult, -max_abs_field, max_abs_field)
                p[field_key] = _stoch_round(_clamp(old_val + d, rmin, rmax), rng)


            _bump_field("overall", overall_mult)
            _bump_field("offRating", off_mult)
            _bump_field("defRating", def_mult)
            _bump_field("stamina", stamina_mult)

            if "scoringRating" in p and p["scoringRating"] is not None:
                old_sr = _safe_float(p.get("scoringRating"), 0.0)
                d_sr = _clamp(base_delta * scoring_mult, -max_abs_field, max_abs_field)
                p["scoringRating"] = float(_clamp(old_sr + d_sr, 0.0, 100.0))

    return league


def _all_players(league: Dict[str, Any]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for t in _iter_teams(league):
        for p in (t.get("players") or []):
            if isinstance(p, dict):
                out.append(p)
    return out

def _all_players_with_team(league: Dict[str, Any]) -> List[Tuple[Dict[str, Any], str]]:
    out: List[Tuple[Dict[str, Any], str]] = []
    for t in _iter_teams(league):
        tname = _team_name(t)
        for p in (t.get("players") or []):
            if isinstance(p, dict):
                out.append((p, tname))
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
        "deltas": { playerName: { "age":1, "overall":+1, "attr0":-2, ... }, "player__team": {...} },
        "version": PROGRESSION_PY_VERSION
      }
    """
    if not isinstance(league, dict):
        return {"league": league, "deltas": {}, "version": PROGRESSION_PY_VERSION}

    ensure_progression_fields(league, season_start_year=season_year)

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
            "attrs": list(p.get("attrs") or []),
            "name": name,
            "team": tname
        }

    apply_jan1_age_up_all_players(league, season_year=season_year)

    apply_end_of_season_progression(
        league=league,
        stats_by_key=stats_by_key,
        settings=settings,
        seed=seed
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

        for k in ("overall", "offRating", "defRating", "stamina"):
            d[k] = _safe_int(p.get(k), 0) - _safe_int(b.get(k), 0)

        new_attrs = list(p.get("attrs") or [])
        old_attrs = list(b.get("attrs") or [])
        n = max(len(new_attrs), len(old_attrs))
        for i in range(n):
            nv = _safe_int(new_attrs[i], 0) if i < len(new_attrs) else 0
            ov = _safe_int(old_attrs[i], 0) if i < len(old_attrs) else 0
            d[f"attr{i}"] = nv - ov

        # ✅ store BOTH keys (composite + name-only)
        deltas[key] = d


    return {"league": league, "deltas": deltas, "version": PROGRESSION_PY_VERSION}
