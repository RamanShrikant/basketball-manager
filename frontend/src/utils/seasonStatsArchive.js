import LZString from "lz-string";

export const PLAYER_STATS_KEY = "bm_player_stats_v1";
export const POSTSEASON_KEY = "bm_postseason_v2";
export const PLAYOFF_RESULTS_KEY = "bm_results_v2";
export const REGULAR_SCHEDULE_KEY = "bm_schedule_v3";
export const REGULAR_RESULT_INDEX_KEY = "bm_results_index_v3";
export const REGULAR_RESULT_PREFIX = "bm_result_v3_";
export const SEASON_STATS_ARCHIVE_VERSION = "season_stats_archive_v1";

const BEST_OF_SEVEN_HOME_ORDER = ["H", "H", "A", "A", "H", "A", "H"];

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round1(value) {
  return Number(safeNumber(value, 0).toFixed(1));
}

function format1(value) {
  return safeNumber(value, 0).toFixed(1);
}

function safeClone(value) {
  try {
    if (typeof structuredClone === "function") return structuredClone(value);
  } catch {}

  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

export function readCompressedOrJsonValue(raw, fallback = null) {
  if (!raw) return fallback;

  try {
    if (raw.startsWith("lz:")) {
      const decompressed = LZString.decompressFromUTF16(raw.slice(3));
      return decompressed ? JSON.parse(decompressed) : fallback;
    }
  } catch {}

  try {
    return JSON.parse(raw);
  } catch {}

  try {
    const decompressed = LZString.decompressFromUTF16(raw);
    return decompressed ? JSON.parse(decompressed) : fallback;
  } catch {
    return fallback;
  }
}

export function readStorageValue(key, fallback = null) {
  try {
    return readCompressedOrJsonValue(localStorage.getItem(key), fallback);
  } catch {
    return fallback;
  }
}

export function getAllTeamsFromLeague(leagueData) {
  if (!leagueData) return [];
  if (Array.isArray(leagueData.teams)) return leagueData.teams.filter(Boolean);
  return Object.entries(leagueData.conferences || {}).flatMap(([conference, teams]) =>
    (teams || []).filter(Boolean).map((team) => ({
      ...team,
      conference: team?.conference || team?.conf || conference,
    }))
  );
}

export function resolveTeamLogo(team) {
  return (
    team?.logo ||
    team?.teamLogo ||
    team?.newTeamLogo ||
    team?.logoUrl ||
    team?.image ||
    team?.img ||
    ""
  );
}

export function resolvePlayerImage(player) {
  return (
    player?.headshot ||
    player?.portrait ||
    player?.image ||
    player?.photo ||
    player?.img ||
    player?.face ||
    ""
  );
}

function compactPlayer(player = {}, teamName = "") {
  const attrs = Array.isArray(player?.attrs)
    ? player.attrs.slice(0, 15)
    : Array.isArray(player?.attributes)
    ? player.attributes.slice(0, 15)
    : [];

  return {
    id: player?.id || null,
    name: player?.name || player?.player || "Unknown",
    player: player?.name || player?.player || "Unknown",
    pos: player?.pos || player?.position || "-",
    position: player?.pos || player?.position || "-",
    secondaryPos: player?.secondaryPos || player?.secondaryPosition || "",
    age: player?.age ?? player?.playerAge ?? null,
    overall: player?.overall ?? player?.ovr ?? player?.rating ?? 0,
    ovr: player?.overall ?? player?.ovr ?? player?.rating ?? 0,
    potential: player?.potential ?? player?.pot ?? 0,
    pot: player?.potential ?? player?.pot ?? 0,
    offRating: player?.offRating ?? player?.offense ?? 0,
    defRating: player?.defRating ?? player?.defense ?? 0,
    stamina: player?.stamina ?? 0,
    attrs,
    headshot: resolvePlayerImage(player),
    image: resolvePlayerImage(player),
    img: resolvePlayerImage(player),
    teamName,
    team: teamName,
  };
}

function buildRosterSnapshot(leagueData) {
  return getAllTeamsFromLeague(leagueData).map((team) => ({
    name: team?.name || team?.teamName || "Unknown Team",
    conference: team?.conference || team?.conf || "",
    logo: resolveTeamLogo(team),
    players: (team?.players || []).map((player) =>
      compactPlayer(player, team?.name || team?.teamName || "")
    ),
  }));
}

function blankPlayerStats() {
  return {
    GP: 0,
    MIN: "0.0",
    PTS: "0.0",
    REB: "0.0",
    AST: "0.0",
    STL: "0.0",
    BLK: "0.0",
    TOV: "0.0",
    PF: "0.0",
    FG: "0.0",
    "3P": "0.0",
    FT: "0.0",
    "3PA": "0.0",
    FTA: "0.0",
  };
}

function toPlayerDisplayStats(rec = {}) {
  const gp = safeNumber(rec?.gp, 0);
  if (!gp) return blankPlayerStats();

  const safeGp = gp || 1;
  const fga = safeNumber(rec?.fga, 0);
  const tpa = safeNumber(rec?.tpa, 0);
  const fta = safeNumber(rec?.fta, 0);

  return {
    GP: gp,
    MIN: format1(safeNumber(rec?.min, 0) / safeGp),
    PTS: format1(safeNumber(rec?.pts, 0) / safeGp),
    REB: format1(safeNumber(rec?.reb, 0) / safeGp),
    AST: format1(safeNumber(rec?.ast, 0) / safeGp),
    STL: format1(safeNumber(rec?.stl, 0) / safeGp),
    BLK: format1(safeNumber(rec?.blk, 0) / safeGp),
    TOV: format1(safeNumber(rec?.to ?? rec?.tov ?? rec?.turnovers, 0) / safeGp),
    PF: format1(safeNumber(rec?.pf ?? rec?.fouls, 0) / safeGp),
    FG: fga > 0 ? format1((safeNumber(rec?.fgm, 0) / fga) * 100) : "0.0",
    "3P": tpa > 0 ? format1((safeNumber(rec?.tpm, 0) / tpa) * 100) : "0.0",
    FT: fta > 0 ? format1((safeNumber(rec?.ftm, 0) / fta) * 100) : "0.0",
    "3PA": format1(tpa / safeGp),
    FTA: format1(fta / safeGp),
  };
}

function parseMadeAttempts(value) {
  if (value && typeof value === "object") {
    return {
      made: safeNumber(value?.m ?? value?.made, 0),
      attempts: safeNumber(value?.a ?? value?.attempts ?? value?.att, 0),
    };
  }

  const parts = String(value || "")
    .trim()
    .split(/[\/-]/)
    .map((part) => Number(part));

  if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
    return { made: parts[0], attempts: parts[1] };
  }

  return { made: 0, attempts: 0 };
}

