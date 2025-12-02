# blocks.py
# Block model using percentile-based per-36 curves and Gaussian noise
# Aligned with the Tk "Blocks View" logic.

import json
import math
import random
import bisect
from typing import List

STATLINE_VARIANCE_BOOST = 1.35  # same swinginess as UI


def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


# ============================================================
#     BLOCK RATING → PERCENTILE → BLK36 → GAME BLOCKS
# ============================================================

def _load_block_distribution(path: str = "30.json") -> List[float]:
    """
    Build global list of Block ratings from 30.json.

    Matches the Tk UI helper:
      attrs = p.get("attrs"); index 10 = Block.
    Falls back to p["Block"] if present.

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
                    if isinstance(attrs, list) and len(attrs) > 10:
                        v = attrs[10]
                        if isinstance(v, (int, float)):
                            vals.append(float(v))
                            continue
                    # fallback: flat Block field if present
                    if isinstance(p.get("Block"), (int, float)):
                        vals.append(float(p["Block"]))
    except Exception:
        vals = [float(x) for x in range(25, 100)]

    if not vals:
        vals = [50.0]

    vals.sort()
    return vals


# Global empirical distribution
ALL_BLOCKS: List[float] = _load_block_distribution()


def block_rating_from_player(p) -> float:
    """
    Safely pull Block rating off a player dict (mirrors Tk UI helper).
    """
    attrs = p.get("attrs")
    if isinstance(attrs, list) and len(attrs) > 10:
        v = attrs[10]
        if isinstance(v, (int, float)):
            return float(v)
    if isinstance(p.get("Block"), (int, float)):
        return float(p["Block"])
    # default to global average
    return sum(ALL_BLOCKS) / len(ALL_BLOCKS)


def block_to_percentile(block_rating: float) -> float:
    """
    Empirical CDF: map a Block rating to a 0–100 percentile
    based on ALL_BLOCKS, with interpolation between neighbors.
    """
    arr = ALL_BLOCKS
    if not arr:
        return 50.0

    block_rating = float(block_rating)

    if block_rating <= arr[0]:
        return 0.0
    if block_rating >= arr[-1]:
        return 100.0

    n = len(arr)

    # Find insertion index such that arr[i-1] < block_rating <= arr[i]
    i = bisect.bisect_left(arr, block_rating)
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

    t = (block_rating - low_val) / (high_val - low_val)
    pct = pct_low + t * (pct_high - pct_low)
    return clamp(pct, 0.0, 100.0)


# Real-life BLK per 36 curve, downsampled to 0,5,10,...,100 percentiles
BLK36_CURVE = [
    (0,   0.1),
    (5,   0.2),
    (10,  0.3),
    (15,  0.3),
    (20,  0.4),
    (25,  0.4),
    (30,  0.5),
    (35,  0.5),
    (40,  0.6),
    (45,  0.6),
    (50,  0.7),
    (55,  0.7),
    (60,  0.8),
    (65,  0.9),
    (70,  1.0),
    (75,  1.0),
    (80,  1.1),
    (85,  1.1),
    (90,  1.4),
    (95,  1.8),
    (100, 3.3),
]


def percentile_to_blk36(pct: float) -> float:
    """
    Map Block percentile -> BLK per 36 via BLK36_CURVE (linear interpolation).
    """
    pct = clamp(pct, 0.0, 100.0)
    curve = BLK36_CURVE  # already sorted

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


def block_per36_from_rating(block_rating: float) -> float:
    """
    Convert a block rating to expected BLK per 36 using the
    percentile -> BLK36 curve.
    """
    pct = block_to_percentile(block_rating)
    return percentile_to_blk36(pct)


def block_to_game_blocks(block_rating: float, minutes: float) -> float:
    """
    Main conversion: Block rating + minutes -> expected blocks
    for this game (no randomness).
    """
    blk36 = block_per36_from_rating(block_rating)
    return blk36 * (minutes / 36.0)


# ------------------------------------------------------------
# Public API used by game_sim.py
# ------------------------------------------------------------

def blocks_per36(pos, block_rating, height, overall) -> float:
    """
    Percentile-based BLK/36 curve, matching the Tk GUI sandbox logic.

    Signature kept identical to the old blocks_per36 so game_sim can
    still call it. Only `block_rating` is actually used.
    """
    try:
        val = float(block_rating)
    except (TypeError, ValueError):
        val = 50.0
    return block_per36_from_rating(val)


def noisy_blocks(expected: float) -> int:
    """
    Add game-to-game variance around an expected block count
    for a single game.

      base_stdev = max(0.20, sqrt(exp) * 0.7)
      stdev      = base_stdev * STATLINE_VARIANCE_BOOST
      value ~ N(exp, stdev^2), clamped at 0 and rounded to int.
    """
    if expected is None:
        return 0

    expected = float(max(expected, 0.0))
    if expected <= 0.0:
        return 0

    base_stdev = max(0.20, math.sqrt(expected) * 0.7)
    stdev = base_stdev * STATLINE_VARIANCE_BOOST

    val = random.gauss(expected, stdev)
    if val < 0:
        return 0
    return int(round(val))
