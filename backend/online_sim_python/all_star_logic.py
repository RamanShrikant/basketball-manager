from typing import Any, Dict, List


def _to_int(value: Any, default: int = 0) -> int:
    try:
        if value is None:
            return default
        return int(float(value))
    except Exception:
        return default


def _to_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except Exception:
        return default


def _round1(value: float) -> float:
    return round(float(value), 1)


def _safe_get(raw: Dict[str, Any], *keys: str, default = None):
    for key in keys:
        if key in raw and raw[key] is not None:
            return raw[key]
    return default


def _norm(v, vmax):
    return 0.0 if vmax <= 0 else max(0.0, min(1.0, v / vmax))


def _norm_range_hi(v, lo, hi):
    return 0.0 if hi <= lo else max(0.0, min(1.0, (v - lo) / (hi - lo)))


def _norm_wins(wins: float, cap: float, gamma: float = 2.0) -> float:
    base = _norm(wins, cap)
    floor = 0.30
    return floor + (1.0 - floor) * base


ALL_STAR_LOGIC_VERSION = "all_star_gp_thresholds_v4_hotfix_20260810"

def _normalize_player_stats(player_stats: Any) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []

    if isinstance(player_stats, dict):
        iterable = player_stats.items()
    elif isinstance(player_stats, list):
        iterable = enumerate(player_stats)
    else:
        return rows

    for key, raw in iterable:
        if not isinstance(raw, dict):
            continue

        player_name = _safe_get(raw, "player", "name", "playerName")
        team_name = _safe_get(raw, "team", "teamName")

        if (not player_name or not team_name) and isinstance(key, str) and "__" in key:
            left, right = key.split("__", 1)
            if not player_name:
                player_name = left.strip()
            if not team_name:
                team_name = right.strip()

        if not player_name or not team_name:
            continue

        gp = _to_int(_safe_get(raw, "gp", "gamesPlayed"), 0)
        pts_total = _to_float(_safe_get(raw, "pts", "points"), 0.0)
        reb_total = _to_float(_safe_get(raw, "reb", "rebounds"), 0.0)
        ast_total = _to_float(_safe_get(raw, "ast", "assists"), 0.0)
        stl_total = _to_float(_safe_get(raw, "stl", "steals"), 0.0)
        blk_total = _to_float(_safe_get(raw, "blk", "blocks"), 0.0)

        started = _to_int(_safe_get(raw, "started"), 0)
        sixth = _to_int(_safe_get(raw, "sixth"), 0)

        fgm = _to_float(_safe_get(raw, "fgm"), 0.0)
        fga = _to_float(_safe_get(raw, "fga"), 0.0)
        tpm = _to_float(_safe_get(raw, "tpm", "threesMade"), 0.0)
        tpa = _to_float(_safe_get(raw, "tpa", "threesAttempted"), 0.0)
        ftm = _to_float(_safe_get(raw, "ftm"), 0.0)
        fta = _to_float(_safe_get(raw, "fta"), 0.0)

        def_rating = _to_float(_safe_get(raw, "def_rating", "defRating", "defense", "def"), 0.0)

        rows.append({
            "player": str(player_name),
            "team": str(team_name),
            "gp": gp,
            "pts_total": pts_total,
            "reb_total": reb_total,
            "ast_total": ast_total,
            "stl_total": stl_total,
            "blk_total": blk_total,
            "started": started,
            "sixth": sixth,
            "fgm": fgm,
            "fga": fga,
            "tpm": tpm,
            "tpa": tpa,
            "ftm": ftm,
            "fta": fta,
            "def_rating": def_rating,
        })

    return rows


def _norm_team_name(value: Any) -> str:
    text = str(value or "").strip().lower()
    text = text.replace("&", "and")
    text = " ".join(text.split())
    return text


def _build_team_conference_map(league_data: Dict[str, Any]) -> Dict[str, str]:
    conferences = (league_data or {}).get("conferences") or {}
    out: Dict[str, str] = {}

    east = conferences.get("East") or conferences.get("east") or []
    west = conferences.get("West") or conferences.get("west") or []

    for team in east:
        if isinstance(team, dict):
            name = team.get("name") or team.get("team")
        else:
            name = team

        if name:
            out[str(name)] = "East"
            out[_norm_team_name(name)] = "East"

    for team in west:
        if isinstance(team, dict):
            name = team.get("name") or team.get("team")
        else:
            name = team

        if name:
            out[str(name)] = "West"
            out[_norm_team_name(name)] = "West"

    return out