function createRawPlayerStat(playerName, teamName) {
  return {
    player: playerName,
    team: teamName,
    gp: 0,
    min: 0,
    pts: 0,
    reb: 0,
    ast: 0,
    stl: 0,
    blk: 0,
    to: 0,
    pf: 0,
    fgm: 0,
    fga: 0,
    tpm: 0,
    tpa: 0,
    ftm: 0,
    fta: 0,
  };
}

function addBoxRow(target, teamName, row) {
  const playerName = row?.player || row?.player_name || row?.name;
  if (!playerName || !teamName) return;

  const key = `${playerName}__${teamName}`;
  if (!target[key]) target[key] = createRawPlayerStat(playerName, teamName);

  const rec = target[key];
  const fg = parseMadeAttempts(row?.fg);
  const three = parseMadeAttempts(row?.["3p"] ?? row?.tp ?? row?.three);
  const ft = parseMadeAttempts(row?.ft);

  rec.gp += 1;
  rec.min += safeNumber(row?.min ?? row?.minutes, 0);
  rec.pts += safeNumber(row?.pts ?? row?.points, 0);
  rec.reb += safeNumber(row?.reb ?? row?.rebounds, 0);
  rec.ast += safeNumber(row?.ast ?? row?.assists, 0);
  rec.stl += safeNumber(row?.stl ?? row?.steals, 0);
  rec.blk += safeNumber(row?.blk ?? row?.blocks, 0);
  rec.to += safeNumber(row?.to ?? row?.tov ?? row?.turnovers, 0);
  rec.pf += safeNumber(row?.pf ?? row?.fouls, 0);
  rec.fgm += fg.made;
  rec.fga += fg.attempts;
  rec.tpm += three.made;
  rec.tpa += three.attempts;
  rec.ftm += ft.made;
  rec.fta += ft.attempts;
}

