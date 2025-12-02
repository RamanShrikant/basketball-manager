# assists.py - 1:1 with grail file

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


def assists_per36(pos, passing, off_iq, overall):
    """
    Wrapper matching your friend's ast_per36 curve.

    game_sim still passes pos/off_iq/overall, but grail only cares about
    the passing rating.
    """
    r = max(25, min(99, passing))
    if r <= 70:
        return lerp(r, 25, 1.0, 70, 5.0)
    else:
        return lerp(r, 70, 5.0, 99, 11.0)


def noisy_assists(expected):
    return noisy_count(expected)
