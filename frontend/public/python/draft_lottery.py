"""
draft_lottery.py
Basketball Manager NBA Draft Lottery logic.

This file supports:
- 2026 draft/offseason: legacy 14-team NBA lottery.
- 2027+ draft/offseason: NBA 3-2-1 lottery.
- Dev override through payload.lotterySystem / payload.forceLotterySystem.
"""

from __future__ import annotations

import copy
import random
import time
from typing import Any, Dict, List, Optional, Tuple

DRAFT_LOTTERY_VERSION = "2026-05-29_lottery_hybrid_2026_old_2027_321"

# Legacy 14-team NBA lottery odds by combinations.
# Top 4 picks are drawn, picks 5-14 fall by inverse record.
LOTTERY_COMBINATIONS = [
    140,
    140,
    140,
    125,
    105,
    90,
    75,
    60,
    45,
    30,
    20,
    15,
    10,
    5,
]


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
    return total or 20260529


def _get_season_year(league: Dict[str, Any], payload: Dict[str, Any]) -> int:
    for value in [
        payload.get("seasonYear"),
        league.get("seasonYear"),
        league.get("currentSeasonYear"),
        league.get("seasonStartYear"),
    ]:
        year = _safe_int(value, 0)
        if 2020 <= year <= 2100:
            return year
    return 2026


def _normalize_lottery_system(value: Any, season_year: int) -> str:
    raw = str(value or "auto").strip().lower()

    if raw in {"old", "legacy", "legacy_14", "2026", "old_14", "modern_old"}:
        return "legacy_14"
    if raw in {"321", "3-2-1", "three_two_one", "three-two-one", "new", "new_321"}:
        return "three_two_one"

    # Real-life timing: the 2026 Draft Lottery was the last legacy lottery.
    # The 3-2-1 Lottery starts with the 2027 NBA Draft.
    if season_year >= 2027:
        return "three_two_one"
    return "legacy_14"


def _get_all_teams(league: Dict[str, Any]) -> List[Dict[str, Any]]:
    if isinstance(league.get("teams"), list):
        return league.get("teams") or []

    conferences = league.get("conferences") or {}
    teams: List[Dict[str, Any]] = []

    if isinstance(conferences, dict):
        for conf_name, conf_teams in conferences.items():
            for team in conf_teams or []:
                if isinstance(team, dict):
                    row = team
                    row.setdefault("conference", conf_name)
                    teams.append(row)

    return teams


def _team_logo_from_league(league: Dict[str, Any], team_name: str) -> str:
    for team in _get_all_teams(league):
        if team.get("name") == team_name or team.get("teamName") == team_name:
            return (
                team.get("logo")
                or team.get("teamLogo")
                or team.get("newTeamLogo")
                or team.get("logoUrl")
                or team.get("image")
                or team.get("img")
                or ""
            )
    return ""


def _latest_history_entry(league: Dict[str, Any], season_year: int) -> Optional[Dict[str, Any]]:
    history = league.get("seasonHistory") or []
    if not isinstance(history, list):
        return None

    matches = [
        row
        for row in history
        if isinstance(row, dict) and _safe_int(row.get("seasonYear"), 0) == season_year
    ]

    if matches:
        complete = [row for row in matches if row.get("status") == "complete"]
        return complete[-1] if complete else matches[-1]

    valid = [
        row
        for row in history
        if isinstance(row, dict) and isinstance(row.get("teams"), list)
    ]

    if not valid:
        return None

    return sorted(valid, key = lambda row: _safe_int(row.get("seasonYear"), 0))[-1]


def _extract_conference_seed(row: Dict[str, Any]) -> Optional[int]:
    for key in [
        "conferenceSeed",
        "confSeed",
        "seed",
        "regularSeasonConferenceSeed",
        "playInSeed",
    ]:
        value = row.get(key)
        seed = _safe_int(value, 0)
        if 1 <= seed <= 15:
            return seed
    return None


