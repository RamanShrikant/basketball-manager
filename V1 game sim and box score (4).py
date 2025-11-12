import tkinter as tk
from tkinter import ttk
import json, itertools, random, math

# --- Load JSON ---
with open("atlantic northwest bucks cavs.json", "r", encoding="utf-8") as f:
    data = json.load(f)

teams = [t for conf in data["conferences"].values() for t in conf]
POSITIONS = ["PG", "SG", "SF", "PF", "C"]

# ===================== Team Rating Calib Constants (from your widened-scale block) =====================
TR_GAIN            = 1.30
TR_STAR_REF        = 84.0
TR_STAR_SCALE      = 1.00
TR_STAR_EXP_OVR    = 1.22
TR_STAR_EXP_OFF    = 1.20
TR_STAR_EXP_DEF    = 1.20
TR_STAR_SHARE_EXP  = 0.45
TR_STAR_OUT_EXP    = 0.85

TR_COV_ALPHA       = 15.0
TR_OVERPOS_MAXPT   = 6.0
TR_EMPTY_MIN_PTS   = 35.0

TR_FATIGUE_FLOOR   = 0.68
TR_FATIGUE_K       = 0.010
# =========================================================================================

# ===================== GAME SCORING CALIBRATION (targets 105–122 season averages) =====================
OFF_MEAN = 80.0
DEF_MEAN = 80.0

# Restore linear endpoints: OFF 98 ≈ 122 vs avg DEF; OFF 65 ≈ 105 vs avg DEF (and symmetric for DEF)
BASE_O   = 111.5
OFF_COEF = 19.0/33.0    # ≈0.576
DEF_COEF = 19.0/33.0
DEF_BIAS = 0.0

# Pace kept tighter to hold team PF/PA band inside ~105–122 on average
PACE_A   = 0.0032
PACE_D   = 0.0030
PACE_CLAMP = (0.84, 1.07)


def clamp(x, lo, hi): 
    return max(lo, min(hi, x))

def sigma_margin_for_delta(d):
    # More variance when the overall gap is large → trims top-end win% and lifts bottom teams
    gap   = abs(d)
    base  = 10.6
    slope = 0.10
    extra = 0.60 * max(0.0, gap - 18.0)
    return max(10.0, min(16.0, base - slope * gap + extra))

def sigma_total_for_delta(d):
    # Modest variance in totals; OFF/DEF still drive spread.
    return max(10.0, min(15.0, 15.0 - 0.10 * abs(d)))

MARG_PER_OVR   = 0.27      # was 0.295
STYLE_MARGIN_K = 0.22      # was 0.16
TOTAL_SKEW_K   = 0.48      # keep

# -----------------------------------------------------------------------------------------
# Shared helpers
# -----------------------------------------------------------------------------------------

def fatigue_threshold(stamina): return 0.359 * stamina + 2.46
def fatigue_penalty(minutes, stamina):
    threshold = fatigue_threshold(stamina)
    over = max(0, minutes - threshold)
    return max(TR_FATIGUE_FLOOR, 1 - TR_FATIGUE_K * over)

def _coverage_penalty(pos_minutes):
    target = 48.0
    coverage_error = sum(abs(pos_minutes[pos] - target) for pos in POSITIONS)
    cov_pen = (coverage_error / 240.0) * TR_COV_ALPHA
    worst_over = max(0.0, max(pos_minutes[pos] - target for pos in POSITIONS))
    over_pen = (worst_over / 192.0) * TR_OVERPOS_MAXPT
    return cov_pen + over_pen

def _scale_to_range(raw):
    scaled = (raw - 75.0) * TR_GAIN + 75.0
    return max(25.0, min(99.0, scaled))

def _star_boost(eff_list, star_exp, ref=TR_STAR_REF):
    if not eff_list:
        return 0.0
    eff_sorted = sorted(eff_list, key=lambda x: x[0], reverse=True)[:2]
    pull = 0.0
    for eff, p in eff_sorted:
        gap = max(0.0, p.get("overall", p.get("offRating", p.get("defRating", 75))) - ref)
        if gap <= 0:
            continue
        share = max(0.0, p["minutes"] / 240.0) ** TR_STAR_SHARE_EXP
        pull += (gap ** star_exp) * share
    return TR_STAR_SCALE * (pull ** TR_STAR_OUT_EXP)

def _agg_with_fatigue(roster, key):
    if not roster:
        return 0.0, []
    eff_list = []
    for p in roster:
        m = p["minutes"]
        pen = fatigue_penalty(m, p.get("stamina", 75))
        eff = p.get(key, 75) * pen
        eff_list.append((eff, p))
    wavg = sum((p["minutes"] / 240.0) * eff for eff, p in eff_list)
    return wavg, eff_list

def expected_points_for(off, opp_def):
    return BASE_O + OFF_COEF*(off - OFF_MEAN) - DEF_COEF*(opp_def - DEF_MEAN) + DEF_BIAS

def pace_multiplier(offA, defA, offB, defB):
    tempo = PACE_A * ((offA - OFF_MEAN) + (offB - OFF_MEAN)) - PACE_D * ((defA - DEF_MEAN) + (defB - DEF_MEAN))
    return clamp(1.0 + tempo, *PACE_CLAMP)

def autocomplete_minutes_and_ratings_for_team(team_obj):
    players = [dict(p) for p in sorted(team_obj["players"], key=lambda x: x["overall"], reverse=True)]
    for i, p in enumerate(players):
        p["minutes"] = 0
        p["_value"] = p.get("overall", 75)
        p["_score"] = p.get("overall", 75) + (p.get("stamina", 70) - 70) * 0.15

    # pick ~10, ensure positional coverage
    chosen = []
    for pos in POSITIONS:
        pos_players = [p for p in players if p.get("pos") == pos or p.get("secondaryPos") == pos]
        if pos_players:
            best = max(pos_players, key=lambda x: x["_score"])
            if best not in chosen:
                chosen.append(best)
    for p in sorted(players, key=lambda x: x["_score"], reverse=True):
        if len(chosen) >= 10: break
        if p not in chosen: chosen.append(p)

    # seed minutes evenly then optimize for team OVR
    for p in chosen: p["minutes"] = 12
    remain = 240 - (12 * len(chosen)); i = 0
    while remain > 0:
        chosen[i % len(chosen)]["minutes"] += 1
        remain -= 1; i += 1

    def _team_total(arr):
        pos_tot = {pos: 0 for pos in POSITIONS}
        off = deff = ovr = 0
        for p in arr:
            m = p["minutes"]
            if m <= 0: continue
            pen = fatigue_penalty(m, p.get("stamina", 75))
            w = m / 240.0
            off += w * (p.get("offRating", 75) * pen)
            deff += w * (p.get("defRating", 75) * pen)
            ovr += w * (p.get("overall", 75) * pen)
            pos_tot[p.get("pos","SG")] += m
            sec = p.get("secondaryPos")
            if sec: pos_tot[sec] += m * 0.2
        missing = sum(max(0, 48 - pos_tot[pos]) for pos in POSITIONS)
        cov_pen = 1 - (0.02 * (missing / 240.0))
        return (off * cov_pen, deff * cov_pen, ovr * cov_pen)

    improved = True
    while improved:
        improved = False
        base_ovr = _team_total(chosen)[2]
        for a in chosen:
            for b in chosen:
                if a == b or a["minutes"] <= 12: continue
                if b["minutes"] >= 24 and b not in chosen[:5]: continue
                a["minutes"] -= 1; b["minutes"] += 1
                new_ovr = _team_total(chosen)[2]
                if new_ovr > base_ovr:
                    base_ovr = new_ovr; improved = True
                else:
                    a["minutes"] += 1; b["minutes"] -= 1

    # choose starters by max avg OVR, prefer primaries
    PRIMARY_BONUS = 0.02
    SECONDARY_PEN = 0.01
    best_mapping, best_score = None, -1e9
    for combo in itertools.combinations(chosen, 5):
        elig = {}
        for pl in combo:
            slots = set()
            if pl.get("pos") in POSITIONS: slots.add(pl["pos"])
            sec = pl.get("secondaryPos")
            if sec in POSITIONS: slots.add(sec)
            elig[pl["name"]] = slots
        for perm in itertools.permutations(POSITIONS):
            valid = True; primary_hits = 0; sec_uses = 0; score_sum = 0.0; mapping = {}
            for player, slot in zip(combo, perm):
                if slot not in elig[player["name"]]: valid = False; break
                mapping[slot] = player; score_sum += player.get("overall", 75)
                if slot == player.get("pos"): primary_hits += 1
                elif player.get("secondaryPos") == slot: sec_uses += 1
            if not valid: continue
            avg_ovr = score_sum / 5.0
            score = avg_ovr + PRIMARY_BONUS * primary_hits - SECONDARY_PEN * sec_uses
            if score > best_score:
                best_score = score; best_mapping = mapping

    if not best_mapping:
        lineup = sorted(chosen, key=lambda x: x.get("overall", 75), reverse=True)[:5]
        best_mapping = {pos: ply for pos, ply in zip(POSITIONS, lineup)}

    starters = [best_mapping[p] for p in POSITIONS if p in best_mapping]
    bench = [p for p in chosen if p not in starters]; bench.sort(key=lambda x: -x["minutes"])
    ordered = starters + bench + [p for p in players if p not in chosen]

    # compute ratings from minutes
    roster = []; pos_minutes = {p: 0.0 for p in POSITIONS}; total_minutes = 0
    for p in ordered:
        m = p.get("minutes", 0)
        if m <= 0: continue
        total_minutes += m
        pos_minutes[p.get("pos","SG")] += m
        if p.get("secondaryPos"): pos_minutes[p["secondaryPos"]] += m * 0.20
        roster.append({
            "minutes": m, "stamina": p.get("stamina", 75),
            "overall": p.get("overall", 75), "offRating": p.get("offRating", 75),
            "defRating": p.get("defRating", 75), "pos": p.get("pos", "SG"),
            "secondaryPos": p.get("secondaryPos")
        })

    if total_minutes == 0:
        ratings = {"overall": 0.0, "off": 0.0, "def": 0.0}
        return ordered, ratings

    base_ovr, eff_ovr = _agg_with_fatigue(roster, "overall")
    base_off, eff_off = _agg_with_fatigue(roster, "offRating")
    base_def, eff_def = _agg_with_fatigue(roster, "defRating")

    star_ovr = _star_boost(eff_ovr, TR_STAR_EXP_OVR, ref=TR_STAR_REF)
    star_off = _star_boost(eff_off, TR_STAR_EXP_OFF, ref=TR_STAR_REF)
    star_def = _star_boost(eff_def, TR_STAR_EXP_DEF, ref=TR_STAR_REF)

    cov_pen = _coverage_penalty(pos_minutes)
    empty_pen = 0.0
    if total_minutes < 240:
        empty_frac = (240 - total_minutes) / 240.0
        empty_pen = TR_EMPTY_MIN_PTS * (empty_frac ** 0.85)

    raw_off = base_off + star_off - cov_pen - empty_pen
    raw_def = base_def + star_def - cov_pen - empty_pen
    raw_ovr = base_ovr + star_ovr - cov_pen - empty_pen

    team_off = _scale_to_range(raw_off)
    team_def = _scale_to_range(raw_def)
    team_ovr = _scale_to_range(raw_ovr)
    ratings = {"overall": team_ovr, "off": team_off, "def": team_def}
    return ordered, ratings

