# efficiency.py
# This module isolates all efficiency / fatigue / coverage logic
# from your friend's original game sim Python files.
#
# NO logic has been changed — only reorganized cleanly.

import math


# ---------------------------------------------------------
# Basic clamp
# ---------------------------------------------------------
def clamp(x, lo, hi):
    return max(lo, min(hi, x))


# ---------------------------------------------------------
# Fatigue model (exactly your friend's math)
# ---------------------------------------------------------

TR_FATIGUE_FLOOR = 0.68
TR_FATIGUE_K = 0.010

def fatigue_threshold(stamina):
    """
    Your friend's fatigue threshold:
        threshold = 0.359 * stamina + 2.46
    """
    return 0.359 * (stamina or 75) + 2.46


def fatigue_penalty(minutes, stamina):
    """
    Penalty grows once minutes exceed threshold.
    Minimum penalty floor = 0.68.
    """
    over = max(0, (minutes or 0) - fatigue_threshold(stamina))
    return max(TR_FATIGUE_FLOOR, 1 - TR_FATIGUE_K * over)


# ---------------------------------------------------------
# Coverage penalty (position minutes lack)
# Matches the EXACT gamespace logic.
# ---------------------------------------------------------

TR_COV_ALPHA = 15.0
TR_OVERPOS_MAXPT = 6.0

def coverage_penalty(pos_min):
    """
    pos_min is a dict: { "PG": minutes, "SG": minutes, ... }

    Missing positional minutes → penalty added to total efficiency
    Overloaded positions → smaller secondary penalty
    """

    POS = ["PG", "SG", "SF", "PF", "C"]
    target = 48

    # Absolute error across all 5 positions
    coverage_error = sum(abs((pos_min.get(p, 0) or 0) - target) for p in POS)
    cov_pen = (coverage_error / 240) * TR_COV_ALPHA

    # Largest overfill (if any)
    over = max(0, max((pos_min.get(p, 0) or 0) - target for p in POS))
    over_pen = (over / 192) * TR_OVERPOS_MAXPT

    return cov_pen + over_pen


# ---------------------------------------------------------
# Empty-minutes penalty
# ---------------------------------------------------------

TR_EMPTY_MIN_PTS = 35.0

def empty_minutes_penalty(total_minutes):
    """
    If fewer than 240 minutes allocated, add penalty.
    """
    if total_minutes >= 240:
        return 0.0

    missing = 240 - total_minutes
    frac = missing / 240

    # same exponent 0.85 your friend used
    return TR_EMPTY_MIN_PTS * (frac ** 0.85)


# ---------------------------------------------------------
# Star boost engine (same star curve as your friend)
# ---------------------------------------------------------

TR_STAR_REF = 84.0
TR_STAR_SCALE = 1.00
TR_STAR_EXP_OVR = 1.22
TR_STAR_EXP_OFF = 1.20
TR_STAR_EXP_DEF = 1.20
TR_STAR_SHARE_EXP = 0.45
TR_STAR_OUT_EXP = 0.85

def star_boost(eff_list, star_exp, ref=TR_STAR_REF):
    """
    eff_list: [ { "eff": number, "player": p }, ... ]

    Your friend's exact 2-star shared-boost algorithm:
    - identify top 2 players by effective rating
    - convert gap above reference
    - weight by share minutes
    - apply exponent scaling
    """

    if not eff_list:
        return 0.0

    top2 = sorted(eff_list, key=lambda x: x["eff"], reverse=True)[:2]

    pull = 0.0
    for entry in top2:
        p = entry["player"]
        base = p.get("overall") or p.get("offRating") or p.get("defRating") or 75

        gap = max(0, base - ref)
        if gap <= 0:
            continue

        share = max(0.0, (p.get("minutes", 0) / 240.0)) ** TR_STAR_SHARE_EXP
        pull += (gap ** star_exp) * share

    # Out exponent / scale match exactly
    return TR_STAR_SCALE * (pull ** TR_STAR_OUT_EXP)


# ---------------------------------------------------------
# Scaling final off/def/overall back into 25–99 range
# ---------------------------------------------------------

TR_GAIN = 1.30

def scale_range(raw):
    """
    Same mapping formula in original:
        (raw - 75) * GA + 75
    Clamped to 25–99
    """
    return clamp((raw - 75) * TR_GAIN + 75, 25, 99)
