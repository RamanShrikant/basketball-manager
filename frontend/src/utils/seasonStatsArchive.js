import LZString from "lz-string";
import {
  deleteAppDataFromDB,
  loadAppDataFromDB,
  saveAppDataToDB,
} from "./indexedDbStorage.js";
import { readScheduleFromStorage } from "./scheduleStorage.js";

export const PLAYER_STATS_KEY = "bm_player_stats_v1";
export const POSTSEASON_KEY = "bm_postseason_v2";
export const PLAYOFF_RESULTS_KEY = "bm_results_v2";
export const REGULAR_RESULT_INDEX_KEY = "bm_results_index_v3";
export const REGULAR_RESULT_PREFIX = "bm_result_v3_";
export const SEASON_STATS_ARCHIVE_VERSION = "season_stats_archive_v1";
export const COMPLETED_STATS_BACKUP_KEY = "bm_completed_stats_archive_v2";
export const COMPLETED_REGULAR_PLAYER_STATS_KEY = "bm_completed_regular_player_stats_v2";

let completedStatsBackupCache = null;
let completedRegularPlayerStatsBackupCache = null;
let seasonStatsStorageInitialized = false;
let seasonStatsWriteChain = Promise.resolve();
let seasonStatsLastPersistError = null;

function queueSeasonStatsPersistence(operation) {
  seasonStatsWriteChain = seasonStatsWriteChain
    .catch(() => {})
    .then(operation)
    .catch((error) => {
      seasonStatsLastPersistError = error;
      console.warn("[SeasonStatsArchive] IndexedDB persistence failed", error);
      return false;
    });
  return seasonStatsWriteChain;
}

