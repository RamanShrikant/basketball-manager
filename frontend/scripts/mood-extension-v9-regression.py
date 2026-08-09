from __future__ import annotations
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PYDIR = ROOT / "public" / "python"
sys.path.insert(0, str(PYDIR))

import player_mood_logic as mood
import contract_extension_logic as ext


def assert_true(condition, message):
    if not condition:
        raise AssertionError(message)


def make_player(name="Test Player", overall=80, potential=84, age=24):
    return {
        "id": name.lower().replace(" ", "-"),
        "name": name,
        "overall": overall,
        "potential": potential,
        "age": age,
        "pos": "G",
        "contract": {"startYear": 2026, "salaryByYear": [10_000_000, 11_000_000, 12_000_000]},
        "meta": {"yearsWithCurrentTeam": 2},
    }


def test_contextual_baseline_and_missing_stats():
    p = make_player()
    team = {"name": "Test Team", "wins": 0, "losses": 0, "players": [p]}
    league = {"seasonYear": 2026, "currentDate": "2026-10-20", "teams": [team]}
    result = mood.get_locker_room_moods(league, "Test Team")
    assert_true(result.get("ok"), "Locker Room endpoint failed")
    row = result["players"][0]
    assert_true(row.get("baseMood") == 65, f"Expected V9 baseMood 65, got {row.get('baseMood')}")
    assert_true(row.get("moodScore", 0) >= 50, "Missing early-season minutes/stats should not create fake misery")
    interest = row.get("extensionInterest") or {}
    assert_true(0 <= interest.get("score", -1) <= 100, "Extension interest score missing/out of range")
    assert_true("personalityType" in interest, "Extension personality type missing")


def test_interest_is_separate_from_mood():
    player = {"id": "p1", "name": "Player One"}
    high_mood_low_interest = {
        "__extensionMoodByPlayer": {
            "p1": {
                "moodScore": 86,
                "extensionInterestScore": 63,
                "extensionInterestWilling": False,
                "extensionInterestLabel": "Prefers to Wait",
            }
        }
    }
    reason = ext._extension_refusal_reason({}, {}, player, "veteran", high_mood_low_interest)
    assert_true(reason is not None, "A happy player with low extension interest should be allowed to prefer waiting")

    content_high_interest = {
        "__extensionMoodByPlayer": {
            "p1": {
                "moodScore": 68,
                "extensionInterestScore": 82,
                "extensionInterestWilling": True,
                "extensionInterestLabel": "Interested",
            }
        }
    }
    reason = ext._extension_refusal_reason({}, {}, player, "veteran", content_high_interest)
    assert_true(reason is None, "A merely content player with strong security/relationship interest should be able to extend")


def test_threshold_and_versions():
    assert_true("v9" in str(mood.MOOD_SYSTEM_VERSION).lower(), "Mood version was not upgraded to V9")
    assert_true("v9" in str(ext.EXTENSION_SYSTEM_VERSION).lower(), "Extension version was not upgraded to V9")
    assert_true(ext.EXTENSION_INTEREST_THRESHOLD == 70, "Extension interest threshold should be 70")


if __name__ == "__main__":
    tests = [
        test_contextual_baseline_and_missing_stats,
        test_interest_is_separate_from_mood,
        test_threshold_and_versions,
    ]
    for test in tests:
        test()
        print(f"PASS {test.__name__}")
    print(f"V9 mood/extension regression passed: {len(tests)}/{len(tests)}")