def _normalize_record_row(
    row: Dict[str, Any],
    league: Dict[str, Any],
    index: int,
) -> Dict[str, Any]:
    team_name = (
        row.get("teamName")
        or row.get("team")
        or row.get("name")
        or row.get("team_name")
        or f"Team {index + 1}"
    )

    wins = _safe_int(row.get("wins"), 0)
    losses = _safe_int(row.get("losses"), 0)
    games = wins + losses
    win_pct = _safe_float(row.get("winPct"), wins / games if games else 0.0)

    logo = (
        row.get("logo")
        or row.get("teamLogo")
        or row.get("newTeamLogo")
        or row.get("logoUrl")
        or row.get("image")
        or row.get("img")
        or _team_logo_from_league(league, team_name)
    )

    made_playoffs = bool(row.get("madePlayoffs"))
    made_play_in = bool(row.get("madePlayIn"))
    conference_seed = _extract_conference_seed(row)
    playoff_result = row.get("playoffResult") or ("playoffs" if made_playoffs else "missed_playoffs")

    return {
        **row,
        "teamName": team_name,
        "currentOwnerTeamName": team_name,
        "originalTeamName": team_name,
        "conference": row.get("conference") or row.get("conf") or None,
        "wins": wins,
        "losses": losses,
        "gamesPlayed": games,
        "winPct": round(win_pct, 3),
        "leagueRank": _safe_int(row.get("leagueRank"), index + 1),
        "conferenceSeed": conference_seed,
        "madePlayoffs": made_playoffs,
        "madePlayIn": made_play_in,
        "playoffResult": playoff_result,
        "pointDifferential": _safe_int(row.get("pointDifferential"), 0),
        "logo": logo,
    }


def _records_from_payload_or_history(
    league: Dict[str, Any],
    payload: Dict[str, Any],
    season_year: int,
) -> Tuple[List[Dict[str, Any]], str]:
    payload_records = payload.get("teamRecords")
    if isinstance(payload_records, list) and payload_records:
        return [
            _normalize_record_row(row, league, i)
            for i, row in enumerate(payload_records)
            if isinstance(row, dict)
        ], "payload_team_records"

    latest = _latest_history_entry(league, season_year)
    if latest and isinstance(latest.get("teams"), list) and latest.get("teams"):
        return [
            _normalize_record_row(row, league, i)
            for i, row in enumerate(latest.get("teams") or [])
            if isinstance(row, dict)
        ], "season_history"

    teams = _get_all_teams(league)
    fallback = []
    for i, team in enumerate(teams):
        fallback.append(
            _normalize_record_row(
                {
                    "teamName": team.get("name") or team.get("teamName") or f"Team {i + 1}",
                    "wins": _safe_int(team.get("wins"), 0),
                    "losses": _safe_int(team.get("losses"), 0),
                    "madePlayoffs": False,
                    "playoffResult": "unknown",
                },
                league,
                i,
            )
        )

    return fallback, "league_teams_fallback"


def _record_sort_key_worst_first(row: Dict[str, Any]) -> Tuple[float, int, str]:
    wins = _safe_int(row.get("wins"), 0)
    losses = _safe_int(row.get("losses"), 0)
    games = wins + losses
    win_pct = wins / games if games else 0.0

    return (
        win_pct,
        _safe_int(row.get("pointDifferential"), 0),
        str(row.get("teamName") or ""),
    )


def _record_sort_key_best_first(row: Dict[str, Any]) -> Tuple[float, int, str]:
    wins = _safe_int(row.get("wins"), 0)
    losses = _safe_int(row.get("losses"), 0)
    games = wins + losses
    win_pct = wins / games if games else 0.0

    return (
        -win_pct,
        -_safe_int(row.get("pointDifferential"), 0),
        str(row.get("teamName") or ""),
    )


def _weighted_draw_without_replacement(
    teams: List[Dict[str, Any]],
    weights: List[int],
    draw_count: int,
    rng: random.Random,
) -> List[Dict[str, Any]]:
    remaining = [
        {
            "team": team,
            "weight": max(1, _safe_int(weights[i], 1)),
        }
        for i, team in enumerate(teams)
    ]

    drawn = []

    while remaining and len(drawn) < draw_count:
        total = sum(row["weight"] for row in remaining)
        ticket = rng.uniform(0, total)
        running = 0.0
        selected_index = 0

        for i, row in enumerate(remaining):
            running += row["weight"]
            if ticket <= running:
                selected_index = i
                break

        picked = remaining.pop(selected_index)
        drawn.append(picked["team"])

    return drawn


