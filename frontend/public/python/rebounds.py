# rebounds.py
# Rebounding model using per-36 curves and Poisson noise
# Matching your friend's "grail" logic

import math
import random

# ----------------------------------------
# Utility
# ----------------------------------------

def clamp(x, lo, hi):
    return max(lo, min(hi, x))

def gauss(mu, sigma):
    return random.gauss(mu, sigma)

def lerp(a, b, t):
    return a + (b - a) * t

# ----------------------------------------
# Rebounds per 36 curve (from friend)
# ----------------------------------------

def reb_per36(reb_rating: float) -> float:
    """
    Map rebounding rating (attr12) to per 36 rebounding.

    Low rebounders:   about 1.0 - 5.0 per 36
    High rebounders:  about 5.0 - 13.5 per 36
    """
    x = max(25, min(99, reb_rating))

    if x <= 60:
        # 25 -> 1.0   up to   60 -> 5.0
        return lerp(1.0, 5.0, (x - 25) / 35.0)
    else:
        # 60 -> 5.0   up to   99 -> 13.5
        return lerp(5.0, 13.5, (x - 60) / 39.0)

# ----------------------------------------
# Poisson noise (same shape as your friend's tool)
# ----------------------------------------

def noisy_count(expected: float) -> int:
    """
    Turn an expected value into a noisy non negative integer
    using a Poisson draw.
    """
    lam = max(0.05, expected)
    L = math.exp(-lam)
    k = 0
    p = 1.0

    while p > L:
        k += 1
        p *= random.random()

    return max(0, k - 1)

# ----------------------------------------
# Public API - same name/signature
# ----------------------------------------

def get_rebounds(players, team_reb_rate: float = 1.0, pace_adj: float = 1.0):
    """
    players: list of dicts, each like:
        {
          "name": "Player Name",
          "minutes": 34,
          "reb": 88,        # this is attrs[12] from your JSON
          "pos": "C"        # not used here but you already pass it
        }

    team_reb_rate and pace_adj are kept for compatibility, and can be
    used as multipliers if you ever want to tune global rebounding.
    """

    out = []

    for p in players:
        minutes = p.get("minutes", 0) or 0
        reb_rating = p.get("reb", 70)

        # expected rebounds from rating and minutes
        base_per36 = reb_per36(reb_rating)
        expected = base_per36 * (minutes / 36.0)

        # optional global scaling hooks
        expected *= team_reb_rate
        expected *= pace_adj

        out.append(noisy_count(expected))

    return out
