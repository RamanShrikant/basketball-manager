import tkinter as tk
from tkinter import ttk
import json, itertools, random, math

# --- Load JSON ---
# Make sure your roster file (with "scoringRating") is named 18.5 (1).json
with open("13 6.json", "r", encoding="utf-8") as f:
    data = json.load(f)

teams = [t for conf in data["conferences"].values() for t in conf]
POSITIONS = ["PG", "SG", "SF", "PF", "C"]

# ===================== Team Rating Calib Constants =====================
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

# Controls how swingy game-to-game scoring is (1.0 = current, >1.0 = more variance)
STATLINE_VARIANCE_BOOST = 1.35  # try 1.2–1.35 for "slight" increase

def clamp(x, lo, hi):
    return max(lo, min(hi, x))


def fatigue_threshold(stamina):
    return 0.359 * stamina + 2.46


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


# ============================================================
#        SCORING → PERCENTILE → PTS36 → GAME POINTS
# ============================================================

# True JSON scoringRating percentile distribution
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

# NBA PTS36 percentile curve
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
    (5, 10.2),
    (0, 8.2),
]


def scoring_to_percentile(score):
    # Convert scoringRating -> percentile using SCORING_PCT_TABLE (linear interpolation).
    low = SCORING_PCT_TABLE[0][1]
    high = SCORING_PCT_TABLE[-1][1]
    score = max(low, min(high, score))

    for i in range(len(SCORING_PCT_TABLE) - 1):
        p1, v1 = SCORING_PCT_TABLE[i]
        p2, v2 = SCORING_PCT_TABLE[i + 1]
        if v1 <= score <= v2:
            t = (score - v1) / (v2 - v1)
            return p1 + (p2 - p1) * t

    return 0.0


def percentile_to_pts36(pct):
    # Convert scoring percentile -> PTS per 36 using PTS36_CURVE (linear interpolation).
    pct = max(0, min(100, pct))
    for i in range(len(PTS36_CURVE) - 1):
        p1, v1 = PTS36_CURVE[i]
        p2, v2 = PTS36_CURVE[i + 1]
        if p2 <= pct <= p1:
            t = (pct - p2) / (p1 - p2)
            return v2 + (v1 - v2) * t
    return 8.2


def scoring_to_game_points(scoring_rating, minutes):
    # Main conversion: scoringRating + minutes -> expected game points (no randomness).
    pct = scoring_to_percentile(scoring_rating)
    pts36 = percentile_to_pts36(pct)
    return pts36 * (minutes / 36.0)


