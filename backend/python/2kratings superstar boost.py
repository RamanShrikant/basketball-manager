# ------------------------------------------------------------
# Interactive Player Overall Calculator (13 Attributes with Rebounding)
# Smooth 60-99 scaling, including Rebounding
# +1 overall for 3+ stats above 90, +1 for each extra 90+ stat
# ------------------------------------------------------------

pos_params = {
    #Three Point, Mid Range, Close Shot, Free Throw, Ball Handling, Passing, Speed, Athleticism, Perimeter Defense, Interior Defense, Block, Steal, Rebounding
    "PG": {
        "weights": [0.11, 0.05, 0.03, 0.05, 0.17, 0.17, 0.10, 0.07, 0.10, 0.02, 0.01, 0.07, 0.05],
        "prim": [5, 6, 1, 7],  # Ball Handling, Passing, ThreePt, Speed
        "alpha": 0.25
    },
    "SG": {
        "weights": [0.15, 0.08, 0.05, 0.05, 0.12, 0.07, 0.11, 0.07, 0.11, 0.03, 0.02, 0.08, 0.06],
        "prim": [1, 5, 7],  # ThreePt, BallHandling, Speed
        "alpha": 0.28
    },
    "SF": {
        "weights": [0.12, 0.09, 0.07, 0.04, 0.08, 0.07, 0.10, 0.10, 0.10, 0.06, 0.04, 0.08, 0.05],
        "prim": [1, 8, 9],  # ThreePt, Athleticism, PerimeterDef
        "alpha": 0.22
    },
    "PF": {
        "weights": [0.07, 0.07, 0.12, 0.03, 0.05, 0.05, 0.08, 0.12, 0.07, 0.13, 0.08, 0.08, 0.05],
        "prim": [3, 10, 8],  # CloseShot, InteriorDef, Athleticism
        "alpha": 0.24
    },
    "C": {
        "weights": [0.04, 0.06, 0.17, 0.03, 0.02, 0.04, 0.07, 0.12, 0.05, 0.16, 0.13, 0.06, 0.08],
        "prim": [3, 10, 11, 13],  # CloseShot, InteriorDef, Block, Rebounding
        "alpha": 0.30
    }
}


def overall_from_attrs(attrs, position):
    """
    Compute overall rating with Rebounding as a 13th attribute.
    Smooth scaling (sigmoid) maps scores to 60-99 range.
    Includes +1 overall for 3+ stats above 90, +1 for each additional 90+ stat.
    """
    import math

    if position not in pos_params:
        raise ValueError(f"Invalid position '{position}'.")

    params = pos_params[position]
    w = params["weights"]
    prim = [i - 1 for i in params["prim"]]  # convert 1-based to 0-based
    alpha = params["alpha"]

    # Weighted score
    W = sum(wi * ai for wi, ai in zip(w, attrs))
    Peak = max(attrs[i] for i in prim)
    B = alpha * Peak + (1 - alpha) * W

    # Smooth sigmoid scaling
    center = 77       # typical average player
    steepness = 0.12  # controls compression/stretch
    S = 1 / (1 + math.exp(-steepness * (B - center)))  # 0..1

    # Map to 60-99
    overall = 60 + 39 * S
    overall = int(round(max(60, min(99, overall))))

    # Bonus for stats above 90
    num_90_plus = sum(1 for a in attrs if a > 90)
    if num_90_plus >= 3:
        overall += 1 + (num_90_plus - 3)
        if overall > 99:
            overall = 99

    return overall


def get_player_input():
    """
    Ask user to input attributes and position, then print overall.
    """
    print("\n--- Player Overall Calculator (13 Attributes with Rebounding) ---")
    print("Enter player attributes (25–99):")

    attr_names = [
        "Three Point",
        "Mid Range",
        "Close Shot",
        "Free Throw",
        "Ball Handling",
        "Passing",
        "Speed",
        "Athleticism",
        "Perimeter Defense",
        "Interior Defense",
        "Block",
        "Steal",
        "Rebounding"
    ]

    attrs = []
    for name in attr_names:
        while True:
            try:
                val = float(input(f"{name}: "))
                if 25 <= val <= 99:
                    attrs.append(val)
                    break
                else:
                    print("Enter a value between 25-99.")
            except ValueError:
                print("Enter a number.")

    while True:
        pos = input("Enter position (PG, SG, SF, PF, C): ").strip().upper()
        if pos in pos_params:
            break
        print("Invalid position.")

    overall = overall_from_attrs(attrs, pos)
    print(f"\nCalculated Overall for {pos}: {overall}\n")


if __name__ == "__main__":
    import sys, json
    data = json.loads(sys.stdin.read())
    overall = overall_from_attrs(data["attrs"], data["pos"])
    print(overall)


