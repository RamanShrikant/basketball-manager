# game_sim.py
#
# FULL, CLEAN, FINAL VERSION — Pyodide safe, no duplication, no broken indentation
#
import asyncio
import math
import random

from bm_scoring import scoring_to_game_points
from assists import assists_per36, noisy_assists
from rebounds import get_rebounds
from steals import steals_per36, noisy_steals
from blocks import blocks_per36, noisy_blocks
from shooting_model import simulate_one_game

from efficiency import (
    fatigue_penalty, coverage_penalty, empty_minutes_penalty,
    star_boost, scale_range,
)

# ------------------------------------------------------------
# Utility helpers
# ------------------------------------------------------------

def clamp(x, lo, hi):
    return max(lo, min(hi, x))

def gauss(mu, sigma):
    return random.gauss(mu, sigma)

# ------------------------------------------------------------
# TEAM RATINGS
# ------------------------------------------------------------

def compute_team_ratings(team, mins):
    roster = []
    pos_min = {"PG": 0, "SG": 0, "SF": 0, "PF": 0, "C": 0}
    total_minutes = 0

    for p in team["players"]:
        m = mins.get(p["name"], 0)
        if m <= 0:
            continue

        total_minutes += m

        pos = p.get("pos", "SG")
        sec = p.get("secondaryPos")

        pos_min[pos] += m
        if sec:
            pos_min[sec] += m * 0.2

        roster.append({
            "player": p.get("name", "Unknown"),
            "minutes": m,
            "overall": p.get("overall", 75),
            "offRating": p.get("offRating", 75),
            "defRating": p.get("defRating", 75),
            "stamina": p.get("stamina", 75),
        })

    if total_minutes == 0:
        return {"overall": 0, "off": 0, "def": 0, "roster": []}

    eff_overall = []
    eff_off = []
    eff_def = []

    wavg_ovr = 0
    wavg_off = 0
    wavg_def = 0

    for r in roster:
        pen = fatigue_penalty(r["minutes"], r["stamina"])
        w = r["minutes"] / 240

        eff_o = r["overall"] * pen
        eff_f = r["offRating"] * pen
        eff_d = r["defRating"] * pen

        wavg_ovr += w * eff_o
        wavg_off += w * eff_f
        wavg_def += w * eff_d

        eff_overall.append({"eff": eff_o, "player": r})
        eff_off.append({"eff": eff_f, "player": r})
        eff_def.append({"eff": eff_d, "player": r})

    s_ovr = star_boost(eff_overall, star_exp=1.22)
    s_off = star_boost(eff_off, star_exp=1.20)
    s_def = star_boost(eff_def, star_exp=1.20)

    cov_pen = coverage_penalty(pos_min)
    empty_pen = empty_minutes_penalty(total_minutes)

    raw_ovr = wavg_ovr + s_ovr - cov_pen - empty_pen
    raw_off = wavg_off + s_off - cov_pen - empty_pen
    raw_def = wavg_def + s_def - cov_pen - empty_pen

    return {
        "overall": round(scale_range(raw_ovr)),
        "off": round(scale_range(raw_off)),
        "def": round(scale_range(raw_def)),
        "roster": roster
    }

# ------------------------------------------------------------
# EXPECTED POINTS / TEMPO
# ------------------------------------------------------------

OFF_MEAN = 80.0
DEF_MEAN = 80.0

BASE_O = 110.5
OFF_COEF = 18.0 / 33.0
DEF_COEF = 0.61

MARG_PER_OVR   = 0.26   # how much each rating point shifts expected margin
STYLE_MARGIN_K = 0.20   # extra style term: off vs def imbalance
TOTAL_SKEW_K   = 0.42   # small skew to totals for offensive juggernauts

def expected_points(off, opp_def):
    return BASE_O + OFF_COEF * (off - OFF_MEAN) - DEF_COEF * (opp_def - DEF_MEAN)

def tempo_multiplier(offA, defA, offB, defB):
    PACE_A = 0.0029
    PACE_D = 0.0032
    PACE_CLAMP = (0.83, 1.05)

    t = (
        PACE_A * ((offA - 80) + (offB - 80))
        - PACE_D * ((defA - 80) + (defB - 80))
    )
    return clamp(1 + t, PACE_CLAMP[0], PACE_CLAMP[1])

