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
    from free_agency_logic import estimate_market_value, classify_team_direction
except Exception:  # pragma: no cover
    estimate_market_value = None
    classify_team_direction = None

try:
    from player_mood_logic import get_locker_room_moods
except Exception:  # pragma: no cover
    get_locker_room_moods = None


# BM_PATCH42_EXTENSION_ECONOMY_IMPORT
try:
    from deflated_trade_scale import player_economic_overall, player_economic_potential
except Exception:  # pragma: no cover
    def player_economic_overall(player):
        try:
            return float(player.get("overall", player.get("ovr", 0)))
        except Exception:
            return 0.0

    def player_economic_potential(player):
        try:
            base = player_economic_overall(player)
            return max(base, float(player.get("potential", player.get("pot", base))))
        except Exception:
            return player_economic_overall(player)

EXTENSION_SYSTEM_VERSION = "2026-08-08_selective_interest_v10"
EXTENSION_HAPPY_MOOD_THRESHOLD = 76  # legacy compatibility only
EXTENSION_INTEREST_THRESHOLD = 70


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


def _stable_fraction(*parts: Any) -> float:
    raw = "|".join(str(part or "") for part in parts)
    import hashlib
    return int(hashlib.sha256(raw.encode("utf-8")).hexdigest()[:12], 16) / float(0xFFFFFFFFFFFF)


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
    # Contracts are keyed by season start year. Falling back to season + 1
    # skips the first salary slot and makes extensions/FA deals look short.
    return season


def _display_year(league_data: Dict[str, Any]) -> int:
    return _int(league_data.get("displaySeasonYear") or league_data.get("seasonEndYear"), _season_start_year(league_data) + 1)


def _date_add_days(date_str: str, delta: int) -> str:
    try:
        import datetime as dt
        d = dt.date.fromisoformat(str(date_str))
        return (d + dt.timedelta(days=delta)).isoformat()
    except Exception:
        return str(date_str or "")


def _valid_date_for_year(value: Any, expected_year: int) -> str:
    try:
        import datetime as dt
        text = str(value or "").strip()
        d = dt.date.fromisoformat(text)
        return text if d.year == int(expected_year) else ""
    except Exception:
        return ""


def _rookie_deadline_date(league_data: Dict[str, Any]) -> str:
    calendar = league_data.get("calendar") if isinstance(league_data.get("calendar"), dict) else {}
    season_year = _season_start_year(league_data)
    explicit = (
        _valid_date_for_year(calendar.get("rookieExtensionDeadlineDate"), season_year)
        or _valid_date_for_year(calendar.get("contractExtensionDeadlineDate"), season_year)
        or _valid_date_for_year(calendar.get("extensionDeadlineDate"), season_year)
    )
    if explicit:
        return str(explicit)
    game_start = _valid_date_for_year(calendar.get("regularSeasonGameStart"), season_year) or f"{season_year}-10-21"
    return _date_add_days(game_start, -1)


def _veteran_deadline_date(league_data: Dict[str, Any]) -> str:
    calendar = league_data.get("calendar") if isinstance(league_data.get("calendar"), dict) else {}
    display_year = _display_year(league_data)
    explicit = (
        _valid_date_for_year(calendar.get("veteranExtensionDeadlineDate"), display_year)
        or _valid_date_for_year(calendar.get("veteranContractExtensionDeadlineDate"), display_year)
    )
    if explicit:
        return str(explicit)
    return f"{display_year}-03-31"