def sim_match_from_ratings(rA, rB):
    """
    Point differentials widened, but win% spread moderated toward ~80/20.
    PF/PA is still asymmetric via favorite identity.
    """
    # base TOTAL from OFF/DEF and pace
    base_A = expected_points_for(rA["off"], rB["def"])
    base_B = expected_points_for(rB["off"], rA["def"])
    pace   = pace_multiplier(rA["off"], rA["def"], rB["off"], rB["def"])
    total_mean = (base_A + base_B) * pace

    # deterministic margin: overall edge + style edge
    margin_ovr   = MARG_PER_OVR * (rA["overall"] - rB["overall"])
    style_term   = ((rA["off"] - rB["def"]) - (rB["off"] - rA["def"]))
    margin_style = STYLE_MARGIN_K * style_term
    margin_det   = margin_ovr + margin_style
    
    # Gentle compression for very large OVR gaps → trims top-end win% and adds a few underdog wins
    gap = abs(rA["overall"] - rB["overall"])
    if gap > 18:
        # Up to ~32% compression by gap 30 (linear ramp from 18→30)
        margin_det *= (1.0 - 0.32 * min(1.0, (gap - 18.0) / 12.0))

    # skew TOTAL toward favorite identity
    if margin_det >= 0:
        skew_raw = (rA["off"] - rA["def"]) / 20.0
    else:
        skew_raw = (rB["off"] - rB["def"]) / 20.0
    skew = clamp(skew_raw, -1.0, 1.0)
    total_det = total_mean + TOTAL_SKEW_K * skew * abs(margin_det)

    # sample
    sig_m = sigma_margin_for_delta(rA["overall"] - rB["overall"])
    sig_t = sigma_total_for_delta(rA["overall"] - rB["overall"])
    sampled_margin = random.gauss(margin_det,  sig_m)
    sampled_total  = random.gauss(total_det,    sig_t)

    # --- Underdog shock: zero-mean-ish volatility that appears more with large gaps,
    # with a slight bias against the favorite (keeps average margins similar, raises upset rate).
    gap = abs(rA["overall"] - rB["overall"])
    p_shock   = clamp((gap - 8.0) / 24.0, 0.0, 0.55)          # up to 55% chance on very large gaps
    shock_std = 3.2 + 0.12 * gap                               # 3–6 pts typical
    # tiny bias that nudges against the favorite (≤ ~0.35 pts for huge gaps)
    bias = -0.35 * min(1.0, gap / 20.0) if margin_det >= 0 else +0.35 * min(1.0, gap / 20.0)
    if random.random() < p_shock:
        sampled_margin += random.gauss(bias, shock_std)    

    sA = int(round((sampled_total + sampled_margin) / 2.0))
    sB = int(round((sampled_total - sampled_margin) / 2.0))

    sA = clamp(sA, 85, 150); sB = clamp(sB, 85, 150)
    while sA == sB:
        sA += random.randint(8,16)
        sB += random.randint(8,16)
    return sA, sB

