"""
trade_negotiation_logic.py

Main CPU trade brain for Basketball Manager.

React/Pyodide public entry points:
- evaluate_trade_json(proposal_json): used by Trade Builder.
- find_trade_offers_json(search_json): used by Trade Finder.

This file coordinates:
- trade_value_model.py = how players/picks/packages are valued
- trade_team_ai.py = how teams view themselves and what they prefer

It does NOT mutate league data. Trade execution stays in React/JS.
"""

from __future__ import annotations

import itertools
import json
import math
from typing import Any, Dict, List, Tuple

from trade_team_ai import get_team_preferences, infer_team_phase, normalize_name
from trade_value_model import (
    candidate_assets_for_team,
    items_to_package,
    package_value,
    player_overall,
    player_salary,
)


# -----------------------------------------------------------------------------
# Main negotiation knobs your friend can tune
# -----------------------------------------------------------------------------

NEGOTIATION_KNOBS: Dict[str, float] = {
    "acceptScore": 6.0,
    "counterScore": -6.0,
    "softRejectCounterFloor": -20.0,
    "counterExtraAsk": 4.0,
    "rejectExtraAsk": 8.0,
    "maxFinderOfferAssets": 4.0,
    "finderTopCandidates": 14.0,
    "finderMaxOffers": 30.0,
    "finderAcceptedScoreTarget": 7.0,
}

STAR_EXIT_PENALTIES: Dict[str, float] = {
    "superstar": 28.0,  # 92+
    "allStar": 17.0,    # 88-91
    "youngPremium": 9.0, # 84+ and 25 or younger
}

DEPTH_PACKAGE_PENALTIES: Dict[str, float] = {
    "premiumForDepth": 10.0,
    "superstarForLesserBest": 15.0,
}

SALARY_BALANCE_PENALTIES: List[Tuple[float, float, str]] = [
    (1.35, 0.0, "Salary balance looks reasonable."),
    (1.75, 4.0, "Salary balance is a little uncomfortable."),
    (2.50, 10.0, "Salary balance is difficult."),
    (999.0, 18.0, "Salary balance is too uneven."),
]


# -----------------------------------------------------------------------------
# Safe helpers
# -----------------------------------------------------------------------------


def _num(value: Any, default: float = 0.0) -> float:
    try:
        n = float(value)
        if math.isfinite(n):
            return n
    except Exception:
        pass
    return default


def _str(value: Any, default: str = "") -> str:
    if value is None:
        return default
    return str(value)


def _team_name(team: Dict[str, Any] | str) -> str:
    if isinstance(team, dict):
        return _str(team.get("name") or team.get("teamName"), "")
    return _str(team, "")


def _same_team(a: Any, b: Any) -> bool:
    return normalize_name(a) == normalize_name(b)


def _players_from_package(package: Dict[str, Any]) -> List[Dict[str, Any]]:
    players = package.get("players") if isinstance(package, dict) else []
    return players if isinstance(players, list) else []


def _find_team(teams: List[Dict[str, Any]], team_name: str) -> Dict[str, Any] | None:
    for team in teams:
        if isinstance(team, dict) and _same_team(team.get("name") or team.get("teamName"), team_name):
            return team
    return None


def _selected_items_to_package(selected_items: List[Dict[str, Any]]) -> Dict[str, Any]:
    return items_to_package(selected_items)


# -----------------------------------------------------------------------------
# Penalties and scoring
# -----------------------------------------------------------------------------


def _salary_match_penalty(cpu_receives_salary: float, cpu_sends_salary: float) -> Tuple[float, str]:
    """
    Light salary sanity check.

    This is intentionally NOT full NBA CBA matching yet. It only discourages
    extremely lopsided salaries while you build the rest of the trade system.
    """
    if cpu_sends_salary <= 0 and cpu_receives_salary <= 0:
        return 0.0, "No salary pressure."

    high = max(cpu_receives_salary, cpu_sends_salary)
    low = max(min(cpu_receives_salary, cpu_sends_salary), 1.0)
    ratio = high / low

    for max_ratio, penalty, reason in SALARY_BALANCE_PENALTIES:
        if ratio <= max_ratio:
            return penalty, reason

    return 18.0, "Salary balance is too uneven."