def _deadline_date(league_data: Dict[str, Any]) -> str:
    # Backwards-compatible alias used by older callers and save data.
    return _rookie_deadline_date(league_data)


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
    rookie_deadline = _rookie_deadline_date(league_data)
    veteran_deadline = _veteran_deadline_date(league_data)
    current = _current_date(league_data, payload)
    legacy_closed = bool(state.get("closed"))
    closed_types = set(str(x) for x in (state.get("closedTypes") or []))
    if legacy_closed:
        closed_types.update(["rookie_scale", "veteran"])
    rookie_open = bool(not legacy_closed and "rookie_scale" not in closed_types and (not current or current <= rookie_deadline))
    veteran_open = bool(not legacy_closed and "veteran" not in closed_types and (not current or current <= veteran_deadline))
    return {
        "version": EXTENSION_SYSTEM_VERSION,
        "seasonYear": season_year,
        "deadlineDate": rookie_deadline,
        "rookieDeadlineDate": rookie_deadline,
        "veteranDeadlineDate": veteran_deadline,
        "currentDate": current,
        "isOpen": bool(rookie_open or veteran_open),
        "rookieWindowOpen": rookie_open,
        "veteranWindowOpen": veteran_open,
        "closed": legacy_closed,
        "closedTypes": sorted(closed_types),
        "closedDate": state.get("closedDate"),
        "cpuPhasesProcessed": list(state.get("cpuPhasesProcessed") or []),
        "transactions": list(state.get("transactions") or []),
        "negotiations": list(state.get("negotiations") or []),
        "lastCpuRun": state.get("lastCpuRun") if isinstance(state.get("lastCpuRun"), dict) else None,
        "cpuRunDiagnostics": list(state.get("cpuRunDiagnostics") or []),
    }


def _team_direction(league_data: Dict[str, Any], team: Dict[str, Any]) -> str:
    if classify_team_direction is not None:
        try:
            row = classify_team_direction(team, league_data=league_data)
            if isinstance(row, dict) and row.get("direction"):
                return str(row.get("direction")).lower()
        except Exception:
            pass
    wins = _num(team.get("wins") or team.get("recordWins"), 0)
    losses = _num(team.get("losses") or team.get("recordLosses"), 0)
    total = wins + losses
    if total >= 20:
        pct = wins / max(1.0, total)
        if pct >= 0.58:
            return "contender"
        if pct <= 0.36:
            return "rebuilding"
    return "balanced"


def _player_mood_value(player: Dict[str, Any]) -> float:
    # Legacy fallback only. Canonical extension decisions use Locker Room mood.
    mood = player.get("mood")
    if isinstance(mood, dict):
        return _num(mood.get("moodScore") or mood.get("value") or mood.get("score"), 50)
    if isinstance(mood, (int, float)):
        return _num(mood, 50)
    return 50.0


def _extension_mood_lookup_keys(player: Dict[str, Any]) -> List[str]:
    keys = []
    for value in [
        player.get("id"),
        player.get("playerId"),
        player.get("uuid"),
        player.get("name"),
        player.get("player"),
    ]:
        key = _norm(value)
        if key and key not in keys:
            keys.append(key)
    return keys


def _build_extension_mood_map(
    league_data: Dict[str, Any],
    team: Dict[str, Any],
    payload: Optional[Dict[str, Any]] = None,
) -> Dict[str, float]:
    # Compute the exact Locker Room mood snapshot once per team, then reuse it.
    if get_locker_room_moods is None:
        return {}

    try:
        payload = payload or {}
        current_date = _current_date(league_data, payload)
        calendar = league_data.get("calendar") if isinstance(league_data.get("calendar"), dict) else {}
        mood_league = {
            **league_data,
            "currentDate": current_date,
            "calendarDate": current_date,
            "calendar": {
                **calendar,
                "currentDate": current_date,
                "cursorDate": current_date,
            },
        }
        result = get_locker_room_moods(
            mood_league,
            team.get("name") or team.get("teamName"),
        )
        rows = result.get("players") if isinstance(result, dict) and isinstance(result.get("players"), list) else []
        mood_map: Dict[str, float] = {}
        for row in rows:
            if not isinstance(row, dict):
                continue
            raw_score = row.get("moodScore")
            if raw_score in [None, ""]:
                raw_score = row.get("score")
            score = _num(raw_score, -1)
            if score < 0:
                continue
            for value in [
                row.get("playerId"),
                row.get("id"),
                row.get("playerName"),
                row.get("name"),
                row.get("player"),
            ]:
                key = _norm(value)
                if key:
                    mood_map[key] = score
        return mood_map
    except Exception:
        return {}


def _canonical_extension_mood_value(
    player: Dict[str, Any],
    payload: Optional[Dict[str, Any]] = None,
) -> float:
    payload = payload or {}
    mood_map = payload.get("__extensionMoodByPlayer")
    if isinstance(mood_map, dict):
        for key in _extension_mood_lookup_keys(player):
            if key in mood_map:
                return _num(mood_map.get(key), 50)
    return _player_mood_value(player)