def _make_pick_row(
    pick_number: int,
    round_number: int,
    pick_in_round: int,
    team: Dict[str, Any],
    source: str,
    lottery_seed: Optional[int] = None,
) -> Dict[str, Any]:
    team_name = team.get("teamName") or team.get("name") or ""

    return {
        "pick": pick_number,
        "round": round_number,
        "pickInRound": pick_in_round,
        "teamName": team_name,
        "currentOwnerTeamName": team_name,
        "originalTeamName": team_name,
        "wins": _safe_int(team.get("wins"), 0),
        "losses": _safe_int(team.get("losses"), 0),
        "winPct": _safe_float(team.get("winPct"), 0.0),
        "madePlayoffs": bool(team.get("madePlayoffs")),
        "madePlayIn": bool(team.get("madePlayIn")),
        "playoffResult": team.get("playoffResult") or "",
        "leagueRank": team.get("leagueRank"),
        "conferenceSeed": team.get("conferenceSeed"),
        "logo": team.get("logo") or "",
        "source": source,
        "lotterySeed": lottery_seed,
        "lotteryBalls": team.get("lotteryBalls"),
        "lotteryCategory": team.get("lotteryCategory"),
    }


def _team_name_set(rows: List[Dict[str, Any]]) -> set:
    return {row.get("teamName") for row in rows if row.get("teamName")}


