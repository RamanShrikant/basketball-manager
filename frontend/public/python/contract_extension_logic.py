"""Integrated contract-extension engine for Basketball Manager.

Public actions:
- preview_contract_extensions
- submit_contract_extension_offer
- process_cpu_contract_extensions
- close_contract_extension_window

The engine appends extension seasons to the canonical contract.salaryByYear
array so existing salary-table, cap, trade, option, and free-agency code keeps
one source of truth.
"""
from __future__ import annotations

import copy
import json
import math
from typing import Any, Dict, Iterable, List, Optional, Tuple

from contract_extension_acceptance import evaluate_extension_offer
from cpu_contract_extensions import build_cpu_extension_offer

try:
    from league_financials import get_financial_rules
except Exception:  # pragma: no cover
    get_financial_rules = None

try:
    from free_agency_logic import estimate_market_value
except Exception:  # pragma: no cover
    estimate_market_value = None

EXTENSION_SYSTEM_VERSION = "2026-07-31_contract_extensions_v1"


def _num(value: Any, fallback: float = 0.0) -> float:
    try:
        if value is None or value == "":
            return float(fallback)
        n = float(value)
        return n if math.isfinite(n) else float(fallback)
    except Exception:
        return float(fallback)


def _int(value: Any, fallback: int = 0) -> int:
    return int(round(_num(value, fallback)))


def _round_money(value: float) -> int:
    return int(round(float(value or 0) / 1000.0) * 1000)


def _norm(value: Any) -> str:
    return "".join(ch.lower() for ch in str(value or "") if ch.isalnum())


def _player_key(player: Dict[str, Any]) -> str:
    pid = player.get("id") or player.get("playerId") or player.get("uuid")
    return f"id:{pid}" if pid not in [None, ""] else f"name:{player.get('name') or ''}"


def _season_start_year(league_data: Dict[str, Any]) -> int:
    return _int(
        league_data.get("seasonStartYear")
        or league_data.get("seasonYear")
        or league_data.get("currentSeasonYear"),
        2026,
    )


def _contract_season_year(league_data: Dict[str, Any]) -> int:
    explicit = (
        league_data.get("contractSeasonYear")
        or league_data.get("payrollSeasonYear")
        or league_data.get("currentPayrollSeasonYear")
        or league_data.get("salarySeasonYear")
    )
    if explicit:
        return _int(explicit, _season_start_year(league_data))

    season = _season_start_year(league_data)
    starts: List[int] = []
    for _, _, team in _iter_teams(league_data):
        for player in team.get("players", []) or []:
            contract = player.get("contract") if isinstance(player.get("contract"), dict) else {}
            salaries = contract.get("salaryByYear") if isinstance(contract.get("salaryByYear"), list) else []
            if salaries:
                starts.append(_int(contract.get("startYear"), season))
    if starts:
        mode = max(set(starts), key=starts.count)
        if starts.count(mode) / len(starts) >= 0.55 and mode == season:
            return season
    return season + 1


def _display_year(league_data: Dict[str, Any]) -> int:
    return _int(league_data.get("displaySeasonYear") or league_data.get("seasonEndYear"), _season_start_year(league_data) + 1)


def _date_add_days(date_str: str, delta: int) -> str:
    try:
        import datetime as dt
        d = dt.date.fromisoformat(str(date_str))
        return (d + dt.timedelta(days=delta)).isoformat()
    except Exception:
        return str(date_str or "")


def _deadline_date(league_data: Dict[str, Any]) -> str:
    calendar = league_data.get("calendar") if isinstance(league_data.get("calendar"), dict) else {}
    explicit = calendar.get("contractExtensionDeadlineDate") or calendar.get("extensionDeadlineDate")
    if explicit:
        return str(explicit)
    game_start = str(calendar.get("regularSeasonGameStart") or f"{_season_start_year(league_data)}-10-21")
    return _date_add_days(game_start, -1)