def _extension_refusal_reason(
    league_data: Dict[str, Any],
    team: Dict[str, Any],
    player: Dict[str, Any],
    extension_type: str,
    payload: Optional[Dict[str, Any]] = None,
) -> Optional[str]:
    mood = _canonical_extension_mood_value(player, payload)
    if mood < EXTENSION_HAPPY_MOOD_THRESHOLD:
        rounded = _int(mood, 50)
        return (
            f"Not interested in an extension right now — his Locker Room mood is "
            f"{rounded}. Players must be Happy ({EXTENSION_HAPPY_MOOD_THRESHOLD}+) "
            f"before committing to an extension."
        )
    return None


def _offer_aav(salaries: List[int]) -> int:
    return _round_money(sum(salaries) / max(1, len(salaries)))


def _build_extension_ask_packages(
    league_data: Dict[str, Any],
    team: Dict[str, Any],
    player: Dict[str, Any],
    eligibility: Dict[str, Any],
) -> List[Dict[str, Any]]:
    if not eligibility.get("eligible"):
        return []
    extension_type = str(eligibility.get("extensionType") or "veteran")
    market = eligibility.get("marketValue") if isinstance(eligibility.get("marketValue"), dict) else {}
    market_first = _num(market.get("expectedYear1Salary") or eligibility.get("recommendedFirstYearSalary"), eligibility.get("minFirstYearSalary"))
    market_aav = _num(market.get("expectedAAV") or market_first, market_first)
    min_first = _num(eligibility.get("minFirstYearSalary"), 1_200_000)
    max_first = _num(eligibility.get("maxFirstYearSalary"), market_first)
    min_years = max(1, _int(eligibility.get("minYears"), 1))
    max_years = max(min_years, _int(eligibility.get("maxYears"), min_years))
    overall = _num(player.get("overall"), 70)
    potential = _num(player.get("potential"), overall)
    econ_overall = _num(player_economic_overall(player), overall)
    econ_potential = max(econ_overall, _num(player_economic_potential(player), potential))
    age = _num(player.get("age"), 27)
    direction = _team_direction(league_data, team)

    preferred_years = [5, 4, 3, 2, 1]
    legal_years = [year for year in preferred_years if min_years <= year <= max_years]
    if not legal_years:
        legal_years = [max_years]
    legal_years = legal_years[:3]

    if extension_type == "rookie_scale":
        base_premium = 1.035
        if econ_potential >= 90 or econ_overall >= 86:
            base_premium += 0.025
        if potential - overall >= 7:
            base_premium += 0.015
        raise_pct = 8.0
    else:
        base_premium = 1.02 if direction in {"contender", "title_contender", "win_now"} else 1.06
        if direction in {"retooling", "retool"}:
            base_premium += 0.025
        if direction in {"rebuilding", "rebuild"}:
            base_premium += 0.055
        if age >= 32:
            base_premium += 0.02
        raise_pct = 8.0 if econ_overall >= 82 else 5.0

    packages: List[Dict[str, Any]] = []
    seen = set()
    for year in legal_years:
        shorter_premium = max(0, max_years - year) * (0.035 if extension_type == "rookie_scale" else 0.045)
        desired_first = market_first * (base_premium + shorter_premium)
        # High-end players should naturally hit the cap/max clamp instead of overflowing legal limits.
        if econ_overall >= 90 or (extension_type == "rookie_scale" and econ_potential >= 92):
            desired_first = max(desired_first, max_first * 0.985)
        first = _round_money(max(min_first, min(max_first, desired_first)))
        salaries = [_round_money(first * ((1 + raise_pct / 100.0) ** idx)) for idx in range(year)]
        if not salaries or (year, salaries[0]) in seen:
            continue
        seen.add((year, salaries[0]))
        option_type = "none"
        if (econ_overall >= 88 or econ_potential >= 91) and year >= 4:
            option_type = "player"
        total = sum(salaries)
        aav = _offer_aav(salaries)
        if year >= 5:
            label = "Long-term security"
        elif year >= 4:
            label = "Balanced commitment"
        elif year == 3:
            label = "Short-term premium"
        elif year == 2:
            label = "Bridge premium"
        else:
            label = "Prove-it premium"
        packages.append({
            "packageId": f"ask:{year}:{salaries[0]}",
            "askPackageId": f"ask:{year}:{salaries[0]}",
            "label": label,
            "years": year,
            "firstYearSalary": salaries[0],
            "annualRaisePct": raise_pct,
            "salaryByYear": salaries,
            "optionType": option_type,
            "extensionType": extension_type,
            "totalValue": total,
            "aav": aav,
            "marketAAV": _round_money(market_aav),
            "valueRatio": round(aav / max(1.0, market_aav), 4),
            "playerAsk": True,
            "pitch": "Player's preferred structure based on market value, role, age, and team direction.",
        })
    return packages