# ---------- COACH GAMEPLAN PANEL ----------
class TeamPanel(tk.Frame):
    def __init__(self, parent, label, on_update=None):
        super().__init__(parent, bg="white", bd=2, relief="solid")
        self.pack(side="left", fill="both", expand=True, padx=6, pady=6)
        self.label = label
        self.on_update = on_update
        self.players, self.sliders = [], []
        self.selected = None
        self.current_team = None
        self.team_data = {}
        self.team_ratings = {"overall": 0, "off": 0, "def": 0}

        tk.Label(self, text=label, font=("Arial", 12, "bold"), bg="white").pack(pady=3)

        top = tk.Frame(self, bg="white"); top.pack(pady=4)
        tk.Label(top, text="Select Team:", bg="white", font=("Arial", 9)).pack(side="left", padx=4)
        self.team_combo = ttk.Combobox(
            top, values=[t["name"] for t in teams],
            state="readonly", width=28, font=("Arial", 9)
        )
        self.team_combo.pack(side="left", padx=4)
        self.team_combo.bind("<<ComboboxSelected>>", self.show_team)

        pos_frame = tk.Frame(self, bg="white"); pos_frame.pack(pady=3)
        self.pos_labels = {}
        for pos in POSITIONS:
            lbl = tk.Label(pos_frame, text=f"{pos}: 0/48", font=("Arial", 9, "bold"), bg="white")
            lbl.pack(side="left", padx=8)
            self.pos_labels[pos] = lbl

        self.table = tk.Frame(self, bg="white"); self.table.pack(pady=8)
        headers = ["", "Player", "Pos", "OVR", "OFF", "DEF", "STA", "Minutes", "Role"]
        for i, h in enumerate(headers):
            tk.Label(self.table, text=h, font=("Arial", 9, "bold"), bg="white").grid(row=0, column=i, padx=4, pady=2)

        bottom = tk.Frame(self, bg="white"); bottom.pack(pady=5)
        self.total_lbl = tk.Label(bottom, text="Total Minutes: 0 / 240", font=("Arial", 9, "bold"), bg="white")
        self.total_lbl.pack(side="left", padx=6)
        self.remain_lbl = tk.Label(bottom, text="Remaining: 240", font=("Arial", 9, "bold"), bg="white")
        self.remain_lbl.pack(side="left", padx=6)

        tf = tk.Frame(self, bg="white"); tf.pack(pady=6)
        self.team_overall_lbl = tk.Label(tf, text="Team Overall: 0.0", font=("Arial", 11, "bold"), bg="white")
        self.team_off_lbl = tk.Label(tf, text="Offense: 0.0", font=("Arial", 11), bg="white")
        self.team_def_lbl = tk.Label(tf, text="Defense: 0.0", font=("Arial", 11), bg="white")
        self.team_overall_lbl.pack(side="left", padx=10)
        self.team_off_lbl.pack(side="left", padx=10)
        self.team_def_lbl.pack(side="left", padx=10)

        auto = tk.Frame(self, bg="white"); auto.pack(pady=8)
        self.auto_btn = tk.Button(
            auto, text="Autocomplete", font=("Arial", 10, "bold"),
            bg="#2b85ff", fg="white", relief="flat", command=self.autocomplete_rotation
        )
        self.auto_btn.pack(pady=2)

    def fatigue_threshold(self, stamina): return 0.359 * stamina + 2.46
    def fatigue_penalty(self, minutes, stamina):
        threshold = self.fatigue_threshold(stamina)
        over = max(0, minutes - threshold)
        return max(TR_FATIGUE_FLOOR, 1 - TR_FATIGUE_K * over)

    def save_current_team(self):
        if not self.current_team or not self.players:
            return
        for s, p in self.sliders:
            p["minutes"] = s.get()
        self.team_data[self.current_team] = [dict(p) for p in self.players]

    def load_team_data(self, name):
        if name in self.team_data:
            return [dict(p) for p in self.team_data[name]]
        team = next(t for t in teams if t["name"] == name)
        arr = []
        for i, p in enumerate(sorted(team["players"], key=lambda x: x["overall"], reverse=True)):
            d = dict(p)
            d["minutes"] = 24 if i < 5 else 0
            arr.append(d)
        self.team_data[name] = arr
        return arr

    def show_team(self, _=None):
        if self.current_team:
            self.save_current_team()
        name = self.team_combo.get()
        if not name:
            return
        self.current_team = name
        self.players = self.load_team_data(name)
        self.draw_table()

    def select_player(self, i):
        if self.selected is None:
            self.selected = i
            self.players[i]["_canvas"].itemconfig(self.players[i]["_rect"], fill="#d9d9d9")
            return
        if self.selected == i:
            self.selected = None
            self.draw_table()
            return

        for s, p in self.sliders:
            p["minutes"] = s.get()
        a, b = self.selected, i
        self.players[a], self.players[b] = self.players[b], self.players[a]

        if a < 5 <= b:
            if self.players[b]["minutes"] <= 0:
                self.players[b]["minutes"] = 1
                self.players[a]["minutes"] = max(0, self.players[a]["minutes"] - 1)
        elif b < 5 <= a:
            if self.players[b]["minutes"] <= 0:
                self.players[b]["minutes"] = 1
                self.players[a]["minutes"] = max(0, self.players[a]["minutes"] - 1)

        self.selected = None
        self.draw_table()

    def draw_table(self):
        for w in self.table.grid_slaves():
            if int(w.grid_info()["row"]) > 0:
                w.destroy()
        self.sliders.clear()
        for i, p in enumerate(self.players):
            starter = i < 5
            f = ("Arial", 8, "bold") if starter else ("Arial", 8)
            c = tk.Canvas(self.table, width=12, height=12, bg="white", highlightthickness=0)
            rect = c.create_rectangle(1, 1, 11, 11, outline="black", fill="white")
            c.grid(row=i + 1, column=0, padx=6, pady=3, sticky="w")
            c.bind("<Button-1>", lambda e, ix=i: self.select_player(ix))
            p["_canvas"], p["_rect"] = c, rect
            pos = p["pos"] + ("/" + p["secondaryPos"] if p.get("secondaryPos") else "")
            tk.Label(self.table, text=p["name"], font=f, bg="white").grid(row=i + 1, column=1, sticky="w")
            tk.Label(self.table, text=pos, font=("Arial", 8, "italic"), bg="white").grid(row=i + 1, column=2)
            tk.Label(self.table, text=p["overall"], font=("Arial", 8), bg="white").grid(row=i + 1, column=3)
            tk.Label(self.table, text=p["offRating"], font=("Arial", 8), bg="white").grid(row=i + 1, column=4)
            tk.Label(self.table, text=p["defRating"], font=("Arial", 8), bg="white").grid(row=i + 1, column=5)
            tk.Label(self.table, text=p["stamina"], font=("Arial", 8), bg="white").grid(row=i + 1, column=6)
            s = tk.Scale(
                self.table, from_=0, to=48, orient="horizontal", length=90,
                showvalue=True, bg="white", troughcolor="#e0e0e0",
                highlightthickness=0, font=("Arial", 7)
            )
            s.grid(row=i + 1, column=7, padx=3)
            s.set(p.get("minutes", 24 if starter else 0))
            s._last = s.get()
            s.config(command=lambda _, sc=s: self.update_totals(sc))
            self.sliders.append((s, p))
            role = ["PG", "SG", "SF", "PF", "C"][i] if i < 5 else str(i + 1)
            tk.Label(self.table, text=role, font=f, bg="white").grid(row=i + 1, column=8)
            p["_role"] = role
        self.update_totals()

    def update_totals(self, changed=None):
        total = sum(s.get() for s, _ in self.sliders)
        if total > 240 and changed is not None:
            overflow = total - 240
            changed.set(max(0, changed.get() - overflow))
            total -= overflow
        remain = max(0, 240 - total)
        self.total_lbl.config(text=f"Total Minutes: {min(total, 240)} / 240")
        self.remain_lbl.config(text=f"Remaining: {remain}")
        if changed:
            changed._last = changed.get()
        self.update_team_ratings()
        if self.on_update:
            self.on_update()

    def _minutes_weighted(self):
        pos_minutes = {p: 0.0 for p in POSITIONS}
        roster = []
        total_minutes = 0
        for s, p in self.sliders:
            m = s.get()
            if m <= 0:
                continue
            total_minutes += m
            pos_minutes[p["pos"]] += m
            if p.get("secondaryPos"):
                pos_minutes[p["secondaryPos"]] += m * 0.20
            roster.append({
                "minutes": m,
                "stamina": p.get("stamina", 75),
                "overall": p.get("overall", 75),
                "offRating": p.get("offRating", 75),
                "defRating": p.get("defRating", 75),
                "pos": p.get("pos", "SG"),
                "secondaryPos": p.get("secondaryPos")
            })
        return roster, pos_minutes, total_minutes

    def _agg_with_fatigue(self, roster, key):
        if not roster:
            return 0.0, []
        eff_list = []
        for p in roster:
            m = p["minutes"]
            pen = self.fatigue_penalty(m, p.get("stamina", 75))
            eff = p.get(key, 75) * pen
            eff_list.append((eff, p))
        wavg = sum((p["minutes"] / 240.0) * eff for eff, p in eff_list)
        return wavg, eff_list

    def _star_boost(self, eff_list, star_exp, ref=TR_STAR_REF):
        if not eff_list:
            return 0.0
        eff_sorted = sorted(eff_list, key=lambda x: x[0], reverse=True)[:2]
        pull = 0.0
        for eff, p in eff_sorted:
            gap = max(0.0, p.get("overall", p.get("offRating", p.get("defRating", 75))) - ref)
            if gap <= 0:
                continue
            share = max(0.0, p["minutes"] / 240.0) ** TR_STAR_SHARE_EXP
            pull += (gap ** star_exp) * share
        return TR_STAR_SCALE * (pull ** TR_STAR_OUT_EXP)

    def _coverage_penalty(self, pos_minutes):
        return _coverage_penalty(pos_minutes)

    def _scale_to_range(self, raw):
        return _scale_to_range(raw)

    def update_team_ratings(self):
        roster, pos_minutes, total_minutes = self._minutes_weighted()

        if total_minutes == 0:
            self.team_ratings = {"overall": 0.0, "off": 0.0, "def": 0.0}
            self.team_overall_lbl.config(text="Team Overall: 0.0")
            self.team_off_lbl.config(text="Offense: 0.0")
            self.team_def_lbl.config(text="Defense: 0.0")
            for pos in POSITIONS:
                self.pos_labels[pos].config(text=f"{pos}: 0/48", fg="black")
            return

        base_ovr, eff_ovr = self._agg_with_fatigue(roster, "overall")
        base_off, eff_off = self._agg_with_fatigue(roster, "offRating")
        base_def, eff_def = self._agg_with_fatigue(roster, "defRating")

        star_ovr = self._star_boost(eff_ovr, TR_STAR_EXP_OVR, ref=TR_STAR_REF)
        star_off = self._star_boost(eff_off, TR_STAR_EXP_OFF, ref=TR_STAR_REF)
        star_def = self._star_boost(eff_def, TR_STAR_EXP_DEF, ref=TR_STAR_REF)

        cov_pen = self._coverage_penalty(pos_minutes)

        empty_pen = 0.0
        if total_minutes < 240:
            empty_frac = (240 - total_minutes) / 240.0
            empty_pen = TR_EMPTY_MIN_PTS * (empty_frac ** 0.85)

        raw_off = base_off + star_off - cov_pen - empty_pen
        raw_def = base_def + star_def - cov_pen - empty_pen
        raw_ovr = base_ovr + star_ovr - cov_pen - empty_pen

        team_off = self._scale_to_range(raw_off)
        team_def = self._scale_to_range(raw_def)
        team_ovr = self._scale_to_range(raw_ovr)

        self.team_ratings = {"overall": team_ovr, "off": team_off, "def": team_def}
        self.team_overall_lbl.config(text=f"Team Overall: {team_ovr:.1f}")
        self.team_off_lbl.config(text=f"Offense: {team_off:.1f}")
        self.team_def_lbl.config(text=f"Defense: {team_def:.1f}")

        for pos in POSITIONS:
            used = round(pos_minutes[pos])
            self.pos_labels[pos].config(
                text=f"{pos}: {used}/48", fg="black" if used <= 48 else "red"
            )

    # ---------- Autocomplete (minutes logic identical; starter choice changed only) ----------
    def autocomplete_rotation(self):
        if not self.players:
            return

        def team_total(arr):
            pos_tot = {pos: 0 for pos in POSITIONS}
            off = deff = ovr = 0
            for p in arr:
                m = p["minutes"]
                if m <= 0:
                    continue
                pen = self.fatigue_penalty(m, p["stamina"])
                w = m / 240
                off += w * (p["offRating"] * pen)
                deff += w * (p["defRating"] * pen)
                ovr += w * (p["overall"] * pen)
                pos_tot[p["pos"]] += m
                if p.get("secondaryPos"):
                    pos_tot[p["secondaryPos"]] += m * 0.2
            missing = sum(max(0, 48 - pos_tot[pos]) for pos in POSITIONS)
            cov_pen = 1 - (0.02 * (missing / 240))
            return (off * cov_pen, deff * cov_pen, ovr * cov_pen)

        for p in self.players:
            p["minutes"] = 0
            p["_value"] = p["overall"]
        for p in self.players:
            p["_score"] = p["overall"] + (p["stamina"] - 70) * 0.15

        chosen = []
        for pos in POSITIONS:
            pos_players = [p for p in self.players if p["pos"] == pos or p.get("secondaryPos") == pos]
            if pos_players:
                best = max(pos_players, key=lambda x: x["_score"])
                if best not in chosen:
                    chosen.append(best)
        for p in sorted(self.players, key=lambda x: x["_score"], reverse=True):
            if len(chosen) >= 10:
                break
            if p not in chosen:
                chosen.append(p)

        for p in chosen:
            p["minutes"] = 12
        remain = 240 - (12 * len(chosen))
        i = 0
        while remain > 0:
            chosen[i % len(chosen)]["minutes"] += 1
            remain -= 1
            i += 1

        improved = True
        while improved:
            improved = False
            base_ovr = team_total(chosen)[2]
            for a in chosen:
                for b in chosen:
                    if a == b:
                        continue
                    if a["minutes"] <= 12:
                        continue
                    if b["minutes"] >= 24 and b not in chosen[:5]:
                        continue
                    a["minutes"] -= 1
                    b["minutes"] += 1
                    new_ovr = team_total(chosen)[2]
                    if new_ovr > base_ovr:
                        base_ovr = new_ovr
                        improved = True
                    else:
                        a["minutes"] += 1
                        b["minutes"] -= 1

        PRIMARY_BONUS = 0.02
        SECONDARY_PEN = 0.01

        best_mapping = None
        best_score = -1e9

        for combo in itertools.combinations(chosen, 5):
            elig = {}
            for pl in combo:
                slots = set()
                if pl["pos"] in POSITIONS:
                    slots.add(pl["pos"])
                sec = pl.get("secondaryPos")
                if sec in POSITIONS:
                    slots.add(sec)
                elig[pl["name"]] = slots

            for perm in itertools.permutations(POSITIONS):
                valid = True
                primary_hits = 0
                sec_uses = 0
                score_sum = 0.0
                mapping = {}
                for player, slot in zip(combo, perm):
                    if slot not in elig[player["name"]]:
                        valid = False
                        break
                    mapping[slot] = player
                    score_sum += player["overall"]
                    if slot == player["pos"]:
                        primary_hits += 1
                    elif player.get("secondaryPos") == slot:
                        sec_uses += 1
                if not valid:
                    continue
                avg_ovr = score_sum / 5.0
                score = avg_ovr + PRIMARY_BONUS * primary_hits - SECONDARY_PEN * sec_uses
                if score > best_score:
                    best_score = score
                    best_mapping = mapping

        if not best_mapping:
            lineup = sorted(chosen, key=lambda x: x["overall"], reverse=True)[:5]
            best_mapping = {pos: ply for pos, ply in zip(POSITIONS, lineup)}

        starters = [best_mapping[p] for p in POSITIONS if p in best_mapping]
        bench = [p for p in chosen if p not in starters]
        bench.sort(key=lambda x: -x["minutes"])

        for p in self.players:
            if p not in chosen:
                p["minutes"] = 0

        self.players[:] = starters + bench + [p for p in self.players if p not in chosen]

        for s, p in self.sliders:
            s.set(p["minutes"])
        self.draw_table()
        self.update_team_ratings()
        if self.on_update:
            self.on_update()


