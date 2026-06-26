"""
cpu_cpu_trade_logic.py

Season-timed CPU-to-CPU trade candidate generator for Basketball Manager.

This file is intentionally friend-editable. It DOES NOT mutate rosters or picks.
It only proposes trade candidates. JavaScript then validates and executes using
Basketball Manager's existing trade machine legality rules.
"""

from __future__ import annotations

import hashlib
import json
import math
import random
from typing import Any, Dict, List, Optional, Tuple


# -----------------------------------------------------------------------------
# Main knobs your friend can tune
# -----------------------------------------------------------------------------

CPU_TRADES_ENABLED = True

# No trade spam at season start.
NO_TRADE_FIRST_N_DAYS = 12

# Candidate generation chance by season zone. This is intentionally conservative
# because JavaScript will still reject illegal/unfair trades after this.
EARLY_SEASON_BASE_CHANCE = 0.035
MID_SEASON_BASE_CHANCE = 0.070
LATE_SEASON_BASE_CHANCE = 0.130
DEADLINE_WEEK_BASE_CHANCE = 0.950

# Caps to keep it natural.
MAX_CPU_TRADES_PER_DAY = 1
MAX_CPU_TRADES_PER_TEAM_SEASON = 3
MAX_CANDIDATES_PER_DAY = 8

# Team direction thresholds.
BUYER_WIN_PCT = 0.535
STRONG_BUYER_WIN_PCT = 0.600
SELLER_WIN_PCT = 0.410
STRONG_SELLER_WIN_PCT = 0.330
MIN_GAMES_FOR_RECORD_DIRECTION = 12

# Surprise/slump modifiers.
SURPRISE_WINNING_SELLER_REDUCTION = 0.50
CONTENDER_SLUMP_BUYER_BOOST = 1.55
BAD_TEAM_OVERACHIEVING_SELLER_REDUCTION = 0.58

# Asset guardrails. First version avoids star trades and messy pick trades.
MIN_TARGET_VET_OVR = 73
MAX_TARGET_VET_OVR = 85
MIN_TARGET_VET_AGE = 25
MAX_UNTOUCHABLE_OVR = 86
MAX_ASSETS_PER_SIDE = 3

# CPU picks: simple only. Avoid swaps/protected split chaos in automated trades.
ALLOW_CPU_FIRST_ROUND_PICKS = True
ALLOW_CPU_SECOND_ROUND_PICKS = True
PREFER_SECOND_ROUND_PICK_FOR_SMALL_TRADES = True


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


def _norm(value: Any) -> str:
    return "".join(ch for ch in _str(value).lower() if ch.isalnum())


def _stable_seed(*parts: Any) -> int:
    raw = "|".join(_str(p) for p in parts)
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]
    return int(digest, 16)


def _rng_for(*parts: Any) -> random.Random:
    return random.Random(_stable_seed(*parts))


def _all_teams(league: Dict[str, Any]) -> List[Dict[str, Any]]:
    if isinstance(league.get("teams"), list):
        return [t for t in league.get("teams") if isinstance(t, dict)]
    conferences = league.get("conferences")
    out: List[Dict[str, Any]] = []
    if isinstance(conferences, dict):
        for rows in conferences.values():
            if isinstance(rows, list):
                out.extend([t for t in rows if isinstance(t, dict)])
    return out


def _team_name(team: Dict[str, Any]) -> str:
    return _str(team.get("name") or team.get("teamName") or team.get("team"), "")


def _players(team: Dict[str, Any]) -> List[Dict[str, Any]]:
    rows = team.get("players")
    return rows if isinstance(rows, list) else []


def _player_name(player: Dict[str, Any]) -> str:
    return _str(player.get("name") or player.get("player"), "Unknown Player")


def _player_ovr(player: Dict[str, Any]) -> float:
    return _num(player.get("overall") or player.get("ovr") or player.get("rating"), 60.0)


