import LZString from "lz-string";

const PLAYER_STATS_KEY = "bm_player_stats_v1";
const AWARDS_KEY = "bm_awards_v1";
const FINALS_MVP_KEY = "bm_finals_mvp_v1";
const ALL_STARS_KEY = "bm_all_stars_v1";

function readCompressedOrJson(key, fallback = {}) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;

    if (raw.startsWith("lz:")) {
      const decompressed = LZString.decompressFromUTF16(raw.slice(3));
      return decompressed ? JSON.parse(decompressed) : fallback;
    }

    try {
      return JSON.parse(raw);
    } catch {}

    const decompressed = LZString.decompressFromUTF16(raw);
    return decompressed ? JSON.parse(decompressed) : fallback;
  } catch {
    return fallback;
  }
}

function getAllTeamsFromLeague(leagueData) {
  if (!leagueData) return [];
  if (Array.isArray(leagueData.teams)) return leagueData.teams;
  if (leagueData.conferences) return Object.values(leagueData.conferences).flat();
  return [];
}

function getTeamLogoMap(leagueData) {
  const map = {};
  const teams = getAllTeamsFromLeague(leagueData);

  for (const team of teams) {
    if (!team?.name) continue;

    map[team.name] =
      team.logo ||
      team.teamLogo ||
      team.newTeamLogo ||
      team.logoUrl ||
      team.image ||
      team.img ||
      "";
  }

  return map;
}

function round1(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(1));
}

function pct1(made, attempts) {
  const m = Number(made || 0);
  const a = Number(attempts || 0);
  if (!a) return 0;
  return round1((m / a) * 100);
}

function buildArchivedSeasonRow(rec, seasonYear, teamLogoMap) {
  const gp = Number(rec?.gp || 0);
  const safeGp = gp || 1;
  const teamName = rec?.team || "Free Agent";

  return {
    seasonYear,
    teamName,
    teamLogo: teamLogoMap[teamName] || "",
    games: gp,
    ppg: round1(Number(rec?.pts || 0) / safeGp),
    rpg: round1(Number(rec?.reb || 0) / safeGp),
    apg: round1(Number(rec?.ast || 0) / safeGp),
    spg: round1(Number(rec?.stl || 0) / safeGp),
    bpg: round1(Number(rec?.blk || 0) / safeGp),
    fgPct: pct1(rec?.fgm, rec?.fga),
    threePct: pct1(rec?.tpm, rec?.tpa),
    ftPct: pct1(rec?.ftm, rec?.fta),
    source: "sim",
    simulated: true,
  };
}

function ensureHistory(player) {
  const next = { ...player };

  next.history = {
    ...(next.history || {}),
    seasons: Array.isArray(next.history?.seasons) ? [...next.history.seasons] : [],
    accolades: Array.isArray(next.history?.accolades) ? [...next.history.accolades] : [],
    transactions: Array.isArray(next.history?.transactions) ? [...next.history.transactions] : [],
  };

  return next;
}

function upsertSeasonRow(player, row) {
  const next = ensureHistory(player);

  next.history.seasons = next.history.seasons.filter((existing) => {
    const sameSeason = Number(existing?.seasonYear || 0) === Number(row?.seasonYear || 0);
    const sameTeam = String(existing?.teamName || "") === String(row?.teamName || "");
    const sameSource = existing?.source === "sim" || existing?.simulated === true;

    return !(sameSeason && sameTeam && sameSource);
  });

  next.history.seasons.push(row);

  next.history.seasons.sort((a, b) => {
    const ay = Number(a?.seasonYear || 0);
    const by = Number(b?.seasonYear || 0);

    if (ay !== by) return ay - by;
    return String(a?.teamName || "").localeCompare(String(b?.teamName || ""));
  });

  return next;
}

function addAccolade(player, accolade) {
  const next = ensureHistory(player);

  const exists = next.history.accolades.some((row) => {
    return (
      Number(row?.seasonYear || 0) === Number(accolade?.seasonYear || 0) &&
      String(row?.type || "") === String(accolade?.type || "") &&
      String(row?.label || "") === String(accolade?.label || "")
    );
  });

  if (!exists) {
    next.history.accolades.push(accolade);
  }

  next.history.accolades.sort((a, b) => Number(a?.seasonYear || 0) - Number(b?.seasonYear || 0));

  return next;
}

