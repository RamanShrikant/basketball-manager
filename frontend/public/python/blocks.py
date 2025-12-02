# blocks.py - 1:1 with grail file

import math
import random


def lerp(x, x1, y1, x2, y2):
    """Piecewise-clamped linear interpolation exactly like your friend's."""
    if x <= x1:
        return y1
    if x >= x2:
        return y2
    t = (x - x1) / (x2 - x1)
    return y1 + (y2 - y1) * t


def noisy_count(expected):
    """Shared noise model used for AST / STL / BLK in the grail file."""
    expected = max(expected, 0.0)

    lam = expected
    if expected < 2:
        lam *= random.uniform(0.6, 1.4)
    else:
        lam *= random.uniform(0.7, 1.3)

    if lam < 0.5:
        return 1 if random.random() < lam else 0

    val = random.gauss(lam, math.sqrt(max(lam, 1e-6)))
    return max(0, int(round(val)))


def blocks_per36(pos, block_rating, height, overall):
    """
    Wrapper that matches your friend's blk_per36 curve.

    Same 4-arg signature as game_sim, but only block_rating matters.
    """
    r = max(25, min(99, block_rating))
    if r <= 70:
        return lerp(r, 25, 0.1, 70, 1.0)
    else:
        return lerp(r, 70, 1.0, 99, 3.3)


def noisy_blocks(expected):
    return noisy_count(expected)