def _build_current_roster_team_map(league_data: Dict[str, Any]) -> Dict[str, str]:
    out: Dict[str, str] = {}
    conferences = (league_data or {}).get("conferences") or {}
    teams = []
    if isinstance((league_data or {}).get("teams"), list):
        teams.extend((league_data or {}).get("teams") or [])
    for rows in conferences.values():
        if isinstance(rows, list):
            teams.extend(rows)

    for team in teams:
        if not isinstance(team, dict):
            continue
        team_name = team.get("name") or team.get("team")
        if not team_name:
            continue
        for bucket in ["players", "twoWayPlayers", "stashPlayers"]:
            for player in team.get(bucket) or []:
                if not isinstance(player, dict):
                    continue
                name = player.get("name") or player.get("player")
                if name:
                    out[str(name)] = str(team_name)
    return out

def _combine_rows_by_player_current_team(rows: List[Dict[str, Any]], current_team_by_player: Dict[str, str]) -> List[Dict[str, Any]]:
    grouped: Dict[str, Dict[str, Any]] = {}

    for row in rows:
        name = row.get("player")
        if not name:
            continue
        if name not in grouped:
            grouped[name] = {
                "player": name,
                "team": current_team_by_player.get(name) or row.get("team") or "",
                "gp": 0,
                "pts_total": 0.0,
                "reb_total": 0.0,
                "ast_total": 0.0,
                "stl_total": 0.0,
                "blk_total": 0.0,
                "started": 0,
                "sixth": 0,
                "fgm": 0.0,
                "fga": 0.0,
                "tpm": 0.0,
                "tpa": 0.0,
                "ftm": 0.0,
                "fta": 0.0,
                "def_rating": row.get("def_rating", 0.0),
                "team_names": [],
            }
        total = grouped[name]
        if current_team_by_player.get(name):
            total["team"] = current_team_by_player[name]
        elif row.get("team"):
            total["team"] = row.get("team")
        if row.get("team") and row.get("team") not in total["team_names"]:
            total["team_names"].append(row.get("team"))
        for key in ["gp", "started", "sixth"]:
            total[key] += _to_int(row.get(key), 0)
        for key in ["pts_total", "reb_total", "ast_total", "stl_total", "blk_total", "fgm", "fga", "tpm", "tpa", "ftm", "fta"]:
            total[key] += _to_float(row.get(key), 0.0)
        if _to_float(row.get("def_rating"), 0.0) > _to_float(total.get("def_rating"), 0.0):
            total["def_rating"] = row.get("def_rating", total.get("def_rating", 0.0))

    return list(grouped.values())

def _read_game_result(game: Dict[str, Any], results_by_id: Dict[str, Any]) -> Dict[str, Any]:
    game_id = game.get("id")
    result = (results_by_id or {}).get(game_id) or (results_by_id or {}).get(str(game_id)) or {}
    if not result and isinstance(game.get("result"), dict):
        result = game.get("result") or {}
    return result if isinstance(result, dict) else {}


def _build_team_records(schedule_by_date: Dict[str, Any], results_by_id: Dict[str, Any]) -> Dict[str, Dict[str, int]]:
    records: Dict[str, Dict[str, int]] = {}

    def ensure(team: Any) -> Dict[str, int]:
        name = str(team or "")
        if name not in records:
            records[name] = {"wins": 0, "losses": 0, "gp": 0}
        return records[name]

    for _, games in (schedule_by_date or {}).items():
        if not isinstance(games, list):
            continue

        for game in games:
            if not isinstance(game, dict):
                continue
            result = _read_game_result(game, results_by_id)
            if not game.get("played") and not result:
                continue

            totals = result.get("totals") or result.get("score") or result.get("winner") or {}
            home_pts = _to_int(totals.get("home"), 0)
            away_pts = _to_int(totals.get("away"), 0)
            home_name = game.get("home")
            away_name = game.get("away")
            if not home_name or not away_name or home_pts == away_pts:
                continue

            home = ensure(home_name)
            away = ensure(away_name)
            home["gp"] += 1
            away["gp"] += 1
            if home_pts > away_pts:
                home["wins"] += 1
                away["losses"] += 1
            else:
                away["wins"] += 1
                home["losses"] += 1

    return records


