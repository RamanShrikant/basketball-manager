from __future__ import annotations
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PYDIR = ROOT / "public" / "python"
sys.path.insert(0, str(PYDIR))

import player_mood_logic as mood
import contract_extension_logic as ext
import cpu_contract_extensions as cpu


def assert_true(condition, message):
    if not condition:
        raise AssertionError(message)


def personality(**overrides):
    row = {
        "loyalty": 55,
        "ambition": 55,
        "winningSensitivity": 55,
        "roleSensitivity": 55,
    }
    row.update(overrides)
    return row


def interest(player, mood_score, relationship, role, team_score, career, rookie=False, years=1, p=None):
    return mood._v9_extension_interest(
        {"leagueId": "v10-regression"},
        {"name": "Test Team"},
        player,
        mood_score,
        p or personality(),
        relationship,
        role,
        team_score,
        career,
        player.get("contract") or {},
        years,
        rookie,
    )


def test_selective_interest_distribution():
    buried_young = {
        "id": "buried-young",
        "name": "Buried Young",
        "overall": 80,
        "potential": 87,
        "age": 22,
        "contract": {"startYear": 2026, "salaryByYear": [7_400_000]},
    }
    bad = interest(buried_young, 63, 3, -15, 3, 7.4, rookie=True, years=1)
    assert_true(bad["score"] < 70 and not bad["willing"], f"Buried young player should be able to refuse; got {bad}")

    supported_young = dict(buried_young)
    supported_young["id"] = "supported-young"
    good = interest(supported_young, 79, 5, 6, 5, 6, rookie=True, years=1)
    assert_true(good["score"] >= 70 and good["willing"], f"Happy core youngster should still be able to extend; got {good}")

    ordinary_vet = {
        "id": "ordinary-vet",
        "name": "Ordinary Vet",
        "overall": 74,
        "potential": 76,
        "age": 27,
        "contract": {"startYear": 2026, "salaryByYear": [4_000_000]},
    }
    wait = interest(ordinary_vet, 64, 1, -5, 1, 1, rookie=False, years=1)
    assert_true(wait["score"] < 70, f"Ordinary legal veteran should not automatically want an extension; got {wait}")


def test_mood_and_interest_remain_separate():
    star = {
        "id": "happy-market-star",
        "name": "Happy Market Star",
        "overall": 95,
        "potential": 96,
        "age": 27,
        "contract": {"startYear": 2026, "salaryByYear": [48_000_000]},
    }
    result = interest(star, 82, 0, 0, 0, 0, rookie=False, years=1, p=personality(ambition=72))
    assert_true(result["score"] < 70, f"A happy high-leverage star must be able to prefer the market; got {result}")

    security_vet = {
        "id": "security-vet",
        "name": "Security Vet",
        "overall": 79,
        "potential": 79,
        "age": 32,
        "contract": {"startYear": 2026, "salaryByYear": [10_000_000]},
    }
    result2 = interest(security_vet, 69, 6, 4, 3, 2, rookie=False, years=1, p=personality(loyalty=72, ambition=42))
    assert_true(result2["score"] >= 70, f"A content security/loyalty-oriented veteran should sometimes extend; got {result2}")


def test_cpu_first_apron_is_pressure_not_blanket_ban():
    player = {
        "id": "core-rookie",
        "name": "Core Rookie",
        "overall": 82,
        "potential": 91,
        "age": 22,
        "meta": {"yearsWithCurrentTeam": 3},
        "contract": {"startYear": 2026, "salaryByYear": [8_000_000]},
    }
    teammate = {
        "id": "salary-anchor",
        "name": "Salary Anchor",
        "overall": 80,
        "potential": 80,
        "age": 28,
        "contract": {"startYear": 2027, "salaryByYear": [198_000_000]},
    }
    team = {"name": "Test Team", "players": [player, teammate]}
    package = {
        "packageId": "ask:5",
        "askPackageId": "ask:5",
        "years": 5,
        "firstYearSalary": 18_000_000,
        "annualRaisePct": 8.0,
        "salaryByYear": [18_000_000, 19_440_000, 20_995_000, 22_675_000, 24_489_000],
        "optionType": "none",
        "aav": 21_120_000,
        "marketAAV": 21_000_000,
        "valueRatio": 1.006,
    }
    eligibility = {
        "eligible": True,
        "extensionType": "rookie_scale",
        "extensionStartYear": 2027,
        "salaryCapAtExtensionStart": 160_000_000,
        "firstApronAtExtensionStart": 196_000_000,
        "askPackages": [package],
        "marketValue": {"expectedAAV": 21_000_000},
    }
    decision = cpu.cpu_extension_offer_diagnostic({}, team, player, eligibility, "rookie_deadline")
    assert_true(decision["approved"], f"Core rookie should not be blanket-blocked just because payroll is over first apron; got {decision}")


def test_versions_and_persistence_hooks():
    assert_true("v10" in str(mood.MOOD_SYSTEM_VERSION).lower(), "Mood version is not V10")
    assert_true("v10" in str(ext.EXTENSION_SYSTEM_VERSION).lower(), "Extension version is not V10")
    calendar = (ROOT / "src" / "pages" / "Calendar.jsx").read_text(encoding="utf-8")
    history = (ROOT / "src" / "pages" / "LeagueHistory.jsx").read_text(encoding="utf-8")
    extensions_ui = (ROOT / "src" / "pages" / "ContractExtensions.jsx").read_text(encoding="utf-8")
    assert_true("contractExtensionResumeToken" in calendar, "Fresh-render Calendar extension resume hook is missing")
    assert_true("setContractExtensionResumeToken((value) => value + 1)" in calendar, "Deadline continue still resumes from stale render")
    assert_true("contractExtensionState?.transactions" in history, "Extension History defensive fallback is missing")
    assert_true("buildExtensionMoodLeague" in extensions_ui, "Contract Extensions is not using the same stored gameplan context as Locker Room")


if __name__ == "__main__":
    tests = [
        test_selective_interest_distribution,
        test_mood_and_interest_remain_separate,
        test_cpu_first_apron_is_pressure_not_blanket_ban,
        test_versions_and_persistence_hooks,
    ]
    for test in tests:
        test()
        print(f"PASS {test.__name__}")
    print(f"V10 mood/extension regression passed: {len(tests)}/{len(tests)}")
