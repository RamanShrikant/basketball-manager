from __future__ import annotations

import copy
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
PYTHON_DIR = ROOT / "public" / "python"
sys.path.insert(0, str(PYTHON_DIR))

from contract_extension_logic import handle_request  # noqa: E402
from free_agency_logic import build_contract_status_row  # noqa: E402


def fixture():
    return {
        "seasonYear": 2026,
        "seasonStartYear": 2026,
        "displaySeasonYear": 2027,
        "contractSeasonYear": 2026,
        "currentFinancialSeasonYear": 2026,
        "calendar": {
            "regularSeasonGameStart": "2026-10-21",
            "currentDate": "2026-10-10",
        },
        "salaryCap": 154_647_000,
        "maxSalary": 54_000_000,
        "firstApron": 195_945_000,
        "conferences": {
            "East": [
                {
                    "name": "Boston Celtics",
                    "players": [
                        {
                            "id": "rookie-star",
                            "name": "Rookie Star",
                            "age": 23,
                            "overall": 87,
                            "potential": 92,
                            "pos": "SG",
                            "contract": {
                                "startYear": 2023,
                                "salaryByYear": [8_000_000, 9_000_000, 10_000_000, 11_000_000],
                                "option": None,
                            },
                            "rights": {"rookieScale": True, "heldByTeam": "Boston Celtics"},
                            "meta": {
                                "draftRound": 1,
                                "draftYear": 2023,
                                "proSeasons": 3,
                                "yearsWithCurrentTeam": 3,
                            },
                            "history": {"transactions": []},
                        },
                        {
                            "id": "veteran",
                            "name": "Veteran Starter",
                            "age": 29,
                            "overall": 82,
                            "potential": 82,
                            "pos": "SF",
                            "contract": {
                                "startYear": 2024,
                                "salaryByYear": [18_000_000, 19_000_000, 20_000_000],
                                "option": None,
                            },
                            "rights": {},
                            "meta": {"proSeasons": 8, "yearsWithCurrentTeam": 2},
                            "history": {"transactions": []},
                        },
                    ],
                },
                {
                    "name": "New York Knicks",
                    "players": [
                        {
                            "id": "cpu-core",
                            "name": "CPU Core",
                            "age": 24,
                            "overall": 85,
                            "potential": 89,
                            "pos": "PF",
                            "contract": {
                                "startYear": 2023,
                                "salaryByYear": [7_000_000, 8_000_000, 9_000_000, 10_000_000],
                                "option": None,
                            },
                            "rights": {"rookieScale": True, "heldByTeam": "New York Knicks"},
                            "meta": {
                                "draftRound": 1,
                                "draftYear": 2023,
                                "proSeasons": 3,
                                "yearsWithCurrentTeam": 3,
                            },
                            "history": {"transactions": []},
                        }
                    ],
                },
            ],
            "West": [],
        },
        "freeAgents": [],
    }


def request(action, league, **payload):
    return handle_request({"action": action, "leagueData": league, "payload": payload})


def assert_true(value, message):
    if not value:
        raise AssertionError(message)


