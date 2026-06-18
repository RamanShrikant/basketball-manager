"""
draft_lottery.py
Basketball Manager NBA Draft Lottery logic.

This file supports:
- 2026 draft/offseason: legacy 14-team NBA lottery.
- 2027+ draft/offseason: NBA 3-2-1 lottery.
- Dev override through payload.lotterySystem / payload.forceLotterySystem.

Returned payload intentionally includes both the locked draft order and the
pre-reveal odds/matrix data that DraftLottery.jsx uses for the UI.
"""

from __future__ import annotations

import copy
import random
import time
from typing import Any, Dict, List, Optional, Tuple

DRAFT_LOTTERY_VERSION = "2026-06-18_lottery_clean_display_rank_v6"

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

# Keep this high enough for a stable matrix, but low enough for Pyodide to stay
# snappy while the page generates hidden lottery data before reveal.
ODDS_SIMULATION_COUNT = 8000


# ------------------------------------------------------------
# Small helpers
# ------------------------------------------------------------
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


def _round_pct(value: float) -> float:
    return round(float(value or 0.0), 3)


def _team_name(row: Dict[str, Any]) -> str:
    return str(row.get("teamName") or row.get("name") or row.get("team") or "").strip()


def _team_name_set(rows: List[Dict[str, Any]]) -> set:
    return {_team_name(row) for row in rows if _team_name(row)}


