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
from datetime import datetime
from typing import Any, Dict, List, Optional, Set, Tuple


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
MAX_CPU_TRADES_PER_TEAM_SEASON = 8
MAX_CANDIDATES_PER_DAY = 120
RECENT_CPU_ACQUISITION_COOLDOWN_DAYS = 45

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

# Asset guardrails. V2 treats every standard-roster player as technically
# tradeable at the right price. Star/core players are protected by asking-price
# penalties instead of hard blockers, and packages remain capped for sim speed.
MIN_MARKET_PLAYER_OVR = 65
MAX_ASSETS_PER_SIDE = 5
MAX_PLAYER_ASSETS_PER_SIDE = 3
MAX_PICK_ASSETS_PER_SIDE = 4

# One-per-season mega trade lane. These caps are only used when JS requests
# megaTradeMode; the regular CPU trade bank keeps its existing package limits.
MEGA_TRADE_TARGET_OVR = 90
MEGA_MAX_ASSETS_PER_SIDE = 7
MEGA_MAX_PLAYER_ASSETS_PER_SIDE = 3
MEGA_MAX_PICK_ASSETS_PER_SIDE = 4
MEGA_TARGET_SCAN_LIMIT = 28
MEGA_BUYER_SCAN_LIMIT = 24

MAJOR_TRADE_TARGET_OVR = 80
STAR_TRADE_TARGET_OVR = 85
STANDARD_ROSTER_MIN = 14
STANDARD_ROSTER_MAX = 16

# CPU picks: simple only. Avoid swaps/protected split chaos in automated trades.
ALLOW_CPU_FIRST_ROUND_PICKS = True
ALLOW_CPU_SECOND_ROUND_PICKS = True
PREFER_SECOND_ROUND_PICK_FOR_SMALL_TRADES = True
ALLOW_CPU_PROTECTED_FIRSTS = True
CPU_PROTECTED_FIRST_PROFILES = [3, 5, 10, 14]


# Per-generation memoization. The worker handles generation requests serially,
# so these caches are reset for every payload and never cross league states.
# They only avoid recalculating deterministic values during the same exact search.
_GENERATION_CACHE: Dict[str, Any] = {}
_NORM_CACHE: Dict[str, str] = {}


def _reset_generation_cache(league: Optional[Dict[str, Any]] = None, current_date: str = "") -> None:
    global _GENERATION_CACHE, _NORM_CACHE
    _NORM_CACHE = {}
    cache: Dict[str, Any] = {
        "league": league,
        "currentDate": current_date,
        "salary": {},
        "contractYears": {},
        "roughPlayer": {},
        "roughPick": {},
        "playerItem": {},
        "pickItem": {},
        "playerOvr": {},
        "playerPot": {},
        "playerAge": {},
        "pickRound": {},
        "pickIdentity": {},
        "standardRosterCount": {},
        "rosterRank": {},
        "sellerTargets": {},
        "buyerOutgoing": {},
        "simplePicks": {},
        "tradeCounts": {},
        "tradePairs": set(),
        "recentAcquisitions": {},
    }

    if isinstance(league, dict):
        current = _parse_trade_date(current_date) if current_date else None
        for row in league.get("tradeHistory") or []:
            if not isinstance(row, dict):
                continue
            if not (row.get("cpuCpuTrade") or row.get("source") == "cpu_cpu_trade"):
                continue

            name_keys = {
                _norm(row.get("userTeamName")),
                _norm(row.get("cpuTeamName")),
                _norm(row.get("fromTeamName")),
                _norm(row.get("toTeamName")),
            }
            name_keys.discard("")
            for key in name_keys:
                cache["tradeCounts"][key] = cache["tradeCounts"].get(key, 0) + 1

            pair = {_norm(row.get("fromTeamName")), _norm(row.get("toTeamName"))}
            pair.discard("")
            if len(pair) == 2:
                cache["tradePairs"].add(frozenset(pair))

            if current is None:
                continue
            previous = _parse_trade_date(row.get("date") or row.get("currentDate"))
            if previous is None:
                continue
            elapsed = (current - previous).days
            if elapsed < 0 or elapsed > RECENT_CPU_ACQUISITION_COOLDOWN_DAYS:
                continue
            for move in row.get("movedPlayers") or []:
                if not isinstance(move, dict):
                    continue
                team_key = _norm(move.get("toTeam"))
                player_key = _norm(move.get("name"))
                if team_key and player_key:
                    cache["recentAcquisitions"].setdefault(team_key, set()).add(player_key)

    _GENERATION_CACHE = cache


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
    text = value if isinstance(value, str) else _str(value)
    cached = _NORM_CACHE.get(text)
    if cached is not None:
        return cached
    normalized = "".join(ch for ch in text.lower() if ch.isalnum())
    if len(_NORM_CACHE) < 4096:
        _NORM_CACHE[text] = normalized
    return normalized


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
    cache = _GENERATION_CACHE.get("playerOvr") if isinstance(_GENERATION_CACHE, dict) else None
    key = id(player)
    if isinstance(cache, dict) and key in cache:
        return cache[key]
    value = _num(player.get("overall") or player.get("ovr") or player.get("rating"), 60.0)
    if isinstance(cache, dict):
        cache[key] = value
    return value


def _player_pot(player: Dict[str, Any]) -> float:
    cache = _GENERATION_CACHE.get("playerPot") if isinstance(_GENERATION_CACHE, dict) else None
    key = id(player)
    if isinstance(cache, dict) and key in cache:
        return cache[key]
    value = _num(player.get("potential") or player.get("pot") or _player_ovr(player), _player_ovr(player))
    if isinstance(cache, dict):
        cache[key] = value
    return value


def _player_age(player: Dict[str, Any]) -> float:
    cache = _GENERATION_CACHE.get("playerAge") if isinstance(_GENERATION_CACHE, dict) else None
    key = id(player)
    if isinstance(cache, dict) and key in cache:
        return cache[key]
    value = _num(player.get("age"), 27.0)
    if isinstance(cache, dict):
        cache[key] = value
    return value


def _salary_for_year(player: Dict[str, Any], season_year: int) -> float:
    cache = _GENERATION_CACHE.get("salary") if isinstance(_GENERATION_CACHE, dict) else None
    key = (id(player), int(season_year))
    if isinstance(cache, dict):
        cached = cache.get(key)
        if cached and cached[0] is player:
            return cached[1]

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
        value = max(0.0, _num(salaries[idx], 0.0))
    else:
        value = max(0.0, _num(player.get("salary") or player.get("currentSalary") or player.get("capHit"), 0.0))

    if isinstance(cache, dict):
        cache[key] = (player, value)
    return value


def _contract_years_left(player: Dict[str, Any], season_year: int) -> int:
    cache = _GENERATION_CACHE.get("contractYears") if isinstance(_GENERATION_CACHE, dict) else None
    key = (id(player), int(season_year))
    if isinstance(cache, dict):
        cached = cache.get(key)
        if cached and cached[0] is player:
            return cached[1]

    contract = player.get("contract") if isinstance(player.get("contract"), dict) else {}
    salaries = contract.get("salaryByYear") if isinstance(contract.get("salaryByYear"), list) else []
    if not salaries:
        value = 1 if _salary_for_year(player, season_year) > 0 else 0
    else:
        start = int(_num(contract.get("startYear"), season_year))
        idx = season_year - start
        if idx < 0:
            idx = 0
        value = 1 if idx >= len(salaries) else max(1, len(salaries) - idx)

    if isinstance(cache, dict):
        cache[key] = (player, value)
    return value


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
    if _GENERATION_CACHE.get("league") is league:
        return int((_GENERATION_CACHE.get("tradeCounts") or {}).get(_norm(team_name), 0))

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


def _already_traded_pair(
    league: Dict[str, Any],
    team_a: str,
    team_b: str,
) -> bool:
    wanted = {_norm(team_a), _norm(team_b)}
    if len(wanted) != 2:
        return False

    if _GENERATION_CACHE.get("league") is league:
        return frozenset(wanted) in (_GENERATION_CACHE.get("tradePairs") or set())

    for row in league.get("tradeHistory") or []:
        if not isinstance(row, dict):
            continue
        if not (row.get("cpuCpuTrade") or row.get("source") == "cpu_cpu_trade"):
            continue

        names = {
            _norm(row.get("fromTeamName")),
            _norm(row.get("toTeamName")),
        }
        names.discard("")

        if names == wanted:
            return True

    return False


