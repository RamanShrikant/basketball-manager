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
    ["mvp", "MVP", "Most Valuable Player"],
    ["dpoy", "DPOY", "Defensive Player of the Year"],
    ["sixth_man", "6MOY", "Sixth Man of the Year"],
    ["roty", "ROTY", "Rookie of the Year"],
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

  const addAllStars = (starRows, label) => {
    for (const row of starRows || []) add(row?.player, { seasonYear, type: "all_star", label, team: row?.team || null, source: "sim" });
  };
  addAllStars(allStars?.east?.starters, "All-Star Starter");
  addAllStars(allStars?.west?.starters, "All-Star Starter");
  addAllStars(allStars?.east?.reserves, "All-Star Reserve");
  addAllStars(allStars?.west?.reserves, "All-Star Reserve");
  return rows;
}

function applyStatsToClonedLeague(updated, seasonYear) {
  const statsMap = readCompressedOrJson(PLAYER_STATS_KEY, {});
  const teamLogoMap = getTeamLogoMap(updated);
  const index = buildPlayerLocationIndex(updated);
  for (const rec of Object.values(statsMap || {})) {
    const playerName = rec?.player;
    if (!playerName || !Number(rec?.gp || 0)) continue;
    const row = buildArchivedSeasonRow(rec, seasonYear, teamLogoMap);
    updateIndexedPlayer(index, playerName, (player) => upsertSeasonRow(player, row));
  }
  return { updated, index };
}

function applyAwardsToClonedLeague(updated, seasonYear, existingIndex = null) {
  const index = existingIndex || buildPlayerLocationIndex(updated);
  for (const { playerName, accolade } of collectAwardAccolades(seasonYear)) {
    updateIndexedPlayer(index, playerName, (player) => addAccolade(player, accolade));
  }
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

