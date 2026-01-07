# progression.py
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional, Tuple
import copy
import random
import math
import datetime as _dt

PROGRESSION_PY_VERSION = "2026-01-07_progression_v1"


# -------------------------
# Helpers
# -------------------------

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
    # fallback (not ideal, but avoids crashes)
    return str(p.get("player", p.get("name", "UNKNOWN_PLAYER")))

def _get_ratings_dict(p: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    r = p.get("ratings")
    return r if isinstance(r, dict) else None


# -------------------------
# Settings (friend-tweakable)
# -------------------------

DEFAULT_SETTINGS: Dict[str, Any] = {
    # How much a "typical" player changes at each age (before multipliers).
    # Positive = improvement, negative = decline.
    "age_curve": {
        # 18-21 big growth
        18: 1.60, 19: 1.50, 20: 1.35, 21: 1.20,
        # 22-26 growth
        22: 1.00, 23: 0.90, 24: 0.75, 25: 0.60, 26: 0.40,
        # 27-29 flat-ish
        27: 0.20, 28: 0.10, 29: 0.05,
        # 30+ decline
        30: -0.20, 31: -0.35, 32: -0.50, 33: -0.65, 34: -0.80,
        35: -0.95, 36: -1.10, 37: -1.25, 38: -1.40, 39: -1.55, 40: -1.70
    },

    # Dev trait multipliers
    "dev_trait_mult": {
        "Bust": 0.80,
        "Normal": 1.00,
        "High": 1.15,
        "Star": 1.30
    },

    # Potential effect (0..100). 50 is neutral.
    "potential_scale": 0.010,  # 0.01 => +0.5 at 100, -0.5 at 0

    # Minutes factor: how much playing time matters for growth (0..1)
    "minutes_cap_mpg": 30.0,   # mpg where growth is basically maxed
    "minutes_min_mpg": 5.0,    # below this mpg, very little growth

    # Randomness (kept small)
    "noise_sigma": 0.15,       # gaussian noise factor applied to base delta

    # Per-year safeguards
    "max_abs_delta_per_rating": 3.0,   # max change to any single rating per year
    "min_rating": 25,
    "max_rating": 99,

    # Rating groups (ONLY applied if those keys exist in your player['ratings'] dict)
    # You should edit these keys to match your sim's rating names.
    "groups": {
        "athletic": {
            "keys": ["spd", "acc", "vert", "stamina"],
            "young_mult": 1.15,
            "old_mult": 1.45,   # declines harder
        },
        "skill": {
            "keys": ["shoot", "three", "mid", "ft", "handle", "pass", "fin"],
            "young_mult": 1.00,
            "old_mult": 0.85,   # declines slower
        },
        "defense": {
            "keys": ["perD", "intD", "stl", "blk", "defIQ"],
            "young_mult": 1.00,
            "old_mult": 1.10,
        },
        "iq": {
            "keys": ["offIQ", "defIQ", "vision", "discipline"],
            "young_mult": 0.85,
            "old_mult": 0.60,   # can still slightly improve / decline slowly
        }
    }
}


# -------------------------
# Migration / birthdays
# -------------------------

def ensure_progression_fields(league: Dict[str, Any], season_start_year: Optional[int] = None) -> Dict[str, Any]:
    """
    Adds missing progression fields without forcing you to edit every roster JSON.
    Safe to run on every load.
    """
    lg = league

    players = lg.get("players", [])
    if not isinstance(players, list):
        return lg

    # fallback season year
    if season_start_year is None:
        season_start_year = _safe_int(lg.get("seasonStartYear"), _safe_int(lg.get("season_year"), 2025))

    for p in players:
        if not isinstance(p, dict):
            continue

        # birthday defaults (Jan 1)
        p.setdefault("birthMonth", 1)
        p.setdefault("birthDay", 1)

        # dev defaults
        p.setdefault("potential", 50)
        p.setdefault("dev_trait", "Normal")

        # lastBirthdayYear prevents multiple increments
        # set to season_start_year-1 so they'll age on Jan 1 of season_start_year if sim reaches it
        if "lastBirthdayYear" not in p:
            p["lastBirthdayYear"] = season_start_year - 1

        # if no age, set a safe default (you can change this)
        if "age" not in p:
            p["age"] = 25

    # store season start year if absent
    lg.setdefault("seasonStartYear", season_start_year)
    return lg


def apply_birthdays_for_date(league: Dict[str, Any], date_iso: str) -> Dict[str, Any]:
    """
    Call this before simulating a game on date_iso.
    Players will age up when date passes their (month, day) birthday for that calendar year.
    """
    lg = league
    dt = _parse_iso_date(date_iso)
    year = dt.year
    md_today = (dt.month, dt.day)

    players = lg.get("players", [])
    if not isinstance(players, list):
        return lg

    for p in players:
        if not isinstance(p, dict):
            continue
        bm = _safe_int(p.get("birthMonth", 1), 1)
        bd = _safe_int(p.get("birthDay", 1), 1)
        md_birth = (bm, bd)

        last_y = _safe_int(p.get("lastBirthdayYear"), year - 1)

        # if today's date is on/after birthday and we haven't applied for this year -> age up
        if md_today >= md_birth and last_y < year:
            p["age"] = _safe_int(p.get("age"), 25) + 1
            p["lastBirthdayYear"] = year

    return lg


# -------------------------
# Progression
# -------------------------

def _age_curve_value(age: int, settings: Dict[str, Any]) -> float:
    curve = settings.get("age_curve", {})
    if age in curve:
        return float(curve[age])
    # if age not in dict, interpolate-ish:
    if age < 18:
        return float(curve.get(18, 1.6))
    if age > 40:
        return float(curve.get(40, -1.7))
    # nearest neighbor fallback
    return float(curve.get(max(min(age, 40), 18), 0.0))

def _minutes_factor(mpg: float, settings: Dict[str, Any]) -> float:
    lo = float(settings.get("minutes_min_mpg", 5.0))
    hi = float(settings.get("minutes_cap_mpg", 30.0))
    if mpg <= lo:
        return 0.15
    if mpg >= hi:
        return 1.0
    return 0.15 + 0.85 * ((mpg - lo) / (hi - lo))

def _dev_multiplier(potential: float, dev_trait: str, settings: Dict[str, Any]) -> float:
    trait_mult = settings.get("dev_trait_mult", {}).get(dev_trait, 1.0)
    pot_scale = float(settings.get("potential_scale", 0.01))
    pot_bonus = (potential - 50.0) * pot_scale  # -0.5..+0.5 if pot_scale=0.01
    return float(trait_mult) * (1.0 + pot_bonus)

def _production_bonus(stats: Optional[Dict[str, Any]]) -> float:
    """
    Tiny bonus to reward production (kept small so it doesn't dominate).
    You can replace this later with something smarter.
    """
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

    # simple "impact-ish" index
    idx = pts + 1.5 * ast + 1.2 * reb + 3.0 * stl + 3.0 * blk

    # map to ~0.95..1.05
    # (50 is arbitrary scale to keep changes small)
    return _clamp(1.0 + (idx - 20.0) / 400.0, 0.95, 1.05)

def apply_end_of_season_progression(
    league: Dict[str, Any],
    stats_by_player_id: Optional[Dict[str, Dict[str, Any]]] = None,
    settings: Optional[Dict[str, Any]] = None,
    seed: Optional[int] = None
) -> Dict[str, Any]:
    """
    Run once after playoffs/awards, before generating next season.
    Updates ratings in-place (returns league for convenience).

    stats_by_player_id: dict[player_id] -> {gp, min, pts, ast, reb, stl, blk, ...}
    """
    lg = league
    settings = settings or DEFAULT_SETTINGS
    rng = random.Random(seed)

    players = lg.get("players", [])
    if not isinstance(players, list):
        return lg

    for p in players:
        if not isinstance(p, dict):
            continue

        rid = _player_id(p)
        stats = (stats_by_player_id or {}).get(rid)

        age = _safe_int(p.get("age"), 25)
        potential = _safe_float(p.get("potential"), 50.0)
        dev_trait = str(p.get("dev_trait", "Normal"))

        # minutes
        mpg = 0.0
        if stats:
            gp = _safe_float(stats.get("gp"), 0.0)
            mins = _safe_float(stats.get("min"), 0.0)
            if gp > 0:
                mpg = mins / gp

        base = _age_curve_value(age, settings)
        min_fac = _minutes_factor(mpg, settings)
        dev_fac = _dev_multiplier(potential, dev_trait, settings)
        prod_fac = _production_bonus(stats)

        # small randomness
        noise = rng.gauss(0.0, float(settings.get("noise_sigma", 0.15)))
        base_delta = base * dev_fac * min_fac * prod_fac * (1.0 + noise)

        r = _get_ratings_dict(p)
        if not r:
            # If your ratings are not in p['ratings'], you can adapt this block.
            continue

        # decide young vs old multipliers for rating groups
        is_old = age >= 30

        max_abs = float(settings.get("max_abs_delta_per_rating", 3.0))
        rmin = int(settings.get("min_rating", 25))
        rmax = int(settings.get("max_rating", 99))

        groups = settings.get("groups", {})

        for gname, gcfg in groups.items():
            keys = gcfg.get("keys", [])
            if not isinstance(keys, list):
                continue

            young_mult = float(gcfg.get("young_mult", 1.0))
            old_mult = float(gcfg.get("old_mult", 1.0))
            gmult = old_mult if is_old else young_mult

            for key in keys:
                if key not in r:
                    continue

                old_val = _safe_float(r.get(key), 0.0)

                # apply delta (cap per rating)
                d = _clamp(base_delta * gmult, -max_abs, max_abs)

                new_val = _clamp(old_val + d, rmin, rmax)

                # store
                # keep ints if your ratings are ints
                r[key] = int(round(new_val))

    return lg
