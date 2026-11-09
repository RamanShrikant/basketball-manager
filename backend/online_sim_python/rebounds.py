# rebounds.py
# Rebounding model using percentile-based per-36 curves and Gaussian noise
# Aligned with the Tk "Rebounds View" logic.

import json
import math
import random
import bisect
from typing import List

# ------------------------------
# Global config / constants
# ------------------------------

STATLINE_VARIANCE_BOOST = 1.35  # same as UI: slight variance boost


def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


# ============================================================
#    REBOUNDING → PERCENTILE → TRB36 → GAME REBOUNDS
# ============================================================

def _load_rebound_distribution(path: str = "30.json") -> List[float]:
    """
    Build global list of Rebounding ratings from 30.json.

    Matches the Tk UI helper:
      attrs = p.get("attrs"); index 12 = Rebounding.
    Falls back to p["Rebounding"] if present.

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
                    if isinstance(attrs, list) and len(attrs) > 12:
                        v = attrs[12]
                        if isinstance(v, (int, float)):
                            vals.append(float(v))
                            continue
                    # Fallback: flat field
                    if isinstance(p.get("Rebounding"), (int, float)):
                        vals.append(float(p["Rebounding"]))
    except Exception:
        # Fallback distribution if the JSON isn't available
        vals = [float(x) for x in range(25, 100)]

    if not vals:
        vals = [50.0]

    vals.sort()
    return vals


# Global empirical distribution
ALL_REBOUND: List[float] = _load_rebound_distribution()


def rebound_to_percentile(reb: float) -> float:
    """
    Empirical CDF: map a Rebounding rating to a 0–100 percentile
    based on ALL_REBOUND, with interpolation between neighbors.
    """
    arr = ALL_REBOUND
    if not arr:
        return 50.0

    reb = float(reb)

    if reb <= arr[0]:
        return 0.0
    if reb >= arr[-1]:
        return 100.0

    n = len(arr)

    # Find insertion index such that arr[i-1] < reb <= arr[i]
    i = bisect.bisect_left(arr, reb)
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

    t = (reb - low_val) / (high_val - low_val)
    pct = pct_low + t * (pct_high - pct_low)
    return clamp(pct, 0.0, 100.0)


# Approximate real-life TRB per 36 curve (percentiles 0,5,...,100)
# Anchored to your NBA distribution (min ~2.2, max ~14).
TRB36_CURVE = [
    (0,   2.2),
    (5,   3.0),
    (10,  3.5),
    (15,  3.8),
    (20,  4.0),
    (25,  4.2),
    (30,  4.4),
    (35,  4.6),
    (40,  4.8),
    (45,  5.0),
    (50,  5.2),
    (55,  5.4),
    (60,  5.6),
    (65,  5.9),
    (70,  6.2),
    (75,  6.6),
    (80,  7.0),
    (85,  7.5),
    (90, 8.2),
    (95, 10.5),
    (100, 13.4),
]


def percentile_to_trb36(pct: float) -> float:
    """
    Map Rebounding percentile -> TRB per 36 via TRB36_CURVE (linear interpolation).
    """
    pct = clamp(pct, 0.0, 100.0)
    curve = TRB36_CURVE  # already sorted

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


def rebound_per36(reb_rating: float) -> float:
    """
    Convert a rebounding rating to expected TRB per 36 using
    the percentile -> TRB36 curve.
    """
    pct = rebound_to_percentile(reb_rating)
    return percentile_to_trb36(pct)


def rebound_to_game_rebounds(reb_rating: float, minutes: float) -> float:
    """
    Main conversion: Rebounding rating + minutes -> expected rebounds
    for this game (no randomness).
    """
    per36 = rebound_per36(reb_rating)
    return per36 * (minutes / 36.0)


# ------------------------------
# Noise model (Gaussian, UI-style)
# ------------------------------

def noisy_rebounds(expected: float) -> int:
    """
    Add game-to-game variance around an expected rebound count.
    Matches the Tk statline logic:

        base_stdev = max(0.5, sqrt(exp) * 0.7)
        stdev      = base_stdev * STATLINE_VARIANCE_BOOST
        value ~ N(exp, stdev^2)

    Then clamp at 0 and round to int.
    """
    if expected is None:
        return 0

    expected = float(max(expected, 0.0))
    if expected <= 0.0:
        return 0

    base_stdev = max(0.5, math.sqrt(expected) * 0.7)
    stdev = base_stdev * STATLINE_VARIANCE_BOOST

    val = random.gauss(expected, stdev)
    if val < 0:
        return 0
    return int(round(val))


# ----------------------------------------
# Public API - same name/signature
# ----------------------------------------

def get_rebounds(players, team_reb_rate: float = 1.0, pace_adj: float = 1.0):
    """
    players: list of dicts, each like:
        {
          "name": "Player Name",
          "minutes": 34,
          "reb": 88,        # rating on same scale as attrs[12]
          "pos": "C"        # not used here but already passed
        }

    team_reb_rate and pace_adj are kept for compatibility and act
    as global multipliers.
    """
    out = []

    for p in players:
        minutes = p.get("minutes", 0) or 0
        reb_rating = p.get("reb", 70)

        # Expected rebounds from rating and minutes
        expected = rebound_to_game_rebounds(reb_rating, minutes)

        # Optional global scaling hooks
        expected *= team_reb_rate
        expected *= pace_adj

        out.append(noisy_rebounds(expected))

    return out