def _parse_trade_date(value: Any) -> Optional[datetime]:
    text = _str(value, "").strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00").split("T")[0])
    except Exception:
        return None


def _recent_cpu_acquired_player_names(
    league: Dict[str, Any],
    team_name: str,
    current_date: str,
    cooldown_days: int = RECENT_CPU_ACQUISITION_COOLDOWN_DAYS,
) -> Set[str]:
    if (
        _GENERATION_CACHE.get("league") is league
        and _GENERATION_CACHE.get("currentDate") == current_date
        and cooldown_days == RECENT_CPU_ACQUISITION_COOLDOWN_DAYS
    ):
        return (_GENERATION_CACHE.get("recentAcquisitions") or {}).get(_norm(team_name), set())

    current = _parse_trade_date(current_date)
    if current is None or not team_name:
        return set()

    locked: Set[str] = set()
    for row in league.get("tradeHistory") or []:
        if not isinstance(row, dict):
            continue
        if not (row.get("cpuCpuTrade") or row.get("source") == "cpu_cpu_trade"):
            continue

        previous = _parse_trade_date(row.get("date") or row.get("currentDate"))
        if previous is None:
            continue

        elapsed = (current - previous).days
        if elapsed < 0 or elapsed > cooldown_days:
            continue

        for move in row.get("movedPlayers") or []:
            if not isinstance(move, dict):
                continue
            if _norm(move.get("toTeam")) == _norm(team_name):
                name_key = _norm(move.get("name"))
                if name_key:
                    locked.add(name_key)

    return locked


def _is_standard_player(player: Dict[str, Any]) -> bool:
    status = _str(player.get("rosterStatus") or player.get("contractType"), "").lower()
    return not (player.get("isTwoWay") or player.get("isStash") or "two" in status or "stash" in status)


def _standard_roster_count(team: Dict[str, Any]) -> int:
    cache = _GENERATION_CACHE.get("standardRosterCount") if isinstance(_GENERATION_CACHE, dict) else None
    key = id(team)
    if isinstance(cache, dict):
        cached = cache.get(key)
        if cached and cached[0] is team:
            return cached[1]

    value = sum(
        1
        for player in _players(team)
        if isinstance(player, dict) and _is_standard_player(player)
    )
    if isinstance(cache, dict):
        cache[key] = (team, value)
    return value


def _roster_rank(team: Dict[str, Any], player: Dict[str, Any]) -> int:
    cache = _GENERATION_CACHE.get("rosterRank") if isinstance(_GENERATION_CACHE, dict) else None
    key = (id(team), id(player))
    if isinstance(cache, dict):
        cached = cache.get(key)
        if cached and cached[0] is team and cached[1] is player:
            return cached[2]

    roster = sorted(_players(team), key=_player_ovr, reverse=True)
    try:
        value = roster.index(player) + 1
    except Exception:
        value = 99
    if isinstance(cache, dict):
        cache[key] = (team, player, value)
    return value


def _asset_protection_penalty(team: Dict[str, Any], player: Dict[str, Any], team_ctx: Optional[Dict[str, Any]] = None) -> float:
    """Soft asking-price protection. No standard player is hard-blocked."""
    ctx = team_ctx or {}
    rank = _roster_rank(team, player)
    ovr = _player_ovr(player)
    pot = _player_pot(player)
    age = _player_age(player)
    years_left = _contract_years_left(player, int(_num(ctx.get("seasonYear"), 2026)))
    phase = _str(ctx.get("phase"), "middle")
    upside = max(0.0, pot - ovr)

    penalty = 0.0
    if rank == 1:
        penalty += 13.0
    elif rank == 2:
        penalty += 8.0
    elif rank == 3:
        penalty += 5.0
    elif rank <= 5:
        penalty += 2.2

    if ovr >= 92:
        penalty += 20.0
    elif ovr >= 89:
        penalty += 12.0
    elif ovr >= STAR_TRADE_TARGET_OVR:
        penalty += 7.0
    elif ovr >= MAJOR_TRADE_TARGET_OVR:
        penalty += 3.0

    if age <= 24 and pot >= 84:
        penalty += 2.5 + upside * 0.32
    if age <= 22 and pot >= 88:
        penalty += 4.0

    # Sellers/retoolers should listen on real players. Contenders should not move
    # core pieces unless the exact evaluator later sees a massive return.
    if phase in {"seller", "retool"}:
        penalty *= 0.52
        if age >= 29 or years_left <= 1:
            penalty *= 0.62
        # Low-direction teams should actually listen on expensive 80+ veterans.
        # The exact Propose Trade-style validator still blocks weak returns, but
        # this prevents the generator from never surfacing realistic sell-high names.
        if ovr >= MAJOR_TRADE_TARGET_OVR and age >= 32:
            penalty *= 0.78
    elif phase == "middle":
        penalty *= 0.88
    elif phase == "buyer":
        penalty *= 1.18
    elif phase == "contender":
        penalty *= 1.38

    return penalty



def _is_shared_untouchable_core(team: Dict[str, Any], player: Dict[str, Any], team_ctx: Optional[Dict[str, Any]] = None) -> bool:
    """Hard CPU-outgoing guard matching League Intel's protected-core spirit.

    Retooling/selling teams should not protect 28+ players. Contenders can
    still treat elite prime stars as core, but young blue-chip pieces are the
    main hard blocker for CPU-to-CPU outgoing packages.
    """
    ctx = team_ctx or {}
    phase = _str(ctx.get("phase"), "middle")
    ovr = _player_ovr(player)
    pot = _player_pot(player)
    age = _player_age(player)
    upside = max(0.0, pot - ovr)
    rank = _roster_rank(team, player)

    if phase in {"seller", "retool"} and age >= 28:
        return False

    if age <= 23 and pot >= 90 and ovr >= 76:
        return True
    if age <= 24 and pot >= 88 and upside >= 6:
        return True
    if age <= 25 and ovr >= 89 and pot >= 93:
        return True
    if age <= 22 and ovr >= 80 and pot >= 94:
        return True
    if phase in {"contender", "buyer"}:
        if ovr >= 94 and age <= 32 and rank <= 2:
            return True
        if ovr >= 91 and 24 <= age <= 32 and rank == 1:
            return True

    return False

def _market_player_score(team: Dict[str, Any], player: Dict[str, Any], season_year: int, team_ctx: Optional[Dict[str, Any]] = None, role: str = "seller") -> float:
    ctx = dict(team_ctx or {})
    ctx["seasonYear"] = season_year
    ovr = _player_ovr(player)
    pot = _player_pot(player)
    age = _player_age(player)
    years_left = _contract_years_left(player, season_year)
    salary_m = _salary_for_year(player, season_year) / 1_000_000
    upside = max(0.0, pot - ovr)
    rank = _roster_rank(team, player)
    phase = _str(ctx.get("phase"), "middle")
    protection = _asset_protection_penalty(team, player, ctx)

    if role == "seller":
        score = ovr * 1.55
        score += max(0.0, age - 27) * 0.85
        score += max(0.0, salary_m - 18.0) * 0.22
        score += 4.0 if years_left <= 1 else 0.0
        score += 2.4 if phase in {"seller", "retool"} else 0.0
        if phase in {"seller", "retool"} and ovr >= MAJOR_TRADE_TARGET_OVR:
            score += 6.8
        if phase in {"seller", "retool"} and ovr >= STAR_TRADE_TARGET_OVR and age >= 28:
            score += 4.2
        if phase in {"seller", "retool"} and ovr >= STAR_TRADE_TARGET_OVR and age >= 32:
            score += 5.2
        score -= upside * (0.22 if phase in {"seller", "retool"} and ovr >= MAJOR_TRADE_TARGET_OVR else 0.32)
        score -= protection
    else:
        # Buyer outgoing board: prospects/picks/salary are movable, but core stars
        # stay expensive rather than impossible. This lets big trades exist when
        # exact bilateral value really clears the bar.
        score = max(0.0, 82.0 - ovr) * 0.85
        score += upside * 0.35
        score += max(0.0, 26 - age) * 0.55
        score += min(salary_m / 8.0, 3.0)
        if rank >= 7:
            score += 4.0
        elif rank >= 4:
            score += 1.0
        score -= protection * (0.46 if phase in {"contender", "buyer"} else 0.70)

    return score