function teamMetaMaps(teams = []) {
  const playerByTeamAndName = new Map();
  const playerByName = new Map();
  const logoByTeam = new Map();
  const conferenceByTeam = new Map();

  for (const team of teams) {
    logoByTeam.set(team.name, team.logo || "");
    conferenceByTeam.set(team.name, team.conference || "");

    for (const player of team.players || []) {
      playerByTeamAndName.set(`${player.name}__${team.name}`, player);
      if (!playerByName.has(player.name)) playerByName.set(player.name, player);
    }
  }

  return { playerByTeamAndName, playerByName, logoByTeam, conferenceByTeam };
}

function normalizeRegularSeasonRows(rows = []) {
  return (rows || []).map((row) => ({
    teamName: row?.teamName || row?.team || "Unknown Team",
    conference: row?.conference || row?.conf || "",
    wins: safeNumber(row?.wins ?? row?.w, 0),
    losses: safeNumber(row?.losses ?? row?.l, 0),
    gamesPlayed: safeNumber(
      row?.gamesPlayed,
      safeNumber(row?.wins ?? row?.w, 0) + safeNumber(row?.losses ?? row?.l, 0)
    ),
    pointDifferential: safeNumber(row?.pointDifferential ?? row?.diff, 0),
    pointsFor: safeNumber(row?.pointsFor ?? row?.pf, 0),
    pointsAgainst: safeNumber(row?.pointsAgainst ?? row?.pa, 0),
    conferenceSeed: row?.conferenceSeed ?? null,
    leagueRank: row?.leagueRank ?? null,
  }));
}


function readRegularSeasonResultsV3() {
  const ids = readStorageValue(REGULAR_RESULT_INDEX_KEY, []) || [];
  const out = {};

  for (const id of Array.isArray(ids) ? ids : []) {
    const result = readStorageValue(`${REGULAR_RESULT_PREFIX}${String(id)}`, null);
    if (result) out[String(id)] = result;
  }

  return out;
}

function buildRegularSeasonRowsFromStorage(leagueData) {
  const schedule = readStorageValue(REGULAR_SCHEDULE_KEY, {}) || {};
  const results = readRegularSeasonResultsV3();
  const teams = getAllTeamsFromLeague(leagueData);
  const byName = new Map(
    teams.map((team) => [
      team?.name || team?.teamName,
      {
        teamName: team?.name || team?.teamName,
        conference: team?.conference || team?.conf || "",
        wins: 0,
        losses: 0,
        gamesPlayed: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 0,
      },
    ])
  );

  const scheduleById = new Map();
  for (const games of Object.values(schedule || {})) {
    for (const game of games || []) {
      if (game?.id == null) continue;
      scheduleById.set(String(game.id), game);
    }
  }

  const ensure = (teamName, conference = "") => {
    if (!teamName) return null;
    if (!byName.has(teamName)) {
      byName.set(teamName, {
        teamName,
        conference,
        wins: 0,
        losses: 0,
        gamesPlayed: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 0,
      });
    }
    return byName.get(teamName);
  };

  for (const [gameId, result] of Object.entries(results)) {
    const game = scheduleById.get(String(gameId));
    if (!game || !result?.totals) continue;

    const home = ensure(game.home, game.confHome || "");
    const away = ensure(game.away, game.confAway || "");
    if (!home || !away) continue;

    const homePts = safeNumber(result?.totals?.home, 0);
    const awayPts = safeNumber(result?.totals?.away, 0);
    home.gamesPlayed += 1;
    away.gamesPlayed += 1;
    home.pointsFor += homePts;
    home.pointsAgainst += awayPts;
    away.pointsFor += awayPts;
    away.pointsAgainst += homePts;

    if (homePts > awayPts) {
      home.wins += 1;
      away.losses += 1;
    } else if (awayPts > homePts) {
      away.wins += 1;
      home.losses += 1;
    }
  }

  return Array.from(byName.values()).map((row) => ({
    ...row,
    pointDifferential: row.pointsFor - row.pointsAgainst,
  }));
}

