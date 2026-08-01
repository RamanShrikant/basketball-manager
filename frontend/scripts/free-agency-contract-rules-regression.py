#!/usr/bin/env python3
"""Regression checks for the surgical free-agency contract-rules patch.

These checks deliberately separate destination/interest scoring from the actual
signed contract. They verify salary floors/ceilings, years, raises, rights and
exception limits without changing the existing free-agency decision brain.
"""

from __future__ import annotations

import copy
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
PYTHON_DIR = ROOT / "public" / "python"
sys.path.insert(0, str(PYTHON_DIR))

import free_agency_logic as fa  # noqa: E402
import league_financials as lf  # noqa: E402


checks = 0


def check(condition, message):
    global checks
    checks += 1
    if not condition:
        raise AssertionError(message)


def player(name, age, pro_seasons, overall=80, potential=None, rights=None, previous_salary=10_000_000):
    return {
        "id": name.lower().replace(" ", "-"),
        "name": name,
        "age": age,
        "proSeasons": pro_seasons,
        "overall": overall,
        "potential": potential if potential is not None else overall,
        "position": "SF",
        "rights": rights or {},
        "previousContract": {
            "startYear": 2026,
            "salaryByYear": [previous_salary],
            "option": None,
        },
    }


def official_league():
    league = {
        "seasonYear": 2026,
        "currentSeasonYear": 2026,
        "currentFinancialSeasonYear": 2027,
        "financials": {
            "baseSeasonYear": 2027,
            "currentSeasonYear": 2027,
            "currentFinancialSeasonYear": 2027,
            "appliedThroughSeasonYear": 2027,
            "baseRules": copy.deepcopy(lf.OFFICIAL_2026_27_FINANCIAL_RULES),
        },
        "conferences": {
            "East": [
                {"name": "Home", "roster": []},
                {"name": "Away", "roster": []},
            ],
            "West": [],
        },
        "freeAgents": [],
    }
    return lf.ensure_league_financials(league)


league = official_league()
fa.sync_financial_constants(league)
rules_2027 = lf.get_financial_rules(league, 2027)

check(rules_2027["salaryCap"] == 164_961_000, "2026-27 salary cap must be synchronized.")
check(rules_2027["luxuryTaxLine"] == 200_428_000, "2026-27 luxury tax must be synchronized.")
check(rules_2027["firstApron"] == 209_015_000, "2026-27 first apron must be synchronized.")
check(rules_2027["secondApron"] == 221_686_000, "2026-27 second apron must be synchronized.")
check(rules_2027["nonTaxpayerMLE"] == 15_044_000, "2026-27 NTMLE must be synchronized.")
check(rules_2027["taxpayerMLE"] == 6_064_000, "2026-27 taxpayer MLE must be synchronized.")
check(rules_2027["roomException"] == 9_366_000, "2026-27 room MLE must be synchronized.")

rookie = player("Rookie Max", 22, 3)
prime = player("Prime Max", 28, 8)
veteran = player("Veteran Max", 34, 12)
check(fa.get_player_max_salary_percentage(rookie, league) == 0.25, "0-6 service years must use 25% max.")
check(fa.get_player_max_salary_percentage(prime, league) == 0.30, "7-9 service years must use 30% max.")
check(fa.get_player_max_salary_percentage(veteran, league) == 0.35, "10+ service years must use 35% max.")
check(fa.get_player_max_salary_amount(league, rookie) == 41_240_000, "25% max amount is incorrect.")
check(fa.get_player_max_salary_amount(league, prime) == 49_488_000, "30% max amount is incorrect.")
check(fa.get_player_max_salary_amount(league, veteran) == 57_736_000, "35% max amount is incorrect.")

minimum_expectations = {
    0: 1_300_000,
    1: 1_900_000,
    2: 2_200_000,
    4: 2_500_000,
    7: 2_900_000,
    12: 3_300_000,
}
for service, expected in minimum_expectations.items():
    p = player(f"Minimum {service}", 19 + service, service, overall=70)
    check(
        fa.get_player_minimum_salary_amount(league, p) == expected,
        f"Minimum scale is incorrect for {service} service years.",
    )