def main():
    league = fixture()
    untouched = copy.deepcopy(league)

    preview = request(
        "preview_contract_extensions",
        league,
        userTeamName="Boston Celtics",
        currentDate="2026-10-10",
    )
    assert_true(preview["ok"], "preview should succeed")
    assert_true(preview["summary"]["eligibleCount"] == 2, "rookie and veteran should be eligible")
    assert_true(league == untouched, "preview must be read-only")

    option_fixture = fixture()
    option_fixture["conferences"]["East"][0]["players"][1]["contract"]["option"] = {
        "type": "player",
        "yearIndices": [2],
        "picked": None,
    }
    option_preview = request(
        "preview_contract_extensions",
        option_fixture,
        userTeamName="Boston Celtics",
        currentDate="2026-10-10",
    )
    option_row = next(row for row in option_preview["players"] if row["playerId"] == "veteran")
    assert_true(not option_row["eligible"], "unresolved contract options must block extension negotiation")
    assert_true("option" in option_row["reason"].lower(), "option block must explain why negotiation is unavailable")

    rookie_row = next(row for row in preview["players"] if row["playerId"] == "rookie-star")
    lowball_offer = {
        "years": 1,
        "firstYearSalary": rookie_row["minFirstYearSalary"],
        "annualRaisePct": 0,
        "optionType": "team",
    }
    lowball_one = request(
        "submit_contract_extension_offer",
        league,
        userTeamName="Boston Celtics",
        playerId="rookie-star",
        currentDate="2026-10-10",
        offer=lowball_offer,
    )
    lowball_two = request(
        "submit_contract_extension_offer",
        league,
        userTeamName="Boston Celtics",
        playerId="rookie-star",
        currentDate="2026-10-10",
        offer=lowball_offer,
    )
    assert_true(lowball_one["decision"] == lowball_two["decision"], "the same exact offer must produce a deterministic player decision")
    assert_true(league == untouched, "offer evaluation must not mutate its input league")

    original_salaries = list(league["conferences"]["East"][0]["players"][0]["contract"]["salaryByYear"])
    accepted = request(
        "submit_contract_extension_offer",
        league,
        userTeamName="Boston Celtics",
        playerId="rookie-star",
        currentDate="2026-10-10",
        offer={
            "years": 5,
            "firstYearSalary": rookie_row["maxFirstYearSalary"],
            "annualRaisePct": 8,
            "optionType": "player",
        },
    )
    assert_true(accepted["ok"] and accepted["accepted"], "max rookie offer should be accepted")
    updated = accepted["leagueData"]
    player = updated["conferences"]["East"][0]["players"][0]
    contract = player["contract"]
    assert_true(contract["salaryByYear"][: len(original_salaries)] == original_salaries, "existing salaries must not change")
    assert_true(len(contract["salaryByYear"]) == len(original_salaries) + 5, "five extension years must append")
    assert_true(contract["extensionMeta"]["extensionStartYear"] == 2027, "extension must begin after old contract")
    assert_true(contract["option"]["yearIndices"] == [len(contract["salaryByYear"]) - 1], "option must attach to final extension year")
    assert_true(player["history"]["transactions"][-1]["type"] == "contract_extension", "player history must record extension")
    assert_true(updated["contractExtensionHistory"][-1]["playerId"] == "rookie-star", "league history must record extension")
    mood_rows = updated["playerMoodState"]["players"]["id:rookie-star"]["events"]
    assert_true(any(row.get("type") == "contract_extension" for row in mood_rows), "locker-room mood event must be stored")

    reextension_fixture = copy.deepcopy(updated)
    reextension_fixture.update({
        "seasonYear": 2031,
        "seasonStartYear": 2031,
        "displaySeasonYear": 2032,
        "contractSeasonYear": 2031,
        "currentFinancialSeasonYear": 2031,
    })
    reextension_fixture["calendar"] = {
        "regularSeasonGameStart": "2031-10-21",
        "currentDate": "2031-10-10",
    }
    reextension_fixture["conferences"]["East"][0]["players"][0]["contract"]["option"] = None
    reextension_preview = request(
        "preview_contract_extensions",
        reextension_fixture,
        userTeamName="Boston Celtics",
        currentDate="2031-10-10",
    )
    reextension_row = next(row for row in reextension_preview["players"] if row["playerId"] == "rookie-star")
    assert_true(reextension_row["eligible"], "an extended player may become extension-eligible again near the new deal's end")
    assert_true(reextension_row["extensionType"] == "veteran", "a completed rookie extension must never be treated as another rookie-scale extension")

    team = updated["conferences"]["East"][0]
    offseason_status = build_contract_status_row(team, player, 2026, updated)
    assert_true(offseason_status["status"] == "signed", "extended player must not enter free agency at old expiry")
    assert_true(offseason_status["salaryThisYear"] > 0, "extension salary must be visible to existing FA expiry logic")

    cpu_first = request(
        "process_cpu_contract_extensions",
        league,
        userTeamName="Boston Celtics",
        phase="deadline",
        currentDate="2026-10-20",
    )
    assert_true(cpu_first["ok"], "CPU pass should succeed")
    assert_true(cpu_first["summary"]["extensionsSigned"] >= 1, "CPU core player should extend")
    cpu_again = request(
        "process_cpu_contract_extensions",
        cpu_first["leagueData"],
        userTeamName="Boston Celtics",
        phase="deadline",
        currentDate="2026-10-20",
    )
    assert_true(cpu_again["alreadyProcessed"], "CPU deadline pass must be idempotent")
    late_opening = request(
        "process_cpu_contract_extensions",
        cpu_first["leagueData"],
        userTeamName="Boston Celtics",
        phase="opening",
        currentDate="2026-10-20",
    )
    assert_true(late_opening.get("skipped"), "the opening CPU pass must not run after the final deadline pass")
    assert_true(late_opening["summary"]["extensionsSigned"] == 0, "late opening processing must not create extra extensions")

    closed = request(
        "close_contract_extension_window",
        updated,
        userTeamName="Boston Celtics",
        currentDate="2026-10-20",
    )
    assert_true(closed["ok"] and closed["state"]["closed"], "deadline close should persist")
    closed_preview = request(
        "preview_contract_extensions",
        closed["leagueData"],
        userTeamName="Boston Celtics",
        currentDate="2026-10-21",
    )
    assert_true(not closed_preview["state"]["isOpen"], "closed window must remain locked")

    next_season = copy.deepcopy(closed["leagueData"])
    next_season.update({
        "seasonYear": 2027,
        "seasonStartYear": 2027,
        "displaySeasonYear": 2028,
        "contractSeasonYear": 2027,
        "currentFinancialSeasonYear": 2027,
    })
    next_season["calendar"] = {
        "regularSeasonGameStart": "2027-10-21",
        "currentDate": "2027-10-01",
    }
    next_preview = request(
        "preview_contract_extensions",
        next_season,
        userTeamName="Boston Celtics",
        currentDate="2027-10-01",
    )
    assert_true(next_preview["state"]["seasonYear"] == 2027, "extension state must migrate to the new season")
    assert_true(next_preview["state"]["isOpen"], "a prior season deadline lock must not carry into the next season")
    assert_true(not next_preview["state"]["cpuPhasesProcessed"], "CPU extension phase markers must reset each season")

    output = {
        "status": "PASS",
        "checks": 29,
        "userExtensionYears": contract["extensionMeta"]["extensionYears"],
        "cpuExtensionsSigned": cpu_first["summary"]["extensionsSigned"],
        "freeAgencyStatusAfterExtension": offseason_status["status"],
    }
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