def _dedupe_by_team(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen = set()
    out = []
    for row in rows or []:
        name = _team_name(row)
        if not name or name in seen:
            continue
        seen.add(name)
        out.append(row)
    return out


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


# ------------------------------------------------------------
# Records / standings input
# ------------------------------------------------------------
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

    return sorted(valid, key=lambda row: _safe_int(row.get("seasonYear"), 0))[-1]


def _extract_conference_seed(row: Dict[str, Any]) -> Optional[int]:
    for key in [
        "conferenceSeed",
        "confSeed",
        "seed",
        "regularSeasonConferenceSeed",
        "playInSeed",
    ]:
        seed = _safe_int(row.get(key), 0)
        if 1 <= seed <= 15:
            return seed
    return None


def _normalize_record_row(row: Dict[str, Any], league: Dict[str, Any], index: int) -> Dict[str, Any]:
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
    conference_seed = _extract_conference_seed(row)
    made_playoffs = bool(row.get("madePlayoffs"))
    made_play_in = bool(row.get("madePlayIn")) or bool(conference_seed and 7 <= conference_seed <= 10)

    logo = (
        row.get("logo")
        or row.get("teamLogo")
        or row.get("newTeamLogo")
        or row.get("logoUrl")
        or row.get("image")
        or row.get("img")
        or _team_logo_from_league(league, team_name)
    )

    playoff_result = row.get("playoffResult") or ("playoffs" if made_playoffs else "missed_playoffs")

    return {
        **row,
        "teamName": team_name,
        "currentOwnerTeamName": row.get("currentOwnerTeamName") or team_name,
        "originalTeamName": row.get("originalTeamName") or team_name,
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
        "pointDifferential": _safe_int(row.get("pointDifferential", row.get("netRating", 0)), 0),
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

    fallback = []
    for i, team in enumerate(_get_all_teams(league)):
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
    return (win_pct, _safe_int(row.get("pointDifferential"), 0), _team_name(row))


def _record_sort_key_best_first(row: Dict[str, Any]) -> Tuple[float, int, str]:
    wins = _safe_int(row.get("wins"), 0)
    losses = _safe_int(row.get("losses"), 0)
    games = wins + losses
    win_pct = wins / games if games else 0.0
    return (-win_pct, -_safe_int(row.get("pointDifferential"), 0), _team_name(row))


# ------------------------------------------------------------
# Lottery draw + pick row helpers
# ------------------------------------------------------------
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
    team_name = _team_name(team)
    return {
        "pick": pick_number,
        "round": round_number,
        "pickInRound": pick_in_round,
        "teamName": team_name,
        "currentOwnerTeamName": team.get("currentOwnerTeamName") or team_name,
        "originalTeamName": team.get("originalTeamName") or team_name,
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
        "lotterySeed": team.get("lotterySeed") or team.get("projectedPick") or None,
        "lotteryBalls": team.get("lotteryBalls"),
        "lotteryCategory": team.get("lotteryCategory"),
        "lotterySeedValue": lottery_seed,
    }


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


def _select_78_losers(records: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    by_conf: Dict[str, List[Dict[str, Any]]] = {}
    for row in records:
        conf = str(row.get("conference") or "league")
        by_conf.setdefault(conf, []).append(row)

    losers = []

    for conf_rows in by_conf.values():
        seed_78 = [row for row in conf_rows if _safe_int(row.get("conferenceSeed"), 0) in {7, 8}]
        explicit = [row for row in seed_78 if _is_explicit_78_loser(row)]
        if explicit:
            losers.append(sorted(explicit, key=_record_sort_key_worst_first)[0])
            continue

        # Fallback when old saves do not carry the exact play-in path.
        missed = [row for row in seed_78 if not bool(row.get("madePlayoffs"))]
        if missed:
            losers.append(sorted(missed, key=_record_sort_key_worst_first)[0])
            continue

        seed_8 = [row for row in seed_78 if _safe_int(row.get("conferenceSeed"), 0) == 8]
        if seed_8:
            losers.append(seed_8[0])
        elif seed_78:
            losers.append(sorted(seed_78, key=_record_sort_key_worst_first)[-1])

    return _dedupe_by_team(losers)[:2]


def _apply_pick_restrictions(order: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    # This supports the new rule when save data carries restriction flags.
    # If the data is not present, it is a no-op.
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
    # Draft-relegated teams cannot fall past pick 12. If a relegated team lands
    # below 12, swap it with the lowest non-relegated team currently inside the
    # top 12. Swapping avoids the old insert/shift loop where one relegated team
    # could push another back to pick 13.
    for _ in range(20):
        violation_index = None
        for index, team in enumerate(order):
            if _team_name(team) in relegated_names and index > 11:
                violation_index = index
                break

        if violation_index is None:
            break

        swap_index = None
        for index in range(min(11, len(order) - 1), -1, -1):
            if _team_name(order[index]) not in relegated_names:
                swap_index = index
                break

        if swap_index is None:
            break

        order[swap_index], order[violation_index] = order[violation_index], order[swap_index]

    return order


# ------------------------------------------------------------
# Odds matrix helpers
# ------------------------------------------------------------
def _empty_counts(team_names: List[str], max_pick: int) -> Dict[str, Dict[int, int]]:
    return {name: {pick: 0 for pick in range(1, max_pick + 1)} for name in team_names}


def _counts_to_pct_map(counts: Dict[int, int], total: int, max_pick: int) -> Dict[str, float]:
    denom = max(1, int(total or 1))
    return {str(pick): _round_pct((counts.get(pick, 0) / denom) * 100.0) for pick in range(1, max_pick + 1)}


def _matrix_row_from_counts(
    team: Dict[str, Any],
    counts: Dict[int, int],
    total: int,
    max_pick: int,
    projected_pick: int,
    final_pick: Optional[int] = None,
) -> Dict[str, Any]:
    odds_by_pick = _counts_to_pct_map(counts, total, max_pick)
    possible = [(pick, pct) for pick, pct in ((p, odds_by_pick[str(p)]) for p in range(1, max_pick + 1)) if pct > 0]
    if possible:
        best_pick = min(pick for pick, _ in possible)
        worst_pick = max(pick for pick, _ in possible)
        most_likely_pick, most_likely_pct = max(possible, key=lambda item: (item[1], -item[0]))
    else:
        best_pick = projected_pick
        worst_pick = projected_pick
        most_likely_pick = projected_pick
        most_likely_pct = 0.0

    average_pick = 0.0
    for pick in range(1, max_pick + 1):
        average_pick += pick * (odds_by_pick[str(pick)] / 100.0)

    # User-facing Expected Pick is intentionally the clean pre-lottery projection
    # slot, not the math average. The matrix still exposes averagePick and
    # mostLikelyPick for deeper context.
    expected_pick = int(projected_pick or most_likely_pick or best_pick or 0)

    actual_pick_odds = odds_by_pick.get(str(final_pick), 0.0) if final_pick else 0.0
    first_pick_odds = odds_by_pick.get("1", 0.0)
    top_four_odds = sum(odds_by_pick.get(str(pick), 0.0) for pick in range(1, min(4, max_pick) + 1))

    row = {
        "teamName": _team_name(team),
        "currentOwnerTeamName": team.get("currentOwnerTeamName") or _team_name(team),
        "originalTeamName": team.get("originalTeamName") or _team_name(team),
        "wins": _safe_int(team.get("wins"), 0),
        "losses": _safe_int(team.get("losses"), 0),
        "winPct": _safe_float(team.get("winPct"), 0.0),
        "leagueRank": team.get("leagueRank"),
        "conferenceSeed": team.get("conferenceSeed"),
        "madePlayoffs": bool(team.get("madePlayoffs")),
        "madePlayIn": bool(team.get("madePlayIn")),
        "playoffResult": team.get("playoffResult") or "",
        "logo": team.get("logo") or "",
        "lotterySeed": projected_pick,
        "projectedPick": projected_pick,
        "expectedPick": expected_pick,
        "expectedPickMode": "pre_lottery_slot",
        "averagePick": round(average_pick, 2),
        "avgPick": round(average_pick, 2),
        "mostLikelyPick": most_likely_pick,
        "mostLikelyPickOddsPct": _round_pct(most_likely_pct),
        "bestPick": best_pick,
        "worstPick": worst_pick,
        "firstPickOddsPct": _round_pct(first_pick_odds),
        "topFourOddsPct": _round_pct(top_four_odds),
        "oddsByPick": odds_by_pick,
        "finalPick": final_pick or None,
        "actualPickOddsPct": _round_pct(actual_pick_odds),
        "pickChange": int(projected_pick - final_pick) if final_pick else 0,
        "simulationCount": total,
        "lotteryBalls": team.get("lotteryBalls"),
        "combinations": team.get("combinations") or team.get("lotteryBalls"),
        "lotteryCategory": team.get("lotteryCategory"),
    }

    if final_pick:
        change = projected_pick - final_pick
        if change >= 5:
            tag = "Huge jump"
        elif change > 0:
            tag = "Jumped"
        elif change == 0:
            tag = "Held"
        elif change <= -5:
            tag = "Big fall"
        else:
            tag = "Fell"
        row["resultTag"] = tag

    return row


def _attach_pick_context(picks: List[Dict[str, Any]], odds_rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    by_team = {_team_name(row): row for row in odds_rows}
    out = []
    for pick in picks or []:
        row = by_team.get(_team_name(pick))
        if not row:
            out.append(pick)
            continue
        out.append(
            {
                **pick,
                "projectedPick": row.get("projectedPick"),
                "expectedPick": row.get("expectedPick"),
                "actualPickOddsPct": row.get("actualPickOddsPct"),
                "pickChange": row.get("pickChange"),
                "resultTag": row.get("resultTag"),
                "firstPickOddsPct": row.get("firstPickOddsPct"),
            }
        )
    return out


def _simulate_legacy_odds(
    lottery_teams: List[Dict[str, Any]],
    weights: List[int],
    seed_number: int,
    simulations: int = ODDS_SIMULATION_COUNT,
) -> Tuple[List[Dict[str, Any]], Dict[str, Dict[int, int]]]:
    team_names = [_team_name(team) for team in lottery_teams]
    counts = _empty_counts(team_names, 14)
    rng = random.Random(_stable_seed(seed_number, "legacy_odds_matrix", len(lottery_teams)))

    for _ in range(simulations):
        top_four = _weighted_draw_without_replacement(lottery_teams, weights, min(4, len(lottery_teams)), rng)
        top_names = _team_name_set(top_four)
        remaining = [team for team in lottery_teams if _team_name(team) not in top_names]
        remaining = sorted(remaining, key=_record_sort_key_worst_first)
        order = (top_four + remaining)[:14]
        for index, team in enumerate(order):
            counts[_team_name(team)][index + 1] += 1

    rows = []
    for i, team in enumerate(lottery_teams):
        projected = i + 1
        rows.append(_matrix_row_from_counts(team, counts[_team_name(team)], simulations, 14, projected))
    return rows, counts


# ------------------------------------------------------------
# 3-2-1 pool building
# ------------------------------------------------------------
def _is_non_playin_missed(row: Dict[str, Any]) -> bool:
    seed = _safe_int(row.get("conferenceSeed"), 0)
    if seed:
        return seed > 10
    return (not bool(row.get("madePlayoffs"))) and (not bool(row.get("madePlayIn")))


def _build_321_lottery_context(records: List[Dict[str, Any]]) -> Dict[str, Any]:
    sorted_worst = sorted(records, key=_record_sort_key_worst_first)

    seed_9_10 = [row for row in records if _safe_int(row.get("conferenceSeed"), 0) in {9, 10}]
    seed_9_10 = _dedupe_by_team(seed_9_10)

    seven_eight_losers = _select_78_losers(records)
    seven_eight_loser_names = _team_name_set(seven_eight_losers)

    non_playin_missed = [row for row in records if _is_non_playin_missed(row)]
    if len(non_playin_missed) < 10:
        fill_names = _team_name_set(non_playin_missed) | _team_name_set(seed_9_10) | seven_eight_loser_names
        for row in sorted_worst:
            name = _team_name(row)
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

    non_playin_missed = sorted(_dedupe_by_team(non_playin_missed), key=_record_sort_key_worst_first)[:10]
    draft_relegated = sorted(non_playin_missed, key=_record_sort_key_worst_first)[:3]
    draft_relegated_names = _team_name_set(draft_relegated)

    pool = []
    pool.extend(non_playin_missed)
    pool.extend(seed_9_10)
    pool.extend(seven_eight_losers)
    pool = _dedupe_by_team(pool)

    if len(pool) < 16:
        existing = _team_name_set(pool)
        for row in sorted_worst:
            name = _team_name(row)
            if not name or name in existing:
                continue
            pool.append(row)
            existing.add(name)
            if len(pool) >= 16:
                break

    pool = pool[:16]
    seven_eight_loser_names = _team_name_set(seven_eight_losers)
    lottery_teams = []
    weights = []

    for team in pool:
        name = _team_name(team)
        seed = _safe_int(team.get("conferenceSeed"), 0)
        if name in seven_eight_loser_names:
            balls = 1
            category = "three_two_one_7_8_play_in_loser"
            label = "7/8 play-in loser"
        elif seed in {9, 10}:
            balls = 2
            category = "three_two_one_9_10_play_in_seed"
            label = "9/10 play-in seed"
        elif name in draft_relegated_names:
            balls = 2
            category = "three_two_one_draft_relegated"
            label = "Draft relegated"
        else:
            balls = 3
            category = "three_two_one_non_play_in_missed"
            label = "Missed play-in"

        row = {
            **team,
            "lotteryBalls": balls,
            "combinations": balls,
            "lotteryCategory": category,
            "lotteryCategoryLabel": label,
        }
        lottery_teams.append(row)
        weights.append(balls)

    return {
        "lotteryTeams": lottery_teams,
        "weights": weights,
        "poolNames": _team_name_set(lottery_teams),
        "draftRelegatedNames": draft_relegated_names,
        "sevenEightLoserNames": seven_eight_loser_names,
        "nonPlayInMissed": non_playin_missed,
    }


def _expected_pick_from_clean_321_rank(display_rank: int) -> int:
    """Return the clean 3-2-1 expected pick for a displayed lottery rank.

    The UI intentionally shows the 16 lottery teams as clean Record Rank #30
    through #15, even when raw save data has play-in ranks that skip around.
    Expected picks form the three visual bridges Raman wanted:
      - display ranks #27-#21 -> expected picks #1-#7
      - display ranks #30-#28 -> expected picks #8-#10
      - display ranks #20-#15 -> expected picks #11-#16
    Odds, lottery balls, and actual drawing logic remain untouched.
    """
    rank = _safe_int(display_rank, 0)
    if 21 <= rank <= 27:
        return 28 - rank
    if 28 <= rank <= 30:
        return 38 - rank
    if 15 <= rank <= 20:
        return 31 - rank
    return 0


def _clean_321_display_rows(lottery_teams: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    rows = sorted(_dedupe_by_team(list(lottery_teams or [])), key=_record_sort_key_worst_first)[:16]
    out = []
    for index, team in enumerate(rows):
        display_rank = 30 - index
        expected_pick = _expected_pick_from_clean_321_rank(display_rank)
        out.append(
            {
                **team,
                "actualLeagueRank": team.get("actualLeagueRank") or team.get("leagueRank"),
                "displayLeagueRank": display_rank,
                "leagueRank": display_rank,
                "lotterySeed": expected_pick,
                "projectedPick": expected_pick,
                "expectedPick": expected_pick,
                "expectedPickMode": "clean_321_record_bridge",
            }
        )
    return out


def _apply_clean_321_display_slots(lottery_teams: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    display_by_name = {_team_name(team): team for team in _clean_321_display_rows(lottery_teams)}
    return [
        {**team, **{k: v for k, v in (display_by_name.get(_team_name(team)) or {}).items() if k not in {"teamName", "currentOwnerTeamName", "originalTeamName"}}}
        for team in lottery_teams
    ]


def _draw_321_order(
    lottery_teams: List[Dict[str, Any]],
    weights: List[int],
    draft_relegated_names: set,
    rng: random.Random,
) -> List[Dict[str, Any]]:
    drawn = _weighted_draw_without_replacement(lottery_teams, weights, min(16, len(lottery_teams)), rng)
    drawn = _apply_pick_restrictions(drawn)
    drawn = _enforce_321_relegated_floor(drawn, draft_relegated_names)
    return drawn


def _simulate_321_odds(
    lottery_teams: List[Dict[str, Any]],
    weights: List[int],
    draft_relegated_names: set,
    seed_number: int,
    simulations: int = ODDS_SIMULATION_COUNT,
) -> Tuple[List[Dict[str, Any]], Dict[str, Dict[int, int]]]:
    clean_display_order = _clean_321_display_rows(lottery_teams)
    projected_by_name = {_team_name(team): _safe_int(team.get("projectedPick"), 0) for team in clean_display_order}
    team_names = [_team_name(team) for team in lottery_teams]
    counts = _empty_counts(team_names, 16)
    rng = random.Random(_stable_seed(seed_number, "321_odds_matrix", len(lottery_teams)))

    for _ in range(simulations):
        order = _draw_321_order(lottery_teams, weights, draft_relegated_names, rng)
        for index, team in enumerate(order[:16]):
            counts[_team_name(team)][index + 1] += 1

    rows = []
    # Display odds/matrix rows as a clean Record Rank #30 -> #15 bridge.
    # This keeps the real 3-2-1 odds while preventing raw play-in ranks from
    # skipping numbers or breaking the visual expected-pick pattern.
    team_by_name = {_team_name(team): team for team in lottery_teams}
    for display_team in clean_display_order:
        name = _team_name(display_team)
        base_team = {**(team_by_name.get(name) or display_team), **display_team}
        projected = projected_by_name.get(name, 0)
        rows.append(_matrix_row_from_counts(base_team, counts[name], simulations, 16, projected))
    return rows, counts


# ------------------------------------------------------------
# Lottery systems
# ------------------------------------------------------------
def _run_legacy_14_lottery(
    records: List[Dict[str, Any]],
    source: str,
    season_year: int,
    seed_number: int,
    rng: random.Random,
) -> Dict[str, Any]:
    lottery_teams = [row for row in records if not bool(row.get("madePlayoffs"))]
    if len(lottery_teams) != 14:
        lottery_teams = sorted(records, key=_record_sort_key_worst_first)[:14]
    lottery_teams = sorted(_dedupe_by_team(lottery_teams), key=_record_sort_key_worst_first)[:14]

    playoff_teams = [row for row in records if _team_name(row) not in _team_name_set(lottery_teams)]
    playoff_teams = sorted(playoff_teams, key=_record_sort_key_worst_first)

    weights = LOTTERY_COMBINATIONS[: len(lottery_teams)]
    # Add exact first-pick odds from combinations into the lottery teams before
    # running the matrix so the #1 column remains clean even with low sims.
    # User-facing legacy display uses clean lottery record ranks #30 -> #17.
    # This prevents raw saved league/play-in ranks from skipping numbers in the
    # odds table and matrix while leaving the actual lottery/order logic intact.
    total_combos = sum(weights) or 1
    lottery_teams = [
        {
            **team,
            "actualLeagueRank": team.get("actualLeagueRank") or team.get("leagueRank"),
            "displayLeagueRank": 30 - i,
            "leagueRank": 30 - i,
            "lotterySeed": i + 1,
            "projectedPick": i + 1,
            "expectedPick": i + 1,
            "expectedPickMode": "clean_legacy_lottery_rank",
            "combinations": weights[i] if i < len(weights) else 1,
            "lotteryBalls": weights[i] if i < len(weights) else 1,
            "lotteryCategory": "legacy_14",
            "lotteryCategoryLabel": "Legacy lottery",
            "exactFirstPickOddsPct": _round_pct(((weights[i] if i < len(weights) else 1) / total_combos) * 100.0),
        }
        for i, team in enumerate(lottery_teams)
    ]

    top_four = _weighted_draw_without_replacement(lottery_teams, weights, min(4, len(lottery_teams)), rng)
    top_four_names = _team_name_set(top_four)
    remaining_lottery = [team for team in lottery_teams if _team_name(team) not in top_four_names]
    remaining_lottery = sorted(remaining_lottery, key=_record_sort_key_worst_first)

    first_round_order = (top_four + remaining_lottery + playoff_teams)[:30]
    all_teams_inverse = sorted(records, key=_record_sort_key_worst_first)[:30]

    final_pick_by_team = {_team_name(team): index + 1 for index, team in enumerate(first_round_order[:14])}
    odds_rows, _ = _simulate_legacy_odds(lottery_teams, weights, seed_number)
    enriched_odds = []
    for row in odds_rows:
        name = _team_name(row)
        final_pick = final_pick_by_team.get(name)
        enriched = {**row, "finalPick": final_pick or None}
        if final_pick:
            enriched["actualPickOddsPct"] = _round_pct(enriched.get("oddsByPick", {}).get(str(final_pick), 0.0))
            enriched["pickChange"] = int(_safe_int(enriched.get("projectedPick"), 0) - final_pick)
            change = enriched["pickChange"]
            enriched["resultTag"] = "Huge jump" if change >= 5 else "Jumped" if change > 0 else "Held" if change == 0 else "Big fall" if change <= -5 else "Fell"
        # Use exact #1 odds for the legacy display.
        exact = next((t.get("exactFirstPickOddsPct") for t in lottery_teams if _team_name(t) == name), None)
        projected_slot = _safe_int(enriched.get("projectedPick"), 0)
        if projected_slot:
            enriched["bestPick"] = 1
            enriched["worstPick"] = min(14, projected_slot + 4)
        if exact is not None:
            enriched["firstPickOddsPct"] = exact
            enriched["oddsByPick"] = {**(enriched.get("oddsByPick") or {}), "1": exact}
        enriched_odds.append(enriched)

    first_round_picks = []
    for index, team in enumerate(first_round_order):
        pick_number = index + 1
        if index < 4:
            source_label = "lottery_drawn_top_4"
        elif pick_number <= 14:
            source_label = "lottery_inverse_record"
        else:
            source_label = "playoff_inverse_record"
        first_round_picks.append(_make_pick_row(pick_number, 1, pick_number, team, source_label, seed_number))

    second_round_picks = []
    for index, team in enumerate(all_teams_inverse):
        pick_number = index + 31
        second_round_picks.append(_make_pick_row(pick_number, 2, index + 1, team, "second_round_inverse_record", seed_number))

    first_round_picks = _attach_pick_context(first_round_picks, enriched_odds)

    lottery_summary = []
    odds_by_name = {_team_name(row): row for row in enriched_odds}
    for team in lottery_teams:
        odds = odds_by_name.get(_team_name(team), {})
        lottery_summary.append({**team, **odds})

    drawn_summary = []
    for i, team in enumerate(top_four):
        drawn_summary.append(
            {
                "pick": i + 1,
                "teamName": _team_name(team),
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
        "preLotteryOdds": enriched_odds,
        "lotteryOdds": enriched_odds,
        "oddsMatrix": enriched_odds,
        "oddsSimulationCount": ODDS_SIMULATION_COUNT,
        "topFourDrawn": drawn_summary,
        "firstRoundOrder": first_round_picks,
        "secondRoundOrder": second_round_picks,
        "fullDraftOrder": first_round_picks + second_round_picks,
        "meta": {
            "system": "legacy_14",
            "systemLabel": "2026 legacy NBA lottery",
            "rules": "Legacy NBA lottery: 14 teams, top 4 picks drawn, picks 5-14 by inverse record. Round 2 uses league-wide inverse record.",
            "lotteryCombinations": LOTTERY_COMBINATIONS,
            "oddsSimulationCount": ODDS_SIMULATION_COUNT,
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
    context = _build_321_lottery_context(records)
    lottery_teams = context["lotteryTeams"]
    weights = context["weights"]
    pool_names = context["poolNames"]
    draft_relegated_names = context["draftRelegatedNames"]

    # User-facing 3-2-1 display uses clean lottery record ranks #30 -> #15.
    # Expected picks are a visual record bridge, while actual odds/draw logic
    # still use the true 3-2-1 ball weights and path categories.
    lottery_teams = _apply_clean_321_display_slots(lottery_teams)

    drawn_16 = _draw_321_order(lottery_teams, weights, draft_relegated_names, rng)

    remaining_teams = [row for row in records if _team_name(row) not in pool_names]
    remaining_teams = sorted(remaining_teams, key=_record_sort_key_worst_first)

    first_round_order = (drawn_16 + remaining_teams)[:30]

    # New 3-2-1 second-round rule:
    # picks 31-46 invert the final lottery result, then 47-60 use non-lottery
    # teams by league-wide inverse record.
    second_round_order = list(reversed(drawn_16[:16])) + remaining_teams
    second_round_order = second_round_order[:30]

    final_pick_by_team = {_team_name(team): index + 1 for index, team in enumerate(drawn_16[:16])}
    odds_rows, _ = _simulate_321_odds(lottery_teams, weights, draft_relegated_names, seed_number)
    enriched_odds = []
    for row in odds_rows:
        name = _team_name(row)
        final_pick = final_pick_by_team.get(name)
        enriched = {**row, "finalPick": final_pick or None}
        if final_pick:
            enriched["actualPickOddsPct"] = _round_pct(enriched.get("oddsByPick", {}).get(str(final_pick), 0.0))
            enriched["pickChange"] = int(_safe_int(enriched.get("projectedPick"), 0) - final_pick)
            change = enriched["pickChange"]
            enriched["resultTag"] = "Huge jump" if change >= 5 else "Jumped" if change > 0 else "Held" if change == 0 else "Big fall" if change <= -5 else "Fell"
        enriched["bestPick"] = 1
        if "draft_relegated" in str(enriched.get("lotteryCategory") or ""):
            enriched["worstPick"] = 12
        else:
            enriched["worstPick"] = 16
        enriched_odds.append(enriched)

    first_round_picks = []
    for index, team in enumerate(first_round_order):
        pick_number = index + 1
        source_label = team.get("lotteryCategory") or "three_two_one_lottery_drawn" if pick_number <= 16 else "non_lottery_inverse_record"
        if pick_number > 16:
            source_label = "non_lottery_inverse_record"
        first_round_picks.append(_make_pick_row(pick_number, 1, pick_number, team, source_label, seed_number))

    second_round_picks = []
    for index, team in enumerate(second_round_order):
        pick_number = index + 31
        source_label = "second_round_inverse_lottery_result" if index < 16 else "second_round_non_lottery_inverse_record"
        second_round_picks.append(_make_pick_row(pick_number, 2, index + 1, team, source_label, seed_number))

    first_round_picks = _attach_pick_context(first_round_picks, enriched_odds)
    second_round_picks = _attach_pick_context(second_round_picks, enriched_odds)

    odds_by_name = {_team_name(row): row for row in enriched_odds}
    lottery_summary = []
    for team in sorted(lottery_teams, key=_record_sort_key_worst_first):
        odds = odds_by_name.get(_team_name(team), {})
        lottery_summary.append({**team, **odds})

    drawn_summary = []
    for i, team in enumerate(drawn_16):
        drawn_summary.append(
            {
                "pick": i + 1,
                "teamName": _team_name(team),
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
        "preLotteryOdds": enriched_odds,
        "lotteryOdds": enriched_odds,
        "oddsMatrix": enriched_odds,
        "oddsSimulationCount": ODDS_SIMULATION_COUNT,
        "topFourDrawn": drawn_summary[:4],
        "topSixteenDrawn": drawn_summary,
        "firstRoundOrder": first_round_picks,
        "secondRoundOrder": second_round_picks,
        "fullDraftOrder": first_round_picks + second_round_picks,
        "meta": {
            "system": "three_two_one",
            "systemLabel": "3-2-1 NBA lottery",
            "rules": "3-2-1 Lottery: 16 teams drawn; picks 31-46 invert the first-round lottery result, then picks 47-60 use non-lottery inverse record.",
            "lotteryBalls": "3-2-1",
            "draftRelegatedTeams": sorted(list(draft_relegated_names)),
            "sevenEightLosers": sorted(list(context.get("sevenEightLoserNames") or [])),
            "oddsSimulationCount": ODDS_SIMULATION_COUNT,
            "seed": str(seed_number),
        },
    }


# ------------------------------------------------------------
# Public request API
# ------------------------------------------------------------
def run_draft_lottery(league_data: Dict[str, Any], payload: Dict[str, Any]) -> Dict[str, Any]:
    league = copy.deepcopy(_plain(league_data) or {})
    payload = _plain(payload) or {}

    season_year = _get_season_year(league, payload)
    requested_system = payload.get("forceLotterySystem") or payload.get("lotterySystem") or payload.get("system") or "auto"
    lottery_system = _normalize_lottery_system(requested_system, season_year)

    seed_value = payload.get("seed")
    if seed_value is None:
        seed_value = f"{season_year}_{lottery_system}_{time.time_ns()}_{random.random()}"

    seed_number = _stable_seed(seed_value, season_year, lottery_system)
    rng = random.Random(seed_number)

    records, source = _records_from_payload_or_history(league, payload, season_year)
    records = [row for row in records if _team_name(row)]

    if len(records) < 30:
        return {
            "ok": False,
            "reason": f"NOT_ENOUGH_TEAM_RECORDS: {len(records)}",
            "version": DRAFT_LOTTERY_VERSION,
            "seasonYear": season_year,
            "source": source,
            "meta": {"system": lottery_system, "requestedSystem": str(requested_system)},
        }

    # Dedupe first in case old saves accidentally duplicate teams across league.teams
    # and conferences. Keep 30 by best-first league rank for stability.
    records = sorted(_dedupe_by_team(records), key=_record_sort_key_best_first)[:30]

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