def _seller_trade_targets(team: Dict[str, Any], season_year: int, team_ctx: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    cache = _GENERATION_CACHE.get("sellerTargets") if isinstance(_GENERATION_CACHE, dict) else None
    cache_key = (id(team), int(season_year), id(team_ctx))
    if isinstance(cache, dict):
        cached = cache.get(cache_key)
        if cached and cached[0] is team and cached[1] is team_ctx:
            return cached[2]

    out = []
    for p in _players(team):
        if not isinstance(p, dict) or not _is_standard_player(p):
            continue
        ovr = _player_ovr(p)
        if ovr < MIN_MARKET_PLAYER_OVR:
            continue
        if _is_shared_untouchable_core(team, p, team_ctx):
            continue
        score = _market_player_score(team, p, season_year, team_ctx, "seller")
        # Keep every tier technically available, but do not waste the generator's
        # limited attempts on players a team would almost never shop today.
        if score < 45 and ovr < MAJOR_TRADE_TARGET_OVR:
            continue
        out.append({"player": p, "score": score})

    # Ensure the board contains some real starter/star possibilities when a team
    # is selling, not only the safest mid-70s names.
    ranked = sorted(out, key=lambda x: x["score"], reverse=True)
    starter_rows = [r for r in ranked if _player_ovr(r["player"]) >= MAJOR_TRADE_TARGET_OVR]
    mixed = []
    seen = set()
    for row in starter_rows[:8] + ranked:
        player_key = _norm(row["player"].get("id") or row["player"].get("name"))
        if player_key and player_key not in seen:
            seen.add(player_key)
            mixed.append(row["player"])
    result = mixed[:20]
    if isinstance(cache, dict):
        cache[cache_key] = (team, team_ctx, result)
    return result


def _buyer_outgoing_players(team: Dict[str, Any], season_year: int, team_ctx: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    cache = _GENERATION_CACHE.get("buyerOutgoing") if isinstance(_GENERATION_CACHE, dict) else None
    key = (id(team), int(season_year), id(team_ctx))
    if isinstance(cache, dict):
        cached = cache.get(key)
        if cached and cached[0] is team and cached[1] is team_ctx:
            return cached[2]

    out = []
    for p in _players(team):
        if not isinstance(p, dict) or not _is_standard_player(p):
            continue
        ovr = _player_ovr(p)
        if ovr < MIN_MARKET_PLAYER_OVR:
            continue
        if _is_shared_untouchable_core(team, p, team_ctx):
            continue
        score = _market_player_score(team, p, season_year, team_ctx, "buyer")
        if score < -8 and ovr >= STAR_TRADE_TARGET_OVR:
            continue
        out.append({"player": p, "score": score})
    result = [r["player"] for r in sorted(out, key=lambda x: x["score"], reverse=True)[:20]]
    if isinstance(cache, dict):
        cache[key] = (team, team_ctx, result)
    return result


def _pick_identity_key(pick: Dict[str, Any]) -> str:
    cache = _GENERATION_CACHE.get("pickIdentity") if isinstance(_GENERATION_CACHE, dict) else None
    key = id(pick)
    if isinstance(cache, dict) and key in cache:
        return cache[key]
    value = "|".join([
        _str(pick.get("assetType") or pick.get("type") or "pick", "pick").lower(),
        _str(int(_num(pick.get("year") or pick.get("seasonYear"), 0))),
        _str(int(_num(pick.get("round"), 1))),
        _norm(pick.get("originalTeam") or pick.get("originalTeamName") or pick.get("team")),
        _norm(pick.get("ownerTeam") or pick.get("currentOwnerTeamName") or pick.get("owner")),
    ])
    if isinstance(cache, dict):
        cache[key] = value
    return value


def _protected_first_variant(pick: Dict[str, Any], protect_end: int) -> Dict[str, Any]:
    label = "Lottery Protected" if int(protect_end) == 14 else f"Top {int(protect_end)} Protected"
    return {
        **pick,
        "protection": label,
        "protections": label,
        "displayProtection": label,
        "cpuGeneratedProtection": True,
        "tradeRule": {
            "action": "protected",
            "protectStart": 1,
            "protectEnd": int(protect_end),
            "baseProtectionLabel": f"Top {int(protect_end)} Protected",
        },
    }


def _simple_pick_assets(league: Dict[str, Any], owner_team: str, season_year: int) -> List[Dict[str, Any]]:
    cache = _GENERATION_CACHE.get("simplePicks") if isinstance(_GENERATION_CACHE, dict) else None
    key = (id(league), _norm(owner_team), int(season_year))
    if isinstance(cache, dict):
        cached = cache.get(key)
        if cached and cached[0] is league:
            return cached[1]

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
        distance = max(1, year - season_year)
        score = (0 if rnd == 2 else 10) + distance * 0.25
        out.append({"pick": row, "score": score, "round": rnd})

        # Give the automated market a realistic middle ground between no first and
        # a fully unprotected first. These are simple one-protection picks only, so
        # they match the project rule while giving high-quality trades better shape.
        if ALLOW_CPU_PROTECTED_FIRSTS and rnd == 1:
            for protect_end in CPU_PROTECTED_FIRST_PROFILES:
                variant = _protected_first_variant(row, protect_end)
                protection_discount = {3: 0.15, 5: 0.30, 10: 0.65, 14: 0.95}.get(int(protect_end), 0.55)
                out.append({"pick": variant, "score": score + protection_discount, "round": rnd})

    result = [r["pick"] for r in sorted(out, key=lambda x: x["score"])[:16]]
    if isinstance(cache, dict):
        cache[key] = (league, result)
    return result


def _player_item(player: Dict[str, Any]) -> Dict[str, Any]:
    cache = _GENERATION_CACHE.get("playerItem") if isinstance(_GENERATION_CACHE, dict) else None
    key = id(player)
    if isinstance(cache, dict):
        cached = cache.get(key)
        if cached and cached[0] is player:
            return cached[1]
    item = {"type": "player", "player": player}
    if isinstance(cache, dict):
        cache[key] = (player, item)
    return item


def _pick_item(pick: Dict[str, Any]) -> Dict[str, Any]:
    cache = _GENERATION_CACHE.get("pickItem") if isinstance(_GENERATION_CACHE, dict) else None
    key = id(pick)
    if isinstance(cache, dict):
        cached = cache.get(key)
        if cached and cached[0] is pick:
            return cached[1]
    protection = _str(pick.get("displayProtection") or pick.get("protections") or pick.get("protection") or "Unprotected", "Unprotected")
    round_label = '1st' if int(_num(pick.get('round'), 1)) == 1 else '2nd'
    label_suffix = "" if protection.lower() in {"", "unprotected", "none", "null"} else f" ({protection})"
    item = {
        "type": "pick",
        "pick": pick,
        "protection": protection or "Unprotected",
        "tradeRule": pick.get("tradeRule") if isinstance(pick.get("tradeRule"), dict) else None,
        "displayLabel": f"{pick.get('year', '')} {round_label} - {pick.get('originalTeam') or pick.get('team') or 'Own'}{label_suffix}",
    }
    if isinstance(cache, dict):
        cache[key] = (pick, item)
    return item


def _rough_value_player(player: Dict[str, Any], season_year: int) -> float:
    cache = _GENERATION_CACHE.get("roughPlayer") if isinstance(_GENERATION_CACHE, dict) else None
    key = (id(player), int(season_year))
    if isinstance(cache, dict):
        cached = cache.get(key)
        if cached and cached[0] is player:
            return cached[1]

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
    value = (ovr - 65) * 0.45 + upside * 0.22 + age_adj - contract_drag
    if isinstance(cache, dict):
        cache[key] = (player, value)
    return value


def _rough_value_pick(pick: Dict[str, Any], season_year: int = 2026) -> float:
    cache = _GENERATION_CACHE.get("roughPick") if isinstance(_GENERATION_CACHE, dict) else None
    key = (id(pick), int(season_year))
    if isinstance(cache, dict):
        cached = cache.get(key)
        if cached and cached[0] is pick:
            return cached[1]

    rnd = int(_num(pick.get("round"), 1))
    year = int(_num(pick.get("year") or pick.get("seasonYear"), season_year + 3))
    distance = max(1, min(7, year - season_year))
    protection = _str(pick.get("displayProtection") or pick.get("protections") or pick.get("protection") or "", "").lower()
    if rnd == 1:
        value = max(4.8, 7.2 - distance * 0.25)
        if "lottery" in protection or "top 14" in protection:
            value *= 0.62
        elif "top 10" in protection:
            value *= 0.70
        elif "top 5" in protection:
            value *= 0.82
        elif "top 3" in protection:
            value *= 0.88
        elif "protected" in protection:
            value *= 0.78
    else:
        value = max(0.9, 1.7 - distance * 0.08)

    if isinstance(cache, dict):
        cache[key] = (pick, value)
    return value


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


def _pick_bundle_options(
    picks: List[Dict[str, Any]],
    max_picks: int,
    rng: random.Random,
    allow_four_pick_bundles: bool = False,
) -> List[List[Dict[str, Any]]]:
    clean = [p for p in picks if isinstance(p, dict)]
    rng.shuffle(clean)
    seconds = [p for p in clean if int(_num(p.get("round"), 1)) == 2]
    protected_firsts = [p for p in clean if int(_num(p.get("round"), 1)) == 1 and "protected" in _str(p.get("displayProtection") or p.get("protection") or "").lower()]
    unprotected_firsts = [p for p in clean if int(_num(p.get("round"), 1)) == 1 and p not in protected_firsts]
    ordered = protected_firsts[:6] + unprotected_firsts[:5] + seconds[:6]
    ordered += [p for p in clean if p not in ordered]
    ordered = ordered[:12]
    out: List[List[Dict[str, Any]]] = [[]]

    def add_bundle(bundle: List[Dict[str, Any]]) -> None:
        if len(bundle) > max_picks:
            return
        keys = [_pick_identity_key(p) for p in bundle]
        if len(keys) != len(set(keys)):
            return
        sig = tuple(sorted((_str(p.get("id") or ""), _str(p.get("displayProtection") or p.get("protection") or "")) for p in bundle))
        if sig in seen:
            return
        seen.add(sig)
        out.append(bundle)

    seen = {tuple()}
    for pick in ordered:
        add_bundle([pick])
    if max_picks >= 2:
        limit = min(len(ordered), 10)
        for i in range(limit):
            for j in range(i + 1, limit):
                add_bundle([ordered[i], ordered[j]])
    if max_picks >= 3:
        # Rare richer pick bundles: protected first + second, or first + two seconds.
        limit = min(len(ordered), 9)
        for i in range(limit):
            for j in range(i + 1, limit):
                for k in range(j + 1, limit):
                    bundle = [ordered[i], ordered[j], ordered[k]]
                    firsts = sum(1 for p in bundle if int(_num(p.get("round"), 1)) == 1)
                    if firsts <= 2:
                        add_bundle(bundle)

    if allow_four_pick_bundles and max_picks >= 4:
        # Mega trades can reach a real blockbuster pick shape, but this lane is
        # opt-in so the normal bank does not pay the combinatorics cost.
        limit = min(len(ordered), 8)
        for i in range(limit):
            for j in range(i + 1, limit):
                for k in range(j + 1, limit):
                    for l in range(k + 1, limit):
                        bundle = [ordered[i], ordered[j], ordered[k], ordered[l]]
                        firsts = sum(1 for p in bundle if int(_num(p.get("round"), 1)) == 1)
                        if 2 <= firsts <= 3:
                            add_bundle(bundle)
    return out


def _package_value(items: List[Dict[str, Any]], season_year: int) -> float:
    total = 0.0
    for item in items:
        if not isinstance(item, dict):
            continue
        if item.get("type") == "player" and isinstance(item.get("player"), dict):
            total += _rough_value_player(item["player"], season_year)
        elif item.get("type") == "pick" and isinstance(item.get("pick"), dict):
            total += _rough_value_pick(item["pick"], season_year)
    return total


def _package_salary(items: List[Dict[str, Any]], season_year: int) -> float:
    return sum(
        _salary_for_year(item.get("player"), season_year)
        for item in items
        if isinstance(item, dict) and item.get("type") == "player" and isinstance(item.get("player"), dict)
    )


def _pick_round(pick: Dict[str, Any]) -> int:
    cache = _GENERATION_CACHE.get("pickRound") if isinstance(_GENERATION_CACHE, dict) else None
    key = id(pick)
    if isinstance(cache, dict) and key in cache:
        return cache[key]
    value = int(_num(pick.get("round"), 1))
    if isinstance(cache, dict):
        cache[key] = value
    return value


def _has_first(items: List[Dict[str, Any]]) -> bool:
    return any(item.get("type") == "pick" and _pick_round(item.get("pick") or {}) == 1 for item in items)


def _has_second(items: List[Dict[str, Any]]) -> bool:
    return any(item.get("type") == "pick" and _pick_round(item.get("pick") or {}) == 2 for item in items)


def _first_count(items: List[Dict[str, Any]]) -> int:
    return sum(1 for item in items if item.get("type") == "pick" and _pick_round(item.get("pick") or {}) == 1)


def _premium_young_asset_count(items: List[Dict[str, Any]]) -> int:
    count = 0
    for item in items:
        if not isinstance(item, dict) or item.get("type") != "player" or not isinstance(item.get("player"), dict):
            continue
        player = item["player"]
        if _player_age(player) <= 24 and _player_pot(player) >= 82:
            count += 1
    return count


def _player_position_bucket(player: Dict[str, Any]) -> str:
    text = _str(player.get("pos") or player.get("position") or player.get("positionAbbrev"), "").upper()
    for token in ["PG", "SG", "SF", "PF", "C"]:
        if token in text:
            return token
    if "G" in text:
        return "SG"
    if "F" in text:
        return "SF"
    return "UTIL"


def _is_young_franchise_cornerstone(player: Dict[str, Any]) -> bool:
    age = _player_age(player)
    ovr = _player_ovr(player)
    pot = _player_pot(player)
    upside = max(0.0, pot - ovr)
    return bool(
        ovr >= MEGA_TRADE_TARGET_OVR
        and (
            (age <= 23 and pot >= 92)
            or (age <= 24 and pot >= 94)
            or (age <= 25 and pot >= 94 and upside >= 3)
        )
    )


def _buyer_mega_fit_score(buyer: Dict[str, Any], target: Dict[str, Any], buyer_ctx: Dict[str, Any]) -> float:
    target_bucket = _player_position_bucket(target)
    target_ovr = _player_ovr(target)
    ranked = sorted(_players(buyer), key=lambda p: _player_ovr(p), reverse=True)
    top8 = sum(_player_ovr(p) for p in ranked[:8]) / max(1, len(ranked[:8])) if ranked else 70.0
    same_bucket_quality = [p for p in ranked if _player_position_bucket(p) == target_bucket and _player_ovr(p) >= 80]
    same_bucket_star = max((_player_ovr(p) for p in same_bucket_quality), default=0.0)
    need_bonus = 0.0
    if target_bucket == "UTIL":
        need_bonus = 0.35
    elif not same_bucket_quality:
        need_bonus = 1.20
    elif same_bucket_star <= target_ovr - 5.0:
        need_bonus = 0.90
    elif same_bucket_star <= target_ovr - 2.0:
        need_bonus = 0.45
    else:
        need_bonus = -0.75

    phase_bonus = 1.30 if buyer_ctx.get("phase") == "contender" else 0.62 if buyer_ctx.get("phase") == "buyer" else 0.0
    return (top8 - 78.0) * 0.19 + phase_bonus + need_bonus + _num(buyer_ctx.get("buyerWeight"), 0.0)


def _best_player_value(items: List[Dict[str, Any]], season_year: int) -> float:
    vals = [
        _rough_value_player(item.get("player"), season_year)
        for item in items
        if isinstance(item, dict) and item.get("type") == "player" and isinstance(item.get("player"), dict)
    ]
    return max(vals) if vals else 0.0


def _best_player_ovr(items: List[Dict[str, Any]]) -> float:
    vals = [
        _player_ovr(item.get("player"))
        for item in items
        if isinstance(item, dict) and item.get("type") == "player" and isinstance(item.get("player"), dict)
    ]
    return max(vals) if vals else 0.0


def _has_premium_young_asset(items: List[Dict[str, Any]]) -> bool:
    for item in items:
        if not isinstance(item, dict) or item.get("type") != "player" or not isinstance(item.get("player"), dict):
            continue
        player = item["player"]
        if _player_age(player) <= 24 and _player_pot(player) >= 82:
            return True
    return False


def _player_combo_options(pool: List[Dict[str, Any]], max_players: int, rng: random.Random, target: Optional[Dict[str, Any]] = None, season_year: int = 2026) -> List[List[Dict[str, Any]]]:
    rows = [p for p in pool if isinstance(p, dict)]
    target_salary = _salary_for_year(target or {}, season_year)
    target_ovr = _player_ovr(target or {})

    # Build three lanes rather than one sorted movable list:
    # 1) salary ballast for large contracts, 2) premium future/current value, and
    # 3) normal movable depth. This is the key v3 change that lets the bank find
    # starter/high-salary frameworks without hardcoding stars into or out of the market.
    by_movable = rows[:]
    rng.shuffle(by_movable)
    by_movable = sorted(
        by_movable,
        key=lambda p: (
            _market_player_score({"players": rows}, p, season_year, {}, "buyer"),
            _rough_value_player(p, season_year),
        ),
        reverse=True,
    )[:12]

    by_value = sorted(
        rows,
        key=lambda p: (
            _rough_value_player(p, season_year),
            max(0.0, _player_pot(p) - _player_ovr(p)),
            _player_ovr(p),
        ),
        reverse=True,
    )[:10 if target_ovr >= MAJOR_TRADE_TARGET_OVR else 6]

    by_salary = sorted(
        rows,
        key=lambda p: (
            abs(_salary_for_year(p, season_year) - max(1.0, target_salary * 0.62)),
            -_rough_value_player(p, season_year),
        ),
    )[:8 if target_salary >= 18_000_000 else 4]

    ordered = []
    seen = set()
    for bucket in (by_value, by_salary, by_movable):
        for player in bucket:
            key = _norm(player.get("id") or player.get("name"))
            if key and key not in seen:
                seen.add(key)
                ordered.append(player)

    ordered = ordered[:18 if target_ovr >= MAJOR_TRADE_TARGET_OVR else 12]
    combos: List[List[Dict[str, Any]]] = []

    def add_combo(combo: List[Dict[str, Any]]) -> None:
        if not combo or len(combo) > max_players:
            return
        sig = tuple(sorted(_norm(p.get("id") or p.get("name")) for p in combo))
        if not sig or any(not x for x in sig):
            return
        if sig in combo_seen:
            return
        combo_seen.add(sig)
        combos.append(combo)

    combo_seen = set()
    for p0 in ordered:
        add_combo([p0])

    if max_players >= 2:
        limit = min(len(ordered), 14 if target_ovr >= MAJOR_TRADE_TARGET_OVR else 9)
        for i in range(limit):
            for j in range(i + 1, limit):
                add_combo([ordered[i], ordered[j]])

    if max_players >= 3:
        # For high-value targets, include enough three-player salary/value shells to
        # satisfy matching, but cap the combinatorics tightly for sim speed.
        limit = min(len(ordered), 10 if target_ovr >= MAJOR_TRADE_TARGET_OVR else 7)
        for i in range(limit):
            for j in range(i + 1, limit):
                for k in range(j + 1, limit):
                    add_combo([ordered[i], ordered[j], ordered[k]])

    rng.shuffle(combos)
    combos.sort(
        key=lambda combo: (
            -abs(_package_salary([_player_item(p) for p in combo], season_year) - target_salary) / 10_000_000,
            _package_value([_player_item(p) for p in combo], season_year),
        ),
        reverse=True,
    )
    return combos[:84 if target_ovr >= MAJOR_TRADE_TARGET_OVR else 42]


def _target_value_window(target: Dict[str, Any]) -> Tuple[float, float]:
    ovr = _player_ovr(target)
    if ovr >= 90:
        return (1.50, 22.0)
    if ovr >= STAR_TRADE_TARGET_OVR:
        return (-0.15, 19.0)
    if ovr >= MAJOR_TRADE_TARGET_OVR:
        return (-1.75, 16.5)
    if ovr >= 78:
        return (-2.45, 12.0)
    return (-3.10, 8.5)


def _mega_target_value_window(target: Dict[str, Any]) -> Tuple[float, float]:
    age = _player_age(target)
    ovr = _player_ovr(target)
    # Direct deadline mega trades need a broader value window than normal banked
    # deals. Otherwise a realistic Booker/Tatum-style trade can fail because a
    # contender's available salary+picks lands a few points outside the narrow
    # asking band even though both teams would plausibly accept the framework.
    if age <= 31:
        low, high = 2.0, 42.0
    elif age <= 34:
        low, high = 1.2, 34.0
    else:
        low, high = 0.3, 26.0
    if ovr >= 94:
        low += 0.8
        high += 6.0
    elif ovr >= 92:
        low += 0.4
        high += 4.0
    return (low, high)


def _candidate_template_label(target: Dict[str, Any], to_items: List[Dict[str, Any]], from_items: List[Dict[str, Any]]) -> str:
    ovr = _player_ovr(target)
    pick_count = sum(1 for item in to_items if item.get("type") == "pick")
    player_count = sum(1 for item in to_items if item.get("type") == "player")
    seller_pick_count = sum(1 for item in from_items if item.get("type") == "pick")
    if ovr >= STAR_TRADE_TARGET_OVR:
        return "star-market framework"
    if ovr >= MAJOR_TRADE_TARGET_OVR and pick_count:
        return "starter plus picks framework"
    if player_count >= 2 and ovr >= 78:
        return "consolidation framework"
    if seller_pick_count:
        return "seller-sweetened directional framework"
    if pick_count:
        return "pick-sweetened rotation framework"
    return "directional player framework"


def _build_candidate(
    league: Dict[str, Any],
    seller: Dict[str, Any],
    buyer: Dict[str, Any],
    target: Dict[str, Any],
    buyer_pool: List[Dict[str, Any]],
    buyer_picks: List[Dict[str, Any]],
    seller_picks: List[Dict[str, Any]],
    seller_ctx: Dict[str, Any],
    buyer_ctx: Dict[str, Any],
    season_year: int,
    rng: random.Random,
    mega_trade: bool = False,
) -> Optional[Dict[str, Any]]:
    target_salary = _salary_for_year(target, season_year)
    target_value = _rough_value_player(target, season_year)
    target_ovr = _player_ovr(target)

    seller_roster_count = _standard_roster_count(seller)
    buyer_roster_count = _standard_roster_count(buyer)
    seller_allowed_max = max(STANDARD_ROSTER_MAX, seller_roster_count + 1)
    buyer_allowed_max = max(STANDARD_ROSTER_MAX, buyer_roster_count + 1)

    max_assets = MEGA_MAX_ASSETS_PER_SIDE if mega_trade else MAX_ASSETS_PER_SIDE
    max_players = min(MEGA_MAX_PLAYER_ASSETS_PER_SIDE if mega_trade else MAX_PLAYER_ASSETS_PER_SIDE, max_assets)
    max_picks = MEGA_MAX_PICK_ASSETS_PER_SIDE if mega_trade else MAX_PICK_ASSETS_PER_SIDE
    player_combos = _player_combo_options(buyer_pool, max_players, rng, target, season_year)
    pick_bundles = _pick_bundle_options(
        buyer_picks,
        max_picks,
        rng,
        allow_four_pick_bundles = mega_trade,
    )
    # Keep the generated search progressive rather than exhaustive. First-round
    # options are considered early for starter/star targets, but we cap the bundle
    # count so one hard salary match cannot stall the sim thread.
    if mega_trade:
        pick_bundles = pick_bundles[:64]
    elif target_ovr >= STAR_TRADE_TARGET_OVR:
        pick_bundles = pick_bundles[:28]
    elif target_ovr >= MAJOR_TRADE_TARGET_OVR:
        pick_bundles = pick_bundles[:24]
    else:
        pick_bundles = pick_bundles[:12]
    seller_pick_bundles = _pick_bundle_options(seller_picks, 1, rng)[:6]

    viable = []
    min_balance, max_balance = _mega_target_value_window(target) if mega_trade else _target_value_window(target)

    # Higher-end targets need real outbound structure. This keeps every player
    # available while making expensive players require multi-asset frameworks.
    for combo in player_combos:
        outgoing_player_items = [_player_item(p) for p in combo]
        for pick_bundle in pick_bundles:
            if len(combo) + len(pick_bundle) > max_assets:
                continue
            if target_ovr >= STAR_TRADE_TARGET_OVR and len(combo) + len(pick_bundle) < 2:
                continue
            if target_ovr >= 87 and len(combo) + len(pick_bundle) < 3:
                continue
            to_items = outgoing_player_items + [_pick_item(p) for p in pick_bundle]
            if not to_items:
                continue

            # Starter/high-end targets must be paid for with actual trade capital,
            # not just the two second-round-pick shells that made v2 feel shallow.
            if target_ovr >= MAJOR_TRADE_TARGET_OVR:
                has_real_anchor = (
                    _has_first(to_items) or
                    _has_premium_young_asset(to_items) or
                    _best_player_ovr(to_items) >= max(76.0, target_ovr - 4.0)
                )
                if not has_real_anchor:
                    continue
            if target_ovr >= STAR_TRADE_TARGET_OVR:
                premium_points = 0
                premium_points += 2 if _has_first(to_items) else 0
                premium_points += 1 if _has_second(to_items) else 0
                premium_points += 2 if _has_premium_young_asset(to_items) else 0
                premium_points += 1 if _best_player_ovr(to_items) >= target_ovr - 5.0 else 0
                if premium_points < 3:
                    continue

            if mega_trade:
                first_count = _first_count(to_items)
                premium_young_count = _premium_young_asset_count(to_items)
                best_outgoing_ovr = _best_player_ovr(to_items)
                mega_premium_points = first_count * 2 + premium_young_count * 3
                if best_outgoing_ovr >= target_ovr - 7.0:
                    mega_premium_points += 2
                elif best_outgoing_ovr >= 82.0:
                    mega_premium_points += 1
                # Dedicated mega-trade lane: multiple firsts can carry value
                # without requiring the buyer to give up its own League Intel
                # untouchable young core. This lets contenders push in for 90+
                # prime/older stars without sending Wemby/Harper-style pieces.
                required_points = 5 if _player_age(target) <= 31 else 4 if _player_age(target) <= 34 else 3
                if mega_premium_points < required_points:
                    continue
                if first_count < (2 if _player_age(target) <= 34 else 1) and premium_young_count <= 0:
                    continue

            from_items = [_player_item(target)]
            outgoing_salary = _package_salary(to_items, season_year)
            incoming_salary = _package_salary(from_items, season_year)
            if not _salary_matchish(incoming_salary, outgoing_salary):
                continue

            seller_projected_count = seller_roster_count - 1 + len(combo)
            buyer_projected_count = buyer_roster_count - len(combo) + 1
            if seller_projected_count > seller_allowed_max:
                continue
            if buyer_projected_count > buyer_allowed_max:
                continue

            total_value = _package_value(to_items, season_year)
            seller_total_value = _package_value(from_items, season_year)
            balance = total_value - seller_total_value

            # If the buyer is overpaying, let the seller include one simple pick
            # to convert a rejected overpay into a plausible directional trade.
            if balance > max_balance and seller_pick_bundles:
                sweetener_options = seller_pick_bundles[1:] or []
                rng.shuffle(sweetener_options)
                for seller_pick_bundle in sweetener_options[:3]:
                    trial_from_items = from_items + [_pick_item(p) for p in seller_pick_bundle]
                    if len(trial_from_items) > max_assets:
                        continue
                    trial_balance = total_value - _package_value(trial_from_items, season_year)
                    if min_balance <= trial_balance <= max_balance:
                        from_items = trial_from_items
                        balance = trial_balance
                        break

            if balance < min_balance or balance > max_balance:
                continue

            pick_count = len(pick_bundle)
            player_count = len(combo)
            quality_bonus = 0.0
            if target_ovr >= MAJOR_TRADE_TARGET_OVR:
                quality_bonus += 2.8
            if target_ovr >= STAR_TRADE_TARGET_OVR:
                quality_bonus += 4.2
            if seller_ctx.get("phase") in {"seller", "retool"} and target_ovr >= MAJOR_TRADE_TARGET_OVR:
                quality_bonus += 1.6
            if seller_ctx.get("phase") in {"seller", "retool"} and _player_age(target) >= 32 and target_ovr >= STAR_TRADE_TARGET_OVR:
                quality_bonus += 2.0
            if pick_count:
                quality_bonus += min(2.8, pick_count * 0.8 + (1.0 if _has_first(to_items) else 0.0))
            if _has_first(to_items) and target_ovr >= MAJOR_TRADE_TARGET_OVR:
                quality_bonus += 1.2
            if _has_premium_young_asset(to_items) and target_ovr >= MAJOR_TRADE_TARGET_OVR:
                quality_bonus += 1.0
            if player_count >= 2 and target_ovr >= 78:
                quality_bonus += 1.0

            # Penalize one-team spam without hard-locking activity below the cap.
            buyer_activity = _already_traded_count(league, _team_name(buyer))
            seller_activity = _already_traded_count(league, _team_name(seller))
            activity_penalty = max(0, buyer_activity - 1) * 0.85 + max(0, seller_activity - 1) * 0.75

            score = (
                10.0
                - abs(balance) * (0.70 if target_ovr >= MAJOR_TRADE_TARGET_OVR else 0.95)
                + buyer_ctx.get("buyerWeight", 0)
                + seller_ctx.get("sellerWeight", 0)
                + quality_bonus
                - activity_penalty
            )
            if mega_trade:
                score += 8.0 + min(3.0, _first_count(to_items) * 0.65 + _premium_young_asset_count(to_items) * 0.80)
            viable.append((score, combo, pick_bundle, from_items, to_items, balance))
            viable_cap = 96 if mega_trade else (72 if target_ovr >= MAJOR_TRADE_TARGET_OVR else 36)
            if len(viable) >= viable_cap:
                break
        viable_cap = 96 if mega_trade else (72 if target_ovr >= MAJOR_TRADE_TARGET_OVR else 36)
        if len(viable) >= viable_cap:
            break

    if not viable:
        return None

    viable.sort(key=lambda row: row[0], reverse=True)
    shortlist = viable[: min(10, len(viable))]
    choice_index = min(len(shortlist) - 1, int((rng.random() ** 2.05) * len(shortlist)))
    score, combo, pick_bundle, from_items, to_items, balance = shortlist[choice_index]
    from_team = _team_name(seller)
    to_team = _team_name(buyer)
    template = _candidate_template_label(target, to_items, from_items)

    side_limit = MEGA_MAX_ASSETS_PER_SIDE if mega_trade else MAX_ASSETS_PER_SIDE
    if len(from_items) > side_limit or len(to_items) > side_limit:
        return None

    target_tier = "rotation"
    if target_ovr >= 90:
        target_tier = "franchise"
    elif target_ovr >= STAR_TRADE_TARGET_OVR:
        target_tier = "star"
    elif target_ovr >= MAJOR_TRADE_TARGET_OVR:
        target_tier = "starter"

    motive_bits = []
    if buyer_ctx.get("slump"):
        motive_bits.append(f"{to_team} is underperforming and explores a {target_tier}-level upgrade")
    elif buyer_ctx.get("phase") == "contender":
        motive_bits.append(f"{to_team} shops like a contender looking for a higher-impact rotation piece")
    else:
        motive_bits.append(f"{to_team} looks like a buyer")
    if seller_ctx.get("phase") in {"seller", "retool"}:
        motive_bits.append(f"{from_team} is open to bigger market frameworks for future value")
    else:
        motive_bits.append(f"{from_team} listens because the package clears its asking-price board")

    return {
        "id": f"{'cpu_mega_trade' if mega_trade else 'cpu_trade'}_{_norm(from_team)}_{_norm(to_team)}_{_norm(_player_name(target))}_{_stable_seed(template, balance) % 100000}",
        "megaTrade": bool(mega_trade),
        "fromTeamName": from_team,
        "toTeamName": to_team,
        "fromItems": from_items,
        "toItems": to_items,
        "motive": "; ".join(motive_bits) + ".",
        "debug": {
            "sellerPhase": seller_ctx.get("phase"),
            "buyerPhase": buyer_ctx.get("phase"),
            "targetPlayer": _player_name(target),
            "targetOvr": target_ovr,
            "targetAge": _player_age(target),
            "targetTier": target_tier,
            "template": template,
            "balance": round(balance, 3),
            "candidateScore": round(score, 3),
            "targetSalary": target_salary,
            "outgoingSalary": _package_salary(to_items, season_year),
            "sellerRosterBefore": seller_roster_count,
            "buyerRosterBefore": buyer_roster_count,
            "sellerRosterAfter": seller_roster_count - 1 + sum(1 for item in to_items if item.get("type") == "player"),
            "buyerRosterAfter": buyer_roster_count - sum(1 for item in to_items if item.get("type") == "player") + 1,
            "buyerPickCount": sum(1 for item in to_items if item.get("type") == "pick"),
            "sellerPickCount": sum(1 for item in from_items if item.get("type") == "pick"),
            "protectedFirstCount": sum(1 for item in to_items + from_items if item.get("type") == "pick" and int(_num((item.get("pick") or {}).get("round"), 1)) == 1 and "protected" in _str(item.get("protection") or (item.get("pick") or {}).get("displayProtection") or "").lower()),
            "megaTrade": bool(mega_trade),
            "megaFirstCount": _first_count(to_items) if mega_trade else 0,
            "megaPremiumYoungAssetCount": _premium_young_asset_count(to_items) if mega_trade else 0,
        },
    }


def _build_mega_trade_candidates(
    league: Dict[str, Any],
    context: Dict[str, Any],
    teams: List[Dict[str, Any]],
    contexts: Dict[str, Dict[str, Any]],
    season_year: int,
    current_date: str,
    rng: random.Random,
    max_candidates: int,
) -> Tuple[List[Dict[str, Any]], str, Dict[str, Any]]:
    target_rows: List[Tuple[float, Dict[str, Any], Dict[str, Any]]] = []

    for seller in teams:
        seller_name = _team_name(seller)
        seller_ctx = contexts.get(seller_name, {})
        seller_phase = seller_ctx.get("phase")
        seller_win_pct = _num(seller_ctx.get("winPct"), 0.0)
        seller_top_avg = _num(seller_ctx.get("topAvg"), 70.0)
        hard_sweep = bool(context.get("megaTradeHardSweep"))
        seller_disappointing = bool(seller_win_pct > 0 and seller_win_pct <= 0.500 and seller_top_avg >= 81.0)
        seller_mid_star_market = bool(seller_win_pct > 0 and seller_win_pct <= (0.555 if hard_sweep else 0.535) and seller_top_avg >= 80.0)
        if seller_phase not in {"seller", "retool"} and not seller_disappointing and not seller_mid_star_market:
            continue
        if _already_traded_count(league, seller_name) >= MAX_CPU_TRADES_PER_TEAM_SEASON:
            continue
        recent_names = _recent_cpu_acquired_player_names(league, seller_name, current_date)
        for player in _players(seller):
            if not isinstance(player, dict) or not _is_standard_player(player):
                continue
            if _player_ovr(player) < MEGA_TRADE_TARGET_OVR:
                continue
            if _norm(_player_name(player)) in recent_names:
                continue
            if _is_young_franchise_cornerstone(player):
                continue
            age = _player_age(player)
            rebuilding_seller = seller_phase == "seller" or (seller_win_pct > 0 and seller_win_pct <= 0.380)
            if not rebuilding_seller and _player_ovr(player) >= 94 and age <= 30:
                continue
            if age < 28 and _is_shared_untouchable_core(seller, player, seller_ctx):
                continue
            salary_m = _salary_for_year(player, season_year) / 1_000_000
            # Prime/older 90+ players on mid/bad teams are the exact market
            # this lane is supposed to force. Younger franchise cornerstones were
            # already filtered above.
            timeline_score = 4.4 if 28 <= age <= 32 else 3.0 if 33 <= age <= 35 else 1.5 if age > 35 else -2.5
            direction_bonus = 0.0
            if seller_phase in {"seller", "retool"}:
                direction_bonus += 4.5
            if seller_disappointing:
                direction_bonus += 3.0
            if seller_mid_star_market and age >= 30:
                direction_bonus += 2.0
            if hard_sweep:
                direction_bonus += 2.5
            score = (
                (_player_ovr(player) - 89.0) * 2.7
                + timeline_score
                + direction_bonus
                + _num(seller_ctx.get("sellerWeight"), 0.0) * 1.4
                + max(0.0, salary_m - 28.0) * 0.04
                + rng.uniform(0.0, 5.0)
            )
            target_rows.append((score, seller, player))

    if not target_rows:
        return [], "no_eligible_mega_star", {"eligibleMegaTargets": 0, "megaTradeMode": True}

    target_rows.sort(key=lambda row: row[0], reverse=True)
    target_rows = target_rows[:MEGA_TARGET_SCAN_LIMIT]
    candidates: List[Dict[str, Any]] = []
    buyer_attempts = 0

    for _, seller, target in target_rows:
        seller_name = _team_name(seller)
        seller_ctx = contexts.get(seller_name, {})
        seller_picks = _simple_pick_assets(league, seller_name, season_year)
        buyer_rows: List[Tuple[float, Dict[str, Any]]] = []
        for buyer in teams:
            buyer_name = _team_name(buyer)
            if _norm(buyer_name) == _norm(seller_name):
                continue
            buyer_ctx = contexts.get(buyer_name, {})
            if buyer_ctx.get("phase") not in {"contender", "buyer"}:
                continue
            if _already_traded_count(league, buyer_name) >= MAX_CPU_TRADES_PER_TEAM_SEASON:
                continue
            if _already_traded_pair(league, seller_name, buyer_name):
                continue
            score = _buyer_mega_fit_score(buyer, target, buyer_ctx) + rng.uniform(0.0, 3.5)
            buyer_rows.append((score, buyer))

        buyer_rows.sort(key=lambda row: row[0], reverse=True)
        for _, buyer in buyer_rows[:MEGA_BUYER_SCAN_LIMIT]:
            buyer_attempts += 1
            buyer_name = _team_name(buyer)
            buyer_ctx = contexts.get(buyer_name, {})
            buyer_recent = _recent_cpu_acquired_player_names(league, buyer_name, current_date)
            if hard_sweep:
                # Deadline mega solver: use a wider salary/asset pool than the
                # normal market board so $45M-$60M stars can be matched without
                # forcing a buyer to send its League Intel untouchable. Still
                # excludes true young-core protected pieces and recent arrivals.
                raw_pool = [
                    player for player in _players(buyer)
                    if isinstance(player, dict)
                    and _is_standard_player(player)
                    and _player_ovr(player) >= MIN_MARKET_PLAYER_OVR
                    and _norm(_player_name(player)) not in buyer_recent
                    and not _is_shared_untouchable_core(buyer, player, buyer_ctx)
                ]
                buyer_pool = sorted(
                    raw_pool,
                    key=lambda p: (
                        _salary_for_year(p, season_year) / 1_000_000,
                        _rough_value_player(p, season_year),
                        max(0.0, _player_pot(p) - _player_ovr(p)),
                    ),
                    reverse=True,
                )[:28]
            else:
                buyer_pool = [
                    player
                    for player in _buyer_outgoing_players(buyer, season_year, buyer_ctx)
                    if _norm(_player_name(player)) not in buyer_recent
                ]
            buyer_picks = _simple_pick_assets(league, buyer_name, season_year)
            if not buyer_pool:
                continue
            candidate = _build_candidate(
                league,
                seller,
                buyer,
                target,
                buyer_pool,
                buyer_picks,
                seller_picks,
                seller_ctx,
                buyer_ctx,
                season_year,
                rng,
                mega_trade = True,
            )
            if not candidate:
                continue
            candidate["motive"] = (
                f"Mega trade market: {seller_name} cashes out on {_player_name(target)} "
                f"because its timeline leans {seller_ctx.get('phase')}, while {buyer_name} makes a title-window swing."
            )
            candidate.setdefault("debug", {})["megaTrade"] = True
            candidate["debug"]["megaBuyerFitScore"] = round(_buyer_mega_fit_score(buyer, target, buyer_ctx), 3)
            candidates.append(candidate)
            if len(candidates) >= max_candidates:
                return candidates, "", {
                    "eligibleMegaTargets": len(target_rows),
                    "buyerAttempts": buyer_attempts,
                    "megaTradeMode": True,
                }

    return candidates, ("" if candidates else "no_valid_mega_trade_package"), {
        "eligibleMegaTargets": len(target_rows),
        "buyerAttempts": buyer_attempts,
        "megaTradeMode": True,
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
        targets = _seller_trade_targets(seller, season_year, ctx)
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
    _reset_generation_cache(league, current_date)
    deadline_date = _str(context.get("tradeDeadlineDate"), "")
    user_team = _str(context.get("userTeamName"), "")
    max_candidates = int(_num(context.get("maxCandidates"), MAX_CANDIDATES_PER_DAY))
    max_candidates = max(1, min(MAX_CANDIDATES_PER_DAY, max_candidates))
    inventory_pressure = max(0.0, min(3.0, _num(context.get("inventoryPressure"), 0.0)))
    reliability_mode = bool(context.get("foregroundRecommended")) or inventory_pressure >= 0.75
    season_year = _season_year(league)

    if deadline_date and current_date and current_date >= deadline_date:
        return {"ok": True, "candidates": [], "skippedReason": "trade_deadline_locked"}

    bank_seed = _str(context.get("bankSeed"), "")
    generation_nonce = int(_num(context.get("generationNonce"), 0))
    rng = _rng_for(
        "cpu_cpu_trade",
        season_year,
        current_date,
        context.get("dayIndex"),
        bank_seed,
        generation_nonce,
    )
    teams = [t for t in _all_teams(league) if _team_name(t) and _norm(_team_name(t)) != _norm(user_team)]
    contexts = {_team_name(t): _phase_for(t, context) for t in teams}
    base_trade_desk_items = _build_trade_desk_signals(league, context, teams, contexts, season_year, current_date, rng)

    if bool(context.get("megaTradeMode")):
        mega_candidates, mega_skipped, mega_debug = _build_mega_trade_candidates(
            league = league,
            context = context,
            teams = teams,
            contexts = contexts,
            season_year = season_year,
            current_date = current_date,
            rng = rng,
            max_candidates = max_candidates,
        )
        candidate_trade_desk_items = []
        for candidate in mega_candidates[:max_candidates]:
            entry = _candidate_trade_desk_entry(candidate, current_date)
            if entry:
                entry["label"] = "Mega Framework"
                entry["tag"] = "Blockbuster"
                entry["priority"] = 96
                candidate_trade_desk_items.append(entry)
        return {
            "ok": True,
            "candidates": mega_candidates[:max_candidates],
            "activityChance": 1.0,
            "skippedReason": None if mega_candidates else mega_skipped,
            "debug": {
                **mega_debug,
                "sellerCount": sum(1 for t in teams if contexts.get(_team_name(t), {}).get("phase") in {"seller", "retool"}),
                "buyerCount": sum(1 for t in teams if contexts.get(_team_name(t), {}).get("phase") in {"contender", "buyer"}),
                "maxCandidates": max_candidates,
                "bankSeedPresent": bool(bank_seed),
                "generationNonce": generation_nonce,
            },
            "tradeDeskItems": (candidate_trade_desk_items + base_trade_desk_items)[:8],
        }

    bank_generation_mode = bool(context.get("bankGenerationMode"))
    chance = 1.0 if bank_generation_mode else _activity_chance(context)
    if not bank_generation_mode and rng.random() > chance:
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
        if ctx.get("sellerWeight", 0) >= 0.20:
            sellers.append(t)
        if ctx.get("buyerWeight", 0) >= 0.20:
            buyers.append(t)

    # Build a randomized, weighted team-pair work queue. The previous nested-loop
    # shape could fill an entire pass with one seller before another franchise was
    # considered. This queue keeps strong buyer/seller direction relevant while
    # ensuring each background pass explores several different matchups.
    pair_queue = []
    for seller in sellers:
        seller_name = _team_name(seller)
        seller_weight = _num(contexts[seller_name].get("sellerWeight"), 0)
        for buyer in buyers:
            buyer_name = _team_name(buyer)
            if _norm(buyer_name) == _norm(seller_name):
                continue
            if _already_traded_pair(league, seller_name, buyer_name):
                continue
            buyer_weight = _num(contexts[buyer_name].get("buyerWeight"), 0)
            activity_penalty = max(0, _already_traded_count(league, seller_name) - 1) * 0.65 + max(0, _already_traded_count(league, buyer_name) - 1) * 0.75
            randomized_priority = seller_weight + buyer_weight + rng.uniform(0.0, 1.25) - activity_penalty
            pair_queue.append((randomized_priority, seller, buyer))

    rng.shuffle(pair_queue)
    pair_queue.sort(key=lambda row: row[0], reverse=True)

    candidates: List[Dict[str, Any]] = []
    seller_candidate_counts: Dict[str, int] = {}
    buyer_candidate_counts: Dict[str, int] = {}
    pair_attempt_limit = min(len(pair_queue), max(120 if reliability_mode else 80, max_candidates * (26 if reliability_mode else 18)))

    for _, seller, buyer in pair_queue[:pair_attempt_limit]:
        seller_name = _team_name(seller)
        buyer_name = _team_name(buyer)
        seller_key = _norm(seller_name)
        buyer_key = _norm(buyer_name)

        # Spread each pass across the league. Repeated passes can revisit a team,
        # but no single pass should look like one franchise generated every deal.
        seller_pass_limit = 8 if reliability_mode else 5
        buyer_pass_limit = 9 if reliability_mode else 6
        if seller_candidate_counts.get(seller_key, 0) >= seller_pass_limit:
            continue
        if buyer_candidate_counts.get(buyer_key, 0) >= buyer_pass_limit:
            continue

        seller_recent_acquisitions = _recent_cpu_acquired_player_names(league, seller_name, current_date)
        buyer_recent_acquisitions = _recent_cpu_acquired_player_names(league, buyer_name, current_date)
        targets = [
            player
            for player in _seller_trade_targets(seller, season_year, contexts[seller_name])
            if _norm(_player_name(player)) not in seller_recent_acquisitions
        ]
        buyer_pool = [
            player
            for player in _buyer_outgoing_players(buyer, season_year, contexts[buyer_name])
            if _norm(_player_name(player)) not in buyer_recent_acquisitions
        ]
        if not targets or not buyer_pool:
            continue

        buyer_picks = _simple_pick_assets(league, buyer_name, season_year)
        seller_picks = _simple_pick_assets(league, seller_name, season_year)
        randomized_targets = targets[:]
        rng.shuffle(randomized_targets)
        if contexts[seller_name].get("phase") in {"seller", "retool"}:
            # In seller/retool seasons, intentionally surface the real names a
            # franchise would shop: productive 80+ players, and especially aging
            # high-end players. Jitter keeps this from becoming deterministic.
            randomized_targets.sort(
                key=lambda p: (
                    (_player_ovr(p) >= MAJOR_TRADE_TARGET_OVR) * 7.0 +
                    (_player_ovr(p) >= STAR_TRADE_TARGET_OVR) * 5.0 +
                    (_player_age(p) >= 32 and _player_ovr(p) >= MAJOR_TRADE_TARGET_OVR) * 4.0 -
                    (_player_age(p) <= 21 and _player_pot(p) >= 88) * 2.0 +
                    rng.uniform(0.0, 6.0)
                ),
                reverse=True,
            )

        pair_added = 0
        pair_candidate_limit = 2 if reliability_mode else 1
        target_scan_limit = 26 if reliability_mode else 16
        seen_pair_signatures: Set[str] = set()
        for target in randomized_targets[:target_scan_limit]:
            candidate = _build_candidate(
                league,
                seller,
                buyer,
                target,
                buyer_pool,
                buyer_picks,
                seller_picks,
                contexts[seller_name],
                contexts[buyer_name],
                season_year,
                rng,
            )
            if not candidate:
                continue
            sig = json.dumps({
                "from": candidate.get("fromTeamName"),
                "to": candidate.get("toTeamName"),
                "fromItems": [item.get("type") + ":" + _norm((item.get("player") or item.get("pick") or {}).get("name") or (item.get("pick") or {}).get("id") or item.get("protection") or "") for item in candidate.get("fromItems") or []],
                "toItems": [item.get("type") + ":" + _norm((item.get("player") or item.get("pick") or {}).get("name") or (item.get("pick") or {}).get("id") or item.get("protection") or "") for item in candidate.get("toItems") or []],
            }, sort_keys=True)
            if sig in seen_pair_signatures:
                continue
            seen_pair_signatures.add(sig)
            candidates.append(candidate)
            pair_added += 1
            seller_candidate_counts[seller_key] = seller_candidate_counts.get(seller_key, 0) + 1
            buyer_candidate_counts[buyer_key] = buyer_candidate_counts.get(buyer_key, 0) + 1
            if len(candidates) >= max_candidates or pair_added >= pair_candidate_limit:
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
            "reliabilityMode": reliability_mode,
            "inventoryPressure": round(inventory_pressure, 3),
            "bankGenerationMode": bank_generation_mode,
            "generationNonce": generation_nonce,
            "bankSeedPresent": bool(bank_seed),
            "recentAcquisitionCooldownDays": RECENT_CPU_ACQUISITION_COOLDOWN_DAYS,
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