# ---------- MAIN (Notebook with two tabs) ----------
root = tk.Tk()
root.title("Coach Gameplan – Home vs Away + Sim Season")
root.geometry("2000x900")
root.configure(bg="white")

notebook = ttk.Notebook(root)
notebook.pack(fill="both", expand=True)

# ================= Tab 1: Game (original UI) =================
game_tab = tk.Frame(notebook, bg="white")
notebook.add(game_tab, text="Game")

def update_sim_state():
    if "sim_btn" not in globals():
        return
    can = (
        home.remain_lbl.cget("text") == "Remaining: 0"
        and away.remain_lbl.cget("text") == "Remaining: 0"
        and home.current_team
        and away.current_team
    )
    sim_btn.config(state="normal" if can else "disabled")

home = TeamPanel(game_tab, "Home", on_update=update_sim_state)
center = tk.Frame(game_tab, bg="#f5f5f5", width=280, bd=2, relief="solid")
center.pack(side="left", fill="y", padx=6, pady=6)
away = TeamPanel(game_tab, "Away", on_update=update_sim_state)

# --- Box score + sim ---
tk.Label(center, text="Box Score", font=("Arial", 14, "bold"), bg="#f5f5f5").pack(pady=8)
table = tk.Frame(center, bg="#f5f5f5"); table.pack(pady=10)
headers = ["Team", "Q1", "Q2", "Q3", "Q4", "OT", "Final"]
for j, h in enumerate(headers):
    tk.Label(table, text=h, font=("Arial", 10, "bold"), bg="#f5f5f5", padx=8).grid(row=0, column=j)
home_labels, away_labels = [], []
for i, lab in enumerate(["Home", "Away"], start=1):
    tk.Label(table, text=lab, font=("Arial", 10, "bold"), bg="#f5f5f5", padx=8).grid(row=i, column=0)
    row = []
    for j in range(1, len(headers)):
        lbl = tk.Label(table, text="--", font=("Arial", 10), width=6, bg="white", relief="ridge")
        lbl.grid(row=i, column=j, padx=1, pady=1)
        row.append(lbl)
    if lab == "Home":
        home_labels = row
    else:
        away_labels = row

def show_boxscore_popup(home_stats, away_stats):
    win = tk.Toplevel(root)
    win.title("Box Score")
    win.geometry("980x560")

    cols = ["Player", "MIN", "PTS", "REB", "AST", "STL", "BLK", "FG", "3P", "FT", "TO", "PF"]
    col_widths = [20, 4, 4, 4, 4, 4, 4, 9, 9, 9, 4, 4]

    def cell(tbl, r, c, text, bold=False, header=False):
        kwargs = {"font": ("Arial", 8, "bold" if bold else "normal"),
                  "bg": "#e0e0e0" if header else "white",
                  "width": col_widths[c],
                  "anchor": "w" if c == 0 else "center",
                  "justify": "left" if c == 0 else "center"}
        tk.Label(tbl, text=text, **kwargs).grid(row=r, column=c, sticky="w" if c == 0 else "")

    def build_table(frame, title, data):
        tk.Label(frame, text=title, font=("Arial", 11, "bold"), bg="white").pack(pady=4)
        tbl = tk.Frame(frame, bg="white"); tbl.pack()
        for j, c in enumerate(cols):
            cell(tbl, 0, j, c, bold=True, header=True)
        totals = {"pts": 0, "reb": 0, "ast": 0, "stl": 0, "blk": 0, "to": 0, "pf": 0,
                  "fgm": 0, "fga": 0, "3pm": 0, "3pa": 0, "ftm": 0, "fta": 0}
        for i, row in enumerate(data, start=1):
            values = [
                row.get("player",""), row.get("min",0), row.get("pts",0), row.get("reb",0),
                row.get("ast",0), row.get("stl",0), row.get("blk",0),
                row.get("fg","0/0"), row.get("3p","0/0"), row.get("ft","0/0"),
                row.get("to",0), row.get("pf",0)
            ]
            for j, val in enumerate(values):
                cell(tbl, i, j, str(val))
            fgm, fga = map(int, values[7].split("/"))
            tpm, tpa = map(int, values[8].split("/"))
            ftm, fta = map(int, values[9].split("/"))
            totals["fgm"] += fgm; totals["fga"] += fga
            totals["3pm"] += tpm; totals["3pa"] += tpa
            totals["ftm"] += ftm; totals["fta"] += fta
            totals["pts"] += int(values[2]); totals["reb"] += int(values[3]); totals["ast"] += int(values[4])
            totals["stl"] += int(values[5]); totals["blk"] += int(values[6]); totals["to"] += int(values[10])
            totals["pf"]  += int(values[11])

        r = len(data) + 1
        cell(tbl, r, 0, "Totals", bold=True, header=True)
        summary = ["", "", totals["pts"], totals["reb"], totals["ast"], totals["stl"], totals["blk"],
                   f"{totals['fgm']}/{totals['fga']}",
                   f"{totals['3pm']}/{totals['3pa']}",
                   f"{totals['ftm']}/{totals['fta']}", totals["to"], totals["pf"]]
        for j, val in enumerate(summary[2:], start=2):
            cell(tbl, r, j, str(val), bold=True, header=True)

    frame = tk.Frame(win, bg="white")
    frame.pack(fill="both", expand=True, padx=8, pady=8)
    left = tk.Frame(frame, bg="white")
    left.pack(side="left", padx=10, fill="both", expand=True)
    right = tk.Frame(frame, bg="white")
    right.pack(side="right", padx=10, fill="both", expand=True)

    build_table(left, "Home", home_stats)
    build_table(right, "Away", away_stats)

