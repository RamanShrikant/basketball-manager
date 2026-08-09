from __future__ import annotations
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PYDIR = ROOT / "public" / "python"
sys.path.insert(0, str(PYDIR))

from player_mood_logic import get_locker_room_moods
from contract_extension_logic import build_extension_eligibility, _build_extension_mood_map
from cpu_contract_extensions import build_cpu_extension_offer


def teams_of(league):
    if isinstance(league.get("teams"), list):
        return [t for t in league["teams"] if isinstance(t, dict)]
    out = []
    for rows in (league.get("conferences") or {}).values():
        if isinstance(rows, list): out.extend(t for t in rows if isinstance(t, dict))
    return out


def bucket(score):
    if score >= 90: return "90-100 Thriving"
    if score >= 80: return "80-89 Very Happy"
    if score >= 72: return "72-79 Happy"
    if score >= 62: return "62-71 Content"
    if score >= 50: return "50-61 Uneasy"
    if score >= 35: return "35-49 Frustrated"
    return "0-34 Very Frustrated"


def main(path):
    league = json.loads(Path(path).read_text(encoding="utf-8"))
    mood_counts = Counter()
    eligible = willing = cpu_offer = 0
    fail = Counter()
    for team in teams_of(league):
        name = team.get("name") or team.get("teamName") or ""
        mood_result = get_locker_room_moods(league, name)
        for row in mood_result.get("players", []):
            mood_counts[bucket(int(row.get("moodScore") or 0))] += 1
        payload = {"__extensionMoodByPlayer": _build_extension_mood_map(league, team, {})}
        for player in team.get("players", []) or []:
            row = build_extension_eligibility(league, team, player, payload)
            if not row.get("extensionType"):
                continue
            if row.get("playerRefusesExtension"):
                fail["player_prefers_to_wait"] += 1
                continue
            if not row.get("eligible"):
                fail["legal_or_package_gate"] += 1
                continue
            eligible += 1
            willing += 1
            cpu = build_cpu_extension_offer(league, team, player, row, phase="deadline")
            if cpu:
                cpu_offer += 1
            else:
                fail["cpu_value_or_payroll_gate"] += 1

    print("V9 LEAGUE MOOD DISTRIBUTION")
    for key in ["90-100 Thriving", "80-89 Very Happy", "72-79 Happy", "62-71 Content", "50-61 Uneasy", "35-49 Frustrated", "0-34 Very Frustrated"]:
        print(f"  {key:24} {mood_counts[key]}")
    print("\nEXTENSION PIPELINE SNAPSHOT")
    print(f"  Player willing + legally eligible: {willing}")
    print(f"  CPU would produce an offer:        {cpu_offer}")
    for key, value in fail.most_common():
        print(f"  {key:32} {value}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python frontend/scripts/mood-extension-v9-diagnostics.py <league-save.json>")
    main(sys.argv[1])
