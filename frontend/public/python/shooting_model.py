# shooting_model.py
# Pure shooting / efficiency model extracted from your friend's Tkinter tool,
# with all UI / JSON loading removed. This ONLY handles one player game stats.

import math
import random

DEBUG_PLAYERS = {"Karl-Anthony Towns", "Jaylen Brown", "Lauri Markkanen"}
_debug_counts = {}
MAX_DEBUG_GAMES = 8  # don’t spam 82 lines
VERSION_TAG = "v_midclose_debug_1"

# -----------------------------
# small helpers
# -----------------------------
def _should_debug(name):
    n = _debug_counts.get(name, 0)
    if n >= MAX_DEBUG_GAMES:
        return False
    _debug_counts[name] = n + 1
    return True


def clamp(x, a, b):
    return a if x < a else b if x > b else x


def lin(x, x1, y1, x2, y2):
    if x <= x1:
        return y1
    if x >= x2:
        return y2
    return y1 + (y2 - y1) * ((x - x1) / (x2 - x1))


def bino(n, p):
    """Simple binomial via n Bernoulli draws."""
    c = 0
    for _ in range(n):
        if random.random() < p:
            c += 1
    return c


# Approximate league constants from the original tool
LEAGUE_OFF_AVG = 78.0         # average offRating in the league
LEAGUE_FT_AVG_RATING = 68.5   # comment in original code

# --- Points-per-36 curve based on offRating ---
PP_POINTS = [
    (60, 10),
    (65, 12),
    (70, 14),
    (75, 16),
    (80, 18),
    (82, 20),
    (85, 22),
    (88, 25),
    (90, 27),
    (92, 29),
    (95, 31),
    (97, 32),
    (99, 33),
]


def PP36(off):
    if off <= 60:
        return 10
    if off >= 99:
        return 33
    for (x1, y1), (x2, y2) in zip(PP_POINTS, PP_POINTS[1:]):
        if x1 <= off <= x2:
            return y1 + (y2 - y1) * ((off - x1) / (x2 - x1))
    return 20.0


# -------------------------------------------------------
# SHOOTING CURVES
# -------------------------------------------------------
def p3_curve(r):
    if r <= 40:
        return 0.0
    if r <= 70:
        base = lin(r, 40, 0.01, 70, 0.30)
    elif r <= 80:
        base = lin(r, 70, 0.30, 80, 0.36)
    elif r <= 90:
        base = lin(r, 80, 0.36, 90, 0.40)
    elif r <= 95:
        base = lin(r, 90, 0.40, 95, 0.42)
    else:
        base = lin(r, 95, 0.42, 99, 0.44)

    # no extra per-rating bonuses, no 1.02 multiplier
    return clamp(base, 0.0, 0.46)





def pMid_curve(r):
    """
    Midrange make probability.

    Goal:
    - Scrubs still bad.
    - 80–90 rated shooters get a noticeable bump (helps KAT / Jaylen / Lauri).
    - 95+ barely move (they're already fine).
    """
    if r <= 40:
        return 0.0

    if r <= 70:
        # was roughly 0.33 → 0.41
        base = lin(r, 40, 0.37, 70, 0.47)
    elif r <= 90:
        # push good mids into high-40s / low-50s
        base = lin(r, 70, 0.47, 90, 0.53)
    else:
        # true midrange gods live here
        base = lin(r, 90, 0.53, 99, 0.57)

    # extra love for the “middle-star” band
    if 75 <= r <= 88:
        base *= 1.04
    elif r > 88:
        base *= 1.015  # tiny bump for elites so they don't go crazy

    return clamp(base, 0.0, 0.60)


def pClose_curve(r):
    if r <= 40:
        base = 0.48  # was 0.46
    elif r <= 70:
        # was 0.46 → 0.55
        base = lin(r, 40, 0.48, 70, 0.58)
    elif r <= 85:
        # was 0.55 → 0.60
        base = lin(r, 70, 0.58, 85, 0.63)
    else:
        # was 0.60 → 0.66
        base = lin(r, 85, 0.63, 99, 0.70)

    # again: no 1.04 multiplier, anchors are already juiced
    return clamp(base, 0.0, 0.75)


def pFT_curve(r):
    avg_r = LEAGUE_FT_AVG_RATING

    if r <= 25:
        return clamp(lin(r, 0, 0.30, 25, 0.50), 0.0, 1.0)
    if r <= avg_r:
        return lin(r, 25, 0.50, avg_r, 0.78)
    return clamp(lin(r, avg_r, 0.78, 99, 0.935), 0.0, 1.0)


def FTr(close_rating):
    return clamp(0.12 + 0.25 * ((close_rating - 50) / 50), 0.05, 0.45)