# ===================== Autocomplete Minutes + Ratings =====================
def autocomplete_minutes_and_ratings_for_team(team_obj):
    players = [dict(p) for p in sorted(team_obj["players"], key=lambda x: x["overall"], reverse=True)]
    for p in players:
        p["minutes"] = 0
        p["_value"] = p.get("overall", 75)
        p["_score"] = p.get("overall", 75) + (p.get("stamina", 70) - 70) * 0.15

    # Pick ~10 players with positional coverage
    chosen = []
    for pos in POSITIONS:
        pos_players = [p for p in players if p.get("pos") == pos or p.get("secondaryPos") == pos]
        if pos_players:
            best = max(pos_players, key=lambda x: x["_score"])
            if best not in chosen:
                chosen.append(best)

    for p in sorted(players, key=lambda x: x["_score"], reverse=True):
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

    def _team_total(arr):
        pos_tot = {pos: 0 for pos in POSITIONS}
        off = deff = ovr = 0
        for p in arr:
            m = p["minutes"]
            if m <= 0:
                continue
            pen = fatigue_penalty(m, p.get("stamina", 75))
            w = m / 240.0
            off += w * (p.get("offRating", 75) * pen)
            deff += w * (p.get("defRating", 75) * pen)
            ovr += w * (p.get("overall", 75) * pen)
            pos_tot[p.get("pos", "SG")] += m
            sec = p.get("secondaryPos")
            if sec:
                pos_tot[sec] += m * 0.2
        missing = sum(max(0, 48 - pos_tot[pos]) for pos in POSITIONS)
        cov_pen = 1 - (0.02 * (missing / 240.0))
        return off * cov_pen, deff * cov_pen, ovr * cov_pen

    improved = True
    while improved:
        improved = False
        base_ovr = _team_total(chosen)[2]
        for a in chosen:
            for b in chosen:
                if a == b or a["minutes"] <= 12:
                    continue
                if b["minutes"] >= 24 and b not in chosen[:5]:
                    continue
                a["minutes"] -= 1
                b["minutes"] += 1
                new_ovr = _team_total(chosen)[2]
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
            if pl.get("pos") in POSITIONS:
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
                score_sum += player.get("overall", 75)
                if slot == player.get("pos"):
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
    ordered = starters + bench + [p for p in players if p not in chosen]

    roster = []
    pos_minutes = {p: 0.0 for p in POSITIONS}
    total_minutes = 0
    for p in ordered:
        m = p.get("minutes", 0)
        if m <= 0:
            continue
        total_minutes += m
        pos_minutes[p.get("pos", "SG")] += m
        if p.get("secondaryPos"):
            pos_minutes[p["secondaryPos"]] += m * 0.20
        roster.append({
            "name": p["name"],
            "minutes": m,
            "stamina": p.get("stamina", 75),
            "overall": p.get("overall", 75),
            "offRating": p.get("offRating", 75),
            "defRating": p.get("defRating", 75),
            "pos": p.get("pos", "SG"),
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


# ========================== TEAM PANEL (Single Team Editor) ==========================
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

        tk.Label(self, text=label, font=("Arial", 14, "bold"), bg="white").pack(pady=6)

        # --- Team selector ---
        top = tk.Frame(self, bg="white")
        top.pack(pady=4)
        tk.Label(top, text="Select Team:", bg="white", font=("Arial", 10)).pack(side="left", padx=4)
        self.team_combo = ttk.Combobox(
            top,
            values=[t["name"] for t in teams],
            state="readonly",
            width=28,
            font=("Arial", 10)
        )
        self.team_combo.pack(side="left", padx=4)
        self.team_combo.bind("<<ComboboxSelected>>", self.show_team)

        # --- Pos coverage labels ---
        pos_frame = tk.Frame(self, bg="white")
        pos_frame.pack(pady=3)
        self.pos_labels = {}
        for pos in POSITIONS:
            lbl = tk.Label(pos_frame, text=f"{pos}: 0/48", font=("Arial", 9, "bold"), bg="white")
            lbl.pack(side="left", padx=8)
            self.pos_labels[pos] = lbl

        # --- Player table (with SCO column) ---
        self.table = tk.Frame(self, bg="white")
        self.table.pack(pady=8)
        headers = ["", "Player", "Pos", "OVR", "OFF", "DEF", "SCO", "STA", "Minutes", "Role"]
        for i, h in enumerate(headers):
            tk.Label(self.table, text=h, font=("Arial", 9, "bold"), bg="white").grid(
                row=0, column=i, padx=4, pady=2
            )

        # --- Bottom minutes summary ---
        bottom = tk.Frame(self, bg="white")
        bottom.pack(pady=5)
        self.total_lbl = tk.Label(bottom, text="Total Minutes: 0 / 240",
                                  font=("Arial", 10, "bold"), bg="white")
        self.total_lbl.pack(side="left", padx=6)
        self.remain_lbl = tk.Label(bottom, text="Remaining: 240",
                                   font=("Arial", 10, "bold"), bg="white")
        self.remain_lbl.pack(side="left", padx=6)

        # --- Team ratings ---
        tf = tk.Frame(self, bg="white")
        tf.pack(pady=6)
        self.team_overall_lbl = tk.Label(tf, text="Team Overall: 0.0",
                                         font=("Arial", 11, "bold"), bg="white")
        self.team_off_lbl = tk.Label(tf, text="Offense: 0.0",
                                     font=("Arial", 11), bg="white")
        self.team_def_lbl = tk.Label(tf, text="Defense: 0.0",
                                     font=("Arial", 11), bg="white")
        self.team_overall_lbl.pack(side="left", padx=10)
        self.team_off_lbl.pack(side="left", padx=10)
        self.team_def_lbl.pack(side="left", padx=10)

        # ===== LEFT SIDE: GENERATED STATLINE PANEL =====
        left_side = tk.Frame(main_frame, bg="white", width=380)
        left_side.pack(side="left", fill="y", padx=6, pady=6)

        stat_panel = tk.Frame(left_side, bg="white", bd=2, relief="solid")
        stat_panel.pack(fill="x", pady=6)

        tk.Label(
            stat_panel,
            text="Generated Statline",
            font=("Arial", 14, "bold"),
            bg="white"
        ).pack(pady=6)

        # Textbox for team points
        tk.Label(
            stat_panel, text="Team Points Scored:", font=("Arial", 10), bg="white"
        ).pack()

        team_points_entry = tk.Entry(stat_panel, width=10, font=("Arial", 11))
        team_points_entry.pack(pady=4)

        stat_frame = tk.Frame(stat_panel, bg="white")
        stat_frame.pack(pady=5)

        # ----------- FIXED GENERATED STATLINE (matches target exactly) -----------
        def generate_statline(self=self):
                    # Clear old output
                    for w in stat_frame.winfo_children():
                        w.destroy()
        
                    # Minutes must sum to 240
                    total_minutes = sum(s.get() for s, _ in self.sliders)
                    if total_minutes != 240:
                        tk.Label(stat_frame, text="Minutes must total 240.", fg="red", bg="white").pack()
                        return
        
                    # Validate target points
                    txt = team_points_entry.get().strip()
                    if not txt.isdigit() or int(txt) <= 0:
                        tk.Label(stat_frame, text="Enter a positive integer.", fg="red", bg="white").pack()
                        return
        
                    target = int(txt)
        
                    # A — expected points per player (using same scoring curve as Generated Points)
                    expected = []
                    for s, p in self.sliders:
                        mins = s.get()
                        sco = p.get("scoringRating", 0)
                        exp = scoring_to_game_points(sco, mins)
                        expected.append((p, exp))
        
                    # B — add randomness (Gaussian) around expectation
                    raw_values = []
                    for p, exp in expected:
                        # slightly higher stdev → more game-to-game variance,
                        # but mean = exp is unchanged so long-run averages stay the same
                        base_stdev = max(1.2, math.sqrt(exp) * 0.9)
                        stdev = base_stdev * STATLINE_VARIANCE_BOOST
                        v = random.gauss(exp, stdev)
                        raw_values.append(max(0.0, v))
        
                    # C — convert to integers
                    pts = [int(round(v)) for v in raw_values]
        
                    # Force 0-minute players to stay at 0
                    for i, (p, _) in enumerate(expected):
                        if p.get("minutes", 0) <= 0:
                            pts[i] = 0
        
                    # D — adjust to match target exactly (balanced across all players)
                    diff = target - sum(pts)
                    if diff != 0:
                        steps = abs(diff)
                        for _ in range(steps):
                            weights = []
                            for i, (p, _) in enumerate(expected):
                                mins = p.get("minutes", 0)
                                if mins <= 0:
                                    w = 0
                                elif diff < 0 and pts[i] <= 0:
                                    w = 0
                                else:
                                    # Balanced: every player with minutes > 0 is equally likely to be adjusted
                                    w = 1
                                weights.append(w)
                            if not any(weights):
                                break
                            idx = random.choices(range(len(pts)), weights=weights)[0]
                            if diff > 0:
                                pts[idx] += 1
                            else:
                                pts[idx] -= 1
        
                    # Re-lock 0-minute players
                    for i, (p, _) in enumerate(expected):
                        if p.get("minutes", 0) <= 0:
                            pts[i] = 0
        
                    # Final tiny correction pass (in case of any break)
                    final_diff = target - sum(pts)
                    if final_diff != 0:
                        steps = abs(final_diff)
                        sign = 1 if final_diff > 0 else -1
                        for _ in range(steps):
                            weights = []
                            for i, (p, _) in enumerate(expected):
                                mins = p.get("minutes", 0)
                                if mins <= 0:
                                    w = 0
                                elif sign < 0 and pts[i] <= 0:
                                    w = 0
                                else:
                                    w = max(1, 120 - p.get("scoringRating", 60))
                                weights.append(w)
                            if not any(weights):
                                break
                            idx = random.choices(range(len(pts)), weights=weights)[0]
                            pts[idx] += sign
        
                    # =========================
                    # NEW STEP: NO PLAYER = 1pt
                    # =========================
                    # 1) Pair up 1-point players: (1,1) -> (0,2)
                    ones = [i for i, (p, _) in enumerate(expected)
                            if p.get("minutes", 0) > 0 and pts[i] == 1]
        
                    while len(ones) >= 2:
                        i1 = ones.pop()
                        i2 = ones.pop()
                        # 1 + 1 -> 0 + 2 (total unchanged)
                        pts[i1] = 0
                        pts[i2] = 2
        
                    # 2) Handle leftover single 1, if any
                    ones = [i for i, (p, _) in enumerate(expected)
                            if p.get("minutes", 0) > 0 and pts[i] == 1]
                    if len(ones) == 1:
                        i1 = ones[0]
        
                        # Prefer to borrow from someone with >=3
                        candidates = [i for i, (p, _) in enumerate(expected)
                                      if p.get("minutes", 0) > 0 and i != i1 and pts[i] >= 3]
                        if candidates:
                            j = random.choice(candidates)
                            # 1 + 3 -> 2 + 2
                            pts[i1] = 2
                            pts[j] -= 1
                        else:
                            # Fallback: use someone with >=2
                            candidates = [i for i, (p, _) in enumerate(expected)
                                          if p.get("minutes", 0) > 0 and i != i1 and pts[i] >= 2]
                            if candidates:
                                j = random.choice(candidates)
                                # 1 + 2 -> 0 + 3
                                pts[i1] = 0
                                pts[j] += 1
                            else:
                                # Extreme edge case (e.g., total = 1 with only one player scoring):
                                # can't fix without breaking the total; leave as-is.
                                pass
        
                    # Sanity re-lock 0-minute players again
                    for i, (p, _) in enumerate(expected):
                        if p.get("minutes", 0) <= 0:
                            pts[i] = 0
        
                    # Display table
                    header = tk.Frame(stat_frame, bg="white")
                    tk.Label(header, text="Player", width=16, font=("Arial", 10, "bold"), bg="white").pack(side="left")
                    tk.Label(header, text="PTS", width=6, font=("Arial", 10, "bold"), bg="white").pack(side="left")
                    header.pack(pady=2)
        
                    for (p, _), val in zip(expected, pts):
                        r = tk.Frame(stat_frame, bg="white")
                        tk.Label(r, text=p["name"], width=16, bg="white").pack(side="left")
                        tk.Label(r, text=str(val), width=6, bg="white").pack(side="left")
                        r.pack(pady=1)
        
                    # FOOTER
                    footer = tk.Frame(stat_frame, bg="white")
                    tk.Label(
                        footer,
                        text="TOTAL",
                        width=16,
                        font=("Arial", 11, "bold"),
                        fg="blue",
                        bg="white"
                    ).pack(side="left")
                    tk.Label(
                        footer,
                        text=str(sum(pts)),
                        width=6,
                        font=("Arial", 11, "bold"),
                        fg="blue",
                        bg="white"
                    ).pack(side="left")
                    footer.pack(pady=8)

        # button
        gen_stat_btn = tk.Button(
            stat_panel,
            text="Generate Statline",
            font=("Arial", 12, "bold"),
            bg="#cc5500", fg="white",
            padx=20, pady=6,
            relief="flat",
            command=generate_statline
        )
        gen_stat_btn.pack(pady=10)

        # --- Autocomplete button ---
        auto = tk.Frame(self, bg="white")
        auto.pack(pady=8)
        self.auto_btn = tk.Button(
            auto,
            text="Autocomplete",
            font=("Arial", 11, "bold"),
            bg="#2b85ff",
            fg="white",
            relief="flat",
            padx=20,
            pady=4,
            command=self.autocomplete_rotation
        )
        self.auto_btn.pack(pady=2)

    # ---------------- SAVE UI DATA -----------------
    def save_current_team(self):
        if not self.current_team or not self.players:
            return
        for s, p in self.sliders:
            p["minutes"] = s.get()
        self.team_data[self.current_team] = [dict(p) for p in self.players]

    # ---------------- LOAD TEAM -----------------
    def load_team_data(self, name):
        if name in self.team_data:
            return [dict(p) for p in self.team_data[name]]

        team_obj = next(t for t in teams if t["name"] == name)
        ordered_players, _ = autocomplete_minutes_and_ratings_for_team(team_obj)

        arr = []
        for p in ordered_players:
            d = dict(p)
            if "minutes" not in d:
                d["minutes"] = 0
            arr.append(d)

        self.team_data[name] = arr
        return arr

    # ---------------- SHOW TEAM IN UI -----------------
    def show_team(self, _=None):
        if self.current_team:
            self.save_current_team()
        name = self.team_combo.get()
        if not name:
            return
        self.current_team = name
        self.players = self.load_team_data(name)
        self.draw_table()

    # ---------------- REORDER PLAYERS (checkbox click) -----------------
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

        self.selected = None
        self.draw_table()

    # ---------------- DRAW PLAYER TABLE -----------------
    def draw_table(self):
        for w in self.table.grid_slaves():
            if int(w.grid_info()["row"]) > 0:
                w.destroy()
        self.sliders.clear()

        for i, p in enumerate(self.players):
            starter = i < 5
            f = ("Arial", 8, "bold") if starter else ("Arial", 8)

            # checkbox-like square
            c = tk.Canvas(self.table, width=12, height=12, bg="white", highlightthickness=0)
            rect = c.create_rectangle(1, 1, 11, 11, outline="black", fill="white")
            c.grid(row=i + 1, column=0, padx=6, pady=3, sticky="w")
            c.bind("<Button-1>", lambda e, ix=i: self.select_player(ix))
            p["_canvas"], p["_rect"] = c, rect

            pos = p["pos"] + ("/" + p["secondaryPos"] if p.get("secondaryPos") else "")

            scoring = round(p.get("scoringRating", 0), 1)

            tk.Label(self.table, text=p["name"], font=f, bg="white").grid(
                row=i + 1, column=1, sticky="w"
            )
            tk.Label(self.table, text=pos, font=("Arial", 8, "italic"), bg="white").grid(
                row=i + 1, column=2
            )
            tk.Label(self.table, text=p["overall"], font=("Arial", 8), bg="white").grid(
                row=i + 1, column=3
            )
            tk.Label(self.table, text=p["offRating"], font=("Arial", 8), bg="white").grid(
                row=i + 1, column=4
            )
            tk.Label(self.table, text=p["defRating"], font=("Arial", 8), bg="white").grid(
                row=i + 1, column=5
            )
            tk.Label(self.table, text=scoring, font=("Arial", 8), bg="white").grid(
                row=i + 1, column=6
            )
            tk.Label(self.table, text=p["stamina"], font=("Arial", 8), bg="white").grid(
                row=i + 1, column=7
            )

            s = tk.Scale(
                self.table,
                from_=0,
                to=48,
                orient="horizontal",
                length=90,
                showvalue=True,
                bg="white",
                troughcolor="#e0e0e0",
                highlightthickness=0,
                font=("Arial", 7),
            )
            s.grid(row=i + 1, column=8, padx=3)
            s.set(p.get("minutes", 24 if starter else 0))
            s._last = s.get()
            s.config(command=lambda _, sc=s: self.update_totals(sc))
            self.sliders.append((s, p))

            role = ["PG", "SG", "SF", "PF", "C"][i] if i < 5 else str(i + 1)
            tk.Label(self.table, text=role, font=f, bg="white").grid(row=i + 1, column=9)
            p["_role"] = role

        self.update_totals()

    # ---------------- MINUTES + TEAM RATING UPDATES -----------------
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

        base_ovr, eff_ovr = _agg_with_fatigue(roster, "overall")
        base_off, eff_off = _agg_with_fatigue(roster, "offRating")
        base_def, eff_def = _agg_with_fatigue(roster, "defRating")

        star_ovr = _star_boost(eff_ovr, TR_STAR_EXP_OVR, ref=TR_STAR_REF)
        star_off = _star_boost(eff_off, TR_STAR_EXP_OFF, ref=TR_STAR_REF)
        star_def = _star_boost(eff_def, TR_STAR_EXP_DEF, ref=TR_STAR_REF)

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

        # push minutes back into player dicts
        for s, p in self.sliders:
            p["minutes"] = s.get()

        self.update_team_ratings()
        if self.on_update:
            self.on_update()

    # ---------------- AUTOCOMPLETE BUTTON LOGIC -----------------
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
                pen = fatigue_penalty(m, p["stamina"])
                w = m / 240
                off += w * (p["offRating"] * pen)
                deff += w * (p["defRating"] * pen)
                ovr += w * (p["overall"] * pen)
                pos_tot[p["pos"]] += m
                if p.get("secondaryPos"):
                    pos_tot[p["secondaryPos"]] += m * 0.2
            missing = sum(max(0, 48 - pos_tot[pos]) for pos in POSITIONS)
            cov_pen = 1 - (0.02 * (missing / 240))
            return off * cov_pen, deff * cov_pen, ovr * cov_pen

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

        # push to sliders & redraw
        self.draw_table()
        self.update_team_ratings()
        if self.on_update:
            self.on_update()


# ======================== ROOT WINDOW / UI SETUP ========================
root = tk.Tk()
root.title("Team Minutes Editor (Single Team)")
root.geometry("1500x900")
root.configure(bg="white")

# --------- MAIN HORIZONTAL WRAPPER -----------
main_frame = tk.Frame(root, bg="white")
main_frame.pack(fill="both", expand=True)

# LEFT → TEAM PANEL
panel = TeamPanel(main_frame, "Team")
panel.pack(side="left", fill="both", expand=True, padx=6, pady=6)

# RIGHT → GENERATED PANELS (POINTS + STATLINE)
right_side = tk.Frame(main_frame, bg="white", width=380)
right_side.pack(side="right", fill="y", padx=6, pady=6)

# ===== Generated Points Panel =====
points_panel = tk.Frame(right_side, bg="white", bd=2, relief="solid")
points_panel.pack(fill="x", pady=6)

tk.Label(points_panel, text="Generated Points", font=("Arial", 14, "bold"), bg="white").pack(pady=6)

points_frame = tk.Frame(points_panel, bg="white")
points_frame.pack(pady=5)


def generate_points():
    for w in points_frame.winfo_children():
        w.destroy()

    total_minutes = sum(s.get() for s, _ in panel.sliders)
    if total_minutes != 240:
        tk.Label(points_frame, text="Total minutes must be 240.",
                 font=("Arial", 11, "bold"), fg="red", bg="white").pack()
        return

    header = tk.Frame(points_frame, bg="white")
    tk.Label(header, text="Player", font=("Arial", 10, "bold"), width=18, bg="white").pack(side="left")
    tk.Label(header, text="PTS", font=("Arial", 10, "bold"), width=6, bg="white").pack(side="left")
    header.pack(pady=1)

    team_total = 0
    for s, p in panel.sliders:
        mins = s.get()
        sco = p.get("scoringRating", 0)
        pts = scoring_to_game_points(sco, mins)
        team_total += pts

        row = tk.Frame(points_frame, bg="white")
        tk.Label(row, text=p["name"], font=("Arial", 10), width=18, bg="white").pack(side="left")
        tk.Label(row, text=f"{pts:.1f}", font=("Arial", 10), width=6, bg="white").pack(side="left")
        row.pack(pady=1)

    total_row = tk.Frame(points_frame, bg="white")
    tk.Label(total_row, text="TOTAL", font=("Arial", 11, "bold"), width=18, fg="blue", bg="white").pack(side="left")
    tk.Label(total_row, text=f"{team_total:.1f}", font=("Arial", 11, "bold"), width=6, fg="blue", bg="white").pack(side="left")
    total_row.pack(pady=8)


gen_btn = tk.Button(
    points_panel,
    text="Generate Points",
    font=("Arial", 12, "bold"),
    bg="#1a9e55", fg="white",
    padx=20, pady=4,
    relief="flat",
    command=generate_points
)
gen_btn.pack(pady=8)

root.mainloop()
