import tkinter as tk
from tkinter import messagebox
import math

# ------------------------------------------------------------
# Interactive Player Overall Calculator
# Adds Offensive/Defensive IQ (very small effect)
# ------------------------------------------------------------

pos_params = {
    "PG": {"weights": [0.11, 0.05, 0.03, 0.05, 0.17, 0.17, 0.10, 0.07,
                       0.10, 0.02, 0.01, 0.07, 0.05, 0.01, 0.01],
            "prim": [5, 6, 1, 7], "alpha": 0.25},
    "SG": {"weights": [0.15, 0.08, 0.05, 0.05, 0.12, 0.07, 0.11, 0.07,
                       0.11, 0.03, 0.02, 0.08, 0.06, 0.01, 0.01],
            "prim": [1, 5, 7], "alpha": 0.28},
    "SF": {"weights": [0.12, 0.09, 0.07, 0.04, 0.08, 0.07, 0.10, 0.10,
                       0.10, 0.06, 0.04, 0.08, 0.05, 0.01, 0.01],
            "prim": [1, 8, 9], "alpha": 0.22},
    "PF": {"weights": [0.07, 0.07, 0.12, 0.03, 0.05, 0.05, 0.08, 0.12,
                       0.07, 0.13, 0.08, 0.08, 0.05, 0.01, 0.01],
            "prim": [3, 10, 8], "alpha": 0.24},
    "C":  {"weights": [0.04, 0.06, 0.17, 0.03, 0.02, 0.04, 0.07, 0.12,
                       0.05, 0.16, 0.13, 0.06, 0.08, 0.01, 0.01],
            "prim": [3, 10, 11, 13], "alpha": 0.30}
}

ATTR_NAMES = [
    "Three Point", "Mid Range", "Close Shot", "Free Throw",
    "Ball Handling", "Passing", "Speed", "Athleticism",
    "Perimeter Defense", "Interior Defense", "Block", "Steal",
    "Rebounding", "Offensive IQ", "Defensive IQ"
]

OFFENSIVE_ATTRS = [0, 1, 2, 3, 4, 5, 6, 7, 13]   # add offensive IQ
DEFENSIVE_ATTRS = [7, 8, 9, 10, 11, 12, 14]      # add defensive IQ


def overall_from_attrs(attrs, position):
    params = pos_params[position]
    w = params["weights"]
    prim = [i - 1 for i in params["prim"]]
    alpha = params["alpha"]
    W = sum(wi * ai for wi, ai in zip(w, attrs))
    Peak = max(attrs[i] for i in prim)
    B = alpha * Peak + (1 - alpha) * W
    S = 1 / (1 + math.exp(-0.12 * (B - 77)))
    overall = int(round(60 + 39 * S))
    num_90_plus = sum(1 for a in attrs if a > 90)
    if num_90_plus >= 3:
        overall = min(99, overall + 1 + (num_90_plus - 3))
    return overall


def offense_defense_from_attrs(attrs, position):
    params = pos_params[position]
    w = params["weights"]
    off_score = sum(w[i] * attrs[i] for i in OFFENSIVE_ATTRS)
    def_score = sum(w[i] * attrs[i] for i in DEFENSIVE_ATTRS)
    off_weight = sum(w[i] for i in OFFENSIVE_ATTRS)
    def_weight = sum(w[i] for i in DEFENSIVE_ATTRS)

    def scale(x):
        S = 1 / (1 + math.exp(-0.12 * (x - 77)))
        return int(round(60 + 39 * S))

    return scale(off_score / off_weight), scale(def_score / def_weight)


# --- Stamina Rating (same as last version) ---
def stamina_rating(age, athleticism):
    age = max(18, min(45, age))
    ath = max(25, min(99, athleticism))

    if age <= 27:
        age_factor = 1.0
    elif 28 <= age <= 34:
        age_factor = 0.95 - (0.15 * (age - 28) / 6)
    else:
        age_factor = 0.8 - (0.45 * (age - 35) / 10)

    age_factor = max(0.35, min(1.0, age_factor))
    stamina_raw = (age_factor * 99 * 0.575) + (ath * 0.425)
    norm = (stamina_raw - 40) / (99 - 40)
    stamina = 40 + norm * 59
    stamina = max(40, min(99, stamina))
    return int(round(stamina))


# ---------------- GUI SECTION ---------------- #
def calculate_overall():
    try:
        attrs = []
        for entry in attr_entries:
            val = float(entry.get())
            if not (25 <= val <= 99):
                messagebox.showerror("Invalid Input", "Each attribute must be between 25 and 99.")
                return
            attrs.append(val)

        pos = pos_var.get().upper().strip()
        sec_pos = sec_pos_var.get().upper().strip()
        age_text = age_entry.get().strip()
        if not age_text.isdigit():
            messagebox.showerror("Invalid Input", "Please enter a valid age.")
            return
        age = int(age_text)
        if not (18 <= age <= 45):
            messagebox.showerror("Invalid Age", "Age must be between 18 and 45.")
            return
        if pos not in pos_params:
            messagebox.showerror("Invalid Position", "Primary position must be PG, SG, SF, PF, or C.")
            return
        if sec_pos and sec_pos not in pos_params:
            messagebox.showwarning("Note", "Invalid secondary position ignored.")
            sec_pos = ""

        overall = overall_from_attrs(attrs, pos)
        off_rating, def_rating = offense_defense_from_attrs(attrs, pos)
        stamina = stamina_rating(age, attrs[7])

        result_label.config(
            text=(
                f"Calculated Overall: {overall}\n"
                f"Offensive Rating: {off_rating}\n"
                f"Defensive Rating: {def_rating}\n"
                f"Stamina Rating: {stamina}\n"
                f"Position: {pos}{' / ' + sec_pos if sec_pos else ''} | Age: {age}"
            ),
            fg="green"
        )
        result_label.update_idletasks()

    except ValueError:
        messagebox.showerror("Invalid Input", "Please enter valid numeric values for all fields.")


# --- GUI setup ---
root = tk.Tk()
root.title("Player Overall Calculator")
root.geometry("480x880")
root.resizable(False, False)

tk.Label(root, text="Player Overall Calculator", font=("Helvetica", 16, "bold")).pack(pady=10)
frame = tk.Frame(root)
frame.pack()

attr_entries = []
for i, name in enumerate(ATTR_NAMES):
    tk.Label(frame, text=name + ":").grid(row=i, column=0, sticky="e", padx=5, pady=3)
    entry = tk.Entry(frame, width=10)
    entry.grid(row=i, column=1, padx=5, pady=3)
    attr_entries.append(entry)

tk.Label(root, text="Age:").pack()
age_entry = tk.Entry(root, width=10)
age_entry.pack(pady=3)

tk.Label(root, text="Primary Position (PG, SG, SF, PF, C):").pack()
pos_var = tk.StringVar()
tk.Entry(root, textvariable=pos_var, width=10).pack(pady=3)

tk.Label(root, text="Secondary Position (optional):").pack()
sec_pos_var = tk.StringVar()
tk.Entry(root, textvariable=sec_pos_var, width=10).pack(pady=3)

tk.Button(root, text="Calculate Overall", command=calculate_overall,
          bg="#0078D7", fg="white").pack(pady=15)

result_label = tk.Label(root, text="", font=("Helvetica", 13))
result_label.pack(pady=10)

root.mainloop()
