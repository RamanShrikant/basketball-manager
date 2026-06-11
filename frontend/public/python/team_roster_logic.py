"""
team_roster_logic.py
Basketball Manager roster rules and rookie signing logic.

This file handles:
- Standard roster, two-way, draft-rights, and offseason roster counting.
- Rookie signing previews after the draft.
- Applying user rookie signing decisions.
- CPU rookie signing decisions for non-user teams.
"""

from __future__ import annotations

import copy
import random
from typing import Any, Dict, List, Optional, Tuple

TEAM_ROSTER_LOGIC_VERSION = "2026-06-11_team_roster_logic_user_offseason_overfill_v6"

STANDARD_ROSTER_MIN = 14
STANDARD_ROSTER_MAX = 15
TWO_WAY_MAX = 3
OFFSEASON_CONTROLLED_MAX = 20

STANDARD_TYPES = {"standard", "rookie_scale", "minimum", "extension"}
TWO_WAY_TYPES = {"two_way", "two-way"}
DRAFT_RIGHTS_TYPES = {"draft_rights", "unsigned_rookie", "rookie_pending"}
STASH_TYPES = {"stash", "stashed", "draft_stash", "g_league_stash", "overseas_stash"}


def _plain(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, dict):
        return {str(k): _plain(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_plain(v) for v in value]
    if isinstance(value, tuple):
        return [_plain(v) for v in value]
    try:
        if hasattr(value, "to_py"):
            return _plain(value.to_py())
    except Exception:
        pass
    return value


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        if value is None:
            return default
        return int(float(value))
    except Exception:
        return default


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except Exception:
        return default


def _stable_seed(*parts: Any) -> int:
    text = "|".join(str(part) for part in parts)
    total = 0
    for i, ch in enumerate(text):
        total = (total + (i + 1) * ord(ch)) % 2_147_483_647
    return total or 20260528


def _get_all_teams(league: Dict[str, Any]) -> List[Dict[str, Any]]:
    if isinstance(league.get("teams"), list):
        return league.get("teams") or []

    conferences = league.get("conferences") or {}
    teams: List[Dict[str, Any]] = []
    if isinstance(conferences, dict):
        for conf_name, conf_teams in conferences.items():
            for team in conf_teams or []:
                if isinstance(team, dict):
                    team.setdefault("conference", conf_name)
                    teams.append(team)
    return teams


def _team_name(team: Dict[str, Any]) -> str:
    return team.get("name") or team.get("teamName") or "Unknown Team"


def _find_team(league: Dict[str, Any], team_name: str) -> Optional[Dict[str, Any]]:
    if not team_name:
        return None
    for team in _get_all_teams(league):
        if team.get("name") == team_name or team.get("teamName") == team_name:
            return team
    return None


def _contract_type(player: Dict[str, Any]) -> str:
    contract = player.get("contract") if isinstance(player.get("contract"), dict) else {}
    value = (
        player.get("contractType")
        or player.get("rosterStatus")
        or contract.get("type")
        or "standard"
    )
    return str(value or "standard").lower()


def is_standard_player(player: Dict[str, Any]) -> bool:
    ctype = _contract_type(player)
    return ctype in STANDARD_TYPES or ctype == "standard"


def is_two_way_player(player: Dict[str, Any]) -> bool:
    return _contract_type(player) in TWO_WAY_TYPES


def is_draft_rights_player(player: Dict[str, Any]) -> bool:
    return _contract_type(player) in DRAFT_RIGHTS_TYPES


def is_stash_player(player: Dict[str, Any]) -> bool:
    return _contract_type(player) in STASH_TYPES


def is_pending_rookie(player: Dict[str, Any]) -> bool:
    contract = player.get("contract") if isinstance(player.get("contract"), dict) else {}
    return bool(
        contract.get("pendingRookieSigning")
        or player.get("rookieSigningPending")
        or _contract_type(player) in DRAFT_RIGHTS_TYPES
    )


def _ensure_team_lists(team: Dict[str, Any]) -> None:
    if not isinstance(team.get("players"), list):
        team["players"] = []
    if not isinstance(team.get("twoWayPlayers"), list):
        team["twoWayPlayers"] = []
    if not isinstance(team.get("draftRights"), list):
        team["draftRights"] = []
    if not isinstance(team.get("stashPlayers"), list):
        team["stashPlayers"] = []
    if not isinstance(team.get("pendingRookieSignings"), list):
        team["pendingRookieSignings"] = []


def _dedupe_by_id(players: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out = []
    seen = set()
    for player in players or []:
        if not isinstance(player, dict):
            continue
        key = player.get("id") or player.get("name")
        if key in seen:
            continue
        seen.add(key)
        out.append(player)
    return out


def normalize_team_roster_lists(team: Dict[str, Any]) -> None:
    _ensure_team_lists(team)

    kept_players = []
    for player in team.get("players") or []:
        if not isinstance(player, dict):
            continue

        if is_pending_rookie(player):
            team["pendingRookieSignings"].append(player)
            continue

        if is_two_way_player(player):
            team["twoWayPlayers"].append(player)
            continue

        if is_draft_rights_player(player):
            team["draftRights"].append(player)
            continue

        if is_stash_player(player):
            team["stashPlayers"].append(player)
            continue

        kept_players.append(player)

    team["players"] = _dedupe_by_id(kept_players)
    team["twoWayPlayers"] = _dedupe_by_id(team.get("twoWayPlayers") or [])
    team["draftRights"] = _dedupe_by_id(team.get("draftRights") or [])
    team["stashPlayers"] = _dedupe_by_id(team.get("stashPlayers") or [])
    team["pendingRookieSignings"] = _dedupe_by_id(team.get("pendingRookieSignings") or [])


def normalize_league_roster_lists(league: Dict[str, Any]) -> None:
    for team in _get_all_teams(league):
        normalize_team_roster_lists(team)


def roster_counts(team: Dict[str, Any]) -> Dict[str, int]:
    normalize_team_roster_lists(team)
    standard_count = len(team.get("players") or [])
    two_way_count = len(team.get("twoWayPlayers") or [])
    draft_rights_count = len(team.get("draftRights") or [])
    stash_count = len(team.get("stashPlayers") or [])
    pending_rookies_count = len(team.get("pendingRookieSignings") or [])

    # Stashes are unlimited draft-rights style holds in this game flow. They
    # should not consume the offseason controlled-player cap and should never
    # block rookie signing decisions. The season-start legality check only cares
    # about standard roster size and two-way slots.
    controlled_count = standard_count + two_way_count + pending_rookies_count
    total_with_stash_count = controlled_count + stash_count

    return {
        "standardCount": standard_count,
        "twoWayCount": two_way_count,
        "draftRightsCount": draft_rights_count,
        "stashCount": stash_count,
        "pendingRookiesCount": pending_rookies_count,
        "controlledCount": controlled_count,
        "totalWithStashCount": total_with_stash_count,
        "standardMin": STANDARD_ROSTER_MIN,
        "standardMax": STANDARD_ROSTER_MAX,
        "twoWayMax": TWO_WAY_MAX,
        "offseasonControlledMax": OFFSEASON_CONTROLLED_MAX,
    }




def can_add_standard_contract(team: Dict[str, Any], phase: str = "offseason") -> bool:
    counts = roster_counts(team)

    # Offseason user flow is intentionally permissive. The hard 15-man standard
    # roster limit is enforced only by season-start / Calendar simulation checks.
    if str(phase or "offseason").lower() == "offseason":
        return True

    return counts["standardCount"] < STANDARD_ROSTER_MAX


def can_add_two_way_contract(team: Dict[str, Any], phase: str = "offseason") -> bool:
    counts = roster_counts(team)

    # Same idea for two-ways: allow offseason overfill, then block simulation
    # until the team is back at 3 or fewer two-way contracts.
    if str(phase or "offseason").lower() == "offseason":
        return True

    return counts["twoWayCount"] < TWO_WAY_MAX


def needs_season_start_standard_cut(team: Dict[str, Any]) -> bool:
    return roster_counts(team)["standardCount"] > STANDARD_ROSTER_MAX


def validate_team_for_season_start(team: Dict[str, Any]) -> Dict[str, Any]:
    counts = roster_counts(team)
    errors = []

    if counts["standardCount"] < STANDARD_ROSTER_MIN:
        need = STANDARD_ROSTER_MIN - counts["standardCount"]
        errors.append(f"Standard roster: {counts['standardCount']} / {STANDARD_ROSTER_MIN} minimum — sign {need} standard player{'s' if need != 1 else ''}.")
    if counts["standardCount"] > STANDARD_ROSTER_MAX:
        remove = counts["standardCount"] - STANDARD_ROSTER_MAX
        errors.append(f"Standard roster: {counts['standardCount']} / {STANDARD_ROSTER_MAX} maximum — remove {remove} standard player{'s' if remove != 1 else ''}.")
    if counts["twoWayCount"] > TWO_WAY_MAX:
        remove = counts["twoWayCount"] - TWO_WAY_MAX
        errors.append(f"Two-way roster: {counts['twoWayCount']} / {TWO_WAY_MAX} maximum — remove {remove} two-way player{'s' if remove != 1 else ''}.")

    return {
        "ok": not errors,
        "teamName": _team_name(team),
        "errors": errors,
        **counts,
    }


def _rookie_salary_for_pick(round_num: int, pick_num: int) -> int:
    if round_num == 1:
        return max(2_400_000, int(11_800_000 - (pick_num - 1) * 315_000))

    pick_in_round = max(1, pick_num - 30)
    return max(1_250_000, int(2_250_000 - (pick_in_round - 1) * 28_000))


def _standard_second_round_contract(player: Dict[str, Any], season_year: int) -> Dict[str, Any]:
    meta = player.get("meta") if isinstance(player.get("meta"), dict) else {}
    pick_num = _safe_int(meta.get("draftPick"), 60)
    round_num = _safe_int(meta.get("draftRound"), 2)
    first_salary = _rookie_salary_for_pick(round_num, pick_num)

    if round_num == 1:
        return {
            "type": "standard",
            "startYear": season_year + 1,
            "salaryByYear": [
                first_salary,
                int(first_salary * 1.05),
                int(first_salary * 1.10),
                int(first_salary * 1.22),
            ],
            "option": {
                "type": "team",
                "yearIndices": [2, 3],
                "picked": None,
            },
            "source": "first_round_rookie_scale_contract",
            "countsAgainstStandardRoster": True,
        }

    return {
        "type": "standard",
        "startYear": season_year + 1,
        "salaryByYear": [first_salary, int(first_salary * 1.08)],
        "option": None,
        "source": "second_round_rookie_contract",
    }


def _two_way_contract(season_year: int) -> Dict[str, Any]:
    return {
        "type": "two_way",
        "startYear": season_year + 1,
        "salaryByYear": [580_000],
        "option": None,
        "source": "rookie_two_way_contract",
        "countsAgainstStandardRoster": False,
    }


def _draft_rights_contract(season_year: int) -> Dict[str, Any]:
    return {
        "type": "draft_rights",
        "startYear": season_year,
        "salaryByYear": [],
        "option": None,
        "source": "unsigned_draft_rights",
        "countsAgainstStandardRoster": False,
    }


def _stash_contract(season_year: int) -> Dict[str, Any]:
    return {
        "type": "stash",
        "startYear": season_year + 1,
        "salaryByYear": [],
        "option": None,
        "source": "one_year_rookie_stash",
        "countsAgainstStandardRoster": False,
        "countsAgainstSalaryCap": False,
    }


def _player_summary(player: Dict[str, Any], team_name: str) -> Dict[str, Any]:
    meta = player.get("meta") if isinstance(player.get("meta"), dict) else {}
    traits = player.get("traits") if isinstance(player.get("traits"), dict) else {}
    return {
        "playerId": player.get("id"),
        "playerName": player.get("name"),
        "teamName": team_name,
        "pos": player.get("pos"),
        "secondaryPos": player.get("secondaryPos") or "",
        "age": player.get("age"),
        "overall": _safe_int(player.get("overall"), 0),
        "potential": _safe_int(player.get("potential"), 0),
        "draftPick": _safe_int(meta.get("draftPick"), 0),
        "draftRound": _safe_int(meta.get("draftRound"), 0),
        "draftPickInRound": _safe_int(meta.get("draftPickInRound"), 0),
        "college": meta.get("college") or player.get("college") or "",
        "nationality": meta.get("nationality") or player.get("nationality") or "",
        "archetype": meta.get("archetype") or player.get("archetype") or "",
        "headshot": player.get("headshot") or player.get("image") or player.get("img") or "",
        "portraitId": player.get("portraitId") or "",
        "nbaReady": _safe_float(traits.get("nbaReady"), 0.0),
        "starUpside": _safe_float(traits.get("starUpside"), 0.0),
    }


def _recommended_rookie_decision(player: Dict[str, Any], team: Dict[str, Any]) -> str:
    counts = roster_counts(team)
    overall = _safe_int(player.get("overall"), 0)
    potential = _safe_int(player.get("potential"), overall)
    meta = player.get("meta") if isinstance(player.get("meta"), dict) else {}
    pick = _safe_int(meta.get("draftPick"), 60)
    upside = potential - overall
    two_way_open = counts["twoWayCount"] < TWO_WAY_MAX
    # Pending rookies already occupy one controlled slot before this decision.
    # A standard/two-way/stash decision replaces that pending slot, so a team at
    # exactly 20 controlled players can still resolve the rookie without needing
    # to release someone first.
    effective_controlled_before_decision = max(0, counts["controlledCount"] - 1)
    controlled_open = effective_controlled_before_decision < OFFSEASON_CONTROLLED_MAX

    if not controlled_open:
        # A full non-stash controlled roster should not force teams to lose a
        # newly drafted player. Stash is unlimited and can be cleaned up later.
        return "stash"

    # Pick-range driven rookie-contract behavior:
    # 1-24: normal first-round standard contracts.
    # 25-45: default to two-way for non-outliers at 71 OVR or lower.
    # 46-60: default to stash for 69 OVR or lower, two-way for useful 70-73s.
    # Only clear OVR/POT outliers jump straight to standard contracts.
    if pick <= 24:
        if overall <= 63 and two_way_open:
            return "two_way"
        return "standard"

    if 25 <= pick <= 45:
        if overall >= 74 or potential >= 86:
            return "standard"
        if overall <= 71:
            if two_way_open:
                return "two_way"
            return "stash" if controlled_open else "release"
        if overall <= 73 and two_way_open and potential < 84:
            return "two_way"
        return "standard"

    # Picks 46-60 should usually be developmental holds, not automatic standard deals.
    if pick >= 46:
        if overall >= 74 or potential >= 86:
            return "standard"
        if overall <= 69:
            return "stash"
        if two_way_open:
            return "two_way"
        if upside >= 3 or potential >= 72:
            return "stash"
        return "release"

    if overall >= 74 or potential >= 84:
        return "standard"
    if two_way_open:
        return "two_way"
    return "stash" if controlled_open else "release"


def _decision_label(decision: str) -> str:
    labels = {
        "standard": "Standard Contract",
        "two_way": "Two-Way Contract",
        "stash": "1-Year Stash",
        "release": "Release to Free Agency",
    }
    return labels.get(decision, decision)


def _hydrate_pending_rookie_image_from_draft_class(league: Dict[str, Any], player: Dict[str, Any]) -> None:
    if not isinstance(player, dict):
        return

    if player.get("headshot") or player.get("image") or player.get("img"):
        return

    draft_state = league.get("draftState") if isinstance(league.get("draftState"), dict) else {}
    draft_blob = draft_state.get("draft") if isinstance(draft_state.get("draft"), dict) else {}

    draft_class = []
    if isinstance(draft_blob.get("draftClass"), list):
        draft_class = draft_blob.get("draftClass") or []
    elif isinstance(draft_state.get("draftClass"), list):
        draft_class = draft_state.get("draftClass") or []

    if not draft_class:
        return

    player_name = str(player.get("name") or "").strip().lower()
    player_id = str(player.get("id") or "").strip().lower()

    match = None
    for prospect in draft_class:
        if not isinstance(prospect, dict):
            continue
        prospect_name = str(prospect.get("name") or "").strip().lower()
        prospect_id = str(prospect.get("id") or "").strip().lower()
        if player_name and prospect_name == player_name:
            match = prospect
            break
        if prospect_id and prospect_id in player_id:
            match = prospect
            break

    if not match:
        return

    image_url = match.get("headshot") or match.get("image") or match.get("img") or ""
    if image_url:
        player["headshot"] = image_url
        player["image"] = image_url
        player["img"] = image_url

    if match.get("portraitId"):
        player["portraitId"] = match.get("portraitId")


def collect_pending_rookies(league: Dict[str, Any], user_team_name: Optional[str] = None) -> List[Dict[str, Any]]:
    normalize_league_roster_lists(league)
    rows = []

    for team in _get_all_teams(league):
        team_name = _team_name(team)
        for player in team.get("pendingRookieSignings") or []:
            if not isinstance(player, dict):
                continue
            _hydrate_pending_rookie_image_from_draft_class(league, player)
            row = _player_summary(player, team_name)
            row["recommendedDecision"] = _recommended_rookie_decision(player, team)
            row["recommendedLabel"] = _decision_label(row["recommendedDecision"])
            row["userControlled"] = bool(user_team_name and team_name == user_team_name)
            rows.append(row)

    rows.sort(key = lambda row: (row.get("draftPick") or 999, row.get("playerName") or ""))
    return rows


def _remove_from_pending(team: Dict[str, Any], player_id: str) -> Optional[Dict[str, Any]]:
    pending = team.get("pendingRookieSignings") or []
    kept = []
    found = None

    for player in pending:
        if isinstance(player, dict) and player.get("id") == player_id and found is None:
            found = player
        else:
            kept.append(player)

    team["pendingRookieSignings"] = kept
    return found


def _append_unique(target: List[Dict[str, Any]], player: Dict[str, Any]) -> None:
    player_id = player.get("id")
    existing = {p.get("id") for p in target if isinstance(p, dict)}
    if player_id not in existing:
        target.append(player)


def _same_player_identity(a: Dict[str, Any], b: Dict[str, Any]) -> bool:
    a_id = a.get("id")
    b_id = b.get("id")
    if a_id and b_id:
        return str(a_id) == str(b_id)

    a_name = str(a.get("name") or "").strip().lower()
    b_name = str(b.get("name") or "").strip().lower()
    return bool(a_name and b_name and a_name == b_name)


def _remove_matching_free_agent_duplicates(league: Dict[str, Any], player: Dict[str, Any]) -> None:
    if not isinstance(league.get("freeAgents"), list):
        return

    league["freeAgents"] = [
        free_agent
        for free_agent in league.get("freeAgents") or []
        if not (isinstance(free_agent, dict) and _same_player_identity(free_agent, player))
    ]


def _clear_resolved_rookie_pending_markers(player: Dict[str, Any]) -> None:
    player["rookieSigningPending"] = False
    player.pop("qualifyingOffer", None)
    player.pop("qualifyingOfferEligible", None)
    player.pop("rightsRenounced", None)
    player.pop("freeAgencyMeta", None)

    contract = player.get("contract")
    if isinstance(contract, dict):
        contract.pop("pendingRookieSigning", None)


def _bird_level_from_seasons(seasons_toward_bird: int) -> str:
    seasons = max(0, min(3, _safe_int(seasons_toward_bird, 0)))
    if seasons >= 3:
        return "bird"
    if seasons == 2:
        return "early_bird"
    if seasons == 1:
        return "non_bird"
    return "none"


def _get_player_draft_round(player: Dict[str, Any]) -> int:
    meta = player.get("meta") if isinstance(player.get("meta"), dict) else {}
    return _safe_int(meta.get("draftRound") or player.get("draftRound"), 0)


def _get_player_draft_pick(player: Dict[str, Any]) -> int:
    meta = player.get("meta") if isinstance(player.get("meta"), dict) else {}
    return _safe_int(meta.get("draftPick") or player.get("draftPick"), 0)


def _set_rookie_team_control_rights(
    player: Dict[str, Any],
    team_name: str,
    season_year: int,
    rookie_scale_control: bool,
    rights_path: str,
    seasons_toward_bird: int = 1,
) -> None:
    rights = player.get("rights") if isinstance(player.get("rights"), dict) else {}
    seasons = max(0, min(3, _safe_int(rights.get("seasonsTowardBird"), seasons_toward_bird)))

    if seasons <= 0 and rookie_scale_control:
        seasons = 1

    player["rights"] = {
        **rights,
        "heldByTeam": team_name,
        "seasonsTowardBird": seasons,
        "birdLevel": _bird_level_from_seasons(seasons),
        "rookieScale": bool(rookie_scale_control),
        "restrictedFreeAgent": False,
    }

    meta = player.setdefault("meta", {})
    if isinstance(meta, dict):
        meta["rookieRightsPath"] = rights_path
        meta["rookieContractSeasonYear"] = season_year
        meta["rookieTeamControl"] = bool(rookie_scale_control)
        meta["yearsWithCurrentTeam"] = max(1, _safe_int(meta.get("yearsWithCurrentTeam"), 1))


def _clear_team_control_rights(player: Dict[str, Any]) -> None:
    rights = player.get("rights") if isinstance(player.get("rights"), dict) else {}
    player["rights"] = {
        **rights,
        "heldByTeam": None,
        "seasonsTowardBird": 0,
        "birdLevel": "none",
        "rookieScale": False,
        "restrictedFreeAgent": False,
    }


def _normalize_existing_rookie_rights_for_team(
    team: Dict[str, Any],
    season_year: int,
) -> List[Dict[str, Any]]:
    actions = []
    team_name = _team_name(team)
    normalize_team_roster_lists(team)

    for player in team.get("players") or []:
        if not isinstance(player, dict):
            continue

        draft_round = _get_player_draft_round(player)
        if draft_round not in [1, 2]:
            continue

        meta = player.get("meta") if isinstance(player.get("meta"), dict) else {}
        draft_year = _safe_int(
            meta.get("draftYear") or meta.get("draftSeasonYear") or meta.get("rookieContractSeasonYear"),
            0,
        )
        age = _safe_int(player.get("age"), 0)

        # Keep this recovery narrow: it is meant for just-drafted/current young rookies,
        # not old veteran records that may happen to carry a draftRound field.
        if draft_year and draft_year not in [season_year, season_year - 1]:
            continue
        if not draft_year and age > 24:
            continue

        contract = player.get("contract") if isinstance(player.get("contract"), dict) else {}
        contract_type = _contract_type(player)
        if contract_type not in STANDARD_TYPES and contract.get("type") not in STANDARD_TYPES:
            continue

        rights = player.get("rights") if isinstance(player.get("rights"), dict) else {}
        already_controlled = (
            rights.get("heldByTeam") == team_name
            and bool(rights.get("rookieScale"))
        )
        if already_controlled:
            continue

        rights_path = "first_round_rookie_scale_rfa_path" if draft_round == 1 else "second_round_standard_rfa_path"
        _set_rookie_team_control_rights(
            player = player,
            team_name = team_name,
            season_year = season_year,
            rookie_scale_control = True,
            rights_path = rights_path,
            seasons_toward_bird = max(1, _safe_int(rights.get("seasonsTowardBird"), 1)),
        )
        actions.append({
            "playerId": player.get("id"),
            "playerName": player.get("name"),
            "teamName": team_name,
            "action": "normalized_rookie_rfa_rights",
            "draftRound": draft_round,
            "rightsPath": rights_path,
        })

    return actions


def _add_transaction(player: Dict[str, Any], season_year: int, label: str, team_name: str, tx_type: str) -> None:
    history = player.setdefault("history", {})
    if not isinstance(history.get("transactions"), list):
        history["transactions"] = []
    history["transactions"].append({
        "seasonYear": season_year,
        "type": tx_type,
        "label": label,
        "teamName": team_name,
    })


def _apply_decision_to_player(
    league: Dict[str, Any],
    team: Dict[str, Any],
    player: Dict[str, Any],
    decision: str,
    season_year: int,
) -> Dict[str, Any]:
    _ensure_team_lists(team)
    team_name = _team_name(team)
    decision = str(decision or "release").lower()

    # A rookie signing decision fully resolves this player. Remove any stale
    # free-agent duplicate first so he cannot immediately show up in Rights/QO.
    _remove_matching_free_agent_duplicates(league, player)
    _clear_resolved_rookie_pending_markers(player)

    if decision == "standard":
        draft_round = _get_player_draft_round(player)
        player["contract"] = _standard_second_round_contract(player, season_year)
        player["contractType"] = "standard"
        player["rosterStatus"] = "standard"
        player["assignmentStatus"] = "nba"
        player["team"] = team_name
        player["rookieSigningPending"] = False
        meta = player.setdefault("meta", {})
        if isinstance(meta, dict):
            meta["rookieSigningDecision"] = "standard"
            meta["nbaRookieSeasonYear"] = season_year + 1
        rights_path = "first_round_rookie_scale_rfa_path" if draft_round == 1 else "second_round_standard_rfa_path"
        _set_rookie_team_control_rights(
            player = player,
            team_name = team_name,
            season_year = season_year,
            rookie_scale_control = True,
            rights_path = rights_path,
            seasons_toward_bird = 1,
        )
        label = "Signed first-round rookie standard contract" if draft_round == 1 else "Signed second-round rookie standard contract"
        _add_transaction(player, season_year, label, team_name, "rookie_signing_standard")
        _append_unique(team["players"], player)

    elif decision == "two_way":
        player["contract"] = _two_way_contract(season_year)
        player["contractType"] = "two_way"
        player["rosterStatus"] = "two_way"
        player["assignmentStatus"] = "g_league"
        player["team"] = team_name
        player["rookieSigningPending"] = False
        meta = player.setdefault("meta", {})
        if isinstance(meta, dict):
            meta["rookieSigningDecision"] = "two_way"
            meta["nbaRookieSeasonYear"] = season_year + 1
        player["twoWayMeta"] = {
            **(player.get("twoWayMeta") if isinstance(player.get("twoWayMeta"), dict) else {}),
            "assignedByTeam": team_name,
            "assignedSeasonYear": season_year + 1,
            "currentTwoWaySeasonYear": season_year + 1,
            "twoWayYearsUsed": 1,
            "maxTwoWayYears": 2,
            "source": "rookie_signing_two_way",
        }
        _set_rookie_team_control_rights(
            player = player,
            team_name = team_name,
            season_year = season_year,
            rookie_scale_control = False,
            rights_path = "rookie_two_way_team_control",
            seasons_toward_bird = 0,
        )
        _add_transaction(player, season_year, "Signed rookie two-way contract", team_name, "rookie_signing_two_way")
        _append_unique(team["twoWayPlayers"], player)

    elif decision == "stash":
        player["contract"] = _stash_contract(season_year)
        player["contractType"] = "stash"
        player["rosterStatus"] = "stashed"
        player["assignmentStatus"] = "stash"
        player["team"] = team_name
        player["rookieSigningPending"] = False

        meta = player.setdefault("meta", {})
        if isinstance(meta, dict):
            meta["rookieSigningDecision"] = "stash"
            meta["stashSeasonYear"] = season_year + 1
            meta["stashDecisionSeasonYear"] = season_year + 1
            meta["nbaRookieSeasonYear"] = None
            meta["proSeasonsAtStashStart"] = _safe_int(meta.get("proSeasons") or player.get("proSeasons"), 0)

        player["stashMeta"] = {
            **(player.get("stashMeta") if isinstance(player.get("stashMeta"), dict) else {}),
            "stashedByTeam": team_name,
            "stashSeasonYear": season_year + 1,
            "decisionSeasonYear": season_year + 1,
            "returnEligibleSeasonYear": season_year + 1,
            "source": "rookie_signing_one_year_stash",
        }

        _set_rookie_team_control_rights(
            player = player,
            team_name = team_name,
            season_year = season_year,
            rookie_scale_control = False,
            rights_path = "one_year_stash_team_control",
            seasons_toward_bird = 0,
        )
        _add_transaction(player, season_year, "Stashed rookie for one season", team_name, "rookie_signing_stash")
        _append_unique(team["stashPlayers"], player)

    elif decision == "release":
        player["contract"] = {"type": "free_agent", "startYear": season_year, "salaryByYear": [], "option": None}
        player["contractType"] = "free_agent"
        player["rosterStatus"] = "free_agent"
        player["assignmentStatus"] = "free_agent"
        player["team"] = "Free Agent"
        player["rookieSigningPending"] = False
        player.setdefault("meta", {})["rookieSigningDecision"] = "release"
        _clear_team_control_rights(player)
        _add_transaction(player, season_year, f"Released by {team_name} after draft", "Free Agent", "rookie_released")
        if not isinstance(league.get("freeAgents"), list):
            league["freeAgents"] = []
        _append_unique(league["freeAgents"], player)

    else:
        # Unknown/legacy choices safely become releases so the rookie-signing event fully resolves.
        player["contract"] = {"type": "free_agent", "startYear": season_year, "salaryByYear": [], "option": None}
        player["contractType"] = "free_agent"
        player["rosterStatus"] = "free_agent"
        player["assignmentStatus"] = "free_agent"
        player["team"] = "Free Agent"
        player["rookieSigningPending"] = False
        player.setdefault("meta", {})["rookieSigningDecision"] = "release"
        _clear_team_control_rights(player)
        _add_transaction(player, season_year, f"Released by {team_name} after draft", "Free Agent", "rookie_released")
        if not isinstance(league.get("freeAgents"), list):
            league["freeAgents"] = []
        _append_unique(league["freeAgents"], player)
        decision = "release"

    return {
        **_player_summary(player, team_name if decision != "release" else "Free Agent"),
        "decision": decision,
        "decisionLabel": _decision_label(decision),
    }


def _auto_cpu_decision(player: Dict[str, Any], team: Dict[str, Any], season_year: int) -> str:
    recommended = _recommended_rookie_decision(player, team)
    rng = random.Random(_stable_seed(season_year, _team_name(team), player.get("id"), "rookie_signing"))
    overall = _safe_int(player.get("overall"), 0)
    potential = _safe_int(player.get("potential"), overall)
    meta = player.get("meta") if isinstance(player.get("meta"), dict) else {}
    pick = _safe_int(meta.get("draftPick"), 60)

    # Keep CPU behavior pick-slot driven. Randomness should move developmental
    # players between stash and two-way, not upgrade normal late picks into
    # standard deals too often.
    if recommended == "two_way" and pick >= 46 and overall <= 69 and potential >= 70 and rng.random() < 0.35:
        return "stash"
    if recommended == "stash" and overall >= 70 and roster_counts(team)["twoWayCount"] < TWO_WAY_MAX and rng.random() < 0.25:
        return "two_way"
    if recommended == "standard" and pick >= 25 and overall <= 71 and roster_counts(team)["twoWayCount"] < TWO_WAY_MAX:
        return "two_way"
    return recommended


def _should_cpu_upgrade_two_way(player: Dict[str, Any], team: Dict[str, Any]) -> bool:
    counts = roster_counts(team)
    if counts["standardCount"] >= STANDARD_ROSTER_MAX:
        return False
    if counts["controlledCount"] >= OFFSEASON_CONTROLLED_MAX:
        return False

    overall = _safe_int(player.get("overall"), 0)
    potential = _safe_int(player.get("potential"), overall)
    age = _safe_int(player.get("age"), 22)
    upside = potential - overall

    if overall >= 76:
        return True
    if overall >= 74 and potential >= 78:
        return True
    if age <= 23 and overall >= 72 and potential >= 82:
        return True
    if age <= 22 and overall >= 70 and upside >= 7:
        return True

    return False


def _should_cpu_release_two_way(player: Dict[str, Any]) -> bool:
    overall = _safe_int(player.get("overall"), 0)
    potential = _safe_int(player.get("potential"), overall)
    age = _safe_int(player.get("age"), 22)

    if overall <= 56 and potential <= 66:
        return True
    if age >= 24 and overall <= 58 and potential <= 68:
        return True
    if age >= 26 and overall <= 61 and potential <= 69:
        return True

    return False


def _remove_two_way_player(team: Dict[str, Any], player: Dict[str, Any]) -> None:
    key = player.get("id") or player.get("name")
    team["twoWayPlayers"] = [
        p for p in (team.get("twoWayPlayers") or [])
        if (p.get("id") or p.get("name")) != key
    ]


def _auto_manage_cpu_two_way_players_after_rookie_signings(
    league: Dict[str, Any],
    team: Dict[str, Any],
    season_year: int,
) -> List[Dict[str, Any]]:
    actions = []
    normalize_team_roster_lists(team)

    upgrade_candidates = sorted(
        list(team.get("twoWayPlayers") or []),
        key = _player_keep_score,
        reverse = True,
    )

    for player in upgrade_candidates:
        if not _should_cpu_upgrade_two_way(player, team):
            continue

        _remove_two_way_player(team, player)
        actions.append(_promote_two_way_to_standard(team, player, season_year))
        normalize_team_roster_lists(team)

    two_way_sorted = sorted(
        list(team.get("twoWayPlayers") or []),
        key = _player_keep_score,
        reverse = True,
    )

    keep_keys = {
        (p.get("id") or p.get("name"))
        for p in two_way_sorted[:TWO_WAY_MAX]
    }

    kept_two_way = []
    release_two_way = []

    for player in two_way_sorted:
        key = player.get("id") or player.get("name")
        if key not in keep_keys:
            release_two_way.append((player, "two_way_roster_limit_release"))
        elif _should_cpu_release_two_way(player):
            release_two_way.append((player, "two_way_performance_release"))
        else:
            kept_two_way.append(player)

    team["twoWayPlayers"] = kept_two_way

    for player, reason in release_two_way:
        actions.append(_release_player_to_free_agency(
            league = league,
            team_name = _team_name(team),
            player = player,
            season_year = season_year,
            reason = reason,
        ))

    normalize_team_roster_lists(team)
    return actions


def preview_rookie_signings(league_data: Dict[str, Any], payload: Dict[str, Any]) -> Dict[str, Any]:
    league = copy.deepcopy(_plain(league_data) or {})
    payload = _plain(payload) or {}
    user_team_name = payload.get("userTeamName") or payload.get("teamName")
    season_year = _safe_int(payload.get("seasonYear") or league.get("seasonYear") or league.get("currentSeasonYear"), 2026)

    pending = collect_pending_rookies(league, user_team_name)
    user_pending = [row for row in pending if row.get("userControlled")]
    cpu_pending = [row for row in pending if not row.get("userControlled")]

    user_team = _find_team(league, user_team_name) if user_team_name else None
    user_team_roster_counts = roster_counts(user_team) if user_team else None

    league.setdefault("rookieSigningState", {})
    league["rookieSigningState"].update({
        "seasonYear": season_year,
        "pendingCount": len(pending),
        "userPendingCount": len(user_pending),
        "cpuPendingCount": len(cpu_pending),
        "complete": len(pending) == 0,
        "version": TEAM_ROSTER_LOGIC_VERSION,
    })

    return {
        "ok": True,
        "version": TEAM_ROSTER_LOGIC_VERSION,
        "leagueData": league,
        "seasonYear": season_year,
        "pendingRookies": pending,
        "userPendingRookies": user_pending,
        "cpuPendingRookies": cpu_pending,
        "userTeamRosterCounts": user_team_roster_counts,
        "summary": {
            "pendingCount": len(pending),
            "userPendingCount": len(user_pending),
            "cpuPendingCount": len(cpu_pending),
            "userTeamRosterCounts": user_team_roster_counts,
        },
    }


def apply_rookie_signings(league_data: Dict[str, Any], payload: Dict[str, Any]) -> Dict[str, Any]:
    league = copy.deepcopy(_plain(league_data) or {})
    payload = _plain(payload) or {}
    user_team_name = payload.get("userTeamName") or payload.get("teamName")
    season_year = _safe_int(payload.get("seasonYear") or league.get("seasonYear") or league.get("currentSeasonYear"), 2026)
    raw_decisions = payload.get("decisions") or {}

    if isinstance(raw_decisions, list):
        decisions = {row.get("playerId"): row.get("decision") for row in raw_decisions if isinstance(row, dict)}
    else:
        decisions = dict(raw_decisions) if isinstance(raw_decisions, dict) else {}

    normalize_league_roster_lists(league)
    applied = []
    skipped = []

    for team in _get_all_teams(league):
        normalize_team_roster_lists(team)
        team_name = _team_name(team)

        # Rookie signing decisions are a batch replacement. Pending rookies
        # already count as controlled players before this screen. Remove all
        # pending rookies first, then add back only the standard/two-way/stash
        # choices. This prevents a team at 21 raw controlled players with two
        # pending rookies from being forced to release both when one signing and
        # one release would legally finish at 20.
        pending_players = [
            p for p in (team.get("pendingRookieSignings") or [])
            if isinstance(p, dict)
        ]
        team["pendingRookieSignings"] = []

        for player in pending_players:
            player_id = player.get("id")
            is_user_team = bool(user_team_name and team_name == user_team_name)
            decision = decisions.get(player_id)

            if is_user_team and not decision:
                # If the user forgot one decision, use the same practical recommendation shown in preview.
                decision = _recommended_rookie_decision(player, team)

            if not is_user_team:
                decision = _auto_cpu_decision(player, team, season_year)

            decision = str(decision or "release").lower()
            if decision == "draft_rights":
                decision = "stash"
            if decision not in ["standard", "two_way", "stash", "release"]:
                decision = "release"

            # User-controlled rookie signings have no offseason roster-count
            # blockers. CPU teams keep the old conservative behavior so they do
            # not deliberately overfill unless finalization later repairs them.
            if not is_user_team:
                if decision == "two_way" and roster_counts(team)["twoWayCount"] >= TWO_WAY_MAX:
                    decision = "stash"
                if decision in ["standard", "two_way"] and roster_counts(team)["controlledCount"] >= OFFSEASON_CONTROLLED_MAX:
                    decision = "stash"

            result = _apply_decision_to_player(league, team, player, decision, season_year)
            result["userControlled"] = is_user_team
            applied.append(result)

    rookie_rights_actions = []
    cpu_two_way_actions = []

    for team in _get_all_teams(league):
        team_name = _team_name(team)
        rookie_rights_actions.extend(_normalize_existing_rookie_rights_for_team(team, season_year))

        if user_team_name and team_name == user_team_name:
            continue

        cpu_two_way_actions.extend(
            _auto_manage_cpu_two_way_players_after_rookie_signings(
                league = league,
                team = team,
                season_year = season_year,
            )
        )

    remaining = collect_pending_rookies(league, user_team_name)
    complete = len(remaining) == 0

    league.setdefault("rookieSigningState", {})
    league["rookieSigningState"].update({
        "seasonYear": season_year,
        "complete": complete,
        "appliedCount": len(applied),
        "remainingCount": len(remaining),
        "appliedDecisions": applied,
        "rookieRightsActions": rookie_rights_actions,
        "cpuTwoWayActions": cpu_two_way_actions,
        "version": TEAM_ROSTER_LOGIC_VERSION,
    })
    league.setdefault("draftState", {})["rookieSigningsComplete"] = complete

    return {
        "ok": True,
        "version": TEAM_ROSTER_LOGIC_VERSION,
        "leagueData": league,
        "seasonYear": season_year,
        "complete": complete,
        "appliedDecisions": applied,
        "remainingPendingRookies": remaining,
        "summary": {
            "appliedCount": len(applied),
            "remainingCount": len(remaining),
            "rookieRightsActionCount": len(rookie_rights_actions),
            "cpuTwoWayActionCount": len(cpu_two_way_actions),
            "complete": complete,
        },
    }


def get_roster_rules_summary(league_data: Dict[str, Any], payload: Dict[str, Any]) -> Dict[str, Any]:
    league = copy.deepcopy(_plain(league_data) or {})
    normalize_league_roster_lists(league)
    rows = []
    for team in _get_all_teams(league):
        rows.append(validate_team_for_season_start(team))

    return {
        "ok": True,
        "version": TEAM_ROSTER_LOGIC_VERSION,
        "leagueData": league,
        "rules": {
            "standardRosterMin": STANDARD_ROSTER_MIN,
            "standardRosterMax": STANDARD_ROSTER_MAX,
            "twoWayMax": TWO_WAY_MAX,
            "offseasonControlledMax": OFFSEASON_CONTROLLED_MAX,
        },
        "teams": rows,
    }



# ------------------------------------------------------------
# ROSTER FINALIZATION / SEASON-START VALIDATION
# ------------------------------------------------------------

def _player_keep_score(player: Dict[str, Any]) -> float:
    overall = _safe_float(player.get("overall"), 0.0)
    potential = _safe_float(player.get("potential"), overall)
    age = _safe_int(player.get("age"), 27)
    upside = max(0.0, potential - overall)
    contract = player.get("contract") if isinstance(player.get("contract"), dict) else {}
    salary_by_year = contract.get("salaryByYear") if isinstance(contract.get("salaryByYear"), list) else []
    salary = _safe_float(salary_by_year[0], 0.0) if salary_by_year else 0.0

    score = overall * 1.0 + potential * 0.25 + upside * 0.85

    if age <= 23:
        score += 4.0
    elif age <= 26:
        score += 2.0
    elif age >= 34:
        score -= 2.5
    elif age >= 31:
        score -= 1.0

    if overall >= 80:
        score += 7.0
    elif overall >= 76:
        score += 4.0
    elif overall >= 72:
        score += 1.5

    # On the final roster fringe, expensive low-end contracts are a little more cuttable,
    # but talent still matters far more than salary.
    if overall < 74 and salary >= 5_000_000:
        score -= min(4.0, salary / 5_000_000)

    return float(score)


def _minimum_standard_contract(season_year: int) -> Dict[str, Any]:
    return {
        "type": "standard",
        "startYear": season_year,
        "salaryByYear": [1_500_000],
        "option": None,
        "source": "roster_finalization_minimum",
    }


def _set_player_as_standard(player: Dict[str, Any], team_name: str, season_year: int, source: str = "roster_finalization") -> Dict[str, Any]:
    contract = player.get("contract") if isinstance(player.get("contract"), dict) else {}
    salary_by_year = contract.get("salaryByYear") if isinstance(contract.get("salaryByYear"), list) else []

    if not salary_by_year:
        contract = _minimum_standard_contract(season_year)
    else:
        contract = {
            **contract,
            "type": "standard",
        }

    player["contract"] = contract
    player["contractType"] = "standard"
    player["rosterStatus"] = "standard"
    player["assignmentStatus"] = "nba"
    player["team"] = team_name

    rights = player.get("rights") if isinstance(player.get("rights"), dict) else {}
    player["rights"] = {
        **rights,
        "heldByTeam": team_name,
        "seasonsTowardBird": max(1, _safe_int(rights.get("seasonsTowardBird"), 1)),
        "birdLevel": rights.get("birdLevel") or "non_bird",
        "restrictedFreeAgent": False,
    }

    meta = player.setdefault("meta", {})
    if isinstance(meta, dict):
        meta["acquiredVia"] = meta.get("acquiredVia") or source
        meta["yearsWithCurrentTeam"] = max(0, _safe_int(meta.get("yearsWithCurrentTeam"), 0))

    return player


def _release_player_to_free_agency(
    league: Dict[str, Any],
    team_name: str,
    player: Dict[str, Any],
    season_year: int,
    reason: str = "roster_finalization_release",
) -> Dict[str, Any]:
    if not isinstance(league.get("freeAgents"), list):
        league["freeAgents"] = []

    released = copy.deepcopy(player)
    old_contract = released.get("contract") if isinstance(released.get("contract"), dict) else None
    if old_contract:
        released["previousContract"] = copy.deepcopy(old_contract)

    released["team"] = "Free Agent"
    released["contract"] = {
        "type": "free_agent",
        "startYear": season_year,
        "salaryByYear": [],
        "option": None,
        "source": reason,
    }
    released["contractType"] = "free_agent"
    released["rosterStatus"] = "free_agent"
    released["assignmentStatus"] = "free_agent"
    released["freeAgencyMeta"] = {
        "fromTeam": team_name,
        "reason": reason,
        "seasonYear": season_year,
    }

    rights = released.get("rights") if isinstance(released.get("rights"), dict) else {}
    released["rights"] = {
        **rights,
        "heldByTeam": None,
        "seasonsTowardBird": 0,
        "birdLevel": "none",
        "restrictedFreeAgent": False,
    }

    existing = {
        p.get("id") or p.get("name")
        for p in league.get("freeAgents") or []
        if isinstance(p, dict)
    }
    key = released.get("id") or released.get("name")
    if key not in existing:
        league["freeAgents"].append(released)

    return {
        "playerId": released.get("id"),
        "playerName": released.get("name"),
        "teamName": team_name,
        "action": "released",
        "reason": reason,
        "overall": released.get("overall"),
        "contractType": _contract_type(player),
    }


def _promote_two_way_to_standard(team: Dict[str, Any], player: Dict[str, Any], season_year: int) -> Dict[str, Any]:
    team_name = _team_name(team)
    promoted = copy.deepcopy(player)
    promoted = _set_player_as_standard(promoted, team_name, season_year, source = "two_way_promotion")
    if _get_player_draft_round(promoted) in [1, 2] or _contract_type(player) in TWO_WAY_TYPES:
        _set_rookie_team_control_rights(
            player = promoted,
            team_name = team_name,
            season_year = season_year,
            rookie_scale_control = True,
            rights_path = "two_way_upgraded_standard_rfa_path",
            seasons_toward_bird = 1,
        )
    team["players"].append(promoted)
    return {
        "playerId": promoted.get("id"),
        "playerName": promoted.get("name"),
        "teamName": team_name,
        "action": "promoted_two_way_to_standard",
        "overall": promoted.get("overall"),
    }


def _sign_replacement_free_agent(
    league: Dict[str, Any],
    team: Dict[str, Any],
    season_year: int,
) -> Optional[Dict[str, Any]]:
    free_agents = [p for p in (league.get("freeAgents") or []) if isinstance(p, dict)]
    if not free_agents:
        return None

    # CPU emergency filler: take the best available low-to-mid-level option.
    free_agents.sort(
        key = lambda p: (
            _player_keep_score(p),
            _safe_int(p.get("overall"), 0),
            _safe_int(p.get("potential"), 0),
        ),
        reverse = True,
    )

    chosen = free_agents[0]
    chosen_key = chosen.get("id") or chosen.get("name")
    league["freeAgents"] = [
        p for p in free_agents
        if (p.get("id") or p.get("name")) != chosen_key
    ]

    signed = copy.deepcopy(chosen)
    team_name = _team_name(team)
    signed = _set_player_as_standard(signed, team_name, season_year, source = "cpu_roster_finalization_minimum")
    signed["contract"] = _minimum_standard_contract(season_year)
    team["players"].append(signed)

    return {
        "playerId": signed.get("id"),
        "playerName": signed.get("name"),
        "teamName": team_name,
        "action": "signed_replacement_free_agent",
        "overall": signed.get("overall"),
    }


def _resolve_cpu_pending_rookies_for_finalization(
    league: Dict[str, Any],
    team: Dict[str, Any],
    season_year: int,
) -> List[Dict[str, Any]]:
    actions = []
    normalize_team_roster_lists(team)
    pending = list(team.get("pendingRookieSignings") or [])
    team["pendingRookieSignings"] = []

    for player in pending:
        if not isinstance(player, dict):
            continue

        decision = _recommended_rookie_decision(player, team)
        if decision == "standard" and not can_add_standard_contract(team, phase = "offseason"):
            decision = "two_way" if can_add_two_way_contract(team, phase = "offseason") else "stash"
        if decision == "two_way" and not can_add_two_way_contract(team, phase = "offseason"):
            decision = "stash"
        if decision == "stash" and roster_counts(team)["controlledCount"] >= OFFSEASON_CONTROLLED_MAX:
            decision = "release"

        result = _apply_decision_to_player(
            league = league,
            team = team,
            player = player,
            decision = decision,
            season_year = season_year,
        )
        result["action"] = f"resolved_pending_rookie_{decision}"
        actions.append(result)

    return actions


def _is_standard_two_way_eligible_for_finalization(player: Dict[str, Any], season_year: int) -> bool:
    if not isinstance(player, dict):
        return False

    overall = _safe_int(player.get("overall"), 0)
    potential = _safe_int(player.get("potential"), overall)
    age = _safe_int(player.get("age"), 22)
    upside = potential - overall

    if overall >= 76:
        return False
    if overall >= 74 and potential >= 82:
        return False
    if age >= 25 and overall >= 72:
        return False

    rookie_year = None
    meta = player.get("meta") if isinstance(player.get("meta"), dict) else {}
    for value in [
        meta.get("nbaRookieSeasonYear"),
        player.get("nbaRookieSeasonYear"),
        meta.get("rookieYear"),
        player.get("rookieYear"),
        meta.get("rookieSeasonYear"),
        player.get("rookieSeasonYear"),
        meta.get("draftYear"),
        player.get("draftYear"),
        player.get("draftClassYear"),
    ]:
        year = _safe_int(value, 0)
        if 2020 <= year <= 2100:
            rookie_year = year
            break

    if rookie_year is not None:
        if int(season_year) - int(rookie_year) >= 3:
            return False
    elif _safe_int(meta.get("proSeasons") or player.get("proSeasons") or player.get("yearsPro"), 0) >= 3:
        return False

    return bool(overall <= 73 or (age <= 23 and overall <= 75 and upside <= 3))


def _move_standard_to_two_way_for_finalization(
    team: Dict[str, Any],
    player: Dict[str, Any],
    season_year: int,
) -> Dict[str, Any]:
    team_name = _team_name(team)
    key = player.get("id") or player.get("name")
    moved = copy.deepcopy(player)
    moved["previousStandardContract"] = copy.deepcopy(player.get("contract")) if isinstance(player.get("contract"), dict) else None
    moved["contract"] = _two_way_contract(season_year)
    moved["contractType"] = "two_way"
    moved["rosterStatus"] = "two_way"
    moved["assignmentStatus"] = "g_league"
    moved["team"] = team_name

    meta = moved.setdefault("meta", {})
    if isinstance(meta, dict):
        meta["cpuRosterFinalizationTwoWay"] = True
        meta["twoWayAssignedSeasonYear"] = season_year + 1

    moved["twoWayMeta"] = {
        **(moved.get("twoWayMeta") if isinstance(moved.get("twoWayMeta"), dict) else {}),
        "currentTwoWaySeasonYear": season_year + 1,
        "assignedSeasonYear": season_year + 1,
        "twoWayYearsUsed": max(1, _safe_int(moved.get("twoWayYearsUsed"), 1)),
        "maxTwoWayYears": 2,
        "source": "cpu_roster_finalization_two_way_conversion",
    }
    moved["twoWayYearsUsed"] = moved["twoWayMeta"]["twoWayYearsUsed"]
    moved["maxTwoWayYears"] = 2

    team["players"] = [
        p for p in (team.get("players") or [])
        if (p.get("id") or p.get("name")) != key
    ]
    _append_unique(team.setdefault("twoWayPlayers", []), moved)

    return {
        "playerId": moved.get("id"),
        "playerName": moved.get("name"),
        "teamName": team_name,
        "action": "standard_to_two_way",
        "overall": moved.get("overall"),
        "reason": "cpu_roster_finalization_two_way_conversion",
    }


def _auto_finalize_cpu_team(
    league: Dict[str, Any],
    team: Dict[str, Any],
    season_year: int,
) -> List[Dict[str, Any]]:
    actions = []
    normalize_team_roster_lists(team)

    actions.extend(_resolve_cpu_pending_rookies_for_finalization(league, team, season_year))
    normalize_team_roster_lists(team)

    # Too many two-way players: keep the best 3, release the rest.
    two_way = sorted(team.get("twoWayPlayers") or [], key = _player_keep_score, reverse = True)
    keep_two_way = two_way[:TWO_WAY_MAX]
    cut_two_way = two_way[TWO_WAY_MAX:]
    team["twoWayPlayers"] = keep_two_way
    for player in cut_two_way:
        actions.append(_release_player_to_free_agency(
            league = league,
            team_name = _team_name(team),
            player = player,
            season_year = season_year,
            reason = "two_way_roster_limit_release",
        ))

    normalize_team_roster_lists(team)

    # Too many standard players: first convert eligible young fringe players to
    # two-way, then cut only if the team is still over 15. This preserves useful
    # RFAs/Bird-rights signings while still making the team season-legal.
    safety = 0
    while (
        roster_counts(team)["standardCount"] > STANDARD_ROSTER_MAX
        and roster_counts(team)["twoWayCount"] < TWO_WAY_MAX
        and safety < 12
    ):
        safety += 1
        candidates = [
            player for player in (team.get("players") or [])
            if _is_standard_two_way_eligible_for_finalization(player, season_year)
        ]
        if not candidates:
            break

        candidates.sort(
            key = lambda player: (
                _player_keep_score(player),
                _safe_int(player.get("overall"), 0),
                _safe_int(player.get("potential"), 0),
            )
        )
        actions.append(_move_standard_to_two_way_for_finalization(team, candidates[0], season_year))
        normalize_team_roster_lists(team)

    # If still over 15, release the lowest-value fringe extras.
    while roster_counts(team)["standardCount"] > STANDARD_ROSTER_MAX:
        standard = sorted(team.get("players") or [], key = _player_keep_score, reverse = True)
        keep_standard = standard[:STANDARD_ROSTER_MAX]
        cut_standard = standard[STANDARD_ROSTER_MAX:]
        team["players"] = keep_standard
        for player in cut_standard:
            actions.append(_release_player_to_free_agency(
                league = league,
                team_name = _team_name(team),
                player = player,
                season_year = season_year,
                reason = "standard_roster_limit_release",
            ))
        normalize_team_roster_lists(team)

    # Too few standard players: promote best two-way first, then emergency-sign FAs.
    while roster_counts(team)["standardCount"] < STANDARD_ROSTER_MIN and team.get("twoWayPlayers"):
        team["twoWayPlayers"].sort(key = _player_keep_score, reverse = True)
        player = team["twoWayPlayers"].pop(0)
        actions.append(_promote_two_way_to_standard(team, player, season_year))
        normalize_team_roster_lists(team)

    safety = 0
    while roster_counts(team)["standardCount"] < STANDARD_ROSTER_MIN and safety < 8:
        safety += 1
        signed = _sign_replacement_free_agent(league, team, season_year)
        if not signed:
            break
        actions.append(signed)
        normalize_team_roster_lists(team)

    return actions

def _build_finalization_report(league: Dict[str, Any], user_team_name: Optional[str] = None) -> Dict[str, Any]:
    normalize_league_roster_lists(league)
    team_rows = []

    for team in _get_all_teams(league):
        counts = roster_counts(team)
        validation = validate_team_for_season_start(team)
        pending_count = counts.get("pendingRookiesCount", 0)
        errors = list(validation.get("errors") or [])

        if pending_count > 0:
            errors.append(f"Has {pending_count} pending rookie signing decision(s).")

        row = {
            **validation,
            "ok": len(errors) == 0,
            "errors": errors,
            "isUserTeam": bool(user_team_name and _team_name(team) == user_team_name),
        }
        team_rows.append(row)

    user_row = None
    if user_team_name:
        user_row = next((row for row in team_rows if row.get("teamName") == user_team_name), None)

    illegal_rows = [row for row in team_rows if not row.get("ok")]
    cpu_illegal_rows = [row for row in illegal_rows if not row.get("isUserTeam")]

    return {
        "teams": team_rows,
        "userTeam": user_row,
        "illegalTeams": illegal_rows,
        "cpuIllegalTeams": cpu_illegal_rows,
        "illegalTeamCount": len(illegal_rows),
        "cpuIllegalTeamCount": len(cpu_illegal_rows),
        "userTeamOk": True if user_row is None else bool(user_row.get("ok")),
        "rules": {
            "standardRosterMin": STANDARD_ROSTER_MIN,
            "standardRosterMax": STANDARD_ROSTER_MAX,
            "twoWayMax": TWO_WAY_MAX,
            "offseasonControlledMax": OFFSEASON_CONTROLLED_MAX,
        },
    }


def preview_roster_finalization(league_data: Dict[str, Any], payload: Dict[str, Any]) -> Dict[str, Any]:
    league = copy.deepcopy(_plain(league_data) or {})
    payload = _plain(payload) or {}
    user_team_name = payload.get("userTeamName") or payload.get("teamName")
    normalize_league_roster_lists(league)
    report = _build_finalization_report(league, user_team_name)

    return {
        "ok": True,
        "version": TEAM_ROSTER_LOGIC_VERSION,
        "leagueData": league,
        "summary": report,
    }


def apply_roster_finalization(league_data: Dict[str, Any], payload: Dict[str, Any]) -> Dict[str, Any]:
    league = copy.deepcopy(_plain(league_data) or {})
    payload = _plain(payload) or {}
    user_team_name = payload.get("userTeamName") or payload.get("teamName")
    season_year = _safe_int(payload.get("seasonYear") or league.get("seasonYear") or league.get("currentSeasonYear"), 2026)

    normalize_league_roster_lists(league)
    before = _build_finalization_report(league, user_team_name)

    # User roster overfill is allowed to carry into Calendar. We still finalize
    # CPU teams here, but the user's standard/two-way legality is enforced only
    # when they try to simulate games.
    actions = []
    for team in _get_all_teams(league):
        team_name = _team_name(team)
        if user_team_name and team_name == user_team_name:
            continue
        actions.extend(_auto_finalize_cpu_team(league, team, season_year))

    normalize_league_roster_lists(league)
    after = _build_finalization_report(league, user_team_name)

    # If a CPU team somehow remains illegal because the free-agent pool was empty,
    # report it clearly rather than silently advancing a broken league.
    unresolved_cpu = after.get("cpuIllegalTeams") or []
    if unresolved_cpu:
        return {
            "ok": False,
            "reason": "CPU_ROSTER_FINALIZATION_UNRESOLVED",
            "version": TEAM_ROSTER_LOGIC_VERSION,
            "leagueData": league,
            "summary": after,
            "actions": actions,
            "message": "CPU roster finalization could not fully repair every team.",
        }

    league.setdefault("rosterFinalizationState", {})
    league["rosterFinalizationState"].update({
        "complete": True,
        "seasonYear": season_year,
        "actions": actions,
        "summary": after,
        "version": TEAM_ROSTER_LOGIC_VERSION,
    })

    return {
        "ok": True,
        "version": TEAM_ROSTER_LOGIC_VERSION,
        "leagueData": league,
        "summary": after,
        "actions": actions,
        "complete": True,
        "message": "CPU roster finalization complete. User roster legality will be checked before Calendar simulation.",
    }


def handle_request(request: Dict[str, Any]) -> Dict[str, Any]:
    req = _plain(request) or {}
    action = req.get("action") or "preview_rookie_signings"
    league_data = req.get("leagueData") or req.get("league") or {}
    payload = req.get("payload") or {}

    if action == "preview_rookie_signings":
        return preview_rookie_signings(league_data, payload)

    if action == "apply_rookie_signings":
        return apply_rookie_signings(league_data, payload)

    if action == "get_roster_rules_summary":
        return get_roster_rules_summary(league_data, payload)

    if action == "preview_roster_finalization":
        return preview_roster_finalization(league_data, payload)

    if action == "apply_roster_finalization":
        return apply_roster_finalization(league_data, payload)

    return {
        "ok": False,
        "reason": f"UNKNOWN_TEAM_ROSTER_ACTION: {action}",
        "version": TEAM_ROSTER_LOGIC_VERSION,
    }