function updatePlayerEverywhere(leagueData, playerName, updater) {
  const updated = structuredClone(leagueData);

  for (const confKey of Object.keys(updated.conferences || {})) {
    updated.conferences[confKey] = (updated.conferences[confKey] || []).map((team) => {
      return {
        ...team,
        players: (team.players || []).map((player) => {
          if ((player?.name || player?.player) !== playerName) return player;
          return updater(player);
        }),
      };
    });
  }

  updated.freeAgents = (updated.freeAgents || []).map((player) => {
    if ((player?.name || player?.player) !== playerName) return player;
    return updater(player);
  });

  return updated;
}

export function archiveCurrentSeasonStatsIntoPlayerHistory(leagueData, seasonYear) {
  if (!leagueData) return leagueData;

  const statsMap = readCompressedOrJson(PLAYER_STATS_KEY, {});
  const teamLogoMap = getTeamLogoMap(leagueData);
  let updated = structuredClone(leagueData);

  for (const rec of Object.values(statsMap || {})) {
    const playerName = rec?.player;
    if (!playerName || !Number(rec?.gp || 0)) continue;

    const row = buildArchivedSeasonRow(rec, seasonYear, teamLogoMap);

    updated = updatePlayerEverywhere(updated, playerName, (player) => {
      return upsertSeasonRow(player, row);
    });
  }

  return updated;
}

export function archiveCurrentAwardsIntoPlayerHistory(leagueData, seasonYear) {
  if (!leagueData) return leagueData;

  const awards = readCompressedOrJson(AWARDS_KEY, null);
  const finalsMvp = readCompressedOrJson(FINALS_MVP_KEY, null);
  const allStars = readCompressedOrJson(ALL_STARS_KEY, null);

  let updated = structuredClone(leagueData);

  const addFor = (playerName, accolade) => {
    if (!playerName) return;

    updated = updatePlayerEverywhere(updated, playerName, (player) => {
      return addAccolade(player, accolade);
    });
  };

  const awardMap = [
    ["mvp", "MVP", "Most Valuable Player"],
    ["dpoy", "DPOY", "Defensive Player of the Year"],
    ["sixth_man", "6MOY", "Sixth Man of the Year"],
    ["roty", "ROTY", "Rookie of the Year"],
  ];

  for (const [key, shortLabel, fullLabel] of awardMap) {
    const winner = awards?.[key];
    if (winner?.player) {
      addFor(winner.player, {
        seasonYear,
        type: key,
        label: shortLabel,
        details: fullLabel,
        team: winner.team || null,
        source: "sim",
      });
    }
  }

  const allNbaMap = [
    ["all_nba_first", "All-NBA First Team", "all_nba_first"],
    ["all_nba_second", "All-NBA Second Team", "all_nba_second"],
    ["all_nba_third", "All-NBA Third Team", "all_nba_third"],
  ];

  for (const [key, label, type] of allNbaMap) {
    for (const row of awards?.[key] || []) {
      if (row?.player) {
        addFor(row.player, {
          seasonYear,
          type,
          label,
          team: row.team || null,
          source: "sim",
        });
      }
    }
  }

  const fmvpWinner = finalsMvp?.finals_mvp;
  if (fmvpWinner?.player) {
    addFor(fmvpWinner.player, {
      seasonYear,
      type: "finals_mvp",
      label: "Finals MVP",
      team: fmvpWinner.team || finalsMvp?.champion_team || null,
      source: "sim",
    });
  }

  const addAllStarRows = (rows, label) => {
    for (const row of rows || []) {
      if (!row?.player) continue;

      addFor(row.player, {
        seasonYear,
        type: "all_star",
        label,
        team: row.team || null,
        source: "sim",
      });
    }
  };

  addAllStarRows(allStars?.east?.starters, "All-Star Starter");
  addAllStarRows(allStars?.west?.starters, "All-Star Starter");
  addAllStarRows(allStars?.east?.reserves, "All-Star Reserve");
  addAllStarRows(allStars?.west?.reserves, "All-Star Reserve");

  return updated;
}

export function archiveCurrentSeasonIntoPlayerCards(leagueData, seasonYear) {
  let updated = archiveCurrentSeasonStatsIntoPlayerHistory(leagueData, seasonYear);
  updated = archiveCurrentAwardsIntoPlayerHistory(updated, seasonYear);
  return updated;
}