def _dedupe_by_team(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen = set()
    out = []
    for row in rows:
        name = row.get("teamName")
        if not name or name in seen:
            continue
        seen.add(name)
        out.append(row)
    return out


def _row_text_blob(row: Dict[str, Any]) -> str:
    keys = [
        "playInResult",
        "playInOutcome",
        "playInGameResult",
        "playInPath",
        "playoffResult",
        "postseasonResult",
        "status",
    ]
    return " ".join(str(row.get(key) or "") for key in keys).lower().replace("-", "_").replace(" ", "_")


def _is_explicit_78_loser(row: Dict[str, Any]) -> bool:
    if bool(row.get("lostSevenEightGame")) or bool(row.get("lost78Game")) or bool(row.get("lost7v8Game")):
        return True

    blob = _row_text_blob(row)
    has_78 = any(token in blob for token in ["7_8", "7v8", "7_vs_8", "seven_eight", "seven_vs_eight"])
    has_loss = any(token in blob for token in ["lost", "loser", "loss"])
    return has_78 and has_loss


def _select_78_losers(records: List[Dict[str, Any]], rng: random.Random) -> List[Dict[str, Any]]:
    by_conf: Dict[str, List[Dict[str, Any]]] = {}
    for row in records:
        conf = str(row.get("conference") or "league")
        by_conf.setdefault(conf, []).append(row)

    losers = []

    for conf_rows in by_conf.values():
        seed_78 = [
            row
            for row in conf_rows
            if _safe_int(row.get("conferenceSeed"), 0) in {7, 8}
        ]

        explicit = [row for row in seed_78 if _is_explicit_78_loser(row)]
        if explicit:
            losers.append(sorted(explicit, key = _record_sort_key_worst_first)[0])
            continue

        missed = [row for row in seed_78 if not bool(row.get("madePlayoffs"))]
        if missed:
            losers.append(sorted(missed, key = _record_sort_key_worst_first)[0])
            continue

        seed_8 = [row for row in seed_78 if _safe_int(row.get("conferenceSeed"), 0) == 8]
        if seed_8:
            losers.append(seed_8[0])
            continue

        if seed_78:
            losers.append(sorted(seed_78, key = _record_sort_key_worst_first)[-1])

    return _dedupe_by_team(losers)[:2]


def _apply_pick_restrictions(order: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    # This supports the new rule when your save data carries restriction flags.
    # If the data is not present, it becomes a no-op.
    order = list(order)

    def no_first(team: Dict[str, Any]) -> bool:
        return bool(
            team.get("noConsecutiveFirstPick")
            or team.get("cannotPickFirst")
            or team.get("wonFirstPickLastDraft")
        )

    def no_top_five(team: Dict[str, Any]) -> bool:
        return bool(
            team.get("noThirdStraightTopFive")
            or team.get("cannotPickTopFive")
            or team.get("topFiveLastTwoDrafts")
        )

    if order and no_first(order[0]):
        for i in range(1, len(order)):
            if not no_first(order[i]):
                order[0], order[i] = order[i], order[0]
                break

    for i in range(min(5, len(order))):
        if not no_top_five(order[i]):
            continue

        for j in range(5, len(order)):
            if not no_top_five(order[j]):
                order[i], order[j] = order[j], order[i]
                break

    return order


def _enforce_321_relegated_floor(order: List[Dict[str, Any]], relegated_names: set) -> List[Dict[str, Any]]:
    order = list(order)

    # Draft-relegated teams cannot fall past pick 12.
    # If one lands below 12 in the draw, move it up to pick 12 and shift others down.
    for _ in range(20):
        violation = None
        for index, team in enumerate(order):
            if team.get("teamName") in relegated_names and index > 11:
                violation = (index, team)
                break

        if violation is None:
            break

        index, team = violation
        order.pop(index)
        order.insert(11, team)

    return order


def _run_legacy_14_lottery(
    records: List[Dict[str, Any]],
    source: str,
    season_year: int,
    seed_number: int,
    rng: random.Random,
) -> Dict[str, Any]:
    lottery_teams = [row for row in records if not bool(row.get("madePlayoffs"))]

    if len(lottery_teams) != 14:
        sorted_worst = sorted(records, key = _record_sort_key_worst_first)
        lottery_teams = sorted_worst[:14]

    lottery_teams = sorted(lottery_teams, key = _record_sort_key_worst_first)[:14]

    playoff_teams = [
        row
        for row in records
        if row.get("teamName") not in _team_name_set(lottery_teams)
    ]
    playoff_teams = sorted(playoff_teams, key = _record_sort_key_worst_first)

    weights = LOTTERY_COMBINATIONS[:len(lottery_teams)]
    top_four = _weighted_draw_without_replacement(
        lottery_teams,
        weights,
        min(4, len(lottery_teams)),
        rng,
    )

    top_four_names = _team_name_set(top_four)
    remaining_lottery = [
        team
        for team in lottery_teams
        if team.get("teamName") not in top_four_names
    ]
    remaining_lottery = sorted(remaining_lottery, key = _record_sort_key_worst_first)

    first_round_order = (top_four + remaining_lottery + playoff_teams)[:30]
    all_teams_inverse = sorted(records, key = _record_sort_key_worst_first)[:30]

    first_round_picks = []
    second_round_picks = []

    for index, team in enumerate(first_round_order):
        pick_number = index + 1
        if index < 4:
            source_label = "lottery_drawn_top_4"
        elif pick_number <= 14:
            source_label = "lottery_inverse_record"
        else:
            source_label = "playoff_inverse_record"

        first_round_picks.append(
            _make_pick_row(
                pick_number = pick_number,
                round_number = 1,
                pick_in_round = pick_number,
                team = team,
                source = source_label,
                lottery_seed = seed_number,
            )
        )

    for index, team in enumerate(all_teams_inverse):
        pick_number = index + 31
        second_round_picks.append(
            _make_pick_row(
                pick_number = pick_number,
                round_number = 2,
                pick_in_round = index + 1,
                team = team,
                source = "second_round_inverse_record",
                lottery_seed = seed_number,
            )
        )

    lottery_summary = []
    for i, team in enumerate(lottery_teams):
        lottery_summary.append(
            {
                "lotterySeed": i + 1,
                "teamName": team.get("teamName"),
                "wins": team.get("wins"),
                "losses": team.get("losses"),
                "winPct": team.get("winPct"),
                "combinations": LOTTERY_COMBINATIONS[i] if i < len(LOTTERY_COMBINATIONS) else 1,
                "lotteryBalls": LOTTERY_COMBINATIONS[i] if i < len(LOTTERY_COMBINATIONS) else 1,
                "lotteryCategory": "legacy_14",
                "logo": team.get("logo") or "",
            }
        )

    drawn_summary = []
    for i, team in enumerate(top_four):
        drawn_summary.append(
            {
                "pick": i + 1,
                "teamName": team.get("teamName"),
                "wins": team.get("wins"),
                "losses": team.get("losses"),
                "logo": team.get("logo") or "",
            }
        )

    return {
        "ok": True,
        "version": DRAFT_LOTTERY_VERSION,
        "seasonYear": season_year,
        "source": source,
        "lotteryTeams": lottery_summary,
        "topFourDrawn": drawn_summary,
        "firstRoundOrder": first_round_picks,
        "secondRoundOrder": second_round_picks,
        "fullDraftOrder": first_round_picks + second_round_picks,
        "meta": {
            "system": "legacy_14",
            "systemLabel": "2026 legacy NBA lottery",
            "rules": "Legacy NBA lottery: 14 teams, top 4 picks drawn, picks 5-14 by inverse record.",
            "lotteryCombinations": LOTTERY_COMBINATIONS,
            "seed": str(seed_number),
        },
    }


def _run_three_two_one_lottery(
    records: List[Dict[str, Any]],
    source: str,
    season_year: int,
    seed_number: int,
    rng: random.Random,
) -> Dict[str, Any]:
    sorted_worst = sorted(records, key = _record_sort_key_worst_first)

    seed_9_10 = [
        row
        for row in records
        if _safe_int(row.get("conferenceSeed"), 0) in {9, 10}
    ]

    seven_eight_losers = _select_78_losers(records, rng)
    seven_eight_loser_names = _team_name_set(seven_eight_losers)

    non_playin_missed = [
        row
        for row in records
        if (
            not bool(row.get("madePlayoffs"))
            and _safe_int(row.get("conferenceSeed"), 99) > 10
        )
    ]

    if len(non_playin_missed) < 10:
        fill_names = _team_name_set(non_playin_missed) | _team_name_set(seed_9_10) | seven_eight_loser_names
        for row in sorted_worst:
            name = row.get("teamName")
            seed = _safe_int(row.get("conferenceSeed"), 99)
            if not name or name in fill_names:
                continue
            if bool(row.get("madePlayoffs")) and seed <= 6:
                continue
            if seed in {7, 8, 9, 10}:
                continue
            non_playin_missed.append(row)
            fill_names.add(name)
            if len(non_playin_missed) >= 10:
                break

    non_playin_missed = sorted(_dedupe_by_team(non_playin_missed), key = _record_sort_key_worst_first)[:10]
    draft_relegated = sorted(non_playin_missed, key = _record_sort_key_worst_first)[:3]
    draft_relegated_names = _team_name_set(draft_relegated)

    lottery_pool = []
    lottery_pool.extend(non_playin_missed)
    lottery_pool.extend(seed_9_10)
    lottery_pool.extend(seven_eight_losers)
    lottery_pool = _dedupe_by_team(lottery_pool)

    if len(lottery_pool) < 16:
        existing = _team_name_set(lottery_pool)
        for row in sorted_worst:
            name = row.get("teamName")
            if not name or name in existing:
                continue
            lottery_pool.append(row)
            existing.add(name)
            if len(lottery_pool) >= 16:
                break

    lottery_pool = lottery_pool[:16]

    pool_names = _team_name_set(lottery_pool)
    lottery_teams = []
    weights = []

    for team in lottery_pool:
        name = team.get("teamName")
        seed = _safe_int(team.get("conferenceSeed"), 0)

        if name in seven_eight_loser_names:
            balls = 1
            category = "three_two_one_7_8_play_in_loser"
        elif seed in {9, 10}:
            balls = 2
            category = "three_two_one_9_10_play_in_seed"
        elif name in draft_relegated_names:
            balls = 2
            category = "three_two_one_draft_relegated"
        else:
            balls = 3
            category = "three_two_one_non_play_in_missed"

        team_with_balls = {
            **team,
            "lotteryBalls": balls,
            "lotteryCategory": category,
        }
        lottery_teams.append(team_with_balls)
        weights.append(balls)

    # Sort display by category/record, but draw by weighted random.
    drawn_16 = _weighted_draw_without_replacement(
        lottery_teams,
        weights,
        min(16, len(lottery_teams)),
        rng,
    )

    drawn_16 = _apply_pick_restrictions(drawn_16)
    drawn_16 = _enforce_321_relegated_floor(drawn_16, draft_relegated_names)

    remaining_teams = [
        row
        for row in records
        if row.get("teamName") not in pool_names
    ]
    remaining_teams = sorted(remaining_teams, key = _record_sort_key_worst_first)

    first_round_order = (drawn_16 + remaining_teams)[:30]
    all_teams_inverse = sorted(records, key = _record_sort_key_worst_first)[:30]

    first_round_picks = []
    second_round_picks = []

    for index, team in enumerate(first_round_order):
        pick_number = index + 1
        if pick_number <= 16:
            source_label = team.get("lotteryCategory") or "three_two_one_lottery_drawn"
        else:
            source_label = "non_lottery_inverse_record"

        first_round_picks.append(
            _make_pick_row(
                pick_number = pick_number,
                round_number = 1,
                pick_in_round = pick_number,
                team = team,
                source = source_label,
                lottery_seed = seed_number,
            )
        )

    for index, team in enumerate(all_teams_inverse):
        pick_number = index + 31
        second_round_picks.append(
            _make_pick_row(
                pick_number = pick_number,
                round_number = 2,
                pick_in_round = index + 1,
                team = team,
                source = "second_round_inverse_record",
                lottery_seed = seed_number,
            )
        )

    lottery_summary = []
    for i, team in enumerate(sorted(lottery_teams, key = _record_sort_key_worst_first)):
        lottery_summary.append(
            {
                "lotterySeed": i + 1,
                "teamName": team.get("teamName"),
                "wins": team.get("wins"),
                "losses": team.get("losses"),
                "winPct": team.get("winPct"),
                "conferenceSeed": team.get("conferenceSeed"),
                "lotteryBalls": team.get("lotteryBalls"),
                "combinations": team.get("lotteryBalls"),
                "lotteryCategory": team.get("lotteryCategory"),
                "logo": team.get("logo") or "",
            }
        )

    drawn_summary = []
    for i, team in enumerate(drawn_16):
        drawn_summary.append(
            {
                "pick": i + 1,
                "teamName": team.get("teamName"),
                "wins": team.get("wins"),
                "losses": team.get("losses"),
                "conferenceSeed": team.get("conferenceSeed"),
                "lotteryBalls": team.get("lotteryBalls"),
                "lotteryCategory": team.get("lotteryCategory"),
                "logo": team.get("logo") or "",
            }
        )

    return {
        "ok": True,
        "version": DRAFT_LOTTERY_VERSION,
        "seasonYear": season_year,
        "source": source,
        "lotteryTeams": lottery_summary,
        "topFourDrawn": drawn_summary[:4],
        "topSixteenDrawn": drawn_summary,
        "firstRoundOrder": first_round_picks,
        "secondRoundOrder": second_round_picks,
        "fullDraftOrder": first_round_picks + second_round_picks,
        "meta": {
            "system": "three_two_one",
            "systemLabel": "3-2-1 NBA lottery",
            "rules": "3-2-1 Lottery: 16 teams drawn; non-play-in misses get 3 balls except the 3 worst draft-relegated teams get 2, 9/10 play-in seeds get 2, 7/8 play-in losers get 1.",
            "lotteryBalls": "3-2-1",
            "draftRelegatedTeams": sorted(list(draft_relegated_names)),
            "seed": str(seed_number),
        },
    }


def run_draft_lottery(league_data: Dict[str, Any], payload: Dict[str, Any]) -> Dict[str, Any]:
    league = copy.deepcopy(_plain(league_data) or {})
    payload = _plain(payload) or {}

    season_year = _get_season_year(league, payload)
    requested_system = (
        payload.get("forceLotterySystem")
        or payload.get("lotterySystem")
        or payload.get("system")
        or "auto"
    )
    lottery_system = _normalize_lottery_system(requested_system, season_year)

    seed_value = payload.get("seed")
    if seed_value is None:
        seed_value = f"{season_year}_{lottery_system}_{time.time_ns()}_{random.random()}"

    seed_number = _stable_seed(seed_value, season_year, lottery_system)
    rng = random.Random(seed_number)

    records, source = _records_from_payload_or_history(league, payload, season_year)
    records = [row for row in records if row.get("teamName")]

    if len(records) < 30:
        return {
            "ok": False,
            "reason": f"NOT_ENOUGH_TEAM_RECORDS: {len(records)}",
            "version": DRAFT_LOTTERY_VERSION,
            "seasonYear": season_year,
            "source": source,
            "meta": {
                "system": lottery_system,
                "requestedSystem": str(requested_system),
            },
        }

    records = sorted(records, key = _record_sort_key_best_first)

    if lottery_system == "three_two_one":
        result = _run_three_two_one_lottery(records, source, season_year, seed_number, rng)
    else:
        result = _run_legacy_14_lottery(records, source, season_year, seed_number, rng)

    result["meta"] = {
        **(result.get("meta") or {}),
        "requestedSystem": str(requested_system),
        "autoResolvedSystem": lottery_system,
    }

    return result


def handle_request(request: Dict[str, Any]) -> Dict[str, Any]:
    req = _plain(request) or {}

    action = req.get("action") or "run_draft_lottery"
    league_data = req.get("leagueData") or req.get("league") or {}
    payload = req.get("payload") or {}

    if action in {"run_draft_lottery", "draft_lottery", "generate_draft_lottery"}:
        return run_draft_lottery(league_data, payload)

    return {
        "ok": False,
        "reason": f"UNKNOWN_DRAFT_LOTTERY_ACTION: {action}",
        "version": DRAFT_LOTTERY_VERSION,
    }