def _current_date(league_data: Dict[str, Any], payload: Optional[Dict[str, Any]] = None) -> str:
    payload = payload or {}
    calendar = league_data.get("calendar") if isinstance(league_data.get("calendar"), dict) else {}
    return str(
        payload.get("currentDate")
        or league_data.get("currentDate")
        or league_data.get("calendarDate")
        or calendar.get("currentDate")
        or calendar.get("cursorDate")
        or f"{_season_start_year(league_data)}-10-01"
    )


def _iter_teams(league_data: Dict[str, Any]) -> Iterable[Tuple[Optional[str], int, Dict[str, Any]]]:
    if isinstance(league_data.get("teams"), list):
        for idx, team in enumerate(league_data.get("teams") or []):
            if isinstance(team, dict):
                yield None, idx, team
        return
    conferences = league_data.get("conferences") if isinstance(league_data.get("conferences"), dict) else {}
    for conference, rows in conferences.items():
        if not isinstance(rows, list):
            continue
        for idx, team in enumerate(rows):
            if isinstance(team, dict):
                yield str(conference), idx, team


def _find_team(league_data: Dict[str, Any], team_name: str) -> Optional[Dict[str, Any]]:
    target = _norm(team_name)
    for _, _, team in _iter_teams(league_data):
        if _norm(team.get("name") or team.get("teamName")) == target:
            return team
    return None


def _find_player(team: Dict[str, Any], player_ref: Any) -> Optional[Dict[str, Any]]:
    target = _norm(player_ref)
    for player in team.get("players", []) or []:
        keys = [player.get("id"), player.get("playerId"), player.get("name")]
        if any(_norm(value) == target for value in keys if value not in [None, ""]):
            return player
    return None