def shot_dist(r3, rMid, rClose):
    if r3 <= 40 and rMid <= 40:
        return 0.0, 0.0, 1.0

    w3 = max(0, r3 - 40) * 1.7
    wMid = max(0, rMid - 40) * 0.8
    wClose = (max(1, rClose - 50) + 18) * 0.95   # 5% less rim bias


    S = w3 + wMid + wClose
    f3 = w3 / S
    fMid = wMid / S
    fClose = wClose / S

    if rClose >= 97 and r3 <= 75:
        f3 = min(f3, 0.15)
        fClose = 1.0 - f3 - fMid

    if r3 <= 40:
        f3 = 0.0
    if rMid <= 40:
        fMid = 0.0
    if f3 + fMid == 0:
        fClose = 1.0

    return f3, fMid, fClose


# -------------------------------------------------------
# RECONCILIATION
# -------------------------------------------------------
def reconcile(stats, target_pts, player):
    r3, rMid, rClose, _ = player["attrs"][:4]
    off = player["offRating"]

    exp = PP36(off) * (stats["minutes"] / 36.0)
    eff_ratio = target_pts / exp if exp > 0 else 1.0  # debug only

    strength = 1.0  # don’t scale adjustments by eff_ratio


    total2 = rMid + rClose if (rMid + rClose) > 0 else 1
    pmid_w = rMid / total2
    pclose_w = rClose / total2

    threeA = stats["3PA"]
    midA = stats["midA"]
    closeA = stats["closeA"]
    threeM = stats["3PM"]
    midM = stats["midM"]
    closeM = stats["closeM"]
    FTM = stats["FTM"]
    FTA = stats["FTA"]

    def pts():
        return (midM + closeM) * 2 + threeM * 3 + FTM

    diff = target_pts - pts()

    for _ in range(200):
        if diff == 0:
            break

        if diff > 0:
            need2 = int((diff / 2.0) * strength)
            for _ in range(max(0, need2)):
                if diff <= 0:
                    break
                roll = random.random()
                if midM < midA and roll < pmid_w:
                    midM += 1
                    diff -= 2
                elif closeM < closeA:
                    closeM += 1
                    diff -= 2
            if diff <= 0:
                continue

            need3 = int((diff / 3.0) * strength)
            for _ in range(max(0, need3)):
                if diff <= 0:
                    break
                if threeM < threeA:
                    threeM += 1
                    diff -= 3
            if diff <= 0:
                continue

            if diff == 1 and threeM < threeA and (midM > 0 or closeM > 0):
                threeM += 1
                diff -= 3
                if midM > 0 and random.random() < pmid_w:
                    midM -= 1
                    diff += 2
                elif closeM > 0:
                    closeM -= 1
                    diff += 2

        else:
            need2 = int((abs(diff) / 2.0) * strength)
            for _ in range(max(0, need2)):
                if diff >= 0:
                    break
                if midM > 0 or closeM > 0:
                    roll = random.random()
                    if midM > 0 and roll < pmid_w:
                        midM -= 1
                        diff += 2
                    elif closeM > 0:
                        closeM -= 1
                        diff += 2
            if diff >= 0:
                continue

            need3 = int((abs(diff) / 3.0) * strength)
            for _ in range(max(0, need3)):
                if diff >= 0:
                    break
                if threeM > 0:
                    threeM -= 1
                    diff += 3
            if diff >= 0:
                continue

            if diff == -1 and threeM > 0 and (midM < midA or closeM < closeA):
                threeM -= 1
                diff += 3
                roll = random.random()
                if midM < midA and roll < pmid_w:
                    midM += 1
                    diff -= 2
                elif closeM < closeA:
                    closeM += 1
                    diff -= 2

    diff = target_pts - pts()

    if diff > 0:
        while diff > 0 and (midM < midA or closeM < closeA or threeM < threeA):
            if midM < midA and random.random() < pmid_w:
                midM += 1
                diff -= 2
                continue
            if closeM < closeA:
                closeM += 1
                diff -= 2
                continue
            if threeM < threeA:
                threeM += 1
                diff -= 3
                continue

        if diff > 0:
            FTA += diff
            FTM += diff
            diff = 0

    elif diff < 0:
        while diff < 0 and (midM > 0 or closeM > 0 or threeM > 0):
            if midM > 0 and random.random() < pmid_w:
                midM -= 1
                diff += 2
                continue
            if closeM > 0:
                closeM -= 1
                diff += 2
                continue
            if threeM > 0:
                threeM -= 1
                diff += 3
                continue

        if diff < 0 and FTM > 0:
            k = min(-diff, FTM)
            FTM -= k
            FTA = max(0, FTA - k)
            diff += k

        if diff > 0:
            FTA += diff
            FTM += diff
            diff = 0

    return threeM, midM, closeM, FTM, FTA


