# bm_scoring.py
# Pure scoring logic — direct extraction from original Python

import math

SCORING_PCT_TABLE = [
    (0,   40.54),
    (5,   51.08),
    (10,  53.32),
    (15,  53.98),
    (20,  54.95),
    (25,  55.89),
    (30,  56.36),
    (35,  56.98),
    (40,  58.27),
    (45,  59.03),
    (50,  59.64),
    (55,  60.28),
    (60,  62.48),
    (65,  63.57),
    (70,  64.54),
    (75,  66.92),
    (80,  68.99),
    (85,  71.96),
    (90,  76.75),
    (95,  81.88),
    (100, 97.24),
]

PTS36_CURVE = [
    (100, 34.4),
    (95, 25.5),
    (90, 23.7),
    (85, 22.05),
    (80, 20.8),
    (75, 19.4),
    (70, 18.6),
    (65, 17.65),
    (60, 17.1),
    (55, 16.25),
    (50, 15.7),
    (45, 15.2),
    (40, 14.7),
    (35, 14.1),
    (30, 13.5),
    (25, 13.05),
    (20, 12.5),
    (15, 11.9),
    (10, 11.1),
    (5,  10.2),
    (0,  8.2),
]

def clamp(x, lo, hi):
    return max(lo, min(hi, x))

def lerp(a, b, t):
    return a + (b - a) * t

def scoring_to_percentile(score):
    low = SCORING_PCT_TABLE[0][1]
    high = SCORING_PCT_TABLE[-1][1]
    score = clamp(score, low, high)

    for i in range(len(SCORING_PCT_TABLE) - 1):
        p1, v1 = SCORING_PCT_TABLE[i]
        p2, v2 = SCORING_PCT_TABLE[i + 1]
        if v1 <= score <= v2:
            t = (score - v1) / (v2 - v1)
            return lerp(p1, p2, t)
    return 0

def percentile_to_pts36(pct):
    pct = clamp(pct, 0, 100)

    for i in range(len(PTS36_CURVE) - 1):
        p1, v1 = PTS36_CURVE[i]
        p2, v2 = PTS36_CURVE[i + 1]
        if p2 <= pct <= p1:
            t = (pct - p2) / (p1 - p2)
            return lerp(v2, v1, t)
    return 8.2

def scoring_to_game_points(score, minutes):
    pct = scoring_to_percentile(score)
    pts36 = percentile_to_pts36(pct)
    return pts36 * (minutes / 36)
