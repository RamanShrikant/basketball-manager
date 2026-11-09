# steals.py
# Steal model using percentile-based per-36 curves and Gaussian noise
# Aligned with the Tk "Steals View" logic.

import json
import math
import random
import bisect
from typing import List

STATLINE_VARIANCE_BOOST = 1.35  # same swinginess as UI


def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


# ============================================================
#     STEAL RATING → PERCENTILE → STL36 → GAME STEALS
# ============================================================

def _load_steal_distribution(path: str = "30.json") -> List[float]:
    """
    Build global list of Steal ratings from 30.json.

    Matches the Tk UI helper:
      attrs = p.get("attrs"); index 11 = Steal.
    Falls back to p["Steal"] if present.

    If loading fails, returns a synthetic 25–99 range so the
    sim can still run.
    """
    vals: List[float] = []

    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)

        conferences = data.get("conferences", {})
        for conf_teams in conferences.values():
            for team in conf_teams:
                for p in team.get("players", []):
                    attrs = p.get("attrs")
                    if isinstance(attrs, list) and len(attrs) > 11:
                        v = attrs[11]
                        if isinstance(v, (int, float)):
                            vals.append(float(v))
                            continue
                    # fallback: flat Steal field if present
                    if isinstance(p.get("Steal"), (int, float)):
                        vals.append(float(p["Steal"]))
    except Exception:
        # fallback distribution if JSON isn't available
        vals = [float(x) for x in range(25, 100)]

    if not vals:
        vals = [50.0]

    vals.sort()
    return vals


# Global empirical distribution
ALL_STEALS: List[float] = _load_steal_distribution()


def steal_rating_from_player(p) -> float:
    """
    Safely pull Steal rating off a player dict (mirrors Tk UI helper).
    """
    attrs = p.get("attrs")
    if isinstance(attrs, list) and len(attrs) > 11:
        v = attrs[11]
        if isinstance(v, (int, float)):
            return float(v)
    if isinstance(p.get("Steal"), (int, float)):
        return float(p["Steal"])
    # default to global average
    return sum(ALL_STEALS) / len(ALL_STEALS)


def steal_to_percentile(steal_rating: float) -> float:
    """
    Empirical CDF: map a Steal rating to a 0–100 percentile
    based on ALL_STEALS, with interpolation between neighbors.
    """
    arr = ALL_STEALS
    if not arr:
        return 50.0

    steal_rating = float(steal_rating)

    if steal_rating <= arr[0]:
        return 0.0
    if steal_rating >= arr[-1]:
        return 100.0

    n = len(arr)

    # Find insertion index such that arr[i-1] < steal_rating <= arr[i]
    i = bisect.bisect_left(arr, steal_rating)
    if i <= 0:
        return 0.0
    if i >= n:
        return 100.0

    low_idx = i - 1
    high_idx = i
    low_val = arr[low_idx]
    high_val = arr[high_idx]

    if high_val <= low_val:
        return clamp(100.0 * high_idx / (n - 1), 0.0, 100.0)

    pct_low = 100.0 * low_idx / (n - 1)
    pct_high = 100.0 * high_idx / (n - 1)

    t = (steal_rating - low_val) / (high_val - low_val)
    pct = pct_low + t * (pct_high - pct_low)
    return clamp(pct, 0.0, 100.0)


# Real-life STL per 36 curve, downsampled to 0,5,10,...,100 percentiles
STL36_CURVE = [
    (0,   0.4),
    (5,   0.7),
    (10,  0.8),
    (15,  0.8),
    (20,  0.9),
    (25,  0.9),
    (30,  1.0),
    (35,  1.0),
    (40,  1.1),
    (45,  1.1),
    (50,  1.2),
    (55,  1.2),
    (60,  1.2),
    (65,  1.3),
    (70,  1.4),
    (75,  1.4),
    (80,  1.5),
    (85,  1.5),
    (90,  1.6),
    (95,  1.7),
    (100, 3.0),
]


def percentile_to_stl36(pct: float) -> float:
    """
    Map Steal percentile -> STL per 36 via STL36_CURVE (linear interpolation).
    """
    pct = clamp(pct, 0.0, 100.0)
    curve = STL36_CURVE  # already sorted

    if pct <= curve[0][0]:
        return curve[0][1]
    if pct >= curve[-1][0]:
        return curve[-1][1]

    for i in range(len(curve) - 1):
        p1, v1 = curve[i]
        p2, v2 = curve[i + 1]
        if p1 <= pct <= p2:
            if p2 == p1:
                return v1
            t = (pct - p1) / (p2 - p1)
            return v1 + (v2 - v1) * t

    return curve[-1][1]


def steal_per36_from_rating(steal_rating: float) -> float:
    """
    Convert a steal rating to expected STL per 36 using the
    percentile -> STL36 curve.
    """
    pct = steal_to_percentile(steal_rating)
    return percentile_to_stl36(pct)


def steal_to_game_steals(steal_rating: float, minutes: float) -> float:
    """
    Main conversion: Steal rating + minutes -> expected steals
    for this game (no randomness).
    """
    stl36 = steal_per36_from_rating(steal_rating)
    return stl36 * (minutes / 36.0)


# ------------------------------------------------------------
# Public API used by game_sim.py
# ------------------------------------------------------------

def steals_per36(pos, steal_rating, def_iq, overall) -> float:
    """
    Percentile-based STL/36 curve, matching the Tk GUI sandbox logic.

    Signature kept identical to the old steals_per36 so game_sim can
    still call it. Only `steal_rating` is actually used.
    """
    try:
        val = float(steal_rating)
    except (TypeError, ValueError):
        val = 50.0
    return steal_per36_from_rating(val)


def noisy_steals(expected: float) -> int:
    """
    Add game-to-game variance around an expected steal count
    for a single game.

      base_stdev = max(0.25, sqrt(exp) * 0.7)
      stdev      = base_stdev * STATLINE_VARIANCE_BOOST
      value ~ N(exp, stdev^2), clamped at 0 and rounded to int.
    """
    if expected is None:
        return 0

    expected = float(max(expected, 0.0))
    if expected <= 0.0:
        return 0

    base_stdev = max(0.25, math.sqrt(expected) * 0.7)
    stdev = base_stdev * STATLINE_VARIANCE_BOOST

    val = random.gauss(expected, stdev)
    if val < 0:
        return 0
    return int(round(val))