def _normalize_contract(player: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    contract = player.get("contract") if isinstance(player.get("contract"), dict) else None
    if not contract:
        return None
    salaries = contract.get("salaryByYear") if isinstance(contract.get("salaryByYear"), list) else []
    salaries = [_int(value, 0) for value in salaries]
    if not salaries or not any(value > 0 for value in salaries):
        return None
    return {
        **contract,
        "startYear": _int(contract.get("startYear"), 2026),
        "salaryByYear": salaries,
    }


def _option_is_unresolved(contract: Dict[str, Any], current_year: int) -> bool:
    option = contract.get("option") if isinstance(contract.get("option"), dict) else None
    if not option:
        return False
    raw_indices = option.get("yearIndices") if isinstance(option.get("yearIndices"), list) else [option.get("yearIndex")]
    indices = [_int(value, -1) for value in raw_indices if value not in [None, ""]]
    picked = option.get("picked")
    for idx in indices:
        if idx < 0:
            continue
        absolute_year = _int(contract.get("startYear"), current_year) + idx
        if absolute_year < current_year:
            continue
        if isinstance(picked, dict):
            value = picked.get(str(idx), picked.get("default"))
        else:
            value = picked
        if value is None:
            return True
    return False


def _market_value(player: Dict[str, Any]) -> Dict[str, Any]:
    existing = player.get("marketValue") if isinstance(player.get("marketValue"), dict) else None
    if existing:
        return existing
    if estimate_market_value is not None:
        try:
            row = estimate_market_value(player)
            if isinstance(row, dict):
                return row
        except Exception:
            pass
    overall = _num(player.get("overall"), 70)
    potential = _num(player.get("potential"), overall)
    first = max(1_500_000, (overall - 58) * 1_050_000 + max(0, potential - overall) * 400_000)
    return {
        "expectedYears": 3,
        "expectedYear1Salary": _round_money(first),
        "expectedAAV": _round_money(first * 1.05),
        "minAcceptableAAV": _round_money(first * 0.84),
    }


def _financial_rules(league_data: Dict[str, Any], season_year: int) -> Dict[str, Any]:
    if get_financial_rules is not None:
        try:
            row = get_financial_rules(league_data, season_year)
            if isinstance(row, dict):
                return row
        except Exception:
            pass
    cap = _int(league_data.get("salaryCap") or league_data.get("capLimit"), 154_647_000)
    return {
        "salaryCap": cap,
        "minimumSalary": _int(league_data.get("minimumSalary"), 1_200_000),
        "maxSalary": _int(league_data.get("maxSalary") or league_data.get("maxContract"), cap * 0.35),
        "firstApron": _int(league_data.get("firstApron") or league_data.get("apron1"), cap * 1.27),
    }


def _extension_state(league_data: Dict[str, Any], payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    season_year = _season_start_year(league_data)
    state = league_data.get("contractExtensionState") if isinstance(league_data.get("contractExtensionState"), dict) else {}
    if _int(state.get("seasonYear"), 0) != season_year:
        state = {}
    deadline = _deadline_date(league_data)
    current = _current_date(league_data, payload)
    closed = bool(state.get("closed"))
    return {
        "version": EXTENSION_SYSTEM_VERSION,
        "seasonYear": season_year,
        "deadlineDate": deadline,
        "currentDate": current,
        "isOpen": bool(not closed and (not current or not deadline or current <= deadline)),
        "closed": closed,
        "closedDate": state.get("closedDate"),
        "cpuPhasesProcessed": list(state.get("cpuPhasesProcessed") or []),
        "transactions": list(state.get("transactions") or []),
        "negotiations": list(state.get("negotiations") or []),
    }


def build_extension_eligibility(
    league_data: Dict[str, Any],
    team: Dict[str, Any],
    player: Dict[str, Any],
    payload: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    state = _extension_state(league_data, payload)
    contract = _normalize_contract(player)
    current_year = _contract_season_year(league_data)
    market = _market_value(player)
    base = {
        "playerId": player.get("id"),
        "playerName": player.get("name"),
        "teamName": team.get("name"),
        "age": _int(player.get("age"), 0),
        "overall": _int(player.get("overall"), 0),
        "potential": _int(player.get("potential"), player.get("overall") or 0),
        "position": player.get("pos"),
        "eligible": False,
        "extensionType": None,
        "reason": "Not extension eligible.",
        "currentContract": contract,
        "marketValue": market,
        "deadlineDate": state["deadlineDate"],
        "windowOpen": state["isOpen"],
    }

    if not state["isOpen"]:
        base["reason"] = "The Contract Extension Deadline has passed."
        return base
    if not contract:
        base["reason"] = "A signed standard NBA contract is required."
        return base
    if str(player.get("contractType") or player.get("rosterStatus") or contract.get("type") or "standard").lower() in {"two_way", "two-way", "stash"}:
        base["reason"] = "Two-way and stashed players cannot sign standard extensions."
        return base

    salaries = contract["salaryByYear"]
    start_year = _int(contract.get("startYear"), current_year)
    last_year = start_year + len(salaries) - 1
    remaining_years = max(0, last_year - current_year + 1)
    base.update({
        "currentContractSeasonYear": current_year,
        "remainingContractYears": remaining_years,
        "currentContractEndYear": last_year,
    })

    if _option_is_unresolved(contract, current_year):
        base["reason"] = "An unresolved player or team option must be decided first."
        return base
    if remaining_years <= 0:
        base["reason"] = "The contract is expiring and must be handled through Free Agency."
        return base

    extensions = contract.get("extensions") if isinstance(contract.get("extensions"), list) else []
    latest_meta = contract.get("extensionMeta") if isinstance(contract.get("extensionMeta"), dict) else None
    if latest_meta or extensions:
        extension_start = _int((latest_meta or extensions[-1]).get("extensionStartYear"), 0)
        if extension_start > current_year:
            base["reason"] = "This player has already signed an extension."
            base["alreadyExtended"] = True
            return base

    rights = player.get("rights") if isinstance(player.get("rights"), dict) else {}
    meta = player.get("meta") if isinstance(player.get("meta"), dict) else {}
    draft_round = _int(meta.get("draftRound") or player.get("draftRound"), 0)
    has_prior_extension = bool(latest_meta or extensions)
    is_rookie_scale = bool(
        not has_prior_extension
        and (rights.get("rookieScale") or player.get("rookieScale") or contract.get("rookieScale"))
    )

    extension_type = None
    max_years = 0
    if is_rookie_scale and draft_round == 1:
        if remaining_years != 1:
            base["reason"] = "Rookie-scale extensions open when one guaranteed rookie-contract season remains."
            base["eligibleNextSeason"] = remaining_years == 2
            return base
        extension_type = "rookie_scale"
        max_years = 5
    else:
        original_term = _int(contract.get("originalTermYears"), len(salaries))
        if original_term < 3:
            base["reason"] = "The current contract is too short to extend."
            return base
        if remaining_years == 1:
            extension_type = "veteran"
        elif remaining_years == 2 and original_term >= 4:
            extension_type = "veteran"
        else:
            base["reason"] = "This veteran becomes eligible closer to the end of the current contract."
            base["eligibleNextSeason"] = remaining_years in {2, 3}
            return base
        max_years = max(1, min(4, 5 - remaining_years))

    extension_start_year = last_year + 1
    rules = _financial_rules(league_data, extension_start_year)
    salary_cap = _num(rules.get("salaryCap"), 154_647_000)
    pro_seasons = _int(meta.get("proSeasons"), max(0, _int(player.get("age"), 27) - 20))
    max_pct = 0.25 if pro_seasons <= 6 else 0.30 if pro_seasons <= 9 else 0.35
    experience_max = salary_cap * max_pct
    league_max = _num(rules.get("maxSalary"), experience_max)
    last_salary = _num(salaries[-1], 0)
    average_player_salary = salary_cap / 15.0
    if extension_type == "rookie_scale":
        ceiling = min(league_max, experience_max)
    else:
        ceiling = min(league_max, experience_max, max(last_salary * 1.40, average_player_salary * 1.40))
    minimum = max(_num(rules.get("minimumSalary"), 1_200_000), min(ceiling, _num(market.get("minAcceptableAAV"), ceiling * 0.60) * 0.82))
    recommended = min(ceiling, max(minimum, _num(market.get("expectedYear1Salary"), minimum)))

    base.update({
        "eligible": True,
        "extensionType": extension_type,
        "reason": "Eligible to negotiate a rookie-scale extension." if extension_type == "rookie_scale" else "Eligible to negotiate a veteran extension.",
        "remainingContractYears": remaining_years,
        "currentContractEndYear": last_year,
        "extensionStartYear": extension_start_year,
        "minYears": 1,
        "maxYears": max_years,
        "minFirstYearSalary": _round_money(minimum),
        "maxFirstYearSalary": _round_money(ceiling),
        "recommendedFirstYearSalary": _round_money(recommended),
        "maxAnnualRaisePct": 8.0,
        "salaryCapAtExtensionStart": _int(rules.get("salaryCap"), salary_cap),
        "firstApronAtExtensionStart": _int(rules.get("firstApron"), salary_cap * 1.27),
        "experienceMaxPct": max_pct,
    })

    preview_offer = {
        "years": min(max_years, max(1, _int(market.get("expectedYears"), 3))),
        "firstYearSalary": base["recommendedFirstYearSalary"],
        "annualRaisePct": 8.0,
        "salaryByYear": [base["recommendedFirstYearSalary"]],
        "optionType": "none",
        "extensionType": extension_type,
    }
    preview_offer["salaryByYear"] = [
        _round_money(preview_offer["firstYearSalary"] * (1.08 ** idx))
        for idx in range(preview_offer["years"])
    ]
    interest = evaluate_extension_offer(league_data, team, player, preview_offer, base)
    base["interestLabel"] = interest.get("interestLabel")
    base["interestPreview"] = interest
    return base


def _append_mood_event(
    league_data: Dict[str, Any],
    player: Dict[str, Any],
    event: Dict[str, Any],
) -> None:
    state = league_data.setdefault("playerMoodState", {})
    players_state = state.setdefault("players", {})
    keys = [_player_key(player), str(player.get("name") or ""), f"name:{player.get('name') or ''}", _norm(player.get("name"))]
    for key in keys:
        if not key:
            continue
        row = players_state.get(key) if isinstance(players_state.get(key), dict) else {}
        events = list(row.get("events") or row.get("eventLog") or [])
        by_id = {str(item.get("id")): item for item in events if isinstance(item, dict) and item.get("id")}
        by_id[str(event["id"])] = event
        players_state[key] = {**row, "events": list(by_id.values())[-80:]}


def _append_player_transaction(player: Dict[str, Any], row: Dict[str, Any]) -> None:
    history = player.setdefault("history", {})
    transactions = history.setdefault("transactions", [])
    tx_id = str(row.get("id") or "")
    transactions[:] = [item for item in transactions if str(item.get("id") or "") != tx_id]
    transactions.append(row)


def _apply_accepted_extension(
    league_data: Dict[str, Any],
    team: Dict[str, Any],
    player: Dict[str, Any],
    offer: Dict[str, Any],
    eligibility: Dict[str, Any],
    actor: str,
    current_date: str,
) -> Dict[str, Any]:
    contract = _normalize_contract(player)
    if not contract:
        raise ValueError("Player does not have a valid contract to extend.")

    extension_salaries = [_int(value, 0) for value in offer.get("salaryByYear", []) if _int(value, 0) > 0]
    if not extension_salaries:
        raise ValueError("Extension salary is missing.")

    original_salaries = list(contract["salaryByYear"])
    extension_start_year = _int(eligibility.get("extensionStartYear"), contract["startYear"] + len(original_salaries))
    expected_start = contract["startYear"] + len(original_salaries)
    if extension_start_year != expected_start:
        raise ValueError("Extension years must begin immediately after the existing contract.")

    extension_option = str(offer.get("optionType") or "none").lower()
    option = None
    if extension_option in {"player", "team"}:
        option_idx = len(original_salaries) + len(extension_salaries) - 1
        option = {"type": extension_option, "yearIndices": [option_idx], "picked": None}

    total_new_money = sum(extension_salaries)
    transaction_id = f"extension:{_season_start_year(league_data)}:{_norm(team.get('name'))}:{_norm(player.get('id') or player.get('name'))}"
    meta = {
        "id": transaction_id,
        "type": eligibility.get("extensionType"),
        "signedSeasonYear": _season_start_year(league_data),
        "signedDate": current_date,
        "originalEndYear": extension_start_year - 1,
        "extensionStartYear": extension_start_year,
        "extensionYears": len(extension_salaries),
        "extensionSalaryByYear": extension_salaries,
        "totalNewMoney": total_new_money,
        "optionType": extension_option,
        "actor": actor,
        "teamName": team.get("name"),
    }

    extensions = list(contract.get("extensions") or [])
    extensions = [row for row in extensions if str(row.get("id") or "") != transaction_id]
    extensions.append(meta)
    player["contract"] = {
        **contract,
        "salaryByYear": original_salaries + extension_salaries,
        "option": option,
        "signedSeasonYear": contract.get("signedSeasonYear") or _season_start_year(league_data),
        "originalTermYears": contract.get("originalTermYears") or len(original_salaries),
        "extensionMeta": meta,
        "extensions": extensions,
    }
    player["contractType"] = "extension"
    player["rosterStatus"] = player.get("rosterStatus") or "standard"

    display_year = _display_year(league_data)
    tx = {
        "id": transaction_id,
        "seasonYear": display_year,
        "date": current_date,
        "type": "contract_extension",
        "label": f"Signed a {len(extension_salaries)}-year, ${total_new_money:,} contract extension with {team.get('name')}",
        "teamName": team.get("name"),
        "toTeam": team.get("name"),
        "years": len(extension_salaries),
        "totalValue": total_new_money,
        "extensionStartYear": extension_start_year,
    }
    _append_player_transaction(player, tx)

    league_history = league_data.setdefault("contractExtensionHistory", [])
    league_history[:] = [row for row in league_history if str(row.get("id") or "") != transaction_id]
    league_history.append({
        **tx,
        "playerId": player.get("id"),
        "playerName": player.get("name"),
        "salaryByYear": extension_salaries,
        "actor": actor,
    })

    positive_impact = 9 if _int(player.get("overall"), 0) >= 84 else 7
    mood_event = {
        "id": transaction_id,
        "date": current_date,
        "category": "Future Security",
        "label": "Future Security",
        "headline": "The organization committed to his long-term future.",
        "text": "The organization committed to his long-term future.",
        "detail": f"{len(extension_salaries)} extension years and ${total_new_money:,} in new money.",
        "impact": positive_impact,
        "baseImpact": positive_impact,
        "decayPctPerWeek": 2.5,
        "type": "contract_extension",
        "duration": "long_term",
        "source": "contract_extension_system",
        "teamName": team.get("name"),
        "playerName": player.get("name"),
        "playerKey": _player_key(player),
    }
    _append_mood_event(league_data, player, mood_event)
    return {"transaction": tx, "extensionMeta": meta}


def _validate_offer(offer: Dict[str, Any], eligibility: Dict[str, Any]) -> Tuple[bool, str, Dict[str, Any]]:
    years = _int(offer.get("years"), 0)
    if years < _int(eligibility.get("minYears"), 1) or years > _int(eligibility.get("maxYears"), 1):
        return False, "The offered extension length is outside the legal range.", {}
    first = _int(offer.get("firstYearSalary"), 0)
    minimum = _int(eligibility.get("minFirstYearSalary"), 0)
    maximum = _int(eligibility.get("maxFirstYearSalary"), 0)
    if first < minimum or first > maximum:
        return False, "The first-year salary is outside the legal extension range.", {}
    raise_pct = _num(offer.get("annualRaisePct"), 0)
    if raise_pct < 0 or raise_pct > _num(eligibility.get("maxAnnualRaisePct"), 8):
        return False, "Annual raises must be between 0% and the legal maximum.", {}
    option_type = str(offer.get("optionType") or "none").lower()
    if option_type not in {"none", "player", "team"}:
        return False, "Unsupported option type.", {}
    salaries = [_round_money(first * ((1 + raise_pct / 100.0) ** idx)) for idx in range(years)]
    normalized = {
        "years": years,
        "firstYearSalary": salaries[0],
        "annualRaisePct": raise_pct,
        "salaryByYear": salaries,
        "optionType": option_type,
        "extensionType": eligibility.get("extensionType"),
    }
    return True, "", normalized


def preview_contract_extensions(
    league_data: Dict[str, Any],
    user_team_name: Optional[str] = None,
    payload: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    team = _find_team(league_data, user_team_name or "")
    if not team:
        return {"ok": False, "reason": "Selected team could not be found."}
    rows = [build_extension_eligibility(league_data, team, player, payload) for player in team.get("players", []) or []]
    rows.sort(key=lambda row: (not row.get("eligible"), -_num(row.get("overall"), 0), str(row.get("playerName") or "")))
    state = _extension_state(league_data, payload)
    return {
        "ok": True,
        "version": EXTENSION_SYSTEM_VERSION,
        "teamName": team.get("name"),
        "state": state,
        "summary": {
            "playerCount": len(rows),
            "eligibleCount": sum(1 for row in rows if row.get("eligible")),
            "rookieEligibleCount": sum(1 for row in rows if row.get("eligible") and row.get("extensionType") == "rookie_scale"),
            "veteranEligibleCount": sum(1 for row in rows if row.get("eligible") and row.get("extensionType") == "veteran"),
            "alreadyExtendedCount": sum(1 for row in rows if row.get("alreadyExtended")),
        },
        "players": rows,
        "leagueExtensionHistory": list(league_data.get("contractExtensionHistory") or [])[-80:],
    }


def submit_contract_extension_offer(
    league_data: Dict[str, Any],
    user_team_name: str,
    player_ref: Any,
    offer: Dict[str, Any],
    payload: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    updated = copy.deepcopy(league_data)
    team = _find_team(updated, user_team_name)
    if not team:
        return {"ok": False, "reason": "Selected team could not be found."}
    player = _find_player(team, player_ref)
    if not player:
        return {"ok": False, "reason": "Player could not be found on the selected team."}
    eligibility = build_extension_eligibility(updated, team, player, payload)
    if not eligibility.get("eligible"):
        return {"ok": False, "reason": eligibility.get("reason"), "eligibility": eligibility}

    valid, reason, normalized_offer = _validate_offer(offer or {}, eligibility)
    if not valid:
        return {"ok": False, "reason": reason, "eligibility": eligibility}

    decision = evaluate_extension_offer(updated, team, player, normalized_offer, eligibility)
    state = _extension_state(updated, payload)
    negotiation = {
        "id": f"negotiation:{state['seasonYear']}:{_norm(team.get('name'))}:{_norm(player.get('id') or player.get('name'))}:{len(state['negotiations']) + 1}",
        "date": state["currentDate"],
        "teamName": team.get("name"),
        "playerId": player.get("id"),
        "playerName": player.get("name"),
        "offer": normalized_offer,
        "accepted": bool(decision.get("accepted")),
        "decision": decision,
        "actor": "user",
    }
    state["negotiations"].append(negotiation)

    applied = None
    if decision.get("accepted"):
        applied = _apply_accepted_extension(updated, team, player, normalized_offer, eligibility, "user", state["currentDate"])
        state["transactions"].append(applied["transaction"])
    elif decision.get("valueRatio", 1) < 0.80:
        event = {
            "id": f"{negotiation['id']}:lowball",
            "date": state["currentDate"],
            "category": "Negotiation Frustration",
            "label": "Negotiation Frustration",
            "headline": "A substantially below-market extension offer hurt organizational trust.",
            "text": "A substantially below-market extension offer hurt organizational trust.",
            "detail": decision.get("reason"),
            "impact": -4,
            "baseImpact": -4,
            "decayPctPerWeek": 8,
            "type": "contract_negotiation",
            "duration": "temporary",
            "source": "contract_extension_system",
        }
        _append_mood_event(updated, player, event)

    updated["contractExtensionState"] = state
    return {
        "ok": True,
        "accepted": bool(decision.get("accepted")),
        "decision": decision,
        "offer": normalized_offer,
        "eligibility": eligibility,
        "transaction": applied.get("transaction") if applied else None,
        "leagueData": updated,
    }


def process_cpu_contract_extensions(
    league_data: Dict[str, Any],
    user_team_name: Optional[str] = None,
    phase: str = "opening",
    payload: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    updated = copy.deepcopy(league_data)
    state = _extension_state(updated, payload)
    phase_key = f"{state['seasonYear']}:{phase}"
    if phase_key in state["cpuPhasesProcessed"]:
        updated["contractExtensionState"] = state
        return {"ok": True, "alreadyProcessed": True, "phase": phase, "results": [], "leagueData": updated}

    deadline_key = f"{state['seasonYear']}:deadline"
    if phase == "opening" and (
        deadline_key in state["cpuPhasesProcessed"]
        or (
            state.get("currentDate")
            and state.get("deadlineDate")
            and state["currentDate"] >= state["deadlineDate"]
        )
    ):
        state["cpuPhasesProcessed"].append(phase_key)
        updated["contractExtensionState"] = state
        return {
            "ok": True,
            "alreadyProcessed": False,
            "skipped": True,
            "skipReason": "The opening CPU pass cannot run on or after the deadline.",
            "phase": phase,
            "summary": {"offersMade": 0, "extensionsSigned": 0},
            "results": [],
            "leagueData": updated,
        }

    results = []
    for _, _, team in _iter_teams(updated):
        if user_team_name and _norm(team.get("name")) == _norm(user_team_name):
            continue
        for player in list(team.get("players", []) or []):
            eligibility = build_extension_eligibility(updated, team, player, payload)
            if not eligibility.get("eligible"):
                continue
            cpu = build_cpu_extension_offer(updated, team, player, eligibility, phase=phase)
            if not cpu:
                continue
            offer = cpu.get("offer") or {}
            decision = cpu.get("decision") or {}
            result = {
                "teamName": team.get("name"),
                "playerId": player.get("id"),
                "playerName": player.get("name"),
                "offer": offer,
                "decision": decision,
                "coreScore": cpu.get("coreScore"),
                "accepted": bool(decision.get("accepted")),
            }
            state["negotiations"].append({
                "id": f"cpu-negotiation:{phase_key}:{_norm(team.get('name'))}:{_norm(player.get('id') or player.get('name'))}",
                "date": state["currentDate"],
                "actor": "cpu",
                **result,
            })
            if decision.get("accepted"):
                applied = _apply_accepted_extension(updated, team, player, offer, eligibility, "cpu", state["currentDate"])
                state["transactions"].append(applied["transaction"])
                result["transaction"] = applied["transaction"]
            results.append(result)

    state["cpuPhasesProcessed"].append(phase_key)
    updated["contractExtensionState"] = state
    return {
        "ok": True,
        "phase": phase,
        "alreadyProcessed": False,
        "summary": {
            "offersMade": len(results),
            "extensionsSigned": sum(1 for row in results if row.get("accepted")),
        },
        "results": results,
        "leagueData": updated,
    }


def close_contract_extension_window(
    league_data: Dict[str, Any],
    user_team_name: Optional[str] = None,
    payload: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    cpu_result = process_cpu_contract_extensions(league_data, user_team_name, phase="deadline", payload=payload)
    updated = cpu_result.get("leagueData") if isinstance(cpu_result.get("leagueData"), dict) else copy.deepcopy(league_data)
    state = _extension_state(updated, payload)
    state["closed"] = True
    state["isOpen"] = False
    state["closedDate"] = state["currentDate"] or state["deadlineDate"]
    updated["contractExtensionState"] = state
    return {
        "ok": True,
        "cpuResult": {key: value for key, value in cpu_result.items() if key != "leagueData"},
        "state": state,
        "leagueData": updated,
    }


def handle_request(request: Dict[str, Any]) -> Dict[str, Any]:
    request = request or {}
    action = str(request.get("action") or "")
    league_data = request.get("leagueData") if isinstance(request.get("leagueData"), dict) else {}
    payload = request.get("payload") if isinstance(request.get("payload"), dict) else {}
    user_team_name = payload.get("userTeamName") or request.get("userTeamName")

    if action == "preview_contract_extensions":
        return preview_contract_extensions(league_data, user_team_name, payload)
    if action == "submit_contract_extension_offer":
        return submit_contract_extension_offer(
            league_data,
            str(user_team_name or ""),
            payload.get("playerId") or payload.get("playerName"),
            payload.get("offer") if isinstance(payload.get("offer"), dict) else {},
            payload,
        )
    if action == "process_cpu_contract_extensions":
        return process_cpu_contract_extensions(
            league_data,
            user_team_name,
            str(payload.get("phase") or "opening"),
            payload,
        )
    if action == "close_contract_extension_window":
        return close_contract_extension_window(league_data, user_team_name, payload)
    return {"ok": False, "reason": f"Unknown contract extension action: {action}"}


def handle_request_json(raw: str) -> str:
    try:
        return json.dumps(handle_request(json.loads(raw or "{}")))
    except Exception as exc:
        return json.dumps({"ok": False, "reason": str(exc)})