def _phase_allowed_extension_type(phase: str, extension_type: str, current_date: str, state: Dict[str, Any]) -> bool:
    phase = str(phase or "opening").lower()
    if phase in {"rookie_deadline", "rookie", "opening"}:
        return extension_type == "rookie_scale"
    if phase in {"veteran_deadline", "veteran"}:
        return extension_type == "veteran"
    if phase == "deadline":
        # Legacy caller: before opening night this is the rookie deadline; after that it is the veteran deadline.
        return extension_type == ("rookie_scale" if current_date <= state.get("rookieDeadlineDate", "9999-12-31") else "veteran")
    return True


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
        "rookieDeadlineDate": state["rookieDeadlineDate"],
        "veteranDeadlineDate": state["veteranDeadlineDate"],
        "windowOpen": state["isOpen"],
        "askPackages": [],
    }

    if not state["isOpen"]:
        base["reason"] = "The contract extension windows have passed."
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
        explicit_original_term = (
            contract.get("originalTermYears")
            or contract.get("termYears")
            or contract.get("years")
            or meta.get("originalTermYears")
            or meta.get("contractYears")
        )
        original_term = _int(explicit_original_term, 0)
        if original_term <= 0:
            # The shipped roster stores many active veteran deals as remaining years only.
            # Infer enough original term for end-of-contract veteran extension rules instead
            # of treating every expiring veteran as a fake one-year contract.
            original_term = 4 if remaining_years == 2 else 3 if remaining_years == 1 else len(salaries)
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

    deadline_for_type = state["rookieDeadlineDate"] if extension_type == "rookie_scale" else state["veteranDeadlineDate"]
    closed_types = set(state.get("closedTypes") or [])
    if extension_type in closed_types:
        base["reason"] = "This extension window is closed for the season."
        base["deadlineDate"] = deadline_for_type
        base["deadlineType"] = "rookie" if extension_type == "rookie_scale" else "veteran"
        return base
    if state.get("currentDate") and deadline_for_type and state["currentDate"] > deadline_for_type:
        base["reason"] = "The Rookie Extension Deadline has passed." if extension_type == "rookie_scale" else "The Veteran Extension Deadline has passed."
        base["deadlineDate"] = deadline_for_type
        base["deadlineType"] = "rookie" if extension_type == "rookie_scale" else "veteran"
        return base

    mood_payload = dict(payload or {})
    if not isinstance(mood_payload.get("__extensionMoodByPlayer"), dict):
        mood_payload["__extensionMoodByPlayer"] = _build_extension_mood_map(league_data, team, mood_payload)
    sentiment = _canonical_extension_sentiment(player, mood_payload)
    extension_mood = _num(sentiment.get("moodScore"), 65)
    extension_interest = _num(sentiment.get("extensionInterestScore"), extension_mood)
    base["extensionMoodScore"] = _int(extension_mood, 65)
    base["extensionMoodRequired"] = None
    base["extensionMoodEligible"] = bool(extension_mood >= 72)
    base["extensionInterestScore"] = _int(extension_interest, 65)
    base["extensionInterestRequired"] = EXTENSION_INTEREST_THRESHOLD
    base["extensionInterestEligible"] = bool(sentiment.get("extensionInterestWilling", extension_interest >= EXTENSION_INTEREST_THRESHOLD))
    base["extensionInterestLabel"] = sentiment.get("extensionInterestLabel") or ("Interested" if extension_interest >= EXTENSION_INTEREST_THRESHOLD else "Prefers to Wait")
    base["extensionInterestReasons"] = list(sentiment.get("extensionInterestReasons") or [])
    base["extensionPersonalityType"] = sentiment.get("extensionPersonalityType") or "Flexible"

    refusal = _extension_refusal_reason(league_data, team, player, extension_type, mood_payload)
    if refusal:
        base.update({
            "extensionType": extension_type,
            "reason": refusal,
            "deadlineDate": deadline_for_type,
            "deadlineType": "rookie" if extension_type == "rookie_scale" else "veteran",
            "playerRefusesExtension": True,
        })
        return base

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
        "reason": "Eligible to choose a rookie-scale extension package." if extension_type == "rookie_scale" else "Eligible to choose a veteran extension package.",
        "remainingContractYears": remaining_years,
        "currentContractEndYear": last_year,
        "extensionStartYear": extension_start_year,
        "deadlineDate": deadline_for_type,
        "deadlineType": "rookie" if extension_type == "rookie_scale" else "veteran",
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

    ask_packages = _build_extension_ask_packages(league_data, team, player, base)
    base["askPackages"] = ask_packages
    if ask_packages:
        preferred = ask_packages[0]
        interest_label = base.get("extensionInterestLabel") or "Interested"
        base["interestLabel"] = interest_label
        base["interestPreview"] = {
            "accepted": True,
            "interestLabel": interest_label,
            "reason": f"Extension interest {base.get('extensionInterestScore', '—')}/100. Choose one of the packages his camp is already willing to sign.",
            "offerAAV": preferred.get("aav"),
            "marketAAV": preferred.get("marketAAV"),
            "valueRatio": preferred.get("valueRatio"),
            "marketValue": market,
        }
    else:
        base["eligible"] = False
        base["reason"] = "No legal extension package could be generated under the current contract limits."
        base["interestLabel"] = "No legal package"
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
    if eligibility.get("extensionType") == "rookie_scale":
        rights = player.setdefault("rights", {})
        if isinstance(rights, dict):
            rights["rookieScaleExtensionSigned"] = True
            rights["rookieScale"] = False
        player["rookieScale"] = False
        contract["rookieScale"] = False
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
    package_id = str(offer.get("askPackageId") or offer.get("packageId") or "")
    ask_packages = eligibility.get("askPackages") if isinstance(eligibility.get("askPackages"), list) else []
    if package_id:
        for package in ask_packages:
            if str(package.get("askPackageId") or package.get("packageId")) == package_id:
                normalized = {
                    "years": _int(package.get("years"), 0),
                    "firstYearSalary": _int(package.get("firstYearSalary"), 0),
                    "annualRaisePct": _num(package.get("annualRaisePct"), 0),
                    "salaryByYear": [_int(value, 0) for value in package.get("salaryByYear", [])],
                    "optionType": str(package.get("optionType") or "none").lower(),
                    "extensionType": eligibility.get("extensionType"),
                    "askPackageId": package_id,
                    "packageId": package_id,
                    "playerAsk": True,
                    "acceptedByPlayerAsk": True,
                    "label": package.get("label"),
                }
                if not normalized["salaryByYear"]:
                    return False, "The selected player-ask package is missing salary years.", {}
                return True, "", normalized
        return False, "That extension package is no longer available.", {}

    # Backwards compatibility for old saved UI/tests that still submit manual offers.
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
    mood_payload = dict(payload or {})
    mood_payload["__extensionMoodByPlayer"] = _build_extension_mood_map(league_data, team, mood_payload)
    rows = [build_extension_eligibility(league_data, team, player, mood_payload) for player in team.get("players", []) or []]
    rows.sort(key=lambda row: (not row.get("eligible"), -_num(row.get("overall"), 0), str(row.get("playerName") or "")))
    state = _extension_state(league_data, mood_payload)
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
    mood_payload = dict(payload or {})
    mood_payload["__extensionMoodByPlayer"] = _build_extension_mood_map(updated, team, mood_payload)
    eligibility = build_extension_eligibility(updated, team, player, mood_payload)
    if not eligibility.get("eligible"):
        return {"ok": False, "reason": eligibility.get("reason"), "eligibility": eligibility}

    valid, reason, normalized_offer = _validate_offer(offer or {}, eligibility)
    if not valid:
        return {"ok": False, "reason": reason, "eligibility": eligibility}

    if normalized_offer.get("acceptedByPlayerAsk"):
        salaries = normalized_offer.get("salaryByYear") or []
        aav = _offer_aav(salaries)
        market_aav = _round_money(_num((eligibility.get("marketValue") or {}).get("expectedAAV"), aav))
        decision = {
            "accepted": True,
            "score": 100,
            "threshold": 0,
            "interestLabel": "Accepted asking price",
            "reason": "The player signed because this matched one of his requested extension packages.",
            "offerAAV": aav,
            "marketAAV": market_aav,
            "valueRatio": round(aav / max(1.0, market_aav), 4),
            "marketValue": eligibility.get("marketValue"),
        }
    else:
        decision = evaluate_extension_offer(updated, team, player, normalized_offer, eligibility)
    state = _extension_state(updated, mood_payload)
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
        team_payload = dict(payload or {})
        team_payload["__extensionMoodByPlayer"] = _build_extension_mood_map(updated, team, team_payload)
        for player in list(team.get("players", []) or []):
            eligibility = build_extension_eligibility(updated, team, player, team_payload)
            if not eligibility.get("eligible"):
                continue
            if not _phase_allowed_extension_type(phase, str(eligibility.get("extensionType") or ""), state.get("currentDate") or "", state):
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
    payload = payload or {}
    phase = str(payload.get("phase") or "deadline")
    cpu_result = process_cpu_contract_extensions(league_data, user_team_name, phase=phase, payload=payload)
    updated = cpu_result.get("leagueData") if isinstance(cpu_result.get("leagueData"), dict) else copy.deepcopy(league_data)
    state = _extension_state(updated, payload)
    closed_types = set(state.get("closedTypes") or [])
    if phase in {"rookie_deadline", "rookie", "opening"}:
        closed_types.add("rookie_scale")
    elif phase in {"veteran_deadline", "veteran"}:
        closed_types.add("veteran")
    else:
        # Legacy close-callers used one all-season deadline and expect the entire
        # extension system to close. Calendar v2 passes rookie_deadline/veteran_deadline
        # explicitly, so this branch is only for backwards compatibility/tests.
        closed_types.update(["rookie_scale", "veteran"])
    state["closedTypes"] = sorted(closed_types)
    state["rookieWindowOpen"] = "rookie_scale" not in closed_types and state.get("currentDate", "") <= state.get("rookieDeadlineDate", "")
    state["veteranWindowOpen"] = "veteran" not in closed_types and state.get("currentDate", "") <= state.get("veteranDeadlineDate", "")
    state["isOpen"] = bool(state["rookieWindowOpen"] or state["veteranWindowOpen"])
    state["closed"] = not state["isOpen"]
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