def _player_pot(player: Dict[str, Any]) -> float:
    return _num(player.get("potential") or player.get("pot") or _player_ovr(player), _player_ovr(player))


def _player_age(player: Dict[str, Any]) -> float:
    return _num(player.get("age"), 27.0)


def _salary_for_year(player: Dict[str, Any], season_year: int) -> float:
    contract = player.get("contract") if isinstance(player.get("contract"), dict) else {}
    salaries = contract.get("salaryByYear") if isinstance(contract.get("salaryByYear"), list) else []
    if salaries:
        start = int(_num(contract.get("startYear"), season_year))
        idx = season_year - start
        if len(salaries) == 1 and start == season_year - 1 and not (0 <= idx < len(salaries)):
            idx = 0
        if idx < 0:
            idx = 0
        if idx >= len(salaries):
            idx = len(salaries) - 1
        return max(0.0, _num(salaries[idx], 0.0))
    return max(0.0, _num(player.get("salary") or player.get("currentSalary") or player.get("capHit"), 0.0))


def _contract_years_left(player: Dict[str, Any], season_year: int) -> int:
    contract = player.get("contract") if isinstance(player.get("contract"), dict) else {}
    salaries = contract.get("salaryByYear") if isinstance(contract.get("salaryByYear"), list) else []
    if not salaries:
        return 1 if _salary_for_year(player, season_year) > 0 else 0
    start = int(_num(contract.get("startYear"), season_year))
    idx = season_year - start
    if idx < 0:
        idx = 0
    if idx >= len(salaries):
        return 1
    return max(1, len(salaries) - idx)


def _season_year(league: Dict[str, Any]) -> int:
    label = " ".join(_str(league.get(k), "") for k in ["leagueName", "name", "title", "fileName"])
    # final rosters 25/26 -> payroll/current season 2026
    import re
    m = re.search(r"(20\d{2})\s*[/-]\s*(20\d{2})", label)
    if m:
        return int(m.group(2))
    m = re.search(r"(\d{2})\s*[/-]\s*(\d{2})", label)
    if m:
        return 2000 + int(m.group(2))
    return int(_num(league.get("seasonYear") or league.get("currentSeasonYear") or league.get("seasonStartYear"), 2026))


def _top_avg(team: Dict[str, Any], n: int = 8) -> float:
    vals = sorted((_player_ovr(p) for p in _players(team)), reverse=True)[:n]
    return sum(vals) / len(vals) if vals else 70.0


def _record_for(team_name: str, context: Dict[str, Any], team: Dict[str, Any]) -> Dict[str, float]:
    records = context.get("recordsByTeam") if isinstance(context.get("recordsByTeam"), dict) else {}
    row = records.get(team_name) or records.get(_norm(team_name)) or {}
    if not isinstance(row, dict):
        row = {}
    wins = _num(row.get("wins") if "wins" in row else row.get("w"), _num(team.get("wins") or (team.get("record") or {}).get("wins"), 0.0))
    losses = _num(row.get("losses") if "losses" in row else row.get("l"), _num(team.get("losses") or (team.get("record") or {}).get("losses"), 0.0))
    return {"wins": wins, "losses": losses, "games": wins + losses}


def _expected_win_pct_from_strength(top_avg: float) -> float:
    # Simple roster-strength expectation. 78 ~= .500, 86 ~= high seed.
    return max(0.22, min(0.78, 0.50 + (top_avg - 78.0) * 0.025))


