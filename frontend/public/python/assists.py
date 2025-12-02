import json
import math
import random
import bisect
from typing import List

# ------------------------------------------------------------
# assists.py — percentile-based mapping using global Passing distribution
# ------------------------------------------------------------

STATLINE_VARIANCE_BOOST = 1.35  # same swinginess as GUI sandbox

AST36_CURVE = [
    (0, 1.1),
    (5, 1.5),
    (10, 1.8),
    (15, 1.9),
    (20, 2.0),
    (25, 2.1),
    (30, 2.3),
    (35, 2.5),
    (40, 2.8),
    (45, 2.9),
    (50, 3.3),
    (55, 3.6),
    (60, 3.9),
    (65, 4.2),
    (70, 4.6),
    (75, 5.2),
    (80, 5.7),
    (85, 6.2),
    (90, 6.8),
    (95, 7.8),
    (96, 8.3),
    (97, 8.9),
    (98, 9.8),
    (99, 10.7),
    (100, 11.6),
]


def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def _load_passing_distribution(path: str = "30.json") -> List[float]:
    """
    Build global list of Passing ratings from 30.json.

    Mirrors the GUI helper:
        attrs = p.get("attrs"); idx 5 = Passing.
    Falls back to p["Passing"] if present.
    If anything fails, returns a simple [25..99] range so the
    module still works instead of crashing.
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
                    if isinstance(attrs, list) and len(attrs) > 5:
                        v = attrs[5]
                        if isinstance(v, (int, float)):
                            vals.append(float(v))
                            continue
                    # fallback: flat Passing field
                    if isinstance(p.get("Passing"), (int, float)):
                        vals.append(float(p["Passing"]))
    except Exception:
        # Fallback: assume roughly uniform 25–99 distribution
        vals = [float(x) for x in range(25, 100)]

    if not vals:
        vals = [50.0]

    vals.sort()
    return vals


# Global empirical distribution (on import)
ALL_PASSING: List[float] = _load_passing_distribution()


def passing_to_percentile(passing: float) -> float:
    """
    Empirical CDF: map a Passing rating to a 0–100 percentile
    based on ALL_PASSING, **with interpolation between neighbors**.

    If a rating falls between two players' Passing values, its
    percentile is interpolated between their percentiles instead of
    snapping to one step.
    """
    arr = ALL_PASSING
    if not arr:
        return 50.0

    passing = float(passing)

    # Hard clamp at the extremes
    if passing <= arr[0]:
        return 0.0
    if passing >= arr[-1]:
        return 100.0

    n = len(arr)

    # Find insertion index such that arr[i-1] < passing <= arr[i]
    i = bisect.bisect_left(arr, passing)

    # Safety checks
    if i <= 0:
        return 0.0
    if i >= n:
        return 100.0

    low_idx = i - 1
    high_idx = i
    low_val = arr[low_idx]
    high_val = arr[high_idx]

    # If both neighbors have the same Passing, just use that step's percentile
    if high_val <= low_val:
        return clamp(100.0 * high_idx / (n - 1), 0.0, 100.0)

    # Percentiles of the two neighbors
    pct_low = 100.0 * low_idx / (n - 1)
    pct_high = 100.0 * high_idx / (n - 1)

    # Interpolate percentiles based on where "passing" sits between low_val and high_val
    t = (passing - low_val) / (high_val - low_val)
    pct = pct_low + t * (pct_high - pct_low)

    return clamp(pct, 0.0, 100.0)


def percentile_to_ast36(pct: float) -> float:
    """
    Map Passing percentile -> AST per 36 via AST36_CURVE (linear interpolation).
    1:1 with the GUI helper.
    """
    pct = clamp(pct, 0.0, 100.0)
    curve = AST36_CURVE  # already sorted by percentile

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


def passing_to_game_assists(passing_rating: float, minutes: float) -> float:
    """
    Main conversion: Passing rating + minutes -> expected assists
    for this game (no randomness), identical to GUI sandbox.
    """
    pct = passing_to_percentile(passing_rating)
    ast36 = percentile_to_ast36(pct)
    return ast36 * (minutes / 36.0)


# ------------------------------------------------------------
# Public API used by game_sim.py
# ------------------------------------------------------------
def assists_per36(pos, passing, off_iq, overall) -> float:
    """
    Percentile-based AST/36 curve, matching the Tk GUI sandbox logic.

    Signature kept identical to the previous assists_per36 so game_sim
    can still call it. Only `passing` is actually used.
    """
    try:
        passing_val = float(passing)
    except (TypeError, ValueError):
        # If something weird comes in, just treat as league-average passer.
        passing_val = 50.0

    pct = passing_to_percentile(passing_val)
    return percentile_to_ast36(pct)


def noisy_assists(expected: float) -> int:
    """
    Add game-to-game variance around an expected assist count for a single game.

    This matches the "Generated Assist Statline" Gaussian logic:
      base_stdev = max(0.4, sqrt(exp) * 0.8)
      stdev      = base_stdev * STATLINE_VARIANCE_BOOST
      value ~ N(exp, stdev^2), clamped at 0 and rounded to int.
    """
    if expected is None:
        return 0

    expected = float(max(expected, 0.0))
    if expected <= 0.0:
        return 0

    base_stdev = max(0.4, math.sqrt(expected) * 0.8)
    stdev = base_stdev * STATLINE_VARIANCE_BOOST

    val = random.gauss(expected, stdev)
    if val < 0:
        return 0
    return int(round(val))
