import json
import tkinter as tk
from tkinter import ttk

# ----------------------------
# Load JSON
# ----------------------------
with open("15.json", "r", encoding="utf-8") as f:
    data = json.load(f)

# ----------------------------
# Exploding Elite Curve
# ----------------------------
def explode(value, power):
    return (value / 100) ** power

# ----------------------------
# Close Shot Penalty (NEW)
# ----------------------------
def close_penalty(close):
    if close >= 70:
        return 0
    return ((70 - close) / 30) ** 2.3    # nonlinear punishment


# ----------------------------
# Scoring Rating (Improved)
# ----------------------------
def scoring_rating(pos, three, mid, close):

    # ------- Guards (PG / SG) -------
    if pos in {"PG", "SG"}:
        three_term = explode(three, 7) * 1.20
        mid_term   = explode(mid,   7) * 1.55
        close_term = explode(close, 6) * 1.10

        base = (
            0.38 * (three / 100) +
            0.40 * (mid / 100) +
            0.22 * (close / 100)
        )

        penalty = close_penalty(close) * 1.7  # STRONG PUNISHMENT for close <70

        raw = base + three_term + mid_term + close_term - penalty

        scaled = raw * 14.75 + 43.5
        return scaled

    # ------- Wings (SF) -------
    if pos == "SF":
        three_term = explode(three, 7) * 1.05
        mid_term   = explode(mid,   7) * 1.40
        close_term = explode(close, 7) * 1.50

        base = (
            0.32 * (three / 100) +
            0.35 * (mid / 100) +
            0.33 * (close / 100)
        )

        penalty = close_penalty(close) * 1.2

        raw = base + three_term + mid_term + close_term - penalty
        scaled = raw * 14.75 + 43.5
        return scaled

    # ------- Bigs (PF / C) -------
    if pos in {"PF", "C"}:
        close_term = explode(close, 8) * 1.95   # buff finishing even more
        mid_term   = explode(mid,   6) * 1.30
        three_term = explode(three, 5) * 0.60   # reduce stretch big inflation

        base = (
            0.58 * (close / 100) +
            0.27 * (mid / 100) +
            0.15 * (three / 100)
        )

        penalty = close_penalty(close) * 2.0   # brutal if a big can't finish

        raw = base + three_term + mid_term + close_term - penalty
        scaled = raw * 14.75 + 43.5
        return scaled


# ----------------------------
# Build team → players
# ----------------------------
teams = {}
all_players = []

for conf, tlist in data["conferences"].items():
    for team in tlist:
        teams[team["name"]] = team["players"]
        for p in team["players"]:
            temp = p.copy()
            temp["team"] = team["name"]
            all_players.append(temp)


# ----------------------------
# GUI Setup
# ----------------------------
root = tk.Tk()
root.title("Player Scoring Ratings")
root.geometry("1050x750")

label = tk.Label(root, text="Select a Team:", font=("Arial", 15))
label.pack(pady=12)

selected_team = tk.StringVar()

dropdown_values = list(teams.keys()) + ["All Players (Sorted)"]

team_dropdown = ttk.Combobox(root, textvariable=selected_team, font=("Arial", 13))
team_dropdown["values"] = dropdown_values
team_dropdown.pack()


# ----------------------------
# Table Setup
# ----------------------------
tree = ttk.Treeview(
    root,
    columns=("name", "team", "pos", "three", "mid", "close", "rating"),
    show="headings",
    height=30
)

tree.heading("name", text="Player")
tree.heading("team", text="Team")
tree.heading("pos", text="Pos")
tree.heading("three", text="3PT")
tree.heading("mid", text="Mid")
tree.heading("close", text="Close")
tree.heading("rating", text="Scoring Rating")

tree.column("name", width=200)
tree.column("team", width=140)
tree.column("pos", width=60)
tree.column("three", width=70)
tree.column("mid", width=70)
tree.column("close", width=70)
tree.column("rating", width=140)

tree.pack(fill="both", expand=True, pady=20)


# ----------------------------
# Update table
# ----------------------------
def update_table(event):
    team = selected_team.get()

    for row in tree.get_children():
        tree.delete(row)

    # ALL PLAYERS MODE
    if team == "All Players (Sorted)":
        rows = []
        for p in all_players:
            three = p["attrs"][0]
            mid   = p["attrs"][1]
            close = p["attrs"][2]
            rating = scoring_rating(p["pos"], three, mid, close)
            rows.append((p["name"], p["team"], p["pos"], three, mid, close, rating))

        rows.sort(key=lambda x: x[6], reverse=True)

        for r in rows:
            tree.insert("", "end", values=(
                r[0], r[1], r[2], r[3], r[4], r[5], f"{r[6]:.2f}"
            ))
        return

    # TEAM MODE
    roster = teams[team]

    for p in roster:
        three = p["attrs"][0]
        mid   = p["attrs"][1]
        close = p["attrs"][2]
        rating = scoring_rating(p["pos"], three, mid, close)

        tree.insert("", "end", values=(
            p["name"], team, p["pos"], three, mid, close, f"{rating:.2f}"
        ))


team_dropdown.bind("<<ComboboxSelected>>", update_table)

root.mainloop()