# ============================================================================
# V9 EXTENSION SENTIMENT BRIDGE
# ============================================================================
# Contract extensions now consume Locker Room's extensionInterest result rather
# than treating a single mood threshold as the entire player decision.

def _build_extension_mood_map(
    league_data: Dict[str, Any],
    team: Dict[str, Any],
    payload: Optional[Dict[str, Any]] = None,
) -> Dict[str, Dict[str, Any]]:
    if get_locker_room_moods is None:
        return {}
    try:
        payload = payload or {}
        current_date = _current_date(league_data, payload)
        calendar = league_data.get("calendar") if isinstance(league_data.get("calendar"), dict) else {}
        mood_league = {
            **league_data,
            "currentDate": current_date,
            "calendarDate": current_date,
            "calendar": {**calendar, "currentDate": current_date, "cursorDate": current_date},
        }
        result = get_locker_room_moods(mood_league, team.get("name") or team.get("teamName"))
        rows = result.get("players") if isinstance(result, dict) and isinstance(result.get("players"), list) else []
        sentiment_map: Dict[str, Dict[str, Any]] = {}
        for row in rows:
            if not isinstance(row, dict):
                continue
            mood = _num(row.get("moodScore"), 65)
            interest = row.get("extensionInterest") if isinstance(row.get("extensionInterest"), dict) else {}
            interest_score = _num(interest.get("score"), mood)
            entry = {
                "moodScore": mood,
                "moodLabel": row.get("moodLabel"),
                "extensionInterestScore": interest_score,
                "extensionInterestLabel": interest.get("label") or ("Interested" if interest_score >= EXTENSION_INTEREST_THRESHOLD else "Prefers to Wait"),
                "extensionInterestWilling": bool(interest.get("willing", interest_score >= EXTENSION_INTEREST_THRESHOLD)),
                "extensionInterestThreshold": _int(interest.get("threshold"), EXTENSION_INTEREST_THRESHOLD),
                "extensionInterestReasons": list(interest.get("reasons") or []),
                "extensionPersonalityType": interest.get("personalityType") or "Flexible",
            }
            for value in [row.get("playerId"), row.get("id"), row.get("playerName"), row.get("name"), row.get("player")]:
                key = _norm(value)
                if key:
                    sentiment_map[key] = entry
        return sentiment_map
    except Exception:
        return {}