# ----------- Box Score generator (full, with foul cap 6) -----------
def generate_boxscore(team_obj, team_points, team_ratings, num_ot_periods):
    import random, math

    BASE = {
        "PTS": 113.8, "REB": 44.1, "AST": 26.5, "STL": 8.2, "BLK": 4.9,
        "FGM": 41.7, "FGA": 89.2, "3PM": 13.5, "3PA": 37.6,
        "FTM": 16.9, "FTA": 21.7, "TO": 14.3, "PF": 20.8
    }

    full_roster = [p for _, p in team_obj.sliders]
    active = [p for p in full_roster if p.get("minutes", 0) > 0]
    bench0 = [p for p in full_roster if p.get("minutes", 0) <= 0]

    game_target_minutes = 240 + 25 * max(0, int(num_ot_periods))
    if active:
        max_per_player = 48 + 5 * max(0, int(num_ot_periods))
        tweaked = []
        for p in active:
            base = int(p["minutes"])
            delta = random.uniform(-1.5, 1.5)
            mm = int(round(base + delta))
            mm = max(1, min(mm, max_per_player))
            tweaked.append(mm)

        cur = sum(tweaked)
        star_w = [(max(1, p["offRating"]) ** 1.15) * max(1, int(p["minutes"])) for p in active]
        star_order_up = sorted(range(len(active)), key=lambda i: star_w[i], reverse=True)
        star_order_dn = list(reversed(star_order_up))
        guard = 0
        while cur != game_target_minutes and guard < 2000:
            if cur < game_target_minutes:
                for i in star_order_up:
                    if tweaked[i] < max_per_player:
                        tweaked[i] += 1
                        cur += 1
                        if cur == game_target_minutes: break
            else:
                for i in star_order_dn:
                    if tweaked[i] > 1:
                        tweaked[i] -= 1
                        cur -= 1
                        if cur == game_target_minutes: break
            guard += 1

        for i, p in enumerate(active):
            p["minutes"] = tweaked[i]

    if not active:
        return [{"player": p["name"], "min": 0, "pts": 0, "reb": 0, "ast": 0, "stl": 0,
                 "blk": 0, "fg": "0/0", "3p": "0/0", "ft": "0/0", "to": 0, "pf": 0}
                for p in full_roster]

    for p in active:
        if not p.get("attrs"):
            p["attrs"] = [70] * 15

    def clamp(x, lo, hi): return max(lo, min(hi, x))

    def league_attr_means(_cache={"ready": False}):
        if _cache.get("ready"):
            return _cache["means"]
        cnt = 0
        sums = {"three":0, "pass":0, "reb":0, "stl":0, "blk":0, "offiq":0, "defiq":0, "overall":0}
        for t in teams:
            for p in t["players"]:
                a = p.get("attrs", [70]*15)
                sums["three"]  += a[2]
                sums["pass"]   += a[5]
                sums["reb"]    += a[12]
                sums["stl"]    += a[11]
                sums["blk"]    += a[10]
                sums["offiq"]  += a[13]
                sums["defiq"]  += a[14]
                sums["overall"]+= p.get("overall", 75)
                cnt += 1
        means = {k: (v / cnt if cnt else 75) for k, v in sums.items()}
        _cache["means"] = means; _cache["ready"] = True
        return means

    L = league_attr_means()

    tot_min = sum(p["minutes"] for p in active) or 1
    def wmean(idx): return sum(p["attrs"][idx]*p["minutes"] for p in active)/tot_min

    tm = {
        "three":  wmean(2),  "pass":   wmean(5),   "reb":   wmean(12),
        "stl":    wmean(11), "blk":    wmean(10),  "offiq": wmean(13),
        "defiq":  wmean(14), "overall":sum(p["overall"]*p["minutes"] for p in active)/tot_min
    }
    big_share = (sum(p["minutes"] for p in active if ("PF" in p["pos"] or "C" in p["pos"])) / tot_min)
    league_big_share = 0.40

    def rel(x, mean): return (x - mean) / 10.0

    off = team_ratings.get("off", 75.0)
    pace_adj = clamp(1.0 + (off - 75.0)*0.002 + random.gauss(0, 0.02), 0.95, 1.05)
    fga_mult = clamp(1.0 + 0.04*rel(tm["overall"],L["overall"]) + 0.02*rel(tm["three"],L["three"])
                           + random.gauss(0,0.045), 0.88, 1.12)
    three_mult = clamp(1.0 + 0.22*rel(tm["three"],L["three"]) - 0.04*(big_share - league_big_share)
                             + random.gauss(0,0.06), 0.75, 1.35)
    drive_prop = (-0.50*rel(tm["three"],L["three"]) + 0.25*rel(tm["offiq"],L["offiq"])
                  + 0.15*rel(tm["overall"],L["overall"]))
    fta_mult = clamp(1.0 + 0.20*drive_prop + random.gauss(0,0.07), 0.75, 1.35)
    to_mult  = clamp(1.0 + 0.25*rel(L["offiq"],tm["offiq"]) + 0.10*rel(L["overall"],tm["overall"])
                           + random.gauss(0,0.07), 0.75, 1.40)
    pf_mult  = clamp(1.0 + 0.22*rel(L["defiq"],tm["defiq"]) + 0.12*(big_share - league_big_share)
                           + random.gauss(0,0.06), 0.75, 1.40)
    reb_mult = clamp(1.0 + 0.25*rel(tm["reb"],L["reb"]) + 0.10*(big_share - league_big_share)
                           + random.gauss(0,0.05), 0.85, 1.25)
    ast_mult = clamp(1.0 + 0.25*rel(tm["pass"],L["pass"]) + 0.08*rel(tm["offiq"],L["offiq"])
                           + random.gauss(0,0.06), 0.80, 1.25)
    stl_mult = clamp(1.0 + 0.25*rel(tm["stl"],L["stl"]) + random.gauss(0,0.08), 0.70, 1.40)
    blk_mult = clamp(1.0 + 0.28*rel(tm["blk"],L["blk"]) + 0.12*(big_share - league_big_share)
                           + random.gauss(0,0.08), 0.70, 1.50)

    team_FGA = int(round(BASE["FGA"] * pace_adj * fga_mult))
    team_3PA = int(round(BASE["3PA"] * three_mult))
    team_FTA = int(round(BASE["FTA"] * fta_mult))
    team_3PA = clamp(team_3PA, int(team_FGA*0.20), int(team_FGA*0.52))
    team_FGA = max(team_FGA, team_3PA + 5)

    def sample_multinomial(total, weights):
        counts = [0]*len(weights)
        s = sum(weights)
        if s <= 0:
            for _ in range(total): counts[random.randrange(len(weights))] += 1
            return counts
        cum, acc = [], 0.0
        for w in weights: acc += w; cum.append(acc)
        for _ in range(total):
            r = random.random()*s
            for i,t in enumerate(cum):
                if r <= t: counts[i]+=1; break
        return counts

    def binom(n, p):
        if n <= 0: return 0
        p = clamp(p, 0.0, 1.0)
        k = 0
        for _ in range(n):
            if random.random() < p: k += 1
        return k

    plist = active[:]
    team_off_mean = sum(p["offRating"] * p["minutes"] for p in plist) / (sum(p["minutes"] for p in plist) or 1)
    base_w = []
    for p in plist:
        rel_star = 1.0 + 0.015*(p["offRating"] - team_off_mean)
        base_w.append((max(1,p["offRating"])**1.2) * max(1,p["minutes"]) * max(0.5,rel_star))
    prelim_p = [x/(sum(base_w) or 1.0) for x in base_w]
    prelim_top = sorted(range(len(plist)), key=lambda i: prelim_p[i], reverse=True)[:3]
    for rank,i in enumerate(prelim_top):
        if random.random() < [0.14,0.09,0.06][rank]: base_w[i] *= random.uniform(1.5,2.2)
        elif random.random() < 0.08: base_w[i] *= random.uniform(0.5,0.75)
    for i,p in enumerate(plist):
        sigma = 0.35 if p["minutes"] < 18 else 0.18
        base_w[i] *= math.exp(random.gauss(0, sigma))
    p_usage = [x/(sum(base_w) or 1.0) for x in base_w]

    fga = sample_multinomial(team_FGA, p_usage)

    LOW_3PT_HARD_CAP = 50

    def pos_base_per36(pos):
        return 7.5 if "PG" in pos else 7.0 if "SG" in pos else 6.2 if "SF" in pos else 4.2 if "PF" in pos else 2.2

    def per36_3pa_target(p):
        if p["attrs"][2] < LOW_3PT_HARD_CAP:
            return 0.0
        three = p["attrs"][2]; offiq = p["attrs"][13]
        base = pos_base_per36(p["pos"])
        bump = 0.18*(three - L["three"]) + 0.06*(offiq - L["offiq"])
        return clamp(base + bump, 1.2, 11.8)

    target3 = []
    for p in plist:
        mu36 = per36_3pa_target(p)
        vol = math.exp(random.gauss(0, 0.22 if p["minutes"] < 22 else 0.14))
        target3.append(mu36 * vol * (p["minutes"]/36.0))

    three_att = []
    for i, p in enumerate(plist):
        if p["attrs"][2] < LOW_3PT_HARD_CAP:
            three_att.append(0)
            continue
        three = p["attrs"][2]; offIQ = p["attrs"][13]
        share = 0.26 + 0.003*(three - L["three"]) + 0.0010*(offIQ - L["offiq"])
        if ("PF" in p["pos"] or "C" in p["pos"]) and three >= 88:
            share += 0.06
        if three < 65:
            share = clamp(share, 0.10, 0.22)
        elif three < 80:
            share = clamp(share, 0.12, 0.35)
        else:
            share = clamp(share, 0.14, 0.55)
        att = 0
        for _ in range(fga[i]):
            if random.random() < share:
                att += 1
        blend = clamp(random.uniform(0.35, 0.65), 0.35, 0.65)
        att = int(round(blend*att + (1-blend)*target3[i] + random.uniform(-1, 1)))
        att = clamp(att, 0, fga[i])
        three_att.append(att)

    need = team_3PA - sum(three_att)
    eligible = [j for j, p in enumerate(plist) if p["attrs"][2] >= LOW_3PT_HARD_CAP]
    if need != 0 and eligible:
        order = sorted(
            eligible,
            key=lambda j: (per36_3pa_target(plist[j]) - (three_att[j]/max(1, plist[j]["minutes"]))*36),
            reverse=(need > 0)
        )
        for j in order:
            if need == 0: break
            room = (fga[j] - three_att[j]) if need > 0 else three_att[j]
            if room <= 0: continue
            delta = min(abs(need), max(1, room//2))
            three_att[j] += delta if need > 0 else -delta
            need += -delta if need > 0 else +delta
    for i, p in enumerate(plist):
        if p["attrs"][2] < LOW_3PT_HARD_CAP:
            three_att[i] = 0

    two_att = [max(0, fga[i] - three_att[i]) for i in range(len(plist))]
    for i, p in enumerate(plist):
        min_two = 1 if fga[i] >= 6 else 0
        if two_att[i] < min_two and three_att[i] >= 1:
            two_att[i] += 1
            three_att[i] -= 1

    top3_idx = sorted(range(len(plist)), key=lambda i: p_usage[i], reverse=True)[:3]
    star_boost = [1.15 if i in top3_idx else 0.95 for i in range(len(plist))]

    ft_weights = []
    for i, p in enumerate(plist):
        offIQ = p["attrs"][13]; ft_skill = p["attrs"][3]
        share = three_att[i] / fga[i] if fga[i] > 0 else 0.0
        drive = (1.0 - share)
        or_fac = (p["offRating"]/75.0) ** 0.7
        ft_fac = (max(50,ft_skill)/75.0) ** 0.6
        w = p_usage[i]*drive*(0.9 + 0.004*(offIQ - L["offiq"])) * star_boost[i] * or_fac * ft_fac
        if p["minutes"] < 15: w *= random.uniform(0.7, 1.4)
        ft_weights.append(max(0.0001, w))
    ft_weights = [w**0.85 for w in ft_weights]

    team_pairs = max(0, team_FTA // 2)
    pairs = sample_multinomial(team_pairs, ft_weights)
    fta = [2*c for c in pairs]
    leftover_singles = team_FTA - sum(fta)
    if leftover_singles > 0:
        order = sorted(range(len(plist)), key=lambda j: (ft_weights[j], p_usage[j]), reverse=True)
        for j in order:
            if leftover_singles <= 0: break
            fta[j] += 1; leftover_singles -= 1

    def pct_two_for(p):
        mid, offIQ, pos = p["attrs"][1], p["attrs"][13], p["pos"]
        base = {"PG":0.51,"SG":0.52,"SF":0.53,"PF":0.55,"C":0.59}
        b = base["C" if "C" in pos else ("PF" if "PF" in pos else ("SF" if "SF" in pos else ("SG" if "SG" in pos else "PG")))]
        pct = b + 0.0020*(mid - 67) + 0.0015*(offIQ - L["offiq"])
        return clamp(pct, b-0.08, b+0.09)

    def pct_three_for(p):
        three, offIQ = p["attrs"][2], p["attrs"][13]
        pct = 0.35 + 0.0060*(three - L["three"]) + 0.0012*(offIQ - L["offiq"])
        return clamp(pct, 0.28, 0.48)

    def pct_ft_for(p):
        ft = p["attrs"][3]
        return clamp(0.80 + 0.0035*(ft - 70), 0.74, 0.97)

    form = []
    for i in range(len(plist)):
        base_sigma = 0.12 if i in top3_idx else 0.08
        form.append(clamp(random.gauss(1.0, base_sigma), 0.85, 1.20))
    luck_two   = [clamp(random.gauss(form[i], 0.05), 0.90, 1.15) for i in range(len(plist))]
    luck_three = [clamp(random.gauss(form[i], 0.07), 0.88, 1.18) for i in range(len(plist))]
    luck_ft    = [clamp(random.gauss(1.0, 0.02),     0.96, 1.06) for _ in range(len(plist))]

    two_made, three_made, ft_made = [], [], []
    for i, p in enumerate(plist):
        two_att_i = max(0, fga[i] - three_att[i])
        p2 = clamp(pct_two_for(p)*luck_two[i],     0.25, 0.75)
        p3 = clamp(pct_three_for(p)*luck_three[i], 0.20, 0.70)
        pf = clamp(pct_ft_for(p)*luck_ft[i],       0.70, 0.99)
        m2 = binom(two_att_i,   p2)
        m3 = binom(three_att[i], p3)
        mf = binom(fta[i],       pf)
        two_made.append(m2); three_made.append(m3); ft_made.append(mf)

    def min_factor(p): return (p["minutes"]/36.0) ** 0.90
    w_min = [min_factor(p) for p in plist]
    reb_w = [max(0.1, p["attrs"][12]/80.0) * w_min[i] for i, p in enumerate(plist)]
    made_fg = [two_made[i] + three_made[i] for i in range(len(plist))]
    total_made_fg = sum(made_fg) or 1
    pos_bonus = []
    for p in plist:
        if "PG" in p["pos"]:   pos_bonus.append(1.25)
        elif "SG" in p["pos"]: pos_bonus.append(1.10)
        elif "SF" in p["pos"]: pos_bonus.append(1.00)
        elif "PF" in p["pos"]: pos_bonus.append(0.85)
        else:                  pos_bonus.append(0.70)
    creation_score = []
    for i, p in enumerate(plist):
        creation = 0.90*p["attrs"][5] + 0.60*p["attrs"][13] + 0.25*(p["offRating"] - tm["overall"]) + 20.0*p_usage[i]
        creation_score.append(creation)
    top_creators = sorted(range(len(plist)), key=lambda i: creation_score[i], reverse=True)[:3]
    ast_w = []
    for i, p in enumerate(plist):
        w = ((max(1, p["attrs"][5]) / 75.0) ** 1.25) * (0.55 + 1.25*p_usage[i]) * (1.0 + 0.25*made_fg[i]/total_made_fg)
        w *= (max(55, p["attrs"][13]) / 75.0) ** 0.90
        w *= pos_bonus[i]
        w *= w_min[i]
        vol = 0.30 if i in top_creators[:1] else 0.24 if i in top_creators[:2] else 0.18
        w *= math.exp(random.gauss(0, vol))
        ast_w.append(max(0.05, w))
    stl_w = [max(0.1, p["attrs"][11]/85.0) * w_min[i] for i, p in enumerate(plist)]
    blk_w = [max(0.1, p["attrs"][10]/85.0) * w_min[i] for i, p in enumerate(plist)]

    def apportion(total, weights, rnd_range=(0.78,1.22), floor0=True):
        s = sum(weights) or 1.0
        vals = [int(round(total*(wi/s)*random.uniform(*rnd_range))) for wi in weights]
        while sum(vals) != total:
            d = total - sum(vals)
            if d > 0:
                i = max(range(len(vals)), key=lambda j: weights[j]); vals[i]+=1
            else:
                i = max(range(len(vals)), key=lambda j: vals[j])
                if vals[i] > (0 if floor0 else 1): vals[i]-=1
                else:
                    j = next((k for k in range(len(vals)) if vals[k] > (0 if floor0 else 1)), None)
                    if j is None: break
                    vals[j]-=1
        return vals

    team_REB = int(round(BASE["REB"] * pace_adj * reb_mult))
    team_AST = int(round(BASE["AST"] * pace_adj * ast_mult))
    team_STL = int(round(BASE["STL"] * stl_mult))
    team_BLK = int(round(BASE["BLK"] * blk_mult))

    rebs = apportion(team_REB, reb_w)
    asts = apportion(team_AST, ast_w, rnd_range=(0.70, 1.35))
    stls = apportion(team_STL, stl_w)
    blks = apportion(team_BLK, blk_w)

    team_TO = int(round(BASE["TO"] * to_mult))
    touches = [ (max(0, fga[i] - three_att[i]) + three_att[i]) + 0.44*fta[i] + 0.30*asts[i] for i in range(len(plist))]
    def poisson(lmbd):
        Lm = math.exp(-lmbd); k = 0; prod = 1.0
        while prod > Lm:
            k += 1; prod *= random.random()
        return max(0, k-1)
    lam = []
    for i, p in enumerate(plist):
        offIQ, overall, pos = p["attrs"][13], p["overall"], p["pos"]
        guard_fac = 1.15 if ("G" in pos) else 0.90
        iq_pen    = 1.0 + max(0, L["offiq"] - offIQ) * (0.015 if "G" in pos else 0.008)
        ov_pen    = 1.0 + max(0, L["overall"] - overall) * 0.008
        lam.append(clamp(guard_fac*iq_pen*ov_pen*(touches[i]/8.0), 0.05, 5.0))
    tos = [poisson(l) for l in lam]
    caps_to = [min(int(math.ceil(0.40*touches[i])), 8 + (3 if i in top3_idx else 0)) for i in range(len(plist))]
    over = 0
    for i in range(len(tos)):
        if tos[i] > caps_to[i]:
            over += tos[i]-caps_to[i]
            tos[i] = caps_to[i]
    if over > 0:
        order = sorted(range(len(plist)), key=lambda j: lam[j], reverse=True)
        for j in order:
            if over <= 0: break
            room = max(0, caps_to[j]-tos[j]); add = min(room, over)
            if add > 0: tos[j]+=add; over-=add
    diff_to = team_TO - sum(tos)
    ord_up = sorted(range(len(plist)), key=lambda j: lam[j], reverse=True)
    ord_dn = sorted(range(len(plist)) , key=lambda j: tos[j], reverse=True)
    guard = 0
    while diff_to != 0 and guard < 300:
        if diff_to > 0:
            for i in ord_up: tos[i]+=1; diff_to-=1; break
        else:
            for i in ord_dn:
                if tos[i] > 0: tos[i]-=1; diff_to+=1; break
        guard += 1

    team_PF = int(round(BASE["PF"] * pf_mult))
    pf_lam = []
    for i, p in enumerate(plist):
        defIQ, pos = p["attrs"][14], p["pos"]
        big = ("C" in pos) or ("PF" in pos)
        pos_fac = 1.20 if big else 0.90
        iq_pen  = 1.0 + max(0, L["defiq"] - defIQ) * (0.020 if big else 0.010)
        pf_lam.append(clamp(pos_fac * iq_pen * (p["minutes"]/36.0) * 2.8, 0.05, 4.5))
    def poisson2(lmbd):
        Lm = math.exp(-lmbd); k = 0; prod = 1.0
        while prod > Lm:
            k += 1; prod *= random.random()
        return max(0, k-1)
    pfs = [poisson2(l) for l in pf_lam]
    pfs = [min(6, x) for x in pfs]
    diff_pf = team_PF - sum(pfs)
    ord_up = sorted(range(len(plist)), key=lambda j: pf_lam[j], reverse=True)
    ord_dn = sorted(range(len(plist)), key=lambda j: pfs[j], reverse=True)
    guard = 0
    while diff_pf != 0 and guard < 400:
        if diff_pf > 0:
            for i in ord_up:
                if pfs[i] < 6:
                    pfs[i] += 1
                    diff_pf -= 1
                    break
        else:
            for i in ord_dn:
                if pfs[i] > 0:
                    pfs[i] -= 1
                    diff_pf += 1
                    break
        guard += 1

    # Force team points to match scoreboard
    def total_points(twos, threes, fts): return 2*sum(twos) + 3*sum(threes) + sum(fts)
    P0 = total_points(two_made, three_made, ft_made) or 1
    target = int(team_points)
    if P0 != target:
        f = clamp(target / P0, 0.85, 1.15)
        for arr, att in ((two_made, [max(0, fga[i] - three_att[i]) for i in range(len(plist))]), (three_made, three_att)):
            for i in range(len(arr)):
                arr[i] = clamp(int(round(arr[i]*f)), 0, att[i])
        for i in range(len(ft_made)):
            ft_made[i] = clamp(int(round(ft_made[i]*(0.85*f + 0.15))), 0, fta[i])

        def bump_up():
            order = list(range(len(plist)))
            for i in order:
                if three_made[i] < three_att[i]: three_made[i]+=1; return 3
            for i in order:
                if two_made[i] < max(0, fga[i]-three_att[i]): two_made[i]+=1; return 2
            for i in order:
                if ft_made[i] < int(0.9*fta[i]): ft_made[i]+=1; return 1
            return 0

        def bump_down():
            for i in reversed(range(len(plist))):
                if two_made[i] > 0: two_made[i]-=1; return 2
            for i in reversed(range(len(plist))):
                if three_made[i] > 0: three_made[i]-=1; return 3
            for i in reversed(range(len(plist))):
                if ft_made[i] > int(0.6*fta[i]): ft_made[i]-=1; return 1
            return 0

        guard = 0
        while total_points(two_made, three_made, ft_made) != target and guard < 450:
            cur = total_points(two_made, three_made, ft_made)
            if cur < target:
                if bump_up() == 0: break
            else:
                if bump_down() == 0: break
            guard += 1

    results = []
    for i, p in enumerate(plist):
        two_att_i = max(0, fga[i] - three_att[i])
        fgm = two_made[i] + three_made[i]
        fga_i = two_att_i + three_att[i]
        pts = 2*two_made[i] + 3*three_made[i] + ft_made[i]
        results.append({
            "player": p["name"], "min": int(p["minutes"]), "pts": pts,
            "reb": rebs[i], "ast": asts[i], "stl": stls[i], "blk": blks[i],
            "fg": f"{fgm}/{fga_i}", "3p": f"{three_made[i]}/{three_att[i]}",
            "ft": f"{ft_made[i]}/{fta[i]}", "to": tos[i], "pf": pfs[i]
        })

    for p in bench0:
        results.append({
            "player": p["name"], "min": 0, "pts": 0, "reb": 0, "ast": 0, "stl": 0, "blk": 0,
            "fg": "0/0", "3p": "0/0", "ft": "0/0", "to": 0, "pf": 0
        })

    return results

# ----------- Simulate Game (uses calibrated scoring) -----------
def simulate_game():
    home.save_current_team()
    away.save_current_team()

    h, a = home.team_ratings, away.team_ratings
    if not (h["off"] and a["off"]):
        return

    base_home = expected_points_for(h["off"], a["def"])
    base_away = expected_points_for(a["off"], h["def"])
    pace = pace_multiplier(h["off"], h["def"], a["off"], a["def"])
    total_mean = (base_home + base_away) * pace

    margin_ovr   = MARG_PER_OVR * (h["overall"] - a["overall"])
    style_term   = ((h["off"] - a["def"]) - (a["off"] - h["def"]))
    margin_style = STYLE_MARGIN_K * style_term
    margin_det   = margin_ovr + margin_style

    skew_raw = (h["off"] - h["def"]) / 20.0 if margin_det >= 0 else (a["off"] - a["def"]) / 20.0
    skew = clamp(skew_raw, -1.0, 1.0)
    total_det = total_mean + TOTAL_SKEW_K * skew * abs(margin_det)

    sig_m = sigma_margin_for_delta(h["overall"] - a["overall"])
    sig_t = sigma_total_for_delta(h["overall"] - a["overall"])
    sampled_margin = random.gauss(margin_det,  sig_m)
    sampled_total  = random.gauss(total_det,    sig_t)

    hs = int(round((sampled_total + sampled_margin) / 2.0))
    as_ = int(round((sampled_total - sampled_margin) / 2.0))
    hs = clamp(hs, 85, 150); as_ = clamp(as_, 85, 150)

    def qsplit(total):
        q = [random.uniform(0.22, 0.28) for _ in range(4)]
        sc = total / sum(q)
        pts = [int(x * sc) for x in q]
        pts[-1] += total - sum(pts)
        return pts

    hq, aq = qsplit(hs), qsplit(as_)
    ot_h = ot_a = 0
    if sum(hq) == sum(aq):
        h_ot, a_ot = random.randint(8, 16), random.randint(8, 16)
        ot_h += h_ot; ot_a += a_ot
        hq.append(h_ot); aq.append(a_ot)
    th, ta = sum(hq), sum(aq)
    while th == ta:
        h_ot, a_ot = random.randint(8, 16), random.randint(8, 16)
        ot_h += h_ot; ot_a += a_ot
        hq[-1] += h_ot; aq[-1] += a_ot
        th, ta = sum(hq), sum(aq)

    for i in range(4):
        home_labels[i].config(text=str(hq[i]))
        away_labels[i].config(text=str(aq[i]))
    home_labels[4].config(text=str(ot_h) if ot_h > 0 else "--")
    away_labels[4].config(text=str(ot_a) if ot_a > 0 else "--")
    home_labels[5].config(text=str(th))
    away_labels[5].config(text=str(ta))

    result = f"🏆 Home wins {th}-{ta}" if th > ta else f"🏆 Away wins {ta}-{th}"
    if ot_h > 0 or ot_a > 0:
        result += " (OT)"
    winner_lbl.config(text=result)

    num_ot_periods = max(0, len(hq) - 4)
    home_box = generate_boxscore(home, th, home.team_ratings, num_ot_periods)
    away_box = generate_boxscore(away, ta, away.team_ratings, num_ot_periods)

    def open_boxscore():
        show_boxscore_popup(home_box, away_box)

    global view_btn
    try:
        view_btn.destroy()
    except Exception:
        pass

    view_btn = tk.Button(center, text="View Box Score", font=("Arial", 11, "bold"),
                         bg="#444", fg="white", relief="flat", padx=20, pady=6,
                         command=open_boxscore)
    view_btn.pack(pady=8)

winner_lbl = tk.Label(center, text="", font=("Arial", 11, "bold"), bg="#f5f5f5", pady=8)
winner_lbl.pack()

sim_btn = tk.Button(center, text="Simulate Game", font=("Arial", 11, "bold"),
                    bg="#2b85ff", fg="white", relief="flat",
                    padx=20, pady=6, state="disabled",
                    command=simulate_game)
sim_btn.pack(pady=10)

# ================= Tab 2: Sim Season =================
season_tab = tk.Frame(notebook, bg="white")
notebook.add(season_tab, text="Sim Season")

ctrl = tk.Frame(season_tab, bg="white")
ctrl.pack(fill="x", padx=10, pady=8)

tk.Label(
    ctrl,
    text="Season sim uses EXACTLY these autocomplete ratings (OVR/OFF/DEF) for all teams. Each pair plays 50 times.",
    font=("Arial", 10, "italic"),
    bg="white"
).pack(side="left")

_last_autocomplete_ratings = {}

def run_season():
    global _last_autocomplete_ratings
    team_infos = []
    _last_autocomplete_ratings = {}

    for t in teams:
        _, ratings = autocomplete_minutes_and_ratings_for_team(t)
        team_infos.append({"name": t["name"], "ratings": ratings})
        _last_autocomplete_ratings[t["name"]] = ratings

    standings = {ti["name"]: {"W":0, "L":0, "PF":0, "PA":0, "G":0} for ti in team_infos}
    n = len(team_infos)
    for i in range(n):
        for j in range(i+1, n):
            A = team_infos[i]; B = team_infos[j]
            for _ in range(50):  # each pair plays 10 times
                sA, sB = sim_match_from_ratings(A["ratings"], B["ratings"])
                standings[A["name"]]["PF"] += sA; standings[A["name"]]["PA"] += sB; standings[A["name"]]["G"] += 1
                standings[B["name"]]["PF"] += sB; standings[B["name"]]["PA"] += sA; standings[B["name"]]["G"] += 1
                if sA > sB:
                    standings[A["name"]]["W"] += 1; standings[B["name"]]["L"] += 1
                else:
                    standings[B["name"]]["W"] += 1; standings[A["name"]]["L"] += 1

    def winp(s):
        g = s["W"] + s["L"]
        return (s["W"] / g) if g > 0 else 0.0

    sorted_rows = sorted(
        standings.items(),
        key=lambda kv: (winp(kv[1]), kv[1]["PF"] - kv[1]["PA"]),
        reverse=True
    )

    # --- build default rows and render with 3-state sort support ---
    rows = []
    for name, s in sorted_rows:
        g = max(1, s["G"])
        ppg   = s["PF"] / g
        papg  = s["PA"] / g
        win_pct = winp(s)
        avg_margin = (s["PF"] - s["PA"]) / g
        r = _last_autocomplete_ratings.get(name, {"overall":0,"off":0,"def":0})
        rows.append((
            name,
            f"{r['overall']:.1f}", f"{r['off']:.1f}", f"{r['def']:.1f}",
            s["W"], s["L"], f"{win_pct:.3f}",
            f"{avg_margin:.1f}",
            f"{ppg:.1f}", f"{papg:.1f}"
        ))
    
    # store/reset default + sort state, then render & refresh header arrows
    global season_rows_default, season_sort_state
    season_rows_default = rows
    season_sort_state   = {c: 0 for c in cols}
    _table_set_rows(season_table, season_rows_default)
    _refresh_heading_labels(season_table, cols)
    # --- end build & render block ---    

run_btn = tk.Button(ctrl, text="Simulate Season", font=("Arial", 11, "bold"),
                    bg="#2b85ff", fg="white", relief="flat", padx=16, pady=6,
                    command=run_season)
run_btn.pack(side="right")

tbl_frame = tk.Frame(season_tab, bg="white")
tbl_frame.pack(fill="both", expand=True, padx=10, pady=8)

cols = ("Team", "OVR", "OFF", "DEF", "W", "L", "Win%", "Avg Margin", "PPG", "PPG Allowed")

# --- Sorting helpers for Sim Season table (3-state per column) ---
season_rows_default = []     # canonical default order (last simulated order)
season_sort_state   = {}     # column -> 0 (default), 1 (desc), 2 (asc)

def _parse_col_value(col_name, s):
    if col_name == "Team":
        return s.lower()
    if col_name in ("W", "L"):
        try: return int(s)
        except: return -10**9
    try: return float(s)     # OVR/OFF/DEF/Win%/Avg Margin/PPG/PPG Allowed
    except: return float("-inf")

def _table_set_rows(tree, rows):
    for r in tree.get_children():
        tree.delete(r)
    for tup in rows:
        tree.insert("", "end", values=tup)

def _refresh_heading_labels(tree, columns):
    arrows = {0:"", 1:" ↓", 2:" ↑"}
    for c in columns:
        lbl = c + arrows.get(season_sort_state.get(c,0), "")
        tree.heading(c, text=lbl)

def _on_click_heading(col_name, tree, columns):
    # cycle state: 0 -> 1 (desc) -> 2 (asc) -> 0 (default)
    state = (season_sort_state.get(col_name, 0) + 1) % 3
    for k in columns:
        season_sort_state[k] = 0
    season_sort_state[col_name] = state

    if state == 0:
        rows = list(season_rows_default)
    else:
        idx = list(columns).index(col_name)
        rows = sorted(
            season_rows_default,
            key=lambda tup: _parse_col_value(col_name, tup[idx]),
            reverse=(state == 1)
        )

    _table_set_rows(tree, rows)
    _refresh_heading_labels(tree, columns)
# --- end sorting helpers ---


# Tree with clickable headings (↓ then ↑ then default)
season_table = ttk.Treeview(tbl_frame, columns=cols, show="headings", height=26)
for c, w in zip(cols, (260, 70, 70, 70, 70, 70, 90, 100, 120, 140)):
    season_table.heading(c, text=c)  # label gets arrow suffix later
    season_table.column(c, width=w, anchor="center" if c != "Team" else "w")
season_table.pack(fill="both", expand=True)

# enable 3-state sort on each header
for c in cols:
    season_table.heading(c, command=lambda cc=c: _on_click_heading(cc, season_table, cols))


root.mainloop()