inflated = copy.deepcopy(league)
inflated["currentFinancialSeasonYear"] = 2028
inflated["financials"]["currentSeasonYear"] = 2028
inflated["financials"]["currentFinancialSeasonYear"] = 2028
inflated_rules = lf.get_financial_rules(inflated, 2028)
inflated = lf.normalize_financial_aliases(inflated, inflated_rules)
check(
    fa.get_player_minimum_salary_amount(inflated, veteran) > fa.get_player_minimum_salary_amount(league, veteran),
    "Minimum salary must rise with league inflation.",
)
check(
    fa.get_player_max_salary_amount(inflated, rookie) > fa.get_player_max_salary_amount(league, rookie),
    "Player max must rise with the salary cap.",
)

full_bird = player(
    "Full Bird",
    28,
    8,
    rights={"heldByTeam": "Home", "birdLevel": "bird", "seasonsTowardBird": 3},
    previous_salary=30_000_000,
)
early_bird = player(
    "Early Bird",
    26,
    5,
    rights={"heldByTeam": "Home", "birdLevel": "early_bird", "seasonsTowardBird": 2},
    previous_salary=8_000_000,
)
non_bird = player(
    "Non Bird",
    27,
    6,
    rights={"heldByTeam": "Home", "birdLevel": "non_bird", "seasonsTowardBird": 1},
    previous_salary=5_000_000,
)

path_cases = [
    (full_bird, "bird_rights", None, 1, 5, 0.08, "bird"),
    (early_bird, "bird_rights", None, 2, 4, 0.08, "early_bird"),
    (non_bird, "bird_rights", None, 1, 4, 0.05, "non_bird"),
    (rookie, "cap_space", None, 1, 4, 0.05, "cap_space"),
    (rookie, "cap_or_exception", "non_taxpayer_mle", 1, 4, 0.05, "non_taxpayer_mle"),
    (rookie, "cap_or_exception", "room_exception", 1, 3, 0.05, "room_exception"),
    (rookie, "cap_or_exception", "taxpayer_mle", 1, 2, 0.05, "taxpayer_mle"),
    (rookie, "minimum", None, 1, 2, 0.05, "minimum"),
]
for p, spending, exception, min_years, max_years, max_raise, expected_path in path_cases:
    resolved = fa.get_free_agent_contract_path_limits(p, spending, exception)
    check(resolved["path"] == expected_path, f"Wrong path for {expected_path}.")
    check(resolved["minYears"] == min_years, f"Wrong minimum years for {expected_path}.")
    check(resolved["maxYears"] == max_years, f"Wrong maximum years for {expected_path}.")
    check(resolved["maxRaisePct"] == max_raise, f"Wrong raise limit for {expected_path}.")

linear = fa.build_legal_salary_by_year(10_000_000, 4, 0.08)
check(linear == [10_000_000, 10_800_000, 11_600_000, 12_400_000], "Raises must be based on first-year salary.")

bird_actual = fa.shape_cpu_contract_for_spending_path(
    league,
    full_bird,
    "Home",
    {"startYear": 2027, "salaryByYear": [30_000_000, 31_500_000, 33_075_000, 34_729_000]},
    "bird_rights",
    None,
    fa.get_player_max_salary_amount(league, full_bird),
)
check(len(bird_actual["salaryByYear"]) == 5, "Full Bird four-year decision offer must sign as five actual years.")
check(bird_actual["salaryByYear"][:3] == [30_000_000, 32_400_000, 34_800_000], "Full Bird actual deal must use 8% linear raises.")

bird_decision = fa.build_decision_contract_from_actual(league, bird_actual, full_bird)
check(len(bird_decision["salaryByYear"]) == 4, "Fifth Bird year must not enter decision comparison.")
check(bird_decision["salaryByYear"] == [30_000_000, 31_500_000, 33_075_000, 34_729_000], "Bird decision contract must preserve legacy 5% comparison.")