function buildSnapshotFromRaw({
  seasonYear,
  label,
  teams,
  rawPlayerStats,
  rawTeamStats,
  includeZeroRosterPlayers = true,
}) {
  const maps = teamMetaMaps(teams);
  const playerRows = [];
  const addedPlayerKeys = new Set();

  for (const rec of Object.values(rawPlayerStats || {})) {
    const playerName = rec?.player || rec?.name;
    const teamName = rec?.team || rec?.teamName;
    if (!playerName || !teamName) continue;

    const key = `${playerName}__${teamName}`;
    const meta =
      maps.playerByTeamAndName.get(key) ||
      maps.playerByName.get(playerName) ||
      compactPlayer({ name: playerName }, teamName);

    playerRows.push({
      ...meta,
      name: playerName,
      player: playerName,
      teamName,
      team: teamName,
      teamLogo: maps.logoByTeam.get(teamName) || "",
      headshot: resolvePlayerImage(meta),
      stats: toPlayerDisplayStats(rec),
    });
    addedPlayerKeys.add(key);
  }

  if (includeZeroRosterPlayers) {
    for (const team of teams) {
      for (const player of team.players || []) {
        const key = `${player.name}__${team.name}`;
        if (addedPlayerKeys.has(key)) continue;
        playerRows.push({
          ...player,
          teamName: team.name,
          team: team.name,
          teamLogo: team.logo || "",
          stats: blankPlayerStats(),
        });
      }
    }
  }

  playerRows.sort((a, b) => {
    const teamDiff = String(a.teamName || "").localeCompare(String(b.teamName || ""));
    if (teamDiff) return teamDiff;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });

  const rawTeamsByName = new Map(
    (rawTeamStats || []).map((row) => [row?.teamName || row?.team, row])
  );

  const teamRows = teams.map((team) => {
    const raw = rawTeamsByName.get(team.name) || {};
    const gp = safeNumber(
      raw?.gamesPlayed ?? raw?.gp,
      safeNumber(raw?.wins ?? raw?.w, 0) + safeNumber(raw?.losses ?? raw?.l, 0)
    );
    const safeGp = gp || 1;
    const playerTotals = Object.values(rawPlayerStats || {}).filter(
      (rec) => (rec?.team || rec?.teamName) === team.name
    );
    const sum = (field) => playerTotals.reduce((acc, rec) => acc + safeNumber(rec?.[field], 0), 0);
    const fga = sum("fga");
    const tpa = sum("tpa");
    const fta = sum("fta");
    const pointsFor = safeNumber(raw?.pointsFor ?? raw?.pf ?? raw?.pts, 0);
    const pointsAgainst = safeNumber(raw?.pointsAgainst ?? raw?.pa ?? raw?.oppPts, 0);

    return {
      teamName: team.name,
      logo: team.logo || "",
      conference: team.conference || "",
      wins: safeNumber(raw?.wins ?? raw?.w, 0),
      losses: safeNumber(raw?.losses ?? raw?.l, 0),
      pointDifferential: safeNumber(raw?.pointDifferential ?? raw?.diff, pointsFor - pointsAgainst),
      stats: {
        GP: gp,
        PTS: format1(pointsFor / safeGp),
        PA: format1(pointsAgainst / safeGp),
        REB: format1(sum("reb") / safeGp),
        AST: format1(sum("ast") / safeGp),
        STL: format1(sum("stl") / safeGp),
        BLK: format1(sum("blk") / safeGp),
        TOV: format1(
          playerTotals.reduce(
            (acc, rec) => acc + safeNumber(rec?.to ?? rec?.tov ?? rec?.turnovers, 0),
            0
          ) / safeGp
        ),
        PF: format1(
          playerTotals.reduce(
            (acc, rec) => acc + safeNumber(rec?.pf ?? rec?.fouls, 0),
            0
          ) / safeGp
        ),
        FG: fga > 0 ? format1((sum("fgm") / fga) * 100) : "0.0",
        "3P": tpa > 0 ? format1((sum("tpm") / tpa) * 100) : "0.0",
        FT: fta > 0 ? format1((sum("ftm") / fta) * 100) : "0.0",
        "3PA": format1(tpa / safeGp),
        FTA: format1(fta / safeGp),
      },
    };
  });

  return {
    version: SEASON_STATS_ARCHIVE_VERSION,
    seasonYear: safeNumber(seasonYear, 0),
    label: label || "",
    createdAt: new Date().toISOString(),
    teams,
    playerRows,
    teamRows,
  };
}

