from __future__ import annotations
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PYDIR = ROOT / "public" / "python"
sys.path.insert(0, str(PYDIR))

import contract_extension_logic as ext


def iter_teams(league):
    if isinstance(league.get("teams"), list):
        yield from [t for t in league.get("teams", []) if isinstance(t, dict)]
        return
    for rows in (league.get("conferences") or {}).values():
        if isinstance(rows, list):
            yield from [t for t in rows if isinstance(t, dict)]


def main(path_text):
    path = Path(path_text)
    league = json.loads(path.read_text(encoding="utf-8-sig"))
    state = league.get("contractExtensionState") if isinstance(league.get("contractExtensionState"), dict) else {}
    history = league.get("contractExtensionHistory") if isinstance(league.get("contractExtensionHistory"), list) else []

    print("=== V10 EXTENSION DIAGNOSTICS ===")
    print(f"Save: {path}")
    print(f"Canonical extension history rows: {len(history)}")
    print(f"Extension-state transaction rows: {len(state.get('transactions') or [])}")
    print(f"CPU phases processed: {state.get('cpuPhasesProcessed') or []}")

    runs = state.get("cpuRunDiagnostics") if isinstance(state.get("cpuRunDiagnostics"), list) else []
    if runs:
        print("\nCPU deadline runs:")
        for row in runs:
            if not isinstance(row, dict):
                continue
            print(
                f"- {row.get('phase')} {row.get('date')}: legal={row.get('legalCandidates',0)} "
                f"willing={row.get('playerWilling',0)} refused={row.get('playerRefused',0)} "
                f"teamApproved={row.get('teamApproved',0)} payrollRejected={row.get('payrollRejected',0)} "
                f"signed={row.get('signed',0)}"
            )
            reasons = row.get("rejectionReasons") or {}
            if reasons:
                print("  rejection reasons:", dict(sorted(reasons.items(), key=lambda item: (-item[1], item[0]))))
    else:
        print("\nNo V10 CPU deadline diagnostics are stored yet. Sim through an extension deadline first.")

    # Current snapshot: legally extension-shaped rows that are willing/refusing.
    current = Counter()
    samples = {"willing": [], "refusing": []}
    for team in iter_teams(league):
        mood_map = ext._build_extension_mood_map(league, team, {})
        payload = {"__extensionMoodByPlayer": mood_map}
        for player in team.get("players", []) or []:
            row = ext.build_extension_eligibility(league, team, player, payload)
            if row.get("playerRefusesExtension"):
                current["refusing"] += 1
                if len(samples["refusing"]) < 8:
                    samples["refusing"].append((team.get("name"), player.get("name"), row.get("extensionInterestScore"), row.get("extensionMoodScore")))
            elif row.get("eligible"):
                current["willing"] += 1
                if len(samples["willing"]) < 8:
                    samples["willing"].append((team.get("name"), player.get("name"), row.get("extensionInterestScore"), row.get("extensionMoodScore")))

    print("\nCurrent extension-interest snapshot:")
    print(f"Willing/has ask: {current['willing']}")
    print(f"Legally shaped but refusing: {current['refusing']}")
    for key in ["willing", "refusing"]:
        if samples[key]:
            print(f"{key.title()} samples:")
            for team_name, player_name, interest, mood in samples[key]:
                print(f"  {team_name}: {player_name} — interest {interest}, mood {mood}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: py -3 frontend/scripts/mood-extension-v10-diagnostics.py <exported-league.json>")
    main(sys.argv[1])