base_actual = {"startYear": 2027, "salaryByYear": [30_000_000, 31_500_000, 33_075_000, 34_729_000]}
base_record = fa.build_offer_record(league, "Home", full_bird, base_actual, "cpu", 1, decision_contract=bird_decision)
bird_record = fa.build_offer_record(league, "Home", full_bird, bird_actual, "cpu", 1, decision_contract=bird_decision)
check(base_record["decisionAAV"] == bird_record["decisionAAV"], "Fifth year/8% raises must not increase decision AAV.")
check(base_record["decisionTotalValue"] == bird_record["decisionTotalValue"], "Fifth year/8% raises must not increase decision total.")

league_for_score = copy.deepcopy(league)
league_for_score["conferences"]["East"][0]["roster"] = [
    player("Home Starter", 27, 7, overall=82),
    player("Home Guard", 26, 6, overall=79),
]
full_bird["marketValue"] = fa.estimate_market_value(full_bird, league_for_score)
score_before = fa.score_offer_for_player(league_for_score, full_bird, base_record)
score_after = fa.score_offer_for_player(league_for_score, full_bird, bird_record)
check(score_before == score_after, "Actual fifth year/raise must not change player destination score.")

rookie_max = fa.get_player_max_salary_amount(league, rookie)
actual_max = {"startYear": 2027, "salaryByYear": fa.build_legal_salary_by_year(rookie_max, 4, 0.05)}
decision_max = fa.build_decision_contract_from_actual(league, actual_max, rookie)
check(decision_max["salaryByYear"][0] == fa.MAX_SALARY, "25% legal max must retain old max decision strength.")

vet_min = fa.get_player_minimum_salary_amount(league, veteran)
actual_min = {"startYear": 2027, "salaryByYear": [vet_min]}
decision_min = fa.build_decision_contract_from_actual(league, actual_min, veteran)
check(decision_min["salaryByYear"][0] == fa.MIN_DEAL, "Higher veteran minimum must retain old minimum decision strength.")

market_low = fa.estimate_market_value(player("Low Vet", 34, 12, overall=72), league)
check(market_low["contractExpectedYear1Salary"] >= 3_300_000, "Public AAV must rise to player minimum when needed.")
check(market_low["expectedYear1Salary"] == fa.MIN_DEAL, "Minimum lift must not alter decision market curve.")

market_young_star = fa.estimate_market_value(player("Young Star", 24, 5, overall=95, potential=97), league)
check(market_young_star["contractExpectedYear1Salary"] <= fa.get_player_max_salary_amount(league, player("Young Star", 24, 5, overall=95, potential=97)), "Public AAV must respect player max.")
check(market_young_star["expectedYear1Salary"] == fa.MAX_SALARY, "Lower 25% max must not weaken decision market curve.")

for path_name, spending, exception, years in [
    ("taxpayer", "cap_or_exception", "taxpayer_mle", 3),
    ("room", "cap_or_exception", "room_exception", 4),
    ("minimum", "minimum", None, 3),
    ("outside", "cap_space", None, 5),
]:
    invalid = {"startYear": 2027, "salaryByYear": fa.build_legal_salary_by_year(5_000_000, years, 0.05)}
    result = fa.validate_contract_shape_for_path(league, rookie, invalid, spending, exception)
    check(not result["ok"], f"Illegal {path_name} contract length must be rejected.")

valid_early = {"startYear": 2027, "salaryByYear": fa.build_legal_salary_by_year(10_000_000, 2, 0.08)}
check(fa.validate_contract_shape_for_path(league, early_bird, valid_early, "bird_rights", None)["ok"], "Legal Early Bird deal should pass.")
invalid_early_one = {"startYear": 2027, "salaryByYear": [10_000_000]}
check(not fa.validate_contract_shape_for_path(league, early_bird, invalid_early_one, "bird_rights", None)["ok"], "One-year Early Bird deal must fail.")

