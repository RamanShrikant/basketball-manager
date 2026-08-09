from __future__ import annotations
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PYDIR = ROOT / "public" / "python"
sys.path.insert(0, str(PYDIR))

import player_mood_logic as mood


def assert_true(condition, message):
    if not condition:
        raise AssertionError(message)


def test_injury_context_active_and_returned():
    active = {
        "name": "Injured Player",
        "injury": {"active": True, "returnDate": "2027-02-15"},
    }
    ctx = mood._v11_player_injury_context(active, "2027-02-01")
    assert_true(ctx["active"], f"Expected active injury context, got {ctx}")
    assert_true(ctx["daysRemaining"] == 14, f"Expected 14 days remaining, got {ctx}")
    assert_true(mood._v11_injury_mood_impact(ctx) < 0, "Active injury should have a small frustration effect")

    returned = mood._v11_player_injury_context(active, "2027-02-15")
    assert_true(not returned["active"], f"Player should be available on return date, got {returned}")
    assert_true(mood._v11_injury_mood_impact(returned) == 0, "Recovered player should have no injury mood penalty")


def test_v11_source_guards():
    mood_source = (PYDIR / "player_mood_logic.py").read_text(encoding="utf-8")
    locker = (ROOT / "src" / "pages" / "LockerRoom.jsx").read_text(encoding="utf-8")
    extensions = (ROOT / "src" / "pages" / "ContractExtensions.jsx").read_text(encoding="utf-8")
    finder = (ROOT / "src" / "pages" / "TradeFinder.jsx").read_text(encoding="utf-8")
    roster = (ROOT / "src" / "pages" / "RosterView.jsx").read_text(encoding="utf-8")
    intel = (ROOT / "src" / "pages" / "Intel_v1.jsx").read_text(encoding="utf-8")

    assert_true("v11" in str(mood.MOOD_SYSTEM_VERSION).lower(), "Mood system version is not V11")
    assert_true("Injury absence does not count as a coaching or playing-time decision" in mood_source, "Injury-safe minutes guard is missing")
    assert_true('factors["injuryRecovery"]' in mood_source, "Injury recovery mood factor is missing")

    assert_true("function MoodDriversPanel" in locker, "Mood-first Locker Room panel is missing")
    assert_true("function ContractOutlookMini" in locker, "Compact contract outlook is missing")
    assert_true("function MoodLedgerStrip" in locker, "Mood context strip is missing")
    assert_true("xl:grid-cols-[520px_minmax(0,1fr)]" in locker, "Locker Room left-column sizing is missing")
    assert_true("right-[-120px]" not in locker, "Old clipped Locker Room team watermark is still present")

    assert_true("orderedExtensionPlayers" in extensions, "Contract Extensions status ordering is missing")
    assert_true("extensionRowSortBucket" in extensions, "Contract Extensions status buckets are missing")

    assert_true("localeCompare(String(b?.name || b?.teamName" in finder, "Trade Finder alphabetical team order is missing")

    assert_true('{ key: "injuryStatus", label: "STATUS"' not in roster, "Roster STATUS column still exists")
    assert_true("formatInjuryReturnLabel(player, currentLeagueDate)" in roster, "Selected-player return-date badge is missing")

    assert_true("grid-rows-[110px_1fr]" in intel, "League Intel report-height tune is missing")
    assert_true("grid-rows-[220px_1fr]" in intel, "League Intel lineup-height tune is missing")
    assert_true("grid-rows-[190px_1fr]" in intel, "League Intel status-height tune is missing")


if __name__ == "__main__":
    tests = [
        test_injury_context_active_and_returned,
        test_v11_source_guards,
    ]
    for test in tests:
        test()
        print(f"PASS {test.__name__}")
    print(f"V11 mood/UI regression passed: {len(tests)}/{len(tests)}")
