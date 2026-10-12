"""Read-only adapter over Basketball Manager's EXISTING Python CPU trade models.

This file introduces NO new acceptance scores, market-ranking formulas or trade
rules. It merely exposes existing candidate boards and value estimates for
League Intel's UI. These are NOT offers, trade-bank entries or CPU decisions.
"""

import json
import cpu_cpu_trade_logic as cpu
import trade_team_ai as team_ai
import trade_value_model as values


def _name(item):
    return str(item.get("name") or item.get("teamName") or "") if isinstance(item, dict) else ""


def _player_ref(p, source):
    return {"id": p.get("id") or p.get("playerId"),
            "name": p.get("name") or p.get("player") or "",
            "sourceTeam": source}


def _owned_picks(league, owner):
    for pick in league.get("draftPicks") or []:
        if not isinstance(pick, dict):
            continue
        if cpu._norm(pick.get("ownerTeam") or pick.get("currentOwnerTeamName") or pick.get("owner")) != cpu._norm(owner):
            continue
        if str(pick.get("status") or "active").lower() != "active":
            continue
        if "swap" in str(pick.get("assetType") or pick.get("type") or "").lower():
            continue
        yield pick


def get_intel_cpu_profile_json(payload_json):
    payload = json.loads(payload_json)
    league = payload.get("leagueData") or {}
    user_team_name = str(payload.get("userTeamName") or "")
    records = payload.get("recordsByTeam") or {}
    teams = cpu._all_teams(league)
    season = cpu._season_year(league)
    context = {"recordsByTeam": records, "seasonYear": season}

    # Generator cache is scoped to this request only; not stored in a saved league.
    current_date = str(league.get("currentDate") or "")
    cpu._reset_generation_cache(league, current_date)
    boards = {}
    originals = {}
    for team in teams:
        name = cpu._team_name(team)
        if not name:
            continue
        phase = cpu._phase_for(team, context)
        role = "seller" if phase.get("phase") in {"seller", "retool"} else "buyer"
        outgoing = (cpu._seller_trade_targets(team, season, phase) if role == "seller"
                    else cpu._buyer_outgoing_players(team, season, phase))
        recently_acquired = cpu._recent_cpu_acquired_player_names(league, name, current_date)
        if recently_acquired:
            outgoing = [p for p in outgoing if cpu._norm(cpu._player_name(p)) not in recently_acquired]
        core = [p for p in cpu._players(team)
                if isinstance(p, dict) and cpu._is_standard_player(p)
                and cpu._is_shared_untouchable_core(team, p, phase)]
        originals[name] = {"team": team, "phase": phase, "role": role, "outgoing": outgoing, "core": core}
        boards[name] = {
            "teamName": name,
            "cpuCpuPhase": phase.get("phase") or "middle",
            "cpuCpuRole": role,
            "outgoing": [_player_ref(p, name) for p in outgoing[:10]],
            "hardProtected": [_player_ref(p, name) for p in core],
            "source": "cpu_cpu_trade_logic.py:_phase_for + _seller_trade_targets/_buyer_outgoing_players + _is_shared_untouchable_core",
        }

    user_team = next((t for t in teams if cpu._norm(cpu._team_name(t)) == cpu._norm(user_team_name)), None)
    user_players = [p for p in cpu._players(user_team or {}) if isinstance(p, dict) and cpu._is_standard_player(p)]
    user_picks = list(_owned_picks(league, user_team_name))
    for name, entry in originals.items():
        if cpu._norm(name) == cpu._norm(user_team_name):
            continue
        team = entry["team"]
        # This is the game's real SIX-phase user-facing valuation model, NOT an
        # alternative CPU personality. Records are supplied by saved results.
        row = records.get(name) or {}
        preferences = team_ai.get_team_preferences(team, {name: row})
        phase_label = preferences.get("phase") or "middle"
        user_player_values = sorted((
            {**_player_ref(p, user_team_name), "kind": "player",
             "value": values.player_trade_value(p, preferences)}
            for p in user_players), key=lambda p: p["value"], reverse=True)
        user_pick_values = sorted((
            {"kind": "pick", "id": p.get("id") or p.get("pickId"),
             "year": p.get("year") or p.get("seasonYear"), "round": p.get("round"),
             "originalTeam": p.get("originalTeam") or p.get("originalTeamName"),
             "protection": p.get("protection") or p.get("displayProtection") or "Unprotected",
             "sourceTeam": user_team_name, "value": values.pick_trade_value(p, preferences)}
            for p in user_picks), key=lambda p: p["value"], reverse=True)
        boards[name]["negotiationPhase"] = phase_label
        # Display order follows the original team direction. Existing Python
        # valuation itself already includes that direction's multipliers.
        # Intel now displays TWO independently ranked player and pick needs.
        # Keep extra read-only candidates because the JS layer must filter
        # picks through the game's real trade-eligibility rules. These are
        # existing CPU valuations, NOT confirmed preferences or offers.
        boards[name]["valuedUserAssets"] = user_player_values[:12] + user_pick_values[:12]
        # This is NOT a CPU wishlist. It is a watchlist of players already in
        # the existing CPU outgoing boards, sorted only by the RECEIVING team's
        # existing valuation function; package acceptance is still unverified.
        watched = []
        # CPU's ORIGINAL buyer mega-trade fit function captures team positional
        # compatibility, roster strength, and buyer direction. It is a ranking
        # signal only and never turns this watchlist into a CPU offer.
        need_label = cpu._pos_label_for_buyer(team)
        boards[name]["buyerNeed"] = need_label
        for other_name, other in originals.items():
            if cpu._norm(other_name) in {cpu._norm(name), cpu._norm(user_team_name)}:
                continue
            # Actual seller/retool board = strongest evidence of market availability.
            if other["role"] != "seller":
                continue
            for p in other["outgoing"][:5]:
                watched.append({**_player_ref(p, other_name),
                                "value": values.player_trade_value(p, preferences),
                                "existingCpuFit": cpu._buyer_mega_fit_score(team, p, entry["phase"]),
                                "buyerNeed": need_label})
        # Sort using existing CPU team-fit first and original receiving-team
        # valuation second. No new weights, thresholds, or acceptance logic.
        watched.sort(key=lambda p: (p["existingCpuFit"], p["value"]), reverse=True)
        seen = set()
        unique = []
        for p in watched:
            key = (p["sourceTeam"], str(p["id"] or p["name"]))
            if key in seen:
                continue
            seen.add(key)
            unique.append(p)
            if len(unique) == 12:
                break
        boards[name]["watchlist"] = unique
    return json.dumps({"seasonYear": season, "userTeamName": user_team_name, "teams": boards})