pre_sim_league = copy.deepcopy(league)
pre_sim_league["seasonYear"] = 2027
pre_sim_league["currentSeasonYear"] = 2027
pre_sim_young_star = player("Pre Sim Young Star", 24, 5, overall=95, potential=97)
pre_sim_young_star["marketValue"] = fa.estimate_market_value(pre_sim_young_star, pre_sim_league)
pre_sim_contract, pre_sim_capacity, pre_sim_spending = fa._build_pre_sim_one_year_offer(
    pre_sim_league,
    "Away",
    pre_sim_young_star,
    2027,
)
check(pre_sim_contract is not None and pre_sim_spending.get("ok"), "Pre-simulation legal shaping must still produce a contract.")
check(pre_sim_contract["salaryByYear"][0] == fa.get_player_max_salary_amount(pre_sim_league, pre_sim_young_star), "Pre-simulation actual contract must respect the 25% max.")
check(pre_sim_capacity.get("decisionYearOneSalary") == fa.MAX_SALARY, "Pre-simulation destination money ranking must retain the legacy max value.")


# User-offer salary universe behavior: above a retained-rights ceiling should
# route through cap space when cap room exists, and should return a clear blocker
# when it does not. This preserves the broad slider while submit remains strict.
non_bird_player = player(
    "Non Bird Cap Space",
    25,
    5,
    rights={"heldByTeam": "Home", "birdLevel": "non_bird", "seasonsTowardBird": 1},
    previous_salary=8_000_000,
)
non_bird_player["contract"] = {"startYear": 2026, "salaryByYear": [8_000_000]}
cap_space_contract = {"startYear": 2027, "salaryByYear": fa.build_legal_salary_by_year(30_000_000, 4, 0.05)}
cap_space_eval_league = copy.deepcopy(league)
cap_space_eval_league["freeAgencyState"] = {"isActive": True}
cap_space_eval_league["freeAgents"] = [copy.deepcopy(non_bird_player)]
cap_space_eval = fa.validate_offer_spending_rules(cap_space_eval_league, "Home", non_bird_player, cap_space_contract)
check(cap_space_eval.get("ok"), "Above Non-Bird ceiling should be legal through cap space when room exists.")
check(cap_space_eval.get("spendingType") == "cap_space", "Above Non-Bird ceiling should be classified as cap space.")
check(cap_space_eval.get("rightsCeiling") == 9_600_000, "Non-Bird rights ceiling should still be reported.")

blocked_eval_league = copy.deepcopy(league)
blocked_eval_league["freeAgencyState"] = {"isActive": True}
blocked_eval_league["conferences"]["East"][0]["players"] = [
    {"id": "salary", "name": "Salary", "contract": {"startYear": 2027, "salaryByYear": [150_000_000]}}
]
blocked_eval_league["conferences"]["East"][0]["roster"] = blocked_eval_league["conferences"]["East"][0]["players"]
blocked_eval_league["freeAgents"] = [copy.deepcopy(non_bird_player)]
blocked_eval = fa.validate_offer_spending_rules(blocked_eval_league, "Home", non_bird_player, cap_space_contract)
check(not blocked_eval.get("ok"), "Above Non-Bird ceiling should still be blocked without cap room.")
check(blocked_eval.get("spendingType") == "bird_rights_or_cap_room_blocked", "Blocker should explain rights/cap-room failure.")

cleanup_player = player("Cleanup Veteran", 35, 12, overall=72)
cleanup_player["contract"] = {"startYear": 2027, "salaryByYear": [fa.MIN_DEAL]}
check(fa.get_player_minimum_salary_amount(league, cleanup_player) == 3_300_000, "Cleanup path must use experience-based veteran minimums.")

print(json.dumps({
    "status": "PASS",
    "checks": checks,
    "salaryCap": rules_2027["salaryCap"],
    "maxTiers": {
        "25pct": fa.get_player_max_salary_amount(league, rookie),
        "30pct": fa.get_player_max_salary_amount(league, prime),
        "35pct": fa.get_player_max_salary_amount(league, veteran),
    },
    "fullBirdActualYears": len(bird_actual["salaryByYear"]),
    "fullBirdDecisionYears": len(bird_decision["salaryByYear"]),
    "destinationScorePreserved": score_before == score_after,
}, indent=2))