def _build_team_wins(schedule_by_date: Dict[str, Any], results_by_id: Dict[str, Any]) -> Dict[str, int]:
    return {team: row.get("wins", 0) for team, row in _build_team_records(schedule_by_date, results_by_id).items()}


def _decorate_players(
    normalized_rows: List[Dict[str, Any]],
    team_conf_map: Dict[str, str],
    team_wins: Dict[str, int],
    min_games: int,
    team_games: Dict[str, int],
) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []

    for row in normalized_rows:
        gp = max(0, row["gp"])
        if gp < min_games:
            continue

        conference = (
            team_conf_map.get(row["team"])
            or team_conf_map.get(_norm_team_name(row["team"]))
        )

        if conference not in ("East", "West"):
            continue

        resolved_team_games = max(
            _to_int(team_games.get(row["team"]), 0),
            _to_int(team_games.get(_norm_team_name(row["team"])), 0),
            gp,
            min_games,
        )
        starter_min_games = max(min_games, int((resolved_team_games * 0.75) + 0.9999))
        reserve_min_games = max(min_games, int((resolved_team_games * 0.60) + 0.9999))
        if gp < reserve_min_games:
            continue

        ppg = row["pts_total"] / gp if gp else 0.0
        rpg = row["reb_total"] / gp if gp else 0.0
        apg = row["ast_total"] / gp if gp else 0.0
        spg = row["stl_total"] / gp if gp else 0.0
        bpg = row["blk_total"] / gp if gp else 0.0

        fg_pct = (row["fgm"] / row["fga"] * 100.0) if row["fga"] > 0 else 0.0
        tp_pct = (row["tpm"] / row["tpa"] * 100.0) if row["tpa"] > 0 else 0.0
        ft_pct = (row["ftm"] / row["fta"] * 100.0) if row["fta"] > 0 else 0.0

        team_wins_value = team_wins.get(row["team"], 0)

        out.append({
            "player": row["player"],
            "team": row["team"],
            "conference": conference,
            "gp": gp,
            "ppg": _round1(ppg),
            "rpg": _round1(rpg),
            "apg": _round1(apg),
            "spg": _round1(spg),
            "bpg": _round1(bpg),
            "fg_pct": _round1(fg_pct),
            "tp_pct": _round1(tp_pct),
            "ft_pct": _round1(ft_pct),
            "started": row["started"],
            "sixth": row["sixth"],
            "team_wins": team_wins_value,
            "team_games": resolved_team_games,
            "starter_min_games": starter_min_games,
            "reserve_min_games": reserve_min_games,
            "starter_eligible": gp >= starter_min_games,
            "reserve_eligible": gp >= reserve_min_games,
            "def_rating": row["def_rating"],
            "all_star_score": 0.0,
        })

    return out


def _build_all_star_context(players: List[Dict[str, Any]]) -> Dict[str, float]:
    if not players:
        return {
            "ppg": 0.0,
            "apg": 0.0,
            "rpg": 0.0,
            "spg": 0.0,
            "bpg": 0.0,
            "wins": 82.0,
            "def_lo": 0.0,
            "def_hi": 0.0,
        }

    return {
        "ppg": max(p["ppg"] for p in players),
        "apg": max(p["apg"] for p in players),
        "rpg": max(p["rpg"] for p in players),
        "spg": max(p["spg"] for p in players),
        "bpg": max(p["bpg"] for p in players),
        "wins": 82.0,
        "def_lo": min(p["def_rating"] for p in players),
        "def_hi": max(p["def_rating"] for p in players),
    }