def sigma_margin(d):
    base = 10
    slope = 0.09
    extra = 0.5 * max(0, abs(d) - 18)
    return clamp(base - slope * abs(d) + extra, 7.5, 13.5)

def sigma_total(d):
    return clamp(14.0 - 0.10 * abs(d), 7.5, 11.0)

# ------------------------------------------------------------
# QUARTER SPLITTER
# ------------------------------------------------------------

def qsplit(total):
    weights = [random.random()*0.06 + 0.22 for _ in range(4)]
    s = sum(weights)
    scaled = [int(w*total/s) for w in weights]
    diff = total - sum(scaled)
    scaled[3] += diff
    return scaled
# ------------------------------------------------------------
# GRAIL SHOOTING ENGINE (per-player line)  🔥
# ------------------------------------------------------------

def lin(x, x1, y1, x2, y2):
    if x <= x1:
        return y1
    if x >= x2:
        return y2
    return y1 + (y2 - y1) * ((x - x1) / (x2 - x1))

def bino(n, p):
    c = 0
    for _ in range(n):
        if random.random() < p:
            c += 1
    return c

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

def p3_curve(r):
    if r <= 40:
        return 0.0
    if r <= 70:
        base = lin(r, 40, 0.01, 70, 0.32)
    elif r <= 80:
        base = lin(r, 70, 0.32, 80, 0.37)
    elif r <= 90:
        base = lin(r, 80, 0.37, 90, 0.41)
    elif r <= 95:
        base = lin(r, 90, 0.41, 95, 0.44)
    else:
        base = lin(r, 95, 0.44, 99, 0.46)

    if r >= 95:
        base += 0.01
    elif r >= 90:
        base += 0.008
    elif r >= 85:
        base += 0.006
    elif r >= 80:
        base += 0.004
    elif r >= 75:
        base += 0.002

    base *= 1.07
    return clamp(base, 0.0, 0.55)

def pMid_curve(r):
    if r <= 40:
        return 0.0
    if r <= 70:
        base = lin(r, 40, 0.33, 70, 0.41)
    elif r <= 90:
        base = lin(r, 70, 0.41, 90, 0.46)
    else:
        base = lin(r, 90, 0.46, 99, 0.50)
    base *= 1.04
    return clamp(base, 0.0, 0.54)

def pClose_curve(r):
    if r <= 40:
        return 0.46
    if r <= 70:
        base = lin(r, 40, 0.46, 70, 0.55)
    elif r <= 85:
        base = lin(r, 70, 0.55, 85, 0.60)
    else:
        base = lin(r, 85, 0.60, 99, 0.66)
    base *= 1.04
    return clamp(base, 0.0, 0.70)

def pFT_curve(r, avg_r):
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
    wClose = max(1, rClose - 50) + 18

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

def reconcile_line(stats, target_pts, player):
    r3, rMid, rClose, _ = player["attrs"][:4]
    off = player["offRating"]

    exp = PP36(off) * (stats["minutes"] / 36.0)
    eff_ratio = target_pts / exp if exp > 0 else 1.0
    strength = 1.0 + (eff_ratio - 1.0)

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

def simulate_player_line(player, minutes, target_pts, league_off_avg, league_ft_avg):
    r3, rMid, rClose, rFT = player["attrs"][:4]
    off = player["offRating"]

    p3r = p3_curve(r3)
    pMr = pMid_curve(rMid)
    pCr = pClose_curve(rClose)
    pFTr = pFT_curve(rFT, league_ft_avg)

    f3, fMid, fClose = shot_dist(r3, rMid, rClose)

    exp_pts = PP36(off) * (minutes / 36.0)
    ratio = target_pts / exp_pts if exp_pts > 0 else 1.0
    E = clamp(random.gauss(ratio, 0.15), 0.55, 1.55)

    exp_pp_fga = clamp(1.20 + 0.15 * ((off - league_off_avg) / 20.0), 0.9, 1.5)
    rawFGA = target_pts / (exp_pp_fga * E)
    rawFGA *= random.gauss(1.0, 0.05)
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

    threeM, midM, closeM, FTM, FTA = reconcile_line(stats, target_pts, player)
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

    FG_attempts = FGA
    FG_makes = FGM

    FG_pct = FG_makes / FG_attempts if FG_attempts > 0 else 0.0
    three_pct = threeM / threeA if threeA > 0 else 0.0
    FT_pct = FTM / FTA if FTA > 0 else 0.0

    return {
        "FGM": FG_makes,
        "FGA": FG_attempts,
        "3PM": threeM,
        "3PA": threeA,
        "FTM": FTM,
        "FTA": FTA,
        "FG%": FG_pct,
        "3P%": three_pct,
        "FT%": FT_pct,
        "PTS": pts,
    }