def _star_exit_penalty(cpu_sends: Dict[str, Any], cpu_preferences: Dict[str, Any]) -> float:
    players = _players_from_package(cpu_sends)
    star_retention = _num((cpu_preferences.get("preferences") or {}).get("starRetention"), 1.0)
    penalty = 0.0

    for player in players:
        if not isinstance(player, dict):
            continue
        overall = player_overall(player)
        age = _num(player.get("age"), 27.0)
        if overall >= 92:
            penalty += STAR_EXIT_PENALTIES["superstar"] * star_retention
        elif overall >= 88:
            penalty += STAR_EXIT_PENALTIES["allStar"] * star_retention
        elif overall >= 84 and age <= 25:
            penalty += STAR_EXIT_PENALTIES["youngPremium"] * star_retention

    return penalty


def _depth_package_penalty(cpu_receives: Dict[str, Any], cpu_sends: Dict[str, Any]) -> float:
    sends_players = _players_from_package(cpu_sends)
    receives_players = _players_from_package(cpu_receives)

    best_sent = max((player_overall(p) for p in sends_players if isinstance(p, dict)), default=0)
    best_received = max((player_overall(p) for p in receives_players if isinstance(p, dict)), default=0)

    if best_sent >= 86 and best_received <= best_sent - 7 and len(receives_players) >= 2:
        return DEPTH_PACKAGE_PENALTIES["premiumForDepth"]
    if best_sent >= 90 and best_received <= best_sent - 5:
        return DEPTH_PACKAGE_PENALTIES["superstarForLesserBest"]
    return 0.0