# -------------------------------------------------------
# MAIN: simulate_one_game
# -------------------------------------------------------
def simulate_one_game(player, minutes, target_pts):
    r3, rMid, rClose, rFT = player["attrs"][:4]
    off = player["offRating"]

    debug = player["name"] in DEBUG_PLAYERS and _should_debug(player["name"])

    p3r = p3_curve(r3)
    pMr = pMid_curve(rMid)
    pCr = pClose_curve(rClose)
    pFTr = pFT_curve(rFT)

    if debug:
        print(
            f"[FGDBG PRE] {player['name']} "
            f"r3/rMid/rClose={r3}/{rMid}/{rClose} "
            f"p3/pMid/pClose={p3r:.3f}/{pMr:.3f}/{pCr:.3f}"
        )

    f3, fMid, fClose = shot_dist(r3, rMid, rClose)

    if debug:
        print(
            f"[FGDBG DIST] {player['name']} "
            f"f3/fMid/fClose={f3:.3f}/{fMid:.3f}/{fClose:.3f}"
        )

    exp_pts = PP36(off) * (minutes / 36.0)
    ratio = target_pts / exp_pts if exp_pts > 0 else 1.0  # just for debug

    if debug:
        print(
            f"[FGDBG RATIO] {player['name']} "
            f"target={target_pts:.1f} exp={exp_pts:.1f} ratio={ratio:.3f}"
        )

    # Luck only – don’t bias efficiency by ratio
    E = clamp(random.gauss(1.0, 0.08), 0.80, 1.20)


    two_rating = 0.60 * rClose + 0.40 * rMid
    two_norm   = (two_rating - 75.0) / 18.0
    off_norm   = (off - LEAGUE_OFF_AVG) / 20.0

    # 🔧 Slightly lower baseline + weaker star scaling
    exp_pp_fga = 1.28 + 0.12 * two_norm + 0.02 * off_norm
    exp_pp_fga = clamp(exp_pp_fga, 1.00, 1.65)


    rawFGA = target_pts / (exp_pp_fga * E)
    rawFGA *= random.gauss(1.0, 0.02)
    FGA = max(1, int(rawFGA))

    tr = FTr(rClose)
    FTA = max(0, int(round(FGA * tr)))
    if FTA % 2 == 1 and target_pts > 1:
        FTA += 1

    while True:
        threeA = int(round(FGA * f3))
        midA = int(round(FGA * fMid))
        closeA = FGA - threeA - midA
        max_pts = 3 * threeA + 2 * (midA + closeA) + FTA
        if max_pts >= target_pts or FGA > 80:
            break
        FGA += 1
        FTA = max(0, int(round(FGA * tr)))
        if FTA % 2 == 1 and target_pts > 1:
            FTA += 1

    if debug:
        print(
            f"[FGDBG SIM] {player['name']} "
            f"mins={minutes} targetPts={target_pts} "
            f"E={E:.3f} two_norm={two_norm:.3f} off_norm={off_norm:.3f} "
            f"exp_pp_fga={exp_pp_fga:.3f} FGA={FGA} "
            f"3A/midA/closeA={threeA}/{midA}/{closeA}"
        )

    threeM = bino(threeA, p3r)
    midM = bino(midA, pMr)
    closeM = bino(closeA, pCr)
    FTM = bino(FTA, pFTr)

    stats = {
        "FGA": FGA,
        "3PA": threeA,
        "midA": midA,
        "closeA": closeA,
        "3PM": threeM,
        "midM": midM,
        "closeM": closeM,
        "FTM": FTM,
        "FTA": FTA,
        "minutes": minutes,
    }

    threeM, midM, closeM, FTM, FTA = reconcile(stats, target_pts, player)
    FGM = threeM + midM + closeM
    pts = FTM + threeM * 3 + (midM + closeM) * 2

    if pts != target_pts:
        diff = target_pts - pts
        if diff > 0:
            FTA += diff
            FTM += diff
            pts = target_pts
        else:
            diff = -diff
            k = min(diff, FTM)
            FTM -= k
            FTA = max(0, FTA - k)
            pts -= k
            diff -= k

            while diff > 0 and FGM > 0:
                if midM > 0:
                    midM -= 1
                    FGM -= 1
                    pts -= 2
                    diff -= 2
                    continue
                if closeM > 0:
                    closeM -= 1
                    FGM -= 1
                    pts -= 2
                    diff -= 2
                    continue
                if threeM > 0:
                    threeM -= 1
                    FGM -= 1
                    pts -= 3
                    diff -= 3
                    continue

            if pts < target_pts:
                extra = target_pts - pts
                FTA += extra
                FTM += extra
                pts = target_pts

    if debug:
        print(
            f"[FGDBG FINAL] {player['name']} "
            f"FGM/FGA={FGM}/{FGA} "
            f"3PM/3PA={threeM}/{threeA} "
            f"midM/midA={midM}/{midA} "
            f"closeM/closeA={closeM}/{closeA} "
            f"PTS={pts}"
        )

    return {
        "FGM": FGM,
        "FGA": FGA,
        "3PM": threeM,
        "3PA": threeA,
        "FTM": FTM,
        "FTA": FTA,
    }

