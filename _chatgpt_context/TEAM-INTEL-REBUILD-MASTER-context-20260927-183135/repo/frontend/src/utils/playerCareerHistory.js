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

function seasonStatRecordHasRealProduction(rec = {}) {
  return (
    Number(rec?.pts || 0) +
    Number(rec?.reb || 0) +
    Number(rec?.ast || 0) +
    Number(rec?.stl || 0) +
    Number(rec?.blk || 0) +
    Number(rec?.fga || 0) +
    Number(rec?.tpa || 0) +
    Number(rec?.fta || 0)
  ) > 0;
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

function statDisplayNumber(value, fallback = 0) {
  const n = Number(String(value ?? "").replace("%", ""));
  return Number.isFinite(n) ? n : fallback;
}

function archivedPlayerSnapshotHasGames(row = {}) {
  const stats = row?.stats && typeof row.stats === "object" ? row.stats : {};
  const games = statDisplayNumber(row?.games ?? row?.gp ?? row?.GP ?? stats.GP, 0);
  return games > 0;
}

function buildArchivedSeasonRowFromSnapshot(row, seasonYear, teamLogoMap) {
  const stats = row?.stats && typeof row.stats === "object" ? row.stats : {};
  const teamName = row?.teamName || row?.team || "Free Agent";
  return {
    seasonYear,
    teamName,
    teamLogo: row?.teamLogo || row?.logo || teamLogoMap[teamName] || "",
    games: statDisplayNumber(row?.games ?? row?.gp ?? row?.GP ?? stats.GP, 0),
    ppg: round1(statDisplayNumber(row?.ppg ?? stats.PTS, 0)),
    rpg: round1(statDisplayNumber(row?.rpg ?? stats.REB, 0)),
    apg: round1(statDisplayNumber(row?.apg ?? stats.AST, 0)),
    spg: round1(statDisplayNumber(row?.spg ?? stats.STL, 0)),
    bpg: round1(statDisplayNumber(row?.bpg ?? stats.BLK, 0)),
    fgPct: round1(statDisplayNumber(row?.fgPct ?? stats.FG, 0)),
    threePct: round1(statDisplayNumber(row?.threePct ?? stats["3P"], 0)),
    ftPct: round1(statDisplayNumber(row?.ftPct ?? stats.FT, 0)),
    source: "sim",
    simulated: true,
    recoveredFromStatsArchive: true,
  };
}

function findRegularStatsArchiveForPlayerHistory(leagueData, completedSeasonYear) {
  const targetDisplayYear = Number(completedSeasonYear || 0);
  const targetStartYear = targetDisplayYear > 1900 ? targetDisplayYear - 1 : 0;
  const history = Array.isArray(leagueData?.seasonHistory) ? leagueData.seasonHistory : [];

  const candidates = history
    .filter((entry) => entry?.statsArchive?.regular?.playerRows)
    .map((entry) => {
      const entryYear = Number(entry?.seasonYear || 0);
      const snapshotYear = Number(entry?.statsArchive?.regular?.seasonYear || 0);
      const displayYear = snapshotYear > 1900 ? snapshotYear + 1 : (entryYear > 1900 ? entryYear + 1 : 0);
      let priority = 0;
      if (entryYear === targetStartYear || snapshotYear === targetStartYear) priority = 4;
      else if (entryYear === targetDisplayYear || snapshotYear === targetDisplayYear) priority = 3;
      else if (displayYear === targetDisplayYear) priority = 2;
      else if (targetDisplayYear <= 0) priority = 1;
      return { entry, entryYear, snapshotYear, displayYear, priority };
    })
    .filter((row) => row.priority > 0)
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return Number(b.snapshotYear || b.entryYear || 0) - Number(a.snapshotYear || a.entryYear || 0);
    });

  return candidates[0] || null;
}