const BEST_OF_SEVEN_HOME_ORDER = ["H", "H", "A", "A", "H", "A", "H"];

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseBoxMinutes(value) {
  if (typeof value === "string" && value.includes(":")) {
    const [mins, secs] = value.split(":").map((part) => Number(part));
    const m = Number.isFinite(mins) ? mins : 0;
    const s = Number.isFinite(secs) ? secs : 0;
    return m + s / 60;
  }
  return safeNumber(value, 0);
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

function writeCompressedStorageValue(key, value) {
  try {
    const json = JSON.stringify(value);
    const compressed = LZString.compressToUTF16(json);
    localStorage.setItem(key, `lz:${compressed}`);
    return true;
  } catch {
    return false;
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
    portraitId: player?.portraitId || player?.portraitFamilyId || "",
    portraitFamilyId: player?.portraitFamilyId || player?.portraitId || "",
    portraitVariant: player?.portraitVariant || player?.portraitStage || "",
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


export function stripAwardDisplayRows(statsMap = {}) {
  return Object.fromEntries(
    Object.entries(statsMap || {}).filter(([, row]) => !row?._awardsOnly && !row?._combinedForAwards)
  );
}

function isRealRawPlayerStatRow(rec = {}) {
  if (!rec || rec._awardsOnly || rec._combinedForAwards) return false;
  const playerName = rec?.player || rec?.name;
  if (!playerName) return false;
  return (
    safeNumber(rec?.gp, 0) > 0 ||
    safeNumber(rec?.min, 0) > 0 ||
    safeNumber(rec?.pts, 0) > 0 ||
    safeNumber(rec?.reb, 0) > 0 ||
    safeNumber(rec?.ast, 0) > 0
  );
}

function addRawStatsInto(target, row = {}) {
  if (!target || !row) return target;
  target.gp += safeNumber(row?.gp, 0);
  target.min += safeNumber(row?.min, 0);
  target.pts += safeNumber(row?.pts, 0);
  target.reb += safeNumber(row?.reb, 0);
  target.ast += safeNumber(row?.ast, 0);
  target.stl += safeNumber(row?.stl, 0);
  target.blk += safeNumber(row?.blk, 0);
  target.fgm += safeNumber(row?.fgm, 0);
  target.fga += safeNumber(row?.fga, 0);
  target.tpm += safeNumber(row?.tpm, 0);
  target.tpa += safeNumber(row?.tpa, 0);
  target.ftm += safeNumber(row?.ftm, 0);
  target.fta += safeNumber(row?.fta, 0);
  target.to += safeNumber(row?.to ?? row?.tov ?? row?.turnovers, 0);
  target.pf += safeNumber(row?.pf ?? row?.fouls, 0);
  return target;
}

function combineRawStatsByPlayerName(rawPlayerStats = {}) {
  const byName = new Map();

  for (const rec of Object.values(rawPlayerStats || {})) {
    if (!isRealRawPlayerStatRow(rec)) continue;
    const playerName = rec?.player || rec?.name;
    if (!playerName) continue;

    if (!byName.has(playerName)) byName.set(playerName, createRawPlayerStat(playerName, rec?.team || rec?.teamName || ""));
    const target = byName.get(playerName);
    target.team = rec?.team || rec?.teamName || target.team || "";
    addRawStatsInto(target, rec);
  }

  return byName;
}

export function snapshotHasUsefulPlayerStats(snapshot) {
  return Boolean(
    snapshot &&
      Array.isArray(snapshot.playerRows) &&
      snapshot.playerRows.some((row) => safeNumber(row?.stats?.GP ?? row?.gp, 0) > 0)
  );
}

export function snapshotHasAnyTeamGames(snapshot) {
  return Boolean(
    snapshot &&
      Array.isArray(snapshot.teamRows) &&
      snapshot.teamRows.some((row) => safeNumber(row?.stats?.GP ?? row?.gamesPlayed ?? row?.gp, 0) > 0)
  );
}

function snapshotIsUseful(snapshot) {
  return snapshotHasUsefulPlayerStats(snapshot) || snapshotHasAnyTeamGames(snapshot);
}

function readCompletedStatsBackup() {
  if (completedStatsBackupCache && typeof completedStatsBackupCache === "object") {
    return completedStatsBackupCache;
  }
  const backup = readStorageValue(COMPLETED_STATS_BACKUP_KEY, null);
  if (!backup || typeof backup !== "object") return null;
  completedStatsBackupCache = backup;
  return backup;
}

function readCompletedRegularPlayerStatsBackup(seasonYear = null) {
  let backup = completedRegularPlayerStatsBackupCache;
  if (!backup || typeof backup !== "object") {
    backup = readStorageValue(COMPLETED_REGULAR_PLAYER_STATS_KEY, null);
    if (backup && typeof backup === "object") {
      completedRegularPlayerStatsBackupCache = backup;
    }
  }
  if (!backup || typeof backup !== "object") return null;
  const targetYear = safeNumber(seasonYear, 0);
  if (targetYear && safeNumber(backup?.seasonYear, 0) !== targetYear) return null;
  const stats = backup?.playerStatsMap || backup?.stats || null;
  if (!stats || typeof stats !== "object") return null;
  return stats;
}

function persistCompletedRegularPlayerStatsBackup(seasonYear, playerStatsMap) {
  const year = safeNumber(seasonYear, 0);
  if (!year) return;
  if (!playerStatsMap || typeof playerStatsMap !== "object") return;
  if (!Object.values(playerStatsMap).some(isRealRawPlayerStatRow)) return;

  const payload = {
    version: SEASON_STATS_ARCHIVE_VERSION,
    seasonYear: year,
    playerStatsMap,
    updatedAt: new Date().toISOString(),
  };
  completedRegularPlayerStatsBackupCache = payload;
  queueSeasonStatsPersistence(async () => {
    try {
      await saveAppDataToDB(COMPLETED_REGULAR_PLAYER_STATS_KEY, payload);
      seasonStatsLastPersistError = null;
      try { localStorage.removeItem(COMPLETED_REGULAR_PLAYER_STATS_KEY); } catch {}
      return true;
    } catch (error) {
      // Critical recovery only: preserve the last completed regular-season
      // snapshot in compressed localStorage if IndexedDB is unavailable.
      writeCompressedStorageValue(COMPLETED_REGULAR_PLAYER_STATS_KEY, payload);
      throw error;
    }
  });
}

function persistCompletedStatsBackup(seasonYear, regular, playoffs) {
  const year = safeNumber(seasonYear, 0);
  if (!year) return;

  const previous = readCompletedStatsBackup();
  const sameSeason = safeNumber(previous?.seasonYear, 0) === year;
  const previousRegular = sameSeason ? previous?.regular || null : null;
  const previousPlayoffs = sameSeason ? previous?.playoffs || null : null;

  const nextRegular = snapshotHasUsefulPlayerStats(regular)
    ? regular
    : snapshotHasUsefulPlayerStats(previousRegular)
    ? previousRegular
    : regular || previousRegular || null;
  const nextPlayoffs = snapshotIsUseful(playoffs)
    ? playoffs
    : snapshotIsUseful(previousPlayoffs)
    ? previousPlayoffs
    : playoffs || previousPlayoffs || null;

  // Never replace the last useful completed-season backup with an empty
  // snapshot created by a later offseason/progression cleanup path.
  if (!snapshotIsUseful(nextRegular) && !snapshotIsUseful(nextPlayoffs)) return;

  const payload = {
    version: SEASON_STATS_ARCHIVE_VERSION,
    seasonYear: year,
    regular: nextRegular,
    playoffs: nextPlayoffs,
    updatedAt: new Date().toISOString(),
  };
  completedStatsBackupCache = payload;
  queueSeasonStatsPersistence(async () => {
    try {
      await saveAppDataToDB(COMPLETED_STATS_BACKUP_KEY, payload);
      seasonStatsLastPersistError = null;
      try { localStorage.removeItem(COMPLETED_STATS_BACKUP_KEY); } catch {}
      return true;
    } catch (error) {
      // Critical recovery only: preserve the last completed-season archive in
      // compressed localStorage if IndexedDB is unavailable.
      writeCompressedStorageValue(COMPLETED_STATS_BACKUP_KEY, payload);
      throw error;
    }
  });
}

export async function flushSeasonStatsArchiveStorageWrites() {
  await seasonStatsWriteChain.catch(() => {});
}

export async function initializeSeasonStatsArchiveStorage({ reset = false } = {}) {
  if (seasonStatsStorageInitialized && !reset) return getSeasonStatsArchiveStorageReport();

  if (reset) {
    completedStatsBackupCache = null;
    completedRegularPlayerStatsBackupCache = null;
    try { localStorage.removeItem(COMPLETED_STATS_BACKUP_KEY); } catch {}
    try { localStorage.removeItem(COMPLETED_REGULAR_PLAYER_STATS_KEY); } catch {}
    await Promise.allSettled([
      deleteAppDataFromDB(COMPLETED_STATS_BACKUP_KEY),
      deleteAppDataFromDB(COMPLETED_REGULAR_PLAYER_STATS_KEY),
    ]);
    seasonStatsStorageInitialized = true;
    return getSeasonStatsArchiveStorageReport();
  }

  let dbCompleted = null;
  let dbRegular = null;
  try {
    [dbCompleted, dbRegular] = await Promise.all([
      loadAppDataFromDB(COMPLETED_STATS_BACKUP_KEY),
      loadAppDataFromDB(COMPLETED_REGULAR_PLAYER_STATS_KEY),
    ]);
  } catch (error) {
    console.warn("[SeasonStatsArchive] IndexedDB bootstrap read failed", error);
  }

  const legacyCompleted = readStorageValue(COMPLETED_STATS_BACKUP_KEY, null);
  const legacyRegular = readStorageValue(COMPLETED_REGULAR_PLAYER_STATS_KEY, null);
  completedStatsBackupCache = legacyCompleted || dbCompleted || null;
  completedRegularPlayerStatsBackupCache = legacyRegular || dbRegular || null;

  const migrations = [];
  if (legacyCompleted) {
    migrations.push(
      saveAppDataToDB(COMPLETED_STATS_BACKUP_KEY, legacyCompleted).then(() => {
        localStorage.removeItem(COMPLETED_STATS_BACKUP_KEY);
      })
    );
  }
  if (legacyRegular) {
    migrations.push(
      saveAppDataToDB(COMPLETED_REGULAR_PLAYER_STATS_KEY, legacyRegular).then(() => {
        localStorage.removeItem(COMPLETED_REGULAR_PLAYER_STATS_KEY);
      })
    );
  }

  if (migrations.length) {
    const settled = await Promise.allSettled(migrations);
    const failed = settled.find((row) => row.status === "rejected");
    if (failed) {
      seasonStatsLastPersistError = failed.reason;
      console.warn("[SeasonStatsArchive] legacy backup migration incomplete; localStorage fallback kept where needed", failed.reason);
    } else {
      seasonStatsLastPersistError = null;
    }
  }

  seasonStatsStorageInitialized = true;
  return getSeasonStatsArchiveStorageReport();
}

export async function getSeasonStatsArchiveStorageReport() {
  let dbCompleted = null;
  let dbRegular = null;
  let indexedDbReadable = false;
  try {
    [dbCompleted, dbRegular] = await Promise.all([
      loadAppDataFromDB(COMPLETED_STATS_BACKUP_KEY),
      loadAppDataFromDB(COMPLETED_REGULAR_PLAYER_STATS_KEY),
    ]);
    indexedDbReadable = true;
  } catch {}

  return {
    initialized: seasonStatsStorageInitialized,
    storage: "indexedDB",
    completedSeasonYear: safeNumber(completedStatsBackupCache?.seasonYear, 0) || null,
    completedRegularSeasonYear:
      safeNumber(completedRegularPlayerStatsBackupCache?.seasonYear, 0) || null,
    indexedDbCompletedSeasonYear: safeNumber(dbCompleted?.seasonYear, 0) || null,
    indexedDbCompletedRegularSeasonYear: safeNumber(dbRegular?.seasonYear, 0) || null,
    indexedDbReadable,
    localStorageCompletedBackupPresent:
      typeof localStorage !== "undefined" && localStorage.getItem(COMPLETED_STATS_BACKUP_KEY) !== null,
    localStorageRegularBackupPresent:
      typeof localStorage !== "undefined" && localStorage.getItem(COMPLETED_REGULAR_PLAYER_STATS_KEY) !== null,
    lastPersistError: seasonStatsLastPersistError
      ? String(seasonStatsLastPersistError?.message || seasonStatsLastPersistError)
      : null,
  };
}

function addBoxRow(target, teamName, row) {
  const playerName = row?.player || row?.player_name || row?.name;
  if (!playerName || !teamName) return;

  const minutes = parseBoxMinutes(row?.min ?? row?.minutes);
  // Box-score exports can include every roster player with 0.0 minutes. Those
  // are DNPs and must not count as games played in playoff/offseason archives.
  if (minutes <= 0) return;

  const key = `${playerName}__${teamName}`;
  if (!target[key]) target[key] = createRawPlayerStat(playerName, teamName);

  const rec = target[key];
  const fg = parseMadeAttempts(row?.fg);
  const three = parseMadeAttempts(row?.["3p"] ?? row?.tp ?? row?.three);
  const ft = parseMadeAttempts(row?.ft);

  rec.gp += 1;
  rec.min += minutes;
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
  const schedule = readScheduleFromStorage() || {};
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


function buildRegularPlayerStatsFromStoredBoxScores() {
  const schedule = readScheduleFromStorage() || {};
  const results = readRegularSeasonResultsV3();
  const scheduleById = new Map();

  for (const games of Object.values(schedule || {})) {
    for (const game of games || []) {
      if (game?.id == null) continue;
      scheduleById.set(String(game.id), game);
    }
  }

  const rawPlayerStats = {};
  for (const [gameId, result] of Object.entries(results || {})) {
    const game = scheduleById.get(String(gameId));
    if (!game || !result?.box) continue;
    for (const row of result?.box?.home || []) addBoxRow(rawPlayerStats, game.home, row);
    for (const row of result?.box?.away || []) addBoxRow(rawPlayerStats, game.away, row);
  }

  return rawPlayerStats;
}

export function readCanonicalRegularPlayerStatsMap() {
  const stored = readStorageValue(PLAYER_STATS_KEY, {}) || {};
  const hasAwardHelpers = Object.values(stored).some(
    (row) => row?._awardsOnly || row?._combinedForAwards
  );

  if (!hasAwardHelpers) return stored;

  // Older builds replaced a traded player's current-team segment with an
  // awards-only combined row. Rebuild the canonical season map from actual
  // game box scores when those results are still available, then repair the
  // live key so every other stats consumer sees the same source of truth.
  const rebuilt = buildRegularPlayerStatsFromStoredBoxScores();
  if (Object.values(rebuilt || {}).some(isRealRawPlayerStatRow)) {
    writeCompressedStorageValue(PLAYER_STATS_KEY, rebuilt);
    return rebuilt;
  }

  return stripAwardDisplayRows(stored);
}

function chooseUsefulRegularRawStats(...candidates) {
  for (const candidate of candidates) {
    if (
      candidate &&
      typeof candidate === "object" &&
      Object.values(candidate).some(isRealRawPlayerStatRow)
    ) {
      return candidate;
    }
  }
  return candidates.find((candidate) => candidate && typeof candidate === "object") || {};
}

function buildRegularSnapshotFromStoredBoxScores(leagueData, seasonYear = null) {
  const rawPlayerStats = buildRegularPlayerStatsFromStoredBoxScores();
  if (!Object.values(rawPlayerStats || {}).some(isRealRawPlayerStatRow)) return null;

  return buildRegularSeasonStatsSnapshot(
    leagueData,
    rawPlayerStats,
    buildRegularSeasonRowsFromStorage(leagueData),
    seasonYear
  );
}

function buildSnapshotFromRaw({
  seasonYear,
  label,
  teams,
  rawPlayerStats,
  rawTeamStats,
  includeZeroRosterPlayers = true,
  combinePlayerStatsToRosterTeams = false,
}) {
  const maps = teamMetaMaps(teams);
  const playerRows = [];
  const addedPlayerKeys = new Set();

  if (combinePlayerStatsToRosterTeams) {
    const combinedByName = combineRawStatsByPlayerName(rawPlayerStats || {});

    for (const team of teams || []) {
      const teamName = team?.name || team?.teamName || "";
      for (const player of team?.players || []) {
        const playerName = player?.name || player?.player;
        if (!playerName || !teamName) continue;
        const key = `${playerName}__${teamName}`;
        const rec = combinedByName.get(playerName) || null;
        playerRows.push({
          ...player,
          name: playerName,
          player: playerName,
          teamName,
          team: teamName,
          teamLogo: maps.logoByTeam.get(teamName) || team.logo || "",
          headshot: resolvePlayerImage(player),
          stats: rec ? toPlayerDisplayStats({ ...rec, team: teamName }) : blankPlayerStats(),
        });
        addedPlayerKeys.add(key);
      }
    }
  } else {

  for (const rec of Object.values(rawPlayerStats || {})) {
    // Awards-page combined/helper rows are useful for award races, but they are
    // not real per-team season rows and should never inflate player-card history
    // or rookie eligibility recovery archives.
    if (rec?._awardsOnly || rec?._combinedForAwards) continue;
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

  }

  if (includeZeroRosterPlayers && !combinePlayerStatsToRosterTeams) {
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
    combinePlayerStatsToRosterTeams: true,
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
    includeZeroRosterPlayers: true,
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

export function ensureCompletedSeasonStatsArchive(
  leagueData,
  seasonStartYear,
  options = {}
) {
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
  const providedPlayerStats = options?.playerStatsMap;
  const providedHasRealStats = Boolean(
    providedPlayerStats &&
      typeof providedPlayerStats === "object" &&
      Object.values(providedPlayerStats).some(isRealRawPlayerStatRow)
  );
  const storedPlayerStats = readCanonicalRegularPlayerStatsMap();
  const storedHasRealStats = Boolean(
    storedPlayerStats &&
      typeof storedPlayerStats === "object" &&
      Object.values(storedPlayerStats).some(isRealRawPlayerStatRow)
  );
  const rawBackupPlayerStats = readCompletedRegularPlayerStatsBackup(targetYear);
  const rebuiltRegularPlayerStats = !providedHasRealStats && !storedHasRealStats
    ? buildRegularPlayerStatsFromStoredBoxScores()
    : null;
  const playerStatsMap = chooseUsefulRegularRawStats(
    providedPlayerStats,
    storedPlayerStats,
    rawBackupPlayerStats,
    rebuiltRegularPlayerStats
  );
  if (Object.values(playerStatsMap || {}).some(isRealRawPlayerStatRow)) {
    persistCompletedRegularPlayerStatsBackup(targetYear, playerStatsMap);
  }
  const postseasonState = options?.postseasonState ?? readStorageValue(POSTSEASON_KEY, null);
  const playoffResults = options?.playoffResults ?? readStorageValue(PLAYOFF_RESULTS_KEY, {}) ?? {};
  const rosterLeagueData = options?.rosterLeagueData || next;

  const providedStandings = Array.isArray(options?.regularSeasonRows)
    ? options.regularSeasonRows
    : null;
  const savedFinalStandings = providedStandings?.length
    ? providedStandings
    : Array.isArray(entry?.teams) && entry.teams.length
    ? entry.teams
    : buildRegularSeasonRowsFromStorage(next);

  const previousArchive = entry?.statsArchive || {};
  const previousRegular = previousArchive?.regular || null;
  const previousPlayoffs = previousArchive?.playoffs || null;

  const rebuiltRegular = buildRegularSeasonStatsSnapshot(
    rosterLeagueData,
    playerStatsMap,
    savedFinalStandings,
    targetYear
  );

  const rebuiltPlayoffs = buildPlayoffStatsSnapshot(
    rosterLeagueData,
    postseasonState,
    playoffResults,
    targetYear
  );

  // This function is called from several season/offseason paths. Some of those
  // paths run after live stat storage has already been cleared. Never let a
  // later empty rebuild overwrite the real completed-season table captured at
  // the end of the regular season or playoffs.
  const regular = snapshotHasUsefulPlayerStats(rebuiltRegular) || !snapshotHasUsefulPlayerStats(previousRegular)
    ? rebuiltRegular
    : previousRegular;
  const playoffs = snapshotHasUsefulPlayerStats(rebuiltPlayoffs) || !snapshotHasUsefulPlayerStats(previousPlayoffs)
    ? rebuiltPlayoffs
    : previousPlayoffs;

  history[index] = {
    ...entry,
    seasonYear: targetYear,
    statsArchive: {
      version: SEASON_STATS_ARCHIVE_VERSION,
      ...previousArchive,
      regular,
      playoffs,
      archivedAt: new Date().toISOString(),
    },
  };

  next.seasonHistory = history
    .sort((a, b) => safeNumber(a?.seasonYear, 0) - safeNumber(b?.seasonYear, 0))
    .slice(-10);

  // Keep one compressed latest-season backup outside leagueData. This protects
  // the offseason stats pages from later stale league saves without retaining
  // game logs or multiple seasons of duplicate data.
  persistCompletedStatsBackup(targetYear, regular, playoffs);

  return next;
}

export function getLivePlayoffStatsSnapshot(leagueData) {
  const post = readStorageValue(POSTSEASON_KEY, null);
  const results = readStorageValue(PLAYOFF_RESULTS_KEY, {}) || {};
  const seasonYear = safeNumber(post?.seasonYear, 0);
  return buildPlayoffStatsSnapshot(leagueData, post, results, seasonYear);
}

export function getArchivedStatsSnapshot(leagueData, scope = "regular") {
  const rows = Array.isArray(leagueData?.seasonHistory) ? leagueData.seasonHistory : [];
  const getScoped = (entry) =>
    scope === "playoffs" ? entry?.statsArchive?.playoffs || null : entry?.statsArchive?.regular || null;

  const candidates = rows
    .map((entry) => {
      const snapshot = getScoped(entry);
      const seasonYear = safeNumber(snapshot?.seasonYear ?? entry?.seasonYear, 0);
      return { snapshot, seasonYear, source: "league" };
    })
    .filter((row) => row.snapshot);

  const backup = readCompletedStatsBackup();
  const backupSnapshot = scope === "playoffs" ? backup?.playoffs || null : backup?.regular || null;
  if (backupSnapshot) {
    candidates.push({
      snapshot: backupSnapshot,
      seasonYear: safeNumber(backupSnapshot?.seasonYear ?? backup?.seasonYear, 0),
      source: "backup",
    });
  }

  const latestKnownYear = candidates.reduce(
    (max, row) => Math.max(max, safeNumber(row?.seasonYear, 0)),
    0
  );

  const hasUsefulStoredRegularSnapshot =
    scope !== "playoffs" && candidates.some((row) => snapshotHasUsefulPlayerStats(row.snapshot));

  // The exact end-of-season display snapshot is the source of truth. Only
  // reconstruct from raw totals or box scores when no useful archived snapshot
  // survived. Rebuilding from the current offseason roster can otherwise move
  // last season's stats onto the wrong team after roster transactions.
  if (scope !== "playoffs" && !hasUsefulStoredRegularSnapshot) {
    const rawBackupPlayerStats = readCompletedRegularPlayerStatsBackup(latestKnownYear || null);
    if (rawBackupPlayerStats && Object.values(rawBackupPlayerStats).some(isRealRawPlayerStatRow)) {
      const recoveredFromRawBackup = buildRegularSeasonStatsSnapshot(
        leagueData,
        rawBackupPlayerStats,
        buildRegularSeasonRowsFromStorage(leagueData),
        latestKnownYear || null
      );
      if (snapshotHasUsefulPlayerStats(recoveredFromRawBackup)) {
        candidates.push({
          snapshot: recoveredFromRawBackup,
          seasonYear: safeNumber(recoveredFromRawBackup?.seasonYear ?? latestKnownYear, 0),
          source: "raw-stats-backup",
        });
      }
    }

    const recovered = buildRegularSnapshotFromStoredBoxScores(leagueData, latestKnownYear || null);
    if (recovered && snapshotHasUsefulPlayerStats(recovered)) {
      candidates.push({
        snapshot: recovered,
        seasonYear: safeNumber(recovered?.seasonYear ?? latestKnownYear, 0),
        source: "result-store-recovery",
      });
    }
  }

  const usefulCandidates = candidates.filter((row) =>
    scope === "playoffs" ? snapshotIsUseful(row.snapshot) : snapshotHasUsefulPlayerStats(row.snapshot)
  );
  const rankedCandidates = usefulCandidates.length ? usefulCandidates : candidates;

  rankedCandidates.sort((a, b) => {
    if (b.seasonYear !== a.seasonYear) return b.seasonYear - a.seasonYear;

    const sourceRank = (source) =>
      source === "backup" ? 4 : source === "league" ? 3 : source === "raw-stats-backup" ? 2 : 1;
    return sourceRank(b.source) - sourceRank(a.source);
  });

  return rankedCandidates[0]?.snapshot || null;
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