export function buildRegularSeasonStatsSnapshot(
  leagueData,
  playerStatsMap = {},
  regularSeasonRows = [],
  seasonYear = null
) {
  const teams = buildRosterSnapshot(leagueData);
  const normalizedRows = normalizeRegularSeasonRows(regularSeasonRows);

  return buildSnapshotFromRaw({
    seasonYear,
    label: "Regular Season",
    teams,
    rawPlayerStats: playerStatsMap || {},
    rawTeamStats: normalizedRows,
    includeZeroRosterPlayers: true,
  });
}

function addSeriesGames(gameMap, series) {
  if (!series?.highSeedTeam || !series?.lowSeedTeam) return;

  (series.gameIds || []).forEach((gameId, index) => {
    if (!gameId) return;
    const highHome = BEST_OF_SEVEN_HOME_ORDER[index] === "H";
    gameMap.set(String(gameId), {
      home: highHome ? series.highSeedTeam : series.lowSeedTeam,
      away: highHome ? series.lowSeedTeam : series.highSeedTeam,
    });
  });
}

export function buildPostseasonGameMap(postseasonState) {
  const map = new Map();

  for (const conf of Object.values(postseasonState?.conf || {})) {
    const rounds = conf?.rounds || {};
    for (const series of Object.values(rounds?.r1 || {})) addSeriesGames(map, series);
    for (const series of Object.values(rounds?.r2 || {})) addSeriesGames(map, series);
    addSeriesGames(map, rounds?.r3?.confFinals);
  }

  addSeriesGames(map, postseasonState?.finals);
  return map;
}

export function buildPlayoffStatsSnapshot(
  leagueData,
  postseasonState,
  playoffResults = {},
  seasonYear = null
) {
  const teams = buildRosterSnapshot(leagueData);
  const gameMap = buildPostseasonGameMap(postseasonState);
  const rawPlayerStats = {};
  const rawTeams = new Map();

  const ensureTeam = (teamName) => {
    if (!teamName) return null;
    if (!rawTeams.has(teamName)) {
      rawTeams.set(teamName, {
        teamName,
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
        pointsFor: 0,
        pointsAgainst: 0,
      });
    }
    return rawTeams.get(teamName);
  };

  for (const [gameId, result] of Object.entries(playoffResults || {})) {
    if (!String(gameId).startsWith("PO_")) continue;
    const meta = gameMap.get(String(gameId));
    if (!meta || !result?.totals) continue;

    const home = ensureTeam(meta.home);
    const away = ensureTeam(meta.away);
    if (!home || !away) continue;

    const homePts = safeNumber(result?.totals?.home, 0);
    const awayPts = safeNumber(result?.totals?.away, 0);

    home.gamesPlayed += 1;
    away.gamesPlayed += 1;
    home.pointsFor += homePts;
    home.pointsAgainst += awayPts;
    away.pointsFor += awayPts;
    away.pointsAgainst += homePts;

    if (homePts > awayPts) {
      home.wins += 1;
      away.losses += 1;
    } else if (awayPts > homePts) {
      away.wins += 1;
      home.losses += 1;
    }

    for (const row of result?.box?.home || []) addBoxRow(rawPlayerStats, meta.home, row);
    for (const row of result?.box?.away || []) addBoxRow(rawPlayerStats, meta.away, row);
  }

  const participatingTeamNames = new Set(rawTeams.keys());
  const playoffTeams = teams.filter((team) => participatingTeamNames.has(team.name));

  return buildSnapshotFromRaw({
    seasonYear,
    label: "Playoffs",
    teams: playoffTeams,
    rawPlayerStats,
    rawTeamStats: Array.from(rawTeams.values()),
    includeZeroRosterPlayers: false,
  });
}