def _impact_all_nba_style(p: Dict[str, Any], c: Dict[str, float]) -> float:
    return (
        0.15 * _norm_wins(p["team_wins"], c["wins"], gamma = 2.0) +
        0.30 * _norm(p["ppg"], c["ppg"]) +
        0.15 * _norm(p["apg"], c["apg"]) +
        0.15 * _norm(p["rpg"], c["rpg"]) +
        0.10 * _norm(p["spg"], c["spg"]) +
        0.10 * _norm(p["bpg"], c["bpg"]) +
        0.05 * _norm_range_hi(p["def_rating"], c["def_lo"], c["def_hi"])
    )


def _apply_all_star_scores(players: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    ctx = _build_all_star_context(players)

    for p in players:
        p["all_star_score"] = round(float(_impact_all_nba_style(p, ctx)), 3)

    return players


def _sort_players(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return sorted(
        rows,
        key = lambda p: (
            p["all_star_score"],
            p["ppg"],
            p["apg"],
            p["rpg"],
            p["team_wins"],
        ),
        reverse = True,
    )


def _build_conference_team(players: List[Dict[str, Any]], conference: str) -> Dict[str, Any]:
    conf_players = _sort_players([p for p in players if p["conference"] == conference])

    starters = _sort_players([p for p in conf_players if p.get("starter_eligible")])[:5]
    selected_names = {p.get("player") for p in starters}

    reserve_pool = [p for p in conf_players if p.get("reserve_eligible") and p.get("player") not in selected_names]
    reserves = _sort_players(reserve_pool)[:7]
    selected_names.update(p.get("player") for p in reserves)

    # Emergency fallback only prevents empty teams in very short/debug seasons; normal All-Star
    # selections still obey starter 75% GP and reserve 60% GP thresholds.
    if len(starters) < 5:
        for p in conf_players:
            if p.get("player") in selected_names:
                continue
            starters.append(p)
            selected_names.add(p.get("player"))
            if len(starters) >= 5:
                break
    if len(reserves) < 7:
        for p in conf_players:
            if p.get("player") in selected_names:
                continue
            reserves.append(p)
            selected_names.add(p.get("player"))
            if len(reserves) >= 7:
                break

    snubs = [p for p in conf_players if p.get("player") not in selected_names][:8]

    return {
        "starters": starters,
        "reserves": reserves,
        "snubs": snubs,
        "full_roster": starters + reserves,
    }


def compute_all_stars(payload: Dict[str, Any]) -> Dict[str, Any]:
    payload = payload or {}

    season = payload.get("season") or "Unknown Season"
    cutoff_date = payload.get("cutoff_date") or payload.get("cutoffDate") or ""
    min_games = _to_int(payload.get("min_games") or payload.get("minGames"), 12)

    player_stats = payload.get("playerStats") or payload.get("player_stats") or {}
    league_data = payload.get("leagueData") or payload.get("league_data") or {}
    schedule_by_date = payload.get("scheduleByDate") or payload.get("schedule_by_date") or {}
    results_by_id = payload.get("resultsById") or payload.get("results_by_id") or {}

    normalized_rows = _normalize_player_stats(player_stats)
    current_team_by_player = _build_current_roster_team_map(league_data)
    normalized_rows = _combine_rows_by_player_current_team(normalized_rows, current_team_by_player)
    team_conf_map = _build_team_conference_map(league_data)
    team_records = _build_team_records(schedule_by_date, results_by_id)
    team_wins = {team: row.get("wins", 0) for team, row in team_records.items()}
    team_games = {team: row.get("gp", 0) for team, row in team_records.items()}
    team_games.update({_norm_team_name(team): gp for team, gp in list(team_games.items())})

    decorated = _decorate_players(
        normalized_rows = normalized_rows,
        team_conf_map = team_conf_map,
        team_wins = team_wins,
        min_games = min_games,
        team_games = team_games,
    )

    decorated = _apply_all_star_scores(decorated)

    east = _build_conference_team(decorated, "East")
    west = _build_conference_team(decorated, "West")

    return {
        "season": season,
        "cutoff_date": cutoff_date,
        "min_games": min_games,
        "starter_games_pct": 0.75,
        "reserve_games_pct": 0.60,
        "all_star_version": ALL_STAR_LOGIC_VERSION,
        "east": east,
        "west": west,
    }