def _phase_for(team: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    name = _team_name(team)
    record = _record_for(name, context, team)
    top = _top_avg(team, 8)
    games = record["games"]
    win_pct = record["wins"] / games if games > 0 else None
    expected = _expected_win_pct_from_strength(top)
    surprise = False
    slump = False

    if win_pct is not None and games >= MIN_GAMES_FOR_RECORD_DIRECTION:
        surprise = bool(win_pct >= expected + 0.105 and top < 81.5)
        slump = bool(win_pct <= expected - 0.115 and top >= 82.0)
        if win_pct >= STRONG_BUYER_WIN_PCT:
            phase = "contender"
        elif win_pct >= BUYER_WIN_PCT:
            phase = "buyer"
        elif win_pct <= STRONG_SELLER_WIN_PCT:
            phase = "seller"
        elif win_pct <= SELLER_WIN_PCT:
            phase = "retool"
        else:
            phase = "middle"
    else:
        if top >= 84.5:
            phase = "contender"
        elif top >= 81.0:
            phase = "buyer"
        elif top <= 75.5:
            phase = "seller"
        elif top <= 78.0:
            phase = "retool"
        else:
            phase = "middle"

    buyer_weight = 0.0
    seller_weight = 0.0
    if phase == "contender":
        buyer_weight = 1.20
    elif phase == "buyer":
        buyer_weight = 1.00
    elif phase == "middle":
        buyer_weight = 0.35
        seller_weight = 0.25
    elif phase == "retool":
        seller_weight = 0.75
        buyer_weight = 0.20
    elif phase == "seller":
        seller_weight = 1.15

    if slump and phase in {"contender", "buyer"}:
        buyer_weight *= CONTENDER_SLUMP_BUYER_BOOST
    if surprise and seller_weight > 0:
        seller_weight *= SURPRISE_WINNING_SELLER_REDUCTION
    if win_pct is not None and top <= 77.0 and win_pct >= 0.500:
        seller_weight *= BAD_TEAM_OVERACHIEVING_SELLER_REDUCTION

    return {
        "teamName": name,
        "phase": phase,
        "wins": record["wins"],
        "losses": record["losses"],
        "games": games,
        "winPct": win_pct if win_pct is not None else 0.0,
        "topAvg": top,
        "expectedWinPct": expected,
        "surprise": surprise,
        "slump": slump,
        "buyerWeight": buyer_weight,
        "sellerWeight": seller_weight,
    }


def _already_traded_count(league: Dict[str, Any], team_name: str) -> int:
    count = 0
    for row in league.get("tradeHistory") or []:
        if not isinstance(row, dict):
            continue
        if not (row.get("cpuCpuTrade") or row.get("source") == "cpu_cpu_trade"):
            continue
        names = [
            row.get("userTeamName"),
            row.get("cpuTeamName"),
            row.get("fromTeamName"),
            row.get("toTeamName"),
        ]
        if any(_norm(n) == _norm(team_name) for n in names if n):
            count += 1
    return count


def _is_standard_player(player: Dict[str, Any]) -> bool:
    status = _str(player.get("rosterStatus") or player.get("contractType"), "").lower()
    return not (player.get("isTwoWay") or player.get("isStash") or "two" in status or "stash" in status)


def _is_core_player(team: Dict[str, Any], player: Dict[str, Any]) -> bool:
    roster = sorted(_players(team), key=_player_ovr, reverse=True)
    try:
        rank = roster.index(player) + 1
    except Exception:
        rank = 99
    return rank <= 3 or _player_ovr(player) >= MAX_UNTOUCHABLE_OVR


def _seller_trade_targets(team: Dict[str, Any], season_year: int) -> List[Dict[str, Any]]:
    out = []
    for p in _players(team):
        if not isinstance(p, dict) or not _is_standard_player(p):
            continue
        ovr = _player_ovr(p)
        age = _player_age(p)
        years_left = _contract_years_left(p, season_year)
        if _is_core_player(team, p):
            continue
        if not (MIN_TARGET_VET_OVR <= ovr <= MAX_TARGET_VET_OVR):
            continue
        if age < MIN_TARGET_VET_AGE and years_left > 1:
            continue
        score = ovr * 1.8 + age * 0.20 - years_left * 1.5
        if age >= 31:
            score += 4.0
        if years_left <= 1:
            score += 3.0
        out.append({"player": p, "score": score})
    return [r["player"] for r in sorted(out, key=lambda x: x["score"], reverse=True)[:8]]


def _buyer_outgoing_players(team: Dict[str, Any], season_year: int) -> List[Dict[str, Any]]:
    roster = sorted(_players(team), key=_player_ovr, reverse=True)
    out = []
    for idx, p in enumerate(roster):
        if not isinstance(p, dict) or not _is_standard_player(p):
            continue
        ovr = _player_ovr(p)
        age = _player_age(p)
        if idx <= 5 or ovr >= 81:
            continue
        if ovr < 65:
            continue
        if age > 30 and ovr >= 72:
            continue
        # Prefer movable young/bench salaries, not actual rotation core.
        score = (78 - ovr) + max(0, 25 - age) * 1.15 - max(0, age - 28) * 0.7 + min(_salary_for_year(p, season_year) / 10_000_000, 2.0)
        out.append({"player": p, "score": score})
    return [r["player"] for r in sorted(out, key=lambda x: x["score"], reverse=True)[:10]]


def _simple_pick_assets(league: Dict[str, Any], owner_team: str, season_year: int) -> List[Dict[str, Any]]:
    out = []
    rows = league.get("draftPicks") if isinstance(league.get("draftPicks"), list) else []
    for row in rows:
        if not isinstance(row, dict):
            continue
        asset_type = _str(row.get("assetType") or row.get("type") or "pick", "pick").lower()
        if asset_type != "pick":
            continue
        if _str(row.get("status") or "active", "active").lower() not in {"active", ""}:
            continue
        if _norm(row.get("ownerTeam") or row.get("currentOwnerTeamName") or row.get("owner")) != _norm(owner_team):
            continue
        year = int(_num(row.get("year") or row.get("seasonYear"), 0))
        rnd = int(_num(row.get("round"), 1))
        if year < season_year + 1:
            continue
        if rnd == 1 and not ALLOW_CPU_FIRST_ROUND_PICKS:
            continue
        if rnd == 2 and not ALLOW_CPU_SECOND_ROUND_PICKS:
            continue
        protection = _str(row.get("displayProtection") or row.get("protections") or row.get("protection") or "Unprotected", "Unprotected")
        if protection and protection.lower() not in {"unprotected", "none", "null"}:
            continue
        score = (0 if rnd == 2 else 10) + (year - season_year) * 0.25
        out.append({"pick": row, "score": score, "round": rnd})
    return [r["pick"] for r in sorted(out, key=lambda x: x["score"])[:8]]


def _player_item(player: Dict[str, Any]) -> Dict[str, Any]:
    return {"type": "player", "player": player}


def _pick_item(pick: Dict[str, Any]) -> Dict[str, Any]:
    protection = _str(pick.get("displayProtection") or pick.get("protections") or pick.get("protection") or "Unprotected", "Unprotected")
    return {
        "type": "pick",
        "pick": pick,
        "protection": protection or "Unprotected",
        "displayLabel": f"{pick.get('year', '')} {'1st' if int(_num(pick.get('round'), 1)) == 1 else '2nd'} - {pick.get('originalTeam') or pick.get('team') or 'Own'}",
    }


def _rough_value_player(player: Dict[str, Any], season_year: int) -> float:
    ovr = _player_ovr(player)
    pot = _player_pot(player)
    age = _player_age(player)
    salary = _salary_for_year(player, season_year) / 1_000_000
    years = _contract_years_left(player, season_year)
    upside = max(0.0, pot - ovr)
    age_adj = 0.0
    if age <= 24:
        age_adj += (25 - age) * 0.35
    if age >= 31:
        age_adj -= (age - 30) * 0.28
    contract_drag = max(0.0, salary - max(2.0, (ovr - 66) * 2.0)) * 0.08
    if years >= 3 and age >= 30:
        contract_drag += 1.2
    return (ovr - 65) * 0.45 + upside * 0.22 + age_adj - contract_drag


def _rough_value_pick(pick: Dict[str, Any]) -> float:
    rnd = int(_num(pick.get("round"), 1))
    if rnd == 1:
        return 4.0
    return 1.2


def _salary_matchish(incoming_salary: float, outgoing_salary: float) -> bool:
    if incoming_salary <= outgoing_salary + 1_000_000:
        return True
    if outgoing_salary <= 0:
        return incoming_salary <= 7_500_000
    if outgoing_salary <= 7_500_000:
        return incoming_salary <= outgoing_salary * 2 + 250_000
    if outgoing_salary <= 29_000_000:
        return incoming_salary <= outgoing_salary + 7_500_000
    return incoming_salary <= outgoing_salary * 1.25 + 250_000


def _build_candidate(
    league: Dict[str, Any],
    seller: Dict[str, Any],
    buyer: Dict[str, Any],
    target: Dict[str, Any],
    buyer_pool: List[Dict[str, Any]],
    picks: List[Dict[str, Any]],
    seller_ctx: Dict[str, Any],
    buyer_ctx: Dict[str, Any],
    season_year: int,
    rng: random.Random,
) -> Optional[Dict[str, Any]]:
    target_salary = _salary_for_year(target, season_year)
    target_value = _rough_value_player(target, season_year)

    # Try 1-player or 2-player outgoing packages, then maybe add a pick.
    pool = buyer_pool[:]
    rng.shuffle(pool)
    combos: List[List[Dict[str, Any]]] = [[p] for p in pool]
    for i in range(min(len(pool), 6)):
        for j in range(i + 1, min(len(pool), 8)):
            combos.append([pool[i], pool[j]])

    best = None
    for combo in combos:
        outgoing_salary = sum(_salary_for_year(p, season_year) for p in combo)
        if not _salary_matchish(target_salary, outgoing_salary):
            continue
        outgoing_value = sum(_rough_value_player(p, season_year) for p in combo)
        seller_needs_pick = all(
            _player_age(p) > 26 and _player_pot(p) <= _player_ovr(p) + 2
            for p in combo
        )
        need_pick = target_value > outgoing_value + 1.1 or seller_needs_pick
        pick = None
        if need_pick and picks:
            # Prefer 2nds for small trades, firsts for bigger vet upgrades.
            second = [p for p in picks if int(_num(p.get("round"), 1)) == 2]
            first = [p for p in picks if int(_num(p.get("round"), 1)) == 1]
            if PREFER_SECOND_ROUND_PICK_FOR_SMALL_TRADES and target_value - outgoing_value < 3.0 and second:
                pick = second[0]
            elif first:
                pick = first[0]
            elif second:
                pick = second[0]
        total_value = outgoing_value + (_rough_value_pick(pick) if pick else 0.0)
        balance = total_value - target_value
        # Too cheap or insane overpay: skip. JS does final acceptance.
        if balance < -3.25 or balance > 6.5:
            continue
        score = 10.0 - abs(balance) + buyer_ctx.get("buyerWeight", 0) + seller_ctx.get("sellerWeight", 0)
        if best is None or score > best[0]:
            best = (score, combo, pick, balance)

    if not best:
        return None

    _, combo, pick, balance = best
    from_team = _team_name(seller)
    to_team = _team_name(buyer)
    from_items = [_player_item(target)]
    to_items = [_player_item(p) for p in combo]
    if pick:
        to_items.append(_pick_item(pick))

    if len(from_items) > MAX_ASSETS_PER_SIDE or len(to_items) > MAX_ASSETS_PER_SIDE:
        return None

    motive_bits = []
    if buyer_ctx.get("slump"):
        motive_bits.append(f"{to_team} is underperforming and looks for a rotation boost")
    else:
        motive_bits.append(f"{to_team} looks like a buyer")
    if seller_ctx.get("surprise"):
        motive_bits.append(f"{from_team} is overachieving, so seller pressure is reduced")
    else:
        motive_bits.append(f"{from_team} moves a veteran for younger assets")

    return {
        "id": f"cpu_trade_{_norm(from_team)}_{_norm(to_team)}_{_norm(_player_name(target))}",
        "fromTeamName": from_team,
        "toTeamName": to_team,
        "fromItems": from_items,
        "toItems": to_items,
        "motive": "; ".join(motive_bits) + ".",
        "debug": {
            "sellerPhase": seller_ctx.get("phase"),
            "buyerPhase": buyer_ctx.get("phase"),
            "targetPlayer": _player_name(target),
            "balance": round(balance, 3),
            "targetSalary": target_salary,
            "outgoingSalary": sum(_salary_for_year(p, season_year) for p in combo),
        },
    }



def _desk_entry(entry_type: str, label: str, tag: str, headline: str, current_date: str = "", teams: Optional[List[str]] = None, players: Optional[List[str]] = None, priority: float = 40.0) -> Dict[str, Any]:
    clean_teams = [t for t in (teams or []) if t]
    clean_players = [p for p in (players or []) if p]
    base = f"{entry_type}|{label}|{tag}|{headline}|{current_date}|{'/'.join(clean_teams)}|{'/'.join(clean_players)}"
    return {
        "id": f"cpu_desk_{hashlib.sha256(base.encode('utf-8')).hexdigest()[:14]}",
        "type": entry_type,
        "label": label,
        "tag": tag,
        "headline": headline,
        "date": current_date,
        "teamNames": clean_teams,
        "playerNames": clean_players,
        "priority": priority,
        "source": "cpu_cpu_trade_logic",
    }


def _record_text(ctx: Dict[str, Any]) -> str:
    games = int(_num(ctx.get("games"), 0))
    if games <= 0:
        return "before the standings sample is meaningful"
    return f"at {int(_num(ctx.get('wins'), 0))}-{int(_num(ctx.get('losses'), 0))}"


def _pos_label_for_buyer(team: Dict[str, Any]) -> str:
    counts: Dict[str, int] = {}
    for player in _players(team):
        pos = _str(player.get("pos") or player.get("position"), "").upper()
        if pos:
            counts[pos] = counts.get(pos, 0) + 1
    if counts.get("C", 0) <= 1:
        return "frontcourt depth"
    if counts.get("PG", 0) <= 1:
        return "backup ball-handling"
    if counts.get("SF", 0) + counts.get("PF", 0) <= 4:
        return "two-way wing help"
    return "rotation depth"


def _build_trade_desk_signals(
    league: Dict[str, Any],
    context: Dict[str, Any],
    teams: List[Dict[str, Any]],
    contexts: Dict[str, Dict[str, Any]],
    season_year: int,
    current_date: str,
    rng: random.Random,
    limit: int = 6,
) -> List[Dict[str, Any]]:
    entries: List[Dict[str, Any]] = []

    sellers = [t for t in teams if contexts.get(_team_name(t), {}).get("sellerWeight", 0) > 0.30]
    buyers = [t for t in teams if contexts.get(_team_name(t), {}).get("buyerWeight", 0) > 0.30]
    middle = [t for t in teams if contexts.get(_team_name(t), {}).get("phase") == "middle"]

    sellers.sort(key=lambda t: contexts[_team_name(t)].get("sellerWeight", 0), reverse=True)
    buyers.sort(key=lambda t: contexts[_team_name(t)].get("buyerWeight", 0), reverse=True)
    middle.sort(key=lambda t: abs(contexts[_team_name(t)].get("winPct", 0.5) - 0.5))

    for buyer in buyers[:2]:
        name = _team_name(buyer)
        ctx = contexts[name]
        need = _pos_label_for_buyer(buyer)
        if ctx.get("slump"):
            headline = f"{name} is underperforming {_record_text(ctx)} and has started checking the market for {need}."
            label = "Slump Buyer"
            priority = 72
        elif ctx.get("phase") == "contender":
            headline = f"{name} profiles as a buyer {_record_text(ctx)} and is prioritizing {need} before the deadline."
            label = "Buyer Watch"
            priority = 66
        else:
            headline = f"{name} has enough momentum {_record_text(ctx)} to browse the market for {need}, but is not forcing a deal yet."
            label = "Buyer Watch"
            priority = 54
        entries.append(_desk_entry("rumor", label, "Buyer", headline, current_date, [name], [], priority))

    for seller in sellers[:2]:
        name = _team_name(seller)
        ctx = contexts[name]
        targets = _seller_trade_targets(seller, season_year)
        target = targets[0] if targets else None
        target_name = _player_name(target) if target else "veteran rotation pieces"
        if ctx.get("surprise"):
            headline = f"{name}'s front office was expected to listen on veterans, but its strong start {_record_text(ctx)} has made it more patient."
            label = "Market Hold"
            tag = "Patience"
            priority = 61
        else:
            headline = f"{name}'s front office is listening on {target_name} as its direction leans toward asset collection {_record_text(ctx)}."
            label = "Available Names"
            tag = "Market"
            priority = 70
        entries.append(_desk_entry("rumor", label, tag, headline, current_date, [name], [target_name] if target else [], priority))

    if middle:
        team = middle[0]
        name = _team_name(team)
        ctx = contexts[name]
        headline = f"{name} remains near the middle {_record_text(ctx)} and may wait for another stretch of games before buying or selling."
        entries.append(_desk_entry("rumor", "League Pulse", "Trend", headline, current_date, [name], [], 45))

    rng.shuffle(entries)
    entries.sort(key=lambda row: _num(row.get("priority"), 0), reverse=True)
    return entries[:limit]


def _candidate_trade_desk_entry(candidate: Dict[str, Any], current_date: str) -> Optional[Dict[str, Any]]:
    from_team = _str(candidate.get("fromTeamName") or candidate.get("sellerTeamName"), "")
    to_team = _str(candidate.get("toTeamName") or candidate.get("buyerTeamName"), "")
    if not from_team or not to_team:
        return None

    target_names = []
    for item in candidate.get("fromItems") or []:
        if isinstance(item, dict) and item.get("type") == "player" and isinstance(item.get("player"), dict):
            target_names.append(_player_name(item["player"]))
    target = target_names[0] if target_names else "a rotation piece"
    headline = f"{to_team} and {from_team} have discussed a framework centered on {target}."
    return _desk_entry("negotiation", "Framework Talks", "Talks", headline, current_date, [from_team, to_team], target_names, 82)

def _activity_chance(context: Dict[str, Any]) -> float:
    day = int(_num(context.get("dayIndex"), 0))
    total = max(1, int(_num(context.get("totalDates"), 170)))
    if day < NO_TRADE_FIRST_N_DAYS:
        return 0.0

    # Deadline week should feel active. Rumors without candidates made the Trade Desk
    # look alive while no executable CPU-to-CPU deals were ever reaching JS.
    if bool(context.get("forceCpuTradeActivity")):
        return 1.0

    progress = max(0.0, min(1.0, day / total))
    days_to_deadline = _num(context.get("daysToDeadline"), 999)
    if days_to_deadline <= 3:
        return 1.0
    if days_to_deadline <= 7:
        return DEADLINE_WEEK_BASE_CHANCE
    if progress < 0.28:
        return EARLY_SEASON_BASE_CHANCE
    if progress < 0.67:
        return MID_SEASON_BASE_CHANCE
    return LATE_SEASON_BASE_CHANCE


def find_cpu_cpu_trade_candidates(payload: Dict[str, Any]) -> Dict[str, Any]:
    league = payload.get("leagueData") if isinstance(payload.get("leagueData"), dict) else {}
    context = payload.get("context") if isinstance(payload.get("context"), dict) else {}
    if not CPU_TRADES_ENABLED:
        return {"ok": True, "candidates": [], "skippedReason": "disabled"}

    current_date = _str(context.get("currentDate"), "")
    deadline_date = _str(context.get("tradeDeadlineDate"), "")
    user_team = _str(context.get("userTeamName"), "")
    max_candidates = int(_num(context.get("maxCandidates"), MAX_CANDIDATES_PER_DAY))
    max_candidates = max(1, min(MAX_CANDIDATES_PER_DAY, max_candidates))
    season_year = _season_year(league)

    if deadline_date and current_date and current_date >= deadline_date:
        return {"ok": True, "candidates": [], "skippedReason": "trade_deadline_locked"}

    rng = _rng_for("cpu_cpu_trade", season_year, current_date, context.get("dayIndex"))
    teams = [t for t in _all_teams(league) if _team_name(t) and _norm(_team_name(t)) != _norm(user_team)]
    contexts = {_team_name(t): _phase_for(t, context) for t in teams}
    base_trade_desk_items = _build_trade_desk_signals(league, context, teams, contexts, season_year, current_date, rng)

    chance = _activity_chance(context)
    if rng.random() > chance:
        return {
            "ok": True,
            "candidates": [],
            "skippedReason": "quiet_day",
            "activityChance": chance,
            "tradeDeskItems": base_trade_desk_items,
        }

    sellers = []
    buyers = []
    for t in teams:
        name = _team_name(t)
        ctx = contexts[name]
        if _already_traded_count(league, name) >= MAX_CPU_TRADES_PER_TEAM_SEASON:
            continue
        if ctx.get("sellerWeight", 0) > 0.30:
            sellers.append(t)
        if ctx.get("buyerWeight", 0) > 0.30:
            buyers.append(t)

    rng.shuffle(sellers)
    rng.shuffle(buyers)
    sellers.sort(key=lambda t: contexts[_team_name(t)].get("sellerWeight", 0), reverse=True)
    buyers.sort(key=lambda t: contexts[_team_name(t)].get("buyerWeight", 0), reverse=True)

    candidates: List[Dict[str, Any]] = []
    seen_pairs = set()

    for seller in sellers[:10]:
        seller_name = _team_name(seller)
        targets = _seller_trade_targets(seller, season_year)
        if not targets:
            continue
        for buyer in buyers[:12]:
            buyer_name = _team_name(buyer)
            if _norm(buyer_name) == _norm(seller_name):
                continue
            pair_key = (_norm(seller_name), _norm(buyer_name))
            if pair_key in seen_pairs:
                continue
            seen_pairs.add(pair_key)
            buyer_pool = _buyer_outgoing_players(buyer, season_year)
            if not buyer_pool:
                continue
            picks = _simple_pick_assets(league, buyer_name, season_year)
            rng.shuffle(targets)
            for target in targets[:4]:
                candidate = _build_candidate(
                    league,
                    seller,
                    buyer,
                    target,
                    buyer_pool,
                    picks,
                    contexts[seller_name],
                    contexts[buyer_name],
                    season_year,
                    rng,
                )
                if candidate:
                    candidates.append(candidate)
                    break
            if len(candidates) >= max_candidates:
                break
        if len(candidates) >= max_candidates:
            break

    candidate_trade_desk_items = []
    for candidate in candidates[:max_candidates]:
        entry = _candidate_trade_desk_entry(candidate, current_date)
        if entry:
            candidate_trade_desk_items.append(entry)

    return {
        "ok": True,
        "candidates": candidates[:max_candidates],
        "activityChance": chance,
        "skippedReason": None if candidates else "no_viable_candidates",
        "debug": {
            "sellerCount": len(sellers),
            "buyerCount": len(buyers),
            "maxCandidates": max_candidates,
            "deadlineMode": _num(context.get("daysToDeadline"), 999) <= 7,
        },
        "tradeDeskItems": (candidate_trade_desk_items + base_trade_desk_items)[:8],
    }


def find_cpu_cpu_trade_candidates_json(payload_json: str) -> str:
    try:
        payload = json.loads(payload_json or "{}")
        result = find_cpu_cpu_trade_candidates(payload)
        return json.dumps(result)
    except Exception as exc:
        return json.dumps({
            "ok": False,
            "candidates": [],
            "skippedReason": "error",
            "error": str(exc),
        })