export function getLatestSeasonHistoryEntry(leagueData, { requireArchive = false } = {}) {
  const rows = Array.isArray(leagueData?.seasonHistory) ? leagueData.seasonHistory : [];
  const filtered = requireArchive
    ? rows.filter((row) => row?.statsArchive?.regular || row?.statsArchive?.playoffs)
    : rows;

  return [...filtered].sort(
    (a, b) => safeNumber(b?.seasonYear, 0) - safeNumber(a?.seasonYear, 0)
  )[0] || null;
}

export function ensureCompletedSeasonStatsArchive(leagueData, seasonStartYear) {
  if (!leagueData) return leagueData;

  const next = safeClone(leagueData);
  const history = Array.isArray(next?.seasonHistory) ? [...next.seasonHistory] : [];
  const targetYear = safeNumber(seasonStartYear, 0);
  let index = history.findIndex((row) => safeNumber(row?.seasonYear, 0) === targetYear);

  if (index < 0) {
    history.push({ seasonYear: targetYear, status: "complete", teams: [] });
    index = history.length - 1;
  }

  const entry = history[index] || {};
  const playerStatsMap = readStorageValue(PLAYER_STATS_KEY, {}) || {};
  const postseasonState = readStorageValue(POSTSEASON_KEY, null);
  const playoffResults = readStorageValue(PLAYOFF_RESULTS_KEY, {}) || {};

  const savedFinalStandings = Array.isArray(entry?.teams) && entry.teams.length
    ? entry.teams
    : buildRegularSeasonRowsFromStorage(next);

  const regular = buildRegularSeasonStatsSnapshot(
    next,
    playerStatsMap,
    savedFinalStandings,
    targetYear
  );

  const playoffs = buildPlayoffStatsSnapshot(
    next,
    postseasonState,
    playoffResults,
    targetYear
  );

  history[index] = {
    ...entry,
    seasonYear: targetYear,
    statsArchive: {
      version: SEASON_STATS_ARCHIVE_VERSION,
      regular,
      playoffs,
      archivedAt: new Date().toISOString(),
    },
  };

  next.seasonHistory = history
    .sort((a, b) => safeNumber(a?.seasonYear, 0) - safeNumber(b?.seasonYear, 0))
    .slice(-10);

  return next;
}

export function getLivePlayoffStatsSnapshot(leagueData) {
  const post = readStorageValue(POSTSEASON_KEY, null);
  const results = readStorageValue(PLAYOFF_RESULTS_KEY, {}) || {};
  const seasonYear = safeNumber(post?.seasonYear, 0);
  return buildPlayoffStatsSnapshot(leagueData, post, results, seasonYear);
}

export function getArchivedStatsSnapshot(leagueData, scope = "regular") {
  const entry = getLatestSeasonHistoryEntry(leagueData, { requireArchive: true });
  if (!entry) return null;
  return scope === "playoffs"
    ? entry?.statsArchive?.playoffs || null
    : entry?.statsArchive?.regular || null;
}

export function seasonLabelFromStartYear(seasonYear) {
  const year = safeNumber(seasonYear, 0);
  if (!year) return "";
  return `${year}-${String(year + 1).slice(-2)}`;
}

export function expandSnapshotTeamRows(snapshot) {
  return (snapshot?.teamRows || []).map((row) => ({
    ...row,
    stats: { ...row.stats },
  }));
}

export function getSnapshotTeams(snapshot) {
  return (snapshot?.teams || []).map((team) => ({
    ...team,
    players: (team?.players || []).map((player) => ({ ...player })),
  }));
}

export function getSnapshotPlayerRows(snapshot) {
  return (snapshot?.playerRows || []).map((row) => ({
    ...row,
    stats: { ...row.stats },
  }));
}

export function summarizeSnapshot(snapshot) {
  return {
    playerCount: snapshot?.playerRows?.length || 0,
    teamCount: snapshot?.teamRows?.length || 0,
    seasonYear: snapshot?.seasonYear || null,
    label: snapshot?.label || "",
  };
}