def _canonical_extension_sentiment(
    player: Dict[str, Any],
    payload: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    payload = payload or {}
    mood_map = payload.get("__extensionMoodByPlayer")
    if isinstance(mood_map, dict):
        for key in _extension_mood_lookup_keys(player):
            if key not in mood_map:
                continue
            raw = mood_map.get(key)
            if isinstance(raw, dict):
                mood = _num(raw.get("moodScore"), 65)
                score = _num(raw.get("extensionInterestScore"), mood)
                return {
                    **raw,
                    "moodScore": mood,
                    "extensionInterestScore": score,
                    "extensionInterestWilling": bool(raw.get("extensionInterestWilling", score >= EXTENSION_INTEREST_THRESHOLD)),
                    "extensionInterestThreshold": _int(raw.get("extensionInterestThreshold"), EXTENSION_INTEREST_THRESHOLD),
                }
            # Compatibility with V8 maps that stored mood as a plain number.
            mood = _num(raw, 65)
            return {
                "moodScore": mood,
                "extensionInterestScore": mood,
                "extensionInterestWilling": mood >= EXTENSION_INTEREST_THRESHOLD,
                "extensionInterestThreshold": EXTENSION_INTEREST_THRESHOLD,
                "extensionInterestLabel": "Interested" if mood >= EXTENSION_INTEREST_THRESHOLD else "Prefers to Wait",
                "extensionInterestReasons": [],
                "extensionPersonalityType": "Flexible",
            }
    mood = _player_mood_value(player)
    return {
        "moodScore": mood,
        "extensionInterestScore": mood,
        "extensionInterestWilling": mood >= EXTENSION_INTEREST_THRESHOLD,
        "extensionInterestThreshold": EXTENSION_INTEREST_THRESHOLD,
        "extensionInterestLabel": "Interested" if mood >= EXTENSION_INTEREST_THRESHOLD else "Prefers to Wait",
        "extensionInterestReasons": [],
        "extensionPersonalityType": "Flexible",
    }


def _canonical_extension_mood_value(player: Dict[str, Any], payload: Optional[Dict[str, Any]] = None) -> float:
    return _num(_canonical_extension_sentiment(player, payload).get("moodScore"), 65)


def _extension_refusal_reason(
    league_data: Dict[str, Any],
    team: Dict[str, Any],
    player: Dict[str, Any],
    extension_type: str,
    payload: Optional[Dict[str, Any]] = None,
) -> Optional[str]:
    sentiment = _canonical_extension_sentiment(player, payload)
    score = _int(sentiment.get("extensionInterestScore"), 65)
    mood = _int(sentiment.get("moodScore"), 65)
    willing = bool(sentiment.get("extensionInterestWilling", score >= EXTENSION_INTEREST_THRESHOLD))
    if willing and score >= EXTENSION_INTEREST_THRESHOLD:
        return None
    label = str(sentiment.get("extensionInterestLabel") or "Prefers to Wait")
    if mood >= 80:
        return (
            f"{label} — he is happy with the current situation (mood {mood}), but his extension interest is "
            f"{score}/100. He wants to preserve more future flexibility before committing long term."
        )
    return (
        f"{label} — extension interest is {score}/100 (needs {EXTENSION_INTEREST_THRESHOLD}+). "
        f"Current Locker Room mood is {mood}; role, security, team direction, franchise relationship, and free-agency leverage all affect this decision."
    )


# ============================================================================
# V10 CPU DEADLINE DIAGNOSTICS WRAPPER
# ============================================================================
# Keeps the proven V8/V9 extension execution path, while recording each gate so
# a future zero-extension season is immediately diagnosable instead of guessed.

_process_cpu_contract_extensions_v9 = process_cpu_contract_extensions


def _v10_scan_cpu_extension_gates(
    league_data: Dict[str, Any],
    user_team_name: Optional[str],
    phase: str,
    payload: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    from cpu_contract_extensions import cpu_extension_offer_diagnostic

    state = _extension_state(league_data, payload)
    current_date = state.get("currentDate") or _current_date(league_data, payload)
    user_key = _norm(user_team_name)
    diag = {
        "version": "v10",
        "seasonYear": state.get("seasonYear"),
        "phase": phase,
        "date": current_date,
        "teamsChecked": 0,
        "legalCandidates": 0,
        "playerWilling": 0,
        "playerRefused": 0,
        "teamApproved": 0,
        "teamValueRejected": 0,
        "payrollRejected": 0,
        "otherRejected": 0,
        "offersGenerated": 0,
        "signed": 0,
        "rejectionReasons": {},
    }

    for _, _, team in _iter_teams(league_data):
        team_name = team.get("name") or team.get("teamName") or ""
        if user_key and _norm(team_name) == user_key:
            continue
        diag["teamsChecked"] += 1
        mood_map = _build_extension_mood_map(league_data, team, payload)
        team_payload = dict(payload or {})
        team_payload["__extensionMoodByPlayer"] = mood_map

        for player in team.get("players", []) or []:
            eligibility = build_extension_eligibility(league_data, team, player, team_payload)
            extension_type = str(eligibility.get("extensionType") or "")
            if not extension_type:
                continue
            if not _phase_allowed_extension_type(phase, extension_type, current_date, state):
                continue

            if eligibility.get("playerRefusesExtension"):
                diag["legalCandidates"] += 1
                diag["playerRefused"] += 1
                reason = "player_interest_below_threshold"
                diag["rejectionReasons"][reason] = diag["rejectionReasons"].get(reason, 0) + 1
                continue

            if not eligibility.get("eligible"):
                continue

            diag["legalCandidates"] += 1
            diag["playerWilling"] += 1
            decision = cpu_extension_offer_diagnostic(league_data, team, player, eligibility, phase)
            if decision.get("approved"):
                diag["teamApproved"] += 1
                continue

            reason = str(decision.get("reason") or "unknown")
            diag["rejectionReasons"][reason] = diag["rejectionReasons"].get(reason, 0) + 1
            if reason.startswith("payroll"):
                diag["payrollRejected"] += 1
            elif reason.startswith("team_value"):
                diag["teamValueRejected"] += 1
            else:
                diag["otherRejected"] += 1

    return diag


def process_cpu_contract_extensions(
    league_data: Dict[str, Any],
    user_team_name: Optional[str] = None,
    phase: str = "opening",
    payload: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    before = _extension_state(league_data, payload)
    phase_key = f"{before['seasonYear']}:{phase}"
    already_processed = phase_key in before.get("cpuPhasesProcessed", [])

    # Run the established execution path first.
    result = _process_cpu_contract_extensions_v9(league_data, user_team_name, phase, payload)
    updated = result.get("leagueData") if isinstance(result, dict) else None
    if not isinstance(updated, dict) or already_processed or phase not in {"rookie_deadline", "veteran_deadline", "deadline"}:
        return result

    rows = result.get("results") if isinstance(result.get("results"), list) else []
    signed = sum(1 for row in rows if isinstance(row, dict) and row.get("transaction"))

    # BM_PATCH45_ROOKIE_SIGNINGS_CPU_EXTENSIONS
    # Always persist deadline diagnostics, even when some extensions are signed.
    # A 3-extension season should still explain whether scarcity came from legal
    # eligibility, player willingness, team-value gates, payroll pressure, or
    # options/other blockers.
    diagnostics = _v10_scan_cpu_extension_gates(league_data, user_team_name, phase, payload)
    diagnostics["offersGenerated"] = len(rows)
    diagnostics["signed"] = signed

    state = updated.get("contractExtensionState") if isinstance(updated.get("contractExtensionState"), dict) else {}
    state["lastCpuRun"] = diagnostics
    history = list(state.get("cpuRunDiagnostics") or [])
    history = [
        row for row in history
        if not (
            isinstance(row, dict)
            and _int(row.get("seasonYear"), -1) == _int(diagnostics.get("seasonYear"), -2)
            and str(row.get("phase") or "") == str(phase)
        )
    ]
    history.append(diagnostics)
    state["cpuRunDiagnostics"] = history[-12:]
    updated["contractExtensionState"] = state
    result["leagueData"] = updated
    result["diagnostics"] = diagnostics
    return result