# ------------------------------------------------------------
# BOX SCORE GENERATION (FULL FUNCTION)
# ------------------------------------------------------------

async def build_box(team, mins, team_points, ratings):
    players = team["players"]

    active = []
    inactive = []

    for p in players:
        m = mins.get(p["name"], 0)
        if m > 0:
            active.append({**p, "minutes": m})
        else:
            inactive.append(p)

    expected = []
    for p in active:
        sr = p.get("scoringRating", 0)
        expected.append(scoring_to_game_points(sr, p["minutes"]))

    raw = [max(0, gauss(exp, max(1.2, math.sqrt(exp)*0.9))) for exp in expected]
    pts = [round(x) for x in raw]

    diff = team_points - sum(pts)
    while diff != 0:
        i = random.randrange(len(pts))
        if diff > 0:
            pts[i] += 1
            diff -= 1
        else:
            if pts[i] > 0:
                pts[i] -= 1
                diff += 1
            else:
                break

       # league-style averages for this team (proxy for grail's league averages)
    off_vals = [p.get("offRating", 75) for p in active]
    ft_vals = [(p.get("attrs") or [70]*15)[3] for p in active]
    league_off_avg = sum(off_vals) / len(off_vals) if off_vals else 80.0
    league_ft_avg = sum(ft_vals) / len(ft_vals) if ft_vals else 70.0

    rows = []
    for i, p in enumerate(active):
        if i % 3 == 0:
            await asyncio.sleep(0)

        P = pts[i]

        # 🔥 Use grail shooting model for this player
        stats = simulate_one_game(p, p["minutes"], P)

        rows.append({
            "player": p["name"],
            "min": p["minutes"],
            "pts": P,
            "fg": f"{stats['FGM']}/{stats['FGA']}",
            "3p": f"{stats['3PM']}/{stats['3PA']}",
            "ft": f"{stats['FTM']}/{stats['FTA']}",
            "reb": 0,
            "ast": 0,
            "stl": 0,
            "blk": 0,
            "to": 0,
            "pf": 0
        })


    simple = []
    for p in active:
        a = p.get("attrs") or [70]*15
        simple.append({
            "name": p["name"],
            "minutes": p["minutes"],
            "passing": a[5],
            "offiq": a[13],
            "overall": p.get("overall",75),
            "reb": a[12],
            "stl": a[11],
            "blk": a[10],
            "height": a[4] if len(a)>4 else 80,
            "pos": p.get("pos","SG")
        })

    total_reb = get_rebounds(simple, team_reb_rate=1.0)
    ast = []
    stl = []
    blk = []

    for sp in simple:
        m = sp["minutes"]

        per36_ast = assists_per36(sp["pos"], sp["passing"], sp["offiq"], sp["overall"])
        ast.append(noisy_assists(per36_ast*m/36))

        per36_stl = steals_per36(sp["pos"], sp["stl"], sp["overall"], sp["overall"])
        stl.append(noisy_steals(per36_stl * m / 36))

        per36_blk = blocks_per36(sp["pos"], sp["blk"], sp["height"], sp["overall"])
        blk.append(noisy_blocks(per36_blk * m / 36))

    for i, r in enumerate(rows):
        r["reb"] = total_reb[i]
        r["ast"] = ast[i]
        r["stl"] = stl[i]
        r["blk"] = blk[i]

    for p in inactive:
        rows.append({
            "player": p["name"],
            "min": 0,
            "pts": 0,
            "fg": "0/0",
            "3p": "0/0",
            "ft": "0/0",
            "reb": 0,
            "ast": 0,
            "stl": 0,
            "blk": 0,
            "to": 0,
            "pf": 0,
        })

    return rows