def score_trade_for_cpu(
    cpu_team_name: str,
    user_team_name: str,
    cpu_receives: Dict[str, Any],
    cpu_sends: Dict[str, Any],
    team_context: Dict[str, Any] | None = None,
    cpu_team: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    """Shared scoring engine used by both Trade Builder and Trade Finder."""
    cpu_preferences = get_team_preferences(cpu_team or cpu_team_name, team_context)
    cpu_phase = cpu_preferences["phase"]

    receives_eval = package_value(cpu_receives, cpu_preferences)
    sends_eval = package_value(cpu_sends, cpu_preferences)

    value_delta = receives_eval["totalValue"] - sends_eval["totalValue"]

    salary_penalty, salary_reason = _salary_match_penalty(
        receives_eval["salaryTotal"],
        sends_eval["salaryTotal"],
    )
    star_penalty = _star_exit_penalty(cpu_sends, cpu_preferences)
    depth_penalty = _depth_package_penalty(cpu_receives, cpu_sends)

    final_score = value_delta - salary_penalty - star_penalty - depth_penalty

    return {
        "score": round(final_score, 2),
        "rawValueDelta": round(value_delta, 2),
        "cpuTeam": cpu_team_name,
        "userTeam": user_team_name,
        "cpuPhase": cpu_phase,
        "cpuPreferences": cpu_preferences.get("preferences", {}),
        "cpuReceives": receives_eval,
        "cpuSends": sends_eval,
        "penalties": {
            "salary": round(salary_penalty, 2),
            "starExit": round(star_penalty, 2),
            "depthPackage": round(depth_penalty, 2),
        },
        "salaryReason": salary_reason,
    }


def decision_from_score(score: float) -> Tuple[str, bool]:
    if score >= NEGOTIATION_KNOBS["acceptScore"]:
        return "accept", True
    if score >= NEGOTIATION_KNOBS["counterScore"]:
        return "counter", False
    return "reject", False


# -----------------------------------------------------------------------------
# Trade Builder evaluation
# -----------------------------------------------------------------------------


def evaluate_trade(proposal: Dict[str, Any]) -> Dict[str, Any]:
    """Evaluate an exact trade from the CPU team's perspective."""
    if not isinstance(proposal, dict):
        return {
            "decision": "reject",
            "accepted": False,
            "score": -999,
            "message": "Invalid trade proposal.",
            "reasons": ["Proposal was not a dictionary/object."],
        }

    cpu_team_name = _str(proposal.get("cpuTeam"), "CPU Team")
    user_team_name = _str(proposal.get("userTeam"), "User Team")
    team_context = proposal.get("teamContext") if isinstance(proposal.get("teamContext"), dict) else {}
    cpu_receives = proposal.get("cpuReceives") if isinstance(proposal.get("cpuReceives"), dict) else {}
    cpu_sends = proposal.get("cpuSends") if isinstance(proposal.get("cpuSends"), dict) else {}
    cpu_team = proposal.get("cpuTeamObject") if isinstance(proposal.get("cpuTeamObject"), dict) else None

    scored = score_trade_for_cpu(
        cpu_team_name=cpu_team_name,
        user_team_name=user_team_name,
        cpu_receives=cpu_receives,
        cpu_sends=cpu_sends,
        team_context=team_context,
        cpu_team=cpu_team,
    )

    score = scored["score"]
    decision, accepted = decision_from_score(score)

    reasons: List[str] = []
    reasons.append(f"{cpu_team_name} phase: {scored['cpuPhase']}.")
    reasons.append(f"CPU receives value: {scored['cpuReceives']['totalValue']}.")
    reasons.append(f"CPU sends value: {scored['cpuSends']['totalValue']}.")
    reasons.append(scored["salaryReason"])

    if scored["penalties"]["starExit"] > 0:
        reasons.append("CPU is reluctant to move a star or premium young player.")
    if scored["penalties"]["depthPackage"] > 0:
        reasons.append("CPU dislikes turning a premium player into a lower-impact depth package.")

    if decision == "accept":
        message = f"{cpu_team_name} accepts the trade."
    elif decision == "counter":
        message = f"{cpu_team_name} is close, but wants a little more value."
    else:
        message = f"{cpu_team_name} rejects the trade."

    counter_suggestions = []
    if decision == "counter":
        missing_value = round(abs(score) + NEGOTIATION_KNOBS["counterExtraAsk"], 2)
        counter_suggestions.append(
            {
                "type": "add_value",
                "message": f"Add roughly {missing_value} points of value: a better pick, young prospect, or stronger rotation player.",
                "targetValue": missing_value,
            }
        )
    elif decision == "reject" and score > NEGOTIATION_KNOBS["softRejectCounterFloor"]:
        counter_suggestions.append(
            {
                "type": "major_add",
                "message": "CPU would need a clearly better asset or less outgoing value to continue talks.",
                "targetValue": round(abs(score) + NEGOTIATION_KNOBS["rejectExtraAsk"], 2),
            }
        )

    return {
        "decision": decision,
        "accepted": accepted,
        "score": score,
        "rawValueDelta": scored["rawValueDelta"],
        "cpuTeam": cpu_team_name,
        "userTeam": user_team_name,
        "cpuPhase": scored["cpuPhase"],
        "message": message,
        "reasons": reasons,
        "penalties": scored["penalties"],
        "cpuReceives": scored["cpuReceives"],
        "cpuSends": scored["cpuSends"],
        "counterSuggestions": counter_suggestions,
    }


def evaluate_trade_json(proposal_json: str) -> str:
    """JSON string entry point used by the JS worker for Trade Builder."""
    try:
        proposal = json.loads(proposal_json)
    except Exception as exc:
        return json.dumps(
            {
                "decision": "reject",
                "accepted": False,
                "score": -999,
                "message": "Invalid JSON trade proposal.",
                "reasons": [str(exc)],
            },
            separators=(",", ":"),
        )

    return json.dumps(evaluate_trade(proposal), separators=(",", ":"))


# -----------------------------------------------------------------------------
# Trade Finder using the same CPU scoring
# -----------------------------------------------------------------------------


def _asset_sort_identity(asset: Dict[str, Any]) -> str:
    if asset.get("type") == "player":
        p = asset.get("player") or {}
        return _str(p.get("id") or p.get("playerId") or p.get("name") or asset.get("label"), "")
    p = asset.get("pick") or {}
    return _str(p.get("id") or p.get("pickId") or asset.get("label"), "")


def _dedupe_combo_key(combo: Tuple[Dict[str, Any], ...]) -> str:
    parts = sorted([f"{a.get('type')}:{_asset_sort_identity(a)}" for a in combo])
    return "|".join(parts)


def _candidate_combos(candidates: List[Dict[str, Any]], max_assets: int) -> List[List[Dict[str, Any]]]:
    top_n = int(NEGOTIATION_KNOBS["finderTopCandidates"])
    limited = candidates[:top_n]
    combos: List[List[Dict[str, Any]]] = []
    seen = set()

    for size in range(1, max_assets + 1):
        for combo in itertools.combinations(limited, size):
            key = _dedupe_combo_key(combo)
            if key in seen:
                continue
            seen.add(key)
            combos.append(list(combo))

    return combos


def _offer_items_to_package(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    return items_to_package(items)


def build_best_offer_for_team(
    team: Dict[str, Any],
    selected_team_name: str,
    selected_package: Dict[str, Any],
    league_state: Dict[str, Any],
    team_context: Dict[str, Any],
) -> Dict[str, Any] | None:
    team_name = _team_name(team)
    if not team_name or _same_team(team_name, selected_team_name):
        return None

    prefs = get_team_preferences(team, team_context)
    candidates = candidate_assets_for_team(team, league_state, prefs)
    if not candidates:
        return None

    max_assets = int(NEGOTIATION_KNOBS["maxFinderOfferAssets"])
    combos = _candidate_combos(candidates, max_assets)

    best = None
    best_sort_key = None

    for combo in combos:
        cpu_receives = selected_package
        cpu_sends = _offer_items_to_package(combo)
        evaluation = evaluate_trade(
            {
                "userTeam": selected_team_name,
                "cpuTeam": team_name,
                "cpuTeamObject": team,
                "teamContext": team_context,
                "cpuReceives": cpu_receives,
                "cpuSends": cpu_sends,
            }
        )

        # Trade Finder should not show pure lowballs just because the CPU would accept them.
        # We prefer packages that are both CPU-acceptable and reasonably close to the
        # user's package value.
        decision = evaluation.get("decision")
        score = _num(evaluation.get("score"), -999)
        offer_value = _num((evaluation.get("cpuSends") or {}).get("totalValue"), 0.0)
        target_value = _num((evaluation.get("cpuReceives") or {}).get("totalValue"), 0.0)
        gap = offer_value - target_value

        value_ratio = offer_value / max(target_value, 1.0)

        # Trade Finder is an executable-offer screen, not a rumor board. Only
        # return packages the CPU already accepts and that are close enough in
        # value to avoid showing pure lowball theft offers. React still applies
        # final hard-cap, roster, pick-ownership, and player-ownership checks
        # before the offer is displayed or loaded into the builder.
        if decision != "accept" or not evaluation.get("accepted") or value_ratio < 0.82:
            continue

        # Sort priorities:
        # 1. Closest value gap.
        # 2. Then closest to the target accept score, so it does not overpay wildly.
        # 3. Then fewer assets.
        sort_key = (
            abs(gap),
            abs(score - NEGOTIATION_KNOBS["finderAcceptedScoreTarget"]),
            len(combo),
        )

        if best is None or sort_key < best_sort_key:
            best = {
                "team": team,
                "teamName": team_name,
                "offer": combo,
                "offerValue": round(offer_value, 2),
                "targetValue": round(target_value, 2),
                "gap": round(gap, 2),
                "quality": "Accepted Offer",
                "decision": evaluation.get("decision"),
                "accepted": True,
                "score": score,
                "evaluation": evaluation,
            }
            best_sort_key = sort_key

    return best


def find_trade_offers(search: Dict[str, Any]) -> Dict[str, Any]:
    """
    Trade Finder entry point.

    Input shape should include:
    {
      "selectedTeamName": "Boston Celtics",
      "selectedItems": [{type:"player", player:{...}}, {type:"pick", pick:{...}}],
      "teams": [...],
      "draftPicks": [...],
      "teamContext": {...},
      "maxOffers": 30
    }
    """
    if not isinstance(search, dict):
        return {"ok": False, "offers": [], "message": "Invalid Trade Finder search."}

    selected_team_name = _str(search.get("selectedTeamName") or search.get("userTeam") or "", "")
    selected_items = search.get("selectedItems") if isinstance(search.get("selectedItems"), list) else []
    teams = search.get("teams") if isinstance(search.get("teams"), list) else []
    team_context = search.get("teamContext") if isinstance(search.get("teamContext"), dict) else {}
    max_offers = int(_num(search.get("maxOffers"), NEGOTIATION_KNOBS["finderMaxOffers"]))

    league_state = {
        "draftPicks": search.get("draftPicks") if isinstance(search.get("draftPicks"), list) else [],
    }

    selected_package = _selected_items_to_package(selected_items)
    target_eval = package_value(selected_package, get_team_preferences(selected_team_name, team_context))

    if not selected_items or target_eval["totalValue"] <= 0:
        return {
            "ok": False,
            "offers": [],
            "message": "Add at least one player or pick before searching.",
            "targetValue": target_eval["totalValue"],
        }

    offers: List[Dict[str, Any]] = []
    for team in teams:
        if not isinstance(team, dict):
            continue
        offer = build_best_offer_for_team(
            team=team,
            selected_team_name=selected_team_name,
            selected_package=selected_package,
            league_state=league_state,
            team_context=team_context,
        )
        if offer:
            offers.append(offer)

    offers.sort(
        key=lambda row: (
            {"accept": 0, "counter": 1, "reject": 2}.get(row.get("decision"), 2),
            abs(_num(row.get("score"), -999) - NEGOTIATION_KNOBS["finderAcceptedScoreTarget"]),
            abs(_num(row.get("gap"), 0)),
        )
    )

    return {
        "ok": True,
        "selectedTeamName": selected_team_name,
        "targetValue": target_eval["totalValue"],
        "teamsChecked": max(0, len(teams) - 1),
        "offers": offers[:max_offers],
    }


def find_trade_offers_json(search_json: str) -> str:
    """JSON string entry point used by the JS worker for Trade Finder."""
    try:
        search = json.loads(search_json)
    except Exception as exc:
        return json.dumps(
            {
                "ok": False,
                "offers": [],
                "message": "Invalid JSON Trade Finder search.",
                "error": str(exc),
            },
            separators=(",", ":"),
        )

    return json.dumps(find_trade_offers(search), separators=(",", ":"))


# -----------------------------------------------------------------------------
# Local smoke test
# -----------------------------------------------------------------------------

if __name__ == "__main__":
    sample_player = {"name": "Good Starter", "pos": "SG", "overall": 82, "potential": 84, "age": 25, "contract": {"salaryByYear": [18000000]}}
    sample_star = {"name": "Aging Star", "pos": "SF", "overall": 86, "potential": 86, "age": 34, "contract": {"salaryByYear": [37000000]}}
    sample = {
        "userTeam": "Toronto Raptors",
        "cpuTeam": "Los Angeles Lakers",
        "teamContext": {"Los Angeles Lakers": {"wins": 48, "losses": 24, "phase": "contender"}},
        "cpuReceives": {"players": [sample_player], "picks": [{"year": 2028, "round": 1, "projectedRank": 19, "protection": "Top 5 Protected"}]},
        "cpuSends": {"players": [sample_star], "picks": []},
    }
    print(evaluate_trade_json(json.dumps(sample)))