function applyArchivedStatsSnapshotToClonedLeague(updated, completedSeasonYear, existingIndex = null) {
  const archiveCandidate = findRegularStatsArchiveForPlayerHistory(updated, completedSeasonYear);
  const playerRows = archiveCandidate?.entry?.statsArchive?.regular?.playerRows || [];
  if (!Array.isArray(playerRows) || !playerRows.length) {
    return { updated, index: existingIndex || buildPlayerLocationIndex(updated), appliedRows: 0 };
  }

  const displaySeasonYear = Number(completedSeasonYear || archiveCandidate.displayYear || 0);
  if (!Number.isFinite(displaySeasonYear) || displaySeasonYear <= 1900) {
    return { updated, index: existingIndex || buildPlayerLocationIndex(updated), appliedRows: 0 };
  }

  const index = existingIndex || buildPlayerLocationIndex(updated);
  const teamLogoMap = getTeamLogoMap(updated);
  let appliedRows = 0;

  for (const snapshotRow of playerRows) {
    const playerName = snapshotRow?.name || snapshotRow?.player;
    if (!playerName || !archivedPlayerSnapshotHasGames(snapshotRow)) continue;
    const row = buildArchivedSeasonRowFromSnapshot(snapshotRow, displaySeasonYear, teamLogoMap);
    updateIndexedPlayer(index, playerName, (player) => upsertSeasonRow(player, row));
    appliedRows += 1;
  }

  return { updated, index, appliedRows };
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

  // Patch 29: when applying archived stat snapshots after an offseason signing,
  // do not attach the player's new current team to an already-authored previous
  // season. Existing real history rows win; archive rows only fill missing years.
  const rowSeason = Number(row?.seasonYear || 0);
  const rowTeam = String(row?.teamName || row?.team || "").trim();
  const isArchiveFill = row?.source === "sim" || row?.simulated === true || row?.recoveredFromStatsArchive;
  if (isArchiveFill && rowSeason && rowTeam) {
    const existingRealSeasonRows = next.history.seasons.filter((existing) => (
      Number(existing?.seasonYear || 0) === rowSeason &&
      Number(existing?.games ?? existing?.gp ?? 0) > 0 &&
      !(existing?.source === "sim" || existing?.simulated === true || existing?.recoveredFromStatsArchive)
    ));
    if (existingRealSeasonRows.length && !existingRealSeasonRows.some((existing) => String(existing?.teamName || existing?.team || "").trim() === rowTeam)) {
      return next;
    }
  }

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

function buildPlayerLocationIndex(leagueData) {
  const index = new Map();
  const addContainer = (container) => {
    if (!Array.isArray(container)) return;
    container.forEach((player, playerIndex) => {
      const name = player?.name || player?.player;
      if (!name) return;
      const rows = index.get(name) || [];
      rows.push({ container, playerIndex });
      index.set(name, rows);
    });
  };

  if (Array.isArray(leagueData?.teams)) {
    for (const team of leagueData.teams) {
      addContainer(team?.players);
      addContainer(team?.twoWayPlayers);
      addContainer(team?.stashPlayers);
    }
  }

  for (const teams of Object.values(leagueData?.conferences || {})) {
    for (const team of teams || []) {
      addContainer(team?.players);
      addContainer(team?.twoWayPlayers);
      addContainer(team?.stashPlayers);
    }
  }

  addContainer(leagueData?.freeAgents);
  return index;
}

function updateIndexedPlayer(index, playerName, updater) {
  for (const location of index.get(playerName) || []) {
    const current = location.container[location.playerIndex];
    location.container[location.playerIndex] = updater(current);
  }
}

function collectAwardAccolades(seasonYear) {
  const awards = readCompressedOrJson(AWARDS_KEY, null);
  const finalsMvp = readCompressedOrJson(FINALS_MVP_KEY, null);
  const allStars = readCompressedOrJson(ALL_STARS_KEY, null);
  const rows = [];
  const add = (playerName, accolade) => {
    if (playerName) rows.push({ playerName, accolade });
  };

  const awardMap = [
    ["mvp", "Most Valuable Player", "Most Valuable Player"],
    ["dpoy", "Defensive Player of the Year", "Defensive Player of the Year"],
    ["sixth_man", "Sixth Man of the Year", "Sixth Man of the Year"],
    ["mip", "Most Improved Player", "Most Improved Player"],
    ["clutch_player", "Clutch Player of the Year", "Clutch Player of the Year"],
    ["roty", "Rookie of the Year", "Rookie of the Year"],
  ];
  for (const [key, shortLabel, fullLabel] of awardMap) {
    const winner = awards?.[key];
    if (winner?.player) add(winner.player, { seasonYear, type: key, label: shortLabel, details: fullLabel, team: winner.team || null, source: "sim" });
  }

  const teamRows = [
    ["all_nba_first", "All-NBA First Team", "all_nba_first"],
    ["all_nba_second", "All-NBA Second Team", "all_nba_second"],
    ["all_nba_third", "All-NBA Third Team", "all_nba_third"],
    ["all_rookie_first", "All-Rookie First Team", "all_rookie_first"],
    ["all_rookie_second", "All-Rookie Second Team", "all_rookie_second"],
    ["all_defensive_first", "All-Defensive First Team", "all_defensive_first"],
    ["all_defensive_second", "All-Defensive Second Team", "all_defensive_second"],
  ];
  for (const [key, label, type] of teamRows) {
    for (const row of awards?.[key] || []) add(row?.player, { seasonYear, type, label, team: row?.team || null, source: "sim" });
  }

  const fmvpWinner = finalsMvp?.finals_mvp;
  if (fmvpWinner?.player) add(fmvpWinner.player, { seasonYear, type: "finals_mvp", label: "Finals MVP", team: fmvpWinner.team || finalsMvp?.champion_team || null, source: "sim" });

  const addAllStars = (starRows) => {
    for (const row of starRows || []) add(row?.player, { seasonYear, type: "all_star", label: "NBA All-Star", team: row?.team || null, source: "sim" });
  };
  addAllStars(allStars?.east?.starters);
  addAllStars(allStars?.west?.starters);
  addAllStars(allStars?.east?.reserves);
  addAllStars(allStars?.west?.reserves);
  return rows;
}

function applyChampionAccoladesToClonedLeague(updated, seasonYear, existingIndex = null) {
  const finalsMvp = readCompressedOrJson(FINALS_MVP_KEY, null);
  const championTeamName = finalsMvp?.champion_team || finalsMvp?.finals_mvp?.team || null;
  if (!championTeamName) return updated;

  const index = existingIndex || buildPlayerLocationIndex(updated);
  const championTeams = getAllTeamsFromLeague(updated).filter((team) => team?.name === championTeamName);
  const championPlayerNames = new Set();

  for (const team of championTeams) {
    for (const list of [team?.players, team?.twoWayPlayers]) {
      for (const player of list || []) {
        const playerName = player?.name || player?.player;
        if (playerName) championPlayerNames.add(playerName);
      }
    }
  }

  const championAccolade = {
    seasonYear,
    type: "champion",
    label: "NBA Champion",
    team: championTeamName,
    source: "sim",
  };

  for (const playerName of championPlayerNames) {
    updateIndexedPlayer(index, playerName, (player) => addAccolade(player, championAccolade));
  }

  return updated;
}

function applyStatsToClonedLeague(updated, seasonYear) {
  const statsMap = readCompressedOrJson(PLAYER_STATS_KEY, {});
  const teamLogoMap = getTeamLogoMap(updated);
  const index = buildPlayerLocationIndex(updated);
  let appliedLiveRows = 0;
  for (const rec of Object.values(statsMap || {})) {
    const playerName = rec?.player;
    if (!playerName || !Number(rec?.gp || 0)) continue;
    // Awards-page aggregate rows are display helpers only. Do not archive them as
    // extra player-card season rows or traded players can be double counted.
    if (rec?._awardsOnly || rec?._combinedForAwards) continue;
    // Do not archive corrupted placeholder rows like GP 82 / 0-0-0-0-0.
    // Those rows can poison future ROTY/MIP eligibility and make cards look broken.
    if (!seasonStatRecordHasRealProduction(rec)) continue;
    const row = buildArchivedSeasonRow(rec, seasonYear, teamLogoMap);
    updateIndexedPlayer(index, playerName, (player) => upsertSeasonRow(player, row));
    appliedLiveRows += 1;
  }

  // Some dev/full-offseason paths may arrive here after live stat keys were
  // already cleared. The compact seasonHistory statsArchive is the fallback
  // source of truth, so recover one player-card row per player/team/season from
  // that archive instead of losing the completed simulated season.
  if (appliedLiveRows === 0) {
    return applyArchivedStatsSnapshotToClonedLeague(updated, seasonYear, index);
  }

  return { updated, index, appliedRows: appliedLiveRows };
}

function applyAwardsToClonedLeague(updated, seasonYear, existingIndex = null) {
  const index = existingIndex || buildPlayerLocationIndex(updated);
  for (const { playerName, accolade } of collectAwardAccolades(seasonYear)) {
    updateIndexedPlayer(index, playerName, (player) => addAccolade(player, accolade));
  }
  applyChampionAccoladesToClonedLeague(updated, seasonYear, index);
  return updated;
}

export function archiveCurrentSeasonStatsIntoPlayerHistory(leagueData, seasonYear) {
  if (!leagueData) return leagueData;
  const updated = structuredClone(leagueData);
  return applyStatsToClonedLeague(updated, seasonYear).updated;
}

export function archiveCurrentAwardsIntoPlayerHistory(leagueData, seasonYear) {
  if (!leagueData) return leagueData;
  const updated = structuredClone(leagueData);
  return applyAwardsToClonedLeague(updated, seasonYear);
}

export function archiveCurrentSeasonIntoPlayerCards(leagueData, seasonYear) {
  if (!leagueData) return leagueData;
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  const updated = structuredClone(leagueData);
  const { index } = applyStatsToClonedLeague(updated, seasonYear);
  applyAwardsToClonedLeague(updated, seasonYear, index);
  if (typeof window !== "undefined" && window.__debugSimLogs) {
    const elapsed = (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt;
    console.log(`[PlayerHistory] archived season in ${elapsed.toFixed(1)}ms with one league clone`);
  }
  return updated;
}