# ------------------------------------------------------------
# MAIN ENTRYPOINT — simulate_game
# ------------------------------------------------------------

async def simulate_game(home, away):
    print("🔍 PY starting simulate_game:", home["name"], "vs", away["name"])
    await asyncio.sleep(0)

    minsH = home["minutes"]
    minsA = away["minutes"]

    rateH = compute_team_ratings(home, minsH)
    rateA = compute_team_ratings(away, minsA)

    dOvr = rateH["overall"] - rateA["overall"]

    pace = tempo_multiplier(rateH["off"], rateH["def"], rateA["off"], rateA["def"])
    muH = expected_points(rateH["off"], rateA["def"]) * pace
    muA = expected_points(rateA["off"], rateH["def"]) * pace

    # ---------- NEW: parity-friendly margin model (from old JS) ----------
    favored = rateH if dOvr >= 0 else rateA

    # compress how much rating difference turns into margin
    base_margin = MARG_PER_OVR * dOvr          # MARG_PER_OVR = 0.26
    style_term  = STYLE_MARGIN_K * (
        (rateH["off"] - rateA["def"]) - (rateA["off"] - rateH["def"])
    )                                           # STYLE_MARGIN_K = 0.20

    margin_mu = base_margin + style_term
    # extra compression for huge gaps
    margin_mu *= 1.0 / (1.0 + 0.018 * abs(dOvr))

    # identity / style skew: offensive juggernauts get a small bump
    ident_skew = TOTAL_SKEW_K * (
        (favored["off"] - OFF_MEAN) - (favored["def"] - DEF_MEAN)
    ) / 2.0                                     # TOTAL_SKEW_K = 0.42

    # total points mean + a bit of style skew
    total_mu = (muH + muA) + ident_skew

    # make variance a bit bigger -> more parity
    sigmaT = sigma_total(dOvr) * 0.75
    sigmaM = sigma_margin(dOvr) * 0.75

    # explicit upset chance (2–5.5% even for big gaps)
    upset_chance = clamp(
        0.015 + 0.05 * math.exp(-abs(dOvr) / 12.0),
        0.02,
        0.055,
    )
    if random.random() < upset_chance:
        # flip the sign and shrink margin when upset happens
        margin_mu *= -1.0 * (0.60 + 0.80 * random.random())

    # sample final total + margin
    sampled_total  = gauss(total_mu,  sigmaT)
    sampled_margin = gauss(margin_mu, sigmaM)

    Hscore = clamp(round((sampled_total + sampled_margin) / 2), 85, 150)
    Ascore = clamp(round(sampled_total - Hscore), 85, 150)


    Hscore = clamp(round((sampled_total + sampled_margin) / 2), 85, 150)
    Ascore = clamp(round(sampled_total - Hscore), 85, 150)

    HQ = qsplit(Hscore)
    AQ = qsplit(Ascore)
    ot_count = 0

    while sum(HQ[:4]) == sum(AQ[:4]):
        await asyncio.sleep(0)
        otH = clamp(round(gauss(12, 3)), 6, 22)
        otA = clamp(round(gauss(12, 3)), 6, 22)
        HQ.append(otH)
        AQ.append(otA)
        ot_count += 1

    finalH = sum(HQ)
    finalA = sum(AQ)

    home_box = await build_box(home, minsH, finalH, rateH)
    away_box = await build_box(away, minsA, finalA, rateA)

    print("✅ PY finished:", home["name"], "vs", away["name"])

    return {
        "score": {"home": finalH, "away": finalA},
        "quarters_home": list(HQ),
        "quarters_away": list(AQ),
        "box_home": home_box,
        "box_away": away_box,
        "ratings_home": rateH,
        "ratings_away": rateA,
        "ot": int(ot_count)
    }

