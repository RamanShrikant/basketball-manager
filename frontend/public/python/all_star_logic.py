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


def _build_team_wins(schedule_by_date: Dict[str, Any], results_by_id: Dict[str, Any]) -> Dict[str, int]:
    wins: Dict[str, int] = {}

    for _, games in (schedule_by_date or {}).items():
        if not isinstance(games, list):
            continue

        for game in games:
            if not isinstance(game, dict):
                continue
            if not game.get("played"):
                continue

            game_id = game.get("id")
            result = (results_by_id or {}).get(game_id) or {}
            totals = result.get("totals") or result.get("score") or {}

            home_pts = _to_int(totals.get("home"), 0)
            away_pts = _to_int(totals.get("away"), 0)

            if home_pts == away_pts:
                continue

            winner = game.get("home") if home_pts > away_pts else game.get("away")
            if winner:
                wins[winner] = wins.get(winner, 0) + 1

    return wins


def _decorate_players(
    normalized_rows: List[Dict[str, Any]],
    team_conf_map: Dict[str, str],
    team_wins: Dict[str, int],
    min_games: int,
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

        ppg = row["pts_total"] / gp if gp else 0.0
        rpg = row["reb_total"] / gp if gp else 0.0
        apg = row["ast_total"] / gp if gp else 0.0
        spg = row["stl_total"] / gp if gp else 0.0
        bpg = row["blk_total"] / gp if gp else 0.0

        fg_pct = (row["fgm"] / row["fga"] * 100.0) if row["fga"] > 0 else 0.0
        tp_pct = (row["tpm"] / row["tpa"] * 100.0) if row["tpa"] > 0 else 0.0
        ft_pct = (row["ftm"] / row["fta"] * 100.0) if row["fta"] > 0 else 0.0

        team_wins_value = team_wins.get(row["team"], 0)

        all_star_score = (
            ppg
            + 0.70 * rpg
            + 0.90 * apg
            + 1.80 * spg
            + 1.50 * bpg
            + 0.04 * team_wins_value
            + 0.03 * row["started"]
            + 0.01 * row["sixth"]
        )

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
            "all_star_score": round(float(all_star_score), 3),
        })

    return out


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
    conf_players = [p for p in players if p["conference"] == conference]
    conf_players = _sort_players(conf_players)

    starters = conf_players[:5]
    reserves = conf_players[5:12]
    snubs = conf_players[12:20]

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
    team_conf_map = _build_team_conference_map(league_data)
    team_wins = _build_team_wins(schedule_by_date, results_by_id)

    decorated = _decorate_players(
        normalized_rows = normalized_rows,
        team_conf_map = team_conf_map,
        team_wins = team_wins,
        min_games = min_games,
    )

    east = _build_conference_team(decorated, "East")
    west = _build_conference_team(decorated, "West")

    return {
        "season": season,
        "cutoff_date": cutoff_date,
        "min_games": min_games,
        "east": east,
        "west": west,
    }